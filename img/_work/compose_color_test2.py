import colorsys
import os
import compose_all as ca

OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards_colortest2"
os.makedirs(OUT_DIR, exist_ok=True)


def build_palette(n):
    """N tonos repartidos uniformemente por toda la rueda de color (hues
    equiespaciados), saturación alta y valor medio-bajo para que el número
    siga contrastando bien sobre el fondo crema de la insignia."""
    palette = []
    for i in range(n):
        hue = i / n
        r, g, b = colorsys.hsv_to_rgb(hue, 0.80, 0.55)
        palette.append((int(r * 255), int(g * 255), int(b * 255)))
    return palette


def main():
    cards = ca.load_cards()
    palette = build_palette(len(cards))
    generated = []
    idx = 0
    for card in cards:
        cid = card["id"]
        ctype = card["type"]
        color = palette[idx % len(palette)]
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
