// Red mínima (1 capa oculta, tanh) implementada a mano: nada de
// dependencias de ML, solo aritmética con arrays. Toma un vector de
// features de longitud fija (ver features.ts) y devuelve un único escalar:
// "qué de buena es esta acción candidata". rlBot.ts la usa para puntuar
// todas las acciones legales y quedarse con la mejor, igual que
// heuristicBot pero con pesos aprendidos en vez de a mano.
export interface RlWeights {
  version: 1;
  featureDim: number;
  hiddenSize: number;
  w1: number[][]; // hiddenSize x featureDim
  b1: number[]; // hiddenSize
  w2: number[]; // hiddenSize
  b2: number;
}

function randomUniform(scale: number): number {
  return (Math.random() * 2 - 1) * scale;
}

export function createRandomWeights(featureDim: number, hiddenSize: number): RlWeights {
  return {
    version: 1,
    featureDim,
    hiddenSize,
    w1: Array.from({ length: hiddenSize }, () => Array.from({ length: featureDim }, () => randomUniform(0.1))),
    b1: Array.from({ length: hiddenSize }, () => 0),
    w2: Array.from({ length: hiddenSize }, () => randomUniform(0.1)),
    b2: 0,
  };
}

export function forward(weights: RlWeights, x: number[]): { hidden: number[]; score: number } {
  const hidden = weights.w1.map((row, j) => {
    let sum = weights.b1[j];
    for (let i = 0; i < row.length; i++) sum += row[i] * x[i];
    return Math.tanh(sum);
  });

  let score = weights.b2;
  for (let j = 0; j < hidden.length; j++) score += weights.w2[j] * hidden[j];

  return { hidden, score };
}

export function serializeWeights(weights: RlWeights): string {
  return JSON.stringify(weights);
}

// Valida forma/dimensiones antes de aceptar unos pesos (de un JSON externo o
// de un checkpoint de entrenamiento): así un archivo ausente/corrupto no
// puede colar un forward() que reviente a mitad de partida.
export function deserializeWeights(json: unknown): RlWeights {
  const data = (typeof json === 'string' ? JSON.parse(json) : json) as Partial<RlWeights> | null;

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

  return data as RlWeights;
}
