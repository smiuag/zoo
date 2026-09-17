// Igual que worker.ts, pero para el experimento de entrenamiento en
// solitario (ver trainCoreSolo.ts/soloSelfPlay.ts): usa runEpisodesSolo en
// vez de runEpisodes.
import { createInterface } from 'node:readline';
import { deserializeWeights } from '../../src/bots/rl/network';
import { runEpisodesSolo } from './trainCoreSolo';
import { serializeGradient } from './train';

interface BatchRequest {
  weights: unknown;
  criticWeights: unknown;
  episodes: number;
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line) as BatchRequest;
  const weights = deserializeWeights(msg.weights);
  const criticWeights = deserializeWeights(msg.criticWeights);
  const result = runEpisodesSolo(weights, criticWeights, msg.episodes);
  process.stdout.write(
    `${JSON.stringify({
      ...result,
      grad: serializeGradient(result.grad),
      criticGrad: serializeGradient(result.criticGrad),
    })}\n`
  );
});
