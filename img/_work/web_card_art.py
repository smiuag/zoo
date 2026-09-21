"""Convierte las ilustraciones planas de img/web/*.jpg (fondo liso crema o blanco) en los PNG del modo
"imagen" de la app: fondo transparente, recortadas al sujeto, 700 px de ancho -> apps/web/public/cards/<id>.png
Uso:  /c/Python310/python img/_work/web_card_art.py [carpeta_de_revision]
El fondo se quita por inundacion desde los bordes: solo se borra lo que se parece al color de fondo Y esta
conectado con el exterior, asi que un animal claro (el perro crema) no se agujerea mientras tenga contorno.
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = r"C:\proyectos\Claude\zoo\img\web"
DST = r"C:\proyectos\Claude\zoo\apps\web\public\cards"
# id de carta -> (archivo, tolerancia de color respecto al fondo)
ART = {
    "dog": ("Perro.jpg", 20), "cat": ("gato.jpg", 20), "diplodocus": ("diplodocus.jpg", 20),
    "tyrannosaurus": ("tiranosaurio.jpg", 20), "pterodactyl": ("terodactilo.jpg", 20), "mosasaurus": ("mosasaurus.jpg", 20),
    # Segunda tanda de la edición completa (2026-09-21)
    "pig": ("cerdos.jpg", 20), "hamster": ("hamster.jpg", 20), "chicken": ("gallina.jpg", 20),
    "hummingbird": ("colibri.jpg", 20), "iguana": ("iguana.jpg", 20), "otter": ("nutria.jpg", 20),
    "plesiosaurus": ("plesiosaurio.jpg", 20), "pteranodon": ("pteranodon.jpg", 20),
    "ostrich": ("avestruz.jpg", 20), "golden-fish": ("pezdorado.jpg", 20), "goose": ("oca.jpg", 20),
}


def cut(path, tol):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(float)
    # fondo local: el degradado/vineta del fondo se estima difuminando mucho la imagen sin el sujeto
    border = np.concatenate([a[:12].reshape(-1, 3), a[-12:].reshape(-1, 3), a[:, :12].reshape(-1, 3), a[:, -12:].reshape(-1, 3)])
    bg0 = np.median(border, axis=0)
    rough = np.abs(a - bg0).max(-1) < tol * 1.6
    w = ndimage.gaussian_filter(rough.astype(float), 40) + 1e-6
    bg = np.stack([ndimage.gaussian_filter(a[..., k] * rough, 40) / w for k in range(3)], -1)
    like_bg = np.abs(a - bg).max(-1) < tol
    lab, _ = ndimage.label(like_bg)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])); edge = edge[edge > 0]
    outside = np.isin(lab, edge)
    # Sombra del suelo (elipse grisacea bajo el animal): se parece menos al fondo que el propio fondo, pero es
    # poco saturada. Se quita solo si se alcanza desde fuera, asi que el contorno del dibujo protege el interior
    # (el pelo crema del perro es mas saturado y ademas queda tras su contorno).
    sat = a.max(-1) - a.min(-1)
    shadow = (np.abs(a - bg).max(-1) < 52) & (sat < 30)
    lab_s, _ = ndimage.label(outside | shadow)
    edge_s = np.unique(np.concatenate([lab_s[0], lab_s[-1], lab_s[:, 0], lab_s[:, -1]])); edge_s = edge_s[edge_s > 0]
    outside = np.isin(lab_s, edge_s)
    subject = ~outside
    subject = ndimage.binary_opening(subject, iterations=2)
    lab2, n = ndimage.label(subject)                                   # solo el sujeto: fuera restos de la sombra del suelo
    if n > 1:
        sizes = ndimage.sum(np.ones_like(lab2), lab2, range(1, n + 1))
        subject = lab2 == (np.argmax(sizes) + 1)
    subject = ndimage.binary_erosion(subject, iterations=1)            # quita el filo del color del fondo
    alpha = Image.fromarray((subject * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert("RGBA"); out.putalpha(alpha)
    ys, xs = np.where(subject); pad = 6
    box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(im.width, xs.max() + pad), min(im.height, ys.max() + pad))
    out = out.crop(box)
    return out.resize((700, round(out.height * 700 / out.width)), Image.LANCZOS), subject, im


if __name__ == "__main__":
    review = sys.argv[1] if len(sys.argv) > 1 else None
    out_dir = os.environ.get("WEB_ART_OUT", DST)
    for cid, (fname, tol) in ART.items():
        png, subject, im = cut(os.path.join(SRC, fname), tol)
        png.save(os.path.join(out_dir, cid + ".png"))
        print(cid, png.size)
        if review:                                                     # contorno de la mascara sobre el original
            a = np.asarray(im).copy()
            a[subject & ~ndimage.binary_erosion(subject, iterations=2)] = [255, 0, 0]
            Image.fromarray(a).save(os.path.join(review, f"webart_{cid}_contorno.png"))
