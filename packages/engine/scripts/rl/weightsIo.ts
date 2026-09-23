// Carga/guardado de pesos compartido por todos los scripts de RL
// (selfPlay.ts, reviveDeadCards.ts...). Antes vivía dentro de selfPlay.ts;
// al necesitarlo también el rescate de cartas muertas se saca aquí. Nunca
// se importa desde src/index.ts ni desde apps/web.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { LIVE_DELTA_INDEX } from '../../src/bots/rl/features';
import {
  createRandomWeights,
  deserializeWeights,
  insertZeroFeatureColumn,
  serializeWeights,
  type RlWeights,
} from '../../src/bots/rl/network';

// Migraciones conocidas de featureDim: cada entrada zero-pads UNA columna
// nueva insertada en `insertIndex` (ver insertZeroFeatureColumn, network.ts)
// para pasar de fromDim a toDim sin perder lo aprendido — el entrenamiento
// solo tiene que aprender a partir de ahí a USAR la columna nueva. Cualquier
// otra discrepancia de dimensión sigue sin migración posible.
const MIGRATIONS: { fromDim: number; toDim: number; insertIndex: number }[] = [
  // 2026-09-16 (features.ts, clásica): liveScoreDelta insertada en medio del
  // vector — el resto de bloques de objetivo se desplazan una posición.
  { fromDim: 96, toDim: 97, insertIndex: LIVE_DELTA_INDEX },
  // 2026-09-23 (featuresFull.ts, completa): ownedCopies añadida al final del
  // bloque de carta, justo donde antes empezaba liveScoreDelta. Mismo índice
  // numérico (96) que la migración de arriba por coincidencia (el bloque de
  // carta de la completa es más largo por hábitats/tipos extra, que compensa
  // el resto del vector) — se deja explícito, no compartido con
  // LIVE_DELTA_INDEX.
  { fromDim: 121, toDim: 122, insertIndex: 96 },
];

export function migrateWeights(weights: RlWeights, expectedFeatureDim: number): RlWeights | null {
  if (weights.featureDim === expectedFeatureDim) return weights;
  const migration = MIGRATIONS.find((m) => m.fromDim === weights.featureDim && m.toDim === expectedFeatureDim);
  if (!migration) return null;
  return insertZeroFeatureColumn(weights, migration.insertIndex);
}

// Generalizada para servir tanto a los pesos de política (FEATURE_DIM,
// HIDDEN_SIZE) como a los del crítico (CRITIC_FEATURE_DIM,
// CRITIC_HIDDEN_SIZE) — misma lógica de validar-migrar-o-reiniciar, dos
// archivos y dos dimensiones distintas.
export function loadOrInitWeights(path: string, expectedFeatureDim: number, hiddenSize: number): RlWeights {
  if (existsSync(path)) {
    try {
      const weights = deserializeWeights(readFileSync(path, 'utf-8'));
      // deserializeWeights solo valida que el JSON sea internamente
      // consistente (sus propias filas coinciden con SU featureDim
      // guardado), no que coincida con el FEATURE_DIM de este módulo. Sin
      // esto, un weights.json de una FEATURE_DIM antigua (p. ej. de antes de
      // añadir una feature nueva) se aceptaría "tal cual" y forward()
      // truncaría en silencio el vector de entrada a las columnas viejas,
      // desalineando el gradiente en vez de fallar con un error claro.
      const migrated = migrateWeights(weights, expectedFeatureDim);
      if (migrated) {
        if (migrated !== weights) {
          console.warn(`${path} tenía featureDim ${weights.featureDim}: migrado a ${expectedFeatureDim} (columna nueva a cero).`);
        }
        return migrated;
      }
      console.warn(
        `${path} tiene featureDim ${weights.featureDim}, no coincide con el esperado (${expectedFeatureDim}) y no hay migración: se reinicia desde pesos aleatorios.`
      );
    } catch {
      console.warn(`${path} existente es inválido, se reinicia desde pesos aleatorios.`);
    }
  }
  return createRandomWeights(expectedFeatureDim, hiddenSize);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Desde que los 4 entrenamientos (general/land/bird/aquatic) también LEEN
// los pesos de las otras 3 variantes al arrancar (ver RL_VARIANT_BOTS en
// trainCore.ts, para el cruce entre bots), corren con mucha más E/S
// simultánea en este mismo directorio que antes — cada uno guarda SU PROPIO
// checkpoint cada EVAL_EVERY batches, así que con los 4 en paralelo hay
// escrituras entrelazadas constantes. En Windows eso puede toparse con un
// bloqueo de archivo transitorio (antivirus/indexador tocando el directorio
// justo en ese instante, "UNKNOWN: unknown error" de writeFileSync) — visto
// en la práctica reventando un entrenamiento entero, tirando horas de
// progreso ya bueno por la borda por un solo guardado que no consiguió
// abrir el archivo. Ahora escribe a un archivo TEMPORAL propio (nombre
// único por proceso, nunca lo abre nadie más) y solo AL FINAL hace un
// rename atómico sobre el destino. Aun así reintenta el conjunto
// (escritura+rename) varias veces con espera creciente antes de rendirse.
export async function saveWeightsWithRetry(weights: RlWeights, path: string, attempts = 10): Promise<void> {
  const serialized = serializeWeights(weights);
  const tmpPath = `${path}.tmp-${process.pid}`;
  for (let i = 0; i < attempts; i++) {
    try {
      writeFileSync(tmpPath, serialized);
      renameSync(tmpPath, path);
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      console.warn(`No se pudo guardar ${path} (intento ${i + 1}/${attempts}), reintentando...`, err);
      await sleep(Math.min(200 * (i + 1), 2000));
    }
  }
}
