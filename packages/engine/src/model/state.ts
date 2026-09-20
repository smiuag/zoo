import type { Card } from '../cards/schema';

export interface CardInstance extends Card {
  instanceId: string;
}

export interface Player {
  id: string;
  name: string;
  deck: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
  // Moneda extra de compra dada por algún efecto jugado este turno (p. ej.
  // Serpiente / Loro / León): NO es una carta, no se añade al mazo ni se
  // puede robar; solo aumenta lo que puedes gastar hasta que termine el
  // turno. Se puede usar para pagar CUALQUIER compra (animal de cualquier
  // hábitat, o moneda).
  bonusPurchasingPowerThisTurn: number;
  // Igual que bonusPurchasingPowerThisTurn (Delfín), pero restringida:
  // solo sirve para pagar animales ACUÁTICOS, nunca monedas ni animales de
  // otro hábitat. Se gasta primero que la genérica cuando aplica (ver
  // payCoins en engine.ts), porque no sirve para nada más.
  aquaticBonusPurchasingPowerThisTurn: number;
  // Especies de las que ya se ha comprado un animal del mercado ESTE TURNO
  // (buyAnimal, no efectos de captura gratis): como mucho 1 compra por
  // especie y turno (no puedes comprar 2 copias del mismo animal seguidas,
  // pero sí animales distintos aunque compartan hábitat).
  boughtSpeciesThisTurn: string[];
  // Cartas jugadas ESTE TURNO (ya en el descarte, playCard las saca de
  // `hand` antes de resolver su efecto): para los efectos que cuentan
  // animales "en tu mano" (Serpiente/Loro/Foca), siguen contando como si
  // siguieran en la mano hasta que termine el turno — así una carta se
  // cuenta a sí misma, y también cuentan las que ya hayas jugado antes este
  // mismo turno. Ver effectiveHand().
  playedThisTurn: CardInstance[];
  // Nº total de compras hechas en TODA la partida (buyAnimal + buyCoin).
  // No cuenta capturas gratis de efectos (Elefante/Araña/Flamenco): esas no
  // pasan por buyAnimal/buyCoin. Solo para el resumen final de la partida.
  purchasesCount: number;
  // En qué ronda alcanzó su MAYOR valor de compra total (monedas de verdad
  // en mano + bonus de cualquier efecto jugado ese turno, p. ej. Serpiente/
  // Loro/León/Delfín): se actualiza en varios puntos del turno (empezar
  // turno, jugar una carta, comprar), quedándose siempre con el pico más
  // alto visto en toda la partida, nunca lo baja al gastar. Ver
  // recordRichestTurn en engine.ts. null hasta el primer beginPlayerTurn.
  // Solo para el resumen final de la partida.
  richestTurn: { round: number; amount: number } | null;
  // Cartas eliminadas de verdad de la colección por un efecto onScore
  // destructivo (de momento, solo el Cocodrilo, ver
  // destroyWeakestNonFlyingOnScore): ya no cuentan para nada
  // (mazo/mano/descarte, PV), pero se guardan aparte solo para poder
  // mostrarlas en el resumen final de la partida.
  destroyedCards: CardInstance[];
}

// Entrega forzosa de cartas en curso (Buitre/Mono/Hiena/Murciélago: al
// descarte; Tiburón/Halcón/León: eliminadas para siempre, a la pila de
// eliminados de quien capturó): quién debe cuántas cartas todavía, y de
// cuáles puede elegir. Mientras esto no sea null, NADIE (ni siquiera el
// jugador activo) tiene ninguna acción legal salvo "resolveDiscard" para
// los jugadores que todavía deben algo — ver getLegalActions en engine.ts.
// Se crea en el mismo playCard que dispara el efecto (cada una de esas
// cartas tiene un único efecto onPlay, así que no hay que encadenar con
// nada más de esa misma carta) y se limpia solo en resolveDiscard, cuando
// `owed` se queda sin entradas.
export interface PendingDiscardDecision {
  // 'discard': la carta elegida va al propio descarte de quien la entrega
  // (Buitre/Mono/Hiena/Murciélago). 'destroy': se elimina de la partida
  // para siempre, a player.destroyedCards DE QUIEN CAPTURÓ (sourcePlayerId,
  // no de quien la entrega) — Tiburón/Halcón/León; nunca vuelve al mercado,
  // nadie puede volver a comprarla. 'giveToPlayer': pasa a la mano de
  // sourcePlayerId (Pato: el rival elegido elige LIBREMENTE cuál de sus
  // monedas entrega, en vez de dársela el motor automáticamente) — ver
  // resolveDiscard en engine.ts.
  kind: 'discard' | 'destroy' | 'giveToPlayer';
  sourceCardName: string;
  // Quién jugó la carta que disparó esto: a quien beneficia bonusDrawPerCoin
  // y bonusPurchasingPowerPerAnimal (y, para 'destroy', quien recibe la
  // carta eliminada en su propia player.destroyedCards).
  sourcePlayerId: string;
  bonusDrawPerCoin: boolean;
  coinsDiscardedSoFar: number;
  // Tiburón/Halcón/León: por cada animal que se acabe eliminando en total
  // (cuenta real de eliminaciones resueltas, no de lo que se debía al
  // principio — un rival sin ninguno elegible nunca llega a deber nada),
  // quien jugó la carta gana esto de valor de compra este turno — 1 animal
  // eliminado = +1, 3 eliminados = +3, etc. null/0 = sin este bonus (el
  // resto de cartas que usan PendingDiscardDecision).
  bonusPurchasingPowerPerAnimal: number | null;
  returnedSoFar: number;
  // Serpiente: si true, cada carta que se acabe descartando por ESTA
  // entrega (kind 'discard') se va anotando en collectedInstanceIds
  // (siguen en el descarte de quien las entregó, esto es solo un registro
  // aparte). Cuando `owed` se vacía del todo, si hay algo anotado, arranca
  // pendingAnimalAbilityChoice para que quien jugó la Serpiente elija cuál
  // de esas habilidades usar — ver resolveDiscard en engine.ts. false/
  // undefined en el resto de cartas que usan PendingDiscardDecision.
  collectDiscardedForAbilityChoice?: boolean;
  collectedInstanceIds: string[];
  // Por jugador afectado: cuántas cartas le quedan por entregar y de qué
  // instanceIds puede elegir (null = cualquier carta de su mano vale).
  owed: Record<string, { amount: number; eligibleInstanceIds: string[] | null }>;
}

// Serpiente (ver PendingDiscardDecision.collectDiscardedForAbilityChoice
// arriba): una vez todos los jugadores han entregado su animal (o se ha
// saltado a quien no tenía ninguno), quien jugó la Serpiente debe elegir
// UNO de candidateInstanceIds (siguen en el descarte de quien los entregó)
// para activar su habilidad onPlay a su favor — ver
// useDiscardedAnimalAbility en engine.ts. Mientras esto no sea null, solo
// sourcePlayerId tiene alguna acción legal (getLegalActions en engine.ts),
// igual que pendingDecision bloquea a todos los demás.
export interface PendingAnimalAbilityChoice {
  sourcePlayerId: string;
  sourceCardName: string;
  candidateInstanceIds: string[];
}

export interface GameState {
  players: Player[];
  activePlayerIndex: number;
  turn: number;
  // Número de ronda actual (empieza en 1): una ronda es 1 turno de CADA
  // jugador. Se incrementa cada vez que el turno vuelve a empezar por el
  // primer jugador (índice 0, que siempre empieza la partida). Distinto de
  // `turn`, que cuenta turnos individuales (1 por jugador y ronda).
  round: number;
  // Duración elegida de la partida en rondas (15/30/50), o null para usar
  // solo el criterio de siempre (agotar mazos compartidos, ver
  // finalRoundTriggerPlayerIndex). Si se fija, la partida termina al
  // completarse esta ronda aunque los mazos no se hayan agotado — ver
  // endTurn en engine.ts.
  maxRounds: number | null;
  log: string[];
  // Contador global para generar instanceId únicos al acuñar cartas nuevas
  // (mazo inicial, capturas, monedas ganadas, etc.).
  nextInstanceId: number;
  // Un mazo compartido (boca abajo) por cada especie de animal, del que se
  // repone el mercado de animales. Clave: el id de especie (p. ej. "lion").
  sharedDecks: Record<string, CardInstance[]>;
  // Mercado de animales boca arriba: siempre intenta tener 1 hueco por
  // especie (macho o hembra al azar), repuesto en cuanto se captura uno.
  animalTrack: CardInstance[];
  // true en cuanto se agotan 5 de los mazos compartidos por primera vez
  // (dispara la ronda final). No null mientras esa ronda final está en
  // curso: índice del jugador que la disparó, para saber cuándo completar
  // la vuelta y terminar la partida.
  finalRoundTriggerPlayerIndex: number | null;
  // true una vez terminada la ronda final tras agotarse 5 mazos
  // compartidos. Ninguna acción es válida después de esto.
  gameOver: boolean;
  // true en cuanto se ha resuelto YA UNA VEZ la fase destructiva de
  // puntuación (el Cocodrilo) tras terminar la partida. Necesario porque
  // scoreGame() se llama en cada render de la web (para el marcador en
  // vivo), así que sin este cerrojo, cada render posterior al fin de la
  // partida volvería a encontrar el Cocodrilo "todavía en la colección" y
  // repetiría su sacrificio una y otra vez, devorando toda la colección
  // acuática en vez de sacrificar solo un animal una única vez. Ver
  // scoring.ts.
  scoringFinalized: boolean;
  pendingDecision: PendingDiscardDecision | null;
  pendingAnimalAbilityChoice: PendingAnimalAbilityChoice | null;
}

// Acuña una nueva instancia de carta con un instanceId único dentro de la
// partida. Vive aquí (no en engine.ts) para que tanto el motor como los
// handlers de efectos puedan usarla sin crear una dependencia circular.
export function mintInstance(state: GameState, card: Card): CardInstance {
  const instanceId = `${card.id}#${state.nextInstanceId}`;
  state.nextInstanceId += 1;
  return { ...card, instanceId };
}

export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// PRNG determinista (mulberry32): mismo seed => misma secuencia siempre.
// Solo la usa reshuffleDiscardIntoDeck (ver más abajo) — el resto de
// barajados (mazo inicial, mazos compartidos de especie) siguen usando
// shuffle() con Math.random() de verdad, sin ningún motivo para cambiarlos.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Repone el mazo personal desde el descarte cuando se vacía a mitad de un
// robo. Determinista a partir de la FORMA del mazo/descarte del propio
// jugador en ese instante (tamaños + compras hechas), NO de Math.random():
// el Tigre (drawThenTopdeck) necesita simular este mismo robo dos veces —
// una para ofrecer al jugador qué carta puede dejar encima del mazo
// (drawThenTopdeckTargetSpecs en engine.ts, sobre una COPIA del jugador,
// para no mutar la partida de verdad solo por consultar las acciones
// legales) y otra al aplicar la acción elegida de verdad (drawThenTopdeck
// en effects/registry.ts, ya con la propia carta jugada sacada de la mano
// y en player.playedThisTurn — ver playCard) — con Math.random() cada
// llamada barajaba distinto, así que la carta que el jugador elegía dejar
// encima podía no ser ninguna de las que de verdad acababan en su mano,
// dejando una en la mano que no estaba entre las opciones ofrecidas.
// Deliberadamente NO se usa player.hand.length en el seed: es precisamente
// lo único que cambia entre esas dos llamadas (playCard ya ha sacado la
// carta jugada de la mano para la segunda), así que incluirlo rompería la
// propia consistencia que esto busca — deck/discard/purchasesCount no se
// tocan hasta después. Sigue siendo "aleatorio" de una reposición a la
// siguiente porque el propio descarte a barajar ya es distinto cada vez
// (más cartas, otra composición), no porque el PRNG cambie de seed por las
// buenas.
function reshuffleDiscardIntoDeck(player: Player): void {
  const seed = player.purchasesCount * 97 + player.discard.length * 31 + player.deck.length * 13 + 1;
  player.deck = seededShuffle(player.discard, seed);
  player.discard = [];
}

// El "final" del mazo (índice más alto) es la cima: robar hace pop(),
// guardar/devolver una carta encima del mazo hace push().
export function drawCards(player: Player, count: number): void {
  for (let i = 0; i < count; i++) {
    if (player.deck.length === 0) {
      if (player.discard.length === 0) return;
      reshuffleDiscardIntoDeck(player);
    }
    const card = player.deck.pop();
    if (card) player.hand.push(card);
  }
}

// "Mano efectiva" para cualquier efecto que cuente animales "en tu mano":
// incluye la mano real MÁS lo ya jugado este turno (ver playedThisTurn), no
// solo `player.hand`. Úsalo en vez de leer `player.hand` directamente en
// cualquier efecto de este tipo, presente o futuro.
export function effectiveHand(player: Player): CardInstance[] {
  return [...player.hand, ...player.playedThisTurn];
}

// Cuando una carta jugada este turno se va del todo de la mano/descarte por
// OTRO efecto (el Flamenco la devuelve al mercado, el Murciélago la manda
// encima de su propio mazo), hay que sacarla también de playedThisTurn: si
// se queda ahí, effectiveHand() la sigue contando como "en tu mano" para el
// resto del turno (p. ej. un segundo Flamenco seguiría ofreciéndola como
// objetivo a devolver aunque el jugador ya no la tenga en ningún sitio
// válido). Sin efecto si la carta no estaba en la lista.
export function removeFromPlayedThisTurn(player: Player, instanceId: string): void {
  const idx = player.playedThisTurn.findIndex((c) => c.instanceId === instanceId);
  if (idx !== -1) player.playedThisTurn.splice(idx, 1);
}

