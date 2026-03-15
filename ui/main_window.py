from __future__ import annotations

import threading
from pathlib import Path

from PyQt6.QtCore import QObject, Qt, QTimer, pyqtSignal
from PyQt6.QtGui import QAction, QFont, QFontDatabase, QIcon
from PyQt6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMainWindow,
    QMenu,
    QMessageBox,
    QPushButton,
    QSizePolicy,
    QSystemTrayIcon,
    QVBoxLayout,
    QWidget,
)

from core.browser_bridge import BrowserBridgeServer, BrowserStateStore
from core.browser_setup import detect_browsers, extension_manual_url, launch_extension_setup
from core.database import init_db
from core.monitor import WindowMonitor
from core.query_engine import QueryAnswer, answer_query, dynamic_suggestions
from core.settings import load_settings, save_settings
from ui.setup_dialog import BrowserSetupDialog
from ui.window_effects import apply_native_window_theme


ICON_PATH = Path(__file__).resolve().parent.parent / "assets" / "memact_icon.svg"
FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
ORBITRON_FONT_PATH = FONT_DIR / "Orbitron-Bold.ttf"
EXTENSION_DIR = Path(__file__).resolve().parent.parent / "extension" / "memact"


class SignalBridge(QObject):
    runtime_ready = pyqtSignal()
    new_event = pyqtSignal()


class SearchInput(QLineEdit):
    focused = pyqtSignal()

    def focusInEvent(self, event) -> None:  # noqa: N802
        super().focusInEvent(event)
        self.focused.emit()


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("MemAct")
        self.resize(1120, 760)
        self.setMinimumSize(880, 620)
        if ICON_PATH.exists():
            self.setWindowIcon(QIcon(str(ICON_PATH)))

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

        self._services_started = False
        self._db_ready = False
        self._quitting = False
        self._native_theme_applied = False
        self._last_answer: QueryAnswer | None = None

        self._build_ui()
        self._build_tray()
        self._build_menu()

        self._show_loading_state()
        QTimer.singleShot(300, self._initialize_runtime_async)

    def _build_ui(self) -> None:
        self.setFont(QFont("Segoe UI", 11))
        self.setStyleSheet(
            """
            QMainWindow {
                background: qlineargradient(
                    x1: 0, y1: 0, x2: 1, y2: 1,
                    stop: 0 #031246,
                    stop: 0.55 #071b63,
                    stop: 1 #02081f
                );
            }
            QWidget#Root {
                background: transparent;
                color: #f6f8ff;
            }
            QPushButton#MenuButton {
                background: rgba(255, 255, 255, 0.08);
                color: #ffffff;
                border: 1px solid rgba(255, 255, 255, 0.14);
                border-radius: 18px;
                padding: 8px 14px;
                font-size: 22px;
                font-weight: 700;
            }
            QPushButton#MenuButton:hover {
                background: rgba(255, 255, 255, 0.14);
            }
            QLabel#HeroTitle {
                color: #ffffff;
                font-size: 44px;
                font-weight: 700;
            }
            QLabel#HeroBody {
                color: rgba(255, 255, 255, 0.78);
                font-size: 15px;
            }
            QLineEdit#SearchInput {
                background: rgba(3, 10, 39, 0.78);
                color: #ffffff;
                border: 1px solid rgba(129, 182, 255, 0.24);
                border-radius: 24px;
                padding: 18px 24px;
                font-size: 24px;
                selection-background-color: #67b0ff;
            }
            QLineEdit#SearchInput:focus {
                border: 1px solid rgba(129, 182, 255, 0.72);
                background: rgba(4, 14, 48, 0.94);
            }
            QWidget#SuggestionsWrap {
                background: transparent;
            }
            QPushButton#SuggestionButton {
                text-align: left;
                background: rgba(255, 255, 255, 0.05);
                color: #edf4ff;
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 12px 16px;
                font-size: 14px;
            }
            QPushButton#SuggestionButton:hover {
                background: rgba(255, 255, 255, 0.11);
                border: 1px solid rgba(129, 182, 255, 0.34);
            }
            QFrame#AnswerCard {
                background: rgba(3, 10, 39, 0.76);
                border: 1px solid rgba(129, 182, 255, 0.18);
                border-radius: 28px;
            }
            QLabel#AnswerEyebrow {
                color: rgba(255, 255, 255, 0.64);
                font-size: 12px;
                font-weight: 700;
                letter-spacing: 1px;
            }
            QLabel#AnswerText {
                color: #ffffff;
                font-size: 30px;
                font-weight: 600;
            }
            QPushButton#DetailsButton {
                background: transparent;
                color: #8ed0ff;
                border: none;
                padding: 0;
                font-size: 14px;
                font-weight: 600;
                text-align: left;
            }
            QPushButton#DetailsButton:hover {
                color: #b7e4ff;
            }
            QListWidget#EvidenceList {
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 18px;
                padding: 8px;
            }
            QListWidget#EvidenceList::item {
                padding: 10px 6px;
                margin: 4px 0;
            }
            QLabel#PrivacyChip {
                background: rgba(255, 255, 255, 0.06);
                color: rgba(255, 255, 255, 0.82);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 14px;
                padding: 10px 14px;
                font-size: 13px;
            }
            QLabel#StatusText {
                color: rgba(255, 255, 255, 0.68);
                font-size: 13px;
            }
            """
        )

        root = QWidget(self)
        root.setObjectName("Root")
        layout = QVBoxLayout(root)
        layout.setContentsMargins(34, 26, 34, 26)
        layout.setSpacing(18)

        top_bar = QHBoxLayout()
        top_bar.addStretch(1)
        self.menu_button = QPushButton("...")
        self.menu_button.setObjectName("MenuButton")
        self.menu_button.setFixedSize(54, 54)
        self.menu_button.clicked.connect(self._show_menu)
        top_bar.addWidget(self.menu_button)
        layout.addLayout(top_bar)

        layout.addStretch(1)

        center = QVBoxLayout()
        center.setSpacing(16)
        center.setAlignment(Qt.AlignmentFlag.AlignHCenter)

        title = QLabel("MemAct")
        title.setObjectName("HeroTitle")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setFont(self._brand_font())

        subtitle = QLabel("Ask anything about what you have done. Your memory stays on this device.")
        subtitle.setObjectName("HeroBody")
        subtitle.setWordWrap(True)
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        subtitle.setMaximumWidth(600)

        self.search_input = SearchInput()
        self.search_input.setObjectName("SearchInput")
        self.search_input.setPlaceholderText("Ask MemAct...")
        self.search_input.setFixedHeight(72)
        self.search_input.setMinimumWidth(680)
        self.search_input.returnPressed.connect(self._submit_query)
        self.search_input.focused.connect(self._refresh_suggestions)
        self.search_input.textChanged.connect(self._handle_query_text_changed)

        self.suggestions_wrap = QWidget()
        self.suggestions_wrap.setObjectName("SuggestionsWrap")
        self.suggestions_layout = QVBoxLayout(self.suggestions_wrap)
        self.suggestions_layout.setContentsMargins(0, 0, 0, 0)
        self.suggestions_layout.setSpacing(10)

        self.answer_card = QFrame()
        self.answer_card.setObjectName("AnswerCard")
        self.answer_card.setMaximumWidth(760)
        answer_layout = QVBoxLayout(self.answer_card)
        answer_layout.setContentsMargins(22, 20, 22, 20)
        answer_layout.setSpacing(12)

        self.answer_eyebrow = QLabel("LOCAL ANSWER")
        self.answer_eyebrow.setObjectName("AnswerEyebrow")
        self.answer_text = QLabel("")
        self.answer_text.setObjectName("AnswerText")
        self.answer_text.setWordWrap(True)
        self.details_button = QPushButton("View details")
        self.details_button.setObjectName("DetailsButton")
        self.details_button.clicked.connect(self._toggle_details)

        self.evidence_list = QListWidget()
        self.evidence_list.setObjectName("EvidenceList")
        self.evidence_list.setVisible(False)
        self.evidence_list.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.MinimumExpanding)

        answer_layout.addWidget(self.answer_eyebrow)
        answer_layout.addWidget(self.answer_text)
        answer_layout.addWidget(self.details_button, 0, Qt.AlignmentFlag.AlignLeft)
        answer_layout.addWidget(self.evidence_list)

        self.privacy_chip = QLabel("Private by default. All capture, indexing, and answering happens locally.")
        self.privacy_chip.setObjectName("PrivacyChip")
        self.privacy_chip.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.status_text = QLabel("")
        self.status_text.setObjectName("StatusText")
        self.status_text.setAlignment(Qt.AlignmentFlag.AlignCenter)

        center.addWidget(title)
        center.addWidget(subtitle)
        center.addSpacing(8)
        center.addWidget(self.search_input, 0, Qt.AlignmentFlag.AlignCenter)
        center.addWidget(self.suggestions_wrap, 0, Qt.AlignmentFlag.AlignCenter)
        center.addSpacing(8)
        center.addWidget(self.answer_card, 0, Qt.AlignmentFlag.AlignCenter)
        center.addWidget(self.status_text)
        center.addSpacing(12)
        center.addWidget(self.privacy_chip, 0, Qt.AlignmentFlag.AlignCenter)

        layout.addLayout(center)
        layout.addStretch(1)

        self.setCentralWidget(root)
        self.answer_card.hide()

    def _brand_font(self) -> QFont:
        family = None
        if ORBITRON_FONT_PATH.exists():
            font_id = QFontDatabase.addApplicationFont(str(ORBITRON_FONT_PATH))
            if font_id != -1:
                families = QFontDatabase.applicationFontFamilies(font_id)
                if families:
                    family = families[0]
        font = QFont(family or "Segoe UI", 40)
        font.setBold(True)
        return font

    def _build_tray(self) -> None:
        tray_icon = QIcon(str(ICON_PATH)) if ICON_PATH.exists() else self.style().standardIcon(self.style().StandardPixmap.SP_ComputerIcon)
        self.tray = QSystemTrayIcon(tray_icon, self)
        self.tray.setToolTip("MemAct is privately recording local actions")
        tray_menu = QMenu(self)
        show_action = QAction("Show MemAct", self)
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
        self.overflow_menu.setStyleSheet(
            """
            QMenu {
                background: #071341;
                color: #ffffff;
                border: 1px solid rgba(129, 182, 255, 0.24);
                padding: 8px;
            }
            QMenu::item {
                padding: 9px 18px;
                border-radius: 12px;
            }
            QMenu::item:selected {
                background: #12368e;
            }
            """
        )
        install_action = self.overflow_menu.addAction("Install Browser Extension")
        install_action.triggered.connect(self._open_browser_setup_from_menu)
        privacy_action = self.overflow_menu.addAction("Privacy Promise")
        privacy_action.triggered.connect(self._show_privacy_dialog)
        self.overflow_menu.addSeparator()
        quit_action = self.overflow_menu.addAction("Quit")
        quit_action.triggered.connect(self.quit_app)

    def _show_loading_state(self) -> None:
        self.status_text.setText("Starting your local memory engine...")
        self._render_suggestions([])

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
        self._refresh_suggestions()
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
        self._render_suggestions(dynamic_suggestions(limit=4))

    def _render_suggestions(self, suggestions: list[str]) -> None:
        while self.suggestions_layout.count():
            item = self.suggestions_layout.takeAt(0)
            widget = item.widget()
            if widget is not None:
                widget.deleteLater()
        for suggestion in suggestions:
            button = QPushButton(suggestion)
            button.setObjectName("SuggestionButton")
            button.clicked.connect(
                lambda _checked=False, value=suggestion: self._apply_suggestion(value)
            )
            button.setMinimumWidth(680)
            self.suggestions_layout.addWidget(button)
        self.suggestions_wrap.setVisible(bool(suggestions) and not self.answer_card.isVisible())

    def _apply_suggestion(self, value: str) -> None:
        self.search_input.setText(value)
        self._submit_query()

    def _handle_query_text_changed(self, text: str) -> None:
        if text.strip():
            self.suggestions_wrap.hide()
        else:
            self.answer_card.hide()
            self._refresh_suggestions()

    def _submit_query(self) -> None:
        query = self.search_input.text().strip()
        if not query:
            self._refresh_suggestions()
            return
        if not self._db_ready:
            self.status_text.setText("Still starting up. Your local memory engine is not ready yet.")
            return
        self.status_text.setText("Searching locally...")
        QApplication.processEvents()
        answer = answer_query(query)
        self._last_answer = answer
        self.answer_eyebrow.setText("LOCAL ANSWER" if not answer.time_scope_label else f"LOCAL ANSWER - {answer.time_scope_label.upper()}")
        self.answer_text.setText(answer.answer)
        self.details_button.setVisible(bool(answer.evidence))
        self.details_button.setText(answer.details_label or "View details")
        self.evidence_list.setVisible(False)
        self.answer_card.show()
        self._populate_evidence(answer)
        self.suggestions_wrap.hide()
        self.status_text.setText("Answer generated from local events on this device.")

    def _populate_evidence(self, answer: QueryAnswer) -> None:
        self.evidence_list.clear()
        for span in answer.evidence:
            app_label = span.application.removesuffix(".exe").replace("_", " ").title()
            label = f"{span.start_at.strftime('%b %d')} - {span.start_at.strftime('%I:%M %p').lstrip('0')} to {span.end_at.strftime('%I:%M %p').lstrip('0')} - {app_label}\n{span.label}"
            item = QListWidgetItem(label)
            item.setToolTip(label)
            self.evidence_list.addItem(item)

    def _toggle_details(self) -> None:
        visible = not self.evidence_list.isVisible()
        self.evidence_list.setVisible(visible)
        self.details_button.setText("Hide details" if visible else (self._last_answer.details_label if self._last_answer else "View details"))

    def _handle_new_event(self) -> None:
        if not self._db_ready:
            return
        if not self.search_input.text().strip():
            self._refresh_suggestions()
        if self.isVisible() and not self.isMinimized():
            self.status_text.setText("Memory updated locally.")

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
            "MemAct",
            "MemAct is still running privately in the background.",
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
            icon_path=ICON_PATH,
            on_setup=self._run_browser_setup,
            is_browser_ready=self._is_browser_extension_ready,
            parent=self,
        )
        dialog.exec()

    def _open_browser_setup_from_menu(self) -> None:
        browsers = detect_browsers()
        if not browsers:
            self._show_info_dialog("MemAct", "No supported browsers were detected on this PC.")
            return
        dialog = BrowserSetupDialog(
            browsers=browsers,
            icon_path=ICON_PATH,
            on_setup=self._run_browser_setup,
            is_browser_ready=self._is_browser_extension_ready,
            parent=self,
        )
        dialog.exec()

    def _run_browser_setup(self, browser) -> None:
        should_continue = self._show_confirmation_dialog(
            "Extension Setup",
            f"MemAct is about to open {browser.name} and the local extension folder.\n\nIf the browser does not land on its extensions page automatically, paste this into the address bar:\n\n{extension_manual_url(browser)}",
        )
        if not should_continue:
            return
        launch_extension_setup(browser, EXTENSION_DIR)

    def _is_browser_extension_ready(self, browser) -> bool:
        return self.browser_state_store.has_session(browser.key)

    def _show_privacy_dialog(self) -> None:
        self._show_info_dialog(
            "Privacy Promise",
            "MemAct stores events, embeddings, and answers locally on this device. It does not call cloud APIs or send your activity off-machine.",
        )

    def _show_info_dialog(self, title: str, text: str) -> None:
        dialog = QMessageBox(self)
        dialog.setWindowTitle(title)
        dialog.setText(text)
        dialog.setIcon(QMessageBox.Icon.Information)
        dialog.setStandardButtons(QMessageBox.StandardButton.Ok)
        if ICON_PATH.exists():
            dialog.setWindowIcon(QIcon(str(ICON_PATH)))
        apply_native_window_theme(dialog)
        dialog.exec()

    def _show_confirmation_dialog(self, title: str, text: str) -> bool:
        dialog = QMessageBox(self)
        dialog.setWindowTitle(title)
        dialog.setText(text)
        dialog.setIcon(QMessageBox.Icon.Information)
        dialog.setStandardButtons(QMessageBox.StandardButton.Ok | QMessageBox.StandardButton.Cancel)
        dialog.setDefaultButton(QMessageBox.StandardButton.Ok)
        if ICON_PATH.exists():
            dialog.setWindowIcon(QIcon(str(ICON_PATH)))
        apply_native_window_theme(dialog)
        return dialog.exec() == QMessageBox.StandardButton.Ok
