#!/usr/bin/env python3
"""Evidence Gate — refuse to call a response valid without structural proof.

The gate is deliberately strict. It validates the payload shape and the fields
that make an answer usable. It never treats "HTTP 200" or prose as evidence.

Examples:
    python3 tools/evidence_gate.py --kind auto --file /tmp/chat.json
    python3 tools/evidence_gate.py --kind claim --file /tmp/claim.json
    cat /tmp/models.json | python3 tools/evidence_gate.py --kind models
    python3 tools/evidence_gate.py --self-test

Exit codes: 0 = PASS, 1 = FAIL, 2 = SKIP/usage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MAX_BYTES = 4 * 1024 * 1024


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Report:
    def __init__(self, kind: str) -> None:
        self.kind = kind
        self.checks: list[dict[str, Any]] = []
        self.missing: list[str] = []
        self.warnings: list[str] = []
        self.usable = True

    def check(self, name: str, ok: bool, detail: Any = None) -> bool:
        item: dict[str, Any] = {"name": name, "ok": bool(ok)}
        if detail is not None:
            item["detail"] = detail
        self.checks.append(item)
        if not ok:
            self.missing.append(name)
        return bool(ok)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def json_text(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        json.loads(value)
        return True
    except Exception:
        return False


def validate_models(payload: Any, report: Report) -> None:
    report.check("payload_is_object", isinstance(payload, dict))
    if not isinstance(payload, dict):
        return
    if "object" in payload:
        report.check("object_is_list", payload.get("object") == "list", payload.get("object"))
    else:
        report.warn("object field is missing; a data array is the minimum evidence")
    data = payload.get("data")
    report.check("data_is_array", isinstance(data, list))
    if not isinstance(data, list):
        return
    invalid = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            invalid.append(f"data[{index}] is not an object")
            continue
        if not nonempty_str(item.get("id")):
            invalid.append(f"data[{index}].id is missing")
    report.check("all_model_ids_are_strings", not invalid, invalid[:8])
    report.check("no_duplicate_model_ids", len({item.get("id") for item in data if isinstance(item, dict) and nonempty_str(item.get("id"))}) == len([item for item in data if isinstance(item, dict) and nonempty_str(item.get("id"))]))
    report.usable = len(data) > 0
    if not data:
        report.warn("model list is structurally valid but empty; no provider model is usable")


def validate_chat(payload: Any, report: Report) -> None:
    report.check("payload_is_object", isinstance(payload, dict))
    if not isinstance(payload, dict):
        return
    if "object" in payload:
        report.check("object_is_chat_completion", payload.get("object") == "chat.completion", payload.get("object"))
    else:
        report.warn("object field is missing; choices are the minimum evidence")
    if nonempty_str(payload.get("id")):
        report.check("id_is_string", True)
    else:
        report.warn("completion id is missing")
    choices = payload.get("choices")
    report.check("choices_is_nonempty_array", isinstance(choices, list) and len(choices) > 0)
    if not isinstance(choices, list) or not choices:
        return
    for index, choice in enumerate(choices):
        prefix = f"choices[{index}]"
        report.check(f"{prefix}_is_object", isinstance(choice, dict))
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        report.check(f"{prefix}.message_is_object", isinstance(message, dict))
        if not isinstance(message, dict):
            continue
        report.check(f"{prefix}.message.role_is_assistant", message.get("role") == "assistant", message.get("role"))
        content = message.get("content")
        tool_calls = message.get("tool_calls")
        has_content = isinstance(content, str) and bool(content.strip())
        has_tools = isinstance(tool_calls, list) and len(tool_calls) > 0
        report.check(f"{prefix}.has_content_or_tool_calls", has_content or has_tools)
        report.check(f"{prefix}.content_is_string_or_null", content is None or isinstance(content, str))
        if has_tools:
            for tool_index, tool in enumerate(tool_calls):
                tprefix = f"{prefix}.tool_calls[{tool_index}]"
                report.check(f"{tprefix}_is_object", isinstance(tool, dict))
                if not isinstance(tool, dict):
                    continue
                report.check(f"{tprefix}.type_is_function", tool.get("type") == "function", tool.get("type"))
                function = tool.get("function")
                report.check(f"{tprefix}.function_is_object", isinstance(function, dict))
                if isinstance(function, dict):
                    report.check(f"{tprefix}.function.name_is_string", nonempty_str(function.get("name")))
                    report.check(f"{tprefix}.function.arguments_is_valid_json", json_text(function.get("arguments")))
        finish = choice.get("finish_reason")
        report.check(f"{prefix}.finish_reason_is_string", nonempty_str(finish), finish)
        if has_tools and finish not in {"tool_calls", "stop"}:
            report.warn(f"{prefix}.finish_reason is {finish!r} with tool_calls")
    usage = payload.get("usage")
    if usage is not None:
        if isinstance(usage, dict):
            for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
                if key in usage:
                    report.check(f"usage.{key}_is_integer", is_int(usage.get(key)), usage.get(key))
        else:
            report.check("usage_is_object", False)
    elif not any(isinstance(choice, dict) and isinstance(choice.get("message"), dict) and choice["message"].get("tool_calls") for choice in choices):
        report.warn("usage is missing; token accounting is not proven")


EVIDENCE_FILE_RE = re.compile(
    r"([\w./\\-]+\.(?:ts|tsx|js|jsx|py|java|go|rs|php|rb|json|md|css|html|yml|yaml|sh|sql|toml|ini))(?::(\d+))?"
)


def _evidence_path(source: str, root: Path) -> tuple[Path, int | None, bool] | None:
    match = EVIDENCE_FILE_RE.search(source or "")
    if not match:
        return None
    candidate = Path(match.group(1))
    line = int(match.group(2)) if match.group(2) else None
    resolved = candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()
    try:
        resolved.relative_to(root.resolve())
        inside = True
    except ValueError:
        inside = False
    return resolved, line, inside


def validate_claim(payload: Any, report: Report, root: Path | None = None) -> None:
    """A factual claim needs evidence that resolves to a real artifact.

    `verified: true` is a claim by the model, not proof. A path source must exist
    inside the allowed root (and a :line must be in range); a command source must
    carry a result marker (exit code, PASS/FAIL, test count, timing). This is what
    stops a fabricated evidence object from passing by shape alone.
    """
    base = (root or Path.cwd()).resolve()
    report.check("payload_is_object", isinstance(payload, dict))
    if not isinstance(payload, dict):
        return
    report.check("claim_is_nonempty_string", nonempty_str(payload.get("claim")))
    evidence = payload.get("evidence")
    report.check("evidence_is_nonempty_array", isinstance(evidence, list) and len(evidence) > 0)
    if not isinstance(evidence, list):
        return
    verifiable = 0
    for index, item in enumerate(evidence):
        prefix = f"evidence[{index}]"
        report.check(f"{prefix}_is_object", isinstance(item, dict))
        if not isinstance(item, dict):
            continue
        source_ok = report.check(f"{prefix}.source_is_string", nonempty_str(item.get("source")))
        observation_ok = report.check(f"{prefix}.observation_is_string", nonempty_str(item.get("observation")))
        verified_ok = report.check(f"{prefix}.verified_is_true", item.get("verified") is True)
        if not (source_ok and observation_ok and verified_ok):
            continue
        source = str(item.get("source") or "")
        observation = str(item.get("observation") or "")
        ref = _evidence_path(source, base)
        if ref is not None:
            resolved, line, inside = ref
            report.check(f"{prefix}.source_inside_root", inside, str(resolved))
            exists = inside and resolved.is_file()
            report.check(f"{prefix}.source_exists", exists, str(resolved))
            if exists and line is not None:
                try:
                    total = len(resolved.read_text(encoding="utf-8", errors="replace").splitlines())
                except Exception:
                    total = 0
                report.check(f"{prefix}.line_in_range", 0 < line <= total, f"{line} <= {total}")
            if exists:
                verifiable += 1
        else:
            has_result = bool(
                re.search(r"\b(?:exit(?:ed)?(?:\s+with)?(?:\s+code)?\s*\d+|PASS|FAIL|OK|\d+\s*/\s*\d+|\d+\s*(?:tests?|checks?)|tok/s|\d+\s*ms)\b", observation, re.I)
            )
            report.check(f"{prefix}.observation_has_result", has_result)
            if has_result:
                verifiable += 1
    report.check("at_least_one_verifiable_evidence", verifiable > 0, verifiable)
    report.usable = not report.missing


def validate_stream(payload: Any, report: Report) -> None:
    events: list[Any] = []
    if isinstance(payload, str):
        for line in payload.splitlines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                events.append(json.loads(data))
            except Exception:
                report.check("all_sse_data_events_are_json", False, data[:80])
    elif isinstance(payload, list):
        events = payload
    else:
        report.check("stream_is_array_or_sse_text", False)
        return
    report.check("stream_has_events", len(events) > 0, len(events))
    if not events:
        return
    text_parts: list[str] = []
    tool_args: dict[int, str] = {}
    tool_names: dict[int, str] = {}
    finished = False
    for index, event in enumerate(events):
        prefix = f"events[{index}]"
        report.check(f"{prefix}_is_object", isinstance(event, dict))
        if not isinstance(event, dict):
            continue
        choices = event.get("choices")
        report.check(f"{prefix}.choices_is_array", isinstance(choices, list))
        if not isinstance(choices, list):
            continue
        for c_index, choice in enumerate(choices):
            if not isinstance(choice, dict):
                report.check(f"{prefix}.choices[{c_index}]_is_object", False)
                continue
            if choice.get("finish_reason"):
                finished = True
            delta = choice.get("delta")
            if isinstance(delta, dict):
                if isinstance(delta.get("content"), str):
                    text_parts.append(delta["content"])
                for tool in delta.get("tool_calls") or []:
                    if not isinstance(tool, dict):
                        continue
                    tool_index = tool.get("index", 0)
                    if not is_int(tool_index):
                        continue
                    function = tool.get("function")
                    if isinstance(function, dict):
                        if isinstance(function.get("name"), str) and function["name"].strip():
                            tool_names[tool_index] = function["name"]
                        if isinstance(function.get("arguments"), str):
                            tool_args[tool_index] = tool_args.get(tool_index, "") + function["arguments"]
    report.check("stream_finished", finished)
    report.check("stream_has_text_or_tool_arguments", bool("".join(text_parts).strip()) or bool(tool_args))
    for tool_index, arguments in sorted(tool_args.items()):
        report.check(f"stream_tool[{tool_index}].name_present", tool_index in tool_names)
        report.check(f"stream_tool[{tool_index}].arguments_json", json_text(arguments))


def validate_responses(payload: Any, report: Report) -> None:
    report.check("payload_is_object", isinstance(payload, dict))
    if not isinstance(payload, dict):
        return
    if "object" in payload:
        report.check("object_is_response", payload.get("object") == "response", payload.get("object"))
    report.check("status_is_completed", payload.get("status") == "completed", payload.get("status"))
    output = payload.get("output")
    report.check("output_is_nonempty_array", isinstance(output, list) and len(output) > 0)
    if not isinstance(output, list) or not output:
        return
    text_parts: list[str] = []
    tool_calls = 0
    for index, item in enumerate(output):
        prefix = f"output[{index}]"
        report.check(f"{prefix}_is_object", isinstance(item, dict))
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "message":
            content = item.get("content")
            report.check(f"{prefix}.content_is_array", isinstance(content, list))
            if isinstance(content, list):
                for p_index, part in enumerate(content):
                    if isinstance(part, dict) and part.get("type") == "output_text" and isinstance(part.get("text"), str):
                        text_parts.append(part["text"])
        elif item_type == "function_call":
            tool_calls += 1
            report.check(f"{prefix}.name_is_string", nonempty_str(item.get("name")))
            report.check(f"{prefix}.arguments_is_valid_json", json_text(item.get("arguments")))
        else:
            report.warn(f"{prefix}.type is {item_type!r}")
    top_text = payload.get("output_text")
    if isinstance(top_text, str) and top_text.strip():
        text_parts.append(top_text)
    report.check("has_output_text_or_function_call", bool("".join(text_parts).strip()) or tool_calls > 0)


def validate_anthropic(payload: Any, report: Report) -> None:
    report.check("payload_is_object", isinstance(payload, dict))
    if not isinstance(payload, dict):
        return
    report.check("type_is_message", payload.get("type") == "message", payload.get("type"))
    report.check("role_is_assistant", payload.get("role") == "assistant", payload.get("role"))
    content = payload.get("content")
    report.check("content_is_nonempty_array", isinstance(content, list) and len(content) > 0)
    if not isinstance(content, list) or not content:
        return
    text_parts: list[str] = []
    tools = 0
    for index, block in enumerate(content):
        prefix = f"content[{index}]"
        report.check(f"{prefix}_is_object", isinstance(block, dict))
        if not isinstance(block, dict):
            continue
        block_type = block.get("type")
        if block_type == "text":
            if isinstance(block.get("text"), str):
                text_parts.append(block["text"])
            report.check(f"{prefix}.text_is_string", nonempty_str(block.get("text")))
        elif block_type == "tool_use":
            tools += 1
            report.check(f"{prefix}.name_is_string", nonempty_str(block.get("name")))
            report.check(f"{prefix}.input_is_object", isinstance(block.get("input"), dict))
        else:
            report.check(f"{prefix}.type_is_known", False, block_type)
    report.check("has_text_or_tool_use", bool("".join(text_parts).strip()) or tools > 0)
    report.check("stop_reason_is_string", nonempty_str(payload.get("stop_reason")), payload.get("stop_reason"))
    usage = payload.get("usage")
    report.check("usage_is_object", isinstance(usage, dict))
    if isinstance(usage, dict):
        report.check("usage.input_tokens_is_integer", is_int(usage.get("input_tokens")), usage.get("input_tokens"))
        report.check("usage.output_tokens_is_integer", is_int(usage.get("output_tokens")), usage.get("output_tokens"))


def validate_tls(payload: Any, report: Report) -> None:
    report.check("payload_is_object", isinstance(payload, dict))
    if not isinstance(payload, dict):
        return
    status = payload.get("status")
    if status == "SKIP":
        report.check("tls_status_is_not_fail", True)
        report.usable = False
        report.warn("TLS verifier skipped; this is not a PASS")
        return
    report.check("tls_status_is_pass", status == "PASS", status)
    report.check("certificate_verification_ok", payload.get("verification") == "OK", payload.get("verification"))
    report.check("tls_version_is_modern", payload.get("protocol") in {"TLSv1.2", "TLSv1.3"}, payload.get("protocol"))
    checks = payload.get("checks")
    report.check("checks_is_nonempty_array", isinstance(checks, list) and len(checks) > 0)
    if isinstance(checks, list):
        report.check("all_checks_ok", all(isinstance(item, dict) and item.get("ok") is True for item in checks))


def detect(payload: Any) -> str:
    if isinstance(payload, list):
        return "stream"
    if isinstance(payload, str):
        return "stream"
    if not isinstance(payload, dict):
        return "unknown"
    if isinstance(payload.get("data"), list) or payload.get("object") == "list":
        return "models"
    if isinstance(payload.get("choices"), list):
        return "chat"
    if payload.get("type") == "message" and isinstance(payload.get("content"), list):
        return "anthropic"
    if payload.get("object") == "response" or isinstance(payload.get("output"), list):
        return "responses"
    if "status" in payload and ("verification" in payload or "protocol" in payload):
        return "tls"
    if nonempty_str(payload.get("claim")) and isinstance(payload.get("evidence"), list):
        return "claim"
    return "unknown"


def validate(kind: str, payload: Any, root: Path | None = None) -> Report:
    actual = detect(payload) if kind == "auto" else kind
    report = Report(actual)
    if actual == "models":
        validate_models(payload, report)
    elif actual == "chat":
        validate_chat(payload, report)
    elif actual == "stream":
        validate_stream(payload, report)
    elif actual == "responses":
        validate_responses(payload, report)
    elif actual == "anthropic":
        validate_anthropic(payload, report)
    elif actual == "tls":
        validate_tls(payload, report)
    elif actual == "claim":
        validate_claim(payload, report, root)
    else:
        report.check("known_payload_kind", False, actual)
    return report


def result_dict(report: Report, raw: bytes) -> dict[str, Any]:
    status = "SKIP" if report.usable is False and not report.missing and not report.checks else ("PASS" if not report.missing else "FAIL")
    if report.kind == "tls" and any(c["name"] == "tls_status_is_not_fail" for c in report.checks):
        status = "SKIP"
    return {
        "generated_at": now(),
        "kind": report.kind,
        "status": status,
        "usable": report.usable,
        "checks": report.checks,
        "missing": report.missing,
        "warnings": report.warnings,
        "payload_sha256": hashlib.sha256(raw).hexdigest(),
        "payload_bytes": len(raw),
        "rule": "PASS only when every required check is true; HTTP 200 or fluent prose is not evidence",
    }


def self_test() -> int:
    fixtures = {
        "chat_valid": {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        },
        "chat_invalid_empty": {
            "object": "chat.completion",
            "choices": [{"message": {"role": "assistant", "content": ""}, "finish_reason": "stop"}],
        },
        "chat_tool_valid": {
            "object": "chat.completion",
            "choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [{"type": "function", "function": {"name": "lookup", "arguments": "{\"q\":\"x\"}"}}]}, "finish_reason": "tool_calls"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
        },
        "models_empty": {"object": "list", "data": []},
        "tls_valid": {"status": "PASS", "verification": "OK", "protocol": "TLSv1.3", "checks": [{"name": "verification_ok", "ok": True}]},
        "anthropic_valid": {"type": "message", "role": "assistant", "content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn", "usage": {"input_tokens": 1, "output_tokens": 1}},
        "stream_valid": "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n",
        "responses_valid": {"object": "response", "status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}]},
        "claim_valid": {"claim": "The file exists.", "evidence": [{"source": "tools/evidence_gate.py:1", "observation": "line 1 exists", "verified": True}]},
        "claim_invalid_no_evidence": {"claim": "The capital of France is Berlin.", "evidence": []},
    }
    expected = {
        "chat_valid": "PASS",
        "chat_invalid_empty": "FAIL",
        "chat_tool_valid": "PASS",
        "models_empty": "PASS",
        "tls_valid": "PASS",
        "anthropic_valid": "PASS",
        "stream_valid": "PASS",
        "responses_valid": "PASS",
        "claim_valid": "PASS",
        "claim_invalid_no_evidence": "FAIL",
    }
    failures = []
    for name, payload in fixtures.items():
        raw = json.dumps(payload).encode()
        result = result_dict(validate("auto", payload), raw)
        got = result["status"]
        print(f"{name}: {got} (expected {expected[name]})")
        if got != expected[name]:
            failures.append(name)
    if failures:
        print(json.dumps({"status": "FAIL", "failed": failures}, indent=2))
        return 1
    print(json.dumps({"status": "PASS", "fixtures": len(fixtures)}, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate an API/TLS payload before calling it valid")
    parser.add_argument("--kind", default="auto", choices=["auto", "models", "chat", "stream", "responses", "anthropic", "tls", "claim"])
    parser.add_argument("--file", default="")
    parser.add_argument("--json-out", default="")
    parser.add_argument("--root", default=".")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()

    if args.file:
        path = Path(args.file).expanduser()
        try:
            raw = path.read_bytes()
        except Exception as exc:
            print(json.dumps({"status": "SKIP", "error": f"cannot read {path}: {exc}"}, indent=2))
            return 2
    else:
        if sys.stdin.isatty():
            print(json.dumps({"status": "SKIP", "error": "no --file and stdin is a TTY"}, indent=2))
            return 2
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        print(json.dumps({"status": "FAIL", "error": f"payload exceeds {MAX_BYTES} bytes"}, indent=2))
        return 1
    if not raw.strip():
        print(json.dumps({"status": "SKIP", "error": "empty payload"}, indent=2))
        return 2
    try:
        payload = json.loads(raw)
    except Exception as exc:
        print(json.dumps({"status": "FAIL", "error": f"invalid JSON: {exc}"}, indent=2))
        return 1

    report = validate(args.kind, payload, Path(args.root).expanduser())
    result = result_dict(report, raw)
    if args.json_out:
        out = Path(args.json_out).expanduser()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else (2 if result["status"] == "SKIP" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
