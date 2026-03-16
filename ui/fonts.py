from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from PyQt6.QtGui import QFont, QFontDatabase


FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
IBM_PLEX_SANS_FONT_PATH = FONT_DIR / "IBMPlexSans-Medium.ttf"
ORBITRON_FONT_PATH = FONT_DIR / "Orbitron-Bold.ttf"


@lru_cache(maxsize=None)
def _load_font_family(font_path: str) -> str | None:
    font_id = QFontDatabase.addApplicationFont(font_path)
    if font_id == -1:
        return None
    families = QFontDatabase.applicationFontFamilies(font_id)
    return families[0] if families else None


def body_font(point_size: int = 11) -> QFont:
    family = None
    if IBM_PLEX_SANS_FONT_PATH.exists():
        family = _load_font_family(str(IBM_PLEX_SANS_FONT_PATH))
    return QFont(family or "IBM Plex Sans", point_size)


def brand_font(point_size: int = 40) -> QFont:
    family = None
    if ORBITRON_FONT_PATH.exists():
        family = _load_font_family(str(ORBITRON_FONT_PATH))
    font = QFont(family or "Segoe UI", point_size)
    font.setBold(True)
    return font
