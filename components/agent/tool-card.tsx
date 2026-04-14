"use client";

import type { ToolMessage } from "@/lib/agent/types";

const toolLabels: Record<string, string> = {
  web_search: "网页搜索",
  generate_image: "图片生成",
  generate_video: "视频生成",
  run_code: "代码执行",
};

const toolIcons: Record<string, string> = {
  web_search: "🔍",
  generate_image: "🖼️",
  generate_video: "🎬",
  run_code: "💻",
};

type SearchResult = { title: string; url: string; snippet?: string };
type ImageResult = { url: string; type: "image" };
type VideoResult = { url: string; type: "video" };
type CodeResult = { stdout: string; stderr: string };

function renderResult(toolName: string, result: unknown) {
  if (result === null || result === undefined) return null;

  if (toolName === "generate_image") {
    const r = result as ImageResult;
    if (r?.type === "image" && r.url) {
      return <img src={r.url} alt="generated" className="mt-2 max-w-xs rounded-lg" />;
    }
  }

  if (toolName === "generate_video") {
    const r = result as VideoResult;
    if (r?.type === "video" && r.url) {
      return (
        <video controls className="mt-2 max-w-sm rounded-lg" src={r.url}>
          Your browser does not support video.
        </video>
      );
    }
  }

  if (toolName === "web_search") {
    const results = result as SearchResult[];
    if (Array.isArray(results)) {
      return (
        <ul className="mt-2 space-y-1">
          {results.map((r, i) => (
            <li key={i} className="text-xs">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-400 hover:underline font-medium"
              >
                {r.title}
              </a>
              {r.snippet && <p className="text-gray-400 mt-0.5">{r.snippet}</p>}
            </li>
          ))}
        </ul>
      );
    }
  }

  if (toolName === "run_code") {
    const r = result as CodeResult;
    return (
      <div className="mt-2 space-y-1 font-mono text-xs">
        {r?.stdout && (
          <pre className="bg-gray-900 rounded p-2 text-green-400 whitespace-pre-wrap">
            {r.stdout}
          </pre>
        )}
        {r?.stderr && (
          <pre className="bg-gray-900 rounded p-2 text-red-400 whitespace-pre-wrap">
            {r.stderr}
          </pre>
        )}
      </div>
    );
  }

  // Fallback: JSON
  return (
    <pre className="mt-2 text-xs bg-gray-900 rounded p-2 text-gray-300 whitespace-pre-wrap overflow-auto max-h-40">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

export function ToolCard({ msg }: { msg: ToolMessage }) {
  const icon = toolIcons[msg.toolName] ?? "🔧";
  const label = toolLabels[msg.toolName] ?? msg.toolName;

  return (
    <div className="my-2 mx-4 rounded-xl border border-gray-700 bg-gray-800/60 px-4 py-3 text-sm max-w-xl">
      <div className="flex items-center gap-2 font-medium text-gray-200">
        <span>{icon}</span>
        <span>{label}</span>
        {msg.pending && (
          <span className="ml-auto text-xs text-gray-400 animate-pulse">执行中…</span>
        )}
        {!msg.pending && !msg.isError && (
          <span className="ml-auto text-xs text-green-400">✓ 完成</span>
        )}
        {!msg.pending && msg.isError && (
          <span className="ml-auto text-xs text-red-400">✗ 失败</span>
        )}
      </div>

      <div className="mt-1 text-xs text-gray-400">
        {Object.entries(msg.args)
          .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
          .join(" · ")}
      </div>

      {!msg.pending && msg.result !== undefined && renderResult(msg.toolName, msg.result)}
    </div>
  );
}
