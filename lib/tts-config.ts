export type TtsConfig = {
  /** Volcengine x-api-key */
  apiKey: string;
  /** Volcengine resource id header value */
  resourceId: string;
  /** Request endpoint base url */
  baseUrl: string;
  /** Request endpoint path */
  path: string;
  /** Default speaker id */
  speaker: string;
  /** Speaker id per AI name (e.g. "大炮"/"Z哥") */
  speakerByName: Record<string, string>;
  /** Optional resource id override per AI name (for ICL/cloned speakers, etc.) */
  resourceIdByName: Record<string, string>;
  format: "mp3" | "wav";
  sampleRate: number;
};

function parseJsonEnv(raw: string | undefined): Partial<TtsConfig> | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!obj || typeof obj !== "object") return null;
    return obj as Partial<TtsConfig>;
  } catch {
    return null;
  }
}

/**
 * Standalone TTS config (not mixed with APP_CONFIG_JSON).
 *
 * - Preferred: `TTS_CONFIG_JSON` (single json)
 * - Fallback: env vars `DOUBAO_TTS_*`
 */
export function getTtsConfig(): TtsConfig {
  const j = parseJsonEnv(process.env.TTS_CONFIG_JSON) ?? {};

  const rawFormat = String((j as { format?: unknown }).format ?? process.env.DOUBAO_TTS_FORMAT ?? "mp3").toLowerCase();
  const format: "mp3" | "wav" = rawFormat === "wav" ? "wav" : "mp3";
  const sampleRateRaw = Number((j as { sampleRate?: unknown }).sampleRate ?? process.env.DOUBAO_TTS_SAMPLE_RATE ?? 24000);
  const sampleRate = Number.isFinite(sampleRateRaw) && sampleRateRaw > 0 ? Math.floor(sampleRateRaw) : 24000;

  const speakerByName =
    (j as { speakerByName?: unknown }).speakerByName && typeof (j as { speakerByName?: unknown }).speakerByName === "object"
      ? ((j as { speakerByName?: Record<string, string> }).speakerByName ?? {})
      : {};

  const resourceIdByName =
    (j as { resourceIdByName?: unknown }).resourceIdByName && typeof (j as { resourceIdByName?: unknown }).resourceIdByName === "object"
      ? ((j as { resourceIdByName?: Record<string, string> }).resourceIdByName ?? {})
      : {};

  return {
    apiKey: String((j as { apiKey?: unknown }).apiKey ?? process.env.DOUBAO_TTS_API_KEY ?? "").trim(),
    resourceId: String((j as { resourceId?: unknown }).resourceId ?? process.env.DOUBAO_TTS_RESOURCE_ID ?? "volc.service_type.10029").trim(),
    baseUrl: String((j as { baseUrl?: unknown }).baseUrl ?? process.env.DOUBAO_TTS_BASE_URL ?? "https://openspeech.bytedance.com").trim(),
    path: String((j as { path?: unknown }).path ?? process.env.DOUBAO_TTS_PATH ?? "/api/v3/tts/unidirectional").trim(),
    speaker: String((j as { speaker?: unknown }).speaker ?? process.env.DOUBAO_TTS_SPEAKER ?? "").trim(),
    speakerByName,
    resourceIdByName,
    format,
    sampleRate,
  };
}

