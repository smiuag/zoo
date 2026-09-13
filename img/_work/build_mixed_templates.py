"""Crea las plantillas mixtas (mitad izquierda Tierra, mitad derecha agua o aire).
Como en Tierra la losa y el pergamino estan 24 px mas arriba, primero se construye
una Tierra con la geometria de agua (Tierra_geoagua) conservando sus plantas, y
despues se funden las mitades con una transicion estrecha en el centro.
Uso:
  /c/Python310/python img/_work/build_mixed_templates.py
"""
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

D = 'img/Nueva carpeta/'
A = np.asarray(Image.open(D + 'agua.jpg').convert('RGB')).astype(float)          # geometria de referencia
T = np.asarray(Image.open(D + 'Tierra.jpg').convert('RGB')).astype(float)        # Tierra original (con plantas)
R = np.asarray(Image.open(D + 'aire_limpio.png').convert('RGB')).astype(float)   # aire ya limpio (geometria agua)
H, W, _ = A.shape

def hsv(arr):
    x = np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).convert('HSV')).astype(float)
    return x[..., 0], x[..., 1], x[..., 2]
def grow(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0
def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

# ---------- 1) agua limpia en todo el bloque de texto (losa + pergamino + bordes) ----------
Y0, Y1, X0, X1 = 584, 966, 63, 656                       # bloque en coordenadas de agua
U = np.zeros((H, W), bool); U[Y0:Y1, X0:X1] = True
U[584:640, 63:97] = False; U[584:640, 620:656] = False    # piedra junto a la losa: se deja Tierra

hA, sA, vA = hsv(A)
baseA = ((((hA >= 6) & (hA <= 50)) & (sA < 100)) | (sA < 40)) & (vA >= 140)
zone = np.zeros((H, W), bool)
for (y0, y1, x0, x1) in [(840, 966, 63, 656), (584, 704, 585, 656), (584, 704, 63, 118)]:
    zone[y0:y1, x0:x1] = True
decoA = grow(~baseA & zone, 4)

def fill_clean(sub, deco):
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
    m = soft(deco, 2)[..., None]
    return sub * (1 - m) + out * m

A_clean = A.copy()
A_clean[Y0:Y1, X0:X1] = fill_clean(A[Y0:Y1, X0:X1], decoA[Y0:Y1, X0:X1])

# ---------- 2) decoraciones de Tierra dentro del bloque (sin sus contornos de losa/pergamino) ----------
h, s, v = hsv(T)
Rc, Gc, Bc = T[..., 0], T[..., 1], T[..., 2]
warm = (h >= 6) & (h <= 36)
colored = ((s > 60) & ~(warm & (s < 115))) | ((h > 36) & (h < 135) & (s > 40))
dark = v < 65
lum = 0.299 * Rc + 0.587 * Gc + 0.114 * Bc
lum = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float)
gy, gx = np.gradient(lum)
edges = np.hypot(gx, gy) > 18
core = colored | dark | edges
keep = grow(core, 3)
keep = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))) > 0
lab, n = ndimage.label(keep)
band = np.zeros((H, W), bool); band[636:684, 63:656] = True       # bisel/contorno de la losa de Tierra
strong = colored | (dark & ~band)                                   # las lineas oscuras de la losa no son decoracion
area = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
strong_n = ndimage.sum(strong, lab, index=np.arange(1, n + 1))
# componentes que solo son bordes (contornos de la losa/pergamino de Tierra, bloques JPEG) se descartan
drop = [i + 1 for i in range(n) if strong_n[i] < 0.3 * area[i]]
keep &= ~np.isin(lab, drop)
keep &= ~(band & ~grow(colored, 3))          # en la banda del bisel solo sobreviven las plantas
keep = grow(keep, 1)

m = soft(keep, 1.5)[..., None]
Tv2 = T.copy()
Tv2[U] = (A_clean * (1 - m) + T * m)[U]
Image.fromarray(np.clip(Tv2, 0, 255).astype(np.uint8)).save(D + 'Tierra_geoagua.png')

# ---------- 3) mezclas: mitad izquierda Tierra, mitad derecha agua / aire ----------
xc, half = W // 2, 14
wx = np.clip((np.arange(W) - (xc - half)) / (2.0 * half), 0, 1)
wx = wx * wx * (3 - 2 * wx)                               # suavizado
wx = wx[None, :, None]
# agua y aire ya comparten geometria: se funden directamente
for name, left, other in [('Tierra_agua', Tv2, A), ('Tierra_aire', Tv2, R), ('agua_aire', A, R)]:
    mix = left * (1 - wx) + other * wx
    Image.fromarray(np.clip(mix, 0, 255).astype(np.uint8)).save(D + name + '.png')
    print('saved', D + name + '.png')
