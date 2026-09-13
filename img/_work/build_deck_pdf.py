import glob
import json
import os
from PIL import Image, JpegImagePlugin  # noqa: F401  (forces JPEG codec registration for PDF export)

import print_layout as pl

Image.init()

CARDS_DIR = r"C:\proyectos\Claude\zoo\img\cards"
DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
OUT_PDF = r"C:\proyectos\Claude\zoo\img\mazo_impresion.pdf"
BACK_PATH = os.path.join(CARDS_DIR, "_back.png")

# Copias pedidas para esta tirada de impresión.
COUNTS = {
    "sloth": 21,
    # 42 en vez de las 49 (7×7) "de libro": el Halcón (nueva especie,
    # coste 6) sumó +7 cartas al total y lo desajustaba de múltiplo de 18
    # (385) — se le resta aquí, a la moneda de bronce, para no tocar el
    # recuento de ninguna especie (ver [[print_deck_multiple_of_18]]).
    "coin-1": 42,
    "coin-2": 20,
    "coin-3": 15,
    "coin-5": 9,
}
# Igual que el motor (ver createGame en engine.ts), escalado a una tirada
# de 7 jugadores: nº jugadores + 2 para el resto, nº jugadores para las
# caras (coste 5+, escasez real). De ahí también los 21 Perezosos (7×3)
# del mazo inicial repartidos en COUNTS más abajo (coin-1 ya no seguía esa
# proporción exacta, ver el comentario junto a él).
PRINT_PLAYERS = 7
DEFAULT_ANIMAL_COPIES = PRINT_PLAYERS + 2  # especies de coste < 5
HIGH_COST_ANIMAL_COPIES = PRINT_PLAYERS  # especies de coste 5 o más


def load_costs():
    costs = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            card = json.load(f)
        costs[card["id"]] = card.get("marketCost", 0)
    return costs


# Las 4 monedas van siempre las primeras (en este orden), delante de
# cualquier animal aunque coincida en coste.
COIN_ORDER = {"coin-1": 0, "coin-2": 1, "coin-3": 2, "coin-5": 3}


def sort_key(cid, costs):
    if cid in COIN_ORDER:
        return (0, COIN_ORDER[cid])
    return (1, costs.get(cid, 0), cid)


def copies_for(cid, costs):
    if cid in COUNTS:
        return COUNTS[cid]
    return HIGH_COST_ANIMAL_COPIES if costs.get(cid, 0) >= 5 else DEFAULT_ANIMAL_COPIES


def build_deck():
    costs = load_costs()
    png_ids = [
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(CARDS_DIR, "*.png"))
        if p != BACK_PATH
    ]

    ordered_ids = sorted(png_ids, key=lambda cid: sort_key(cid, costs))

    deck = []
    for cid in ordered_ids:
        deck.extend([os.path.join(CARDS_DIR, f"{cid}.png")] * copies_for(cid, costs))
    return deck, ordered_ids, costs


_back_tile = Image.open(BACK_PATH).convert("RGB")


def make_back_page(grid, count):
    """`count` puede ser menor que grid.per_page en la última hoja: solo se
    pintan los reversos de las cartas que de verdad tienen frente en esa
    hoja (con sus marcas de corte correspondientes)."""
    return pl.make_page(grid, [_back_tile] * count)


def main():
    deck, ordered_ids, costs = build_deck()
    grid = pl.build_grid_for(BACK_PATH)
    n_pages = pl.n_pages_for(grid, len(deck))
    # Frente y reverso alternados (frente1, reverso1, frente2, reverso2...)
    # para que la impresión a doble cara automática empareje cada hoja sin
    # tener que dar la vuelta al taco de papel a mano.
    all_pages = []
    for p in range(n_pages):
        chunk = deck[p * grid.per_page:(p + 1) * grid.per_page]
        all_pages.append(pl.make_page(grid, chunk))
        all_pages.append(make_back_page(grid, len(chunk)))
        print(f"page {p+1}/{n_pages}: {len(chunk)} cards")

    # resolution=300: las paginas son A4 a 300 ppp (2480x3508 px); sin esto Pillow las declara a
    # 72 ppp y el PDF sale como una pagina de 875x1238 mm.
    all_pages[0].save(OUT_PDF, save_all=True, append_images=all_pages[1:], resolution=300.0)

    print(
        f"\nSaved {OUT_PDF} ({len(all_pages)} páginas alternadas frente/reverso, "
        f"{len(deck)} cartas, {grid.cols}x{grid.rows} por página)"
    )
    print("\nResumen de copias:")
    for cid in ordered_ids:
        n = copies_for(cid, costs)
        print(f"  {cid:14} x{n}  (coste {costs.get(cid, 0)})")


if __name__ == "__main__":
    main()
