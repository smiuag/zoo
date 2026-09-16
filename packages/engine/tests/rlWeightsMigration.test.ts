import { describe, expect, it } from 'vitest';
import { FEATURE_DIM, LIVE_DELTA_INDEX } from '../src/bots/rl/features';
import { createRandomWeights, forward } from '../src/bots/rl/network';
import { migrateWeights } from '../scripts/rl/weightsIo';

describe('scripts/rl/weightsIo migrateWeights', () => {
  it('migra pesos de 96 columnas a 97 insertando la columna liveScoreDelta a cero, sin cambiar ningún score', () => {
    const old = createRandomWeights(96, 6);
    const migrated = migrateWeights(old, FEATURE_DIM);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(FEATURE_DIM);
    expect(migrated!.w1.every((row) => row.length === FEATURE_DIM)).toBe(true);

    const x96 = Array.from({ length: 96 }, () => Math.random() * 2 - 1);
    const x97 = [...x96.slice(0, LIVE_DELTA_INDEX), 0, ...x96.slice(LIVE_DELTA_INDEX)];
    expect(forward(migrated!, x97).score).toBeCloseTo(forward(old, x96).score, 10);

    // Con la columna nueva encendida el score sigue igual (peso 0): es el
    // entrenamiento el que tiene que aprender a usarla.
    const x97on = [...x97];
    x97on[LIVE_DELTA_INDEX] = 0.6;
    expect(forward(migrated!, x97on).score).toBeCloseTo(forward(old, x96).score, 10);
  });

  it('devuelve los mismos pesos si ya tienen la dimensión esperada y null si no hay migración posible', () => {
    const current = createRandomWeights(FEATURE_DIM, 4);
    expect(migrateWeights(current, FEATURE_DIM)).toBe(current);
    expect(migrateWeights(createRandomWeights(80, 4), FEATURE_DIM)).toBeNull();
  });
});
