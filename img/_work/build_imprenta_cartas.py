"""Genera pdf/es/imprenta_cartas/: una imagen PNG por carta (823 x 1122 px, con sangrado, sin marcas) con el
nº de copias en el nombre del archivo, más el reverso y LEEME_cantidades.txt, para mandar a una imprenta.

Mismas cartas y cantidades que el mazo de impresión (build_deck_pdf.py: COUNTS, copias por especie, orden y
especies guardadas). Antes de lanzarlo hay que haber regenerado img/cards con compose_all.py.

Uso:  /c/Python310/python img/_work/build_imprenta_cartas.py
"""
import glob
import json
import os
import shutil
import unicodedata

import build_deck_pdf as bd
from pdf_paths import pdf_path

OUT = os.path.join(os.path.dirname(pdf_path("es", "x.pdf")), "imprenta_cartas")
COIN_NAMES = {"coin-1": "Bronce", "coin-2": "Plata", "coin-3": "Oro", "coin-5": "Platino"}


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return s.replace(" ", "_")


def main():
    names = {}
    for p in glob.glob(os.path.join(bd.DATA_DIR, "*.json")):
        c = json.load(open(p, encoding="utf-8"))
        names[c["id"]] = c.get("name", c["id"])
    names.update(COIN_NAMES)

    deck, ordered_ids, costs = bd.build_deck()
    total = len(deck)

    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(os.path.join(OUT, "*.png")) + glob.glob(os.path.join(OUT, "*.txt")):
        os.remove(f)

    shutil.copyfile(bd.BACK_PATH, os.path.join(OUT, f"00_REVERSO_x{total}.png"))
    rows = []
    for i, cid in enumerate(ordered_ids, 1):
        n = bd.copies_for(cid, costs)
        name = names[cid]
        shutil.copyfile(os.path.join(bd.CARDS_DIR, f"{cid}.png"), os.path.join(OUT, f"{i:02d}_{slug(name)}_x{n}.png"))
        rows.append((name, n))

    full, rest = divmod(total, 18)
    planchas = f"{full} planchas de 18" + (f" y una de {rest}" if rest else "")
    lines = [
        "ANIMALS - cartas para imprimir (edicion clasica)",
        "",
        "Formato: una imagen por carta, PNG, 823 x 1122 px (300 ppp), con sangrado y sin marcas de corte.",
        "Carta terminada: 63,5 x 88,9 mm (750 x 1050 px). Sangrado aprox. 3 mm por lado (unos 73 x 72 px extra en total).",
        "Esquinas redondeadas en la carta terminada. Todas las cartas llevan el mismo reverso (00_REVERSO).",
        "El numero tras la x en el nombre del archivo es el numero de copias.",
        "",
        f"{'Carta':<22} Copias",
    ]
    lines += [f"{name:<22} {n:>6}" for name, n in rows]
    lines += [f"{'REVERSO (todas)':<22} {total:>6}", "", f"{len(rows)} modelos distintos, {total} cartas ({planchas})."]
    with open(os.path.join(OUT, "LEEME_cantidades.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print(OUT, len(rows), "modelos,", total, "cartas")


if __name__ == "__main__":
    main()
