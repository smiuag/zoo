// Lógica de simulación de partidas y acumulación de gradiente, compartida
// entre el proceso principal de cada entrenamiento (selfPlay.ts) y sus
// procesos worker (worker.ts, ver RL_WORKERS en selfPlay.ts): ambos calculan
// EXACTAMENTE lo mismo (mismo playOneGame, misma matemática de ventaja),
// solo que cada uno simula una fracción de las EPISODES_PER_BATCH partidas
// de un batch en paralelo en vez de un único proceso jugándolas todas
// secuencialmente. Nunca importado desde src/index.ts ni desde apps/web.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import { createRlBotFull, rlBotFull } from '../../src/bots/rlBotFull';
import { heuristicBot } from '../../src/bots/heuristicBot';
import * as classicFeatures from '../../src/bots/rl/features';
import * as fullFeatures from '../../src/bots/rl/featuresFull';
import { deserializeWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import { migrateWeights } from './weightsIo';
import type { Bot } from '../../src/bots/types';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import {
  applyAction,
  autoResolvePendingDiscard,
  createGame,
  currentPurchasingPower,
  effectiveMarketCost,
  getActivePlayer,
  type Action,
} from '../../src/engine';
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import type { GameEdition, GameState, Player } from '../../src/model/state';
import { scoreGame, scorePlayer, type PlayerScore } from '../../src/scoring';
import { accumulateGrad, softmax, zeroGrad, type Gradient } from './train';
import { computeReturn } from './reward';
import scalerCalibrationData from './scalerCalibration.json';
import scalerCalibrationFullData from './scalerCalibrationFull.json';

// Edición para la que se entrena (2026-09-21): 'full' usa el codificador de
// features de la edición completa (ver featuresFull.ts, dimensión propia,
// nunca comparte pesos con la clásica) y crea las partidas con
// edition:'full' (mascotas/dinosaurios en el mercado). Por defecto 'classic'
// — sin la variable, CERO cambio de comportamiento respecto a antes de que
// existiera la edición completa.
export const RL_EDITION: GameEdition = process.env.RL_EDITION === 'full' ? 'full' : 'classic';

// Ambos codificadores son funciones puras sin estado ni importaciones
// circulares entre sí: se importan los 2 módulos siempre y se elige aquí, en
// tiempo de ejecución, cuál llamar — así no hace falta un import() dinámico
// para algo que se decide una única vez al arrancar el proceso (ver
// RL_EDITION arriba).
export const ACTIVE_FEATURE_DIM = RL_EDITION === 'full' ? fullFeatures.FEATURE_DIM_FULL : classicFeatures.FEATURE_DIM;
export const ACTIVE_CRITIC_FEATURE_DIM =
  RL_EDITION === 'full' ? fullFeatures.CRITIC_FEATURE_DIM_FULL : classicFeatures.CRITIC_FEATURE_DIM;
// Índice, dentro del vector de features de cada candidata, de liveScoreDelta
// (el PV que sumaría YA comprarla, sin calibración/normalización de coste) —
// se reutiliza para centrar el shaping de compra por la media de las
// candidatas (ver shapingBonus en playOneGame): ya está calculado para TODAS
// las candidatas al construir allFeatures, así que no hace falta volver a
// previsualizar nada.
export const ACTIVE_LIVE_DELTA_INDEX = RL_EDITION === 'full' ? fullFeatures.LIVE_DELTA_INDEX_FULL : classicFeatures.LIVE_DELTA_INDEX;

function encodeActionsForPlayer(state: GameState, playerId: string, actions: Action[]): number[][] {
  return RL_EDITION === 'full'
    ? fullFeatures.encodeActionsForPlayer(state, playerId, actions)
    : classicFeatures.encodeActionsForPlayer(state, playerId, actions);
}

function encodePlayerContext(state: GameState, player: Player): number[] {
  return RL_EDITION === 'full' ? fullFeatures.encodePlayerContext(state, player) : classicFeatures.encodePlayerContext(state, player);
}

export const TRAIN_TEMPERATURE = 1;
// Subido de 400 a 2000 (2026-09-24, pedido explícito del usuario): al
// relanzar el entrenamiento del especialista terrestre, ~84% de sus
// partidas se estaban cortando por este tope sin haber llegado a
// state.gameOver — comprobado que NO es un bucle real (el turno seguía
// avanzando turno a turno, sin quedarse atascado en el mismo), solo que con
// maxRounds alto (ver randomMaxRounds) 400 acciones no bastan para que una
// partida a 4 jugadores llegue a su fin natural. 2000 da margen de sobra sin
// dejar de proteger contra un bucle infinito real si apareciera uno.
export const MAX_ACTIONS_PER_GAME = 2000;
// Ver el comentario largo original (ahora aquí) sobre por qué hace falta
// cortar la ventaja: un crítico recién inicializado que predice mal produce
// una ventaja grande, que a su vez produce un gradiente grande que lo deja
// prediciendo aún peor al batch siguiente — un bucle que diverge a
// Infinity/NaN en unas pocas decenas de batches si no se recorta.
export const ADVANTAGE_CLIP = 5;
// Reward shaping (ver scoreBefore/shapingBonus más abajo): delta de PV en
// vivo que produce comprar un animal, sumado a la ventaja que mueve la
// política (nunca al objetivo del crítico, que predice el retorno real de
// fin de partida). Ver memoria rl_manual_card_boost_no_improvement.md.
// Por defecto 3 desde el 2026-09-17: con peso 1, tras 8000 batches el bot
// general seguía puntuando el Tucán en -48 (Tigre 97) en un mazo con 11
// animales de coste 5+, donde vale 13 PV reales; con peso 3, 8000 batches
// más lo dejaron como primera opción (104.4 vs 102.0) y la versión
// resultante ganó el 80% de 200 duelos a la anterior (100% vs heuristicBot).
// Aves y acuático también mejoraron con 3 (63% y 59% de duelos contra sus
// versiones con peso 1). El motivo: la ventaja terminal de una decisión
// suelta es muy ruidosa (|A| medio ~1 con resultado de partida a 4), y este
// término es la única señal limpia por decisión de "esta compra vale X PV
// ahora".
export const SHAPING_WEIGHT = Number(process.env.RL_SHAPING_WEIGHT ?? 3);

// Valor (en PV-equivalentes) de una carta extra en la mano, para el shaping
// de jugar cartas que roban (Cerdo, ver playOneGame) — pedido explícito del
// usuario 2026-09-22: "el ajuste no debería ser solo para no penalizar el
// gasto de la moneda, sino añadir el valor de la acción de alguna manera".
// Estimación conservadora del PV medio de una carta cualquiera (no viene de
// SCALER_CALIBRATION, que solo calibra las cartas "acumulativas" concretas,
// no esto) — fácil de ajustar si con el tiempo parece muy alta o muy baja.
export const CARD_DRAW_VALUE = Number(process.env.RL_CARD_DRAW_VALUE ?? 2);

// Exploración epsilon-greedy (2026-09-16): con esta probabilidad, la acción
// del aprendiz se elige UNIFORME entre las candidatas en vez de muestrear
// el softmax de sus scores. Motivo: el softmax a temperatura 1 sobre scores
// que se separan 40-80 puntos es en la práctica un argmax — una carta que
// cae 10 puntos por detrás de la mejor tiene p≈5e-5 de volver a probarse,
// y a 70 puntos (Tucán en el bot general, ver reviveDeadCards.ts) p=0.
// Como el término de gradiente de una acción no elegida es -p_k·ventaja ≈
// 0, su score no recibe NINGUNA corrección nunca más: un pozo del que es
// imposible salir. Ni un bonus de entropía lo arregla (su gradiente también
// es proporcional a p_k). Solo una elección forzada le da muestras reales:
// el gradiente de la acción elegida es (1-p_k)·ventaja ≈ ventaja, sea cual
// sea su score actual. Off-policy leve, aceptable con epsilon pequeño (la
// ventaja ya va recortada a ±ADVANTAGE_CLIP).
//
// 0.05 para el especialista terrestre CLÁSICO (2026-09-17): con 0.1 degeneró
// dos veces en condiciones idénticas a aves/acuático (scores de todas las
// compras comprimidos en 2-3 puntos, 20-28% de unidades saturadas, margen
// -3); con 0.05 completó 8000 batches sano (1% saturación, margen positivo)
// y ganó el 72% de 200 duelos a su versión de partida. Es el hábitat con
// más especies candidatas por decisión y el que más compite con el bot
// general por las mismas cartas, así que sus acciones forzadas son más
// ruido que señal. RL_EPSILON lo sobreescribe para cualquier variante.
//
// 0 para la EDICIÓN COMPLETA, las 4 variantes (2026-09-23, a raíz del
// acuático obsesionado con Tiranosaurio/Diplodocus): la excepción de hábitat
// "dinosaurios de coste >=7" añadida el 22/09 les abrió una compra nueva
// cuyo valor real (Tucán/Plesiosaurio/Albatros/Orca reaccionando) es alto
// carta a carta pero pésimo para el resultado final — y el 10% de
// exploración aleatoria bastaba para que la política la descubriera y
// se autorreforzara en bucle (softmax sobre su propio score cada vez más
// alto), sin que tocar el coste normalizado del shaping ni bajar
// SHAPING_WEIGHT lo arreglara. Con epsilon=0 desaparece el bucle en las 4
// variantes (probado con partidas reales contra las 3 baselines hermanas:
// PV medio y % de victorias suben en las 4, no solo en el acuático). El
// riesgo documentado de epsilon=0 (una carta cae en un pozo del que ya no
// se muestrea nunca más, ver el bloque de arriba) sigue siendo real — vigilar
// cartas muertas tras cada entrenamiento largo de la completa igual que
// siempre, con más atención al no tener ya el paracaídas de la exploración
// forzada. RL_EPSILON lo sobreescribe igualmente si hace falta.
const DEFAULT_EPSILON = process.env.RL_EDITION === 'full' ? 0 : process.env.RL_HABITAT === 'land' ? 0.05 : 0.1;
export const EPSILON = Number(process.env.RL_EPSILON ?? DEFAULT_EPSILON);

// Suelo blando (2026-09-16), DESACTIVADO por defecto: en cada decisión de
// compra, cualquier buyAnimal cuyo score quede por debajo del de endTurn
// recibiría un empujón hacia él (delta = FLOOR_WEIGHT · (score_endTurn −
// score_k), ver accumulateFloorGrad). La idea era complementar a EPSILON
// evitando que una carta se hunda tanto que tarde cientos de batches en
// volver. MEDIDO en ablaciones de 40 batches desde los pesos rescatados
// (reviveDeadCards.ts): con peso 0.1 el retorno medio cae de +1.5 a −2 en
// 20 batches; con 0.01 baja de +0.2 a −0.9 en 40; sin suelo (solo epsilon)
// se mantiene estable. Con ~37% de las candidatas justo en el borde del
// suelo, su gradiente agregado (sobre columnas de contexto compartidas por
// todas las candidatas, w2, b1...) domina al de la política y la
// desordena. Se deja como opción (RL_FLOOR_WEIGHT>0) por si se quiere
// volver a probar con otro diseño, pero el antipozo real es EPSILON.
export const FLOOR_WEIGHT = Number(process.env.RL_FLOOR_WEIGHT ?? 0);

// Entrena un especialista de hábitat (RL_HABITAT=land|bird|aquatic): el
// aprendiz solo puede comprar animales de ese hábitat. Sin la variable,
// entrena el bot normal sin restricciones.
export const HABITAT_FILTER = process.env.RL_HABITAT;
if (HABITAT_FILTER && !['land', 'bird', 'aquatic'].includes(HABITAT_FILTER)) {
  throw new Error(`RL_HABITAT inválido: "${HABITAT_FILTER}" (usa land, bird o aquatic)`);
}

// Las otras 3 variantes de rlBot (pesos ya guardados en disco al arrancar
// este proceso, congelados durante todo este entrenamiento): desde
// 2026-09-14 son SIEMPRE los 3 oponentes de cada partida de entrenamiento
// (ver playOneGame más abajo), una de cada. Se excluye la variante que se
// está entrenando ahora mismo de esta lista.
export const RL_VARIANT_BOTS: Record<'general' | 'land' | 'bird' | 'aquatic', Bot> = {
  general: rlBot,
  land: landRlBot,
  bird: birdRlBot,
  aquatic: aquaticRlBot,
};
export const CURRENT_VARIANT = (HABITAT_FILTER as 'land' | 'bird' | 'aquatic' | undefined) ?? 'general';

const FULL_WEIGHTS_DIR = fileURLToPath(new URL('../../src/bots/rl/', import.meta.url));
const FULL_HABITATS = ['land', 'bird', 'aquatic'] as const;

// Especialista de hábitat de la edición completa cuyos pesos ya existen en
// disco AL ARRANCAR este proceso (congelados durante todo este
// entrenamiento, igual que RL_VARIANT_BOTS para la clásica) — o null si
// todavía no se ha entrenado ninguno (primera tanda de los 3 especialistas,
// lanzados a la vez: ninguno ve todavía a los otros 2, solo al generalista).
// Entrenar uno más tarde (p. ej. "más batches para tierra" una vez ya
// existan bird/aquatic) sí los vería, sin cambiar nada de este código.
function loadFullSpecialistIfExists(habitat: (typeof FULL_HABITATS)[number]): Bot | null {
  const path = `${FULL_WEIGHTS_DIR}weights-full-${habitat}.json`;
  if (!existsSync(path)) return null;
  try {
    const raw = deserializeWeights(readFileSync(path, 'utf-8'));
    const weights = migrateWeights(raw, fullFeatures.FEATURE_DIM_FULL);
    if (!weights) return null;
    return createRlBotFull({ weights, habitatFilter: habitat });
  } catch {
    return null;
  }
}

// Edición completa (2026-09-21): todavía no hay hermanos RL con solera (ver
// rlBotFull.ts) — mismo punto de partida que tuvo que tener el primer bot
// clásico alguna vez. El generalista ('weights-full.json', ya entrenado y
// evaluado: 99% de victorias contra el heurístico en 200 partidas) SIEMPRE
// es uno de los 3 oponentes; los otros 2 son los especialistas HERMANOS
// (nunca el mismo que se está entrenando) si ya existen en disco, o el
// heurístico si no. Sin HABITAT_FILTER (entrenando el generalista de nuevo),
// se mantienen los 3 heurísticos de siempre.
export const RL_CURRICULUM_OPPONENTS =
  RL_EDITION === 'full'
    ? HABITAT_FILTER
      ? [
          rlBotFull,
          ...FULL_HABITATS.filter((h) => h !== HABITAT_FILTER).map((h) => loadFullSpecialistIfExists(h) ?? heuristicBot),
        ]
      : [heuristicBot, heuristicBot, heuristicBot]
    : Object.entries(RL_VARIANT_BOTS)
        .filter(([variant]) => variant !== CURRENT_VARIANT)
        .map(([, bot]) => bot);

// Pedido explícito del usuario (2026-09-14): las cartas con un efecto
// onScore "acumulativo" (Águila/Orca/Oso polar: scorePerHabitatCount;
// Albatros: scorePerDistinctSpecies; Tucán: scorePerCostAtLeast) tienen las
// 5 el mismo problema — 0 PV impreso, todo su valor depende de cuánto
// acabe teniendo el resto de la colección — así que el delta de PV en vivo
// justo al comprarlas (ver SHAPING_WEIGHT/playOneGame más abajo) es casi
// nulo tan pronto en la partida como se suelen comprar: compiten en
// desventaja constante contra cualquier carta con PV impreso alto (que sí
// recibe crédito inmediato y seguro), aunque a la larga valgan más. En vez
// de intentar separar "PV impreso vs dinámico" del delta, se sustituye
// directamente por el valor MEDIO que de verdad suelen acabar aportando
// (precalculado jugando partidas de verdad, ver
// scripts/rl/calibrateScalerValues.ts) — "asignado como si fuera fijo" a
// efectos de valorar la carta, específico de esta variante (Orca vale más
// en aquatic que en general, por ejemplo, porque un aquatic acumula más
// animales acuáticos de media). Se regenera a mano cuando cambien estas
// cartas o el balance general del mazo — no en cada batch de
// entrenamiento, sería demasiado caro.
// Edición completa (2026-09-22, pedido explícito del usuario a raíz del
// Plesiosaurio y la Oca — ambas quedaban prácticamente muertas sin esto,
// "es absurdo, son algunas de las cartas que más puntos dan"): calibración
// propia, generada con calibrateScalerValuesFull.ts contra los bots YA
// entrenados de la completa — nunca se reutilizan los números de la
// clásica (scalerCalibration.json), calculados con un mazo distinto (más
// especies por hábitat en la completa, así que el mismo efecto "+1PV por
// acuático en tu colección" cuenta de media un número distinto de
// cartas). A diferencia de la clásica, calibrateScalerValuesFull.ts
// escanea TODAS las cartas cargadas buscando COMPOUNDING_SCORE_EFFECT_TYPES
// en vez de una lista de ids a mano (así se cubre automáticamente cualquier
// carta nueva con ese tipo de efecto, sin tener que acordarse de añadirla
// aquí) — hoy cubre Águila/Orca/Oso polar/Albatros/Tucán/Oca (heredadas de
// la clásica o propias) más Tiburón/Plesiosaurio (propias de la completa).
// Se regenera a mano tras un reentrenamiento grande de la completa (nunca
// en cada batch): `npx vite-node scripts/rl/calibrateScalerValuesFull.ts`.
export const SCALER_CALIBRATION: Record<string, number> =
  RL_EDITION === 'full'
    ? ((scalerCalibrationFullData as Record<string, Record<string, number>>)[CURRENT_VARIANT] ?? {})
    : ((scalerCalibrationData as Record<string, Record<string, number>>)[CURRENT_VARIANT] ?? {});

// Valor de shaping de una compra (2026-09-16, sustituye a "la constante
// calibrada entera" para las cartas acumulativas): `liveDelta` es lo que la
// compra suma al marcador YA (PV impreso + efectos sobre la colección
// actual, p. ej. Tucán con 11 animales de coste 5+ = 12), y `calibrated` el
// valor final MEDIO que esa carta acaba aportando en partidas reales (ver
// SCALER_CALIBRATION), o undefined para cartas normales. Se interpola con
// las rondas que quedan: al principio de la partida (roundProgress≈0) manda
// el calibrado si es mayor (lo que hoy vale poco crecerá); en el último
// turno (roundProgress=1) manda EXACTAMENTE el delta real, que es lo único
// que cuenta cuando ya no hay más turnos; y nunca queda por debajo del
// delta real, porque la colección solo crece. Antes el Tucán recibía el
// mismo shaping (5.6) tuviera 0 u 11 animales caros — justo el dato que le
// diría a la red "aquí vale 12" se tiraba.
// Normalización por coste (pedido explícito del usuario 2026-09-22, a raíz
// del entrenamiento acuático de 100K roto: el Tiranosaurio/Diplodocus, recién
// comprables gracias a la excepción de hábitat "dinosaurios de coste >=7",
// nunca habían recibido gradiente antes, y con PV impreso alto (10) frente a
// coste alto (9-11) su shaping en bruto competía con la mitad del tope de
// ventaja terminal — la red se lanzó a comprarlos sin haber aprendido aún
// que ese oro gastado deja sin monedas la sinergia acuática real, y el PV
// final se desplomó de 178 a 99 en partidas reales). Solo se normaliza el
// delta EN VIVO (`liveDelta`, el PV impreso/real de la propia compra) — el
// valor `calibrated` de las cartas acumulativas (Tucán, Plesiosaurio...) NO
// se toca: ya es un valor medio realmente aportado en partidas de verdad
// (ver SCALER_CALIBRATION), no una cifra de catálogo con sesgo de coste, y
// dividirlo también por coste habría vuelto a hundir justo las cartas caras
// (Plesiosaurio, coste 13) que se rescataron esta misma sesión.
export function shapedPurchaseValue(liveDelta: number, calibrated: number | undefined, roundProgress: number, cost: number): number {
  const normalizedLiveDelta = liveDelta / Math.max(1, cost);
  if (calibrated === undefined) return normalizedLiveDelta;
  return normalizedLiveDelta + (1 - roundProgress) * Math.max(0, calibrated - liveDelta);
}

export function filterActionsForHabitat(state: GameState, actions: Action[]): Action[] {
  if (!HABITAT_FILTER) return actions;
  return filterActionsByHabitat(state, actions, HABITAT_FILTER);
}

// Puntúa y elige, en modo greedy (temperature 0), entre las acciones legales
// ya filtradas por hábitat. Solo lo usa evaluate() en selfPlay.ts.
export function chooseLearnerAction(state: GameState, playerId: string, weights: RlWeights): Action {
  const actions = filterUpgradeChoicesForRl(state, playerId, filterActionsForHabitat(state, legalActionsForBot(state, playerId)));
  if (actions.length === 0) return { type: 'endTurn' };
  const scores = encodeActionsForPlayer(state, playerId, actions).map((x) => forward(weights, x).score);
  const best = Math.max(...scores);
  const bestIdx = actions.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
  return actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]];
}

// Replica tests/helpers.ts / apps/web/src/lib/starterDeck.ts (no exportado
// desde el paquete, así que cada consumidor lo define localmente).
export function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

// Duración fija a 15 rondas (pedido explícito del usuario 2026-09-23): antes
// sorteaba entre las duraciones reales de la app (10/15/20, ver
// ROUND_LIMIT_OPTIONS en apps/web/src/lib/gameConfig.ts) para no entrenar
// siempre sin límite, pero eso metía ruido extra en las comparaciones
// manuales entre checkpoints (dos tandas de partidas del MISMO bot podían
// salir distintas solo por la duración sorteada, no por ningún cambio real).
// Con una duración fija, esa fuente de ruido desaparece — tanto en el
// entrenamiento real como en cualquier script de comparación que importe
// esta misma función (todos lo hacen, ver randomMaxRounds más abajo).
// Nombre de la función sin cambiar a propósito: la usan 19 ficheros y ya no
// es literalmente "aleatoria", pero renombrarla no aporta nada aquí.
// RL_MAX_ROUNDS la sobreescribe si hace falta algo distinto puntualmente.
export function randomMaxRounds(): number {
  return Number(process.env.RL_MAX_ROUNDS ?? 15);
}

export function sampleIndex(scores: number[], temperature: number): number {
  const probs = softmax(scores.map((s) => s / temperature));
  let roll = Math.random();
  for (let i = 0; i < probs.length; i++) {
    roll -= probs[i];
    if (roll <= 0) return i;
  }
  return probs.length - 1;
}

export interface Step {
  allFeatures: number[][];
  allHidden: Float64Array[];
  allScores: number[];
  // Tipo de cada acción candidata, en el mismo orden que allFeatures/
  // allScores: lo usa el suelo blando (FLOOR_WEIGHT) para saber cuál es
  // endTurn y cuáles son compras de animal.
  actionTypes: Action['type'][];
  chosenIndex: number;
  // Features de SOLO ESTADO en el momento de esta decisión (antes de
  // elegir la acción) — ver CRITIC_FEATURE_DIM/encodePlayerContext en
  // features.ts. El crítico las usa para estimar cuánto "vale" ya este
  // estado, independientemente de qué se acabe eligiendo.
  stateFeatures: number[];
  // Reward shaping (ver SHAPING_WEIGHT arriba): delta de PV en vivo que
  // produjo la acción elegida, ya escalado (/20). 0 para cualquier acción
  // que no sea comprar un animal.
  shapingBonus: number;
}

// Pedido explícito del usuario (2026-09-14, confirmado de nuevo más tarde
// ese mismo día con "siempre partidas de 4 con uno de cada" tras probar
// brevemente el self-play puro para "general"): cada partida de
// entrenamiento, para las 4 variantes por igual (general incluido), tiene
// exactamente 1 asiento del aprendiz (el que se está actualizando) y los
// otros 3 son las OTRAS 3 variantes de rlBot (RL_CURRICULUM_OPPONENTS,
// pesos congelados leídos del disco al arrancar este proceso), una de cada
// — nunca self-play puro ni bots fijos no-RL (esos quedan solo para
// evaluate() en selfPlay.ts).
export function playOneGame(
  weights: RlWeights
): { trajectories: Map<string, Step[]>; finalScores: PlayerScore[]; truncated: boolean } {
  const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
  const state = createGame(playerConfigs, { maxRounds: randomMaxRounds(), edition: RL_EDITION });

  const fixedOpponents = new Map<string, Bot>();
  for (let i = 1; i < playerConfigs.length; i++) {
    fixedOpponents.set(playerConfigs[i].id, RL_CURRICULUM_OPPONENTS[i - 1]);
  }

  const trajectories = new Map<string, Step[]>();
  for (const cfg of playerConfigs) {
    if (!fixedOpponents.has(cfg.id)) trajectories.set(cfg.id, []);
  }

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    // Descarte forzoso pendiente (Buitre/Mono/Hiena/Tiranosaurio...): nadie
    // más tiene ninguna acción legal hasta que se resuelva. Pedido explícito
    // del usuario 2026-09-22: si el que debe algo es el propio aprendiz, ya
    // NO se auto-resuelve con la heurística de siempre — se puntúa/elige/
    // registra exactamente como cualquier otra decisión suya, para que
    // pueda aprender a elegir (Gato/Murciélago como sustituto, o la carta
    // menos valiosa entre varias elegibles) en vez de que esa elección
    // quede siempre fuera de su control. Los rivales fijos de la partida
    // siguen auto-resolviéndose con la heurística: no aporta nada
    // puntuarles esta decisión con su propia red (mucho más caro) para algo
    // que el aprendiz ni siquiera ve.
    if (state.pendingDecision) {
      const owedId = Object.keys(state.pendingDecision.owed)[0];
      if (!owedId) {
        state.pendingDecision = null;
        guard++;
        continue;
      }
      if (!trajectories.has(owedId)) {
        autoResolvePendingDiscard(state);
        guard++;
        continue;
      }

      const owedPlayer = state.players.find((p) => p.id === owedId)!;
      const decisionKind = state.pendingDecision.kind;
      const actions = legalActionsForBot(state, owedId);
      if (actions.length === 0) {
        guard++;
        continue;
      }

      const allFeatures = encodeActionsForPlayer(state, owedId, actions);
      const allForward = allFeatures.map((x) => forward(weights, x));
      const allScores = allForward.map((f) => f.score);
      const chosenIndex =
        Math.random() < EPSILON ? Math.floor(Math.random() * actions.length) : sampleIndex(allScores, TRAIN_TEMPERATURE);
      const chosenAction = actions[chosenIndex] as Extract<Action, { type: 'resolveDiscard' }>;
      const stateFeatures = encodePlayerContext(state, owedPlayer);

      // Valor evitado (pedido explícito del usuario 2026-09-22): cuánto PV
      // valía la alternativa más cara de las elegibles, comparado con lo que
      // de verdad se pierde. Con el Gato/Murciélago/Perezoso como sustituto
      // no se pierde nada de verdad (la carta va al descarte, sigue siendo
      // tuya, se puede volver a robar) — se comprueba mirando si
      // destroyedCards creció de verdad tras resolver, no adivinando qué
      // sustituto se usó. Solo aplica a 'destroy' (perder una carta para
      // siempre): 'discard'/'giveToPlayer' no tienen un "más o menos grave"
      // igual de claro, así que no se tocan.
      const eligibleCards = [...owedPlayer.hand, ...owedPlayer.table].filter((c) =>
        actions.some((a) => a.type === 'resolveDiscard' && a.instanceId === c.instanceId)
      );
      const chosenCard = eligibleCards.find((c) => c.instanceId === chosenAction.instanceId);
      const worstCaseValue = eligibleCards.reduce((max, c) => Math.max(max, c.victoryPoints ?? 0), 0);
      const destroyedCountBefore = owedPlayer.destroyedCards.length;

      applyAction(state, owedId, chosenAction);

      let shapingBonus = 0;
      if (decisionKind === 'destroy') {
        const actuallyDestroyed = owedPlayer.destroyedCards.length > destroyedCountBefore;
        const givenUpValue = actuallyDestroyed ? (chosenCard?.victoryPoints ?? 0) : 0;
        shapingBonus = (worstCaseValue - givenUpValue) / 20;
      }

      trajectories.get(owedId)?.push({
        allFeatures,
        allHidden: allForward.map((f) => f.hidden),
        allScores,
        actionTypes: actions.map((a) => a.type),
        chosenIndex,
        stateFeatures,
        shapingBonus,
      });

      guard++;
      continue;
    }

    const player = getActivePlayer(state);
    const fixedBot = fixedOpponents.get(player.id);

    if (fixedBot) {
      applyAction(state, player.id, fixedBot.chooseAction(state, player.id));
      guard++;
      continue;
    }

    // Ley de todos los bots (ver actionPriority.ts): jugar antes que
    // comprar, y robar antes que cualquier otra carta — aplicada aquí para
    // que el propio aprendiz nunca vea (ni pueda aprender a elegir) comprar
    // teniendo mano por jugar, exactamente igual que cualquier otro bot.
    const actions = filterUpgradeChoicesForRl(state, player.id, filterActionsForHabitat(state, legalActionsForBot(state, player.id)));
    if (actions.length === 0) break;

    const allFeatures = encodeActionsForPlayer(state, player.id, actions);
    const allForward = allFeatures.map((x) => forward(weights, x));
    const allScores = allForward.map((f) => f.score);
    const chosenIndex =
      Math.random() < EPSILON ? Math.floor(Math.random() * actions.length) : sampleIndex(allScores, TRAIN_TEMPERATURE);

    // Media de liveScoreDelta (2026-09-23, pedido explícito del usuario)
    // entre TODAS las candidatas de COMPRA de esta decisión (solo las que el
    // jugador puede pagar ahora mismo — getLegalActions ya filtra por
    // canAffordMarket antes de que lleguen aquí), no solo la elegida. Se
    // resta del shaping de comprar más abajo para que ese término deje de
    // tener media positiva: hoy, casi cualquier compra con PV≥0 suma un
    // shaping ≥0 sin comparar con lo que había disponible, así que el
    // gradiente de CUALQUIER candidata no elegida (delta_k = -prob_k ·
    // policyAdvantage) empuja hacia abajo a TODAS las demás con
    // policyAdvantage casi siempre positivo — incluida una carta que fuera
    // igual de buena o mejor que la comprada, solo por no haber sido la
    // elegida esa vez. Centrado por la media, solo se castiga a las
    // alternativas cuando la compra elegida fue genuinamente mejor que la
    // media de lo disponible, y una compra mediocre deja de arrastrar hacia
    // abajo a las demás. Ya está calculado sin coste extra: liveScoreDelta
    // vive en ACTIVE_LIVE_DELTA_INDEX de cada vector de allFeatures.
    const buyAnimalLiveDeltas = actions
      .map((a, i) => (a.type === 'buyAnimal' ? allFeatures[i][ACTIVE_LIVE_DELTA_INDEX] : null))
      .filter((v): v is number => v !== null);
    const meanBuyLiveDelta =
      buyAnimalLiveDeltas.length > 0 ? buyAnimalLiveDeltas.reduce((sum, v) => sum + v, 0) / buyAnimalLiveDeltas.length : 0;

    const chosenAction = actions[chosenIndex];
    const stateFeatures = encodePlayerContext(state, player);
    const boughtCard =
      chosenAction.type === 'buyAnimal' ? state.animalTrack.find((c) => c.instanceId === chosenAction.trackInstanceId) : undefined;
    const calibratedValue = boughtCard ? SCALER_CALIBRATION[boughtCard.id] : undefined;
    // scorePlayer a mitad de partida es puro (su fase destructiva solo corre
    // con gameOver && !scoringFinalized, ver scoring.ts).
    const scoreBefore = chosenAction.type === 'buyAnimal' ? scorePlayer(state, player) : 0;
    // Descuento REAL pagado por dinosaurio comprado (pedido explícito del
    // usuario 2026-09-22). Se calcula ANTES de aplicar la acción
    // (effectiveMarketCost depende de los dinosaurios ya jugados este turno,
    // no de esta compra). Las cartas sin costReductionPerDinosaurPlayedThisTurn
    // dan descuento 0, así que esto no cambia nada para el resto del mercado.
    //
    // OJO (bug encontrado y corregido el mismo 2026-09-22, tras un primer
    // intento roto): este descuento NO se suma al delta de PV en el
    // numerador. Se probó así al principio ("1 de ahorro vale 1 de PV") y
    // combinado con la normalización por coste de más abajo (dividir por el
    // precio YA rebajado) contaba el mismo descuento DOS veces — numerador
    // más grande y denominador más pequeño a la vez —, así que un
    // Tiranosaurio muy rebajado por encadenar dinosaurios quedaba con un
    // shaping MÁS inflado que antes del arreglo de coste, no menos (PV medio
    // real 165→133, Pez Dorado/Foca muertos otra vez, verificado con 250
    // partidas reales tras ~2500 batches). El ahorro ya queda reflejado
    // correctamente y una sola vez al dividir por el precio pagado (más
    // abajo): un Tiranosaurio a mitad de precio ya sale con el doble de
    // eficiencia PV/coste sin necesidad de este crédito adicional.
    const discountRealized = boughtCard ? (boughtCard.marketCost ?? 0) - effectiveMarketCost(player, boughtCard) : 0;
    // Valor de captura ganado al JUGAR una carta (Mono/Ornitorrinco/Delfín/
    // Loro...), no al comprarla — pedido explícito del usuario 2026-09-22.
    // Antes esto no recibía NINGÚN shaping (solo buyAnimal lo tenía), así
    // que el propio acto de jugar estas cartas era invisible para el
    // entrenamiento salvo por su PV impreso (casi siempre 0). Efecto
    // colateral buscado: un turno en que el Perro/Hámster ya estén
    // generando valor de captura extra, jugar Mono/Ornitorrinco ese mismo
    // turno da un shaping más alto sin necesidad de detectar la sinergia a
    // mano — el número ya sale más alto solo porque currentPurchasingPower
    // sube más ese turno en concreto.
    const purchasingPowerBefore = chosenAction.type === 'playCard' ? currentPurchasingPower(player) : 0;
    // Cuántas cartas hay en la mano justo antes de jugar esta (incluida ella
    // misma) — ver netCardsGained más abajo.
    const handLengthBefore = chosenAction.type === 'playCard' ? player.hand.length : 0;
    const roundProgress = state.maxRounds !== null ? Math.min(1, state.round / state.maxRounds) : 0;

    applyAction(state, player.id, chosenAction);

    let shapingBonus = 0;
    if (chosenAction.type === 'buyAnimal') {
      const pvDelta = scorePlayer(state, player) - scoreBefore;
      const pricePaid = (boughtCard?.marketCost ?? 0) - discountRealized;
      shapingBonus = shapedPurchaseValue(pvDelta, calibratedValue, roundProgress, pricePaid) / 20 - meanBuyLiveDelta;
    } else if (chosenAction.type === 'playCard') {
      // Ajustado (pedido explícito del usuario 2026-09-22, "no solo para no
      // penalizar el gasto de la moneda, sino añadir el valor de la acción
      // de alguna manera"): descartar una moneda para conseguir algo que no
      // es dinero (Cerdo roba cartas, Nutria mira 3 y se queda 1) bajaba
      // currentPurchasingPower sin que nada compensara esa bajada, así que
      // el Cerdo puntuaba siempre negativo pese a ser una carta claramente
      // buena — el acuático, que compra mucho Pez Dorado, lo notaba más.
      // Dos piezas:
      // 1. El delta de valor de captura nunca resta (suelo en 0): sigue
      //    premiando un buen intercambio (Pez Dorado con una moneda floja),
      //    pero deja de castigar el simple hecho de gastar una moneda en
      //    algo que no es dinero.
      // 2. netCardsGained: cuántas cartas de más quedan en la mano, ya
      //    compensando que la propia carta jugada sale de ella (jugar una
      //    carta sin ningún robo/descarte da 0, ni premia ni castiga). El
      //    Cerdo escala solo con esto: Bronce -> 0 extra, Oro -> +2,
      //    Platino -> +4 — más moneda arriesgada, más cartas, más shaping.
      //    La Nutria (mira 3, quédate 1) se queda en 0: no cambia cuántas
      //    cartas tienes, solo CUÁLES — esa parte queda sin resolver todavía,
      //    limitación conocida, no un intento fallido.
      const purchasingPowerDelta = currentPurchasingPower(player) - purchasingPowerBefore;
      const netCardsGained = player.hand.length - handLengthBefore + 1;
      shapingBonus = (Math.max(0, purchasingPowerDelta) + netCardsGained * CARD_DRAW_VALUE) / 20;
    }

    trajectories.get(player.id)?.push({
      allFeatures,
      allHidden: allForward.map((f) => f.hidden),
      allScores,
      actionTypes: actions.map((a) => a.type),
      chosenIndex,
      stateFeatures,
      shapingBonus,
    });

    guard++;
  }

  // Pedido explícito del usuario 2026-09-23 (comprobación de si el tope de
  // seguridad MAX_ACTIONS_PER_GAME llega a alcanzarse): si el bucle salió
  // porque se agotó el guard y NO porque la partida terminase de verdad
  // (state.gameOver), esta partida se cortó en seco a mitad — su
  // finalScores es el de un estado INCOMPLETO, no el de una partida
  // jugada hasta el final. Se reporta en selfPlay.ts (truncated_games en
  // el log de cada batch) para poder detectarlo si empieza a pasar.
  const truncated = !state.gameOver && guard >= MAX_ACTIONS_PER_GAME;
  return { trajectories, finalScores: scoreGame(state), truncated };
}

// Suelo blando (ver FLOOR_WEIGHT): para cada compra de animal candidata
// cuyo score esté por debajo del de endTurn en esta misma decisión, suma el
// gradiente que la empujaría hacia ese score (regresión hacia el suelo, no
// más allá). Sin endTurn entre las candidatas (decisiones de jugar carta,
// descartes...) no hace nada.
export function accumulateFloorGrad(grad: Gradient, step: Step, w2: Float64Array, floorWeight = FLOOR_WEIGHT): void {
  if (floorWeight <= 0) return;
  const endTurnIndex = step.actionTypes.indexOf('endTurn');
  if (endTurnIndex === -1) return;
  const floor = step.allScores[endTurnIndex];
  for (let k = 0; k < step.allScores.length; k++) {
    if (step.actionTypes[k] !== 'buyAnimal' || step.allScores[k] >= floor) continue;
    accumulateGrad(grad, step.allFeatures[k], step.allHidden[k], w2, floorWeight * (floor - step.allScores[k]));
  }
}

export interface EpisodeBatchResult {
  grad: Gradient;
  criticGrad: Gradient;
  sumAbsAdvantage: number;
  sumReturn: number;
  stepCount: number;
  episodesUsed: number;
  // Cuántas de las partidas de este lote se cortaron por el tope de
  // seguridad MAX_ACTIONS_PER_GAME en vez de terminar de verdad (ver
  // playOneGame). Debería ser 0 casi siempre; un valor no nulo sostenido
  // señala partidas anormalmente largas (posible bucle/atasco real).
  truncatedGames: number;
}

// Juega `episodeCount` partidas y acumula el gradiente resultante (política +
// crítico) SIN aplicarlo — aplicar el gradiente y guardar a disco sigue
// siendo responsabilidad exclusiva del proceso principal (selfPlay.ts), que
// suma los EpisodeBatchResult de todos sus workers (ver mergeEpisodeResults)
// más su propia cuota antes de una única actualización por batch. Idéntico
// resultado matemático a jugar las EPISODES_PER_BATCH completas en un solo
// proceso: la suma de gradientes es conmutativa/asociativa.
export function runEpisodes(weights: RlWeights, criticWeights: RlWeights, episodeCount: number): EpisodeBatchResult {
  const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
  const criticGrad = zeroGrad(criticWeights.featureDim, criticWeights.hiddenSize);
  let episodesUsed = 0;
  let sumAbsAdvantage = 0;
  let sumReturn = 0;
  let stepCount = 0;
  let truncatedGames = 0;

  for (let e = 0; e < episodeCount; e++) {
    const { trajectories, finalScores, truncated } = playOneGame(weights);
    if (truncated) truncatedGames++;

    for (const [playerId, steps] of trajectories) {
      if (steps.length === 0) continue;

      const returnValue = computeReturn(finalScores, playerId);
      sumReturn += returnValue;

      for (const step of steps) {
        // Ventaja CONDICIONADA AL ESTADO de este paso concreto (ver Step
        // arriba): el crítico predice cuánto "debería" valer el retorno
        // esperado ya desde este estado, y la ventaja es cuánto se quedó
        // corto o se pasó esa predicción respecto al retorno real.
        const critic = forward(criticWeights, step.stateFeatures);
        const rawAdvantage = returnValue - critic.score;
        const advantage = Math.max(-ADVANTAGE_CLIP, Math.min(ADVANTAGE_CLIP, rawAdvantage));
        sumAbsAdvantage += Math.abs(rawAdvantage);
        stepCount++;

        // El shaping SOLO se añade a la ventaja que mueve la POLÍTICA, nunca
        // a la que regresiona el crítico.
        const policyAdvantage = advantage + SHAPING_WEIGHT * step.shapingBonus;

        const probs = softmax(step.allScores);
        for (let k = 0; k < probs.length; k++) {
          const delta = ((k === step.chosenIndex ? 1 : 0) - probs[k]) * policyAdvantage;
          accumulateGrad(grad, step.allFeatures[k], step.allHidden[k], weights.w2, delta);
        }
        accumulateFloorGrad(grad, step, weights.w2);
        accumulateGrad(criticGrad, step.stateFeatures, critic.hidden, criticWeights.w2, advantage);
      }
      episodesUsed++;
    }
  }

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed, truncatedGames };
}
