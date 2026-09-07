import { describe, expect, it } from 'vitest';
import { createRandomWeights, deserializeWeights, forward, serializeWeights } from '../src/bots/rl/network';

describe('rl/network', () => {
  it('con todos los pesos a 0 devuelve exactamente b2', () => {
    const weights = createRandomWeights(4, 3);
    weights.w1 = weights.w1.map((row) => row.map(() => 0));
    weights.b1 = weights.b1.map(() => 0);
    weights.w2 = weights.w2.map(() => 0);
    weights.b2 = 2.5;

    const { score } = forward(weights, [1, 2, 3, 4]);
    expect(score).toBe(2.5);
  });

  it('serializeWeights/deserializeWeights hacen un round-trip exacto', () => {
    const weights = createRandomWeights(4, 3);
    const restored = deserializeWeights(serializeWeights(weights));
    expect(restored).toEqual(weights);
  });

  it('deserializeWeights lanza si las dimensiones no coinciden', () => {
    const weights = createRandomWeights(4, 3);
    const malformed = { ...weights, featureDim: 5 };
    expect(() => deserializeWeights(malformed)).toThrow();
  });

  it('deserializeWeights lanza con un objeto sin la forma esperada', () => {
    expect(() => deserializeWeights({ foo: 'bar' })).toThrow();
    expect(() => deserializeWeights(null)).toThrow();
  });
});
