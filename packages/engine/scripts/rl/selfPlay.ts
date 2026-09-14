// Entrenamiento por self-play del rlBot. Se ejecuta con vite-node (no
// node/tsx a secas: cards/registry.ts usa import.meta.glob, una API solo de
// Vite) vía `npm run train:rl -w packages/engine`. Nunca se importa desde
// src/index.ts ni desde apps/web: es una herramienta de desarrollo, no algo
// que la app o el motor necesiten en tiempo de ejecución normal.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { animalBuyerBot } from '../../src/bots/animalBuyerBot';
import { expensiveFirstBot } from '../../src/bots/expensiveFirstBot';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { randomBot } from '../../src/bots/randomBot';
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import { CRITIC_FEATURE_DIM, encodeAction, encodePlayerContext, FEATURE_DIM } from '../../src/bots/rl/features';
import { createRandomWeights, deserializeWeights, forward, serializeWeights, type RlWeights } from '../../src/bots/rl/network';
import type { Bot } from '../../src/bots/types';
import { getCard } from '../../src/cards/registry';
import type { Card } from '../../src/cards/schema';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, getLegalActions, type Action } from '../../src/engine';
import type { GameState } from '../../src/model/state';
import { scoreGame, scorePlayer, type PlayerScore } from '../../src/scoring';
import { accumulateGrad, applyGrad, softmax, zeroGrad } from './train';
import { computeReturn } from './reward';

const HIDDEN_SIZE = 32;
const LEARNING_RATE = Number(process.env.RL_LR ?? 0.01);
const TRAIN_TEMPERATURE = 1;
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
// Cota de seguridad para la ventaja (retorno − predicción del crítico): sin
// esto, un crítico recién inicializado (pesos aleatorios) que arranca
// prediciendo mal produce una ventaja grande, que a su vez empuja un
// gradiente grande sobre el propio crítico (accumulateGrad suma esa ventaja
// sin normalizar por el número de pasos del batch, solo por episodesUsed),
// lo que lo deja prediciendo AÚN peor en el siguiente batch — un
// retroalimentación positiva que en la práctica diverge a Infinity/NaN en
// unas pocas decenas de batches (visto en producción: avg_abs_advantage
// pasó de ~1.4 en el batch 0 a ~1e119 en el batch 100, corrompiendo también
// los pesos de política, que comparten la misma `advantage` como escala de
// su propio delta). Recortar la ventaja a un rango razonable (los retornos
// de computeReturn ya viven en un rango de pocas unidades) rompe ese bucle
// sin cambiar el comportamiento normal, donde la ventaja real casi nunca se
// acerca a esta cota.
const ADVANTAGE_CLIP = 5;
// Reward shaping: al comprar un animal, además de la ventaja normal
// (crítico), se añade a ese paso concreto el delta de PV EN VIVO que
// produce esa compra ahora mismo (scorePlayer del estado justo antes menos
// justo después, no destructivo mientras la partida sigue en marcha — ver
// scorePlayer en scoring.ts). Sin esto, una carta cuyo valor depende de una
// condición sobre TODA la colección (p. ej. Tucán: +1 PV por cada animal de
// coste 5+ que tengas) solo recibe crédito a través del retorno final,
// muchos turnos después de comprarla — una señal muy dispersa para que
// REINFORCE aprenda a atribuírselo a esa decisión en concreto. Escalado con
// el mismo /20 que usa computeReturn para que quede en un rango comparable
// al de la ventaja normal. Ver el análisis de por qué el Tucán seguía
// infravalorado incluso con el crítico y por qué empujarlo a mano no
// funcionaba (memoria de proyecto rl_manual_card_boost_no_improvement.md).
const SHAPING_WEIGHT = Number(process.env.RL_SHAPING_WEIGHT ?? 1);
const EVAL_EVERY = Number(process.env.RL_EVAL_EVERY ?? 50);
const EVAL_GAMES = Number(process.env.RL_EVAL_GAMES ?? 40);
const MAX_ACTIONS_PER_GAME = 400;

// Entrena un especialista de hábitat (RL_HABITAT=land|bird|aquatic): el
// aprendiz (en self-play Y en curriculum, nunca los oponentes fijos) solo
// puede comprar animales de ese hábitat, en TODAS las partidas de
// entrenamiento y evaluación. Sin la variable, entrena el bot normal sin
// restricciones. Cada especialista guarda sus propios pesos, nunca
// sobrescribe weights.json.
const HABITAT_FILTER = process.env.RL_HABITAT;
if (HABITAT_FILTER && !['land', 'bird', 'aquatic'].includes(HABITAT_FILTER)) {
  throw new Error(`RL_HABITAT inválido: "${HABITAT_FILTER}" (usa land, bird o aquatic)`);
}

const WEIGHTS_FILE = HABITAT_FILTER ? `weights-${HABITAT_FILTER}.json` : 'weights.json';
const WEIGHTS_PATH = fileURLToPath(new URL(`../../src/bots/rl/${WEIGHTS_FILE}`, import.meta.url));
// El crítico vive AQUÍ (scripts/rl/), no en src/bots/rl/ junto a los pesos
// de política: nunca lo usa el bot de verdad (solo sirve durante el
// entrenamiento, para calcular la ventaja), así que no tiene sentido que
// esté en la carpeta que sí importa apps/web — así queda claro que es un
// artefacto de entrenamiento, nunca "enviable".
const CRITIC_FILE = HABITAT_FILTER ? `critic-${HABITAT_FILTER}.json` : 'critic.json';
const CRITIC_PATH = fileURLToPath(new URL(`./${CRITIC_FILE}`, import.meta.url));

// Duraciones reales que se pueden elegir en la app (ver ROUND_LIMIT_OPTIONS
// en apps/web/src/lib/gameConfig.ts — mantener sincronizado si cambia ahí):
// entrenar siempre sin límite (como antes) no representa ninguna partida
// real, así que cada episodio sortea una de estas 3 duraciones. Junto con
// hasRoundLimit/roundProgress en features.ts, esto le permite a la red
// aprender a jugar distinto según cuánta prisa tenga en vez de asumir
// siempre "partida larga".
const REALISTIC_ROUND_LIMITS = [10, 15, 20] as const;
function randomMaxRounds(): number {
  return REALISTIC_ROUND_LIMITS[Math.floor(Math.random() * REALISTIC_ROUND_LIMITS.length)];
}

// Las otras 3 variantes de rlBot (pesos ya guardados en disco al arrancar
// este proceso, congelados durante todo este entrenamiento — no es
// co-evolución en vivo, es "entrenar contra la última generación
// completa"), como oponentes de currículum además de los bots fijos de
// siempre: sin esto, ningún especialista ve nunca el estilo de juego de
// otro rlBot (solo clones de sí mismo o heurísticas simples), aunque en una
// partida real de la app es habitual mezclar algoritmos distintos por bot.
// Se excluye la variante que se está entrenando ahora mismo (no tiene
// sentido enfrentarla contra una copia congelada de sí misma con este
// mecanismo; para eso ya está el self-play).
const RL_VARIANT_BOTS: Record<'general' | 'land' | 'bird' | 'aquatic', Bot> = {
  general: rlBot,
  land: landRlBot,
  bird: birdRlBot,
  aquatic: aquaticRlBot,
};
const CURRENT_VARIANT = (HABITAT_FILTER as 'land' | 'bird' | 'aquatic' | undefined) ?? 'general';
const RL_CURRICULUM_OPPONENTS = Object.entries(RL_VARIANT_BOTS)
  .filter(([variant]) => variant !== CURRENT_VARIANT)
  .map(([, bot]) => bot);

const CURRICULUM_OPPONENTS: Bot[] = [randomBot, heuristicBot, expensiveFirstBot, animalBuyerBot, ...RL_CURRICULUM_OPPONENTS];

function filterActionsForHabitat(state: GameState, actions: Action[]): Action[] {
  if (!HABITAT_FILTER) return actions;
  return actions.filter((a) => {
    if (a.type !== 'buyAnimal') return true;
    const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
    return (animal?.habitats as string[] | undefined)?.includes(HABITAT_FILTER) ?? false;
  });
}

// Puntúa y elige, en modo greedy (temperature 0), entre las acciones legales
// ya filtradas por hábitat. Sustituye a createRlBot en este script porque
// createRlBot no conoce el filtro de hábitat (es una restricción exclusiva
// del entrenamiento de especialistas, no del bot que se usa en la app).
function chooseLearnerAction(state: GameState, playerId: string, weights: RlWeights): Action {
  const actions = filterActionsForHabitat(state, getLegalActions(state, playerId));
  if (actions.length === 0) return { type: 'endTurn' };
  const scores = actions.map((a) => forward(weights, encodeAction(state, playerId, a)).score);
  const best = Math.max(...scores);
  const bestIdx = actions.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
  return actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]];
}

// Replica tests/helpers.ts / apps/web/src/lib/starterDeck.ts (no exportado
// desde el paquete, así que cada consumidor lo define localmente).
function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

function sampleIndex(scores: number[], temperature: number): number {
  const probs = softmax(scores.map((s) => s / temperature));
  let roll = Math.random();
  for (let i = 0; i < probs.length; i++) {
    roll -= probs[i];
    if (roll <= 0) return i;
  }
  return probs.length - 1;
}

interface Step {
  allFeatures: number[][];
  allHidden: number[][];
  allScores: number[];
  chosenIndex: number;
  // Features de SOLO ESTADO en el momento de esta decisión (antes de
  // elegir la acción) — ver CRITIC_FEATURE_DIM/encodePlayerContext en
  // features.ts. El crítico las usa para estimar cuánto "vale" ya este
  // estado, independientemente de qué se acabe eligiendo.
  stateFeatures: number[];
  // Reward shaping (ver SHAPING_WEIGHT arriba): delta de PV en vivo que
  // produjo la acción elegida, ya escalado (/20). 0 para cualquier acción
  // que no sea comprar un animal (playCard/buyCoin/endTurn casi nunca
  // cambian el PV en vivo, y calcular scorePlayer() en cada paso sería
  // demasiado caro para lo poco que aportaría ahí).
  shapingBonus: number;
}

type Mode = 'selfplay' | 'curriculum';

// 1 de cada 5 partidas se juega contra los bots fijos (uno distinto al azar
// por rival) para variar el estilo de juego contra el que se entrena; el
// resto son self-play puro (los 4 asientos son el mismo aprendiz).
function pickMode(episodeIndex: number): Mode {
  return episodeIndex % 5 === 0 ? 'curriculum' : 'selfplay';
}

// Juega una partida completa y devuelve, por cada asiento que cuenta para
// el gradiente (todos en self-play; solo el asiento que no tiene un bot fijo
// asignado en modo curriculum), su lista de decision points.
function playOneGame(weights: RlWeights, mode: Mode): { trajectories: Map<string, Step[]>; finalScores: PlayerScore[] } {
  const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
  const state = createGame(playerConfigs, { maxRounds: randomMaxRounds() });

  const fixedOpponents = new Map<string, Bot>();
  if (mode === 'curriculum') {
    for (let i = 1; i < playerConfigs.length; i++) {
      const opponent = CURRICULUM_OPPONENTS[Math.floor(Math.random() * CURRICULUM_OPPONENTS.length)];
      fixedOpponents.set(playerConfigs[i].id, opponent);
    }
  }

  const trajectories = new Map<string, Step[]>();
  for (const cfg of playerConfigs) {
    if (!fixedOpponents.has(cfg.id)) trajectories.set(cfg.id, []);
  }

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    // Con un descarte pendiente (Buitre/Mono/Hiena/Murciélago), nadie tiene
    // ninguna acción legal hasta que se resuelva: sin esto, el bucle de
    // abajo vería `actions.length === 0` y cortaría el episodio de
    // entrenamiento en seco cada vez que se juegue una de esas cartas.
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

    const actions = filterActionsForHabitat(state, getLegalActions(state, player.id));
    if (actions.length === 0) break;

    const allFeatures = actions.map((action) => encodeAction(state, player.id, action));
    const allForward = allFeatures.map((x) => forward(weights, x));
    const allScores = allForward.map((f) => f.score);
    const chosenIndex = sampleIndex(allScores, TRAIN_TEMPERATURE);

    const chosenAction = actions[chosenIndex];
    const stateFeatures = encodePlayerContext(state, player);
    const scoreBefore = chosenAction.type === 'buyAnimal' ? scorePlayer(state, player) : 0;

    applyAction(state, player.id, chosenAction);

    const shapingBonus =
      chosenAction.type === 'buyAnimal' ? (scorePlayer(state, player) - scoreBefore) / 20 : 0;

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

// Devuelve estadísticas del batch para el log (ver main): la media de
// |ventaja| (cuánto se equivocaba el crítico de media, en valor absoluto —
// baja con el entrenamiento si el crítico aprende bien) y la media de
// retorno crudo (a título informativo, sin más).
function trainBatch(weights: RlWeights, criticWeights: RlWeights): { avgAbsAdvantage: number; avgReturn: number } {
  const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
  const criticGrad = zeroGrad(criticWeights.featureDim, criticWeights.hiddenSize);
  let episodesUsed = 0;
  let sumAbsAdvantage = 0;
  let sumReturn = 0;
  let stepCount = 0;

  for (let e = 0; e < EPISODES_PER_BATCH; e++) {
    const { trajectories, finalScores } = playOneGame(weights, pickMode(e));

    for (const [playerId, steps] of trajectories) {
      if (steps.length === 0) continue;

      const returnValue = computeReturn(finalScores, playerId);
      sumReturn += returnValue;

      for (const step of steps) {
        // Ventaja CONDICIONADA AL ESTADO de este paso concreto, no un único
        // número compartido por toda la partida: el crítico predice cuánto
        // "debería" valer el retorno esperado ya desde este estado (turno,
        // colección, valor de compra...), y la ventaja es cuánto se quedó
        // corto o se pasó esa predicción respecto al retorno real. Así una
        // carta cuyo valor depende de CUÁNDO se juega (más turnos por
        // delante = más veces se puede rejugar un efecto reutilizable)
        // puede aprender esa diferencia; antes, con una baseline global,
        // recibía la misma ventaja sin importar el turno.
        const critic = forward(criticWeights, step.stateFeatures);
        const rawAdvantage = returnValue - critic.score;
        const advantage = Math.max(-ADVANTAGE_CLIP, Math.min(ADVANTAGE_CLIP, rawAdvantage));
        sumAbsAdvantage += Math.abs(rawAdvantage);
        stepCount++;

        // El shaping SOLO se añade a la ventaja que mueve la POLÍTICA (qué
        // acción reforzar en este paso), nunca a la que regresiona el
        // crítico: el crítico predice el retorno real de fin de partida, no
        // un retorno "con bonus" — mezclar el shaping ahí lo desviaría de
        // lo que de verdad tiene que aprender a predecir.
        const policyAdvantage = advantage + SHAPING_WEIGHT * step.shapingBonus;

        const probs = softmax(step.allScores);
        for (let k = 0; k < probs.length; k++) {
          const delta = ((k === step.chosenIndex ? 1 : 0) - probs[k]) * policyAdvantage;
          accumulateGrad(grad, step.allFeatures[k], step.allHidden[k], weights.w2, delta);
        }
        // Regresión del crítico hacia el retorno real: el "delta" de ascenso
        // que empuja su predicción en la dirección correcta es exactamente
        // (objetivo − predicción), que ya es `advantage` tal cual.
        accumulateGrad(criticGrad, step.stateFeatures, critic.hidden, criticWeights.w2, advantage);
      }
      episodesUsed++;
    }
  }

  applyGrad(weights, grad, LEARNING_RATE / Math.max(1, episodesUsed));
  // Normalizado por stepCount (número de decisiones, no de episodios): es
  // una regresión de error cuadrático sobre cada paso, no un gradiente de
  // política por episodio, así que promediar por episodio infla el tamaño
  // real del paso en un factor igual a "pasos por episodio" (~20-40x) —
  // justo lo que causaba la divergencia descrita arriba en ADVANTAGE_CLIP.
  applyGrad(criticWeights, criticGrad, CRITIC_LR / Math.max(1, stepCount));

  return {
    avgAbsAdvantage: stepCount > 0 ? sumAbsAdvantage / stepCount : 0,
    avgReturn: episodesUsed > 0 ? sumReturn / episodesUsed : 0,
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
      // desalineando el gradiente en vez de fallar con un error claro —
      // exactamente lo que pasó al subir FEATURE_DIM de 64 a 72 sin este
      // chequeo: el entrenamiento arrancaba pareciendo "seguir" pero en
      // realidad estaba corrompido desde el primer batch.
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
// los pesos de las otras 3 variantes al arrancar (ver RL_VARIANT_BOTS, para
// el cruce entre bots), corren con mucha más E/S simultánea en este mismo
// directorio que antes — cada uno guarda SU PROPIO checkpoint cada
// EVAL_EVERY batches, así que con los 4 en paralelo hay escrituras
// entrelazadas constantes. En Windows eso puede toparse con un bloqueo de
// archivo transitorio (antivirus/indexador tocando el directorio justo en
// ese instante, "UNKNOWN: unknown error" de writeFileSync) — visto en la
// práctica reventando un entrenamiento entero (una vez en el batch 1250 de
// 2000, otra en el 1600, con los 5 reintentos anteriores agotados),
// tirando horas de progreso ya bueno por la borda por un solo guardado que
// no consiguió abrir el archivo. Ahora escribe a un archivo TEMPORAL propio
// (nombre único por proceso, nunca lo abre nadie más) y solo AL FINAL hace
// un rename atómico sobre el destino — un rename no necesita abrir el
// destino para escribir contenido, así que es mucho menos sensible a que
// otro proceso lo tenga abierto para lectura en ese instante que un
// writeFileSync directo. Aun así reintenta el conjunto (escritura+rename)
// varias veces con espera creciente antes de rendirse de verdad.
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

  const habitatLabel = HABITAT_FILTER ? ` (especialista: solo compra ${HABITAT_FILTER})` : '';
  console.log(
    `Entrenando rlBot${habitatLabel}: ${TOTAL_BATCHES} batches x ${EPISODES_PER_BATCH} partidas, lr=${LEARNING_RATE}, critic_lr=${CRITIC_LR}`
  );

  for (let batch = 0; batch < TOTAL_BATCHES; batch++) {
    const { avgAbsAdvantage, avgReturn } = trainBatch(weights, criticWeights);

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
}

main();
