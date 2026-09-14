"""Monta los cuatro animales de las monedas (con su moneda) sobre el fondo comun
img/coins/fondoCoin.jpg. La silueta de cada animal se saca de su imagen alargada
(monedaNAlargada.jpg) con un poligono dibujado a mano mas exclusion del verde del fondo.
Salida: img/monedaN_fondo.jpg (una por moneda) y una vista previa.
Uso:
  /c/Python310/python img/_work/build_coins_on_bg.py [carpeta_preview]
"""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

BG = Image.open('img/coins/fondoCoin.jpg').convert('RGB'); W, H = BG.size
# poligonos (x, y) en coordenadas de la imagen alargada (687x1024), alrededor de animal + moneda
POLYS = {
    1: [(105,470),(112,405),(180,380),(240,375),(290,330),(300,250),(340,240),(370,300),(430,290),(455,245),(470,320),(500,350),(550,340),(600,380),(610,450),(590,540),(560,600),(500,640),(470,690),(400,705),(320,695),(260,665),(200,650),(145,630),(108,600),(105,545)],
    2: [(108,480),(115,405),(170,380),(230,360),(225,290),(270,265),(300,300),(340,280),(400,270),(450,265),(495,290),(500,360),(490,420),(510,470),(525,560),(525,610),(505,650),(470,690),(400,705),(320,695),(260,665),(200,650),(150,625),(112,600),(108,545)],
    3: [(130,480),(140,415),(195,395),(250,385),(285,340),(285,290),(330,300),(380,320),(430,315),(470,295),(500,320),(500,380),(520,430),(560,440),(600,470),(610,540),(590,600),(540,630),(500,660),(470,700),(400,712),(330,702),(270,672),(200,655),(132,610)],
    5: [(150,470),(165,415),(215,395),(265,380),(300,330),(340,300),(400,295),(450,320),(480,380),(470,420),(500,440),(505,520),(495,570),(480,620),(470,665),(430,695),(380,700),(330,690),(300,655),(250,640),(185,610),(150,560)],
}
SHIFT = {1: 0, 2: 0, 3: 0, 5: 0}          # desplazamiento vertical (px) para apoyar los pies en la rama del fondo

def matte(img, poly):
    hsv = np.asarray(img.convert('HSV')).astype(float); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    pm = Image.new('L', img.size, 0); ImageDraw.Draw(pm).polygon(poly, fill=255)
    green = (h > 38) & (h < 130) & (s > 55)
    m = (np.asarray(pm) > 0) & ~green
    m = ndimage.binary_opening(m, structure=np.ones((3, 3)))
    lab, n = ndimage.label(m); sizes = ndimage.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    m = lab == (np.argmax(sizes) + 1)
    return ndimage.binary_fill_holes(ndimage.binary_closing(m, structure=np.ones((5, 5))))

previews = []
for n, poly in POLYS.items():
    src_path = f'img/moneda{n}Alargada.jpg'
    fg_img = Image.open(src_path).convert('RGB'); fg = np.asarray(fg_img).astype(float)
    m = matte(fg_img, poly)
    alpha = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255.0
    dy = SHIFT[n]
    a = np.zeros((H, W)); f = np.zeros((H, W, 3))
    if dy >= 0: a[dy:] = alpha[:H - dy]; f[dy:] = fg[:H - dy]
    else: a[:H + dy] = alpha[-dy:]; f[:H + dy] = fg[-dy:]
    out = np.asarray(BG).astype(float) * (1 - a[..., None]) + f * a[..., None]
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(f'img/moneda{n}_fondo.jpg', quality=95)
    previews.append(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).resize((343, 512)))
    print(f'moneda {n}: silueta {int(m.sum())} px')
if len(sys.argv) > 1:
    c = Image.new('RGB', (343 * 4 + 30, 512), 'white')
    for i, p in enumerate(previews): c.paste(p, (i * 353, 0))
    c.save(os.path.join(sys.argv[1], 'coins_on_bg.png'))
