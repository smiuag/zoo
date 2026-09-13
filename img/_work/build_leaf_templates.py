"""Variante sobre la version "media" de las plantillas de madera: ademas de la tabla
del nombre, cambia el color de las hojas segun el tipo (verde tierra, azul oscuro
acuatico, azul casi blanco volador) y genera las monedas en cobre, plata, oro y
platino. Salida: img/templates/<intento>/*.png (por defecto medias_hojas3)
Uso:
  /c/Python310/python img/_work/build_leaf_templates.py [carpeta_salida]
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = 'img/template3.png'
import sys
OUT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('LEAF_OUT', 'img/templates/medias_hojas3')
# True: la tabla del nombre se queda siempre de madera y solo cambian las hojas (tallos no)
WOOD_PLANK_ALWAYS = True
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert('RGBA')
rgba = np.asarray(im).astype(float)
rgb = rgba[..., :3]
H, W, _ = rgb.shape
hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(float)
h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

# ---- mascara de la tabla del nombre (igual que build_plank_templates) ----
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
m_plank = soft(plank, 0.8)
for zona in getattr(plank_zones, 'MEDIO', []):
    zy0, zy1, zx0, zx1 = zona[:4]
    umbral = zona[4] if len(zona) > 4 else plank_zones.UMBRAL_LINEA
    half = soft(ndimage.binary_dilation(v[zy0:zy1, zx0:zx1] < umbral, iterations=1), 0.8)
    m_plank[zy0:zy1, zx0:zx1] *= (1 - (1 - getattr(plank_zones, 'PESO_MEDIO', 0.5)) * half)
m_plank = m_plank[..., None]

# ---- mascara de las hojas y lianas: todo lo verde (incluido su contorno verde oscuro) ----
green_all = (h > 35) & (h < 125) & (s > 60)
# solo las hojas, sin los tallos: una apertura morfologica elimina lo estrecho (tallos y
# zarcillos) y despues se recuperan los bordes de las hojas creciendo un poco dentro del verde
def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]; return (x * x + y * y) <= r * r
leaves = ndimage.binary_opening(green_all, structure=disk(8))
for _ in range(3):
    leaves = ndimage.binary_dilation(leaves, structure=disk(1)) & green_all
m_leaf = soft(leaves, 0.6)[..., None]

def recolor(hue, sat_mul, val_fn):
    hh = np.full_like(h, hue)
    ss = np.clip(s * sat_mul, 0, 255)
    vv = np.clip(val_fn(v), 0, 255)
    return np.asarray(Image.fromarray(np.stack([hh, ss, vv], -1).astype(np.uint8), 'HSV').convert('RGB')).astype(float)

yy, xx = np.mgrid[0:H, 0:W]
sheen = (1 + 0.16 * np.cos(2 * np.pi * (xx + 0.6 * yy) / 260.0))[..., None]

PLANK = {
    'tierra': None,
    'agua':   recolor(148, 0.80, lambda x: x * 0.92),
    'aire':   recolor(140, 0.30, lambda x: 255 - (255 - x) * 0.55),
    'cobre':  np.clip(recolor(12, 1.05, lambda x: 128 + (x - 128) * 1.25 + 6) * sheen, 0, 255),
    'plata':  np.clip(recolor(150, 0.05, lambda x: 128 + (x - 128) * 1.40 + 8) * sheen, 0, 255),    # gris plata
    'oro':    np.clip(recolor(30, 1.10, lambda x: 128 + (x - 128) * 1.35 + 18) * sheen, 0, 255),
    'platino': np.clip(recolor(165, 0.16, lambda x: 128 + (x - 128) * 1.25 + 55) * sheen, 0, 255),  # blanco frio, mas claro que la plata
}
LEAF = {
    'tierra': None,                                                # verde original
    'agua':   recolor(150, 1.00, lambda x: x * 0.72),              # azul oscuro
    'aire':   recolor(145, 0.28, lambda x: 255 - (255 - x) * 0.45),  # azul casi blanco
    # monedas: tabla de madera (como tierra) y hojas del color del metal
    'cobre':  recolor(12, 1.05, lambda x: 128 + (x - 128) * 1.15 + 10),
    'plata':  recolor(150, 0.05, lambda x: 128 + (x - 128) * 1.25 + 20),
    'oro':    recolor(30, 1.10, lambda x: 128 + (x - 128) * 1.20 + 25),
    'platino': recolor(165, 0.16, lambda x: 128 + (x - 128) * 1.15 + 60),
}

def build(plank_key, leaf_key):
    out = rgb.copy()
    if PLANK[plank_key] is not None:
        out = out * (1 - m_plank) + PLANK[plank_key] * m_plank
    if LEAF[leaf_key] is not None:
        out = out * (1 - m_leaf) + LEAF[leaf_key] * m_leaf
    return out

pk = (lambda k: 'tierra') if WOOD_PLANK_ALWAYS else (lambda k: k)
imgs = {
    'tierra': build('tierra', 'tierra'),
    'agua':   build(pk('agua'), 'agua'),
    'aire':   build(pk('aire'), 'aire'),
    'moneda_cobre':   build('tierra', 'cobre'),
    'moneda_plata':   build('tierra', 'plata'),
    'moneda_oro':     build('tierra', 'oro'),
    'moneda_platino': build('tierra', 'platino'),
}
xc, half = W // 2, 150
wx = np.clip((np.arange(W) - (xc - half)) / (2.0 * half), 0, 1)
wx = (wx * wx * (3 - 2 * wx))[None, :, None]
for left, right in [('tierra', 'agua'), ('tierra', 'aire'), ('agua', 'aire')]:
    imgs[f'{left}_{right}'] = imgs[left] * (1 - wx) + imgs[right] * wx

def lighten(arr, amount=0.22, desat=0.92, lo=60, hi=170):
    lum0 = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    k = np.clip((lum0 - lo) / (hi - lo), 0, 1); k = (k * k * (3 - 2 * k))[..., None]
    x = 255 - (255 - arr) * (1 - amount * k)
    lum = (0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2])[..., None]
    return lum + (x - lum) * (1 - (1 - desat) * k)

for name, arr in imgs.items():
    out = np.concatenate([np.clip(lighten(arr), 0, 255), rgba[..., 3:4]], -1).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(os.path.join(OUT, name + '.png'))
    print('saved', name)
