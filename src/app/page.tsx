"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Client as CoreClient, LobbyClient } from "boardgame.io/client";
import type { BoardProps } from "boardgame.io/react";
import { Client as ReactClient } from "boardgame.io/react";
import { SocketIO } from "boardgame.io/multiplayer";
import { Durak, canBeatCard, canTransferCard, chooseBotAction } from "@/lib/durak.mts";
import type { Card, DurakState, DurakRole, DurakSetupData, GameLogEntry, Suit } from "@/lib/durak.mts";
import { translations } from "@/lib/translations";
import type { Language, Translation } from "@/lib/translations";

type T = Translation;
type BotSeat = { id: number; credentials: string };
type RoomConnection = {
  matchID: string;
  playerID: string;
  credentials: string;
  slots: DurakSetupData["slots"];
  botSeats: BotSeat[];
  isHost: boolean;
  numPlayers: number;
};
type RoomPlayer = { id: number; name?: string; isConnected?: boolean };
type RoomMetadata = { matchID: string; players: RoomPlayer[] };
type Screen = "setup" | "waiting" | "game";
type GameBoardProps = BoardProps<DurakState> & {
  translations: T;
  roomCode: string;
  onReturnHome: () => void;
};

const serverHost = typeof window === "undefined" ? "localhost" : window.location.hostname;
const serverUrl =
  process.env.NEXT_PUBLIC_GAME_SERVER_URL ||
  (process.env.NODE_ENV === "development" ? `http://${serverHost}:3101` : "");
const roomStorageKey = "durak:last-room";
const roles: DurakRole[] = ["paladin", "barbarian", "thief", "necromancer", "reverse"];
const roleMarks: Record<DurakRole, string> = {
  paladin: "✦",
  barbarian: "⚒",
  thief: "⌁",
  necromancer: "☾",
  reverse: "↺",
};
const suitNames: Record<Suit, string> = {
  "♠": "Spades",
  "♥": "Hearts",
  "♦": "Diamonds",
  "♣": "Clubs",
};

function CardFace({
  card,
  onClick,
  selected = false,
  small = false,
}: {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`playing-card${small ? " playing-card--small" : ""}${selected ? " playing-card--selected" : ""}${onClick ? " playing-card--interactive" : ""}`}
      onClick={onClick}
      aria-label={`${card.label} ${suitNames[card.suit]}`}
      aria-pressed={onClick ? selected : undefined}
    >
      {/* Replace typographic card marks with artwork when image assets are added. */}
      <span className="card-rank">{card.label}</span>
      <span className="card-suit">{card.suit}</span>
    </button>
  );
}

function CardBack({ count = 1 }: { count?: number }) {
  return (
    <div className="card-stack" aria-label={`${count} hidden cards`}>
      {count > 2 && <span className="card-back card-back--offset" />}
      {count > 1 && <span className="card-back card-back--under" />}
      <span className="card-back"><i /></span>
    </div>
  );
}

function GameBoard({
  G,
  ctx,
  moves,
  playerID,
  isActive,
  isConnected,
  _stateID,
  matchData,
  translations: t,
  roomCode,
  onReturnHome,
}: GameBoardProps) {
  const [selection, setSelection] = useState<{ stateId: number; ids: string[]; targetId: string | null }>({
    stateId: -1,
    ids: [],
    targetId: null,
  });
  const [abilityModal, setAbilityModal] = useState<"thief-target" | "necromancer" | null>(null);
  const [selectedAbilityCard, setSelectedAbilityCard] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const stateId = G ? _stateID : 0;
  const selectedIds = selection.stateId === stateId ? selection.ids : [];
  const targetAttackId = selection.stateId === stateId ? selection.targetId : null;
  const ownId = playerID === undefined || playerID === null ? -1 : Number(playerID);
  const ownPlayer = G?.players[ownId];
  const isMyTurn = Boolean(G && isActive && G.current === ownId && ctx.currentPlayer === String(ownId));
  const selectedCards = G && ownPlayer
    ? ownPlayer.hand.filter((card) => selectedIds.includes(card.id))
    : [];
  const selectedRank = selectedCards[0]?.rank;
  const tRoleName = (role: DurakRole) => t.roleShort[role];

  const gameMoves = moves as Record<string, (...args: unknown[]) => void>;
  const toggleCard = useCallback((card: Card) => {
    setNotice("");
    setSelection((previous) => {
      const currentIds = previous.stateId === stateId ? previous.ids : [];
      if (currentIds.includes(card.id)) {
        return { stateId, ids: currentIds.filter((id) => id !== card.id), targetId: selection.targetId };
      }
      const currentCards = ownPlayer?.hand.filter((item) => currentIds.includes(item.id)) ?? [];
      if (G?.phase === "attack" || G?.phase === "throw-in") {
        if (currentCards.length > 0 && currentCards[0].rank !== card.rank) {
          setNotice(t.chooseSameRank);
          return { stateId, ids: [card.id], targetId: selection.targetId };
        }
      } else {
        return { stateId, ids: [card.id], targetId: selection.targetId };
      }
      return { stateId, ids: [...currentIds, card.id], targetId: selection.targetId };
    });
  }, [G?.phase, ownPlayer?.hand, selection.targetId, stateId, t.chooseSameRank]);

  if (!G || !ownPlayer) {
    return (
      <div className="waiting-game">
        <span className="section-kicker">{t.waitingRoom.toUpperCase()}</span>
        <CardBack count={2} />
        <p>{t.waitingHint}</p>
        <strong>{roomCode}</strong>
      </div>
    );
  }

  const playerName = (id: number) => {
    const metadata = matchData?.find((player) => player.id === id);
    if (metadata?.name) return metadata.name;
    return G.players[id].isBot ? `${t.bot} ${id + 1}` : `${t.player} ${id + 1}`;
  };
  const openAttacks = G.table.filter((pair) => !pair.defense);
  const canThrow = selectedCards.length > 0 &&
    selectedCards.every((card) => G.table.some((attack) =>
      attack.card.rank === card.rank || attack.defense?.rank === card.rank,
    )) &&
    G.table.length + selectedCards.length <= G.maxAttackCards;
  const canAttack = selectedCards.length > 0 &&
    selectedCards.every((card) => card.rank === selectedRank) &&
    selectedCards.length <= Math.min(6, G.players[G.defender].handCount);
  const selectedDefenseTarget = openAttacks.find((pair) => pair.card.id === targetAttackId) ?? openAttacks[0];
  const canDefend = selectedCards.length === 1 && Boolean(selectedDefenseTarget) &&
    canBeatCard(selectedDefenseTarget.card, selectedCards[0], ownPlayer.role, G.trump);
  const canTransfer = selectedCards.length === 1 && canTransferCard(G, ownId, selectedCards[0]?.id ?? "");
  const currentName = playerName(ownId);
  const finalPlayer = G.loser === null ? undefined : G.players[G.loser];
  const move = (name: string, ...args: unknown[]) => {
    setNotice("");
    gameMoves[name]?.(...args);
    setSelection({ stateId, ids: [], targetId: null });
  };
  const formatCard = (card: Card) => `${card.label}${card.suit}`;
  const describeLogEntry = (entry: GameLogEntry) => {
    const cards = entry.cards.map(formatCard).join(", ");
    switch (entry.action) {
      case "attack": return `${t.logAttack} ${cards}`;
      case "throw-in": return `${t.logThrowIn} ${cards}`;
      case "defense": return `${t.logDefense} ${entry.targetCard ? formatCard(entry.targetCard) : ""} → ${cards}`;
      case "undo-defense": return `${t.logUndoDefense} ${entry.targetCard ? formatCard(entry.targetCard) : ""} ← ${cards}`;
      case "transfer": return `${t.logTransfer} ${cards} ${entry.targetId === undefined ? "" : playerName(entry.targetId)}`;
      case "take": return `${t.logTake} (${cards})`;
      case "pass": return t.logPass;
      case "steal": return `${t.logSteal} ${entry.targetId === undefined ? "" : playerName(entry.targetId)}: ${cards}`;
      case "recover": return `${t.logRecover}: ${cards}`;
    }
  };
  const handleHandCardClick = (card: Card) => {
    if (G.phase === "defend" && isMyTurn) {
      const attack = openAttacks.find((pair) => pair.card.id === targetAttackId) ?? openAttacks[0];
      if (attack && canBeatCard(attack.card, card, ownPlayer.role, G.trump)) {
        move("defendWith", card.id, attack.card.id);
        return;
      }
    }
    toggleCard(card);
  };

  return (
    <section className="game-screen">
      <div className="game-heading">
        <div>
          <span className="section-kicker">TABLE {roomCode} / {t.round.toUpperCase()} {G.round}</span>
          <h1>{t.table}</h1>
        </div>
        <span className={`connection-status${isConnected ? "" : " connection-status--offline"}`}>
          <i /> {isConnected ? t.connected : t.connectionLost}
        </span>
      </div>
      <div className="game-layout">
        <aside className="side-panel">
          <div className="panel-caption">{t.players} <span>{String(G.players.length).padStart(2, "0")}</span></div>
          <div className="player-list">
            {G.players.map((player) => {
              const isCurrent = G.current === player.id;
              const out = player.handCount === 0;
              return (
                <div className={`player-row${isCurrent ? " player-row--active" : ""}${out ? " player-row--out" : ""}`} key={player.id}>
                  <span className="avatar">{playerName(player.id).slice(0, 1).toUpperCase()}</span>
                  <span className="player-details">
                    <strong>{playerName(player.id)}</strong>
                    <small>{roleMarks[player.role]} {tRoleName(player.role)}{player.returns > 0 && ` · ${player.returns}/2 ${t.returnLabel}`}</small>
                  </span>
                  <span className="hand-count">{out ? "—" : player.handCount}</span>
                </div>
              );
            })}
          </div>
          <div className="side-divider" />
          <div className="panel-caption">{t.deck.toUpperCase()} <span>{G.deckCount}</span></div>
          <div className="deck-status">
            {G.deckCount > 0 ? <CardBack count={G.deckCount} /> : <span className="empty-deck">∅</span>}
            <div><strong>{G.deckCount} <small>{t.cards}</small></strong><span>{t.trump}: <b>{G.trump}</b></span></div>
          </div>
          <div className="side-divider" />
          <div className="panel-caption">{t.discard.toUpperCase()} <span>{G.discard.length}</span></div>
          <div className="discard-preview">
            {G.discard.length > 0 ? (
              <div className="mini-card"><span>{G.discard.at(-1)?.label}</span><b>{G.discard.at(-1)?.suit}</b></div>
            ) : <div className="discard-empty">—</div>}
            <span>{G.discard.length} {t.cards}</span>
          </div>
          <div className="side-divider" />
          <div className="panel-caption">{t.gameHistory} <span>{G.log.length}</span></div>
          <ol className="move-history" aria-label={t.gameHistory}>
            {G.log.length > 0 ? G.log.map((entry, index) => (
              <li key={`${entry.round}-${index}`}>
                <span>{entry.round}.</span>
                <strong>{playerName(entry.playerId)}</strong>
                <small>{describeLogEntry(entry)}</small>
              </li>
            )) : <li className="move-history-empty">{t.emptyHistory}</li>}
          </ol>
        </aside>

        <div className="table-column">
          <div className="felt-table">
            <div className="table-stamp">DURAK <span>·</span> 52</div>
            {(() => {
              const clockwiseSeats: Record<number, number[]> = {
                3: [0, 1, 2],
                4: [0, 1, 2, 3],
                5: [0, 1, 4, 2, 3],
                6: [0, 1, 4, 2, 3, 5],
              };
              return G.players.map((player) => {
                const seatClass = G.players.length === 2
                  ? (player.id === ownId ? "seat-bottom" : "seat-top")
                  : `seat-${clockwiseSeats[G.players.length]?.[player.id] ?? player.id}`;
                const out = player.handCount === 0;
                return (
                  <div className={`table-player ${seatClass}${G.current === player.id ? " table-player--turn" : ""}${out ? " table-player--out" : ""}`} key={player.id}>
                    <span className="seat-avatar">{playerName(player.id).slice(0, 1).toUpperCase()}</span>
                    <span className="seat-name">{playerName(player.id)}</span>
                    <span className="seat-role">{roleMarks[player.role]} {tRoleName(player.role)}</span>
                    <div className="opponent-cards">
                      {player.handCount > 0 && <CardBack count={player.handCount} />}
                      <span>{player.handCount} {t.cards}</span>
                    </div>
                    {G.current === player.id && <span className="turn-pip">{t.turn}</span>}
                  </div>
                );
              });
            })()}
            <div className="battle-center">
              <div className="battle-meta"><span>{t[G.phase === "attack" ? "attacks" : "defend"]}</span><i /><span>{G.table.length} / {G.maxAttackCards || 6}</span></div>
              <div className="battle-cards">
                {G.table.length === 0 ? (
                  <div className="table-empty"><span>♠</span><strong>{isMyTurn ? t.yourTurn : `${t.turnOfPlayer}: ${playerName(G.current)}`}</strong><small>{isMyTurn ? t.attackHint : t.waitForMove}</small></div>
                ) : G.table.map((pair) => (
                  <div className="card-pair" key={pair.card.id}>
                    <CardFace
                      card={pair.card}
                      small
                      selected={targetAttackId === pair.card.id}
                      onClick={G.phase === "defend" && isMyTurn && !pair.defense
                        ? () => setSelection((previous) => ({
                          stateId,
                          ids: previous.stateId === stateId ? previous.ids : [],
                          targetId: pair.card.id,
                        }))
                        : undefined}
                    />
                    {pair.defense
                      ? <CardFace
                        card={pair.defense}
                        small
                        onClick={isMyTurn && (G.phase === "defend" || G.phase === "defend-ready")
                          ? () => move("undoDefense", pair.card.id)
                          : undefined}
                      />
                      : <div className="defense-slot">?</div>}
                  </div>
                ))}
              </div>
              {G.table.length > 0 && <div className="battle-caption">{playerName(G.attacker)} <span>→</span> {playerName(G.defender)}</div>}
              {G.phase === "defend" && isMyTurn && <small className="battle-instruction">{t.chooseAttack}</small>}
            </div>
            <div className="trump-indicator"><span>{t.trump}</span><b>{G.trump}</b></div>
            <div className="felt-texture" />
          </div>

          <div className="hand-panel">
            <div className="hand-heading">
              <div><span className="section-kicker">{isMyTurn ? t.currentPlayer.toUpperCase() : t.waitingRoom.toUpperCase()}</span><h2>{currentName}<span> / {tRoleName(ownPlayer.role)}</span></h2></div>
              <div className="hand-count-label">{ownPlayer.handCount}<small>{t.cards}</small></div>
            </div>
            <div className="hand-cards">
              {ownPlayer.hand.map((card) => (
                <CardFace
                  key={card.id}
                  card={card}
                  selected={selectedIds.includes(card.id)}
                  onClick={() => handleHandCardClick(card)}
                />
              ))}
              {ownPlayer.handCount === 0 && <span className="empty-hand">{t.noCards}</span>}
            </div>
            <div className="action-row">
              {!isMyTurn && G.phase !== "ended" && <span className="waiting-turn">{t.turnOfPlayer}: {playerName(G.current)}. {t.waitForMove}</span>}
              {G.phase === "attack" && isMyTurn && (
                <button className="primary-action" disabled={!canAttack} onClick={() => move("startAttack", selectedIds)}>
                  {t.attackCards}<span>↗</span>
                </button>
              )}
              {G.phase === "throw-in" && isMyTurn && (
                <>
                  <button className="primary-action" disabled={!canThrow} onClick={() => move("throwIn", selectedIds)}>{t.throwInCards}<span>↗</span></button>
                  <button className="secondary-action" onClick={() => move("passThrowIn")}>{t.skipThrowIn}</button>
                </>
              )}
              {G.phase === "defend" && isMyTurn && (
                <>
                  <button
                    className="primary-action"
                    disabled={!canDefend}
                    onClick={() => move("defendWith", selectedIds[0], selectedDefenseTarget?.card.id)}
                  >{t.defend}<span>↗</span></button>
                  {!G.table.some((pair) => pair.defense) && (
                    <button className="secondary-action" disabled={!canTransfer} onClick={() => move("transfer", selectedIds[0])}>{t.transfer}</button>
                  )}
                  <button className="secondary-action" onClick={() => move("takeCards")}>{t.takeCards}</button>
                </>
              )}
              {G.phase === "defend-ready" && isMyTurn && (
                <>
                  <button className="primary-action" onClick={() => move("finishDefense")}>{t.completeDefense}<span>↗</span></button>
                  <button className="secondary-action" onClick={() => move("takeCards")}>{t.takeCards}</button>
                </>
              )}
              {isMyTurn && G.phase === "attack" && ownPlayer.role === "thief" && (
                <button
                  className="ability-action"
                  disabled={ownPlayer.thiefUses >= 3 || ownPlayer.thiefLastRound === G.round}
                  onClick={() => setAbilityModal("thief-target")}
                >{t.steal}<small>{3 - ownPlayer.thiefUses}/3</small></button>
              )}
              {isMyTurn && G.phase === "attack" && ownPlayer.role === "necromancer" && (
                <button
                  className="ability-action"
                  disabled={ownPlayer.necromancerUses >= 5 || ownPlayer.necromancerLastRound === G.round || G.discard.length === 0}
                  onClick={() => { setSelectedAbilityCard(null); setAbilityModal("necromancer"); }}
                >{t.useAbility}<small>{5 - ownPlayer.necromancerUses}/5</small></button>
              )}
            </div>
            <p className="game-notice">{notice || (isMyTurn ? `${t.yourTurn}. ${G.phase === "attack" && G.table.length === 0 ? t.attackHint : t.chooseCard}` : `${t.turnOfPlayer}: ${playerName(G.current)}. ${t.waitForMove}`)}</p>
          </div>
        </div>
      </div>
      <footer className="site-footer"><span>DURAK / {roomCode}</span><span>SERVER-AUTHORITATIVE PLAY</span><span>{G.players.filter((player) => player.handCount > 0).length} {t.players.toLowerCase()} · {G.deckCount} {t.deck.toLowerCase()}</span></footer>

      {abilityModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="ability-modal">
            <button className="modal-close" aria-label={t.close} onClick={() => setAbilityModal(null)}>×</button>
            <span className="section-kicker">{t.useAbility.toUpperCase()}</span>
            <h2>{abilityModal === "thief-target" ? t.steal : t.chooseDiscard}</h2>
            {abilityModal === "thief-target" && (
              <>
                <div className="target-options">
                  {G.players.filter((player) => player.id !== ownId && player.handCount > 1).map((player) => (
                    <button key={player.id} onClick={() => { move("useThief", player.id); setAbilityModal(null); }}>
                      <span className="avatar">{playerName(player.id).slice(0, 1)}</span><strong>{playerName(player.id)}</strong><span>{player.handCount}</span>
                    </button>
                  ))}
                </div>
                <button className="secondary-action" onClick={() => setAbilityModal(null)}>{t.close}</button>
              </>
            )}
            {abilityModal === "necromancer" && (
              <>
                <p className="modal-description">{t.discard}: {Math.min(6, G.discard.length)} / 6</p>
                <div className="modal-cards">
                  {G.discard.slice(-6).map((card) => (
                    <CardFace key={card.id} card={card} selected={selectedAbilityCard === card.id} onClick={() => setSelectedAbilityCard(card.id)} />
                  ))}
                </div>
                <button
                  className="start-button"
                  disabled={!selectedAbilityCard}
                  onClick={() => { move("useNecromancer", selectedAbilityCard); setAbilityModal(null); }}
                >{t.select}<span className="button-arrow">↗</span></button>
              </>
            )}
          </div>
        </div>
      )}

      {G.thiefOfferOwner === ownId && G.thiefReveal.length > 0 && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="ability-modal">
            <span className="section-kicker">{t.useAbility.toUpperCase()}</span>
            <h2>{t.chooseCard}</h2>
            <p className="modal-description">{playerName(G.thiefOfferTarget ?? 0)}</p>
            <div className="modal-cards">
              {G.thiefReveal.map((card) => (
                <CardFace key={card.id} card={card} selected={selectedAbilityCard === card.id} onClick={() => setSelectedAbilityCard(card.id)} />
              ))}
            </div>
            <button
              className="start-button"
              disabled={!selectedAbilityCard}
              onClick={() => { move("stealCard", selectedAbilityCard); setSelectedAbilityCard(null); }}
            >{t.select}<span className="button-arrow">↗</span></button>
            <button className="secondary-action" onClick={() => { move("declineThief"); setSelectedAbilityCard(null); }}>{t.declineSteal}</button>
          </div>
        </div>
      )}

      {G.phase === "ended" && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="result-modal">
            <span className="modal-symbol">♠</span><span className="section-kicker">{t.gameOver}</span>
            <h2>{finalPlayer ? playerName(finalPlayer.id) : t.loser}</h2><p>{t.loser}</p>
            <strong>{roomCode}</strong>
            <button className="start-button" onClick={onReturnHome}>{t.close}<span className="button-arrow">↗</span></button>
          </div>
        </div>
      )}
      {!isConnected && <div className="connection-overlay" role="status">{t.connectionLost}</div>}
    </section>
  );
}

const DurakClient = ReactClient<DurakState, GameBoardProps>({
  game: Durak,
  board: GameBoard,
  debug: false,
  multiplayer: SocketIO({ server: serverUrl }),
});

function BotDrivers({ connection }: { connection: RoomConnection }) {
  const drivers = useRef<Array<{ stop: () => void }>>([]);

  useEffect(() => {
    drivers.current = connection.botSeats.map((bot) => {
      const client = CoreClient({
        game: Durak,
        debug: false,
        numPlayers: connection.numPlayers,
        playerID: String(bot.id),
        credentials: bot.credentials,
        matchID: connection.matchID,
        multiplayer: SocketIO({ server: serverUrl }),
      });
      let actionInProgress = false;
      let lastActionState = -1;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = client.subscribe((state) => {
        if (!state?.G || state.G.current !== bot.id || state.ctx.currentPlayer !== String(bot.id)) return;
        if (actionInProgress || state._stateID === lastActionState) return;
        const action = chooseBotAction(state.G as DurakState, bot.id);
        if (!action) return;
        actionInProgress = true;
        lastActionState = state._stateID;
        timer = setTimeout(() => {
          const current = client.getState();
          if (current?.G?.current === bot.id) client.moves[action.move](...action.args);
          actionInProgress = false;
        }, 500);
      });
      client.start();
      return {
        stop: () => {
          if (timer) clearTimeout(timer);
          unsubscribe();
          client.stop();
        },
      };
    });
    return () => {
      drivers.current.forEach((driver) => driver.stop());
      drivers.current = [];
    };
  }, [connection]);

  return null;
}

export default function Home() {
  const [language, setLanguage] = useState<Language>("ru");
  const [screen, setScreen] = useState<Screen>("setup");
  const [playerCount, setPlayerCount] = useState(4);
  const [setupRoles, setSetupRoles] = useState<DurakRole[]>(["paladin", "barbarian", "thief", "necromancer", "reverse", "paladin"]);
  const [computerSeats, setComputerSeats] = useState<boolean[]>([false, false, false, false, false, false]);
  const [name, setName] = useState("Алексей");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [roomMetadata, setRoomMetadata] = useState<RoomMetadata | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState("");
  const t = translations[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(roomStorageKey);
        if (saved) {
          const restored = JSON.parse(saved) as RoomConnection;
          if (restored.matchID && restored.playerID && restored.credentials) {
            setConnection(restored);
            setRoomCodeInput(restored.matchID);
            setScreen("waiting");
          }
        }
      } catch (restoreError) {
        console.error("Could not restore the saved game room.", restoreError);
        setError(translations.ru.connectionError);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const humanCount = computerSeats.slice(0, playerCount).filter((isComputer) => !isComputer).length;
  const roomClient = useMemo(() => new LobbyClient({ server: serverUrl }), []);

  const updateRoomState = useCallback((metadata: RoomMetadata) => {
    setRoomMetadata(metadata);
    if (metadata.players.length > 0 && metadata.players.every((player) => Boolean(player.name))) {
      setScreen("game");
    }
  }, []);

  useEffect(() => {
    if (screen !== "waiting" || !connection) return;
    let active = true;
    let matchMissing = false;
    const pollRoom = async () => {
      if (!active || matchMissing) return;
      try {
        const match = await roomClient.getMatch("durak", connection.matchID);
        if (!active) return;
        updateRoomState({ matchID: match.matchID, players: match.players });
        setError("");
      } catch (pollError) {
        if (!active) return;
        if (pollError instanceof Error && pollError.message === "HTTP status 404") {
          matchMissing = true;
          clearInterval(timer);
          try {
            window.localStorage.removeItem(roomStorageKey);
          } catch (storageError) {
            console.error("Could not clear the missing game room.", storageError);
          }
          setConnection(null);
          setRoomMetadata(null);
          setRoomCodeInput("");
          setScreen("setup");
          setError(t.roomNotFound);
          return;
        }
        console.error("Could not refresh the game room.", pollError);
        setError(t.connectionLost);
      }
    };
    const timer = setInterval(() => void pollRoom(), 2000);
    void pollRoom();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connection, roomClient, screen, t.connectionLost, t.roomNotFound, updateRoomState]);

  const saveConnection = (room: RoomConnection) => {
    window.localStorage.setItem(roomStorageKey, JSON.stringify(room));
    setConnection(room);
    setRoomCodeInput(room.matchID);
    setScreen("waiting");
    setRoomMetadata(null);
  };

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!serverUrl) {
      setError(t.gameServerMissing);
      return;
    }
    if (humanCount < 1) {
      setError(t.connectionError);
      return;
    }
    setBusy(true);
    const slots = setupRoles.slice(0, playerCount).map((role, id) => ({
      role,
      isBot: computerSeats[id],
    }));
    try {
      const { matchID } = await roomClient.createMatch("durak", {
        numPlayers: playerCount,
        setupData: { slots } satisfies DurakSetupData,
      });
      const host = await roomClient.joinMatch("durak", matchID, {
        playerID: "0",
        playerName: name.trim() || `${t.player} 1`,
      });
      const botSeats: BotSeat[] = [];
      for (let id = 1; id < slots.length; id += 1) {
        if (!slots[id].isBot) continue;
        const botJoin = await roomClient.joinMatch("durak", matchID, {
          playerID: String(id),
          playerName: `${t.bot} ${id + 1}`,
          data: { isBot: true },
        });
        botSeats.push({ id, credentials: botJoin.playerCredentials });
      }
      saveConnection({
        matchID,
        playerID: host.playerID,
        credentials: host.playerCredentials,
        slots,
        botSeats,
        isHost: true,
        numPlayers: playerCount,
      });
    } catch (createError) {
      console.error("Could not create the game room.", createError);
      setError(t.connectionError);
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!serverUrl) {
      setError(t.gameServerMissing);
      return;
    }
    const matchID = roomCodeInput.trim();
    if (!matchID) {
      setError(t.roomCodePlaceholder);
      return;
    }
    setBusy(true);
    try {
      const joined = await roomClient.joinMatch("durak", matchID, {
        playerName: name.trim() || `${t.player} 2`,
      });
      const match = await roomClient.getMatch("durak", matchID);
      const slots = (match.setupData as DurakSetupData | undefined)?.slots ?? [];
      const room: RoomConnection = {
        matchID,
        playerID: joined.playerID,
        credentials: joined.playerCredentials,
        slots,
        botSeats: [],
        isHost: false,
        numPlayers: match.players.length,
      };
      saveConnection(room);
      updateRoomState({ matchID, players: match.players });
    } catch (joinError) {
      console.error("Could not join the game room.", joinError);
      setError(t.connectionError);
    } finally {
      setBusy(false);
    }
  }

  async function copyRoomCode() {
    if (!connection) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(connection.matchID);
      } else {
        const input = document.createElement("textarea");
        input.value = connection.matchID;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        let copied: boolean;
        try {
          input.select();
          copied = document.execCommand("copy");
        } finally {
          input.remove();
        }
        if (!copied) throw new Error("The browser denied the copy command.");
      }
      setCopyState(t.copied);
      window.setTimeout(() => setCopyState(""), 1800);
    } catch (copyError) {
      console.error("Could not copy the room code.", copyError);
      setCopyState(t.copyFailed);
    }
  }

  function leaveRoom() {
    try {
      window.localStorage.removeItem(roomStorageKey);
    } catch (storageError) {
      console.error("Could not clear the saved room credentials.", storageError);
      setError(t.connectionError);
    }
    setConnection(null);
    setRoomMetadata(null);
    setScreen("setup");
  }

  const roleName = (role: DurakRole) => t.roleShort[role];
  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); leaveRoom(); }} aria-label={t.newGame}>
          <span className="brand-mark">D</span>
          <span className="brand-name">{t.gameName}<small>HOUSE RULES</small></span>
        </a>
        <div className="topbar-right">
          <span className="online-indicator"><i /> ONLINE TABLE</span>
          <span className="top-separator" />
          <span className="language-label">{t.language}</span>
          <div className="language-switch" aria-label={t.language}>
            <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>EN</button>
            <button className={language === "ru" ? "active" : ""} onClick={() => setLanguage("ru")}>RU</button>
          </div>
        </div>
      </header>

      {screen === "setup" && (
        <section className="setup-screen">
          <div className="setup-intro">
            <span className="eyebrow"><span /> A TABLE OF CHANCE</span>
            <h1>{t.gameName}<span className="title-period">.</span></h1>
            <p>{t.gameTagline}</p>
            <div className="intro-rule"><span>♠</span><i /><span>♥</span><i /><span>♦</span><i /><span>♣</span></div>
          </div>
          <div className="setup-card online-setup-card">
            <div className="setup-card-header">
              <div><span className="section-kicker">01 / ONLINE</span><h2>{t.lobbyTitle}</h2><p>{t.multiplayerHint}</p></div>
              <span className="deck-badge">52 <span>CARDS</span></span>
            </div>
            <form onSubmit={createRoom}>
              <div className="field-row">
                <label htmlFor="host-name">{t.yourName}</label>
                <input id="host-name" className="text-field" value={name} onChange={(event) => setName(event.target.value)} maxLength={18} />
              </div>
              <div className="player-count-row">
                <div><span className="field-title">{t.playersCount}</span><span className="field-subtitle">2 — 6 {t.players.toLowerCase()}</span></div>
                <div className="stepper">
                  <button type="button" onClick={() => setPlayerCount((count) => Math.max(2, count - 1))} aria-label="Decrease players">−</button>
                  <strong>{String(playerCount).padStart(2, "0")}</strong>
                  <button type="button" onClick={() => setPlayerCount((count) => Math.min(6, count + 1))} aria-label="Increase players">+</button>
                </div>
              </div>
              <div className="players-list">
                {setupRoles.slice(0, playerCount).map((role, id) => (
                  <div className="setup-player" key={id}>
                    <span className="player-number">{String(id + 1).padStart(2, "0")}</span>
                    <span className="setup-seat-name">{id === 0 ? name || `${t.player} 1` : `${t.player} ${id + 1}`}</span>
                    <select
                      aria-label={`${t.role} ${id + 1}`}
                      value={role}
                      onChange={(event) => setSetupRoles((previous) => previous.map((value, index) => index === id ? event.target.value as DurakRole : value))}
                    >
                      {roles.map((item) => <option value={item} key={item}>{roleName(item)}</option>)}
                    </select>
                    <button
                      type="button"
                      className={`seat-type${computerSeats[id] ? " seat-type--bot" : ""}`}
                      disabled={id === 0}
                      onClick={() => setComputerSeats((previous) => previous.map((value, index) => index === id ? !value : value))}
                      aria-label={`${t.player} ${id + 1}: ${computerSeats[id] ? t.computer : t.human}`}
                      title={id === 0 ? t.human : (computerSeats[id] ? t.computer : t.human)}
                    >{computerSeats[id] ? "⌘" : "●"}</button>
                  </div>
                ))}
              </div>
              <p className="seat-legend"><span>●</span> {t.human}<span>⌘</span> {t.computer}</p>
              <button className="start-button" disabled={busy || humanCount === 0}>
                <span>{busy ? t.waitingRoom : t.createRoom}</span><span className="button-arrow">↗</span>
              </button>
            </form>
            <div className="join-divider"><span>{t.joinRoom}</span></div>
            <form className="join-form" onSubmit={joinRoom}>
              <input
                aria-label={t.roomCode}
                className="text-field"
                placeholder={t.roomCodePlaceholder}
                value={roomCodeInput}
                onChange={(event) => setRoomCodeInput(event.target.value)}
              />
              <button className="secondary-action" disabled={busy}>{t.joinRoom}</button>
            </form>
            {error && <p className="form-error" role="alert">{error}</p>}
            {!serverUrl && <p className="form-error" role="alert">{t.gameServerMissing}</p>}
          </div>
          <div className="role-strip">
            {roles.map((role) => (
              <div className="role-chip" key={role}>
                <span>{roleMarks[role]}</span><strong>{roleName(role)}</strong><small>{t.roleDescriptions[role]}</small>
              </div>
            ))}
          </div>
          <footer className="site-footer"><span>DURAK / ONLINE</span><span>PLAY FAIR. PLAY CLEVER.</span><span>52 CARDS · 5 ROLES</span></footer>
        </section>
      )}

      {screen === "waiting" && connection && (
        <section className="waiting-screen">
          <div className="game-heading">
            <div><span className="section-kicker">ONLINE ROOM / {connection.matchID}</span><h1>{t.waitingRoom}</h1></div>
            <button className="ghost-button" onClick={leaveRoom}>↶ <span>{t.disconnect}</span></button>
          </div>
          <div className="waiting-card">
            <span className="waiting-emblem">♠</span>
            <span className="section-kicker">{t.roomCodeLabel}</span>
            <button className="room-code-button" onClick={copyRoomCode}>{connection.matchID}<span>⧉</span></button>
            {copyState && <p className="copy-state">{copyState}</p>}
            <p>{t.waitingHint}</p>
            <div className="waiting-players">
              {connection.slots.map((slot, id) => {
                const roomPlayer = roomMetadata?.players.find((player) => player.id === id);
                const joined = Boolean(roomPlayer?.name);
                return (
                  <div className={`waiting-player${joined ? " waiting-player--joined" : ""}`} key={id}>
                    <span className="avatar">{joined ? roomPlayer?.name?.slice(0, 1).toUpperCase() : String(id + 1)}</span>
                    <span><strong>{roomPlayer?.name || (slot.isBot ? `${t.bot} ${id + 1}` : `${t.player} ${id + 1}`)}</strong><small>{roleMarks[slot.role]} {roleName(slot.role)} · {joined ? t.joined : t.waitingRoom}</small></span>
                    <i>{joined ? "✓" : "…"}</i>
                  </div>
                );
              })}
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <span className="waiting-pulse"><i /> {roomMetadata?.players.filter((player) => player.name).length ?? 0} / {connection.numPlayers} {t.joined.toLowerCase()}</span>
          </div>
          {connection.isHost && <BotDrivers connection={connection} />}
        </section>
      )}

      {screen === "game" && connection && (
        <>
          {connection.isHost && <BotDrivers connection={connection} />}
          <DurakClient
            matchID={connection.matchID}
            playerID={connection.playerID}
            credentials={connection.credentials}
            translations={t}
            roomCode={connection.matchID}
            onReturnHome={leaveRoom}
          />
          {error && <p className="global-error" role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
