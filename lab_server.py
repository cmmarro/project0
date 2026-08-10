"""The observation lab — run me:  python lab_server.py    (http://127.0.0.1:5001)

A subject, a room, and a window. The instrument panel is the point: you can see
every option it weighed and what each one scored, so a decision is never
asserted at you, it's shown.
"""

from __future__ import annotations

import logging
import os
import threading
import webbrowser

import flask.cli
from flask import Flask, jsonify, request, send_from_directory

flask.cli.show_server_banner = lambda *a, **k: None
logging.getLogger("werkzeug").setLevel(logging.WARNING)

from island import providers, settings          # the backend layer, reused as-is
from lab.lab import Lab, start
from lab.mind import Mind

app = Flask(__name__, static_folder="static", static_url_path="/static")
lab = Lab()
start(lab)


@app.get("/")
def index():
    return send_from_directory("static", "lab.html")


@app.get("/api/lab")
def state():
    return jsonify(lab.snapshot())


@app.post("/api/lab/mind")
def toggle_mind():
    """Switch the model on or off without restarting the subject.

    The whole experiment is the comparison, so it has to be a toggle you can
    flip mid-run and watch.
    """
    want = bool((request.get_json(silent=True) or {}).get("on"))
    with lab.lock:
        if not want:
            lab.mind = None
            lab.note("The mind is switched off. Ties break on score alone.", "system")
            return jsonify(lab.snapshot())
        mind = Mind()
        if not mind.online:
            return jsonify({"error": "No backend configured — set one up in the game's "
                                     "settings first, or run with LM Studio started."})
        lab.mind = mind
        lab.note("The mind is switched on. It will be asked only when two "
                 "options weigh the same.", "system")
    return jsonify(lab.snapshot())


@app.post("/api/lab/supply")
def supply():
    """Open or cut off an amenity. This is how you make a dilemma."""
    d = request.get_json(silent=True) or {}
    with lab.lock:
        lab.set_supply(d.get("key", ""), bool(d.get("on")))
    return jsonify(lab.snapshot())


@app.post("/api/lab/offer")
def offer():
    """Make it a promise through the glass: do this, and you get that."""
    d = request.get_json(silent=True) or {}
    with lab.lock:
        made = lab.offer(d.get("do", ""), d.get("gives", ""),
                         d.get("said", "").strip()[:200] or "Do that, and you eat.")
    return jsonify({**lab.snapshot(), "made": made is not None})


@app.post("/api/lab/honour")
def honour():
    d = request.get_json(silent=True) or {}
    with lab.lock:
        lab.honour(bool(d.get("keep", True)))
    return jsonify(lab.snapshot())


@app.post("/api/lab/auto")
def auto():
    d = request.get_json(silent=True) or {}
    with lab.lock:
        lab.auto_honour = bool(d.get("on"))
    return jsonify(lab.snapshot())


@app.post("/api/lab/pause")
def pause():
    with lab.lock:
        lab.running = not lab.running
        lab.note("Observation paused." if not lab.running else "Running.", "system")
    return jsonify(lab.snapshot())


@app.post("/api/lab/reset")
def reset():
    global lab
    keep = lab.mind
    lab = Lab()
    lab.mind = keep
    start(lab)
    return jsonify(lab.snapshot())


@app.get("/api/lab/backend")
def backend():
    cfg = settings.public()
    try:
        p = providers.build(settings.get())
        return jsonify({"provider": cfg.get("provider"), "model": cfg.get("model"),
                        "ready": p is not None})
    except Exception as exc:
        return jsonify({"provider": cfg.get("provider"), "model": cfg.get("model"),
                        "ready": False, "error": str(exc)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    url = f"http://127.0.0.1:{port}"
    print("\n  ---------------------------------------------")
    print("   The lab is running.")
    print(f"   Observation window:  {url}")
    print("   Press Ctrl+C here to stop.")
    print("  ---------------------------------------------\n")
    if os.environ.get("ISLAND_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)
