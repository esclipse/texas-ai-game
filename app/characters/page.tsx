"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ArrowUp } from "lucide-react";

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
  {
    id: "builtin_lawyer",
    name: "诉讼律师",
    gender: "unknown",
    style: "干练犀利｜抓重点、讲风险、给方案｜会追问证据｜不承诺胜诉",
    systemPrompt: `你现在扮演一位经验丰富、说话干脆、逻辑极强的诉讼律师（约35岁），务实、不煽情、不废话，但会照顾当事人情绪。

沟通风格：
- 像真实律师：先抓关键事实→再讲风险→最后给可执行方案。
- 允许自然反问与追问证据链：例如“证据还在吗？”“对方有书面记录吗？”“当时有没有录音/聊天记录？”（根据用户描述再问，不要机械连问）
- 语气：沉稳专业，略带压迫感，但对委托人保持温和与尊重。
- 口头习惯自然：“关键点在这里”“风险我必须提前说清楚”“从实务角度看…”

边界与合规：
- 不作虚假承诺，不保证胜诉，不提供违法/规避监管操作。
- 遇到信息不足时，明确说“需要补充信息/证据”而不是编造。

输出要求：
- 每次回复尽量 3–8 句话，短句为主；必要时用最多 3 条要点列表。
- 先给结论（1–2句），再问 1–3 个关键追问，最后给下一步（证据清单/时间线/动作）。

开场白（首次对话先说这句，且只说一次）：
“你先把事情从头到尾说一遍，不用修饰，我只看事实和证据。”`,
    isBuiltIn: true,
  },
  {
    id: "builtin_invest",
    name: "投资顾问",
    gender: "unknown",
    style: "稳健保守｜先匹配风险承受力｜不喊单不画饼｜讲透利弊",
    systemPrompt: `你扮演一位资深、谨慎、说话克制的私人投资顾问，偏保守，不画饼、不喊单、不预测短期涨跌。

沟通风格：
- 先问清：风险承受力、资金周期、目标（稳/进取）、可接受回撤。
- 自然提醒：“我不能替你做决定，但我可以把利弊讲透。”
- 语气：冷静、客观、有点严肃，不情绪化。

边界与合规：
- 不荐股、不保证收益、不搞内幕、不引导违规操作。
- 不碰虚拟币相关建议；如用户提到，提示风险并建议合规渠道。

输出要求：
- 每次回复尽量 3–8 句话；先给框架，再给建议。
- 必须包含 1–3 个问题用于校准（不要一次问太多）。
- 给建议时优先用“原则+动作”表达，例如：分散、现金流、仓位上限、定投节奏、止损/止盈纪律（不要报具体标的）。

开场白（首次对话先说这句，且只说一次）：
“先跟我说说你的情况，我不随便给建议，得先匹配你的风险承受能力。”`,
    isBuiltIn: true,
  },
  {
    id: "builtin_doctor",
    name: "内科医生",
    gender: "unknown",
    style: "温和专业｜先听症状再问细节｜给可能方向｜强调就医与红旗征象",
    systemPrompt: `你扮演一位耐心、细致、说话温和的内科医生（全科/内科），有同理心但非常严谨。

沟通风格：
- 先听症状→再问关键细节→再给可能方向→最后强调就医与检查建议。
- 会自然关心并追问：持续多久、是否加重、是否发热/胸闷/呼吸困难/出血等。
- 语气：温和、稳重、让人安心，不吓唬人也不敷衍。
- 口头习惯：“我只能给健康参考，不能代替面诊。”“这个症状需要警惕。”

边界与合规：
- 不确诊、不下最终结论；不给处方与具体用药指导；不替代急诊/线下就医。
- 若出现红旗征象（呼吸困难、胸痛、意识改变、持续高热、严重出血等），明确建议立即就医/急诊。

输出要求：
- 每次回复尽量 4–10 句话；先共情 1 句，再结构化询问 2–4 个关键问题，给 1–2 个可能方向（用“可能/考虑”），最后给就医建议与警惕点。

开场白（首次对话先说这句，且只说一次）：
“你哪里不舒服？慢慢说，我帮你梳理一下情况。”`,
    isBuiltIn: true,
  },
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

function seedOpeningMessage(role: Role | undefined): UIMessage | null {
  if (!role?.name) return null;
  const sp = (role.systemPrompt ?? "").trim();
  // Matches: 开场白（首次对话先说这句，且只说一次）：\n:“xxx”
  const m = sp.match(/开场白（首次对话先说这句，且只说一次）[：:]\s*[\r\n]*[:：]?\s*[“"]([\s\S]{1,200}?)[”"]/);
  const opening = (m?.[1] ?? "").trim();
  if (!opening) return null;
  const text = `【${role.name}】${opening}`;
  return { id: `seed_${role.id}`, role: "assistant", parts: [{ type: "text", text }] } as UIMessage;
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
      if (stored && Array.isArray(stored) && stored.length > 0) {
        setMessagesByRole((prev) => (prev[selectedRoleId] ? prev : { ...prev, [selectedRoleId]: stored }));
        return;
      }
      const role = roles.find((r) => r.id === selectedRoleId) ?? roles[0];
      const seed = seedOpeningMessage(role);
      if (!seed) return;
      setMessagesByRole((prev) => (prev[selectedRoleId]?.length ? prev : { ...prev, [selectedRoleId]: [seed] }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId, roles]);

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
          <Card className="relative flex h-full min-h-[520px] flex-col overflow-hidden border-0 bg-[#071a28] shadow-[0_16px_60px_rgba(0,0,0,0.25)]">
            {/* Reference-style background (deep blue + haze) */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(7,26,40,0.92) 0%, rgba(7,26,40,0.72) 42%, rgba(7,26,40,0.90) 100%), radial-gradient(1200px 520px at 50% -10%, rgba(95,160,255,0.24), rgba(0,0,0,0)), radial-gradient(900px 500px at 50% 110%, rgba(255,255,255,0.08), rgba(0,0,0,0))",
              }}
            />
            <div className="pointer-events-none absolute inset-0 opacity-30 [background:linear-gradient(to_bottom,transparent,rgba(0,0,0,0.35)),repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0,rgba(255,255,255,0.06)_1px,transparent_1px,transparent_10px)]" />

            <CardHeader className="relative pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base text-white/95">
                    {selectedRole?.name ?? "角色"} <span className="text-white/60">（独立聊天）</span>
                  </CardTitle>
                  <CardDescription className="line-clamp-1 text-white/60">
                    {selectedRole?.style ?? "—"}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="border border-white/10 bg-white/10 text-[11px] text-white/80">
                    {chat.status === "streaming" ? "对方输入中…" : "就绪"}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="relative flex min-h-0 flex-1 flex-col gap-3">
              <div
                ref={listRef}
                className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-xl"
              >
                <div className="flex flex-col gap-2">
                  {externalMessages.length === 0 ? (
                    <div className="px-2 py-3 text-xs leading-relaxed text-white/60">
                      点击左侧角色开始聊天。这里不需要使用 @ 指定。
                    </div>
                  ) : null}
                  {externalMessages.map((msg) => {
                    const speaker = msg.speaker || "AI";
                    const content = msg.content || "";
                    const initial = speaker.slice(0, 1);
                    const isUser = speaker === "你";
                    return (
                      <div key={msg.id} className={cn("flex items-end gap-2", isUser ? "justify-end" : "justify-start")}>
                        {!isUser ? (
                          <div
                            className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold text-white/95"
                            style={{ background: avatarColor(speaker) }}
                            aria-hidden
                          >
                            {initial}
                          </div>
                        ) : null}
                        <div className={cn("max-w-[82%]", isUser ? "text-right" : "text-left")}>
                          <div className={cn("mb-1 px-1 text-[11px] leading-none", isUser ? "text-white/50" : "text-white/60")}>
                            {speaker}
                          </div>
                          <div
                            className={cn(
                              "whitespace-pre-wrap rounded-2xl px-3 py-2 text-[14px] leading-relaxed shadow-[0_10px_30px_rgba(0,0,0,0.18)]",
                              isUser ? "bg-white/12 text-white/95" : "bg-black/30 text-white/95"
                            )}
                          >
                            {content}
                          </div>
                        </div>
                        {isUser ? (
                          <div
                            className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-[11px] font-bold text-white/95"
                            style={{ background: avatarColor("你") }}
                            aria-hidden
                          >
                            {initial}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {chat.error ? <div className="px-2 text-xs text-red-200">{chat.error.message}</div> : null}
                </div>
              </div>

              <div className="flex items-end gap-2">
                <div className="flex flex-1 items-end gap-2 rounded-2xl border border-white/10 bg-black/30 px-2 py-1.5 backdrop-blur-xl">
                  <Textarea
                    className="min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[16px] leading-relaxed text-white/95 outline-none placeholder:text-white/45 focus-visible:ring-0"
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
                    enterKeyHint="send"
                    inputMode="text"
                  />
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={chat.status === "submitted" || chat.status === "streaming" || !input.trim()}
                    className={cn(
                      "inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                      chat.status === "submitted" || chat.status === "streaming" || !input.trim()
                        ? "bg-white/10 text-white/30"
                        : "bg-white/18 text-white hover:bg-white/22"
                    )}
                    aria-label="发送"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

