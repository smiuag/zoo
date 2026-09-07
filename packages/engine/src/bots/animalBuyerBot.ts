import { getLegalActions, type Action } from '../engine';
import type { Bot } from './types';

// Bot centrado solo en comprar animales: en cuanto puede comprar uno del
// mercado lo hace (elegido al azar entre los disponibles); si no, juega
// cualquier otra carta al azar (necesario para conseguir monedas/efectos),
// sin comprar nunca empleados. Sirve para ver cómo se comporta la economía
// de compra de animales en aislado.
export const animalBuyerBot: Bot = {
  chooseAction(state, playerId) {
    const actions = getLegalActions(state, playerId);

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
