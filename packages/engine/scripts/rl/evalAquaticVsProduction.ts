// Diagnóstico puntual (2026-09-24), pedido por el usuario: enfrentar el
// checkpoint ACTUAL en disco del especialista acuático (aunque esté a mitad
// de un entrenamiento en marcha) contra los 3 bots de PRODUCCIÓN de la
// completa (weights-full-land.json, weights-full-bird.json, weights-full.json
// generalista — los mismos que juega la web, no rivales de curriculum
// congelados). 4 jugadores, rotando el asiento del acuático para no sesgar
// por orden de turno. Reporta PV medio y victorias de cada uno. Desechable.
// Uso: npx vite-node scripts/rl/evalAquaticVsProduction.ts [partidas]
import { fullAquaticRlBot, fullLandRlBot, fullBirdRlBot, rlBotFull } from '../../src/bots/rlBotFull';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scorePlayer } from '../../src/scoring';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';

const GAMES = Number(process.argv[2] ?? 200);

const CONTESTANTS: { label: string; bot: Bot }[] = [
  { label: 'aquatic (checkpoint actual)', bot: fullAquaticRlBot },
  { label: 'land (producción)', bot: fullLandRlBot },
  { label: 'bird (producción)', bot: fullBirdRlBot },
  { label: 'generalista (producción)', bot: rlBotFull },
];

const totals = CONTESTANTS.map(() => ({ scoreSum: 0, wins: 0, games: 0 }));

for (let g = 0; g < GAMES; g++) {
  // Rota qué posición ocupa cada contendiente para que nadie tenga ventaja
  // sistemática de turno.
  const order = CONTESTANTS.map((_, i) => (i + g) % CONTESTANTS.length);
  const playerConfigs = order.map((_, seat) => ({ id: `p${seat}`, name: `P${seat}`, deck: buildStarterDeck() }));
  const state = createGame(playerConfigs, { edition: 'full', maxRounds: randomMaxRounds() });

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }
    const player = getActivePlayer(state);
    const seat = Number(player.id.slice(1));
    const contestantIdx = order[seat];
    const action = CONTESTANTS[contestantIdx].bot.chooseAction(state, player.id);
    applyAction(state, player.id, action);
    guard++;
  }

  const scores = state.players.map((p) => scorePlayer(state, p));
  const bestScore = Math.max(...scores);
  for (let seat = 0; seat < scores.length; seat++) {
    const contestantIdx = order[seat];
    totals[contestantIdx].scoreSum += scores[seat];
    totals[contestantIdx].games++;
    if (scores[seat] === bestScore) totals[contestantIdx].wins++; // empates cuentan para ambos, igual que victoria compartida
  }
}

console.log(`=== ${GAMES} partidas a 4 jugadores, asiento rotado ===`);
console.log('bot                              PV medio   victorias (o empates a la mejor puntuación)');
for (let i = 0; i < CONTESTANTS.length; i++) {
  const t = totals[i];
  console.log(`${CONTESTANTS[i].label.padEnd(32)} ${(t.scoreSum / t.games).toFixed(2).padStart(8)}    ${t.wins} (${((t.wins / GAMES) * 100).toFixed(1)}%)`);
}
