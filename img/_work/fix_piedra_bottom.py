"""Aclara la piedra oscura de la parte baja del marco (piedra.jpg) para que
iguale el tono de la piedra superior. Ganancia local en 2D (esquinas incluidas).
Uso:
  /c/Python310/python img/_work/fix_piedra_bottom.py "img/Nueva carpeta/piedra.jpg" out.png
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.asarray(im).astype(float); H, W, _ = a.shape
hsv = np.asarray(im.convert('HSV')).astype(float); h, s, v = hsv[...,0], hsv[...,1], hsv[...,2]
green = (h > 40) & (h < 120) & (s > 80)          # hojas y lianas: no tocar
stone = (~green) & (v < 205)                      # piedra (excluye pergamino/blanco)
stone[650:969, 60:660] = False                    # pergamino completo (con su linea y borde): no tocar
ref = a[0:75][stone[0:75] & (v[0:75] > 110)]      # piedra clara de referencia (arriba)
target = ref.mean(0) * 1.07                       # un pelin mas claro que la referencia

def blur(arr, r):
    """Gaussian blur separable en numpy (PIL no filtra imagenes float)."""
    k = np.exp(-0.5 * (np.arange(-3*r, 3*r+1) / r) ** 2); k /= k.sum()
    pad = 3*r
    tmp = np.pad(arr, ((0,0),(pad,pad)), mode='edge')
    tmp = np.apply_along_axis(lambda row: np.convolve(row, k, mode='valid'), 1, tmp)
    tmp = np.pad(tmp, ((pad,pad),(0,0)), mode='edge')
    return np.apply_along_axis(lambda col: np.convolve(col, k, mode='valid'), 0, tmp)

# media local de la piedra (convolucion normalizada) -> ganancia local por canal
R = 18
sel = (stone & (v > 40)).astype(float)
wsum = blur(sel, R)
local = np.stack([blur(a[..., c] * sel, R) for c in range(3)], -1) / np.maximum(wsum, 1e-3)[..., None]
gain = np.where(wsum[..., None] > 0.05, target / np.maximum(local, 1), 1.0)
gain = np.clip(gain, 1.0, 3.2)
gain = np.stack([blur(gain[..., c], 6) for c in range(3)], -1)   # suavizar la ganancia

# solo la zona baja, entrando de forma gradual
Y0 = 740
fade = np.clip((np.arange(H) - Y0) / 60.0, 0, 1)[:, None, None]
gain = 1 + (gain - 1) * fade

m = np.asarray(Image.fromarray((stone*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float)/255.0
m[:Y0] = 0
out = a * (1 + (gain - 1) * m[..., None])
sc = np.where(out > 232, 232 + (out - 232) * 0.35, out)
out = np.where(m[..., None] > 0.02, sc, out)
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
print('saved', dst)
