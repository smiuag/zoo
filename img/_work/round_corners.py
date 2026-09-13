"""Deja en blanco todo lo que queda fuera de un rectangulo redondeado exacto (formula), con
borde antialiseado. Medido sobre template3.png: la madera del marco empieza a INSET px del
borde de la imagen y sus esquinas son arcos de radio R (ambos escalan con el ancho).
Lo de fuera se rellena con el color de la banda oscura del marco (mediana de la franja de
3 a 9 px del borde), de modo que el borde queda uniforme hasta las esquinas. Con la variable
de entorno RELLENO=blanco se rellena de blanco.
Uso:
  /c/Python310/python img/_work/round_corners.py entrada.png [salida.png] [inset] [radio]
"""
import os
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]; dst = sys.argv[2] if len(sys.argv) > 2 else src
im = Image.open(src); mode = im.mode
rgb = np.asarray(im.convert('RGB')).astype(float); H, W, _ = rgb.shape
scale = W / 615.0
inset = float(sys.argv[3]) if len(sys.argv) > 3 else 12.5 * scale
radius = float(sys.argv[4]) if len(sys.argv) > 4 else 38.0 * scale

yy, xx = np.mgrid[0:H, 0:W].astype(float) + 0.5
# distancia con signo al rectangulo redondeado (negativa dentro)
x0, y0, x1, y1 = inset, inset, W - inset, H - inset
qx = np.maximum(np.maximum(x0 + radius - xx, xx - (x1 - radius)), 0)
qy = np.maximum(np.maximum(y0 + radius - yy, yy - (y1 - radius)), 0)
d_out = np.sqrt(qx * qx + qy * qy) - radius                     # >0 fuera del redondeo
inside_rect = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
d = np.where(inside_rect, d_out, np.maximum(d_out, 1.0))
alpha = np.clip(0.5 - d, 0, 1)                                  # 1 dentro, 0 fuera, 1 px de antialias
if os.environ.get('RELLENO', 'banda') == 'blanco':
    fill = np.array([255.0, 255.0, 255.0])
else:
    b0, b1 = int(round(3 * scale)), int(round(9 * scale))
    band = np.concatenate([rgb[b0:b1, W // 4:3 * W // 4].reshape(-1, 3), rgb[H - b1:H - b0, W // 4:3 * W // 4].reshape(-1, 3),
                           rgb[H // 4:3 * H // 4, b0:b1].reshape(-1, 3), rgb[H // 4:3 * H // 4, W - b1:W - b0].reshape(-1, 3)])
    fill = np.median(band, axis=0)
out = rgb * alpha[..., None] + fill[None, None, :] * (1 - alpha[..., None])
res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
if mode == 'RGBA': res.putalpha(im.split()[3])
res.save(dst); print('saved', dst, f'inset={inset:.1f} radio={radius:.1f}')
