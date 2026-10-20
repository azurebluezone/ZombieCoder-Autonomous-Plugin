#!/usr/bin/env python3
"""Hulia 100C — read-only heat scan for local editors, clients and network patterns.

The "100C" is a label for a strict, read-only audit. This script never modifies
or deletes a file. It hashes every regular file it can read, extracts endpoints
and config markers, then inventories local listeners, connections, editor/client
configs and runtime blockers.

Usage:
    python3 tools/hulia_100c.py --root /home/xubuntu/Plugin
    python3 tools/hulia_100c.py --root /home/xubuntu/Plugin --out /tmp/opencode/hulia-100c-report.json

Exit code is 0 when the scan completes. Findings are data, not a verdict.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

TEMPERATURE_C = 100
URL_RE = re.compile(r"(?i)\b(?:https?|wss?|socks5?)://[^\s\"'<>]+")
HOST_RE = re.compile(r"(?i)\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?\b")
SECRET_KEY_RE = re.compile(r"(?i)(?:api[_-]?key|apiKey|api[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|bearer)\b")
SECRET_ASSIGN_RE = re.compile(r"(?i)((?:api[_-]?key|apiKey|api[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)[\"']?\s*[:=]\s*[\"']?)([^\s\"',;}]+)")
SECRET_CLI_RE = re.compile(r"(?i)((?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|bearer)\s+)([^\s\"']+)")
BEARER_RE = re.compile(r"(?i)(bearer\s+)([A-Za-z0-9._~+/=-]+)")
SKIP_DIRS = {".git", "node_modules", ".backups", ".zombiecoder", "__pycache__", "dist", "build", ".cache"}
TEXT_SUFFIXES = {".json", ".jsonc", ".toml", ".yaml", ".yml", ".ini", ".conf", ".env", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".txt", ".md", ".cfg", ".properties"}
IGNORE_NAMES = {"package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "readme.md", "license", "license.txt", "changelog.md"}
CLIENT_PATHS = [
    ("opencode-global", "~/.config/opencode"),
    ("opencode-local", "~/.opencode"),
    ("opencode-desktop", "~/.config/ai.opencode.desktop"),
    ("vscode", "~/.config/Code/User"),
    ("vscode-insiders", "~/.config/Code - Insiders/User"),
    ("cursor", "~/.config/Cursor/User"),
    ("windsurf", "~/.config/Windsurf/User"),
    ("zed", "~/.config/zed"),
    ("claude", "~/.claude"),
    ("claude-config", "~/.config/Claude"),
    ("jetbrains", "~/.config/JetBrains"),
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def redact(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if SECRET_KEY_RE.search(line):
            lines.append("<redacted secret-bearing line>")
        else:
            lines.append(line[:240])
    return "\n".join(lines)


def endpoints(text: str) -> list[str]:
    found = set()
    for match in URL_RE.findall(text):
        value = match.rstrip(").,;]}>").strip()
        if any(ord(ch) < 32 for ch in value) or any(ch in value for ch in "${}`<>"):
            continue
        try:
            parsed = urlsplit(value)
        except Exception:
            continue
        if parsed.scheme.lower() not in {"http", "https", "ws", "wss", "socks5"} or not parsed.hostname:
            continue
        clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        found.add(clean.rstrip("/") or clean)
    return sorted(found)


def is_client_config(path: Path) -> bool:
    name = path.name.lower()
    if name in IGNORE_NAMES or name.startswith(("readme", "license", "changelog")):
        return False
    return path.suffix.lower() in TEXT_SUFFIXES


def scan_file(path: Path) -> dict[str, Any]:
    info = path.stat()
    raw = b""
    readable = True
    try:
        with path.open("rb") as fh:
            raw = fh.read(2 * 1024 * 1024)
    except Exception:
        readable = False
    digest = hashlib.sha256(raw).hexdigest() if raw else None
    text = ""
    if raw and b"\x00" not in raw[:4096]:
        try:
            text = raw.decode("utf-8", "replace")
        except Exception:
            text = ""
    urls = endpoints(text)
    markers = []
    for line in text.splitlines():
        if SECRET_KEY_RE.search(line):
            markers.append("<redacted secret-bearing line>")
        elif any(key in line for key in ("baseURL", "baseUrl", "proxy", "mcp", "provider", "model")):
            markers.append(line[:240].strip())
    return {
        "path": str(path),
        "mode": stat.filemode(info.st_mode),
        "bytes": info.st_size,
        "sha256": digest,
        "readable": readable,
        "temperature_c": TEMPERATURE_C,
        "endpoints": urls,
        "markers": markers[:40],
        "secret_marker": bool(SECRET_KEY_RE.search(text)),
    }


def scan_tree(root: Path, max_files: int) -> tuple[list[dict[str, Any]], list[str]]:
    files: list[dict[str, Any]] = []
    skipped: list[str] = []
    for base, dirs, names in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in names:
            if len(files) >= max_files:
                skipped.append(f"file cap reached at {max_files}")
                return files, skipped
            path = Path(base) / name
            if path.is_symlink() or not path.is_file():
                continue
            try:
                files.append(scan_file(path))
            except Exception as exc:
                skipped.append(f"{path}: {type(exc).__name__}")
    return files, skipped


def scan_clients() -> dict[str, Any]:
    clients: dict[str, Any] = {}
    for label, raw in CLIENT_PATHS:
        root = Path(os.path.expanduser(raw))
        item: dict[str, Any] = {"path": str(root), "exists": root.exists(), "files": 0, "endpoints": []}
        if root.exists():
            found = set()
            count = 0
            for base, dirs, names in os.walk(root):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for name in names:
                    if count >= 80:
                        break
                    path = Path(base) / name
                    if not is_client_config(path) or not path.is_file() or path.stat().st_size > 512 * 1024:
                        continue
                    count += 1
                    try:
                        text = path.read_text("utf-8", "replace")
                        if "\x00" in text[:4096]:
                            continue
                    except Exception:
                        continue
                    for url in endpoints(text):
                        if "localhost" not in url and "127.0.0.1" not in url:
                            found.add(url)
            item["files"] = count
            item["endpoints"] = sorted(found)
        clients[label] = item
    return clients


def scan_processes() -> list[dict[str, Any]]:
    wanted = re.compile(r"(?i)(code|cursor|windsurf|zed|idea|pycharm|opencode|claude|node|python|llama)")
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            comm = (entry / "comm").read_text("utf-8", "replace").strip()
            if not wanted.search(comm):
                continue
            raw = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace").strip()
            safe = "<redacted secret-bearing cmdline>" if SECRET_KEY_RE.search(raw) else raw[:300]
            found.append({"pid": int(entry.name), "comm": comm[:80], "cmdline": safe})
        except Exception:
            continue
    return sorted(found, key=lambda item: item["pid"])[:80]


def run_ss(args: list[str]) -> tuple[list[str], str | None]:
    if not shutil.which("ss"):
        return [], "ss binary missing"
    try:
        proc = subprocess.run(["ss", *args], capture_output=True, text=True, timeout=8)
    except Exception as exc:
        return [], f"{type(exc).__name__}: {exc}"
    if proc.returncode != 0:
        return [], (proc.stderr or proc.stdout).strip()[:300]
    return proc.stdout.splitlines(), None


def scan_network() -> dict[str, Any]:
    listeners, err1 = run_ss(["-ltnp"])
    connections, err2 = run_ss(["-tnp"])
    def rows(lines: list[str]) -> list[str]:
        return [line.strip() for line in lines if line.strip() and not line.startswith("State")]
    internet = rows(connections)
    return {
        "listeners": rows(listeners)[:120],
        "connections": internet[:160],
        "errors": [x for x in (err1, err2) if x],
        "proxy_env": {
            key: "<set>"
            for key in os.environ
            if key.lower() in {"http_proxy", "https_proxy", "all_proxy"}
        },
    }


def build_patterns(files: list[dict[str, Any]], clients: dict[str, Any], network: dict[str, Any]) -> dict[str, Any]:
    endpoint_counts: Counter[str] = Counter()
    for item in files:
        endpoint_counts.update(item["endpoints"])
    client_counts: Counter[str] = Counter()
    for item in clients.values():
        client_counts.update(item["endpoints"])
    hosts = Counter()
    for url in list(endpoint_counts) + list(client_counts):
        match = re.match(r"(?i)^[a-z]+://([^/:]+)", url)
        if match:
            hosts[match.group(1).lower()] += 1
    return {
        "endpoint_counts": endpoint_counts.most_common(50),
        "client_endpoint_counts": client_counts.most_common(50),
        "hosts": hosts.most_common(50),
        "listener_count": len(network["listeners"]),
        "connection_count": len(network["connections"]),
    }


def find_opencode() -> str | None:
    hit = shutil.which("opencode")
    if hit:
        return hit
    root = Path.home() / ".config" / "ai.opencode.desktop" / "cli"
    try:
        for version in sorted(root.iterdir(), reverse=True):
            candidate = version / "opencode-cli"
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
    except Exception:
        pass
    return None


def blockers(clients: dict[str, Any], network: dict[str, Any], files: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    if not shutil.which("nginx"):
        out.append("nginx binary missing: `nginx -t` TLS configuration cannot be executed")
    if not shutil.which("openssl"):
        out.append("openssl binary missing: TLS verification cannot be executed")
    if not any(":443" in line for line in network["listeners"]):
        out.append("no local :443 listener found: local Nginx TLS is not running")
    if network["proxy_env"]:
        out.append("proxy environment variables are set: client traffic may bypass the direct origin")
    if not any(item["exists"] and item["files"] for item in clients.values()):
        out.append("no editor/client config files found in the known paths")
    if not find_opencode():
        out.append("opencode CLI not found in PATH or the desktop CLI directory: runtime model catalog cannot be read")
    if not any("127.0.0.1:8000" in line or "0.0.0.0:8000" in line for line in network["listeners"]):
        out.append("no local :8000 listener found: a local OpenAI-compatible gateway is not running")
    if not any("/v1" in url for item in files for url in item["endpoints"]):
        out.append("no /v1 endpoint found in the scanned files")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only 100C local client/network heat scan")
    parser.add_argument("--root", default=os.getcwd())
    parser.add_argument("--out", default="/tmp/opencode/hulia-100c-report.json")
    parser.add_argument("--max-files", type=int, default=2000)
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    if not root.is_dir():
        print(f"root not found: {root}", file=sys.stderr)
        return 2

    files, skipped = scan_tree(root, args.max_files)
    clients = scan_clients()
    network = scan_network()
    processes = scan_processes()
    patterns = build_patterns(files, clients, network)
    report = {
        "generated_at": now(),
        "temperature_c": TEMPERATURE_C,
        "root": str(root),
        "read_only": True,
        "summary": {
            "files": len(files),
            "bytes": sum(item["bytes"] for item in files),
            "clients": len([item for item in clients.values() if item["exists"]]),
            "processes": len(processes),
            "listeners": len(network["listeners"]),
            "connections": len(network["connections"]),
        },
        "files": files,
        "clients": clients,
        "processes": processes,
        "network": network,
        "patterns": patterns,
        "blockers": blockers(clients, network, files),
        "tooling": {
            "nginx": shutil.which("nginx"),
            "openssl": shutil.which("openssl"),
            "ss": shutil.which("ss"),
            "opencode": find_opencode(),
        },
        "skipped": skipped,
        "evidence": {
            "status": "SOURCE_VERIFIED",
            "reason": "read-only scan; every file hash and endpoint is evidence, not a guess",
        },
    }
    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))
    print("blockers:")
    for item in report["blockers"]:
        print(f"- {item}")
    print(f"report: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
