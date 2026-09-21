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
import type { Bot } from '../../src/bots/types';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import type { GameEdition, GameState, Player } from '../../src/model/state';
import { scoreGame, scorePlayer, type PlayerScore } from '../../src/scoring';
import { accumulateGrad, softmax, zeroGrad, type Gradient } from './train';
import { computeReturn } from './reward';
import scalerCalibrationData from './scalerCalibration.json';

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

function encodeActionsForPlayer(state: GameState, playerId: string, actions: Action[]): number[][] {
  return RL_EDITION === 'full'
    ? fullFeatures.encodeActionsForPlayer(state, playerId, actions)
    : classicFeatures.encodeActionsForPlayer(state, playerId, actions);
}

function encodePlayerContext(state: GameState, player: Player): number[] {
  return RL_EDITION === 'full' ? fullFeatures.encodePlayerContext(state, player) : classicFeatures.encodePlayerContext(state, player);
}

export const TRAIN_TEMPERATURE = 1;
export const MAX_ACTIONS_PER_GAME = 400;
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
// 0.05 para el especialista terrestre (2026-09-17): con 0.1 degeneró dos
// veces en condiciones idénticas a aves/acuático (scores de todas las
// compras comprimidos en 2-3 puntos, 20-28% de unidades saturadas, margen
// -3); con 0.05 completó 8000 batches sano (1% saturación, margen positivo)
// y ganó el 72% de 200 duelos a su versión de partida. Es el hábitat con
// más especies candidatas por decisión y el que más compite con el bot
// general por las mismas cartas, así que sus acciones forzadas son más
// ruido que señal. RL_EPSILON lo sobreescribe para cualquier variante.
const DEFAULT_EPSILON = process.env.RL_HABITAT === 'land' ? 0.05 : 0.1;
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
    const weights = deserializeWeights(readFileSync(path, 'utf-8'));
    if (weights.featureDim !== fullFeatures.FEATURE_DIM_FULL) return null;
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
// Edición completa: sin calibración propia todavía (scalerCalibration.json
// solo tiene entradas de la clásica) — shapedPurchaseValue ya maneja
// calibrated===undefined cayendo al delta en vivo sin más, así que esto
// simplemente empieza "sin calibrar" en vez de mezclar valores calculados
// para otro mazo. Se puede generar la suya propia más adelante con
// calibrateScalerValues.ts una vez haya un bot ya entrenado con el que jugar
// esas partidas.
export const SCALER_CALIBRATION: Record<string, number> =
  RL_EDITION === 'full'
    ? {}
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
export function shapedPurchaseValue(liveDelta: number, calibrated: number | undefined, roundProgress: number): number {
  if (calibrated === undefined) return liveDelta;
  return liveDelta + (1 - roundProgress) * Math.max(0, calibrated - liveDelta);
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

// Duraciones reales que se pueden elegir en la app (ver ROUND_LIMIT_OPTIONS
// en apps/web/src/lib/gameConfig.ts): entrenar siempre sin límite no
// representa ninguna partida real, así que cada episodio sortea una.
const REALISTIC_ROUND_LIMITS = [10, 15, 20] as const;
export function randomMaxRounds(): number {
  return REALISTIC_ROUND_LIMITS[Math.floor(Math.random() * REALISTIC_ROUND_LIMITS.length)];
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
export function playOneGame(weights: RlWeights): { trajectories: Map<string, Step[]>; finalScores: PlayerScore[] } {
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
    // Con un descarte pendiente (Buitre/Mono/Hiena/Murciélago), nadie tiene
    // ninguna acción legal hasta que se resuelva.
    if (autoResolvePendingDiscard(state)) {
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

    const chosenAction = actions[chosenIndex];
    const stateFeatures = encodePlayerContext(state, player);
    const boughtCardId =
      chosenAction.type === 'buyAnimal'
        ? state.animalTrack.find((c) => c.instanceId === chosenAction.trackInstanceId)?.id
        : undefined;
    const calibratedValue = boughtCardId ? SCALER_CALIBRATION[boughtCardId] : undefined;
    // scorePlayer a mitad de partida es puro (su fase destructiva solo corre
    // con gameOver && !scoringFinalized, ver scoring.ts).
    const scoreBefore = chosenAction.type === 'buyAnimal' ? scorePlayer(state, player) : 0;
    const roundProgress = state.maxRounds !== null ? Math.min(1, state.round / state.maxRounds) : 0;

    applyAction(state, player.id, chosenAction);

    const shapingBonus = chosenAction.type === 'buyAnimal' ? shapedPurchaseValue(scorePlayer(state, player) - scoreBefore, calibratedValue, roundProgress) / 20 : 0;

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

  return { trajectories, finalScores: scoreGame(state) };
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

  for (let e = 0; e < episodeCount; e++) {
    const { trajectories, finalScores } = playOneGame(weights);

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

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed };
}
