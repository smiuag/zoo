"""Quita la huella central de las tres seguidas de cada barra lateral (filas 300-560),
rellenando con la veta de la propia barra. Uso:
  /c/Python310/python img/_work/remove_middle_paw.py entrada.png salida.png
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA'); W, H = im.size
rgba = np.asarray(im).astype(float); a = rgba[..., :3]
lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(float); h, s = hsv[..., 0], hsv[..., 1]
green = (h > 40) & (h < 125) & (s > 60)
out = a.copy(); rng = np.random.default_rng(3)
for side, (x0, x1) in {'L': (0, 68), 'R': (548, W)}.items():
    m = np.zeros((H, W), bool); m[300:560, x0:x1] = (lum[300:560, x0:x1] > 185) & (s[300:560, x0:x1] < 90)
    m = ndimage.binary_closing(m, structure=np.ones((5, 5)))
    lab, n = ndimage.label(m)
    paws = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) > 150: paws.append((int(ys.mean()), i, ys.min(), ys.max()))
    paws.sort()
    print(side, 'huellas en filas', [p[0] for p in paws])
    if len(paws) < 2: continue
    _, idx, y0, y1 = paws[1]                                   # la segunda: la del medio de las tres (la tercera, mas tenue, no siempre se detecta)
    mask = ndimage.binary_dilation(lab == idx, iterations=4) & ~green
    # madera de relleno: perfil por columna de las filas limpias justo encima y debajo
    rows = [y for y in range(max(0, y0 - 40), min(H, y1 + 40)) if not m[y, x0:x1].any()]
    prof = np.median(a[rows, x0:x1], axis=0)
    ys, xs = np.where(mask)
    fill = prof[xs - x0] + rng.normal(0, 2.5, (len(ys), 1))
    soft = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255.0
    tmp = out.copy(); tmp[ys, xs] = fill
    out = out * (1 - soft[..., None]) + tmp * soft[..., None]
res = np.concatenate([np.clip(out, 0, 255), rgba[..., 3:4]], -1).astype(np.uint8)
Image.fromarray(res, 'RGBA').save(dst); print('saved', dst)
