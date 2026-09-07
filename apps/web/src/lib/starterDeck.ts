import { getCard, type Card } from '@zoo/engine';

// Mazo inicial real del juego: 7 monedas de 1 + 3 Perezosos (0 coste, 0 PV,
// no sirven para pagar nada). Replica tests/helpers.ts de packages/engine
// (no exportado desde el paquete).
export function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}
