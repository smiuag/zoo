"""Arregla las costuras de img/moneda3Alargada.jpg (version guardada como
moneda3Alargada_original.jpg): el panda con la moneda se pego desde img/moneda3.jpg con un
halo borroso alrededor. Se vuelve a pegar desde el original, alineado (escala 0.62,
desplazamiento medido por correlacion), con una mascara que sigue la silueta del panda y la
moneda mas una banda de fondo original difuminada, que tapa el halo. Despues, dos zonas que
en el original ya venian desenfocadas (junto a la moneda y bajo la rama) se tapan con una
flor y unos brotes nitidos copiados de la propia ilustracion.
Uso:
  /c/Python310/python img/_work/fix_coin3_seams.py salida.jpg
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

out_path = sys.argv[1]
E = Image.open('img/moneda3Alargada_original.jpg').convert('RGB')
O = Image.open('img/moneda3.jpg').convert('RGB')
SCALE, DX, DY = 0.62, 26, 195

# ---- matte del panda + moneda en el original ----
o = np.asarray(O).astype(float)
hsv = np.asarray(O.convert('HSV')).astype(float); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
fur = (h >= 3) & (h <= 24) & (s > 70) & (v > 55)
dark = (h >= 3) & (h <= 28) & (s > 45) & (v >= 35) & (v < 150)
white = (s < 50) & (v > 185)
gold = (h >= 20) & (h <= 42) & (s > 45) & (v > 80)
black = v < 60
cand = fur | dark | white | gold | black
POLY = [(160, 560), (168, 330), (250, 300), (390, 290), (395, 175), (470, 140), (540, 175), (600, 195),
        (700, 180), (760, 150), (790, 205), (770, 330), (815, 380), (885, 405), (935, 475), (920, 565),
        (880, 625), (830, 690), (760, 715), (700, 730), (620, 760), (560, 790), (500, 790), (468, 748),
        (420, 722), (300, 738), (200, 705), (165, 640)]
pm = Image.new('L', O.size, 0); ImageDraw.Draw(pm).polygon(POLY, fill=255)
m = cand & (np.asarray(pm) > 0)
m = ndimage.binary_fill_holes(ndimage.binary_closing(m, structure=np.ones((7, 7))))
lab, n = ndimage.label(m); sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
m = ndimage.binary_fill_holes(ndimage.binary_opening(lab == (np.argmax(sizes) + 1), structure=np.ones((5, 5))))

# ---- pegado: silueta + banda de fondo original, con borde difuminado ----
BAND, FEATHER = 14, 12
size = (round(O.width * SCALE), round(O.height * SCALE))
Os = O.resize(size, Image.LANCZOS)
ms = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize(size, Image.LANCZOS)) > 127
ms = ndimage.binary_dilation(ms, iterations=BAND)
alpha = np.asarray(Image.fromarray((ms * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(FEATHER))).astype(float) / 255.0
alpha = np.clip((alpha - 0.35) / 0.65, 0, 1)
e = np.asarray(E).astype(float); H, W, _ = e.shape
canvas = e.copy(); a_full = np.zeros((H, W))
x0, y0 = DX, DY; x1, y1 = min(W, x0 + size[0]), min(H, y0 + size[1])
canvas[y0:y1, x0:x1] = np.asarray(Os).astype(float)[:y1 - y0, :x1 - x0]
a_full[y0:y1, x0:x1] = alpha[:y1 - y0, :x1 - x0]
out = e * (1 - a_full[..., None]) + canvas * a_full[..., None]
base = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

# ---- collage: elementos nitidos de la propia imagen sobre las dos zonas desenfocadas ----
def paste(box, dst, flip=False, scale=1.0, feather=5):
    global out
    el = base.crop(box)
    if flip: el = el.transpose(Image.FLIP_LEFT_RIGHT)
    if scale != 1.0: el = el.resize((round(el.width * scale), round(el.height * scale)), Image.LANCZOS)
    w, h = el.size
    mk = Image.new('L', (w, h), 0); ImageDraw.Draw(mk).ellipse((feather, feather, w - feather, h - feather), fill=255)
    mk = np.asarray(mk.filter(ImageFilter.GaussianBlur(feather))).astype(float) / 255.0
    dx, dy = dst; ex0, ey0 = max(0, dx), max(0, dy); ex1, ey1 = min(W, dx + w), min(H, dy + h)
    a = np.asarray(el).astype(float)[ey0 - dy:ey1 - dy, ex0 - dx:ex1 - dx]; mm = mk[ey0 - dy:ey1 - dy, ex0 - dx:ex1 - dx][..., None]
    out[ey0:ey1, ex0:ex1] = out[ey0:ey1, ex0:ex1] * (1 - mm) + a * mm
paste((140, 755, 200, 815), (118, 588), flip=True, scale=0.95, feather=6)   # flor rosa junto a la moneda
paste((425, 700, 470, 745), (160, 622), flip=True, scale=0.8, feather=5)    # par de hojas
paste((345, 735, 405, 815), (225, 772), flip=True, scale=0.75, feather=6)   # brotes bajo la rama
paste((425, 700, 470, 745), (295, 762), flip=True, scale=0.9, feather=5)
paste((425, 700, 470, 745), (385, 748), flip=False, scale=0.85, feather=5)
paste((345, 735, 405, 815), (468, 712), flip=False, scale=0.7, feather=6)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(out_path, quality=95); print('saved', out_path)
