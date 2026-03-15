from __future__ import annotations

import ctypes
import ctypes.wintypes
import os
import re
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlparse

from pywinauto import Desktop

from core.browser_bridge import BrowserStateStore
from core.database import append_event


user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010
MAX_PATH = 260
BROWSERS = (
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "opera.exe",
    "launcher.exe",
    "vivaldi.exe",
)
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x00000080
KNOWN_NOTIFICATION_CLASSES = {
    "Windows.UI.Core.CoreWindow",
    "XamlExplorerHostIslandWindow",
    "NotifyIconOverflowWindow",
    "Shell_TrayWnd",
    "Windows.UI.Composition.DesktopWindowContentBridge",
}
NOTIFICATION_TOKENS = {
    "notification",
    "notifications",
    "toast",
    "reminder",
    "h.notifyicon",
    "notifyicon",
    "battery is running low",
    "not responding",
}
MEMACT_WINDOW_TOKENS = {
    "memact",
    "ask memact",
    "privacy promise",
}


@dataclass(slots=True)
class WindowSnapshot:
    hwnd: int
    title: str
    app_name: str
    exe_path: str | None
    class_name: str
    ex_style: int


@dataclass(slots=True)
class BrowserContext:
    url: str | None
    current_title: str | None
    tab_titles: list[str]
    tab_urls: list[str]


def _window_text(hwnd: int) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value.strip()


def _class_name(hwnd: int) -> str:
    buffer = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buffer, len(buffer))
    return buffer.value.strip()


def _process_image_path(pid: int) -> str | None:
    handle = kernel32.OpenProcess(
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
        False,
        pid,
    )
    if not handle:
        return None

    try:
        buffer = ctypes.create_unicode_buffer(MAX_PATH)
        copied = psapi.GetModuleFileNameExW(handle, None, buffer, MAX_PATH)
        if copied:
            return buffer.value

        size = ctypes.wintypes.DWORD(MAX_PATH)
        ok = kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size))
        if ok:
            return buffer.value[: size.value]
    finally:
        kernel32.CloseHandle(handle)

    return None


def get_active_window() -> WindowSnapshot | None:
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    title = _window_text(hwnd)
    if not title:
        return None

    pid = ctypes.wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    exe_path = _process_image_path(pid.value)
    app_name = os.path.basename(exe_path) if exe_path else "Unknown"
    return WindowSnapshot(
        hwnd=hwnd,
        title=title,
        app_name=app_name,
        exe_path=exe_path,
        class_name=_class_name(hwnd),
        ex_style=user32.GetWindowLongW(hwnd, GWL_EXSTYLE),
    )


def should_capture_window(snapshot: WindowSnapshot) -> bool:
    title = snapshot.title.strip().lower()
    app_lower = snapshot.app_name.lower()
    if not title:
        return False
    if title in MEMACT_WINDOW_TOKENS:
        return False
    if snapshot.class_name in KNOWN_NOTIFICATION_CLASSES:
        return False
    if app_lower in {"python.exe", "pythonw.exe"} and any(token in title for token in MEMACT_WINDOW_TOKENS):
        return False
    if title.startswith("h.notifyicon_"):
        return False
    if app_lower in {"pickerhost.exe", "shellexperiencehost.exe"}:
        return False
    if snapshot.ex_style & WS_EX_TOOLWINDOW and app_lower not in BROWSERS:
        return False
    if any(token in title for token in NOTIFICATION_TOKENS):
        return False
    return True


def _read_edit_value(control) -> str:
    try:
        value = control.get_value()
        if isinstance(value, str):
            return value.strip()
    except Exception:
        pass
    try:
        value = control.iface_value.CurrentValue
        if isinstance(value, str):
            return value.strip()
    except Exception:
        pass
    try:
        texts = control.texts()
        if texts:
            return str(texts[0]).strip()
    except Exception:
        pass
    return ""


def _control_name(control) -> str:
    try:
        value = control.window_text()
        if isinstance(value, str) and value.strip():
            return value.strip()
    except Exception:
        pass
    try:
        texts = control.texts()
        if texts:
            return str(texts[0]).strip()
    except Exception:
        pass
    try:
        value = control.element_info.name
        if isinstance(value, str) and value.strip():
            return value.strip()
    except Exception:
        pass
    return ""


def _is_selected_tab(control) -> bool:
    try:
        return bool(control.iface_selection_item.CurrentIsSelected)
    except Exception:
        return False


def _is_generic_tab_title(title: str) -> bool:
    value = title.strip().lower()
    if not value:
        return True
    if re.fullmatch(r"tab-\d+", value):
        return True
    return value in {"new tab", "tab", "tab search", "tab actions menu"}


def _normalize_browser_title(window_title: str, url: str | None, selected_title: str | None) -> str:
    if selected_title and not _is_generic_tab_title(selected_title):
        return selected_title.strip()
    title_root = window_title.split(" - ")[0].strip()
    if title_root and " and " not in title_root.lower():
        return title_root
    parsed = urlparse(url or "")
    if parsed.scheme == "file":
        return os.path.basename(parsed.path) or "Local file"
    if parsed.netloc:
        return parsed.netloc.removeprefix("www.")
    return window_title.strip()


def get_browser_context(hwnd: int, app_name: str, window_title: str) -> BrowserContext:
    app_name = app_name.lower()
    if not any(browser in app_name for browser in BROWSERS):
        return BrowserContext(url=None, current_title=None, tab_titles=[], tab_urls=[])

    url = None
    tab_titles: list[str] = []
    tab_urls: list[str] = []
    selected_title = None
    try:
        window = Desktop(backend="uia").window(handle=hwnd)
        for control in window.descendants(control_type="Edit"):
            value = _read_edit_value(control)
            if value.startswith(("http://", "https://", "file://")):
                url = value
                break

        seen_titles: set[str] = set()
        for control in window.descendants(control_type="TabItem"):
            title = _control_name(control)
            if not title or _is_generic_tab_title(title) or title in seen_titles:
                continue
            seen_titles.add(title)
            tab_titles.append(title)
            if _is_selected_tab(control):
                selected_title = title
    except Exception:
        return BrowserContext(url=url, current_title=None, tab_titles=tab_titles, tab_urls=tab_urls)

    return BrowserContext(
        url=url,
        current_title=_normalize_browser_title(window_title, url, selected_title),
        tab_titles=tab_titles,
        tab_urls=tab_urls,
    )


def _browser_key(app_name: str) -> str:
    app_name = app_name.lower()
    if "msedge" in app_name:
        return "edge"
    if "chrome" in app_name:
        return "chrome"
    if "brave" in app_name:
        return "brave"
    if "vivaldi" in app_name:
        return "vivaldi"
    if app_name in {"opera.exe", "launcher.exe"}:
        return "opera"
    return ""


def _browser_context_from_extension(snapshot: WindowSnapshot, store: BrowserStateStore | None) -> BrowserContext | None:
    if store is None:
        return None
    browser_key = _browser_key(snapshot.app_name)
    if not browser_key:
        return None
    session = store.get(browser_key)
    if session is None:
        return None
    return BrowserContext(
        url=session.current_url,
        current_title=_normalize_browser_title(
            snapshot.title,
            session.current_url,
            session.current_title,
        ),
        tab_titles=session.tab_titles,
        tab_urls=session.tab_urls,
    )


def _compose_content_text(snapshot: WindowSnapshot, browser_context: BrowserContext) -> str:
    parts = [
        browser_context.current_title or snapshot.title,
        snapshot.title,
        " ".join(browser_context.tab_titles[:8]),
    ]
    return " ".join(part.strip() for part in parts if part and part.strip())


class WindowMonitor(threading.Thread):
    def __init__(
        self,
        on_new_event=None,
        poll_interval: float = 1.0,
        heartbeat_interval: float = 20.0,
        browser_state_store: BrowserStateStore | None = None,
    ) -> None:
        super().__init__(daemon=True)
        self.on_new_event = on_new_event
        self.poll_interval = poll_interval
        self.heartbeat_interval = heartbeat_interval
        self.browser_state_store = browser_state_store
        self._stop_event = threading.Event()
        self._last_fingerprint: tuple[str, ...] | None = None
        self._last_recorded_at = 0.0
        self._last_browser_probe_key: tuple[str, str] | None = None
        self._last_browser_probe_at = 0.0
        self._last_browser_probe_context = BrowserContext(
            url=None,
            current_title=None,
            tab_titles=[],
            tab_urls=[],
        )

    def stop(self) -> None:
        self._stop_event.set()

    def _emit_event(self, snapshot: WindowSnapshot, browser_context: BrowserContext, interaction_type: str) -> None:
        append_event(
            application=snapshot.app_name,
            window_title=snapshot.title,
            url=browser_context.url,
            interaction_type=interaction_type,
            content_text=_compose_content_text(snapshot, browser_context),
            exe_path=snapshot.exe_path,
            tab_titles=browser_context.tab_titles,
            tab_urls=browser_context.tab_urls,
            source="monitor",
        )
        self._last_recorded_at = time.monotonic()
        if self.on_new_event is not None:
            self.on_new_event()

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                snapshot = get_active_window()
                if snapshot is not None and should_capture_window(snapshot):
                    browser_context = _browser_context_from_extension(snapshot, self.browser_state_store)
                    if browser_context is None:
                        probe_key = (snapshot.app_name.lower(), snapshot.title)
                        now = time.monotonic()
                        if self._last_browser_probe_key == probe_key and now - self._last_browser_probe_at < 2.0:
                            browser_context = self._last_browser_probe_context
                        else:
                            browser_context = get_browser_context(snapshot.hwnd, snapshot.app_name, snapshot.title)
                            self._last_browser_probe_key = probe_key
                            self._last_browser_probe_at = now
                            self._last_browser_probe_context = browser_context

                    fingerprint = (
                        snapshot.app_name.lower(),
                        snapshot.title.strip().lower(),
                        (browser_context.url or "").strip().lower(),
                        "|".join(browser_context.tab_titles[:6]).strip().lower(),
                        "|".join(browser_context.tab_urls[:6]).strip().lower(),
                    )
                    now = time.monotonic()
                    if fingerprint != self._last_fingerprint:
                        self._last_fingerprint = fingerprint
                        self._emit_event(snapshot, browser_context, "focus")
                    elif now - self._last_recorded_at >= self.heartbeat_interval:
                        self._emit_event(snapshot, browser_context, "heartbeat")
            except Exception:
                pass
            time.sleep(self.poll_interval)
