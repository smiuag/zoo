import { describe, expect, it } from 'vitest';
import { forward, createRandomWeights } from '../src/bots/rl/network';
import { accumulateGrad, applyGradAdam, createAdamState, scaleGrad, zeroGrad } from '../scripts/rl/train';

describe('scripts/rl/train (Adam)', () => {
  it('applyGradAdam mueve los pesos y el estado de Adam evoluciona sin NaN/Infinity a lo largo de varios batches', () => {
    const weights = createRandomWeights(4, 3);
    const adam = createAdamState(4, 3);
    const before = forward(weights, [1, 0.5, -0.3, 0.2]).score;

    for (let batch = 0; batch < 20; batch++) {
      const grad = zeroGrad(4, 3);
      const { hidden } = forward(weights, [1, 0.5, -0.3, 0.2]);
      // Un delta fijo hacia arriba: si Adam funciona, el score debería subir
      // de forma consistente a lo largo de los batches, no quedarse plano
      // ni disparase a Infinity.
      accumulateGrad(grad, [1, 0.5, -0.3, 0.2], hidden, weights.w2, 1);
      scaleGrad(grad, 1); // un solo "episodio" por batch en este test
      applyGradAdam(weights, grad, adam, 0.01);

      for (const row of weights.w1) for (const v of row) expect(Number.isFinite(v)).toBe(true);
      for (const v of weights.b1) expect(Number.isFinite(v)).toBe(true);
      for (const v of weights.w2) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(weights.b2)).toBe(true);
    }

    const after = forward(weights, [1, 0.5, -0.3, 0.2]).score;
    expect(after).toBeGreaterThan(before);
    expect(adam.t).toBe(20);
  });

  it('scaleGrad normaliza la suma antes de que Adam la vea (media, no suma cruda)', () => {
    const gradSum = zeroGrad(2, 2);
    accumulateGrad(gradSum, [1, 1], new Float64Array([0.5, 0.5]), new Float64Array([1, 1]), 1);
    accumulateGrad(gradSum, [1, 1], new Float64Array([0.5, 0.5]), new Float64Array([1, 1]), 1);
    const originalB2 = gradSum.b2;

    scaleGrad(gradSum, 1 / 2);

    expect(gradSum.b2).toBeCloseTo(originalB2 / 2, 10);
  });
});
