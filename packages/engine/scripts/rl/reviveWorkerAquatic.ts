// Worker de un solo uso (2026-09-24) para paralelizar la RECOGIDA de
// muestras del rescate de cartas hundidas del especialista ACUÁTICO de la
// completa (ver reviveDeadCardsAquaticParallel.ts) — mismo patrón de
// spawn/stdin-stdout de worker.ts, pero para `collectSamples`, no para
// gradientes de entrenamiento. Recibe por stdin una línea JSON
// {weights, games}, juega esas partidas contra heurísticos, y devuelve por
// stdout las muestras recogidas (features + target + raised). Desechable.
import { createInterface } from 'node:readline';
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeActionsForPlayer } from '../../src/bots/rl/featuresFull';
import { deserializeWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, type Action } from '../../src/engine';
import { buildStarterDeck, randomMaxRounds } from './trainCore';

const MAX_ACTIONS_PER_GAME = 400;

interface Sample {
  features: number[];
  target: number;
  raised: boolean;
}

function learnerActions(state: ReturnType<typeof createGame>, playerId: string): Action[] {
  const actions = filterActionsByHabitat(state, legalActionsForBot(state, playerId), 'aquatic');
  return filterUpgradeChoicesForRl(state, playerId, actions);
}

function collectSamples(weights: RlWeights, games: number): { samples: Sample[]; decisions: number; sunk: number } {
  const samples: Sample[] = [];
  let decisions = 0;
  let sunk = 0;

  for (let g = 0; g < games; g++) {
    const seatId = `p${g % 4}`;
    const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
    const state = createGame(playerConfigs, { maxRounds: randomMaxRounds(), edition: 'full' });

    let guard = 0;
    while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
      if (autoResolvePendingDiscard(state)) {
        guard++;
        continue;
      }
      const player = getActivePlayer(state);
      if (player.id !== seatId) {
        applyAction(state, player.id, heuristicBot.chooseAction(state, player.id));
        guard++;
        continue;
      }

      const actions = learnerActions(state, player.id);
      if (actions.length === 0) break;
      const allFeatures = encodeActionsForPlayer(state, player.id, actions);
      const scores = allFeatures.map((x) => forward(weights, x).score);

      const endTurnIndex = actions.findIndex((a) => a.type === 'endTurn');
      if (endTurnIndex !== -1) {
        decisions++;
        const floor = scores[endTurnIndex];
        for (let k = 0; k < actions.length; k++) {
          const raised = actions[k].type === 'buyAnimal' && scores[k] < floor;
          if (raised) sunk++;
          samples.push({ features: allFeatures[k], target: raised ? floor : scores[k], raised });
        }
      }

      const best = Math.max(...scores);
      const bestIdx = scores.map((_, i) => i).filter((i) => scores[i] >= best - 1e-9);
      applyAction(state, player.id, actions[bestIdx[Math.floor(Math.random() * bestIdx.length)]]);
      guard++;
    }
  }

  return { samples, decisions, sunk };
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line) as { weights: unknown; games: number };
  const weights = deserializeWeights(msg.weights);
  const result = collectSamples(weights, msg.games);
  process.stdout.write(`${JSON.stringify(result)}\n`);
});
