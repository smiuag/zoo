"""Monta las cuatro monedas con los animales de img/coins/4en1.jpeg (2x2: panda=1,
perezoso=2, ardilla=3, koala=5, cada uno con su bellota) sobre el fondo comun
img/coins/fondoCoin.jpg. La silueta de cada animal se recorta con un poligono dibujado a
mano en coordenadas de su cuadrante mas exclusion del verde del fondo; despues se escala y
se coloca con los pies sobre la rama del fondo.
Salida: img/monedaN_fondo.jpg y (opcional) una vista previa.
Uso:
  /c/Python310/python img/_work/build_coins_from_4en1.py [carpeta_preview]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

SRC = Image.open('img/coins/4en1.jpeg').convert('RGB')
BG = Image.open('img/coins/fondoCoin.jpg').convert('RGB'); W, H = BG.size
# cuadrantes (x0, y0, x1, y1) en 4en1.jpeg
QUADS = {1: (75, 14, 428, 367), 2: (428, 14, 782, 367), 3: (75, 367, 428, 721), 5: (428, 367, 782, 721)}
# poligonos alrededor de animal + bellota, en coordenadas del cuadrante
POLYS = {
    # trazados ajustados a la silueta (bellota con su rabito, orejas, cola, pies) para no arrastrar fondo
    1: [(80,125),(83,112),(97,112),(100,122),(130,118),(135,105),(138,50),(150,48),(165,62),(195,72),(225,58),(255,48),(266,70),(266,105),(262,150),(272,150),(288,130),(305,145),(308,180),(298,215),(280,242),(258,258),(240,262),(215,270),(178,276),(150,272),(120,270),(88,255),(62,225),(52,190),(55,150),(70,128)],
    2: [(82,128),(84,116),(96,116),(100,126),(138,120),(140,68),(160,52),(190,50),(220,54),(246,68),(256,100),(248,148),(262,160),(272,215),(266,258),(240,280),(200,292),(160,292),(135,278),(100,265),(70,240),(54,205),(56,160),(70,135)],
    3: [(88,118),(90,104),(100,104),(104,116),(140,110),(145,36),(158,40),(172,62),(195,70),(218,58),(232,34),(244,60),(252,95),(262,105),(280,90),(300,95),(313,125),(310,170),(284,200),(281,244),(262,254),(245,256),(225,262),(195,272),(165,270),(140,268),(118,262),(90,240),(66,215),(58,175),(64,140),(80,122)],
    5: [(92,125),(94,112),(108,112),(112,124),(118,118),(118,80),(135,58),(165,66),(200,55),(235,50),(262,60),(270,100),(258,140),(268,180),(272,235),(258,268),(225,282),(185,286),(150,274),(118,262),(88,248),(66,220),(58,185),(60,150),(75,128)],
}
SCALE = 1.86            # misma escala para los cuatro (la que deja a la ardilla en ~470 px de ancho)
FEET_Y = 692            # fila del fondo donde apoyan los pies (rama)
CENTER_X = 355          # centro horizontal en el fondo
ADJUST = {1: (0, 0), 2: (0, 0), 3: (24, 0), 5: (0, 0)}   # ardilla: la cola tapa la planta roja del fondo   # (dx, dy) de ajuste fino por moneda
# zonas (x0, y0, x1, y1) del cuadrante donde el pelo claro llega al borde sin linea oscura (orejas
# del panda rojo): ahi el fleco palido solo se quita en los 2 px mas exteriores
KEEP = {
    1: [(130, 50, 162, 108), (213, 55, 268, 110), (225, 132, 318, 200)],   # orejas, cola y panuelo
    2: [(220, 143, 246, 178)],                                             # panuelo
    3: [(170, 58, 207, 75), (233, 88, 318, 178)],                          # mechon y cola
    5: [(112, 60, 160, 105), (52, 113, 102, 162), (218, 140, 246, 178)],   # oreja, borde de la bellota, panuelo
}
# poligonos de exclusion (coordenadas del cuadrante): trozos de fondo que el poligono principal abarca
EXCLUDE = {
    1: [[(63, 229), (80, 229), (80, 242), (63, 242)]],                               # flor rosa
    2: [[(60, 231), (80, 231), (80, 243), (60, 243)],                                # flor rosa
        [(226, 274), (272, 240), (290, 240), (290, 290), (226, 290)]],               # rama bajo la pata
    3: [[(281, 172), (300, 172), (300, 250), (281, 250)]],                           # fondo a la derecha de la cola
}
# zonas que se incluyen sin filtros de color (picos verdosos de los panuelos, planta del pie):
# solo se les quita el fleco palido del borde
FORCE = {
    1: [[(228, 154), (236, 153), (243, 157), (244, 160), (238, 165), (229, 167)],      # pico superior del panuelo
        [(228, 167), (238, 169), (244, 176), (243, 180), (235, 181), (228, 178)],      # pico inferior
        [(168, 260), (176, 271), (182, 277), (190, 279), (199, 278), (206, 273), (211, 266), (211, 260)]],  # pie
    3: [[(172, 266), (200, 266), (200, 273), (191, 276), (178, 276), (172, 272)]],   # planta del pie
    5: [[(226, 145), (238, 144), (244, 149), (244, 154), (238, 158), (228, 159)],
        [(228, 161), (238, 163), (245, 170), (244, 174), (236, 175), (228, 172)]],
}
# cajas donde solo se excluyen los pixeles claros (brillo de musgo a la derecha del pie de la ardilla)
EXCLUDE_PALE = {3: [(188, 257, 209, 273)]}
POLY_SLACK = 6          # px que se ensancha el poligono (solo por encima de POLY_SLACK_Y, lejos de la rama)
POLY_SLACK_Y = 228

def strip_fringe(m, hsv, keep_boxes, force_mask=None):
    """Quita el fleco de fondo palido que queda pegado a la silueta: pixeles claros y poco
    saturados del borde (hasta 10 px) que se alcanzan desde el exterior sin cruzar ninguna linea
    oscura ni ningun color intenso (los contornos del dibujo hacen de barrera, asi que el pelo
    claro de dentro de las orejas o los brillos del rabito de la bellota se conservan)."""
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    dark = (v < 150) | (s > 100)
    pale = ~dark & (v > 150) & (s <= 75) & (h >= 30) & (h <= 140)
    # colores que solo tiene el fondo (verde azulado palido, rosa de las flores): se quitan a
    # cualquier profundidad siempre que se alcancen desde fuera sin cruzar un contorno oscuro
    teal = ~dark & (h >= 95) & (h <= 165) & (s >= 20) & (s <= 110) & (v > 120)
    pink = ((h >= 200) | (h <= 5)) & (s > 90) & (v > 120)
    band = m & ~ndimage.binary_erosion(m, iterations=6)
    bg_deep = m & (teal | pink)
    if force_mask is not None: bg_deep &= ~force_mask
    lab, _ = ndimage.label(~m | (band & pale) | bg_deep)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])); edge = edge[edge > 0]
    rm = np.isin(lab, edge) & m
    if keep_boxes:
        thin = m & ~ndimage.binary_erosion(m, iterations=2)
        for x0, y0, x1, y1 in keep_boxes:
            rm[y0:y1, x0:x1] &= thin[y0:y1, x0:x1]
    return m & ~rm

def matte(img, poly, keep_boxes=(), exclude=(), force=(), exclude_pale=()):
    hsv = np.asarray(img.convert('HSV')).astype(float); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    pm = Image.new('L', img.size, 0); ImageDraw.Draw(pm).polygon(poly, fill=255)
    pm = np.asarray(pm) > 0
    wide = ndimage.binary_dilation(pm, iterations=POLY_SLACK)
    wide[POLY_SLACK_Y:] = pm[POLY_SLACK_Y:]          # cerca de la rama, poligono exacto
    wide[165:, :100] = pm[165:, :100]                # lado izquierdo de la bellota, poligono exacto
    pm = Image.fromarray(wide.astype(np.uint8) * 255)
    exm = Image.new('L', img.size, 0)
    for ex in exclude: ImageDraw.Draw(exm).polygon(ex, fill=255)
    exm = np.asarray(exm) > 0
    for (x0, y0, x1, y1) in exclude_pale:
        exm[y0:y1, x0:x1] |= (v[y0:y1, x0:x1] > 140) & (s[y0:y1, x0:x1] < 120)
    pm = Image.fromarray(((np.asarray(pm) > 0) & ~exm).astype(np.uint8) * 255)
    green = (h > 38) & (h < 130) & (s > 55)
    # cielo/resplandor claro del fondo (amarillo-verdoso palido): tono 33-95, saturacion baja,
    # claro. El pelo claro de los animales es calido (tono < 30) o gris (saturacion < 20), y el
    # cuerpo azulado del koala es mucho mas oscuro, asi que no entran aqui.
    sky = (h >= 36) & (h <= 95) & (s >= 25) & (s <= 72) & (v > 150)
    fm = Image.new('L', img.size, 0)
    for fp in force: ImageDraw.Draw(fm).polygon(fp, fill=255)
    fm = np.asarray(fm) > 0
    m = ((np.asarray(pm) > 0) & ~green & ~sky) | fm
    m = ndimage.binary_opening(m, structure=np.ones((2, 2)))
    lab, n = ndimage.label(m); sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    m = lab == (np.argmax(sizes) + 1)
    m = ndimage.binary_closing(m, structure=np.ones((4, 4)))
    # rellenar solo huecos pequenos (ojos, detalles del panuelo); los grandes son cielo entre
    # cabeza y cola y deben quedar fuera
    holes = ndimage.binary_fill_holes(m) & ~m
    lab_h, nh = ndimage.label(holes)
    if nh:
        hs = ndimage.sum(np.ones_like(lab_h), lab_h, index=np.arange(1, nh + 1))
        teal_h = (h >= 95) & (h <= 165) & (s >= 20) & (s <= 110) & (v > 120)
        bgc = ndimage.mean((sky | green | teal_h).astype(float), lab_h, index=np.arange(1, nh + 1))
        # huecos diminutos siempre (cuadros del panuelo, brillos); medianos solo si no son de color de fondo
        m |= np.isin(lab_h, np.arange(1, nh + 1)[(hs < 60) | ((hs < 400) & (np.asarray(bgc) < 0.5))])
    m = strip_fringe(m, hsv, keep_boxes, fm) & ~exm
    lab, n = ndimage.label(m); sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    return lab == (np.argmax(sizes) + 1)

# retoques del fondo por moneda: lista de (caja destino, esquina origen). La caja se cubre con la copia de
# otra zona del mismo fondo, con borde suave. En la ardilla: la planta roja y el helecho que asoman tras
# la cola se tapan con el verde azulado liso de mas arriba, y su base con el musgo de la derecha.
BG_PATCH = {}

def patched_bg(n):
    bg = np.asarray(BG).astype(float).copy()
    for (x0, y0, x1, y1), (sx, sy) in BG_PATCH.get(n, ()):
        w, hh = x1 - x0, y1 - y0
        src = np.asarray(BG).astype(float)[sy:sy + hh, sx:sx + w]
        mask = np.zeros((hh, w)); mask[4:-4, 4:-4] = 1.0
        soft = ndimage.gaussian_filter(mask, 2.0)[..., None]
        bg[y0:y1, x0:x1] = bg[y0:y1, x0:x1] * (1 - soft) + src * soft
    return Image.fromarray(np.clip(bg, 0, 255).astype(np.uint8))

previews = []
for n, box in QUADS.items():
    q = SRC.crop(box)
    m = matte(q, POLYS[n], KEEP.get(n, ()), EXCLUDE.get(n, ()), FORCE.get(n, ()), EXCLUDE_PALE.get(n, ()))
    ys, xs = np.where(m); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    s = SCALE
    fg = q.crop((bx0, by0, bx1, by1)).resize((round((bx1 - bx0) * s), round((by1 - by0) * s)), Image.LANCZOS)
    al = Image.fromarray((m[by0:by1, bx0:bx1] * 255).astype(np.uint8)).resize(fg.size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.0))
    dx, dy = ADJUST[n]
    px = round(CENTER_X - fg.width / 2) + dx; py = FEET_Y - fg.height + dy
    canvas = patched_bg(n); canvas.paste(fg, (px, py), al)
    canvas.save(os.path.join(os.environ.get('COINS_OUT', 'img'), f'moneda{n}_fondo.jpg'), quality=95)   # COINS_OUT: carpeta alternativa si el visor bloquea img/
    previews.append(canvas.resize((343, 512)))
    print(f'moneda {n}: silueta {int(m.sum())} px, escala x{s:.2f}, colocado en ({px},{py}) tam {fg.size}')
if len(sys.argv) > 1:
    c = Image.new('RGB', (343 * 4 + 30, 512), 'white')
    for i, p in enumerate(previews): c.paste(p, (i * 353, 0))
    c.save(os.path.join(sys.argv[1], 'coins_4en1.png'))
    # siluetas sobre los cuadrantes, para revisar
    for n, box in QUADS.items():
        q = SRC.crop(box); a = np.asarray(q).astype(float); m = matte(q, POLYS[n], KEEP.get(n, ()), EXCLUDE.get(n, ()), FORCE.get(n, ()), EXCLUDE_PALE.get(n, ()))
        ov = a.copy(); ov[~m] = ov[~m] * 0.35 + np.array([0, 0, 255]) * 0.65
        d = Image.fromarray(ov.astype(np.uint8)); ImageDraw.Draw(d).polygon(POLYS[n], outline=(255, 0, 0))
        d.resize((q.width * 2, q.height * 2), Image.LANCZOS).save(os.path.join(sys.argv[1], f'q_matte_{n}.png'))
