// Herramienta de regresión (2026-09-16): detecta "cartas muertas" de cada
// variante de rlBot — especies que el bot tiene delante, comprables, muchas
// veces, y no compra NUNCA. Es el diagnóstico que destapó que el Tucán
// llevaba 0 compras en 653 ocasiones (score −44, por debajo de endTurn) y
// que ningún entrenamiento podía corregirlo porque nunca se muestreaba (ver
// EPSILON/FLOOR_WEIGHT en trainCore.ts y reviveDeadCards.ts). Juega N
// partidas de cada variante contra 3 heuristicBot (pesos reales de
// weights*.json, igual que en la app) y, por especie, cuenta veces
// comprable / veces comprada y el score medio relativo al de endTurn en
// esas mismas decisiones.
//
// Uso: npx vite-node scripts/rl/deadCards.ts [partidas por variante=80]
// Sale con código 1 si alguna especie con >= MIN_OFFERS ocasiones tiene 0
// compras en alguna variante.
import { filterActionsByHabitat, filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { encodeActionsForPlayer } from '../../src/bots/rl/features';
import { deserializeWeights, forward, type RlWeights } from '../../src/bots/rl/network';
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import type { Bot } from '../../src/bots/types';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';
import defaultWeightsJson from '../../src/bots/rl/weights.json';
import landWeightsJson from '../../src/bots/rl/weights-land.json';
import birdWeightsJson from '../../src/bots/rl/weights-bird.json';
import aquaticWeightsJson from '../../src/bots/rl/weights-aquatic.json';

const GAMES_PER_VARIANT = Number(process.argv[2] ?? 80);
const MIN_OFFERS = 50;

type Habitat = 'land' | 'bird' | 'aquatic';
const VARIANTS: { label: string; bot: Bot; weights: RlWeights; habitat?: Habitat }[] = [
  { label: 'general', bot: rlBot, weights: deserializeWeights(defaultWeightsJson) },
  { label: 'land', bot: landRlBot, weights: deserializeWeights(landWeightsJson), habitat: 'land' },
  { label: 'bird', bot: birdRlBot, weights: deserializeWeights(birdWeightsJson), habitat: 'bird' },
  { label: 'aquatic', bot: aquaticRlBot, weights: deserializeWeights(aquaticWeightsJson), habitat: 'aquatic' },
];

interface SpeciesStat {
  offered: number;
  bought: number;
  relScoreSum: number;
}

function analyze(variant: (typeof VARIANTS)[number], games: number): Map<string, SpeciesStat> {
  const stats = new Map<string, SpeciesStat>();
  const stat = (species: string) => {
    let s = stats.get(species);
    if (!s) {
      s = { offered: 0, bought: 0, relScoreSum: 0 };
      stats.set(species, s);
    }
    return s;
  };

  for (let g = 0; g < games; g++) {
    const seatId = `p${g % 4}`;
    const playerConfigs = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, deck: buildStarterDeck() }));
    const state = createGame(playerConfigs, { maxRounds: randomMaxRounds() });

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

      // Mismas candidatas que ve el bot de verdad (ver createRlBot).
      let actions = legalActionsForBot(state, player.id);
      if (variant.habitat) actions = filterActionsByHabitat(state, actions, variant.habitat);
      actions = filterUpgradeChoicesForRl(state, player.id, actions);
      const endTurnIndex = actions.findIndex((a) => a.type === 'endTurn');
      if (endTurnIndex !== -1) {
        const scores = encodeActionsForPlayer(state, player.id, actions).map((x) => forward(variant.weights, x).score);
        const floor = scores[endTurnIndex];
        for (let k = 0; k < actions.length; k++) {
          const a = actions[k];
          if (a.type !== 'buyAnimal') continue;
          const animal = state.animalTrack.find((c) => c.instanceId === a.trackInstanceId);
          if (!animal?.species) continue;
          const s = stat(animal.species);
          s.offered++;
          s.relScoreSum += scores[k] - floor;
        }
      }

      const action = variant.bot.chooseAction(state, player.id);
      if (action.type === 'buyAnimal') {
        const animal = state.animalTrack.find((c) => c.instanceId === action.trackInstanceId);
        if (animal?.species) stat(animal.species).bought++;
      }
      applyAction(state, player.id, action);
      guard++;
    }
  }

  return stats;
}

function main(): void {
  const dead: string[] = [];
  for (const variant of VARIANTS) {
    const stats = analyze(variant, GAMES_PER_VARIANT);
    console.log(`\n=== ${variant.label} (${GAMES_PER_VARIANT} partidas vs 3 heuristicBot) ===`);
    console.log('especie        comprable comprada  %   score medio − endTurn');
    const rows = [...stats.entries()].sort((a, b) => b[1].offered - a[1].offered);
    for (const [species, s] of rows) {
      const pct = s.offered ? ((s.bought / s.offered) * 100).toFixed(1) : '-';
      const rel = s.offered ? (s.relScoreSum / s.offered).toFixed(1) : '-';
      const isDead = s.offered >= MIN_OFFERS && s.bought === 0;
      if (isDead) dead.push(`${variant.label}:${species}`);
      console.log(`${species.padEnd(14)} ${String(s.offered).padStart(9)} ${String(s.bought).padStart(8)} ${pct.padStart(5)} ${rel.padStart(10)}${isDead ? '   MUERTA' : ''}`);
    }
  }

  console.log(dead.length ? `\nCartas muertas: ${dead.join(', ')}` : '\nSin cartas muertas.');
  process.exitCode = dead.length ? 1 : 0;
}

main();
