import { describe, expect, it } from 'vitest';
import { accumulateGrad, addGrad, deserializeGradient, serializeGradient, zeroGrad } from '../scripts/rl/train';

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
});
