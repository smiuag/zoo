// Precalcula, para cada variante de rlBot, el valor MEDIO que de verdad
// acaba aportando cada carta con un efecto onScore "acumulativo" (cuenta
// algo en TODA la colección al final de la partida: scorePerHabitatCount —
// Águila/Orca/Oso polar —, scorePerDistinctSpecies — Albatros — y
// scorePerCostAtLeast — Tucán). Pedido explícito del usuario (2026-09-14):
// el reward shaping (ver SCALER_CALIBRATION en trainCore.ts) usaba el delta
// de PV en vivo justo al comprar la carta, que para estas 5 (todas con 0 PV
// impreso: todo su valor es el efecto dinámico) es casi nulo tan pronto en
// la partida como se suelen comprar — así que se sustituye por este valor
// medio "asignado como si fuera fijo", calculado jugando partidas de
// verdad con cada variante y midiendo cuánto cuenta el hábitat/especie/
// coste relevante en la colección final, tenga o no esa carta en concreto
// (el handler de puntuación no mira si la carta está presente, solo cuenta
// el resto de la colección — ver resolveScoreEffect).
//
// Uso: npx vite-node scripts/rl/calibrateScalerValues.ts [partidas por variante]
// Escribe scripts/rl/scalerCalibration.json, que trainCore.ts importa.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aquaticRlBot, birdRlBot, landRlBot, rlBot } from '../../src/bots/rlBot';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { getCard } from '../../src/cards/registry';
import type { Card, Effect } from '../../src/cards/schema';
import type { Bot } from '../../src/bots/types';
import { resolveScoreEffect } from '../../src/effects/registry';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { scoreGame } from '../../src/scoring';
import type { CardInstance, Player } from '../../src/model/state';

const GAMES_PER_VARIANT = Number(process.argv[2] ?? 150);
const MAX_ACTIONS_PER_GAME = 400;
const REALISTIC_ROUND_LIMITS = [10, 15, 20] as const;
function randomMaxRounds(): number {
  return REALISTIC_ROUND_LIMITS[Math.floor(Math.random() * REALISTIC_ROUND_LIMITS.length)];
}

function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}

// Mismo criterio que collectAllCards en scoring.ts (no exportado desde
// ahí): un animal puntúa esté donde esté (mazo, mano, descarte, jugado este
// turno).
function collectAllCards(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn];
}

// Las 5 cartas de hoy con efecto "acumulativo" de 0 PV impreso — cualquier
// carta futura con uno de estos 3 tipos de efecto se calibra igual, sin
// tocar este script.
const CALIBRATABLE_EFFECT_TYPES = new Set(['scorePerHabitatCount', 'scorePerDistinctSpecies', 'scorePerCostAtLeast']);

function findCalibratableCards(): { cardId: string; effect: Effect }[] {
  const result: { cardId: string; effect: Effect }[] = [];
  for (const cardId of ['albatross', 'eagle', 'orca', 'polar-bear', 'toucan']) {
    const card = getCard(cardId);
    const effect = card.effects.find((e) => e.trigger === 'onScore' && CALIBRATABLE_EFFECT_TYPES.has(e.type));
    if (effect) result.push({ cardId, effect });
  }
  return result;
}

const VARIANTS: [string, Bot][] = [
  ['general', rlBot],
  ['land', landRlBot],
  ['bird', birdRlBot],
  ['aquatic', aquaticRlBot],
];

function playAndMeasure(bot: Bot, targets: { cardId: string; effect: Effect }[], games: number): Record<string, number> {
  const sums = new Map<string, number>(targets.map((t) => [t.cardId, 0]));

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
      const activeBot = player.id === seatId ? bot : heuristicBot;
      applyAction(state, player.id, activeBot.chooseAction(state, player.id));
      guard++;
    }

    // Finaliza la partida (resuelve efectos destructivos como el Cocodrilo)
    // antes de mirar la colección final.
    scoreGame(state);
    const player = state.players.find((p) => p.id === seatId);
    if (!player) continue;
    const allCards = collectAllCards(player);

    for (const { cardId, effect } of targets) {
      // sourceCard no lo usa ninguno de los 3 handlers calibrables (solo
      // leen effect.params y allCards), así que un CardInstance vacío basta
      // — mide lo que la colección YA tiene, exista o no esta carta en ella.
      const value = resolveScoreEffect(player, effect, allCards, {} as CardInstance);
      sums.set(cardId, (sums.get(cardId) ?? 0) + value);
    }
  }

  const result: Record<string, number> = {};
  for (const [cardId, sum] of sums) result[cardId] = sum / games;
  return result;
}

function main() {
  const targets = findCalibratableCards();
  const calibration: Record<string, Record<string, number>> = {};

  for (const [label, bot] of VARIANTS) {
    const values = playAndMeasure(bot, targets, GAMES_PER_VARIANT);
    calibration[label] = values;
    console.log(`\n=== ${label} ===`);
    for (const [cardId, avg] of Object.entries(values)) {
      console.log(`  ${cardId.padEnd(12)} valor medio asignado: ${avg.toFixed(2)}`);
    }
  }

  const outPath = fileURLToPath(new URL('./scalerCalibration.json', import.meta.url));
  writeFileSync(outPath, JSON.stringify(calibration, null, 2));
  console.log(`\nGuardado en ${outPath}`);
}

main();
