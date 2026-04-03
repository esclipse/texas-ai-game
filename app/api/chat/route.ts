import { convertToModelMessages, generateText, type UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import { NextResponse } from "next/server";

import { getLlmConfig } from "@/lib/app-config";
import { CHAT_CREDIT_COST } from "@/lib/chat-credit";
import { debugLog } from "@/lib/debug-log";
import { supabaseAdmin } from "@/lib/supabase/server";

type Gender = "male" | "female" | "unknown";
type RoleLite = { name: string; gender?: Gender; style?: string };

function sanitizeAsciiToken(raw: string | undefined) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false as const, value: "" };
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed.charCodeAt(i) > 255) return { ok: false as const, value: "" };
  }
  return { ok: true as const, value: trimmed };
}

const { providersForChat } = getLlmConfig();

export const maxDuration = 30;

function sseLine(data: unknown) {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

function normalizeRoleName(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 24);
}

function normalizeStyle(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 200);
}

function normalizeGender(raw: unknown): Gender {
  return raw === "male" || raw === "female" || raw === "unknown" ? raw : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function parseRoles(raw: unknown): RoleLite[] {
  if (!Array.isArray(raw)) return [];
  const out: RoleLite[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const name = normalizeRoleName(rec.name);
    if (!name) continue;
    out.push({
      name,
      gender: normalizeGender(rec.gender),
      style: normalizeStyle(rec.style),
    });
  }
  // de-dup by name, keep first
  const seen = new Set<string>();
  return out.filter((r) => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

function parseSelectedRole(raw: unknown): RoleLite | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const name = normalizeRoleName(rec.name);
  if (!name) return null;
  return { name, gender: normalizeGender(rec.gender), style: normalizeStyle(rec.style) };
}

function pickSpeakerFromText(text: string, allowedNames: string[]) {
  // Very simple @name extraction: first @... token
  const m = text.match(/@([^\s@]{1,24})/);
  if (!m) return "";
  const name = normalizeRoleName(m[1]);
  if (!name) return "";
  if (allowedNames.length > 0 && !allowedNames.includes(name)) return "";
  return name;
}

function forceSingleLineSpeaker(text: string, speakerName: string) {
  const raw = (text ?? "").toString().trim().replace(/\s+/g, " ");
  const content = raw.replace(/^【[^】]+】\s*/, "");
  const safeContent = content.replace(/[\r\n]+/g, " ").trim();
  return `【${speakerName}】${safeContent}`;
}

type RpcCreditResult = { ok?: boolean; error?: string; credit_balance?: number };

async function getBearerUserId(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return null;
  const supabase = supabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export async function POST(req: Request) {
  debugLog("info", "chat", "start");
  const body = (await req.json()) as {
    messages?: unknown[];
    gameContext?: unknown;
    roles?: unknown;
    selectedRole?: unknown;
    // allow user to supply their own prompts (you will write them)
    systemPrompt?: unknown;
  };

  const uiMessages = Array.isArray(body.messages) ? body.messages : [];
  const roles = parseRoles(body.roles);
  const selectedRole = parseSelectedRole(body.selectedRole);
  const allowedNames = roles.map((r) => r.name);

  const defaultNames = ["Z哥", "大炮", "Q宝", "幂幂", "谭玄", "茶茶"];
  const speakerPool = allowedNames.length > 0 ? allowedNames : defaultNames;
  const forcedSpeaker = selectedRole?.name ? selectedRole.name : "";

  const userProvidedSystemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  const systemPrompt = userProvidedSystemPrompt;

  const typedUiMessages = uiMessages as UIMessage[];
  const maxMessages = 12;
  const recentUiMessages = typedUiMessages.slice(-maxMessages);

  const userId = await getBearerUserId(req);
  if (userId) {
    const supabase = supabaseAdmin();
    const { data: rpcData, error: rpcErr } = await supabase.rpc("consume_chat_credit", {
      p_user_id: userId,
      p_cost: CHAT_CREDIT_COST,
    });
    if (rpcErr) {
      debugLog("error", "chat", "consume_chat_credit rpc", { message: rpcErr.message });
      return NextResponse.json(
        { error: "Credit 扣减失败（请确认已在 Supabase 执行 chat-credit-schema.sql）", detail: rpcErr.message },
        { status: 500 }
      );
    }
    const payload = rpcData as RpcCreditResult | null;
    if (!payload?.ok) {
      if (payload?.error === "insufficient_credit") {
        return NextResponse.json(
          {
            error: "Credit 不足",
            creditBalance: typeof payload.credit_balance === "number" ? payload.credit_balance : 0,
            cost: CHAT_CREDIT_COST,
          },
          { status: 402 }
        );
      }
      if (payload?.error === "no_wallet") {
        return NextResponse.json({ error: "未找到钱包，请刷新页面或重新登录" }, { status: 403 });
      }
      return NextResponse.json({ error: "Credit 扣减失败", code: payload?.error }, { status: 500 });
    }
  }
  const recentWithoutId: Array<Omit<UIMessage, "id">> = recentUiMessages.map((m) => {
    const { id: _id, ...rest } = m;
    void _id;
    return rest;
  });

  const modelMessages = (await convertToModelMessages(recentWithoutId)) as ModelMessage[];

  let lastErr: unknown = null;
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
      debugLog("error", "chat", "missing provider config", { id: p.id, hasKey: Boolean(apiKey), hasBaseURL: Boolean(baseURL), hasModel: Boolean(modelName) });
      continue;
    }

    try {
      const openai = createOpenAI({ apiKey, baseURL });
      const messages: ModelMessage[] = [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt } satisfies ModelMessage] : []),
        ...modelMessages,
      ];
      const result = await generateText({
        model: openai.chat(modelName as never),
        messages,
        temperature: 0.7,
        maxOutputTokens: 200,
      });

      const rawText = (result.text ?? "").trim();
      const lastUserText = (() => {
        for (let i = typedUiMessages.length - 1; i >= 0; i -= 1) {
          const m = typedUiMessages[i];
          if (m?.role !== "user") continue;
          const rec = asRecord(m as unknown);
          const parts = Array.isArray(rec?.parts) ? (rec?.parts as unknown[]) : [];
          const p0 = parts.find((p) => {
            const pr = asRecord(p);
            return pr?.type === "text" && typeof pr.text === "string";
          });
          const p0r = asRecord(p0);
          if (typeof p0r?.text === "string" && p0r.text) return p0r.text;
          // fallback: try content
          const c = rec?.content;
          if (typeof c === "string" && c) return c;
        }
        return "";
      })();

      const requestedSpeaker = forcedSpeaker || pickSpeakerFromText(lastUserText, speakerPool);
      const finalSpeaker =
        requestedSpeaker ||
        (speakerPool.length > 0 ? speakerPool[Math.floor(Math.random() * speakerPool.length)] : "AI");

      // Keep output parseable for UI even when prompts are empty or user-written.
      const text = forceSingleLineSpeaker(rawText, finalSpeaker);
      const messageId = globalThis.crypto?.randomUUID?.() ?? `m_${Date.now()}`;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(sseLine({ type: "start", messageId })));
          controller.enqueue(enc.encode(sseLine({ type: "text-start", id: messageId })));
          if (text) controller.enqueue(enc.encode(sseLine({ type: "text-delta", id: messageId, delta: text })));
          controller.enqueue(enc.encode(sseLine({ type: "text-end", id: messageId })));
          controller.enqueue(enc.encode(sseLine({ type: "finish", finishReason: "stop" })));
          controller.enqueue(enc.encode(sseLine("[DONE]")));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    } catch (e) {
      lastErr = e;
      debugLog("error", "chat", "provider failed", { id: p.id, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : "LLM providers all failed";
  debugLog("error", "chat", "all providers failed", { message: msg });
  return new Response(msg, { status: 502 });
}
