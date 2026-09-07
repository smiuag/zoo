import { getCard } from './cards/registry';
import { matchHabitatList, type Card } from './cards/schema';
import {
  drawCards,
  effectiveHand,
  mintInstance,
  shuffle,
  type CardInstance,
  type GameState,
  type Player,
} from './model/state';
import { resolveEffect, setRefillHook } from './effects/registry';

const STARTING_HAND_SIZE = 5;
const ANIMAL_SPECIES = [
  'monkey',
  'penguin',
  'peacock',
  'lion',
  'tiger',
  'dolphin',
  'goldfish',
  'snake',
  'parrot',
  'elephant',
  'giraffe',
  'spider',
  'hyena',
  'orca',
  'polar-bear',
  'albatross',
  'crocodile',
  'hippopotamus',
  'vulture',
  'duck',
  'flamingo',
  'seal',
  'parakeet',
  'owl',
  'bat',
] as const;
// La partida entra en la ronda final en cuanto este número de mazos
// compartidos (de las 25 especies, todas cuentan) se hayan agotado.
const FINAL_ROUND_EMPTY_DECK_THRESHOLD = 5;
// Monedas que se pueden comprar directamente (a cambio de otras monedas),
// además de conseguirse por efectos o el mazo inicial. Suministro
// ilimitado: no tienen mazo compartido ni se agotan.
const PURCHASABLE_COINS = ['coin-2', 'coin-3'] as const;

export interface CreatePlayerConfig {
  id: string;
  name: string;
  deck: Card[];
}

export type Action =
  // Se resuelve el efecto onPlay de la carta y va al descarte.
  // "targetInstanceId" solo aplica a los pocos efectos que necesitan elegir
  // un objetivo propio (el Elefante o la Araña eligiendo qué animal
  // capturar gratis del mercado; el Flamenco eligiendo qué animal de su
  // mano devolver). "secondaryTargetInstanceId" solo lo usa el Flamenco,
  // para elegir qué animal del mercado coge a cambio; el resto lo ignora.
  | { type: 'playCard'; instanceId: string; targetInstanceId?: string; secondaryTargetInstanceId?: string }
  // Compra un animal del mercado (animalTrack) pagando su coste. Sin
  // trabajador ni límite por turno.
  | { type: 'buyAnimal'; trackInstanceId: string }
  // Compra una moneda de mayor valor (coin-2 o coin-3) pagando su coste.
  // Suministro ilimitado, no depende de un mercado con hueco.
  | { type: 'buyCoin'; coinId: (typeof PURCHASABLE_COINS)[number] }
  | { type: 'endTurn' };

// --- Pago con monedas ---------------------------------------------------
// El dinero no es un contador abstracto: son cartas de tipo "coin" en la
// mano, cada una con un valor (1/2/3). Pagar un coste implica elegir un
// subconjunto de esas cartas cuya suma cubra el coste, gastando el mínimo
// posible de más y, a igualdad, usando el menor número de cartas.
function coinsInHand(player: Player): CardInstance[] {
  return player.hand.filter((c) => c.type === 'coin');
}

// Solo hay 3 valores de moneda posibles (1/2/3), así que en vez de probar
// las 2^n combinaciones de monedas (viable con "unas pocas monedas como
// mucho", pero un bot de self-play puede acabar acumulando decenas gracias
// a efectos como el del Delfín, y 2^30 ya cuelga la partida varios minutos)
// basta con recorrer cuántas de 3 y de 2 se usan: el número óptimo de
// monedas de 1 para cada combinación sale directo, sin necesidad de probar
// también todas sus combinaciones.
function pickCoinsToPay(player: Player, cost: number): CardInstance[] | null {
  const ones: CardInstance[] = [];
  const twos: CardInstance[] = [];
  const threes: CardInstance[] = [];
  for (const coin of coinsInHand(player)) {
    if (coin.value === 1) ones.push(coin);
    else if (coin.value === 2) twos.push(coin);
    else if (coin.value === 3) threes.push(coin);
  }

  let best: { sum: number; count: number; useOnes: number; useTwos: number; useThrees: number } | null = null;
  for (let useThrees = 0; useThrees <= threes.length; useThrees++) {
    for (let useTwos = 0; useTwos <= twos.length; useTwos++) {
      const partial = useThrees * 3 + useTwos * 2;
      const useOnes = Math.min(ones.length, Math.max(0, cost - partial));
      const sum = partial + useOnes;
      if (sum < cost) continue;
      const count = useOnes + useTwos + useThrees;
      if (!best || sum < best.sum || (sum === best.sum && count < best.count)) {
        best = { sum, count, useOnes, useTwos, useThrees };
      }
    }
  }

  if (!best) return null;
  return [...ones.slice(0, best.useOnes), ...twos.slice(0, best.useTwos), ...threes.slice(0, best.useThrees)];
}

// La moneda extra que da algún efecto (p. ej. serpiente / loro / león /
// delfín) este turno (bonusPurchasingPowerThisTurn) cubre primero el coste;
// el resto, si queda, se paga con monedas físicas.
export function canAffordMarket(player: Player, cost: number): boolean {
  const remaining = cost - player.bonusPurchasingPowerThisTurn;
  if (remaining <= 0) return true;
  return pickCoinsToPay(player, remaining) !== null;
}

function payCoins(player: Player, cost: number): void {
  const fromBonus = Math.min(cost, player.bonusPurchasingPowerThisTurn);
  player.bonusPurchasingPowerThisTurn -= fromBonus;
  const remaining = cost - fromBonus;
  if (remaining <= 0) return;
  const toSpend = pickCoinsToPay(player, remaining);
  if (!toSpend) throw new Error('No hay monedas suficientes para pagar');
  for (const coin of toSpend) {
    const idx = player.hand.findIndex((c) => c.instanceId === coin.instanceId);
    player.hand.splice(idx, 1);
    player.discard.push(coin);
  }
}

// Se llama cada vez que un mazo compartido de especie podría haberse
// quedado vacío. En cuanto FINAL_ROUND_EMPTY_DECK_THRESHOLD de ellos están
// agotados a la vez, dispara la ronda final.
function checkFinalRoundTrigger(state: GameState): void {
  if (state.finalRoundTriggerPlayerIndex !== null) return;
  const emptyDecks = Object.values(state.sharedDecks).filter((deck) => deck.length === 0).length;
  if (emptyDecks >= FINAL_ROUND_EMPTY_DECK_THRESHOLD) {
    state.finalRoundTriggerPlayerIndex = state.activePlayerIndex;
    state.log.push(`Se han agotado ${emptyDecks} mazos compartidos: última ronda.`);
  }
}

// --- Mercado de animales --------------------------------------------------
// Siempre intenta tener 1 hueco por especie (25 en total); al comprarse uno
// se repone solo el hueco de esa especie, con una copia del mazo compartido
// de esa especie.
function refillAnimalMarket(state: GameState, onlySpecies?: string): void {
  const speciesToFill = onlySpecies ? [onlySpecies] : [...ANIMAL_SPECIES];
  for (const species of speciesToFill) {
    if (state.animalTrack.some((c) => c.species === species)) continue;
    const deck = state.sharedDecks[species];
    const card = deck?.pop();
    if (card) state.animalTrack.push(card);
  }
  state.animalTrack.sort((a, b) => (a.species ?? '').localeCompare(b.species ?? ''));

  checkFinalRoundTrigger(state);
}

setRefillHook((state, species) => refillAnimalMarket(state, species));

// Solo resetea los contadores propios de ESTE turno; ya NO roba (ver
// endTurn: la mano se roba al final del turno anterior, no al principio del
// siguiente, para que los rivales tengan mano de verdad entre turno y
// turno).
function beginPlayerTurn(_state: GameState, player: Player): void {
  player.bonusPurchasingPowerThisTurn = 0;
  player.boughtSpeciesThisTurn = [];
  player.playedThisTurn = [];
}

// Como mucho 1 compra de mercado (buyAnimal) por ESPECIE y turno: puedes
// comprar tantos animales distintos como quieras/puedas pagar en el mismo
// turno, pero no 2 copias del mismo (el mercado repone el hueco con otra
// copia de la misma especie justo al comprarla, así que sin este límite se
// podría comprar la misma varias veces seguidas). Solo limita compras
// directas; las capturas gratis de efectos (Elefante/Araña/Flamenco) no
// cuentan para este límite.
function canBuySpecies(player: Player, animal: CardInstance): boolean {
  return !animal.species || !player.boughtSpeciesThisTurn.includes(animal.species);
}

export function createGame(playerConfigs: CreatePlayerConfig[]): GameState {
  const state: GameState = {
    players: [],
    activePlayerIndex: 0,
    turn: 1,
    log: [],
    nextInstanceId: 0,
    sharedDecks: {},
    animalTrack: [],
    finalRoundTriggerPlayerIndex: null,
    gameOver: false,
    scoringFinalized: false,
  };

  state.players = playerConfigs.map((cfg) => {
    const deck = shuffle(cfg.deck.map((card) => mintInstance(state, card)));
    return {
      id: cfg.id,
      name: cfg.name,
      deck,
      hand: [],
      discard: [],
      bonusPurchasingPowerThisTurn: 0,
      boughtSpeciesThisTurn: [],
      playedThisTurn: [],
    };
  });

  // Un mazo por especie, con 10 copias fijas (independiente del nº de jugadores).
  const copiesPerSpecies = 10;
  for (const species of ANIMAL_SPECIES) {
    const speciesCard = getCard(species);
    state.sharedDecks[species] = shuffle(
      Array.from({ length: copiesPerSpecies }, () => mintInstance(state, speciesCard))
    );
  }
  refillAnimalMarket(state);

  // TODOS los jugadores empiezan la partida con mano (no solo el primero en
  // jugar): si no, efectos que miran la mano de un rival (Mono, Buitre,
  // Hiena, Pato) no tendrían nada que hacer hasta que a ese rival le tocara
  // jugar por primera vez.
  for (const player of state.players) {
    drawCards(player, STARTING_HAND_SIZE);
  }
  beginPlayerTurn(state, getActivePlayer(state));
  return state;
}

export function getActivePlayer(state: GameState): Player {
  return state.players[state.activePlayerIndex];
}

function requireActivePlayer(state: GameState, playerId: string): Player {
  if (state.gameOver) throw new Error('La partida ha terminado');
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`Jugador desconocido: ${playerId}`);
  if (getActivePlayer(state).id !== playerId) throw new Error(`No es el turno de ${playerId}`);
  return player;
}

// Algunas cartas necesitan elegir un objetivo propio al jugarlas: el
// Elefante y la Araña (qué animal del mercado capturar gratis). Devuelve
// null si la carta no necesita elegir nada (la inmensa mayoría). El
// Flamenco se trata aparte en getLegalActions porque necesita DOS
// elecciones encadenadas (qué animal devolver + qué animal coger a
// cambio), no solo una lista plana de candidatos.
function targetedEffectCandidates(state: GameState, card: CardInstance): CardInstance[] | null {
  const freeCapture = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'freeCaptureUpToCost');
  if (freeCapture) {
    const maxCost = typeof freeCapture.params?.maxCost === 'number' ? freeCapture.params.maxCost : Infinity;
    const habitats = matchHabitatList(freeCapture.params?.habitat);
    const excludeHabitat =
      typeof freeCapture.params?.excludeHabitat === 'string' ? freeCapture.params.excludeHabitat : null;
    return state.animalTrack.filter(
      (c) =>
        (c.marketCost ?? 0) <= maxCost &&
        (habitats.length === 0 || habitats.some((h) => (c.habitats as string[])?.includes(h))) &&
        (!excludeHabitat || !(c.habitats as string[])?.includes(excludeHabitat))
    );
  }
  return null;
}

// Genera las variantes de "playCard" para una carta de Flamenco (o
// cualquier otra que use returnAnimalForUpgrade): una por cada combinación
// de (animal de tu mano ESTE TURNO que devuelves, animal del mercado que
// coges a cambio, de coste como mucho 1 más que el devuelto). "Tu mano
// este turno" = effectiveHand: lo que tienes ahora en la mano más lo que
// ya hayas jugado en este mismo turno (mismo criterio que el resto de
// efectos que miran "tu mano", ver effectiveHand()); no incluye ni el
// mazo ni cartas jugadas en turnos anteriores. Si un animal devuelto no
// tiene ningún destino posible en el mercado, se ofrece igual la variante
// sin `secondaryTargetInstanceId` (se juega su habilidad pero no se coge
// nada a cambio).
function returnAnimalForUpgradeActions(state: GameState, player: Player, card: CardInstance): Action[] {
  const sources = effectiveHand(player).filter((c) => c.type === 'animal');
  const actions: Action[] = [];
  for (const source of sources) {
    const maxCost = (source.marketCost ?? 0) + 1;
    const destinations = state.animalTrack.filter((c) => (c.marketCost ?? 0) <= maxCost);
    if (destinations.length === 0) {
      actions.push({ type: 'playCard', instanceId: card.instanceId, targetInstanceId: source.instanceId });
      continue;
    }
    for (const destination of destinations) {
      actions.push({
        type: 'playCard',
        instanceId: card.instanceId,
        targetInstanceId: source.instanceId,
        secondaryTargetInstanceId: destination.instanceId,
      });
    }
  }
  return actions;
}

export function getLegalActions(state: GameState, playerId: string): Action[] {
  if (state.gameOver) return [];
  const player = state.players.find((p) => p.id === playerId);
  if (!player || getActivePlayer(state).id !== playerId) return [];

  const actions: Action[] = [];

  for (const card of player.hand) {
    // Las monedas nunca se juegan: se gastan solas al pagar una compra.
    if (card.type === 'coin') continue;

    const returnForUpgrade = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'returnAnimalForUpgrade');
    if (returnForUpgrade) {
      actions.push(...returnAnimalForUpgradeActions(state, player, card));
      continue;
    }

    const candidates = targetedEffectCandidates(state, card);
    if (candidates && candidates.length > 0) {
      for (const candidate of candidates) {
        actions.push({ type: 'playCard', instanceId: card.instanceId, targetInstanceId: candidate.instanceId });
      }
    } else {
      actions.push({ type: 'playCard', instanceId: card.instanceId });
    }
  }

  for (const trackAnimal of state.animalTrack) {
    if (canAffordMarket(player, trackAnimal.marketCost ?? 0) && canBuySpecies(player, trackAnimal)) {
      actions.push({ type: 'buyAnimal', trackInstanceId: trackAnimal.instanceId });
    }
  }

  for (const coinId of PURCHASABLE_COINS) {
    if (canAffordMarket(player, getCard(coinId).marketCost ?? 0)) {
      actions.push({ type: 'buyCoin', coinId });
    }
  }

  actions.push({ type: 'endTurn' });
  return actions;
}

export function playCard(
  state: GameState,
  playerId: string,
  instanceId: string,
  targetInstanceId?: string,
  secondaryTargetInstanceId?: string
): void {
  const player = requireActivePlayer(state, playerId);

  const cardIndex = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (cardIndex === -1) throw new Error(`La carta ${instanceId} no está en la mano de ${playerId}`);
  const card = player.hand[cardIndex];
  if (card.type === 'coin') throw new Error('Las monedas no se juegan: se gastan solas al pagar una compra');

  player.hand.splice(cardIndex, 1);
  player.discard.push(card);
  // Antes de resolver el efecto: para los efectos que cuentan animales "en
  // tu mano" (ver effectiveHand), esta carta debe contarse a sí misma, y
  // seguir contando el resto del turno aunque ya esté en el descarte.
  player.playedThisTurn.push(card);

  for (const effect of card.effects.filter((e) => e.trigger === 'onPlay')) {
    resolveEffect(state, player, effect, { targetInstanceId, secondaryTargetInstanceId });
  }

  state.log.push(`${player.name} jugó ${card.name}`);
}

// Compra un animal del mercado pagando su coste; va directo al descarte
// (igual que cualquier compra), sin trabajador. Como mucho 1 compra de
// mercado por ESPECIE y turno (ver canBuySpecies): puedes comprar varios
// animales distintos en el mismo turno, pero no la misma especie 2 veces.
// No aplica a capturas gratis de efectos.
export function buyAnimal(state: GameState, playerId: string, trackInstanceId: string): void {
  const player = requireActivePlayer(state, playerId);

  const trackIndex = state.animalTrack.findIndex((c) => c.instanceId === trackInstanceId);
  if (trackIndex === -1) throw new Error(`El animal ${trackInstanceId} ya no está disponible en el mercado`);
  const animal = state.animalTrack[trackIndex];

  if (!canAffordMarket(player, animal.marketCost ?? 0)) {
    throw new Error(`${playerId} no puede pagar ${animal.marketCost}monedas por ${animal.name}`);
  }
  if (!canBuySpecies(player, animal)) {
    throw new Error(`${playerId} ya ha comprado esa especie este turno`);
  }

  payCoins(player, animal.marketCost ?? 0);
  state.animalTrack.splice(trackIndex, 1);
  player.discard.push(animal);
  if (animal.species) player.boughtSpeciesThisTurn.push(animal.species);
  refillAnimalMarket(state, animal.species);

  state.log.push(`${player.name} compró ${animal.name} por ${animal.marketCost}monedas`);
}

// Compra una moneda de mayor valor pagando su coste; va directo al
// descarte. Suministro ilimitado: no hay mazo compartido que agotar.
export function buyCoin(state: GameState, playerId: string, coinId: (typeof PURCHASABLE_COINS)[number]): void {
  const player = requireActivePlayer(state, playerId);

  const coinCard = getCard(coinId);
  if (!canAffordMarket(player, coinCard.marketCost ?? 0)) {
    throw new Error(`${playerId} no puede pagar ${coinCard.marketCost}monedas por ${coinCard.name}`);
  }

  payCoins(player, coinCard.marketCost ?? 0);
  player.discard.push(mintInstance(state, coinCard));

  state.log.push(`${player.name} compró ${coinCard.name} por ${coinCard.marketCost}monedas`);
}

export function endTurn(state: GameState, playerId: string): void {
  const player = requireActivePlayer(state, playerId);

  // Lo que quede en la mano sin jugar (monedas incluidas) se descarta;
  // volverá a circular cuando el mazo se reponga del descarte. Justo
  // después robas YA tu mano siguiente (como el "clean-up" de Dominion),
  // así la llevas contigo durante los turnos de los demás: si no, un rival
  // que juegue Mono/Buitre/Hiena/Pato (miran tu mano) siempre te
  // encontraría con la mano vacía y el efecto nunca haría nada.
  player.discard.push(...player.hand);
  player.hand = [];
  drawCards(player, STARTING_HAND_SIZE);

  const nextIndex = (state.activePlayerIndex + 1) % state.players.length;
  state.turn += 1;

  // Si algún mazo se agotó en algún momento de esta vuelta, la partida
  // termina en cuanto le tocaría jugar de nuevo a quien lo disparó (todos
  // los demás ya han tenido su turno extra).
  if (state.finalRoundTriggerPlayerIndex !== null && nextIndex === state.finalRoundTriggerPlayerIndex) {
    state.activePlayerIndex = nextIndex;
    state.gameOver = true;
    state.log.push('Fin de la partida.');
    return;
  }

  state.activePlayerIndex = nextIndex;
  const next = getActivePlayer(state);
  beginPlayerTurn(state, next);
  state.log.push(`Turno de ${next.name}`);
}

export function applyAction(state: GameState, playerId: string, action: Action): void {
  switch (action.type) {
    case 'playCard':
      playCard(state, playerId, action.instanceId, action.targetInstanceId, action.secondaryTargetInstanceId);
      return;
    case 'buyAnimal':
      buyAnimal(state, playerId, action.trackInstanceId);
      return;
    case 'buyCoin':
      buyCoin(state, playerId, action.coinId);
      return;
    case 'endTurn':
      endTurn(state, playerId);
      return;
  }
}
