// Diagnóstico puntual (2026-09-24): para cada especie que puede ofrecerse al
// especialista acuático, ¿su score queda alguna vez por debajo de pasar
// turno? Cuenta ocasiones ofrecida / score medio relativo a endTurn / veces
// que quedó por debajo, sobre partidas reales con el checkpoint actual.
// Desechable.
// Uso: npx vite-node scripts/rl/speciesVsEndTurn.ts [partidas]
import { filterActionsByHabitat, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeActionsForPlayer } from '../../src/bots/rl/featuresFull';
import { deserializeWeights, forward } from '../../src/bots/rl/network';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GAMES = Number(process.argv[2] ?? 400);
const weights = deserializeWeights(JSON.parse(readFileSync(fileURLToPath(new URL('../../src/bots/rl/weights-full-aquatic.json', import.meta.url)), 'utf-8')));

interface Stat {
  offered: number;
  belowEndTurn: number;
  relScoreSum: number;
}
const stats = new Map<string, Stat>();
function stat(species: string): Stat {
  let s = stats.get(species);
  if (!s) {
    s = { offered: 0, belowEndTurn: 0, relScoreSum: 0 };
    stats.set(species, s);
  }
  return s;
}

for (let g = 0; g < GAMES; g++) {
  const seatId = `p${g % 4}`;
  const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
  const state = createGame(playerConfigs, { edition: 'full', maxRounds: randomMaxRounds() });

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

    const actions = filterActionsByHabitat(state, legalActionsForBot(state, player.id), 'aquatic');
    const endTurnIdx = actions.findIndex((a) => a.type === 'endTurn');
    if (endTurnIdx !== -1) {
      const vecs = encodeActionsForPlayer(state, player.id, actions);
      const scores = vecs.map((v) => forward(weights, v).score);
      const floor = scores[endTurnIdx];
      for (let k = 0; k < actions.length; k++) {
        const a = actions[k];
        if (a.type !== 'buyAnimal') continue;
        const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
        if (!animal?.species) continue;
        const s = stat(animal.species);
        s.offered++;
        s.relScoreSum += scores[k] - floor;
        if (scores[k] < floor) s.belowEndTurn++;
      }
    }

    applyAction(state, player.id, heuristicBot.chooseAction(state, player.id));
    guard++;
  }
}

const rows = [...stats.entries()].sort((a, b) => a[1].relScoreSum / a[1].offered - b[1].relScoreSum / b[1].offered);
console.log('especie          ofrecida  por_debajo_de_pasar_turno  %debajo  score_medio_vs_pasar_turno');
for (const [species, s] of rows) {
  const pct = ((s.belowEndTurn / s.offered) * 100).toFixed(1);
  const rel = (s.relScoreSum / s.offered).toFixed(2);
  const flag = s.belowEndTurn === s.offered ? '  <-- SIEMPRE por debajo (nunca se compraría)' : '';
  console.log(`${species.padEnd(16)} ${String(s.offered).padStart(8)}  ${String(s.belowEndTurn).padStart(24)}  ${pct.padStart(6)}%  ${rel.padStart(8)}${flag}`);
}
