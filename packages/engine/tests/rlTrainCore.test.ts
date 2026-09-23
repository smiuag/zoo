import { describe, expect, it } from 'vitest';
import { accumulateFloorGrad, shapedPurchaseValue, type Step } from '../scripts/rl/trainCore';
import { zeroGrad } from '../scripts/rl/train';

function stepWith(actionTypes: Step['actionTypes'], allScores: number[]): Step {
  return {
    allFeatures: allScores.map(() => [1, 1]),
    allHidden: allScores.map(() => new Float64Array([0.5, -0.5])),
    allScores,
    actionTypes,
    chosenIndex: 0,
    stateFeatures: [],
    shapingBonus: 0,
  };
}

describe('scripts/rl/trainCore', () => {
  it('shapedPurchaseValue: carta normal = su delta real / coste, sin importar la ronda', () => {
    expect(shapedPurchaseValue(4, undefined, 0, 1)).toBe(4);
    expect(shapedPurchaseValue(4, undefined, 1, 1)).toBe(4);
  });

  it('shapedPurchaseValue: normaliza el delta EN VIVO por el precio pagado (coste alto = shaping proporcionalmente menor)', () => {
    // Tiranosaurio (10 PV impresos, coste 9): antes del ajuste puntuaba 10 en
    // bruto, igual que un animal barato con 10 PV reales, pese a costar 9
    // veces más que él.
    expect(shapedPurchaseValue(10, undefined, 0.5, 9)).toBeCloseTo(10 / 9);
    // Coste 0 (dinosaurio gratis por descuento) no debe dividir por 0 ni
    // disparar el shaping a infinito: se trata como coste 1.
    expect(shapedPurchaseValue(10, undefined, 0.5, 0)).toBe(10);
  });

  it('shapedPurchaseValue: carta acumulativa = calibrado (sin normalizar por coste) al empezar, delta real exacto/coste en el último turno, nunca por debajo del delta real normalizado', () => {
    // Tucán recién comprado sin animales caros (vale 1 hoy, coste 5), calibrado 8.
    // El valor calibrado NUNCA se divide por coste (ver comentario en
    // trainCore.ts): ya es un valor medio real medido en partidas, no una
    // cifra de catálogo con sesgo de coste.
    expect(shapedPurchaseValue(1, 8, 0, 5)).toBeCloseTo(1 / 5 + (8 - 1));
    expect(shapedPurchaseValue(1, 8, 1, 5)).toBeCloseTo(1 / 5);
    expect(shapedPurchaseValue(1, 8, 0.5, 5)).toBeCloseTo(1 / 5 + 0.5 * (8 - 1));
    // Tucán con 11 animales caros en el último turno: 12/5, no la constante.
    expect(shapedPurchaseValue(12, 8, 1, 5)).toBeCloseTo(12 / 5);
    // Y a mitad de partida tampoco baja de lo que ya vale (delta normalizado).
    expect(shapedPurchaseValue(12, 8, 0.5, 5)).toBeCloseTo(12 / 5);
  });

  it('accumulateFloorGrad empuja hacia arriba las compras por debajo de endTurn y no toca las demás', () => {
    const w2 = new Float64Array([1, 1]);
    const grad = zeroGrad(2, 2);
    // buyAnimal a -5, endTurn a 0, buyCoin a -9 (no es animal: no se toca),
    // otro buyAnimal a +3 (por encima: no se toca).
    accumulateFloorGrad(grad, stepWith(['buyAnimal', 'endTurn', 'buyCoin', 'buyAnimal'], [-5, 0, -9, 3]), w2, 0.1);
    // accumulateGrad suma `delta` directamente a b2: solo la primera
    // candidata aporta, con delta = 0.1 * (0 - (-5)).
    expect(grad.b2).toBeCloseTo(0.5);
  });

  it('accumulateFloorGrad no hace nada con peso 0 (el valor por defecto, ver FLOOR_WEIGHT)', () => {
    const grad = zeroGrad(2, 2);
    accumulateFloorGrad(grad, stepWith(['buyAnimal', 'endTurn'], [-5, 0]), new Float64Array([1, 1]));
    expect(grad.b2).toBe(0);
  });

  it('accumulateFloorGrad no hace nada sin endTurn entre las candidatas', () => {
    const grad = zeroGrad(2, 2);
    accumulateFloorGrad(grad, stepWith(['playCard', 'playCard'], [-50, 10]), new Float64Array([1, 1]), 0.1);
    expect(grad.b2).toBe(0);
  });
});
