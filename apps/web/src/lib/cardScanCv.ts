// Escáner de cartas por IMAGEN (OpenCV.js, todo en el dispositivo, sin servidores).
//
// Parte de una colocación obligatoria: las cartas de cada especie van apiladas
// y escalonadas de modo que se vea la franja superior de TODAS, con su bolsa de
// coste (arriba a la izquierda) y su escudo de PV (arriba a la derecha). Esos
// dos iconos son idénticos en todas las cartas, y la carta de delante se ve
// entera, así que:
//   1. Cada bolsa localizada = una carta (búsqueda de la plantilla de la bolsa
//      a varias escalas, filtrada por color y por la presencia del escudo).
//   2. Las bolsas alineadas y juntas forman una pila; la de más abajo es la
//      carta frontal.
//   3. La especie de la pila se decide comparando la ilustración de la carta
//      frontal con la de cada carta de referencia (correlación normalizada, tras
//      corregir la inclinación de la carta con la posición de su escudo).
// Cuenta de cartas = nº de bolsas de la pila; especie = la de la frontal.
//
// Probado con una foto real de ~35 cartas en 16 pilas (1 a 5 cartas): recuento e
// identificación correctos en todas. La foto puede estar girada 90°/180°/270°:
// se prueba cada orientación y se queda con la que más bolsas encuentra.
//
// El núcleo no toca el DOM (recibe imágenes RGBA y el módulo `cv`) para poder
// probarlo desde Node; cardScanVision.ts hace la parte del navegador.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Cv = any;
type Mat = any;

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface ScanAssets {
  /** Plantilla de la bolsa de coste (número borrado), a REF_SCALE de la carta de referencia. */
  bag: RgbaImage;
  /** Plantilla del escudo de PV (número borrado), a REF_SCALE. */
  shield: RgbaImage;
  /** Ilustración central de cada carta, a REF_SCALE. */
  refs: { id: string; image: RgbaImage }[];
}

export interface StackResult {
  /** Especie reconocida de la carta frontal, o null si no se pudo identificar con seguridad. */
  id: string | null;
  /** Nº de cartas de la pila (bolsas contadas). */
  count: number;
  /** Puntuación (0-1) de la mejor coincidencia de ilustración. */
  score: number;
  /** Segunda mejor especie (para depurar o sugerir). */
  runnerUp: string | null;
  /** Posición aproximada de la bolsa de la carta frontal en la imagen trabajada. */
  x: number;
  y: number;
}

export interface CvScanResult {
  stacks: StackResult[];
  /** Cartas por especie (solo pilas identificadas). */
  counts: Record<string, number>;
  /** Cartas contadas en pilas que no se pudieron identificar. */
  unknownCards: number;
  /** Giro (grados, sentido horario) aplicado a la foto para dejar las cartas derechas. */
  rotation: 0 | 90 | 180 | 270;
}

// --- constantes de geometría (píxeles de la carta de referencia, 823x1122) ---
const REF_SCALE = 0.5; // las plantillas y miniaturas se guardan a la mitad
const BAG_W = 136; // ancho de la plantilla de bolsa
const BAG_CENTER = [68, 61]; // centro de la bolsa dentro de su plantilla
const SHIELD_TL_OFFSET = [542, -12]; // esquina de la plantilla de escudo respecto a la de bolsa
const SHIELD_CENTER_OFFSET = [537, 2]; // centro del escudo respecto al centro de la bolsa
const ART_OFFSET = [37, 23]; // esquina de la ilustración respecto al centro de la bolsa

// --- parámetros de detección ---
const WORK_LONG = 1600; // lado largo de la imagen sobre la que se busca
const PROBE_LONG = 1000; // lado largo para decidir la orientación
const PROBE_SHIELD_SUPPORT = 0.5; // el escudo debe aparecer con esta correlación
const BAG_THRESHOLD = 0.6;
const PROBE_THRESHOLD = 0.62;
const MIN_TEMPLATE_PX = 8;
const ID_MIN_SCORE = 0.55; // por debajo, la pila se cuenta pero no se asigna especie

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Cand {
  score: number;
  cx: number;
  cy: number;
  s: number;
  x: number;
  y: number;
  support?: number;
}

function toMat(cv: Cv, img: RgbaImage): Mat {
  const rgba = new cv.Mat(img.height, img.width, cv.CV_8UC4);
  rgba.data.set(img.data);
  const rgb = new cv.Mat();
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
  rgba.delete();
  return rgb;
}

function resized(cv: Cv, src: Mat, factor: number): Mat {
  const dst = new cv.Mat();
  const w = Math.max(1, Math.round(src.cols * factor));
  const h = Math.max(1, Math.round(src.rows * factor));
  cv.resize(src, dst, new cv.Size(w, h), 0, 0, factor < 1 ? cv.INTER_AREA : cv.INTER_CUBIC);
  return dst;
}

function rotateMat(cv: Cv, src: Mat, degrees: 0 | 90 | 180 | 270): Mat {
  if (degrees === 0) return src.clone();
  const dst = new cv.Mat();
  if (degrees === 180) {
    cv.flip(src, dst, -1);
  } else {
    cv.transpose(src, dst);
    // 90° horario = transponer + espejo horizontal; 270° = transponer + espejo vertical.
    cv.flip(dst, dst, degrees === 90 ? 1 : 0);
  }
  return dst;
}

/** Máximo de la correlación normalizada de `tpl` dentro de `img` (y su posición). */
function bestMatch(cv: Cv, img: Mat, tpl: Mat): { score: number; x: number; y: number } {
  if (tpl.cols > img.cols || tpl.rows > img.rows) return { score: -1, x: 0, y: 0 };
  const res = new cv.Mat();
  cv.matchTemplate(img, tpl, res, cv.TM_CCOEFF_NORMED);
  const mm = cv.minMaxLoc(res);
  res.delete();
  return { score: Number.isFinite(mm.maxVal) ? mm.maxVal : -1, x: mm.maxLoc.x, y: mm.maxLoc.y };
}

function scalesBetween(min: number, max: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => min * Math.pow(max / min, i / Math.max(1, steps - 1)));
}

/** Candidatas a bolsa: picos de correlación a cada escala, con supresión de no-máximos. */
function detectBags(cv: Cv, rgb: Mat, bagTpl: Mat, scales: number[], threshold: number): Cand[] {
  const found: Cand[] = [];
  for (const s of scales) {
    const tpl = resized(cv, bagTpl, s / REF_SCALE);
    if (tpl.cols < MIN_TEMPLATE_PX || tpl.rows < MIN_TEMPLATE_PX || tpl.cols >= rgb.cols || tpl.rows >= rgb.rows) {
      tpl.delete();
      continue;
    }
    const res = new cv.Mat();
    cv.matchTemplate(rgb, tpl, res, cv.TM_CCOEFF_NORMED);
    const data: Float32Array = res.data32F;
    const w = res.cols;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (v > threshold) {
        const x = i % w;
        const y = (i - x) / w;
        found.push({ score: v, x, y, cx: x + BAG_CENTER[0] * s, cy: y + BAG_CENTER[1] * s, s });
      }
    }
    res.delete();
    tpl.delete();
  }
  found.sort((a, b) => b.score - a.score);
  const keep: Cand[] = [];
  for (const c of found.slice(0, 3000)) {
    const minDist = 0.7 * BAG_W * c.s;
    if (keep.every((k) => (c.cx - k.cx) ** 2 + (c.cy - k.cy) ** 2 > minDist * minDist)) keep.push(c);
  }
  return keep;
}

/** ¿Hay una bolsa de verdad? Centro crema y aro marrón (el mantel y los dibujos no cumplen ambas). */
function colorOk(hsv: Mat, cx: number, cy: number, s: number): boolean {
  const w = BAG_W * s;
  const x0 = Math.floor(cx - w);
  const x1 = Math.ceil(cx + w);
  const y0 = Math.floor(cy - w);
  const y1 = Math.ceil(cy + w);
  if (x0 < 0 || y0 < 0 || x1 >= hsv.cols || y1 >= hsv.rows) return false;
  const data: Uint8Array = hsv.data;
  const stride = hsv.cols * 3;
  let inner = 0;
  let innerCream = 0;
  let ring = 0;
  let ringBrown = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / w;
      const o = y * stride + x * 3;
      const h = data[o];
      const sat = data[o + 1];
      const val = data[o + 2];
      if (d < 0.38) {
        inner++;
        if (sat < 90 && val > 150) innerCream++;
      } else if (d > 0.5 && d < 0.75) {
        ring++;
        if (sat > 60 && val < 200 && h < 30) ringBrown++;
      }
    }
  }
  return inner > 0 && ring > 0 && innerCream / inner > 0.6 && ringBrown / ring > 0.25;
}

/** Máximo de `tpl` con su esquina en [x0..x1]x[y0..y1] (coordenadas de `rgb`). */
function localMatch(cv: Cv, rgb: Mat, tpl: Mat, x0: number, y0: number, x1: number, y1: number): number {
  const rx0 = Math.max(0, Math.floor(x0));
  const ry0 = Math.max(0, Math.floor(y0));
  const rx1 = Math.min(rgb.cols, Math.ceil(x1) + tpl.cols);
  const ry1 = Math.min(rgb.rows, Math.ceil(y1) + tpl.rows);
  if (rx1 - rx0 < tpl.cols || ry1 - ry0 < tpl.rows) return -1;
  const roi = rgb.roi(new cv.Rect(rx0, ry0, rx1 - rx0, ry1 - ry0));
  const best = bestMatch(cv, roi, tpl);
  roi.delete();
  return best.score;
}

function cluster(cards: Cand[]): Cand[][] {
  const sorted = [...cards].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  const parent = sorted.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const w = BAG_W * Math.max(sorted[i].s, sorted[j].s);
      if (Math.abs(sorted[i].cx - sorted[j].cx) < 0.5 * w && Math.abs(sorted[i].cy - sorted[j].cy) < 2.6 * w) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map<number, Cand[]>();
  sorted.forEach((c, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), c]);
  });
  return [...groups.values()];
}

/** Inclinación (grados) de la carta según dónde aparece su escudo respecto a su bolsa. */
function tiltOf(cv: Cv, rgb: Mat, shieldTpl: Mat, c: Cand): number {
  const s = c.s;
  const ts = resized(cv, shieldTpl, s / REF_SCALE);
  const ex = c.cx + SHIELD_CENTER_OFFSET[0] * s;
  const ey = c.cy + SHIELD_CENTER_OFFSET[1] * s;
  const r = Math.floor(0.9 * BAG_W * s) + 40;
  const x0 = Math.max(0, Math.floor(ex - r));
  const y0 = Math.max(0, Math.floor(ey - r));
  const x1 = Math.min(rgb.cols, Math.floor(ex + r));
  const y1 = Math.min(rgb.rows, Math.floor(ey + r));
  let angle = 0;
  if (x1 - x0 > ts.cols && y1 - y0 > ts.rows) {
    const roi = rgb.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
    const best = bestMatch(cv, roi, ts);
    roi.delete();
    if (best.score >= 0.35) {
      const scx = x0 + best.x + (ts.cols / 2);
      const scy = y0 + best.y + (ts.rows / 2);
      const measured = (Math.atan2(scy - c.cy, scx - c.cx) * 180) / Math.PI;
      const expected = (Math.atan2(SHIELD_CENTER_OFFSET[1], SHIELD_CENTER_OFFSET[0]) * 180) / Math.PI;
      angle = Math.max(-25, Math.min(25, measured - expected));
    }
  }
  ts.delete();
  return angle;
}

const COARSE_ANGLES = [-12, 0, 12];
const FINE_ANGLES = [-18, -12, -7, -3, 0, 3, 7, 12, 18];
const FINE_SIZES = [0.94, 1, 1.06];
const FINE_CANDIDATES = 8;

/** Compara la ilustración de la carta frontal con las de referencia. */
function identify(
  cv: Cv,
  rgb: Mat,
  shieldTpl: Mat,
  front: Cand,
  refs: { id: string; mat: Mat }[]
): { id: string | null; score: number; runnerUp: string | null } {
  const s = front.s;
  const est = tiltOf(cv, rgb, shieldTpl, front);
  // Recorte alrededor de la carta frontal (la ilustración y un margen).
  const x0 = Math.max(0, Math.floor(front.cx - 80 * s));
  const y0 = Math.max(0, Math.floor(front.cy - 80 * s));
  const x1 = Math.min(rgb.cols, Math.ceil(front.cx + 600 * s));
  const y1 = Math.min(rgb.rows, Math.ceil(front.cy + 480 * s));
  if (x1 - x0 < 10 || y1 - y0 < 10) return { id: null, score: 0, runnerUp: null };
  const roiView = rgb.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
  const roi = roiView.clone();
  roiView.delete();
  const pivot = new cv.Point(front.cx - x0, front.cy - y0);
  const artX = front.cx + ART_OFFSET[0] * s - x0;
  const artY = front.cy + ART_OFFSET[1] * s - y0;

  const templates = new Map<string, Mat>();
  const template = (ref: { id: string; mat: Mat }, k: number): Mat => {
    const key = `${ref.id}@${k}`;
    let t = templates.get(key);
    if (!t) {
      t = resized(cv, ref.mat, (s * k) / REF_SCALE);
      templates.set(key, t);
    }
    return t;
  };

  const scoreAt = (angle: number, ref: { id: string; mat: Mat }, k: number, rotated: Mat): number => {
    const t = template(ref, k);
    const m = Math.floor(0.06 * t.cols) + 6;
    const sx0 = Math.max(0, Math.floor(artX - m));
    const sy0 = Math.max(0, Math.floor(artY - m));
    const sx1 = Math.min(rotated.cols, Math.ceil(artX + t.cols + m));
    const sy1 = Math.min(rotated.rows, Math.ceil(artY + t.rows + m));
    if (sx1 - sx0 <= t.cols || sy1 - sy0 <= t.rows) return -1;
    const sub = rotated.roi(new cv.Rect(sx0, sy0, sx1 - sx0, sy1 - sy0));
    const best = bestMatch(cv, sub, t);
    sub.delete();
    void angle;
    return best.score;
  };

  const rotate = (angle: number): Mat => {
    const M = cv.getRotationMatrix2D(pivot, angle, 1);
    const dst = new cv.Mat();
    cv.warpAffine(roi, dst, M, new cv.Size(roi.cols, roi.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    M.delete();
    return dst;
  };

  const best = new Map<string, number>();
  const note = (id: string, v: number) => {
    if (v > (best.get(id) ?? -1)) best.set(id, v);
  };

  // Pasada gruesa: todas las referencias con unos pocos ángulos.
  for (const angle of new Set([...COARSE_ANGLES, Math.round(est)])) {
    const rotated = rotate(angle);
    for (const ref of refs) note(ref.id, scoreAt(angle, ref, 1, rotated));
    rotated.delete();
  }
  // Pasada fina: solo las mejores candidatas, con más ángulos y tamaños.
  const shortlist = [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, FINE_CANDIDATES)
    .map(([id]) => refs.find((r) => r.id === id)!);
  for (const angle of new Set([...FINE_ANGLES, Math.round(est)])) {
    const rotated = rotate(angle);
    for (const ref of shortlist) for (const k of FINE_SIZES) note(ref.id, scoreAt(angle, ref, k, rotated));
    rotated.delete();
  }

  templates.forEach((t) => t.delete());
  roi.delete();
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top) return { id: null, score: 0, runnerUp: null };
  return { id: top[1] >= ID_MIN_SCORE ? top[0] : null, score: top[1], runnerUp: second?.[0] ?? null };
}

/** Bolsas que además tienen su escudo a la distancia esperada: solo ocurre con las cartas derechas. */
function pairedBags(cv: Cv, rgb: Mat, hsv: Mat, shieldTpl: Mat, cands: Cand[]): Cand[] {
  const out: Cand[] = [];
  for (const c of cands) {
    if (!colorOk(hsv, c.cx, c.cy, c.s)) continue;
    const ts = resized(cv, shieldTpl, c.s / REF_SCALE);
    const reach = 42 * c.s;
    const sx = c.x + SHIELD_TL_OFFSET[0] * c.s;
    const sy = c.y + SHIELD_TL_OFFSET[1] * c.s;
    const support = localMatch(cv, rgb, ts, sx - reach, sy - reach, sx + reach, sy + reach);
    ts.delete();
    if (support >= PROBE_SHIELD_SUPPORT) out.push({ ...c, support });
  }
  return out;
}

/** Elige el giro con más parejas bolsa+escudo y estima la escala de las cartas (en unidades de la imagen de sondeo). */
function pickOrientation(cv: Cv, rgb: Mat, bagTpl: Mat, shieldTpl: Mat): { rotation: 0 | 90 | 180 | 270; scale: number } | null {
  const k = PROBE_LONG / Math.max(rgb.cols, rgb.rows);
  const small = resized(cv, rgb, Math.min(1, k));
  const scales = scalesBetween(0.08, 0.34, 9);
  let best: { rotation: 0 | 90 | 180 | 270; count: number; scale: number } | null = null;
  for (const rotation of [0, 90, 270, 180] as const) {
    const rotated = rotateMat(cv, small, rotation);
    const hsv = new cv.Mat();
    cv.cvtColor(rotated, hsv, cv.COLOR_RGB2HSV);
    const strongest = detectBags(cv, rotated, bagTpl, scales, PROBE_THRESHOLD).slice(0, 80);
    const ok = pairedBags(cv, rotated, hsv, shieldTpl, strongest);
    hsv.delete();
    rotated.delete();
    if (ok.length > 0 && (!best || ok.length > best.count)) {
      const top = [...ok].sort((a, b) => b.score - a.score).slice(0, 8);
      const scale = top.map((c) => c.s).sort((a, b) => a - b)[Math.floor(top.length / 2)];
      best = { rotation, count: ok.length, scale };
    }
  }
  small.delete();
  if (!best || best.count < 2) return null;
  // La escala de sondeo se pasa a la de trabajo.
  return { rotation: best.rotation, scale: best.scale * (WORK_LONG / PROBE_LONG) };
}

export async function scanWithCv(
  cv: Cv,
  image: RgbaImage,
  assets: ScanAssets,
  onProgress: (fraction: number) => void = () => {}
): Promise<CvScanResult> {
  const toDelete: Mat[] = [];
  const keep = <T extends Mat>(m: T): T => {
    toDelete.push(m);
    return m;
  };
  try {
    const bagTpl = keep(toMat(cv, assets.bag));
    const shieldTpl = keep(toMat(cv, assets.shield));
    const refs = assets.refs.map((r) => ({ id: r.id, mat: keep(toMat(cv, r.image)) }));

    const full = keep(toMat(cv, image));
    const k = WORK_LONG / Math.max(full.cols, full.rows);
    const work = keep(resized(cv, full, k));
    onProgress(0.03);
    await yieldToUi();

    const orientation = pickOrientation(cv, work, bagTpl, shieldTpl);
    onProgress(0.15);
    await yieldToUi();
    if (!orientation) return { stacks: [], counts: {}, unknownCards: 0, rotation: 0 };

    const rgb = keep(rotateMat(cv, work, orientation.rotation));
    const hsv = keep(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    // Búsqueda fina de bolsas alrededor de la escala estimada.
    const around = [0.8, 0.9, 1, 1.1, 1.25].map((f) => orientation.scale * f);
    const candidates = detectBags(cv, rgb, bagTpl, around, BAG_THRESHOLD);
    onProgress(0.4);
    await yieldToUi();

    const valid: Cand[] = [];
    for (const c of candidates) {
      if (!colorOk(hsv, c.cx, c.cy, c.s)) continue;
      const ts = resized(cv, shieldTpl, c.s / REF_SCALE);
      const reach = 42 * c.s;
      const sx = c.x + SHIELD_TL_OFFSET[0] * c.s;
      const sy = c.y + SHIELD_TL_OFFSET[1] * c.s;
      const support = localMatch(cv, rgb, ts, sx - reach, sy - reach, sx + reach, sy + reach);
      const own = localMatch(cv, rgb, ts, c.x - 3, c.y - 3, c.x + 3, c.y + 3);
      ts.delete();
      if (own > c.score - 0.02) continue; // es un escudo, no una bolsa
      valid.push({ ...c, support });
    }

    // Todas las cartas de una foto tienen casi el mismo tamaño.
    const top = [...valid].sort((a, b) => b.score - a.score).slice(0, 10);
    const dominant = top.length ? top.map((c) => c.s).sort((a, b) => a - b)[Math.floor(top.length / 2)] : 0;
    const sized = valid.filter((c) => c.s >= 0.8 * dominant && c.s <= 1.25 * dominant);

    const stacks = cluster(sized).filter((g) => g.length >= 2 || g.some((c) => (c.support ?? 0) >= 0.5));
    onProgress(0.5);
    await yieldToUi();

    const results: StackResult[] = [];
    for (let i = 0; i < stacks.length; i++) {
      const g = [...stacks[i]].sort((a, b) => a.cy - b.cy);
      const front = g[g.length - 1];
      const id = identify(cv, rgb, shieldTpl, front, refs);
      results.push({ id: id.id, count: g.length, score: id.score, runnerUp: id.runnerUp, x: front.cx, y: front.cy });
      onProgress(0.5 + (0.5 * (i + 1)) / stacks.length);
      await yieldToUi();
    }

    const counts: Record<string, number> = {};
    let unknownCards = 0;
    for (const r of results) {
      if (r.id) counts[r.id] = (counts[r.id] ?? 0) + r.count;
      else unknownCards += r.count;
    }
    onProgress(1);
    return { stacks: results, counts, unknownCards, rotation: orientation.rotation };
  } finally {
    toDelete.forEach((m) => m.delete());
  }
}
