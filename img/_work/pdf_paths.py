"""Donde van TODOS los PDF que generan los scripts de esta carpeta (desde 2026-10-05, decision del
usuario): <raiz del repo>/pdf/<idioma>/, una carpeta por idioma ("es", "en"), nunca sueltos en img/.
Las pruebas y comparativas van a pdf/<idioma>/pruebas/. Los nombres de archivo no cambian (los ingleses
siguen acabando en _en).

Los PDF intermedios que solo usa otro script (la capa sin fondo del reglamento) no son entregables: se
quedan en img/_work/ con un guion bajo delante.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF_ROOT = os.path.join(ROOT, "pdf")


def pdf_path(lang, name, sub=None):
    """Ruta de pdf/<lang>/[<sub>/]<name>, creando la carpeta si falta."""
    folder = os.path.join(PDF_ROOT, lang, sub) if sub else os.path.join(PDF_ROOT, lang)
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, name)
