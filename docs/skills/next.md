---
id: next
name: Next.js
description: Work on Next.js App Router or Pages Router: server/client boundaries, data fetching, caching and build errors. Use for hydration, 404/500 and deployment issues.
---

# Next.js

## Identify the router

- `app/` with `page.tsx`/`layout.tsx` → App Router.
- `pages/` with `pages/*.tsx` → Pages Router.
- Do not mix patterns blindly.

## App Router checklist

- Server Components are the default; add `"use client"` only where state, effects or browser APIs are needed.
- Fetch on the server when possible; never expose a secret to a client component.
- Use `loading.tsx`, `error.tsx` and `not-found.tsx` for states.
- Revalidate deliberately: `revalidatePath`, `revalidateTag`, or `cache: "no-store"`.
- Dynamic APIs (`cookies`, `headers`, `searchParams`) make a route dynamic; confirm the expected behavior.

## Build and diagnose

```bash
npm run build
npm run start
npm run lint
```

- Read the first build error; later errors are often noise.
- A hydration mismatch usually means server and client rendered different HTML.
- A 404 in production may be a missing route, a wrong `basePath`, or a static export limitation.
- A 500 in a Server Component often hides a thrown error in the server log; check the terminal, not only the browser.

## Performance

- Keep client bundles small; move heavy work to the server.
- Use `next/image` for responsive images.
- Measure with the browser performance panel and the build output.
- Do not add a dependency for a one-line utility.

## Verification

- `npm run build` exit 0.
- The changed route returns the expected status in `next start`.
- Loading, empty and error states exist.
