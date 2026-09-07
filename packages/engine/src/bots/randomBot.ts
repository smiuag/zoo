import { getLegalActions } from '../engine';
import type { Bot } from './types';

// Bot mínimo: elige una acción legal al azar. Sirve para poder jugar
// partidas completas de principio a fin mientras no hay una IA real.
export const randomBot: Bot = {
  chooseAction(state, playerId) {
    const actions = getLegalActions(state, playerId);
    if (actions.length === 0) {
      return { type: 'endTurn' };
    }
    return actions[Math.floor(Math.random() * actions.length)];
  },
};
