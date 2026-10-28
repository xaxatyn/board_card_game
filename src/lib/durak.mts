import type { Game, PlayerID } from "boardgame.io";

// Роли и типы карт описывают публичные правила игры; рука каждого игрока
// остаётся приватной и передаётся только его собственному клиенту.
export type DurakRole = "paladin" | "barbarian" | "thief" | "necromancer" | "reverse";
// Масть представлена графическим символом, который одновременно служит
// короткой меткой в интерфейсе и частью стабильного ID карты.
export type Suit = "♠" | "♥" | "♦" | "♣";
// ID нужен для точного выбора карты даже при совпадающем ранге.
// rank используется правилами сравнений, label — подписью на карте.
export type Card = { id: string; rank: number; label: string; suit: Suit };
export type Player = {
  // ID игрока совпадает с его индексом в массиве players и с PlayerID
  // в boardgame.io; role и isBot задаются при создании комнаты.
  id: number;
  role: DurakRole;
  isBot: boolean;
  // Полный список карт хранится на сервере. Клиентам соперников он
  // скрывается функцией playerView; handCount оставлен видимым.
  hand: Card[];
  handCount: number;
  // Число возвратов в игру и статистика использования способностей.
  returns: number;
  thiefUses: number;
  // Запоминает раунд последнего применения, чтобы запрещать повтор
  // способности в том же раунде.
  thiefLastRound: number;
  necromancerUses: number;
  necromancerLastRound: number;
};
// На столе каждая атака хранится отдельно; карта защиты необязательна,
// пока пара ещё не отбита.
export type Attack = { card: Card; defense?: Card };
export type GameLogEntry = {
  // История хранится в состоянии, чтобы одинаково отображаться клиентам.
  round: number;
  playerId: number;
  // Объединённый тип действия позволяет UI форматировать каждый ход
  // исчерпывающим switch без произвольных строк.
  action: "attack" | "throw-in" | "defense" | "undo-defense" | "transfer" | "take" | "pass" | "steal" | "recover";
  cards: Card[];
  // Для перевода/кражи записывается участник-цель; для защиты — покрытая атака.
  targetId?: number;
  targetCard?: Card;
};
// Фазы определяют, какие серверные ходы допустимы и какие кнопки видны.
export type DurakPhase = "attack" | "throw-in" | "defend" | "defend-ready" | "ended";
export type DurakState = {
  // Порядок игроков фиксирован на всю партию; ID является индексом.
  players: Player[];
  // Полная колода существует только на сервере. deckCount — безопасный
  // для показа другим игрокам счётчик оставшихся карт.
  deck: Card[];
  deckCount: number;
  // Карты успешной атаки перемещаются сюда; верх массива — последняя карта.
  discard: Card[];
  trump: Suit;
  // Роли мест в раунде: атакующий, защищающийся и владелец текущего хода.
  attacker: number;
  defender: number;
  current: number;
  // Все атаки раунда и необязательные карты, которыми они побиты.
  table: Attack[];
  log: GameLogEntry[];
  // Флаг защищает от повторного открытия дополнительного окна подкидывания.
  postDefenseThrowInUsed: boolean;
  phase: DurakPhase;
  // Игроки, уже подкинувшие или спасовавшие в текущем окне.
  throwInDone: number[];
  // Предел количества карт на столе для этого защищающегося.
  maxAttackCards: number;
  round: number;
  // Состояние приватного выбора карты Вора хранится на сервере,
  // но раскрывается только ему через playerView.
  thiefOffer: Card[];
  thiefOfferTarget: number | null;
  thiefOfferOwner: number | null;
  thiefReveal: Card[];
  // ID проигравшего фиксируется при завершении партии; null означает,
  // что финального результата пока нет.
  loser: number | null;
};
export type DurakSetupData = {
  // Конфигурация каждого места передаётся лобби и читается при раздаче.
  slots: Array<{ role: DurakRole; isBot: boolean }>;
};

// Колода содержит по одной карте каждого номинала в каждой из четырёх мастей.
const suits: Suit[] = ["♠", "♥", "♦", "♣"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
// Варвар получает увеличенную начальную руку и имеет такой же предел добора.
const handLimit = (player: Player) =>
  player.role === "barbarian" ? 8 : 6;

function createDeck(): Card[] {
  // flatMap создаёт декартово произведение мастей и номиналов — ровно
  // 4 × 13 карт; ID строится из масти и отображаемого номинала.
  return suits.flatMap((suit) =>
    ranks.map((label, index) => ({ id: `${suit}-${label}`, rank: index + 2, label, suit })),
  );
}

// Находит следующего участника по кругу, пропуская игроков без карт.
// Если активных соперников больше нет, возвращает исходное место.
function activePlayer(players: Player[], from: number, direction = 1): number {
  for (let distance = 1; distance <= players.length; distance += 1) {
    // Удвоение длины массива позволяет корректно взять остаток и при
    // движении против часовой стрелки, не получив отрицательный индекс.
    const id = (from + direction * distance + players.length * 2) % players.length;
    if (players[id].hand.length > 0) return id;
  }
  return from;
}

// Возврат разрешён обычным ролям не более двух раз; варвар исключён.
function canReturn(player: Player) {
  return player.role !== "barbarian" && player.returns < 2;
}

// boardgame.io ведёт текущий ход отдельно от игрового состояния.
// Обновляем обе величины, чтобы сервер и клиент показывали одного игрока.
function setCurrent(G: DurakState, events: { endTurn: (arg?: { next: PlayerID }) => void }, player: number) {
  G.current = player;
  events.endTurn({ next: String(player) });
}

// После раунда игроки добирают до своего лимита, начиная с атакующего;
// защищавшийся добирает последним, как принято в правилах игры.
function refillHands(G: DurakState, attacker: number, defender: number) {
  // Сначала задаём круговой порядок, затем переносим защищавшегося в конец.
  const drawOrder = G.players.map((_, offset) => (attacker + offset) % G.players.length);
  drawOrder.splice(drawOrder.indexOf(defender), 1);
  drawOrder.push(defender);
  for (const id of drawOrder) {
    const player = G.players[id];
    // Добираем по одной карте до личного лимита; при пустой колоде цикл
    // останавливается, поэтому остаток руки может быть меньше нормы.
    while (player.hand.length < handLimit(player) && G.deck.length > 0) {
      player.hand.push(G.deck.pop()!);
    }
    player.handCount = player.hand.length;
  }
  G.deckCount = G.deck.length;
}

// Синхронизирует счётчики, которые можно показывать соперникам,
// не раскрывая сами карты в их руках.
function updateCounts(G: DurakState) {
  for (const player of G.players) player.handCount = player.hand.length;
  G.deckCount = G.deck.length;
}

// Записывает действие в историю для игрового журнала на клиенте.
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

// Победа определяется только после исчерпания колоды: пока в ней есть
// карты, участник с пустой рукой ещё может получить карты при доборе.
function checkGameEnd(G: DurakState): boolean {
  // Пока колода не пуста, нулевой размер руки не означает окончательного
  // выхода: этот игрок может снова получить карты при доборе.
  if (G.deck.length !== 0) return false;
  const remaining = G.players.filter((player) => player.hand.length > 0);
  if (remaining.length <= 1) {
    G.phase = "ended";
    // Единственный оставшийся игрок считается проигравшим; если карт нет
    // ни у кого, фиксированного проигравшего нет.
    G.loser = remaining[0]?.id ?? null;
    if (G.loser !== null) G.current = G.loser;
    return true;
  }
  return false;
}

// Подкидывать могут только ближайшие активные места слева и справа
// от защищающегося. Паладин дополнительно запрещает подкидывать соседу
// по часовой стрелке, а уже пасовавший участник не ходит повторно.
function getEdgeThrowers(G: DurakState): number[] {
  const candidates = [
    activePlayer(G.players, G.defender, -1),
    activePlayer(G.players, G.defender, 1),
  ].filter((id, index, list) => list.indexOf(id) === index);
  const paladinNext = (G.defender + 1) % G.players.length;
  return candidates.filter((id) =>
    // Последовательно отсеиваем защитника, вышедших игроков, уже
    // действовавших участников и запрещённого Паладином соседа.
    id !== G.defender &&
    G.players[id].hand.length > 0 &&
    !G.throwInDone.includes(id) &&
    !(G.players[G.defender].role === "paladin" && id === paladinNext),
  );
}

// Передаёт ход следующему разрешённому подкидывающему либо возвращает
// управление защищающемуся для отбивания.
function moveToNextThrower(
  G: DurakState,
  events: { endTurn: (arg?: { next: PlayerID }) => void },
) {
  // Первый оставшийся кандидат — ближайшее активное место слева;
  // при отсутствии кандидатов право действия возвращается защитнику.
  const next = getEdgeThrowers(G)[0];
  if (next !== undefined) {
    G.phase = "throw-in";
    setCurrent(G, events, next);
  } else {
    G.phase = G.table.every(({ defense }) => defense) ? "defend-ready" : "defend";
    setCurrent(G, events, G.defender);
  }
}

// При переводе ищет следующего игрока, способного принять всю атаку:
// у игрока с картами их должно хватать, а игрок без карт должен иметь
// ещё не исчерпанный разрешённый возврат.
function getTransferTarget(G: DurakState, actor: number, attackCount: number) {
  for (let distance = 1; distance < G.players.length; distance += 1) {
    // Проверяем только следующих по часовой стрелке, не назначая
    // переводящего самого себя новым защитником.
    const targetId = (actor + distance) % G.players.length;
    const target = G.players[targetId];
    if (target.hand.length > 0 ? target.hand.length >= attackCount : canReturn(target)) {
      return targetId;
    }
  }
  return undefined;
}

// Обычная карта бьёт старшую карту той же масти; козырь бьёт некозырь.
// Роль «Реверс» меняет сравнение номиналов только внутри одной масти.
export function canBeatCard(attack: Card, defense: Card, role: DurakRole, trump: Suit) {
  if (defense.suit === attack.suit) {
    // Для Реверса козырь не меняет направление сравнения: в той же
    // масти разрешается только меньший ранг.
    return role === "reverse" ? defense.rank < attack.rank : defense.rank > attack.rank;
  }
  return defense.suit === trump && attack.suit !== trump;
}

// Перевод возможен до первого отбивания и только картой того же
// номинала, что уже лежит на столе.
export function canTransferCard(G: DurakState, actor: number, cardId: string) {
  // Перевод нельзя сделать после того, как на стол положена хотя бы одна
  // карта защиты: иначе уже начатая оборона переместилась бы к другому игроку.
  if (G.phase !== "defend" || actor !== G.defender || G.table.some((attack) => attack.defense)) return false;
  const player = G.players[actor];
  const card = player?.hand.find((item) => item.id === cardId);
  if (!card || !G.table.some((attack) => attack.card.rank === card.rank)) return false;
  const newAttackCount = G.table.length + 1;
  return newAttackCount <= 6 && getTransferTarget(G, actor, newAttackCount) !== undefined;
}

// Завершает раунд: успешную атаку отправляет в отбой, а взятые карты
// оставляет у защищавшегося. Затем добирает руки и готовит следующий ход.
function endRound(G: DurakState, wasTaken: boolean): boolean {
  if (!wasTaken) {
    // При успешной защите снимаем с поля обе стороны всех пар и отправляем
    // их в отбой; при взятии это делает сам ход takeCards.
    G.discard.push(...G.table.flatMap(({ card, defense }) => [card, ...(defense ? [defense] : [])]));
  }
  const previousAttacker = G.attacker;
  const previousDefender = G.defender;
  G.table = [];
  G.throwInDone = [];
  G.postDefenseThrowInUsed = false;
  // Запоминаем прежние места до смены ролей раунда: они нужны правилам
  // определения нового атакующего после добора.
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

// Проверяет данные конфигурации комнаты до начала партии, чтобы состав
// мест и роли не расходились с числом игроков boardgame.io.
function validateSetupData(setupData: DurakSetupData | undefined, numPlayers: number) {
  // Возвращаем сообщение об ошибке boardgame.io, а undefined означает,
  // что конфигурация комнаты прошла проверку.
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
  // Идентификатор игры используется LobbyClient при создании/поиске матчей.
  name: "durak",
  // Ограничения не позволяют создать матч с неподдерживаемым количеством мест.
  minPlayers: 2,
  maxPlayers: 6,
  validateSetupData,
  setup: ({ random }, setupData) => {
    // boardgame.io предоставляет генератор случайных чисел с сохранением
    // воспроизводимости состояния при синхронизации партии.
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
    // Раздаём по очереди отдельными проходами, чтобы порядок игроков
    // не влиял на правило лимита: Варвар получает ещё две карты.
    for (let pass = 0; pass < 8; pass += 1) {
      for (const player of players) {
        if (pass < handLimit(player)) player.hand.push(deck.pop()!);
      }
    }
    const trump = deck[0].suit;
    // Первым атакует игрок с самой младшей козырной картой на руке.
    const firstTrump = players
      .flatMap((player) => player.hand.filter((card) => card.suit === trump).map((card) => ({ id: player.id, rank: card.rank })))
      .sort((left, right) => left.rank - right.rank)[0];
    const attacker = firstTrump?.id ?? 0;
    // Начальные значения всех полей задаются явно: boardgame.io копирует
    // объект состояния при каждом ходе и ожидает полный согласованный state.
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
      // boardgame.io спрашивает порядок хода у этой функции; игра сама
      // задаёт current при переходах, поэтому next возвращает то же значение.
      first: ({ G }) => G.current,
      next: ({ G }) => G.current,
    },
  },
  moves: {
    // Атакующий выбирает одну или несколько карт одного номинала;
    // число карт ограничено рукой защищающегося и общим пределом в шесть.
    startAttack: ({ G, events, playerID }, cardIds: string[]) => {
      // Идентификатор клиента — строка; приводим его к числу для обращения
      // к массиву игроков и последующих сравнений.
      const actor = Number(playerID);
      const player = G.players[actor];
      if (G.phase !== "attack" || actor !== G.current || !player || !Array.isArray(cardIds) || cardIds.length === 0) return;
      const cards = cardIds.map((id) => player.hand.find((card) => card.id === id));
      // Сначала убеждаемся, что каждый ID принадлежит руке игрока,
      // а затем запрещаем повтор одного ID в присланном списке.
      if (cards.some((card) => !card) || new Set(cardIds).size !== cardIds.length) return;
      const selected = cards as Card[];
      if (selected.some((card) => card.rank !== selected[0].rank)) return;
      const defender = G.players[G.defender];
      const limit = Math.min(6, defender.hand.length);
      if (selected.length > limit) return;
      player.hand = player.hand.filter((card) => !cardIds.includes(card.id));
      // Из выбранных карт создаём отдельные атаки, чтобы для каждой можно
      // было независимо назначить карту защиты.
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

    // Подкидывание разрешает только номиналы, уже присутствующие на столе,
    // и не позволяет превысить число карт, которое должен отбить защитник.
    throwIn: ({ G, events, playerID }, cardIds: string[]) => {
      const actor = Number(playerID);
      if (G.phase !== "throw-in" || actor !== G.current || !Array.isArray(cardIds) || cardIds.length === 0) return;
      const player = G.players[actor];
      const cards = cardIds.map((id) => player?.hand.find((card) => card.id === id));
      if (cards.some((card) => !card) || new Set(cardIds).size !== cardIds.length) return;
      const selected = cards as Card[];
      const ranksOnTable = new Set(G.table.flatMap(({ card, defense }) =>
        // Подкинуть можно номинал любой карты на столе — как атаки,
        // так и уже положенной защиты.
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

    // Пас закрепляет отказ участника от подкидывания в этой атаке.
    passThrowIn: ({ G, events, playerID }) => {
      const actor = Number(playerID);
      if (G.phase !== "throw-in" || actor !== G.current) return;
      G.throwInDone.push(actor);
      addLogEntry(G, actor, "pass");
      moveToNextThrower(G, events);
    },

    // Защитник сам указывает пару «карта атаки — карта защиты»,
    // поэтому может выбирать порядок отбивания.
    defendWith: ({ G, events, playerID }, defenseId: string, attackId: string) => {
      const actor = Number(playerID);
      if (G.phase !== "defend" || actor !== G.defender || actor !== G.current) return;
      const player = G.players[actor];
      const attack = G.table.find(({ card, defense }) => card.id === attackId && !defense);
      const defense = player.hand.find((card) => card.id === defenseId);
      // Сервер повторно проверяет и наличие обеих карт, и законность пары:
      // клиентское состояние и кнопки нельзя считать доверенным источником.
      if (!attack || !defense || !canBeatCard(attack.card, defense, player.role, G.trump)) return;
      player.hand = player.hand.filter((card) => card.id !== defense.id);
      attack.defense = defense;
      addLogEntry(G, actor, "defense", [defense], undefined, attack.card);
      updateCounts(G);
      if (G.table.every((pair) => pair.defense)) {
        if (!G.postDefenseThrowInUsed) {
          // После полного отбивания даётся отдельное последнее окно
          // подкидывания; повторно оно уже не открывается.
          G.postDefenseThrowInUsed = true;
          G.throwInDone = [];
          moveToNextThrower(G, events);
        } else {
          G.phase = "defend-ready";
        }
      }
    },

    // До завершения раунда защитник может вернуть карту с пары в руку,
    // отменив собственное отбивание.
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

    // При успешном отбивании атакующий продолжает следующим раундом,
    // если партия ещё не закончилась.
    finishDefense: ({ G, events, playerID }) => {
      const actor = Number(playerID);
      if (G.phase !== "defend-ready" || actor !== G.defender || actor !== G.current) return;
      const ended = endRound(G, false);
      if (!ended) setCurrent(G, events, G.attacker);
    },

    // Взятие переносит со стола и атаки, и уже положенные защиты в руку.
    // Игрок без карт получает один возврат, если его роль это допускает.
    takeCards: ({ G, events, playerID }) => {
      const actor = Number(playerID);
      if (!["defend", "defend-ready"].includes(G.phase) || actor !== G.defender || actor !== G.current) return;
      const player = G.players[actor];
      const wasOut = player.hand.length === 0;
      // Флаг нужно запомнить до получения карт со стола: только так
      // отличаем возвращение вышедшего игрока от обычного взятия.
      addLogEntry(G, actor, "take", G.table.flatMap(({ card, defense }) => [card, ...(defense ? [defense] : [])]));
      player.hand.push(...G.table.flatMap(({ card, defense }) => [card, ...(defense ? [defense] : [])]));
      if (wasOut && canReturn(player)) player.returns += 1;
      const ended = endRound(G, true);
      if (!ended) setCurrent(G, events, G.attacker);
    },

    // Перевод добавляет совпадающую карту в атаку и назначает новым
    // защитником следующего игрока, способного принять её целиком.
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
      // Новое ограничение не может быть меньше уже лежащего числа карт
      // и не может превысить число карт в руке нового защитника / шести.
      G.maxAttackCards = Math.min(6, Math.max(target.hand.length, newAttackCount));
      G.throwInDone = [actor];
      updateCounts(G);
      moveToNextThrower(G, events);
    },

    // Способность вора раскрывает владельцу хода случайную часть руки
    // соперника. Само перемещение карты выполняется отдельным ходом.
    useThief: ({ G, playerID, random }, targetId: number) => {
      const actor = Number(playerID);
      const thief = G.players[actor];
      const target = G.players[targetId];
      if (G.phase !== "attack" || G.current !== actor || thief?.role !== "thief" || thief.thiefUses >= 3 || thief.thiefLastRound === G.round) return;
      if (!target || target.id === actor || target.hand.length <= 1) return;
      G.thiefOfferOwner = actor;
      G.thiefOfferTarget = targetId;
      G.thiefOffer = random.Shuffle(target.hand).slice(0, 3);
      // Сохраняем одну и ту же выборку для сервера и личного представления
      // владельца способности до выбора или отказа.
      G.thiefReveal = G.thiefOffer;
    },

    // Вор может выбрать только карту из предъявленного набора; у цели
    // после кражи должна остаться хотя бы одна карта.
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
      // Удаляем карту из руки цели и добавляем ту же карту в руку Вора;
      // отдельный индекс предотвращает создание копии карты.
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

    // Закрывает предложение вора без кражи и удаляет раскрытые карты.
    declineThief: ({ G, playerID }) => {
      const actor = Number(playerID);
      if (G.phase !== "attack" || G.current !== actor || G.thiefOfferOwner !== actor) return;
      G.thiefOffer = [];
      G.thiefReveal = [];
      G.thiefOfferOwner = null;
      G.thiefOfferTarget = null;
    },

    // Некромант возвращает карту только из шести последних карт отбоя;
    // использование способности ограничено количеством и частотой.
    useNecromancer: ({ G, playerID }, cardId: string) => {
      const actor = Number(playerID);
      const player = G.players[actor];
      if (G.phase !== "attack" || G.current !== actor || player?.role !== "necromancer" || player.necromancerUses >= 5 || player.necromancerLastRound === G.round) return;
      const eligible = G.discard.slice(-6);
      // Проверяем принадлежность карты именно последним шести, затем
      // удаляем её из отбоя и помещаем в руку.
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
    // Сервер хранит полные руки, но каждому клиенту показывает только
    // собственные карты. Колода и предложения вора также фильтруются,
    // чтобы скрытая информация не утекала через состояние партии.
    const ownPlayerId = playerID === null ? -1 : Number(playerID);
    const ownerCanSeeOffer = ownPlayerId === G.thiefOfferOwner;
    return {
      ...G,
      deck: [],
      players: G.players.map((player) => ({
        ...player,
        // Копируем объект игрока, но заменяем чужую руку пустым массивом;
        // публичный handCount при этом остаётся доступен интерфейсу.
        hand: player.id === ownPlayerId ? player.hand : [],
      })),
      thiefOffer: [],
      thiefReveal: ownerCanSeeOffer ? G.thiefReveal : [],
    };
  },
};

// Простейшая стратегия компьютерного места. Она возвращает имя хода
// и его аргументы; фактические проверки всё равно остаются на сервере.
export function chooseBotAction(G: DurakState, playerId: number): { move: string; args: unknown[] } | null {
  // Защита от запуска стратегии не для текущего участника и от обращения
  // к отсутствующему месту в некорректном состоянии.
  if (G.current !== playerId) return null;
  const player = G.players[playerId];
  if (!player) return null;
  if (G.phase === "attack") {
    // В атакующей фазе бот сначала применяет доступные способности,
    // и только затем выбирает обычную атаку.
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
    // Собираем карты по номиналу, чтобы выбрать допустимый комплект атаки.
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
      // Простая стратегия перебирает подходящие защиты и выбирает
      // карту с наименьшим рангом; если подходящей нет — берёт атаку.
      .filter((card) => canBeatCard(attack.card, card, player.role, G.trump))
      .sort((a, b) => a.rank - b.rank)[0];
    return defense
      ? { move: "defendWith", args: [defense.id, attack.card.id] }
      : { move: "takeCards", args: [] };
  }
  if (G.phase === "defend-ready") return { move: "finishDefense", args: [] };
  // В завершённой партии у бота нет дальнейших ходов.
  return null;
};
