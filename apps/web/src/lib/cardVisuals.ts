import twemoji from 'twemoji';
import type { CardInstance } from '@zoo/engine';

// Ilustración real de cada carta (especie, moneda o perezoso), servida desde
// la propia app — un archivo por `card.id` en public/cards/ (ver
// apps/web/public/cards/), así que no hace falta ningún mapeo: el nombre de
// archivo ES el id. Alternativa a los emojis (ver SPECIES_ICONS/cardIcon más
// abajo) cuando el jugador elige el estilo "imagen" (ver ArtStyle en
// artStyle.tsx) — a partir de aquí es el usuario quien decide cuál ver.
export function cardImageUrl(card: CardInstance): string {
  return `/cards/${card.id}.png`;
}

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
  // 🦅 (el emoji real de "águila") es para la especie eagle: Unicode no
  // tiene uno de buitre, así que se le da 🦴 (carroñero) como aproximación
  // distinguible en vez de duplicar el mismo icono en 2 especies distintas.
  vulture: '🦴',
  eagle: '🦅',
  sloth: '🦥',
  duck: '🦆',
  flamingo: '🦩',
  seal: '🦭',
  parakeet: '🐦',
  owl: '🦉',
  bat: '🦇',
  turtle: '🐢',
  rabbit: '🐇',
  shark: '🦈',
  squirrel: '🐿️',
  // Mascotas y dinosaurios (2026-09-20). Unicode solo tiene 2 dinosaurios
  // (saurópodo y T-Rex): terodáctilo y mosasaurio usan los dos dragones
  // como aproximación distinguible (mismo criterio que vulture/toucan).
  dog: '🐕',
  cat: '🐈',
  diplodocus: '🦕',
  tyrannosaurus: '🦖',
  pterodactyl: '🐉',
  mosasaurus: '🐲',
  // Especies añadidas 2026-09-21 (aún sin ilustración real, ver
  // game-editions-classic-vs-full): iguana/hámster/cerdo/gallina/nutria
  // tienen emoji real; Pez Dorado (pez existente 🐠 ya usado por goldfish)
  // usa 🐡 para distinguirse. Colibrí no tiene emoji propio: reutiliza el
  // 🐦 genérico, igual que el periquito.
  iguana: '🦎',
  hamster: '🐹',
  pig: '🐷',
  chicken: '🐔',
  otter: '🦦',
  'golden-fish': '🐡',
  hummingbird: '🐦',
  // Oca: emoji real de ganso (Unicode 14.0, 2021), pero sin respaldo SVG de
  // Twemoji 14.0.2 (probado: 404) — mismo trato que el cuervo más abajo,
  // fuera de fetch-twemoji.mjs, solo se ve si el sistema lo soporta
  // nativamente (supportsEmojiNatively).
  goose: '🪿',
  // Avestruz/Plesiosaurio/Pteranodon: Unicode no tiene ninguno de los tres
  // (ni un reptil marino de cuello largo, ni uno volador), así que son
  // aproximaciones visuales elegidas por el usuario (2026-09-21) en vez del
  // 🐾 genérico — ninguna se parece de verdad, pero distinguen la carta de
  // un vistazo mejor que la pata genérica.
  ostrich: '🦃',
  plesiosaurus: '🦑',
  pteranodon: '🦋',
  // Unicode no tiene un emoji de tucán: se usa el 🦤 (dodo) como
  // aproximación distinguible (mismo criterio que vulture: 🦴 más arriba),
  // en vez de caer en el 🐾 genérico y confundirse con el ornitorrinco
  // (platypus), que sí usa ese fallback por no tener ningún ave/mamífero
  // parecido disponible.
  toucan: '🦤',
  // No hay emoji de ornitorrinco en Unicode: usa el 🐾 genérico (fallback
  // de cardIcon) en vez de uno inexacto.
  // Emoji real de cuervo, pero muy reciente (Unicode 15.0, 2022): a
  // propósito NO está en scripts/fetch-twemoji.mjs (esa versión de
  // Twemoji, congelada en 14.0.2, no lo tiene) — solo se ve si el sistema
  // del jugador lo soporta nativamente (supportsEmojiNatively), sin
  // respaldo Twemoji. Decisión explícita del usuario (2026-09-14) frente
  // a una aproximación temática con respaldo disponible.
  raven: '🐦‍⬛',
};

export function cardIcon(card: CardInstance): string {
  if (card.type === 'coin') return '🪙';
  if (card.type === 'animal') return SPECIES_ICONS[card.species ?? ''] ?? '🐾';
  return '❓';
}

// Ruta al SVG de Twemoji para un emoji dado, para que se vea siempre igual
// (mismo dibujo) en cualquier sistema operativo/navegador, en vez de
// depender de la fuente de emoji instalada (Segoe UI Emoji en Windows, Noto
// Color Emoji en Android/Linux...), que varía entre ordenadores y a veces ni
// siquiera tiene el glifo (emojis añadidos en versiones recientes de
// Unicode). Los SVG que hacen falta (los de SPECIES_ICONS + 🪙/🐾/❓) ya
// están descargados en public/twemoji/ (ver apps/web/scripts/
// fetch-twemoji.mjs para regenerarlos si se añade una especie nueva): se
// sirven desde la propia app, sin depender de ningún CDN externo en tiempo
// de ejecución.
export function twemojiUrl(emoji: string): string {
  const codepoint = twemoji.convert.toCodePoint(emoji);
  return `/twemoji/${codepoint}.svg`;
}

// ¿Este navegador/sistema tiene de verdad un glifo a color para este emoji,
// o lo pintaría como un "tofu" (el cuadradito/rectángulo vacío de "carácter
// no soportado")? Se usa para decidir, emoji a emoji, si mostrar el
// carácter nativo (se prefiere: usa la fuente/estilo propio del sistema del
// jugador) o caer al SVG de Twemoji (ver twemojiUrl) como respaldo
// consistente cuando el sistema no lo tiene.
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

// Algunas ilustraciones (importadas de img/web, ver notas de la conversación)
// quedan visualmente más pequeñas que el resto una vez recortadas a su
// silueta — no por error, sino porque el sujeto ocupa menos del encuadre
// original. Escala extra por carta, dejando el resto en su 80% habitual
// (ver --icon-scale y .card__icon-img en styles.css). León y Tigre piden
// más ajuste que el resto (silueta aún más pequeña dentro de su recorte).
const ICON_SCALE_BY_ID: Record<string, number> = {
  'coin-1': 1.2,
  'coin-2': 1.2,
  'coin-3': 1.2,
  'coin-5': 1.2,
  toucan: 1.2,
  tiger: 1.4,
  lion: 1.4,
};

export function cardIconScale(card: CardInstance): number {
  return ICON_SCALE_BY_ID[card.id] ?? 1;
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
// Tipos extra (no son hábitat ni deciden el color de la carta): se añaden
// detrás de los hábitats en la etiqueta.
const EXTRA_TYPE_LABELS: Array<{ key: 'pet' | 'dinosaur'; label: string }> = [
  { key: 'pet', label: 'Mascota' },
  { key: 'dinosaur', label: 'Dinosaurio' },
];

// Partes sueltas de la etiqueta de tipo, SIN unir — la usa CardView.tsx para
// partirla en líneas de 2 en 2 (una carta con 3-4 tipos a la vez, p. ej. la
// Gallina o la Tortuga, no cabía en una sola línea del pie de la carta y se
// recortaba con "…", ver .card__footer en styles.css — pedido explícito del
// usuario 2026-09-21). habitatLabel (más abajo) sigue devolviendo el string
// unido de siempre para cualquier otro uso.
export function habitatLabelParts(card: CardInstance): string[] {
  const matched = HABITAT_LABELS.filter(({ key }) => card.habitats?.includes(key));
  // Un animal con los 3 hábitats a la vez se etiquetaría "Todoterreno" en
  // vez de listarlos por separado. Excepción explícita del usuario
  // (2026-09-21): el Albatros SÍ tiene los 3 a la vez, pero se listan sus 3
  // tipos básicos por separado en vez de colapsarlos en "Todoterreno".
  const extras = EXTRA_TYPE_LABELS.filter(({ key }) => card.habitats?.includes(key)).map(({ label }) => label);
  const collapseToAllTerrain = matched.length === HABITAT_LABELS.length && card.id !== 'albatross';
  const base = collapseToAllTerrain ? ['Todoterreno'] : matched.map(({ label }) => label);
  return [...base, ...extras];
}

export function habitatLabel(card: CardInstance): string {
  return habitatLabelParts(card).join(' - ');
}
