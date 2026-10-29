---
id: evidence-before-confidence
name: Evidence Before Confidence
description: Prove a claim with a path, command, exit code, HTTP status or test output before presenting it as fact. Use for every success report and every bug diagnosis.
---

# Evidence Before Confidence

## The rule

A claim is not true because it sounds right. It is true because you can point to an artifact that another person can re-run.

## Evidence ladder

| Label | Meaning | Minimum artifact |
| --- | --- | --- |
| `SOURCE_VERIFIED` | Code/config says it | `path:line` |
| `CONFIG_VALIDATED` | Runtime loaded it | config/setup report |
| `LIVE_PROBE_PASSED` | A live service answered | HTTP status + body excerpt |
| `END_TO_END_TESTED` | The user path worked | command + exit code + output |
| `NOT_TESTED` | Not exercised | say so, do not imply success |
| `UNVERIFIED` | No proof | stop, do not guess |
| `FIXTURE_ONLY` | Only a fixture/mock was exercised | name the fixture file |
| `SELF_AUTHORED_MOCK` | The proof is code you wrote for the check | name the file and say it is a mock |

One label is not another. A passing unit test does not prove a live gateway. A live gateway does not prove the UI path.

## Real input or no claim

A test proves what the test actually touched. Authentic test output is real evidence of a real run — a file under `test/` is not a mock, and `npm test → 113/113` is `real_run`. The question is never "was it a test?"; it is "did the check touch the real thing, or a stand-in?".

- Name the real input first: the user's file, the real endpoint, the installed binary, the actual repository.
- Every evidence item carries `origin`: `live`, `real_run`, `real_file`, or `simulated`.
- A `fixed` / `installed` / `works` / `done` claim needs at least one `live`, `real_run` or `real_file` item. `simulated` may support it, never carry it alone.
- A green run against a mock/fixture/demo is `simulated` no matter how real the test runner is. It never proves "done", and a label does not make it "done" either.
- No real input available? Write `NOT_TESTED` and say what the user must supply. Do not build a stand-in and call it success.
- Mocks stay legal as a boundary tool: name the file `*.mock.ts` / `fixture-*.json`, mark it `MOCK` in the header, and report it as `FIXTURE_ONLY` / `SELF_AUTHORED_MOCK`.

## Before saying PASS

1. Name the exact check.
2. Run it in this environment.
3. Copy the command, exit code and the one line that matters.
4. If it failed, show the failure and the next hypothesis.
5. If it was not run, write `NOT_TESTED`.
6. Never hide a non-zero exit code, a stack trace, a 4xx/5xx status, or a timeout.

## Diagnosis shape

```text
Symptom:
Reproduction:
Observed:
Expected:
Root cause:
Fix:
Regression check:
```

## Weak-model protocol

Small models guess more. Counter it with a smaller loop:

1. Read the specific file or run the specific probe.
2. Quote one line of evidence.
3. Make one change.
4. Re-run the check.
5. Stop when the evidence is green; do not add speculative changes.

If you cannot prove it, say "জানি না" or `UNVERIFIED`. That is a valid, professional answer.
