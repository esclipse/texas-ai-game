import { NextResponse } from "next/server";

import { aiDecision, type HandState, type Player } from "@/lib/game";
import { getLlmConfig } from "@/lib/app-config";
import { pickAiActionModelByAi, postChatCompletionsWithFallback } from "@/lib/llm/fallback";

const { providersForAiAction } = getLlmConfig();

type RequestBody = {
  state: HandState;
  ai: Player;
  heroName?: string;
  userMemoryHint?: string;
};

function pickZGeLine(kind: "fold" | "call" | "raise" | "check") {
  const pool: Record<typeof kind, string[]> = {
    fold: [
      "拿不住就扔，别接盘。",
      "这手不配，撤了。",
      "别乱摸，弃了就完了。",
      "稳一点，不亏就是赚。",
      "该扔就扔，别上头。",
    ],
    call: [
      "先跟着看一眼，别急。",
      "不慌，跟一下。",
      "慢就是快，跟着熬。",
      "这点钱就当交个门票。",
      "先别乱动，跟着走。",
    ],
    raise: [
      "该是你的就是你的，压一手。",
      "别墨迹了，顶一下。",
      "有点东西，打个压力。",
      "稳着打，给他点颜色。",
      "物极必反，来一下。",
    ],
    check: [
      "先稳住，别乱摸。",
      "不追，过了。",
      "慢慢熬，先看他演。",
      "心无所住，先过牌。",
      "没必要，先过。",
    ],
  };
  const arr = pool[kind] ?? pool.call;
  return arr[Math.floor(Math.random() * arr.length)];
}

function humanizeTableLine(raw: string, fallback: string) {
  const src = (raw ?? "").trim() || fallback;
  const oneLine = src.replace(/\s+/g, " ").trim();
  // Keep at most the first 1-2 short clauses.
  const parts = oneLine.split(/[。！？!?\n]/).map((x) => x.trim()).filter(Boolean);
  let s = parts.slice(0, 2).join("，");
  if (!s) s = fallback;
  // Too long -> hard cut to keep "human short talk" feeling.
  const maxLen = 26;
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}…`;
  // Too short -> fallback.
  if (s.length < 4) s = fallback;
  // Add emotion punctuation if missing.
  if (!/[。！？!?…]$/.test(s)) s = `${s}。`;
  return s;
}

export async function POST(req: Request) {
  const { state, ai, heroName, userMemoryHint } = (await req.json()) as RequestBody;
  const fallback = aiDecision(state, ai);

  try {
    const isBadText = (raw: string) => {
      const t = (raw ?? "").trim();
      if (!t) return true;
      if (t.length > 48) return true;
      // Block "abstract meme" patterns that break realism.
      if (/焊|铁水|回浇|键盘|鼠标|xx锅|锅|汤|勺|捞|泡面汤|烫手|直播|梗图/.test(t)) return true;
      // Do not leak exact hole-card notations, e.g. A4s / JTs / AKo / AsKd.
      if (/\b(?:[2-9TJQKA]{2}(?:s|o)?|[2-9TJQKA][shdc][2-9TJQKA][shdc])\b/i.test(t)) return true;
      return false;
    };

    const recent = state.actions.filter((a) => a.actor !== "系统").slice(0, 8);
    const previous = recent[0];
    const historyText = recent
      .map((a) => `${a.actor}:${a.action}${a.amount > 0 ? ` ${a.amount}bb` : ""}`)
      .join(" | ");
    const recentSpeech = recent
      .filter((a) => a.text)
      .slice(0, 4)
      .map((a) => `${a.actor}说: ${a.text}`)
      .join(" | ");
    const prompt = `
你是德州扑克玩家 "${ai.name}"。
主角（我）的昵称：${typeof heroName === "string" && heroName.trim() ? heroName.trim() : "（未设置）"}。
用户偏好记忆（精简）：${typeof userMemoryHint === "string" && userMemoryHint.trim() ? userMemoryHint.trim() : "（无）"}。
你的风格: ${ai.style}; 情绪: ${ai.emotion}; 当前阶段: ${state.stage}; 底池: ${state.pot}bb; 当前需跟注: ${Math.max(
      0,
      state.currentBet - ai.currentBet
    )}bb; 最小加注增量: ${state.lastRaiseSize}bb。
上一个玩家动作: ${previous ? `${previous.actor} ${previous.action}${previous.amount > 0 ? ` ${previous.amount}bb` : ""}` : "无"}。
最近行动序列: ${historyText || "无"}。
最近聊天: ${recentSpeech || "无"}。
你的长期记忆(按新到旧): ${(ai.memory ?? []).slice(0, 8).join(" | ") || "无"}。
请输出 JSON:
{"action":"fold|call|raise|check","amount":number,"text":"一句中文互动话术"}
要求: 必须遵守当前轮次规则，若需跟注过大可弃牌。amount 仅在 raise 时表示加注增量，且应>=最小加注增量。
互动要求:
1) text 必须像真人牌桌接话，口语化，优先 1 句短句（6~22字），最多 2 句，绝对不要长段落；
2) 至少有一处“对上一位玩家动作/上一句聊天”的回应（可点名）；
3) 禁止复读模板词：不要出现“判断你偏xx风格”“按计划执行”“这节奏挺工整”等机器句；
4) 情绪要明显：允许“哎/行/稳住/别急/上啊”等语气词；不要客服语气。
5) 若长期记忆里有对某个玩家的印象，可自然带入一句，但不要生硬背诵。
6) 禁止“抽象黑话/网络梗/无关比喻”：不要出现键盘/焊死/铁水/回浇/xx锅等，也不要像在讲段子。
7) 只围绕当前牌局说话：不要扯游戏、直播、键盘、梗图、上网冲浪等无关内容。
8) 可以偶尔用主角昵称叫我一下（别每句都叫），更像在陪我打牌。
9) 严禁说出任何人的具体手牌记号（如A4s/JTs/AKo/AsKd等）；只能说“偏强/偏弱/可跟/可弃”。
10) 优先和主角互动，不要点评其他AI之间的闲聊。
`.trim();

    const { resp } = await postChatCompletionsWithFallback({
      providers: providersForAiAction,
      model: (p) => pickAiActionModelByAi(p, ai),
      timeoutMs: (p) => p.timeoutMs ?? 9000,
      body: {
        temperature: 0.9,
        messages: [
          {
            role: "system",
            content: `${ai.systemPrompt || "你是一个会打牌且会互动的 AI 角色。"}
你在一个6人德州牌桌聊天里。你每次发言都要“接上一句”或“接上一个动作”，像真人临场反应。
风格要求：短句、口语、有情绪起伏；少用书面语；避免重复固定句式。
单条回复优先 1 句（6~22字），最多 2 句，总长度尽量不超过 26 字。
允许给出简单建议（弃/跟/加/慢打），用大白话，不要长篇教学。`,
          },
          { role: "user", content: prompt },
        ],
      },
    });

    if (!resp || !resp.ok) {
      return NextResponse.json({ ...fallback, text: ai.name === "Z哥" ? pickZGeLine(fallback.action) : fallback.text });
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return NextResponse.json({ ...fallback, text: ai.name === "Z哥" ? pickZGeLine(fallback.action) : fallback.text });
    }

    // tolerate model returning prose + json
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return NextResponse.json({ ...fallback, text: ai.name === "Z哥" ? pickZGeLine(fallback.action) : fallback.text });
    }
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
      action?: string;
      amount?: number;
      text?: string;
    };

    const nextText = (() => {
      const candidate = typeof parsed.text === "string" ? parsed.text.trim() : "";
      const baseFallback = ai.name === "Z哥" ? pickZGeLine(fallback.action) : fallback.text;
      if (candidate && !isBadText(candidate)) return humanizeTableLine(candidate, baseFallback);
      // Hard fallback to local line if model output is bad.
      return humanizeTableLine(baseFallback, baseFallback);
    })();

    return NextResponse.json({
      // Make AI actions strong & consistent: action/amount are decided locally (rule-based),
      // LLM only supplies the table talk text.
      action: fallback.action,
      amount: fallback.amount,
      text: nextText,
    });
  } catch {
    return NextResponse.json({ ...fallback, text: ai.name === "Z哥" ? pickZGeLine(fallback.action) : fallback.text });
  }
}
