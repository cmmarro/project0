"""Proof that the local-model path works, including when the model is bad at it.

Spins up the mock OpenAI-compatible server in-process and drives the real
provider through it, in both a well-behaved mode and a deliberately sloppy one
that refuses json_schema, wraps its JSON in chat, and forgets a required key.

    python test_providers.py
"""

from __future__ import annotations

import sys
import threading
from http.server import HTTPServer

sys.path.insert(0, "tools")
import mock_openai_server as mock  # noqa: E402

from island import providers  # noqa: E402
from island.brain import PLAN_SCHEMA, SPEAK_SCHEMA  # noqa: E402

FAILS: list[str] = []


def check(label, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(label)


def serve(sloppy: bool) -> tuple[HTTPServer, int]:
    mock.SLOPPY = sloppy
    httpd = HTTPServer(("127.0.0.1", 0), mock.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def exercise(port: int, label: str, expect_strict: bool):
    p = providers.OpenAICompatProvider(f"http://127.0.0.1:{port}/v1", "qwen2.5-7b-instruct", timeout=20)

    check(f"[{label}] lists loaded models", "qwen2.5-7b-instruct" in p.list_models())
    check(f"[{label}] connection test reports success", "Connected to" in p.ping(), p.ping())
    check(f"[{label}] negotiated the expected mode", p.strict_ok is expect_strict,
          f"strict_ok={p.strict_ok}")

    for name, schema in (("speak", SPEAK_SCHEMA), ("plan", PLAN_SCHEMA)):
        out = p.complete("You are a person on a beach.", "Say something.", schema, 400)
        missing = [k for k in schema["required"] if k not in out]
        check(f"[{label}] {name}: every required key present", not missing, str(missing))
        bad_enum = [k for k, spec in schema["properties"].items()
                    if "enum" in spec and out.get(k) not in spec["enum"]]
        check(f"[{label}] {name}: enums are legal values", not bad_enum, str(bad_enum))
        wrong_type = [
            k for k, spec in schema["properties"].items()
            if (spec.get("type") == "integer" and not isinstance(out.get(k), int))
            or (spec.get("type") == "array" and not isinstance(out.get(k), list))
            or (spec.get("type") == "string" and not isinstance(out.get(k), str))
        ]
        check(f"[{label}] {name}: types match the schema", not wrong_type, str(wrong_type))


def main():
    print("\nCastaway — local model backend proof\n")

    print("URL normalising")
    n = providers.OpenAICompatProvider.normalise
    for given, want in [
        ("http://localhost:1234/v1", "http://localhost:1234/v1"),
        ("localhost:1234", "http://localhost:1234/v1"),
        ("http://localhost:1234", "http://localhost:1234/v1"),
        ("http://localhost:1234/v1/", "http://localhost:1234/v1"),
        ("http://localhost:1234/v1/chat/completions", "http://localhost:1234/v1"),
        ("", "http://localhost:1234/v1"),
    ]:
        check(f"{given or '(blank)'!r} -> {want}", n(given) == want, n(given))

    print("\nJSON recovery")
    cases = {
        "plain": '{"a": 1}',
        "fenced": '```json\n{"a": 1}\n```',
        "chatty": 'Sure! Here you go:\n\n{"a": 1}\n\nHope that helps.',
        "nested": 'text {"a": 1, "b": {"c": 2}} more text',
    }
    for label, text in cases.items():
        got = providers.extract_json(text)
        check(f"recovers JSON from {label} output", isinstance(got, dict) and got.get("a") == 1, str(got))
    check("gives up cleanly on junk", providers.extract_json("no json at all") is None)

    print("\nCoercion")
    schema = {"type": "object", "properties": {
        "n": {"type": "integer"}, "s": {"type": "string"},
        "e": {"type": "string", "enum": ["x", "y"]}, "l": {"type": "array"}}}
    got = providers.coerce(schema, {"n": "3", "e": "Y", "l": "one"})
    check("string integers become integers", got["n"] == 3, str(got))
    check("missing keys get a blank of the right type", got["s"] == "")
    check("enum case is repaired", got["e"] == "y")
    check("a scalar is lifted into an array", got["l"] == ["one"])
    check("an invented enum falls back to a legal value",
          providers.coerce(schema, {"e": "nonsense"})["e"] == "x")

    print("\nAgainst a well-behaved backend")
    httpd, port = serve(sloppy=False)
    try:
        exercise(port, "clean", expect_strict=True)
    finally:
        httpd.shutdown()

    print("\nAgainst a backend that refuses json_schema and rambles")
    httpd, port = serve(sloppy=True)
    try:
        exercise(port, "sloppy", expect_strict=False)
    finally:
        httpd.shutdown()

    print("\nUnreachable backend")
    dead = providers.OpenAICompatProvider("http://127.0.0.1:9/v1", "nope", timeout=3)
    try:
        dead.list_models()
        check("a dead server raises ProviderError", False, "no error raised")
    except providers.ProviderError as exc:
        check("a dead server raises ProviderError with a readable message",
              "couldn't reach" in str(exc), str(exc)[:70])

    print()
    if FAILS:
        print(f"  {len(FAILS)} failed: {', '.join(FAILS)}\n")
        raise SystemExit(1)
    print("  all good\n")


if __name__ == "__main__":
    main()
