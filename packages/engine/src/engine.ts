import { getCard } from './cards/registry';
import { matchHabitatList, type Card, type Effect } from './cards/schema';
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
  'turtle',
  'platypus',
  'rabbit',
] as const;
// La partida entra en la ronda final en cuanto este número de mazos
// compartidos (de las 28 especies, todas cuentan) se hayan agotado.
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

export interface CreateGameOptions {
  // Duración de la partida en rondas (una ronda = 1 turno de cada
  // jugador). Si se omite o es null, la partida solo termina cuando se
  // agoten 5 mazos compartidos (ver FINAL_ROUND_EMPTY_DECK_THRESHOLD),
  // como hasta ahora.
  maxRounds?: number | null;
}

export type Action =
  // Se resuelve el efecto onPlay de la carta y va al descarte.
  // "targetInstanceId" solo aplica a los pocos efectos que necesitan elegir
  // un objetivo propio (el Elefante o la Araña eligiendo qué animal
  // capturar gratis del mercado; el Flamenco eligiendo qué animal de su
  // mano devolver). "secondaryTargetInstanceId" solo lo usa el Flamenco,
  // para elegir qué animal del mercado coge a cambio; el resto lo ignora.
  // "targetPlayerId" solo lo usan el Pato y la Jirafa, para elegir a qué
  // rival afecta su efecto; el resto lo ignora.
  | {
      type: 'playCard';
      instanceId: string;
      targetInstanceId?: string;
      secondaryTargetInstanceId?: string;
      targetPlayerId?: string;
    }
  // Compra un animal del mercado (animalTrack) pagando su coste. Sin
  // trabajador ni límite por turno.
  | { type: 'buyAnimal'; trackInstanceId: string }
  // Compra una moneda de mayor valor (coin-2 o coin-3) pagando su coste.
  // Suministro ilimitado, no depende de un mercado con hueco.
  | { type: 'buyCoin'; coinId: (typeof PURCHASABLE_COINS)[number] }
  | { type: 'endTurn' };

// --- Pago con monedas ---------------------------------------------------
// El dinero son cartas de tipo "coin" en la mano, cada una con un valor
// (1/2/3). Pagar un coste elige un subconjunto de esas cartas cuya suma lo
// cubra (gastando el mínimo posible de más y, a igualdad, usando el menor
// número de cartas) y las descarta enteras. Si pagan de más, esa
// diferencia no se pierde: se convierte en valor de compra genérico para
// el resto del turno (ver payCoins) en vez de dejar la moneda "a medio
// gastar" con un valor que ya no coincidiría con lo que dice ser.
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

// La moneda extra que da algún efecto (p. ej. serpiente / loro / león) este
// turno (bonusPurchasingPowerThisTurn) cubre primero el coste, más la
// moneda restringida a acuáticos del Delfín (aquaticBonusPurchasingPowerThisTurn)
// si `isAquaticAnimal` (solo aplica comprando un animal con hábitat
// acuático, nunca una moneda); el resto, si queda, se paga con monedas
// físicas.
export function canAffordMarket(player: Player, cost: number, isAquaticAnimal = false): boolean {
  const bonus = player.bonusPurchasingPowerThisTurn + (isAquaticAnimal ? player.aquaticBonusPurchasingPowerThisTurn : 0);
  const remaining = cost - bonus;
  if (remaining <= 0) return true;
  return pickCoinsToPay(player, remaining) !== null;
}

function payCoins(player: Player, cost: number, isAquaticAnimal = false): void {
  let remaining = cost;
  // Se gasta primero la moneda restringida a acuáticos (si aplica): no
  // sirve para nada más, así que no tiene sentido "reservarla".
  if (isAquaticAnimal) {
    const fromAquaticBonus = Math.min(remaining, player.aquaticBonusPurchasingPowerThisTurn);
    player.aquaticBonusPurchasingPowerThisTurn -= fromAquaticBonus;
    remaining -= fromAquaticBonus;
  }
  const fromBonus = Math.min(remaining, player.bonusPurchasingPowerThisTurn);
  player.bonusPurchasingPowerThisTurn -= fromBonus;
  remaining -= fromBonus;
  if (remaining <= 0) return;
  const toSpend = pickCoinsToPay(player, remaining);
  if (!toSpend) throw new Error('No hay monedas suficientes para pagar');

  for (const coin of toSpend) {
    const idx = player.hand.findIndex((c) => c.instanceId === coin.instanceId);
    player.hand.splice(idx, 1);
    player.discard.push(coin);
  }

  // El valor de compra se puede repartir como se quiera entre varias
  // compras del mismo turno (p. ej. una moneda de 3 paga algo de 2 y,
  // luego, algo de 1): las monedas gastadas se descartan enteras (nunca se
  // les reduce el valor ni se quedan "a medio gastar" en la mano — una
  // Moneda de oro sigue siendo una Moneda de oro, no una carta con un
  // valor que ya no coincide con lo que dice ser), pero si pagan de más,
  // esa diferencia no se pierde: se convierte en valor de compra genérico
  // (el mismo que da el León, etc.), disponible para el resto del turno.
  const spent = toSpend.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const change = spent - remaining;
  if (change > 0) player.bonusPurchasingPowerThisTurn += change;
}

// Se llama cada vez que un mazo compartido de especie podría haberse
// quedado vacío. En cuanto FINAL_ROUND_EMPTY_DECK_THRESHOLD de ellos están
// agotados a la vez, dispara la ronda final.
function checkFinalRoundTrigger(state: GameState): void {
  if (state.finalRoundTriggerPlayerIndex !== null) return;
  // Solo cuentan los mazos de especies de mercado (ANIMAL_SPECIES): la
  // reserva de Perezosos para la Jirafa también vive en sharedDecks (ver
  // createGame) pero no es una especie del mercado (esa clave no está en
  // ANIMAL_SPECIES), así que agotarla no debería adelantar el fin de la
  // partida. El Conejo SÍ es una especie de mercado normal (su propio mazo
  // de sharedDecks['rabbit'] es el mismo que agotan tanto las compras como
  // el efecto de la carta), así que a ese sí le aplica el criterio normal.
  const emptyDecks = ANIMAL_SPECIES.filter((species) => state.sharedDecks[species]?.length === 0).length;
  if (emptyDecks >= FINAL_ROUND_EMPTY_DECK_THRESHOLD) {
    state.finalRoundTriggerPlayerIndex = state.activePlayerIndex;
    state.log.push(`Se han agotado ${emptyDecks} mazos compartidos: última ronda.`);
  }
}

// --- Mercado de animales --------------------------------------------------
// Siempre intenta tener 1 hueco por especie (27 en total); al comprarse uno
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
function beginPlayerTurn(state: GameState, player: Player): void {
  player.bonusPurchasingPowerThisTurn = 0;
  player.aquaticBonusPurchasingPowerThisTurn = 0;
  player.boughtSpeciesThisTurn = [];
  player.playedThisTurn = [];
  recordRichestTurn(state, player);
}

// Valor de compra TOTAL disponible ahora mismo: monedas de verdad en mano +
// el bonus genérico (Serpiente/Loro/León/cambio de una compra...) + el
// bonus solo-acuático (Delfín). Mismos ingredientes que canAffordMarket,
// pero sumados en vez de comparados contra un coste.
function currentPurchasingPower(player: Player): number {
  const coins = player.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0);
  return coins + player.bonusPurchasingPowerThisTurn + player.aquaticBonusPurchasingPowerThisTurn;
}

// richestTurn guarda el PICO de valor de compra alcanzado en un turno, no
// solo el de la mano inicial: se llama tras jugar una carta (algunos
// efectos dan bonus) y tras cada compra (el cambio de una compra con de más
// también da bonus, ver payCoins), además de al empezar el turno. Comprar
// gasta monedas/bonus y por tanto BAJA currentPurchasingPower, pero como
// esto se queda con el máximo visto en toda la partida (nunca lo baja),
// capturar el pico de cada turno antes de que se gaste es exactamente
// "el valor de compra total del turno después de jugar todos los animales".
function recordRichestTurn(state: GameState, player: Player): void {
  const amount = currentPurchasingPower(player);
  if (!player.richestTurn || amount > player.richestTurn.amount) {
    player.richestTurn = { round: state.round, amount };
  }
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

export function createGame(playerConfigs: CreatePlayerConfig[], options: CreateGameOptions = {}): GameState {
  const state: GameState = {
    players: [],
    activePlayerIndex: 0,
    turn: 1,
    round: 1,
    maxRounds: options.maxRounds ?? null,
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
      aquaticBonusPurchasingPowerThisTurn: 0,
      boughtSpeciesThisTurn: [],
      playedThisTurn: [],
      purchasesCount: 0,
      richestTurn: null,
    };
  });

  // Un mazo por especie, con copias fijas (independiente del nº de
  // jugadores): 10 copias para la mayoría, mucho menos para las especies
  // caras (coste 5 o más) — son las de más PV/mejores habilidades, y con
  // solo 6 copias en juego se agotan antes, dándoles algo de escasez real.
  for (const species of ANIMAL_SPECIES) {
    const speciesCard = getCard(species);
    const copiesPerSpecies = (speciesCard.marketCost ?? 0) >= 5 ? 6 : 10;
    state.sharedDecks[species] = shuffle(
      Array.from({ length: copiesPerSpecies }, () => mintInstance(state, speciesCard))
    );
  }

  // Reserva de Perezosos para la Jirafa: NO es el mazo de ningún jugador
  // (el Perezoso ni siquiera es una especie de ANIMAL_SPECIES, nunca sale
  // en el mercado), así que reutiliza sharedDecks solo como almacén
  // genérico. Tantas copias como Jirafas puede haber como mucho en toda la
  // partida (su propio tope de copias, coste 3 -> 10 copias): así nunca
  // haría falta preocuparse de que la reserva se agote antes que las
  // Jirafas mismas.
  const SLOTH_RESERVE_SIZE = 10;
  state.sharedDecks['sloth'] = shuffle(
    Array.from({ length: SLOTH_RESERVE_SIZE }, () => mintInstance(state, getCard('sloth')))
  );

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
// Efectos que necesitan elegir un JUGADOR (no una carta) como objetivo: el
// Pato (de quién robar 1 moneda), la Jirafa (a quién le cae un Perezoso
// encima del mazo) y los Conejos (a quién le cae un Conejo de la reserva en
// el descarte). Ver PLAYER_TARGETED_EFFECT_TYPES más abajo, en
// getLegalActions.
const PLAYER_TARGETED_EFFECT_TYPES = new Set([
  'stealCoinFromChosenPlayer',
  'topdeckSlothForChosenPlayer',
  'addRabbitToChosenPlayerDiscard',
]);

// De los de arriba, la Jirafa es la única que también puede elegirse A SÍ
// MISMA como objetivo (ponerte el Perezoso a ti mismo encima del mazo): el
// Pato robar de tu propia mano o los Conejos maldecirte a ti mismo no
// tendrían ningún sentido, así que esos 2 se quedan sin poder auto-elegirse.
const SELF_TARGETABLE_PLAYER_EFFECT_TYPES = new Set(['topdeckSlothForChosenPlayer']);

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
// coges a cambio, de coste como mucho effect.params.maxCostDelta —por
// defecto 1— más que el devuelto). "Tu mano
// este turno" = effectiveHand: lo que tienes ahora en la mano más lo que
// ya hayas jugado en este mismo turno (mismo criterio que el resto de
// efectos que miran "tu mano", ver effectiveHand()); no incluye ni el
// mazo ni cartas jugadas en turnos anteriores. Si un animal devuelto no
// tiene ningún destino posible en el mercado, se ofrece igual la variante
// sin `secondaryTargetInstanceId` (se juega su habilidad pero no se coge
// nada a cambio).
function returnAnimalForUpgradeActions(state: GameState, player: Player, card: CardInstance, effect: Effect): Action[] {
  const costDelta = typeof effect.params?.maxCostDelta === 'number' ? effect.params.maxCostDelta : 1;
  const sources = effectiveHand(player).filter((c) => c.type === 'animal');
  const actions: Action[] = [];
  for (const source of sources) {
    const maxCost = (source.marketCost ?? 0) + costDelta;
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

// Genera las variantes de "playCard" para el Tigre (o cualquier otra carta
// que use drawThenTopdeck): una por cada carta de la mano que resultaría
// DESPUÉS de robar, para elegir cuál se deja encima del mazo. Como el
// robo es determinista (el mazo ya está barajado; solo "es aleatorio" en
// el sentido de que el jugador no lo ve de antemano), se simula sobre una
// copia de deck/hand/discard — nunca sobre el player real — para saber
// exactamente qué mano resultaría (incluido un posible rebarajado del
// descarte si el mazo se queda corto a mitad del robo) sin mutar la
// partida de verdad. drawThenTopdeck ya no elige la peor por su cuenta:
// el jugador ve estas opciones en un menú, igual que el Elefante o el
// Flamenco.
function drawThenTopdeckActions(player: Player, card: CardInstance, effect: Effect): Action[] {
  const drawAmount = typeof effect.params?.drawAmount === 'number' ? effect.params.drawAmount : 2;
  const preview: Player = { ...player, deck: [...player.deck], hand: [...player.hand], discard: [...player.discard] };
  drawCards(preview, drawAmount);
  // El propio Tigre sigue en preview.hand (todavía no lo ha sacado
  // playCard, eso pasa después de elegir la acción): no tiene sentido
  // ofrecer "dejar el Tigre encima del mazo" como opción, así que se excluye.
  return preview.hand
    .filter((c) => c.instanceId !== card.instanceId)
    .map((c) => ({ type: 'playCard', instanceId: card.instanceId, targetInstanceId: c.instanceId }));
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
      actions.push(...returnAnimalForUpgradeActions(state, player, card, returnForUpgrade));
      continue;
    }

    const drawThenTopdeck = card.effects.find((e) => e.trigger === 'onPlay' && e.type === 'drawThenTopdeck');
    if (drawThenTopdeck) {
      actions.push(...drawThenTopdeckActions(player, card, drawThenTopdeck));
      continue;
    }

    const playerTargeted = card.effects.find(
      (e) => e.trigger === 'onPlay' && PLAYER_TARGETED_EFFECT_TYPES.has(e.type)
    );
    if (playerTargeted) {
      const candidates = SELF_TARGETABLE_PLAYER_EFFECT_TYPES.has(playerTargeted.type)
        ? state.players
        : state.players.filter((p) => p.id !== player.id);
      if (candidates.length > 0) {
        for (const candidate of candidates) {
          actions.push({ type: 'playCard', instanceId: card.instanceId, targetPlayerId: candidate.id });
        }
      } else {
        actions.push({ type: 'playCard', instanceId: card.instanceId });
      }
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
    const isAquaticAnimal = (trackAnimal.habitats as string[] | undefined)?.includes('aquatic') ?? false;
    if (canAffordMarket(player, trackAnimal.marketCost ?? 0, isAquaticAnimal) && canBuySpecies(player, trackAnimal)) {
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
  secondaryTargetInstanceId?: string,
  targetPlayerId?: string
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
    resolveEffect(state, player, effect, { targetInstanceId, secondaryTargetInstanceId, targetPlayerId });
  }
  // Algunas de esas habilidades dan valor de compra extra (Serpiente, Loro,
  // León, Delfín...): puede que este sea el pico de la partida para este
  // jugador, ver recordRichestTurn.
  recordRichestTurn(state, player);

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
  const isAquaticAnimal = (animal.habitats as string[] | undefined)?.includes('aquatic') ?? false;

  if (!canAffordMarket(player, animal.marketCost ?? 0, isAquaticAnimal)) {
    throw new Error(`${playerId} no puede pagar ${animal.marketCost}monedas por ${animal.name}`);
  }
  if (!canBuySpecies(player, animal)) {
    throw new Error(`${playerId} ya ha comprado esa especie este turno`);
  }

  payCoins(player, animal.marketCost ?? 0, isAquaticAnimal);
  state.animalTrack.splice(trackIndex, 1);
  player.discard.push(animal);
  if (animal.species) player.boughtSpeciesThisTurn.push(animal.species);
  player.purchasesCount += 1;
  refillAnimalMarket(state, animal.species);
  // payCoins puede dar cambio como bonus (ver comentario ahí): revisa el
  // pico DESPUÉS de pagar, no antes.
  recordRichestTurn(state, player);

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
  player.purchasesCount += 1;
  recordRichestTurn(state, player);

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
  // El turno vuelve a empezar por el primer jugador (índice 0, siempre
  // quien arranca la partida): esa vuelta completa es una ronda más.
  const startingNewRound = nextIndex === 0;
  if (startingNewRound) state.round += 1;

  // Si se ha elegido una duración (maxRounds), esa es la ÚNICA forma de
  // terminar la partida: el criterio de agotar mazos compartidos queda
  // desactivado (aunque checkFinalRoundTrigger lo siga marcando por si
  // acaso, se ignora aquí abajo). Sin maxRounds, se mantiene el criterio
  // de siempre: termina en cuanto le tocaría jugar de nuevo a quien
  // disparó el agotamiento (todos los demás ya han tenido su turno extra).
  const roundLimitReached = state.maxRounds !== null && startingNewRound && state.round > state.maxRounds;
  const deckDepletionReached =
    state.maxRounds === null &&
    state.finalRoundTriggerPlayerIndex !== null &&
    nextIndex === state.finalRoundTriggerPlayerIndex;
  if (roundLimitReached || deckDepletionReached) {
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
      playCard(
        state,
        playerId,
        action.instanceId,
        action.targetInstanceId,
        action.secondaryTargetInstanceId,
        action.targetPlayerId
      );
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
