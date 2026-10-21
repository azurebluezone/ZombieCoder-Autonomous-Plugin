---
id: cpanel
name: cPanel
description: Deploy and debug PHP/Node/Python sites on cPanel: document root, .htaccess, SSL, cron, email DNS and file permissions. Use for 403/500 and subdomain issues.
---

# cPanel

## First checks

- Confirm the **document root** in cPanel → Domains. A file in the wrong folder is a 404.
- Check `public_html` vs the addon/subdomain root.
- Confirm the PHP version per domain (MultiPHP Manager).
- Check disk quota and inode usage.

## .htaccess

```apache
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.php [L]
```

- A `500` after editing `.htaccess` is usually a syntax error or a module that is not enabled.
- Keep a copy before editing; cPanel's file manager does not version it.
- Do not put secrets in a public document root.

## Permissions

```bash
find . -type d -exec chmod 755 {} \;
find . -type f -exec chmod 644 {} \;
```

- Writable directories: `storage/`, `bootstrap/cache/`, upload folders.
- Do not use `777` as a fix.
- The web user may differ from your SSH user.

## SSL and DNS

- Run AutoSSL; check the certificate covers the exact hostname.
- A subdomain needs its own DNS record and document root.
- After DNS changes, test with `dig +short <host>` and `curl -I https://<host>`.
- Cloudflare proxying can hide the origin; check the origin directly if possible.

## Cron and Node/Python

- Use the absolute interpreter path from cPanel ("Setup Node.js App" / "Setup Python App").
- Log cron output to a file; mail failures are easy to miss.
- Do not run a dev server in production; use the cPanel application manager or a passenger app.

## Verification

- `curl -I https://<domain>` returns the expected status.
- The error log in cPanel → Metrics → Errors is empty of new entries.
- The changed page works with a cache-busting query string.
