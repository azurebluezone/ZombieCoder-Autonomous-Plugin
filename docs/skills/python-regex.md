---
id: python-regex
name: Python Regex
description: Build, test and performance-check Python regular expressions with fixtures first, named groups, ReDoS limits and linear-time fallbacks. Use for parsing, validation, log extraction and bulk renames.
---

# Python Regex

A regex is a specification with a test suite. Write the examples first, the
pattern second, and prove the failure path before shipping.

## 1. Fixtures before the pattern

Write ten strings that must match and ten that must not — including the ugly
ones (empty string, trailing newline, Unicode, very long line). Only then write
the pattern. If the fixtures do not exist, the pattern is a guess.

```python
ACCEPT = ["2026-10-23", "1999-01-01"]
REJECT = ["2026-13-01", "23/10/2026", "", "2026-1-1"]
```

## 2. Python-specific rules

- Raw strings always: `re.compile(r"\d{4}-\d{2}-\d{2}")`. A single backslash in a
  normal string is a silent bug.
- `fullmatch` for validation, `search` for extraction, `match` only when the
  anchor is genuinely at the start. `$` matches before a trailing newline; use
  `\Z` when you mean the absolute end.
- Named groups beat positional groups: `(?P<year>\d{4})` and `m.group("year")`.
- `re.VERBOSE` for anything longer than one line, with a comment per group.
- Compile once at module level; `re` caches 512 patterns but the cache is a
  global mutable — do not rely on it in hot loops.
- Unicode: `\w` and `\d` are Unicode-aware in `str` patterns, ASCII-only in
  `bytes` patterns. Say which one you mean (`re.ASCII`) when it matters.
- Never build a pattern from unescaped user input — use `re.escape`.

## 3. ReDoS: the failure path that kills production

Catastrophic backtracking comes from a repetition nested in a repetition:

```python
BAD  = re.compile(r"(a+)+$")      # (a+)+  -> exponential on "aaaaX"
BAD  = re.compile(r"(.*)*")       # same shape
GOOD = re.compile(r"a+$")         # one quantifier
GOOD = re.compile(r"(?>a+)+$")    # atomic group, Python 3.11+
```

Rules:

1. No nested quantifiers over overlapping character classes.
2. Bound unbounded repetition on untrusted input: `{0,200}` instead of `*`.
3. Prefer a character class with a negation: `[^"]*` over `.*?`.
4. Add a timeout on any pattern that runs against external text:

```python
import regex  # pip install regex
regex.match(r"\d+", text, timeout=0.05)
```

5. Linear-time alternatives: `re2` / `google-re2` for untrusted patterns, or a
   hand-written parser when the language is not regular (nested braces, HTML,
   quoted strings with escapes). Regex cannot count nesting.

## 4. Verify with a benchmark, not a feeling

```python
import re, time
p = re.compile(r"[^@\s]+@[^@\s]+\.[a-z]{2,}")
t0 = time.perf_counter()
for s in samples:
    p.search(s)
print(f"{(time.perf_counter()-t0)*1000/len(samples):.3f} ms/string")
```

Measure the worst input, not the average. A pattern that takes 2 ms on valid
data and 40 s on a hostile line is a denial-of-service bug.

## 5. Code generation instead of hand-written repetition

When the same transformation repeats (rename 200 keys, extract 30 fields), write
one declarative table and generate the code:

```python
FIELDS = {"order_id": r"\d{6}", "email": r"[^@\s]+@[^@\s]+", "total": r"\d+\.\d{2}"}
pattern = re.compile("|".join(f"(?P<{k}>{v})" for k, v in FIELDS.items()))
```

The table is reviewable, the pattern is derived, and a new field is one line.

## 6. Delivery checklist

- [ ] 10 accept + 10 reject fixtures, all passing
- [ ] No nested quantifier; timeout or bounded repetition on external input
- [ ] `re.escape` on any interpolated input
- [ ] Named groups and a compiled module-level pattern
- [ ] Worst-case timing measured and recorded
- [ ] Fallback chosen when the grammar is not regular
