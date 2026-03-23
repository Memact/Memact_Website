import os
import sys
import warnings

os.environ.setdefault("QT_ENABLE_HIGHDPI_SCALING", "0")
os.environ.setdefault("QT_AUTO_SCREEN_SCALE_FACTOR", "0")
os.environ.setdefault("QT_QPA_PLATFORM", "windows:dpiawareness=0")

warnings.filterwarnings(
    "ignore",
    message=r"Apply externally defined coinit_flags: 2",
    module="pywinauto",
)

from PyQt6.QtWidgets import QApplication

sys.coinit_flags = 2

from core.logging_utils import configure_logging
from core.query_engine import warmup_query_engine
from ui.fonts import body_font
from ui.branding import app_icon
from ui.main_window import MainWindow


def main() -> int:
    configure_logging()
    warmup_query_engine()
    app = QApplication(sys.argv)
    app.setApplicationName("Memact")
    app.setFont(body_font(12))
    app.setQuitOnLastWindowClosed(False)
    app.setWindowIcon(app_icon())

    window = MainWindow()
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
