import { shuffle } from './rng.js';

// pairs: [{ id, a: {type, value}, b: {type, value} }]
// 從題庫隨機抽 pairCount 組，每組產生兩張牌，再整副洗牌。
export function buildDeck(pairs, pairCount, rng = Math.random) {
  if (!Number.isInteger(pairCount) || pairCount < 1) {
    throw new RangeError('組數必須是正整數');
  }
  if (pairCount > pairs.length) {
    throw new RangeError(`題庫只有 ${pairs.length} 組配對，不足 ${pairCount} 組`);
  }
  const cards = [];
  for (const pair of shuffle(pairs, rng).slice(0, pairCount)) {
    cards.push({ pairId: pair.id, content: pair.a });
    cards.push({ pairId: pair.id, content: pair.b });
  }
  return shuffle(cards, rng).map((card, i) => ({ id: i, ...card }));
}
