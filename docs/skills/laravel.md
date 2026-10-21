---
id: laravel
name: Laravel
description: Work on Laravel apps: routes, controllers, Eloquent, migrations, queues and Blade. Use for 500 errors, N+1 queries, auth and deployment.
---

# Laravel

## Baseline

```bash
php -v
composer install
php artisan about
php artisan route:list
php artisan migrate --pretend
php artisan test
```

## Request path

1. `routes/web.php` or `routes/api.php`
2. middleware
3. controller / form request
4. service or action
5. Eloquent model / query
6. resource or Blade view

Trace the exact route with `php artisan route:list --path=<segment>`.

## Eloquent

- Use `with()` to avoid N+1 queries; confirm with `DB::listen` or Laravel Debugbar.
- Prefer `cursor()`/`chunk()` for large exports.
- Use `updateOrCreate` only when the unique key is real.
- Wrap multi-table writes in `DB::transaction`.
- Never trust `$request->all()`; use validated data.

## Debug

```bash
tail -n 100 storage/logs/laravel.log
php artisan config:clear
php artisan cache:clear
php artisan queue:failed
```

- A `500` in production hides the message; read the log.
- A blank page may be a permissions issue on `storage/` or `bootstrap/cache/`.
- A queue job that repeats usually has a timeout or a non-idempotent side effect.

## Deployment

- `php artisan migrate --force`
- `php artisan config:cache`
- `php artisan route:cache`
- `php artisan view:cache`
- Set `APP_ENV=production`, `APP_DEBUG=false`.
- Ensure `storage/` and `bootstrap/cache/` are writable by the web user.

## Verification

- `php artisan test` exit 0.
- The changed route returns the expected status with `curl -i`.
- No new N+1 query in the log.
