import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSyncCode, formatSyncCode, SYNC_ALPHABET, SYNC_CODE_TTL_MS } from '../src/logic/sync.js';

test('código de sincronización: se escribe como sea y se normaliza', () => {
  assert.equal(normalizeSyncCode('ABCD-EFGH'), 'ABCDEFGH');
  assert.equal(normalizeSyncCode(' abcd efgh '), 'ABCDEFGH');
  assert.equal(normalizeSyncCode('ABCD-EFG'), null);           // corto
  assert.equal(normalizeSyncCode('ABCD-EFG0'), null);          // 0 no existe (se confunde con O)
  assert.equal(normalizeSyncCode('ABCD-EFGI'), null);          // I tampoco
  assert.equal(normalizeSyncCode(12345678), null);
  assert.equal(formatSyncCode('ABCDEFGH'), 'ABCD-EFGH');
});

test('el alfabeto no tiene caracteres ambiguos y el código vence en 10 minutos', () => {
  for (const ch of '01OIL') assert.equal(SYNC_ALPHABET.includes(ch), false);
  assert.equal(new Set(SYNC_ALPHABET).size, SYNC_ALPHABET.length);
  assert.equal(SYNC_CODE_TTL_MS, 600_000);
});
