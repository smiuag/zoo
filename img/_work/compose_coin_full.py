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
lianas = len(sys.argv) > 8 and sys.argv[8] == 'lianas'   # plantas por los laterales de la imagen

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
LIANA = {}
if lianas:
    # Por cada lado: la liana inferior se prolonga hacia arriba reflejandola sobre si misma en una
    # fila donde el tallo es vertical (asi el tallo sigue recto, sin escalon) y se remata con una
    # de sus propias hojas para que no termine en un corte.
    for side, (x0, x1) in {'L': (0, wx0 + 100), 'R': (wx1 - 100, W)}.items():
        rows = [y for y in range(band_bot, rebuild_bot) if vine[y, x0:x1].sum() >= 3]
        if not rows: continue
        def ext(y):
            xs_ = np.where(vine[y, x0:x1])[0]; return (xs_.min() + x0, xs_.max() + x0) if len(xs_) else None
        def width(y):
            e = ext(y); return (e[1] - e[0]) if e else 0
        def cx(y):
            e = ext(y); return (e[0] + e[1]) / 2 if e else None
        corner = next((y for y in rows if width(y) > 60), rebuild_bot)          # hojas grandes de la esquina
        # fila de espejo: tallo solo y vertical en las 30 filas siguientes
        m = None
        for y in rows:
            if y + 30 >= corner: break
            seg = [cx(yy) for yy in range(y, y + 30)]
            if all(c is not None for c in seg) and all(width(yy) <= 14 for yy in range(y, y + 30)) and max(seg) - min(seg) <= 3:
                m = y; break
        if m is None: continue
        # fin de la copia: ultima fila con solo tallo antes de la esquina (sin cortar hojas)
        src_end = max((y for y in range(m + 60, corner - 3) if all(width(yy) <= 14 for yy in range(y - 8, y + 1))), default=None)
        if src_end is None: continue
        # hoja para rematar: primera hoja completa (ancho >= 18) entre m y la esquina
        leaf = None
        y = m
        while y < corner - 3:
            if width(y) >= 18:
                y2 = y
                while y2 < corner - 3 and width(y2) >= 16: y2 += 1
                if y2 - y >= 10: leaf = (y - 2, y2 + 2); break
                y = y2
            y += 1
        if leaf is not None and leaf[1] >= corner - 3: leaf = None                 # el racimo de la esquina no vale
        LIANA[side] = dict(m=m, src_end=src_end, leaf=leaf, x0=x0, x1=x1)
        vine[:m, x0:x1] = False                                                 # la liana empieza en el espejo
        # el tallo original que la barra copiada aun lleva por encima del espejo se tapa con madera
        bx0, bx1 = (0, wx0) if side == 'L' else (wx1, W)
        gm = ndimage.binary_dilation(green[band_bot:m, bx0:bx1], iterations=3)
        if gm.any():
            prof = np.median(frame[rebuild_top:band_bot, bx0:bx1], axis=0)
            fill = np.broadcast_to(prof[None, :, :], (m - band_bot, bx1 - bx0, 3)) + rng.normal(0, 2.5, (m - band_bot, bx1 - bx0, 1))
            m_ = soft(gm, 1.0)[..., None]
            frame[band_bot:m, bx0:bx1] = frame[band_bot:m, bx0:bx1] * (1 - m_) + fill * m_
        print(f'liana {side}: espejo en y={m}, copia hasta {src_end} (-> y={2*m-src_end}), hoja {leaf}')
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

# --- lianas laterales: copia volteada de la liana superior de cada barra, colocada de modo
#     que su nacimiento empalme con el extremo cortado de la liana inferior ---
if lianas:
    hsv_f = np.asarray(Image.fromarray(np.clip(frame, 0, 255).astype(np.uint8)).convert('HSV')).astype(float)
    vine_src = ndimage.binary_dilation(green, iterations=2)
    paw = (hsv_f[..., 2] > 175) & (hsv_f[..., 1] < 80) & ~vine_src          # los brillos claros del tallo no son huellas
    for side, Lz in LIANA.items():
        m, src_end, leaf, x0, x1 = Lz['m'], Lz['src_end'], Lz['leaf'], Lz['x0'], Lz['x1']
        bx0, bx1 = (0, wx0) if side == 'L' else (wx1, W)
        y_top = 2 * m - src_end
        # huellas de la barra en las filas que cubrira la liana (con margen por encima de la punta)
        y_a = max(0, y_top - 110)
        prof = np.median(frame[rebuild_top:band_bot, bx0:bx1], axis=0)
        # huella = claramente mas clara que la madera de su columna (y no parte de la liana)
        lum_f = 0.299 * frame[y_a:m + 10, bx0:bx1, 0] + 0.587 * frame[y_a:m + 10, bx0:bx1, 1] + 0.114 * frame[y_a:m + 10, bx0:bx1, 2]
        lum_p = 0.299 * prof[:, 0] + 0.587 * prof[:, 1] + 0.114 * prof[:, 2]
        # liana tal como va a quedar (original por debajo del espejo + copia reflejada por encima)
        vine_now = np.zeros((H, W), bool); vine_now[m:] = vine[m:]
        for sy in range(m + 1, src_end + 1): vine_now[2 * m - sy] = vine[sy]
        vine_now = ndimage.binary_dilation(vine_now, iterations=2)
        pw_ = (((lum_f - lum_p[None, :]) > 22) | (lum_f > 206)) & ~vine_now[y_a:m + 10, bx0:bx1]
        if pw_.any():
            pw_ = ndimage.binary_dilation(pw_, iterations=4)
            fill = np.broadcast_to(prof[None, :, :], (m + 10 - y_a, bx1 - bx0, 3)) + rng.normal(0, 2.5, (m + 10 - y_a, bx1 - bx0, 1))
            m_ = soft(pw_, 1.0)[..., None]
            out[y_a:m + 10, bx0:bx1] = out[y_a:m + 10, bx0:bx1] * (1 - m_) + fill * m_
        # copia reflejada de la liana: fila src -> fila 2m - src, misma x
        src_rows_v = np.arange(m + 1, src_end + 1)
        pm = soft(vine_src[src_rows_v, x0:x1], 0.7)
        for i, sy in enumerate(src_rows_v):
            y = 2 * m - sy
            w_ = pm[i][:, None]
            out[y, x0:x1] = out[y, x0:x1] * (1 - w_) + a[sy, x0:x1] * w_
        # remate superior: una hoja completa de la liana (de este lado o, si no hay, del otro espejada),
        # con su tramo de tallo solapado 10 filas sobre el extremo de la copia
        src_side = side if leaf else next((s for s, L2 in LIANA.items() if s != side and L2['leaf']), None)
        if src_side:
            L2 = LIANA[src_side]; l0, l1 = L2['leaf']; sx0, sx1 = L2['x0'], L2['x1']
            sprite = vine_src[l0:l1, sx0:sx1]; src_rgb = a[l0:l1, sx0:sx1]; src_g = green[l0:l1, sx0:sx1]
            if src_side != side:                                                  # prestada del otro lado: espejo horizontal
                sprite, src_rgb, src_g = sprite[:, ::-1], src_rgb[:, ::-1], src_g[:, ::-1]
            xs_top = np.where(vine[src_end - 6:src_end + 1, x0:x1].any(0))[0] + x0   # x del tallo en el extremo
            xs_leaf = np.where(src_g[-6:].any(0))[0]                                # x del tallo en la base de la hoja
            if len(xs_top) and len(xs_leaf):
                D = int(round(xs_top.mean() - xs_leaf.mean()))                       # columna del sprite -> x de la carta
                ps = soft(sprite, 0.7)
                ps[-8:] *= np.linspace(1.0, 0.0, 8)[:, None]                          # la base de la hoja se funde con el tallo
                oy = y_top + 10 - (l1 - l0)                                           # la base de la hoja solapa el tallo
                for i in range(l1 - l0):
                    y = oy + i
                    if y < 0 or y >= H: continue
                    for xx in range(sprite.shape[1]):
                        xd = xx + D
                        w_ = ps[i, xx]
                        if 0 <= xd < W and w_ > 0.02:
                            out[y, xd] = out[y, xd] * (1 - w_) + src_rgb[i, xx] * w_
        print(f'liana {side}: espejo y={m}, copia hasta y={y_top}, remate con hoja de {src_side}')

card = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

draw = ImageDraw.Draw(card)
f = ImageFont.truetype(cc.FONT_BOLD, cc.BADGE_NUMBER_SIZE)
if cost is not None: cc.draw_centered(draw, cc.COST_BADGE, str(cost), f, fill=cc.COST_COLOR)
if pv is not None: cc.draw_centered(draw, cc.PV_BADGE, str(pv), f, fill=cc.PV_COLOR)
os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
card.save(out_path); print('saved', out_path)
