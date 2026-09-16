// Desaturación de una red de rlBot (2026-09-16): divide uniformemente los
// pesos de la PRIMERA capa (w1 y b1) por un factor para sacar las unidades
// tanh de la zona de "interruptor" (|preactivación| > 3, donde tanh vale
// ±1 fijo, no distingue matices y su pendiente ≈ 0 congela el aprendizaje).
// El bot general llegó así de una tanda con Adam: |w1| ≈ 44 y el 60% de
// las unidades saturadas sobre estados reales, frente a |w1| ≈ 10 y 0-1%
// en los especialistas. Escalar w1/b1 no cambia el ORDEN de las
// preactivaciones de cada unidad, y como tanh es monótona tampoco el orden
// de sus salidas; sí cambia (suaviza) cómo se combinan en el score, así que
// el script comprueba en partidas reales que el bot no juega peor antes de
// guardar.
//
// Uso: npx vite-node scripts/rl/desaturateWeights.ts [archivo=weights.json] [objetivo |preact| media=1.0] [partidas=60] [--write]
// Sin --write solo informa. Con --write guarda si la versión desaturada no
// pierde claramente contra la actual (ver umbral abajo).
import { fileURLToPath } from 'node:url';
import { legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeActionsForPlayer, FEATURE_DIM } from '../../src/bots/rl/features';
import { type RlWeights } from '../../src/bots/rl/network';
import { createRlBot } from '../../src/bots/rlBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scoreGame } from '../../src/scoring';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';
import { loadOrInitWeights, saveWeightsWithRetry } from './weightsIo';

const FILE = process.argv[2] ?? 'weights.json';
const TARGET_MEAN_PREACT = Number(process.argv[3] ?? 1.0);
const GAMES = Number(process.argv[4] ?? 60);
const WRITE = process.argv.includes('--write');
// La desaturada debe ganar al menos esta fracción de las partidas 1v1
// contra la actual para guardarse (0.5 = empate; se acepta un margen
// pequeño de ruido por debajo).
const MIN_WINRATE_VS_CURRENT = 0.45;

function scaledFirstLayer(weights: RlWeights, factor: number): RlWeights {
  return {
    ...weights,
    w1: weights.w1.map((row) => row.map((v) => v / factor)),
    b1: weights.b1.map((v) => v / factor),
    w2: Float64Array.from(weights.w2),
  };
}

// Estados reales: todas las candidatas de decisiones de compra de partidas
// entre heuristicBots.
function sampleFeatures(games: number): number[][] {
  const feats: number[][] = [];
  for (let g = 0; g < games; g++) {
    const state = createGame(Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() })), { maxRounds: randomMaxRounds() });
    let guard = 0;
    while (!state.gameOver && guard++ < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) continue;
      const player = getActivePlayer(state);
      const actions = legalActionsForBot(state, player.id);
      if (actions.some((a) => a.type === 'buyAnimal')) feats.push(...encodeActionsForPlayer(state, player.id, actions));
      applyAction(state, player.id, heuristicBot.chooseAction(state, player.id));
    }
  }
  return feats;
}

function saturation(weights: RlWeights, feats: number[][]): { meanAbsPre: number; saturated: number } {
  let abs = 0;
  let sat = 0;
  let n = 0;
  for (const x of feats) {
    for (let j = 0; j < weights.hiddenSize; j++) {
      const row = weights.w1[j];
      let s = weights.b1[j];
      for (let i = 0; i < row.length; i++) s += row[i] * x[i];
      abs += Math.abs(s);
      if (Math.abs(s) > 3) sat++;
      n++;
    }
  }
  return { meanAbsPre: abs / n, saturated: sat / n };
}

// Partidas 1v1 greedy alternando quién empieza; devuelve la fracción de
// victorias de `a` (empate = 0.5).
function duel(a: Bot, b: Bot, games: number): number {
  let wins = 0;
  for (let i = 0; i < games; i++) {
    const configs = [
      { id: 'a', name: 'A', deck: buildStarterDeck() },
      { id: 'b', name: 'B', deck: buildStarterDeck() },
    ];
    if (i % 2) configs.reverse();
    const state = createGame(configs, { maxRounds: randomMaxRounds() });
    let guard = 0;
    while (!state.gameOver && guard++ < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) continue;
      const player = getActivePlayer(state);
      applyAction(state, player.id, (player.id === 'a' ? a : b).chooseAction(state, player.id));
    }
    const scores = scoreGame(state);
    const sa = scores.find((s) => s.playerId === 'a')?.score ?? 0;
    const sb = scores.find((s) => s.playerId === 'b')?.score ?? 0;
    wins += sa > sb ? 1 : sa === sb ? 0.5 : 0;
  }
  return wins / games;
}

async function main(): Promise<void> {
  const path = fileURLToPath(new URL(`../../src/bots/rl/${FILE}`, import.meta.url));
  const current = loadOrInitWeights(path, FEATURE_DIM, 48);
  const feats = sampleFeatures(4);
  const before = saturation(current, feats);
  const factor = Math.max(1, before.meanAbsPre / TARGET_MEAN_PREACT);
  const desaturated = scaledFirstLayer(current, factor);
  const after = saturation(desaturated, feats);
  console.log(`${FILE}: |preact| media ${before.meanAbsPre.toFixed(2)} -> ${after.meanAbsPre.toFixed(2)}, saturadas ${(before.saturated * 100).toFixed(0)}% -> ${(after.saturated * 100).toFixed(0)}% (factor ${factor.toFixed(2)})`);
  if (factor <= 1.01) {
    console.log('Ya está por debajo del objetivo: nada que hacer.');
    return;
  }

  const habitat = FILE.includes('-') ? (FILE.replace('weights-', '').replace('.json', '') as 'land' | 'bird' | 'aquatic') : undefined;
  const botCurrent = createRlBot({ weights: current, habitatFilter: habitat });
  const botDesat = createRlBot({ weights: desaturated, habitatFilter: habitat });
  const vsCurrent = duel(botDesat, botCurrent, GAMES);
  const vsHeuristicDesat = duel(botDesat, heuristicBot, GAMES);
  const vsHeuristicCurrent = duel(botCurrent, heuristicBot, GAMES);
  console.log(`desaturada vs actual (1v1, ${GAMES} partidas): ${(vsCurrent * 100).toFixed(0)}% victorias`);
  console.log(`vs heuristicBot: actual ${(vsHeuristicCurrent * 100).toFixed(0)}%, desaturada ${(vsHeuristicDesat * 100).toFixed(0)}%`);

  if (!WRITE) {
    console.log('(sin --write: no se guarda nada)');
    return;
  }
  if (vsCurrent < MIN_WINRATE_VS_CURRENT) {
    console.log(`NO se guarda: la desaturada pierde claramente contra la actual (< ${MIN_WINRATE_VS_CURRENT * 100}%).`);
    process.exitCode = 1;
    return;
  }
  await saveWeightsWithRetry(desaturated, path);
  console.log(`Guardado ${path}`);
}

main();
