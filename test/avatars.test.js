import test from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_COUNT, isAvatar, randomAvatar, avatarFor } from '../src/logic/avatars.js';
import { Match } from '../src/logic/match.js';

test('avatares: 8 disponibles; al azar siempre uno válido; fijo por id', () => {
  assert.equal(AVATAR_COUNT, 8);
  assert.deepEqual([0, 1, 8, 9, 2.5, '3'].map(isAvatar), [false, true, true, false, false, false]);
  for (let i = 0; i < 50; i++) assert.ok(isAvatar(randomAvatar()));
  assert.equal(randomAvatar(() => 0), 1);
  assert.equal(randomAvatar(() => 0.999), 8);
  assert.equal(avatarFor('abc'), avatarFor('abc'));
  assert.ok(isAvatar(avatarFor('xyz')));
});

test('la vista de la partida lleva el avatar de cada jugador', () => {
  const m = new Match();
  m.addPlayer('A', 'Ana', null, 4);
  m.addPlayer('B', 'Luis');                       // sin avatar: uno fijo según su id
  const v = m.viewFor('A');
  assert.equal(v.players[0].avatar, 4);
  assert.equal(v.players[1].avatar, avatarFor('B'));
});
