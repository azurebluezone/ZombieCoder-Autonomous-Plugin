# AIML & Model Auditor — First-Principles Skills

**Owner:** Tuhin (AIML & Model Auditor)
**Scope:** model and provider behaviour: capability, hallucination, prompt injection, routing, token cost, eval validity.
**Rule:** a model's output is a claim, not evidence. `capabilities.tools` in a model card is a claim too — probe it.

Each skill below follows **what → why → how**, and ends with one authoritative source that was fetched while writing this file.

## Skill index

| # | Skill | Primary risk it controls |
|---|-------|--------------------------|
| 1 | Capability probing over self-report | Assuming a model can do what its card says |
| 2 | Eval-set provenance datasheet | Scoring on data you cannot describe |
| 3 | Harness reproducibility | Numbers nobody can re-run |
| 4 | Statistical error bars on evals | Ship/no-ship on noise |
| 5 | Claim-level groundedness scoring | Confident unsupported answers |
| 6 | Truthfulness baseline | Sycophancy and popular misconceptions |
| 7 | LLM-judge calibration | A judge that agrees with itself |
| 8 | Prompt-injection threat model | Untrusted text treated as instructions |
| 9 | Indirect-injection corpus | Injection arriving through retrieved data |
| 10 | Trust-boundary segregation (Dual LLM) | Confused-deputy and exfiltration |
| 11 | Capability-based injection defence (CaMeL) | Untrusted data steering control flow |
| 12 | Cost-quality routing | Paying frontier prices for easy prompts |
| 13 | Fallback topology | One provider outage = total outage |
| 14 | Fallback verification (chaos) | Fallbacks that exist but never work |
| 15 | Token and cost accounting | Silent 3x spend, wrong invoices |
| 16 | Context-window budgeting | 400s, truncation, silent quality loss |
| 17 | Position-aware context placement | "Lost in the middle" recall collapse |
| 18 | Tool-call schema reliability | Malformed args, wrong tool, broken loops |
| 19 | Consumption guardrails | Denial of wallet, runaway agents |

---

## 1. Capability probing over self-report

### What it is
A repeatable probe suite that measures what a model/provider *actually* does — native tool calling, parallel calls, strict schema adherence, multi-turn tool use, cost and latency — instead of trusting a model card, a router config, or a provider's `/v1/models` response.

### Why it matters
Provider metadata is a marketing surface. A gateway can advertise a model that exists but cannot hold your system prompt, or can emit tool calls as text instead of structured calls. Berkeley's BFCL exists precisely because "supports function calling" is not a boolean you can read off a spec sheet: it scores accuracy across simple, parallel, multi-turn and agentic categories, and reports cost and latency alongside accuracy.

### How to apply
- Keep a `capability_probe` suite with one case per capability you depend on, each with a machine-checkable oracle.
- Probe the **exact** deployment you will route to (base URL + model ID + API version), not the vendor's flagship.
- Record four fields per probe: `passed`, `latency_ms`, `usd`, `raw_response`. A pass without cost is an incomplete result.
- Re-run on every model or gateway change; store results as JSON next to the config.
- Treat a failed probe as a routing constraint, not an error to retry.

```python
PROBES = {
  "tool_call_native": lambda r: r.tool_calls and r.tool_calls[0].name == "get_weather",
  "parallel_calls":   lambda r: len(r.tool_calls) == 2,
  "strict_schema":    lambda r: jsonschema.validate(r.args, WEATHER_SCHEMA) is None,
  "long_prompt_8k":   lambda r: r.error is None,
}

def probe(model, prompt, tools):
    r = call(model, prompt, tools=tools)
    return {
        "passed": all(fn(r) for fn in PROBES.values()),
        "latency_ms": r.latency_ms,
        "usd": r.cost,
        "raw": r.raw,
    }
```

Never merge "model supports tools" and "our adapter supports tools" into one green check — they fail independently.

**Source:** https://gorilla.cs.berkeley.edu/leaderboard.html

---

## 2. Eval-set provenance datasheet

### What it is
A per-dataset record describing where eval items came from, how they were collected, what they contain, what they must not be used for, and who maintains them — the dataset equivalent of an electronics datasheet.

### Why it matters
An eval score is only as meaningful as the set it was computed on. Datasheets for Datasets was written because ML had no standard process for documenting datasets, which "can lead to severe consequences in high-stakes domains." In an audit, the first question is not "what score?" but "whose questions, collected when, filtered how, and has the model seen them?"

### How to apply
- Add `evals/<set>/DATASHEET.md` with: motivation, composition (counts per category), collection process, labelling process, distribution, maintenance, and **intended/out-of-scope uses**.
- Require a `source_url`, `license`, `collected_at`, and `hash` per set; pin the hash in CI.
- Record provenance for **every** eval, including the 20-case smoke set. Ad-hoc sets are where contamination hides.
- Mark any set derived from production traffic as `PII_REVIEWED: yes/no` before it is committed.
- Block a release gate if the datasheet is missing or the hash drifted.

```yaml
# evals/routing_regression/DATASHEET.md (front matter)
id: routing_regression
version: 3
items: 412
source: "internal incidents 2025-11..2026-03, redacted"
license: internal
collected_at: 2026-03-14
sha256: 9f2c...c41
out_of_scope: ["multilingual", "vision", "code execution"]
pii: reviewed
```

**Source:** https://arxiv.org/abs/1803.09010

---

## 3. Harness reproducibility

### What it is
Running evals through one pinned harness with versioned tasks, pinned model revisions, fixed decoding parameters and stored raw outputs — so a second engineer gets the same number.

### Why it matters
Most "model X scores 71%" claims collapse the moment you ask which prompt template, which few-shot count, which answer-extraction regex and which model revision were used. lm-evaluation-harness is built around this: publicly available prompts for reproducibility and comparability, plus explicit `revision` pinning for checkpoints. If two numbers came from different harnesses, they are not comparable — they are two unrelated measurements.

### How to apply
- Pin the harness version, the task version, the model revision and the tokenizer in one lockfile.
- Store `raw_outputs.jsonl` next to the score. A score without raw text cannot be audited or re-scored.
- Run `--limit` on a sample first to verify answer extraction before spending on the full run.
- Keep decoding params in the eval config, not in code defaults that drift.
- Diff prompts between runs; a prompt edit is an eval change and must bump the eval version.

```bash
lm_eval --model hf \
  --model_args pretrained=org/model,revision=step100000 \
  --tasks my_task_v3 \
  --batch_size 8 \
  --limit 50          # smoke first: check extraction
```

Audit question to ask every time: *can I regenerate this exact number from the repo alone?* If no, the result is `UNVERIFIED`.

**Source:** https://github.com/EleutherAI/lm-evaluation-harness

---

## 4. Statistical error bars on evals

### What it is
Treating an eval as an experiment sampled from a super-population: report confidence intervals, test differences between two models properly, and size the eval before running it.

### Why it matters
A 200-item eval has a standard error around 3.5 points at p≈0.5. Teams routinely ship a model because it won 51% to 49% on 100 items — pure noise. Miller's paper makes the point directly: evaluations *are* experiments, and the eval literature has largely ignored the experimental-design literature, producing results that are statistically uninformative.

### How to apply
- Report `score ± 95% CI`, never a bare point estimate.
- Use paired comparisons on the same items when comparing two models; unpaired CIs overstate uncertainty and hide item difficulty.
- Decide the minimum detectable effect **before** the run, then compute required n. If n is unaffordable, shrink the claim, not the interval.
- Never compare scores across different eval sets or different item counts.
- Store per-item pass/fail, not just the aggregate — intervals need the raw vector.

```python
# Wilson interval for a pass rate; use the paired variant when items are shared
from statsmodels.stats.proportion import proportion_confint
lo, hi = proportion_confint(passes, n, alpha=0.05, method="wilson")
report(f"{passes/n:.3f} [{lo:.3f}, {hi:.3f}] n={n}")
```

A gate phrased as "≥ 0.80" is meaningless until you state the interval width you will accept.

**Source:** https://arxiv.org/abs/2411.00640

---

## 5. Claim-level groundedness scoring

### What it is
Decomposing an answer into atomic claims and checking each claim against the retrieved context, then scoring `supported_claims / total_claims`.

### Why it matters
Document-level "is this answer grounded?" judgements are too coarse: a response can be 90% correct and still contain the one fabricated number that causes an incident. Claim-level scoring localises the failure, makes regressions visible, and gives a metric that a judge can be calibrated against. Ragas defines faithfulness exactly this way and ships the decomposition → verification → ratio pipeline.

### How to apply
- Force the model to cite a context ID per sentence; unsupported sentences become automatic failures.
- Score with a small verifier first (cheap, deterministic-ish), escalate disputed claims to a stronger model or human.
- Report the distribution, not just the mean: one wrong claim in a legal answer is not equivalent to one wrong claim in a poem.
- Gate on `unsupported_claims == 0` for high-risk answer classes, not on an average.
- Keep the claim-splitting prompt versioned; changing it changes the metric.

```python
claims = split_claims(answer)                 # ["born in Germany", "born 20 March 1879"]
supported = [c for c in claims if entails(context, c)]
groundedness = len(supported) / max(len(claims), 1)
fail_hard = any(c.risk == "high" and c not in supported for c in claims)
```

Pair this with retrieval quality: a faithful answer over irrelevant context is still a wrong answer.

**Source:** https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/

---

## 6. Truthfulness baseline

### What it is
A fixed set of questions whose popular-but-false answers a model is likely to have absorbed, used to measure whether the model resists imitating human misconceptions.

### Why it matters
TruthfulQA's 817 questions across 38 categories were designed so that imitating human text produces the wrong answer. The original result — best model 58% truthful versus 94% for humans, with larger models generally *less* truthful — is the counter-example to "scale solves accuracy." Any agent that gives advice in health, law, finance or security needs this baseline before it is trusted with prose.

### How to apply
- Run a truthfulness slice as a standing eval, separate from task accuracy. Accuracy evals reward guessing; truthfulness evals reward abstaining.
- Score three outcomes: correct, incorrect-but-confident, and "I don't know". Treat confident-wrong as the expensive failure.
- Track the false-premise subset: questions that presuppose something false. An agent that answers them has no epistemic guard.
- Add domain-specific misconception items mined from your own incident log; public benchmarks saturate.
- Use it as a **release gate input**, not a leaderboard position.

```python
for q in truthful_slice:
    out = ask(q.text)
    label = classify(out, correct=q.correct, incorrect=q.incorrect)
    record(q.id, label)   # correct | incorrect_confident | abstain
assert rate("incorrect_confident") <= budget
```

**Source:** https://arxiv.org/abs/2109.07958

---

## 7. LLM-judge calibration

### What it is
Validating an automated judge against human labels, measuring its known biases (position, verbosity, self-enhancement), and correcting for them before the judge is allowed to gate anything.

### Why it matters
MT-Bench/Chatbot Arena showed strong judges can reach >80% agreement with human preference — the same level humans reach with each other — but also documented position bias, verbosity bias, self-enhancement bias and limited reasoning. An uncalibrated judge is a random number generator with good grammar, and it will happily approve its own family's outputs.

### How to apply
- Build a 100–200 item human-labelled calibration set per judge rubric; report Cohen's κ, not raw agreement (raw agreement inflates on easy items).
- Swap A/B order and average, or drop pairs where the verdict flips — that flip rate *is* the position-bias metric.
- Control verbosity: score against a rubric with length-normalised criteria, or report a length-controlled subset.
- Never let a model judge outputs from the same model family for a release gate; use a different family or a human.
- Re-calibrate whenever the judge model, prompt, or rubric version changes.
- Log judge `reason` + `verdict` + `rubric_version` so a disputed decision is replayable.

```python
a, b = judge(prompt, x, y), judge(prompt, y, x)
if a.verdict != invert(b.verdict):
    position_flips += 1        # report this rate
final = majority([a.verdict, invert(b.verdict), judge_with_third_family(...)])
```

**Source:** https://arxiv.org/abs/2306.05685

---

## 8. Prompt-injection threat model

### What it is
A written model of how untrusted text can alter model behaviour — direct (user input) and indirect (retrieved documents, web pages, tool output, images) — plus the mitigations that apply at each boundary.

### Why it matters
OWASP's LLM01 is blunt about the root cause: injection exists in how models process prompts, and RAG or fine-tuning "do not fully mitigate" it. If your agent reads a repository, a ticket, or a web page, that content is in the same channel as your instructions. The impact ranges from data disclosure to unauthorised tool use to arbitrary command execution in connected systems.

### How to apply
- Classify every input path as `trusted` (system prompt, developer config) or `untrusted` (user, retrieval, tool output) and write it down in a table.
- Apply OWASP's concrete controls: constrain role/capability in the system prompt, validate output format with deterministic code, least-privilege tokens, human approval for high-risk actions, and explicit segregation of external content.
- Assume prompt-level defences are probabilistic. Put the hard control in code: allow-lists, schema validation, no outbound network from tool-executing contexts.
- Log injection attempts as security events with the source document ID.

```python
TRUST = {"system": "trusted", "user": "untrusted", "retrieval": "untrusted", "tool_output": "untrusted"}

def render(msg):
    if TRUST[msg.role] == "untrusted":
        return f"<untrusted source={msg.source_id}>\n{msg.text}\n</untrusted>"
    return msg.text
```

Labelling is not a defence by itself; it is what makes the *next* control (capability limits, output validation) enforceable.

**Source:** https://genai.owasp.org/llmrisk/llm01-prompt-injection/

---

## 9. Indirect-injection corpus

### What it is
A maintained set of adversarial payloads embedded in the data your agent ingests — documents, README files, issue comments, HTML, tool responses — used to measure injection resistance end to end.

### Why it matters
Greshake et al. showed that attackers do not need to talk to your model: they only need to place text in data likely to be retrieved. Their taxonomy covers data theft, worming, information-ecosystem contamination and manipulation of which APIs get called, demonstrated against real systems. A prompt-injection eval made only of chat messages tests the wrong surface.

### How to apply
- Store payloads as fixtures with metadata: vector (document/tool/web/image), goal (exfiltrate, call tool, change answer), and expected safe behaviour.
- Assert on **effects**, not on text: did an outbound request fire, was a privileged tool invoked, did the answer change?
- Include a benign control per vector to catch over-refusal.
- Run the corpus in CI against the real tool layer with a sandboxed network sink; a payload that "fails" because the tool was never implemented proves nothing.
- Version the corpus and record the pass rate per vector class.

```python
def test_indirect_exfil(sandbox):
    doc = load_fixture("exfil_via_markdown_image.md")
    sandbox.run_agent(task="summarise", context=[doc])
    assert sandbox.outbound_requests == []          # effect-based oracle
    assert not sandbox.privileged_calls
```

**Source:** https://arxiv.org/abs/2302.12173

---

## 10. Trust-boundary segregation (Dual LLM)

### What it is
Splitting the system into a **privileged** LLM (sees only trusted input, holds tools) and a **quarantined** LLM (processes untrusted content, holds no tools), with a non-LLM controller passing opaque handles between them.

### Why it matters
The confused-deputy problem is the core of agent security: a model with both private data and tool access, reading attacker-controlled text, is a privilege-escalation primitive. Willison's pattern is the minimal architecture that removes the capability instead of trying to filter the language. It is explicitly a bad-UX, high-complexity trade — which is exactly why it must be an architectural decision, not a prompt.

### How to apply
- Draw the boundary at the tool layer: quarantined context gets zero tools and zero credentials.
- Never forward raw quarantined output to the privileged model. Pass a handle (`$VAR2`) and let the controller render it to the user.
- Allow only verified-shape outputs across the boundary (enum classification), never free text.
- Block exfiltration channels: no model-generated links, no model-generated image URLs, allow-listed hosts only.
- Validate the boundary with a test that greps the privileged prompt for any quarantined bytes.

```python
def handle_untrusted(text):
    summary = quarantined_llm(f"Summarise: {text}")   # no tools, no secrets
    return store(summary)                            # privileged sees only this id
```

Remember the residual risk: a user can still be socially engineered into copying data out.

**Source:** https://simonwillison.net/2023/Apr/25/dual-llm-pattern/

---

## 11. Capability-based injection defence (CaMeL)

### What it is
Extracting control and data flow from the *trusted* user query, then enforcing capability policies at tool-call time so untrusted retrieved data can never influence program flow or reach an unauthorised data sink.

### Why it matters
Dual-LLM's weakness is that the privileged model still reads tainted text. CaMeL moves the guarantee into a system layer: the plan comes from the trusted query, untrusted values are carried as data with capabilities attached, and policy is checked in code when a tool fires. Google DeepMind reports 77% of AgentDojo tasks solved with provable security versus 84% undefended — a quantified, honest security/utility trade rather than a promise.

### How to apply
- Parse the user request into an explicit plan (steps, tool calls, data dependencies) before any retrieval happens.
- Tag every value with its origin and permitted sinks; propagate tags through every transformation.
- Enforce policy at the tool boundary: `send_email` may not receive a value tagged `untrusted:web`.
- Deny by default; require an explicit capability grant per (tool, data-class) pair.
- Test the policy engine directly with synthetic tainted values — it is ordinary code and can be unit-tested.

```python
v = fetch(url)                       # origin=web, caps={read}
s = summarise(v)                     # taint propagates: origin=web
policy.require(s, sink="email")      # raises CapabilityDenied
```

**Source:** https://arxiv.org/abs/2503.18813

---

## 12. Cost-quality routing

### What it is
Choosing a model per request — cheap model by default, strong model when the query is hard — using a router trained or tuned on preference/quality data, rather than a static model choice.

### Why it matters
Most traffic does not need a frontier model, but hard queries do. RouteLLM shows learned routers cutting cost by more than 2x in some settings without sacrificing response quality, and that routers transfer when the strong/weak pair changes. Static routing overpays on the easy 80%; naive "always cheap" underperforms on the hard 20% that customers remember.

### How to apply
- Define the quality metric first (judge score, task pass rate, groundedness), then the cost metric. A router without a quality floor is a cost-cutting exercise.
- Start with a deterministic difficulty heuristic (prompt length, tool count, retrieval ambiguity); add a learned router only when you have labelled traffic.
- Shadow-route: send a sample to the strong model in parallel and compare, without affecting user latency.
- Keep the escalation path explicit and bounded — max one escalation, with the escalation reason logged.
- Re-evaluate the router whenever either endpoint model changes; the transfer claim is empirical, not guaranteed.

```python
def route(req):
    if req.tokens > 20_000 or req.needs_tools or req.risk == "high":
        return STRONG
    return WEAK if router.score(req) < THRESHOLD else STRONG
```

Report a Pareto point, not a single number: `(quality, usd_per_1k, p95_latency)`.

**Source:** https://arxiv.org/abs/2406.18665

---

## 13. Fallback topology

### What it is
An explicit, configured order of failure handling: retries with backoff → same-model peer deployment → cross-provider fallback → graceful degradation, with cooldowns so a sick deployment stops receiving traffic.

### Why it matters
Fallbacks are configuration, and configuration is where availability dies. LiteLLM's router documents the real mechanics teams get wrong: cooldowns apply per deployment (not per model group), 429s trigger immediate cooldown, `num_retries` is not the provider SDK's `max_retries`, and context-window pre-call checks must be enabled to avoid routing a 5k prompt to a 4k deployment. Without these, a "highly available" setup fails over into a smaller context window or retries into a rate limit.

### How to apply
- Write the chain down: `primary → same-model peer region → different-provider equivalent → degraded (cached/partial)`.
- Set cooldowns and `allowed_fails` per deployment; cap total attempts so a retry storm cannot form.
- Enable context-window pre-call checks and tag each deployment's real window; never assume parity across providers.
- Make fallback observable: log `deployment_id`, `attempt`, `reason`, `final_model`.
- Ensure the fallback model passes the *same* capability probes (Skill 1) — a fallback that cannot do tool calls is a downgrade, not a fallback.

```yaml
router_settings:
  num_retries: 2
  allowed_fails: 3
  cooldown_time: 30
  enable_pre_call_checks: true
  fallbacks: [{"primary": ["secondary"]}]
```

**Source:** https://docs.litellm.ai/docs/routing

---

## 14. Fallback verification (chaos)

### What it is
Deliberately breaking a dependency in a controlled experiment, with a defined steady state, to verify the fallback actually works — rather than assuming the YAML is correct.

### Why it matters
The Principles of Chaos name "improper fallback settings when a service is unavailable" as a canonical systemic weakness, alongside retry storms and cascading failures. Configuration review cannot prove that a fallback path executes, authenticates, and produces acceptable output; only an experiment can. The four-step method — define steady state, hypothesise it holds, inject a real-world variable, try to disprove — turns "we have fallbacks" into an evidence-backed claim.

### How to apply
- Define steady state numerically: success rate, p95 latency, groundedness floor, cost per request.
- Inject one variable at a time: provider 500s, 429s, timeout, malformed tool JSON, context-window rejection.
- Constrain blast radius: test tenant, traffic percentage, time box, and an automatic abort.
- Assert on user-visible outcomes, not on logs saying "fallback triggered".
- Keep the experiment in CI or a scheduled drill; a fallback verified once is a fallback that has since rotted.

```python
exp = Experiment(
    steady_state={"success_rate": 0.99, "p95_ms": 2500},
    inject=Fault.provider_500(rate=1.0, duration_s=60, tenant="canary"),
    abort_if=lambda m: m.success_rate < 0.95,
)
assert exp.run().user_visible_success >= 0.98
```

A fallback that returns 200 with an empty answer has passed the HTTP check and failed the experiment.

**Source:** https://principlesofchaos.org/

---

> **Ordering note:** chaos experiments must run **after** the fallback chain is instrumented (Skill 13) and **before** the chain is trusted in a release gate. Running chaos first measures observability, not resilience.

---

## 15. Token and cost accounting

### What it is
Counting input and output tokens per request, before and after the call, and converting them to money with the pinned price table for the exact model and tokenizer.

### Why it matters
Token counts are not portable. Anthropic's docs are explicit that token counting is an estimate, that counting is free but separately rate-limited, and that newer tokenizers can produce roughly 30% more tokens for the same text — meaning a cost model built on old counts silently under-budgets by a third. Cost bugs are usually accounting bugs: wrong `base_model`, uncounted tool definitions, uncounted thinking tokens, uncached prefixes.

### How to apply
- Pre-flight count with the provider endpoint for the *target* model; post-flight reconcile with the response `usage` field. Store both.
- Count everything: system prompt, tool schemas, retrieved context, images/PDFs, thinking tokens. Tool definitions are billed as input.
- Version the price table and tokenizer per model; never reuse a count across a tokenizer change.
- Track `cost_per_request` and `tokens_per_task`, not just monthly spend — monthly totals hide per-feature regressions.
- Alert on cost-per-successful-task drift, with the model ID and prompt version attached.

```python
pre = count_tokens(model=model, system=sys, tools=tools, messages=msgs)
resp = call(...)
post = resp.usage.input_tokens + resp.usage.output_tokens
usd = price(model, resp.usage)
assert abs(pre - resp.usage.input_tokens) / max(pre, 1) < 0.10
record(request_id, model, pre, post, usd, prompt_version)
```

**Source:** https://platform.claude.com/docs/en/build-with-claude/token-counting

---

## 16. Context-window budgeting

### What it is
An explicit budget for the window: reserved output, system prompt, tool schemas, retrieved context, and conversation history — with a defined policy for what happens when the budget is exceeded.

### Why it matters
Everything in the request counts toward the window: system prompt, every message, tool results, images, documents, tool definitions, and the generated output including thinking. Two failure modes are common and different: input alone over the limit returns a 400 `prompt is too long`; input plus `max_tokens` over the limit can be accepted and then stop with `model_context_window_exceeded`. And more context is not better — accuracy and recall degrade as token count grows ("context rot").

### How to apply
- Compute a budget before the call: `window - max_tokens - safety_margin`; allocate fixed shares to system/tools/history/retrieval.
- Choose an explicit overflow policy per stage: truncate oldest history, summarise, drop low-ranked retrieval, or fail fast. Never silently truncate the system prompt.
- Use pre-call checks in the router so a request is never sent to a deployment whose window is too small.
- Log `tokens_used / window` per request; alert at 80%.
- Prefer compaction/summarisation over raw growth for long agent sessions; cached prefixes still occupy the window.

```python
budget = window - max_tokens - 2_000
assert tokens(system) + tokens(tools) < budget * 0.25
context_budget = budget - tokens(system) - tokens(tools) - tokens(history)
context = fit(context, context_budget, policy="drop_lowest_ranked")
```

**Source:** https://platform.claude.com/docs/en/build-with-claude/context-windows

---

## 17. Position-aware context placement

### What it is
Measuring and compensating for the fact that models retrieve information at the beginning and end of a long context far better than in the middle.

### Why it matters
"Lost in the Middle" found performance is often highest when relevant information sits at the start or end of the input and degrades significantly in the middle — even for explicitly long-context models. If you concatenate 40 retrieved chunks and the answer is in chunk 23, you have a retrieval success and a generation failure that looks like a hallucination.

### How to apply
- Measure it on your own task: place the gold passage at positions 0%, 25%, 50%, 75%, 100% of the context and plot accuracy. Your curve is the only curve that matters.
- Put the highest-ranked evidence first and last; do not sort by source order.
- Keep the instruction and the output schema at the edges, adjacent to generation.
- Prefer fewer, better chunks over filling the window; add a reranker before adding tokens.
- Re-run the position sweep after any context-format change (XML tags, markdown headers, citation markers).

```python
for pos in [0.0, 0.25, 0.5, 0.75, 1.0]:
    ctx = place(gold, filler, position=pos)
    acc[pos] = evaluate(ask(q, ctx))
# gate: min(acc.values()) >= threshold, not mean(acc)
```

Report the worst position, not the average — the average hides the middle.

**Source:** https://arxiv.org/abs/2307.03172

---

## 18. Tool-call schema reliability

### What it is
Making tool calls mechanically valid and safely executable: strict JSON schemas, validated arguments, correct `call_id` round-tripping, bounded tool counts, and a dispatcher that rejects unknown tools.

### Why it matters
"Best effort" function calling produces plausible JSON that fails at runtime, and the failure surfaces as a retry loop or a wrong action. The tool-calling flow is a five-step protocol — define, receive call, execute, return output keyed by `call_id`, receive final answer — and every step has a failure mode. Tool definitions are injected into the prompt and billed as input tokens, so an unbounded tool surface is also a cost and accuracy problem; OpenAI recommends keeping initially available functions small (soft guidance: fewer than 20).

### How to apply
- Enable strict mode where available (`additionalProperties: false`, all properties required, optional fields as nullable unions).
- Validate arguments against the same JSON schema in your dispatcher; reject, don't coerce silently.
- Handle 0..N calls per turn; never assume exactly one. Preserve `call_id` on every output.
- Reject unknown tool names with a typed error the model can recover from, and cap turns.
- Write descriptions for a new engineer: purpose, argument format, when *not* to use it.
- Log the raw arguments and the validation verdict for every call.

```python
def dispatch(name, raw_args, call_id):
    if name not in TOOLS:
        return error(call_id, "unknown_tool", recoverable=True)
    args = TOOLS[name].schema.validate(json.loads(raw_args))   # raises on mismatch
    result = TOOLS[name].fn(**args)
    return {"type": "function_call_output", "call_id": call_id, "output": result}
```

**Source:** https://platform.openai.com/docs/guides/function-calling

---

## 19. Consumption guardrails

### What it is
Hard limits on inference consumption per user, request and time window — input size caps, rate limits, quotas, timeouts, max tool calls, budget ceilings — plus anomaly detection on usage.

### Why it matters
OWASP's LLM10 covers exactly the failure an agent operator fears: unbounded consumption leading to denial of service, service degradation, model extraction, and **denial of wallet** — where pay-per-use pricing turns a traffic spike into a financial incident. Long agent loops amplify it: one user request can become dozens of model calls, each with a growing context.

### How to apply
- Cap input size before tokenisation reaches the model; reject oversized requests explicitly rather than truncating silently.
- Enforce per-key and per-user RPM/TPM quotas, plus a per-request dollar ceiling computed from `max_tokens × price`.
- Bound agent loops: max turns, max tool calls, max wall-clock, max cumulative tokens — and fail closed.
- Add timeouts at every layer and propagate cancellation to in-flight model calls.
- Log usage per request with model and feature tags; alert on anomalous tokens/request and on spend velocity.
- Degrade gracefully (smaller model, cached answer, queued job) instead of hard-failing everything.

```python
LIMITS = {"max_input_tokens": 100_000, "max_turns": 8, "max_usd": 0.25, "timeout_s": 60}

def guarded_run(req):
    if tokens(req) > LIMITS["max_input_tokens"]:
        raise RequestTooLarge
    with deadline(LIMITS["timeout_s"]), budget(LIMITS["max_usd"]):
        return agent_loop(req, max_turns=LIMITS["max_turns"])
```

**Source:** https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/

---

## Audit order for a release gate

1. **Provenance** (2, 3) — is the eval real and re-runnable?
2. **Statistics** (4) — is the difference larger than the interval?
3. **Capability** (1, 18) — can the deployment do the job, on this endpoint?
4. **Truthfulness & grounding** (5, 6) — does it avoid confident nonsense?
5. **Injection** (8, 9, 10, 11) — what happens when data is hostile?
6. **Cost & context** (15, 16, 17, 19) — does it fit the budget and the window?
7. **Resilience** (12, 13, 14) — what happens when the provider fails?

A skill with no artifact (datasheet, raw outputs, probe JSON, experiment log) is `NOT_TESTED`, not "probably fine".

---

## Sources

All URLs below were fetched while writing this document; content was read from the fetched page, not from memory.

1. Berkeley Function Calling Leaderboard (BFCL) — https://gorilla.cs.berkeley.edu/leaderboard.html
2. Gebru et al., *Datasheets for Datasets* — https://arxiv.org/abs/1803.09010
3. EleutherAI, *Language Model Evaluation Harness* — https://github.com/EleutherAI/lm-evaluation-harness
4. Miller, *Adding Error Bars to Evals* — https://arxiv.org/abs/2411.00640
5. Ragas, *Faithfulness* — https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/
6. Lin et al., *TruthfulQA* — https://arxiv.org/abs/2109.07958
7. Zheng et al., *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* — https://arxiv.org/abs/2306.05685
8. OWASP, *LLM01:2025 Prompt Injection* — https://genai.owasp.org/llmrisk/llm01-prompt-injection/
9. Greshake et al., *Not what you've signed up for* — https://arxiv.org/abs/2302.12173
10. Willison, *The Dual LLM pattern* — https://simonwillison.net/2023/Apr/25/dual-llm-pattern/
11. Debenedetti et al., *Defeating Prompt Injections by Design* (CaMeL) — https://arxiv.org/abs/2503.18813
12. Ong et al., *RouteLLM* — https://arxiv.org/abs/2406.18665
13. LiteLLM, *Router — Load Balancing* — https://docs.litellm.ai/docs/routing
14. *Principles of Chaos Engineering* — https://principlesofchaos.org/
15. Anthropic, *Token counting* — https://platform.claude.com/docs/en/build-with-claude/token-counting
16. Anthropic, *Context windows* — https://platform.claude.com/docs/en/build-with-claude/context-windows
17. Liu et al., *Lost in the Middle* — https://arxiv.org/abs/2307.03172
18. OpenAI, *Function calling* — https://platform.openai.com/docs/guides/function-calling
19. OWASP, *LLM10:2025 Unbounded Consumption* — https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/

### Sources considered and discarded

- `https://opentelemetry.io/docs/specs/semconv/gen-ai/` — loaded, but the page is a relocation notice pointing at `open-telemetry/semantic-conventions-genai`; it contained no normative content, so it was not used as a skill source.
- `https://arxiv.org/abs/2310.08540` — loaded, but the paper is about in-context learning vs. gradient descent, not data contamination. Discarded rather than mis-cited; no contamination claim is made in this document.
