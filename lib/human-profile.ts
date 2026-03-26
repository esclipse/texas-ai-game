export type HumanProfile = {
  handsSeen: number;
  // Preflop tendencies
  preflopRaises: number;
  preflopCalls: number;
  preflopFolds: number;
  stealsLatePos: number; // CO/BTN/SB opens
  allIns: number;
  // Postflop tendencies
  postflopBets: number;
  postflopCalls: number;
  // General
  lastUpdatedAt: number;
};

export function emptyHumanProfile(): HumanProfile {
  return {
    handsSeen: 0,
    preflopRaises: 0,
    preflopCalls: 0,
    preflopFolds: 0,
    stealsLatePos: 0,
    allIns: 0,
    postflopBets: 0,
    postflopCalls: 0,
    lastUpdatedAt: Date.now(),
  };
}

function keyFor(visitorId: string | null) {
  const v = (visitorId ?? "anon").trim() || "anon";
  return `ai-game:humanProfile:${v}`;
}

export function loadHumanProfile(visitorId: string | null): HumanProfile {
  if (typeof window === "undefined") return emptyHumanProfile();
  try {
    const raw = window.localStorage.getItem(keyFor(visitorId));
    if (!raw) return emptyHumanProfile();
    const obj = JSON.parse(raw) as Partial<HumanProfile>;
    return {
      ...emptyHumanProfile(),
      ...obj,
      handsSeen: Number(obj.handsSeen ?? 0) || 0,
      lastUpdatedAt: Number(obj.lastUpdatedAt ?? Date.now()) || Date.now(),
    };
  } catch {
    return emptyHumanProfile();
  }
}

export function saveHumanProfile(visitorId: string | null, p: HumanProfile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(visitorId), JSON.stringify(p));
  } catch {
    // ignore
  }
}

export function updateHumanProfile(
  visitorId: string | null,
  patch: Partial<HumanProfile>
): HumanProfile {
  const cur = loadHumanProfile(visitorId);
  const next: HumanProfile = {
    ...cur,
    ...patch,
    lastUpdatedAt: Date.now(),
  };
  saveHumanProfile(visitorId, next);
  return next;
}

export function classifyHuman(p: HumanProfile) {
  const preflopHands = Math.max(1, p.preflopRaises + p.preflopCalls + p.preflopFolds);
  const raiseRate = p.preflopRaises / preflopHands;
  const callRate = p.preflopCalls / preflopHands;
  const foldRate = p.preflopFolds / preflopHands;
  const stealRate = p.stealsLatePos / Math.max(1, p.preflopRaises);
  const allInRate = p.allIns / Math.max(1, preflopHands);

  return {
    isManiac: raiseRate > 0.42 || allInRate > 0.08,
    isCallingStation: callRate > 0.48 && foldRate < 0.32,
    isStealer: stealRate > 0.35 && raiseRate > 0.25,
  };
}

