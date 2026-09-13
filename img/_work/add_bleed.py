"""Anade un sangrado (margen de corte) alrededor de una carta o plantilla, del color de la
banda oscura de su borde. La carta mide 63 mm de ancho -> 615 px = 63 mm, asi que 1 cm son
unos 98 px (se escala con el ancho de la imagen).
Uso:
  /c/Python310/python img/_work/add_bleed.py entrada.png salida.png [mm]
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
mm = float(sys.argv[3]) if len(sys.argv) > 3 else 10.0
im = Image.open(src).convert('RGB'); W, H = im.size
px_per_mm = W / 63.0
m = int(round(mm * px_per_mm))
rgb = np.asarray(im).astype(float)
b0, b1 = int(round(3 * W / 615)), int(round(9 * W / 615))
band = np.concatenate([rgb[b0:b1, W // 4:3 * W // 4].reshape(-1, 3), rgb[H - b1:H - b0, W // 4:3 * W // 4].reshape(-1, 3),
                       rgb[H // 4:3 * H // 4, b0:b1].reshape(-1, 3), rgb[H // 4:3 * H // 4, W - b1:W - b0].reshape(-1, 3)])
fill = tuple(int(round(c)) for c in np.median(band, axis=0))
out = Image.new('RGB', (W + 2 * m, H + 2 * m), fill)
out.paste(im, (m, m))
out.save(dst); print('saved', dst, out.size, 'margen px', m, 'color', fill)
