import type { Game, PlayerID } from "boardgame.io";

export type DurakRole = "paladin" | "barbarian" | "thief" | "necromancer" | "reverse";
export type Suit = "♠" | "♥" | "♦" | "♣";
export type Card = { id: string; rank: number; label: string; suit: Suit };
export type Player = {
  id: number;
  role: DurakRole;
  isBot: boolean;
  hand: Card[];
  handCount: number;
  returns: number;
  thiefUses: number;
  thiefLastRound: number;
  necromancerUses: number;
  necromancerLastRound: number;
};
export type Attack = { card: Card; defense?: Card };
export type GameLogEntry = {
  round: number;
  playerId: number;
  action: "attack" | "throw-in" | "defense" | "undo-defense" | "transfer" | "take" | "pass" | "steal" | "recover";
  cards: Card[];
  targetId?: number;
  targetCard?: Card;
};
export type DurakPhase = "attack" | "throw-in" | "defend" | "defend-ready" | "ended";
export type DurakState = {
  players: Player[];
  deck: Card[];
  deckCount: number;
  discard: Card[];
  trump: Suit;
  attacker: number;
  defender: number;
  current: number;
  table: Attack[];
  log: GameLogEntry[];
  postDefenseThrowInUsed: boolean;
  phase: DurakPhase;
  throwInDone: number[];
  maxAttackCards: number;
  round: number;
  thiefOffer: Card[];
  thiefOfferTarget: number | null;
  thiefOfferOwner: number | null;
  thiefReveal: Card[];
  loser: number | null;
};
export type DurakSetupData = {
  slots: Array<{ role: DurakRole; isBot: boolean }>;
};

const suits: Suit[] = ["♠", "♥", "♦", "♣"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const handLimit = (player: Player) =>
  player.role === "barbarian" ? 8 : 6;

function createDeck(): Card[] {
  return suits.flatMap((suit) =>
    ranks.map((label, index) => ({ id: `${suit}-${label}`, rank: index + 2, label, suit })),
  );
}

function activePlayer(players: Player[], from: number, direction = 1): number {
  for (let distance = 1; distance <= players.length; distance += 1) {
    const id = (from + direction * distance + players.length * 2) % players.length;
    if (players[id].hand.length > 0) return id;
  }
  return from;
}

function canReturn(player: Player) {
  return player.role !== "barbarian" && player.returns < 2;
}

function setCurrent(G: DurakState, events: { endTurn: (arg?: { next: PlayerID }) => void }, player: number) {
  G.current = player;
  events.endTurn({ next: String(player) });
}

function refillHands(G: DurakState, attacker: number, defender: number) {
  const drawOrder = G.players.map((_, offset) => (attacker + offset) % G.players.length);
  drawOrder.splice(drawOrder.indexOf(defender), 1);
  drawOrder.push(defender);
  for (const id of drawOrder) {
    const player = G.players[id];
    while (player.hand.length < handLimit(player) && G.deck.length > 0) {
      player.hand.push(G.deck.pop()!);
    }
    player.handCount = player.hand.length;
  }
  G.deckCount = G.deck.length;
}

function updateCounts(G: DurakState) {
  for (const player of G.players) player.handCount = player.hand.length;
  G.deckCount = G.deck.length;
}

function addLogEntry(
  G: DurakState,
  playerId: number,
  action: GameLogEntry["action"],
  cards: Card[] = [],
  targetId?: number,
  targetCard?: Card,
) {
  G.log.push({ round: G.round, playerId, action, cards, targetId, targetCard });
}

function checkGameEnd(G: DurakState): boolean {
  if (G.deck.length !== 0) return false;
  const remaining = G.players.filter((player) => player.hand.length > 0);
  if (remaining.length <= 1) {
    G.phase = "ended";
    G.loser = remaining[0]?.id ?? null;
    if (G.loser !== null) G.current = G.loser;
    return true;
  }
  return false;
}

function getEdgeThrowers(G: DurakState): number[] {
  const candidates = [
    activePlayer(G.players, G.defender, -1),
    activePlayer(G.players, G.defender, 1),
  ].filter((id, index, list) => list.indexOf(id) === index);
  const paladinNext = (G.defender + 1) % G.players.length;
  return candidates.filter((id) =>
    id !== G.defender &&
    G.players[id].hand.length > 0 &&
    !G.throwInDone.includes(id) &&
    !(G.players[G.defender].role === "paladin" && id === paladinNext),
  );
}

function moveToNextThrower(
  G: DurakState,
  events: { endTurn: (arg?: { next: PlayerID }) => void },
) {
  const next = getEdgeThrowers(G)[0];
  if (next !== undefined) {
    G.phase = "throw-in";
    setCurrent(G, events, next);
  } else {
    G.phase = G.table.every(({ defense }) => defense) ? "defend-ready" : "defend";
    setCurrent(G, events, G.defender);
  }
}

function getTransferTarget(G: DurakState, actor: number, attackCount: number) {
  for (let distance = 1; distance < G.players.length; distance += 1) {
    const targetId = (actor + distance) % G.players.length;
    const target = G.players[targetId];
    if (target.hand.length > 0 ? target.hand.length >= attackCount : canReturn(target)) {
      return targetId;
    }
  }
  return undefined;
}

export function canBeatCard(attack: Card, defense: Card, role: DurakRole, trump: Suit) {
  if (defense.suit === attack.suit) {
    return role === "reverse" ? defense.rank < attack.rank : defense.rank > attack.rank;
  }
  return defense.suit === trump && attack.suit !== trump;
}

export function canTransferCard(G: DurakState, actor: number, cardId: string) {
  if (G.phase !== "defend" || actor !== G.defender || G.table.some((attack) => attack.defense)) return false;
  const player = G.players[actor];
  const card = player?.hand.find((item) => item.id === cardId);
  if (!card || !G.table.some((attack) => attack.card.rank === card.rank)) return false;
  const newAttackCount = G.table.length + 1;
  return newAttackCount <= 6 && getTransferTarget(G, actor, newAttackCount) !== undefined;
}

function endRound(G: DurakState, wasTaken: boolean): boolean {
  if (!wasTaken) {
    G.discard.push(...G.table.flatMap(({ card, defense }) => [card, ...(defense ? [defense] : [])]));
  }
  const previousAttacker = G.attacker;
  const previousDefender = G.defender;
  G.table = [];
  G.throwInDone = [];
  G.postDefenseThrowInUsed = false;
  refillHands(G, previousAttacker, previousDefender);
  if (wasTaken) {
    G.attacker = activePlayer(G.players, previousDefender);
  } else {
    G.attacker = G.players[previousDefender].hand.length > 0
      ? previousDefender
      : activePlayer(G.players, previousDefender);
  }
  G.defender = activePlayer(G.players, G.attacker);
  G.phase = "attack";
  G.round += 1;
  G.thiefOffer = [];
  G.thiefOfferOwner = null;
  G.thiefOfferTarget = null;
  G.thiefReveal = [];
  updateCounts(G);
  return checkGameEnd(G);
}

function validateSetupData(setupData: DurakSetupData | undefined, numPlayers: number) {
  if (!setupData || !Array.isArray(setupData.slots)) return "Player roles are required.";
  if (setupData.slots.length !== numPlayers) return "The number of configured slots must match the match size.";
  if (!setupData.slots.every((slot) =>
    ["paladin", "barbarian", "thief", "necromancer", "reverse"].includes(slot.role) &&
    typeof slot.isBot === "boolean",
  )) return "A player slot has invalid configuration.";
  if (setupData.slots.filter((slot) => !slot.isBot).length === 0) return "At least one human player is required.";
  return undefined;
}

export const Durak: Game<DurakState, Record<string, unknown>, DurakSetupData> = {
  name: "durak",
  minPlayers: 2,
  maxPlayers: 6,
  validateSetupData,
  setup: ({ random }, setupData) => {
    const deck = random.Shuffle(createDeck());
    const players: Player[] = setupData!.slots.map((slot, id) => ({
      id,
      role: slot.role,
      isBot: slot.isBot,
      hand: [],
      handCount: 0,
      returns: 0,
      thiefUses: 0,
      thiefLastRound: 0,
      necromancerUses: 0,
      necromancerLastRound: 0,
    }));
    for (let pass = 0; pass < 8; pass += 1) {
      for (const player of players) {
        if (pass < handLimit(player)) player.hand.push(deck.pop()!);
      }
    }
    const trump = deck[0].suit;
    const firstTrump = players
      .flatMap((player) => player.hand.filter((card) => card.suit === trump).map((card) => ({ id: player.id, rank: card.rank })))
      .sort((left, right) => left.rank - right.rank)[0];
    const attacker = firstTrump?.id ?? 0;
    for (const player of players) player.handCount = player.hand.length;
    return {
      players,
      deck,
      deckCount: deck.length,
      discard: [],
      trump,
      attacker,
      defender: activePlayer(players, attacker),
      current: attacker,
      table: [],
      log: [],
      postDefenseThrowInUsed: false,
      phase: "attack",
      throwInDone: [],
      maxAttackCards: 0,
      round: 1,
      thiefOffer: [],
      thiefOfferTarget: null,
      thiefOfferOwner: null,
      thiefReveal: [],
      loser: null,
    };
  },
  turn: {
    order: {
      first: ({ G }) => G.current,
      next: ({ G }) => G.current,
    },
  },
  moves: {
    startAttack: ({ G, events, playerID }, cardIds: string[]) => {
      const actor = Number(playerID);
      const player = G.players[actor];
      if (G.phase !== "attack" || actor !== G.current || !player || !Array.isArray(cardIds) || cardIds.length === 0) return;
      const cards = cardIds.map((id) => player.hand.find((card) => card.id === id));
      if (cards.some((card) => !card) || new Set(cardIds).size !== cardIds.length) return;
      const selected = cards as Card[];
      if (selected.some((card) => card.rank !== selected[0].rank)) return;
      const defender = G.players[G.defender];
      const limit = Math.min(6, defender.hand.length);
      if (selected.length > limit) return;
      player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
      G.attacker = actor;
      G.table = selected.map((card) => ({ card }));
      addLogEntry(G, actor, "attack", selected);
      G.maxAttackCards = limit;
      G.throwInDone = [];
      G.thiefOffer = [];
      G.thiefOfferOwner = null;
      G.thiefOfferTarget = null;
      G.thiefReveal = [];
      updateCounts(G);
      moveToNextThrower(G, events);
    },

    throwIn: ({ G, events, playerID }, cardIds: string[]) => {
      const actor = Number(playerID);
      if (G.phase !== "throw-in" || actor !== G.current || !Array.isArray(cardIds) || cardIds.length === 0) return;
      const player = G.players[actor];
      const cards = cardIds.map((id) => player?.hand.find((card) => card.id === id));
      if (cards.some((card) => !card) || new Set(cardIds).size !== cardIds.length) return;
      const selected = cards as Card[];
      const ranksOnTable = new Set(G.table.flatMap(({ card, defense }) =>
        [card.rank, ...(defense ? [defense.rank] : [])],
      ));
      if (selected.some((card) => !ranksOnTable.has(card.rank))) return;
      if (G.table.length + selected.length > G.maxAttackCards || G.table.length + selected.length > 6) return;
      player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
      G.table.push(...selected.map((card) => ({ card })));
      G.throwInDone.push(actor);
      addLogEntry(G, actor, "throw-in", selected);
      updateCounts(G);
      moveToNextThrower(G, events);
    },

    passThrowIn: ({ G, events, playerID }) => {
      const actor = Number(playerID);
      if (G.phase !== "throw-in" || actor !== G.current) return;
      G.throwInDone.push(actor);
      addLogEntry(G, actor, "pass");
      moveToNextThrower(G, events);
    },

    defendWith: ({ G, events, playerID }, defenseId: string, attackId: string) => {
      const actor = Number(playerID);
      if (G.phase !== "defend" || actor !== G.defender || actor !== G.current) return;
      const player = G.players[actor];
      const attack = G.table.find(({ card, defense }) => card.id === attackId && !defense);
      const defense = player.hand.find((card) => card.id === defenseId);
      if (!attack || !defense || !canBeatCard(attack.card, defense, player.role, G.trump)) return;
      player.hand = player.hand.filter((card) => card.id !== defense.id);
      attack.defense = defense;
      addLogEntry(G, actor, "defense", [defense], undefined, attack.card);
      updateCounts(G);
      if (G.table.every((pair) => pair.defense)) {
        if (!G.postDefenseThrowInUsed) {
          G.postDefenseThrowInUsed = true;
          G.throwInDone = [];
          moveToNextThrower(G, events);
        } else {
          G.phase = "defend-ready";
        }
      }
    },

    undoDefense: ({ G, playerID }, attackId: string) => {
      const actor = Number(playerID);
      if (!["defend", "defend-ready"].includes(G.phase) || actor !== G.defender || actor !== G.current) return;
      const attack = G.table.find(({ card, defense }) => card.id === attackId && defense);
      if (!attack?.defense) return;
      G.players[actor].hand.push(attack.defense);
      addLogEntry(G, actor, "undo-defense", [attack.defense], undefined, attack.card);
      delete attack.defense;
      G.phase = "defend";
      updateCounts(G);
    },

    finishDefense: ({ G, events, playerID }) => {
      const actor = Number(playerID);
      if (G.phase !== "defend-ready" || actor !== G.defender || actor !== G.current) return;
      const ended = endRound(G, false);
      if (!ended) setCurrent(G, events, G.attacker);
    },

    takeCards: ({ G, events, playerID }) => {
      const actor = Number(playerID);
      if (!["defend", "defend-ready"].includes(G.phase) || actor !== G.defender || actor !== G.current) return;
      const player = G.players[actor];
      const wasOut = player.hand.length === 0;
      addLogEntry(G, actor, "take", G.table.flatMap(({ card, defense }) => [card, ...(defense ? [defense] : [])]));
      player.hand.push(...G.table.flatMap(({ card, defense }) => [card, ...(defense ? [defense] : [])]));
      if (wasOut && canReturn(player)) player.returns += 1;
      const ended = endRound(G, true);
      if (!ended) setCurrent(G, events, G.attacker);
    },

    transfer: ({ G, events, playerID }, cardId: string) => {
      const actor = Number(playerID);
      if (G.phase !== "defend" || actor !== G.defender || actor !== G.current || !canTransferCard(G, actor, cardId)) return;
      const player = G.players[actor];
      const card = player.hand.find((item) => item.id === cardId);
      const targetId = getTransferTarget(G, actor, G.table.length + 1);
      if (targetId === undefined) return;
      const target = G.players[targetId];
      const newAttackCount = G.table.length + 1;
      if (!card) return;
      player.hand = player.hand.filter((item) => item.id !== card.id);
      G.table.push({ card });
      addLogEntry(G, actor, "transfer", [card], targetId);
      G.defender = targetId;
      G.maxAttackCards = Math.min(6, Math.max(target.hand.length, newAttackCount));
      G.throwInDone = [actor];
      updateCounts(G);
      moveToNextThrower(G, events);
    },

    useThief: ({ G, playerID, random }, targetId: number) => {
      const actor = Number(playerID);
      const thief = G.players[actor];
      const target = G.players[targetId];
      if (G.phase !== "attack" || G.current !== actor || thief?.role !== "thief" || thief.thiefUses >= 3 || thief.thiefLastRound === G.round) return;
      if (!target || target.id === actor || target.hand.length <= 1) return;
      G.thiefOfferOwner = actor;
      G.thiefOfferTarget = targetId;
      G.thiefOffer = random.Shuffle(target.hand).slice(0, 3);
      G.thiefReveal = G.thiefOffer;
    },

    stealCard: ({ G, playerID }, cardId: string) => {
      const actor = Number(playerID);
      const thief = G.players[actor];
      if (G.phase !== "attack" || G.current !== actor || thief?.role !== "thief" || thief.thiefUses >= 3) return;
      if (G.thiefOfferOwner !== actor || G.thiefOfferTarget === null) return;
      const target = G.players[G.thiefOfferTarget];
      if (target.hand.length <= 1) return;
      const cardIndex = target.hand.findIndex((card) => card.id === cardId && G.thiefOffer.some((offered) => offered.id === cardId));
      if (cardIndex < 0) return;
      const [stolenCard] = target.hand.splice(cardIndex, 1);
      thief.hand.push(stolenCard);
      addLogEntry(G, actor, "steal", [stolenCard], target.id);
      thief.thiefUses += 1;
      thief.thiefLastRound = G.round;
      G.thiefOffer = [];
      G.thiefReveal = [];
      G.thiefOfferOwner = null;
      G.thiefOfferTarget = null;
      updateCounts(G);
      checkGameEnd(G);
    },

    declineThief: ({ G, playerID }) => {
      const actor = Number(playerID);
      if (G.phase !== "attack" || G.current !== actor || G.thiefOfferOwner !== actor) return;
      G.thiefOffer = [];
      G.thiefReveal = [];
      G.thiefOfferOwner = null;
      G.thiefOfferTarget = null;
    },

    useNecromancer: ({ G, playerID }, cardId: string) => {
      const actor = Number(playerID);
      const player = G.players[actor];
      if (G.phase !== "attack" || G.current !== actor || player?.role !== "necromancer" || player.necromancerUses >= 5 || player.necromancerLastRound === G.round) return;
      const eligible = G.discard.slice(-6);
      const cardIndex = G.discard.findIndex((card) => card.id === cardId);
      if (!eligible.some((card) => card.id === cardId) || cardIndex < 0) return;
      player.hand.push(G.discard.splice(cardIndex, 1)[0]);
      addLogEntry(G, actor, "recover", [player.hand.at(-1)!]);
      player.necromancerUses += 1;
      player.necromancerLastRound = G.round;
      updateCounts(G);
    },
  },
  endIf: ({ G }) => G.phase === "ended" ? { loser: G.loser } : undefined,
  playerView: ({ G, playerID }) => {
    const ownPlayerId = playerID === null ? -1 : Number(playerID);
    const ownerCanSeeOffer = ownPlayerId === G.thiefOfferOwner;
    return {
      ...G,
      deck: [],
      players: G.players.map((player) => ({
        ...player,
        hand: player.id === ownPlayerId ? player.hand : [],
      })),
      thiefOffer: [],
      thiefReveal: ownerCanSeeOffer ? G.thiefReveal : [],
    };
  },
};

export function chooseBotAction(G: DurakState, playerId: number): { move: string; args: unknown[] } | null {
  if (G.current !== playerId) return null;
  const player = G.players[playerId];
  if (!player) return null;
  if (G.phase === "attack") {
    if (player.role === "thief" && player.thiefUses < 3 && player.thiefLastRound !== G.round) {
      if (G.thiefOfferOwner === playerId && G.thiefReveal.length > 0) {
        return { move: "stealCard", args: [G.thiefReveal[0].id] };
      }
      if (G.thiefOfferOwner !== playerId) {
        const target = G.players.find((opponent) => opponent.id !== playerId && opponent.handCount > 1);
        if (target) return { move: "useThief", args: [target.id] };
      }
    }
    if (player.role === "necromancer" && player.necromancerUses < 5 && player.necromancerLastRound !== G.round) {
      const card = G.discard.at(-1);
      if (card) return { move: "useNecromancer", args: [card.id] };
    }
    const grouped = new Map<number, Card[]>();
    for (const card of player.hand) grouped.set(card.rank, [...(grouped.get(card.rank) ?? []), card]);
    const attacks = [...grouped.values()].sort((a, b) => a[0].rank - b[0].rank)[0];
    return attacks ? { move: "startAttack", args: [attacks.slice(0, Math.min(2, attacks.length, G.players[G.defender].handCount)).map((card) => card.id)] } : null;
  }
  if (G.phase === "throw-in") {
    const allowedRanks = new Set(G.table.flatMap(({ card, defense }) =>
      [card.rank, ...(defense ? [defense.rank] : [])],
    ));
    const card = player.hand.find((item) => allowedRanks.has(item.rank));
    return card ? { move: "throwIn", args: [[card.id]] } : { move: "passThrowIn", args: [] };
  }
  if (G.phase === "defend") {
    const attack = G.table.find((pair) => !pair.defense);
    if (!attack) return { move: "takeCards", args: [] };
    const defense = player.hand
      .filter((card) => canBeatCard(attack.card, card, player.role, G.trump))
      .sort((a, b) => a.rank - b.rank)[0];
    return defense
      ? { move: "defendWith", args: [defense.id, attack.card.id] }
      : { move: "takeCards", args: [] };
  }
  if (G.phase === "defend-ready") return { move: "finishDefense", args: [] };
  return null;
};
