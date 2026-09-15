import type { Action } from '../engine';
import { legalActionsForBot } from './actionPriority';
import type { Bot } from './types';

// Bot centrado solo en comprar animales: primero juega su mano entera (ley
// de todos los bots, ver actionPriority.ts — robar antes que cualquier otra
// carta), y solo entonces, en cuanto puede comprar uno del mercado, lo hace
// (elegido al azar entre los disponibles); si no puede comprar nada, juega
// cualquier carta que le quede al azar. Sirve para ver cómo se comporta la
// economía de compra de animales en aislado.
export const animalBuyerBot: Bot = {
  chooseAction(state, playerId) {
    const actions = legalActionsForBot(state, playerId);

    const buyActions = actions.filter((a): a is Extract<Action, { type: 'buyAnimal' }> => a.type === 'buyAnimal');
    if (buyActions.length > 0) {
      return buyActions[Math.floor(Math.random() * buyActions.length)];
    }

    const playActions = actions.filter(
      (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard'
    );
    if (playActions.length > 0) {
      return playActions[Math.floor(Math.random() * playActions.length)];
    }

    return { type: 'endTurn' };
  },
};
