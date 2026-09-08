import type { CardInstance } from '@zoo/engine';

const SPECIES_ICONS: Record<string, string> = {
  monkey: '🐒',
  penguin: '🐧',
  peacock: '🦚',
  lion: '🦁',
  tiger: '🐯',
  dolphin: '🐬',
  goldfish: '🐠',
  snake: '🐍',
  parrot: '🦜',
  elephant: '🐘',
  giraffe: '🦒',
  spider: '🕷️',
  hyena: '🐺',
  orca: '🐳',
  'polar-bear': '🐻‍❄️',
  albatross: '🦢',
  crocodile: '🐊',
  hippopotamus: '🦛',
  vulture: '🦅',
  sloth: '🦥',
  duck: '🦆',
  flamingo: '🦩',
  seal: '🦭',
  parakeet: '🐦',
  owl: '🦉',
  bat: '🦇',
  turtle: '🐢',
  // No hay emoji de ornitorrinco en Unicode: usa el 🐾 genérico (fallback
  // de cardIcon) en vez de uno inexacto.
};

export function cardIcon(card: CardInstance): string {
  if (card.type === 'coin') return '🪙';
  if (card.type === 'animal') return SPECIES_ICONS[card.species ?? ''] ?? '🐾';
  return '❓';
}

export function cardAccentClass(card: CardInstance): string {
  if (card.type === 'coin') return 'card--coin';
  if (card.type === 'animal') {
    if (card.habitats?.includes('bird')) return 'card--bird';
    if (card.habitats?.includes('aquatic')) return 'card--aquatic';
    return 'card--land';
  }
  return '';
}

const HABITAT_LABELS: Array<{ key: 'land' | 'bird' | 'aquatic'; label: string }> = [
  { key: 'land', label: 'Terrestre' },
  { key: 'bird', label: 'Volador' },
  { key: 'aquatic', label: 'Acuático' },
];

export function habitatLabel(card: CardInstance): string {
  return HABITAT_LABELS.filter(({ key }) => card.habitats?.includes(key))
    .map(({ label }) => label)
    .join(' - ');
}
