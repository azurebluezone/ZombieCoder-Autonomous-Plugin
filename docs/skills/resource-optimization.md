---
id: resource-optimization
name: Resource Optimization
description: Reduce CPU, memory, tokens, network and human time with measurements instead of guesses. Use when something is slow, expensive, or near a limit.
---

# Resource Optimization

## Measure first

```bash
/usr/bin/time -v command          # wall time, RSS, page faults
time command                      # quick wall time
du -sh path                       # disk
wc -c file                        # bytes
jq '.usage' response.json         # token usage
```

Record the baseline before changing code. An optimization without a before/after number is a hobby.

## Order of attack

1. **Remove work** — cache, deduplicate, avoid the call, narrow the query.
2. **Reduce data** — select fewer columns/fields, stream, paginate, compress.
3. **Reduce round trips** — batch, pool, reuse connections.
4. **Reduce concurrency cost** — bound the pool, back off, queue.
5. **Optimize the hot loop** — only after 1–4.

## Token and context budget

- Send the smallest context that can answer the question.
- Prefer `grep`/section reads over whole-file reads.
- Summarize long tool output; keep the raw artifact on disk.
- Do not paste the same file twice.
- For small local models, keep prompts short and use skills/tools instead of giant system text.

## Server hygiene

- Set timeouts on every network call.
- Bound memory queues; reject instead of growing forever.
- Log latency, status and size, not secrets.
- Add a regression budget: max ms, max bytes, max tokens.

## Output

```text
Baseline:
Change:
After:
Bottleneck moved to:
Regression check:
```
