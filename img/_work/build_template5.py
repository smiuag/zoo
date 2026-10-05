"""Genera img/template5.png: el marco de template3 (ventana de la ilustracion entera) con el pergamino
del nombre de template4 en lugar del tablon, colocado mas abajo que en template4 para que no tape la
ilustracion y sin que asome el tablon por ningun lado.

- El pergamino se recorta de template4 (llevado a 615x878) con su contorno. Las dos hojas que lo pisan
  alli se tapan clonando un tramo limpio del mismo borde (CLONES) y los restos finos de liana, rellenando
  desde el papel de alrededor (cv2.inpaint).
- En template3 se quita el tablon y se deja todo lo demas: la ventana, el liston de madera que la cierra
  por abajo, las hojas y la madera que hay entre el tablon y el panel de texto. El hueco del tablon se
  repinta con la madera CLARA del liston (sus filas, reflejadas), tambien la franja en sombra que habia
  bajo el tablon: el pergamino queda sobre un tablero claro y limpio, igual por arriba que por abajo
  (con la madera en sombra y el contorno del tablon se veia oscuro y sucio), en el tono BOARD_TONE. El pergamino va centrado
  entre la ventana y el panel de texto.
Salida: img/template5.png (615x878, esquinas rellenas del marron de la banda) e
img/_work/template5_control.png. Uso:
  /c/Python310/python img/_work/build_template5.py
"""
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

W, H = 615, 878
GAP = (481, 602)     # del borde inferior de la ventana al borde superior del panel de texto (template3)
SQUASH = 0.91        # alto del pergamino respecto a template4: lo justo para que los rollos no pisen la ventana
DX = 1               # template3 esta 1 px a la derecha de template4 en esta franja

OUT_PNG = os.environ.get('T5_OUT', 'img/template5.png')
# 2026-10-05: el usuario retoca img/template5.png A MANO despues de generarla (como portada_viva.png).
# Para no pisar esos retoques, sin --force solo se escribe en otra ruta (variable de entorno T5_OUT).
if OUT_PNG == 'img/template5.png' and os.path.exists(OUT_PNG) and '--force' not in sys.argv:
    sys.exit('img/template5.png ya existe y puede llevar retoques a mano: usa T5_OUT=otra_ruta o --force')
t3_rgba = Image.open('img/template3.png').convert('RGBA')
t3 = np.asarray(t3_rgba.convert('RGB')).astype(float)
alpha3 = np.asarray(t3_rgba)[..., 3].astype(float) / 255.0
t4_im = Image.open('img/template4.jpg').convert('RGB').resize((W, H), Image.LANCZOS)
t4 = np.asarray(t4_im).astype(float)


def hsv_of(arr):
    a = np.asarray(Image.fromarray(arr.astype(np.uint8)).convert('HSV')).astype(float)
    return a[..., 0], a[..., 1], a[..., 2]


def disk(r):
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (xx * xx + yy * yy) <= r * r


def green_of(arr):
    h, s, v = hsv_of(arr)
    return (h > 40) & (h < 120) & (s > 90)


# ---- 1. pergamino de template4: papel (como en build_scroll_templates.py) + contorno ----
# Parches (y0, y1, x0, x1, origen): encima de cada caja se copia otro tramo limpio del propio pergamino.
# origen = desplazamiento en x del tramo copiado, o 'espejo' (el tramo simetrico del otro extremo, que
# lleva el mismo sombreado junto al rollo).
CLONES = [
    (452, 490, 417, 491, 'espejo'),   # hojas y liana sobre el borde superior derecho, hasta el rollo
    (546, 574, 124, 162, 'espejo'),   # hoja sobre la esquina inferior izquierda de la cara
]
src4 = t4.copy()
for (cy0, cy1, cx0, cx1, origin) in CLONES:
    w = np.zeros((H, W)); w[cy0:cy1, cx0:cx1] = 1.0
    w = ndimage.gaussian_filter(w, 1.2)[..., None]
    patch = src4[:, ::-1] if origin == 'espejo' else np.roll(src4, -origin, axis=1)
    t4 = t4 * (1 - w) + patch * w
h4, s4, v4 = hsv_of(t4)
green4 = green_of(t4)
paper = (s4 < 112) & (v4 > 165) & ~green4
lab, _ = ndimage.label(paper)
region = np.zeros((H, W), bool); region[440:576, 52:562] = True
scroll = paper & region & (lab != lab[300, 307])
lab_s, n = ndimage.label(scroll)
sizes = ndimage.sum(scroll, lab_s, range(1, n + 1))
scroll = np.isin(lab_s, [i + 1 for i, sz in enumerate(sizes) if sz >= 40])
assert scroll.sum() > 20000, 'el pergamino se ha unido a la ventana: revisar CLONES (un parche ha roto su contorno)'
hull = ndimage.binary_fill_holes(ndimage.binary_closing(np.pad(scroll, 12), structure=disk(9))[12:-12, 12:-12])

# Hojas y lianas que pisan o rozan el pergamino: fuera, rellenando desde el papel de alrededor. Se
# enmascara TODO lo verde de la franja (no solo lo de dentro del recorte) para que el relleno no tome
# color de la liana que pasa pegada por fuera.
over = ndimage.binary_dilation(green4, structure=disk(3)) & region
clean = cv2.inpaint(t4.astype(np.uint8), (over * 255).astype(np.uint8), 5, cv2.INPAINT_TELEA).astype(float)

# Recorte = papel + su contorno oscuro. De lo que rodea al papel solo entra lo oscuro: en template4 el
# borde superior da a la ventana blanca y su filo claro se veia como una raya gris sobre la madera.
v_clean = hsv_of(clean)[2]
sprite_mask = (hull | (ndimage.binary_dilation(hull, structure=disk(2)) & (v_clean < 175))) & ~(lab == lab[300, 307])

ys, xs = np.nonzero(sprite_mask)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
new_h = int(round((y1 - y0) * SQUASH))
sprite = Image.fromarray(clean[y0:y1, x0:x1].astype(np.uint8)).resize((x1 - x0, new_h), Image.LANCZOS)
smask = Image.fromarray((sprite_mask[y0:y1, x0:x1] * 255).astype(np.uint8)).resize((x1 - x0, new_h), Image.LANCZOS)
smask = np.asarray(smask.filter(ImageFilter.GaussianBlur(0.6))).astype(float) / 255.0
sprite = np.asarray(sprite).astype(float)
# La cara plana del pergamino (entre los rollos) se centra en vertical en GAP: queda la misma distancia
# de la ventana al borde superior del pergamino que de su borde inferior al panel de texto (pedido
# explicito del usuario). Los bordes son irregulares: se toma su altura mediana a lo largo de la cara.
face_cols = smask[:, 90:-90] > 0.5
face_top_rel = float(np.median(np.argmax(face_cols, axis=0)))
face_bottom_rel = float(np.median(new_h - np.argmax(face_cols[::-1], axis=0)))
px0 = x0 + DX
py0 = int(round((GAP[0] + GAP[1]) / 2 - (face_top_rel + face_bottom_rel) / 2))
m = np.zeros((H, W)); m[py0:py0 + new_h, px0:px0 + (x1 - x0)] = smask
spr = np.zeros((H, W, 3)); spr[py0:py0 + new_h, px0:px0 + (x1 - x0)] = sprite
face_top, face_bottom = py0 + face_top_rel, py0 + face_bottom_rel
print('distancia ventana-pergamino %.1f px, pergamino-panel %.1f px; rollos desde y=%d (ventana hasta %d)'
      % (face_top - GAP[0], GAP[1] - face_bottom, py0, GAP[0] - 1))

# ---- 2. template3 sin tablon ----
out = t3.copy()
# hojas de template3 (con su contorno); las motas verdosas sueltas de la madera no cuentan como hoja
g3 = green_of(t3)
lab3, n3 = ndimage.label(g3)
g3 = np.isin(lab3, [i + 1 for i, sz in enumerate(ndimage.sum(g3, lab3, range(1, n3 + 1))) if sz >= 150])
keep = ndimage.binary_dilation(g3, structure=disk(2))
BAR = (484, 491)       # filas de madera clara del liston que cierra la ventana
FILL = (484, 598)      # filas que se repintan: del liston (incluido) al contorno superior del panel de texto
# Tono del tablero: la madera clara del liston tal cual quedaba demasiado clara junto al resto del marco
# (aviso del usuario). Se lleva al tono de la mitad clara de los postes laterales, medido en template3.
BOARD_TONE = (186, 131, 84)
SHADOW_ROWS = 586      # desde aqui hacia abajo, la franja oscura de template3 llega mas lejos a los lados
PLANK_X = (84, 536)


def tri(k, n):
    """0..n-1, n-1..0, 0..n-1...: recorre n filas de ida y vuelta, sin saltos."""
    k %= 2 * n
    return k if k < n else 2 * n - 1 - k


def source_row(sy):
    """Fila sy del liston como textura de madera para todo el ancho: solo su tramo central limpio
    (x 150..470), reflejado hacia los lados. Mas alla hay hojas, y el contorno de una hoja copiado fila
    a fila dejaba un zigzag verdoso bajo los rollos."""
    return np.pad(t3[sy, 150:470], ((150, W - 470), (0, 0)), mode='reflect') * TONE


TONE = np.array(BOARD_TONE, float) / np.median(t3[BAR[0]:BAR[1], 150:470].reshape(-1, 3), axis=0)
for y in range(*FILL):                                                      # liston prolongado hacia abajo
    sy = y if y < BAR[1] else BAR[1] - 1 - tri(y - BAR[1], BAR[1] - BAR[0])
    xa, xb = (62, 556) if y >= SHADOW_ROWS else PLANK_X
    wrow = np.clip(np.minimum(np.arange(W) - xa, xb - np.arange(W)) / 10.0, 0, 1)   # extremos difuminados
    wrow = (wrow * wrow * (3 - 2 * wrow) * ~keep[y])[:, None]
    out[y] = out[y] * (1 - wrow) + source_row(sy) * wrow

# ---- 3. pergamino encima ----
out = out * (1 - m[..., None]) + spr * m[..., None]

# Esquinas exteriores: template3 las trae transparentes (con un filo gris semitransparente). Se aplana
# sobre el marron de la banda y round_corners.py deja el rectangulo redondeado exacto, igual que se hizo
# con las plantillas del marco anterior.
band = np.concatenate([t3[3:9, W // 4:3 * W // 4].reshape(-1, 3), t3[H - 9:H - 3, W // 4:3 * W // 4].reshape(-1, 3),
                       t3[H // 4:3 * H // 4, 3:9].reshape(-1, 3), t3[H // 4:3 * H // 4, W - 9:W - 3].reshape(-1, 3)])
fill = np.median(band, axis=0)
out = out * alpha3[..., None] + fill * (1 - alpha3[..., None])
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT_PNG)
subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'round_corners.py'), OUT_PNG], check=True)
out = np.asarray(Image.open(OUT_PNG).convert('RGB')).astype(float)
print('saved', OUT_PNG, '; pergamino y=%d..%d, cara %.1f..%.1f' % (py0, py0 + new_h, face_top, face_bottom))

# control: recorte ampliado de la franja, con el contorno del recorte del pergamino en magenta
edge = (m > 0.5) & ~ndimage.binary_erosion(m > 0.5)
ctrl = np.clip(out, 0, 255).copy(); ctrl[edge] = (255, 0, 200)
both = np.concatenate([np.clip(out, 0, 255)[430:630], ctrl[430:630]], axis=0).astype(np.uint8)
Image.fromarray(both).resize((W * 3, 400 * 3), Image.LANCZOS).save('img/_work/template5_control.png')
