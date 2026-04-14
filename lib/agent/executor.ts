// lib/agent/executor.ts

type ToolResult = { result: unknown; isError?: boolean };

async function webSearch(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? "");
  const apiKey = process.env.TAVILY_API_KEY ?? "";
  if (!apiKey) return { result: "TAVILY_API_KEY not configured", isError: true };

  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return { result: `Tavily error: ${resp.status}`, isError: true };
  const data = (await resp.json()) as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  const results = (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content?.slice(0, 300),
  }));
  return { result: results };
}

async function generateImage(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = String(args.prompt ?? "");
  const apiKey = process.env.IMAGE_API_KEY ?? process.env.MINIMAX_API_KEY ?? "";
  const baseUrl = process.env.IMAGE_BASE_URL ?? "https://api.minimax.io/v1";
  if (!apiKey) return { result: "IMAGE_API_KEY not configured", isError: true };

  const resp = await fetch(`${baseUrl}/image_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "image-01", prompt }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) return { result: `Image API error: ${resp.status}`, isError: true };
  const data = (await resp.json()) as { data?: { image_urls?: string[] } };
  const url = data.data?.image_urls?.[0];
  if (!url) return { result: "No image URL returned", isError: true };
  return { result: { url, type: "image" } };
}

async function generateVideo(args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = String(args.prompt ?? "");
  const apiKey = process.env.MINIMAX_API_KEY ?? "";
  const baseUrl = process.env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1";
  if (!apiKey) return { result: "MINIMAX_API_KEY not configured", isError: true };

  // Step 1: submit task
  const submitResp = await fetch(`${baseUrl}/video_generation`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "video-01", prompt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!submitResp.ok) return { result: `Video submit error: ${submitResp.status}`, isError: true };
  const submitData = (await submitResp.json()) as { task_id?: string };
  const taskId = submitData.task_id;
  if (!taskId) return { result: "No task_id returned", isError: true };

  // Step 2: poll for result (max 90s)
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollResp = await fetch(`${baseUrl}/query/video_generation?task_id=${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!pollResp.ok) continue;
    const pollData = (await pollResp.json()) as {
      status?: string;
      download_url?: string;
    };
    if (pollData.status === "Success") {
      const url = pollData.download_url;
      if (!url) return { result: "No download URL", isError: true };
      return { result: { url, type: "video" } };
    }
    if (pollData.status === "Fail") return { result: "Video generation failed", isError: true };
  }
  return { result: "Video generation timed out after 90s", isError: true };
}

async function runCode(args: Record<string, unknown>): Promise<ToolResult> {
  const code = String(args.code ?? "");
  const { execSync } = await import("child_process");
  try {
    const stdout = execSync(`python3 -c ${JSON.stringify(code)}`, {
      timeout: 10_000,
      maxBuffer: 1024 * 64,
      env: { ...process.env },
    })
      .toString()
      .trim();
    return { result: { stdout, stderr: "" } };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    return {
      result: {
        stdout: err.stdout?.toString().trim() ?? "",
        stderr: err.stderr?.toString().trim() ?? err.message ?? "execution error",
      },
      isError: true,
    };
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case "web_search":
      return webSearch(args);
    case "generate_image":
      return generateImage(args);
    case "generate_video":
      return generateVideo(args);
    case "run_code":
      return runCode(args);
    default:
      return { result: `Unknown tool: ${name}`, isError: true };
  }
}
