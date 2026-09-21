import { getCard } from '../../cards/registry';
import { effectiveMarketCost, type Action } from '../../engine';
import type { CardInstance, GameState, Player } from '../../model/state';
import { previewScoreDelta, scoreCollection } from '../../scoring';
import { computeMarketScarcityFull } from './marketScarcityFull';

// Codificador de features para la edición COMPLETA (mascotas y dinosaurios,
// 2026-09-21): copia deliberada de features.ts, NUNCA una versión
// parametrizada del mismo — el riesgo de tocar features.ts es que cualquier
// cambio en la forma/orden de sus columnas invalida en silencio los pesos ya
// entrenados de los bots CLÁSICOS (weights.json/-land/-bird/-aquatic, ver
// rlBot.ts), que son los que juega la web publicada. Este archivo es libre
// de crecer/cambiar sin ese riesgo: solo lo consume el entrenamiento/bot de
// la edición completa (ver rlBotFull.ts y RL_EDITION en scripts/rl/
// trainCore.ts), que empieza desde pesos propios sin nada que migrar.
//
// Diferencias respecto a features.ts:
//   - HABITATS incluye también 'pet' y 'dinosaur' (no solo los 3 básicos):
//     sin esto la red no podría distinguir "esto es un dinosaurio" de nada,
//     que es justo de lo que dependen Diplodocus/Plesiosaurio/Pteranodon
//     (coste dinámico, bonus restringido) y la Oca (PV por mascota distinta).
//   - EFFECT_TYPES incluye también los 10 tipos de efecto que faltaban:
//     mayStayOnTable y eachOpponentDestroysAnimalFromHand (existían desde
//     2026-09-20 — Perro; Mosasaurio/Terodáctilo/Tiranosaurio — pero nunca
//     se habían añadido aquí, mismo bug de la Araña de 2026-09-13, hallado
//     al auditar esta lista contra TODAS las cartas a petición del usuario)
//     y los 8 específicos de las cartas nuevas de esta sesión.
//   - encodePlayerContext añade aquaticBonusPurchasingPowerThisTurn Y
//     dinosaurBonusPurchasingPowerThisTurn (ninguna de las dos estaba en
//     features.ts tampoco: el Delfín ya sufría este mismo punto ciego).
//   - encodeCardBlock, para una compra de mercado (buyAnimal), usa el coste
//     REAL que se pagaría ahora mismo (effectiveMarketCost, con el
//     descuento por dinosaurios ya jugados este turno) en vez del marketCost
//     de catálogo — si no, un Diplodocus a mitad de precio seguiría
//     pareciéndole "de 15" a la red.
//   - secondaryTargetCard también busca en el propio mazo (y su descarte,
//     por si hubo que rebarajar a mitad) del jugador, no solo en el
//     mercado: lo necesita la Nutria (discardCoinMinValueToPeekAndKeep),
//     cuyo objetivo secundario es una de las cartas que se mirarían encima
//     de tu propio mazo, no un animal del escaparate.
export const FEATURE_DIM_FULL = 121;
export const LIVE_DELTA_INDEX_FULL = 96;
export const CRITIC_FEATURE_DIM_FULL = 43;

const HABITATS = ['land', 'bird', 'aquatic', 'pet', 'dinosaur'] as const;
const ACTION_TYPES = ['playCard', 'buyAnimal', 'buyCoin', 'endTurn'] as const;

// Mismos 31 tipos que EFFECT_TYPES en features.ts (ver ese archivo para el
// porqué de cada uno), más los 10 añadidos aquí abajo (41 en total).
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
  'discardFromEachOpponentAndDrawPerCoin',
  'drawTopUnlessExpensiveAnimal',
  'gainAquaticOnlyBonusPurchasingPower',
  'gainBonusPurchasingPowerPerDistinctSpeciesInHand',
  'gainCoin',
  'retrieveAnimalFromDiscard',
  'returnAnimalFromEachOpponent',
  'returnFromDiscardEachTurn',
  'scorePerCostAtLeast',
  'scorePerDestroyedCard',
  'gainBonusPurchasingPowerPerCoinInHand',
  'retrieveCoinFromDiscard',
  'scorePerCoinCard',
  'discardAnimalFromEachPlayerThenUseAbility',
  // Edición completa (2026-09-21): mayStayOnTable y eachOpponentDestroys
  // AnimalFromHand ya existían desde el 2026-09-20 (Perro; Mosasaurio/
  // Terodáctilo/Tiranosaurio) pero nunca se habían añadido a ningún
  // EFFECT_TYPES — mismo bug de la Araña de 2026-09-13, encontrado al
  // auditar esta lista a petición del usuario. El resto son de las cartas
  // nuevas de esta sesión.
  'mayStayOnTable',
  'eachOpponentDestroysAnimalFromHand',
  'returnAllFromDiscard',
  'discardCoinMinValueToDrawCards',
  'discardCoinMinValueToPeekAndKeep',
  'discardCoinToCapture',
  'exchangeCoinForFixed',
  'drawOrReturnSelfForSpecies',
  'gainDinosaurOnlyBonusPurchasingPower',
  'scorePerDistinctSpeciesWithHabitat',
] as const;

const MAX_OPPONENTS = 3;

function fullCollection(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn, ...(player.table ?? [])];
}

function habitatCounts(cards: CardInstance[]): number[] {
  return HABITATS.map((h) => cards.filter((c) => c.type === 'animal' && c.habitats?.includes(h)).length);
}

function distinctSpeciesCount(cards: CardInstance[]): number {
  return new Set(cards.filter((c) => c.type === 'animal').map((c) => c.species)).size;
}

function costTierCounts(cards: CardInstance[]): number[] {
  const animals = cards.filter((c) => c.type === 'animal');
  const cheap = animals.filter((c) => c.marketCost <= 2).length;
  const mid = animals.filter((c) => c.marketCost >= 3 && c.marketCost <= 4).length;
  const expensive = animals.filter((c) => c.marketCost >= 5).length;
  return [cheap, mid, expensive];
}

function coinCardCount(cards: CardInstance[]): number {
  return cards.filter((c) => c.type === 'coin').length;
}

export function encodePlayerContext(state: GameState, player: Player): number[] {
  const own = fullCollection(player);
  const coinSum = player.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0);
  const emptyDecks = Object.entries(state.sharedDecks).filter(
    ([species, deck]) => species !== 'sloth' && deck.length === 0
  ).length;
  const rawVictoryPoints = own.reduce((sum, c) => sum + c.victoryPoints, 0);

  const hasRoundLimit = state.maxRounds !== null ? 1 : 0;
  const roundProgress = state.maxRounds !== null ? Math.min(1, state.round / state.maxRounds) : 0;

  const marketScarcity = computeMarketScarcityFull(state);

  const context = [
    state.turn / 50,
    player.hand.length / 10,
    player.deck.length / 40,
    player.discard.length / 40,
    player.bonusPurchasingPowerThisTurn / 5,
    // Nuevo respecto a features.ts (clásica): ninguna de las dos bolsas de
    // valor de compra restringido (Delfín/Foca en acuático, Diplodocus en
    // dinosaurio) era visible para la red hasta ahora.
    player.aquaticBonusPurchasingPowerThisTurn / 5,
    player.dinosaurBonusPurchasingPowerThisTurn / 5,
    coinSum / 10,
    rawVictoryPoints / 40,
    ...habitatCounts(own).map((n) => n / 15),
    distinctSpeciesCount(own) / 27,
    ...costTierCounts(own).map((n) => n / 15),
    coinCardCount(own) / 15,
    emptyDecks / 5,
    state.finalRoundTriggerPlayerIndex !== null ? 1 : 0,
    hasRoundLimit,
    roundProgress,
    ...marketScarcity.habitat,
    ...marketScarcity.costTier,
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

// `costOverride`: solo para la carta protagonista de un buyAnimal (ver
// finishActionVector) — el coste REAL que se pagaría ahora mismo
// (effectiveMarketCost), no el de catálogo, para los dinosaurios con
// descuento dinámico. undefined para cualquier otro caso: se usa
// card.marketCost tal cual, igual que features.ts.
function encodeCardBlock(card: CardInstance | undefined, costOverride?: number): number[] {
  if (!card) return emptyCardBlock();
  const effectTypes = new Set(card.effects.map((e) => e.type));
  return [
    card.victoryPoints / 15,
    (costOverride ?? card.marketCost) / 10,
    (card.value ?? 0) / 3,
    ...HABITATS.map((h) => (card.habitats?.includes(h) ? 1 : 0)),
    ...EFFECT_TYPES.map((t) => (effectTypes.has(t) ? 1 : 0)),
  ];
}

function encodeTargetBlock(card: CardInstance | undefined): number[] {
  if (!card) return [0, 0, 0, 0, 0, 0, 0, 0];
  return [1, card.victoryPoints / 15, card.marketCost / 10, ...HABITATS.map((h) => (card.habitats?.includes(h) ? 1 : 0))];
}

function actionTypeOneHot(action: Action): number[] {
  return ACTION_TYPES.map((t) => (action.type === t ? 1 : 0));
}

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

function targetCard(state: GameState, player: Player, action: Action): CardInstance | undefined {
  if (action.type !== 'playCard' || !action.targetInstanceId) return undefined;
  return (
    state.animalTrack.find((c) => c.instanceId === action.targetInstanceId) ??
    player.hand.find((c) => c.instanceId === action.targetInstanceId) ??
    player.playedThisTurn.find((c) => c.instanceId === action.targetInstanceId) ??
    player.discard.find((c) => c.instanceId === action.targetInstanceId)
  );
}

// Igual que secondaryTargetCard en features.ts (Flamenco, Gallina: siempre
// del mercado), MÁS el propio mazo/descarte del jugador — lo necesita la
// Nutria (discardCoinMinValueToPeekAndKeep): su objetivo secundario es una
// de las cartas que estarían encima de tu propio mazo en este momento
// (simuladas en discardCoinToPeekTargetSpecs, engine.ts, sobre una copia del
// jugador — pero son las MISMAS instancias que siguen en tu player.deck de
// verdad hasta que de verdad juegues la carta), o en tu descarte si esa
// simulación tuvo que rebarajar a mitad.
function secondaryTargetCard(state: GameState, player: Player, action: Action): CardInstance | undefined {
  if (action.type !== 'playCard' || !action.secondaryTargetInstanceId) return undefined;
  return (
    state.animalTrack.find((c) => c.instanceId === action.secondaryTargetInstanceId) ??
    player.deck.find((c) => c.instanceId === action.secondaryTargetInstanceId) ??
    player.discard.find((c) => c.instanceId === action.secondaryTargetInstanceId)
  );
}

function topOfOwnDeck(player: Player): CardInstance | undefined {
  return player.deck[player.deck.length - 1];
}

interface DecisionBase {
  context: number[];
  baseScore: number;
}

function decisionBase(state: GameState, player: Player): DecisionBase {
  return {
    context: encodePlayerContext(state, player),
    baseScore: scoreCollection(player, fullCollection(player)),
  };
}

function liveScoreDelta(base: DecisionBase, state: GameState, player: Player, action: Action): number {
  if (action.type !== 'buyAnimal') return 0;
  const card = actingCard(state, player, action);
  if (!card) return 0;
  return previewScoreDelta(player, card, base.baseScore) / 20;
}

function finishActionVector(base: DecisionBase, state: GameState, player: Player, action: Action): number[] {
  const acting = actingCard(state, player, action);
  const costOverride = action.type === 'buyAnimal' && acting ? effectiveMarketCost(player, acting) : undefined;

  const features = [
    ...base.context,
    ...actionTypeOneHot(action),
    ...encodeCardBlock(acting, costOverride),
    liveScoreDelta(base, state, player, action),
    ...encodeTargetBlock(targetCard(state, player, action)),
    ...encodeTargetBlock(secondaryTargetCard(state, player, action)),
    ...encodeTargetBlock(topOfOwnDeck(player)),
  ];

  if (features.length >= FEATURE_DIM_FULL) return features.slice(0, FEATURE_DIM_FULL);
  return [...features, ...new Array(FEATURE_DIM_FULL - features.length).fill(0)];
}

export function encodeAction(state: GameState, playerId: string, action: Action): number[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return new Array(FEATURE_DIM_FULL).fill(0);
  return finishActionVector(decisionBase(state, player), state, player, action);
}

export function encodeActionsForPlayer(state: GameState, playerId: string, actions: Action[]): number[][] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return actions.map(() => new Array(FEATURE_DIM_FULL).fill(0));
  const base = decisionBase(state, player);
  return actions.map((action) => finishActionVector(base, state, player, action));
}
