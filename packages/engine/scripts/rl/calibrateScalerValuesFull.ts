// Versión de calibrateScalerValues.ts para la EDICIÓN COMPLETA — pedido
// explícito del usuario 2026-09-22, a raíz del Plesiosaurio: su 0 PV
// impreso (todo su valor real es "+1PV por dinosaurio en tu colección")
// hacía que el reward shaping (delta de PV en vivo al comprarlo) lo viera
// casi sin valor, y que cualquier comparación de PV/coste por hábitat lo
// contara como una carta mala cuando en realidad no se sabe cuánto vale.
// Misma idea que la clásica: jugar partidas de verdad con cada variante de
// la completa y medir cuánto cuenta el hábitat/especie/coste relevante en
// la colección final, calibrando por separado — la completa tiene más
// especies por hábitat que la clásica, así que reutilizar los números
// calibrados de la clásica (que SCALER_CALIBRATION descarta a propósito
// para RL_EDITION==='full', ver trainCore.ts) daría una media equivocada.
//
// Uso: npx vite-node scripts/rl/calibrateScalerValuesFull.ts [partidas por variante]
// Escribe scripts/rl/scalerCalibrationFull.json, que trainCore.ts importa
// cuando RL_EDITION==='full'.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rlBotFull, fullLandRlBot, fullBirdRlBot, fullAquaticRlBot } from '../../src/bots/rlBotFull';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { getAllCards, getCard } from '../../src/cards/registry';
import type { Card, Effect } from '../../src/cards/schema';
import type { Bot } from '../../src/bots/types';
import { COMPOUNDING_SCORE_EFFECT_TYPES, resolveScoreEffect } from '../../src/effects/registry';
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

function collectAllCards(player: Player): CardInstance[] {
  return [...player.deck, ...player.hand, ...player.discard, ...player.playedThisTurn];
}

// Escaneo DINÁMICO de todas las cartas cargadas (pedido explícito del
// usuario 2026-09-22, a raíz de que la Oca — scorePerDistinctSpeciesWithHabitat
// de "pet" — se había quedado fuera de la primera versión de este script,
// con una lista de ids a mano, por descuido): en vez de mantener una lista
// separada que hay que recordar actualizar cada vez que se añade una carta
// acumulativa nueva, se reutiliza COMPOUNDING_SCORE_EFFECT_TYPES — el MISMO
// conjunto que ya usa filterActionsByHabitat para dejarlas comprar fuera de
// hábitat (ver actionPriority.ts) — así cualquier carta nueva con uno de
// esos tipos de efecto se calibra sola la próxima vez que se ejecute este
// script, sin tocar ni una línea aquí.
function findCalibratableCards(): { cardId: string; effect: Effect }[] {
  const result: { cardId: string; effect: Effect }[] = [];
  for (const card of getAllCards()) {
    const effect = card.effects.find((e) => e.trigger === 'onScore' && COMPOUNDING_SCORE_EFFECT_TYPES.has(e.type));
    if (effect) result.push({ cardId: card.id, effect });
  }
  return result;
}

const VARIANTS: [string, Bot][] = [
  ['general', rlBotFull],
  ['land', fullLandRlBot],
  ['bird', fullBirdRlBot],
  ['aquatic', fullAquaticRlBot],
];

function playAndMeasure(bot: Bot, targets: { cardId: string; effect: Effect }[], games: number): Record<string, number> {
  const sums = new Map<string, number>(targets.map((t) => [t.cardId, 0]));

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
      const activeBot = player.id === seatId ? bot : heuristicBot;
      applyAction(state, player.id, activeBot.chooseAction(state, player.id));
      guard++;
    }

    scoreGame(state);
    const player = state.players.find((p) => p.id === seatId);
    if (!player) continue;
    const allCards = collectAllCards(player);

    for (const { cardId, effect } of targets) {
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

  const outPath = fileURLToPath(new URL('./scalerCalibrationFull.json', import.meta.url));
  writeFileSync(outPath, JSON.stringify(calibration, null, 2));
  console.log(`\nGuardado en ${outPath}`);
}

main();
