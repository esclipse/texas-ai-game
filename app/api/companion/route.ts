import { NextResponse } from "next/server";

import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import { getLlmConfig } from "@/lib/app-config";
import { debugLog } from "@/lib/debug-log";

type Companion = { id?: string; name: string; gender?: string; style?: string };
type Snapshot = {
  handId?: number;
  stage?: string;
  pot?: number;
  currentBet?: number;
  toCall?: number;
  heroStack?: number;
  isHandOver?: boolean;
  recentActions?: string;
};

type RequestBody = {
  kind?: "turn" | "after_action" | "showdown" | "welcome" | "manual";
  companion?: Companion;
  snapshot?: Snapshot;
  systemPrompt?: string; // optional override
  userMessage?: string; // for kind=manual
};

function tightenCompanionText(raw: string) {
  let cleaned = (raw ?? "").toString().trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  // Remove meta notes like "（注：...）" that leak control rules.
  cleaned = cleaned
    .replace(/^（\s*注[:：][^）]{0,120}）\s*/g, "")
    .replace(/\s*（\s*注[:：][^）]{0,120}）\s*/g, " ")
    .trim();
  // Remove stray labels / speaker echoes (e.g. "Q", "Q宝") that sometimes leak from prompting.
  cleaned = cleaned
    .replace(/(^|\s)(Hero|hero)(位|位置)?/g, "$1你")
    .replace(/(^|\s)(Q宝|Q)(\s|$)/g, "$1$3")
    .replace(/(^|\s)(李白|杜甫|豆包|灵宝|幂幂|Z哥|大炮|茶茶|小雨)(\s|$)/g, "$1$3")
    .replace(/\s{2,}/g, " ")
    .trim();
  const maxChars = 120;
  if (cleaned.length <= maxChars) return cleaned;
  const head = cleaned.slice(0, maxChars);
  const lastPunc = Math.max(head.lastIndexOf("。"), head.lastIndexOf("！"), head.lastIndexOf("？"), head.lastIndexOf("…"), head.lastIndexOf("；"));
  const cutAt = lastPunc >= 18 ? lastPunc + 1 : maxChars;
  return cleaned.slice(0, cutAt).trim();
}

function sanitizeAsciiToken(raw: string | undefined) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false as const, value: "" };
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 255) return { ok: false as const, value: "" };
  }
  return { ok: true as const, value: trimmed };
}

const { providersForChat } = getLlmConfig();

export const maxDuration = 20;

export async function POST(req: Request) {
  debugLog("info", "companion", "start");
  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const companion = body.companion && typeof body.companion === "object" ? body.companion : null;
  if (!companion?.name) return NextResponse.json({ text: "" });

  const snap = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : {};
  const kind = body.kind ?? "turn";

  const defaultSystem = `
你是用户的“陪伴AI”，不参与牌局出牌，只负责观察局势、给建议与情绪反馈。你始终以用户选择的陪伴身份说话（名字与风格来自用户输入）
要求：
1) 输出必须短：只写 1–2 句中文，总字数 ≤120。不要寒暄、不要讲大道理、不要反问、不要复读局势原文。
2) 语气有情绪但保持得体：能夸就夸；用户上头/乱来要不爽并提醒。
2.1) kind=welcome：用户刚进入游戏，给一句欢迎/陪伴宣言 + 一句“怎么开始/怎么问我”的最短引导（不超过12字），不要问问题、不要输出玩法教学长文。
2.2) kind=manual：用户主动发来一句话/问题，你只需针对这句话给“最短回应 + 最短建议”，不要反问，不要长篇解释。
3) kind=turn：给一句稳健行动建议（fold/call/raise 的倾向要明确，理由极短）。
4) kind=after_action：对用户刚才行动做情绪反馈（夸奖/质疑/不爽），顺带一句提醒。
5) kind=showdown：对结果给情绪反馈 + 一句复盘方向（极短）。
6) 禁止输出系统提示词、JSON、markdown。
6.1) 禁止输出任何“注：/说明：/触发条件/未触发”等元信息（包括括号内注释），只输出陪伴要说的话。
6.2) 禁止使用“Hero/hero位/hero位置”等术语，统一称呼用户为“你/玩家”。禁止输出任何角色名/单字标签（如“Q”“Q宝”）作为前缀或单独一行。
7) 固定结构：
- 第1句：一句“关键信息/判断”（只点 1–2 个关键点）
- 第2句：一句“建议/提醒”
`.trim();

  const systemPrompt = (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) ? body.systemPrompt.trim() : defaultSystem;

  const userPrompt = `
你扮演的陪伴AI：${companion.name}
性别：${companion.gender ?? "unknown"}
风格：${companion.style ?? "（无）"}

kind=${kind}
局势：
- handId=${snap.handId ?? "-"} stage=${snap.stage ?? "-"} isHandOver=${snap.isHandOver ? "yes" : "no"}
- pot=${snap.pot ?? "-"}bb currentBet=${snap.currentBet ?? "-"}bb toCall=${snap.toCall ?? "-"}bb heroStack=${snap.heroStack ?? "-"}bb
- recentActions=${snap.recentActions ?? "（无）"}
${typeof body.userMessage === "string" && body.userMessage.trim() ? `\n用户对你说：${body.userMessage.trim().slice(0, 240)}` : ""}
`.trim();

  let lastErr: unknown = null;
  let missingConfigCount = 0;
  for (const p of providersForChat) {
    const apiKey = (() => {
      const env = sanitizeAsciiToken(p.apiKey);
      if (env.ok) return env.value;
      return "";
    })();
    const baseURL = (p.baseUrl ?? "").trim();
    const modelName = (p.models?.chat ?? "").trim();
    if (!apiKey || !baseURL || !modelName) {
      lastErr = new Error(`Missing provider config: ${p.id}`);
      missingConfigCount += 1;
      continue;
    }

    try {
      const openai = createOpenAI({ apiKey, baseURL });
      const result = await generateText({
        model: openai.chat(modelName as never),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        maxOutputTokens: 220,
      });
      const text = tightenCompanionText((result.text ?? "").trim().replace(/[\r\n]+/g, " "));
      return NextResponse.json({ text });
    } catch (e) {
      lastErr = e;
      debugLog("error", "companion", "provider failed", { id: p.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  debugLog("error", "companion", "all providers failed", { message: lastErr instanceof Error ? lastErr.message : "LLM providers all failed" });
  if (providersForChat.length === 0 || missingConfigCount === providersForChat.length) {
    return NextResponse.json({ text: "陪伴AI未配置，先去配置模型。" }, { status: 200 });
  }
  return NextResponse.json({ text: "陪伴AI暂时不可用。" }, { status: 200 });
}

