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

from island import providers, settings  # noqa: E402

settings._current = dict(settings.DEFAULTS)
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

    print("\nBackends that only support some response modes")
    # LM Studio: json_schema or text, no json_object. This is a real failure
    # that got reported from an actual install.
    mock.REJECT = {"json_object"}
    httpd, port = serve(sloppy=False)
    try:
        p = providers.OpenAICompatProvider(f"http://127.0.0.1:{port}/v1",
                                           "qwen2.5-7b-instruct", timeout=20)
        out = p.complete("You are a person.", "Speak.", SPEAK_SCHEMA, 400)
        check("LM Studio-shaped backend still works", p.mode_used == "json_schema", str(p.mode_used))
        check("and returns a complete answer",
              all(k in out for k in SPEAK_SCHEMA["required"]))
    finally:
        httpd.shutdown()

    # Worst case: no structured support at all, so it has to fall to plain text.
    mock.REJECT = {"json_schema", "json_object"}
    httpd, port = serve(sloppy=False)
    try:
        p = providers.OpenAICompatProvider(f"http://127.0.0.1:{port}/v1",
                                           "qwen2.5-7b-instruct", timeout=20)
        out = p.complete("You are a person.", "Speak.", SPEAK_SCHEMA, 400)
        check("a backend with no structured output falls through to text",
              p.mode_used == "text", str(p.mode_used))
        check("text mode still yields a schema-shaped answer",
              all(k in out for k in SPEAK_SCHEMA["required"]))
        check("refused modes are struck off and not retried",
              p.modes == ["text"], str(p.modes))
        check("the connection test names the loose mode", "loosest mode" in p.ping(), p.ping())
    finally:
        mock.REJECT = set()
        httpd.shutdown()

    # And when nothing works, say what each mode actually complained about.
    mock.REJECT = {"json_schema", "json_object", "text"}
    httpd, port = serve(sloppy=False)
    try:
        p = providers.OpenAICompatProvider(f"http://127.0.0.1:{port}/v1", "x", timeout=20)
        try:
            p.complete("s", "u", SPEAK_SCHEMA, 100)
            check("total failure raises", False, "no error")
        except providers.ProviderError as exc:
            msg = str(exc)
            check("the error names every mode tried, not just the last",
                  all(m in msg for m in ("json_schema", "json_object", "text")), msg[:100])
    finally:
        mock.REJECT = set()
        httpd.shutdown()

    print("\nAuthentication")
    mock.REQUIRE_TOKEN = False
    httpd, port = serve(sloppy=False)
    base = f"http://127.0.0.1:{port}/v1"
    try:
        mock.LAST_AUTH = None
        providers.OpenAICompatProvider(base, "qwen2.5-7b-instruct", timeout=20).list_models()
        check("no key configured means no Authorization header at all",
              mock.LAST_AUTH is None, f"sent {mock.LAST_AUTH!r}")

        mock.LAST_AUTH = None
        providers.OpenAICompatProvider(base, "qwen2.5-7b-instruct",
                                       api_key="  ", timeout=20).list_models()
        check("a whitespace-only key is treated as no key", mock.LAST_AUTH is None,
              f"sent {mock.LAST_AUTH!r}")

        mock.REQUIRE_TOKEN = True
        p = providers.OpenAICompatProvider(base, "qwen2.5-7b-instruct", timeout=20)
        try:
            p.list_models()
            check("a server that wants a token still rejects us", False, "no error raised")
        except providers.ProviderError as exc:
            check("401 explains where to find the token in LM Studio",
                  "Developer" in str(exc) and "401" in str(exc), str(exc)[-110:])

        p = providers.OpenAICompatProvider(base, "qwen2.5-7b-instruct",
                                           api_key="not-needed", timeout=20)
        try:
            p.list_models()
            check("a bogus token is rejected", False, "no error raised")
        except providers.ProviderError as exc:
            check("401 on a bad key says to clear the field or use the lms- token",
                  "clear the API key field" in str(exc), str(exc)[-110:])

        p = providers.OpenAICompatProvider(base, "qwen2.5-7b-instruct",
                                           api_key=mock.VALID_TOKEN, timeout=20)
        check("a real token gets through", "qwen2.5-7b-instruct" in p.list_models())
        check("and it was actually sent", mock.LAST_AUTH == f"Bearer {mock.VALID_TOKEN}",
              str(mock.LAST_AUTH))
        check("a full call works with auth on", "Connected to" in p.ping())
    finally:
        mock.REQUIRE_TOKEN = False
        httpd.shutdown()

    print("\nSalvaging what a small model says")
    from island.brain import is_stale, tidy_line, too_similar
    salvage = [
        ("I am Barnaby Ferreira (he/him), a 34-year-old adjuster forced into a war for survival", ""),
        ("I need to react to my current state. Thirst is high (38/100).", ""),
        ("*wipes his forehead* Water. We need it before dark.", "Water. We need it before dark."),
        ("Fine. But I'm counting what goes in that pile.", "Fine. But I'm counting what goes in that pile."),
        ("I am Odell Kaminski. Water is west of here.", "Water is west of here."),
        ("I am thirsty and there is no water left.", "I am thirsty and there is no water left."),
        # Straight from a playtest: third-person prose with the closing brace
        # of the JSON object left on the end of the line.
        ('"Well then," said Barnaby, eyeing the stranger\'s retreating back. '
         '"I suppose I\'ll do the same." }', "I suppose I'll do the same."),
        ("I remember that the stranger needs water too, like me.", ""),
        ("He sounds worried. Water's west.", "He sounds worried. Water's west."),
    ]
    for raw, want in salvage:
        got = tidy_line(raw)
        check(f"{'drops' if want == '' else 'keeps'}: {raw[:38]}…", got == want, f"got {got!r}")
    long = "So anyway. " * 60
    check("a rambling answer is cut to something readable", len(tidy_line(long)) <= 261,
          f"{len(tidy_line(long))} chars")
    check("a memory keeps its own voice",
          tidy_line("I remember that Marisol shared.", speech=False)
          == "I remember that Marisol shared.")

    print("\nWhen the model stops being a person")
    from island.brain import is_empty_opener
    for raw in ("I can't help with that.", "I don't have access to that information.",
                "Is there anything else I can help you with?",
                "I'm sorry, but I cannot answer that."):
        check(f"drops assistant-speak: {raw[:34]}…", tidy_line(raw) == "", repr(tidy_line(raw)))
    check("but a person saying they can't do something survives",
          tidy_line("I can't carry both. You take the rope.")
          == "I can't carry both. You take the rope.")

    print("\nGreetings with nothing in them")
    # Forbidding a second hello while giving them nothing to answer is what
    # produced "I can't help with that" in a playtest.
    for raw, want in [("Hello there", True), ("Guys, hey.", True), ("Hye guys.", True),
                      ("Hello Barnaby", True), ("good morning everyone", True),
                      ("Where is the water?", False), ("Hey, we need timber.", False),
                      ("Hello, did you take the rope?", False),
                      ("The spring is dry.", False)]:
        check(f"{'empty' if want else 'has something in it'}: {raw!r}",
              is_empty_opener(raw) is want)

    print("\nNot saying the same thing twice")
    check("a greeting to someone you've met is thrown away", is_stale("Hello there! Nice to meet you."))
    check("...and so is the third one", is_stale("Hello again Barnaby."))
    check("but a greeting at first contact is fine",
          not is_stale("Hello there! Nice to meet you.", known=False))
    check("your own words read back at you are caught",
          is_stale("Hye guys.", ["Hye guys."]))
    check("a near-repeat is caught too",
          too_similar("Fine whatever the direction of water.",
                      "Fine, whatever the direction of the water"))
    check("two people both mentioning water is not a repeat",
          not too_similar("Water's west of here, past the rocks.",
                          "I've got eight coconuts and no fire to cook on."))
    check("a real answer survives", not is_stale("No idea. I've not been past the rocks.",
                                                 ["Where's the water?"]))

    print("\nFallback lines")
    from island.brain import Brain
    b = Brain.__new__(Brain)
    b._lock = threading.Lock()
    b._recent_canned = []
    runs = [b._canned() for _ in range(6)]
    check("the same canned line is never used twice running",
          all(a != c for a, c in zip(runs, runs[1:])), " / ".join(runs[:3]))

    print("\nReasoning models")
    think = "<think>The user wants me to decide. Let me weigh the options.</think>\n" \
            '{"say": "Water is west. I am going.", "emotion": "determined"}'
    got = providers.extract_json(think)
    check("a <think> block is stripped before parsing",
          isinstance(got, dict) and got.get("say", "").startswith("Water"), str(got))
    p_nt = providers.OpenAICompatProvider("http://x/v1", "m", no_think=True)
    body = p_nt._payload("SYS", "USR", {"type": "object", "properties": {}}, 100, "json_schema")
    check("thinking is switched off in the request body",
          body.get("chat_template_kwargs") == {"enable_thinking": False}, str(body.get("chat_template_kwargs")))
    check("and asked for in words too", "/no_think" in body["messages"][0]["content"])
    p_t = providers.OpenAICompatProvider("http://x/v1", "m", no_think=False)
    body2 = p_t._payload("SYS", "USR", {"type": "object", "properties": {}}, 100, "json_schema")
    check("and left alone when unticked", "chat_template_kwargs" not in body2)

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
