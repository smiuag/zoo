"""Especies guardadas temporalmente (SHELVED_SPECIES en
packages/engine/src/engine.ts): no se usan en ningún sitio, tampoco en las
hojas ni en el mazo de impresión. Se lee del motor para tener una sola fuente
de verdad."""
import os
import re

_ENGINE = os.path.join(os.path.dirname(__file__), "..", "..", "packages", "engine", "src", "engine.ts")


def load_shelved():
    with open(_ENGINE, encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"SHELVED_SPECIES\s*=\s*\[(.*?)\]", src, re.S)
    return set(re.findall(r"'([\w-]+)'", m.group(1))) if m else set()


SHELVED = load_shelved()
