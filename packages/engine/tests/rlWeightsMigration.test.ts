import { describe, expect, it } from 'vitest';
import { CRITIC_FEATURE_DIM, FEATURE_DIM } from '../src/bots/rl/features';
import { FEATURE_DIM_FULL } from '../src/bots/rl/featuresFull';
import { createRandomWeights, forward } from '../src/bots/rl/network';
import { migrateWeights } from '../scripts/rl/weightsIo';

describe('scripts/rl/weightsIo migrateWeights', () => {
  it('migra pesos de 96 columnas a 97 insertando la columna liveScoreDelta a cero, sin cambiar ningún score', () => {
    // Índice literal 78: dónde se insertó la columna en 2026-09-16, cuando
    // el vector tenía 97 columnas en total (coincide numéricamente con
    // LIVE_DELTA_INDEX hoy, pero por casualidad — no depender de esa
    // constante aquí).
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

  it('migra pesos de 99 columnas (disposición del 25/09 con turno+hasRoundLimit) a 97 quitando esas 2 columnas de un tirón', () => {
    const TURN_REMOVE_INDEX = 0;
    const HAS_ROUND_LIMIT_REMOVE_INDEX = 19; // índice ORIGINAL en ese vector de 99, antes de quitar nada
    const old = createRandomWeights(99, 6);
    const migrated = migrateWeights(old, 97);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(97);
    expect(migrated!.w1.every((row) => row.length === 97)).toBe(true);

    // A diferencia de insertar, quitar SÍ pierde lo aprendido para esas 2
    // columnas — lo que hay que verificar es que el resto del vector se
    // comporta EXACTAMENTE como si esas 2 columnas nunca hubieran estado:
    // un x99 con esas 2 entradas a 0 (su contribución anulada) debe dar el
    // mismo score con los pesos VIEJOS que el x97 sin ellas con los pesos
    // MIGRADOS.
    const x99 = Array.from({ length: 99 }, () => Math.random() * 2 - 1);
    const x99ZeroedRemoved = [...x99];
    x99ZeroedRemoved[TURN_REMOVE_INDEX] = 0;
    x99ZeroedRemoved[HAS_ROUND_LIMIT_REMOVE_INDEX] = 0;
    const x97 = x99.filter((_, i) => i !== TURN_REMOVE_INDEX && i !== HAS_ROUND_LIMIT_REMOVE_INDEX);
    expect(x97).toHaveLength(97);

    expect(forward(migrated!, x97).score).toBeCloseTo(forward(old, x99ZeroedRemoved).score, 10);
  });

  it('migra pesos de 97 columnas (disposición ACTUAL) a FEATURE_DIM (100) insertando el recuento de Delfín/Mono/Loro en toda la colección, sin cambiar ningún score', () => {
    const OWNERSHIP_INSERT_INDEX = 12;
    const old = createRandomWeights(97, 6);
    const migrated = migrateWeights(old, FEATURE_DIM);
    expect(migrated).not.toBeNull();
    expect(migrated!.featureDim).toBe(FEATURE_DIM);
    expect(migrated!.w1.every((row) => row.length === FEATURE_DIM)).toBe(true);

    const x97 = Array.from({ length: 97 }, () => Math.random() * 2 - 1);
    const x100 = [...x97.slice(0, OWNERSHIP_INSERT_INDEX), 0, 0, 0, ...x97.slice(OWNERSHIP_INSERT_INDEX)];
    expect(x100).toHaveLength(100);
    expect(forward(migrated!, x100).score).toBeCloseTo(forward(old, x97).score, 10);

    const x100on = [...x100];
    x100on[OWNERSHIP_INSERT_INDEX] = 0.4;
    x100on[OWNERSHIP_INSERT_INDEX + 1] = -0.2;
    x100on[OWNERSHIP_INSERT_INDEX + 2] = 0.7;
    expect(forward(migrated!, x100on).score).toBeCloseTo(forward(old, x97).score, 10);
  });

  it('migra el crítico de 37 columnas (ACTUAL) a CRITIC_FEATURE_DIM (40) con los mismos índices que la política', () => {
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
