"""Carta de moneda SIN titulo ni texto con el mismo marco que las cartas de animales:
la ventana se prolonga, con su mismo ancho, hasta el fondo del pergamino. Las barras
laterales se reconstruyen con un tramo limpio de la propia barra (madera, contorno y
huellas) para que no queden restos de las hojas de la tabla ni escalones, y la liana
inferior se vuelve a pintar encima. Bolsa (coste) y escudo (PV) como siempre.
Uso:
  /c/Python310/python img/_work/compose_coin_full.py plantilla.png foto.jpg salida.png [coste] [pv] [zoom] [desplazamiento_vertical]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_card as cc

tpl_path, photo_path, out_path = sys.argv[1:4]
cost = sys.argv[4] if len(sys.argv) > 4 else None
pv = sys.argv[5] if len(sys.argv) > 5 else None
zoom = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
vshift = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0

tpl = Image.open(tpl_path).convert('RGB'); W, H = tpl.size
a = np.asarray(tpl).astype(float)
hsv = np.asarray(tpl.convert('HSV')).astype(float); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

def region_from(mask, seed):
    lab, _ = ndimage.label(mask)
    return ndimage.binary_fill_holes(lab == lab[seed])
def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

# --- geometria: ventana real y pergamino ---
window = region_from(a.min(-1) > 245, (250, W // 2))
beige = (a[..., 0] > 205) & (a[..., 2] > 150) & (a[..., 0] - a[..., 2] > 12) & (a[..., 0] - a[..., 2] < 80)
beige[:560] = False
parch = ndimage.binary_fill_holes(ndimage.binary_closing(region_from(beige, (730, W // 2)), structure=np.ones((7, 7))))
wy, wx = np.where(window); py, px = np.where(parch)
wx0, wx1, wy0, wy1 = wx.min(), wx.max() + 1, wy.min(), wy.max() + 1     # ventana: x 68-548, hasta y 480
px0, px1, py1 = px.min(), px.max() + 1, py.max() + 1                     # pergamino: x 53-562, hasta y 832

# --- barras laterales: tramo limpio (sin verde) justo encima de las hojas de la tabla ---
green = (h > 40) & (h < 125) & (s > 60)
bars = np.zeros((H, W), bool); bars[:, :wx0] = True; bars[:, wx1:] = True
row_green = (green & bars).sum(1)
band_top = next(y for y in range(wy1 - 80, H) if row_green[y] > 8) - 4          # donde empiezan las hojas de la tabla
clean_top = max(y for y in range(0, band_top) if row_green[y] > 8) + 6            # ultima liana por encima
src_rows = np.arange(clean_top, band_top)
print(f'ventana x{wx0}-{wx1} y{wy0}-{wy1}; pergamino x{px0}-{px1} hasta y{py1}; tramo limpio de barra {clean_top}-{band_top}')

frame = a.copy()
rebuild_top, rebuild_bot = band_top, py1
band_bot = min(rebuild_top + 170, rebuild_bot)               # franja de las hojas grandes de la tabla
# 1) franja de las hojas: espejo (ligeramente estirado) del tramo limpio de justo encima ->
#    la union en band_top es continua y no hay patron repetido
n_src = len(src_rows)
n_dst = band_bot - rebuild_top
for i, y in enumerate(range(rebuild_top, band_bot)):
    src = rebuild_top - 1 - int(i * (n_src - 1) / max(n_dst - 1, 1))
    frame[y, :wx0] = a[src, :wx0]
    frame[y, wx1:] = a[src, wx1:]
# 2) parte baja: la barra original (mas estrecha) se ensancha hasta el ancho de la ventana
#    con su propia veta vertical (perfil por columna de la franja de arriba). La union con
#    la franja reflejada se funde a lo largo de 50 filas usando madera lisa por ambos lados.
def col_profile(x0, x1):
    return np.median(frame[rebuild_top:band_bot, x0:x1], axis=0)   # color por columna (veta vertical)
rng = np.random.default_rng(5)
mirrored = frame.copy()                                            # franja reflejada (valida hasta band_bot)
F0, F1 = band_bot, band_bot + 50                                   # fundido por debajo de la ultima huella reflejada
for (bx0, bx1, sx0, sx1) in [(0, wx0, px0 - 17, wx0), (wx1, W, wx1, px1 + 17)]:
    prof = col_profile(sx0, sx1)
    for y in range(F0, rebuild_bot):
        # lado "inferior": barra original (reflejada hacia arriba por encima de band_bot) + tira nueva
        ysrc = y if y >= band_bot else band_bot + (band_bot - y)
        lower = a[ysrc, bx0:bx1].copy()
        lower[sx0 - bx0:sx1 - bx0] = prof + rng.normal(0, 2.5, (sx1 - sx0, 1))
        if y < F1:
            tt = (y - F0) / float(F1 - F0); tt = tt * tt * (3 - 2 * tt)
            upper = mirrored[min(y, band_bot - 1), bx0:bx1]
            frame[y, bx0:bx1] = upper * (1 - tt) + lower * tt
        else:
            frame[y, bx0:bx1] = lower
# 3) la liana de la parte baja se vuelve a pintar encima (tambien donde asoma sobre la foto)
vine = green.copy()
vine[:band_bot] = False; vine[rebuild_bot:] = False
lab_v, nv = ndimage.label(vine)
sizes_v = ndimage.sum(np.ones_like(lab_v), lab_v, index=np.arange(1, nv + 1))
vine &= np.isin(lab_v, np.arange(1, nv + 1)[sizes_v >= 60])
vine = ndimage.binary_dilation(vine, iterations=1)
mv = soft(vine, 0.8)[..., None]
frame = frame * (1 - mv) + a * mv
vine_over = vine.copy()

# --- hueco: ventana + rectangulo del mismo ancho hasta el fondo del pergamino ---
hole = Image.new('L', (W, H), 0)
ImageDraw.Draw(hole).rounded_rectangle((wx0, wy1 - 40, wx1 - 1, py1 - 1), radius=10, fill=255)
hole = (np.asarray(hole) > 0) | window
hole_soft = soft(hole, 0.6)

# --- foto ---
bw, bh = wx1 - wx0, py1 - wy0
photo = Image.open(photo_path).convert('RGB'); pw, ph = photo.size
aspect = bw / bh
if pw / ph > aspect: cw, ch = int(ph * aspect), ph
else: cw, ch = pw, int(pw / aspect)
cw, ch = int(cw / zoom), int(ch / zoom)
left = (pw - cw) // 2; top = int((ph - ch) * (0.5 + 0.5 * vshift))
photo = photo.crop((left, top, left + cw, top + ch)).resize((bw, bh), Image.LANCZOS)
canvas = np.full((H, W, 3), 255.0); canvas[wy0:py1, wx0:wx1] = np.asarray(photo).astype(float)
# sombra interior suave del marco sobre la foto
dist = ndimage.distance_transform_edt(hole)
shadow = np.clip(1 - dist / 8.0, 0, 1) ** 1.6 * 0.22
canvas = canvas * (1 - shadow[..., None])

hole_soft = hole_soft * (1 - soft(vine_over, 0.8))    # la liana queda por encima de la foto
out = frame * (1 - hole_soft[..., None]) + canvas * hole_soft[..., None]
card = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

draw = ImageDraw.Draw(card)
f = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
if cost is not None: cc.draw_centered(draw, cc.COST_BADGE, str(cost), f, fill=cc.COST_COLOR)
if pv is not None: cc.draw_centered(draw, cc.PV_BADGE, str(pv), f, fill=cc.PV_COLOR)
os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
card.save(out_path); print('saved', out_path)
