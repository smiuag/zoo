import { getAllCards } from '@zoo/engine';

// Cartas de la edición clásica (la única que se imprime) que el escáner sabe
// reconocer, con lo justo para puntuarlas: PV impreso, coste, hábitats y tipo.
export interface ScanCard {
  id: string;
  name: string;
  type: 'animal' | 'coin';
  victoryPoints: number;
  cost: number;
  habitats: string[];
  /** Nombres impresos (ES + EN) ya normalizados, para comparar con el OCR. */
  aliases: string[];
}

// Nombres de las cartas impresas en inglés (img/_work/card_text_en.py).
const EN_NAMES: Record<string, string> = {
  albatross: 'Albatross',
  bat: 'Bats',
  'coin-1': 'Bronze',
  'coin-2': 'Silver',
  'coin-3': 'Gold',
  'coin-5': 'Platinum',
  crocodile: 'Crocodiles',
  dolphin: 'Dolphins',
  duck: 'Ducks',
  eagle: 'Eagles',
  elephant: 'Elephants',
  flamingo: 'Flamingos',
  giraffe: 'Giraffes',
  goldfish: 'Goldfish',
  hippopotamus: 'Hippos',
  hyena: 'Hyenas',
  lion: 'Lions',
  monkey: 'Monkeys',
  orca: 'Orcas',
  owl: 'Owls',
  panda: 'Giant Pandas',
  parakeet: 'Parakeets',
  parrot: 'Parrots',
  peacock: 'Peacocks',
  penguin: 'Penguins',
  platypus: 'Platypuses',
  rabbit: 'Rabbits',
  raven: 'Ravens',
  seal: 'Seals',
  shark: 'Sharks',
  sloth: 'Sloths',
  snake: 'Snakes',
  spider: 'Spiders',
  squirrel: 'Squirrels',
  tiger: 'Tigers',
  toucan: 'Toucans',
  turtle: 'Turtles',
  vulture: 'Vultures',
};

/** Mayúsculas, sin acentos, solo letras y espacios sueltos. */
export function normalizeName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const SCAN_CARDS: ScanCard[] = getAllCards()
  .filter((c) => c.edition === 'classic' && (c.type === 'animal' || c.type === 'coin'))
  .map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type as 'animal' | 'coin',
    victoryPoints: c.victoryPoints ?? 0,
    cost: c.marketCost ?? 0,
    habitats: (c.habitats as string[]) ?? [],
    aliases: [normalizeName(c.name), ...(EN_NAMES[c.id] ? [normalizeName(EN_NAMES[c.id])] : [])],
  }));

const CARD_BY_ID = new Map(SCAN_CARDS.map((c) => [c.id, c]));

export type ScanCounts = Record<string, number>;

export interface ScanScore {
  direct: number;
  /** [nº de cartas bonus, nº de lo que cuentan] por fila de la calculadora. */
  factors: Record<'eagle' | 'panda' | 'orca' | 'albatross' | 'toucan' | 'shark', [number, number]>;
  total: number;
}

// Mismo cómputo que los efectos scorePer* del motor
// (packages/engine/src/effects/registry.ts): el Pez de colores cuenta como 2
// acuáticos y el Periquito como 2 voladores.
function habitatWeight(card: ScanCard, habitat: string): number {
  if (card.type !== 'animal' || !card.habitats.includes(habitat)) return 0;
  if (card.id === 'goldfish' && habitat === 'aquatic') return 2;
  if (card.id === 'parakeet' && habitat === 'bird') return 2;
  return 1;
}

export function scoreFromCounts(counts: ScanCounts): ScanScore {
  let direct = 0;
  let flying = 0;
  let land = 0;
  let aquatic = 0;
  let costly = 0;
  let coins = 0;
  const species = new Set<string>();
  for (const [id, n] of Object.entries(counts)) {
    const card = CARD_BY_ID.get(id);
    if (!card || n <= 0) continue;
    direct += card.victoryPoints * n;
    flying += habitatWeight(card, 'bird') * n;
    land += habitatWeight(card, 'land') * n;
    aquatic += habitatWeight(card, 'aquatic') * n;
    if (card.type === 'coin') coins += n;
    else {
      species.add(card.id);
      if (card.cost >= 5) costly += n;
    }
  }
  const factors: ScanScore['factors'] = {
    eagle: [counts.eagle ?? 0, flying],
    panda: [counts.panda ?? 0, land],
    orca: [counts.orca ?? 0, aquatic],
    albatross: [counts.albatross ?? 0, species.size],
    toucan: [counts.toucan ?? 0, costly],
    shark: [counts.shark ?? 0, coins],
  };
  const total = direct + Object.values(factors).reduce((sum, [a, b]) => sum + a * b, 0);
  return { direct, factors, total };
}
