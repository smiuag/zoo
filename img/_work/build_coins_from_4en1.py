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
    3: [(88,118),(90,104),(100,104),(104,116),(140,110),(145,36),(158,40),(172,62),(195,70),(218,58),(232,34),(244,60),(252,95),(262,105),(280,90),(300,95),(313,125),(310,170),(295,205),(260,232),(245,248),(225,262),(195,272),(165,270),(140,268),(118,262),(90,240),(66,215),(58,175),(64,140),(80,122)],
    5: [(92,125),(94,112),(108,112),(112,124),(118,118),(118,80),(135,58),(165,66),(200,55),(235,50),(262,60),(270,100),(258,140),(268,180),(272,235),(258,268),(225,282),(185,286),(150,274),(118,262),(88,248),(66,220),(58,185),(60,150),(75,128)],
}
SCALE = 1.86            # misma escala para los cuatro (la que deja a la ardilla en ~470 px de ancho)
FEET_Y = 692            # fila del fondo donde apoyan los pies (rama)
CENTER_X = 355          # centro horizontal en el fondo
ADJUST = {1: (0, 0), 2: (0, 0), 3: (0, 0), 5: (0, 0)}   # (dx, dy) de ajuste fino por moneda
# zonas (x0, y0, x1, y1) del cuadrante donde el pelo claro llega al borde sin linea oscura (orejas
# del panda rojo): ahi el fleco palido solo se quita en los 2 px mas exteriores
KEEP = {1: [(130, 50, 160, 102), (225, 60, 266, 112)]}

def strip_fringe(m, hsv, keep_boxes):
    """Quita el fleco de fondo palido que queda pegado a la silueta: pixeles claros y poco
    saturados del borde (hasta 10 px) que se alcanzan desde el exterior sin cruzar ninguna linea
    oscura ni ningun color intenso (los contornos del dibujo hacen de barrera, asi que el pelo
    claro de dentro de las orejas o los brillos del rabito de la bellota se conservan)."""
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    dark = (v < 150) | (s > 100)
    pale = ~dark & (v > 135) & (s <= 90) & (h >= 22) & (h <= 140)
    band = m & ~ndimage.binary_erosion(m, iterations=10)
    lab, _ = ndimage.label(~m | (band & pale))
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])); edge = edge[edge > 0]
    rm = np.isin(lab, edge) & m
    if keep_boxes:
        thin = m & ~ndimage.binary_erosion(m, iterations=2)
        for x0, y0, x1, y1 in keep_boxes:
            rm[y0:y1, x0:x1] &= thin[y0:y1, x0:x1]
    return m & ~rm

def matte(img, poly, keep_boxes=()):
    hsv = np.asarray(img.convert('HSV')).astype(float); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    pm = Image.new('L', img.size, 0); ImageDraw.Draw(pm).polygon(poly, fill=255)
    green = (h > 38) & (h < 130) & (s > 55)
    # cielo/resplandor claro del fondo (amarillo-verdoso palido): tono 33-95, saturacion baja,
    # claro. El pelo claro de los animales es calido (tono < 30) o gris (saturacion < 20), y el
    # cuerpo azulado del koala es mucho mas oscuro, asi que no entran aqui.
    sky = (h >= 33) & (h <= 95) & (s >= 18) & (s <= 72) & (v > 150)
    m = (np.asarray(pm) > 0) & ~green & ~sky
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
        m |= np.isin(lab_h, np.arange(1, nh + 1)[hs < 400])
    m = strip_fringe(m, hsv, keep_boxes)
    lab, n = ndimage.label(m); sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    return lab == (np.argmax(sizes) + 1)

previews = []
for n, box in QUADS.items():
    q = SRC.crop(box)
    m = matte(q, POLYS[n], KEEP.get(n, ()))
    ys, xs = np.where(m); bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    s = SCALE
    fg = q.crop((bx0, by0, bx1, by1)).resize((round((bx1 - bx0) * s), round((by1 - by0) * s)), Image.LANCZOS)
    al = Image.fromarray((m[by0:by1, bx0:bx1] * 255).astype(np.uint8)).resize(fg.size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.0))
    dx, dy = ADJUST[n]
    px = round(CENTER_X - fg.width / 2) + dx; py = FEET_Y - fg.height + dy
    canvas = BG.copy(); canvas.paste(fg, (px, py), al)
    canvas.save(f'img/moneda{n}_fondo.jpg', quality=95)
    previews.append(canvas.resize((343, 512)))
    print(f'moneda {n}: silueta {int(m.sum())} px, escala x{s:.2f}, colocado en ({px},{py}) tam {fg.size}')
if len(sys.argv) > 1:
    c = Image.new('RGB', (343 * 4 + 30, 512), 'white')
    for i, p in enumerate(previews): c.paste(p, (i * 353, 0))
    c.save(os.path.join(sys.argv[1], 'coins_4en1.png'))
    # siluetas sobre los cuadrantes, para revisar
    for n, box in QUADS.items():
        q = SRC.crop(box); a = np.asarray(q).astype(float); m = matte(q, POLYS[n], KEEP.get(n, ()))
        ov = a.copy(); ov[~m] = ov[~m] * 0.35 + np.array([0, 0, 255]) * 0.65
        d = Image.fromarray(ov.astype(np.uint8)); ImageDraw.Draw(d).polygon(POLYS[n], outline=(255, 0, 0))
        d.resize((q.width * 2, q.height * 2), Image.LANCZOS).save(os.path.join(sys.argv[1], f'q_matte_{n}.png'))
