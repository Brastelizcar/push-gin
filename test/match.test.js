import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, cleanTurn } from '../src/logic/match.js';
import { seededRng } from '../src/logic/cards.js';
import { cs } from './helpers.js';

function started({ players = ['A', 'B', 'C'], turnTime = 0 } = {}) {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const m = new Match({ rng: seededRng(7), turnTime, now: clock.now });
  players.forEach((p) => m.addPlayer(p, `Jugador ${p}`));
  assert.equal(m.handle('A', 'start').ok, true);
  return { m, clock };
}

test('lobby: solo el anfitrión empieza, con 2+ jugadores; quien sale libera el cupo', () => {
  const m = new Match();
  m.addPlayer('A', 'Ana');
  assert.match(m.handle('A', 'start').error, /al menos 2/);
  m.addPlayer('B', 'Luis'); m.addPlayer('C', 'Sofía');
  assert.match(m.handle('B', 'start').error, /anfitrión/);
  m.leave('A');
  assert.equal(m.host, 'B');
  assert.equal(m.handle('B', 'start').ok, true);
  assert.equal(m.phase, 'playing');
  m.leave('C');
  assert.deepEqual(m.order, ['B', 'C']);              // en partida el asiento se conserva
  assert.equal(m.connected.has('C'), false);
});

test('conexión caída: se guarda el asiento con cuenta regresiva; al volver sigue igual', () => {
  const { m, clock } = started();
  m.drop('B', clock.now() + 60_000);
  clock.advance(15_000);
  let b = m.viewFor('A').players.find((p) => p.id === 'B');
  assert.deepEqual([b.connected, b.left, b.reconnectMsLeft], [false, false, 45_000]);
  m.handle('A', 'takeDiscard');
  m.handle('A', 'playTurn', { discard: m.lastDrawn });
  assert.equal(m.game.currentPlayer, 'B');             // la partida lo espera (su turno NO se juega solo)
  m.rejoin('B');
  b = m.viewFor('A').players.find((p) => p.id === 'B');
  assert.deepEqual([b.connected, b.left, b.reconnectMsLeft], [true, false, null]);
  assert.equal(m.handle('B', 'takeDiscard').ok, true);
});

test('conexión caída y no vuelve: la sala llama a leave y cuenta como abandonar', () => {
  const { m, clock } = started();
  m.drop('C', clock.now() + 60_000);
  m.leave('C');
  const c = m.viewFor('A').players.find((p) => p.id === 'C');
  assert.deepEqual([c.left, c.reconnectMsLeft], [true, null]);
  m.rejoin('C');                                       // aunque llegara tarde, sigue fuera
  assert.equal(m.connected.has('C'), false);
});

test('abandonar a media partida: sus turnos se juegan solos y ya no puede actuar', () => {
  const { m } = started();                             // A, B, C; empieza A
  const ev = m.leave('B');
  assert.deepEqual(ev, { type: 'left', by: 'B' });
  assert.equal(m.viewFor('A').players.find((p) => p.id === 'B').left, true);
  assert.match(m.handle('B', 'push').error, /Abandonaste/);
  m.handle('A', 'takeDiscard');
  m.handle('A', 'playTurn', { discard: m.lastDrawn });
  assert.equal(m.game.currentPlayer, 'C');             // el turno de B se jugó solo
  assert.equal(m.game.hands.B.length, 10);             // tomó el descarte y lo devolvió
});

test('abandonar: si el que abandona estaba en turno, su turno se juega al instante', () => {
  const { m } = started();
  m.leave('A');
  assert.equal(m.game.currentPlayer, 'B');
  assert.equal(m.host, 'B');                           // el anfitrión pasa al siguiente que sigue jugando
});

test('abandonar: si queda un solo jugador, la partida termina y él gana', () => {
  const { m } = started();
  m.leave('B');
  m.leave('C');
  assert.equal(m.phase, 'finished');
  const v = m.viewFor('A');
  assert.deepEqual(v.gameWinners, ['A']);
  assert.ok(v.roundScores);
  assert.equal(m.leave('A'), null);                    // ya terminó: no cambia nada
});

test('abandonar entre rondas: el anfitrión nuevo continúa y el que se fue sigue sin jugar', () => {
  const { m } = started({ players: ['A', 'B', 'C'] });
  m.game.hands.A = cs('K♣');                           // A gana la ronda al descartar su última carta
  m.handle('A', 'takeDiscard');
  m.game.hands.A = m.game.hands.A.slice(-1);
  m.handle('A', 'playTurn', { discard: m.game.hands.A[0].id });
  assert.equal(m.phase, 'roundOver');
  m.leave('B');                                        // la ronda 2 la empieza B
  assert.equal(m.handle('A', 'nextRound').ok, true);
  assert.equal(m.game.currentPlayer, 'C');             // el turno de B ya se jugó solo
  m.leave('A');
  assert.equal(m.phase, 'finished');                   // solo queda C
  assert.deepEqual(m.viewFor('C').gameWinners, ['C']);
});

test('handle: turnos, eventos y mensajes inválidos', () => {
  const { m } = started();
  assert.match(m.handle('B', 'takeDiscard').error, /turno/);
  assert.match(m.handle('A', 'playTurn', { discard: 5 }).error, /inválido/);
  assert.match(m.handle('A', 'volar').error, /inválido/);
  const push = m.handle('A', 'push');
  assert.deepEqual(push.event, { type: 'push', by: 'A', to: 'B' });
  const card = m.game.hands.A[0];
  const res = m.handle('A', 'playTurn', { discard: card.id });
  assert.deepEqual(res.event, { type: 'turn', by: 'A', planted: false, laid: 0, hooked: 0 });
  assert.equal(m.game.currentPlayer, 'B');
});

test('vista privada: tu mano completa, de los demás solo cuántas cartas', () => {
  const { m } = started();
  const v = m.viewFor('B', { code: '1234' });
  assert.equal(v.code, '1234');
  assert.deepEqual(v.hand, m.game.hands.B);
  assert.equal(v.hands, undefined);
  assert.ok(v.players.every((p) => p.cards === 10));
  assert.equal(v.turnMsLeft, null);                    // sin temporizador
});

test('temporizador: la vista dice cuánto queda y se reinicia con cada turno', () => {
  const { m, clock } = started({ turnTime: 30 });
  assert.equal(m.viewFor('A').turnMsLeft, 30_000);
  clock.advance(10_000);
  assert.equal(m.viewFor('A').turnMsLeft, 20_000);
  m.handle('A', 'takeDiscard');                        // tomar carta NO reinicia el reloj
  assert.equal(m.viewFor('A').turnMsLeft, 20_000);
  m.handle('A', 'playTurn', { discard: m.game.hands.A[0].id });
  assert.equal(m.viewFor('B').turnMsLeft, 30_000);     // turno nuevo: reloj completo
});

test('se acaba el tiempo antes de tomar carta: toma el descarte y lo devuelve (nada cambia)', () => {
  const { m, clock } = started({ turnTime: 30 });
  const top = m.game.discardTop, hand = [...m.game.hands.A];
  assert.equal(m.timeoutTurn(), null);                 // todavía no
  clock.advance(30_000);
  assert.deepEqual(m.timeoutTurn(), { type: 'timeout', by: 'A' });
  assert.equal(m.game.currentPlayer, 'B');
  assert.deepEqual(m.game.hands.A, hand);
  assert.equal(m.game.discardTop.id, top.id);
});

test('se acaba el tiempo después de tomar carta: descarta la que tomó', () => {
  const { m, clock } = started({ turnTime: 30 });
  m.handle('A', 'push');
  const drew = m.lastDrawn;
  clock.advance(31_000);
  m.timeoutTurn();
  assert.equal(m.game.discardTop.id, drew);
  assert.equal(m.game.hands.A.length, 10);
  assert.equal(m.game.currentPlayer, 'B');
});

test('se acaba el tiempo y la carta tomada ya no está: descarta la que más puntos vale', () => {
  const { m, clock } = started({ turnTime: 30 });
  m.handle('A', 'takeDiscard');
  m.game.hands.A = cs('3♣', 'K♦', 'A♠');               // (simula que la carta tomada ya no está)
  clock.advance(30_000);
  m.timeoutTurn();
  assert.equal(m.game.discardTop.rank, 'A');            // A = 15 puntos
});

test('fin de ronda y de partida: totales y ganadores', () => {
  const { m } = started({ players: ['A', 'B'] });
  for (let r = 0; r < 5; r++) {
    const g = m.game, first = g.currentPlayer, other = first === 'A' ? 'B' : 'A';
    g.hands[first] = cs('K♣'); g.hands[other] = cs('A♠'); g.phase = 'main';
    m.handle(first, 'discard', { cardId: g.hands[first][0].id });
    if (r < 4) { assert.equal(m.phase, 'roundOver'); assert.match(m.handle('B', 'nextRound').error, /anfitrión/); m.handle('A', 'nextRound'); }
  }
  assert.equal(m.phase, 'finished');
  assert.equal(m.totals.A + m.totals.B, 75);
  assert.equal(m.deadline, null);
  assert.ok(m.viewFor('A').gameWinners.length >= 1);
});

test('cleanTurn: limpia lo que manda el cliente', () => {
  assert.equal(cleanTurn(null), null);
  assert.equal(cleanTurn({ discard: 'x', plant: 'mal' }), null);
  assert.equal(cleanTurn({ discard: 'x', hooks: [{ meldId: '1', cardId: 'y' }] }), null);
  assert.deepEqual(cleanTurn({ discard: 'x', hooks: [{ meldId: 1, cardId: 'y', end: null }], extra: 1 }),
    { plant: [], melds: [], discard: 'x', hooks: [{ meldId: 1, cardId: 'y', end: undefined }] });
});
