---
id: fastapi
name: FastAPI
description: Build and debug FastAPI services: request models, dependency injection, async I/O, validation errors and OpenAPI. Use for 422/500 and deployment issues.
---

# FastAPI

## Skeleton

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()

class Item(BaseModel):
    name: str
    qty: int = 1

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

## Rules

- Use Pydantic models for input and output; do not accept raw `dict` for public APIs.
- Use `async def` only for non-blocking work. CPU-bound or blocking SDK calls belong in `def` or a thread pool.
- Put shared clients in a dependency with a `yield` cleanup.
- Return the right status code: `201` for create, `404` for missing, `409` for conflict.
- A `422` is a validation error; read the `detail` array, it names the field.

## Debug

```bash
uvicorn app.main:app --reload --port 8000
curl -sS -i http://127.0.0.1:8000/health
curl -sS -i -X POST http://127.0.0.1:8000/items -H 'content-type: application/json' -d '{"name":"x"}'
```

- A `500` usually means an unhandled exception; check the server traceback.
- A hanging request often means a blocking call inside `async def`.
- Check `/docs` and `/openapi.json` to confirm the schema.

## Production

- Run behind a process manager or container; do not use `--reload` in production.
- Set timeouts on outbound calls.
- Add health and readiness endpoints.
- Log request IDs, not secrets.

## Verification

- `/health` returns 200.
- One valid request and one invalid request return the expected codes.
- OpenAPI schema loads.
