import numpy as np
from PIL import Image, ImageFilter

CARD_W, CARD_H = 615, 878  # mismo tamaño que las cartas compuestas (template3.png)
BACK_LOGO_PATH = r"C:\proyectos\Claude\zoo\img\back.jpg"
OUT_PATH = r"C:\proyectos\Claude\zoo\img\cards\_back.png"

BACKGROUND = (255, 255, 255)  # fondo blanco liso

# El logo ocupa como mucho este % del ancho de la carta: deja margen de
# sobra a los lados por si la impresión no queda perfectamente centrada.
LOGO_WIDTH_RATIO = 0.66 * 1.2


def make_transparent_logo(path, blur=2):
    """El logo viene en JPG sobre fondo blanco sólido: lo convierte a RGBA
    haciendo transparente el fondo (según distancia a blanco), con un
    desenfoque suave del canal alfa para que el borde no quede dentado."""
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    rgb = arr[:, :, :3].astype(int)
    dist_from_white = 255 - rgb.min(axis=2)
    alpha = np.clip(dist_from_white * 3, 0, 255).astype("uint8")
    arr[:, :, 3] = alpha
    out = Image.fromarray(arr, "RGBA")
    a = out.split()[3].filter(ImageFilter.GaussianBlur(blur))
    out.putalpha(a)
    return out.crop(out.getbbox())


def compose_back():
    card = Image.new("RGB", (CARD_W, CARD_H), BACKGROUND)

    logo = make_transparent_logo(BACK_LOGO_PATH)
    target_w = int(CARD_W * LOGO_WIDTH_RATIO)
    scale = target_w / logo.width
    logo = logo.resize((target_w, int(logo.height * scale)), Image.LANCZOS)

    x = (CARD_W - logo.width) // 2
    y = (CARD_H - logo.height) // 2
    card.paste(logo, (x, y), logo)

    card.save(OUT_PATH)
    print(f"Saved {OUT_PATH} ({card.size[0]}x{card.size[1]}, logo {logo.size[0]}x{logo.size[1]})")


if __name__ == "__main__":
    compose_back()
