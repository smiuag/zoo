import { normalizeName, SCAN_CARDS, type ScanCounts } from './scanScoring';

// Reconocimiento LOCAL (sin servidores ni IA externa) de las cartas de una
// foto: se aíslan los píxeles casi blancos (el nombre de la carta va en
// blanco sobre el tablón de madera), se lee con Tesseract en el propio
// navegador y cada nombre encontrado cuenta como una carta. Por eso las
// cartas deben ir escalonadas dejando visible el tablón del nombre de cada
// una. Sin ese aislamiento el OCR no lee el nombre (letra blanca con
// contorno oscuro sobre madera); con él lo lee bien.

const MAX_SIDE = 2000;
// Dos umbrales de "blanco" por si la foto sale oscura o sobreexpuesta; de
// cada especie se queda el mayor recuento de las dos pasadas.
const WHITE_THRESHOLDS = [212, 190];

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Cuántos errores de lectura se toleran según la longitud del nombre: los
// cortos (ORO, LORO, FOCA/ORCA…) casi exactos para no confundirlos entre sí.
function allowedErrors(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return Math.floor(len / 3);
}

interface Candidate {
  id: string;
  distance: number;
}

function bestMatch(token: string): Candidate | null {
  let best: Candidate | null = null;
  let tie = false;
  for (const card of SCAN_CARDS) {
    for (const alias of card.aliases) {
      let d = levenshtein(token, alias);
      // Lectura truncada ("RAFA" por JIRAFA): vale si es parte clara del nombre.
      if (token.length >= 4 && alias.length - token.length >= 1 && alias.endsWith(token)) d = Math.min(d, 1);
      if (d > allowedErrors(alias.length)) continue;
      if (!best || d < best.distance) {
        best = { id: card.id, distance: d };
        tie = false;
      } else if (d === best.distance && best.id !== card.id) tie = true;
    }
  }
  return best && !tie ? best : null;
}

/** Cuenta cartas en el texto del OCR (una carta por nombre encontrado). */
export function countCardsInText(text: string): ScanCounts {
  const counts: ScanCounts = {};
  for (const line of text.split('\n')) {
    const tokens = normalizeName(line).split(' ').filter(Boolean);
    let i = 0;
    while (i < tokens.length) {
      // Primero grupos de 3 y 2 palabras ("Pez de colores", "Oso panda").
      let matched = false;
      for (const size of [3, 2, 1]) {
        if (i + size > tokens.length) continue;
        const found = bestMatch(tokens.slice(i, i + size).join(' '));
        if (found) {
          counts[found.id] = (counts[found.id] ?? 0) + 1;
          i += size;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  }
  return counts;
}

async function loadCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// Texto negro sobre fondo blanco: negro donde el canal más oscuro del píxel
// supera el umbral (blanco de la letra), blanco en el resto.
function whiteMask(source: HTMLCanvasElement, threshold: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.min(px[i], px[i + 1], px[i + 2]) > threshold ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export async function scanPhoto(file: File, onProgress: (fraction: number) => void): Promise<ScanCounts> {
  const { createWorker } = await import('tesseract.js');
  let pass = 0;
  const worker = await createWorker('spa', 1, {
    logger: (m: { status: string; progress: number }) => {
      // La descarga de datos y el reconocimiento ocupan la barra por mitades
      // de cada pasada; no hace falta precisión, solo que se vea avance.
      if (m.status === 'recognizing text') onProgress((pass + m.progress) / WHITE_THRESHOLDS.length);
    },
  });
  try {
    const canvas = await loadCanvas(file);
    const best: ScanCounts = {};
    for (; pass < WHITE_THRESHOLDS.length; pass++) {
      const { data } = await worker.recognize(whiteMask(canvas, WHITE_THRESHOLDS[pass]));
      for (const [id, n] of Object.entries(countCardsInText(data.text))) {
        best[id] = Math.max(best[id] ?? 0, n);
      }
    }
    onProgress(1);
    return best;
  } finally {
    await worker.terminate();
  }
}
