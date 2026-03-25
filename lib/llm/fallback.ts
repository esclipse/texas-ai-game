export type LlmProvider = {
  id: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  models?: {
    chat?: string;
    default?: string;
    secondary?: string;
    perPlayer?: Record<string, string>;
    perName?: Record<string, string>;
    perRef?: Record<string, string>;
  };
};

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

function normalizeBaseUrl(raw: string) {
  return raw.replace(/\/+$/g, "");
}

export function pickAiActionModel(provider: LlmProvider, aiId: string) {
  return provider.models?.perPlayer?.[aiId] ?? (aiId === "ai-2" || aiId === "ai-4" ? provider.models?.secondary : provider.models?.default) ?? "";
}

export function pickAiActionModelByAi(provider: LlmProvider, ai: { id: string; name?: string }) {
  const refKey = (ai as { llmRef?: string }).llmRef?.trim();
  const byRef = refKey ? provider.models?.perRef?.[refKey] : undefined;
  if (byRef) return byRef;

  const nameKey = (ai.name ?? "").trim();
  const byName = nameKey ? provider.models?.perName?.[nameKey] : undefined;
  if (byName) return byName;
  return pickAiActionModel(provider, ai.id);
}

export async function postChatCompletionsWithFallback(args: {
  providers: LlmProvider[];
  model: (p: LlmProvider) => string;
  timeoutMs: (p: LlmProvider) => number;
  body: unknown;
}) {
  const errors: Array<{ providerId: string; status?: number; message: string }> = [];

  for (const p of args.providers) {
    const apiKey = (p.apiKey ?? "").trim();
    const baseUrl = (p.baseUrl ?? "").trim();
    const model = (args.model(p) ?? "").trim();
    const timeoutMs = args.timeoutMs(p);

    if (!apiKey || !baseUrl || !model) {
      errors.push({ providerId: p.id, message: "missing apiKey/baseUrl/model" });
      continue;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

    try {
      const resp = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ ...(args.body as Record<string, unknown>), model }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (resp.ok) return { providerId: p.id, resp };

      const status = resp.status;
      errors.push({ providerId: p.id, status, message: `http ${status}` });

      // Non-retryable (e.g. 400/401/403/404) should stop early.
      if (!isRetryableStatus(status)) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      errors.push({ providerId: p.id, message: msg });
      // Network/timeout is retryable → continue.
    } finally {
      clearTimeout(timer);
    }
  }

  const last = errors[errors.length - 1];
  return {
    providerId: last?.providerId ?? "unknown",
    resp: null as Response | null,
    errors,
  };
}

