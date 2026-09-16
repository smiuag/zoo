import { describe, expect, it } from 'vitest';
import { accumulateGrad, addGrad, clampWeightNorms, deserializeGradient, serializeGradient, zeroGrad } from '../scripts/rl/train';
import { createRandomWeights, forward } from '../src/bots/rl/network';

describe('scripts/rl/train', () => {
  it('serializeGradient/deserializeGradient hacen un round-trip exacto', () => {
    // Regresión: worker.ts manda el gradiente por stdout con JSON.stringify,
    // y JSON.stringify de un Float64Array NO da un array (da un objeto
    // {"0":1,"1":2,...}) — sin pasar por serializeGradient/deserializeGradient
    // en el borde entre procesos, el gradiente de cada worker se perdía en
    // silencio (ver comentario en worker.ts/selfPlay.ts).
    const grad = zeroGrad(4, 3);
    accumulateGrad(grad, [1, 2, 3, 4], new Float64Array([0.1, 0.2, 0.3]), new Float64Array([0.5, 0.6, 0.7]), 0.9);

    const roundTripped = deserializeGradient(JSON.parse(JSON.stringify(serializeGradient(grad))));

    expect(Array.from(roundTripped.w1[0])).toEqual(Array.from(grad.w1[0]));
    expect(Array.from(roundTripped.w1[1])).toEqual(Array.from(grad.w1[1]));
    expect(Array.from(roundTripped.w1[2])).toEqual(Array.from(grad.w1[2]));
    expect(Array.from(roundTripped.b1)).toEqual(Array.from(grad.b1));
    expect(Array.from(roundTripped.w2)).toEqual(Array.from(grad.w2));
    expect(roundTripped.b2).toBe(grad.b2);
  });

  it('un gradiente reconstruido tras el round-trip se puede seguir sumando con addGrad', () => {
    const target = zeroGrad(2, 2);
    const source = zeroGrad(2, 2);
    accumulateGrad(source, [1, 1], new Float64Array([0.5, 0.5]), new Float64Array([1, 1]), 1);

    const roundTripped = deserializeGradient(JSON.parse(JSON.stringify(serializeGradient(source))));
    addGrad(target, roundTripped);

    expect(Array.from(target.w1[0])).toEqual(Array.from(source.w1[0]));
    expect(target.b2).toBe(source.b2);
  });

  it('clampWeightNorms: el tope de w2 escala todos los scores por igual y el de w1 escala cada preactivación por igual', () => {
    const weights = createRandomWeights(6, 4);
    for (const row of weights.w1) for (let i = 0; i < row.length; i++) row[i] *= 50;
    for (let j = 0; j < weights.w2.length; j++) weights.w2[j] *= 50;
    const xs = Array.from({ length: 10 }, () => Array.from({ length: 6 }, () => Math.random() * 2 - 1));
    const preact = (x: number[]) => weights.w1.map((row, j) => row.reduce((s, v, i) => s + v * x[i], weights.b1[j]));

    // Solo w2: mismos hidden, scores multiplicados exactamente por el factor.
    const scoresBefore = xs.map((x) => forward(weights, x).score);
    const w2Only = clampWeightNorms(weights, 0, 3);
    expect(w2Only.w1Factor).toBe(1);
    expect(w2Only.w2Factor).toBeLessThan(1);
    expect(Math.sqrt(weights.w2.reduce((s, v) => s + v * v, 0))).toBeCloseTo(3, 6);
    xs.forEach((x, k) => expect(forward(weights, x).score).toBeCloseTo(scoresBefore[k] * w2Only.w2Factor, 8));

    // Solo w1 (+b1): cada preactivación multiplicada exactamente por el
    // factor (mismo signo, mismo orden entre estados para cada unidad).
    const preBefore = xs.map(preact);
    const w1Only = clampWeightNorms(weights, 2, 0);
    expect(w1Only.w1Factor).toBeLessThan(1);
    const n1 = Math.sqrt(weights.w1.reduce((s, row) => s + row.reduce((t, v) => t + v * v, 0), 0));
    expect(n1).toBeCloseTo(2, 6);
    xs.forEach((x, k) => preact(x).forEach((v, j) => expect(v).toBeCloseTo(preBefore[k][j] * w1Only.w1Factor, 8)));

    // Ya dentro del tope (o topes desactivados): no toca nada.
    expect(clampWeightNorms(weights, 2, 3)).toEqual({ w1Factor: 1, w2Factor: 1 });
    expect(clampWeightNorms(weights, 0, 0)).toEqual({ w1Factor: 1, w2Factor: 1 });
  });
});
