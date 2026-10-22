# Regex and Performance Skills for ZombieCoder

Research notes for two practice tracks:

- **Nila ("The Regex Paga")** — pattern correctness, ReDoS resistance, regex-vs-parser decisions.
- **Rashed (performance engineer)** — code generation, batching, caching, measurement, profiling.

Each skill follows the same shape: **what it is → why it matters → how to apply it**, with one authoritative source that was actually fetched during this research. All URLs are listed again at the end.

| # | Skill | Track |
|---|-------|-------|
| 1 | Examples-first regex contract | Nila |
| 2 | Free-spacing and commented regex | Nila |
| 3 | Choose a linear-time engine | Nila |
| 4 | Backtracking cost model | Nila |
| 5 | Evil-regex audit and containment | Nila |
| 6 | Eliminate ambiguous repetition | Nila |
| 7 | Mutually exclusive alternation and strict classes | Nila |
| 8 | Atomic groups and possessive quantifiers | Nila |
| 9 | Regex vs parser decision | Nila |
| 10 | Precompile and scope the match | Nila |
| 11 | Template → code generation at scale | Rashed |
| 12 | Generated-code provenance | Rashed |
| 13 | Deterministic, idempotent generation | Rashed |
| 14 | Test-driven generation | Rashed |
| 15 | Property-based equivalence | Rashed |
| 16 | Batching to amortize fixed cost | Rashed |
| 17 | Caching and invalidation | Rashed |
| 18 | Measure before and after | Rashed |
| 19 | Profile to find the hotspot | Rashed |
| 20 | Avoid premature optimization | Rashed |

---

## 1. Examples-first regex contract

**What it is.** Before writing a pattern, write an explicit table of inputs that must be accepted and inputs that must be rejected. The table is the specification; the regex is one implementation of it.

**Why it matters.** A regex that "looks right" hides decisions about anchoring, empty strings, Unicode, and near-misses. Accept/reject examples force those decisions into the open and become executable tests. Given-When-Then is a compact way to express each row: given an input, when it is validated, then the result is accept or reject.

**How to apply.**

1. Create a table with columns `input`, `expected`, `why this case exists`.
2. Cover at least: one valid, one invalid, empty string, boundary length, leading/trailing whitespace, Unicode, a near-miss, and a hostile long input.
3. Turn every row into a test before touching the pattern.
4. Keep the table next to the pattern; when the pattern changes, the table is the review artifact.

```text
| input            | expected | why                          |
|------------------|----------|------------------------------|
| user@example.com | accept   | ordinary valid address       |
| user@example     | reject   | missing TLD                  |
| ""               | reject   | empty input                  |
| " user@x.io "    | reject   | no implicit trimming         |
| "a@b.c" + "\n"   | reject   | full-match, not prefix-match |
| "a" * 100000     | reject   | bounded time, no hang        |
```

```python
CASES = [
    ("user@example.com", True),
    ("user@example", False),
    ("", False),
    (" user@x.io ", False),
]

def test_contract():
    for text, expected in CASES:
        assert bool(EMAIL_RE.fullmatch(text)) is expected
```

**Source:** https://martinfowler.com/bliki/GivenWhenThen.html

---

## 2. Free-spacing and commented regex

**What it is.** Free-spacing mode (`(?x)` or the `x` flag) ignores whitespace between tokens and treats `#` as a line comment, so a pattern can be laid out like code. Named groups and `(?#comment)` add local documentation.

**Why it matters.** A dense one-line regex is unreviewable, and unreviewable regex is where ReDoS and silent semantic bugs survive. Layout and comments make the ambiguity visible: repeated groups, overlapping alternatives, and "match anything" dots stand out.

**How to apply.**

1. Enable `(?x)` at the start, or pass the verbose flag supported by the engine.
2. Put one logical clause per line and comment each clause.
3. Never insert spaces inside a token such as `\d`, `(?:`, or a character class; a space inside `[...]` is a literal member.
4. Escape a literal space (`\ ` or `\x20`) when free-spacing is on.
5. Prefer named groups over numeric backreferences in readable patterns.

```python
import re

DATE = re.compile(r"""
    (?P<year>  (?:19|20)\d\d )   # 20th or 21st century
    [-/.]
    (?P<month> 0[1-9] | 1[012] )
    [-/.]
    (?P<day>   0[1-9] | [12][0-9] | 3[01] )
""", re.VERBOSE)
```

Free-spacing is a readability tool, not a performance tool. Measure separately; whitespace is stripped at compile time, but comments and layout do not remove backtracking ambiguity.

**Source:** https://www.regular-expressions.info/freespacing.html

---

## 3. Choose a linear-time engine

**What it is.** Regex engines split into backtracking engines (Perl, PCRE, Python `re`, Java, JavaScript, .NET, Ruby) and text-directed/automata engines (RE2, Go `regexp`, Rust `regex`). RE2's stated primary guarantee is that match time is linear in the length of the input.

**Why it matters.** With a backtracking engine, a short crafted input can consume unbounded CPU; with an automata engine there are no pathological patterns. Engine choice is therefore a security and latency decision, not a micro-optimization. The cost is feature loss: RE2 deliberately does not support backreferences or look-around because only backtracking solutions are known for them.

**How to apply.**

1. Classify the pattern source: trusted static code, or user-supplied/config-supplied data.
2. Use a text-directed engine (RE2, Go `regexp`, Rust `regex`) for anything reachable from untrusted input.
3. Accept the feature trade-off; rewrite look-around as explicit surrounding logic, and replace backreferences with a parser or a second pass.
4. If a backtracking engine is unavoidable, contain it with timeouts and input caps (skill 5).
5. Benchmark constant factors too: RE2 is pessimistic and may be slower on easy inputs, but its worst case is bounded.

```go
// Go's regexp follows RE2's guarantees: linear time, no backreferences.
var emailRE = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
```

**Source:** https://raw.githubusercontent.com/google/re2/main/README.md

---

## 4. Backtracking cost model

**What it is.** A backtracking engine tries one alternative, and on failure returns to the last choice point and tries the next. For a pattern with `n` independent binary choices, the worst case is `2^n` paths. A Thompson NFA simulation instead tracks the set of reachable states, so an `m`-character pattern over an `n`-character input costs `O(mn)`.

**Why it matters.** This explains the production surprise: a pattern that is instant on a valid 10-character string can take seconds or years on a 29-character non-match. Russ Cox's benchmark matches `a?^n a^n` against `a^n`; Perl needs over 60 seconds at `n = 29`, while the NFA implementation needs about 20 microseconds.

**How to apply.**

1. Count the choice points: every `?`, `*`, `+`, `{n,m}`, and `|` can multiply paths.
2. Ask whether two different paths can consume the same text. If yes, the engine may try all combinations on failure.
3. Test the **failing** input, not only the matching input; catastrophic behavior appears when the overall match fails.
4. Scale the input (`n = 10, 15, 20, 25`) and plot time. Exponential growth is a red flag; linear with a large constant is a different problem.
5. Remove ambiguity (skills 6–8) or move to an automata engine (skill 3).

```text
Pattern: a? a? a? a? ... a? aaaa        Input: aaaa
Choices: 2^n ways to assign the a's; only one assignment matches.
Cost:    exponential in the number of optional tokens.
```

**Source:** https://swtch.com/~rsc/regexp/regexp1.html

---

## 5. Evil-regex audit and containment

**What it is.** An "evil regex" is a pattern that can be driven into extreme backtracking by crafted input. The canonical shape is a repeated group containing a repetition or an overlapping alternation: `(a+)+$`, `([a-zA-Z]+)*$`, `(a|aa)+$`, `(a|a?)+$`. OWASP documents this as ReDoS: the attacker supplies a subject (or a pattern) that forces the engine to explore exponentially many paths.

**Why it matters.** One request can pin a CPU core, and a handful of requests can take down a service. ReDoS is cheap for the attacker and often invisible in normal tests because valid inputs match quickly.

**How to apply.**

1. Inventory every pattern that sees untrusted input, including validation, routing, log parsing, WAF rules, and user-configurable patterns.
2. Flag repeated groups with inner repetition or overlapping alternatives.
3. Test each candidate with a long non-matching string: `"a" * 30 + "!"`, then double the length and compare time.
4. Prefer a text-directed engine for untrusted patterns; RE2-style engines do not backtrack.
5. If backtracking is required, set a match timeout or recursion limit, cap input length before matching, and abort rather than queue more work.
6. Treat user-supplied regex as code execution for CPU: do not accept it unless the engine is safe by construction.

```python
# Audit probe: time must grow roughly linearly, not double per added character.
for n in (10, 15, 20, 25, 30):
    subject = "a" * n + "!"
    t0 = time.perf_counter()
    try:
        EVIL.fullmatch(subject)
    except TimeoutError:
        print("timeout", n)
    print(n, time.perf_counter() - t0)
```

**Source:** https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS

---

## 6. Eliminate ambiguous repetition

**What it is.** Nested quantifiers are repeated or alternated tokens inside a group that is itself repeated. If the inner and outer repetition can split the same text in more than one way, the engine tries every split. Rewriting the pattern so each character has exactly one possible owner removes the explosion.

**Why it matters.** The classic CSV pattern `^(.*?,){11}P` takes 27,638 steps to fail on 12 fields, and 56,230 on 13 fields; each added field roughly doubles the work. The rewrite `^([^,\r\n]*,){11}P` needs 61 steps and stays constant as the rest of the line grows, because a field can no longer contain the delimiter.

**How to apply.**

1. Find the repeated group and list what the inner token can match.
2. Identify the delimiter or following token that the inner token can also match.
3. Exclude the delimiter from the inner token with a negated character class, or make the alternatives mutually exclusive.
4. If exclusion is impossible, use an atomic group or possessive quantifier (skill 8).
5. Re-run the failing-input benchmark and compare step counts or wall time.

```text
Ambiguous:  ^(.*?,){11}P
             .*? can match commas, so fields can be split many ways.

Strict:     ^([^,\r\n]*,){11}P
             a field cannot contain a comma; exactly one split per field.
```

**Source:** https://www.regular-expressions.info/catastrophic.html

---

## 7. Mutually exclusive alternation and strict classes

**What it is.** Alternatives and sequential quantifiers must not be able to match the same text. `(.|\s)*` is a canonical violation: a space can be consumed by `.` or by `\s`, producing `2^n` permutations. A strict negated class such as `[^"\n]*` gives each character one owner and cannot backtrack into a delimiter.

**Why it matters.** Ambiguity is the fuel for catastrophic backtracking. Making the pattern stricter reduces both the number of paths and the chance that a future edit turns a working pattern into a vulnerable one. The same page notes that a stricter regex is also a faster regex in normal operation.

**How to apply.**

1. For every alternation, ask: can two branches match the same string? If yes, make them disjoint or order them with a proven prefix rule.
2. Replace `.` with an explicit class whenever "anything" is not literally required. For a quoted string, use `"[^"\n]*"` rather than `".*?"`.
3. For sequential quantified tokens, ensure the first stops at a delimiter the second cannot consume: `a[^b]*b[^c]*c`.
4. Use possessive quantifiers where the token is provably disjoint from what follows.
5. Review the pattern independently of any test subject: the audit is structural, not example-based.

```text
Weak:    (.|\s)*                 # each space has two possible owners
Better:  (?:.|\n)*               # disjoint alternatives (if dot excludes \n)
Best:    [\r\n\t\x20-\x7E]*      # explicit allow-list, single owner
```

**Source:** https://www.regular-expressions.info/redos.html

---

## 8. Atomic groups and possessive quantifiers

**What it is.** An atomic group `(?>...)` discards all backtracking positions created inside it once the group exits. A possessive quantifier (`*+`, `++`, `?+`, `{n,m}+`) is the same idea applied to a repetition. Both tell the engine: once this part matched, never reconsider it.

**Why it matters.** When the matched text is provably disjoint from what follows, backtracking into it is pure waste. In the CSV example, `^(?>(.*?,){11})P` reduces failure from tens of thousands of steps to 36; in the `(x+x+)+y` example, possessive/atomic form fails a 21-character string in 7 steps instead of exploring millions.

**How to apply.**

1. Prove the inner token cannot match the delimiter or the token after the group.
2. Wrap the group in `(?>...)`, or make the quantifier possessive.
3. Re-run both accept and reject tests: atomicity can remove valid matches, especially with ordered alternation.
4. Prefer the narrower fix (exclude the delimiter) when possible; atomic groups are a control mechanism, not a substitute for a correct pattern.
5. Check engine support: Python supports atomic groups and possessive quantifiers from 3.11; RE2-style engines do not need them because they do not backtrack.

```text
Explosive:  (x+x+)+y
Atomic:     (?>(x+x+)+)y
Possessive: (x+x+)++y

Both fail the 21-x string in 7 steps instead of exploring an exponential tree.
```

**Source:** https://www.regular-expressions.info/atomic.html

---

## 9. Regex vs parser decision

**What it is.** A regular expression denotes a regular language: a set of strings recognizable by a finite automaton with constant memory. Nested or counted structure — balanced parentheses, `a^n b^n`, nested JSON/HTML — is context-free or beyond, and cannot be decided by a finite automaton. Backreferences push the problem further, into NP-complete territory.

**Why it matters.** Using regex for nested structure produces either a wrong pattern or runaway backtracking. The regex may "work" on the happy path and fail on malformed input, which is exactly when a parser is needed. The decision is a language-class question, not a matter of pattern cleverness.

**How to apply.**

1. Ask whether correctness requires unbounded nesting, matching counts, or matching a previously captured string.
2. If no: regex (or a small state machine) is appropriate.
3. If yes: use a parser (recursive descent, parser combinator, or a generated parser) and keep regex for lexing tokens.
4. Treat HTML, JSON, XML, SQL, and source code as parser problems; regex can find tokens but not validate structure.
5. If someone proposes backreferences to solve nesting, that is the signal to switch tools.

```text
Regular (regex is fine):   identifiers, dates, IP literals, log fields
Context-free (parser):     JSON objects, HTML trees, balanced parentheses
Harder (parser/engine):    a^n b^n, backreferences, arbitrary nesting depth
```

**Source:** https://en.wikipedia.org/wiki/Regular_language

---

## 10. Precompile and scope the match

**What it is.** Two separate decisions: compile the pattern once and reuse the compiled object, and choose the correct match scope — full match (entire input) versus partial/search (leftmost match anywhere). RE2 exposes this directly as `FullMatch` and `PartialMatch`; its README warns that the simple examples recompile the pattern on every call and shows the precompiled form as the production pattern.

**Why it matters.** Recompiling per call repeats parsing and automaton construction for every input. An unanchored search can attempt a match at every start position, turning an `O(n)` check into `O(n^2)` work on long text. Choosing `fullmatch` for validation also prevents a valid prefix from being accepted as a valid whole.

**How to apply.**

1. Compile at module load, service start, or in a cached field; never inside the hot loop.
2. For validation, use full-match semantics (`fullmatch`, `FullMatch`, or explicit `^...$` with an end-of-input anchor).
3. For extraction, use search/partial match deliberately, and anchor to a known prefix when possible.
4. Escape dynamic literals before interpolation; do not build patterns by string concatenation from untrusted text.
5. Measure compile time separately from match time; a slow startup is a different fix from a slow request.

```go
// Compile once, reuse for every call.
var re = regexp.MustCompile(`^(\w+):(\d+)$`)

func parse(s string) (string, string, bool) {
    m := re.FindStringSubmatch(s) // full-match pattern is anchored
    if m == nil {
        return "", "", false
    }
    return m[1], m[2], true
}
```

**Source:** https://raw.githubusercontent.com/google/re2/main/README.md

---

## 11. Template → code generation at scale

**What it is.** Instead of hand-writing repetitive code, define an input model (constants, schema, grammar, table) and a generator that emits the code. Rob Pike's `stringer` example is the canonical small case: one `//go:generate stringer -type=Pill` line produces a `String()` method whose representation is chosen for the data — names packed into one string, an index array, and the smallest integer type that fits.

**Why it matters.** Hand-written repetitive code drifts: one case is added, one switch arm is forgotten. A generator makes the repetition mechanical and lets the output use a better representation than a human would bother to write. The "write 100 lines, generate 400" trade is worthwhile when the 400 lines are predictable and the 100-line source of truth is reviewable.

**How to apply.**

1. Identify repetition with a stable shape: enum stringers, serializers, dispatch tables, parser tables, schema stubs.
2. Write the smallest input model that captures every case, including aliases and sparse values.
3. Write the generator as a normal program with tests; keep it in the repo.
4. Add a `//go:generate` directive (or Make/Bazel target) next to the source of truth.
5. Generate, compile, and test the output; commit the generated file if consumers need it without running the tool.
6. Do not generate what a library or generic already solves; codegen is for shape repetition, not for avoiding design.

```go
//go:generate stringer -type=Pill
type Pill int

const (
    Placebo Pill = iota
    Aspirin
    Ibuprofen
    Paracetamol
    Acetaminophen = Paracetamol
)
```

**Source:** https://go.dev/blog/generate

---

## 12. Generated-code provenance

**What it is.** Generated files carry a machine-readable header (`// Code generated by stringer -type Pill pill.go; DO NOT EDIT.`), live in predictable filenames, and are produced by an explicit command that is not part of the normal compiler invocation. When the package is consumed without the generator installed, the generated file must already be checked in.

**Why it matters.** Without provenance, a reviewer cannot tell generated code from hand-written code, and a well-meaning edit is silently overwritten on the next generation. Without an explicit generation step, builds depend on a tool that may not exist on the consumer's machine. Clear provenance makes ownership and review scope obvious.

**How to apply.**

1. Emit the standard header on the first line, before the package clause.
2. Use a dedicated filename (`*_string.go`, `*_gen.go`) and never hand-edit it.
3. Keep the generator command next to the input (`//go:generate ...`), and document the regeneration step.
4. In CI, run the generator and fail if `git diff` is non-empty; this proves the checked-in output matches the input.
5. Run tests after generation, not before; the generated file is part of the build.
6. Exclude generated files from lint/coverage rules where appropriate, but not from compilation.

```go
// Code generated by stringer -type Pill pill.go; DO NOT EDIT.

package painkiller
```

**Source:** https://go.dev/blog/generate

---

## 13. Deterministic, idempotent generation

**What it is.** A generator is deterministic when the same input and environment produce byte-identical output, and idempotent when running it again changes nothing (`f(f(x)) = f(x)`). Determinism requires stable input order, stable output order, fixed timestamps, normalized paths, and no randomness or locale dependence.

**Why it matters.** Non-deterministic output creates diff noise, defeats "regenerate and check diff" CI, breaks reproducible builds, and makes cache keys unstable. Idempotence is what lets a pipeline retry generation safely instead of layering changes on top of previous output.

**How to apply.**

1. Sort every collection before emitting: map keys, directory entries, imports, fields.
2. Remove timestamps, hostnames, absolute build paths, random IDs, and locale-dependent formatting; if a timestamp is required, use a fixed epoch (for example `SOURCE_DATE_EPOCH`).
3. Normalize line endings, trailing whitespace, and final newline.
4. Make output a pure function of the declared input; do not read the previous output as input.
5. Test it: run the generator twice in a clean tree and compare hashes; run it from two different directories and compare.
6. Wire the check into CI so a non-deterministic generator fails before merge.

```bash
# Determinism smoke test
./gen > /tmp/a.out
./gen > /tmp/b.out
cmp /tmp/a.out /tmp/b.out

# Idempotence: regenerate over the existing output
./gen > /tmp/before.out
./gen > /tmp/after.out
cmp /tmp/before.out /tmp/after.out
```

**Source:** https://reproducible-builds.org/docs/deterministic-build-systems/

---

## 14. Test-driven generation

**What it is.** Write the test for the next generated behavior before changing the template or generator, then make it pass, then refactor. Fowler's formulation is Red–Green–Refactor, preceded by a test list: enumerate the cases first, pick one, and add more as they occur to you.

**Why it matters.** The test-first step forces the generated interface to be designed before the template is written. It also prevents the common failure where the generator is "obviously correct" but the emitted API is awkward or untested. The test list catches edge cases — empty input, one item, aliases, sparse values, maximum size — before they become template branches.

**How to apply.**

1. Write a test list for the generated artifact, not for the template text.
2. For each item: write a failing test against the expected generated API, run it (red).
3. Change the template/generator until the test passes (green).
4. Refactor the generator and the template, keeping tests green.
5. Keep a small number of golden-file tests for shape, plus behavioral tests for semantics.
6. Test the generator's failure modes too: invalid input, unsupported type, duplicate keys.

```text
Test list for an enum stringer:
  [ ] zero value renders as the first constant
  [ ] each constant renders its own name
  [ ] alias renders the canonical name
  [ ] out-of-range value renders Type(n)
  [ ] negative value renders Type(n)
  [ ] generated file compiles
```

**Source:** https://martinfowler.com/bliki/TestDrivenDevelopment.html

---

## 15. Property-based equivalence

**What it is.** A property-based test states an invariant that must hold for many generated inputs, rather than listing examples. The most useful invariant for optimization work is equivalence: an optimized implementation must produce the same result as a slow, obviously correct reference implementation. Hypothesis also recommends round-trip properties (encode/decode) and "does not crash on valid input".

**Why it matters.** Hand-written examples miss the input that triggers the bug. When replacing a regex with a parser, a backtracking pattern with an atomic one, or a scalar loop with a batched one, equivalence over generated inputs is the safety net. Shrinking turns a failure into a minimal counterexample that is easy to diagnose.

**How to apply.**

1. Write the slow reference implementation first; keep it in the test suite.
2. Define the input domain explicitly (alphabet, length bounds, Unicode, empty).
3. Assert equivalence of outputs, not internal structure.
4. Add domain-specific invariants: no crash, match implies parse, output length bounds, idempotence.
5. Bound the runtime of the property test separately; a performance regression should fail a benchmark, not hang the property test.
6. When a counterexample is found, add it to the example table and keep it as a regression test.

```python
from hypothesis import given, strategies as st

@given(st.text(alphabet=st.characters(min_codepoint=32, max_codepoint=126),
               max_size=200))
def test_fast_matches_reference(s):
    assert bool(FAST_RE.fullmatch(s)) == bool(REFERENCE_RE.fullmatch(s))
```

**Source:** https://hypothesis.readthedocs.io/en/latest/tutorial/introduction.html

---

## 16. Batching to amortize fixed cost

**What it is.** Batching groups multiple work units into one operation so that a fixed per-operation cost is paid once instead of once per unit. The fixed cost can be a network round trip, a syscall, a lock acquisition, a transaction commit, a regex compilation, or a function call overhead. Batch size is the number of work units processed in one batch.

**Why it matters.** At high volume, fixed cost dominates: many small requests spend most of their time on setup rather than useful work. Design-level optimization explicitly favors a single request over multiple round trips in latency-bound systems. Batching also improves throughput on bulk database updates and ETL, at the cost of per-item latency and memory.

**How to apply.**

1. Measure per-item time at batch sizes 1, 10, 100, 1000; find the knee where fixed cost stops dominating.
2. Batch the expensive boundary, not the pure computation: one query for N rows, one write for N records, one compile for N matches.
3. Choose batch size from latency SLO, memory ceiling, and failure granularity; a failed batch should be retryable.
4. Preserve ordering and idempotency across retries (skill 13).
5. Watch tail latency: large batches improve average throughput but can increase p99 for the items at the back.
6. Do not batch when the per-item result is needed immediately or when partial progress matters more than throughput.

```text
Per-item:  for x in xs { db.insert(x) }        # N round trips
Batched:   db.insert_many(xs, batch_size=500)  # N/500 round trips
```

**Source:** https://en.wikipedia.org/wiki/Program_optimization

---

## 17. Caching and invalidation

**What it is.** Caching stores the result of an expensive pure computation so a later identical request can reuse it. For regex work the cheapest cache is the compiled pattern; for codegen it is the generated artifact keyed by input hash; for parsing it is the parsed tree keyed by source text and grammar version. Invalidation is the rule that decides when a cached value is no longer valid.

**Why it matters.** Caching removes redundant work but introduces a correctness risk: a stale entry is a wrong answer that persists. "Cache invalidation" is the hard part precisely because the key must include every input that can change the result — pattern, flags, engine version, grammar, locale, and relevant configuration.

**How to apply.**

1. Cache only pure functions or explicitly versioned artifacts.
2. Define the key completely: normalized input, options, code version, and any external data version.
3. Bound the cache (LRU or size limit) so untrusted input cannot exhaust memory.
4. Invalidate on deploy when the generator or engine changes; include a version in the key rather than trying to purge.
5. Measure hit rate and cost saved; a cache with a low hit rate is added complexity for nothing.
6. Never cache a match result for unbounded user input without a size cap; the key itself can be the memory problem.

```text
cache_key = sha256(pattern + "\0" + flags + "\0" + engine_version + "\0" + input)
```

Go's profiler article shows the performance side of the same idea: reusing a preallocated scratch structure across calls cut a program from 11.94s to 8.11s, and the final version ran 11× faster than the original.

**Source:** https://martinfowler.com/bliki/TwoHardThings.html

---

## 18. Measure before and after

**What it is.** Active benchmarking means running the workload in a steady state and analyzing the system with other tools *while it runs*, not just recording a number at the end. The goal is to know what the benchmark actually measured and what the limiting factor was.

**Why it matters.** Passive benchmarking produces "data, not information": you benchmark A, measure B, and conclude C. Without identifying the limiter, a speedup may be noise, a regression may be hidden by a different bottleneck, and a platform decision may be based on a benchmark that never tested the intended path.

**How to apply.**

1. Record a baseline on the same machine, same data, same build flags, with CPU frequency scaling controlled.
2. Run long enough to reach steady state; use a workload that resembles production.
3. While it runs, inspect CPU, memory, I/O, and the process itself; identify the limiter.
4. Change one variable at a time; keep the old binary for an A/B comparison.
5. Report more than the mean: p50, p99, throughput, memory, and variance. Explain why the result is X and not 2X.
6. Re-run the baseline after the change to rule out drift.
7. For regex, use a failing input and scale its length; for codegen, measure generation time and output size separately.

```bash
# Capture more than wall time.
/usr/bin/time -f '%Uu %Ss %er %MkB %C' ./bench
```

**Source:** https://www.brendangregg.com/activebenchmarking.html

---

## 19. Profile to find the hotspot

**What it is.** A profiler samples the running program and attributes cost to functions, lines, or call paths. CPU profiles show where time is spent; heap profiles show where memory is allocated; the `top`, `list`, and `web` views move from a global picture to a specific line.

**Why it matters.** Intuition about bottlenecks is frequently wrong. In the Go profiler article, the first profile showed hash-map lookups at the top; replacing a map with a slice cut runtime nearly in half, and a later profile showed allocation and garbage collection as the new limiter. Optimizing the wrong function would have produced no measurable gain.

**How to apply.**

1. Enable profiling in the benchmark or service (`-cpuprofile`, `-memprofile`, or `net/http/pprof`).
2. Start with `top -cum` to see inclusive cost, then `list <func>` to find the expensive line.
3. Use a graph/web view to see call relationships and recursive edges.
4. Fix the top item, then re-profile; the bottleneck moves.
5. Separate CPU from allocation: a function can be cheap on CPU and expensive through GC pressure.
6. Profile the same workload you benchmark; a profile of a toy input is not evidence about production.

```bash
go test -bench=. -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -top -cum cpu.out
go tool pprof -list=FindLoops cpu.out
```

**Source:** https://go.dev/blog/pprof

---

## 20. Avoid premature optimization

**What it is.** Knuth's rule: "We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. Yet we should not pass up our opportunities in that critical 3%." The skill is distinguishing the measured 3% from speculative micro-optimizations, and preferring algorithmic and data-structure improvements over local tweaks.

**Why it matters.** Micro-optimization can reduce readability and add bugs for a few percent, while an algorithmic change can be orders of magnitude. At the same time, "premature optimization" is often misused to justify ignoring architecture: performance is part of the specification, and a design that cannot meet the budget is a failure that cannot be optimized away later.

**How to apply.**

1. Establish a correctness baseline and a performance budget first.
2. Measure, then apply Amdahl's law: optimize the part that actually dominates total time.
3. Prefer the higher level first: design, algorithm, data structure, then source-level tweaks.
4. Stop when the budget is met or gains hit diminishing returns; document why the remaining cost is acceptable.
5. Keep the optimized version tested against the reference (skill 15) so the speedup does not trade correctness for time.
6. Revisit only with new measurements; do not carry a cache of assumptions about which line is slow.

```text
Order of attack:
  1. Remove work (avoid the call, the scan, the copy)
  2. Change the algorithm (O(n^2) -> O(n log n) -> O(n))
  3. Change the data structure (map -> slice, allocation -> reuse)
  4. Change the constant factor (batch, cache, compile once)
  5. Micro-tune instructions only after 1–4 are exhausted
```

**Source:** https://en.wikipedia.org/wiki/Program_optimization

---

## Fetch notes

These sources were attempted and failed, so no claim in this document relies on them:

- `https://www.catb.org/esr/writings/taoup/html/generation.html` and `https://www.catb.org/~esr/writings/taoup/html/generation.html` — transport error.
- `https://reproducible-builds.org/docs/deterministic-builds/` — 404; the working page is `/docs/deterministic-build-systems/`.
- `https://github.com/google/re2/wiki/WhyRE2` — page moved; the content now lives in the RE2 `README.md`, which was fetched instead.
- `https://en.wikipedia.org/wiki/Batching_(performance_technique)` — 404; batching is grounded in the Program optimization and Batch processing pages.
- `https://wiki.c2.com/?PrematureOptimization` — page did not render usable content in this client; Knuth's quote was taken from the Program optimization page instead.

## Sources

1. Martin Fowler — Given When Then: https://martinfowler.com/bliki/GivenWhenThen.html
2. Regular-Expressions.info — Free-Spacing & Comments: https://www.regular-expressions.info/freespacing.html
3. Google RE2 — README (linear-time guarantee, syntax limits, precompiled patterns): https://raw.githubusercontent.com/google/re2/main/README.md
4. Russ Cox — Regular Expression Matching Can Be Simple And Fast: https://swtch.com/~rsc/regexp/regexp1.html
5. OWASP — Regular expression Denial of Service (ReDoS): https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS
6. Regular-Expressions.info — Catastrophic Backtracking: https://www.regular-expressions.info/catastrophic.html
7. Regular-Expressions.info — Preventing ReDoS: https://www.regular-expressions.info/redos.html
8. Regular-Expressions.info — Atomic Grouping: https://www.regular-expressions.info/atomic.html
9. Wikipedia — Regular language: https://en.wikipedia.org/wiki/Regular_language
10. Go Blog — Generating code (Rob Pike): https://go.dev/blog/generate
11. Reproducible Builds — Deterministic build systems: https://reproducible-builds.org/docs/deterministic-build-systems/
12. Wikipedia — Idempotence: https://en.wikipedia.org/wiki/Idempotence
13. Martin Fowler — Test Driven Development: https://martinfowler.com/bliki/TestDrivenDevelopment.html
14. Hypothesis — Introduction to property-based testing: https://hypothesis.readthedocs.io/en/latest/tutorial/introduction.html
15. Wikipedia — Batch processing (batch size): https://en.wikipedia.org/wiki/Batch_processing
16. Wikipedia — Program optimization (Knuth quote, Amdahl, caching, round trips): https://en.wikipedia.org/wiki/Program_optimization
17. Martin Fowler — Two Hard Things (cache invalidation): https://martinfowler.com/bliki/TwoHardThings.html
18. Brendan Gregg — Active Benchmarking: https://www.brendangregg.com/activebenchmarking.html
19. Go Blog — Profiling Go Programs: https://go.dev/blog/pprof
