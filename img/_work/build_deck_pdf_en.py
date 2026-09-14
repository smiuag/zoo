import glob
import json
import os
from PIL import Image, JpegImagePlugin  # noqa: F401  (forces JPEG codec registration for PDF export)

import print_layout as pl

Image.init()

CARDS_DIR = r"C:\proyectos\Claude\zoo\img\cards_en"
DATA_DIR = r"C:\proyectos\Claude\zoo\packages\engine\src\cards\data"
OUT_PDF = r"C:\proyectos\Claude\zoo\img\mazo_impresion_en.pdf"
BACK_PATH = os.path.join(CARDS_DIR, "_back.png")

# English print run: same copy counts as build_deck_pdf.py (double-sided,
# multiple of 18) — only the card art (Spanish vs English text) differs.
COUNTS = {
    "sloth": 21,
    # Ver el mismo ajuste en build_deck_pdf.py: bronce se queda en 49 (7×7)
    # "de libro"; plata/oro/platino ceden los 9 que hacían falta en su
    # lugar (el Cuervo, nueva especie, desajustaba el total de múltiplo de
    # 18).
    "coin-1": 49,
    "coin-2": 13,
    "coin-3": 9,
    "coin-5": 6,
}
# Igual que el motor (ver createGame en engine.ts), escalado a una tirada
# de 7 jugadores: nº jugadores + 2 para el resto, nº jugadores para las
# caras (coste 5+, escasez real).
PRINT_PLAYERS = 7
DEFAULT_ANIMAL_COPIES = PRINT_PLAYERS + 2
HIGH_COST_ANIMAL_COPIES = PRINT_PLAYERS


def load_costs():
    costs = {}
    for path in glob.glob(os.path.join(DATA_DIR, "*.json")):
        with open(path, encoding="utf-8") as f:
            card = json.load(f)
        costs[card["id"]] = card.get("marketCost", 0)
    return costs


COIN_ORDER = {"coin-1": 0, "coin-2": 1, "coin-3": 2}


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
    return pl.make_page(grid, [_back_tile] * count)


def main():
    deck, ordered_ids, costs = build_deck()
    grid = pl.build_grid_for(BACK_PATH)
    n_pages = pl.n_pages_for(grid, len(deck))
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
        f"\nSaved {OUT_PDF} ({len(all_pages)} paginas alternadas frente/reverso, "
        f"{len(deck)} cartas, {grid.cols}x{grid.rows} por página)"
    )
    print("\nResumen de copias:")
    total = 0
    for cid in ordered_ids:
        n = copies_for(cid, costs)
        total += n
        print(f"  {cid:14} x{n}  (coste {costs.get(cid, 0)})")
    print(f"\nTotal cards: {total} (multiple of 18: {total % 18 == 0})")


if __name__ == "__main__":
    main()
