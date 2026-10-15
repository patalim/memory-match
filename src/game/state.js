// 遊戲狀態：全部是純函式，回傳新狀態，不改動傳入的 state。
// 翻第二張後停在「待判定」（flipped.length === 2），由呼叫端在動畫結束後呼叫 resolve。
// 這樣規則裡沒有計時器，UI 想等多久都行。
// 記憶時間模式：preview 為 true 時牌先全部亮出（previewing），期間不能翻牌，由 UI 在倒數結束後呼叫 endPreview。

export function createGame({ cards, players = ['玩家 1'], chainOnMatch = true, preview = false }) {
  if (cards.length === 0 || cards.length % 2 !== 0) {
    throw new RangeError('牌數必須是正偶數');
  }
  if (players.length < 1) throw new RangeError('至少需要一位玩家');
  return {
    cards: cards.map((c) => ({ ...c, status: 'down' })), // down | up | matched
    players: players.map((name) => ({ name, pairs: 0 })),
    current: 0,
    flipped: [], // 目前翻開、尚未判定的牌 index
    moves: 0, // 步數：每翻兩張算一步
    chainOnMatch,
    lastResult: null, // 'match' | 'miss'，供音效用
    finished: false,
    previewing: preview,
  };
}

export function canFlip(state, index) {
  const card = state.cards[index];
  return !state.finished && !state.previewing && card !== undefined && card.status === 'down' && state.flipped.length < 2;
}

export function flip(state, index) {
  if (!canFlip(state, index)) return state;
  const cards = state.cards.map((c, i) => (i === index ? { ...c, status: 'up' } : c));
  const flipped = [...state.flipped, index];
  return {
    ...state,
    cards,
    flipped,
    moves: flipped.length === 2 ? state.moves + 1 : state.moves,
    lastResult: null,
  };
}

export function endPreview(state) {
  return state.previewing ? { ...state, previewing: false } : state;
}

export function needsResolve(state) {
  return state.flipped.length === 2;
}

export function resolve(state) {
  if (!needsResolve(state)) return state;
  const [i, j] = state.flipped;
  const matched = state.cards[i].pairId === state.cards[j].pairId;
  const status = matched ? 'matched' : 'down';
  const cards = state.cards.map((c, k) => (k === i || k === j ? { ...c, status } : c));
  const finished = cards.every((c) => c.status === 'matched');
  const players = matched
    ? state.players.map((p, k) => (k === state.current ? { ...p, pairs: p.pairs + 1 } : p))
    : state.players;
  const keepTurn = matched && state.chainOnMatch;
  return {
    ...state,
    cards,
    players,
    flipped: [],
    current: keepTurn || finished ? state.current : (state.current + 1) % state.players.length,
    lastResult: matched ? 'match' : 'miss',
    finished,
  };
}
