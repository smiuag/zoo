"""Aplica a una plantilla el aclarado de la version "media" (rellenos un 22% mas claros y un
8% menos saturados, lineas oscuras intactas), el mismo que usan las plantillas de
img/templates/medias. Uso:
  /c/Python310/python img/_work/lighten_template.py entrada.jpg salida.png [amount] [desat]
"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
amount = float(sys.argv[3]) if len(sys.argv) > 3 else 0.22
desat = float(sys.argv[4]) if len(sys.argv) > 4 else 0.92

def lighten(arr, amount, desat, lo=60, hi=170):
    lum0 = 0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]
    k = np.clip((lum0 - lo) / (hi - lo), 0, 1); k = (k * k * (3 - 2 * k))[..., None]
    x = 255 - (255 - arr) * (1 - amount * k)
    lum = (0.299 * x[..., 0] + 0.587 * x[..., 1] + 0.114 * x[..., 2])[..., None]
    return lum + (x - lum) * (1 - (1 - desat) * k)

im = Image.open(src).convert('RGB')
out = lighten(np.asarray(im).astype(float), amount, desat)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
print('saved', dst)
