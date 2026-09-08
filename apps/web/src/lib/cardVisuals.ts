import twemoji from 'twemoji';
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
  rabbit: '🐇',
  // No hay emoji de ornitorrinco en Unicode: usa el 🐾 genérico (fallback
  // de cardIcon) en vez de uno inexacto.
};

export function cardIcon(card: CardInstance): string {
  if (card.type === 'coin') return '🪙';
  if (card.type === 'animal') return SPECIES_ICONS[card.species ?? ''] ?? '🐾';
  return '❓';
}

// PRUEBA: ruta al SVG de Twemoji para un emoji dado, para que se vea
// siempre igual (mismo dibujo) en cualquier sistema operativo/navegador,
// en vez de depender de la fuente de emoji instalada (Segoe UI Emoji en
// Windows, Noto Color Emoji en Android/Linux...), que varía entre
// ordenadores y a veces ni siquiera tiene el glifo (emojis añadidos en
// versiones recientes de Unicode). Los 31 SVG que hacen falta (los de
// SPECIES_ICONS + 🪙/🐾/❓) ya están descargados en public/twemoji/ (ver
// apps/web/scripts/fetch-twemoji.mjs para regenerarlos si se añade una
// especie nueva): se sirven desde la propia app, sin depender de ningún
// CDN externo en tiempo de ejecución.
export function twemojiUrl(emoji: string): string {
  const codepoint = twemoji.convert.toCodePoint(emoji);
  return `/twemoji/${codepoint}.svg`;
}

// PRUEBA: ¿este navegador/sistema tiene de verdad un glifo a color para
// este emoji, o lo pintaría como un "tofu" (el cuadradito/rectángulo
// vacío de "carácter no soportado")? Se usa para decidir, emoji a emoji,
// si mostrar el carácter nativo (se prefiere: usa la fuente/estilo propio
// del sistema del jugador) o caer al SVG de Twemoji (ver twemojiUrl) como
// respaldo consistente cuando el sistema no lo tiene.
//
// Truco: se pinta el emoji en un <canvas> oculto y se cuenta cuántos
// colores DISTINTOS aparecen entre los píxeles no transparentes. Un glifo
// real a color (como cualquier emoji moderno) usa muchísimos tonos
// distintos; un "tofu" es un simple contorno monocromo (1-2 colores como
// mucho). No es 100% infalible, pero basta para distinguir "hay dibujo de
// verdad" de "no hay nada". Se cachea por emoji: es una operación de
// canvas, cara para hacerla en cada render de cada carta.
const emojiSupportCache = new Map<string, boolean>();

export function supportsEmojiNatively(emoji: string): boolean {
  const cached = emojiSupportCache.get(emoji);
  if (cached !== undefined) return cached;

  let supported = false;
  try {
    const canvas = document.createElement('canvas');
    const SIZE = 24;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = `${SIZE}px sans-serif`;
      ctx.fillText(emoji, 0, 0);
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
      const colors = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue; // píxel transparente: no cuenta
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      }
      supported = colors.size > 4;
    }
  } catch {
    supported = false;
  }

  emojiSupportCache.set(emoji, supported);
  return supported;
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
