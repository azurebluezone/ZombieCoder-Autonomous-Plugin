---
id: server
name: Server Operations
description: Run and debug a Linux server safely: process, port, logs, permissions, systemd, Nginx and TLS. Use for deployment, 502/504 and boot failures.
---

# Server Operations

## First five checks

```bash
systemctl status <service> --no-pager
journalctl -u <service> -n 80 --no-pager
ss -ltnp | grep ':PORT'
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:PORT/health
df -h; free -h; uptime
```

## Process and port

- `ss -ltnp` shows who owns the port.
- `ps -fp <pid>` shows the command line.
- A `502` means Nginx reached the proxy block but the upstream failed. Check the upstream port and logs.
- A `504` means the upstream did not answer in time. Check the upstream timeout and workload.

## systemd unit checklist

```ini
[Service]
ExecStart=/absolute/path/to/binary
WorkingDirectory=/absolute/path
Restart=on-failure
EnvironmentFile=/etc/<service>/env
User=<service-user>
```

```bash
systemctl daemon-reload
systemctl enable --now <service>
systemctl status <service> --no-pager
```

## Nginx

```bash
nginx -t
nginx -T | grep -n 'server_name\|proxy_pass\|listen'
tail -n 80 /var/log/nginx/error.log
```

- `proxy_pass http://127.0.0.1:8000;` must point at a live listener.
- Keep `client_max_body_size`, timeouts and buffer sizes explicit.
- Test with `curl -v` against `127.0.0.1` first, then through the proxy.

## Security

- Never print secrets or tokens in logs.
- Use `chmod 600` for secret files.
- Prefer a non-root service user.
- Open only the ports you need.

## Evidence

Report the exact command, exit code and the one log line that proves the state. If you did not restart the service, say `NOT_TESTED`.
