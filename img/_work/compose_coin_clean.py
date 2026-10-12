"""Monta una carta de moneda sobre el marco LIMPIO img/templates/pruebas/candidata_monedas/fondomoneda.png
(2026-10-12; interior blanco, sin ilustracion dentro). Variante de compose_coin_from_frame.py: el hueco es
la region blanca del propio marco. Reutiliza el marco de una carta de moneda ya montada (historico:
para componer otras monedas: se recorta el hueco de la imagen (ventana + zona de la tabla
y el pergamino), se conservan las hojas que asoman sobre la imagen, se limpian los numeros
de bolsa y escudo con la plantilla original y se pintan los nuevos.
Uso:
  /c/Python310/python img/_work/compose_coin_clean.py marco_limpio.png plantilla.png foto.jpg salida.png [coste] [pv] [zoom]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_card as cc

frame_path, tpl_path, photo_path, out_path = sys.argv[1:5]
cost = sys.argv[5] if len(sys.argv) > 5 else None
pv = sys.argv[6] if len(sys.argv) > 6 else None
zoom = float(sys.argv[7]) if len(sys.argv) > 7 else 1.3

F = np.asarray(Image.open(frame_path).convert('RGB')).astype(float)
T = np.asarray(Image.open(tpl_path).convert('RGB')).astype(float)
H, W, _ = F.shape

def region_from(mask, seed):
    lab, _ = ndimage.label(mask)
    return ndimage.binary_fill_holes(lab == lab[seed])
def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

# hueco: con un marco LIMPIO (fondomoneda.png: interior blanco), la region blanca conexa que
# contiene el centro de la carta, con los agujeros rellenos. Nada del marco se pega sobre la foto.
hole = region_from(F.min(-1) > 245, (H // 2, W // 2))
hole_soft = soft(hole, 0.6)
hy, hx = np.where(hole); wx0, wx1, wy0, py1 = hx.min(), hx.max() + 1, hy.min(), hy.max() + 1

# bolsa y escudo: interior limpio de la plantilla (sin los numeros del marco de origen)
# anclas de bolsa/escudo en las coordenadas de ESTE marco (cc las da en su lienzo con sangrado)
off = (cc.CANVAS_W - W) // 2 if hasattr(cc, 'CANVAS_W') else 0
COST_PT = (cc.COST_BADGE[0] - off, cc.COST_BADGE[1] - off)
PV_PT = (cc.PV_BADGE[0] - off, cc.PV_BADGE[1] - off)
frame = F.copy()
for (cx, cy) in (COST_PT, PV_PT):
    yy, xx = np.mgrid[0:H, 0:W]
    disk = ((yy - cy) ** 2 + (xx - cx) ** 2) <= 34 ** 2
    m = soft(disk, 1.0)[..., None]
    frame = frame * (1 - m) + T * m

# foto
bw, bh = wx1 - wx0, py1 - wy0
photo = Image.open(photo_path).convert('RGB'); pw, ph = photo.size
aspect = bw / bh
cw, ch = (int(ph * aspect), ph) if pw / ph > aspect else (pw, int(pw / aspect))
cw, ch = int(cw / zoom), int(ch / zoom)
left, top = (pw - cw) // 2, (ph - ch) // 2
photo = photo.crop((left, top, left + cw, top + ch)).resize((bw, bh), Image.LANCZOS)
canvas = np.full((H, W, 3), 255.0); canvas[wy0:py1, wx0:wx1] = np.asarray(photo).astype(float)
dist = ndimage.distance_transform_edt(hole)
canvas = canvas * (1 - (np.clip(1 - dist / 8.0, 0, 1) ** 1.6 * 0.22)[..., None])

out = frame * (1 - hole_soft[..., None]) + canvas * hole_soft[..., None]
card = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
draw = ImageDraw.Draw(card)
f = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
if cost is not None: cc.draw_centered(draw, COST_PT, str(cost), f, fill=cc.COST_COLOR)
if pv is not None: cc.draw_centered(draw, PV_PT, str(pv), f, fill=cc.PV_COLOR)
os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
card.save(out_path); print('saved', out_path)
