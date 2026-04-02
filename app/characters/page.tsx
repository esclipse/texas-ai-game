"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { idbDel, idbGet, idbSet } from "@/lib/indexeddb";

type Gender = "male" | "female" | "unknown";

type Role = {
  id: string;
  name: string;
  gender: Gender;
  style: string;
  /** Optional prompt/persona for companion AI */
  systemPrompt?: string;
  imageUrl?: string;
  isBuiltIn?: boolean;
};

const BUILTIN_ROLES: Role[] = [
 
];

const LS_ROLES_KEY = "characters.roles.v1";
const IDB_CHAT_KEY_PREFIX = "characters.chat.v1:";

function safeParseJson<T>(raw: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 70% 45%)`;
}

function textFromUiMessage(m: UIMessage): string {
  const parts = Array.isArray(m.parts) ? m.parts : [];
  let out = "";
  for (const p of parts as Array<{ type?: string; text?: string }>) {
    if (p?.type === "text" && typeof p.text === "string") out += p.text;
  }
  return out.trim();
}

function parseSpeakerLine(text: string): { speaker: string; content: string } {
  const trimmed = text.trim();
  const m = trimmed.match(/^【([^】]{1,24})】\s*([\s\S]*)$/);
  if (!m) return { speaker: "AI", content: trimmed };
  return { speaker: (m[1] ?? "").trim() || "AI", content: (m[2] ?? "").trim() };
}

function normalizeRoleName(raw: string): string {
  return raw.trim().slice(0, 12);
}

function normalizeRoleStyle(raw: string): string {
  return raw.trim().slice(0, 200);
}

function rolePayload(roles: Role[]) {
  return roles.map((r) => ({ name: r.name, gender: r.gender, style: r.style }));
}

export default function CharactersPage() {
  const [roles, setRoles] = useState<Role[]>(BUILTIN_ROLES);
  const [selectedRoleId, setSelectedRoleId] = useState<string>(BUILTIN_ROLES[0]?.id ?? "zge");
  const selectedRole = useMemo(() => roles.find((r) => r.id === selectedRoleId) ?? roles[0], [roles, selectedRoleId]);

  const [messagesByRole, setMessagesByRole] = useState<Record<string, UIMessage[]>>({});

  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState<Gender>("unknown");
  const [newStyle, setNewStyle] = useState("");
  const [newSystemPrompt, setNewSystemPrompt] = useState("");
  const [roleError, setRoleError] = useState<string>("");

  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const chatBody = useMemo(() => {
    const payload = rolePayload(roles);
    const sel = selectedRole ? { name: selectedRole.name, gender: selectedRole.gender, style: selectedRole.style } : undefined;
    return { gameContext: "", roles: payload, selectedRole: sel };
  }, [roles, selectedRole]);

  const transport = useMemo(() => {
    return new DefaultChatTransport<UIMessage>({
      api: "/api/chat",
      body: chatBody,
    });
  }, [chatBody]);

  const chat = useChat({
    id: selectedRoleId,
    transport,
    messages: messagesByRole[selectedRoleId] ?? [],
  });

  // Load roles from localStorage.
  useEffect(() => {
    const stored = safeParseJson<Role[]>(globalThis.localStorage?.getItem(LS_ROLES_KEY) ?? null);
    if (!stored || !Array.isArray(stored)) return;

    const cleaned: Role[] = [];
    for (const r of stored) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const name = typeof rr.name === "string" ? normalizeRoleName(rr.name) : "";
      const gender = rr.gender === "male" || rr.gender === "female" || rr.gender === "unknown" ? (rr.gender as Gender) : "unknown";
      const style = typeof rr.style === "string" ? normalizeRoleStyle(rr.style) : "";
      const systemPrompt = typeof rr.systemPrompt === "string" ? rr.systemPrompt.trim().slice(0, 2000) : "";
      const id = typeof rr.id === "string" ? rr.id : "";
      if (!id || !name) continue;
      cleaned.push({
        id,
        name,
        gender,
        style,
        systemPrompt: systemPrompt || undefined,
        imageUrl: typeof rr.imageUrl === "string" ? rr.imageUrl : undefined,
        isBuiltIn: Boolean(rr.isBuiltIn),
      });
    }
    // Ensure built-ins always exist (and stay first).
    const byId = new Map<string, Role>();
    for (const r of [...BUILTIN_ROLES, ...cleaned]) byId.set(r.id, r);
    setRoles(Array.from(byId.values()));
  }, []);

  // Persist roles to localStorage (including built-ins for simplicity).
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(LS_ROLES_KEY, JSON.stringify(roles));
    } catch {
      // ignore
    }
  }, [roles]);

  // Load chat history for selected role from IndexedDB (lazy).
  useEffect(() => {
    let cancelled = false;
    const key = `${IDB_CHAT_KEY_PREFIX}${selectedRoleId}`;
    void (async () => {
      if (messagesByRole[selectedRoleId]?.length) return;
      const stored = await idbGet<UIMessage[]>(key).catch(() => undefined);
      if (cancelled) return;
      if (stored && Array.isArray(stored)) {
        setMessagesByRole((prev) => (prev[selectedRoleId] ? prev : { ...prev, [selectedRoleId]: stored }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

  // Persist chat messages (per role) to IndexedDB.
  useEffect(() => {
    const key = `${IDB_CHAT_KEY_PREFIX}${selectedRoleId}`;
    const msgs = chat.messages;
    setMessagesByRole((prev) => ({ ...prev, [selectedRoleId]: msgs }));
    void idbSet(key, msgs).catch(() => {});
  }, [chat.messages, selectedRoleId]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceToBottom < 120) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [chat.messages.length, chat.status]);

  const externalMessages = useMemo(() => {
    return (chat.messages ?? []).map((m) => {
      if (m.role === "user") {
        return { id: m.id, speaker: "你", content: textFromUiMessage(m) };
      }
      const raw = textFromUiMessage(m);
      const { speaker, content } = parseSpeakerLine(raw);
      return { id: m.id, speaker, content };
    });
  }, [chat.messages]);

  const createRole = () => {
    setRoleError("");
    const name = normalizeRoleName(newName);
    const style = normalizeRoleStyle(newStyle);
    const systemPrompt = newSystemPrompt.trim().slice(0, 2000);
    if (!name) {
      setRoleError("请输入角色名。");
      return;
    }
    if (!style) {
      setRoleError("请输入角色风格（简短描述）。");
      return;
    }
    const exists = roles.some((r) => r.name === name);
    if (exists) {
      setRoleError("角色名重复，请换一个。");
      return;
    }
    const id = `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const role: Role = { id, name, gender: newGender, style, systemPrompt: systemPrompt || undefined, isBuiltIn: false };
    setRoles((prev) => [...prev, role]);
    setSelectedRoleId(id);
    setNewName("");
    setNewGender("unknown");
    setNewStyle("");
    setNewSystemPrompt("");
  };

  const deleteRole = async (roleId: string) => {
    const r = roles.find((x) => x.id === roleId);
    if (!r || r.isBuiltIn) return;
    setRoles((prev) => prev.filter((x) => x.id !== roleId));
    setMessagesByRole((prev) => {
      const next = { ...prev };
      delete next[roleId];
      return next;
    });
    await idbDel(`${IDB_CHAT_KEY_PREFIX}${roleId}`).catch(() => {});
    if (selectedRoleId === roleId) {
      setSelectedRoleId(BUILTIN_ROLES[0]?.id ?? "zge");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (chat.status === "submitted" || chat.status === "streaming") return;
    setInput("");
    await chat.sendMessage({ text });
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-zinc-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 md:flex-row">
        <div className="w-full md:w-[360px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">角色</CardTitle>
              <CardDescription>点击卡片选择聊天对象</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {roles.map((r) => {
                  const selected = r.id === selectedRoleId;
                  const initial = r.name.slice(0, 1);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedRoleId(r.id)}
                      className={cn(
                        "group relative flex flex-col items-start gap-2 rounded-lg border bg-white p-3 text-left transition",
                        selected ? "border-zinc-900 shadow-sm" : "border-zinc-200 hover:border-zinc-300"
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-md text-xs font-bold text-white"
                            style={{ background: avatarColor(r.name) }}
                            aria-hidden
                          >
                            {r.imageUrl ? <span className="text-[10px]">IMG</span> : initial}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-zinc-900">{r.name}</div>
                            <div className="truncate text-[11px] text-zinc-500">{r.isBuiltIn ? "默认角色" : "自定义"}</div>
                          </div>
                        </div>
                        {!r.isBuiltIn ? (
                          <span className="opacity-0 transition group-hover:opacity-100">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-zinc-500 hover:text-red-600"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void deleteRole(r.id);
                              }}
                            >
                              删除
                            </Button>
                          </span>
                        ) : null}
                      </div>
                      <div className="line-clamp-2 text-[12px] leading-relaxed text-zinc-600">{r.style}</div>
                      <div className="flex items-center gap-2">
                        <Badge variant={selected ? "default" : "secondary"} className="text-[11px]">
                          {r.gender}
                        </Badge>
                        {selected ? <Badge variant="outline" className="text-[11px]">当前</Badge> : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-2 text-xs font-semibold text-zinc-700">创建自定义角色</div>
                <div className="space-y-2">
                  <Input value={newName} onChange={(e) => setNewName(e.currentTarget.value)} placeholder="角色名（例如：阿哲）" />
                  <div className="flex gap-2">
                    <Button type="button" variant={newGender === "male" ? "default" : "secondary"} size="sm" onClick={() => setNewGender("male")}>
                      male
                    </Button>
                    <Button type="button" variant={newGender === "female" ? "default" : "secondary"} size="sm" onClick={() => setNewGender("female")}>
                      female
                    </Button>
                    <Button type="button" variant={newGender === "unknown" ? "default" : "secondary"} size="sm" onClick={() => setNewGender("unknown")}>
                      unknown
                    </Button>
                  </div>
                  <Textarea
                    value={newStyle}
                    onChange={(e) => setNewStyle(e.currentTarget.value)}
                    placeholder="风格（例如：嘴硬、短句、带点嘲讽）"
                    className="min-h-[72px]"
                  />
                  <Textarea
                    value={newSystemPrompt}
                    onChange={(e) => setNewSystemPrompt(e.currentTarget.value)}
                    placeholder="提示词（可选，用于陪伴AI人设/口癖/边界，≤2000字）"
                    className="min-h-[92px]"
                  />
                  {roleError ? <div className="text-xs text-red-600">{roleError}</div> : null}
                  <Button type="button" className="w-full" onClick={createRole}>
                    创建角色
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="min-h-[520px] w-full flex-1">
          <Card className="flex h-full min-h-[520px] flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {selectedRole?.name ?? "角色"} <span className="text-zinc-500">（独立聊天）</span>
                  </CardTitle>
                  <CardDescription className="line-clamp-1">
                    {selectedRole?.style ?? "—"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {chat.status === "streaming" ? "对方输入中…" : "就绪"}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
              <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-3">
                <div className="flex flex-col gap-2">
                  {externalMessages.length === 0 ? (
                    <div className="px-2 py-3 text-xs leading-relaxed text-zinc-500">
                      点击左侧角色开始聊天。这里不需要使用 @ 指定。
                    </div>
                  ) : null}
                  {externalMessages.map((msg) => {
                    const speaker = msg.speaker || "AI";
                    const content = msg.content || "";
                    const initial = speaker.slice(0, 1);
                    return (
                      <div key={msg.id} className="flex items-start gap-2">
                        <div
                          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs font-bold text-white"
                          style={{ background: avatarColor(speaker) }}
                          aria-hidden
                        >
                          {initial}
                        </div>
                        <div className="max-w-[78%]">
                          <div className="mb-1 px-1 text-xs leading-none text-zinc-500">{speaker}</div>
                          <div className="relative whitespace-pre-wrap rounded-lg bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                            <span className="absolute left-[-6px] top-3 h-0 w-0 border-y-[6px] border-r-[6px] border-y-transparent border-r-white" />
                            {content}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {chat.error ? <div className="px-2 text-xs text-red-600">{chat.error.message}</div> : null}
                </div>
              </div>

              <div className="flex gap-2">
                <Textarea
                  className="flex-1 focus-visible:ring-cyan-400/30"
                  value={input}
                  onChange={(e) => setInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const ne = e.nativeEvent as Event;
                    if ("isComposing" in ne && Boolean((ne as unknown as { isComposing?: boolean }).isComposing)) return;
                    if (e.shiftKey) return;
                    e.preventDefault();
                    void send();
                  }}
                  disabled={chat.status === "submitted" || chat.status === "streaming"}
                  placeholder="回车发送；Shift+Enter 换行…"
                />
                <Button type="button" onClick={() => void send()} disabled={chat.status === "submitted" || chat.status === "streaming"}>
                  发送
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

