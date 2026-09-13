"""Iguala el color del marco de una plantilla al de otra de referencia, por clases:
la madera se ajusta a la madera de la referencia y las hojas a sus hojas (media y
desviacion por canal en YCbCr). Las lineas oscuras y el resto se dejan como estan.
Uso:
  /c/Python310/python img/_work/match_frame_colors.py plantilla.jpg referencia.png salida.png
"""
import sys
import numpy as np
from PIL import Image, ImageFilter

src, ref, dst = sys.argv[1:4]

def load(path):
    im = Image.open(path).convert('RGB')
    rgb = np.asarray(im).astype(float)
    ycc = np.asarray(im.convert('YCbCr')).astype(float)
    hsv = np.asarray(im.convert('HSV')).astype(float)
    return rgb, ycc, hsv

def classes(hsv):
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    wood = (h >= 5) & (h <= 36) & (s > 55) & (v > 70) & (v < 225)   # excluye el beige claro del escudo
    green = (h > 40) & (h < 125) & (s > 60) & (v > 50)
    return {'madera': wood, 'hojas': green}

rgb_s, ycc_s, hsv_s = load(src)
rgb_r, ycc_r, hsv_r = load(ref)
cls_s, cls_r = classes(hsv_s), classes(hsv_r)

out_ycc = ycc_s.copy()
for name in cls_s:
    ms, mr = cls_s[name], cls_r[name]
    mu_s, sd_s = ycc_s[ms].mean(0), ycc_s[ms].std(0)
    mu_r, sd_r = ycc_r[mr].mean(0), ycc_r[mr].std(0)
    adj = (ycc_s - mu_s) * (sd_r / np.maximum(sd_s, 1e-3)) + mu_r
    m = np.asarray(Image.fromarray((ms * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float) / 255.0
    m = np.where(ms, np.maximum(m, 0.6), m)[..., None]
    out_ycc = out_ycc * (1 - m) + adj * m
    print(f'{name}: {mu_s.round(0)} -> {mu_r.round(0)} (sd {sd_s.round(0)} -> {sd_r.round(0)})')

out = Image.fromarray(np.clip(out_ycc, 0, 255).astype(np.uint8), 'YCbCr').convert('RGB')
out.save(dst); print('saved', dst)
