// Sandbox sintético de diagnóstico (2026-09-23, pedido explícito del usuario
// tras consultar a un especialista externo): reproduce la ESTRUCTURA mínima
// del "pozo de cartas muertas" (mercado con candidatas escasas, una de ellas
// comparte una columna de features con muy pocas más) SIN simular partidas
// reales — así se pueden lanzar decenas de semillas en segundos y aislar si
// el fenómeno es genérico de REINFORCE+softmax+poca exploración, o un
// artefacto específico de compartir una columna en la MLP.
//
// Reutiliza el código de producción tal cual, sin reimplementar la
// matemática: forward/createRandomWeights (network.ts) y
// accumulateGrad/applyGrad/softmax/clampWeightNorms/zeroGrad/scaleGrad
// (train.ts).
//
// 20 especies sintéticas con un valor medio verdadero, asignado sin ninguna
// relación con la bandera compartida (3 de las 20 la tienen) — así cualquier
// diferencia sistemática entre el grupo con bandera y el resto es, por
// diseño, un artefacto del entrenamiento, no una diferencia real de calidad.
//
// El valor verdadero se REGENERA en cada semilla (no una vez para toda la
// corrida): si se fijara una sola vez, la asignación aleatoria de qué 3
// especies llevan la bandera podría, por pura casualidad, tocarles un valor
// medio más bajo esa vez — y ese sesgo de la asignación (no del
// entrenamiento) contaminaría la comparación. Variando el valor verdadero
// semilla a semilla, y midiendo el sesgo de RANGO (posición por score de la
// red MENOS posición por valor real, no la posición cruda), ese ruido se
// cancela solo al promediar sobre semillas.
//
// Lanzar con: npx vite-node scripts/rl/marketBanditSandbox.ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRandomWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import { accumulateGrad, applyGrad, clampWeightNorms, scaleGrad, softmax, zeroGrad } from './train';

const N_SPECIES = 20;
const FLAGGED = new Set([0, 1, 2]); // 3 de 20 comparten la bandera, análogo a "pet"
const AVAILABILITY_PROB = 0.5; // cada especie, independiente, disponible o no en cada decisión
const MIN_AVAILABLE = 2;
const NOISE_STD = 0.4;
const BASELINE_EMA = 0.05;
// 0.15: con 0.02 (escala real de producción) 300 batches no bastan para que
// el juguete converja de forma medible — comprobado, con 0.02 el resultado
// queda indistinguible de uniforme (0.05 = 1/20) en las 4 condiciones. Este
// sandbox no necesita imitar la escala exacta de producción, solo producir
// una señal de aprendizaje real en un tiempo de cómputo razonable.
const LEARNING_RATE = Number(process.env.RL_SANDBOX_LR ?? 0.15);
const MAX_NORM = 10;
const DECISIONS_PER_BATCH = 150;
const BATCHES = 300;
const CHECKPOINT_EVERY = 25;
const N_SEEDS = Number(process.env.RL_SANDBOX_SEEDS ?? 20);

function generateTrueValue(): number[] {
  return Array.from({ length: N_SPECIES }, () => 0.3 + Math.random() * 0.7);
}

function gaussianNoise(std: number): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function sampleAvailable(): number[] {
  let available: number[];
  do {
    available = [];
    for (let i = 0; i < N_SPECIES; i++) if (Math.random() < AVAILABILITY_PROB) available.push(i);
  } while (available.length < MIN_AVAILABLE);
  return available;
}

function buildFeatures(mode: 'tabular' | 'mlp', speciesIdx: number, trueValue: number[]): number[] {
  if (mode === 'tabular') {
    const onehot = new Array(N_SPECIES).fill(0);
    onehot[speciesIdx] = 1;
    return onehot;
  }
  return [trueValue[speciesIdx], FLAGGED.has(speciesIdx) ? 1 : 0];
}

function sampleIndex(scores: number[]): number {
  const probs = softmax(scores);
  let roll = Math.random();
  for (let i = 0; i < probs.length; i++) {
    roll -= probs[i];
    if (roll <= 0) return i;
  }
  return probs.length - 1;
}

// Rango por valor descendente: 0 = el mejor. Usado para medir sesgo de la
// red frente al orden real, no el valor absoluto (que varía de semilla a
// semilla).
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const result = new Array(values.length).fill(0);
  order.forEach(([, i], rank) => {
    result[i] = rank;
  });
  return result;
}

interface Checkpoint {
  batch: number;
  probs: number[]; // p(a) de las 20 especies, evaluadas todas disponibles a la vez
  selectionRate: number[]; // chosen/available acumulado hasta este checkpoint, por especie
}

interface RunResult {
  mode: 'tabular' | 'mlp';
  epsilon: number;
  seed: number;
  trueValue: number[];
  checkpoints: Checkpoint[];
}

function runOne(mode: 'tabular' | 'mlp', epsilon: number, seed: number, trueValue: number[]): RunResult {
  const featureDim = mode === 'tabular' ? N_SPECIES : 2;
  const hiddenSize = mode === 'tabular' ? 4 : 8;
  const weights: RlWeights = createRandomWeights(featureDim, hiddenSize);
  let baseline = 0;

  const cumulative = Array.from({ length: N_SPECIES }, () => ({ available: 0, chosen: 0 }));
  const checkpoints: Checkpoint[] = [];

  for (let batch = 0; batch < BATCHES; batch++) {
    const grad = zeroGrad(featureDim, hiddenSize);

    for (let d = 0; d < DECISIONS_PER_BATCH; d++) {
      const available = sampleAvailable();
      const features = available.map((i) => buildFeatures(mode, i, trueValue));
      const forwardResults = features.map((f) => forward(weights, f));
      const scores = forwardResults.map((f) => f.score);
      const probs = softmax(scores);

      const chosenLocal = Math.random() < epsilon ? Math.floor(Math.random() * available.length) : sampleIndex(scores);
      const chosenSpecies = available[chosenLocal];

      const reward = trueValue[chosenSpecies] + gaussianNoise(NOISE_STD);
      const advantage = reward - baseline;
      baseline += BASELINE_EMA * (reward - baseline);

      for (let k = 0; k < available.length; k++) {
        const speciesIdx = available[k];
        cumulative[speciesIdx].available++;
        if (k === chosenLocal) cumulative[speciesIdx].chosen++;
        const delta = ((k === chosenLocal ? 1 : 0) - probs[k]) * advantage;
        accumulateGrad(grad, features[k], forwardResults[k].hidden, weights.w2, delta);
      }
    }

    scaleGrad(grad, 1 / DECISIONS_PER_BATCH);
    applyGrad(weights, grad, LEARNING_RATE);
    clampWeightNorms(weights, MAX_NORM, MAX_NORM);

    if ((batch + 1) % CHECKPOINT_EVERY === 0) {
      const allFeatures = Array.from({ length: N_SPECIES }, (_, i) => buildFeatures(mode, i, trueValue));
      const allScores = allFeatures.map((f) => forward(weights, f).score);
      const allProbs = softmax(allScores);
      checkpoints.push({
        batch: batch + 1,
        probs: allProbs,
        selectionRate: cumulative.map((s) => (s.available > 0 ? s.chosen / s.available : 0)),
      });
    }
  }

  return { mode, epsilon, seed, trueValue, checkpoints };
}

function summarizeCondition(mode: 'tabular' | 'mlp', epsilon: number, runs: RunResult[]): void {
  // Sesgo de rango: rango por p(a) final MENOS rango por valor real, medio
  // sobre las especies con bandera vs sin ella, medio sobre TODAS las
  // semillas. Positivo = la red las coloca peor de lo que su valor real
  // justificaría. Se cancela el ruido de "a esta semilla le tocó un valor
  // real más bajo" porque cada semilla se compara contra SU PROPIO orden
  // real, no contra un valor absoluto fijo.
  const rankBiasFlagged: number[] = [];
  const rankBiasUnflagged: number[] = [];
  let belowThresholdCount = 0;
  let worstIsFlaggedCount = 0;

  for (const run of runs) {
    const last = run.checkpoints[run.checkpoints.length - 1];
    const rankByP = ranks(last.probs);
    const rankByTrue = ranks(run.trueValue);
    for (let i = 0; i < N_SPECIES; i++) {
      const bias = rankByP[i] - rankByTrue[i];
      (FLAGGED.has(i) ? rankBiasFlagged : rankBiasUnflagged).push(bias);
      if (last.probs[i] < 1e-3) belowThresholdCount++;
    }
    const worstIdx = last.probs.indexOf(Math.min(...last.probs));
    if (FLAGGED.has(worstIdx)) worstIsFlaggedCount++;
  }

  console.log(
    `[${mode.padEnd(7)} epsilon=${epsilon.toFixed(2)}] sesgo de rango con bandera=${mean(rankBiasFlagged).toFixed(2)}  ` +
      `sin bandera=${mean(rankBiasUnflagged).toFixed(2)}  (positivo = peor de lo que su valor real justifica; 0 = sin sesgo)  ` +
      `%especies p<1e-3=${((belowThresholdCount / (runs.length * N_SPECIES)) * 100).toFixed(1)}%  ` +
      `peor-especie-es-con-bandera=${worstIsFlaggedCount}/${runs.length} (esperado ~${((FLAGGED.size / N_SPECIES) * 100).toFixed(0)}% si fuera azar)`
  );
}

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function main(): void {
  console.log(`N_SEEDS=${N_SEEDS}, BATCHES=${BATCHES}, DECISIONS_PER_BATCH=${DECISIONS_PER_BATCH}, LR=${LEARNING_RATE}`);
  console.log(`Valor real regenerado cada semilla (sin relación con la bandera compartida, 3 de ${N_SPECIES}).\n`);

  const conditions: { mode: 'tabular' | 'mlp'; epsilon: number }[] = [
    { mode: 'tabular', epsilon: 0 },
    { mode: 'tabular', epsilon: 0.05 },
    { mode: 'mlp', epsilon: 0 },
    { mode: 'mlp', epsilon: 0.05 },
  ];

  // Mismo valor real por semilla en las 4 condiciones (comparación pareada):
  // se genera una vez por semilla, no una vez por condición.
  const trueValuesBySeed = Array.from({ length: N_SEEDS }, () => generateTrueValue());

  const allResults: RunResult[] = [];
  for (const { mode, epsilon } of conditions) {
    const runs: RunResult[] = [];
    for (let seed = 0; seed < N_SEEDS; seed++) runs.push(runOne(mode, epsilon, seed, trueValuesBySeed[seed]));
    summarizeCondition(mode, epsilon, runs);
    allResults.push(...runs);
  }

  const outPath = fileURLToPath(new URL('./marketBanditSandboxResults.json', import.meta.url));
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        flagged: [...FLAGGED],
        results: allResults.map((r) => ({ mode: r.mode, epsilon: r.epsilon, seed: r.seed, trueValue: r.trueValue, checkpoints: r.checkpoints })),
      },
      null,
      2
    )
  );
  console.log(`\nDetalle completo guardado en ${outPath}`);
}

main();
