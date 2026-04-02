type AppConfig = {
  llm?: {
    /**
     * Preferred provider order for different API routes.
     * If omitted, will use providers list order.
     */
    routing?: {
      chat?: string[];
      aiAction?: string[];
    };
    providers?: Array<{
      id: string;
      apiKey?: string;
      baseUrl?: string;
      models?: {
        chat?: string;
        default?: string;
        secondary?: string;
        /** per seat id, e.g. ai-1..ai-5 (advanced) */
        perPlayer?: Record<string, string>;
        /** per AI display name, e.g. "Z哥"/"大炮" (recommended) */
        perName?: Record<string, string>;
        /**
         * Stable role key (recommended for user-created characters).
         * Example: "buddy_7" / "npc_zge" / "user_1234_friend_1"
         */
        perRef?: Record<string, string>;
      };
      timeoutMs?: number;
    }>;

    // Backward compatible single-provider fields.
    apiKey?: string;
    baseUrl?: string;
    chatModel?: string;
    defaultModel?: string;
    secondaryModel?: string;
    perPlayerModel?: Record<string, string>;
    timeoutMs?: number;
  };
  qwen?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    model2?: string;
    timeoutMs?: number;
  };
  supabase?: {
    url?: string;
    serviceRoleKey?: string;
  };
  public?: {
    roles?: Array<{
      /** Optional seat override: ai-1..ai-5 */
      seat?: string;
      llmRef: string;
      name: string;
      style?: string;
      emotion?: string;
      systemPrompt?: string;
    }>;
  };
  /**
   * Optional TTS config (so one APP_CONFIG_JSON can drive both LLM + TTS).
   * If present, `TTS_CONFIG_JSON` still takes precedence.
   */
  tts?: {
    apiKey?: string;
    resourceId?: string;
    baseUrl?: string;
    path?: string;
    speaker?: string;
    speakerByName?: Record<string, string>;
    resourceIdByName?: Record<string, string>;
    format?: "mp3" | "wav";
    sampleRate?: number;
  };
  adminToken?: string;
};

let cached: AppConfig | null = null;

function parseJsonEnv(raw: string | undefined): AppConfig | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!obj || typeof obj !== "object") return null;
    return obj as AppConfig;
  } catch {
    return null;
  }
}

export function getAppConfig(): AppConfig {
  if (cached) return cached;
  cached = parseJsonEnv(process.env.APP_CONFIG_JSON) ?? {};
  return cached;
}

export function getQwenConfig() {
  const cfg = getAppConfig();
  const q = cfg.qwen ?? {};
  return {
    apiKey: q.apiKey ?? process.env.QWEN_API_KEY ?? "",
    baseUrl: q.baseUrl ?? process.env.QWEN_BASE_URL ?? "",
    model: q.model ?? process.env.QWEN_MODEL ?? "",
    model2: q.model2 ?? process.env.QWEN_MODEL_2 ?? "",
    timeoutMs: Number(q.timeoutMs ?? process.env.QWEN_TIMEOUT_MS ?? 9000),
  };
}

export function getLlmConfig() {
  const cfg = getAppConfig();
  const llm = cfg.llm ?? {};
  const q = cfg.qwen ?? {};

  const fallbackApiKey = llm.apiKey ?? q.apiKey ?? process.env.QWEN_API_KEY ?? "";
  const fallbackBaseUrl = llm.baseUrl ?? q.baseUrl ?? process.env.QWEN_BASE_URL ?? "";
  const fallbackDefaultModel = llm.defaultModel ?? q.model ?? process.env.QWEN_MODEL ?? "";
  const fallbackSecondaryModel = llm.secondaryModel ?? q.model2 ?? process.env.QWEN_MODEL_2 ?? "";
  const fallbackChatModel = llm.chatModel ?? fallbackDefaultModel;
  const fallbackTimeoutMs = Number(llm.timeoutMs ?? q.timeoutMs ?? process.env.QWEN_TIMEOUT_MS ?? 9000);
  const fallbackPerPlayerModel = llm.perPlayerModel ?? {};

  const rawProviders = Array.isArray(llm.providers) ? llm.providers : [];
  const providers =
    rawProviders.length > 0
      ? rawProviders
      : [
          {
            id: "default",
            apiKey: fallbackApiKey,
            baseUrl: fallbackBaseUrl,
            timeoutMs: fallbackTimeoutMs,
            models: {
              chat: fallbackChatModel,
              default: fallbackDefaultModel,
              secondary: fallbackSecondaryModel,
              perPlayer: fallbackPerPlayerModel,
            },
          },
        ];

  const providerById = new Map(providers.map((p) => [p.id, p] as const));
  const routing = llm.routing ?? {};

  const orderedProviders = (ids: string[] | undefined) => {
    if (Array.isArray(ids) && ids.length > 0) {
      const picked = ids.map((id) => providerById.get(id)).filter(Boolean) as NonNullable<(typeof providers)[number]>[];
      if (picked.length) return picked;
    }
    return providers;
  };

  return {
    routing,
    providers,
    providersForChat: orderedProviders(routing.chat),
    providersForAiAction: orderedProviders(routing.aiAction),
  };
}

export function getSupabaseAdminConfig() {
  const cfg = getAppConfig();
  const s = cfg.supabase ?? {};
  return {
    url: s.url ?? process.env.SUPABASE_URL ?? "",
    serviceRoleKey: s.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
}

export function getAdminToken() {
  const cfg = getAppConfig();
  return (cfg.adminToken ?? process.env.ADMIN_TOKEN ?? "").trim();
}

export type PublicRoleConfig = NonNullable<NonNullable<AppConfig["public"]>["roles"]>[number];

export function getPublicRoles(): PublicRoleConfig[] {
  const cfg = getAppConfig();
  const roles = cfg.public?.roles;
  if (!Array.isArray(roles)) return [];
  return roles
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      seat:
        typeof (r as PublicRoleConfig).seat === "string"
          ? (r as PublicRoleConfig).seat?.trim() || undefined
          : undefined,
      llmRef: String((r as PublicRoleConfig).llmRef ?? "").trim(),
      name: String((r as PublicRoleConfig).name ?? "").trim(),
      style: typeof (r as PublicRoleConfig).style === "string" ? (r as PublicRoleConfig).style : undefined,
      emotion: typeof (r as PublicRoleConfig).emotion === "string" ? (r as PublicRoleConfig).emotion : undefined,
      systemPrompt: typeof (r as PublicRoleConfig).systemPrompt === "string" ? (r as PublicRoleConfig).systemPrompt : undefined,
    }))
    .filter((r) => r.llmRef && r.name);
}

