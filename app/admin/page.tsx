"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function AdminPage() {
  const [adminToken, setAdminToken] = useState("");
  const [visitorId, setVisitorId] = useState("");
  const [delta, setDelta] = useState(200);
  const [reason, setReason] = useState("补充筹码");
  const [result, setResult] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  const canSubmit = useMemo(() => {
    if (!adminToken.trim()) return false;
    if (!visitorId.trim()) return false;
    if (!Number.isFinite(delta) || Math.floor(delta) === 0) return false;
    return true;
  }, [adminToken, visitorId, delta]);

  const submit = async () => {
    if (!canSubmit) return;
    setIsBusy(true);
    setResult("");
    try {
      const resp = await fetch("/api/admin/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminToken: adminToken.trim(),
          visitorId: visitorId.trim(),
          delta: Math.floor(delta),
          reason: reason.trim(),
        }),
      });
      const data = (await resp.json()) as { ok?: boolean; error?: string; chipBalance?: number };
      if (!resp.ok || !data.ok) {
        setResult(`失败：${data.error ?? `HTTP ${resp.status}`}`);
        return;
      }
      setResult(`成功：新余额 ${data.chipBalance}bb`);
    } catch (e) {
      setResult(`失败：${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl bg-zinc-50 p-4 text-zinc-900">
      <Card className="border-zinc-200">
        <CardHeader>
          <CardTitle className="text-base">Admin · 补充筹码</CardTitle>
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

          <div className="grid gap-1.5">
            <div className="text-xs font-medium text-zinc-700">访客 ID（visitorId）</div>
            <input
              className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              value={visitorId}
              onChange={(e) => setVisitorId(e.target.value)}
              placeholder="例如：9f2c0a...（20位）"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-zinc-700">增减筹码（delta）</div>
              <input
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                value={String(delta)}
                onChange={(e) => setDelta(Number(e.target.value))}
                inputMode="numeric"
              />
              <div className="text-[11px] text-zinc-500">正数加筹码，负数扣筹码</div>
            </div>
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-zinc-700">原因（可选）</div>
              <input
                className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="补充筹码"
              />
            </div>
          </div>

          <Button
            type="button"
            className={cn("w-full", isBusy ? "opacity-70" : "")}
            disabled={!canSubmit || isBusy}
            onClick={() => void submit()}
          >
            {isBusy ? "处理中..." : "提交"}
          </Button>

          {result ? <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm">{result}</div> : null}
        </CardContent>
      </Card>
    </main>
  );
}

