import { describe, expect, it } from 'vitest';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../src/engine';
import { randomBot } from '../src/bots/randomBot';
import { scoreGame } from '../src/scoring';
import { buildStarterDeck } from './helpers';

const ROUNDS_PER_PLAYER = 15;

describe('simulación 4 jugadores (bots aleatorios)', () => {
  it('completa la partida sin errores y produce un resumen jugable', () => {
    const players = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({
      id,
      name: `Bot ${i + 1}`,
      deck: buildStarterDeck(),
    }));
    const state = createGame(players);

    const actionCounts: Record<string, number> = {};

    const targetTurn = state.turn + ROUNDS_PER_PLAYER * players.length;
    let guard = 0;
    while (state.turn < targetTurn && !state.gameOver && guard < 20000) {
      // Con un descarte pendiente (Buitre/Mono/Hiena/Murciélago), nadie más
      // tiene ninguna acción legal hasta que TODOS los afectados resuelvan
      // el suyo: aquí no hay UI, así que se resuelve solo con la misma
      // heurística que usaría un bot (ver autoResolvePendingDiscard).
      if (autoResolvePendingDiscard(state)) {
        actionCounts.resolveDiscard = (actionCounts.resolveDiscard ?? 0) + 1;
        guard += 1;
        continue;
      }
      const player = getActivePlayer(state);
      const action = randomBot.chooseAction(state, player.id);
      actionCounts[action.type] = (actionCounts[action.type] ?? 0) + 1;
      applyAction(state, player.id, action);
      guard += 1;
    }

    const scores = scoreGame(state);

    console.log('\n=== Simulación 4 jugadores ===');
    console.log(`Turnos totales jugados: ${state.turn - 1} (guard usado: ${guard})`);
    console.log('Recuento de acciones:', actionCounts);

    for (const player of state.players) {
      const all = [...player.deck, ...player.hand, ...player.discard];
      const counts = {
        coins: all.filter((c) => c.type === 'coin').length,
        animalsOwned: all.filter((c) => c.type === 'animal').length,
        distinctSpecies: new Set(all.filter((c) => c.type === 'animal').map((c) => c.species)).size,
        totalCards: all.length,
      };
      const score = scores.find((s) => s.playerId === player.id)!.score;
      console.log(`${player.name} (score=${score}):`, counts);
    }

    expect(state.gameOver || state.turn >= targetTurn).toBe(true);
    expect(scores).toHaveLength(4);
    expect(scores.every((s) => Number.isFinite(s.score))).toBe(true);
  });
});
