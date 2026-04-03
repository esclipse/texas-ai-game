"use client";
/* 角色列表仅内置；勿再 import LS_ROLES_KEY（已从 characters-shared 移除） */

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Compass, Menu, MessageCircle, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { BUILTIN_ROLES, parseStoredRolesFromLocalStorage, roleCardImage, type Gender, type Role } from "@/lib/characters-shared";

const ACCENT = "#c8f542";

function fakeMetric(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = 8 + (h % 180);
  const dec = (h % 99) / 10;
  return `${n}.${dec}k`;
}

export default function CharactersExplorePage() {
  const roles = useMemo<Role[]>(() => parseStoredRolesFromLocalStorage(), []);
  const [tab, setTab] = useState<"foryou" | "all">("foryou");
  const [genderFilter, setGenderFilter] = useState<"all" | Gender>("all");

  const filtered = useMemo(() => {
    let list = roles;
    if (genderFilter !== "all") list = list.filter((r) => r.gender === genderFilter);
    if (tab === "foryou") list = [...list].sort((a, b) => (a.isBuiltIn === b.isBuiltIn ? 0 : a.isBuiltIn ? -1 : 1));
    return list;
  }, [roles, tab, genderFilter]);

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
              </div>
            );
          })}
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0b0b0c]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-end justify-around px-2 pb-2 pt-1">
          <NavIcon icon={<Compass className="h-5 w-5" />} label="探索" active />
          <NavIcon icon={<MessageCircle className="h-5 w-5" />} label="聊天" href={BUILTIN_ROLES[0] ? `/characters/${BUILTIN_ROLES[0].id}` : "/characters"} />
          <div className="relative -top-4 h-14 w-14 shrink-0" aria-hidden />
          <NavIcon icon={<span className="text-lg">🏅</span>} label="排行" />
          <NavIcon icon={<UserRound className="h-5 w-5" />} label="我的" href="/" />
        </div>
      </nav>
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
