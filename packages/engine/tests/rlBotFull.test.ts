import { describe, expect, it } from 'vitest';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, getLegalActions } from '../src/engine';
import { createRlBotFull, rlBotFull } from '../src/bots/rlBotFull';
import { createRandomWeights } from '../src/bots/rl/network';
import { FEATURE_DIM_FULL } from '../src/bots/rl/featuresFull';
import { buildStarterDeck } from './helpers';

describe('rlBotFull', () => {
  it('siempre devuelve una acción legal (greedy, temperature 0) en una partida de la edición completa', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }], { edition: 'full' });
    const bot = createRlBotFull({ weights: createRandomWeights(FEATURE_DIM_FULL, 8) });

    const action = bot.chooseAction(state, 'p1');
    expect(getLegalActions(state, 'p1')).toContainEqual(action);
  });

  it('siempre devuelve una acción legal con muestreo (temperature > 0)', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }], { edition: 'full' });
    const bot = createRlBotFull({ weights: createRandomWeights(FEATURE_DIM_FULL, 8), temperature: 1 });

    for (let i = 0; i < 20; i++) {
      const action = bot.chooseAction(state, 'p1');
      expect(getLegalActions(state, 'p1')).toContainEqual(action);
    }
  });

  it('juega una partida completa de 4 en la edición completa (mascotas/dinosaurios) sin lanzar errores', () => {
    const state = createGame(
      [
        { id: 'p1', name: 'Alice', deck: buildStarterDeck() },
        { id: 'p2', name: 'Bob', deck: buildStarterDeck() },
        { id: 'p3', name: 'Cass', deck: buildStarterDeck() },
        { id: 'p4', name: 'Dee', deck: buildStarterDeck() },
      ],
      { edition: 'full', maxRounds: 15 }
    );

    for (let i = 0; i < 800 && !state.gameOver; i++) {
      if (autoResolvePendingDiscard(state)) continue;
      const player = getActivePlayer(state);
      const action = rlBotFull.chooseAction(state, player.id);
      applyAction(state, player.id, action);
    }

    expect(state.gameOver).toBe(true);
  });

  it('no rompe si los pesos inyectados tienen una dimensión incompatible', () => {
    const state = createGame([{ id: 'p1', name: 'Alice', deck: buildStarterDeck() }], { edition: 'full' });
    const incompatibleWeights = createRandomWeights(FEATURE_DIM_FULL + 10, 4);
    const bot = createRlBotFull({ weights: incompatibleWeights });

    const action = bot.chooseAction(state, 'p1');
    expect(getLegalActions(state, 'p1')).toContainEqual(action);
  });
});
