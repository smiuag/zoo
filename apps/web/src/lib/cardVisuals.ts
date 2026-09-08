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

// Bronce/Plata/Oro (coin-1/2/3): medalla del mismo tono que el metal de la
// moneda, en vez de un 🪙 genérico igual para las 3 (que en la mayoría de
// fuentes de emoji se pinta dorado, confundiéndose con la de Oro).
const COIN_ICONS: Record<number, string> = {
  1: '🥉',
  2: '🥈',
  3: '🥇',
};

export function cardIcon(card: CardInstance): string {
  if (card.type === 'coin') return COIN_ICONS[card.value ?? 0] ?? '🪙';
  if (card.type === 'animal') return SPECIES_ICONS[card.species ?? ''] ?? '🐾';
  return '❓';
}

// Bronce/Plata/Oro llevan cada una su propio tono (ver .card--coin-bronze/
// -silver/-gold en styles.css), además de la clase base .card--coin
// compartida (usada p. ej. por el menú contextual de solo texto).
const COIN_TONE_CLASS: Record<number, string> = {
  1: 'card--coin-bronze',
  2: 'card--coin-silver',
  3: 'card--coin-gold',
};

export function cardAccentClass(card: CardInstance): string {
  if (card.type === 'coin') return ['card--coin', COIN_TONE_CLASS[card.value ?? 0]].filter(Boolean).join(' ');
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
