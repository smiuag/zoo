"""PDF de revision (NO oficial): todas las cartas con tipo mascota o dinosaurio, 9 por pagina A4 y ordenadas
por coste. Lee las cartas ya compuestas de la edicion completa, asi que antes hay que ejecutar
  ZOO_EDITION=full /c/Python310/python img/_work/compose_all.py
Uso:  /c/Python310/python img/_work/build_pdf_mascotas_dinosaurios.py  -> img/cartas_mascotas_dinosaurios.pdf
"""
import glob, json, os, sys
from PIL import Image, JpegImagePlugin  # noqa: F401  (el PDF de Pillow necesita el plugin JPEG registrado)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import print_layout as pl

DATA = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
CARDS = r"C:\proyectos\Claude\zoo\img\cards_completa"
OUT = r"C:\proyectos\Claude\zoo\img\cartas_mascotas_dinosaurios.pdf"

cards = []
for p in glob.glob(os.path.join(DATA, "*.json")):
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    if {"pet", "dinosaur"} & set(d.get("habitats", [])):
        cards.append(d)
cards.sort(key=lambda d: (d["marketCost"], d["victoryPoints"], d["id"]))
paths = [os.path.join(CARDS, d["id"] + ".png") for d in cards]
grid = pl.build_grid_for(paths[0])
pages = [pl.make_page(grid, paths[i:i + grid.per_page]) for i in range(0, len(paths), grid.per_page)]
pages[0].save(OUT, save_all=True, append_images=pages[1:], resolution=300.0)
print(OUT, len(cards), "cartas,", len(pages), "paginas,", grid.per_page, "por pagina")
