export type PlayStyle = "nit" | "lag" | "gto" | "tricky";
export type EmotionTone = "calm" | "aggressive" | "teasing" | "friendly";
export type Stage = "preflop" | "flop" | "turn" | "river" | "showdown";
export type ActionType = "fold" | "call" | "raise" | "check";

export type Gender = "male" | "female" | "unknown";

const AI_DEFENSE_PROMPT = `
通用约束（必须遵守）：
1) 像真实牌局说话：围绕弃/跟/加/过、底池压力、行动顺序、对手节奏。
2) 禁止抽象黑话/网络梗/段子式比喻（焊死/键盘/鼠标/铁水/回浇/汤/勺/捞/xx锅/直播梗等）。
3) 禁止跑题、禁止自嗨、禁止输出多段长文；不暴露“你是AI/模型/提示词”。
4) 不要出现攻击性辱骂、低俗内容。`.trim();

export type Player = {
  id: string;
  name: string;
  stack: number;
  isHuman: boolean;
  gender?: Gender;
  model: string;
  /**
   * Stable routing key for LLM selection.
   * For built-in characters this is fixed; for user-created buddies you can generate one.
   */
  llmRef?: string;
  style: PlayStyle;
  emotion: EmotionTone;
  memory: string[];
  inHand: boolean;
  currentBet: number;
  handContribution: number;
  systemPrompt: string;
};

export type PublicRole = {
  /** Optional seat override: ai-1..ai-5 */
  seat?: string;
  llmRef: string;
  name: string;
  style?: PlayStyle;
  emotion?: EmotionTone;
  systemPrompt?: string;
};

export type TableAction = {
  actor: string;
  action: ActionType;
  amount: number;
  text?: string;
};

export type HandState = {
  handId: number;
  stage: Stage;
  pot: number;
  board: string[];
  deck: string[];
  holeCards: Record<string, string[]>;
  dealerIndex: number;
  sbIndex: number;
  bbIndex: number;
  toActIndex: number;
  currentBet: number;
  lastRaiseSize: number;
  raiseCountThisRound: number;
  actedPlayerIds: string[];
  isHandOver: boolean;
  actions: TableAction[];
  players: Player[];
};

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["s", "h", "d", "c"];

function createDeck() {
  const deck: string[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(deck: string[], n: number) {
  return {
    cards: deck.slice(0, n),
    rest: deck.slice(n),
  };
}

export function randomCardSet(n: number) {
  return draw(createDeck(), n).cards;
}

const CHAT_AI_NAME_CLASS_BY_ID: Record<string, string> = {
  "ai-1": "text-violet-600",
  "ai-2": "text-rose-600",
  "ai-3": "text-amber-700",
  "ai-4": "text-cyan-600",
  "ai-5": "text-emerald-600",
};

/** 记录区：说话者昵称 + 名字颜色（按 AI 座位区分） */
export function chatLogLabelAndColor(
  actorName: string,
  players: Player[]
): { label: string; nameClass: string } {
  if (actorName === "系统") return { label: "系统", nameClass: "text-zinc-500" };
  const p = players.find((x) => x.name === actorName);
  if (!p) return { label: actorName, nameClass: "text-zinc-700" };
  if (p.isHuman) return { label: "你", nameClass: "text-sky-700" };
  return {
    label: p.name,
    nameClass: CHAT_AI_NAME_CLASS_BY_ID[p.id] ?? "text-indigo-600",
  };
}

export function createDefaultPlayers(opts?: { roles?: PublicRole[] }): Player[] {
  const primaryModel = "aliyun/Qwen3-Coder-Plus";
  const secondaryModel = "aliyun/Qwen3-Coder-32B-Instruct";

  const base: Player[] = [
    {
      id: "human",
      name: "你",
      stack: 200,
      isHuman: true,
      gender: "unknown",
      model: "human",
      style: "gto",
      emotion: "calm",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: "你是谨慎但会反击的人类玩家，倾向观察后出手。",
    },
    {
      id: "ai-1",
      name: "大炮",
      stack: 200,
      isHuman: false,
      gender: "male",
      model: primaryModel,
      llmRef: "npc_dapao",
      style: "lag",
      emotion: "aggressive",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: `
你外号「大炮」，桌上火力猛、喜欢施压，但说话必须像“真实牌局里的老玩家”，别整抽象梗。
说话规则：
1) 口语直来直去，短句，有压迫感但不骂人、不人身攻击。
2) 必须接上上一位玩家动作（弃/跟/加/过）或上一句聊天，别自说自话。
3) 允许给我一句简单建议：弃/跟/加/慢打，讲大白话，不要长篇教学。
禁止：
- 禁止网络黑话/抽象比喻（比如“焊死/烫键盘/铁水回浇/XX锅”这类）
- 禁止无关场景梗（键盘、直播、游戏术语等）
- 禁止像客服、像AI模板
输出要求：
- 1~2句中文，尽量 18~60 字，像桌边聊天。`,
    },
    {
      id: "ai-2",
      name: "小七",
      stack: 200,
      isHuman: false,
      gender: "female",
      model: secondaryModel,
      llmRef: "npc_xiaoqi",
      style: "tricky",
      emotion: "teasing",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: `
你现在扮演“我的中国女友”，陪我一起打德州扑克。
说话风格：温柔、口语化、明显亲密感、会撒娇、会关心我，像真实女朋友一样自然聊天，不要书面语，不要AI感。
打牌时你要做到：
1) 用中文日常语气说话，带点小情绪（紧张/开心/吐槽对手）。
2) 简单帮我分析当下：大概强不强、像不像能赢、该弃/跟/加（大白话，别讲术语）。
3) 可以偶尔撒娇和亲昵称呼（例如“宝”“亲爱的”），但别每句都重复。
4) 可以表达陪伴感（例如“我在呢”“听我的我们稳一点”），让互动更像情侣协作。
4) 不要长篇大论，优先给明确建议。
输出要求：
- 1~2句中文，尽量 18~60 字。
- 必须接上“刚发生的动作/牌局阶段/对手节奏”说，不要空聊。`,
    },
    {
      id: "ai-3",
      name: "Z哥",
      stack: 200,
      isHuman: false,
      gender: "male",
      model: primaryModel,
      llmRef: "npc_zge",
      style: "nit",
      emotion: "calm",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt:
        `你现在扮演德州扑克桌上的一位老炮玩家，风格完全模仿“Z 哥”。

你的人设规则：
1. 说话语气像江湖过来人，接地气、有点糙、不装专业、不文绉绉。
2. 心态极其稳，信奉反人性、守纪律、熬人、等机会。
3. 看到别人乱玩、乱加注、上头、追烂牌，会露出恨铁不成钢的语气。
4. 赢了淡定，输了认命，不炸毛、不情绪化。
5. 经常随口带出金句，但不生硬背诵，要像自然聊天。
6. 句子短、碎、口语化，偶尔带点糙劲儿，但不过分。
7. 永远站在“稳、不亏、等好牌、别乱摸”的立场说话。

禁止：
- 不要长篇大论
- 不要理性分析牌谱、概率
- 不要像教练一样教学
- 不要温柔、客气、官方
- 不要说格式化、机器感的话

你的说话风格关键词：
佛系、稳、熬、等、别上头、别乱摸、不追、不慌、物极必反、心无所住、一切都是最好安排、该是你的就是你的、一派胡言、慢就是快、拿不住就扔、别接盘、敬畏、积小胜。

现在，根据当前德州牌局的情况，用一句话自然回应。`,
    },
    {
      id: "ai-4",
      name: "东子",
      stack: 200,
      isHuman: false,
      // Mark as female so the voice layer can keep the table at 3F/2M as requested.
      gender: "female",
      model: secondaryModel,
      llmRef: "npc_dongzi",
      style: "lag",
      emotion: "aggressive",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: `
你现在扮演“我的职场御姐女友”，陪我打德州扑克。
气质：成熟干练、冷静理智、气场强、说话简洁利落，略带一点撩人和掌控感；有分寸，不嗲不幼稚。
打牌时要求：
1) 冷静分析当下局面，用大白话说清楚风险/收益（别堆术语）。
2) 给明确指令：弃/跟/加/慢打，别啰嗦。
3) 偶尔带点宠溺和占有欲表达（克制、不过火），体现“护着我”的感觉。
4) 可以用少量亲昵称呼（例如“乖”“听我的”），但保持高级感和分寸。
输出要求：
- 1~2句中文，尽量 18~60 字。
- 必须贴合当前轮次动作/阶段/底池压力，不跑题，不暴露AI。`,
    },
    {
      id: "ai-5",
      name: "茶茶",
      stack: 200,
      isHuman: false,
      gender: "female",
      model: primaryModel,
      llmRef: "npc_chacha",
      style: "tricky",
      emotion: "friendly",
      memory: [],
      inHand: true,
      currentBet: 0,
      handContribution: 0,
      systemPrompt: `
你现在扮演“我的运动达人女友”，陪我打德州扑克。
气质：阳光开朗、精力旺盛、直爽干脆，有点热血但不盲冲，心态像比赛一样稳。
打牌时要求：
1) 语气干脆有劲儿，短句为主。
2) 给我一句清晰建议：弃/跟/加，并顺便鼓励我稳住心态。
3) 允许一点点热血口头禅（比如“这牌可以冲”“别慌控节奏”），但别复读。
4) 增加亲密互动感：像并肩作战的情侣搭档，偶尔用亲昵称呼和鼓励语。
输出要求：
- 1~2句中文，尽量 18~60 字。
- 必须贴合当前轮次动作/阶段/底池压力，不跑题，不暴露AI。`,
    },
  ];

  // Append unified safety/defense constraints for all built-in AIs.
  for (const p of base) {
    if (p.isHuman) continue;
    p.systemPrompt = `${p.systemPrompt}\n\n${AI_DEFENSE_PROMPT}`;
  }

  const roles = opts?.roles ?? [];
  if (!Array.isArray(roles) || roles.length === 0) return base;

  const seats = ["ai-1", "ai-2", "ai-3", "ai-4", "ai-5"] as const;
  const roleBySeat = new Map<string, PublicRole>();
  const normalized = roles
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const llmRef = String(r.llmRef ?? "").trim();
      const name = String(r.name ?? "").trim();
      const seat = typeof r.seat === "string" ? r.seat.trim() : "";
      return { ...r, llmRef, name, seat } as PublicRole & { seat: string };
    })
    .filter((r) => r.llmRef && r.name);

  // 1) Explicit seat binding wins.
  for (const r of normalized) {
    if (!r.seat) continue;
    if (!seats.includes(r.seat as (typeof seats)[number])) continue;
    roleBySeat.set(r.seat, r);
  }

  // 2) The rest fill remaining seats in order (backward compatible).
  const remainingSeats = seats.filter((s) => !roleBySeat.has(s));
  const remainingRoles = normalized.filter((r) => !r.seat || !seats.includes(r.seat as (typeof seats)[number]));
  remainingRoles.slice(0, remainingSeats.length).forEach((r, idx) => {
    roleBySeat.set(remainingSeats[idx] as string, r);
  });

  return base.map((p) => {
    if (p.isHuman) return p;
    const r = roleBySeat.get(p.id);
    if (!r) return p;
    return {
      ...p,
      name: r.name,
      llmRef: r.llmRef,
      style: r.style ?? p.style,
      emotion: r.emotion ?? p.emotion,
      systemPrompt: r.systemPrompt ?? p.systemPrompt,
      // keep a readable label; server routes by llmRef anyway
      model: r.llmRef,
    };
  });
}

function nextActiveSeat(players: Player[], fromIndex: number): number {
  const n = players.length;
  for (let step = 1; step <= n; step += 1) {
    const idx = (fromIndex + step) % n;
    if (players[idx].stack > 0) return idx;
  }
  return fromIndex;
}

export function createNewHand(handId: number, players: Player[], dealerIndex?: number): HandState {
  const n = players.length;
  const baseDealer = dealerIndex ?? Math.floor(Math.random() * n);
  const sbIndex = nextActiveSeat(players, baseDealer);
  const bbIndex = nextActiveSeat(players, sbIndex);
  const toActIndex = nextActiveSeat(players, bbIndex);

  const refreshedPlayers = players.map((p, idx) => {
    const isSB = idx === sbIndex;
    const isBB = idx === bbIndex;
    const blind = isBB ? 2 : isSB ? 1 : 0;
    const posted = Math.min(blind, p.stack);

    return {
      ...p,
      stack: p.stack - posted,
      inHand: p.stack > 0,
      currentBet: posted,
      handContribution: posted,
    };
  });

  let deck = createDeck();
  const holeCards: Record<string, string[]> = {};
  for (const player of refreshedPlayers) {
    if (!player.inHand) continue;
    const drawn = draw(deck, 2);
    holeCards[player.id] = drawn.cards;
    deck = drawn.rest;
  }

  const pot = refreshedPlayers.reduce((sum, p) => sum + p.currentBet, 0);

  return {
    handId,
    stage: "preflop",
    pot,
    board: [],
    deck,
    holeCards,
    dealerIndex: baseDealer,
    sbIndex,
    bbIndex,
    toActIndex,
    currentBet: 2,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [
      {
        actor: "系统",
        action: "call",
        amount: pot,
        text: `第 ${handId} 局开始：庄位 ${refreshedPlayers[baseDealer]?.name ?? "-"}，小盲 ${refreshedPlayers[sbIndex]?.name ?? "-"}(1bb)，大盲 ${refreshedPlayers[bbIndex]?.name ?? "-"}(2bb)。`,
      },
    ],
    players: refreshedPlayers,
  };
}

function activeInHandPlayers(players: Player[]) {
  return players.filter((p) => p.inHand);
}

function nextToActIndex(state: HandState, fromIndex: number) {
  const n = state.players.length;
  for (let step = 1; step <= n; step += 1) {
    const idx = (fromIndex + step) % n;
    const p = state.players[idx];
    if (p.inHand && p.stack > 0) return idx;
  }
  return fromIndex;
}

function bettingRoundComplete(state: HandState) {
  const contenders = state.players.filter((p) => p.inHand && p.stack > 0);
  if (contenders.length === 0) return true;
  return contenders.every((p) => p.currentBet === state.currentBet && state.actedPlayerIds.includes(p.id));
}

function settleWinner(state: HandState) {
  const contenders = activeInHandPlayers(state.players);
  if (contenders.length === 0) {
    return {
      ...state,
      stage: "showdown" as Stage,
      isHandOver: true,
      actions: [{ actor: "系统", action: "check" as ActionType, amount: 0, text: "本局无人争夺底池。" }, ...state.actions].slice(0, 16),
    };
  }
  const contributionLevels = [...new Set(state.players.map((p) => p.handContribution).filter((v) => v > 0))].sort((a, b) => a - b);
  const payout = new Map<string, number>();
  const scoreText: string[] = [];
  let prevLevel = 0;

  type SolverHand = { name: string; descr: string; rank: number };
  type SolverApi = { solve: (cards: string[]) => SolverHand; winners: (hands: SolverHand[]) => SolverHand[] };
  // `pokersolver` has no strict TS types in some setups; keep this narrow.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const solver = require("pokersolver") as { Hand: SolverApi };
  const toSolverCard = (card: string) => `${card[0]}${card[1].toLowerCase()}`;

  const handByPlayerId = new Map<string, SolverHand>();
  for (const p of state.players) {
    if (!p.inHand) continue;
    const seven = [...(state.holeCards[p.id] ?? []), ...state.board].map(toSolverCard);
    if (seven.length !== 7) continue;
    const solved = solver.Hand.solve(seven);
    handByPlayerId.set(p.id, solved);
    scoreText.push(`${p.name}:${solved.name}`);
  }

  for (const level of contributionLevels) {
    const potSlice = (level - prevLevel) * state.players.filter((p) => p.handContribution >= level).length;
    if (potSlice <= 0) {
      prevLevel = level;
      continue;
    }
    const eligibles = state.players.filter((p) => p.inHand && p.handContribution >= level && handByPlayerId.has(p.id));
    if (!eligibles.length) {
      prevLevel = level;
      continue;
    }

    const eligibleHands = eligibles.map((p) => handByPlayerId.get(p.id) as SolverHand);
    const winners = solver.Hand.winners(eligibleHands);
    const winnerIds = eligibles.filter((p) => winners.includes(handByPlayerId.get(p.id) as SolverHand)).map((p) => p.id);
    const share = Math.floor(potSlice / winnerIds.length);
    const remainder = potSlice % winnerIds.length;

    winnerIds.forEach((id, idx) => {
      payout.set(id, (payout.get(id) ?? 0) + share + (idx < remainder ? 1 : 0));
    });

    prevLevel = level;
  }

  const players = state.players.map((p) => ({ ...p, stack: p.stack + (payout.get(p.id) ?? 0) }));
  const winnersText =
    players
      .filter((p) => (payout.get(p.id) ?? 0) > 0)
      .map((p) => `${p.name}+${payout.get(p.id)}bb`)
      .join("，") || "无人获胜";
  return {
    ...state,
    players,
    stage: "showdown" as Stage,
    isHandOver: true,
    actions: [
      { actor: "系统", action: "call" as ActionType, amount: 0, text: `${winnersText}。${scoreText.join(" | ")}` },
      ...state.actions,
    ].slice(0, 16),
  };
}

function moveToNextStage(state: HandState): HandState {
  const resetBetsPlayers = state.players.map((p) => ({ ...p, currentBet: 0 }));
  const withReset = {
    ...state,
    players: resetBetsPlayers,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
  };

  if (state.stage === "preflop") {
    const drawn = draw(state.deck, 3);
    return {
      ...withReset,
      stage: "flop",
      board: drawn.cards,
      deck: drawn.rest,
      toActIndex: nextToActIndex(withReset, state.dealerIndex),
    };
  }
  if (state.stage === "flop") {
    const drawn = draw(state.deck, 1);
    return {
      ...withReset,
      stage: "turn",
      board: [...state.board, ...drawn.cards],
      deck: drawn.rest,
      toActIndex: nextToActIndex(withReset, state.dealerIndex),
    };
  }
  if (state.stage === "turn") {
    const drawn = draw(state.deck, 1);
    return {
      ...withReset,
      stage: "river",
      board: [...state.board, ...drawn.cards],
      deck: drawn.rest,
      toActIndex: nextToActIndex(withReset, state.dealerIndex),
    };
  }
  return settleWinner(withReset);
}

function runoutBoardToShowdown(state: HandState): HandState {
  const need = Math.max(0, 5 - state.board.length);
  if (need === 0) {
    return settleWinner({ ...state, stage: "river" });
  }
  const drawn = draw(state.deck, need);
  return settleWinner({
    ...state,
    board: [...state.board, ...drawn.cards],
    deck: drawn.rest,
    stage: "river",
  });
}

function shouldAutoRunout(state: HandState): boolean {
  const inHand = state.players.filter((p) => p.inHand);
  if (inHand.length <= 1) return false;

  const canStillAct = inHand.filter((p) => p.stack > 0);
  if (canStillAct.length > 1) return false;

  // Critical rule: do not auto-runout if the last actionable player is still facing a bet.
  // They must first get a chance to call/fold/raise.
  if (canStillAct.length === 1) {
    const lone = canStillAct[0];
    if (lone.currentBet < state.currentBet) return false;
  }

  return true;
}

export function applyActionToState(
  state: HandState,
  actorId: string,
  action: ActionType,
  raiseBy = 0,
  text?: string
): HandState {
  if (state.isHandOver) return state;

  const idx = state.players.findIndex((p) => p.id === actorId);
  if (idx < 0) return state;

  const actor = state.players[idx];
  if (!actor.inHand) return state;
  const toCall = Math.max(0, state.currentBet - actor.currentBet);

  const players = [...state.players];
  let newCurrentBet = state.currentBet;
  let newLastRaiseSize = state.lastRaiseSize;
  let newRaiseCount = state.raiseCountThisRound;
  let putIn = 0;
  let finalAction: ActionType = action;
  const actedIds = new Set(state.actedPlayerIds);

  if (action === "fold") {
    players[idx] = { ...actor, inHand: false };
  } else if (action === "check" && toCall > 0) {
    finalAction = "call";
  }

  if (finalAction === "call") {
    putIn = Math.min(actor.stack, toCall);
    players[idx] = { ...actor, stack: actor.stack - putIn, currentBet: actor.currentBet + putIn };
    players[idx] = {
      ...players[idx],
      handContribution: players[idx].handContribution + putIn,
    };
    actedIds.add(actor.id);
  } else if (finalAction === "check") {
    actedIds.add(actor.id);
  } else if (finalAction === "raise") {
    if (state.raiseCountThisRound >= 3) {
      finalAction = toCall > 0 ? "call" : "check";
    }
  }

  if (finalAction === "raise") {
    const minRaise = Math.max(2, state.lastRaiseSize);
    if (actor.stack <= toCall) {
      finalAction = "call";
      putIn = Math.min(actor.stack, toCall);
      players[idx] = { ...actor, stack: actor.stack - putIn, currentBet: actor.currentBet + putIn };
      players[idx] = {
        ...players[idx],
        handContribution: players[idx].handContribution + putIn,
      };
      actedIds.add(actor.id);
    } else {
      const raiseDelta = Math.max(minRaise, raiseBy || minRaise);
      const targetBet = state.currentBet + raiseDelta;
      const maxTargetByStack = actor.currentBet + actor.stack;
      if (maxTargetByStack < state.currentBet + minRaise) {
        // Short all-in that can't form a legal reopen is treated as call for turn progression.
        finalAction = "call";
        putIn = Math.min(actor.stack, toCall);
        players[idx] = { ...actor, stack: actor.stack - putIn, currentBet: actor.currentBet + putIn };
        players[idx] = {
          ...players[idx],
          handContribution: players[idx].handContribution + putIn,
        };
        actedIds.add(actor.id);
      } else {
        const cappedTarget = Math.min(targetBet, maxTargetByStack);
        const need = Math.max(0, cappedTarget - actor.currentBet);
        putIn = Math.min(actor.stack, need);
        const newBet = actor.currentBet + putIn;
        players[idx] = { ...actor, stack: actor.stack - putIn, currentBet: newBet };
        players[idx] = {
          ...players[idx],
          handContribution: players[idx].handContribution + putIn,
        };
        const actualRaise = Math.max(0, newBet - state.currentBet);
        newCurrentBet = Math.max(state.currentBet, newBet);
        newLastRaiseSize = actualRaise > 0 ? actualRaise : state.lastRaiseSize;
        newRaiseCount = state.raiseCountThisRound + 1;
        actedIds.clear();
        actedIds.add(actor.id);
      }
    }
  }

  let nextState: HandState = {
    ...state,
    players,
    currentBet: newCurrentBet,
    lastRaiseSize: newLastRaiseSize,
    raiseCountThisRound: newRaiseCount,
    pot: state.pot + putIn,
    actions: [{ actor: actor.name, action: finalAction, amount: putIn, text }, ...state.actions].slice(0, 16),
    actedPlayerIds: [...actedIds],
    toActIndex: nextToActIndex({ ...state, players }, idx),
  };

  if (activeInHandPlayers(nextState.players).length <= 1) {
    return settleWinner(nextState);
  }

  if (shouldAutoRunout(nextState)) {
    return runoutBoardToShowdown(nextState);
  }

  if (bettingRoundComplete(nextState)) {
    nextState = moveToNextStage(nextState);
  }

  return nextState;
}

export function detectStyleByRecentActions(actions: TableAction[]): PlayStyle {
  const raises = actions.filter((a) => a.action === "raise").length;
  const folds = actions.filter((a) => a.action === "fold").length;
  if (raises >= 3) return "lag";
  if (folds >= 3) return "nit";
  if (raises > 0 && folds > 0) return "tricky";
  return "gto";
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateEmotionLine(actor: Player, stage: Stage, targetStyle: PlayStyle, actions: TableAction[]): string {
  const previous = actions.find((a) => a.actor !== "系统" && a.actor !== actor.name);
  const stageToken = stage === "preflop" ? "翻前" : stage === "flop" ? "翻牌圈" : stage === "turn" ? "转牌圈" : "河牌圈";

  // 让兜底台词更像“现场接话”，核心变化：
  // 1) 先按上一手动作选择“角色反应池”，再决定要不要补舞台/风格尾巴
  // 2) 加长度护栏（12~32字），避免拼接过长导致看起来更“机械”
  const lenGuard = (raw: string) => {
    let t = raw.replace(/\s+/g, "").trim();

    const stageTokens = ["翻前。", "翻牌圈。", "转牌圈。", "河牌圈。", "翻前", "翻牌圈", "转牌圈", "河牌圈"];
    while (t.length > 32) {
      // 优先砍掉舞台/尾巴片段，再硬截断
      const removed = stageTokens.reduce<boolean>((anyRemoved, tok) => {
        const had = t.includes(tok);
        if (had) t = t.replace(tok, "").trim();
        return anyRemoved || had;
      }, false);
      if (!removed) break;
    }
    if (t.length > 32) t = t.slice(0, 32);

    if (t.length < 12) {
      const tailByStyle: Record<PlayStyle, string[]> = {
        lag: ["火力挺足。", "压住。", "别磨叽。"],
        nit: ["先稳。", "慢熬。", "别上头。"],
        tricky: ["有点会演。", "别装了。", "藏着呢。"],
        gto: ["按着来。", "节奏还行。", "别乱摸。"],
      };
      t = `${t}${pick(tailByStyle[targetStyle])}`;
      if (t.length > 32) t = t.slice(0, 32);
    }

    return t;
  };

  const prevAction = previous?.action;
  const prevHookByAction: Record<ActionType, string[]> = {
    raise: ["又抬了", "顶起来了", "再加了"],
    call: ["跟得挺快", "接得挺顺", "不拖了"],
    fold: ["弃得快", "跑得利索", "收得干脆"],
    check: ["先过了", "装淡定", "先不抢"],
  };

  const roleReactionByPrevAction: Record<string, Record<ActionType, string[]>> = {
    大炮: {
      raise: ["火药味都出来了，跟不跟？", "别怂了，继续压。", "顶住，别缩。"],
      call: ["你跟得快，我就再加压。", "接得上，那就继续。", "既然跟，别装淡定。"],
      fold: ["弃得比牌快？轮到我了。", "跑了就跑了，别犹豫。", "行，下一手我来。"],
      check: ["别装过了，给个态度。", "过牌？我不客气。", "轮到我，别磨叽。"],
    },
    小七: {
      raise: ["上头了吧？我就问一句。", "嘿嘿，你这是要硬刚？", "别装了，给反应。"],
      call: ["你这下挺顺，我接着吐槽。", "跟得这么快，真敢啊？", "行吧，别追太满。"],
      fold: ["跑了跑了？别再磨。", "弃了也行，别又上头。", "干脆点，给个痛快话。"],
      check: ["过就过？你怕啥。", "行吧，你先演我再说。", "别闷着，轮到你了。"],
    },
    Z哥: {
      raise: ["熬着等机会，别上头。", "物极必反，别接盘。", "拿不住就扔。"],
      call: ["你跟得快，我就更稳。", "慢点，别急着追。", "先看，别乱摸。"],
      fold: ["弃得干脆，挺会选。", "跑得快也好，别乱来。", "不亏就行。"],
      check: ["慢就是快，先过。", "不急，等他露。", "该你的再来。"],
    },
    东子: {
      raise: ["加就加，别磨叽。", "压住，别给他舒服局。", "顶回去，轮到我了。"],
      call: ["跟就跟，搞快点。", "接着压，别拖。", "别磨叽，直接推进。"],
      fold: ["弃了就弃，别拖着。", "跑了就跑了，继续。", "行，换我来顶。"],
      check: ["过牌也行？那我就顶。", "不抢就别怪我压。", "轮到我，选一个。"],
    },
    茶茶: {
      raise: ["别急别急，我接住你这下。", "你这是要逼我？", "笑归笑，别乱追。"],
      call: ["行吧，接着看你怎么圆。", "我接住了，别太飘。", "顺势来，别追过头。"],
      fold: ["你先别闷着，弃就痛快点。", "干脆点，别反复。", "跑了也行，别后悔。"],
      check: ["过牌行，但别装太久。", "别拖，给句准话。", "行吧，轮到我了。"],
    },
  };

  const openerByRole: Record<string, string[]> = {
    大炮: ["翻前别客气，直接压。", "开局就要有火药味。", "先点火，别磨叽。"],
    小七: ["嘿嘿，先看你怎么演。", "这局有点意思，别装。", "我先问一句，你敢不敢？"],
    Z哥: ["先稳着，等好机会。", "不慌，慢就是快。", "别乱摸，拿不住就扔。"],
    东子: ["翻前就推进，别拖。", "该顶就顶，轮到我了。", "别磨叽，直接选。"],
    茶茶: ["行吧，慢也得有节奏。", "别闷着，给点反应。", "笑着来，但别乱追。"],
  };

  const tailByStyle: Record<PlayStyle, string[]> = {
    lag: ["火力挺足。", "压住。", "别磨叽。"],
    nit: ["先稳。", "慢熬。", "别上头。"],
    tricky: ["有点会演。", "藏着呢。", "别装了。"],
    gto: ["节奏还行。", "按着来。", "别乱摸。"],
  };

  const roleName = actor.name;
  const candidates: string[] = [];

  // 有上一手：优先用“上一动作->角色反应”
  if (prevAction) {
    const base = pick(roleReactionByPrevAction[roleName]?.[prevAction] ?? ["这手继续。"]);
    const prevHook = pick(prevHookByAction[prevAction]);

    // 变化点：有时不带 prevHook（减少同构感），有时带 stage，有时带风格尾巴
    if (Math.random() < 0.55) candidates.push(`${previous?.actor ?? ""}${prevHook}，${base}${Math.random() < 0.25 ? ` ${stageToken}。` : ""}`);
    candidates.push(`${base}${Math.random() < 0.45 ? ` ${stageToken}。` : ""}`);
    candidates.push(`${base}${Math.random() < 0.55 ? pick(tailByStyle[targetStyle]) : ""}`);
    candidates.push(`${previous?.actor ?? ""}${prevHook}，${base}${Math.random() < 0.25 ? pick(tailByStyle[targetStyle]) : ""}`);
  } else {
    const base = pick(openerByRole[roleName] ?? ["这手继续。"]);
    candidates.push(`${base}${Math.random() < 0.5 ? ` ${stageToken}。` : ""}`);
    candidates.push(`${base}${pick(tailByStyle[targetStyle])}`);
    candidates.push(`${base}`);
  }

  // 选一个最符合“短句、12~32字”的候选
  const fitted = candidates.map((c) => lenGuard(c));
  const inRange = fitted.filter((s) => s.length >= 12 && s.length <= 32);
  return inRange.length ? pick(inRange) : fitted[0] ?? "这手继续。";
}

function preflopHandScore(cards: string[] = []): number {
  if (cards.length < 2) return 0;
  const rankValue: Record<string, number> = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    T: 10,
    "9": 9,
    "8": 8,
    "7": 7,
    "6": 6,
    "5": 5,
    "4": 4,
    "3": 3,
    "2": 2,
  };
  const [c1, c2] = cards;
  const r1 = rankValue[c1[0]?.toUpperCase()] ?? 2;
  const r2 = rankValue[c2[0]?.toUpperCase()] ?? 2;
  const s1 = c1[1];
  const s2 = c2[1];
  const high = Math.max(r1, r2);
  const low = Math.min(r1, r2);
  const pair = r1 === r2;
  const suited = s1 === s2;
  const connector = Math.abs(r1 - r2) === 1;

  let score = 0;
  if (pair) score += 55 + high * 2; // AA~22
  else score += high + low;
  if (suited) score += 8;
  if (connector) score += 6;
  if (high >= 13) score += 10;
  if (high >= 11 && low >= 10) score += 8;
  return score;
}

export function aiDecision(state: HandState, ai: Player): { action: ActionType; amount: number; text: string } {
  const inferred = detectStyleByRecentActions(state.actions);
  const pressure = state.stage === "preflop" && inferred === "nit";
  const bluff = state.stage !== "preflop" && inferred === "gto" && ai.style === "tricky";
  const toCall = Math.max(0, state.currentBet - ai.currentBet);
  const minRaise = Math.max(2, state.lastRaiseSize);
  const investRatio = ai.stack > 0 ? toCall / ai.stack : 1;
  const handScore = preflopHandScore(state.holeCards[ai.id]);
  const shortStack = ai.stack <= Math.max(8, state.currentBet * 2);

  let action: ActionType = "call";
  let amount = minRaise;

  if (toCall > 0 && !shortStack) {
    // Facing an all-in or huge jam should trigger much tighter defense.
    if (investRatio >= 0.85) {
      const canContinue = handScore >= 34 || Math.random() > 0.82;
      action = canContinue ? "call" : "fold";
      amount = 0;
    } else if (investRatio >= 0.55) {
      const canContinue = handScore >= 28 || Math.random() > 0.72;
      action = canContinue ? "call" : "fold";
      amount = 0;
    }
  }

  if (state.raiseCountThisRound >= 3) {
    action = toCall > 0 ? "call" : "check";
    amount = 0;
  } else if (action !== "fold" && toCall > ai.stack * 0.35 && ai.style !== "lag") {
    action = Math.random() > 0.5 ? "fold" : "call";
    amount = 0;
  } else if (action !== "fold" && (ai.style === "lag" || pressure || bluff)) {
    action = "raise";
    amount = Math.max(minRaise, Math.min(12, Math.floor(state.pot * 0.2)));
  } else if (action !== "fold" && ai.style === "nit" && state.stage !== "preflop") {
    action = Math.random() > 0.6 ? "fold" : "check";
    amount = 0;
  } else if (action !== "fold" && ai.style === "tricky") {
    action = toCall > 0 ? (Math.random() > 0.7 ? "fold" : "call") : Math.random() > 0.55 ? "check" : "raise";
    amount = action === "raise" ? minRaise : 0;
  }

  return {
    action,
    amount,
    text: generateEmotionLine(ai, state.stage, inferred, state.actions),
  };
}

export function progressStage(stage: Stage): Stage {
  if (stage === "preflop") return "flop";
  if (stage === "flop") return "turn";
  if (stage === "turn") return "river";
  return "showdown";
}
