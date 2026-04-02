/**
 * 德州结算回归：弃牌收池、全下后对手 fold 等。
 * 运行：npx tsx scripts/run-settlement-tests.ts
 */
import assert from "node:assert";

import {
  applyActionToState,
  createDefaultPlayers,
  createNewHand,
  settleWinner,
  type HandState,
} from "../lib/game";

function huPlayers() {
  return createDefaultPlayers({ mode: "hu" });
}

function totalChips(state: HandState) {
  return state.players.reduce((sum, p) => sum + p.stack, 0) + state.pot;
}

function testSettleFoldWinWithoutShowdown() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "preflop",
    pot: 100,
    board: [],
    deck: [],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 100,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 0, inHand: true, handContribution: 100, currentBet: 100 },
      { ...ai, stack: 150, inHand: false, handContribution: 50, currentBet: 50 },
    ],
  };
  const out = settleWinner(state);
  assert.strictEqual(out.isHandOver, true);
  assert.strictEqual(out.players.find((p) => p.id === "human")?.stack, 100);
}

function testNoChangeWhenHandOver() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "showdown",
    pot: 0,
    board: [],
    deck: [],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: true,
    actions: [],
    players: [
      { ...human, stack: 100, inHand: true, handContribution: 100, currentBet: 0 },
      { ...ai, stack: 0, inHand: false, handContribution: 0, currentBet: 0 },
    ],
  };
  const out = applyActionToState(state, "human", "call");
  assert.strictEqual(out, state);
}

function testNoChangeOnInvalidActorId() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "preflop",
    pot: 3,
    board: [],
    deck: ["2d", "3d", "4d"],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 2,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 198, inHand: true, handContribution: 1, currentBet: 1 },
      { ...ai, stack: 198, inHand: true, handContribution: 2, currentBet: 2 },
    ],
  };
  const out = applyActionToState(state, "unknown", "call");
  assert.strictEqual(out, state);
}

function testFoldDoesNotEndWhenAtLeastTwoContendersRemain() {
  const all = createDefaultPlayers({ mode: "6max" });
  const human = all.find((p) => p.id === "human");
  const ai1 = all.find((p) => p.id === "ai-1");
  const ai2 = all.find((p) => p.id === "ai-2");
  if (!human || !ai1 || !ai2) throw new Error("missing players");

  const rest = all.filter((p) => ![human.id, ai1.id, ai2.id].includes(p.id));
  const players = [
    { ...human, stack: 100, inHand: true, handContribution: 10, currentBet: 10 },
    { ...ai1, stack: 100, inHand: true, handContribution: 20, currentBet: 20 },
    { ...ai2, stack: 100, inHand: true, handContribution: 30, currentBet: 30 },
    ...rest.map((p) => ({ ...p, stack: 0, inHand: false, handContribution: 0, currentBet: 0 })),
  ];

  const state: HandState = {
    handId: 1,
    stage: "preflop",
    pot: 60,
    board: [],
    deck: [],
    holeCards: {
      [human.id]: ["As", "Ah"],
      [ai1.id]: ["Kd", "Kc"],
      [ai2.id]: ["Qd", "Qc"],
    },
    dealerIndex: 0,
    sbIndex: 1,
    bbIndex: 2,
    toActIndex: 0,
    currentBet: 30,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players,
  };

  const beforeTotal = totalChips(state);
  const out = applyActionToState(state, human.id, "fold");
  assert.strictEqual(out.isHandOver, false);
  assert.strictEqual(out.pot, state.pot);
  assert.strictEqual(out.players.find((p) => p.id === human.id)?.inHand, false);
  assert.strictEqual(totalChips(out), beforeTotal);
  // fromIndex=0 => next active seat should be ai-1 at index=1
  assert.strictEqual(out.toActIndex, 1);
}

function testShowdownStillUsesSolver() {
  const [human, ai] = huPlayers();
  const board = ["2s", "3s", "4s", "5s", "6s"];
  const state: HandState = {
    handId: 1,
    stage: "river",
    pot: 200,
    board,
    deck: [],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: ["human", "ai-1"],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 0, inHand: true, handContribution: 100, currentBet: 0 },
      { ...ai, stack: 0, inHand: true, handContribution: 100, currentBet: 0 },
    ],
  };
  const out = settleWinner(state);
  assert.strictEqual(out.isHandOver, true);
  assert.strictEqual(out.pot, 0);
  const h = out.players.find((p) => p.id === "human")?.stack ?? 0;
  const a = out.players.find((p) => p.id === "ai-1")?.stack ?? 0;
  assert.strictEqual(h + a, 200);
}

function testCheckConvertsToCallWhenFacingBet() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "flop",
    pot: 10,
    board: ["2s", "3s", "4s"],
    deck: [],
    holeCards: { human: ["5d", "6d"], "ai-1": ["7d", "8d"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 10,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 100, inHand: true, handContribution: 6, currentBet: 6 },
      { ...ai, stack: 100, inHand: true, handContribution: 10, currentBet: 10 },
    ],
  };

  const out = applyActionToState(state, human.id, "check");
  assert.strictEqual(out.actions[0]?.action, "call");
  assert.strictEqual(out.players.find((p) => p.id === human.id)?.currentBet, 10);
  assert.strictEqual(out.players.find((p) => p.id === human.id)?.handContribution, 10);
  assert.strictEqual(out.pot, 14);
}

function testSettleNoContenders() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "river",
    pot: 123,
    board: [],
    deck: [],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 50, inHand: false, handContribution: 10, currentBet: 0 },
      { ...ai, stack: 70, inHand: false, handContribution: 0, currentBet: 0 },
    ],
  };
  const out = settleWinner(state);
  assert.strictEqual(out.isHandOver, true);
  assert.strictEqual(out.pot, 0);
}

function testRaiseCapFallsBackToCallOrCheck() {
  const [human, ai] = huPlayers();

  // toCall > 0 => raise => call
  const facing: HandState = {
    handId: 1,
    stage: "preflop",
    pot: 20,
    board: [],
    deck: [],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 10,
    lastRaiseSize: 2,
    raiseCountThisRound: 3,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 10, inHand: true, handContribution: 6, currentBet: 6 },
      { ...ai, stack: 100, inHand: true, handContribution: 10, currentBet: 10 },
    ],
  };
  const out1 = applyActionToState(facing, human.id, "raise", 4);
  assert.strictEqual(out1.actions[0]?.action, "call");
  assert.strictEqual(out1.raiseCountThisRound, 3);
  assert.strictEqual(out1.currentBet, 10);
  assert.strictEqual(out1.pot, 24);

  // toCall === 0 => raise => check
  const notFacing: HandState = {
    ...facing,
    pot: 20,
    actedPlayerIds: [],
    players: [
      { ...human, stack: 10, inHand: true, handContribution: 10, currentBet: 10 },
      { ...ai, stack: 100, inHand: true, handContribution: 10, currentBet: 10 },
    ],
  };
  const out2 = applyActionToState(notFacing, human.id, "raise", 4);
  assert.strictEqual(out2.actions[0]?.action, "check");
  assert.strictEqual(out2.pot, 20);
}

function testLegalRaiseResetsActedPlayersAndIncreasesBet() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "preflop",
    pot: 10,
    board: [],
    deck: [],
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 10,
    lastRaiseSize: 2,
    raiseCountThisRound: 1,
    actedPlayerIds: [ai.id],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 100, inHand: true, handContribution: 6, currentBet: 6 },
      { ...ai, stack: 100, inHand: true, handContribution: 10, currentBet: 10 },
    ],
  };

  const out = applyActionToState(state, human.id, "raise", 4);
  assert.strictEqual(out.currentBet, 14);
  assert.strictEqual(out.lastRaiseSize, 4);
  assert.strictEqual(out.raiseCountThisRound, 2);
  assert.deepStrictEqual(out.actedPlayerIds, [human.id]);
  const me = out.players.find((p) => p.id === human.id)!;
  assert.strictEqual(me.currentBet, 14);
  assert.strictEqual(me.handContribution, 14);
  assert.strictEqual(out.pot, 18);
}

function testFoldAfterAllIn() {
  const [human, ai] = huPlayers();
  const beforePot = 100;
  const state: HandState = {
    handId: 1,
    stage: "preflop",
    pot: beforePot,
    board: [],
    deck: ["2d", "3d", "4d", "5d", "6d", "7d", "8d", "9d", "Td", "Jd", "Qd", "Kd", "Ad"],
    holeCards: { human: ["As", "Ah"], "ai-1": ["2c", "3c"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 1,
    currentBet: 100,
    lastRaiseSize: 98,
    raiseCountThisRound: 1,
    actedPlayerIds: ["human"],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 0, inHand: true, handContribution: 100, currentBet: 100 },
      { ...ai, stack: 100, inHand: true, handContribution: 50, currentBet: 50 },
    ],
  };
  const out = applyActionToState(state, "ai-1", "fold");
  assert.strictEqual(out.isHandOver, true);
  assert.strictEqual(out.players.find((p) => p.id === "human")?.stack, beforePot);
}

function testPreflopToFlopWhenBettingRoundComplete() {
  const [human, ai] = huPlayers();
  const deck = ["2d", "3d", "4d", "5d", "6d"];
  // human is SB with currentBet=1; ai is BB with currentBet=2
  const state: HandState = {
    handId: 1,
    stage: "preflop",
    pot: 3,
    board: [],
    deck,
    holeCards: { human: ["As", "Ah"], "ai-1": ["Kd", "Kc"] },
    dealerIndex: 0,
    sbIndex: 1,
    bbIndex: 0,
    toActIndex: 0,
    currentBet: 2,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [ai.id],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 199, inHand: true, handContribution: 1, currentBet: 1 },
      { ...ai, stack: 198, inHand: true, handContribution: 2, currentBet: 2 },
    ],
  };

  const out = applyActionToState(state, human.id, "call");
  assert.strictEqual(out.stage, "flop");
  assert.deepStrictEqual(out.board, ["2d", "3d", "4d"]);
  assert.strictEqual(out.currentBet, 0);
  assert.deepStrictEqual(out.actedPlayerIds, []);
  assert.strictEqual(out.players.find((p) => p.id === human.id)?.currentBet, 0);
  assert.strictEqual(out.pot, 4); // pot 3 + call 1
  assert.deepStrictEqual(out.deck, ["5d", "6d"]);
}

function testFlopToTurnWhenBettingRoundComplete() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "flop",
    pot: 100,
    board: ["2s", "3s", "4s"],
    deck: ["9d", "Td"],
    holeCards: { human: ["5d", "6d"], "ai-1": ["7d", "8d"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [ai.id],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 100, inHand: true, handContribution: 50, currentBet: 0 },
      { ...ai, stack: 100, inHand: true, handContribution: 50, currentBet: 0 },
    ],
  };

  const out = applyActionToState(state, human.id, "check");
  assert.strictEqual(out.stage, "turn");
  assert.strictEqual(out.board.length, 4);
  assert.strictEqual(out.board[3], "9d");
  assert.strictEqual(out.currentBet, 0);
  assert.deepStrictEqual(out.actedPlayerIds, []);
  assert.strictEqual(out.pot, 100);
}

function testAutoRunoutToShowdownWhenOnlyOnePlayerCanStillAct() {
  const [human, ai] = huPlayers();
  const state: HandState = {
    handId: 1,
    stage: "flop",
    pot: 150,
    board: ["2s", "3s", "4s"],
    deck: ["9c", "Tc"], // runout needs 2 cards to reach 5
    holeCards: { human: ["5d", "6d"], "ai-1": ["7d", "8d"] },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      // lone actor (stack > 0)
      { ...human, stack: 50, inHand: true, handContribution: 50, currentBet: 0 },
      // all-in player (stack === 0, but still inHand === true)
      { ...ai, stack: 0, inHand: true, handContribution: 100, currentBet: 0 },
    ],
  };

  const beforeTotal = totalChips(state);
  const out = applyActionToState(state, human.id, "check");
  assert.strictEqual(out.isHandOver, true);
  assert.strictEqual(out.stage, "showdown");
  assert.strictEqual(out.pot, 0);
  assert.strictEqual(out.board.length, 5);
  assert.strictEqual(totalChips(out), beforeTotal);
}

function testSettleWinnerMultiContendersConservesPot() {
  const all = createDefaultPlayers({ mode: "6max" });
  const human = all.find((p) => p.id === "human");
  const ai1 = all.find((p) => p.id === "ai-1");
  const ai2 = all.find((p) => p.id === "ai-2");
  if (!human || !ai1 || !ai2) throw new Error("missing players");

  const rest = all.filter((p) => ![human.id, ai1.id, ai2.id].includes(p.id));
  const state: HandState = {
    handId: 1,
    stage: "showdown",
    pot: 300, // sum of handContribution below
    board: ["2s", "3s", "4s", "5s", "9h"],
    deck: [],
    holeCards: {
      [human.id]: ["As", "Ah"],
      [ai1.id]: ["Ks", "Kd"],
      [ai2.id]: ["Qs", "Qd"],
    },
    dealerIndex: 0,
    sbIndex: 0,
    bbIndex: 1,
    toActIndex: 0,
    currentBet: 0,
    lastRaiseSize: 2,
    raiseCountThisRound: 0,
    actedPlayerIds: [],
    isHandOver: false,
    actions: [],
    players: [
      { ...human, stack: 0, inHand: true, handContribution: 50, currentBet: 0 },
      { ...ai1, stack: 0, inHand: true, handContribution: 100, currentBet: 0 },
      { ...ai2, stack: 0, inHand: true, handContribution: 150, currentBet: 0 },
      ...rest.map((p) => ({ ...p, stack: 0, inHand: false, handContribution: 0, currentBet: 0 })),
    ],
  };

  const out = settleWinner(state);
  assert.strictEqual(out.isHandOver, true);
  assert.strictEqual(out.pot, 0);
  const endTotal = out.players.reduce((sum, p) => sum + p.stack, 0);
  assert.strictEqual(endTotal, 300);
}

function testCreateNewHandPostsBlindsAndDealsHoleCards() {
  const players = huPlayers().map((p) => ({ ...p, stack: 200, inHand: true }));
  const s = createNewHand(1, players, 0);
  // With 2 players and dealerIndex=0: SB posts 1bb, BB posts 2bb => pot=3bb
  assert.strictEqual(s.pot, 3);
  const totalCurrentBet = s.players.reduce((sum, p) => sum + p.currentBet, 0);
  assert.strictEqual(totalCurrentBet, 3);
  assert.strictEqual(s.stage, "preflop");
  assert.deepStrictEqual(s.board, []);
  assert.strictEqual(s.deck.length, 48); // 52 - 2 players * 2 hole cards
  for (const p of s.players) {
    assert.strictEqual(s.holeCards[p.id]?.length, 2);
  }
  assert.strictEqual(s.currentBet, 2);
  assert.strictEqual(s.lastRaiseSize, 2);
  assert.strictEqual(s.raiseCountThisRound, 0);
}

function testStageProgressionAllChecksToShowdown() {
  const players = huPlayers().map((p) => ({ ...p, stack: 200 }));
  let s: HandState = createNewHand(1, players, 0);
  const initialTotal = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;

  const maxSteps = 120;
  for (let i = 0; i < maxSteps; i += 1) {
    if (s.isHandOver) break;
    const actor = s.players[s.toActIndex];
    assert(actor && actor.inHand);
    assert(actor.stack >= 0);

    const toCall = Math.max(0, s.currentBet - actor.currentBet);
    const next = applyActionToState(s, actor.id, toCall > 0 ? "call" : "check");
    s = next;

    const total = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
    assert.strictEqual(total, initialTotal);
  }

  assert.strictEqual(s.isHandOver, true);
  assert.strictEqual(s.pot, 0);
  assert.strictEqual(s.board.length, 5);
}

function testChipConservationAfterFold() {
  const players = huPlayers().map((p) => ({ ...p, stack: 200 }));
  const hand = createNewHand(1, players);
  const totalAfterDeal = hand.players.reduce((s, p) => s + p.stack, 0) + hand.pot;
  const humanIdx = hand.players.findIndex((p) => p.id === "human");
  const aiIdx = hand.players.findIndex((p) => p.id === "ai-1");
  let s: HandState = hand;
  if (s.toActIndex === aiIdx) {
    s = applyActionToState(s, s.players[aiIdx].id, "fold");
  } else {
    s = applyActionToState(s, s.players[humanIdx].id, "fold");
  }
  if (!s.isHandOver) {
    const actor = s.players[s.toActIndex];
    s = applyActionToState(s, actor.id, "fold");
  }
  assert.strictEqual(s.isHandOver, true);
  const totalEnd = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
  assert.strictEqual(totalEnd, totalAfterDeal);
}

function testRandomPolicyTerminatesAndPreservesChips() {
  const iterations = 10;
  for (let run = 0; run < iterations; run += 1) {
    const players = huPlayers().map((p) => ({ ...p, stack: 200 }));
    let s: HandState = createNewHand(1, players);
    const initialTotal = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;

    const maxSteps = 200;
    for (let i = 0; i < maxSteps; i += 1) {
      if (s.isHandOver) break;
      const actor = s.players[s.toActIndex];
      assert(actor && actor.inHand);
      assert(actor.stack >= 0);

      const toCall = Math.max(0, s.currentBet - actor.currentBet);
      const r = Math.random();

      // Simple legal-ish policy:
      // - Facing bet: sometimes fold, otherwise call
      // - No bet: sometimes fold, otherwise check
      const action: "fold" | "call" | "check" = toCall > 0 ? (r < 0.2 ? "fold" : "call") : r < 0.08 ? "fold" : "check";

      s = applyActionToState(s, actor.id, action);
      const total = s.players.reduce((sum, p) => sum + p.stack, 0) + s.pot;
      assert.strictEqual(total, initialTotal);
    }

    assert.strictEqual(s.isHandOver, true);
    assert.strictEqual(s.pot, 0);
  }
}

const tests: [string, () => void][] = [
  ["settleWinner: 弃牌收池（无 7 张牌）", testSettleFoldWinWithoutShowdown],
  ["settleWinner: 摊牌仍分配 200bb", testShowdownStillUsesSolver],
  ["settleWinner: 无人参赛时 pot 归零", testSettleNoContenders],
  ["applyAction: 全下后对手 fold", testFoldAfterAllIn],
  ["applyAction: handOver 无副作用", testNoChangeWhenHandOver],
  ["applyAction: invalid actorId 无副作用", testNoChangeOnInvalidActorId],
  ["applyAction: fold 不提前结束", testFoldDoesNotEndWhenAtLeastTwoContendersRemain],
  ["applyAction: check -> call", testCheckConvertsToCallWhenFacingBet],
  ["applyAction: raise cap 回退 call/check", testRaiseCapFallsBackToCallOrCheck],
  ["applyAction: legal raise 重置 acted + 提高下注", testLegalRaiseResetsActedPlayersAndIncreasesBet],
  ["stage: preflop -> flop", testPreflopToFlopWhenBettingRoundComplete],
  ["stage: flop -> turn", testFlopToTurnWhenBettingRoundComplete],
  ["stage: all-in all but 1 触发 auto runout", testAutoRunoutToShowdownWhenOnlyOnePlayerCanStillAct],
  ["settleWinner: 多人摊牌筹码守恒", testSettleWinnerMultiContendersConservesPot],
  ["createNewHand: 发盲注 + 发手牌", testCreateNewHandPostsBlindsAndDealsHoleCards],
  ["状态机: 全部 check/call 走到摊牌", testStageProgressionAllChecksToShowdown],
  ["筹码守恒: HU 首人 fold", testChipConservationAfterFold],
  ["状态机: 随机策略终止且筹码守恒", testRandomPolicyTerminatesAndPreservesChips],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok — ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL — ${name}:`, e);
  }
}
if (failed > 0) {
  process.exit(1);
}
console.log(`\nall ${tests.length} settlement tests passed.`);
