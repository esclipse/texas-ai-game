"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type FeedbackItem = {
  id: string;
  content: string;
  createdAt: string;
};

const HERO_NAME_KEY = "ai-game:heroName";
const VISITOR_ID_KEY = "ai-game:visitorId";

async function sha256Base64Url(input: string) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return base64;
}

function stableFingerprintSeed() {
  const nav = typeof navigator !== "undefined" ? navigator : (null as unknown as Navigator | null);
  const scr = typeof window !== "undefined" ? window.screen : (null as unknown as Screen | null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  const parts = [
    `ua=${nav?.userAgent ?? ""}`,
    `lang=${nav?.language ?? ""}`,
    `platform=${(nav as unknown as { platform?: string })?.platform ?? ""}`,
    `hc=${(nav as unknown as { hardwareConcurrency?: number })?.hardwareConcurrency ?? ""}`,
    `dm=${(nav as unknown as { deviceMemory?: number })?.deviceMemory ?? ""}`,
    `tz=${tz}`,
    `so=${new Date().getTimezoneOffset()}`,
    `sw=${scr?.width ?? ""}`,
    `sh=${scr?.height ?? ""}`,
    `cd=${scr ? (scr as unknown as { colorDepth?: number })?.colorDepth ?? "" : ""}`,
    `pr=${typeof window !== "undefined" ? window.devicePixelRatio : ""}`,
  ];
  return parts.join("|");
}

export default function UserPage() {
  const [visitorId, setVisitorId] = useState("");
  const [heroName, setHeroName] = useState("");
  const [draftHeroName, setDraftHeroName] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const localName = (window.localStorage.getItem(HERO_NAME_KEY) ?? "").trim().slice(0, 12);
        setHeroName(localName);
        setDraftHeroName(localName);

        const cachedVisitorId = (window.localStorage.getItem(VISITOR_ID_KEY) ?? "").trim();
        if (cachedVisitorId) {
          setVisitorId(cachedVisitorId);
          const profileResp = await fetch(`/api/user-profile?visitorId=${encodeURIComponent(cachedVisitorId)}`);
          if (!cancelled && profileResp.ok) {
            const profile = (await profileResp.json()) as { nickname?: string };
            const remoteName = (profile.nickname ?? "").trim().slice(0, 12);
            if (remoteName) {
              setHeroName(remoteName);
              setDraftHeroName(remoteName);
              window.localStorage.setItem(HERO_NAME_KEY, remoteName);
            }
          }
          return;
        }

        const seed = stableFingerprintSeed();
        const fp = await sha256Base64Url(`v1|${seed}`);
        const resp = await fetch("/api/visitor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: fp }),
        });
        if (!resp.ok) return;

        const data = (await resp.json()) as { visitorId?: string };
        const nextVisitorId = (data.visitorId ?? "").trim();
        if (!nextVisitorId || cancelled) return;
        setVisitorId(nextVisitorId);
        window.localStorage.setItem(VISITOR_ID_KEY, nextVisitorId);

        const profileResp = await fetch(`/api/user-profile?visitorId=${encodeURIComponent(nextVisitorId)}`);
        if (!cancelled && profileResp.ok) {
          const profile = (await profileResp.json()) as { nickname?: string };
          const remoteName = (profile.nickname ?? "").trim().slice(0, 12);
          if (remoteName) {
            setHeroName(remoteName);
            setDraftHeroName(remoteName);
            window.localStorage.setItem(HERO_NAME_KEY, remoteName);
          }
        }
      } finally {
        if (!cancelled) setIsBusy(false);
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const canSaveName = useMemo(() => {
    return draftHeroName.trim().slice(0, 12) !== heroName;
  }, [draftHeroName, heroName]);

  const saveHeroName = async () => {
    if (!visitorId) {
      setSaveMessage("用户未初始化，请稍后重试");
      return;
    }
    const nextName = draftHeroName.trim().slice(0, 12);
    try {
      const resp = await fetch("/api/user-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, nickname: nextName }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) {
        setSaveMessage(data.error ?? "保存失败，请稍后重试");
        return;
      }
      if (nextName) window.localStorage.setItem(HERO_NAME_KEY, nextName);
      else window.localStorage.removeItem(HERO_NAME_KEY);
      setHeroName(nextName);
      setDraftHeroName(nextName);
      setSaveMessage(nextName ? "昵称已保存" : "已清空昵称");
    } catch {
      setSaveMessage("保存失败，请稍后重试");
    }
  };

  const submitFeedback = async () => {
    if (!visitorId) {
      setFeedbackMessage("用户未初始化，请稍后重试");
      return;
    }
    const content = feedbackText.trim().slice(0, 300);
    if (!content) {
      setFeedbackMessage("请输入问题内容");
      return;
    }
    try {
      const resp = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId, content }),
      });
      const data = (await resp.json()) as { error?: string; item?: FeedbackItem };
      if (!resp.ok || !data.item) {
        setFeedbackMessage(data.error ?? "记录失败，请稍后重试");
        return;
      }
      setFeedbackText("");
      setFeedbackMessage("反馈已记录");
    } catch {
      setFeedbackMessage("记录失败，请稍后重试");
    }
  };

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl bg-[#faf9f6] p-4 text-[#1A1A1A]">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold">用户页面</h1>
        <Link href="/">
          <Button variant="outline" className="border-[#e9e5dc] bg-white hover:bg-[#faf9f6]">
            返回牌桌
          </Button>
        </Link>
      </div>

      <div className="space-y-3">
        <Card className="border-[#e9e5dc] bg-white">
          <CardHeader>
            <CardTitle className="text-base">昵称设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <input
              className="h-9 w-full rounded-md border border-[#e9e5dc] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/30"
              placeholder="输入昵称（最多 12 字）"
              maxLength={12}
              value={draftHeroName}
              onChange={(e) => {
                setDraftHeroName(e.target.value);
                setSaveMessage("");
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#788d5d]">{heroName ? `当前昵称：${heroName}` : "当前未设置昵称"}</span>
              <Button type="button" size="sm" disabled={!canSaveName} onClick={saveHeroName}>
                保存昵称
              </Button>
            </div>
            {saveMessage ? <div className="text-xs text-[#d97757]">{saveMessage}</div> : null}
          </CardContent>
        </Card>

        <Card className="border-[#e9e5dc] bg-white">
          <CardHeader>
            <CardTitle className="text-base">问题反馈</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <textarea
              className="min-h-28 w-full rounded-md border border-[#e9e5dc] bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/30"
              placeholder="请输入你遇到的问题（最多 300 字）"
              maxLength={300}
              value={feedbackText}
              onChange={(e) => {
                setFeedbackText(e.target.value);
                setFeedbackMessage("");
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#788d5d]">{feedbackText.trim().length}/300</span>
              <Button type="button" size="sm" onClick={submitFeedback}>
                提交反馈
              </Button>
            </div>
            {feedbackMessage ? <div className="text-xs text-[#d97757]">{feedbackMessage}</div> : null}
          </CardContent>
        </Card>

        {isBusy ? <div className="text-sm text-[#788d5d]">初始化用户中...</div> : null}
      </div>
    </main>
  );
}

