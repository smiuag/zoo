import { getLegalActions } from '../engine';
import { encodeAction, FEATURE_DIM } from './rl/features';
import { createRandomWeights, deserializeWeights, forward, type RlWeights } from './rl/network';
import type { Bot } from './types';
import defaultWeightsJson from './rl/weights.json';
import landWeightsJson from './rl/weights-land.json';
import birdWeightsJson from './rl/weights-bird.json';
import aquaticWeightsJson from './rl/weights-aquatic.json';

// Tamaño de la capa oculta con la que se generan pesos de emergencia cuando
// no hay un weights.json entrenado/válido disponible (arranque en frío
// antes del primer `train:rl`, o un checkpoint corrupto).
const FALLBACK_HIDDEN_SIZE = 32;
const TIE_EPSILON = 1e-9;

type Habitat = 'land' | 'bird' | 'aquatic';

function loadWeightsFromJson(json: unknown): RlWeights {
  try {
    const weights = deserializeWeights(json);
    if (weights.featureDim !== FEATURE_DIM) throw new Error('featureDim no coincide con FEATURE_DIM');
    return weights;
  } catch {
    return createRandomWeights(FEATURE_DIM, FALLBACK_HIDDEN_SIZE);
  }
}

function loadDefaultWeights(): RlWeights {
  return loadWeightsFromJson(defaultWeightsJson);
}

export interface RlBotOptions {
  // Inyectables para tests y para el propio script de entrenamiento (que
  // quiere puntuar con los pesos que está actualizando, no con los del
  // weights.json ya commiteado).
  weights?: RlWeights;
  // 0 (por defecto): argmax determinista, como heuristicBot. >0: muestreo
  // softmax a esa temperatura, usado durante el self-play para explorar.
  temperature?: number;
  // Restringe qué animales puede COMPRAR del mercado a ese hábitat (jugar
  // cartas, comprar monedas y terminar turno no se filtran). Es la misma
  // restricción con la que se entrenaron los especialistas de hábitat en
  // scripts/rl/selfPlay.ts (RL_HABITAT): sin esto, unos pesos entrenados
  // bajo esa restricción puntuarían compras que nunca vieron durante el
  // entrenamiento.
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

export function createRlBot(options: RlBotOptions = {}): Bot {
  const temperature = options.temperature ?? 0;

  return {
    chooseAction(state, playerId) {
      let actions = getLegalActions(state, playerId);
      if (options.habitatFilter) {
        const habitat = options.habitatFilter;
        actions = actions.filter((action) => {
          if (action.type !== 'buyAnimal') return true;
          const animal = state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
          return (animal?.habitats as string[] | undefined)?.includes(habitat) ?? false;
        });
      }
      if (actions.length === 0) return { type: 'endTurn' };

      // Los pesos por defecto se cargan de forma perezosa (no al definir el
      // bot) para que crear el módulo nunca falle aunque weights.json esté
      // corrupto y solo se note el fallback al jugar de verdad.
      const weights = options.weights ?? loadDefaultWeights();
      // Un score no finito (NaN/Infinity, p. ej. por unos pesos con una
      // featureDim que no encaja con FEATURE_DIM) se trata como "el peor
      // posible" en vez de dejar que rompa el argmax: Math.max con un NaN
      // de por medio devuelve NaN y ninguna comparación >= NaN es cierta,
      // lo que dejaría bestIndices vacío y el bot sin ninguna acción legal
      // que devolver.
      const scores = actions.map((action) => {
        const score = forward(weights, encodeAction(state, playerId, action)).score;
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

export const rlBot: Bot = createRlBot();

// Especialistas de hábitat: misma red/arquitectura, entrenados por
// self-play con RL_HABITAT=land|bird|aquatic (ver scripts/rl/selfPlay.ts),
// cada uno con sus propios pesos y restringido a comprar solo animales de
// ese hábitat.
export const landRlBot: Bot = createRlBot({ weights: loadWeightsFromJson(landWeightsJson), habitatFilter: 'land' });
export const birdRlBot: Bot = createRlBot({ weights: loadWeightsFromJson(birdWeightsJson), habitatFilter: 'bird' });
export const aquaticRlBot: Bot = createRlBot({
  weights: loadWeightsFromJson(aquaticWeightsJson),
  habitatFilter: 'aquatic',
});
