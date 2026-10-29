---
id: first-principles
name: First-Principles Thinking
description: Break a problem into primitives before choosing a framework, dependency or fix. Use when the cause is unclear or the obvious answer feels borrowed.
---

# First-Principles Thinking

## When to use

- The task is new, ambiguous, or the current design is failing for an unknown reason.
- Someone says "this is how it is always done" but cannot show the constraint.
- A small model is about to copy a large pattern without understanding it.

## Method

1. **State the outcome** in one sentence. Not the tool, the outcome.
2. **List the primitives**: input, state, transformation, output, constraints, failure modes.
3. **Mark evidence**: which primitive is measured, which is assumed. Assumptions are not facts.
4. **Remove borrowed steps**: for each step ask "what breaks if this step disappears?" Keep only what has a reason.
5. **Choose the smallest mechanism** that satisfies the primitives. Standard library first; dependency must earn its place.
6. **Design the check** before writing the implementation: one real input, one command, one exit code. A fixture can test the logic, never the outcome.
7. **Record the trade-off**: what was gained, what was given up, and why.

## Guardrails

- Do not invent a new abstraction for a one-off task.
- Do not call a guess a root cause. A root cause is reproducible.
- Do not optimize before measuring. `time`, `wc -c`, `du`, and a profiler beat intuition.
- If two designs satisfy the constraints, pick the one with fewer moving parts and a smaller blast radius.

## Output shape

```text
Outcome:
Primitives:
Assumptions:
Smallest mechanism:
Verification:
Trade-off:
```

Report in Bengali; keep code, paths and identifiers in English.
