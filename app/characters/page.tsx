"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Compass, Menu, MessageCircle, Plus, UserRound, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BUILTIN_ROLES,
  LS_ROLES_KEY,
  IDB_CHAT_KEY_PREFIX,
  normalizeRoleName,
  normalizeRoleStyle,
  parseStoredRolesFromLocalStorage,
  roleCardImage,
  type Gender,
  type Role,
} from "@/lib/characters-shared";
import { idbDel } from "@/lib/indexeddb";

const ACCENT = "#c8f542";

function fakeMetric(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = 8 + (h % 180);
  const dec = (h % 99) / 10;
  return `${n}.${dec}k`;
}

export default function CharactersExplorePage() {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(() => parseStoredRolesFromLocalStorage());
  const [tab, setTab] = useState<"foryou" | "all">("foryou");
  const [genderFilter, setGenderFilter] = useState<"all" | Gender>("all");
  const [showCreate, setShowCreate] = useState(false);

  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState<Gender>("unknown");
  const [newStyle, setNewStyle] = useState("");
  const [newSystemPrompt, setNewSystemPrompt] = useState("");
  const [newImageUrl, setNewImageUrl] = useState("");
  const [roleError, setRoleError] = useState("");

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(LS_ROLES_KEY, JSON.stringify(roles));
    } catch {
      // ignore
    }
  }, [roles]);

  const filtered = useMemo(() => {
    let list = roles;
    if (genderFilter !== "all") list = list.filter((r) => r.gender === genderFilter);
    if (tab === "foryou") list = [...list].sort((a, b) => (a.isBuiltIn === b.isBuiltIn ? 0 : a.isBuiltIn ? -1 : 1));
    return list;
  }, [roles, tab, genderFilter]);

  const createRole = () => {
    setRoleError("");
    const name = normalizeRoleName(newName);
    const style = normalizeRoleStyle(newStyle);
    const systemPrompt = newSystemPrompt.trim().slice(0, 2000);
    const imageUrl = newImageUrl.trim().slice(0, 500) || undefined;
    if (!name) {
      setRoleError("请输入角色名。");
      return;
    }
    if (!style) {
      setRoleError("请输入角色风格（简短描述）。");
      return;
    }
    if (roles.some((r) => r.name === name)) {
      setRoleError("角色名重复，请换一个。");
      return;
    }
    const id = `u_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const role: Role = {
      id,
      name,
      gender: newGender,
      style,
      systemPrompt: systemPrompt || undefined,
      imageUrl,
      isBuiltIn: false,
    };
    setRoles((prev) => [...prev, role]);
    setNewName("");
    setNewGender("unknown");
    setNewStyle("");
    setNewSystemPrompt("");
    setNewImageUrl("");
    setShowCreate(false);
    router.push(`/characters/${encodeURIComponent(id)}`);
  };

  const deleteRole = async (roleId: string) => {
    const r = roles.find((x) => x.id === roleId);
    if (!r || r.isBuiltIn) return;
    setRoles((prev) => prev.filter((x) => x.id !== roleId));
    await idbDel(`${IDB_CHAT_KEY_PREFIX}${roleId}`).catch(() => {});
  };

  return (
    <div className="min-h-dvh bg-[#0b0b0c] pb-24 text-white">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0b0b0c]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <Link href="/" className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/5" aria-label="菜单">
            <Menu className="h-5 w-5 text-white/80" />
          </Link>
          <span className="text-[15px] font-bold tracking-[0.2em]">鱼演</span>
          <span className="h-10 w-10" aria-hidden />
        </div>
      </header>

      <div className="mx-auto max-w-lg px-3 pt-3">
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <FilterPill label="为你推荐" active={tab === "foryou"} onClick={() => setTab("foryou")} />
          <FilterPill label="全部" active={tab === "all"} onClick={() => setTab("all")} />
        </div>
        <div className="mb-3 flex gap-2 text-[11px]">
          {(["all", "unknown", "male", "female"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenderFilter(g)}
              className={cn(
                "rounded-full px-3 py-1.5 font-medium transition",
                genderFilter === g ? "text-black" : "bg-white/5 text-white/55 hover:bg-white/10"
              )}
              style={genderFilter === g ? { backgroundColor: ACCENT } : undefined}
            >
              {g === "all" ? "全部性别" : g === "unknown" ? "未知" : g === "male" ? "男" : "女"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {filtered.map((r) => {
            const img = roleCardImage(r);
            const metric = fakeMetric(r.id);
            return (
              <div key={r.id} className="group relative">
                <Link href={`/characters/${encodeURIComponent(r.id)}`} className="block">
                  <article className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-white/10 transition active:scale-[0.98]">
                    <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-md">
                      <MessageCircle className="h-3 w-3" />
                      {metric}
                    </div>
                    <div className="absolute inset-x-0 bottom-0 p-2.5 pt-8">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-bold">{r.name}</span>
                      </div>
                      <div className="my-1.5 flex items-center gap-2">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/25" />
                        <span className="text-[8px]" style={{ color: ACCENT }}>
                          ◆
                        </span>
                        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/25" />
                      </div>
                      <p className="line-clamp-2 text-[11px] leading-snug text-white/70">{r.style}</p>
                    </div>
                  </article>
                </Link>
                {!r.isBuiltIn ? (
                  <button
                    type="button"
                    className="absolute right-1 top-10 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white/80 backdrop-blur-md hover:text-red-300"
                    aria-label="删除角色"
                    onClick={(e) => {
                      e.preventDefault();
                      void deleteRole(r.id);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0b0b0c]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-end justify-around px-2 pb-2 pt-1">
          <NavIcon icon={<Compass className="h-5 w-5" />} label="探索" active />
          <NavIcon icon={<MessageCircle className="h-5 w-5" />} label="聊天" href={BUILTIN_ROLES[0] ? `/characters/${BUILTIN_ROLES[0].id}` : "/characters"} />
          <button
            type="button"
            onClick={() => {
              setRoleError("");
              setShowCreate(true);
            }}
            className="relative -top-4 flex h-14 w-14 items-center justify-center rounded-full text-black shadow-[0_8px_24px_rgba(200,245,66,0.35)]"
            style={{ backgroundColor: ACCENT }}
            aria-label="创建角色"
          >
            <Plus className="h-7 w-7 stroke-[2.5]" />
          </button>
          <NavIcon icon={<span className="text-lg">🏅</span>} label="排行" />
          <NavIcon icon={<UserRound className="h-5 w-5" />} label="我的" href="/" />
        </div>
      </nav>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div
            className="max-h-[88dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-[#121214] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 text-sm font-semibold">创建角色</div>
            <div className="space-y-3">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="角色名"
                className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
              />
              <div className="flex gap-2">
                {(["unknown", "male", "female"] as const).map((g) => (
                  <Button
                    key={g}
                    type="button"
                    size="sm"
                    variant={newGender === g ? "default" : "secondary"}
                    className={cn(newGender === g && "border-0 text-black")}
                    style={newGender === g ? { backgroundColor: ACCENT } : undefined}
                    onClick={() => setNewGender(g)}
                  >
                    {g === "unknown" ? "未知" : g === "male" ? "男" : "女"}
                  </Button>
                ))}
              </div>
              <Textarea
                value={newStyle}
                onChange={(e) => setNewStyle(e.target.value)}
                placeholder="一句话人设（卡片简介）"
                className="min-h-[72px] border-white/15 bg-white/5 text-white placeholder:text-white/35"
              />
              <Input
                value={newImageUrl}
                onChange={(e) => setNewImageUrl(e.target.value)}
                placeholder="封面图 URL（可选）"
                className="border-white/15 bg-white/5 text-white placeholder:text-white/35"
              />
              <Textarea
                value={newSystemPrompt}
                onChange={(e) => setNewSystemPrompt(e.target.value)}
                placeholder="系统提示词（可选）"
                className="min-h-[88px] border-white/15 bg-white/5 text-white placeholder:text-white/35"
              />
              {roleError ? <div className="text-xs text-red-400">{roleError}</div> : null}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1 border-white/20 bg-transparent text-white" onClick={() => setShowCreate(false)}>
                  取消
                </Button>
                <Button type="button" className="flex-1 border-0 text-black" style={{ backgroundColor: ACCENT }} onClick={createRole}>
                  创建并开聊
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full px-3.5 py-2 text-[12px] font-medium transition",
        active ? "text-black" : "bg-white/8 text-white/75 hover:bg-white/12"
      )}
      style={active ? { backgroundColor: ACCENT } : undefined}
    >
      {label}
    </button>
  );
}

function NavIcon({
  icon,
  label,
  active,
  href,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  href?: string;
}) {
  const body = (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <span className={cn(active ? "text-white" : "text-white/45")}>{icon}</span>
      <span className={cn("text-[10px]", active ? "text-white" : "text-white/40")}>{label}</span>
      {active ? <span className="h-1 w-1 rounded-full" style={{ backgroundColor: ACCENT }} /> : <span className="h-1 w-1" />}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="min-w-[56px] text-center">
        {body}
      </Link>
    );
  }
  return <div className="min-w-[56px] text-center">{body}</div>;
}
