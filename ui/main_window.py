from __future__ import annotations

import threading
from pathlib import Path

from PyQt6.QtCore import QObject, QPoint, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QAction, QIcon
from PyQt6.QtWidgets import (
    QApplication,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMenu,
    QMessageBox,
    QScrollArea,
    QPushButton,
    QSpacerItem,
    QSizePolicy,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)

from core.browser_bridge import BrowserBridgeServer, BrowserStateStore
from core.browser_setup import detect_browsers, extension_manual_url, launch_extension_setup
from core.database import init_db
from core.monitor import WindowMonitor
from core.query_engine import (
    ActivitySpan,
    QueryAnswer,
    SearchSuggestion,
    answer_query,
    autocomplete_suggestions,
    dynamic_suggestions,
)
from core.settings import load_settings, save_settings
from ui.branding import app_icon
from ui.fonts import body_font, brand_font
from ui.setup_dialog import BrowserSetupDialog
from ui.window_effects import apply_native_window_theme


SEARCH_ICON_PATH = Path(__file__).resolve().parent.parent / "assets" / "search_icon.svg"
EXTENSION_DIR = Path(__file__).resolve().parent.parent / "extension" / "memact"


class SignalBridge(QObject):
    runtime_ready = pyqtSignal()
    new_event = pyqtSignal()
    query_answer_ready = pyqtSignal(object, int, str)
    suggestions_ready = pyqtSignal(object, int, str, str)


class SearchInput(QLineEdit):
    focused = pyqtSignal()
    blurred = pyqtSignal()
    navigate_up = pyqtSignal()
    navigate_down = pyqtSignal()
    accept_selection = pyqtSignal()
    commit_selection = pyqtSignal()
    escape_pressed = pyqtSignal()

    def focusInEvent(self, event) -> None:  # noqa: N802
        super().focusInEvent(event)
        self.focused.emit()

    def focusOutEvent(self, event) -> None:  # noqa: N802
        super().focusOutEvent(event)
        self.blurred.emit()

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Down:
            self.navigate_down.emit()
            event.accept()
            return
        if event.key() == Qt.Key.Key_Up:
            self.navigate_up.emit()
            event.accept()
            return
        if event.key() == Qt.Key.Key_Escape:
            self.escape_pressed.emit()
            event.accept()
            return
        if event.key() == Qt.Key.Key_Tab and bool(self.property("suggestionSelected")):
            self.commit_selection.emit()
            event.accept()
            return
        if event.key() in (Qt.Key.Key_Return, Qt.Key.Key_Enter):
            if bool(self.property("suggestionSelected")):
                self.accept_selection.emit()
                event.accept()
                return
        super().keyPressEvent(event)


class SuggestionCard(QFrame):
    clicked = pyqtSignal(str)
    hovered = pyqtSignal(str)
    unhovered = pyqtSignal()

    def __init__(self, suggestion: SearchSuggestion, parent=None) -> None:
        super().__init__(parent)
        self._completion = suggestion.completion
        self.setObjectName("SuggestionCard")
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setProperty("hovered", False)
        self.setProperty("active", False)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(6)

        meta = QLabel(suggestion.category.upper())
        meta.setObjectName("SuggestionMeta")
        title = QLabel(suggestion.title)
        title.setObjectName("SuggestionTitle")
        title.setWordWrap(True)
        subtitle = QLabel(suggestion.subtitle)
        subtitle.setObjectName("SuggestionSubtitle")
        subtitle.setWordWrap(True)

        layout.addWidget(meta)
        layout.addWidget(title)
        layout.addWidget(subtitle)

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            self.clicked.emit(self._completion)
        super().mousePressEvent(event)

    def enterEvent(self, event) -> None:  # noqa: N802
        self.setProperty("hovered", True)
        self.style().unpolish(self)
        self.style().polish(self)
        self.hovered.emit(self._completion)
        super().enterEvent(event)

    def leaveEvent(self, event) -> None:  # noqa: N802
        self.setProperty("hovered", False)
        self.style().unpolish(self)
        self.style().polish(self)
        self.unhovered.emit()
        super().leaveEvent(event)


class EvidenceCard(QFrame):
    def __init__(self, span: ActivitySpan, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("EvidenceCard")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 16, 18, 16)
        layout.setSpacing(6)

        title = QLabel(span.label)
        title.setObjectName("EvidenceTitle")
        title.setWordWrap(True)

        app_label = span.application.removesuffix(".exe").replace("_", " ").title()
        meta = QLabel(
            f"{span.start_at.strftime('%b %d')}  |  {span.start_at.strftime('%I:%M %p').lstrip('0')} to {span.end_at.strftime('%I:%M %p').lstrip('0')}  |  {app_label}"
        )
        meta.setObjectName("EvidenceMeta")
        meta.setWordWrap(True)

        snippet = QLabel(span.snippet)
        snippet.setObjectName("EvidenceSnippet")
        snippet.setWordWrap(True)

        reason = QLabel(span.match_reason)
        reason.setObjectName("EvidenceReason")
        reason.setWordWrap(True)

        layout.addWidget(title)
        layout.addWidget(meta)
        layout.addWidget(snippet)
        layout.addWidget(reason)


class GlassInfoDialog(QDialog):
    def __init__(self, *, title: str, text: str, parent=None) -> None:
        super().__init__(parent)
        self.setModal(True)
        self.setWindowTitle(title)
        self.setFont(body_font(12))
        self.resize(560, 240)
        self.setWindowIcon(app_icon())

        self.setStyleSheet(
            """
            QDialog {
                background: #000543;
                color: #ffffff;
            }
            QFrame#DialogPanel {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 24px;
            }
            QLabel#DialogTitle {
                color: #ffffff;
                font-size: 24px;
            }
            QLabel#DialogBody {
                color: #ffffff;
                font-size: 17px;
            }
            QFrame#InfoOrb {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 28px;
            }
            QLabel#InfoGlyph {
                color: #ffffff;
                font-size: 28px;
                font-weight: 600;
            }
            QPushButton {
                background: #0038ff;
                color: #ffffff;
                border: 1px solid #0038ff;
                border-radius: 14px;
                padding: 10px 18px;
                min-width: 110px;
                font-size: 15px;
            }
            QPushButton:hover {
                background: rgba(0, 56, 255, 0.84);
            }
            """
        )

        shell = QVBoxLayout(self)
        shell.setContentsMargins(20, 20, 20, 20)

        panel = QFrame()
        panel.setObjectName("DialogPanel")
        panel_layout = QVBoxLayout(panel)
        panel_layout.setContentsMargins(22, 22, 22, 22)
        panel_layout.setSpacing(18)

        top = QHBoxLayout()
        top.setSpacing(16)

        orb = QFrame()
        orb.setObjectName("InfoOrb")
        orb.setFixedSize(56, 56)
        orb_layout = QVBoxLayout(orb)
        orb_layout.setContentsMargins(0, 0, 0, 0)
        glyph = QLabel("i")
        glyph.setObjectName("InfoGlyph")
        glyph.setAlignment(Qt.AlignmentFlag.AlignCenter)
        orb_layout.addWidget(glyph)

        text_col = QVBoxLayout()
        text_col.setSpacing(10)
        title_label = QLabel(title)
        title_label.setObjectName("DialogTitle")
        body_label = QLabel(text)
        body_label.setObjectName("DialogBody")
        body_label.setWordWrap(True)
        text_col.addWidget(title_label)
        text_col.addWidget(body_label)

        top.addWidget(orb, 0, Qt.AlignmentFlag.AlignTop)
        top.addLayout(text_col, 1)
        panel_layout.addLayout(top)

        actions = QHBoxLayout()
        actions.addStretch(1)
        ok_button = QPushButton("OK")
        ok_button.clicked.connect(self.accept)
        actions.addWidget(ok_button)
        panel_layout.addLayout(actions)

        shell.addWidget(panel)

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        apply_native_window_theme(self)


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("Memact")
        self.resize(1120, 760)
        self.setMinimumSize(880, 620)
        self.setWindowIcon(app_icon())

        self.settings = load_settings()
        self.browser_state_store = BrowserStateStore()
        self.browser_bridge = BrowserBridgeServer(self.browser_state_store)
        self.monitor = WindowMonitor(
            on_new_event=lambda: self._bridge.new_event.emit(),
            browser_state_store=self.browser_state_store,
        )

        self._bridge = SignalBridge()
        self._bridge.runtime_ready.connect(self._finish_runtime_initialization)
        self._bridge.new_event.connect(self._handle_new_event)
        self._bridge.query_answer_ready.connect(self._handle_query_answer_ready)
        self._bridge.suggestions_ready.connect(self._handle_suggestions_ready)

        self._services_started = False
        self._db_ready = False
        self._quitting = False
        self._native_theme_applied = False
        self._last_answer: QueryAnswer | None = None
        self._search_active = False
        self._hero_shifted = False
        self._query_request_id = 0
        self._suggestion_request_id = 0
        self._selected_suggestion_index = -1
        self._visible_suggestion_cards: list[SuggestionCard] = []
        self._typed_query_before_selection = ""
        self._cached_empty_suggestions: list[SearchSuggestion] | None = None
        self._results_mode = False

        self._suggestion_timer = QTimer(self)
        self._suggestion_timer.setSingleShot(True)
        self._suggestion_timer.setInterval(120)
        self._suggestion_timer.timeout.connect(self._kickoff_suggestion_refresh)

        self._hover_reset_timer = QTimer(self)
        self._hover_reset_timer.setSingleShot(True)
        self._hover_reset_timer.setInterval(50)
        self._hover_reset_timer.timeout.connect(self._clear_preview_if_idle)

        self._build_ui()
        self._build_tray()
        self._build_menu()

        self._show_loading_state()
        QTimer.singleShot(300, self._initialize_runtime_async)

    def _build_ui(self) -> None:
        self.setFont(body_font(12))
        self.setStyleSheet(
            """
            QMainWindow {
                background: #000543;
            }
            QWidget#Root {
                background: transparent;
                color: #ffffff;
            }
            QFrame#MenuOrb {
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 24px;
            }
            QPushButton#MenuButton {
                background: transparent;
                color: #ffffff;
                border: none;
                border-radius: 16px;
                padding: 6px 12px;
                font-size: 20px;
            }
            QPushButton#MenuButton:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            QLabel#HeroTitle {
                color: #ffffff;
                font-size: 68px;
                font-weight: 600;
            }
            QLabel#CompactBrand {
                color: #ffffff;
                font-size: 42px;
                font-weight: 700;
            }
            QLineEdit#SearchInput {
                background: transparent;
                color: #ffffff;
                border: none;
                padding: 0;
                font-size: 24px;
                selection-background-color: #0038ff;
            }
            QLineEdit#SearchInput[empty="true"] {
                color: rgba(255, 255, 255, 0.56);
            }
            QLineEdit#SearchInput[preview="true"] {
                color: rgba(255, 255, 255, 0.62);
            }
            QLineEdit#SearchInput:focus {
                background: transparent;
            }
            QPushButton#SearchButton {
                background: transparent;
                border: none;
                padding: 0;
            }
            QPushButton#SearchButton:hover {
                background: rgba(255, 255, 255, 0.08);
                border-radius: 12px;
            }
            QFrame#SuggestionDock {
                background: rgba(5, 16, 79, 0.975);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-top: none;
                border-bottom-left-radius: 24px;
                border-bottom-right-radius: 24px;
                margin-top: -2px;
            }
            QScrollArea#SuggestionScroll {
                background: transparent;
                border: none;
            }
            QScrollArea#SuggestionScroll QWidget {
                background: transparent;
            }
            QScrollBar:vertical {
                background: transparent;
                width: 10px;
                margin: 6px 2px 6px 2px;
            }
            QScrollBar::handle:vertical {
                background: rgba(255, 255, 255, 0.22);
                border-radius: 5px;
                min-height: 28px;
            }
            QScrollBar::handle:vertical:hover {
                background: rgba(255, 255, 255, 0.34);
            }
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
            QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {
                background: transparent;
                border: none;
                height: 0;
            }
            QLabel#SuggestionHeading {
                color: rgba(255, 255, 255, 0.62);
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QFrame#SuggestionCard {
                background: rgba(255, 255, 255, 0.035);
                border: none;
                border-radius: 14px;
            }
            QFrame#SuggestionCard[hovered="true"], QFrame#SuggestionCard[active="true"] {
                background: rgba(255, 255, 255, 0.11);
            }
            QLabel#SuggestionMeta {
                color: rgba(255, 255, 255, 0.42);
                font-size: 10px;
                font-weight: 700;
                letter-spacing: 0.8px;
            }
            QLabel#SuggestionTitle {
                color: #ffffff;
                font-size: 17px;
                font-weight: 500;
            }
            QLabel#SuggestionSubtitle {
                color: rgba(255, 255, 255, 0.56);
                font-size: 12px;
            }
            QFrame#SearchShell {
                background: rgba(255, 255, 255, 0.09);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 26px;
            }
            QFrame#SearchShell[active="true"] {
                background: rgba(255, 255, 255, 0.13);
                border: 1px solid rgba(121, 173, 255, 0.45);
            }
            QFrame#SearchShell[attached="true"] {
                border-bottom-left-radius: 10px;
                border-bottom-right-radius: 10px;
            }
            QFrame#AnswerCard {
                background: rgba(255, 255, 255, 0.09);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 28px;
            }
            QLabel#AnswerEyebrow {
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QLabel#AnswerText {
                color: #ffffff;
                font-size: 34px;
                font-weight: 500;
            }
            QLabel#AnswerSummary {
                color: rgba(255, 255, 255, 0.74);
                font-size: 15px;
            }
            QPushButton#DetailsButton {
                background: transparent;
                color: #ffffff;
                border: none;
                padding: 0;
                font-size: 14px;
                font-weight: 600;
                text-align: left;
            }
            QPushButton#DetailsButton:hover {
                color: #0038ff;
            }
            QScrollArea#EvidenceScroll {
                background: transparent;
                border: none;
            }
            QFrame#EvidenceCard {
                background: rgba(255, 255, 255, 0.055);
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 18px;
            }
            QLabel#EvidenceTitle {
                color: #ffffff;
                font-size: 18px;
                font-weight: 600;
            }
            QLabel#EvidenceMeta {
                color: rgba(121, 173, 255, 0.92);
                font-size: 12px;
                font-weight: 600;
            }
            QLabel#EvidenceSnippet {
                color: rgba(255, 255, 255, 0.82);
                font-size: 14px;
            }
            QLabel#EvidenceReason {
                color: rgba(255, 255, 255, 0.58);
                font-size: 12px;
                font-weight: 600;
                letter-spacing: 0.3px;
            }
            QLabel#RefineHeading {
                color: rgba(255, 255, 255, 0.62);
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QPushButton#RefineButton {
                background: rgba(255, 255, 255, 0.045);
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 14px;
                padding: 10px 14px;
                font-size: 13px;
                text-align: left;
            }
            QPushButton#RefineButton:hover {
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.22);
            }
            QLabel#StatusText {
                color: rgba(255, 255, 255, 0.68);
                font-size: 14px;
            }
            """
        )

        root = QWidget(self)
        self.root = root
        root.setObjectName("Root")
        layout = QVBoxLayout(root)
        layout.setContentsMargins(40, 30, 40, 30)
        layout.setSpacing(16)

        top_bar = QHBoxLayout()
        self.top_bar = top_bar
        top_bar.setSpacing(0)
        self.back_orb = QFrame()
        self.back_orb.setObjectName("MenuOrb")
        self.back_orb.setFixedSize(62, 62)
        back_layout = QVBoxLayout(self.back_orb)
        back_layout.setContentsMargins(8, 8, 8, 8)
        self.back_button = QPushButton("<")
        self.back_button.setObjectName("MenuButton")
        self.back_button.setFixedSize(46, 46)
        self.back_button.clicked.connect(self._go_home)
        back_layout.addWidget(self.back_button)

        self.compact_brand_host = QWidget()
        self.compact_brand_host.setFixedWidth(62)
        brand_layout = QVBoxLayout(self.compact_brand_host)
        brand_layout.setContentsMargins(0, 0, 0, 0)
        self.compact_brand = QLabel("m")
        self.compact_brand.setObjectName("CompactBrand")
        self.compact_brand.setAlignment(Qt.AlignmentFlag.AlignCenter)
        compact_brand_font = body_font(34)
        compact_brand_font.setBold(True)
        self.compact_brand.setFont(compact_brand_font)
        brand_layout.addWidget(self.compact_brand)

        self.results_search_stack = QWidget()
        self.results_search_stack.setFixedWidth(780)
        self.results_search_layout = QVBoxLayout(self.results_search_stack)
        self.results_search_layout.setContentsMargins(0, 0, 0, 0)
        self.results_search_layout.setSpacing(0)

        self.results_header = QWidget()
        results_header_layout = QHBoxLayout(self.results_header)
        results_header_layout.setContentsMargins(0, 0, 0, 0)
        results_header_layout.setSpacing(16)
        results_header_layout.addWidget(self.compact_brand_host)
        results_header_layout.addWidget(self.back_orb)
        results_header_layout.addWidget(self.results_search_stack, 0)
        self.results_header.hide()
        top_bar.addWidget(self.results_header, 0, Qt.AlignmentFlag.AlignLeft)
        top_bar.addSpacing(16)
        menu_orb = QFrame()
        menu_orb.setObjectName("MenuOrb")
        menu_orb.setFixedSize(62, 62)
        menu_layout = QVBoxLayout(menu_orb)
        menu_layout.setContentsMargins(8, 8, 8, 8)
        self.menu_button = QPushButton("...")
        self.menu_button.setObjectName("MenuButton")
        self.menu_button.setFixedSize(46, 46)
        self.menu_button.clicked.connect(self._show_menu)
        menu_layout.addWidget(self.menu_button)
        top_bar.addStretch(1)
        top_bar.addWidget(menu_orb, 0, Qt.AlignmentFlag.AlignRight)
        layout.addLayout(top_bar)

        self.top_spacer = QSpacerItem(
            20,
            12,
            QSizePolicy.Policy.Minimum,
            QSizePolicy.Policy.Expanding,
        )
        layout.addItem(self.top_spacer)

        center = QVBoxLayout()
        center.setSpacing(0)
        center.setAlignment(Qt.AlignmentFlag.AlignHCenter)
        center.setContentsMargins(0, 0, 0, 0)
        self.center_layout = center

        title = QLabel("memact")
        title.setObjectName("HeroTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setFont(brand_font(66))
        self.title_label = title

        self.search_shell = QFrame()
        self.search_shell.setObjectName("SearchShell")
        self.search_shell.setProperty("active", False)
        self.search_shell.setProperty("attached", False)
        self.search_shell.setMinimumWidth(760)
        self.search_shell.setMaximumWidth(840)
        self.search_shell.setFixedHeight(72)
        search_layout = QHBoxLayout(self.search_shell)
        search_layout.setContentsMargins(26, 16, 18, 16)
        search_layout.setSpacing(14)

        self.search_input = SearchInput()
        self.search_input.setObjectName("SearchInput")
        self.search_input.setPlaceholderText("Search")
        self.search_input.setProperty("empty", True)
        self.search_input.setProperty("preview", False)
        self.search_input.setFrame(False)
        self.search_input.setFixedHeight(34)
        self.search_input.returnPressed.connect(self._submit_query)
        self.search_input.focused.connect(self._handle_search_focus)
        self.search_input.blurred.connect(self._schedule_suggestion_hide)
        self.search_input.textChanged.connect(self._handle_query_text_changed)
        self.search_input.navigate_down.connect(self._select_next_suggestion)
        self.search_input.navigate_up.connect(self._select_previous_suggestion)
        self.search_input.accept_selection.connect(self._handle_accept_selection)
        self.search_input.commit_selection.connect(self._commit_selected_suggestion)
        self.search_input.escape_pressed.connect(self._dismiss_suggestions)
        search_layout.addWidget(self.search_input, 1)

        self.search_button = QPushButton("")
        self.search_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.search_button.setObjectName("SearchButton")
        self.search_button.setFixedSize(34, 34)
        self.search_button.clicked.connect(self._submit_query)
        if SEARCH_ICON_PATH.exists():
            self.search_button.setIcon(QIcon(str(SEARCH_ICON_PATH)))
            self.search_button.setIconSize(self.search_button.size())
        search_layout.addWidget(self.search_button, 0, Qt.AlignmentFlag.AlignVCenter)
        self.search_shell_base_margins = (26, 16, 18, 16)

        self.suggestion_dock = QFrame()
        self.suggestion_dock.setObjectName("SuggestionDock")
        self.suggestion_dock.setMinimumWidth(760)
        self.suggestion_dock.setMaximumWidth(840)
        self.suggestion_dock.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
        self._suggestion_row_height = 66
        self._suggestion_visible_limit = 6
        dock_layout = QVBoxLayout(self.suggestion_dock)
        dock_layout.setContentsMargins(10, 8, 10, 12)
        dock_layout.setSpacing(2)
        self.suggestion_heading = QLabel("")
        self.suggestion_heading.setObjectName("SuggestionHeading")
        self.suggestion_heading.hide()
        dock_layout.addWidget(self.suggestion_heading)
        self.suggestion_scroll = QScrollArea()
        self.suggestion_scroll.setObjectName("SuggestionScroll")
        self.suggestion_scroll.setWidgetResizable(True)
        self.suggestion_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.suggestion_scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.suggestion_content = QWidget()
        self.suggestions_layout = QVBoxLayout(self.suggestion_content)
        self.suggestions_layout.setContentsMargins(0, 0, 0, 0)
        self.suggestions_layout.setSpacing(8)
        self.suggestion_scroll.setWidget(self.suggestion_content)
        dock_layout.addWidget(self.suggestion_scroll)

        self.answer_card = QFrame()
        self.answer_card.setObjectName("AnswerCard")
        self.answer_card.setMinimumWidth(760)
        self.answer_card.setMaximumWidth(980)
        self.answer_card.setMinimumHeight(320)
        answer_layout = QVBoxLayout(self.answer_card)
        answer_layout.setContentsMargins(22, 20, 22, 20)
        answer_layout.setSpacing(12)

        self.answer_eyebrow = QLabel("LOCAL ANSWER")
        self.answer_eyebrow.setObjectName("AnswerEyebrow")
        self.answer_text = QLabel("")
        self.answer_text.setObjectName("AnswerText")
        self.answer_text.setWordWrap(True)
        self.answer_summary = QLabel("")
        self.answer_summary.setObjectName("AnswerSummary")
        self.answer_summary.setWordWrap(True)
        self.details_button = QPushButton("View details")
        self.details_button.setObjectName("DetailsButton")
        self.details_button.clicked.connect(self._toggle_details)

        self.refine_heading = QLabel("REFINE SEARCH")
        self.refine_heading.setObjectName("RefineHeading")
        self.refine_heading.setVisible(False)
        self.refine_row = QHBoxLayout()
        self.refine_row.setSpacing(8)
        self.refine_row.setContentsMargins(0, 0, 0, 0)
        self.refine_host = QWidget()
        self.refine_host.setLayout(self.refine_row)
        self.refine_host.setVisible(False)

        self.evidence_scroll = QScrollArea()
        self.evidence_scroll.setObjectName("EvidenceScroll")
        self.evidence_scroll.setWidgetResizable(True)
        self.evidence_scroll.setVisible(False)
        self.evidence_content = QWidget()
        self.evidence_layout = QVBoxLayout(self.evidence_content)
        self.evidence_layout.setContentsMargins(0, 0, 0, 0)
        self.evidence_layout.setSpacing(10)
        self.evidence_scroll.setWidget(self.evidence_content)

        answer_layout.addWidget(self.answer_eyebrow)
        answer_layout.addWidget(self.answer_text)
        answer_layout.addWidget(self.answer_summary)
        answer_layout.addWidget(self.refine_heading)
        answer_layout.addWidget(self.refine_host)
        answer_layout.addWidget(self.details_button, 0, Qt.AlignmentFlag.AlignLeft)
        answer_layout.addWidget(self.evidence_scroll)

        self.status_text = QLabel("")
        self.status_text.setObjectName("StatusText")
        self.status_text.setAlignment(Qt.AlignmentFlag.AlignCenter)

        center.addSpacing(0)
        center.addWidget(title)
        center.addSpacing(6)
        center.addWidget(self.search_shell, 0, Qt.AlignmentFlag.AlignCenter)
        center.addWidget(self.suggestion_dock, 0, Qt.AlignmentFlag.AlignCenter)
        center.addSpacing(16)
        center.addWidget(self.answer_card, 0, Qt.AlignmentFlag.AlignCenter)

        layout.addLayout(center)
        self.bottom_spacer = QSpacerItem(
            20,
            260,
            QSizePolicy.Policy.Minimum,
            QSizePolicy.Policy.Expanding,
        )
        layout.addItem(self.bottom_spacer)
        layout.addWidget(self.status_text, 0, Qt.AlignmentFlag.AlignHCenter | Qt.AlignmentFlag.AlignBottom)

        self.setCentralWidget(root)
        self.answer_card.hide()
        self.suggestion_dock.hide()

    def _build_tray(self) -> None:
        self.tray = QSystemTrayIcon(app_icon(64), self)
        self.tray.setToolTip("Memact is privately recording local actions")
        tray_menu = QMenu(self)
        tray_menu.setFont(body_font(12))
        tray_menu.setStyleSheet(self._menu_stylesheet())
        show_action = QAction("Show", self)
        show_action.triggered.connect(self.show_window)
        quit_action = QAction("Quit", self)
        quit_action.triggered.connect(self.quit_app)
        tray_menu.addAction(show_action)
        tray_menu.addSeparator()
        tray_menu.addAction(quit_action)
        self.tray.setContextMenu(tray_menu)
        self.tray.activated.connect(self._handle_tray_click)
        self.tray.show()

    def _build_menu(self) -> None:
        self.overflow_menu = QMenu(self)
        self.overflow_menu.setStyleSheet(self._menu_stylesheet())
        install_action = self.overflow_menu.addAction("Install Browser Extension")
        install_action.triggered.connect(self._open_browser_setup_from_menu)
        privacy_action = self.overflow_menu.addAction("Privacy Promise")
        privacy_action.triggered.connect(self._show_privacy_dialog)
        self.overflow_menu.addSeparator()
        quit_action = self.overflow_menu.addAction("Quit")
        quit_action.triggered.connect(self.quit_app)

    def _show_loading_state(self) -> None:
        self.status_text.setText("Starting your local memory engine...")
        self._render_suggestions([], heading="")

    def _initialize_runtime_async(self) -> None:
        if self._db_ready:
            return
        threading.Thread(target=self._initialize_runtime_worker, daemon=True).start()

    def _initialize_runtime_worker(self) -> None:
        init_db()
        self._bridge.runtime_ready.emit()

    def _finish_runtime_initialization(self) -> None:
        if self._db_ready:
            return
        self._db_ready = True
        self.status_text.setText("Ready. Ask anything about your past actions.")
        QTimer.singleShot(150, self._start_background_services)
        QTimer.singleShot(900, self._maybe_show_browser_setup)

    def _start_background_services(self) -> None:
        if self._services_started:
            return
        self.browser_bridge.start()
        self.monitor.start()
        self._services_started = True

    def _refresh_suggestions(self) -> None:
        if not self._db_ready:
            return
        if not self.search_input.hasFocus():
            self.suggestion_dock.hide()
            return
        self._suggestion_timer.start()

    def _set_search_active(self, active: bool) -> None:
        self._search_active = active
        self.search_shell.setProperty("active", active)
        self.search_shell.style().unpolish(self.search_shell)
        self.search_shell.style().polish(self.search_shell)
        self.search_shell.update()

    def _handle_search_focus(self) -> None:
        self._set_search_active(True)
        self._refresh_suggestions()

    def _kickoff_suggestion_refresh(self) -> None:
        if not self._db_ready or not self.search_input.hasFocus():
            return
        text = self.search_input.text().strip()
        heading = "AUTOCOMPLETE" if text else "RECENT PROMPTS"
        if not text and self._cached_empty_suggestions is not None:
            self._render_suggestions(self._cached_empty_suggestions, heading=heading)
            return
        request_id = self._suggestion_request_id + 1
        self._suggestion_request_id = request_id
        threading.Thread(
            target=self._suggestion_worker,
            args=(request_id, text, heading),
            daemon=True,
        ).start()

    def _suggestion_worker(self, request_id: int, text: str, heading: str) -> None:
        suggestions = autocomplete_suggestions(text, limit=5) if text else dynamic_suggestions(limit=4)
        self._bridge.suggestions_ready.emit(suggestions, request_id, text, heading)

    def _handle_suggestions_ready(
        self,
        suggestions: list[SearchSuggestion],
        request_id: int,
        text: str,
        heading: str,
    ) -> None:
        if request_id != self._suggestion_request_id:
            return
        if not self.search_input.hasFocus():
            return
        if self.search_input.text().strip() != text:
            return
        if not text:
            self._cached_empty_suggestions = suggestions
        self._render_suggestions(suggestions, heading=heading)

    def _sync_back_button(self) -> None:
        show_back = bool(self.search_input.text().strip()) or self.answer_card.isVisible()
        self.back_orb.setVisible(show_back)

    def _menu_stylesheet(self) -> str:
        return """
            QMenu {
                background: #000543;
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.16);
                padding: 8px;
            }
            QMenu::item {
                padding: 10px 18px;
                border-radius: 12px;
                background: transparent;
                margin: 2px 0;
            }
            QMenu::item:selected {
                background: rgba(255, 255, 255, 0.1);
            }
            QMenu::separator {
                height: 1px;
                background: rgba(255, 255, 255, 0.12);
                margin: 8px 10px;
            }
        """

    def _render_suggestions(self, suggestions: list[SearchSuggestion], *, heading: str) -> None:
        self._visible_suggestion_cards = []
        self._selected_suggestion_index = -1
        self.search_input.setProperty("suggestionSelected", False)
        self._set_preview_state(False)
        while self.suggestions_layout.count():
            item = self.suggestions_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
        self.suggestion_heading.setText(heading)
        self.suggestion_heading.setVisible(False)
        for suggestion in suggestions:
            card = SuggestionCard(suggestion)
            card.setMinimumHeight(self._suggestion_row_height)
            card.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
            card.clicked.connect(self._apply_suggestion)
            card.hovered.connect(self._select_suggestion_by_completion)
            card.unhovered.connect(self._schedule_hover_preview_reset)
            card.setMinimumWidth(520)
            self.suggestions_layout.addWidget(card)
            self._visible_suggestion_cards.append(card)
        visible_rows = min(len(suggestions), self._suggestion_visible_limit)
        scroll_height = 0
        if visible_rows:
            scroll_height = (
                visible_rows * self._suggestion_row_height
                + max(visible_rows - 1, 0) * self.suggestions_layout.spacing()
            )
        self.suggestion_scroll.setFixedHeight(scroll_height)
        heading_height = self.suggestion_heading.sizeHint().height() if self.suggestion_heading.isVisible() else 0
        _, top_margin, _, bottom_margin = self.suggestion_dock.layout().getContentsMargins()
        dock_height = top_margin + bottom_margin + scroll_height
        if heading_height:
            dock_height += heading_height + self.suggestion_dock.layout().spacing()
        self.suggestion_dock.setFixedHeight(max(dock_height, 0))
        self._set_hero_shifted(bool(suggestions))
        if self._results_mode and self.suggestion_dock.parent() is not self.root:
            self.suggestion_dock.setParent(self.root)
        self.suggestion_dock.setVisible(bool(suggestions))
        self._set_search_attached(bool(suggestions))
        QTimer.singleShot(0, self._reveal_suggestion_dock)
        self._sync_back_button()

    def _set_search_attached(self, attached: bool) -> None:
        self.search_shell.setProperty("attached", attached)
        self.search_shell.style().unpolish(self.search_shell)
        self.search_shell.style().polish(self.search_shell)
        self.search_shell.update()

    def _set_results_mode(self, active: bool) -> None:
        if self._results_mode == active:
            return
        self._results_mode = active
        self.center_layout.removeWidget(self.search_shell)
        self.center_layout.removeWidget(self.suggestion_dock)
        self.results_search_layout.removeWidget(self.search_shell)
        if active:
            self.title_label.hide()
            self.results_header.show()
            self.results_search_layout.addWidget(self.search_shell)
            self.top_spacer.changeSize(20, 8, QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Fixed)
            self.search_shell.setMinimumWidth(700)
            self.search_shell.setMaximumWidth(700)
        else:
            self.results_header.hide()
            self.title_label.show()
            self.center_layout.insertWidget(3, self.search_shell, 0, Qt.AlignmentFlag.AlignCenter)
            self.center_layout.insertWidget(4, self.suggestion_dock, 0, Qt.AlignmentFlag.AlignCenter)
            self.top_spacer.changeSize(20, 12, QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Expanding)
            self.search_shell.setMinimumWidth(760)
            self.search_shell.setMaximumWidth(840)
        self.root.layout().invalidate()
        self.root.layout().activate()

    def _set_preview_state(self, active: bool) -> None:
        self.search_input.setProperty("preview", active)
        if not active:
            self.search_input.setProperty("suggestionSelected", False)
        self.search_input.style().unpolish(self.search_input)
        self.search_input.style().polish(self.search_input)
        self.search_input.update()

    def _select_suggestion(self, index: int) -> None:
        if not self._visible_suggestion_cards:
            return
        index = max(0, min(index, len(self._visible_suggestion_cards) - 1))
        self._selected_suggestion_index = index
        self.search_input.setProperty("suggestionSelected", True)
        self._set_preview_state(True)
        for current, card in enumerate(self._visible_suggestion_cards):
            active = current == index
            card.setProperty("active", active)
            card.style().unpolish(card)
            card.style().polish(card)
        completion = self._visible_suggestion_cards[index]._completion
        self.search_input.blockSignals(True)
        self.search_input.setText(completion)
        self.search_input.blockSignals(False)

    def _select_suggestion_by_completion(self, completion: str) -> None:
        for index, card in enumerate(self._visible_suggestion_cards):
            if card._completion == completion:
                if self._selected_suggestion_index == -1:
                    self._typed_query_before_selection = self.search_input.text()
                self._select_suggestion(index)
                return

    def _schedule_hover_preview_reset(self) -> None:
        self._hover_reset_timer.start()

    def _clear_preview_if_idle(self) -> None:
        if any(bool(card.property("hovered")) for card in self._visible_suggestion_cards):
            return
        if self._selected_suggestion_index >= 0:
            for card in self._visible_suggestion_cards:
                card.setProperty("active", False)
                card.style().unpolish(card)
                card.style().polish(card)
        self._selected_suggestion_index = -1
        self.search_input.setProperty("suggestionSelected", False)
        self.search_input.blockSignals(True)
        self.search_input.setText(self._typed_query_before_selection)
        self.search_input.blockSignals(False)
        self._set_preview_state(False)

    def _select_next_suggestion(self) -> None:
        if not self.suggestion_dock.isVisible() or not self._visible_suggestion_cards:
            return
        if self._selected_suggestion_index == -1:
            self._typed_query_before_selection = self.search_input.text()
            self._select_suggestion(0)
            return
        self._select_suggestion((self._selected_suggestion_index + 1) % len(self._visible_suggestion_cards))

    def _select_previous_suggestion(self) -> None:
        if not self.suggestion_dock.isVisible() or not self._visible_suggestion_cards:
            return
        if self._selected_suggestion_index == -1:
            self._typed_query_before_selection = self.search_input.text()
            self._select_suggestion(len(self._visible_suggestion_cards) - 1)
            return
        self._select_suggestion((self._selected_suggestion_index - 1) % len(self._visible_suggestion_cards))

    def _handle_accept_selection(self) -> None:
        if self.suggestion_dock.isVisible() and self._selected_suggestion_index >= 0:
            self._apply_suggestion(self._visible_suggestion_cards[self._selected_suggestion_index]._completion)

    def _commit_selected_suggestion(self) -> None:
        if not self.suggestion_dock.isVisible() or self._selected_suggestion_index < 0:
            return
        completion = self._visible_suggestion_cards[self._selected_suggestion_index]._completion
        self.search_input.blockSignals(True)
        self.search_input.setText(completion)
        self.search_input.blockSignals(False)
        self._typed_query_before_selection = completion
        self.search_input.setProperty("suggestionSelected", False)
        self._set_preview_state(False)

    def _dismiss_suggestions(self) -> None:
        self.suggestion_dock.hide()
        self._set_search_attached(False)
        self.search_input.setProperty("suggestionSelected", False)
        if self._selected_suggestion_index >= 0:
            self.search_input.blockSignals(True)
            self.search_input.setText(self._typed_query_before_selection)
            self.search_input.blockSignals(False)
        self._set_preview_state(False)
        self._selected_suggestion_index = -1

    def _apply_suggestion(self, value: str) -> None:
        self._typed_query_before_selection = value
        self.search_input.setProperty("suggestionSelected", False)
        self._set_preview_state(False)
        self.search_input.blockSignals(True)
        self.search_input.setText(value)
        self.search_input.blockSignals(False)
        self.search_input.style().unpolish(self.search_input)
        self.search_input.style().polish(self.search_input)
        self.search_input.update()
        self._submit_query()

    def _schedule_suggestion_hide(self) -> None:
        QTimer.singleShot(140, self._hide_suggestions_if_idle)

    def _hide_suggestions_if_idle(self) -> None:
        focused = QApplication.focusWidget()
        if focused is self.search_input:
            return
        if isinstance(focused, SuggestionCard):
            return
        self.suggestion_dock.hide()
        self._set_search_attached(False)
        if not self.search_input.text().strip():
            self._set_search_active(False)
        self._set_hero_shifted(False)
        self._sync_back_button()

    def _set_hero_shifted(self, shifted: bool) -> None:
        if self._hero_shifted == shifted:
            return
        self._hero_shifted = shifted
        if shifted:
            self.status_text.hide()
        else:
            self.status_text.show()

    def _position_suggestion_dock(self) -> None:
        if not self._results_mode:
            return
        anchor_pos = self.search_shell.mapTo(self.root, QPoint(0, 0))
        dock_width = self.search_shell.width()
        self.suggestion_dock.setMinimumWidth(dock_width)
        self.suggestion_dock.setMaximumWidth(dock_width)
        self.suggestion_dock.resize(dock_width, self.suggestion_dock.height())
        x = anchor_pos.x()
        y = anchor_pos.y() + self.search_shell.height() - 1
        self.suggestion_dock.move(x, y)
        self.suggestion_dock.raise_()
        self.search_shell.raise_()

    def _reveal_suggestion_dock(self) -> None:
        if self._results_mode:
            self._position_suggestion_dock()
            return
        self.search_shell.raise_()

    def _handle_query_text_changed(self, text: str) -> None:
        selected_completion = None
        if 0 <= self._selected_suggestion_index < len(self._visible_suggestion_cards):
            selected_completion = self._visible_suggestion_cards[self._selected_suggestion_index]._completion
        if bool(self.search_input.property("suggestionSelected")) and text != selected_completion:
            self._selected_suggestion_index = -1
            self.search_input.setProperty("suggestionSelected", False)
            self._set_preview_state(False)
            for card in self._visible_suggestion_cards:
                card.setProperty("active", False)
                card.style().unpolish(card)
                card.style().polish(card)
        if not bool(self.search_input.property("suggestionSelected")):
            self._typed_query_before_selection = text
        self.search_input.setProperty("empty", not bool(text))
        self.search_input.style().unpolish(self.search_input)
        self.search_input.style().polish(self.search_input)
        self.search_input.update()
        self._sync_back_button()
        if text.strip():
            self._set_search_active(True)
            self._suggestion_timer.start()
        else:
            if self.search_input.hasFocus():
                self._set_search_active(True)
                self._refresh_suggestions()
            else:
                self.suggestion_dock.hide()
                self._set_search_attached(False)
                self._set_search_active(False)
                self._set_hero_shifted(False)

    def _go_home(self) -> None:
        self._reset_home_state(clear_query=True)

    def _reset_home_state(self, *, clear_query: bool) -> None:
        self._set_results_mode(False)
        self.suggestion_dock.hide()
        self._set_search_attached(False)
        self.search_input.setProperty("suggestionSelected", False)
        self._set_preview_state(False)
        self.answer_card.hide()
        self._clear_evidence_cards()
        self.evidence_scroll.hide()
        self.answer_summary.clear()
        self._render_related_queries([])
        self._last_answer = None
        self.search_button.setEnabled(True)
        if clear_query:
            self._typed_query_before_selection = ""
            self.search_input.clear()
            self.search_input.clearFocus()
        self._set_search_active(False)
        self._set_hero_shifted(False)
        if self._db_ready:
            self.status_text.setText("Ready. Ask anything about your past actions.")
        else:
            self.status_text.setText("Starting your local memory engine...")
        self._sync_back_button()

    def _submit_query(self) -> None:
        query = self.search_input.text().strip()
        if not query:
            self._reset_home_state(clear_query=False)
            return
        if not self._db_ready:
            self.status_text.setText("Still starting up. Your local memory engine is not ready yet.")
            return
        self._query_request_id += 1
        request_id = self._query_request_id
        self._typed_query_before_selection = query
        self.search_input.setProperty("suggestionSelected", False)
        self._set_preview_state(False)
        self.status_text.setText("Searching locally...")
        self.search_button.setEnabled(False)
        self._suggestion_timer.stop()
        self.suggestion_dock.hide()
        self._set_search_attached(False)
        threading.Thread(
            target=self._query_worker,
            args=(request_id, query),
            daemon=True,
        ).start()

    def _query_worker(self, request_id: int, query: str) -> None:
        answer = answer_query(query)
        self._bridge.query_answer_ready.emit(answer, request_id, query)

    def _handle_query_answer_ready(self, answer: QueryAnswer, request_id: int, query: str) -> None:
        if request_id != self._query_request_id:
            return
        self._set_results_mode(True)
        self.search_button.setEnabled(True)
        self._last_answer = answer
        self.search_input.setProperty("suggestionSelected", False)
        self._set_preview_state(False)
        self.search_input.blockSignals(True)
        self.search_input.setText(query)
        self.search_input.blockSignals(False)
        self.search_input.setProperty("empty", not bool(query))
        self.search_input.style().unpolish(self.search_input)
        self.search_input.style().polish(self.search_input)
        self.search_input.update()
        self.answer_eyebrow.setText("LOCAL ANSWER" if not answer.time_scope_label else f"LOCAL ANSWER - {answer.time_scope_label.upper()}")
        self.answer_text.setText(answer.answer)
        self.answer_summary.setText(answer.summary)
        self._render_related_queries(answer.related_queries)
        self.details_button.setVisible(bool(answer.evidence))
        self.details_button.setText(answer.details_label or "Show top matches")
        self.evidence_scroll.setVisible(False)
        self.answer_card.show()
        self._populate_evidence(answer)
        self.suggestion_dock.hide()
        self._set_search_attached(False)
        self._set_hero_shifted(False)
        if answer.result_count:
            self.status_text.setText(f"Matched {answer.result_count} local events and ranked the strongest evidence.")
        else:
            self.status_text.setText("Answer generated from local events on this device.")
        self._sync_back_button()

    def _populate_evidence(self, answer: QueryAnswer) -> None:
        self._clear_evidence_cards()
        for span in answer.evidence:
            card = EvidenceCard(span)
            self.evidence_layout.addWidget(card)
        self.evidence_layout.addStretch(1)

    def _clear_evidence_cards(self) -> None:
        while self.evidence_layout.count():
            item = self.evidence_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()

    def _render_related_queries(self, queries: list[str]) -> None:
        while self.refine_row.count():
            item = self.refine_row.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
        if not queries:
            self.refine_heading.hide()
            self.refine_host.hide()
            return
        for query in queries:
            button = QPushButton(query)
            button.setObjectName("RefineButton")
            button.clicked.connect(lambda _checked=False, value=query: self._apply_suggestion(value))
            self.refine_row.addWidget(button)
        self.refine_row.addStretch(1)
        self.refine_heading.show()
        self.refine_host.show()

    def _toggle_details(self) -> None:
        visible = not self.evidence_scroll.isVisible()
        self.evidence_scroll.setVisible(visible)
        self.details_button.setText("Hide top matches" if visible else (self._last_answer.details_label if self._last_answer else "Show top matches"))

    def _handle_new_event(self) -> None:
        if not self._db_ready:
            return
        self._cached_empty_suggestions = None
        if self.search_input.hasFocus() and not self.search_input.text().strip():
            self._refresh_suggestions()
        if self.isVisible() and not self.isMinimized():
            self.status_text.setText("Memory updated locally.")

    def mousePressEvent(self, event) -> None:  # noqa: N802
        if event.button() == Qt.MouseButton.LeftButton:
            position = self.root.mapFromGlobal(self.mapToGlobal(event.position().toPoint()))
            in_search = self.search_shell.geometry().contains(position)
            in_dock = self.suggestion_dock.isVisible() and self.suggestion_dock.geometry().contains(position)
            if not in_search and not in_dock:
                self.suggestion_dock.hide()
                self._set_search_attached(False)
                if not self.search_input.text().strip():
                    self._set_search_active(False)
                    self._set_hero_shifted(False)
                self.search_input.clearFocus()
        super().mousePressEvent(event)

    def resizeEvent(self, event) -> None:  # noqa: N802
        super().resizeEvent(event)
        self._position_suggestion_dock()

    def _show_menu(self) -> None:
        self.overflow_menu.popup(self.menu_button.mapToGlobal(self.menu_button.rect().bottomLeft()))

    def _handle_tray_click(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.show_window()

    def show_window(self) -> None:
        self.show()
        self.raise_()
        self.activateWindow()

    def showEvent(self, event) -> None:  # noqa: N802
        super().showEvent(event)
        if not self._native_theme_applied:
            apply_native_window_theme(self)
            self._native_theme_applied = True

    def quit_app(self) -> None:
        self._quitting = True
        if self._services_started:
            self.monitor.stop()
            self.browser_bridge.stop()
        self.tray.hide()
        self.close()
        QApplication.quit()

    def closeEvent(self, event) -> None:  # noqa: N802
        if self._quitting:
            super().closeEvent(event)
            return
        event.ignore()
        self.hide()
        self.tray.showMessage(
            "Memact",
            "Memact is still running privately in the background.",
            QSystemTrayIcon.MessageIcon.Information,
            1800,
        )

    def _maybe_show_browser_setup(self) -> None:
        if self.settings.get("extension_prompt_shown"):
            return
        browsers = detect_browsers()
        self.settings["extension_prompt_shown"] = True
        save_settings(self.settings)
        if not browsers:
            return
        dialog = BrowserSetupDialog(
            browsers=browsers,
            on_setup=self._run_browser_setup,
            is_browser_ready=self._is_browser_extension_ready,
            parent=self,
        )
        dialog.exec()

    def _open_browser_setup_from_menu(self) -> None:
        browsers = detect_browsers()
        if not browsers:
            self._show_info_dialog("Memact", "No supported browsers were detected on this PC.")
            return
        dialog = BrowserSetupDialog(
            browsers=browsers,
            on_setup=self._run_browser_setup,
            is_browser_ready=self._is_browser_extension_ready,
            parent=self,
        )
        dialog.exec()

    def _run_browser_setup(self, browser) -> None:
        launch_extension_setup(browser, EXTENSION_DIR)
        self.status_text.setText(
            f"Opened {browser.name}. If needed, use {extension_manual_url(browser)} in the address bar."
        )

    def _is_browser_extension_ready(self, browser) -> bool:
        return self.browser_state_store.has_session(browser.key)

    def _show_privacy_dialog(self) -> None:
        dialog = GlassInfoDialog(
            title="Privacy Promise",
            text="Memact stores events, embeddings, and answers locally on this device. It does not call cloud APIs or send your activity off-machine.",
            parent=self,
        )
        dialog.exec()

    def _style_dialog(self, dialog: QMessageBox) -> None:
        dialog.setFont(body_font(12))
        dialog.setStyleSheet(
            """
            QMessageBox {
                background: #000543;
                color: #ffffff;
            }
            QMessageBox QLabel {
                color: #ffffff;
                font-size: 16px;
                min-width: 340px;
            }
            QMessageBox QPushButton {
                background: #0038ff;
                color: #ffffff;
                border: 1px solid #0038ff;
                border-radius: 12px;
                padding: 9px 16px;
                min-width: 96px;
                font-size: 14px;
            }
            QMessageBox QPushButton:hover {
                background: rgba(0, 56, 255, 0.84);
            }
            """
        )

    def _show_info_dialog(self, title: str, text: str) -> None:
        dialog = QMessageBox(self)
        dialog.setWindowTitle(title)
        dialog.setText(text)
        dialog.setIcon(QMessageBox.Icon.Information)
        dialog.setStandardButtons(QMessageBox.StandardButton.Ok)
        dialog.setWindowIcon(app_icon())
        self._style_dialog(dialog)
        apply_native_window_theme(dialog)
        dialog.exec()

    def _show_confirmation_dialog(self, title: str, text: str) -> bool:
        dialog = QMessageBox(self)
        dialog.setWindowTitle(title)
        dialog.setText(text)
        dialog.setIcon(QMessageBox.Icon.Information)
        dialog.setStandardButtons(QMessageBox.StandardButton.Ok | QMessageBox.StandardButton.Cancel)
        dialog.setDefaultButton(QMessageBox.StandardButton.Ok)
        dialog.setWindowIcon(app_icon())
        self._style_dialog(dialog)
        apply_native_window_theme(dialog)
        return dialog.exec() == QMessageBox.StandardButton.Ok
