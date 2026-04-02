import { NextResponse } from "next/server";

import { type HandState, type Player } from "@/lib/game";
import { getLlmConfig } from "@/lib/app-config";
import { pickAiActionModelByAi, postChatCompletionsWithFallback } from "@/lib/llm/fallback";
import { debugLog } from "@/lib/debug-log";

const { providersForAiAction } = getLlmConfig();

type RequestBody = {
  state: HandState;
  ai: Player;
  heroName?: string;
  userMemoryHint?: string;
  // allow user to supply their own prompts (you will write them)
  systemPrompt?: string;
  userPrompt?: string;
};

export async function POST(req: Request) {
  debugLog("info", "ai-action", "start");
  const { state, ai, heroName, userMemoryHint, systemPrompt, userPrompt } = (await req.json()) as RequestBody;

  try {
    void heroName;
    void userMemoryHint;
    const toCall = Math.max(0, state.currentBet - ai.currentBet);
    const minRaise = Math.max(2, state.lastRaiseSize);
    const raiseCapReached = state.raiseCountThisRound >= 3;

    const prompt = typeof userPrompt === "string" && userPrompt.trim() ? userPrompt.trim() : "";
    const sys = typeof systemPrompt === "string" && systemPrompt.trim() ? systemPrompt.trim() : "";

    const { resp } = await postChatCompletionsWithFallback({
      providers: providersForAiAction,
      model: (p) => pickAiActionModelByAi(p, ai),
      timeoutMs: (p) => p.timeoutMs ?? 9000,
      body: {
        temperature: 0.9,
        messages: [
          ...(sys ? [{ role: "system" as const, content: sys }] : []),
          ...(prompt ? [{ role: "user" as const, content: prompt }] : []),
        ],
      },
    });

    if (!resp || !resp.ok) {
      debugLog("warn", "ai-action", "llm failed", { ai: ai.name, ok: resp?.ok ?? false });
      // No aiDecision fallback: return a deterministic legal move.
      const legalAction = toCall > 0 ? "call" : "check";
      return NextResponse.json({
        action: legalAction,
        amount: 0,
        text: "",
      });
    }

    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      const legalAction = toCall > 0 ? "call" : "check";
      return NextResponse.json({ action: legalAction, amount: 0, text: "" });
    }

    // tolerate model returning prose + json
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      const legalAction = toCall > 0 ? "call" : "check";
      return NextResponse.json({ action: legalAction, amount: 0, text: "" });
    }
    const parsed = JSON.parse(content.slice(jsonStart, jsonEnd + 1)) as {
      action?: string;
      amount?: number;
      text?: string;
    };

    const normalizeText = (t: unknown) => {
      const s = typeof t === "string" ? t.trim().replace(/\s+/g, " ") : "";
      if (!s) return "";
      // keep it short; don't force punctuation to avoid overfitting templates
      if (s.length > 26) return `${s.slice(0, 26)}…`;
      return s;
    };

    const normalizeAction = (raw: unknown): "fold" | "call" | "raise" | "check" | null => {
      const s = typeof raw === "string" ? raw.trim() : "";
      if (s === "fold" || s === "call" || s === "raise" || s === "check") return s;
      return null;
    };

    const requestedAction = normalizeAction(parsed.action);
    const requestedAmount = typeof parsed.amount === "number" && Number.isFinite(parsed.amount) ? Math.max(0, Math.floor(parsed.amount)) : 0;

    // Legalize (ensure action/amount won't break applyActionToState betting progression).
    let finalAction: "fold" | "call" | "raise" | "check" = toCall > 0 ? "call" : "check";
    let finalAmount = 0;

    if (requestedAction === "fold") {
      finalAction = "fold";
      finalAmount = 0;
    } else if (requestedAction === "check") {
      finalAction = toCall > 0 ? "call" : "check";
      finalAmount = 0;
    } else if (requestedAction === "call") {
      finalAction = "call";
      finalAmount = 0;
    } else if (requestedAction === "raise") {
      if (raiseCapReached) {
        finalAction = toCall > 0 ? "call" : "check";
        finalAmount = 0;
      } else if (toCall <= 0) {
        // raise over check
        if (ai.stack < minRaise) {
          finalAction = "check";
          finalAmount = 0;
        } else {
          finalAction = "raise";
          finalAmount = Math.max(minRaise, requestedAmount || minRaise);
        }
      } else {
        if (ai.stack - toCall < minRaise) {
          finalAction = "call";
          finalAmount = 0;
        } else {
          finalAction = "raise";
          finalAmount = Math.max(minRaise, requestedAmount || minRaise);
        }
      }
    } else {
      // missing/invalid action -> choose default legal move
      finalAction = toCall > 0 ? "call" : "check";
      finalAmount = 0;
    }

    const nextText = normalizeText(parsed.text);
    debugLog("info", "ai-action", "ok", { ai: ai.name, action: finalAction, amount: finalAmount, textLen: nextText.length });

    return NextResponse.json({
      action: finalAction,
      amount: finalAmount,
      text: nextText,
    });
  } catch {
    debugLog("error", "ai-action", "exception");
    const toCall = Math.max(0, state.currentBet - ai.currentBet);
    return NextResponse.json({
      action: toCall > 0 ? "call" : "check",
      amount: 0,
      text: "",
    });
  }
}
