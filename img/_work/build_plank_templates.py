"""Genera plantillas a partir de img/template3.png cambiando solo el color de la
tabla del nombre: tierra (madera original), agua (azulada), aire (clara),
monedas (dorado metalico) y las tres mixtas (mitad izquierda / mitad derecha).
Salida: img/Nueva carpeta/madera/*.png
Uso:
  /c/Python310/python img/_work/build_plank_templates.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = 'img/template3.png'
OUT = os.environ.get('PLANK_OUT', 'img/Nueva carpeta/madera')
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGBA')
rgba = np.asarray(im).astype(float)
rgb = rgba[..., :3]
H, W, _ = rgb.shape
hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(float)
h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

# ---- mascara de la tabla: inundacion desde su centro sin cruzar el contorno oscuro ni las hojas ----
BOX = (493, 596, 84, 542)                           # y0, y1, x0, x1
green = (h > 40) & (h < 120) & (s > 90)
wall = (v < 168) | green                                 # cara clara; bisel y contorno quedan fuera
region = np.zeros((H, W), bool); region[BOX[0]:BOX[1], BOX[2]:BOX[3]] = True
lab, _ = ndimage.label(~wall & region)
face = ndimage.binary_fill_holes(lab == lab[540, 307])   # inundacion desde el centro de la tabla
def disk_plank(r):
    yy_, xx_ = np.mgrid[-r:r + 1, -r:r + 1]; return (xx_ * xx_ + yy_ * yy_) <= r * r
# forma exterior de la cara (cierre + relleno de huecos); dentro de ella, lo oscuro conectado
# con el exterior (contorno, bisel, entrantes del borde) no se pinta; lo oscuro aislado (vetas) si
closed = ndimage.binary_fill_holes(ndimage.binary_closing(face, structure=disk_plank(10)))
dark = (v < 132) & closed                                  # solo lo realmente oscuro, no el antialias
lab_d, _ = ndimage.label(dark | ~closed)
exterior_ids = np.unique(lab_d[~closed]); exterior_ids = exterior_ids[exterior_ids > 0]
boundary_dark = np.isin(lab_d, exterior_ids) & closed
# las grietas finas que llegan al borde tambien se pintan, salvo su tramo pegado al contorno
thin_streak = boundary_dark & ~ndimage.binary_opening(boundary_dark, structure=disk_plank(3))
dist_in = ndimage.distance_transform_edt(closed)
boundary_dark &= ~(thin_streak & (dist_in >= 5))
plank = closed & ~boundary_dark & ~ndimage.binary_dilation(green, iterations=1)
# suavizar el borde de la zona pintada: fuera puntas y dientes de sierra
plank = ndimage.binary_closing(ndimage.binary_opening(plank, structure=disk_plank(2)), structure=disk_plank(2))
plank &= region
# zonas manuales (ver plank_zones.py): cajas que nunca se pintan y cajas que siempre se pintan
import importlib, plank_zones
importlib.reload(plank_zones)
for (zy0, zy1, zx0, zx1) in plank_zones.NO_PINTAR:
    sub = plank[zy0:zy1, zx0:zx1]
    keep = (v[zy0:zy1, zx0:zx1] >= plank_zones.UMBRAL_MADERA) if plank_zones.UMBRAL_MADERA > 0 else np.ones_like(sub)
    keep = ndimage.binary_dilation(keep, iterations=1)
    plank[zy0:zy1, zx0:zx1] = sub & ~keep
for (zy0, zy1, zx0, zx1) in plank_zones.SI_PINTAR:
    sub = plank[zy0:zy1, zx0:zx1]
    dark_box = ndimage.binary_dilation(v[zy0:zy1, zx0:zx1] < plank_zones.UMBRAL_OSCURO, iterations=1)   # lineas + su antialias
    fillable = ~dark_box & ~ndimage.binary_dilation(green, iterations=1)[zy0:zy1, zx0:zx1]
    plank[zy0:zy1, zx0:zx1] = (sub | fillable) & ~dark_box
for zona in getattr(plank_zones, 'NO_PINTAR_LINEAS', []):
    zy0, zy1, zx0, zx1 = zona[:4]
    umbral = zona[4] if len(zona) > 4 else plank_zones.UMBRAL_LINEA
    # solo las manchas oscuras que nacen del contorno (la linea de la muesca), no la textura suelta
    vb = v[zy0:zy1, zx0:zx1]
    cand = vb < umbral
    anchor = ndimage.binary_dilation(vb < 118, iterations=2)          # contorno de verdad
    lab_l, nl = ndimage.label(cand)
    line = np.zeros_like(cand)
    for i in range(1, nl + 1):
        c = lab_l == i
        if (c & anchor).any(): line |= c
    plank[zy0:zy1, zx0:zx1] &= ~line                                  # solo el trazo, sin engordar
m = np.asarray(Image.fromarray((plank * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255.0
# zonas MEDIO: los trazos oscuros de la caja se pintan a medias (peso 0.5)
for zona in getattr(plank_zones, 'MEDIO', []):
    zy0, zy1, zx0, zx1 = zona[:4]
    umbral = zona[4] if len(zona) > 4 else plank_zones.UMBRAL_LINEA
    half = ndimage.binary_dilation(v[zy0:zy1, zx0:zx1] < umbral, iterations=1)
    half = np.asarray(Image.fromarray((half * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255.0
    m[zy0:zy1, zx0:zx1] *= (1 - (1 - getattr(plank_zones, 'PESO_MEDIO', 0.5)) * half)

def recolor(hue, sat_mul, val_fn):
    """Cambia tono/saturacion y remapea el valor conservando la veta (H,S,V de PIL, 0-255)."""
    hh = np.full_like(h, hue)
    ss = np.clip(s * sat_mul, 0, 255)
    vv = np.clip(val_fn(v), 0, 255)
    out = np.asarray(Image.fromarray(np.stack([hh, ss, vv], -1).astype(np.uint8), 'HSV').convert('RGB')).astype(float)
    return out

VARIANTS = {
    'tierra':  None,                                                            # madera original
    'agua':    recolor(148, 0.80, lambda x: x * 0.92),                          # azul mar
    'aire':    recolor(140, 0.22, lambda x: 255 - (255 - x) * 0.80),            # celeste palido, poco saturado, algo menos claro
    'monedas': recolor(30, 1.10, lambda x: 128 + (x - 128) * 1.35 + 18),        # dorado con mas contraste
}
# brillo especular en diagonal para que el dorado parezca metal y no pintura amarilla
yy, xx = np.mgrid[0:H, 0:W]
sheen = 1 + 0.16 * np.cos(2 * np.pi * (xx + 0.6 * yy) / 260.0)
VARIANTS['monedas'] = np.clip(VARIANTS['monedas'] * sheen[..., None], 0, 255)
_ = {}

def apply(variant):
    if variant is None:
        return rgb.copy()
    return rgb * (1 - m[..., None]) + variant * m[..., None]

imgs = {k: apply(vv) for k, vv in VARIANTS.items()}

# ---- mixtas: mitad izquierda / mitad derecha con transicion suave en el centro ----
xc, half = W // 2, 150                                  # transicion de ~300 px (casi toda la tabla)
wx = np.clip((np.arange(W) - (xc - half)) / (2.0 * half), 0, 1)
wx = (wx * wx * (3 - 2 * wx))[None, :, None]
for left, right in [('tierra', 'agua'), ('tierra', 'aire'), ('agua', 'aire')]:
    imgs[f'{left}_{right}'] = imgs[left] * (1 - wx) + imgs[right] * wx
# triple (todoterreno): agua a la izquierda, tierra (madera) en el centro, aire a la derecha,
# con dos transiciones progresivas repartidas a lo largo de la tabla
def ramp(x0, x1):
    r = np.clip((np.arange(W) - x0) / float(x1 - x0), 0, 1)
    return (r * r * (3 - 2 * r))[None, :, None]
w1, w2 = ramp(130, 290), ramp(330, 490)
imgs['tierra_agua_aire'] = imgs['agua'] * (1 - w1) + imgs['tierra'] * (w1 - w2) + imgs['aire'] * w2

def save_set(folder, transform):
    os.makedirs(folder, exist_ok=True)
    for name, arr in imgs.items():
        out = np.concatenate([np.clip(transform(arr), 0, 255), rgba[..., 3:4]], -1).astype(np.uint8)
        Image.fromarray(out, 'RGBA').save(os.path.join(folder, name + '.png'))
        print('saved', os.path.join(folder, name + '.png'))

def lighten(arr, amount=0.42, desat=0.85, lo=60, hi=170):
    """Version clara: los rellenos se acercan al blanco un `amount` y pierden algo de
    saturacion, pero las lineas oscuras del dibujo (luminosidad < lo) se conservan tal
    cual; entre lo y hi la transicion es progresiva."""
    lum0 = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    k = np.clip((lum0 - lo) / (hi - lo), 0, 1); k = k * k * (3 - 2 * k)
    k = k[..., None]
    x = 255 - (255 - arr) * (1 - amount * k)
    lum = (0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2])[..., None]
    return lum + (x - lum) * (1 - (1 - desat) * k)

# imagen de control: zona pintada en azul, cajas NO_PINTAR en rojo, SI_PINTAR en verde, rejilla cada 10 px
from PIL import ImageDraw as _ID
ctrl = rgb.copy(); ctrl[plank] = ctrl[plank] * 0.45 + np.array([40, 80, 255]) * 0.55
ctrl_im = Image.fromarray(ctrl.astype(np.uint8)).crop((70, 480, 550, 610)).resize((1920, 520), Image.NEAREST)
d = _ID.Draw(ctrl_im)
sx, sy = 1920 / 480.0, 520 / 130.0
for gx in range(70, 551, 10):
    X = (gx - 70) * sx; d.line([(X, 0), (X, 520)], fill=(255, 255, 255) if gx % 50 else (255, 220, 0), width=1)
    if gx % 50 == 0: d.text((X + 2, 2), str(gx), fill=(255, 220, 0))
for gy in range(480, 611, 10):
    Y = (gy - 480) * sy; d.line([(0, Y), (1920, Y)], fill=(255, 255, 255) if gy % 50 else (255, 220, 0), width=1)
    if gy % 50 == 0: d.text((2, Y + 2), str(gy), fill=(255, 220, 0))
for (zy0, zy1, zx0, zx1), col in [(z, (255, 0, 0)) for z in plank_zones.NO_PINTAR] + [(z, (0, 200, 0)) for z in plank_zones.SI_PINTAR] + [(z[:4], (255, 140, 0)) for z in getattr(plank_zones, 'NO_PINTAR_LINEAS', [])] + [(z[:4], (255, 0, 255)) for z in getattr(plank_zones, 'MEDIO', [])]:
    d.rectangle([((zx0 - 70) * sx, (zy0 - 480) * sy), ((zx1 - 70) * sx, (zy1 - 480) * sy)], outline=col, width=3)
ctrl_im.save(os.path.join(OUT, 'plank_zonas_control.png'))
save_set(OUT, lambda a: a)                          # version normal
save_set(os.path.join(OUT, 'claras'), lighten)      # version clara
save_set(os.path.join(OUT, 'medias'), lambda a: lighten(a, amount=0.22, desat=0.92))   # entre la original y la clara
