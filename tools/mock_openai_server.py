"""A stand-in for LM Studio, for testing the local-model path without a GPU.

Speaks enough of the OpenAI API for the game: GET /v1/models and
POST /v1/chat/completions. It reads the requested JSON schema and invents a
conforming answer.

    python tools/mock_openai_server.py              # well-behaved backend
    python tools/mock_openai_server.py --sloppy     # refuses json_schema, wraps
                                                    # its JSON in chatty prose,
                                                    # and drops a required key

The --sloppy mode is the point: it imitates a small local model badly following
instructions, so the fallback and repair paths get exercised.
"""

from __future__ import annotations

import argparse
import json
import random
from http.server import BaseHTTPRequestHandler, HTTPServer

LINES = [
    "You'll want to move before the light goes.",
    "I've got water. I'm not carrying it for both of us.",
    "Fine. But I'm counting what goes in that pile.",
    "There's timber on the far side. It isn't going to walk here.",
    "Say that again and mean it this time.",
]

SLOPPY = False
MODEL_ID = "qwen2.5-7b-instruct"
REQUIRE_TOKEN = False        # imitate LM Studio with authentication switched on
# Modes this fake backend refuses. LM Studio takes json_schema or text and has
# no json_object at all, which is exactly the shape of a real bug this caught.
REJECT: set[str] = set()
VALID_TOKEN = "lms-test-token"
LAST_AUTH: str | None = None  # what the last request sent, for tests


def invent(schema: dict) -> dict:
    out = {}
    for key, spec in schema.get("properties", {}).items():
        if "enum" in spec:
            out[key] = random.choice(spec["enum"])
        elif spec.get("type") == "integer":
            out[key] = 0
        elif spec.get("type") == "array":
            out[key] = []
        elif key in ("say", "thought"):
            out[key] = random.choice(LINES)
        elif key == "memory":
            out[key] = "Worth remembering that they said that."
        else:
            out[key] = ""
    if SLOPPY and len(out) > 2:
        # A small model forgetting a field is the common failure. Drop one.
        out.pop(sorted(out)[-1], None)
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _auth_failure(self):
        """LM Studio validates the token's shape and 401s on anything else."""
        global LAST_AUTH
        header = self.headers.get("Authorization")
        LAST_AUTH = header
        if not REQUIRE_TOKEN:
            return None
        token = (header or "").removeprefix("Bearer ").strip()
        if not token:
            return {"error": {"message": "No API token provided.",
                              "type": "invalid_request_error", "code": "invalid_api_key"}}
        if not token.startswith("lms-"):
            return {"error": {"message": f"Malformed LM Studio API token provided: {token}. "
                                         "Ensure you are using a valid token.",
                              "type": "invalid_request_error", "code": "invalid_api_key"}}
        if token != VALID_TOKEN:
            return {"error": {"message": "Invalid API token.",
                              "type": "invalid_request_error", "code": "invalid_api_key"}}
        return None

    def _send(self, code: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        bad = self._auth_failure()
        if bad:
            return self._send(401, bad)
        if self.path.rstrip("/").endswith("/models"):
            return self._send(200, {"object": "list", "data": [
                {"id": MODEL_ID, "object": "model"},
                {"id": "llama-3.2-3b-instruct", "object": "model"},
            ]})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        bad = self._auth_failure()
        if bad:
            return self._send(401, bad)
        length = int(self.headers.get("Content-Length") or 0)
        req = json.loads(self.rfile.read(length) or b"{}")
        fmt = req.get("response_format") or {}
        mode = fmt.get("type") or "text"

        if mode in REJECT or (mode == "json_schema" and SLOPPY):
            if mode == "json_object":
                # LM Studio's actual wording.
                return self._send(400, {"error": "'response_format.type' must be 'json_schema' or 'text'"})
            return self._send(400, {"error": {
                "message": f"'response_format.{mode}' is not supported by this model",
            }})

        if mode == "json_schema":
            schema = fmt["json_schema"]["schema"]
            content = json.dumps(invent(schema))
        else:
            # No server-side enforcement: recover the shape from the prompt hint.
            schema = self._schema_from_hint(req)
            content = json.dumps(invent(schema))
            if SLOPPY:
                content = f"Sure! Here's the JSON you asked for:\n```json\n{content}\n```\nHope that helps."

        self._send(200, {
            "id": "chatcmpl-mock",
            "object": "chat.completion",
            "model": req.get("model", MODEL_ID),
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140},
        })

    @staticmethod
    def _schema_from_hint(req: dict) -> dict:
        """Rebuild a rough schema from the plain-language hint in the system prompt."""
        system = next((m.get("content", "") for m in req.get("messages", [])
                       if m.get("role") == "system"), "")
        props: dict = {}
        for line in system.splitlines():
            line = line.strip()
            if not line.startswith('"'):
                continue
            key = line.split('"')[1]
            spec: dict = {"type": "string"}
            if "one of:" in line:
                tail = line.split("one of:", 1)[1]
                spec = {"type": "string",
                        "enum": [v.strip() for v in tail.split("—")[0].split(",") if v.strip()]}
            elif line.split(":", 1)[1].strip().startswith("integer"):
                spec = {"type": "integer"}
            elif line.split(":", 1)[1].strip().startswith("array"):
                spec = {"type": "array"}
            props[key] = spec
        return {"type": "object", "properties": props}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=1234)
    ap.add_argument("--sloppy", action="store_true",
                    help="imitate a small model: no json_schema, prose around the JSON, missing keys")
    ap.add_argument("--require-token", action="store_true",
                    help=f"imitate LM Studio with auth on; expects {VALID_TOKEN!r}")
    ap.add_argument("--reject", default="",
                    help="comma-separated response_format modes to 400 on, e.g. json_object")
    args = ap.parse_args()

    global SLOPPY, REQUIRE_TOKEN, REJECT
    SLOPPY = args.sloppy
    REQUIRE_TOKEN = args.require_token
    REJECT = {m.strip() for m in args.reject.split(",") if m.strip()}
    mode = ("sloppy" if SLOPPY else "well-behaved") + (", auth required" if REQUIRE_TOKEN else "")
    if REJECT:
        mode += ", rejects " + "/".join(sorted(REJECT))
    print(f"mock OpenAI-compatible server ({mode}) on http://127.0.0.1:{args.port}/v1")
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
