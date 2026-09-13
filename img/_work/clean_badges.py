"""Limpia el interior de la bolsa (arriba-izquierda) y del escudo (arriba-derecha)
de un marco: quita laurel, pliegues y manchas dejando piedra lisa para poner un numero.
Uso:
  /c/Python310/python img/_work/clean_badges.py entrada.png salida.png [--debug mask.png]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
debug = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == '--debug' else None
im = Image.open(src).convert('RGB')
T = np.asarray(im).astype(float); H, W, _ = T.shape
hsv = np.asarray(im.convert('HSV')).astype(float); s, v = hsv[..., 1], hsv[..., 2]

# Cada zona: semilla (y, x) y caja en la que debe quedar el relleno por inundacion.
# Se prueban umbrales de contorno de mas suave a mas duro hasta que la zona no se "escapa".
ZONES = {
    'bolsa':  {'seed': (125, 95),  'box': (60, 192, 24, 166),   'protect': [(168, 230, 0, 105)]},    # nidos abajo-izq
    'escudo': {'seed': (115, 612), 'box': (20, 206, 528, 696),  'protect': [(165, 240, 636, 718)]},  # nido abajo-dcha
}

def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

def blur(arr, r):
    k = np.exp(-0.5 * (np.arange(-3 * r, 3 * r + 1) / r) ** 2); k /= k.sum()
    return ndimage.convolve1d(ndimage.convolve1d(arr, k, axis=0, mode='nearest'), k, axis=1, mode='nearest')

def flood(seed, box, thr, dil):
    block = (v < thr) | (s >= 110)
    if dil: block = ndimage.binary_dilation(block, iterations=dil)
    lab, _ = ndimage.label(~block)
    comp = lab == lab[seed]
    ys, xs = np.where(comp)
    ok = ys.min() >= box[0] and ys.max() <= box[1] and xs.min() >= box[2] and xs.max() <= box[3]
    return comp, ok

mask = np.zeros((H, W), bool)
for name, z in ZONES.items():
    for thr, dil in [(120, 1), (135, 1), (150, 1), (135, 2), (150, 2), (165, 2)]:
        comp, ok = flood(z['seed'], z['box'], thr, dil)
        if ok: break
    else:
        raise SystemExit(f'{name}: no se pudo delimitar la zona')
    comp = ndimage.binary_fill_holes(comp)
    # forma completa: union con su espejo (eje medido en la mitad superior, sin decoraciones)
    ys, xs = np.where(comp)
    top = ys < ys.min() + 0.5 * (ys.max() - ys.min())
    cx = np.median([(xs[ys == r].min() + xs[ys == r].max()) / 2 for r in np.unique(ys[top])])
    ax = int(round(2 * cx))
    mirror = np.zeros_like(comp); xm = ax - xs; ok = (xm >= 0) & (xm < W)
    mirror[ys[ok], xm[ok]] = True
    shape = ndimage.binary_fill_holes(comp | mirror)
    shape = ndimage.binary_closing(shape, structure=np.ones((5, 5)))
    shape = ndimage.binary_erosion(shape, iterations=1)

    # Decoraciones que se solapan con la forma y hay que conservar: color saturado
    # (corales) y, en las cajas donde se apoyan los nidos, todo lo que no sea piedra lisa.
    hh = hsv[..., 0]
    colored = (s > 110) | (((hh < 6) | (hh > 40)) & (s > 60))
    def big_components(m, min_area):
        lab_c, n_c = ndimage.label(m)
        if n_c == 0: return m
        areas = ndimage.sum(np.ones_like(lab_c), lab_c, index=np.arange(1, n_c + 1))
        keep_ids = np.arange(1, n_c + 1)[areas >= min_area]
        return np.isin(lab_c, keep_ids)
    protect = big_components(colored, 60)                # motas sueltas del laurel no cuentan
    # nidos: textura con bordes marcados dentro de las cajas donde se apoyan
    lum = 0.299 * T[..., 0] + 0.587 * T[..., 1] + 0.114 * T[..., 2]
    gy, gx = np.gradient(blur(lum, 0.8))
    edges = np.hypot(gx, gy) > 22
    for (py0, py1, px0, px1) in z.get('protect', []):
        boxm = np.zeros((H, W), bool); boxm[py0:py1, px0:px1] = True
        tex = big_components(ndimage.binary_dilation(edges & boxm, iterations=2), 300)
        protect |= tex
    zone_mask = shape & ~ndimage.binary_dilation(protect, iterations=3)
    zone_mask = ndimage.binary_opening(zone_mask, structure=np.ones((3, 3)))
    ys, xs = np.where(zone_mask)
    print(f'{name}: umbral {thr}/{dil}, area {zone_mask.sum()}, y{ys.min()}-{ys.max()} x{xs.min()}-{xs.max()}')
    mask |= zone_mask

med = np.median(T[mask], axis=0)
plain = mask & (np.abs(T - med).max(-1) < 22)
plain = ndimage.binary_erosion(plain, iterations=2)
print('plain fraction', round(plain.sum() / mask.sum(), 2))

# relleno por convolucion normalizada en dos escalas
fill = np.zeros_like(T); wsum = np.zeros((H, W))
for r in (6, 14, 30):
    wgt = plain.astype(float) * (1.0 / r)
    num = np.stack([blur(T[..., c] * wgt, r) for c in range(3)], -1); den = blur(wgt, r)
    need = (wsum < 1e-3)
    fill[need] = (num / np.maximum(den, 1e-6)[..., None])[need]
    wsum = np.where(need & (den > 0.15 / r), den, wsum)
# grano suave para que no parezca plastico
rng = np.random.default_rng(7)
grain = blur(rng.normal(0, 3.0, (H, W)), 0.8)
fill = fill + grain[..., None]

m = soft(mask, 1.0)[..., None]
out = T * (1 - m) + fill * m
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
print('saved', dst)
if debug:
    ov = T.copy(); ov[mask] = ov[mask] * 0.5 + np.array([255, 0, 0]) * 0.5; ov[plain] = ov[plain] * 0.5 + np.array([0, 255, 0]) * 0.5
    Image.fromarray(np.clip(ov, 0, 255).astype(np.uint8)).save(debug)
