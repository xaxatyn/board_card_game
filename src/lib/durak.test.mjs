import assert from "node:assert/strict";
import test from "node:test";
import { Durak } from "./durak.mts";

const card = (suit, label, rank) => ({ id: `${suit}-${label}`, suit, label, rank });
const emptyPlayer = (id, role = "paladin", hand = []) => ({
  id,
  role,
  isBot: false,
  hand,
  handCount: hand.length,
  returns: 0,
  thiefUses: 0,
  thiefLastRound: 0,
  necromancerUses: 0,
  necromancerLastRound: 0,
});
const makeState = (players, overrides = {}) => ({
  players,
  deck: [],
  deckCount: 0,
  discard: [],
  trump: "♠",
  attacker: 0,
  defender: 1,
  current: 0,
  table: [],
  phase: "attack",
  throwInDone: [],
  maxAttackCards: 0,
  round: 1,
  thiefOffer: [],
  thiefOfferTarget: null,
  thiefOfferOwner: null,
  thiefReveal: [],
  loser: null,
  ...overrides,
});
const events = { endTurn: ({ next } = {}) => next };

test("deals a 52-card deck and gives the barbarian eight cards", () => {
  const state = Durak.setup(
    { ctx: { numPlayers: 3 }, random: { Shuffle: (cards) => cards } },
    { slots: [
      { role: "paladin", isBot: false },
      { role: "barbarian", isBot: true },
      { role: "thief", isBot: false },
    ] },
  );
  assert.equal(state.players[1].hand.length, 8);
  assert.equal(state.players[0].hand.length, 6);
  assert.equal(state.deck.length + state.players.reduce((sum, player) => sum + player.hand.length, 0), 52);
});

test("starts an attack with multiple same-rank cards and rejects mixed ranks", () => {
  const hand = [card("♥", "3", 3), card("♦", "3", 3), card("♣", "4", 4)];
  const state = makeState([
    emptyPlayer(0, "paladin", [...hand]),
    emptyPlayer(1, "paladin", Array.from({ length: 4 }, (_, i) => card("♠", `${i + 2}`, i + 2))),
    emptyPlayer(2, "paladin", [card("♥", "7", 7)]),
    emptyPlayer(3, "paladin", [card("♣", "8", 8)]),
  ]);
  Durak.moves.startAttack({ G: state, playerID: "0", events }, ["♥-3", "♦-3"]);
  assert.equal(state.table.length, 2);
  assert.deepEqual(state.table.map(({ card: played }) => played.rank), [3, 3]);
  assert.equal(state.players[0].hand.length, 1);
  assert.equal(state.phase, "throw-in");

  const invalid = makeState([
    emptyPlayer(0, "paladin", [...hand]),
    emptyPlayer(1, "paladin", [card("♠", "2", 2)]),
    emptyPlayer(2, "paladin", [card("♥", "7", 7)]),
  ]);
  Durak.moves.startAttack({ G: invalid, playerID: "0", events }, ["♥-3", "♣-4"]);
  assert.equal(invalid.table.length, 0);
  assert.equal(invalid.players[0].hand.length, 3);
});

test("lets the defender choose which attack card a defense beats", () => {
  const attacks = [
    { card: card("♦", "6", 6) },
    { card: card("♥", "6", 6) },
  ];
  const defense = card("♥", "8", 8);
  const state = makeState([
    emptyPlayer(0, "paladin", []),
    emptyPlayer(1, "paladin", [defense]),
  ], {
    attacker: 0,
    defender: 1,
    current: 1,
    phase: "defend",
    table: attacks,
    maxAttackCards: 2,
  });
  Durak.moves.defendWith({ G: state, playerID: "1" }, defense.id, attacks[1].card.id);
  assert.equal(state.table[0].defense, undefined);
  assert.equal(state.table[1].defense.id, defense.id);
  assert.equal(state.phase, "defend");
});

test("after taking cards, the next player after the defender becomes attacker", () => {
  const state = makeState([
    emptyPlayer(0, "paladin", [card("♥", "4", 4)]),
    emptyPlayer(1, "paladin", []),
    emptyPlayer(2, "paladin", [card("♣", "7", 7)]),
    emptyPlayer(3, "paladin", [card("♦", "9", 9)]),
  ], {
    attacker: 0,
    defender: 1,
    current: 1,
    phase: "defend",
    table: [{ card: card("♠", "6", 6) }],
    maxAttackCards: 1,
  });
  Durak.moves.takeCards({ G: state, playerID: "1", events });
  assert.equal(state.players[1].handCount, 1);
  assert.equal(state.attacker, 2);
  assert.equal(state.current, 2);
  assert.equal(state.phase, "attack");
});

test("the paladin's next player cannot throw in", () => {
  const state = makeState([
    emptyPlayer(0, "paladin", [card("♦", "4", 4), card("♣", "5", 5)]),
    emptyPlayer(1, "paladin", [card("♥", "4", 4)]),
    emptyPlayer(2, "paladin", [card("♣", "5", 5)]),
  ], { defender: 1 });
  Durak.moves.startAttack({ G: state, playerID: "0", events }, ["♦-4"]);
  assert.equal(state.current, 0);
  assert.equal(state.phase, "throw-in");
});

test("only the two active seats next to the defender can throw in", () => {
  const state = makeState([
    emptyPlayer(0, "paladin", [card("♥", "8", 8), card("♣", "4", 4)]),
    emptyPlayer(1, "thief", [card("♦", "2", 2)]),
    emptyPlayer(2, "paladin", [card("♣", "8", 8)]),
    emptyPlayer(3, "paladin", [card("♠", "8", 8)]),
  ], {
    attacker: 0,
    defender: 1,
  });
  Durak.moves.startAttack({ G: state, playerID: "0", events }, ["♥-8"]);
  assert.equal(state.current, 0);
  Durak.moves.passThrowIn({ G: state, playerID: "0", events });
  assert.equal(state.current, 2);
  Durak.moves.passThrowIn({ G: state, playerID: "2", events });
  assert.equal(state.current, 1);
  assert.equal(state.phase, "defend");
});

test("a transfer can return an eligible player with no cards", () => {
  const state = makeState([
    emptyPlayer(0, "paladin", [card("♠", "4", 4)]),
    emptyPlayer(1, "paladin", [card("♥", "6", 6), card("♦", "6", 6)]),
    emptyPlayer(2, "paladin", []),
    emptyPlayer(3, "paladin", [card("♣", "9", 9)]),
  ], {
    attacker: 0,
    defender: 1,
    current: 1,
    phase: "defend",
    table: [{ card: card("♠", "6", 6) }],
    maxAttackCards: 1,
  });
  Durak.moves.transfer({ G: state, playerID: "1", events }, "♥-6");
  assert.equal(state.defender, 2);
  assert.equal(state.table.length, 2);
  assert.equal(state.phase, "defend");

  state.current = 2;
  state.phase = "defend";
  Durak.moves.takeCards({ G: state, playerID: "2", events });
  assert.equal(state.players[2].returns, 1);
  assert.equal(state.players[2].handCount, 2);
});

test("a barbarian or a player with two returns cannot be transferred back", () => {
  const attack = { card: card("♠", "6", 6) };
  const transferCard = card("♥", "6", 6);
  const barbarianGame = makeState([
    emptyPlayer(0),
    emptyPlayer(1, "paladin", [transferCard]),
    emptyPlayer(2, "barbarian", []),
  ], { current: 1, defender: 1, phase: "defend", table: [attack] });
  Durak.moves.transfer({ G: barbarianGame, playerID: "1", events }, transferCard.id);
  assert.equal(barbarianGame.defender, 1);

  const twiceReturned = emptyPlayer(2, "paladin", []);
  twiceReturned.returns = 2;
  const exhaustedGame = makeState([
    emptyPlayer(0),
    emptyPlayer(1, "paladin", [transferCard]),
    twiceReturned,
  ], { current: 1, defender: 1, phase: "defend", table: [attack] });
  Durak.moves.transfer({ G: exhaustedGame, playerID: "1", events }, transferCard.id);
  assert.equal(exhaustedGame.defender, 1);
});

test("the thief sees only their offer and can steal a selected offered card", () => {
  const stolen = card("♦", "9", 9);
  const state = makeState([
    emptyPlayer(0, "thief", [card("♠", "2", 2)]),
    emptyPlayer(1, "paladin", [stolen, card("♥", "7", 7)]),
  ]);
  const random = { Shuffle: (cards) => cards };
  Durak.moves.useThief({ G: state, playerID: "0", random }, 1);
  const thiefView = Durak.playerView({ G: state, playerID: "0" });
  const opponentView = Durak.playerView({ G: state, playerID: "1" });
  assert.equal(thiefView.thiefReveal.length, 2);
  assert.equal(opponentView.thiefReveal.length, 0);
  assert.equal(opponentView.players[0].hand.length, 0);
  Durak.moves.stealCard({ G: state, playerID: "0" }, stolen.id);
  assert.equal(state.players[0].hand.some((item) => item.id === stolen.id), true);
  assert.equal(state.players[1].hand.some((item) => item.id === stolen.id), false);
  assert.equal(state.players[0].thiefUses, 1);
});

test("the necromancer can recover only one of the last six discard cards", () => {
  const player = emptyPlayer(0, "necromancer", []);
  const discard = Array.from({ length: 7 }, (_, index) => card("♣", String(index + 2), index + 2));
  assert.equal(discard.length, 7);
  const oldest = discard[0].id;
  const latest = discard[6].id;
  const state = makeState([player, emptyPlayer(1)], { discard });
  Durak.moves.useNecromancer({ G: state, playerID: "0" }, oldest);
  assert.equal(player.hand.length, 0);
  Durak.moves.useNecromancer({ G: state, playerID: "0" }, latest);
  assert.deepEqual(player.hand.map((item) => item.id), [latest]);
  assert.equal(player.necromancerUses, 1);
});

test("reverse players beat only with a lower card of the same suit", () => {
  const state = makeState([
    emptyPlayer(0),
    emptyPlayer(1, "reverse", [card("♥", "4", 4), card("♦", "A", 14)]),
  ], {
    attacker: 0,
    defender: 1,
    current: 1,
    phase: "defend",
    table: [{ card: card("♥", "8", 8) }],
    maxAttackCards: 1,
  });
  Durak.moves.defendWith({ G: state, playerID: "1" }, "♦-A", "♥-8");
  assert.equal(state.table[0].defense, undefined);
  Durak.moves.defendWith({ G: state, playerID: "1" }, "♥-4", "♥-8");
  assert.equal(state.table[0].defense.id, "♥-4");
});
