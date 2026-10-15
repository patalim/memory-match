import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seededRng, shuffle } from '../src/game/rng.js';
import { buildDeck } from '../src/game/deck.js';
import { createGame, flip, resolve, canFlip, needsResolve, endPreview } from '../src/game/state.js';
import { rankPlayers } from '../src/game/rank.js';

const text = (value) => ({ type: 'text', value });
const makePairs = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, a: text(`a${i}`), b: text(`b${i}`) }));

// 固定牌面：0,1 配 p0；2,3 配 p1；4,5 配 p2
const fixedCards = () =>
  [0, 0, 1, 1, 2, 2].map((p, id) => ({ id, pairId: `p${p}`, content: text(String(id)) }));

const play = (state, ...indexes) => indexes.reduce((s, i) => flip(s, i), state);

test('shuffle：不改動原陣列、保留元素、固定種子可重現', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = shuffle(src, seededRng(42));
  const b = shuffle(src, seededRng(42));
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), src);
});

test('shuffle：各位置分佈大致均勻', () => {
  const rng = seededRng(7);
  const counts = [0, 0, 0];
  for (let n = 0; n < 6000; n++) counts[shuffle([0, 1, 2], rng).indexOf(0)]++;
  for (const c of counts) assert.ok(c > 1800 && c < 2200, `分佈偏離：${counts}`);
});

test('buildDeck：每組兩張、張數正確、id 連續', () => {
  const deck = buildDeck(makePairs(10), 8, seededRng(1));
  assert.equal(deck.length, 16);
  assert.deepEqual(deck.map((c) => c.id), [...Array(16).keys()]);
  const byPair = Map.groupBy(deck, (c) => c.pairId);
  assert.equal(byPair.size, 8);
  for (const cards of byPair.values()) assert.equal(cards.length, 2);
});

test('buildDeck：題庫較多時隨機抽選，不同種子抽到不同組', () => {
  const ids = (seed) => new Set(buildDeck(makePairs(20), 8, seededRng(seed)).map((c) => c.pairId));
  assert.notDeepEqual(ids(1), ids(2));
});

test('buildDeck：組數超過題庫或不合法會丟錯', () => {
  assert.throws(() => buildDeck(makePairs(3), 4), RangeError);
  assert.throws(() => buildDeck(makePairs(3), 0), RangeError);
  assert.throws(() => buildDeck(makePairs(3), 1.5), RangeError);
});

test('翻第一張：只翻開、不計步', () => {
  const s = flip(createGame({ cards: fixedCards() }), 0);
  assert.equal(s.cards[0].status, 'up');
  assert.equal(s.moves, 0);
  assert.equal(needsResolve(s), false);
});

test('翻兩張算一步，並停在待判定', () => {
  const s = play(createGame({ cards: fixedCards() }), 0, 1);
  assert.equal(s.moves, 1);
  assert.equal(needsResolve(s), true);
});

test('待判定時不能翻第三張；重複點同一張、已配對的牌也忽略', () => {
  const g = createGame({ cards: fixedCards() });
  const pending = play(g, 0, 2);
  assert.equal(canFlip(pending, 4), false);
  assert.equal(flip(pending, 4), pending);
  const once = flip(g, 0);
  assert.equal(flip(once, 0), once);
  const matched = resolve(play(g, 0, 1));
  assert.equal(flip(matched, 0), matched);
  assert.equal(flip(g, 99), g);
});

test('配對成功：計分、牌保持翻開、連續配對時不換人', () => {
  const s = resolve(play(createGame({ cards: fixedCards(), players: ['甲', '乙'] }), 0, 1));
  assert.equal(s.cards[0].status, 'matched');
  assert.equal(s.players[0].pairs, 1);
  assert.equal(s.current, 0);
  assert.equal(s.lastResult, 'match');
});

test('配對成功但關閉連續配對：換人', () => {
  const g = createGame({ cards: fixedCards(), players: ['甲', '乙'], chainOnMatch: false });
  const s = resolve(play(g, 0, 1));
  assert.equal(s.players[0].pairs, 1);
  assert.equal(s.current, 1);
});

test('配對失敗：蓋回、換人、不計分；輪回第一位', () => {
  let s = createGame({ cards: fixedCards(), players: ['甲', '乙'] });
  s = resolve(play(s, 0, 2));
  assert.equal(s.cards[0].status, 'down');
  assert.equal(s.current, 1);
  assert.equal(s.lastResult, 'miss');
  assert.equal(s.players[0].pairs + s.players[1].pairs, 0);
  s = resolve(play(s, 0, 2));
  assert.equal(s.current, 0);
});

test('單人配對失敗仍是同一人', () => {
  const s = resolve(play(createGame({ cards: fixedCards() }), 0, 2));
  assert.equal(s.current, 0);
});

test('resolve 在沒有待判定時原樣回傳', () => {
  const g = createGame({ cards: fixedCards() });
  assert.equal(resolve(g), g);
  const one = flip(g, 0);
  assert.equal(resolve(one), one);
});

test('全部配完：finished，最後一組不換人，之後不能再翻', () => {
  let s = createGame({ cards: fixedCards(), players: ['甲', '乙'], chainOnMatch: false });
  s = resolve(play(s, 0, 1)); // 甲得分，換乙
  s = resolve(play(s, 2, 3)); // 乙得分，換甲
  s = resolve(play(s, 4, 5)); // 甲得分，結束
  assert.equal(s.finished, true);
  assert.equal(s.current, 0);
  assert.deepEqual(s.players.map((p) => p.pairs), [2, 1]);
  assert.equal(s.moves, 3);
  assert.equal(canFlip(s, 0), false);
});

test('不改動傳入的狀態', () => {
  const g = createGame({ cards: fixedCards() });
  const snapshot = structuredClone(g);
  resolve(play(g, 0, 1));
  assert.deepEqual(g, snapshot);
});

test('createGame：牌數或玩家不合法會丟錯', () => {
  assert.throws(() => createGame({ cards: [] }), RangeError);
  assert.throws(() => createGame({ cards: fixedCards().slice(1) }), RangeError);
  assert.throws(() => createGame({ cards: fixedCards(), players: [] }), RangeError);
});

test('rankPlayers：同分並列、下一名跳號', () => {
  const r = rankPlayers([
    { name: '甲', pairs: 3 },
    { name: '乙', pairs: 5 },
    { name: '丙', pairs: 3 },
    { name: '丁', pairs: 1 },
  ]);
  assert.deepEqual(r.map((p) => [p.name, p.rank]), [['乙', 1], ['甲', 2], ['丙', 2], ['丁', 4]]);
});

test('rankPlayers：全部同分都是第 1 名', () => {
  const r = rankPlayers([{ name: 'a', pairs: 0 }, { name: 'b', pairs: 0 }]);
  assert.deepEqual(r.map((p) => p.rank), [1, 1]);
});

test('記憶時間：預覽期間不能翻牌，endPreview 後才能玩', () => {
  const g = createGame({ cards: fixedCards(), preview: true });
  assert.equal(g.previewing, true);
  assert.equal(canFlip(g, 0), false);
  assert.equal(flip(g, 0), g);
  const started = endPreview(g);
  assert.equal(started.previewing, false);
  assert.equal(canFlip(started, 0), true);
  assert.equal(started.moves, 0);
  assert.equal(g.previewing, true, '不改動原狀態');
});

test('記憶時間：預設關閉；沒有預覽時 endPreview 原樣回傳', () => {
  const g = createGame({ cards: fixedCards() });
  assert.equal(g.previewing, false);
  assert.equal(endPreview(g), g);
});
