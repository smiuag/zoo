"""Pone en blanco el borde exterior oscuro de una plantilla o carta: la linea oscura del
perimetro, el relleno marron plano de fuera de las esquinas redondeadas y la linea del
redondeo que lo delimita. El marco dibujado no se toca. Uso:
  /c/Python310/python img/_work/whiten_border.py entrada.png [salida.png]   (sin salida: sobrescribe)
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else src
im = Image.open(src); mode = im.mode
rgb = np.asarray(im.convert('RGB')).astype(int); H, W, _ = rgb.shape
lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

mask = np.zeros((H, W), bool)
# 1) perimetro: filas/columnas exteriores que son una linea oscura
for k in range(4):
    for sl in (np.s_[k, :], np.s_[H - 1 - k, :], np.s_[:, k], np.s_[:, W - 1 - k]):
        if np.median(lum[sl]) < 75: mask[sl] = True
# 2) esquinas: relleno PLANO (color casi constante) inundado desde cada esquina, y la linea
#    oscura del redondeo pegada a el
R = 80
for (cy, cx) in [(0, 0), (0, W - 1), (H - 1, 0), (H - 1, W - 1)]:
    y0, y1 = (0, R) if cy == 0 else (H - R, H); x0, x1 = (0, R) if cx == 0 else (W - R, W)
    box = rgb[y0:y1, x0:x1]
    sy, sx = (3 if cy == 0 else R - 4), (3 if cx == 0 else R - 4)
    ref = box[sy, sx]
    flat = np.abs(box - ref).max(-1) <= 8
    lab, _ = ndimage.label(flat)
    comp = lab == lab[sy, sx]
    if 50 < comp.sum() < R * R * 0.5:
        near = ndimage.binary_dilation(comp, iterations=3)
        curve = near & (lum[y0:y1, x0:x1] < 100)
        mask[y0:y1, x0:x1] |= comp | curve
mask = ndimage.binary_closing(mask, structure=np.ones((3, 3)))
out = rgb.copy(); out[mask] = 255
res = Image.fromarray(out.astype(np.uint8))
if mode == 'RGBA': res.putalpha(im.split()[3])
res.save(dst); print('saved', dst, 'px blanqueados:', int(mask.sum()))
