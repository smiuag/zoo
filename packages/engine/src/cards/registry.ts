import { CardSchema, type Card } from './schema';

const modules = import.meta.glob('./data/*.json', { eager: true }) as Record<
  string,
  { default: unknown }
>;

function loadCards(): Card[] {
  return Object.entries(modules).map(([path, mod]) => {
    const result = CardSchema.safeParse(mod.default);
    if (!result.success) {
      throw new Error(`Invalid card data in ${path}: ${result.error.message}`);
    }
    return result.data;
  });
}

const cards = loadCards();
const cardsById = new Map(cards.map((card) => [card.id, card]));

export function getAllCards(): Card[] {
  return cards;
}

export function getCard(id: string): Card {
  const card = cardsById.get(id);
  if (!card) {
    throw new Error(`Unknown card id: ${id}`);
  }
  return card;
}
