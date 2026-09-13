"""Compone una moneda con una plantilla que ya trae transparencia: la foto va detras,
cubriendo toda la zona transparente, y el marco opaco tapa sus bordes.
Uso:
  /c/Python310/python img/_work/compose_coin_alpha.py plantilla.png foto.jpg salida.png [pv]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_card as cc

tpl_path, photo_path, out_path = sys.argv[1:4]
pv = sys.argv[4] if len(sys.argv) > 4 else None

tpl = Image.open(tpl_path).convert('RGBA'); W, H = tpl.size
alpha = np.asarray(tpl)[..., 3]
# ventana = la zona transparente conectada del centro (las esquinas exteriores que
# removebg tambien dejo transparentes no cuentan: ahi la carta queda blanca)
lab0, _ = ndimage.label(alpha < 250)
win = ndimage.binary_fill_holes(lab0 == lab0[H // 2, W // 2])
ys, xs = np.where(win)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
pad = 3                                                    # la foto sobresale un poco bajo el marco
x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
bw, bh = x1 - x0, y1 - y0

photo = Image.open(photo_path).convert('RGB'); pw, ph = photo.size
aspect = bw / bh
if pw / ph > aspect:
    cw, ch = int(ph * aspect), ph; left, top = (pw - cw) // 2, 0
else:
    cw, ch = pw, int(pw / aspect); left, top = 0, (ph - ch) // 2
photo = photo.crop((left, top, left + cw, top + ch)).resize((bw, bh), Image.LANCZOS)

card = Image.new('RGB', (W, H), (255, 255, 255))
card.paste(photo, (x0, y0))
card.paste(tpl, (0, 0), tpl)                               # el marco tapa los bordes de la foto

if pv is not None:
    a = np.asarray(tpl.convert('RGB')).astype(int)
    beige = (a[..., 0] > 200) & (a[..., 1] > 185) & (a[..., 2] > 140) & (a[..., 0] - a[..., 2] > 20) & (alpha > 200)
    beige[:int(H * 0.72)] = False
    lab, n = ndimage.label(beige)
    sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    shield = lab == (np.argmax(sizes) + 1)
    sy, sx = np.where(shield); cx, cy = int(sx.mean()), int(sy.mean())
    f = ImageFont.truetype(cc.FONT_BOLD, round(cc.BADGE_NUMBER_SIZE * W / 615))
    cc.draw_centered(ImageDraw.Draw(card), (cx, cy), str(pv), f, fill=cc.PV_COLOR)

os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
card.save(out_path); print('saved', out_path, 'foto en', (x0, y0, x1, y1))
