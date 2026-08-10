"""Model backends.

Two providers, one interface:

  * AnthropicProvider     — the Claude API via the official SDK
  * OpenAICompatProvider  — anything speaking OpenAI's /v1/chat/completions:
                            LM Studio, Ollama, llama.cpp, vLLM, LiteLLM, …

Both take a JSON schema and are expected to return a dict matching it. Local
models are far less reliable at that than a frontier model, so the OpenAI path
degrades in stages: strict json_schema → json_object with the schema in the
prompt → fish the JSON out of whatever prose came back → coerce the result
against the schema so a missing key doesn't lose the whole turn.
"""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request

USER_AGENT = "castaway/1.0"


class ProviderError(Exception):
    pass


# --- schema-tolerant parsing -------------------------------------------------

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)
_THINK = re.compile(r"<(think|thinking|reasoning)>.*?</\1>", re.S | re.I)


def extract_json(text: str) -> dict | None:
    """Get an object out of a response that may be wrapped in prose or fences."""
    if not text:
        return None
    # Reasoning models put <think>…</think> in front of the answer.
    text = _THINK.sub(" ", text).strip()
    if not text:
        return None
    candidates = [text]
    m = _FENCE.search(text)
    if m:
        candidates.insert(0, m.group(1))
    # Longest balanced {...} span, which handles a model that chats first.
    start, depth = None, 0
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                candidates.append(text[start:i + 1])
    for c in candidates:
        try:
            out = json.loads(c.strip())
            if isinstance(out, dict):
                return out
        except (ValueError, TypeError):
            continue
    return None


def _blank_for(spec: dict):
    if "enum" in spec:
        return spec["enum"][0]
    kind = spec.get("type")
    if kind == "integer":
        return 0
    if kind == "number":
        return 0.0
    if kind == "boolean":
        return False
    if kind == "array":
        return []
    if kind == "object":
        return {}
    return ""


def coerce(schema: dict, data: dict) -> dict:
    """Make a loose response fit the schema rather than throwing the turn away."""
    props = schema.get("properties", {})
    out: dict = {}
    for key, spec in props.items():
        value = data.get(key)
        if value is None:
            out[key] = _blank_for(spec)
            continue
        kind = spec.get("type")
        try:
            if kind == "integer":
                value = int(round(float(value)))
            elif kind == "number":
                value = float(value)
            elif kind == "string" and not isinstance(value, str):
                value = str(value)
            elif kind == "array" and not isinstance(value, list):
                value = [value] if value != "" else []
            elif kind == "boolean":
                value = bool(value)
        except (TypeError, ValueError):
            value = _blank_for(spec)
        if "enum" in spec and value not in spec["enum"]:
            # A local model will happily invent an action. Snap it back.
            lowered = str(value).strip().lower()
            match = next((e for e in spec["enum"] if str(e).lower() == lowered), None)
            value = match if match is not None else _blank_for(spec)
        out[key] = value
    return out


def schema_hint(schema: dict) -> str:
    """A plain-language nudge for backends without real schema enforcement."""
    lines = []
    for key, spec in schema.get("properties", {}).items():
        bits = spec.get("type", "string")
        if "enum" in spec:
            bits += " — one of: " + ", ".join(str(e) for e in spec["enum"])
        desc = spec.get("description", "")
        lines.append(f'  "{key}": {bits}{" — " + desc if desc else ""}')
    return ("Reply with a single JSON object and nothing else. No prose, no code "
            "fences. Its keys are exactly:\n" + "\n".join(lines))


# --- providers ---------------------------------------------------------------

class BaseProvider:
    kind = "none"
    label = "none"

    def complete(self, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        raise NotImplementedError

    def list_models(self) -> list[str]:
        return []

    def ping(self) -> str:
        """Cheap reachability check. Returns a human-readable status."""
        return "ok"


class AnthropicProvider(BaseProvider):
    kind = "anthropic"

    def __init__(self, model: str, api_key: str = "", effort: str = "low"):
        try:
            import anthropic  # noqa: PLC0415
        except ImportError as exc:
            raise ProviderError("the anthropic package isn't installed — pip install anthropic") from exc
        self.model = model or "claude-opus-5"
        self.effort = effort or "low"
        kwargs = {"api_key": api_key} if api_key else {}
        try:
            self.client = anthropic.Anthropic(**kwargs)
        except Exception as exc:
            raise ProviderError(f"couldn't build the Anthropic client: {exc}") from exc
        self.label = f"anthropic · {self.model}"

    def complete(self, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        resp = self.client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": schema},
            },
        )
        if resp.stop_reason == "refusal":
            raise ProviderError("the model declined to answer")
        text = next((b.text for b in resp.content if b.type == "text"), "")
        data = extract_json(text)
        if data is None:
            raise ProviderError("no JSON object in the response")
        return coerce(schema, data)

    def list_models(self) -> list[str]:
        try:
            return [m.id for m in self.client.models.list()]
        except Exception:
            return []

    def ping(self) -> str:
        self.client.messages.create(
            model=self.model, max_tokens=16,
            messages=[{"role": "user", "content": "Say OK."}],
        )
        return f"reached {self.model}"


class OpenAICompatProvider(BaseProvider):
    """LM Studio and friends. Speaks /v1/chat/completions over plain HTTP."""

    kind = "openai"

    def __init__(self, base_url: str, model: str, api_key: str = "",
                 temperature: float = 0.8, timeout: int = 120, no_think: bool = True):
        self.base = self.normalise(base_url)
        self.model = model
        # No placeholder token. LM Studio validates the format of whatever you
        # send and 401s on a made-up one, so when there's no key we send no
        # Authorization header at all.
        self.api_key = (api_key or "").strip()
        self.temperature = temperature
        self.timeout = timeout
        # Reasoning models can't emit <think> under a schema constraint — the
        # generation is grammar-locked from the first token, so the request
        # fails or comes back mangled. Ask them to skip it.
        self.no_think = no_think
        self.send_template_kwargs = no_think
        # Which response_format modes this backend will accept. Each gets struck
        # off the first time it's rejected, so we stop asking. LM Studio takes
        # json_schema or text and has no json_object; other servers differ again.
        self.modes = ["json_schema", "json_schema_loose", "json_object", "text"]
        self.mode_used: str | None = None
        self.label = f"{self.base} · {model or '(no model set)'}"

    @property
    def strict_ok(self) -> bool:
        return "json_schema" in self.modes

    @staticmethod
    def normalise(base_url: str) -> str:
        base = (base_url or "").strip().rstrip("/")
        if not base:
            base = "http://localhost:1234/v1"
        if not base.startswith(("http://", "https://")):
            base = "http://" + base
        # Accept ".../v1", ".../v1/chat/completions", or a bare host:port.
        for tail in ("/chat/completions", "/completions"):
            if base.endswith(tail):
                base = base[: -len(tail)]
        if not base.endswith("/v1"):
            base += "/v1"
        return base

    def _request(self, path: str, payload: dict | None = None, timeout: int | None = None):
        url = f"{self.base}{path}"
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(url, data=data, method="POST" if data else "GET", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as exc:
            body = ""
            try:
                body = exc.read().decode()[:400]
            except Exception:
                pass
            raise ProviderError(f"HTTP {exc.code} from {url}: {self._explain(exc.code, body) or body or exc.reason}") from exc
        except urllib.error.URLError as exc:
            raise ProviderError(f"couldn't reach {url}: {exc.reason}") from exc
        except TimeoutError as exc:
            raise ProviderError(f"{url} timed out after {timeout or self.timeout}s") from exc

    def _explain(self, code: int, body: str) -> str:
        """Turn a backend's error into something you can act on."""
        if code == 401:
            if self.api_key:
                return ("that API key was rejected. If this is LM Studio with authentication "
                        "switched on, use the token it shows you (it starts with 'lms-'). "
                        "If authentication is off, clear the API key field entirely.")
            return ("the server wants an API key. In LM Studio that's Developer → Settings → "
                    "authentication; copy the token it shows and paste it into the API key field.")
        if code == 404 and "/models" not in body:
            return (f"nothing is serving the OpenAI API at {self.base}. Check the port — "
                    "LM Studio usually uses 1234, Ollama 11434.")
        return ""

    def list_models(self) -> list[str]:
        data = self._request("/models", timeout=15)
        return [m.get("id", "") for m in data.get("data", []) if m.get("id")]

    def _payload(self, system: str, user: str, schema: dict, max_tokens: int, mode: str) -> dict:
        # Only json_schema enforces the shape server-side. The other two modes
        # have to ask for it in words, so the schema goes into the system prompt.
        enforced = mode.startswith("json_schema")
        sys_text = system if enforced else f"{system}\n\n{schema_hint(schema)}"
        if self.no_think:
            sys_text += ("\n\nAnswer immediately with the JSON object. Do not reason step by "
                         "step, do not write <think> tags, do not explain yourself. /no_think")
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": sys_text},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": self.temperature,
            "stream": False,
        }
        if self.send_template_kwargs:
            # Qwen3 and friends read this to switch reasoning off. Backends that
            # don't know it usually ignore it; the ones that 400 get retried without.
            body["chat_template_kwargs"] = {"enable_thinking": False}
        if enforced:
            spec = {"name": "reply", "schema": schema}
            if mode == "json_schema":
                # Some backends want it, some reject it. If strict fails we retry
                # the same mode without it before giving up on schemas entirely.
                spec["strict"] = True
            body["response_format"] = {"type": "json_schema", "json_schema": spec}
        elif mode == "json_object":
            body["response_format"] = {"type": "json_object"}
        # text mode sends no response_format at all — every backend accepts that.
        return body

    def complete(self, system: str, user: str, schema: dict, max_tokens: int) -> dict:
        """Try each response mode the backend hasn't already refused."""
        failures: list[str] = []
        for mode in list(self.modes):
            try:
                data = self._request("/chat/completions",
                                     self._payload(system, user, schema, max_tokens, mode))
            except ProviderError as exc:
                if self.send_template_kwargs and "chat_template_kwargs" in str(exc):
                    # Backend doesn't accept that hint. Drop it and retry this mode.
                    self.send_template_kwargs = False
                    try:
                        data = self._request("/chat/completions",
                                             self._payload(system, user, schema, max_tokens, mode))
                    except ProviderError as exc2:
                        exc = exc2
                    else:
                        failures.append(f"{mode}: retried without chat_template_kwargs")
                        data = data
                        choices = data.get("choices") or []
                        if choices:
                            content = (choices[0].get("message") or {}).get("content") or ""
                            parsed = extract_json(content)
                            if parsed is not None:
                                self.mode_used = mode
                                return coerce(schema, parsed)
                failures.append(f"{mode}: {exc}")
                if "HTTP 4" in str(exc) and mode != "text":
                    # This backend doesn't offer that mode. Stop asking for it.
                    self.modes.remove(mode)
                    continue
                raise ProviderError(" | ".join(failures)) from exc

            choices = data.get("choices") or []
            if not choices:
                failures.append(f"{mode}: no choices in the response")
                continue
            content = (choices[0].get("message") or {}).get("content") or ""
            parsed = extract_json(content)
            if parsed is None:
                failures.append(f"{mode}: no JSON in the reply — {content[:120]!r}")
                continue
            self.mode_used = mode
            return coerce(schema, parsed)

        raise ProviderError(
            "couldn't get JSON out of this backend. Tried " + ", ".join(failures)
            if failures else "no usable response")

    def ping(self) -> str:
        models = self.list_models()
        if not self.model:
            raise ProviderError(
                "reachable, but no model selected — "
                + (f"try one of: {', '.join(models[:3])}" if models else "and it reports no loaded models"))
        if models and self.model not in models:
            raise ProviderError(f"'{self.model}' isn't loaded. Available: {', '.join(models[:5])}")
        probe = {
            "type": "object",
            "properties": {"ok": {"type": "boolean"}, "note": {"type": "string"}},
            "required": ["ok", "note"],
            "additionalProperties": False,
        }
        out = self.complete(
            "You are a test harness. Answer only with the JSON object requested.",
            "Set ok to true and note to the single word 'ready'.",
            probe, 200,
        )
        described = {
            "json_schema": "structured output (json_schema) — the strongest mode",
            "json_schema_loose": "structured output (json_schema without the strict flag)",
            "json_object": "JSON-object mode; this backend has no json_schema, so replies get repaired",
            "text": "plain text with the schema asked for in the prompt — the loosest mode, "
                    "expect the occasional rough turn",
        }.get(self.mode_used or "", self.mode_used or "?")
        note = str(out.get("note") or "").strip()
        detail = f", said {note!r}" if note else ""
        return f"Connected to {self.model} using {described}{detail}."


def build(settings: dict) -> BaseProvider | None:
    """Make a provider from a settings dict, or None for offline."""
    provider = (settings.get("provider") or "offline").lower()
    if provider == "offline":
        return None
    if provider == "anthropic":
        return AnthropicProvider(
            model=settings.get("model") or "claude-opus-5",
            api_key=settings.get("api_key", ""),
            effort=settings.get("effort", "low"),
        )
    if provider == "openai":
        return OpenAICompatProvider(
            base_url=settings.get("base_url", ""),
            model=settings.get("model", ""),
            api_key=settings.get("api_key", ""),
            temperature=float(settings.get("temperature", 0.8)),
            timeout=int(settings.get("timeout", 120)),
            no_think=bool(settings.get("no_think", True)),
        )
    raise ProviderError(f"unknown provider {provider!r}")
