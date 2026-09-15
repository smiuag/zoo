import { legalActionsForBot } from './actionPriority';
import type { Bot } from './types';

// Bot mínimo: elige al azar entre las acciones que deja la ley de
// prioridad de todos los bots (ver actionPriority.ts: jugar antes que
// comprar, robar antes que cualquier otra carta). Sirve para poder jugar
// partidas completas de principio a fin mientras no hay una IA real.
export const randomBot: Bot = {
  chooseAction(state, playerId) {
    const actions = legalActionsForBot(state, playerId);
    if (actions.length === 0) {
      return { type: 'endTurn' };
    }
    return actions[Math.floor(Math.random() * actions.length)];
  },
};
