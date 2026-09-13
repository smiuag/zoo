"""Reutiliza el marco de una carta de moneda ya montada (p. ej. intento_arreglado.png)
para componer otras monedas: se recorta el hueco de la imagen (ventana + zona de la tabla
y el pergamino), se conservan las hojas que asoman sobre la imagen, se limpian los numeros
de bolsa y escudo con la plantilla original y se pintan los nuevos.
Uso:
  /c/Python310/python img/_work/compose_coin_from_frame.py marco.png plantilla.png foto.jpg salida.png [coste] [pv] [zoom]
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

# hueco: ventana real de la plantilla + rectangulo del mismo ancho hasta el fondo del pergamino
window = region_from(T.min(-1) > 245, (250, W // 2))
beige = (T[..., 0] > 205) & (T[..., 2] > 150) & (T[..., 0] - T[..., 2] > 12) & (T[..., 0] - T[..., 2] < 80); beige[:560] = False
parch = ndimage.binary_fill_holes(ndimage.binary_closing(region_from(beige, (730, W // 2)), structure=np.ones((7, 7))))
wy, wx = np.where(window); py, _ = np.where(parch)
wx0, wx1, wy0, wy1, py1 = wx.min(), wx.max() + 1, wy.min(), wy.max() + 1, py.max() + 1
hole = Image.new('L', (W, H), 0)
ImageDraw.Draw(hole).rounded_rectangle((wx0, wy1 - 40, wx1 - 1, py1 - 1), radius=10, fill=255)
hole = (np.asarray(hole) > 0) | window

# hojas del marco que asoman sobre la imagen: se quedan por encima de la foto nueva
hsv = np.asarray(Image.fromarray(F.astype(np.uint8)).convert('HSV')).astype(float)
green = (hsv[..., 0] > 40) & (hsv[..., 0] < 125) & (hsv[..., 1] > 60)
lab, n = ndimage.label(green & hole)
sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
touch = np.zeros(n + 1, bool)
edge = green & hole & ~ndimage.binary_erosion(hole, iterations=3)          # componentes que tocan el borde del hueco
touch[np.unique(lab[edge])] = True
leaves = np.isin(lab, np.arange(1, n + 1)[touch[1:] & (sizes >= 40)])
leaves = ndimage.binary_dilation(leaves, iterations=2)
hole_soft = soft(hole, 0.6) * (1 - soft(leaves, 0.8))

# bolsa y escudo: interior limpio de la plantilla (sin los numeros del marco de origen)
frame = F.copy()
for (cx, cy) in (cc.COST_BADGE, cc.PV_BADGE):
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
if cost is not None: cc.draw_centered(draw, cc.COST_BADGE, str(cost), f, fill=cc.COST_COLOR)
if pv is not None: cc.draw_centered(draw, cc.PV_BADGE, str(pv), f, fill=cc.PV_COLOR)
os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
card.save(out_path); print('saved', out_path)
