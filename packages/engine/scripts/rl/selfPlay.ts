// Entrenamiento por self-play del rlBot. Se ejecuta con vite-node (no
// node/tsx a secas: cards/registry.ts usa import.meta.glob, una API solo de
// Vite) vía `npm run train:rl -w packages/engine`. Nunca se importa desde
// src/index.ts ni desde apps/web: es una herramienta de desarrollo, no algo
// que la app o el motor necesiten en tiempo de ejecución normal.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { randomBot } from '../../src/bots/randomBot';
import { CRITIC_FEATURE_DIM, FEATURE_DIM } from '../../src/bots/rl/features';
import { createRandomWeights, deserializeWeights, serializeWeights, type RlWeights } from '../../src/bots/rl/network';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scoreGame } from '../../src/scoring';
import { addGrad, applyGradAdam, createAdamState, deserializeGradient, scaleGrad, zeroGrad, type AdamState } from './train';
import {
  buildStarterDeck,
  chooseLearnerAction,
  HABITAT_FILTER,
  MAX_ACTIONS_PER_GAME,
  randomMaxRounds,
  runEpisodes,
  type EpisodeBatchResult,
} from './trainCore';

// 2026-09-16: subido de 32 a 48 (x1.5) junto con el bump de FEATURE_DIM
// 86->96, para darle a la red algo más de capacidad con la que aprender los
// nuevos cruces "lo que ya tengo/lo que falta en el mercado" × "la carta
// candidata" (ver features.ts). Coste total por acción evaluada ≈
// (96/86)*(48/32) ≈ 1.7x, dentro del margen de 2-3x aceptado.
const HIDDEN_SIZE = 48;
const LEARNING_RATE = Number(process.env.RL_LR ?? 0.01);
const EPISODES_PER_BATCH = Number(process.env.RL_EPISODES ?? 32);
const TOTAL_BATCHES = Number(process.env.RL_BATCHES ?? 2000);
// "Crítico": pequeña red separada (mismo tipo de MLP, ver network.ts, pero
// features de SOLO ESTADO — ver CRITIC_FEATURE_DIM/encodePlayerContext en
// features.ts — en vez de estado+acción) que se entrena por regresión a
// predecir el retorno esperado desde CUALQUIER estado de la partida.
// Sustituye a la baseline anterior (un único número global, media móvil de
// todos los retornos vistos): esa baseline no distinguía turno 2 de turno
// 18 ni "tengo mucho dinero/cartas por jugar" de "no tengo nada", así que
// una carta cuyo valor real depende del ESTADO en que se juega (más turnos
// por delante = más veces puedes rejugar un Hipopótamo; el Tucán vale
// aprox. lo mismo esté donde esté) recibía la MISMA ventaja
// independientemente del momento — la red no tenía forma de aprender esa
// diferencia. Con una baseline condicionada al estado, la ventaja
// (retorno real − predicción del crítico PARA ESE ESTADO CONCRETO) sí
// puede distinguir ambos casos.
const CRITIC_HIDDEN_SIZE = 16;
const CRITIC_LR = Number(process.env.RL_CRITIC_LR ?? 0.02);
const EVAL_EVERY = Number(process.env.RL_EVAL_EVERY ?? 50);
const EVAL_GAMES = Number(process.env.RL_EVAL_GAMES ?? 40);

const WEIGHTS_FILE = HABITAT_FILTER ? `weights-${HABITAT_FILTER}.json` : 'weights.json';
const WEIGHTS_PATH = fileURLToPath(new URL(`../../src/bots/rl/${WEIGHTS_FILE}`, import.meta.url));
// El crítico vive AQUÍ (scripts/rl/), no en src/bots/rl/ junto a los pesos
// de política: nunca lo usa el bot de verdad (solo sirve durante el
// entrenamiento, para calcular la ventaja), así que no tiene sentido que
// esté en la carpeta que sí importa apps/web — así queda claro que es un
// artefacto de entrenamiento, nunca "enviable".
const CRITIC_FILE = HABITAT_FILTER ? `critic-${HABITAT_FILTER}.json` : 'critic.json';
const CRITIC_PATH = fileURLToPath(new URL(`./${CRITIC_FILE}`, import.meta.url));

// Paralelización de la simulación de partidas (2026-09-14): las
// EPISODES_PER_BATCH partidas de un batch son independientes entre sí (solo
// LEEN los pesos actuales, nunca los mutan), así que se reparten entre este
// proceso principal + RL_WORKERS procesos worker (worker.ts) que las juegan
// en paralelo y devuelven su gradiente parcial; este proceso suma todos los
// parciales (mergeEpisodeResults) y aplica UNA sola actualización por
// batch — resultado matemáticamente idéntico a jugar las 32 partidas
// secuencialmente en un único proceso (la suma de gradientes es
// conmutativa), solo que más rápido en pared-reloj. Por defecto 2: con los
// 4 entrenamientos (general/land/bird/aquatic) corriendo a la vez, cada uno
// con 2 workers + su propio proceso principal = 3 simulando por variante x
// 4 variantes = 12 procesos, uno por cada hilo lógico de esta máquina (6
// núcleos físicos / 12 con hyperthreading). RL_WORKERS=0 conserva el
// comportamiento secuencial de antes (útil para depurar).
const WORKER_COUNT = Number(process.env.RL_WORKERS ?? 2);
// vite-node.mjs invocado directamente con node reproduce exactamente lo que
// hace el binario `vite-node` (ver node_modules/.bin/vite-node, que solo
// hace `exec node .../vite-node.mjs "$@"`) — así los workers cargan
// cards/registry.ts (import.meta.glob) igual que este proceso principal.
const VITE_NODE_ENTRY = fileURLToPath(new URL('../../../../node_modules/vite-node/vite-node.mjs', import.meta.url));
const ENGINE_DIR = fileURLToPath(new URL('../../', import.meta.url));

interface WorkerHandle {
  send(msg: { weights: unknown; criticWeights: unknown; episodes: number }): Promise<EpisodeBatchResult>;
  kill(): void;
}

function spawnWorker(): WorkerHandle {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [VITE_NODE_ENTRY, 'scripts/rl/worker.ts'], {
    cwd: ENGINE_DIR,
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  const pending: ((line: string) => void)[] = [];
  const pendingErrors: ((err: Error) => void)[] = [];
  const lineReader = createInterface({ input: child.stdout });
  lineReader.on('line', (line) => {
    const resolve = pending.shift();
    pendingErrors.shift();
    resolve?.(line);
  });
  child.on('exit', (code, signal) => {
    const err = new Error(`Worker RL terminó inesperadamente (code=${code}, signal=${signal})`);
    while (pendingErrors.length > 0) pendingErrors.shift()?.(err);
  });

  return {
    send(msg) {
      return new Promise((resolve, reject) => {
        pending.push((line) => {
          // grad/criticGrad viajan como arrays normales (ver
          // serializeGradient en worker.ts): hay que reconstruir los
          // Float64Array antes de que addGrad/applyGrad los toquen.
          const raw = JSON.parse(line) as Omit<EpisodeBatchResult, 'grad' | 'criticGrad'> & {
            grad: Parameters<typeof deserializeGradient>[0];
            criticGrad: Parameters<typeof deserializeGradient>[0];
          };
          resolve({ ...raw, grad: deserializeGradient(raw.grad), criticGrad: deserializeGradient(raw.criticGrad) });
        });
        pendingErrors.push(reject);
        child.stdin.write(`${JSON.stringify(msg)}\n`);
      });
    },
    kill() {
      child.stdin.end();
      child.kill();
    },
  };
}

const workers: WorkerHandle[] = Array.from({ length: WORKER_COUNT }, () => spawnWorker());

// Reparte `total` en `parts` cuotas lo más iguales posible (las primeras
// `total % parts` se llevan una unidad extra).
function splitEvenly(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

function mergeEpisodeResults(results: EpisodeBatchResult[], weights: RlWeights, criticWeights: RlWeights): EpisodeBatchResult {
  const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
  const criticGrad = zeroGrad(criticWeights.featureDim, criticWeights.hiddenSize);
  let episodesUsed = 0;
  let sumAbsAdvantage = 0;
  let sumReturn = 0;
  let stepCount = 0;

  for (const r of results) {
    addGrad(grad, r.grad);
    addGrad(criticGrad, r.criticGrad);
    episodesUsed += r.episodesUsed;
    sumAbsAdvantage += r.sumAbsAdvantage;
    sumReturn += r.sumReturn;
    stepCount += r.stepCount;
  }

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed };
}

// Devuelve estadísticas del batch para el log (ver main): la media de
// |ventaja| (cuánto se equivocaba el crítico de media, en valor absoluto —
// baja con el entrenamiento si el crítico aprende bien) y la media de
// retorno crudo (a título informativo, sin más).
async function trainBatch(
  weights: RlWeights,
  criticWeights: RlWeights,
  policyAdam: AdamState,
  criticAdam: AdamState
): Promise<{ avgAbsAdvantage: number; avgReturn: number }> {
  const shares = splitEvenly(EPISODES_PER_BATCH, WORKER_COUNT + 1);
  const serializedWeights = serializeWeights(weights);
  const serializedCriticWeights = serializeWeights(criticWeights);

  const workerPromises = workers.map((worker, i) =>
    worker.send({
      weights: JSON.parse(serializedWeights),
      criticWeights: JSON.parse(serializedCriticWeights),
      episodes: shares[i],
    })
  );
  // Este proceso principal también simula su propia cuota (la última) en
  // vez de quedarse solo orquestando: con WORKER_COUNT=2 son 3 simuladores
  // por variante (este + 2 workers), no 2.
  const ownResult = runEpisodes(weights, criticWeights, shares[WORKER_COUNT]);
  const workerResults = await Promise.all(workerPromises);

  const merged = mergeEpisodeResults([ownResult, ...workerResults], weights, criticWeights);

  // Adam necesita ver la MEDIA del batch, no la suma cruda de
  // episodios/pasos (ver scaleGrad en train.ts): sus medias móviles de
  // magnitud del gradiente (m/v) deben ser comparables de un batch a otro,
  // y episodesUsed/stepCount varían ligeramente según duren las partidas.
  scaleGrad(merged.grad, 1 / Math.max(1, merged.episodesUsed));
  applyGradAdam(weights, merged.grad, policyAdam, LEARNING_RATE);
  // Normalizado por stepCount (número de decisiones, no de episodios): es
  // una regresión de error cuadrático sobre cada paso, no un gradiente de
  // política por episodio, así que promediar por episodio infla el tamaño
  // real del paso en un factor igual a "pasos por episodio" (~20-40x) —
  // justo lo que causaba una divergencia vista en producción (ver
  // ADVANTAGE_CLIP en trainCore.ts).
  scaleGrad(merged.criticGrad, 1 / Math.max(1, merged.stepCount));
  applyGradAdam(criticWeights, merged.criticGrad, criticAdam, CRITIC_LR);

  return {
    avgAbsAdvantage: merged.stepCount > 0 ? merged.sumAbsAdvantage / merged.stepCount : 0,
    avgReturn: merged.episodesUsed > 0 ? merged.sumReturn / merged.episodesUsed : 0,
  };
}

// Partidas 1 contra 1 a temperatura 0 (juego determinista/greedy) para medir
// progreso real, alternando quién empieza para no sesgar por orden de turno.
function evaluate(weights: RlWeights, opponent: Bot, games: number): number {
  let wins = 0;

  for (let i = 0; i < games; i++) {
    const configs = [
      { id: 'learner', name: 'Learner', deck: buildStarterDeck() },
      { id: 'opponent', name: 'Opponent', deck: buildStarterDeck() },
    ];
    if (i % 2 !== 0) configs.reverse();

    const state = createGame(configs, { maxRounds: randomMaxRounds() });

    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const action =
        player.id === 'learner'
          ? chooseLearnerAction(state, player.id, weights)
          : opponent.chooseAction(state, player.id);
      applyAction(state, player.id, action);
      guard++;
    }

    const scores = scoreGame(state);
    const learnerScore = scores.find((s) => s.playerId === 'learner')?.score ?? 0;
    const opponentScore = scores.find((s) => s.playerId === 'opponent')?.score ?? 0;
    if (learnerScore > opponentScore) wins += 1;
    else if (learnerScore === opponentScore) wins += 0.5;
  }

  return wins / games;
}

// Generalizada para servir tanto a los pesos de política (WEIGHTS_PATH,
// FEATURE_DIM, HIDDEN_SIZE) como a los del crítico (CRITIC_PATH,
// CRITIC_FEATURE_DIM, CRITIC_HIDDEN_SIZE) — misma lógica de
// validar-o-reiniciar, dos archivos y dos dimensiones distintas.
function loadOrInitWeights(path: string, expectedFeatureDim: number, hiddenSize: number): RlWeights {
  if (existsSync(path)) {
    try {
      const weights = deserializeWeights(readFileSync(path, 'utf-8'));
      // deserializeWeights solo valida que el JSON sea internamente
      // consistente (sus propias filas coinciden con SU featureDim
      // guardado), no que coincida con el FEATURE_DIM de este módulo. Sin
      // esto, un weights.json de una FEATURE_DIM antigua (p. ej. de antes de
      // añadir una feature nueva) se aceptaría "tal cual" y forward()
      // truncaría en silencio el vector de entrada a las columnas viejas,
      // desalineando el gradiente en vez de fallar con un error claro.
      if (weights.featureDim !== expectedFeatureDim) {
        console.warn(
          `${path} tiene featureDim ${weights.featureDim}, no coincide con el esperado (${expectedFeatureDim}): se reinicia desde pesos aleatorios.`
        );
      } else {
        return weights;
      }
    } catch {
      console.warn(`${path} existente es inválido, se reinicia desde pesos aleatorios.`);
    }
  }
  return createRandomWeights(expectedFeatureDim, hiddenSize);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Desde que los 4 entrenamientos (general/land/bird/aquatic) también LEEN
// los pesos de las otras 3 variantes al arrancar (ver RL_VARIANT_BOTS en
// trainCore.ts, para el cruce entre bots), corren con mucha más E/S
// simultánea en este mismo directorio que antes — cada uno guarda SU PROPIO
// checkpoint cada EVAL_EVERY batches, así que con los 4 en paralelo hay
// escrituras entrelazadas constantes. En Windows eso puede toparse con un
// bloqueo de archivo transitorio (antivirus/indexador tocando el directorio
// justo en ese instante, "UNKNOWN: unknown error" de writeFileSync) — visto
// en la práctica reventando un entrenamiento entero, tirando horas de
// progreso ya bueno por la borda por un solo guardado que no consiguió
// abrir el archivo. Ahora escribe a un archivo TEMPORAL propio (nombre
// único por proceso, nunca lo abre nadie más) y solo AL FINAL hace un
// rename atómico sobre el destino. Aun así reintenta el conjunto
// (escritura+rename) varias veces con espera creciente antes de rendirse.
async function saveWeightsWithRetry(weights: RlWeights, path: string, attempts = 10): Promise<void> {
  const serialized = serializeWeights(weights);
  const tmpPath = `${path}.tmp-${process.pid}`;
  for (let i = 0; i < attempts; i++) {
    try {
      writeFileSync(tmpPath, serialized);
      renameSync(tmpPath, path);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      console.warn(`No se pudo guardar ${path} (intento ${i + 1}/${attempts}), reintentando...`, err);
      await sleep(Math.min(200 * (i + 1), 2000));
    }
  }
}

async function main(): Promise<void> {
  const weights = loadOrInitWeights(WEIGHTS_PATH, FEATURE_DIM, HIDDEN_SIZE);
  const criticWeights = loadOrInitWeights(CRITIC_PATH, CRITIC_FEATURE_DIM, CRITIC_HIDDEN_SIZE);
  // Estado de Adam (ver train.ts): vive solo en memoria de este proceso, no
  // se guarda en weights*.json — cada invocación de train:rl arranca sus
  // medias móviles desde cero aunque continúe unos pesos ya entrenados.
  const policyAdam = createAdamState(weights.featureDim, weights.hiddenSize);
  const criticAdam = createAdamState(criticWeights.featureDim, criticWeights.hiddenSize);

  const habitatLabel = HABITAT_FILTER ? ` (especialista: solo compra ${HABITAT_FILTER})` : '';
  console.log(
    `Entrenando rlBot${habitatLabel}: ${TOTAL_BATCHES} batches x ${EPISODES_PER_BATCH} partidas, lr=${LEARNING_RATE}, critic_lr=${CRITIC_LR}, workers=${WORKER_COUNT}`
  );

  try {
    for (let batch = 0; batch < TOTAL_BATCHES; batch++) {
      const { avgAbsAdvantage, avgReturn } = await trainBatch(weights, criticWeights, policyAdam, criticAdam);

      if (batch % EVAL_EVERY === 0 || batch === TOTAL_BATCHES - 1) {
        const winrateVsHeuristic = evaluate(weights, heuristicBot, EVAL_GAMES);
        const winrateVsRandom = evaluate(weights, randomBot, EVAL_GAMES);
        console.log(
          `batch=${batch} avg_return=${avgReturn.toFixed(3)} critic_avg_abs_advantage=${avgAbsAdvantage.toFixed(3)} ` +
            `winrate_vs_heuristic=${winrateVsHeuristic.toFixed(2)} winrate_vs_random=${winrateVsRandom.toFixed(2)}`
        );
        await saveWeightsWithRetry(weights, WEIGHTS_PATH);
        await saveWeightsWithRetry(criticWeights, CRITIC_PATH);
      }
    }

    await saveWeightsWithRetry(weights, WEIGHTS_PATH);
    await saveWeightsWithRetry(criticWeights, CRITIC_PATH);
    console.log('Entrenamiento terminado. Pesos guardados en', WEIGHTS_PATH, 'y', CRITIC_PATH);
  } finally {
    for (const worker of workers) worker.kill();
  }
}

main();
