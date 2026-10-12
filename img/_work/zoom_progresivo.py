"""Zoom progresivo: amplia la imagen alrededor de un punto (el animal) con factor k en el centro y
menos hacia los bordes. Separable en x e y; t = distancia normalizada al borde por ese lado (0 en el
centro, 1 en el borde), u(t) = distancia de origen.

Modo clásico (sin t0): u = t * (1/k + (1 - 1/k) * t**p); el zoom cae de forma continua desde el centro,
los bordes quedan fijos (u(1) = 1) y el animal se deforma un poco.
Modo uniforme (con t0): u = t/k hasta t0 (zoom UNIFORME: el animal no se deforma) y de t0 a 1 el fondo se
comprime hasta u(1) = umax (<= 1: con umax < 1 se pierde algo de borde a cambio de comprimir menos).

Uso: zoom_progresivo.py entrada salida cx cy k [p] [t0] [umax]
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out, cx, cy, k = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
p = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0
t0 = float(sys.argv[7]) if len(sys.argv) > 7 else None
umax = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0

im = np.asarray(Image.open(src).convert('RGB')).astype(float)
h, w, _ = im.shape


def u_of_t(t):
    if t0 is None:
        return t * (1 / k + (1 - 1 / k) * t ** p)
    u0 = t0 / k
    tt = np.clip((t - t0) / (1 - t0), 0, 1)
    return np.where(t <= t0, t / k, u0 + (umax - u0) * tt ** p)


def warp_axis(n, c):
    xs = np.arange(n, dtype=float)
    res = np.empty(n)
    for side, sel in (('neg', xs < c), ('pos', xs >= c)):
        edge = 0.0 if side == 'neg' else n - 1.0
        span = c - edge if side == 'neg' else edge - c
        t = np.abs(xs[sel] - c) / span
        res[sel] = c + np.sign(xs[sel] - c) * u_of_t(t) * span
    return res


mx = warp_axis(w, cx)
my = warp_axis(h, cy)
gy, gx = np.meshgrid(my, mx, indexing='ij')
outim = np.stack([ndimage.map_coordinates(im[..., ch], [gy, gx], order=3, mode='nearest') for ch in range(3)], -1)
Image.fromarray(np.clip(outim, 0, 255).astype(np.uint8)).save(out, quality=97)
print('saved', out, 'k=%.2f p=%.1f t0=%s umax=%.2f centro=(%d,%d)' % (k, p, t0, umax, cx, cy))
