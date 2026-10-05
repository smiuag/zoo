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

// Tamaño de trabajo. La foto se lee A SU RESOLUCIÓN NATIVA, troceada en
// cuadrículas con solapamiento (TILE_SIDE px de lado, TILE_OVERLAP de margen
// compartido), en vez de reducirla entera: así en una mesa con 30-40 cartas
// cada nombre conserva su tamaño en píxeles. Solo se reduce si el lado largo
// pasa de MAX_FULL_SIDE (memoria); las fotos pequeñas (p. ej. las que pasan por
// WhatsApp, ~900 px) se amplían hasta ×MAX_UPSCALE porque con letras de ~12 px
// el OCR no lee nada. El solapamiento es mayor que un nombre, para que ninguno
// quede cortado por el borde de un trozo; los nombres que salen en dos trozos
// se cuentan una vez (ver addDetections).
const MAX_FULL_SIDE = 4800;
const SMALL_SIDE = 1600;
const MAX_UPSCALE = 3;
const TILE_SIDE = 2200;
const TILE_OVERLAP = 350;
// Altura mínima (px) de la caja de un nombre para aceptarlo.
const MIN_NAME_HEIGHT = 8;
// Si con la foto tal cual se detectan menos cartas que estas (las lecturas
// basura de una foto girada suelen colar 1-2 cartas falsas), se reintenta
// girándola 90° y 270° (cartas tumbadas respecto al móvil).
const MIN_CARDS_BEFORE_ROTATING = 4;

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
  /** Nombre corto leído con algún error: a ese nivel el ruido del OCR se parece a un nombre real. */
  weak: boolean;
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
        best = { id: card.id, distance: d, weak: d > 0 && alias.length <= 5 };
        tie = false;
      } else if (d === best.distance && best.id !== card.id) tie = true;
    }
  }
  return best && !tie ? best : null;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Una carta detectada: especie y caja del nombre (si se conoce) en coordenadas de la imagen. */
interface Detection {
  id: string;
  box?: Box;
  /** Coincidencia dudosa (nombre corto con errores): solo vale si se lee en 2 pasadas en el mismo sitio. */
  weak: boolean;
  /** Veces que se ha leído en esa posición (trozos solapados, máscaras distintas). */
  seen: number;
}

interface Token {
  t: string;
  box?: Box;
}

function unionBox(boxes: (Box | undefined)[]): Box | undefined {
  const known = boxes.filter((b): b is Box => !!b);
  if (known.length === 0) return undefined;
  return {
    x0: Math.min(...known.map((b) => b.x0)),
    y0: Math.min(...known.map((b) => b.y0)),
    x1: Math.max(...known.map((b) => b.x1)),
    y1: Math.max(...known.map((b) => b.y1)),
  };
}

// Busca nombres de carta en una línea de palabras (una carta por nombre).
function detectInLine(tokens: Token[]): Detection[] {
  const found: Detection[] = [];
  let i = 0;
  while (i < tokens.length) {
    // Primero grupos de 3 y 2 palabras ("Pez de colores", "Oso panda").
    let matched = false;
    for (const size of [3, 2, 1]) {
      if (i + size > tokens.length) continue;
      const group = tokens.slice(i, i + size);
      const match = bestMatch(group.map((g) => g.t).join(' '));
      if (match) {
        const box = unionBox(group.map((g) => g.box));
        // Cajas diminutas son motas de ruido, no un nombre.
        if (!box || box.y1 - box.y0 >= MIN_NAME_HEIGHT) found.push({ id: match.id, box, weak: match.weak, seen: 1 });
        i += size;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
  return found;
}

/** Cuenta cartas en el texto del OCR (una carta por nombre encontrado). */
export function countCardsInText(text: string): ScanCounts {
  const counts: ScanCounts = {};
  for (const line of text.split('\n')) {
    const tokens = normalizeName(line)
      .split(' ')
      .filter(Boolean)
      .map((t) => ({ t }));
    for (const d of detectInLine(tokens)) counts[d.id] = (counts[d.id] ?? 0) + 1;
  }
  return counts;
}

interface OcrWord {
  text: string;
  bbox: Box;
}

// (detectInLines, addDetections y countsOf se exportan solo para poder probar el troceado sin navegador.)
/** Detecta cartas en las líneas de palabras del OCR de un trozo, con la caja desplazada al origen de la imagen entera. */
export function detectInLines(lines: OcrWord[][], offsetX: number, offsetY: number): Detection[] {
  const out: Detection[] = [];
  for (const line of lines) {
    const tokens: Token[] = line.flatMap((w) => {
      const box = {
        x0: w.bbox.x0 + offsetX,
        y0: w.bbox.y0 + offsetY,
        x1: w.bbox.x1 + offsetX,
        y1: w.bbox.y1 + offsetY,
      };
      return normalizeName(w.text)
        .split(' ')
        .filter(Boolean)
        .map((t) => ({ t, box }));
    });
    out.push(...detectInLine(tokens));
  }
  return out;
}

// Un mismo nombre leído en dos trozos (o con dos máscaras) cae en el mismo
// sitio con unos píxeles de error, y a veces con la caja más ancha o más alta
// (el OCR pega ruido a la palabra). Dos copias de la misma especie escalonadas
// están separadas, como mínimo, por la altura del nombre. Se consideran la
// misma carta si son de la misma especie, sus cajas se solapan en horizontal y
// sus centros distan en vertical menos de 1,2 alturas del nombre MÁS BAJO.
const SAME_CARD_DISTANCE_IN_HEIGHTS = 1.2;

function isSameCard(a: Detection, b: Detection): boolean {
  if (a.id !== b.id) return false;
  if (!a.box || !b.box) return false;
  if (a.box.x1 < b.box.x0 || b.box.x1 < a.box.x0) return false;
  const h = Math.max(Math.min(a.box.y1 - a.box.y0, b.box.y1 - b.box.y0), 6);
  const dy = (a.box.y0 + a.box.y1) / 2 - (b.box.y0 + b.box.y1) / 2;
  return Math.abs(dy) < h * SAME_CARD_DISTANCE_IN_HEIGHTS;
}

export function addDetections(into: Detection[], incoming: Detection[]): void {
  for (const d of incoming) {
    const existing = into.find((e) => isSameCard(e, d));
    if (!existing) {
      into.push({ ...d });
      continue;
    }
    existing.seen += d.seen;
    if (!d.weak) existing.weak = false;
  }
}

/** Detecciones válidas: las seguras, y las dudosas solo si se leyeron al menos dos veces en el mismo sitio. */
export function confirmed(detections: Detection[]): Detection[] {
  return detections.filter((d) => !d.weak || d.seen >= 2);
}

export function countsOf(detections: Detection[]): ScanCounts {
  const counts: ScanCounts = {};
  for (const d of detections) counts[d.id] = (counts[d.id] ?? 0) + 1;
  return counts;
}

async function loadCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale =
    longSide > MAX_FULL_SIDE
      ? MAX_FULL_SIDE / longSide
      : longSide < SMALL_SIDE
        ? Math.min(MAX_UPSCALE, MAX_FULL_SIDE / longSide)
        : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function rotateCanvas(source: HTMLCanvasElement, degrees: 90 | 270): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = source.height;
  out.height = source.width;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return out;
}

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Posiciones de inicio de `count` trozos de `size` px repartidos de forma
// uniforme sobre `total` px (con el solapamiento que resulte).
function tileStarts(total: number, size: number, count: number): number[] {
  if (count <= 1) return [0];
  return Array.from({ length: count }, (_, i) => Math.round((i * (total - size)) / (count - 1)));
}

/** Cuadrícula de trozos con solapamiento; un único trozo si la imagen ya es de tamaño normal. */
export function tilesFor(width: number, height: number): Tile[] {
  const fits = (n: number) => n <= TILE_SIDE * 1.2;
  if (fits(width) && fits(height)) return [{ x: 0, y: 0, w: width, h: height }];
  const axis = (total: number) => {
    if (fits(total)) return { size: total, starts: [0] };
    const count = Math.ceil((total - TILE_OVERLAP) / (TILE_SIDE - TILE_OVERLAP));
    const size = Math.ceil((total + (count - 1) * TILE_OVERLAP) / count);
    return { size, starts: tileStarts(total, size, count) };
  };
  const cols = axis(width);
  const rows = axis(height);
  return rows.starts.flatMap((y) => cols.starts.map((x) => ({ x, y, w: cols.size, h: rows.size })));
}

function cropCanvas(source: HTMLCanvasElement, tile: Tile): HTMLCanvasElement {
  if (tile.w === source.width && tile.h === source.height) return source;
  const out = document.createElement('canvas');
  out.width = tile.w;
  out.height = tile.h;
  out.getContext('2d')!.drawImage(source, tile.x, tile.y, tile.w, tile.h, 0, 0, tile.w, tile.h);
  return out;
}

export async function scanPhoto(file: File, onProgress: (fraction: number) => void): Promise<ScanCounts> {
  const { createWorker } = await import('tesseract.js');
  let planned = 1; // se fija al conocer los trozos y se amplía al planificar cada fase
  let done = 0;
  let lastReported = 0;
  const report = (withinPass: number) => {
    // Nunca hacia atrás aunque se añadan pasadas al plan (extras y giros).
    lastReported = Math.max(lastReported, Math.min(0.99, (done + withinPass) / planned));
    onProgress(lastReported);
  };
  const worker = await createWorker('spa', 1, {
    logger: (m: { status: string; progress: number }) => {
      // La descarga de datos y el reconocimiento ocupan la barra por mitades
      // de cada pasada; no hace falta precisión, solo que se vea avance.
      if (m.status === 'recognizing text') report(m.progress);
    },
  });

  async function readTile(canvas: HTMLCanvasElement, tile: Tile, mask: PrintProfile['masks'][number]): Promise<Detection[]> {
    const { data } = await worker.recognize(mask(cropCanvas(canvas, tile)), {}, { blocks: true });
    done++;
    const lines: OcrWord[][] = [];
    for (const block of data.blocks ?? [])
      for (const paragraph of block.paragraphs)
        for (const line of paragraph.lines) lines.push(line.words.map((w) => ({ text: w.text, bbox: w.bbox })));
    return detectInLines(lines, tile.x, tile.y);
  }

  // Lee todos los trozos de un lienzo con la máscara `maskIndex` de un perfil.
  async function readAllTiles(canvas: HTMLCanvasElement, tiles: Tile[], profile: PrintProfile, maskIndex: number) {
    const found: Detection[] = [];
    for (const tile of tiles) addDetections(found, await readTile(canvas, tile, profile.masks[maskIndex]));
    return found;
  }

  // Lectura completa de un lienzo: 1ª máscara de cada perfil en todos los
  // trozos; el perfil que más detecta (los demás dan lecturas basura) lee
  // además sus máscaras restantes (otros umbrales de luz). Los perfiles no se
  // mezclan entre sí.
  async function scanCanvas(canvas: HTMLCanvasElement, extraMasks: boolean): Promise<Detection[]> {
    const tiles = tilesFor(canvas.width, canvas.height);
    const perProfile: Detection[][] = [];
    for (const profile of PRINT_PROFILES) perProfile.push(await readAllTiles(canvas, tiles, profile, 0));
    const strong = (list: Detection[]) => list.filter((d) => !d.weak).length;
    let winner = 0;
    perProfile.forEach((list, i) => {
      if (strong(list) > strong(perProfile[winner])) winner = i;
    });
    if (extraMasks) {
      const profile = PRINT_PROFILES[winner];
      planned += (profile.masks.length - 1) * tiles.length;
      for (let m = 1; m < profile.masks.length; m++)
        addDetections(perProfile[winner], await readAllTiles(canvas, tiles, profile, m));
    }
    return confirmed(perProfile[winner]);
  }

  try {
    const canvas = await loadCanvas(file);
    planned = tilesFor(canvas.width, canvas.height).length * PRINT_PROFILES.length;
    let best = await scanCanvas(canvas, true);

    if (best.length < MIN_CARDS_BEFORE_ROTATING) {
      for (const degrees of [90, 270] as const) {
        const rotated = rotateCanvas(canvas, degrees);
        planned += tilesFor(rotated.width, rotated.height).length * PRINT_PROFILES.length;
        const result = await scanCanvas(rotated, false);
        if (result.length > best.length) best = result;
      }
    }
    onProgress(1);
    return countsOf(best);
  } finally {
    await worker.terminate();
  }
}
