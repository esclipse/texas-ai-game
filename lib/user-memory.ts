export type UserMemory = {
  preferredName?: string;
  addressingRule?: string;
  tonePreference?: string;
  adviceStyle?: string;
  taboo: string[];
  notes: string[];
  updatedAt: number;
};

const KEY = "ai-game:user-memory";
const MAX_NOTES = 4;

function safeParse(raw: string | null): UserMemory | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<UserMemory>;
    return {
      preferredName: typeof v.preferredName === "string" ? v.preferredName : undefined,
      addressingRule: typeof v.addressingRule === "string" ? v.addressingRule : undefined,
      tonePreference: typeof v.tonePreference === "string" ? v.tonePreference : undefined,
      adviceStyle: typeof v.adviceStyle === "string" ? v.adviceStyle : undefined,
      taboo: Array.isArray(v.taboo) ? v.taboo.filter((x) => typeof x === "string") : [],
      notes: Array.isArray(v.notes) ? v.notes.filter((x) => typeof x === "string").slice(0, MAX_NOTES) : [],
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function loadUserMemory(): UserMemory {
  if (typeof window === "undefined") return { taboo: [], notes: [], updatedAt: Date.now() };
  const m = safeParse(window.localStorage.getItem(KEY));
  return m ?? { taboo: [], notes: [], updatedAt: Date.now() };
}

export function saveUserMemory(next: UserMemory) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

function uniq(arr: string[]) {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

export function updateUserMemoryFromText(text: string) {
  if (typeof window === "undefined") return;
  const t = text.trim();
  if (!t) return;
  const mem = loadUserMemory();

  const callMe = t.match(/叫我([^\s，。！？!?,]{1,8})/);
  if (callMe?.[1]) {
    mem.preferredName = callMe[1];
    mem.addressingRule = `称呼我为${callMe[1]}`;
  }
  const myName = t.match(/我叫([^\s，。！？!?,]{1,8})/);
  if (myName?.[1]) mem.preferredName = myName[1];

  if (/御姐|成熟|冷静|干练/.test(t)) mem.tonePreference = "偏御姐冷静";
  if (/温柔|女友|撒娇/.test(t)) mem.tonePreference = "偏温柔女友";
  if (/运动|热血|阳光/.test(t)) mem.tonePreference = "偏运动阳光";

  if (/简短|直接|别啰嗦|一句话/.test(t)) mem.adviceStyle = "建议要短、直接、先结论";
  if (/别黑话|别玩梗|真实牌局|别抽象/.test(t)) mem.taboo = uniq([...mem.taboo, "禁止黑话与抽象梗"]);
  if (/别骂|文明一点/.test(t)) mem.taboo = uniq([...mem.taboo, "禁止攻击性表达"]);

  // Only keep high-value declarative notes.
  if (/我(喜欢|不喜欢|希望|想要)/.test(t) || /以后|下次|记住/.test(t)) {
    mem.notes = uniq([t.slice(0, 48), ...mem.notes]).slice(0, MAX_NOTES);
  }

  mem.updatedAt = Date.now();
  saveUserMemory(mem);
}

export function userMemorySummary(maxChars = 220) {
  const m = loadUserMemory();
  const parts: string[] = [];
  if (m.preferredName) parts.push(`昵称:${m.preferredName}`);
  if (m.addressingRule) parts.push(`称呼:${m.addressingRule}`);
  if (m.tonePreference) parts.push(`语气偏好:${m.tonePreference}`);
  if (m.adviceStyle) parts.push(`建议风格:${m.adviceStyle}`);
  if (m.taboo.length) parts.push(`禁忌:${m.taboo.join("、")}`);
  if (m.notes.length) parts.push(`备注:${m.notes.join(" | ")}`);
  const s = parts.join("；");
  return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
}

