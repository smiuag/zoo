import type { Action, GameState, Player } from '@zoo/engine';
import { findAnywhere } from './actionLabels';

// Helpers para agrupar `getLegalActions(...)` por la carta/casilla que el
// jugador pulsó. Todo se deriva de las acciones legales reales (nunca se
// reimplementa "puede pagarlo"/etc. aquí: si el motor no la ofrece, no
// aparece).

// Todas las variantes de "playCard" para UNA carta concreta de la mano.
// Normalmente es solo 1, pero puede haber varias si la propia carta
// necesita elegir un objetivo (Elefante, Araña, Flamenco).
export function playCardActionsFor(legalActions: Action[], cardInstanceId: string) {
  return legalActions.filter(
    (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard' && a.instanceId === cardInstanceId
  );
}

export function buyAnimalActionFor(legalActions: Action[], trackInstanceId: string) {
  return legalActions.find(
    (a): a is Extract<Action, { type: 'buyAnimal' }> => a.type === 'buyAnimal' && a.trackInstanceId === trackInstanceId
  );
}

export function buyCoinActionFor(legalActions: Action[], coinId: string) {
  return legalActions.find(
    (a): a is Extract<Action, { type: 'buyCoin' }> => a.type === 'buyCoin' && a.coinId === coinId
  );
}

// Descarte forzoso pendiente (Buitre/Mono/Hiena/Murciélago): si esta carta
// concreta de la mano es una de las que el visor puede elegir descartar
// ahora mismo, ver PendingDiscardDecision en el motor.
export function resolveDiscardActionFor(legalActions: Action[], cardInstanceId: string) {
  return legalActions.find(
    (a): a is Extract<Action, { type: 'resolveDiscard' }> =>
      a.type === 'resolveDiscard' && a.instanceId === cardInstanceId
  );
}

// Etiqueta corta para un objetivo (carta del mazo/mano/descarte/mercado),
// usada en el panel contextual de elección (Elefante, Araña).
export function targetLabel(state: GameState, player: Player, targetInstanceId: string): string {
  const card = findAnywhere(state, player, targetInstanceId);
  if (!card) return '?';
  const bits = [card.name];
  if (card.type === 'animal') bits.push(`${card.victoryPoints}PV`);
  if (card.marketCost) bits.push(`${card.marketCost} monedas`);
  return bits.join(' · ');
}
