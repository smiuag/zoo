import { normalizeName, SCAN_CARDS, type ScanCounts } from './scanScoring';

// Reconocimiento LOCAL (sin servidores ni IA externa) de las cartas de una
// foto: se aísla el nombre de cada carta, se lee con Tesseract en el propio
// navegador y cada nombre encontrado cuenta como una carta. Por eso las
// cartas deben ir escalonadas dejando visible el nombre de cada una. Sin el
// aislamiento el OCR no lo lee (el nombre va sobre un tablón con relieve);
// con él lo lee bien.
//
// Cada diseño de carta impresa necesita su propio aislamiento (letra blanca
// sobre madera en el oficial actual, letra oscura sobre tablón de color en el
// antiguo sin iconos). El usuario NO elige variante: se prueban todos los
// PERFILES DE IMPRESIÓN y de cada especie se queda el mayor recuento.
//
// PARA AÑADIR UNA IMPRESIÓN NUEVA: añadir una entrada a PRINT_PROFILES con la
// máscara que deje su nombre en negro sobre blanco (y ajustar umbrales
// probando con una foto real o una simulación). Si cambia el diseño del
// nombre de la carta (color, fondo, posición), revisar estos perfiles.

const MAX_SIDE = 2000;

interface PrintProfile {
  id: string;
  description: string;
  /** Una máscara por pasada de OCR (umbrales distintos por si la foto sale oscura o sobreexpuesta). */
  masks: ((source: HTMLCanvasElement) => HTMLCanvasElement)[];
}

// Texto negro sobre fondo blanco: negro donde `isText(r, g, b)` es verdadero.
function maskBy(source: HTMLCanvasElement, isText: (r: number, g: number, b: number) => boolean): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const v = isText(px[i], px[i + 1], px[i + 2]) ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const whiteText = (threshold: number) => (c: HTMLCanvasElement) =>
  maskBy(c, (r, g, b) => Math.min(r, g, b) > threshold);
const darkText = (threshold: number) => (c: HTMLCanvasElement) =>
  maskBy(c, (r, g, b) => Math.max(r, g, b) < threshold);

const PRINT_PROFILES: PrintProfile[] = [
  {
    id: 'white-on-wood',
    description: 'Oficial actual (con iconos): nombre en blanco con contorno oscuro sobre tablón de madera.',
    masks: [whiteText(212), whiteText(190)],
  },
  {
    id: 'dark-on-plank',
    description: 'Antiguo (sin iconos): nombre en marrón oscuro sobre tablón de madera o gris azulado según el hábitat.',
    masks: [darkText(90), darkText(110)],
  },
];

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

export async function scanPhoto(file: File, onProgress: (fraction: number) => void): Promise<ScanCounts> {
  const { createWorker } = await import('tesseract.js');
  const masks = PRINT_PROFILES.flatMap((profile) => profile.masks);
  let pass = 0;
  const worker = await createWorker('spa', 1, {
    logger: (m: { status: string; progress: number }) => {
      // La descarga de datos y el reconocimiento ocupan la barra por mitades
      // de cada pasada; no hace falta precisión, solo que se vea avance.
      if (m.status === 'recognizing text') onProgress((pass + m.progress) / masks.length);
    },
  });
  try {
    const canvas = await loadCanvas(file);
    const best: ScanCounts = {};
    for (; pass < masks.length; pass++) {
      const { data } = await worker.recognize(masks[pass](canvas));
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
