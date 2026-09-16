// Lógica de simulación de partidas y acumulación de gradiente, compartida
// entre el proceso principal de cada entrenamiento (selfPlay.ts) y sus
// procesos worker (worker.ts, ver RL_WORKERS en selfPlay.ts): ambos calculan
// EXACTAMENTE lo mismo (mismo playOneGame, misma matemática de ventaja),
// solo que cada uno simula una fracción de las EPISODES_PER_BATCH partidas
// de un batch en paralelo en vez de un único proceso jugándolas todas
// secuencialmente. Nunca importado desde src/index.ts ni desde apps/web.
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import { encodeActionsForPlayer, encodePlayerContext } from '../../src/bots/rl/features';
import { forward, type RlWeights } from '../../src/bots/rl/network';
import type { Bot } from '../../src/bots/types';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import type { GameState } from '../../src/model/state';
import { scoreGame, scorePlayer, type PlayerScore } from '../../src/scoring';
import { accumulateGrad, softmax, zeroGrad, type Gradient } from './train';
import { computeReturn } from './reward';
import scalerCalibrationData from './scalerCalibration.json';

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
export const SHAPING_WEIGHT = Number(process.env.RL_SHAPING_WEIGHT ?? 1);

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
export const RL_CURRICULUM_OPPONENTS = Object.entries(RL_VARIANT_BOTS)
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
export const SCALER_CALIBRATION: Record<string, number> = (
  scalerCalibrationData as Record<string, Record<string, number>>
)[CURRENT_VARIANT] ?? {};

export function filterActionsForHabitat(state: GameState, actions: Action[]): Action[] {
  if (!HABITAT_FILTER) return actions;
  return actions.filter((a) => {
    if (a.type !== 'buyAnimal') return true;
    const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
    return (animal?.habitats as string[] | undefined)?.includes(HABITAT_FILTER) ?? false;
  });
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
  const state = createGame(playerConfigs, { maxRounds: randomMaxRounds() });

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
    const chosenIndex = sampleIndex(allScores, TRAIN_TEMPERATURE);

    const chosenAction = actions[chosenIndex];
    const stateFeatures = encodePlayerContext(state, player);
    // Si la carta que se va a comprar es una de las calibradas (ver
    // SCALER_CALIBRATION más abajo), no hace falta el snapshot de antes: su
    // shaping se sustituye entero por el valor medio precalculado.
    const boughtCardId =
      chosenAction.type === 'buyAnimal'
        ? state.animalTrack.find((c) => c.instanceId === chosenAction.trackInstanceId)?.id
        : undefined;
    const calibratedValue = boughtCardId ? SCALER_CALIBRATION[boughtCardId] : undefined;
    const scoreBefore = chosenAction.type === 'buyAnimal' && calibratedValue === undefined ? scorePlayer(state, player) : 0;

    applyAction(state, player.id, chosenAction);

    const shapingBonus =
      calibratedValue !== undefined
        ? calibratedValue / 20
        : chosenAction.type === 'buyAnimal'
          ? (scorePlayer(state, player) - scoreBefore) / 20
          : 0;

    trajectories.get(player.id)?.push({
      allFeatures,
      allHidden: allForward.map((f) => f.hidden),
      allScores,
      chosenIndex,
      stateFeatures,
      shapingBonus,
    });

    guard++;
  }

  return { trajectories, finalScores: scoreGame(state) };
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
        accumulateGrad(criticGrad, step.stateFeatures, critic.hidden, criticWeights.w2, advantage);
      }
      episodesUsed++;
    }
  }

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed };
}
