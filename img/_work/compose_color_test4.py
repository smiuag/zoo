import colorsys
import os
import compose_all as ca

OUT_DIR = r"C:\proyectos\Claude\zoo\img\cards_colortest4"
os.makedirs(OUT_DIR, exist_ok=True)

PURPLE_HUE = 280 / 360
GOLD_HUE = 46 / 360  # dorado-amarillo puro, no marrón


def build_palette(n):
    """Igual que la tanda anterior para los morados, pero los dorados ahora
    van mucho más saturados y claros (más amarillos, algunos casi chillones)
    en vez de quedarse en un marrón apagado."""
    palette = []
    half = (n + 1) // 2
    for i in range(n):
        is_purple = i % 2 == 0
        step = i // 2
        total_steps = half if is_purple else n // 2
        t = step / max(total_steps - 1, 1)
        if is_purple:
            hue = PURPLE_HUE
            sat = 0.55 + 0.35 * t
            val = 0.32 + 0.30 * (1 - t)
        else:
            hue = GOLD_HUE
            sat = 0.85 + 0.15 * t
            val = 0.55 + 0.40 * t  # el más chillón queda al final del rango
        r, g, b = colorsys.hsv_to_rgb(hue, sat, val)
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
