from __future__ import annotations

from pathlib import Path

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QColor, QFont, QFontDatabase, QIcon, QPainter, QPixmap


FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
ORBITRON_FONT_PATH = FONT_DIR / "Orbitron-Bold.ttf"


def _orbitron_family() -> str | None:
    if not ORBITRON_FONT_PATH.exists():
        return None
    font_id = QFontDatabase.addApplicationFont(str(ORBITRON_FONT_PATH))
    if font_id == -1:
        return None
    families = QFontDatabase.applicationFontFamilies(font_id)
    return families[0] if families else None


def app_icon(size: int = 256) -> QIcon:
    family = _orbitron_family() or "Segoe UI"
    pixmap = QPixmap(size, size)
    pixmap.fill(Qt.GlobalColor.transparent)

    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing, True)
    painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
    painter.setBrush(QColor("#000543"))
    painter.setPen(Qt.PenStyle.NoPen)
    painter.drawRoundedRect(0, 0, size, size, size * 0.22, size * 0.22)

    font = QFont(family, int(size * 0.42))
    font.setBold(True)
    font.setLetterSpacing(QFont.SpacingType.AbsoluteSpacing, 0.5)
    painter.setFont(font)
    painter.setPen(QColor("#ffffff"))
    rect = pixmap.rect().adjusted(0, -int(size * 0.03), 0, 0)
    painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, "m")
    painter.end()

    return QIcon(pixmap)


def logo_markup() -> str:
    return (
        '<span style="font-size:54px;">memact</span>'
    )
