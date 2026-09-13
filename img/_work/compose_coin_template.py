"""Compone una carta de moneda con la plantilla 'template moneda' a tamaño completo
(ventana grande y escudo abajo): la ilustracion llena toda la ventana, el marco tapa
sus bordes con transparencia de subpixel (sin halo blanco) y una sombra interior suave
integra la union. El numero de PV va en el escudo.
Uso:
  /c/Python310/python img/_work/compose_coin_template.py plantilla.jpg foto.jpg salida.png [pv] [ancho_salida|-] [zoom] [desplazamiento_vertical]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose_card as cc

tpl_path, photo_path, out_path = sys.argv[1:4]
pv = sys.argv[4] if len(sys.argv) > 4 else None
out_w = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] != '-' else None
zoom = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0      # >1: recorta el borde de la foto y agranda el centro
vshift = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0    # -1..1: desplaza el recorte hacia arriba/abajo

tpl = Image.open(tpl_path).convert('RGB'); W, H = tpl.size
a = np.asarray(tpl).astype(float)

# 1) ventana: region blanca conectada del centro + bolsas blancas aisladas dentro de su caja
white = a.min(-1) > 235
lab, _ = ndimage.label(white)
win = ndimage.binary_fill_holes(lab == lab[H // 2, W // 2])
ys0, xs0 = np.where(win)
box = np.zeros_like(win); box[ys0.min():ys0.max() + 1, xs0.min():xs0.max() + 1] = True
win |= white & box
win = ndimage.binary_fill_holes(win)

# 2) transparencia de subpixel: en una banda de 4 px alrededor del borde de la ventana, lo
#    "blanco" de cada pixel es fondo, no marco -> alpha = 1 - blancura, y el color del marco
#    se recupera quitando esa parte de blanco (des-premultiplicar).
edge_band = ndimage.binary_dilation(win, iterations=4) & ~ndimage.binary_erosion(win, iterations=4)
lum = a.min(-1)
# color de referencia del marco junto a cada pixel del borde: el mas oscuro en 7 px (el
# contorno de la ventana es una linea oscura, y el JPG la difumina hacia el blanco)
ref = ndimage.minimum_filter(np.where(win, 255.0, lum), size=7)
alpha = np.where(win, 0.0, 1.0)
band_out = edge_band & ~win & (ref < 225)          # solo el lado del marco, y solo si hay contorno cerca
ab = np.clip((255.0 - lum[band_out]) / (255.0 - ref[band_out]), 0, 1)
alpha[band_out] = ab
frame = a.copy()
sel = band_out & (alpha > 0.02) & (alpha < 0.98)
frame[sel] = np.clip((a[sel] - 255.0 * (1 - alpha[sel])[:, None]) / alpha[sel][:, None], 0, 255)
alpha = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.4))).astype(float) / 255.0

# 3) foto: recorte centrado a la proporcion de la ventana, cubriendo su caja con margen
pad = 3
x0, y0 = max(0, xs0.min() - pad), max(0, ys0.min() - pad)
x1, y1 = min(W, xs0.max() + 1 + pad), min(H, ys0.max() + 1 + pad)
bw, bh = x1 - x0, y1 - y0
photo = Image.open(photo_path).convert('RGB'); pw, ph = photo.size
aspect = bw / bh
if pw / ph > aspect:
    cw, ch = int(ph * aspect), ph
else:
    cw, ch = pw, int(pw / aspect)
cw, ch = int(cw / zoom), int(ch / zoom)
left = (pw - cw) // 2
top = int((ph - ch) * (0.5 + 0.5 * vshift))
photo = photo.crop((left, top, left + cw, top + ch)).resize((bw, bh), Image.LANCZOS)
canvas = np.full((H, W, 3), 255.0); canvas[y0:y1, x0:x1] = np.asarray(photo).astype(float)

# 4) sombra interior del marco sobre la foto (el marco queda "por encima")
dist = ndimage.distance_transform_edt(win)
shadow = np.clip(1 - dist / 10.0, 0, 1) ** 1.6 * 0.28
canvas = canvas * (1 - shadow[..., None])

out = frame * alpha[..., None] + canvas * (1 - alpha[..., None])
card = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

# 5) escudo: numero de PV centrado en su interior beige
if pv is not None:
    hsv_t = np.asarray(tpl.convert('HSV')).astype(float)
    beige = (a[..., 0] > 195) & (a[..., 1] > 180) & (a[..., 2] > 140) & (a[..., 0] - a[..., 2] > 12) & (hsv_t[..., 1] < 90)
    boxm = np.zeros_like(beige); boxm[int(H * 0.74):int(H * 0.95), int(W * 0.33):int(W * 0.67)] = True
    beige &= boxm & ~win
    lab2, n2 = ndimage.label(beige)
    sizes = ndimage.sum(np.ones_like(lab2), lab2, index=np.arange(1, n2 + 1))
    shield = ndimage.binary_fill_holes(lab2 == (np.argmax(sizes) + 1))
    sy, sx = np.where(shield); cx, cy = int(sx.mean()), int(sy.mean())
    f = ImageFont.truetype(cc.FONT_BOLD, round(cc.BADGE_NUMBER_SIZE * W / 615))
    cc.draw_centered(ImageDraw.Draw(card), (cx, cy), str(pv), f, fill=cc.PV_COLOR)

if out_w and out_w != W:
    card = card.resize((out_w, round(H * out_w / W)), Image.LANCZOS)
os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
card.save(out_path); print('saved', out_path, card.size)
