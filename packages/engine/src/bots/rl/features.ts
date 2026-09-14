import { getCard } from '../../cards/registry';
import type { Action } from '../../engine';
import type { CardInstance, GameState, Player } from '../../model/state';

// Vector de entrada de la red del rlBot: longitud fija (se rellena con
// ceros si hace falta) para que la dimensión de los pesos entrenados nunca
// dependa del estado concreto de una partida. Si se añade un grupo de
// features nuevo hay que volver a entrenar (los pesos guardados asumen esta
// disposición exacta de columnas).
// 2026-09-14: subido de 81 a 84 al añadir costTierCounts (3 columnas) a
// encodePlayerContext, de 84 a 85 al añadir 'scorePerDestroyedCard' a
// EFFECT_TYPES (Tiburón/Halcón/León), y de 85 a 86 al añadir
// 'gainBonusPurchasingPowerPerCoinInHand' (nueva habilidad del Murciélago)
// — invalida cualquier weights*.json guardado con la disposición anterior
// (loadOrInitWeights/loadWeightsFromJson lo detectan por featureDim y
// reinician desde pesos aleatorios en vez de romper).
export const FEATURE_DIM = 86;

// Longitud de encodePlayerContext (más abajo) SOLA, sin nada de acción:
// la usa el "crítico" del entrenamiento (ver scripts/rl/selfPlay.ts) para
// estimar el retorno esperado desde un estado, no desde una acción
// concreta — dos redes separadas, dos dimensiones separadas (esta es
// mucho más pequeña que FEATURE_DIM porque no lleva ningún bloque de
// carta). Verificado por un test que compara con la longitud real
// devuelta por encodePlayerContext (ver rlFeatures.test.ts) — si cambia
// esa función hay que actualizar esto también.
export const CRITIC_FEATURE_DIM = 30;

const HABITATS = ['land', 'bird', 'aquatic'] as const;
const ACTION_TYPES = ['playCard', 'buyAnimal', 'buyCoin', 'endTurn'] as const;

// Todos los "type" de efecto conocidos por el motor (ver
// effects/registry.ts): un hueco multi-hot por cada uno, para que la red
// pueda aprender su propio valor en vez de depender de la tabla de bonos a
// mano de heuristicBot. Los 8 primeros (hasta 'swapSelfWithTopOfDeck') ya
// no los usa NINGUNA carta actual (renombrados/retirados en rebalances
// pasados) — se dejan tal cual, sin reordenar, para no desplazar el resto
// de columnas (invalidaría los pesos guardados sin necesidad). Los 9
// últimos se añadieron el 2026-09-13 al descubrir, investigando por qué
// la Araña salía tan mal puntuada, que NINGUNA carta con estos tipos de
// efecto (añadidos/renombrados en los rebalances de esta misma sesión:
// delfín/foca, mono/serpiente, pingüino, ardilla, tucán...) estaba
// representada aquí — la red no podía distinguirlas de un animal sin
// ningún efecto, solo por coste/PV/hábitat (confirmado con
// scripts/rl/scoreSpider.ts: Foca y Ornitorrinco, con efectos distintos,
// puntuaban EXACTAMENTE igual). Cualquier tipo de efecto nuevo que se
// añada a partir de ahora debe añadirse aquí también, o vuelve a pasar.
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

// Incluye playedThisTurn: lo jugado este turno todavía no está en el
// descarte de verdad (sigue "en el limbo" hasta terminar el turno, ver
// playCard/endTurn en engine.ts), pero sigue siendo del jugador.
function fullCollection(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn];
}

function habitatCounts(cards: CardInstance[]): number[] {
  return HABITATS.map((h) => cards.filter((c) => c.type === 'animal' && c.habitats?.includes(h)).length);
}

function distinctSpeciesCount(cards: CardInstance[]): number {
  return new Set(cards.filter((c) => c.type === 'animal').map((c) => c.species)).size;
}

// Recuento de animales propios por franja de coste (misma frontera que ya
// usa scripts/rl/cardPreference.ts para informar: barato <=2, medio 3-4,
// caro 5+). Añadido el 2026-09-14 al confirmar que cartas con un efecto
// onScore que depende de ESTE recuento (p. ej. Tucán: +1 PV por cada
// animal de coste 5+ en todo el mazo, ver scorePerCostAtLeast en
// effects/registry.ts) no tenían NINGÚN input del que depender su valor
// real — encodeCardBlock ya le decía a la red "esta carta tiene un efecto
// scorePerCostAtLeast" (one-hot de tipo), pero no "cuántos animales de
// coste 5+ tengo YA", que es lo que de verdad determina cuánto vale. Sin
// esto, ningún volumen de entrenamiento podía enseñarle la correlación
// porque la variable de la que depende era invisible para la red.
function costTierCounts(cards: CardInstance[]): number[] {
  const animals = cards.filter((c) => c.type === 'animal');
  const cheap = animals.filter((c) => c.marketCost <= 2).length;
  const mid = animals.filter((c) => c.marketCost >= 3 && c.marketCost <= 4).length;
  const expensive = animals.filter((c) => c.marketCost >= 5).length;
  return [cheap, mid, expensive];
}

// Contexto propio del jugador que decide, más lo único que se puede saber
// legítimamente de cada rival: el tamaño de su mano (nunca su contenido) y
// su descarte entero (boca arriba, es información pública).
export function encodePlayerContext(state: GameState, player: Player): number[] {
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

  // Duración elegida de la partida (ver maxRounds en GameState): sin esto,
  // el turno absoluto (arriba) no dice nada sobre "cuánta prisa tengo" — el
  // turno 15 es "recién empezando" en una partida a 50 rondas y "se acaba
  // ya" en una a 15. hasRoundLimit distingue "sin límite" (0, el turno
  // absoluto vale lo que valía antes) de "con límite" (1); roundProgress
  // (0 sin límite) es la fracción de la duración ya consumida, tope 1 por
  // si `round` llegara a superar `maxRounds` un instante antes de que el
  // motor cierre la partida.
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
// / Araña eligiendo qué capturar gratis, Flamenco eligiendo qué devolver,
// Jirafa eligiendo qué recuperar): el objetivo puede estar en el mercado, en
// la propia mano, en lo ya jugado este turno (playedThisTurn, ver
// returnAnimalForUpgrade en el motor) o en el descarte.
function targetCard(state: GameState, player: Player, action: Action): CardInstance | undefined {
  if (action.type !== 'playCard' || !action.targetInstanceId) return undefined;
  return (
    state.animalTrack.find((c) => c.instanceId === action.targetInstanceId) ??
    player.hand.find((c) => c.instanceId === action.targetInstanceId) ??
    player.playedThisTurn.find((c) => c.instanceId === action.targetInstanceId) ??
    player.discard.find((c) => c.instanceId === action.targetInstanceId)
  );
}

// Solo la usa el Flamenco (returnAnimalForUpgrade): el animal del mercado
// que se recibiría A CAMBIO del que se devuelve (targetCard, arriba). Sin
// esto, el bot podía aprender "qué me conviene soltar" pero no distinguía,
// puntuando cada variante, si a cambio se lleva algo bueno o malo — solo lo
// intuía indirectamente por el contexto general de la partida, nunca por
// las stats concretas de lo que recibe. Siempre está en el mercado (nunca
// en mano/mazo/descarte): es lo que se coge, no algo que el jugador ya tenga.
function secondaryTargetCard(state: GameState, action: Action): CardInstance | undefined {
  if (action.type !== 'playCard' || !action.secondaryTargetInstanceId) return undefined;
  return state.animalTrack.find((c) => c.instanceId === action.secondaryTargetInstanceId);
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
    ...encodeTargetBlock(secondaryTargetCard(state, action)),
    ...encodeTargetBlock(topOfOwnDeck(player)),
  ];

  if (features.length >= FEATURE_DIM) return features.slice(0, FEATURE_DIM);
  return [...features, ...new Array(FEATURE_DIM - features.length).fill(0)];
}
