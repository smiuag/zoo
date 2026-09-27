"""Prepara el emblema de la portada del reglamento a partir de img/portada.png
(el original del usuario, que NO se toca): recorta el blanco/transparente que
sobra, aviva los colores y lo guarda en img/portada_viva.png, que es lo que
usan instrucciones.html e instrucciones_en.html.

Uso:  /c/Python310/python img/_work/build_portada.py [saturacion] [contraste] [--force]
"""
import os
import sys

import numpy as np
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "portada.png")
OUT = os.path.join(HERE, "..", "portada_viva.png")
NUMS = [x for x in sys.argv[1:] if not x.startswith("--")]
SATURATION = float(NUMS[0]) if len(NUMS) > 0 else 1.4
CONTRAST = float(NUMS[1]) if len(NUMS) > 1 else 1.1
PAD = 6          # px de aire alrededor del emblema
UPSCALE = 3      # el original es pequeño (emblema de ~280 px): se amplía para que no pixele

# 2026-09-27: el usuario retoca portada_viva.png A MANO despues de generarla. Este script
# la pisaria, asi que solo escribe si no existe o si se pasa --force.
if os.path.exists(OUT) and "--force" not in sys.argv:
    sys.exit("portada_viva.png ya existe y puede llevar retoques a mano: usa --force para regenerarla")
im = Image.open(SRC).convert("RGBA")
a = np.asarray(im)
ys, xs = np.where(a[..., 3] > 20)
box = (max(xs.min() - PAD, 0), max(ys.min() - PAD, 0), min(xs.max() + PAD + 1, im.width), min(ys.max() + PAD + 1, im.height))
im = im.crop(box)
im = im.resize((im.width * UPSCALE, im.height * UPSCALE), Image.LANCZOS)

alpha = im.getchannel("A")
rgb = im.convert("RGB")
rgb = ImageEnhance.Color(rgb).enhance(SATURATION)
rgb = ImageEnhance.Contrast(rgb).enhance(CONTRAST)
out = rgb.convert("RGBA")
out.putalpha(alpha)
out.save(OUT)
print("saved", os.path.abspath(OUT), out.size, f"saturacion={SATURATION} contraste={CONTRAST}")
