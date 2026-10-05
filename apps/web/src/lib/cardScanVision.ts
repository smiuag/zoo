import { scanWithCv, type RgbaImage, type ScanAssets } from './cardScanCv';
import { SCAN_CARDS, type ScanCounts } from './scanScoring';

// Parte del navegador del escáner por imagen: carga perezosa de OpenCV.js
// (~13 MB, solo al usar el escáner) y de los recursos de reconocimiento
// (public/scan: plantillas de bolsa y escudo, y la ilustración de cada carta;
// se generan con img/_work/build_scan_assets.py), decodifica la foto y llama al
// núcleo (cardScanCv.ts), que no depende del DOM.

// Las fotos grandes se reducen antes de pasarlas al núcleo: este trabaja a
// ~1600 px, así que más resolución solo gasta memoria.
const MAX_PHOTO_SIDE = 2400;
const OPENCV_WAIT_MS = 60_000;

export interface PhotoScan {
  /** Cartas por especie (id de carta), solo de las pilas identificadas. */
  counts: ScanCounts;
  /** Cartas contadas en pilas cuya especie no se pudo identificar. */
  unknownCards: number;
  /** Pilas encontradas en la foto. */
  stacks: number;
}

let openCvPromise: Promise<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
let assetsPromise: Promise<ScanAssets> | null = null;

// Mismo patrón que el README de @techstark/opencv-js, sin hacer `await` sobre
// el propio módulo (es "thenable") y esperando a que el WebAssembly esté listo.
function loadOpenCv() {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      const mod = await import('@techstark/opencv-js');
      const cv = (mod as any).default ?? mod; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (cv instanceof Promise) return await cv;
      const started = Date.now();
      while (!cv.Mat) {
        if (Date.now() - started > OPENCV_WAIT_MS) throw new Error('OpenCV.js no terminó de cargar');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return cv;
    })().catch((err) => {
      openCvPromise = null; // permite reintentar tras un fallo de red
      throw err;
    });
  }
  return openCvPromise;
}

function toRgba(source: CanvasImageSource, width: number, height: number): RgbaImage {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

async function loadAsset(url: string): Promise<RgbaImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo cargar ${url}`);
  const bitmap = await createImageBitmap(await response.blob());
  const image = toRgba(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return image;
}

function loadAssets(): Promise<ScanAssets> {
  if (!assetsPromise) {
    const base = `${import.meta.env.BASE_URL}scan/`;
    assetsPromise = (async () => {
      const wanted = new Set(SCAN_CARDS.map((c) => c.id));
      const index = (await (await fetch(`${base}refs/index.json`)).json()) as string[];
      const ids = index.filter((id) => wanted.has(id));
      const [bag, shield, ...refs] = await Promise.all([
        loadAsset(`${base}bag.png`),
        loadAsset(`${base}shield.png`),
        ...ids.map((id) => loadAsset(`${base}refs/${id}.jpg`)),
      ]);
      return { bag, shield, refs: refs.map((image, i) => ({ id: ids[i], image })) };
    })().catch((err) => {
      assetsPromise = null;
      throw err;
    });
  }
  return assetsPromise;
}

async function loadPhoto(file: File): Promise<RgbaImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
  const image = toRgba(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  bitmap.close();
  return image;
}

export async function scanPhoto(file: File, onProgress: (fraction: number) => void): Promise<PhotoScan> {
  // 0-20 %: carga del motor y de los recursos (solo la primera vez); 20-100 %: análisis.
  onProgress(0.02);
  const [cv, assets, photo] = await Promise.all([loadOpenCv(), loadAssets(), loadPhoto(file)]);
  onProgress(0.2);
  const result = await scanWithCv(cv, photo, assets, (f) => onProgress(0.2 + 0.8 * f));
  return { counts: result.counts, unknownCards: result.unknownCards, stacks: result.stacks.length };
}
