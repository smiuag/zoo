// Diagnóstico puntual (2026-09-24): ¿pasa turno teniendo dinero para
// comprar algo? Bucket por poder de compra disponible en la decisión
// (comprar o pasar, sin cartas por jugar) y cuenta cuántas veces, con ese
// poder, elige comprar vs pasar, con el checkpoint actual. Desechable.
// Uso: npx vite-node scripts/rl/passTurnWithMoney.ts [partidas]
import { filterActionsByHabitat, legalActionsForBot } from '../../src/bots/actionPriority';
import { heuristicBot } from '../../src/bots/heuristicBot';
import { fullAquaticRlBot } from '../../src/bots/rlBotFull';
import { applyAction, autoResolvePendingDiscard, createGame, getActivePlayer } from '../../src/engine';
import { buildStarterDeck, MAX_ACTIONS_PER_GAME, randomMaxRounds } from './trainCore';

const GAMES = Number(process.argv[2] ?? 400);

interface Bucket {
  buyAnimal: number;
  buyCoin: number;
  endTurn: number;
}
const buckets = new Map<number, Bucket>();
function freshBucket(): Bucket {
  return { buyAnimal: 0, buyCoin: 0, endTurn: 0 };
}

const passedWithMoneyExamples: string[] = [];

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
    const hasPlayCard = actions.some((a) => a.type === 'playCard');
    if (!hasPlayCard) {
      const coinSum = player.hand.filter((c) => c.type === 'coin').reduce((sum, c) => sum + (c.value ?? 0), 0);
      const purchasingPower =
        coinSum + player.bonusPurchasingPowerThisTurn + player.aquaticBonusPurchasingPowerThisTurn + player.dinosaurBonusPurchasingPowerThisTurn;
      const canAffordSomething = actions.some((a) => a.type === 'buyAnimal' || a.type === 'buyCoin');
      const bucketKey = Math.min(purchasingPower, 10);
      const bucket = buckets.get(bucketKey) ?? freshBucket();
      buckets.set(bucketKey, bucket);

      const action = fullAquaticRlBot.chooseAction(state, player.id);
      if (action.type === 'buyAnimal') bucket.buyAnimal++;
      else if (action.type === 'buyCoin') bucket.buyCoin++;
      else if (action.type === 'endTurn') {
        bucket.endTurn++;
        if (canAffordSomething && purchasingPower > 0 && passedWithMoneyExamples.length < 15) {
          const affordable = actions
            .filter((a) => a.type === 'buyAnimal')
            .map((a) => state.animalTrack.find((c) => c.instanceId === (a as any).trackInstanceId)?.species)
            .filter(Boolean);
          passedWithMoneyExamples.push(`poder=${purchasingPower}  podía comprar: [${affordable.join(', ')}]`);
        }
      }
      applyAction(state, player.id, action);
    } else {
      applyAction(state, player.id, fullAquaticRlBot.chooseAction(state, player.id));
    }
    guard++;
  }
}

console.log('poder_compra  buyAnimal  buyCoin  endTurn   % pasa turno');
for (const key of [...buckets.keys()].sort((a, b) => a - b)) {
  const b = buckets.get(key)!;
  const total = b.buyAnimal + b.buyCoin + b.endTurn;
  const label = key === 10 ? '10+' : String(key);
  console.log(`${label.padEnd(13)} ${String(b.buyAnimal).padStart(9)}  ${String(b.buyCoin).padStart(7)}  ${String(b.endTurn).padStart(7)}   ${((b.endTurn / total) * 100).toFixed(1)}%`);
}

console.log(`\nEjemplos de "pasó turno pudiendo comprar algo" (${passedWithMoneyExamples.length}):`);
for (const ex of passedWithMoneyExamples) console.log(`  ${ex}`);
