"""Platino: conserva la escena central de moneda5Alargada (perezoso, moneda y su rama) y toma
el entorno de moneda3Alargada (fondo del panda), fundiendo la zona central con Poisson para
que no haya saltos de tono en la union. Uso:
  /c/Python310/python img/_work/build_coin5_scene.py salida.jpg
"""
import sys
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage, sparse
from scipy.sparse.linalg import spsolve

out_path = sys.argv[1]
FG = np.asarray(Image.open('img/moneda5Alargada.jpg').convert('RGB')).astype(float); H, W, _ = FG.shape
BG = np.asarray(Image.open('img/moneda3Alargada.jpg').convert('RGB').resize((W, H), Image.LANCZOS)).astype(float)
cm = Image.new('L', (W, H), 0); ImageDraw.Draw(cm).rounded_rectangle((115, 235, 575, 735), radius=120, fill=255)
mask = np.asarray(cm) > 0
mask[:2] = mask[-2:] = False; mask[:, :2] = mask[:, -2:] = False
# Poisson: laplaciano de la escena del perezoso dentro de la mascara, borde = fondo del panda
idx = -np.ones((H, W), int); ys, xs = np.where(mask); n = len(ys); idx[ys, xs] = np.arange(n)
rows, cols, vals = [], [], []; b = np.zeros((n, 3))
for k, (y, x) in enumerate(zip(ys, xs)):
    rows.append(k); cols.append(k); vals.append(4.0)
    lap = 4 * FG[y, x]
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        yy, xx = y + dy, x + dx
        lap -= FG[yy, xx]
        j = idx[yy, xx]
        if j >= 0: rows.append(k); cols.append(j); vals.append(-1.0)
        else: b[k] += BG[yy, xx]
    b[k] += lap
A = sparse.csr_matrix((vals, (rows, cols)), shape=(n, n))
out = BG.copy()
for c in range(3): out[ys, xs, c] = spsolve(A, b[:, c])
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(out_path, quality=95); print('saved', out_path)
