"""Suaviza el tono de las barras laterales de una carta ya montada: iguala las variaciones
lentas de color (bandas, manchas) conservando la veta fina, sin tocar hojas ni contornos.
Opcionalmente rellena un parche rectangular de la barra izquierda con madera limpia.
Uso:
  /c/Python310/python img/_work/smooth_bar_tone.py entrada.png salida.png [y0 y1] [parche_izq y0 y1]
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
Y0, Y1 = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (430, 836)
patch = (int(sys.argv[6]), int(sys.argv[7])) if len(sys.argv) > 7 and sys.argv[5] == 'parche_izq' else None

im = Image.open(src).convert('RGBA'); W, H = im.size
rgba = np.asarray(im).astype(float); a = rgba[..., :3]
hsv = np.asarray(im.convert('RGB').convert('HSV')).astype(float); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
green = ndimage.binary_dilation((h > 40) & (h < 125) & (s > 60), iterations=2)
dark = lum < 95                                                   # contornos
WX0, WX1 = 68, 548                                                # ventana: barras a ambos lados

def blur(arr, r):
    return ndimage.gaussian_filter(arr, r, mode='nearest')
def soft(mask, r):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float) / 255.0

out = a.copy()
rng = np.random.default_rng(11)
for side, (bx0, bx1) in {'L': (0, WX0), 'R': (WX1, W)}.items():
    # 1) parche rectangular (solo izquierda): madera limpia con el perfil de columna de la barra de arriba
    if side == 'L' and patch:
        py0, py1 = patch
        ref = a[Y0:py0 - 10, bx0:bx1]
        refmask = ~green[Y0:py0 - 10, bx0:bx1] & (lum[Y0:py0 - 10, bx0:bx1] < 200)
        prof = np.array([np.median(ref[refmask[:, x], x], axis=0) if refmask[:, x].sum() > 10 else np.median(ref[:, x], axis=0) for x in range(bx1 - bx0)])
        keep = green[py0:py1, bx0:bx1]                            # las hojas del parche se conservan
        fill = prof[None, :, :] + rng.normal(0, 2.5, (py1 - py0, bx1 - bx0, 1))
        m = 1 - soft(keep, 0.8)[..., None]
        edge = np.ones((py1 - py0, 1, 1)); edge[:6, 0, 0] = np.linspace(0, 1, 6); edge[-6:, 0, 0] = np.linspace(1, 0, 6)
        m = m * edge
        out[py0:py1, bx0:bx1] = out[py0:py1, bx0:bx1] * (1 - m) + fill * m
        lum[py0:py1, bx0:bx1] = 0.299 * out[py0:py1, bx0:bx1, 0] + 0.587 * out[py0:py1, bx0:bx1, 1] + 0.114 * out[py0:py1, bx0:bx1, 2]
    # 2) igualado de tono a baja frecuencia: escala < 10 px se conserva (veta), > 10 px se aplana
    wood = ~green & ~dark & (lum < 215)
    wood[:Y0] = False; wood[Y1:] = False; wood[:, :bx0] = False; wood[:, bx1:] = False
    wm = wood.astype(float)
    small = np.stack([blur(out[..., c] * wm, 6) for c in range(3)], -1) / np.maximum(blur(wm, 6), 1e-3)[..., None]
    big = np.stack([blur(out[..., c] * wm, 70) for c in range(3)], -1) / np.maximum(blur(wm, 70), 1e-3)[..., None]
    gain = np.clip(big / np.maximum(small, 1), 0.75, 1.3)
    m = soft(wood, 1.0)[..., None]
    # entrada/salida suave en las filas limite
    ramp = np.ones((H, 1, 1)); ramp[:Y0] = 0; ramp[Y1:] = 0
    ramp[Y0:Y0 + 20, 0, 0] = np.linspace(0, 1, 20); ramp[Y1 - 20:Y1, 0, 0] = np.linspace(1, 0, 20)
    m = m * ramp
    out = out * (1 - m) + out * gain * m

res = np.concatenate([np.clip(out, 0, 255), rgba[..., 3:4]], -1).astype(np.uint8)
Image.fromarray(res, 'RGBA').save(dst); print('saved', dst)
