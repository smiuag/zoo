"""Genera una textura de pergamino como la del dorso de las cartas (img/cards/_back.png)
pero SIN la cenefa de flores ni el emblema, para usarla de fondo en el reglamento
(build_instrucciones.py --fondo).

Rellenar los huecos de los dibujos difuminando el pergamino de alrededor se probó y no
sirve: el emblema es tan grande que en el centro quedaba una mancha lisa. En su lugar se
hace una síntesis por parches: se buscan en el dorso todas las ventanas que son SOLO
pergamino, y la textura nueva se compone con parches elegidos al azar de entre ellas,
solapados a la mitad y fundidos con una ventana suave. Como fundir varios parches
promedia y apaga las manchas, al final se devuelve el contraste original.

Uso:  /c/Python310/python img/_work/build_fondo_pergamino.py        ->  img/fondo_pergamino.jpg (una página A6)
      /c/Python310/python img/_work/build_fondo_pergamino.py a4     ->  img/fondo_pergamino_a4.jpg (folio entero,
      sin bordes tostados: lo usa el librillo con pergamino hasta el borde)
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "cards", "_back.png")
SHEET = "a4" in sys.argv[1:]
OUT = os.path.join(HERE, "..", "fondo_pergamino_a4.jpg" if SHEET else "fondo_pergamino.jpg")
OUT_W, OUT_H = (2480, 3508) if SHEET else (1240, 1748)          # A4 o A6 a 300 ppp
PATCH = 112
STEP = PATCH // 2

a = np.asarray(Image.open(SRC).convert("RGB")).astype(float)
H, W, _ = a.shape
base = np.median(a.reshape(-1, 3), axis=0)
dist = np.sqrt(((a - base) ** 2).sum(-1))
sat = a.max(-1) - a.min(-1)
clean = (dist < 34) & (sat < 75)
clean = ndimage.binary_erosion(clean, iterations=3)

# ventanas PATCH x PATCH totalmente limpias (suma con imagen integral)
ii = np.pad(clean.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
full = ii[PATCH:, PATCH:] - ii[:-PATCH, PATCH:] - ii[PATCH:, :-PATCH] + ii[:-PATCH, :-PATCH]
ys, xs = np.where(full >= PATCH * PATCH * 0.995)
print("parches limpios disponibles:", len(ys))
if len(ys) < 50:
    raise SystemExit("muy pocos parches limpios: revisar umbrales")

clean_px = a[clean]
mean = clean_px.mean(0)
std_src = clean_px.std(0)

rng = np.random.default_rng(11)
win1 = np.hanning(PATCH + 2)[1:-1]
win = np.outer(win1, win1)[..., None]
acc = np.zeros((OUT_H + 2 * PATCH, OUT_W + 2 * PATCH, 3))
wsum = np.zeros((OUT_H + 2 * PATCH, OUT_W + 2 * PATCH, 1))
for oy in range(0, OUT_H + STEP, STEP):
    for ox in range(0, OUT_W + STEP, STEP):
        k = rng.integers(len(ys))
        p = a[ys[k]:ys[k] + PATCH, xs[k]:xs[k] + PATCH]
        if rng.random() < 0.5:
            p = p[:, ::-1]
        if rng.random() < 0.5:
            p = p[::-1]
        # posición con algo de azar: sin esto los parches caen en rejilla y se nota el patrón
        jy = int(np.clip(oy + rng.integers(-STEP // 2, STEP // 2 + 1), 0, OUT_H + PATCH))
        jx = int(np.clip(ox + rng.integers(-STEP // 2, STEP // 2 + 1), 0, OUT_W + PATCH))
        acc[jy:jy + PATCH, jx:jx + PATCH] += p * win
        wsum[jy:jy + PATCH, jx:jx + PATCH] += win
out = (acc / np.maximum(wsum, 1e-6))[STEP:STEP + OUT_H, STEP:STEP + OUT_W]

# devolver el contraste que se pierde al promediar parches
std_out = out.reshape(-1, 3).std(0)
out = mean + (out - out.reshape(-1, 3).mean(0)) * (std_src / np.maximum(std_out, 1e-6)) * 0.9
# manchas grandes y bordes algo más tostados, como en el dorso original
big = ndimage.gaussian_filter(rng.normal(0, 1, (OUT_H, OUT_W)), 140)
big = big / np.abs(big).max() * 5.0
yy, xx = np.mgrid[0:OUT_H, 0:OUT_W]
edge = np.minimum(np.minimum(xx, OUT_W - 1 - xx) / (OUT_W * 0.12), np.minimum(yy, OUT_H - 1 - yy) / (OUT_H * 0.09))
vig = (0.0 if SHEET else -7.0) * np.clip(1 - edge, 0, 1) ** 2
out = out + (big + vig)[..., None] * np.array([1.0, 1.05, 1.35])
out = np.clip(out, 0, 255).astype(np.uint8)
Image.fromarray(out).save(OUT, quality=88)
print("saved", os.path.abspath(OUT), out.shape[:2], "tono medio", mean.round())
