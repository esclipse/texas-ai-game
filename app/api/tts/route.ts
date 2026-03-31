import { NextResponse } from "next/server";

import { getTtsConfig } from "@/lib/tts-config";
import { debugLog } from "@/lib/debug-log";

type Body = {
  text?: unknown;
  /**
   * Optional: override speaker id depending on your Doubao TTS setup.
   */
  speaker?: unknown;
  /**
   * Optional: used for server-side speaker mapping (speakerByName).
   */
  speakerName?: unknown;
  /**
   * Optional: audio encoding preference.
   * "mp3" is recommended for web playback; "wav" for debugging.
   */
  format?: unknown;
};

function str(v: unknown) {
  return typeof v === "string" ? v : "";
}

function pickFormat(v: unknown): "mp3" | "wav" {
  const s = str(v).toLowerCase();
  return s === "wav" ? "wav" : "mp3";
}

export async function POST(req: Request) {
  debugLog("info", "tts", "start");
  const body = (await req.json()) as Body;
  const text = str(body.text).trim();
  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });

  const cfg = getTtsConfig();
  const baseUrl = cfg.baseUrl;
  const path = cfg.path;
  const speakerName = str(body.speakerName).trim();
  const mappedSpeaker = speakerName ? (cfg.speakerByName[speakerName] ?? "") : "";
  const speaker = str(body.speaker).trim() || mappedSpeaker || cfg.speaker;
  const resourceId = (speakerName ? cfg.resourceIdByName[speakerName] : "")?.trim() || cfg.resourceId;
  const format = pickFormat(body.format || cfg.format);

  if (!cfg.apiKey) {
    debugLog("error", "tts", "missing apiKey");
    return NextResponse.json({ error: "Missing DOUBAO_TTS_API_KEY (or TTS_CONFIG_JSON.apiKey)" }, { status: 500 });
  }
  if (!resourceId) return NextResponse.json({ error: "Missing DOUBAO_TTS_RESOURCE_ID (or TTS_CONFIG_JSON.resourceId)" }, { status: 500 });
  if (!speaker) return NextResponse.json({ error: "Missing speaker (or TTS_CONFIG_JSON.speaker)" }, { status: 400 });

  // WebSocket 双向流式-V3 文档示例（HTTP unidirectional endpoint）使用 req_params。
  // We keep additions enabled for better robustness and caching.
  const payload = {
    req_params: {
      text,
      speaker,
      additions:
        "{\"disable_markdown_filter\":true,\"enable_language_detector\":true,\"enable_latex_tn\":true,\"disable_default_bit_rate\":true,\"max_length_to_filter_parenthesis\":0,\"cache_config\":{\"text_type\":1,\"use_cache\":true}}",
      audio_params: {
        format,
        sample_rate: cfg.sampleRate,
      },
    },
  };

  const url = `${baseUrl.replace(/\/+$/g, "")}${path.startsWith("/") ? "" : "/"}${path}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "X-Api-Resource-Id": resourceId,
      Connection: "keep-alive",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => "");
    debugLog("error", "tts", "upstream not ok", { status: resp.status, message: msg.slice(0, 160) });
    return NextResponse.json(
      {
        error: "TTS upstream error",
        status: resp.status,
        message: msg.slice(0, 600),
      },
      { status: 502 }
    );
  }

  // Upstream response formats can vary:
  // - binary audio (ideal)
  // - HTTP Chunked JSON stream (multiple JSON objects, each contains base64 audio segment)
  const ct = (resp.headers.get("content-type") ?? "").toLowerCase();

  const extractBase64Audio = (data: unknown) => {
    const obj = data as { data?: unknown; audio?: unknown; resp_data?: unknown; respData?: unknown };
    const nested =
      (obj.resp_data && typeof obj.resp_data === "object" ? (obj.resp_data as { audio?: unknown }).audio : undefined) ??
      (obj.respData && typeof obj.respData === "object" ? (obj.respData as { audio?: unknown }).audio : undefined);
    return str(obj.data) || str(obj.audio) || str(nested) || "";
  };

  const looksLikeStreamJson = ct.includes("json") || ct.startsWith("text/plain") || ct.startsWith("text/") || ct === "";
  if (looksLikeStreamJson && resp.body) {
    // Parse a stream of (possibly many) JSON objects and concatenate audio segments.
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let carry = "";
    const chunks: Buffer[] = [];
    let sawAnyAudio = false;
    let lastObj: unknown = null;

    const parseMany = (input: string) => {
      const out: { objs: unknown[]; rest: string } = { objs: [], rest: input };
      let i = 0;
      while (i < out.rest.length) {
        const start = out.rest.indexOf("{", i);
        if (start < 0) {
          out.rest = out.rest.slice(i);
          return out;
        }
        let depth = 0;
        let inStr = false;
        let esc = false;
        let end = -1;
        for (let j = start; j < out.rest.length; j += 1) {
          const ch = out.rest[j];
          if (inStr) {
            if (esc) esc = false;
            else if (ch === "\\") esc = true;
            else if (ch === "\"") inStr = false;
            continue;
          }
          if (ch === "\"") {
            inStr = true;
            continue;
          }
          if (ch === "{") depth += 1;
          if (ch === "}") depth -= 1;
          if (depth === 0) {
            end = j + 1;
            break;
          }
        }
        if (end < 0) {
          out.rest = out.rest.slice(start);
          return out;
        }
        const slice = out.rest.slice(start, end);
        try {
          out.objs.push(JSON.parse(slice) as unknown);
        } catch {
          // skip malformed
        }
        i = end;
      }
      out.rest = "";
      return out;
    };

    // Read until stream ends; stop early when upstream indicates finish.
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      carry += dec.decode(value, { stream: true });
      const parsed = parseMany(carry);
      carry = parsed.rest;
      for (const obj of parsed.objs) {
        lastObj = obj;
        const code = (obj as { code?: unknown }).code;
        const audioB64 = extractBase64Audio(obj);
        if (audioB64) {
          sawAnyAudio = true;
          chunks.push(Buffer.from(audioB64, "base64"));
        }
        // End code for session finish in docs: 20000000 (ok)
        if (code === 20000000) {
          try {
            await reader.cancel();
          } catch {
            // ignore
          }
          break;
        }
      }
    }

    if (sawAnyAudio) {
      const bin = Buffer.concat(chunks);
      debugLog("info", "tts", "ok", { bytes: bin.byteLength, speakerName, resourceId });
      return new Response(bin, {
        headers: {
          "Content-Type": format === "wav" ? "audio/wav" : "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    }

    const hint =
      speakerName && cfg.resourceIdByName[speakerName]
        ? ""
        : "Hint: set TTS_CONFIG_JSON.resourceIdByName[AI名] to match this speaker's resource pack (ICL voices often differ from 10029).";
    debugLog("error", "tts", "unexpected json response", { speakerName, resourceId, lastObj });
    return NextResponse.json({ error: "Unexpected TTS JSON response", hint, speakerName, speaker, resourceId, data: lastObj }, { status: 502 });
  }

  // Binary audio passthrough (or non-stream response).
  const buf = await resp.arrayBuffer();
  return new Response(buf, {
    headers: {
      "Content-Type": ct && !ct.startsWith("text/") ? ct : format === "wav" ? "audio/wav" : "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}

