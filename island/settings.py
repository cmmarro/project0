"""Runtime model settings, editable from the browser and persisted to disk.

Kept out of the game state deliberately: you can point the survivors at a
different backend mid-run without restarting the island.
"""

from __future__ import annotations

import json
import os
import pathlib
import threading

def _user_dir() -> pathlib.Path:
    """Somewhere your settings survive replacing the game folder.

    People update this by downloading the ZIP again and extracting it fresh,
    which throws away everything not in the repo — including the settings you
    spent ten minutes getting right. So the default home for them is outside
    the folder.
    """
    if os.name == "nt":
        base = os.environ.get("APPDATA") or (pathlib.Path.home() / "AppData" / "Roaming")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or (pathlib.Path.home() / ".config")
    return pathlib.Path(base) / "castaway"


HERE = pathlib.Path(__file__).resolve().parent.parent / "settings.json"
USER = _user_dir() / "settings.json"


def _path() -> pathlib.Path:
    """A settings.json sitting next to the game wins — that's someone who put
    it there on purpose. Otherwise use the per-user copy."""
    return HERE if HERE.exists() else USER


# Kept as a module-level name because the tests and a couple of call sites
# refer to it; it tracks whichever file is actually in use.
PATH = _path()

DEFAULTS = {
    "provider": "offline",                    # offline | anthropic | openai
    "base_url": "http://localhost:1234/v1",   # LM Studio's default
    "model": "",
    "api_key": "",
    "effort": "low",                          # anthropic only
    "temperature": 0.8,                       # openai-compatible only
    "max_tokens": 700,
    "prompt_style": "auto",                   # auto | full | compact
    "no_think": True,                         # ask reasoning models not to think

    "timeout": 120,
}

_lock = threading.RLock()
_current: dict = dict(DEFAULTS)


def _from_env() -> dict:
    """Environment still works, so existing setups don't break."""
    out: dict = {}
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        out["provider"] = "anthropic"
        out["model"] = os.environ.get("ISLAND_MODEL", "claude-opus-5")
    if os.environ.get("ISLAND_BASE_URL"):
        out["provider"] = "openai"
        out["base_url"] = os.environ["ISLAND_BASE_URL"]
        out["model"] = os.environ.get("ISLAND_MODEL", "")
    return out


def load() -> dict:
    global _current
    with _lock:
        data = dict(DEFAULTS)
        data.update(_from_env())
        path = _path()
        if path.exists():
            try:
                saved = json.loads(path.read_text())
                data.update({k: v for k, v in saved.items() if k in DEFAULTS})
            except (ValueError, OSError):
                pass
        _current = data
        return dict(_current)


def get() -> dict:
    with _lock:
        return dict(_current)


def update(patch: dict) -> dict:
    with _lock:
        for key, value in (patch or {}).items():
            if key not in DEFAULTS:
                continue
            # An empty api_key in a save means "leave what's there" — the UI
            # sends a masked placeholder rather than the real secret.
            if key == "api_key" and value in ("", None, MASK):
                continue
            _current[key] = value
        save()
        return dict(_current)


def save():
    with _lock:
        path = _path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(_current, indent=2) + "\n")
            os.chmod(path, 0o600)      # it holds an API key
        except OSError:
            pass


MASK = "••••••••"


def public() -> dict:
    """Safe to send to the browser: the key is never echoed back."""
    data = get()
    data["api_key"] = MASK if data.get("api_key") else ""
    data["has_key"] = bool(get().get("api_key"))
    return data


load()
