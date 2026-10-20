#!/usr/bin/env python3
"""Render the reusable Nginx TLS template without hardcoding a host.

Usage:
    python3 tools/render_nginx.py \
      --server-name api.example.com \
      --cert /etc/ssl/fullchain.pem \
      --key /etc/ssl/privkey.pem \
      --upstream http://127.0.0.1:8000 \
      --out /tmp/opencode/nginx.conf

Then:
    python3 tools/tls_verify.py --host api.example.com --nginx-conf /tmp/opencode/nginx.conf
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PLACEHOLDERS = ("SERVER_NAME", "TLS_CERT", "TLS_KEY", "UPSTREAM")


def main() -> int:
    parser = argparse.ArgumentParser(description="Render the generic Nginx TLS template")
    parser.add_argument("--template", default="tls/nginx.conf.template")
    parser.add_argument("--server-name", required=True)
    parser.add_argument("--cert", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--out", default="/tmp/opencode/nginx-rendered.conf")
    args = parser.parse_args()

    template_path = Path(args.template).expanduser()
    try:
        text = template_path.read_text(encoding="utf-8")
    except Exception as exc:
        print(json.dumps({"status": "SKIP", "error": f"cannot read template: {exc}"}, indent=2))
        return 2

    values = {
        "SERVER_NAME": args.server_name,
        "TLS_CERT": args.cert,
        "TLS_KEY": args.key,
        "UPSTREAM": args.upstream,
    }
    for key, value in values.items():
        if not value.strip():
            print(json.dumps({"status": "FAIL", "error": f"{key} is empty"}, indent=2))
            return 1
    rendered = text
    for key, value in values.items():
        rendered = rendered.replace("${" + key + "}", value)
    remaining = [key for key in PLACEHOLDERS if "${" + key + "}" in rendered]
    if remaining:
        print(json.dumps({"status": "FAIL", "error": "unresolved placeholders", "remaining": remaining}, indent=2))
        return 1

    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(rendered, encoding="utf-8")
    print(json.dumps({"status": "PASS", "out": str(out), "server_name": args.server_name, "upstream": args.upstream}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
