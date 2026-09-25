// Entrenamiento por self-play del rlBot. Se ejecuta con vite-node (no
// node/tsx a secas: cards/registry.ts usa import.meta.glob, una API solo de
// Vite) vía `npm run train:rl -w packages/engine`. Nunca se importa desde
// src/index.ts ni desde apps/web: es una herramienta de desarrollo, no algo
// que la app o el motor necesiten en tiempo de ejecución normal.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { randomBot } from '../../src/bots/randomBot';
import { serializeWeights, type RlWeights } from '../../src/bots/rl/network';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scoreGame } from '../../src/scoring';
import { addGrad, applyGrad, applyGradAdam, clampWeightNorms, createAdamState, deserializeGradient, scaleGrad, zeroGrad, type AdamState } from './train';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';
import {
  ACTIVE_CRITIC_FEATURE_DIM,
  ACTIVE_FEATURE_DIM,
  buildStarterDeck,
  chooseLearnerAction,
  EPSILON,
  FLOOR_WEIGHT,
  SHAPING_WEIGHT,
  HABITAT_FILTER,
  MAX_ACTIONS_PER_GAME,
  randomMaxRounds,
  RL_CURRICULUM_OPPONENTS,
  RL_EDITION,
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
// Optimizador de la POLÍTICA (el crítico usa Adam siempre: es una regresión
// normal y ahí va bien). Por defecto SGD, como en todas las tandas largas
// que han funcionado (|w1|≈10 tras 4000 batches). Adam (añadido el
// 2026-09-16) se probó en una tanda larga ese mismo día y hace crecer las
// normas de los pesos sin freno: x5 en 900 batches (|w1| 10 -> 55, del 0%
// al 25-33% de unidades tanh saturadas), porque da pasos de tamaño ~lr en
// la dirección del gradiente aunque este sea minúsculo, y el gradiente de
// política siempre empuja en la misma dirección (sube la acción elegida,
// baja el resto) — con SGD el paso encoge cuando el softmax se satura y la
// escala se estabiliza sola. RL_OPTIMIZER=adam lo reactiva para
// experimentos.
const POLICY_OPTIMIZER = process.env.RL_OPTIMIZER === 'adam' ? 'adam' : 'sgd';
// Topes de norma de la política (ver clampWeightNorms en train.ts). 16 ≈ lo
// que medían las redes sanas de tandas anteriores (|w1|≈|w2|≈10 con 32
// unidades ocultas; con 48 escala a ~12-13) con algo de margen. Se aplica
// tras CADA actualización; al arrancar sobre unos pesos ya inflados (el
// general venía con |w1|≈48 y el 60% de unidades saturadas) el primer
// batch los reescala de golpe al tope — es la "desaturación" acordada con
// el usuario el 2026-09-16 (factor 3, ver desaturateWeights.ts para la
// comprobación en duelos que se hizo antes de decidirlo).
const MAX_NORM_W1 = Number(process.env.RL_MAX_NORM_W1 ?? 16);
const MAX_NORM_W2 = Number(process.env.RL_MAX_NORM_W2 ?? 16);
const EVAL_EVERY = Number(process.env.RL_EVAL_EVERY ?? 50);
const EVAL_GAMES = Number(process.env.RL_EVAL_GAMES ?? 40);

// "Gatekeeper" (pedido explícito del usuario 2026-09-23, mismo patrón que
// usa AlphaZero para autojuego): cada RL_GATE_EVERY batches, el candidato
// (los pesos tal como van ahora mismo) se examina contra el MEJOR conocido
// hasta ahora (bestWeights/bestCriticWeights más abajo, no necesariamente
// el checkpoint anterior más reciente) jugando cada uno RL_GATE_GAMES
// partidas de 4 contra el mismo trío de RL_CURRICULUM_OPPONENTS (los
// rivales precargados de entrenamiento, no una referencia externa — decisión
// explícita del usuario, con la contrapartida de que hay que ir
// actualizando esos rivales a mano de vez en cuando). Si el candidato gana
// más partidas que el mejor, se promueve a nuevo mejor; si no, política +
// crítico + estado de Adam del crítico se REVIERTEN al mejor conocido antes
// de seguir entrenando — así una racha que empeora (como el bucle del
// Tiranosaurio/Diplodocus del 22/09, o la caída de puntos vista en varias
// comprobaciones manuales de esta sesión) no se queda para siempre en el
// fichero de pesos ni contamina los batches siguientes. RL_GATE_EVERY=0
// desactiva el mecanismo entero (comportamiento de antes).
const GATE_EVERY = Number(process.env.RL_GATE_EVERY ?? 500);
const GATE_GAMES = Number(process.env.RL_GATE_GAMES ?? 1000);

// Edición completa (2026-09-21): archivo propio (weights-full.json), nunca
// weights.json — ese es el generalista CLÁSICO que juega la web publicada,
// con una dimensión de features totalmente distinta (ver featuresFull.ts).
// HABITAT_FILTER no aplica todavía a la completa (sin especialistas de
// hábitat/tipo propios de momento), así que se ignora si RL_EDITION=full.
// RL_RUN_TAG (opcional): sufijo para correr varios intentos independientes
// de la MISMA variante en paralelo sin que se pisen el fichero de pesos —
// cada uno lee/escribe su propia copia numerada (p. ej.
// weights-aquatic-r01.json). Vacío por defecto: cero cambio de
// comportamiento respecto a antes de que existiera esta variable.
const RUN_TAG = process.env.RL_RUN_TAG ? `-${process.env.RL_RUN_TAG}` : '';
const WEIGHTS_FILE =
  RL_EDITION === 'full'
    ? HABITAT_FILTER
      ? `weights-full-${HABITAT_FILTER}${RUN_TAG}.json`
      : `weights-full${RUN_TAG}.json`
    : HABITAT_FILTER
      ? `weights-${HABITAT_FILTER}${RUN_TAG}.json`
      : `weights${RUN_TAG}.json`;
const WEIGHTS_PATH = fileURLToPath(new URL(`../../src/bots/rl/${WEIGHTS_FILE}`, import.meta.url));
// El crítico vive AQUÍ (scripts/rl/), no en src/bots/rl/ junto a los pesos
// de política: nunca lo usa el bot de verdad (solo sirve durante el
// entrenamiento, para calcular la ventaja), así que no tiene sentido que
// esté en la carpeta que sí importa apps/web — así queda claro que es un
// artefacto de entrenamiento, nunca "enviable".
const CRITIC_FILE =
  RL_EDITION === 'full'
    ? HABITAT_FILTER
      ? `critic-full-${HABITAT_FILTER}${RUN_TAG}.json`
      : `critic-full${RUN_TAG}.json`
    : HABITAT_FILTER
      ? `critic-${HABITAT_FILTER}${RUN_TAG}.json`
      : `critic${RUN_TAG}.json`;
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
  let truncatedGames = 0;

  for (const r of results) {
    addGrad(grad, r.grad);
    addGrad(criticGrad, r.criticGrad);
    episodesUsed += r.episodesUsed;
    sumAbsAdvantage += r.sumAbsAdvantage;
    sumReturn += r.sumReturn;
    stepCount += r.stepCount;
    truncatedGames += r.truncatedGames;
  }

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed, truncatedGames };
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
): Promise<{ avgAbsAdvantage: number; avgReturn: number; truncatedGames: number }> {
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
  if (POLICY_OPTIMIZER === 'adam') applyGradAdam(weights, merged.grad, policyAdam, LEARNING_RATE);
  else applyGrad(weights, merged.grad, LEARNING_RATE);
  clampWeightNorms(weights, MAX_NORM_W1, MAX_NORM_W2);
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
    truncatedGames: merged.truncatedGames,
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

    const state = createGame(configs, { maxRounds: randomMaxRounds(), edition: RL_EDITION });

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

// Partidas de 4 contra el trío precargado de RL_CURRICULUM_OPPONENTS (no
// 1 contra 1 como evaluate() de arriba): mide lo mismo que ven las
// partidas de entrenamiento de verdad, así que es la referencia natural
// para el gatekeeper. El asiento del candidato rota entre las 4 posiciones
// para que el orden de turno no sesgue el resultado. Greedy (temperatura
// 0, igual que evaluate()): decide con la mejor acción según la red, sin
// aleatoriedad de exploración.
function evaluateAgainstCurriculum(weights: RlWeights, games: number): { winRate: number; avgScore: number } {
  let wins = 0;
  let scoreTotal = 0;

  for (let g = 0; g < games; g++) {
    const seat = g % 4;
    const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
    const state = createGame(playerConfigs, { maxRounds: randomMaxRounds(), edition: RL_EDITION });
    const candidateId = playerConfigs[seat].id;
    // Asigna a cada asiento que NO es el candidato uno de los 3 rivales
    // precargados, en orden, saltándose el asiento del candidato.
    const opponentBySeat = new Map<string, Bot>();
    let oppIdx = 0;
    for (let i = 0; i < 4; i++) {
      if (i === seat) continue;
      opponentBySeat.set(playerConfigs[i].id, RL_CURRICULUM_OPPONENTS[oppIdx]);
      oppIdx++;
    }

    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      const action =
        player.id === candidateId
          ? chooseLearnerAction(state, player.id, weights)
          : opponentBySeat.get(player.id)!.chooseAction(state, player.id);
      applyAction(state, player.id, action);
      guard++;
    }

    const scores = scoreGame(state);
    const candidateScore = scores.find((s) => s.playerId === candidateId)?.score ?? 0;
    const best = Math.max(...scores.map((s) => s.score));
    scoreTotal += candidateScore;
    if (candidateScore >= best) wins += scores.filter((s) => s.score >= best).length > 1 ? 0.5 : 1;
  }

  return { winRate: wins / games, avgScore: scoreTotal / games };
}

// Copian el CONTENIDO de src encima de dest sin reasignar la variable
// externa (weights/criticWeights/criticAdam siguen siendo el mismo objeto
// que ya tienen capturado trainBatch/los workers) — así un revert del
// gatekeeper se ve de inmediato en el resto del proceso sin más cambios.
function restoreWeightsInto(dest: RlWeights, src: RlWeights): void {
  const clone = structuredClone(src);
  dest.w1 = clone.w1;
  dest.b1 = clone.b1;
  dest.w2 = clone.w2;
  dest.b2 = clone.b2;
}
function restoreAdamInto(dest: AdamState, src: AdamState): void {
  const clone = structuredClone(src);
  dest.m = clone.m;
  dest.v = clone.v;
  dest.t = clone.t;
}

async function main(): Promise<void> {
  const weights = loadOrInitWeights(WEIGHTS_PATH, ACTIVE_FEATURE_DIM, HIDDEN_SIZE);
  const criticWeights = loadOrInitWeights(CRITIC_PATH, ACTIVE_CRITIC_FEATURE_DIM, CRITIC_HIDDEN_SIZE);
  // Estado de Adam (ver train.ts): vive solo en memoria de este proceso, no
  // se guarda en weights*.json — cada invocación de train:rl arranca sus
  // medias móviles desde cero aunque continúe unos pesos ya entrenados.
  const policyAdam = createAdamState(weights.featureDim, weights.hiddenSize);
  const criticAdam = createAdamState(criticWeights.featureDim, criticWeights.hiddenSize);

  // Punto de partida de esta invocación = primer "mejor conocido" del
  // gatekeeper (ver GATE_EVERY arriba). Si GATE_EVERY<=0 nunca se usan.
  const bestWeights = structuredClone(weights);
  const bestCriticWeights = structuredClone(criticWeights);
  const bestCriticAdam = structuredClone(criticAdam);
  let totalTruncatedGames = 0;
  let totalEpisodesSoFar = 0;

  const habitatLabel = HABITAT_FILTER ? ` (especialista: solo compra ${HABITAT_FILTER})` : '';
  console.log(
    `Entrenando rlBot${habitatLabel}: ${TOTAL_BATCHES} batches x ${EPISODES_PER_BATCH} partidas, optimizador=${POLICY_OPTIMIZER}, max_norm_w1=${MAX_NORM_W1}, max_norm_w2=${MAX_NORM_W2}, lr=${LEARNING_RATE}, critic_lr=${CRITIC_LR}, epsilon=${EPSILON}, shaping=${SHAPING_WEIGHT}, floor_weight=${FLOOR_WEIGHT}, workers=${WORKER_COUNT}, gate_every=${GATE_EVERY}, gate_games=${GATE_GAMES}`
  );

  try {
    for (let batch = 0; batch < TOTAL_BATCHES; batch++) {
      const { avgAbsAdvantage, avgReturn, truncatedGames } = await trainBatch(weights, criticWeights, policyAdam, criticAdam);
      totalTruncatedGames += truncatedGames;
      totalEpisodesSoFar += EPISODES_PER_BATCH;

      if (batch % EVAL_EVERY === 0 || batch === TOTAL_BATCHES - 1) {
        const winrateVsHeuristic = evaluate(weights, heuristicBot, EVAL_GAMES);
        const winrateVsRandom = evaluate(weights, randomBot, EVAL_GAMES);
        // Pedido explícito del usuario 2026-09-23: cuántas partidas de
        // entrenamiento (desde el arranque de este proceso, no solo este
        // batch) se cortaron por el tope de seguridad MAX_ACTIONS_PER_GAME
        // en vez de terminar de verdad — ver playOneGame en trainCore.ts.
        // Debería quedarse en 0.00% siempre; si empieza a subir, señala
        // partidas anormalmente largas (posible atasco real, no solo ruido).
        const truncatedPct = totalEpisodesSoFar > 0 ? (totalTruncatedGames / totalEpisodesSoFar) * 100 : 0;
        console.log(
          `batch=${batch} avg_return=${avgReturn.toFixed(3)} critic_avg_abs_advantage=${avgAbsAdvantage.toFixed(3)} ` +
            `winrate_vs_heuristic=${winrateVsHeuristic.toFixed(2)} winrate_vs_random=${winrateVsRandom.toFixed(2)} ` +
            `truncated_games=${totalTruncatedGames}/${totalEpisodesSoFar} (${truncatedPct.toFixed(2)}%)`
        );
        await saveWeightsWithRetry(weights, WEIGHTS_PATH);
        await saveWeightsWithRetry(criticWeights, CRITIC_PATH);
      }

      if (GATE_EVERY > 0 && batch > 0 && batch % GATE_EVERY === 0) {
        const candidate = evaluateAgainstCurriculum(weights, GATE_GAMES);
        const best = evaluateAgainstCurriculum(bestWeights, GATE_GAMES);
        if (candidate.winRate > best.winRate) {
          restoreWeightsInto(bestWeights, weights);
          restoreWeightsInto(bestCriticWeights, criticWeights);
          restoreAdamInto(bestCriticAdam, criticAdam);
          console.log(
            `  [gatekeeper] batch=${batch} candidato ${(candidate.winRate * 100).toFixed(1)}% (PV ${candidate.avgScore.toFixed(1)}) ` +
              `> mejor ${(best.winRate * 100).toFixed(1)}% (PV ${best.avgScore.toFixed(1)}) — PROMOVIDO a nuevo mejor`
          );
        } else {
          restoreWeightsInto(weights, bestWeights);
          restoreWeightsInto(criticWeights, bestCriticWeights);
          restoreAdamInto(criticAdam, bestCriticAdam);
          console.log(
            `  [gatekeeper] batch=${batch} candidato ${(candidate.winRate * 100).toFixed(1)}% (PV ${candidate.avgScore.toFixed(1)}) ` +
              `<= mejor ${(best.winRate * 100).toFixed(1)}% (PV ${best.avgScore.toFixed(1)}) — REVERTIDO al mejor conocido`
          );
        }
        await saveWeightsWithRetry(weights, WEIGHTS_PATH);
        await saveWeightsWithRetry(criticWeights, CRITIC_PATH);
      }
    }

    // Al terminar la tanda, el fichero en disco debe reflejar el MEJOR
    // conocido, no el último candidato en curso (que puede llevar menos de
    // GATE_EVERY batches sin examinar todavía, o haber sido rechazado en el
    // último gate y ya estar revertido a esto mismo de todas formas).
    if (GATE_EVERY > 0) {
      restoreWeightsInto(weights, bestWeights);
      restoreWeightsInto(criticWeights, bestCriticWeights);
    }
    await saveWeightsWithRetry(weights, WEIGHTS_PATH);
    await saveWeightsWithRetry(criticWeights, CRITIC_PATH);
    console.log('Entrenamiento terminado. Pesos guardados en', WEIGHTS_PATH, 'y', CRITIC_PATH);
  } finally {
    for (const worker of workers) worker.kill();
  }

  // RL_SKIP_RECALIBRATE=1: para pruebas cortas (humo/ablaciones) en las que
  // no interesa esperar las ~600 partidas de la recalibración. La edición
  // completa siempre se salta este paso: calibrateScalerValues.ts es
  // enteramente de la clásica (sus 4 variantes, su createGame sin edition),
  // y SCALER_CALIBRATION ya vale {} a propósito para 'full' (ver
  // trainCore.ts) — no hay nada que este paso pudiera mejorar todavía.
  if (RL_EDITION !== 'full' && process.env.RL_SKIP_RECALIBRATE !== '1') await recalibrateScalerValues();
}

// Norma pedida explícitamente por el usuario (2026-09-16): recalcular
// scalerCalibration.json después de CADA entrenamiento, no solo a mano de
// vez en cuando — si no, el valor de shaping de Águila/Orca/Oso polar/
// Albatros/Tucán/Tiburón se queda anclado a como jugaba el bot mucho más
// atrás y deja de reflejar lo que de verdad es capaz de acumular ahora.
//
// Tiene que ser un PROCESO NUEVO, no una llamada normal dentro de este
// mismo proceso: rlBot.ts importa weights*.json como JSON estático al
// arrancar (`import defaultWeightsJson from './rl/weights.json'`), así que
// aunque este proceso acabe de guardar pesos nuevos en disco, sus propias
// copias de rlBot/landRlBot/birdRlBot/aquaticRlBot seguirían siendo las de
// cuando arrancó — calibrateScalerValues.ts en un proceso aparte los vuelve
// a leer de disco desde cero y sí ve los recién guardados.
async function recalibrateScalerValues(): Promise<void> {
  console.log('Recalibrando scalerCalibration.json con los pesos recién guardados...');
  await new Promise<void>((resolve) => {
    // Anotado como ChildProcessWithoutNullStreams (igual que spawnWorker más
    // arriba) solo para que TS resuelva bien las sobrecargas de .on(): no se
    // toca stdout/stdin como stream en ningún momento, todo va con
    // stdio:'inherit' (se ve directamente en esta terminal).
    const child: ChildProcessWithoutNullStreams = spawn(
      process.execPath,
      [VITE_NODE_ENTRY, 'scripts/rl/calibrateScalerValues.ts'],
      { cwd: ENGINE_DIR, env: process.env, stdio: ['inherit', 'inherit', 'inherit'] }
    );
    // Un fallo aquí no debe tirar el entrenamiento ya terminado y guardado:
    // como mucho, la próxima tanda usa una calibración desactualizada, igual
    // que pasaba antes de esta norma.
    child.on('exit', () => resolve());
    // TS en este proyecto no resuelve bien la sobrecarga de .on('error', ...)
    // sobre ChildProcess (ver .on('exit', ...) arriba, que sí funciona sin
    // más); en vez de pelear con el tipado exacto, se trata como un emisor
    // de eventos genérico solo para esta línea.
    (child as unknown as { on(event: 'error', listener: (err: Error) => void): void }).on('error', (err) => {
      console.warn('No se pudo recalibrar scalerCalibration.json:', err);
      resolve();
    });
  });
}

main();
