import type { RlWeights } from '../../src/bots/rl/network';

// Solo usado por el entrenamiento (self-play): matemática de REINFORCE
// (política softmax sobre la puntuación de cada acción legal, gradiente de
// log-verosimilitud pesado por la ventaja del episodio), nunca importado
// desde src/index.ts ni desde apps/web.
export interface Gradient {
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

export function zeroGrad(featureDim: number, hiddenSize: number): Gradient {
  return {
    w1: Array.from({ length: hiddenSize }, () => new Array(featureDim).fill(0)),
    b1: new Array(hiddenSize).fill(0),
    w2: new Array(hiddenSize).fill(0),
    b2: 0,
  };
}

export function softmax(scores: number[]): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const total = exps.reduce((sum, e) => sum + e, 0);
  return exps.map((e) => e / total);
}

// Acumula el gradiente de ASCENSO (REINFORCE maximiza el retorno esperado)
// de una única acción candidata sobre su propio (features, hidden) y los
// pesos de salida w2 (compartidos entre todas las candidatas de este
// decision point). `delta` = (1[acción elegida] − π(acción)) × ventaja.
export function accumulateGrad(grad: Gradient, features: number[], hidden: number[], w2: number[], delta: number): void {
  grad.b2 += delta;
  for (let j = 0; j < hidden.length; j++) {
    grad.w2[j] += delta * hidden[j];
    const gradPre = delta * w2[j] * (1 - hidden[j] * hidden[j]); // tanh'(pre) = 1 - tanh(pre)^2
    grad.b1[j] += gradPre;
    const row = grad.w1[j];
    for (let i = 0; i < features.length; i++) row[i] += gradPre * features[i];
  }
}

// Suma `source` dentro de `target` (in-place): permite acumular en un solo
// batch los gradientes parciales calculados por varios workers en paralelo
// (ver RL_WORKERS en selfPlay.ts/worker.ts) exactamente como si se hubiera
// hecho todo en un único accumulateGrad secuencial — la suma es
// conmutativa/asociativa, así que el orden o el reparto entre procesos no
// cambia el resultado final.
export function addGrad(target: Gradient, source: Gradient): void {
  target.b2 += source.b2;
  for (let j = 0; j < target.w1.length; j++) {
    target.b1[j] += source.b1[j];
    target.w2[j] += source.w2[j];
    const targetRow = target.w1[j];
    const sourceRow = source.w1[j];
    for (let i = 0; i < targetRow.length; i++) targetRow[i] += sourceRow[i];
  }
}

export function applyGrad(weights: RlWeights, grad: Gradient, learningRate: number): void {
  for (let j = 0; j < weights.hiddenSize; j++) {
    weights.b1[j] += learningRate * grad.b1[j];
    weights.w2[j] += learningRate * grad.w2[j];
    const row = weights.w1[j];
    const gradRow = grad.w1[j];
    for (let i = 0; i < weights.featureDim; i++) row[i] += learningRate * gradRow[i];
  }
  weights.b2 += learningRate * grad.b2;
}
