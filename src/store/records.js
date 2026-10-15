import { recordKey, updateRecord, sanitizeRecord } from '../game/records.js';

// 紀錄存 localStorage；讀寫失敗時視為沒有紀錄，遊戲照常可玩。
const KEY = 'memory-match:records';

function readAll() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function getRecord(bankId, cardCount) {
  return sanitizeRecord(readAll()[recordKey(bankId, cardCount)]);
}

// 回傳 { record, newMoves, newTime }；寫入失敗時仍回傳這局的比較結果。
export function recordResult(bankId, cardCount, result) {
  const all = readAll();
  const key = recordKey(bankId, cardCount);
  const outcome = updateRecord(sanitizeRecord(all[key]), result);
  all[key] = outcome.record;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 存不了就算了 */
  }
  return outcome;
}
