import { describe, expect, it } from 'vitest';
import { CRITIC_FEATURE_DIM, FEATURE_DIM } from '../src/bots/rl/features';
import { FEATURE_DIM_FULL } from '../src/bots/rl/featuresFull';
import { createRandomWeights, forward } from '../src/bots/rl/network';
import { migrateWeights } from '../scripts/rl/weightsIo';

describe('scripts/rl/weightsIo migrateWeights', () => {
  it('migra pesos de 96 columnas a 97 insertando la columna liveScoreDelta a cero, sin cambiar ningún score', () => {
    // Índice literal 78, NO LIVE_DELTA_INDEX (que hoy vale 80: se movió con
    // la migración 97->99 de más abajo) — esta migración concreta describe
    // dónde se insertó la columna en 2026-09-16, cuando el vector aún tenía
    // 97 columnas en total.
    const LIVE_DELTA_INDEX_AT_97 = 78;
    const old = createRandomWeights(96, 6);
    const migrated = migrateWeights(old, 97);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(97);
    expect(migrated!.w1.every((row) => row.length === 97)).toBe(true);

    const x96 = Array.from({ length: 96 }, () => Math.random() * 2 - 1);
    const x97 = [...x96.slice(0, LIVE_DELTA_INDEX_AT_97), 0, ...x96.slice(LIVE_DELTA_INDEX_AT_97)];
    expect(forward(migrated!, x97).score).toBeCloseTo(forward(old, x96).score, 10);

    // Con la columna nueva encendida el score sigue igual (peso 0): es el
    // entrenamiento el que tiene que aprender a usarla.
    const x97on = [...x97];
    x97on[LIVE_DELTA_INDEX_AT_97] = 0.6;
    expect(forward(migrated!, x97on).score).toBeCloseTo(forward(old, x96).score, 10);
  });

  it('migra pesos de 97 columnas a 99 insertando las 2 bolsas de compra restringido a cero, sin cambiar ningún score', () => {
    const AQUATIC_BONUS_INSERT_INDEX = 5;
    const DINOSAUR_BONUS_INSERT_INDEX = 6;
    const old = createRandomWeights(97, 6);
    const migrated = migrateWeights(old, FEATURE_DIM);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(FEATURE_DIM);
    expect(migrated!.w1.every((row) => row.length === FEATURE_DIM)).toBe(true);

    const x97 = Array.from({ length: 97 }, () => Math.random() * 2 - 1);
    const x99 = [
      ...x97.slice(0, AQUATIC_BONUS_INSERT_INDEX),
      0,
      0,
      ...x97.slice(AQUATIC_BONUS_INSERT_INDEX),
    ];
    expect(x99).toHaveLength(99);
    expect(forward(migrated!, x99).score).toBeCloseTo(forward(old, x97).score, 10);

    const x99on = [...x99];
    x99on[AQUATIC_BONUS_INSERT_INDEX] = 0.6;
    x99on[DINOSAUR_BONUS_INSERT_INDEX] = -0.3;
    expect(forward(migrated!, x99on).score).toBeCloseTo(forward(old, x97).score, 10);
  });

  it('migra pesos de 96 columnas directamente a FEATURE_DIM encadenando las 3 migraciones', () => {
    const old = createRandomWeights(96, 6);
    const migrated = migrateWeights(old, FEATURE_DIM);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(FEATURE_DIM);
    expect(migrated!.w1.every((row) => row.length === FEATURE_DIM)).toBe(true);
  });

  it('migra el crítico de 37 columnas a CRITIC_FEATURE_DIM (39) con los mismos índices que la política', () => {
    const old = createRandomWeights(37, 4);
    const migrated = migrateWeights(old, CRITIC_FEATURE_DIM);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(CRITIC_FEATURE_DIM);
    expect(migrated!.w1.every((row) => row.length === CRITIC_FEATURE_DIM)).toBe(true);
  });

  it('devuelve los mismos pesos si ya tienen la dimensión esperada y null si no hay migración posible', () => {
    const current = createRandomWeights(FEATURE_DIM, 4);
    expect(migrateWeights(current, FEATURE_DIM)).toBe(current);
    expect(migrateWeights(createRandomWeights(80, 4), FEATURE_DIM)).toBeNull();
  });

  it('migra pesos de la completa (121 columnas) a 122 insertando ownedCopies a cero, sin cambiar ningún score', () => {
    const OWNED_COPIES_INSERT_INDEX = 96;
    const old = createRandomWeights(121, 6);
    const migrated = migrateWeights(old, FEATURE_DIM_FULL);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(FEATURE_DIM_FULL);
    expect(migrated!.w1.every((row) => row.length === FEATURE_DIM_FULL)).toBe(true);

    const x121 = Array.from({ length: 121 }, () => Math.random() * 2 - 1);
    const x122 = [...x121.slice(0, OWNED_COPIES_INSERT_INDEX), 0, ...x121.slice(OWNED_COPIES_INSERT_INDEX)];
    expect(forward(migrated!, x122).score).toBeCloseTo(forward(old, x121).score, 10);

    const x122on = [...x122];
    x122on[OWNED_COPIES_INSERT_INDEX] = 0.6;
    expect(forward(migrated!, x122on).score).toBeCloseTo(forward(old, x121).score, 10);
  });
});
