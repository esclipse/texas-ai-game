"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type FeedbackItem = {
  id: string;
  visitorId: string;
  nickname: string;
  content: string;
  createdAt: string | null;
};

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [result, setResult] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  const canSubmit = useMemo(() => {
    if (!adminToken.trim()) return false;
    return true;
  }, [adminToken]);

  const submit = async () => {
    if (!canSubmit) return;
    setIsBusy(true);
    setResult("");
    try {
      const qs = new URLSearchParams({ adminToken: adminToken.trim(), limit: "200" });
      const resp = await fetch(`/api/admin/feedback?${qs.toString()}`);
      const data = (await resp.json()) as { error?: string; items?: FeedbackItem[] };
      if (!resp.ok) {
        setResult(`失败：${data.error ?? `HTTP ${resp.status}`}`);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setResult(`已加载 ${Array.isArray(data.items) ? data.items.length : 0} 条反馈`);
    } catch (e) {
      setResult(`失败：${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl bg-zinc-50 p-4 text-zinc-900">
      <Card className="border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base">Admin · 问题反馈列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <div className="text-xs font-medium text-zinc-700">管理员口令（ADMIN_TOKEN）</div>
            <input
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="输入口令"
              type="password"
            />
          </div>

          <Button
            type="button"
            className={cn("w-full", isBusy ? "opacity-70" : "")}
            disabled={!canSubmit || isBusy}
            onClick={() => void submit()}
          >
            {isBusy ? "加载中..." : "加载反馈"}
          </Button>

          {result ? <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm">{result}</div> : null}
          <div className="rounded-md border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700">最近反馈（最新在上）</div>
            {items.length === 0 ? (
              <div className="px-3 py-6 text-sm text-zinc-500">暂无数据，输入口令后点击“加载反馈”</div>
            ) : (
              <div className="max-h-[68vh] overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} className="border-b border-zinc-100 px-3 py-2 last:border-b-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5">visitor: {item.visitorId}</span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5">昵称: {item.nickname || "未设置"}</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-zinc-900">{item.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

