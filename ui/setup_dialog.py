from __future__ import annotations

import webbrowser

from PyQt6.QtCore import Qt
from PyQt6.QtWidgets import (
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from core.browser_setup import BrowserInstall
from ui.branding import app_icon
from ui.fonts import body_font
from ui.window_effects import apply_native_window_theme


def _dialog_badge_font(point_size: int = 11):
    return body_font(point_size)


class BrowserSetupDialog(QDialog):
    def __init__(
        self,
        browsers: list[BrowserInstall],
        on_setup,
        is_browser_ready=None,
        browser_status=None,
        parent=None,
    ) -> None:
        super().__init__(parent)
        self.on_setup = on_setup
        ready_check = is_browser_ready or (lambda _browser: False)
        self.browser_status = browser_status or (lambda browser: "ready" if ready_check(browser) else "setup")
        self.browsers = [browser for browser in browsers if self.browser_status(browser) != "ready"]
        self.setModal(True)
        self.setWindowTitle("Browser extension setup")
        self.setMinimumWidth(660)
        self.setFont(body_font(12))
        self.setWindowIcon(app_icon())

        self.setStyleSheet(
            """
            QDialog {
                background: #00011B;
            }
            QWidget#Root {
                background: #00011B;
                color: #ffffff;
            }
            QFrame#Panel {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 24px;
            }
            QLabel#Title {
                color: #ffffff;
                font-size: 24px;
            }
            QLabel#Body {
                color: rgba(255, 255, 255, 0.84);
                font-size: 14px;
            }
            QFrame#HelperCard {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 16px;
            }
            QLabel#HelperTitle {
                color: rgba(255, 255, 255, 0.68);
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QLabel#HelperText {
                color: rgba(255, 255, 255, 0.9);
                font-size: 14px;
            }
            QFrame#BrowserTile {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 16px;
            }
            QLabel#BrowserName {
                color: #ffffff;
                font-size: 16px;
            }
            QLabel#BrowserMeta {
                color: rgba(255, 255, 255, 0.76);
                font-size: 13px;
            }
            QLabel#BrowserUrl {
                color: rgba(255, 255, 255, 0.6);
                font-size: 12px;
            }
            QLabel#DefaultBadge {
                color: rgba(255, 255, 255, 0.94);
                background: rgba(40, 74, 128, 0.10);
                border: 1px solid rgba(40, 74, 128, 0.18);
                border-radius: 11px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: 700;
            }
            QLabel#StatusBadge {
                color: rgba(255, 255, 255, 0.82);
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 11px;
                padding: 3px 10px;
                font-size: 11px;
                font-weight: 700;
            }
            QPushButton {
                background: rgba(40, 74, 128, 0.14);
                color: #ffffff;
                border: 1px solid rgba(88, 126, 188, 0.26);
                border-radius: 12px;
                padding: 0 18px;
                min-width: 118px;
                min-height: 38px;
                font-size: 13px;
                font-weight: 700;
            }
            QPushButton:hover {
                background: rgba(40, 74, 128, 0.20);
                border: 1px solid rgba(106, 150, 218, 0.32);
            }
            QPushButton:pressed {
                background: rgba(40, 74, 128, 0.26);
                border: 1px solid rgba(106, 150, 218, 0.28);
            }
            QPushButton:disabled {
                background: rgba(255, 255, 255, 0.05);
                color: rgba(255, 255, 255, 0.42);
                border: 1px solid rgba(255, 255, 255, 0.10);
            }
            QPushButton#SecondaryButton {
                background: rgba(255, 255, 255, 0.05);
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.12);
                min-width: 108px;
            }
            QPushButton#SecondaryButton:hover {
                background: rgba(255, 255, 255, 0.10);
                border: 1px solid rgba(255, 255, 255, 0.16);
            }
            QScrollArea#BrowserScroll {
                background: transparent;
                border: none;
            }
            QWidget#BrowserScrollContent {
                background: transparent;
            }
            QScrollBar:vertical {
                background: transparent;
                width: 10px;
                margin: 4px 2px 4px 2px;
            }
            QScrollBar::handle:vertical {
                background: rgba(255, 255, 255, 0.22);
                border-radius: 5px;
                min-height: 24px;
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
                background: transparent;
                border: none;
                height: 0;
            }
            """
        )

        root = QWidget(self)
        root.setObjectName("Root")
        outer = QVBoxLayout(root)
        outer.setContentsMargins(20, 20, 20, 20)
        outer.setSpacing(12)

        panel = QFrame()
        panel.setObjectName("Panel")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(20, 20, 20, 20)
        panel_layout.setSpacing(12)

        title = QLabel("Connect your browser")
        title.setObjectName("Title")

        body = QLabel(
            "Pick a browser once. Memact will open the extensions page and the local folder so you can finish setup in a familiar flow."
        )
        body.setObjectName("Body")
        body.setWordWrap(True)

        panel_layout.addWidget(title)
        panel_layout.addWidget(body)

        panel_layout.addWidget(
            self._helper_card(
                "QUICK SETUP",
                "Open setup for your browser. If it asks, enable Developer mode. Then choose Load unpacked and select extension/memact.",
            )
        )

        browser_scroll = QScrollArea()
        browser_scroll.setObjectName("BrowserScroll")
        browser_scroll.setWidgetResizable(True)
        browser_scroll.setFrameShape(QFrame.Shape.NoFrame)
        browser_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        browser_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        browser_scroll.setMaximumHeight(320)

        browser_scroll_content = QWidget()
        browser_scroll_content.setObjectName("BrowserScrollContent")
        browser_scroll_layout = QVBoxLayout(browser_scroll_content)
        browser_scroll_layout.setContentsMargins(0, 0, 0, 0)
        browser_scroll_layout.setSpacing(10)

        if self.browsers:
            for browser in self.browsers:
                tile = self._browser_tile(browser)
                if tile is not None:
                    browser_scroll_layout.addWidget(tile)
        else:
            empty = QLabel("All detected browsers are already connected to Memact.")
            empty.setObjectName("BrowserMeta")
            empty.setWordWrap(True)
            browser_scroll_layout.addWidget(empty)

        browser_scroll_layout.addStretch(1)
        browser_scroll.setWidget(browser_scroll_content)
        panel_layout.addWidget(browser_scroll)

        footer = QHBoxLayout()
        footer.setSpacing(10)
        help_button = QPushButton("Open browser help")
        help_button.setObjectName("SecondaryButton")
        help_button.setCursor(Qt.CursorShape.PointingHandCursor)
        help_button.clicked.connect(self._open_help_for_first_browser)
        later_button = QPushButton("Later")
        later_button.setObjectName("SecondaryButton")
        later_button.setCursor(Qt.CursorShape.PointingHandCursor)
        later_button.clicked.connect(self.accept)
        footer.addWidget(help_button)
        footer.addStretch(1)
        footer.addWidget(later_button)
        panel_layout.addLayout(footer)

        outer.addWidget(panel)

        dialog_layout = QVBoxLayout(self)
        dialog_layout.setContentsMargins(0, 0, 0, 0)
        dialog_layout.addWidget(root)

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        apply_native_window_theme(self)

    def _helper_card(self, title: str, text: str) -> QFrame:
        card = QFrame()
        card.setObjectName("HelperCard")
        layout = QVBoxLayout(card)
        layout.setContentsMargins(14, 12, 14, 12)
        layout.setSpacing(6)
        heading = QLabel(title)
        heading.setObjectName("HelperTitle")
        label = QLabel(text)
        label.setObjectName("HelperText")
        label.setWordWrap(True)
        layout.addWidget(heading)
        layout.addWidget(label)
        return card

    def _browser_tile(self, browser: BrowserInstall) -> QFrame:
        tile = QFrame()
        tile.setObjectName("BrowserTile")
        layout = QHBoxLayout(tile)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(12)

        text_col = QVBoxLayout()
        text_col.setSpacing(4)

        title_row = QHBoxLayout()
        title_row.setSpacing(8)
        name = QLabel(browser.name)
        name.setObjectName("BrowserName")
        title_row.addWidget(name)
        status = self.browser_status(browser)
        if browser.is_default:
            default_badge = QLabel("Default browser")
            default_badge.setObjectName("DefaultBadge")
            default_badge.setFont(_dialog_badge_font())
            title_row.addWidget(default_badge)
        if status == "ready":
            ready = QLabel("Connected")
            ready.setObjectName("StatusBadge")
            ready.setFont(_dialog_badge_font())
            title_row.addWidget(ready)
        title_row.addStretch(1)

        if status == "ready":
            meta_text = "Extension detected and connected to Memact."
        elif status == "update":
            meta_text = "Extension detected. An update is available."
        elif browser.is_default and browser.supported:
            meta_text = "Default browser detected locally. Memact can guide setup."
        elif browser.supported:
            meta_text = "Detected locally. Memact can guide setup."
        else:
            meta_text = "Detected locally, but automatic setup is not supported."

        meta = QLabel(meta_text)
        meta.setObjectName("BrowserMeta")
        meta.setWordWrap(True)

        url_label = QLabel(browser.extensions_url)
        url_label.setObjectName("BrowserUrl")
        url_label.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)

        text_col.addLayout(title_row)
        text_col.addWidget(meta)
        text_col.addWidget(url_label)

        setup_label = "Update" if status == "update" else "Open setup"
        setup_button = QPushButton(setup_label)
        setup_button.setEnabled(browser.supported)
        setup_button.setCursor(Qt.CursorShape.PointingHandCursor)
        setup_button.clicked.connect(
            lambda _checked=False, selected=browser: self._handle_setup(selected)
        )

        layout.addLayout(text_col, 1)
        layout.addWidget(setup_button, 0, Qt.AlignmentFlag.AlignVCenter)
        return tile

    def _handle_setup(self, browser: BrowserInstall) -> None:
        self.on_setup(browser)
        self.accept()

    def _open_help_for_first_browser(self) -> None:
        for browser in self.browsers:
            if browser.help_url:
                webbrowser.open(browser.help_url)
                break
