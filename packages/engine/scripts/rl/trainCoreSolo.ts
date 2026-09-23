// Variante puntual de trainCore.ts (playOneGame/runEpisodes) para el
// experimento pedido por el usuario el 2026-09-17: entrenar bird JUGANDO
// SOLO (1 asiento, sin los otros 3 especialistas como rivales fijos) tras
// notar que el bird recién entrenado (siempre en partidas de 4, ver
// playOneGame en trainCore.ts) puntúa peor que su versión anterior tanto en
// partidas de 8 como en solitario — la hipótesis es que entrenar sin
// disputarse cartas contra otros bots podría enseñarle mejor a maximizar su
// propia partida. Nunca toca trainCore.ts (la regla "siempre partidas de 4
// con uno de cada" sigue siendo el default de producción) ni los pesos
// committeados: usa sus propios archivos weights-<habitat>-solo.json /
// critic-<habitat>-solo.json (ver soloSelfPlay.ts).
import { getCard } from '../../src/cards/registry';
import { forward, type RlWeights } from '../../src/bots/rl/network';
import { ANIMAL_SPECIES, applyAction, autoResolvePendingDiscard, createGame, getActivePlayer, initialMarketCopies } from '../../src/engine';
import { mintInstance, shuffle, type GameState } from '../../src/model/state';
import { filterUpgradeChoicesForRl, legalActionsForBot } from '../../src/bots/actionPriority';
import { encodeActionsForPlayer, encodePlayerContext } from '../../src/bots/rl/features';
import { scoreGame, scorePlayer } from '../../src/scoring';
import { accumulateFloorGrad, ADVANTAGE_CLIP, buildStarterDeck, EPSILON, filterActionsForHabitat, MAX_ACTIONS_PER_GAME, randomMaxRounds, sampleIndex, SCALER_CALIBRATION, shapedPurchaseValue, SHAPING_WEIGHT, TRAIN_TEMPERATURE, type EpisodeBatchResult, type Step } from './trainCore';
import { accumulateGrad, softmax, zeroGrad } from './train';

// Pedido explícito del usuario (2026-09-17), tras ver que con 1 jugador el
// mercado es muchísimo más escaso de lo normal (initialMarketCopies:
// numPlayers para coste 5+, numPlayers+2 para el resto — con 1 jugador,
// 1 copia de cada carta cara y 3 del resto, así que el aprendiz nunca tenía
// que aprender a lidiar con la escasez real ni a anticiparse a que otros
// se llevaran las cartas). createGame no admite tamaño de mercado
// independiente del nº de asientos, así que aquí se completa el mercado a
// mano justo después de crear la partida de 1 jugador: por cada especie, si
// le faltan copias para llegar al nivel de una mesa de MARKET_PLAYER_COUNT,
// se mintan e insertan barajadas.
const MARKET_PLAYER_COUNT = Number(process.env.RL_SOLO_MARKET_PLAYERS ?? 5);

function topUpMarketForPlayerCount(state: GameState, targetPlayers: number): void {
  for (const species of ANIMAL_SPECIES) {
    const card = getCard(species);
    // -1: createGame ya reparte 1 copia de cada especie al mercado visible
    // (animalTrack) antes de devolver el estado, saliendo de sharedDecks —
    // siempre exactamente 1, sin importar el nº de jugadores. state.sharedDecks
    // ya refleja esa resta, así que el objetivo tiene que restarla también o
    // se sobrepasaría en 1 copia por especie.
    const target = initialMarketCopies(card.marketCost ?? 0, targetPlayers) - 1;
    const deck = state.sharedDecks[species] ?? [];
    const missing = target - deck.length;
    if (missing <= 0) continue;
    for (let i = 0; i < missing; i++) deck.push(mintInstance(state, card));
    state.sharedDecks[species] = shuffle(deck);
  }
}

// computeReturn (reward.ts) mide "mi score - la media de mis rivales", y
// devuelve 0 en cuanto no hay rivales (others.length===0) — en solitario
// SIEMPRE sería 0, matando toda la señal de retorno terminal (solo
// quedaría el shaping por compra, nunca "esta partida acabó mejor/peor de
// lo esperado"). En su lugar, el retorno es directamente el score final
// escalado /20, la misma escala que usa computeReturn para que
// ADVANTAGE_CLIP (pensado para esa escala) siga teniendo sentido.
function computeReturnSolo(finalScore: number): number {
  return finalScore / 20;
}

function playOneGameSolo(weights: RlWeights): { steps: Step[]; finalScore: number; truncated: boolean } {
  const playerConfig = { id: 'p0', name: 'P0', deck: buildStarterDeck() };
  const state = createGame([playerConfig], { maxRounds: randomMaxRounds() });
  topUpMarketForPlayerCount(state, MARKET_PLAYER_COUNT);

  const steps: Step[] = [];

  let guard = 0;
  while (!state.gameOver && guard < MAX_ACTIONS_PER_GAME) {
    if (autoResolvePendingDiscard(state)) {
      guard++;
      continue;
    }

    const player = getActivePlayer(state);
    const actions = filterUpgradeChoicesForRl(state, player.id, filterActionsForHabitat(state, legalActionsForBot(state, player.id)));
    if (actions.length === 0) break;

    const allFeatures = encodeActionsForPlayer(state, player.id, actions);
    const allForward = allFeatures.map((x) => forward(weights, x));
    const allScores = allForward.map((f) => f.score);
    const chosenIndex =
      Math.random() < EPSILON ? Math.floor(Math.random() * actions.length) : sampleIndex(allScores, TRAIN_TEMPERATURE);

    const chosenAction = actions[chosenIndex];
    const stateFeatures = encodePlayerContext(state, player);
    const boughtCard =
      chosenAction.type === 'buyAnimal' ? state.animalTrack.find((c) => c.instanceId === chosenAction.trackInstanceId) : undefined;
    const calibratedValue = boughtCard ? SCALER_CALIBRATION[boughtCard.id] : undefined;
    const scoreBefore = chosenAction.type === 'buyAnimal' ? scorePlayer(state, player) : 0;
    const roundProgress = state.maxRounds !== null ? Math.min(1, state.round / state.maxRounds) : 0;

    applyAction(state, player.id, chosenAction);

    const shapingBonus =
      chosenAction.type === 'buyAnimal'
        ? shapedPurchaseValue(scorePlayer(state, player) - scoreBefore, calibratedValue, roundProgress, boughtCard?.marketCost ?? 0) / 20
        : 0;

    steps.push({
      allFeatures,
      allHidden: allForward.map((f) => f.hidden),
      allScores,
      actionTypes: actions.map((a) => a.type),
      chosenIndex,
      stateFeatures,
      shapingBonus,
    });

    guard++;
  }

  const truncated = !state.gameOver && guard >= MAX_ACTIONS_PER_GAME;
  return { steps, finalScore: scoreGame(state)[0].score, truncated };
}

export function runEpisodesSolo(weights: RlWeights, criticWeights: RlWeights, episodeCount: number): EpisodeBatchResult {
  const grad = zeroGrad(weights.featureDim, weights.hiddenSize);
  const criticGrad = zeroGrad(criticWeights.featureDim, criticWeights.hiddenSize);
  let episodesUsed = 0;
  let sumAbsAdvantage = 0;
  let sumReturn = 0;
  let stepCount = 0;
  let truncatedGames = 0;

  for (let e = 0; e < episodeCount; e++) {
    const { steps, finalScore, truncated } = playOneGameSolo(weights);
    if (truncated) truncatedGames++;
    if (steps.length === 0) continue;

    const returnValue = computeReturnSolo(finalScore);
    sumReturn += returnValue;

    for (const step of steps) {
      const critic = forward(criticWeights, step.stateFeatures);
      const rawAdvantage = returnValue - critic.score;
      const advantage = Math.max(-ADVANTAGE_CLIP, Math.min(ADVANTAGE_CLIP, rawAdvantage));
      sumAbsAdvantage += Math.abs(rawAdvantage);
      stepCount++;

      const policyAdvantage = advantage + SHAPING_WEIGHT * step.shapingBonus;

      const probs = softmax(step.allScores);
      for (let k = 0; k < probs.length; k++) {
        const delta = ((k === step.chosenIndex ? 1 : 0) - probs[k]) * policyAdvantage;
        accumulateGrad(grad, step.allFeatures[k], step.allHidden[k], weights.w2, delta);
      }
      accumulateFloorGrad(grad, step, weights.w2);
      accumulateGrad(criticGrad, step.stateFeatures, critic.hidden, criticWeights.w2, advantage);
    }
    episodesUsed++;
  }

  return { grad, criticGrad, sumAbsAdvantage, sumReturn, stepCount, episodesUsed, truncatedGames };
}
