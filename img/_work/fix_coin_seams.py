"""Quita las costuras de una imagen de moneda alargada (monedaNAlargada.jpg) en la que el
animal se pego desde el original cuadrado (monedaN.jpg) con un halo borroso: localiza el
original dentro de la alargada (escala y posicion por correlacion), detecta la zona pegada
(donde ambas coinciden) y la vuelve a fundir con Poisson (gradientes del original, colores del
borde de la alargada), de modo que el halo desaparece sin saltos de tono.
Uso:
  /c/Python310/python img/_work/fix_coin_seams.py alargada.jpg original.jpg salida.jpg [banda_px]
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage, sparse
from scipy.signal import fftconvolve
from scipy.sparse.linalg import spsolve

src_e, src_o, dst = sys.argv[1:4]
BAND = int(sys.argv[4]) if len(sys.argv) > 4 else 8
E_img = Image.open(src_e).convert('RGB'); O_img = Image.open(src_o).convert('RGB')
E = np.asarray(E_img).astype(float); H, W, _ = E.shape
Eg = np.asarray(E_img.convert('L')).astype(float)

# 1) alineacion: plantilla = centro de la alargada; se busca escala y posicion en el original
ty0, ty1, tx0, tx1 = int(H * 0.3), int(H * 0.62), int(W * 0.18), int(W * 0.82)
tpl = Eg[ty0:ty1, tx0:tx1]; tpl = tpl - tpl.mean()
best = None
for s in np.arange(0.50, 0.86, 0.01):
    o = np.asarray(O_img.convert('L').resize((round(O_img.width * s), round(O_img.height * s)), Image.LANCZOS)).astype(float)
    if o.shape[0] < tpl.shape[0] or o.shape[1] < tpl.shape[1]: continue
    o0 = o - o.mean()
    corr = fftconvolve(o0, tpl[::-1, ::-1], mode='valid')
    loc = np.sqrt(np.maximum(fftconvolve(o0 ** 2, np.ones_like(tpl), mode='valid'), 1e-6)) * np.sqrt((tpl ** 2).sum())
    ncc = corr / loc; k = np.unravel_index(np.argmax(ncc), ncc.shape)
    if best is None or ncc[k] > best[0]: best = (ncc[k], s, k)
ncc, SCALE, (oy, ox) = best
DX, DY = tx0 - ox, ty0 - oy
print(f'alineacion: ncc {ncc:.3f}, escala {SCALE:.2f}, desplazamiento ({DX}, {DY})')

# 2) original escalado sobre la alargada; zona pegada = donde coinciden
size = (round(O_img.width * SCALE), round(O_img.height * SCALE))
Os = np.asarray(O_img.resize(size, Image.LANCZOS)).astype(float)
src = E.copy(); have = np.zeros((H, W), bool)
x0, y0 = max(0, DX), max(0, DY); x1, y1 = min(W, DX + size[0]), min(H, DY + size[1])
src[y0:y1, x0:x1] = Os[y0 - DY:y1 - DY, x0 - DX:x1 - DX]; have[y0:y1, x0:x1] = True
diff = ndimage.uniform_filter(np.where(have, np.abs(E - src).mean(-1), 255.0), 9)
same = ndimage.binary_opening(diff < 18, structure=np.ones((5, 5)))
lab, n = ndimage.label(same); sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
same = ndimage.binary_fill_holes(ndimage.binary_closing(lab == (np.argmax(sizes) + 1), structure=np.ones((9, 9))))
mask = ndimage.binary_dilation(same, iterations=BAND) & ndimage.binary_erosion(have, iterations=2)
print('zona pegada + banda:', int(mask.sum()), 'px')

# 3) Poisson: laplaciano del original dentro de la mascara, borde = alargada
idx = -np.ones((H, W), int); ys, xs = np.where(mask); n = len(ys); idx[ys, xs] = np.arange(n)
rows, cols, vals = [], [], []; b = np.zeros((n, 3))
for k, (y, x) in enumerate(zip(ys, xs)):
    rows.append(k); cols.append(k); vals.append(4.0)
    lap = 4 * src[y, x]
    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        yy, xx = y + dy, x + dx
        lap -= src[yy, xx]
        j = idx[yy, xx]
        if j >= 0: rows.append(k); cols.append(j); vals.append(-1.0)
        else: b[k] += E[yy, xx]
    b[k] += lap
A = sparse.csr_matrix((vals, (rows, cols)), shape=(n, n))
out = E.copy()
for c in range(3): out[ys, xs, c] = spsolve(A, b[:, c])
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst, quality=95); print('saved', dst)
