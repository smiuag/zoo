import { getCard } from '../src/cards/registry';
import type { Card } from '../src/cards/schema';

// Mazo inicial real: 7 monedas de 1 + 3 Perezosos (0 coste, 0 PV, no sirven
// para pagar nada: solo ocupan hueco de mano hasta que los descartas).
export function buildStarterDeck(): Card[] {
  const coin1 = getCard('coin-1');
  const sloth = getCard('sloth');
  return [...Array.from({ length: 7 }, () => coin1), ...Array.from({ length: 3 }, () => sloth)];
}
