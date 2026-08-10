"""Straight into the lab:  python lab_server.py

Same app as server.py — this only skips the start screen and opens the lab.
"""

from __future__ import annotations

import os
import threading
import webbrowser

from server import app

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    url = f"http://127.0.0.1:{port}/lab"
    print("\n  ---------------------------------------------")
    print("   The lab is running.")
    print(f"   Observation window:  {url}")
    print("   Press Ctrl+C here to stop.")
    print("  ---------------------------------------------\n")
    if os.environ.get("ISLAND_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    app.run(host="127.0.0.1", port=port, threaded=True, debug=False)
