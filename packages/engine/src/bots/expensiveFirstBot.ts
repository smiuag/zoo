import { getLegalActions, type Action } from '../engine';
import { getCard } from '../cards/registry';
import type { CardInstance, GameState, Player } from '../model/state';
import type { Bot } from './types';

// Bot con una estrategia deliberadamente distinta a heuristicBot (que
// prioriza ratio PV/coste, y por eso converge siempre en el mismo puñado
// de "mejores" especies baratas/medias): este prioriza SIEMPRE comprar la
// especie más CARA que se pueda pagar, sin mirar su PV. Solo cuando no hay
// nada que comprar decide qué jugar de la mano, y ahí prioriza las cartas
// que generan dinero (mejoran monedas o dan dinero extra de compra) para
// poder llegar antes a las compras caras. Sirve para comprobar si "casi
// nunca se compran las especies más caras" es un problema del juego o solo
// de cómo decide heuristicBot.

function findInHand(player: Player, instanceId: string): CardInstance | undefined {
  return player.hand.find((c) => c.instanceId === instanceId);
}
function findInTrack(state: GameState, instanceId: string): CardInstance | undefined {
  return state.animalTrack.find((c) => c.instanceId === instanceId);
}

const MONEY_GENERATING_EFFECTS = new Set([
  'upgradeCoin', // Tortuga: mejora 1 moneda
  'gainFlatBonusPurchasingPower', // León
  'gainBonusPurchasingPowerPerHabitatInHand', // Serpiente / Loro
  'gainAquaticOnlyBonusPurchasingPower', // Delfín (restringido a comprar acuáticos)
]);

function isMoneyGenerator(card: CardInstance): boolean {
  return card.effects.some((e) => MONEY_GENERATING_EFFECTS.has(e.type));
}

function scoreAction(state: GameState, player: Player, action: Action): number {
  switch (action.type) {
    case 'buyAnimal': {
      // Prioridad 1, sin excepciones: cuanto más cara, mejor. No mira PV ni
      // ratio: si te la puedes permitir, cómprala.
      const track = findInTrack(state, action.trackInstanceId);
      if (!track) return -Infinity;
      return 1000 + (track.marketCost ?? 0) * 10;
    }

    case 'buyCoin': {
      // Comprar una moneda mayor también es "generar dinero" para llegar
      // antes a la compra cara: por debajo de cualquier compra de animal,
      // por encima de jugar una carta cualquiera.
      const coin = getCard(action.coinId);
      return 250 + (coin.marketCost ?? 0);
    }

    case 'playCard': {
      // Prioridad 2: entre lo que se puede jugar de la mano, prioriza lo
      // que genera dinero (para poder pagar antes una compra cara), luego
      // cualquier otra cosa.
      const card = findInHand(player, action.instanceId);
      if (!card) return -Infinity;
      return isMoneyGenerator(card) ? 200 : 100;
    }

    case 'endTurn':
      return 10;
  }
  return 0;
}

const TIE_EPSILON = 1e-9;

export const expensiveFirstBot: Bot = {
  chooseAction(state, playerId) {
    const actions = getLegalActions(state, playerId);
    if (actions.length === 0) return { type: 'endTurn' };

    const player = state.players.find((p) => p.id === playerId);
    if (!player) return { type: 'endTurn' };

    let bestScore = -Infinity;
    for (const action of actions) {
      const score = scoreAction(state, player, action);
      if (score > bestScore) bestScore = score;
    }
    const bestActions = actions.filter((action) => scoreAction(state, player, action) >= bestScore - TIE_EPSILON);
    return bestActions[Math.floor(Math.random() * bestActions.length)];
  },
};
