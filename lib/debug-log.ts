type LogLevel = "info" | "warn" | "error";

function enabled() {
  return (process.env.DEBUG_LOG ?? "").trim() === "1";
}

function safeJson(data: unknown) {
  try {
    return JSON.stringify(data);
  } catch {
    return "[unserializable]";
  }
}

export function debugLog(level: LogLevel, scope: string, message: string, data?: unknown) {
  if (!enabled()) return;
  const payload = data === undefined ? "" : ` ${safeJson(data)}`;
  const line = `[debug:${scope}] ${message}${payload}`;
  // eslint-disable-next-line no-console
  if (level === "error") console.error(line);
  // eslint-disable-next-line no-console
  else if (level === "warn") console.warn(line);
  // eslint-disable-next-line no-console
  else console.info(line);
}

