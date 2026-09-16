// Copia CONGELADA de src/bots/rl/features.ts tal y como estaba justo antes
// del bump de escasez de mercado / coinCardCount del 2026-09-16 (FEATURE_DIM
// pasó de 86 a 96 en ese cambio). Solo la usa sixPlayerMatch.ts, para poder
// seguir puntuando los pesos de pre_marketscarcity_backup/ con el vector de
// entrada que realmente vieron durante su entrenamiento, mientras los pesos
// nuevos usan el features.ts actual (96 dims).
// NUNCA editar este fichero para que siga una mejora futura: si vuelve a
// hacer falta comparar contra una generación más vieja, se congela una
// nueva copia con su propio nombre (legacyFeaturesNN.ts) en su momento (ver
// legacyFeatures64.ts, mismo patrón).
import { getCard } from '../../src/cards/registry';
import type { Action } from '../../src/engine';
import type { CardInstance, GameState, Player } from '../../src/model/state';

export const LEGACY_FEATURE_DIM_86 = 86;

const HABITATS = ['land', 'bird', 'aquatic'] as const;
const ACTION_TYPES = ['playCard', 'buyAnimal', 'buyCoin', 'endTurn'] as const;

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
] as const;

const MAX_OPPONENTS = 3;

function fullCollection(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn];
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

export function legacyEncodePlayerContext86(state: GameState, player: Player): number[] {
  const own = fullCollection(player);
  const coinSum = player.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0);
  const emptyDecks = Object.entries(state.sharedDecks).filter(
    ([species, deck]) => species !== 'sloth' && deck.length === 0
  ).length;
  const rawVictoryPoints = own.reduce((sum, c) => sum + c.victoryPoints, 0);

  const hasRoundLimit = state.maxRounds !== null ? 1 : 0;
  const roundProgress = state.maxRounds !== null ? Math.min(1, state.round / state.maxRounds) : 0;

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
    ...costTierCounts(own).map((n) => n / 15),
    emptyDecks / 5,
    state.finalRoundTriggerPlayerIndex !== null ? 1 : 0,
    hasRoundLimit,
    roundProgress,
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

function secondaryTargetCard(state: GameState, action: Action): CardInstance | undefined {
  if (action.type !== 'playCard' || !action.secondaryTargetInstanceId) return undefined;
  return state.animalTrack.find((c) => c.instanceId === action.secondaryTargetInstanceId);
}

function topOfOwnDeck(player: Player): CardInstance | undefined {
  return player.deck[player.deck.length - 1];
}

export function legacyEncodeAction86(state: GameState, playerId: string, action: Action): number[] {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return new Array(LEGACY_FEATURE_DIM_86).fill(0);

  const features = [
    ...legacyEncodePlayerContext86(state, player),
    ...actionTypeOneHot(action),
    ...encodeCardBlock(actingCard(state, player, action)),
    ...encodeTargetBlock(targetCard(state, player, action)),
    ...encodeTargetBlock(secondaryTargetCard(state, action)),
    ...encodeTargetBlock(topOfOwnDeck(player)),
  ];

  if (features.length >= LEGACY_FEATURE_DIM_86) return features.slice(0, LEGACY_FEATURE_DIM_86);
  return [...features, ...new Array(LEGACY_FEATURE_DIM_86 - features.length).fill(0)];
}
