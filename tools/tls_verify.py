#!/usr/bin/env python3
"""Verify TLS with OpenSSL and optionally validate an Nginx config.

No host is hardcoded. The Nginx template is reusable through placeholders:
SERVER_NAME, TLS_CERT, TLS_KEY and UPSTREAM.

Usage:
    python3 tools/tls_verify.py --host gpu.zombiecoder.my.id --servername gpu.zombiecoder.my.id
    python3 tools/tls_verify.py --host localhost --port 8443 --nginx-conf /tmp/nginx.conf

Exit codes: 0 = PASS, 1 = FAIL, 2 = SKIP (missing binary/config, not a TLS failure).
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(cmd: list[str], timeout: int) -> tuple[int, str, str, str | None]:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input="")
    except Exception as exc:
        return 127, "", "", f"{type(exc).__name__}: {exc}"
    return proc.returncode, proc.stdout or "", proc.stderr or "", None


def main() -> int:
    parser = argparse.ArgumentParser(description="TLS evidence verifier")
    parser.add_argument("--host", default=os.environ.get("ZC_TLS_HOST", ""))
    parser.add_argument("--port", type=int, default=443)
    parser.add_argument("--servername", default="")
    parser.add_argument("--ca-file", default="")
    parser.add_argument("--nginx-conf", default="")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--json-out", default="/tmp/opencode/tls-evidence.json")
    args = parser.parse_args()

    host = args.host.strip()
    if not host:
        print("--host is required (or set ZC_TLS_HOST)", file=sys.stderr)
        return 2
    servername = args.servername.strip() or host
    ca_file = args.ca_file.strip()
    if not ca_file:
        for candidate in ("/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/cert.pem"):
            if Path(candidate).is_file():
                ca_file = candidate
                break

    evidence: dict[str, Any] = {
        "generated_at": now(),
        "host": host,
        "port": args.port,
        "servername": servername,
        "ca_file": ca_file or None,
        "status": "FAIL",
        "checks": [],
        "reasons": [],
    }

    if not shutil.which("openssl"):
        evidence["status"] = "SKIP"
        evidence["reasons"].append("openssl binary missing")
    else:
        cmd = [
            "openssl",
            "s_client",
            "-connect",
            f"{host}:{args.port}",
            "-servername",
            servername,
            "-brief",
            "-verify_return_error",
        ]
        if ca_file:
            cmd.extend(["-CAfile", ca_file])
        code, stdout, stderr, error = run(cmd, args.timeout)
        text = f"{stdout}\n{stderr}"
        evidence["openssl_exit"] = code
        evidence["protocol"] = next(
            (line.split(":", 1)[1].strip() for line in text.splitlines() if line.startswith("Protocol version:")),
            None,
        )
        evidence["cipher"] = next(
            (line.split(":", 1)[1].strip() for line in text.splitlines() if line.startswith("Ciphersuite:")),
            None,
        )
        evidence["peer_certificate"] = next(
            (line.split(":", 1)[1].strip() for line in text.splitlines() if line.startswith("Peer certificate:")),
            None,
        )
        verification = next(
            (line.split(":", 1)[1].strip() for line in text.splitlines() if line.startswith("Verification:")),
            None,
        )
        evidence["verification"] = verification
        evidence["checks"].append({"name": "openssl_exit", "ok": code == 0, "detail": code})
        evidence["checks"].append({"name": "verification_ok", "ok": verification == "OK", "detail": verification})
        evidence["checks"].append(
            {
                "name": "tls_version",
                "ok": evidence["protocol"] in {"TLSv1.2", "TLSv1.3"},
                "detail": evidence["protocol"],
            }
        )
        if error:
            evidence["reasons"].append(error)
        if code != 0:
            evidence["reasons"].append(f"openssl exit {code}")
        if verification != "OK":
            evidence["reasons"].append(f"certificate verification: {verification or 'missing'}")
        if evidence["protocol"] not in {"TLSv1.2", "TLSv1.3"}:
            evidence["reasons"].append(f"TLS version not accepted: {evidence['protocol']}")
        if all(check["ok"] for check in evidence["checks"]):
            evidence["status"] = "PASS"

    if args.nginx_conf:
        nginx = shutil.which("nginx")
        if not nginx:
            evidence["nginx"] = {"status": "SKIP", "reason": "nginx binary missing"}
        else:
            code, stdout, stderr, error = run([nginx, "-t", "-c", args.nginx_conf], args.timeout)
            evidence["nginx"] = {
                "status": "PASS" if code == 0 else "FAIL",
                "exit": code,
                "stdout": stdout.strip()[:2000],
                "stderr": stderr.strip()[:2000],
                "error": error,
            }
            if code != 0:
                evidence["status"] = "FAIL"
                evidence["reasons"].append("nginx -t failed")

    out = Path(args.json_out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(evidence, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(evidence, indent=2, ensure_ascii=False))
    print(f"evidence: {out}")
    return 0 if evidence["status"] == "PASS" else (2 if evidence["status"] == "SKIP" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
