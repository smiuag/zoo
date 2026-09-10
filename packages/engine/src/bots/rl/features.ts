import { getCard } from '../../cards/registry';
import type { Action } from '../../engine';
import type { CardInstance, GameState, Player } from '../../model/state';

// Vector de entrada de la red del rlBot: longitud fija (se rellena con
// ceros si hace falta) para que la dimensión de los pesos entrenados nunca
// dependa del estado concreto de una partida. Si se añade un grupo de
// features nuevo hay que volver a entrenar (los pesos guardados asumen esta
// disposición exacta de columnas).
export const FEATURE_DIM = 64;

const HABITATS = ['land', 'bird', 'aquatic'] as const;
const ACTION_TYPES = ['playCard', 'buyAnimal', 'buyCoin', 'endTurn'] as const;

// Todos los "type" de efecto conocidos por el motor (ver
// effects/registry.ts): un hueco multi-hot por cada uno, para que la red
// pueda aprender su propio valor en vez de depender de la tabla de bonos a
// mano de heuristicBot.
const EFFECT_TYPES = [
  'drawCards',
  'discardFromEachOpponent',
  'chooseDiscardFromEachOpponent',
  'gainBonusPurchasingPowerPerSpeciesInDiscard',
  'drawThenTopdeck',
  'freeCaptureUpToCost',
  'upgradeCoin',
  'gainFlatBonusPurchasingPower',
  'gainBonusPurchasingPowerPerHabitatInHand',
  'discardAnimalFromEachOpponent',
  'stealCoinFromChosenPlayer',
  'returnAnimalForUpgrade',
  'scorePerHabitatCount',
  'scorePerDistinctSpecies',
  'scoreBonusIfSpeciesCountAtLeast',
  'destroyWeakestNonFlyingOnScore',
  'swapSelfWithTopOfDeck',
] as const;

const MAX_OPPONENTS = 3;

function fullCollection(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard];
}

function habitatCounts(cards: CardInstance[]): number[] {
  return HABITATS.map((h) => cards.filter((c) => c.type === 'animal' && c.habitats?.includes(h)).length);
}

function distinctSpeciesCount(cards: CardInstance[]): number {
  return new Set(cards.filter((c) => c.type === 'animal').map((c) => c.species)).size;
}

// Contexto propio del jugador que decide, más lo único que se puede saber
// legítimamente de cada rival: el tamaño de su mano (nunca su contenido) y
// su descarte entero (boca arriba, es información pública).
function encodePlayerContext(state: GameState, player: Player): number[] {
  const own = fullCollection(player);
  const coinSum = player.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0);
  // "sloth" es la reserva de la Jirafa (ver createGame en engine.ts), no
  // una especie de mercado: se excluye para que este contador siga
  // reflejando solo la escasez real del mercado (mismo criterio que
  // checkFinalRoundTrigger). El Conejo sí es una especie de mercado normal
  // (su propio sharedDecks['rabbit']) y cuenta como cualquier otra.
  const emptyDecks = Object.entries(state.sharedDecks).filter(
    ([species, deck]) => species !== 'sloth' && deck.length === 0
  ).length;
  // OJO: nunca usar scorePlayer() aquí. Tiene un efecto secundario
  // destructivo (el Cocodrilo elimina una carta acuática cada vez que se
  // llama, pensado para resolverse una única vez al terminar la partida) y
  // encodeAction se invoca en cada decisión, no solo al final: usar
  // scorePlayer() corrompería la mano/mazo/descarte del jugador en mitad de
  // la partida. Basta una suma de PV en bruto, sin resolver efectos.
  const rawVictoryPoints = own.reduce((sum, c) => sum + c.victoryPoints, 0);

  const context = [
    state.turn / 50,
    player.hand.length / 10,
    player.deck.length / 40,
    player.discard.length / 40,
    player.bonusPurchasingPowerThisTurn / 5,
    coinSum / 10,
    rawVictoryPoints / 40,
    ...habitatCounts(own).map((n) => n / 15),
    distinctSpeciesCount(own) / 27,
    emptyDecks / 5,
    state.finalRoundTriggerPlayerIndex !== null ? 1 : 0,
  ];

  const opponents = state.players.filter((p) => p.id !== player.id);
  for (let i = 0; i < MAX_OPPONENTS; i++) {
    const opponent = opponents[i];
    if (!opponent) {
      context.push(0, 0, 0, 0);
      continue;
    }
    const discardVp = opponent.discard.reduce((sum, c) => sum + c.victoryPoints, 0);
    context.push(
      opponent.hand.length / 10,
      opponent.discard.length / 40,
      discardVp / 20,
      distinctSpeciesCount(opponent.discard) / 27
    );
  }

  return context;
}

function emptyCardBlock(): number[] {
  return [0, 0, 0, ...HABITATS.map(() => 0), ...EFFECT_TYPES.map(() => 0)];
}

function encodeCardBlock(card: CardInstance | undefined): number[] {
  if (!card) return emptyCardBlock();
  const effectTypes = new Set(card.effects.map((e) => e.type));
  return [
    card.victoryPoints / 15,
    card.marketCost / 10,
    (card.value ?? 0) / 3,
    ...HABITATS.map((h) => (card.habitats?.includes(h) ? 1 : 0)),
    ...EFFECT_TYPES.map((t) => (effectTypes.has(t) ? 1 : 0)),
  ];
}

function encodeTargetBlock(card: CardInstance | undefined): number[] {
  if (!card) return [0, 0, 0, 0, 0, 0];
  return [1, card.victoryPoints / 15, card.marketCost / 10, ...HABITATS.map((h) => (card.habitats?.includes(h) ? 1 : 0))];
}

function actionTypeOneHot(action: Action): number[] {
  return ACTION_TYPES.map((t) => (action.type === t ? 1 : 0));
}

// La carta "protagonista" de la acción: la que se juega de la mano, el
// animal del mercado que se compra, o la moneda que se compra. `endTurn` no
// tiene ninguna.
function actingCard(state: GameState, player: Player, action: Action): CardInstance | undefined {
  switch (action.type) {
    case 'playCard':
      return player.hand.find((c) => c.instanceId === action.instanceId);
    case 'buyAnimal':
      return state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
    case 'buyCoin':
      return { ...getCard(action.coinId), instanceId: action.coinId };
    case 'endTurn':
      return undefined;
  }
}

// Solo relevante para las acciones "playCard" con targetInstanceId (Elefante
// / Araña eligiendo qué capturar gratis, Flamenco eligiendo qué devolver):
// el objetivo puede estar en el mercado o en la propia mano/descarte.
function targetCard(state: GameState, player: Player, action: Action): CardInstance | undefined {
  if (action.type !== 'playCard' || !action.targetInstanceId) return undefined;
  return (
    state.animalTrack.find((c) => c.instanceId === action.targetInstanceId) ??
    player.hand.find((c) => c.instanceId === action.targetInstanceId) ??
    player.discard.find((c) => c.instanceId === action.targetInstanceId)
  );
}

// Encima del propio mazo (boca abajo, pero el jugador SÍ conoce esa carta:
// es él quien la puso ahí, ya sea al robar/barajar o con un efecto de
// alguna carta). Se mantiene en el vector aunque ninguna carta actual mire
// "lo que hay encima de mi mazo" (el Murciélago, que sí lo hacía, ya no):
// FEATURE_DIM es fijo y los pesos entrenados asumen esta disposición de
// columnas, así que no se puede quitar sin invalidar el modelo guardado.
function topOfOwnDeck(player: Player): CardInstance | undefined {
  return player.deck[player.deck.length - 1];
}

export function encodeAction(state: GameState, playerId: string, action: Action): number[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return new Array(FEATURE_DIM).fill(0);

  const features = [
    ...encodePlayerContext(state, player),
    ...actionTypeOneHot(action),
    ...encodeCardBlock(actingCard(state, player, action)),
    ...encodeTargetBlock(targetCard(state, player, action)),
    ...encodeTargetBlock(topOfOwnDeck(player)),
  ];

  if (features.length >= FEATURE_DIM) return features.slice(0, FEATURE_DIM);
  return [...features, ...new Array(FEATURE_DIM - features.length).fill(0)];
}
