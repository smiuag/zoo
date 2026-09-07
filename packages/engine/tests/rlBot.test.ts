import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getActivePlayer, getLegalActions } from '../src/engine';
import { createRlBot, rlBot } from '../src/bots/rlBot';
import { createRandomWeights } from '../src/bots/rl/network';
import { FEATURE_DIM } from '../src/bots/rl/features';
import { buildStarterDeck } from './helpers';

describe('rlBot', () => {
  it('siempre devuelve una acción legal (greedy, temperature 0)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const bot = createRlBot({ weights: createRandomWeights(FEATURE_DIM, 8) });

    const action = bot.chooseAction(state, 'p1');
    expect(getLegalActions(state, 'p1')).toContainEqual(action);
  });

  it('siempre devuelve una acción legal con muestreo (temperature > 0)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    const bot = createRlBot({ weights: createRandomWeights(FEATURE_DIM, 8), temperature: 1 });

    for (let i = 0; i < 20; i++) {
      const action = bot.chooseAction(state, 'p1');
      expect(getLegalActions(state, 'p1')).toContainEqual(action);
    }
  });

  it('juega una partida completa entre dos rlBots (con los pesos por defecto) sin lanzar errores', () => {
    const state = createGame([
      { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
      { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
    ]);

    for (let i = 0; i < 200 && !state.gameOver; i++) {
      const player = getActivePlayer(state);
      const action = rlBot.chooseAction(state, player.id);
      applyAction(state, player.id, action);
    }

    expect(state.turn).toBeGreaterThan(1);
  });

  it('no rompe ni deja de devolver una acción legal si los pesos inyectados tienen una dimensión incompatible', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }]);
    // featureDim mayor que FEATURE_DIM: forward() leería posiciones fuera
    // del vector de entrada (undefined -> NaN) para cada unidad oculta.
    const incompatibleWeights = createRandomWeights(FEATURE_DIM + 10, 4);
    const bot = createRlBot({ weights: incompatibleWeights });

    const action = bot.chooseAction(state, 'p1');
    expect(getLegalActions(state, 'p1')).toContainEqual(action);
  });
});
