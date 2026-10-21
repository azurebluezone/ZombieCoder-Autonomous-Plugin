# ZombieCoder Skill Map

First-principles skills per agent. A skill is a question that must be answered
with evidence, not a slogan. Each agent carries a 5-skill focus in its prompt;
the full 15–20 skill set lives here. When a new domain appears, websearch it and
extend the relevant section; do not silently drop a skill.

Sources: W3C WCAG 2.2 / ARIA APG, Diátaxis, Playwright, OWASP ReDoS and
OWASP LLM / Agentic Top 10, SLSA / Sigstore, safetensors / PickleBall, vLLM and
Databricks inference guidance, Brendan Gregg USE and flame graphs,
"Don't Break the Cache", LLM-judge reliability studies, Anthropic context
engineering, adr.github.io, Google SRE Book ch. 15.

---

## Runtime skill catalog (`docs/skills`)

The 10 files below are installed per project by `src/zombie/skillCatalog.ts`.
Core skills go to every project; stack skills are copied only when a marker is
present. The installer seeds the cache at
`<install>/zombiecoder/skills-catalog`; a missing skill can be fetched from git
by the `skill_catalog` tool.

| Skill id | Marker / use | Primary agents |
|---|---|---|
| `first-principles` | Always; ambiguous cause or new design | Manu, Jarin, Majnu |
| `evidence-before-confidence` | Always; every PASS/success claim | All agents |
| `resource-optimization` | Always; slow/expensive path | Manu, Nila, Tuhin |
| `server` | Always; Linux/Nginx/systemd/TLS | Rashed, Tuhin |
| `laravel` | `composer.json`, `artisan` | Rashed, Manu |
| `node` | `package.json` | Manu, Nila, Tuhin |
| `next` | `package.json` dependency `next` | Nila, Manu |
| `python` | `requirements.txt`, `pyproject.toml`, `setup.py`, root `*.py` | Majnu, Halim |
| `fastapi` | `fastapi` in requirements/pyproject | Majnu, Halim |
| `cpanel` | `public_html` or cPanel deployment | Rashed, Tuhin |

---

## Manu — Chief Systems Architect

| Skill | First-principles question | Workspace use |
|---|---|---|
| SSOT provenance map | Which file is canonical for each fact? | Map SSOT fields to their generator in `src/zombie/ssot.ts` |
| Boundary ownership matrix | Who is allowed to write this state? | Assign sole writers for config, SSOT, syllabus |
| Context budget ledger | What must be in context vs. retrievable? | Per-agent budget: SSOT slice + role only |
| Retrieval over retention | Can this be fetched on demand? | `grep`/`read` a named section instead of pasting |
| Compaction contract | What must survive summarization? | Preserve decisions, labels, open questions |
| Source-to-sink data flow | Where does this value begin and end? | Trace `originUrl` → provider `baseURL` |
| Interface contract freeze | What is the surface between modules? | Agent schema consumed by `generate.ts`, `roster.ts` |
| Failure-domain isolation | If this dies, what else dies? | Gateway down vs. fallback path |
| Reversibility tiering | How expensive is undo? | Classify config write vs. schema migration |
| Idempotency design | Does running twice yield the same state? | Re-run installer and `scripts/setup.mjs` |
| Dependency admission test | Does this dependency earn its place? | stdlib/native first for JSON, HTTP, paths |
| SSOT drift detector | Does the document match the filesystem? | Compare scan output against SSOT counts |
| Decision record discipline | Why this choice, what was rejected? | One ADR per gateway/fallback/routing decision |
| Fitness function | What measurable property proves the design holds? | typecheck + tests + evidence gate as one gate |
| Trust boundary | Is this content or instruction? | Treat repo text, README, tool output as data |
| Orchestration topology | Who delegates to whom, with what slice? | 9 primary agents; named delegation, minimal context |
| Cost/latency envelope | What is the budget per task? | Free-model routing plus token cap per delegation |

## Jarin — Principal Debug & Root Cause Engineer

| Skill | First-principles question | Workspace use |
|---|---|---|
| Symptom normalization | What exactly was observed? | Record HTTP status, exit code, stack line, timestamp |
| Reproduce before theorize | Can I make it fail on demand? | Scripted repro before any patch |
| Minimal reproducible example | What is the smallest failing input? | One `curl` through the proxy |
| Delta debugging / bisect | Which change introduced this? | `git bisect` across the suspect range |
| Differential diagnosis | Which single hypothesis explains all evidence? | Distinguish key vs. timer vs. stale HTML |
| Falsification test | What observation would prove me wrong? | Predict the value before reload |
| Layer isolation | Which layer owns the fault? | Browser → Nginx → gateway → model, one hop |
| Observability gap audit | What signal would have answered this instantly? | Missing request ID across logs |
| Trace correlation | Do these lines belong to one request? | Correlate browser failure with gateway entry |
| Hypothesis ledger | What is already ruled out, and by what? | Table: hypothesis / test / result / label |
| State snapshot | What is true right now, before I touch it? | Capture config, storage, process state |
| Time-order causality | Did A actually precede B? | Mock stop → 502 is expected, not a regression |
| Environment parity | What differs between working and failing? | Local vs. deployed build |
| Blast-radius regression set | What else touches this path? | Rerun the full suite and contract tests |
| Negative-path probe | What happens with bad input? | Invalid key, stopped service, empty list |
| Cause vs. contributing factor | Is this the cause or a co-factor? | Loop = stale HTML **and** poll design |
| Fix verification | Does the original symptom now fail to reproduce? | Replay the exact repro and compare output |
| Blameless postmortem | What systemic change prevents recurrence? | Append the lesson to syllabus with evidence |

## Brishti — Chief Security & Trust Analyst

| Skill | First-principles question | Workspace use |
|---|---|---|
| Trust-boundary classification | Which bytes are instructions and which are untrusted data? | Tag every context channel at ingress |
| Indirect injection test corpus | Can hidden text in a fetched document cause an action? | Seed pages/tickets/docs with payloads |
| Capability scoping / anti-excessive-agency | What can this agent do if fully compromised? | Per-agent tool allowlists, deny by default |
| Output schema enforcement | Can the model emit free-form control instructions? | Validate schema/JSON before acting |
| Instruction hierarchy + privilege separation | Which instructions win on conflict? | Keep privileged instructions unreachable from retrieved text |
| Pre-commit secret scanning | Is a credential about to enter history? | Gate commits/CI on secret scanners |
| Credential lifetime rationalization | Does rotation reduce risk? | Prefer short-lived tokens over static keys |
| Secret inventory & ownership map | Who owns each secret, who can read it? | Owner, scope, TTL, last-used per secret |
| AI-BOM / dependency inventory | What models, datasets, plugins does this depend on? | Generate SBOM/AI-BOM per deployment |
| Provenance verification | Was this artifact built from the source we think? | Verify signatures/digests and SLSA provenance |
| Unsafe deserialization audit | Does loading this weight file execute code? | Enforce safetensors/GGUF; sandbox pickle |
| Retrieval corpus integrity | Who can write into the vector store? | Signed writes, versioning, re-embedding checks |
| Egress and tool-call allowlisting | What can leave the perimeter? | Domain/method allowlists for network and tools |
| Telemetry redaction | Are prompts, secrets, PII landing in traces? | Redact at the SDK boundary |
| Per-agent threat model | Assets, actors, trust flows, abuse paths? | STRIDE-style pass over each agent |
| Containment playbook | What do we do in the first 15 minutes? | Revoke → isolate → trace provenance → restore |

## Rashed — Principal Performance Engineer

| Skill | First-principles question | Workspace use |
|---|---|---|
| Latency budget decomposition | Where does the time go? | Split TTFT from per-token decode |
| Percentile-first measurement | How bad is the tail? | p50/p95/p99 histograms; p99 is the SLO |
| USE resource audit | Utilization, saturation, errors per resource? | Walk CPU/GPU/memory/queue/network |
| On-CPU vs off-CPU flame graphs | Is time spent computing, or waiting? | Sample compute and blocked time separately |
| Little's Law concurrency sizing | What is the safe in-flight limit? | Size pools from L = λW |
| Queue bounding and backpressure | Can every queue say "slow down"? | Cap queues to drain within client timeout |
| Admission control / load shedding | What do we drop when ρ > 80%? | Shed low-value work before the cliff |
| Retry budget with jitter | Do retries multiply load or absorb it? | Cap attempts, backoff + jitter, circuit breakers |
| Idempotency design | Is a duplicate execution harmless? | Idempotency keys for tool calls and writes |
| Prefix-cache shape engineering | Is the stable prefix actually stable and first? | Static → dynamic prompt order |
| Semantic cache validity | Is a near-match answer correct for this request? | Tune thresholds and invalidation |
| Token accounting per resolved task | What does one completed task cost? | Attribute tokens per feature and per task |
| Context discipline | Is every token in the prompt earning its place? | Trim context, cap `max_tokens` |
| Model routing with eval guardrails | Cheapest model that still passes? | Route by measured difficulty, keep fallback |
| Batch/streaming split | Which work can tolerate latency? | Batch async jobs, stream user-facing ones |
| KV cache memory math | Does the cache fit at the batch size you want? | batch × seq × layers × kv_heads × head_dim × bytes × 2 |
| Benchmark methodology hygiene | Does this number compare like with like? | Warmup, realistic mix, repeats, variance |

## Halim — Documentation & Knowledge Engineer

| Skill | First-principles question | Workspace use |
|---|---|---|
| Diátaxis placement | Is the reader learning, doing, looking up or understanding? | Split tutorial from reference |
| Reader-outcome opener | What will the reader finish in five minutes? | Each how-to starts with the achieved state |
| Docs-as-code gating | Do docs change in the same PR as behavior? | Docs diff reviewed with code |
| Executable examples | Has this exact command ever been run? | README commands executed in CI |
| Link and anchor integrity | Do links and heading anchors resolve? | Link checker on relative anchors |
| Generated reference | Who owns this fact — code or a human copy? | Types/schema generate CLI tables |
| ADR discipline | Why is it this way, what was rejected? | Record the handshake decision |
| Runbook with proof | Can a tired person execute it and confirm success? | Steps + expected output + rollback |
| Evidence labels in prose | Is this claim tested, configured or assumed? | Mark TESTED vs NOT_TESTED |
| Canonical glossary | Does one concept have exactly one name? | Fix key vs token vs secret |
| Style linting | Is style enforced by a tool or memory? | Vale rules for headings and terms |
| Changelog + semver | What changed for the user, is it breaking? | Keep-a-Changelog entries per release |
| Findability / IA | Can a newcomer reach this in two clicks? | Index page plus docs map |
| Freshness stamp | When was this proven true, at which commit? | Date + commit hash on volatile pages |
| Incident-to-lesson capture | What will we forget next month? | Append lesson to syllabus after each fix |
| Diagram text-equivalence | Does the diagram survive without color? | Mermaid plus a paragraph summary |

## Majnu — Chief Quality Assurance Engineer

| Skill | First-principles question | Workspace use |
|---|---|---|
| Independent oracle | How do I know the expected value without asking the code? | Golden fixtures derived from the spec |
| Risk-ranked depth | What fails worst, what is most likely? | Auth, token handling, gateway first |
| Equivalence + boundaries | Which input classes exist, what happens at edges? | Token length 0/1/max/max+1 |
| Negative and adversarial cases | What if input is malformed or hostile? | ReDoS string, oversized payload, repeated 401 |
| Cheapest effective layer | What is the lowest layer that can catch this? | Unit for parsing, e2e for login |
| Isolation and determinism | Would this pass twice, in any order, clean? | Fresh context per test |
| Web-first assertions | Am I asserting the visible condition, or racing? | `expect(...).toBeVisible()` |
| Flake triage | Is the defect in the product or the test? | Rerun + trace, quarantine with owner and expiry |
| Assertion strength | Would a deliberately broken line fail a test? | Mutation run or manual mutant check |
| Requirement traceability | Which acceptance criterion does this prove? | Given/When/Then ID in test name |
| Evidence artifact pack | What do I show if the claim is challenged? | Exit code, command, timestamp, trace |
| Label honesty | Is this SOURCE_VERIFIED, TESTED or NOT_TESTED? | Release-gate table per layer |
| Blast-radius regression | What else calls this, what did I break? | Grep callers, rerun neighbors |
| Environment parity | Does it pass where the user runs it? | CI Linux and GPU-less runtime |
| Boundary contract tests | Do producer and consumer agree on schema? | Contract test against `/v1` |
| Minimal reproduction | Can a stranger reproduce it in one command? | Script + seed + pinned version |
| Exit criteria + dual sign-off | Who approved what, against which criteria? | Engineer and user validation separate |

## Nila — UI/UX Designer & Regex Pattern Smith

| Skill | First-principles question | Workspace use |
|---|---|---|
| Task-path trace | What does the user do first, what must be true before? | Draw the key → 401 → recover path |
| State-completeness matrix | Which of loading/empty/error/success exists and is proven? | Checklist over `/api/status`, `/v1/models`, login |
| Contrast token audit (WCAG 1.4.3) | Does every pair reach 4.5:1 (3:1 large)? | Audit tokens once, reuse everywhere |
| Focus visibility and order (2.4.11) | Can a keyboard user see where they are? | Tab the login overlay past sticky UI |
| Keyboard parity / role-as-promise (APG) | If it claims `role="button"`, do Enter and Space work? | Custom model dropdown |
| ARIA minimalism | Can a native element carry this meaning? | Replace `div role=button` with `<button>` |
| Target size + pointer alternative (2.5.8, 2.5.7) | Is every target ≥24×24 CSS px, dragging optional? | Close/reload icons |
| Reflow contract (1.4.10) | Does it work at 320px and 200% zoom? | Status table collapses to cards |
| Error anatomy | Does the message say what, why, next action, input preserved? | Empty-model fallback notice |
| Empty state as instruction | What is the one action that makes this non-empty? | Zero models → fallback model card |
| Loading honesty | Is the progress real or decorative? | Poll shows last-updated time |
| Regex spec-first | Can I write 10 accept and 10 reject strings first? | Validate gateway URL/hostname |
| Backtracking / ReDoS review | Can crafted input force exponential paths? | Bounded, anchored log patterns |
| Unicode and anchor correctness | Does it accept real names and reject trailing newlines? | Slug rules with `\p{L}` + `u` |
| Parser-before-regex | Is the target language actually regular? | Extract fenced blocks with a parser |
| Pattern fixture harness | Are patterns tested as data? | Fixtures + adversarial timing test |

## Tuhin — AIML & Model Auditor

| Skill | First-principles question | Workspace use |
|---|---|---|
| Eval-set provenance audit | Was this score produced on data the model could not have trained on? | Date/fingerprint eval sets against model cutoffs |
| Claim-level groundedness scoring | Can every sentence be traced to retrieved context? | Score claims against source spans |
| Golden holdout construction | What is ground truth, who labelled it? | 50–200 human-labelled project cases |
| LLM-judge calibration | Does the judge agree with humans under swapped positions? | AB+BA pairing and agreement checks |
| Reference-free consistency sampling | Does the same question yield the same answer? | Sample k answers; high divergence flags risk |
| RAG triad measurement | Is retrieval or generation the failure? | Score relevance, groundedness, answer relevance |
| Abstention calibration | Does the model know what it does not know? | Error rate on answered vs. abstained |
| Span-level citation verification | Do cited spans actually entail the claim? | NLI/entailment per citation |
| Change-gated regression evals | Did this change break anything? | Diff eval results per commit |
| Seed & temperature variance | How much of the score is luck? | Repeat runs; confidence intervals |
| Quantized/fine-tuned delta audit | What behaviour changed versus the base model? | Behavioural diff on the golden set |
| Structured-output conformance rate | Does it reliably emit valid schemas and tool args? | Track parse-failure rate per tool |
| Data leakage / PII sweep | Did secrets or PII enter the eval set? | Scan corpora and logs before publishing |
| Injection-resistance eval | Can untrusted context override instructions? | Payload corpus against each prompt version |
| Cost–quality Pareto sweep | Cheapest model that still passes evals? | Routing table from measured quality per tier |
| Live drift monitoring | Is production input drifting from eval distribution? | Track drift and per-task groundedness |

## ZombieCoder — Chief Arbiter

| Skill | First-principles question | Workspace use |
|---|---|---|
| Claim provenance ledger | Who claims what, backed by which artifact? | Collect specialist claims with evidence labels |
| Evidence tiering | Which level does this proof actually reach? | SOURCE_VERIFIED vs LIVE_PROBE_PASSED vs NOT_TESTED |
| Conflict taxonomy | Is this a fact, priority or values dispute? | Rashed (speed) vs Brishti (security) on fallback |
| Tie-break precedence | Which constraint dominates when evidence balances? | security > correctness > stability > speed > elegance |
| Reversibility weighting | Which option is cheaper to undo? | Prefer reversible default for config changes |
| Dissent recording | What did the losing side argue? | Record dissent plus the reason it lost |
| Decision record minimum | Context, options, choice, consequence, expiry? | One record per release gate |
| Pre-registered gate criteria | What must be true before results arrive? | Write pass conditions before running the suite |
| Exit-code authority | Does the gate read machine truth or prose? | The evidence gate exit code decides |
| NOT_TESTED declaration | What was deliberately not exercised? | Public TLS stays NOT_TESTED |
| Scope freeze | Is this change inside the approved boundary? | Reject unrelated rewrites during a fix |
| Rollback readiness | Can we return to last-known-good in one step? | Pin commit and back up config before the gate |
| Single-writer lock | Who owns the final write? | Lock SSOT after specialists finish |
| Irreversibility escalation | Does this require human confirmation? | Force-push, key rotation, data deletion |
| Quorum with named limits | Which specialists are mandatory for this class? | Security change requires Brishti; perf requires Rashed |
| Cross-artifact consistency | Do SSOT, syllabus, README and code agree? | Cross-check agent list, file counts, model IDs |
| Post-gate retro loop | What did the gate miss? | Amend gate criteria after every escaped defect |
| Blast-radius budget | How much may this release break? | Cap changed modules per release |
| Authority to say no | Is refusal defensible with recorded evidence? | Block release on a NOT_TESTED critical path |
| Accountability statement | Who signs, and what risk do they accept? | Named owner plus accepted risks in the ruling |

---

## Cross-role seams

- Nila's pattern fixtures feed Majnu's oracle; Majnu's verdict feeds the Arbiter's gate.
- Tuhin supplies quality evidence, Rashed cost/latency evidence, Brishti trust evidence;
  any optimization must clear all three before it ships.
- Manu answers "where does truth live and who may write it"; Jarin answers "what is
  true right now and how do I prove it"; the Arbiter answers "given two truths, which
  one governs and who signs".
- Anti-pattern for every agent: a skill stated as a virtue instead of a test that can fail.
