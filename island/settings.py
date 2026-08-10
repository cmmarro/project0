"""Runtime model settings, editable from the browser and persisted to disk.

Kept out of the game state deliberately: you can point the survivors at a
different backend mid-run without restarting the island.
"""

from __future__ import annotations

import json
import os
import pathlib
import threading

PATH = pathlib.Path(__file__).resolve().parent.parent / "settings.json"

DEFAULTS = {
    "provider": "offline",                    # offline | anthropic | openai
    "base_url": "http://localhost:1234/v1",   # LM Studio's default
    "model": "",
    "api_key": "",
    "effort": "low",                          # anthropic only
    "temperature": 0.8,                       # openai-compatible only
    "max_tokens": 1200,
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
        if PATH.exists():
            try:
                saved = json.loads(PATH.read_text())
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
        try:
            PATH.write_text(json.dumps(_current, indent=2) + "\n")
            os.chmod(PATH, 0o600)      # it holds an API key
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
