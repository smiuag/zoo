import type { RlWeights } from '../../src/bots/rl/network';

// Solo usado por el entrenamiento (self-play): matemática de REINFORCE
// (política softmax sobre la puntuación de cada acción legal, gradiente de
// log-verosimilitud pesado por la ventaja del episodio), nunca importado
// desde src/index.ts ni desde apps/web.
//
// Mismo motivo que en network.ts: Float64Array en vez de number[][] para
// que V8 optimice los bucles calientes de acumulación de gradiente — mismo
// resultado exacto, más rápido.
export interface Gradient {
  w1: Float64Array[];
  b1: Float64Array;
  w2: Float64Array;
  b2: number;
}

export function zeroGrad(featureDim: number, hiddenSize: number): Gradient {
  return {
    w1: Array.from({ length: hiddenSize }, () => new Float64Array(featureDim)),
    b1: new Float64Array(hiddenSize),
    w2: new Float64Array(hiddenSize),
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
export function accumulateGrad(
  grad: Gradient,
  features: number[],
  hidden: Float64Array,
  w2: Float64Array,
  delta: number
): void {
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

// Forma en la que un Gradient viaja por stdin/stdout entre selfPlay.ts y
// worker.ts (ver worker.ts): arrays normales, nunca Float64Array —
// JSON.stringify de un Float64Array no da un array (da un objeto
// {"0":1,"1":2,...}), así que sin esta conversión el gradiente de cada
// worker llegaría corrompido al proceso principal y se perdería en
// silencio (los bucles que esperan un array indexado con .length no
// encontrarían nada que sumar, no un error visible).
export interface RawGradient {
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

export function serializeGradient(grad: Gradient): RawGradient {
  return {
    w1: grad.w1.map((row) => Array.from(row)),
    b1: Array.from(grad.b1),
    w2: Array.from(grad.w2),
    b2: grad.b2,
  };
}

export function deserializeGradient(raw: RawGradient): Gradient {
  return {
    w1: raw.w1.map((row) => Float64Array.from(row)),
    b1: Float64Array.from(raw.b1),
    w2: Float64Array.from(raw.w2),
    b2: raw.b2,
  };
}

// SGD plano: cada actualización solo mira el gradiente de ESTE batch. Con
// self-play (gradiente ruidoso, solo unas pocas decenas de episodios por
// batch) esto da bandazos — ver applyGradAdam más abajo, que es lo que usa
// selfPlay.ts de verdad. Se mantiene por si hace falta comparar contra la
// baseline sin momentum/adaptación.
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

// Multiplica `grad` in-place por `factor` — se usa para pasar de "suma de
// gradiente de todos los episodios/pasos de este batch" a "media", ANTES de
// dárselo a Adam: sus medias móviles (m/v, ver AdamState) necesitan ver una
// magnitud de gradiente consistente entre batches, y episodesUsed/stepCount
// varía ligeramente de un batch a otro (duraciones de partida distintas).
export function scaleGrad(grad: Gradient, factor: number): void {
  grad.b2 *= factor;
  for (let j = 0; j < grad.w1.length; j++) {
    grad.b1[j] *= factor;
    grad.w2[j] *= factor;
    const row = grad.w1[j];
    for (let i = 0; i < row.length; i++) row[i] *= factor;
  }
}

// Adam (Kingma & Ba 2014): momentum (media móvil del gradiente, `m`) +
// tasa de aprendizaje adaptada POR PESO según cuánto ha variado su
// gradiente históricamente (media móvil del gradiente al cuadrado, `v`).
// Un peso con gradientes grandes/ruidosos frena solo; uno con gradientes
// pequeños/tranquilos acelera solo — sin tener que buscar a mano una única
// tasa de aprendizaje que le venga bien a la vez a la columna de "coste" (
// gradiente en cada decisión) y a la de un tipo de efecto raro (gradiente
// solo cuando aparece esa carta exacta). betas/epsilon son los valores por
// defecto de siempre (Kingma & Ba), rara vez hace falta tocarlos.
//
// Vive en memoria del proceso, nunca se guarda en weights*.json: cada
// invocación de train:rl arranca sus medias móviles desde cero (m=v=0,
// t=0), incluso si continúa unos pesos ya entrenados de una tanda anterior
// — un pequeño "arranque en frío" de un puñado de batches, no una pérdida
// real (a diferencia de los propios pesos, que si se guardan).
const ADAM_BETA1 = 0.9;
const ADAM_BETA2 = 0.999;
const ADAM_EPSILON = 1e-8;

export interface AdamState {
  m: Gradient;
  v: Gradient;
  t: number;
}

export function createAdamState(featureDim: number, hiddenSize: number): AdamState {
  return { m: zeroGrad(featureDim, hiddenSize), v: zeroGrad(featureDim, hiddenSize), t: 0 };
}

function adamStep(w: Float64Array, g: Float64Array, m: Float64Array, v: Float64Array, lr: number, bc1: number, bc2: number): void {
  for (let i = 0; i < w.length; i++) {
    m[i] = ADAM_BETA1 * m[i] + (1 - ADAM_BETA1) * g[i];
    v[i] = ADAM_BETA2 * v[i] + (1 - ADAM_BETA2) * g[i] * g[i];
    const mHat = m[i] / bc1;
    const vHat = v[i] / bc2;
    w[i] += lr * (mHat / (Math.sqrt(vHat) + ADAM_EPSILON));
  }
}

// `grad` debe ser ya la MEDIA del batch (ver scaleGrad arriba), no la suma
// cruda de accumulateGrad/addGrad.
export function applyGradAdam(weights: RlWeights, grad: Gradient, adam: AdamState, learningRate: number): void {
  adam.t += 1;
  const bc1 = 1 - ADAM_BETA1 ** adam.t;
  const bc2 = 1 - ADAM_BETA2 ** adam.t;

  for (let j = 0; j < weights.hiddenSize; j++) {
    adamStep(weights.w1[j], grad.w1[j], adam.m.w1[j], adam.v.w1[j], learningRate, bc1, bc2);
  }
  adamStep(weights.b1, grad.b1, adam.m.b1, adam.v.b1, learningRate, bc1, bc2);
  adamStep(weights.w2, grad.w2, adam.m.w2, adam.v.w2, learningRate, bc1, bc2);

  // b2 es un escalar, no un Float64Array: mismo cálculo pero sin bucle.
  adam.m.b2 = ADAM_BETA1 * adam.m.b2 + (1 - ADAM_BETA1) * grad.b2;
  adam.v.b2 = ADAM_BETA2 * adam.v.b2 + (1 - ADAM_BETA2) * grad.b2 * grad.b2;
  const mHatB2 = adam.m.b2 / bc1;
  const vHatB2 = adam.v.b2 / bc2;
  weights.b2 += learningRate * (mHatB2 / (Math.sqrt(vHatB2) + ADAM_EPSILON));
}
