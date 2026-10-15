import { sampleBanks } from '../data/samples.js';
import { buildDeck } from '../game/deck.js';
import { createGame, flip, resolve, needsResolve } from '../game/state.js';
import { rankPlayers } from '../game/rank.js';
import { formatTime } from '../game/layout.js';
import { loadSettings, saveSettings } from '../store/settings.js';
import { createBoard } from './board.js';
import { play, setSoundEnabled } from './audio.js';

const app = document.getElementById('app');
const MAX_PLAYERS = 6;
const MATCH_DELAY = 700;
const MISS_DELAY = 1100;

// 之後題庫改存 IndexedDB 時，只要換掉這個函式。
const loadBanks = () => sampleBanks;

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null));
  return el;
}

let cleanup = () => {};
function show(render) {
  cleanup();
  cleanup = () => {};
  app.replaceChildren();
  render();
}

// ---------------- 設定畫面 ----------------
function showSetup() {
  show(() => {
    const settings = loadSettings();
    const banks = loadBanks();
    let bank = banks.find((b) => b.id === settings.bankId) ?? banks[0];
    let playerCount = Math.min(settings.players.length, MAX_PLAYERS);
    const names = Array.from({ length: MAX_PLAYERS }, (_, i) => settings.players[i] ?? `玩家 ${i + 1}`);

    const hint = h('p', { class: 'hint', role: 'alert' });
    const startBtn = h('button', { class: 'primary start', type: 'button' }, '開始遊戲');
    const customInput = h('input', { type: 'number', id: 'custom', min: 2, step: 1, 'aria-label': '自選組數' });
    const nameBox = h('div', { class: 'names' });
    const bankSelect = h('select', { id: 'bank' }, banks.map((b) => h('option', { value: b.id }, `${b.name}（${b.pairs.length} 組）`)));
    bankSelect.value = bank.id;

    const radioGroup = (name, items, current, onChange, extraClass = '') =>
      h('div', { class: `choices ${extraClass}`.trim() }, items.map(([value, label]) => {
        const input = h('input', { type: 'radio', name, value, checked: String(current) === String(value) });
        input.addEventListener('change', () => onChange(value));
        return h('label', {}, input, label);
      }));

    let size = settings.size;
    const sizeGroup = radioGroup('size', [['4', '4×4（8 組）'], ['6', '6×6（18 組）'], ['custom', '自選']], size, (v) => { size = v; refresh(); });
    const playerGroup = radioGroup('players', Array.from({ length: MAX_PLAYERS }, (_, i) => [i + 1, `${i + 1} 人`]), playerCount, (v) => { playerCount = Number(v); refresh(); }, 'compact');
    customInput.value = settings.customPairs;
    customInput.addEventListener('input', refresh);
    const chain = h('input', { type: 'checkbox', id: 'chain', checked: settings.chainOnMatch });
    const sound = h('input', { type: 'checkbox', id: 'sound', checked: settings.sound });
    bankSelect.addEventListener('change', () => { bank = banks.find((b) => b.id === bankSelect.value); refresh(); });

    function pairCount() {
      return size === 'custom' ? Number(customInput.value) : Number(size) ** 2 / 2;
    }
    function refresh() {
      customInput.disabled = size !== 'custom';
      customInput.max = bank.pairs.length;
      nameBox.replaceChildren(...Array.from({ length: playerCount }, (_, i) => {
        const input = h('input', { type: 'text', value: names[i], maxlength: 12, 'aria-label': `第 ${i + 1} 位玩家名字` });
        input.addEventListener('input', () => { names[i] = input.value; });
        return input;
      }));
      const n = pairCount();
      let msg = '';
      if (!Number.isInteger(n) || n < 2) msg = '組數至少要 2 組。';
      else if (n > bank.pairs.length) msg = `這個題庫只有 ${bank.pairs.length} 組配對，請選較小的牌數。`;
      hint.textContent = msg;
      startBtn.disabled = msg !== '';
    }

    startBtn.addEventListener('click', () => {
      const players = names.slice(0, playerCount).map((n, i) => n.trim() || `玩家 ${i + 1}`);
      const next = { ...settings, bankId: bank.id, size, customPairs: Number(customInput.value) || settings.customPairs, players, chainOnMatch: chain.checked, sound: sound.checked };
      saveSettings(next);
      setSoundEnabled(next.sound);
      play('flip'); // 在使用者操作內啟動 AudioContext
      startGame(bank, pairCount(), players, next.chainOnMatch);
    });

    app.append(h('section', { class: 'setup' },
      h('h1', {}, '翻牌配對'),
      h('div', { class: 'field' }, h('label', { class: 'title', for: 'bank' }, '題庫'), bankSelect),
      h('fieldset', { class: 'field' }, h('legend', {}, '牌數'), sizeGroup,
        h('div', { class: 'inline', style: 'margin-top:10px' }, h('label', { for: 'custom' }, '自選組數：'), customInput)),
      h('fieldset', { class: 'field' }, h('legend', {}, '玩家人數'), playerGroup, h('div', { style: 'margin-top:10px' }, nameBox)),
      h('div', { class: 'field' },
        h('label', { class: 'inline' }, chain, '配對成功可再翻一次（多人時）'),
        h('label', { class: 'inline' }, sound, '音效')),
      hint, startBtn));
    refresh();
  });
}

// ---------------- 遊戲畫面 ----------------
function startGame(bank, pairs, players, chainOnMatch) {
  show(() => {
    let state = createGame({ cards: buildDeck(bank.pairs, pairs), players, chainOnMatch });
    let startedAt = null;
    let finalMs = 0;
    let timerId = null;
    let resolveId = null;
    let resultId = null;

    const moves = h('span', { class: 'stat' });
    const time = h('span', { class: 'stat' });
    const scores = h('div', { class: 'scores', 'aria-live': 'polite' });
    const soundBtn = h('button', { type: 'button' });
    const wrap = h('div', { class: 'board-wrap' });

    const elapsed = () => (startedAt == null ? 0 : (state.finished ? finalMs : performance.now() - startedAt));

    function renderHud() {
      moves.textContent = `步數 ${state.moves}`;
      time.textContent = `時間 ${formatTime(elapsed())}`;
      soundBtn.textContent = loadSettings().sound ? '🔊 音效開' : '🔇 音效關';
      if (state.players.length > 1) {
        scores.replaceChildren(...state.players.map((p, i) =>
          h('span', { class: `score${i === state.current && !state.finished ? ' turn' : ''}` },
            `${i === state.current && !state.finished ? '▶ ' : ''}${p.name}：${p.pairs} 組`)));
      }
    }

    app.append(
      h('div', { class: 'hud' },
        h('button', { type: 'button', onclick: showSetup }, '← 回設定'),
        moves, time, h('span', { class: 'spacer' }), soundBtn),
      state.players.length > 1 ? scores : null,
      wrap);

    soundBtn.addEventListener('click', () => {
      const s = loadSettings();
      s.sound = !s.sound;
      saveSettings(s);
      setSoundEnabled(s.sound);
      renderHud();
    });

    const board = createBoard(wrap, state.cards, (index) => {
      const next = flip(state, index);
      if (next === state) return;
      state = next;
      if (startedAt == null) {
        startedAt = performance.now();
        timerId = setInterval(renderHud, 250);
      }
      play('flip');
      board.update(state);
      renderHud();
      if (needsResolve(state)) {
        const willMatch = state.cards[state.flipped[0]].pairId === state.cards[state.flipped[1]].pairId;
        resolveId = setTimeout(doResolve, willMatch ? MATCH_DELAY : MISS_DELAY);
      }
    });

    function doResolve() {
      state = resolve(state);
      board.update(state);
      if (state.finished) {
        finalMs = performance.now() - startedAt;
        clearInterval(timerId);
        play('win');
      } else {
        play(state.lastResult);
      }
      renderHud();
      if (state.finished) resultId = setTimeout(showResult, 600);
    }

    function showResult() {
      const multi = state.players.length > 1;
      const body = multi
        ? h('ol', { class: 'ranking' }, rankPlayers(state.players).map((p) =>
            h('li', {}, h('span', {}, `第 ${p.rank} 名　${p.name}`), h('span', {}, `${p.pairs} 組`))))
        : h('ul', { class: 'ranking' },
            h('li', {}, h('span', {}, '步數'), h('span', {}, String(state.moves))),
            h('li', {}, h('span', {}, '時間'), h('span', {}, formatTime(finalMs))));
      const dialog = h('dialog', {},
        h('h2', {}, multi ? '🎉 遊戲結束' : '🎉 過關！'), body,
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'primary', type: 'button', onclick: () => startGame(bank, pairs, players, chainOnMatch) }, '再玩一次'),
          h('button', { type: 'button', onclick: showSetup }, '回設定')));
      app.append(dialog);
      dialog.showModal();
    }

    cleanup = () => {
      clearInterval(timerId);
      clearTimeout(resolveId);
      clearTimeout(resultId);
      board.destroy();
    };
    renderHud();
  });
}

setSoundEnabled(loadSettings().sound);
showSetup();
