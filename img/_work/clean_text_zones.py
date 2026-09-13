"""Limpia la losa del titulo y el pergamino de un marco (aire/Tierra) copiando
la textura limpia de agua.jpg, conservando las decoraciones del marco destino.
Uso:
  /c/Python310/python img/_work/clean_text_zones.py agua.jpg destino.jpg out.png [aire|tierra]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src_clean, src_target, dst = sys.argv[1], sys.argv[2], sys.argv[3]
layout = (sys.argv[4] if len(sys.argv) > 4 else 'aire').lower()
A = np.asarray(Image.open(src_clean).convert('RGB')).astype(float)
T = np.asarray(Image.open(src_target).convert('RGB')).astype(float)
H, W, _ = T.shape

# Rectangulos (y0, y1, x0, x1): (en agua, en destino). Aire comparte geometria con agua;
# en Tierra la losa es mas baja (cara + bisel) y el pergamino esta 24 px mas arriba.
SLAB, BEVEL, PARCH = (584, 676, 97, 620), (676, 700, 97, 620), (704, 966, 63, 656)
LAYOUTS = {
    'aire':   [((584, 700, 97, 620), (584, 700, 97, 620)), (PARCH, PARCH)],
    'tierra': [(SLAB, (584, 642, 97, 620)), (BEVEL, (642, 674, 97, 620)), (PARCH, (680, 942, 63, 656))],
}
# Zonas de agua (coordenadas de agua) donde hay corales/esponjas que hay que borrar
SRC_DECO_ZONES = [
    (840, 966, 63, 656),    # banda inferior del pergamino (corales, algas)
    (584, 700, 585, 620),   # extremo derecho de la losa (esponja)
    (584, 700, 97, 118),    # extremo izquierdo de la losa (esponja rosa)
]

def hsv(arr):
    x = np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert('HSV')).astype(float)
    return x[..., 0], x[..., 1], x[..., 2]

def grow(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0

def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

def resize(arr, h, w):
    return np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(float)

def fill_clean(sub, deco):
    """Rellena los pixeles 'deco' con textura limpia de la misma imagen desplazada."""
    h, w_ = deco.shape
    out = sub.copy(); todo = deco.copy()
    ys, xs = np.mgrid[0:h, 0:w_]
    for dy, dx in [(-60, 0), (-120, 0), (-180, 0), (-240, 0), (60, 0), (120, 0),
                   (0, -80), (0, 80), (0, -160), (0, 160), (0, -240), (0, 240)]:
        yy, xx = ys + dy, xs + dx
        inside = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w_)
        yc, xc = np.clip(yy, 0, h - 1), np.clip(xx, 0, w_ - 1)
        ok = todo & inside & ~deco[yc, xc]
        out[ok] = sub[yc[ok], xc[ok]]; todo &= ~ok
    for y in np.where(todo.any(1))[0]:
        good = ~deco[y]
        out[y, todo[y]] = np.median(sub[y][good], 0) if good.any() else np.median(sub[~deco], 0)
    m = soft(deco, 2)[..., None]            # borde suave entre relleno y textura original
    return sub * (1 - m) + out * m

# 1) fuente limpia: agua sin corales/esponjas dentro de sus zonas conocidas
hA, sA, vA = hsv(A)
warmA = (hA >= 6) & (hA <= 50)
baseA = (((sA < 100) & warmA) | (sA < 40)) & (vA >= 140)
zone = np.zeros((H, W), bool)
for (y0, y1, x0, x1) in SRC_DECO_ZONES: zone[y0:y1, x0:x1] = True
decoA = grow(~baseA & zone, 4)

A_clean = np.zeros_like(T)
w = np.zeros((H, W))
for (sy0, sy1, sx0, sx1), (dy0, dy1, dx0, dx1) in LAYOUTS[layout]:
    fill = fill_clean(A[sy0:sy1, sx0:sx1], decoA[sy0:sy1, sx0:sx1])
    A_clean[dy0:dy1, dx0:dx1] = resize(fill, dy1 - dy0, dx1 - dx0)
    rect = np.zeros((H, W), bool); rect[dy0:dy1, dx0:dx1] = True
    w = np.maximum(w, soft(rect, 3))

# 2) decoraciones del destino a conservar: color saturado (incluidos verdes oliva),
#    muy oscuro, azulado (nubes/plumas), blancos pegados a lo anterior y, sobre todo,
#    cualquier cosa con bordes nitidos: las manchas del original son difusas y sin bordes.
h, s, v = hsv(T)
R, G, B = T[..., 0], T[..., 1], T[..., 2]
warm = (h >= 6) & (h <= 36)                          # beige/marron del pergamino y la piedra
colored = ((s > 60) & ~(warm & (s < 115))) | ((h > 36) & (h < 135) & (s > 40))
dark = v < 65
bluish = (B > R + 8) & (v > 150)
lum = 0.299 * R + 0.587 * G + 0.114 * B
lum = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float)
gy, gx = np.gradient(lum)
edges = np.hypot(gx, gy) > 18
core = colored | dark | bluish | edges
white = (v > 222) & (B >= R - 6)
keep = grow(core, 3) | (white & grow(core, 14))
# cerrar huecos interiores (interior de nubes, hojas claras) y dar margen
keep = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))) > 0
# descartar islas pequenas que solo son bordes de bloques JPEG (sin color ni oscuridad real)
from scipy import ndimage
lab, n = ndimage.label(keep)
strong = colored | dark | bluish
area = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
strong_n = ndimage.sum(strong, lab, index=np.arange(1, n + 1))
drop_ids = [i + 1 for i in range(n) if area[i] < 300 and strong_n[i] < 0.3 * area[i]]
if drop_ids:
    keep &= ~np.isin(lab, drop_ids)
keep_deco = grow(keep, 1)
w = w * (1 - soft(keep_deco, 1.5))

out = T * (1 - w[..., None]) + A_clean * w[..., None]
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
print('saved', dst, 'replaced px:', int((w > 0.5).sum()))
