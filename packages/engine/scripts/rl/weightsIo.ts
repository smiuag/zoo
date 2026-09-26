// Carga/guardado de pesos compartido por todos los scripts de RL
// (selfPlay.ts, reviveDeadCards.ts...). Antes vivía dentro de selfPlay.ts;
// al necesitarlo también el rescate de cartas muertas se saca aquí. Nunca
// se importa desde src/index.ts ni desde apps/web.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  createRandomWeights,
  deserializeWeights,
  insertZeroFeatureColumn,
  removeFeatureColumn,
  serializeWeights,
  type RlWeights,
} from '../../src/bots/rl/network';

// Migraciones conocidas de featureDim: cada entrada añade una o varias
// columnas (`indices`, aplicados en orden — ver insertZeroFeatureColumn,
// network.ts) o quita una (`index` — ver removeFeatureColumn) para pasar de
// fromDim a toDim EN UN SOLO PASO, aunque toDim-fromDim sea >1. Insertar
// nunca pierde nada (la columna nueva entra a cero); quitar sí pierde lo
// aprendido para ESA columna concreta, el resto de pesos se conserva.
// Cualquier otra discrepancia de dimensión sigue sin migración posible.
//
// IMPORTANTE: cada migración es un salto DIRECTO fromDim->toDim, nunca un
// tramo de una cadena más larga con dimensiones intermedias con nombre
// propio (97->98->99, por ejemplo) — a lo largo de hoy varias features se
// han añadido y quitado en el mismo día, así que un mismo número de
// columnas (98, 99...) ha significado disposiciones de vector DISTINTAS en
// momentos distintos. Si dos migraciones compartieran una dimensión
// intermedia con esa clase de ambigüedad, el encadenado de migrateWeights
// podría mezclar pasos de dos migraciones distintas y acabar en una
// disposición de columnas que no es ninguna de las dos (o peor, oscilar sin
// converger — pasó de verdad hoy con la primera versión de este mecanismo,
// antes de saltar en un solo paso). Saltar fromDim->toDim de un tirón evita
// el problema de raíz: solo hace falta que fromDim no se repita entre
// migraciones de la MISMA dirección (insertar o quitar).
const MIGRATIONS: { fromDim: number; toDim: number; kind: 'insert' | 'remove'; index: number; indices?: number[] }[] = [
  // 2026-09-16 (features.ts, clásica): liveScoreDelta insertada en medio del
  // vector — el resto de bloques de objetivo se desplazan una posición.
  // Literal 78 a propósito, NO LIVE_DELTA_INDEX: esta entrada describe dónde
  // se insertó la columna EN AQUEL MOMENTO, no la disposición actual del
  // vector (que además ha cambiado de sentido varias veces desde entonces)
  // — si se leyera el valor actual de la constante, un weights.json de 96
  // columnas migraría a un índice equivocado.
  { fromDim: 96, toDim: 97, kind: 'insert', index: 78 },
  // 2026-09-23 (featuresFull.ts, completa): ownedCopies añadida al final del
  // bloque de carta, justo donde antes empezaba liveScoreDelta. Mismo índice
  // numérico (96) que la migración de arriba por coincidencia (el bloque de
  // carta de la completa es más largo por hábitats/tipos extra, que compensa
  // el resto del vector) — se deja explícito, no compartido con
  // LIVE_DELTA_INDEX.
  { fromDim: 121, toDim: 122, kind: 'insert', index: 96 },
  // 2026-09-25 (features.ts, clásica): quitadas state.turn (índice 0) y
  // hasRoundLimit (índice 19, que tras quitar la 0 pasa a ser la 18) sobre
  // el vector de 99 columnas de ese momento (97 con las 2 bolsas de compra
  // restringido ya insertadas) — ver el comentario de FEATURE_DIM en
  // features.ts. Mismos índices para el crítico (39->37). Esta migración
  // solo serviría para un weights.json guardado justo en esa ventana muy
  // concreta del 25/09, si existiera — el 97/37 de hoy es el punto de
  // llegada, no vuelve a usarse como fromDim de ninguna otra migración de
  // bajada.
  { fromDim: 99, toDim: 97, kind: 'remove', index: 0, indices: [0, 19] },
  { fromDim: 39, toDim: 37, kind: 'remove', index: 0, indices: [0, 19] },
  // 2026-09-25 (más tarde todavía, features.ts clásica): recuento, por
  // hábitat y en TODA LA COLECCIÓN (no solo la mano — ver el intento
  // revertido de más arriba en el historial de este archivo, y el
  // comentario en encodePlayerContext), de animales con el efecto
  // gainBonusPurchasingPowerPerHabitatInHand parametrizado a ese hábitat
  // (Delfín=acuático, Mono=terrestre, Loro=volador). 3 columnas nuevas,
  // salto directo 97->100 (y 37->40 para el crítico).
  { fromDim: 97, toDim: 100, kind: 'insert', index: 12, indices: [12, 12, 12] },
  { fromDim: 37, toDim: 40, kind: 'insert', index: 12, indices: [12, 12, 12] },
];

// Encadena migraciones consecutivas cuando hace falta más de un salto (p.
// ej. 96->97 y luego 97->100 si algún día hiciera falta partir de un
// weights.json muy antiguo) filtrando también por dirección (creciendo si
// expectedFeatureDim > current, encogiendo si es menor) — necesario porque,
// aunque cada migración ahora salta fromDim->toDim de un tirón, dos
// migraciones de sentido contrario podrían compartir un fromDim (ver el
// comentario de MIGRATIONS) y `.find` sin este filtro podría coger la que
// no toca.
export function migrateWeights(weights: RlWeights, expectedFeatureDim: number): RlWeights | null {
  let current = weights;
  while (current.featureDim !== expectedFeatureDim) {
    const growing = expectedFeatureDim > current.featureDim;
    const migration = MIGRATIONS.find((m) => m.fromDim === current.featureDim && (growing ? m.kind === 'insert' : m.kind === 'remove'));
    if (!migration) return null;
    if (migration.kind === 'insert') {
      for (const idx of migration.indices ?? [migration.index]) current = insertZeroFeatureColumn(current, idx);
    } else {
      // Los índices de una eliminación múltiple son POSICIONES EN EL VECTOR
      // ORIGINAL (antes de quitar nada), no se recalculan tras cada
      // eliminación — por eso van de mayor a menor: quitar primero el índice
      // más alto no descoloca la posición de los que quedan por quitar.
      for (const idx of [...(migration.indices ?? [migration.index])].sort((a, b) => b - a)) current = removeFeatureColumn(current, idx);
    }
  }
  return current;
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
          const direction = expectedFeatureDim > weights.featureDim ? 'columna(s) nueva(s) a cero' : 'columna(s) quitada(s)';
          console.warn(`${path} tenía featureDim ${weights.featureDim}: migrado a ${expectedFeatureDim} (${direction}).`);
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
