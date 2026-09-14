// Proceso worker de larga duración para un entrenamiento (ver RL_WORKERS en
// selfPlay.ts, que decide cuántos lanzar por cada uno de los 4 procesos
// general/land/bird/aquatic). Recibe por stdin, una línea JSON por batch,
// los pesos actuales de política+crítico y cuántos episodios simular, y
// devuelve por stdout (otra línea JSON) el gradiente acumulado de esos
// episodios — nunca aplica el gradiente ni escribe pesos a disco, eso lo
// sigue haciendo solo el proceso principal (selfPlay.ts), que suma los
// resultados de todos sus workers + su propia cuota antes de una única
// actualización por batch.
//
// Se lanza vía vite-node (nunca node/tsx a secas — ver comentario al inicio
// de selfPlay.ts): playOneGame usa el registro de cartas, que depende de
// import.meta.glob, una API solo de Vite.
import { createInterface } from 'node:readline';
import { deserializeWeights } from '../../src/bots/rl/network';
import { runEpisodes } from './trainCore';

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
  const result = runEpisodes(weights, criticWeights, msg.episodes);
  process.stdout.write(`${JSON.stringify(result)}\n`);
});
