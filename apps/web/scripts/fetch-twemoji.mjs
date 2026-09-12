// Descarga los SVG de Twemoji para todos los emojis usados en cardVisuals.ts
// (SPECIES_ICONS + los genéricos 🪙/🐾/❓) a public/twemoji/, para servirlos
// desde la propia app sin depender de ningún CDN en tiempo de ejecución (ver
// twemojiUrl en cardVisuals.ts). Ejecutar cada vez que se añada una especie
// nueva con un emoji que todavía no esté descargado.
//
// Uso: node scripts/fetch-twemoji.mjs
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import twemoji from 'twemoji';

// Debe reflejar los mismos emojis que SPECIES_ICONS en ../src/lib/
// cardVisuals.ts, más los 3 genéricos (moneda/sin-icono/desconocido) que usa
// cardIcon(). Si se añade una especie nueva ahí, añadir aquí su emoji.
const EMOJIS = [
  '🐒',
  '🐧',
  '🦚',
  '🦁',
  '🐯',
  '🐬',
  '🐠',
  '🐍',
  '🦜',
  '🐘',
  '🦒',
  '🕷️',
  '🐺',
  '🐳',
  '🐻‍❄️',
  '🦢',
  '🐊',
  '🦛',
  '🦴',
  '🦅',
  '🦥',
  '🦆',
  '🦩',
  '🦭',
  '🐦',
  '🦉',
  '🦇',
  '🐢',
  '🐇',
  '🦈',
  '🐾',
  '🪙',
  '❓',
];

const OUT_DIR = fileURLToPath(new URL('../public/twemoji', import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

// Twemoji no siempre publica el nombre EXACTO del codepoint con el selector
// de variación -fe0f incluido (p. ej. la araña 🕷️ es "1f577.svg" en su
// repositorio, no "1f577-fe0f.svg"): si falla la primera URL, se reintenta
// sin ese sufijo antes de rendirse.
async function fetchSvg(codepoint) {
  const candidates = [codepoint, codepoint.replace(/-fe0f$/, '')];
  for (const candidate of candidates) {
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${candidate}.svg`;
    const res = await fetch(url);
    if (res.ok) return res.text();
  }
  throw new Error(`No se encontró el SVG de Twemoji para el codepoint ${codepoint}`);
}

async function main() {
  let downloaded = 0;
  for (const emoji of EMOJIS) {
    const codepoint = twemoji.convert.toCodePoint(emoji);
    const outPath = path.join(OUT_DIR, `${codepoint}.svg`);
    if (existsSync(outPath)) continue;
    const svg = await fetchSvg(codepoint);
    writeFileSync(outPath, svg, 'utf-8');
    console.log(`descargado ${codepoint}.svg (${emoji})`);
    downloaded += 1;
  }
  console.log(downloaded > 0 ? `\nListo: ${downloaded} SVG nuevos.` : '\nYa estaban todos descargados.');
}

main();
