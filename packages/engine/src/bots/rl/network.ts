// Red mínima (1 capa oculta, tanh) implementada a mano: nada de
// dependencias de ML, solo aritmética con arrays. Toma un vector de
// features de longitud fija (ver features.ts) y devuelve un único escalar:
// "qué de buena es esta acción candidata". rlBot.ts la usa para puntuar
// todas las acciones legales y quedarse con la mejor, igual que
// heuristicBot pero con pesos aprendidos en vez de a mano.
//
// Los pesos viven en Float64Array (no number[][] normales): V8 optimiza
// mucho mejor un bucle sobre memoria contigua y de tipo fijo que sobre un
// array de "cualquier cosa" — mismo resultado exacto, más rápido en el
// sitio más caliente de todo el entrenamiento (forward() se llama una vez
// por cada acción candidata, de cada turno, de cada partida, de cada
// batch). El JSON en disco (serializeWeights/deserializeWeights) sigue
// siendo arrays normales de toda la vida: JSON.stringify de un
// Float64Array no da un array (da un objeto {"0":1,"1":2,...}), así que la
// conversión ocurre solo al entrar/salir — los weights*.json ya guardados
// se leen exactamente igual que antes, no hace falta reentrenar nada.
export interface RlWeights {
  version: 1;
  featureDim: number;
  hiddenSize: number;
  w1: Float64Array[]; // hiddenSize x featureDim
  b1: Float64Array; // hiddenSize
  w2: Float64Array; // hiddenSize
  b2: number;
}

function randomUniform(scale: number): number {
  return (Math.random() * 2 - 1) * scale;
}

function randomFloat64Array(length: number, scale: number): Float64Array {
  const arr = new Float64Array(length);
  for (let i = 0; i < length; i++) arr[i] = randomUniform(scale);
  return arr;
}

export function createRandomWeights(featureDim: number, hiddenSize: number): RlWeights {
  return {
    version: 1,
    featureDim,
    hiddenSize,
    w1: Array.from({ length: hiddenSize }, () => randomFloat64Array(featureDim, 0.1)),
    b1: new Float64Array(hiddenSize),
    w2: randomFloat64Array(hiddenSize, 0.1),
    b2: 0,
  };
}

export function forward(weights: RlWeights, x: number[]): { hidden: Float64Array; score: number } {
  const hidden = new Float64Array(weights.hiddenSize);
  for (let j = 0; j < weights.hiddenSize; j++) {
    const row = weights.w1[j];
    let sum = weights.b1[j];
    for (let i = 0; i < row.length; i++) sum += row[i] * x[i];
    hidden[j] = Math.tanh(sum);
  }

  let score = weights.b2;
  for (let j = 0; j < hidden.length; j++) score += weights.w2[j] * hidden[j];

  return { hidden, score };
}

// Inserta una columna a cero en `insertIndex` de CADA fila de w1
// (desplazando el resto una posición), sin tocar b1/w2/b2: con peso 0 en la
// columna nueva, forward() da EXACTAMENTE el mismo score que antes para
// cualquier vector que tuviera esa misma columna insertada (con cualquier
// valor — el peso 0 la ignora). Permite ampliar featureDim en
// features.ts/featuresFull.ts sin invalidar pesos ya entrenados: solo hace
// falta reentrenar para que la red APRENDA a usar la columna nueva, no para
// recuperar lo ya aprendido. Usado por scripts/rl/weightsIo.ts (entrenamiento)
// y rlBotFull.ts (producción/web, que no puede importar weightsIo.ts).
export function insertZeroFeatureColumn(weights: RlWeights, insertIndex: number): RlWeights {
  const featureDim = weights.featureDim + 1;
  const w1 = weights.w1.map((row) => {
    const migrated = new Float64Array(featureDim);
    migrated.set(row.subarray(0, insertIndex), 0);
    migrated[insertIndex] = 0;
    migrated.set(row.subarray(insertIndex), insertIndex + 1);
    return migrated;
  });
  return { ...weights, featureDim, w1 };
}

export function serializeWeights(weights: RlWeights): string {
  return JSON.stringify({
    version: weights.version,
    featureDim: weights.featureDim,
    hiddenSize: weights.hiddenSize,
    w1: weights.w1.map((row) => Array.from(row)),
    b1: Array.from(weights.b1),
    w2: Array.from(weights.w2),
    b2: weights.b2,
  });
}

// Forma en la que los pesos viven en el JSON de disco: arrays normales
// (nunca Float64Array — ver comentario de RlWeights arriba). Se convierte a
// RlWeights de verdad al final de deserializeWeights.
interface RawRlWeights {
  featureDim: number;
  hiddenSize: number;
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
}

// Valida forma/dimensiones antes de aceptar unos pesos (de un JSON externo o
// de un checkpoint de entrenamiento): así un archivo ausente/corrupto no
// puede colar un forward() que reviente a mitad de partida.
export function deserializeWeights(json: unknown): RlWeights {
  const data = (typeof json === 'string' ? JSON.parse(json) : json) as Partial<RawRlWeights> | null;

  if (
    !data ||
    typeof data.featureDim !== 'number' ||
    typeof data.hiddenSize !== 'number' ||
    typeof data.b2 !== 'number' ||
    !Array.isArray(data.w1) ||
    !Array.isArray(data.b1) ||
    !Array.isArray(data.w2)
  ) {
    throw new Error('Formato de pesos RL inválido');
  }

  if (
    data.w1.length !== data.hiddenSize ||
    data.w1.some((row) => !Array.isArray(row) || row.length !== data.featureDim) ||
    data.b1.length !== data.hiddenSize ||
    data.w2.length !== data.hiddenSize
  ) {
    throw new Error('Dimensiones de pesos RL inconsistentes');
  }

  return {
    version: 1,
    featureDim: data.featureDim,
    hiddenSize: data.hiddenSize,
    w1: data.w1.map((row) => Float64Array.from(row)),
    b1: Float64Array.from(data.b1),
    w2: Float64Array.from(data.w2),
    b2: data.b2,
  };
}
