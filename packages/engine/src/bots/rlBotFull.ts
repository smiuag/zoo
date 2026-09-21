// Bots RL de la edición completa (2026-09-21): mismo diseño que rlBot.ts
// (red mínima, argmax/softmax sobre todas las acciones legales), pero con el
// codificador de features de featuresFull.ts (dimensión propia, ve
// mascotas/dinosaurios) y sus propios pesos (weights-full*.json, generados
// por `RL_EDITION=full [RL_HABITAT=land|bird|aquatic] npm run train:rl`).
// Nunca comparten pesos ni featureDim con rlBot.ts: cargar un weights.json
// clásico aquí (o viceversa) se rechaza por featureDim.
//
// A diferencia de rlBot.ts (que ante un JSON inválido cae a pesos
// ALEATORIOS y los sigue usando igual), aquí un fallo de carga (archivo que
// todavía no existe, featureDim que no coincide, JSON corrupto) hace que el
// bot entero sea heuristicBot en su lugar — pedido explícito del usuario
// 2026-09-21: un especialista de la completa sin entrenar de verdad no debe
// jugar con una red al azar (peor que cualquier heurística), así que ni se
// intenta. Se decide UNA vez, al cargar este módulo, no en cada chooseAction.
import { filterActionsByHabitat, legalActionsForBot } from './actionPriority';
import { encodeActionsForPlayer, FEATURE_DIM_FULL } from './rl/featuresFull';
import { deserializeWeights, forward, type RlWeights } from './rl/network';
import { heuristicBot } from './heuristicBot';
import type { Bot } from './types';
import defaultWeightsJson from './rl/weights-full.json';
import landWeightsJson from './rl/weights-full-land.json';
import birdWeightsJson from './rl/weights-full-bird.json';
import aquaticWeightsJson from './rl/weights-full-aquatic.json';

const TIE_EPSILON = 1e-9;

type Habitat = 'land' | 'bird' | 'aquatic';

function tryLoadWeights(json: unknown): RlWeights | null {
  try {
    const weights = deserializeWeights(json);
    if (weights.featureDim !== FEATURE_DIM_FULL) return null;
    return weights;
  } catch {
    return null;
  }
}

export interface RlBotFullOptions {
  weights: RlWeights;
  temperature?: number;
  // Especialistas de hábitat de la edición completa: restringe qué animales
  // puede COMPRAR del mercado a ese hábitat — mismo criterio (con la misma
  // excepción para efectos onScore acumulativos, ver filterActionsByHabitat
  // en actionPriority.ts) que habitatFilter en rlBot.ts para los 3
  // especialistas clásicos.
  habitatFilter?: Habitat;
}

function sampleFromSoftmax(scores: number[], temperature: number): number {
  const scaled = scores.map((s) => s / temperature);
  const max = Math.max(...scaled);
  const weights = scaled.map((s) => Math.exp(s - max));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return weights.length - 1;
}

export function createRlBotFull(options: RlBotFullOptions): Bot {
  const temperature = options.temperature ?? 0;

  return {
    chooseAction(state, playerId) {
      let actions = legalActionsForBot(state, playerId);
      if (options.habitatFilter) {
        actions = filterActionsByHabitat(state, actions, options.habitatFilter);
      }
      if (actions.length === 0) return { type: 'endTurn' };

      const scores = encodeActionsForPlayer(state, playerId, actions).map((features) => {
        const score = forward(options.weights, features).score;
        return Number.isFinite(score) ? score : -Infinity;
      });

      if (temperature <= 0) {
        const best = Math.max(...scores);
        const bestIndices = scores.map((_, i) => i).filter((i) => scores[i] >= best - TIE_EPSILON);
        return actions[bestIndices[Math.floor(Math.random() * bestIndices.length)]];
      }

      return actions[sampleFromSoftmax(scores, temperature)];
    },
  };
}

function specialistOrHeuristic(json: unknown, habitatFilter?: Habitat): Bot {
  const weights = tryLoadWeights(json);
  return weights ? createRlBotFull({ weights, habitatFilter }) : heuristicBot;
}

export const rlBotFull: Bot = specialistOrHeuristic(defaultWeightsJson);
export const fullLandRlBot: Bot = specialistOrHeuristic(landWeightsJson, 'land');
export const fullBirdRlBot: Bot = specialistOrHeuristic(birdWeightsJson, 'bird');
export const fullAquaticRlBot: Bot = specialistOrHeuristic(aquaticWeightsJson, 'aquatic');
