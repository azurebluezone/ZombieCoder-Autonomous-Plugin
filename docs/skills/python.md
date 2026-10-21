---
id: python
name: Python
description: Write and debug Python with virtual environments, type hints, small scripts and tests. Use for packaging, imports, data work and CLI tools.
---

# Python

## Environment

```bash
python3 --version
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -U pip
python -m pip install -r requirements.txt
```

- Never install project dependencies into the system interpreter.
- Pin versions for reproducibility.
- Use `python -m module` so the active interpreter is unambiguous.

## Code rules

- Prefer the standard library: `pathlib`, `json`, `argparse`, `subprocess`, `sqlite3`.
- Use type hints for public functions.
- Raise specific exceptions; do not swallow errors with `except Exception: pass`.
- Use `with` for files, locks and connections.
- Keep side effects out of import time.

## Debug

```bash
python -m compileall -q .
python -m pytest -q
python -X faulthandler script.py
python -m pdb script.py
```

- Read the last frame of the traceback that belongs to your code.
- Reproduce with the smallest input.
- Check `sys.path` and the working directory for import errors.

## Packaging

- `pyproject.toml` is the modern default.
- Keep runtime dependencies minimal.
- Add a console entry point instead of a shell wrapper when possible.

## Verification

- `python -m compileall` exit 0.
- `pytest` exit 0 (or the documented subset).
- One real invocation with a sample input.
