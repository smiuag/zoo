import os
import compose_all as ca

OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards_colortest"
os.makedirs(OUT_DIR, exist_ok=True)

# Paleta de colores bien distintos entre sí (evitando tonos casi blancos o
# demasiado claros, para que el número siga siendo legible sobre el fondo
# crema de la insignia). Una carta = un color, para poder comparar.
PALETTE = [
    (139, 94, 24),   # marrón (el original, de referencia)
    (178, 34, 34),   # rojo ladrillo
    (0, 100, 0),     # verde bosque
    (25, 25, 112),   # azul medianoche
    (128, 0, 128),   # púrpura
    (204, 85, 0),    # naranja quemado
    (0, 105, 92),    # verde azulado (teal oscuro)
    (139, 0, 139),   # magenta oscuro
    (70, 70, 70),    # gris carbón
    (184, 134, 11),  # dorado oscuro
    (178, 34, 90),   # frambuesa
    (0, 71, 133),    # azul acero
    (85, 107, 47),   # verde oliva
    (139, 26, 26),   # rojo óxido
    (72, 61, 139),   # azul violeta oscuro
    (160, 82, 45),   # siena
    (0, 90, 90),     # cian oscuro
    (128, 60, 0),    # marrón cobrizo
    (99, 33, 66),    # ciruela
    (34, 87, 122),   # azul petróleo
    (120, 20, 20),   # granate
    (46, 90, 39),    # verde musgo
    (90, 60, 130),   # violeta grisáceo
]


def main():
    cards = ca.load_cards()
    generated = []
    idx = 0
    for card in cards:
        cid = card["id"]
        ctype = card["type"]
        color = PALETTE[idx % len(PALETTE)]
        if ctype == "animal":
            photo = os.path.join(ca.IMG_DIR, ca.SPECIES_PHOTO[card["species"]])
            name = card["name"]
            type_label = " - ".join(ca.HABITAT_ES[h] for h in ca.HABITAT_ORDER if h in card["habitats"])
            cost = "-" if card["species"] in ca.NOT_PURCHASABLE_SPECIES else card["marketCost"]
            pv = card["victoryPoints"]
            text = card["text"]
        elif ctype == "coin":
            photo = os.path.join(ca.IMG_DIR, ca.COIN_PHOTO[cid])
            name = card["name"]
            type_label = "Moneda"
            cost = card["marketCost"] if card.get("marketCost") else "-"
            pv = card["victoryPoints"] or None
            text = card["text"]
        else:
            continue

        out_path = os.path.join(OUT_DIR, f"{cid}.png")
        ca.compose_generic(photo, name, type_label, cost, pv, text, out_path, is_coin=(ctype == "coin"), badge_color=color)
        generated.append((cid, color, out_path))
        idx += 1
        print(f"generated {cid} color={color}")

    print(f"\nTotal: {len(generated)} cards")
    return generated


if __name__ == "__main__":
    main()
