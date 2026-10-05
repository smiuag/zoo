"""Plantillas OFICIALES de las cartas de animal, a partir del marco img/template5.png (615x878; lo genera
build_template5.py y el usuario lo retoca a mano): marco de template3 con el nombre en un pergamino
enrollado. Genera las combinaciones de color tinendo el pergamino del nombre y el panel de texto:
tierra (arena clara), agua (azul claro), aire (blanco), monedas (dorado), las tres mixtas y la triple.
Colores, panel tenido y ancho de la mezcla los fijo el usuario el 2026-10-05 tras varias hojas de prueba.
Salida: img/templates/template5/*.png (615x878) y img/templates/sangrado/template5/*.png (con los 98 px
de sangrado que espera compose_card.py). Si se regeneran, borrar img/_work/template_alpha_cache/. Uso:
  /c/Python310/python img/_work/build_scroll_templates.py
Para otro marco con pergamino, las variables de entorno SCROLL_SRC, SCROLL_ROWS (franja y0,y1 que contiene
el pergamino), SCROLL_OUT y SCROLL_OUT_BLEED cambian origen, franja y carpetas. El marco anterior:
  SCROLL_SRC=img/template4.jpg SCROLL_ROWS=440,576 SCROLL_OUT=img/templates/template4 SCROLL_OUT_BLEED=img/templates/sangrado/template4
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = os.environ.get('SCROLL_SRC', 'img/template5.png')
OUT = os.environ.get('SCROLL_OUT', 'img/templates/template5')
OUT_BLEED = os.environ.get('SCROLL_OUT_BLEED', 'img/templates/sangrado/template5')
W, H = 615, 878
BLEED = 98
EDGE = 3

im = Image.open(SRC).convert('RGB').resize((W, H), Image.LANCZOS)
rgb = np.asarray(im).astype(float)
hsv = np.asarray(im.convert('HSV')).astype(float)
h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]

# ---- mascara del pergamino: papel claro y poco saturado dentro de su caja, sin la ventana blanca de la
# ilustracion (que es otra pieza conexa: el contorno oscuro del pergamino las separa) ----
# y0, y1, x0, x1; SCROLL_ROWS=y0,y1 para un marco con el pergamino a otra altura (template5: 474,598)
BOX = tuple(int(n) for n in os.environ.get('SCROLL_ROWS', '472,598').split(',')) + (52, 562)
green = (h > 40) & (h < 120) & (s > 90)
paper = (s < 112) & (v > 165) & ~green                  # con v > 150 el contorno fino deja de separar ventana y pergamino
lab, _ = ndimage.label(paper)
window_id = lab[300, 307]                                # centro de la ventana de la ilustracion
region = np.zeros((H, W), bool); region[BOX[0]:BOX[1], BOX[2]:BOX[3]] = True
scroll = paper & region & (lab != window_id)
lab_s, n = ndimage.label(scroll)
sizes = ndimage.sum(scroll, lab_s, range(1, n + 1))
scroll = np.isin(lab_s, [i + 1 for i, sz in enumerate(sizes) if sz >= 40])      # fuera motas sueltas
m = np.asarray(Image.fromarray((scroll * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255.0

lum = 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]

# El panel de texto tambien toma el color del habitat (SCROLL_PANEL=0 lo deja beige). Es un pergamino beige,
# mas oscuro que el del nombre, asi que su luminosidad se estira para que su zona clara de el mismo color.
if os.environ.get('SCROLL_PANEL', '1') != '0':
    panel = ndimage.binary_fill_holes(lab == lab[720, 307]) & ~ndimage.binary_dilation(green, iterations=2)
    panel[:BOX[1]] = False
    top = np.percentile(lum[panel], 90)
    lum = np.where(panel, 120 + (lum - 120) * (250 - 120) / (top - 120), lum)
    pm = np.asarray(Image.fromarray((panel * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))).astype(float) / 255.0
    m = np.maximum(m, pm)


def duotone(dark, light, lo=120.0, hi=250.0, gamma=1.0):
    """El pergamino es casi blanco, asi que cambiar el tono no lo tine: se remapea su luminosidad
    entre un color oscuro (sombras y bordes) y uno claro (centro), conservando el sombreado."""
    t = np.clip((lum - lo) / (hi - lo), 0, 1) ** gamma
    return np.array(dark, float) + (np.array(light, float) - np.array(dark, float)) * t[..., None]


# Colores de habitat: (color de sombras y bordes, color del centro). Para probar otros tonos sin tocar los
# oficiales: SCROLL_TIERRA / SCROLL_AGUA / SCROLL_AIRE = "r,g,b;r,g,b" (con SCROLL_OUT y SCROLL_OUT_BLEED a carpetas de prueba).
def _tone(env, default):
    if os.environ.get(env):
        return tuple(tuple(int(n) for n in c.split(',')) for c in os.environ[env].split(';'))
    return default


TIERRA = _tone('SCROLL_TIERRA', ((150, 108, 64), (242, 218, 180)))      # arena clara
AGUA = _tone('SCROLL_AGUA', ((103, 141, 174), (197, 225, 245)))        # azul claro
AIRE = _tone('SCROLL_AIRE', ((168, 160, 148), (253, 250, 244)))        # blanco apenas calido (entre blanco puro y blanco roto)

VARIANTS = {
    'tierra':  duotone(*TIERRA),
    'agua':    duotone(*AGUA),
    'aire':    duotone(*AIRE),
    'monedas': duotone((150, 96, 24), (255, 226, 132)),                 # dorado
}
# brillo en diagonal para que el dorado parezca metal y no papel amarillo
yy, xx = np.mgrid[0:H, 0:W]
sheen = 1 + 0.10 * np.cos(2 * np.pi * (xx + 0.6 * yy) / 260.0)
VARIANTS['monedas'] = np.clip(VARIANTS['monedas'] * sheen[..., None], 0, 255)


def apply(variant):
    if variant is None:
        return rgb.copy()
    return rgb * (1 - m[..., None]) + variant * m[..., None]


imgs = {k: apply(vv) for k, vv in VARIANTS.items()}

# ---- mixtas: mitad izquierda / mitad derecha con transicion suave; triple: agua, tierra, aire ----
def ramp(x0, x1):
    r = np.clip((np.arange(W) - x0) / float(x1 - x0), 0, 1)
    return (r * r * (3 - 2 * r))[None, :, None]


# Semianchura (px) de la transicion entre dos colores: 150 = degradado a lo largo de casi todo el
# pergamino; menos = cada lado conserva su color y la mezcla ocurre de golpe en el centro.
BLEND = int(os.environ.get('SCROLL_BLEND', '90'))
wx = ramp(W // 2 - BLEND, W // 2 + BLEND)
for left, right in [('tierra', 'agua'), ('tierra', 'aire'), ('agua', 'aire')]:
    imgs[f'{left}_{right}'] = imgs[left] * (1 - wx) + imgs[right] * wx
tb = min(BLEND, 80)
w1, w2 = ramp(210 - tb, 210 + tb), ramp(410 - tb, 410 + tb)
imgs['tierra_agua_aire'] = imgs['agua'] * (1 - w1) + imgs['tierra'] * (w1 - w2) + imgs['aire'] * w2

# color del sangrado: la banda oscura del borde (mediana de la franja de 3 a 9 px)
band = np.concatenate([rgb[3:9, W // 4:3 * W // 4].reshape(-1, 3), rgb[H - 9:H - 3, W // 4:3 * W // 4].reshape(-1, 3),
                       rgb[H // 4:3 * H // 4, 3:9].reshape(-1, 3), rgb[H // 4:3 * H // 4, W - 9:W - 3].reshape(-1, 3)])
fill = tuple(int(round(c)) for c in np.median(band, axis=0))

os.makedirs(OUT, exist_ok=True)
os.makedirs(OUT_BLEED, exist_ok=True)
for name, arr in imgs.items():
    arr = arr.copy()
    arr[:EDGE], arr[-EDGE:], arr[:, :EDGE], arr[:, -EDGE:] = fill, fill, fill, fill   # el JPG trae una raya mas oscura en el canto: se veria entre marco y sangrado
    card = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    card.save(os.path.join(OUT, name + '.png'))
    bleed = Image.new('RGB', (W + 2 * BLEED, H + 2 * BLEED), fill)
    bleed.paste(card, (BLEED, BLEED))
    bleed.save(os.path.join(OUT_BLEED, name + '.png'))
    print('saved', name)

# imagen de control: zona repintada en magenta sobre el original ampliado
ctrl = rgb.copy(); ctrl[scroll] = ctrl[scroll] * 0.45 + np.array([255, 0, 200]) * 0.55
Image.fromarray(ctrl.astype(np.uint8)).crop((40, BOX[0] - 10, 580, BOX[1] + 14)).resize((1620, (BOX[1] - BOX[0] + 24) * 3), Image.NEAREST).save(os.path.join(OUT, 'scroll_zona_control.png'))
print('sangrado', fill)
