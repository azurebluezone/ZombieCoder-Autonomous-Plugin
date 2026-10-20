#!/usr/bin/env python3
"""Build an evidence-based origin profile from a Hulia 100C report.

This does not invent a host and does not choose silently when the scan found
multiple public origins. It normalizes every discovered endpoint, counts where
it came from, and emits a profile with an explicit `requires_choice` flag.

Usage:
    python3 tools/origin_profile.py --report /tmp/opencode/hulia-100c-report.json
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

TEMPLATE = "tls/nginx.conf.template"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize(endpoint: str) -> str | None:
    try:
        parsed = urlsplit(endpoint)
    except Exception:
        return None
    if parsed.scheme.lower() not in {"http", "https", "ws", "wss"}:
        return None
    if not parsed.hostname:
        return None
    scheme = "https" if parsed.scheme.lower() in {"https", "wss"} else "http"
    host = parsed.hostname.lower()
    try:
        port = parsed.port
    except ValueError:
        return None
    if port and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        return f"{scheme}://{host}:{port}"
    return f"{scheme}://{host}"


def local_host(host: str) -> bool:
    return host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} or host.endswith(".local")


def placeholder_host(host: str) -> bool:
    return (
        host in {"host", "example.com", "example.org", "example.net"}
        or host.endswith((".example", ".test", ".invalid", ".example.com", ".example.org", ".example.net"))
    )


def source_priority(source: str) -> int:
    if source.startswith("client:opencode-"):
        return 3
    if source.startswith("client:"):
        return 2
    if source.startswith("file:"):
        path = source[5:].replace("\\", "/")
        if path.endswith(("package-lock.json", "package.json", "README.md")) or "/test/" in path:
            return 0
        if "/src/" in path or "/doc/" in path or path.endswith("model.mjs"):
            return 2
        return 1
    return 1


def api_like(endpoint: str) -> bool:
    path = (urlsplit(endpoint).path or "").lower()
    return any(part in path for part in ("/v1", "/api", "/mcp", "/rpc", "/sse", "/chat", "/models"))


def build(report: dict[str, Any]) -> dict[str, Any]:
    counts: Counter[str] = Counter()
    sources: dict[str, set[str]] = defaultdict(set)
    raw_endpoints: Counter[str] = Counter()
    api_like_origins: set[str] = set()
    priorities: dict[str, int] = defaultdict(int)
    for item in report.get("files", []):
        path = item.get("path", "?")
        for endpoint in item.get("endpoints", []):
            raw_endpoints[endpoint] += 1
            origin = normalize(endpoint)
            if origin:
                counts[origin] += 1
                sources[origin].add(f"file:{path}")
                priorities[origin] = max(priorities[origin], source_priority(f"file:{path}"))
                if api_like(endpoint):
                    api_like_origins.add(origin)
    for label, item in (report.get("clients") or {}).items():
        for endpoint in item.get("endpoints", []):
            raw_endpoints[endpoint] += 1
            origin = normalize(endpoint)
            if origin:
                counts[origin] += 1
                sources[origin].add(f"client:{label}")
                priorities[origin] = max(priorities[origin], source_priority(f"client:{label}"))
                if api_like(endpoint):
                    api_like_origins.add(origin)

    public = []
    local = []
    non_api = []
    for origin, count in counts.most_common():
        host = urlsplit(origin).hostname or ""
        record = {
            "origin": origin,
            "count": count,
            "sources": sorted(sources[origin])[:20],
            "tls_expected": origin.startswith("https://"),
            "verify_with": None,
            "api_like": origin in api_like_origins,
            "priority": priorities.get(origin, 0),
        }
        if origin.startswith("https://") and not local_host(host) and not placeholder_host(host):
            if record["api_like"] and record["priority"] >= 2:
                record["verify_with"] = f"python3 tools/tls_verify.py --host {host} --servername {host}"
                public.append(record)
            else:
                non_api.append(record)
        else:
            local.append(record)

    blockers = list(report.get("blockers", []))
    if not public:
        blockers.append("no public HTTPS API origin discovered; provide SERVER_NAME and a certificate")
    if len(public) > 1:
        blockers.append("multiple public HTTPS API origins discovered; choose one explicitly")

    return {
        "generated_at": now(),
        "source_report": str(report.get("_path", "")),
        "temperature_c": report.get("temperature_c", 100),
        "read_only": True,
        "public_candidates": public,
        "non_api_candidates": non_api,
        "local_candidates": local,
        "recommended": public[0]["origin"] if len(public) == 1 else None,
        "requires_choice": len(public) > 1,
        "tls_template": TEMPLATE,
        "render_variables": ["SERVER_NAME", "TLS_CERT", "TLS_KEY", "UPSTREAM"],
        "blockers": blockers,
        "evidence": {
            "status": "SOURCE_VERIFIED",
            "reason": "origins are normalized from endpoints read by hulia_100c.py; nothing is guessed",
            "raw_endpoint_count": sum(raw_endpoints.values()),
            "normalized_origin_count": len(counts),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Create an origin profile from a 100C scan")
    parser.add_argument("--report", default="/tmp/opencode/hulia-100c-report.json")
    parser.add_argument("--out", default="origin/origin-profile.json")
    args = parser.parse_args()

    path = Path(args.report).expanduser()
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(json.dumps({"status": "SKIP", "error": f"cannot read report: {exc}"}, indent=2))
        return 2
    report["_path"] = str(path)
    profile = build(report)
    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(profile, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({
        "recommended": profile["recommended"],
        "requires_choice": profile["requires_choice"],
        "public_candidates": len(profile["public_candidates"]),
        "local_candidates": len(profile["local_candidates"]),
        "blockers": profile["blockers"],
        "out": str(out),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
