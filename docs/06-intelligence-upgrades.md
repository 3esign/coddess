# Coddess Intelligence Upgrades — Deep Dive & 2026 Playbook

> Companion to `05-reasoning-pipeline.md`. That doc closed weaknesses W1–W10 (intent,
> verify/repair, knowledge, compaction, native tools, worktrees). This one is a fresh
> audit of the shipped harness against the 2026 state of the art (Claude Code / Anthropic,
> Cursor, Cline, Roo, Codex CLI, Aider, SWE-agent) and a prioritized plan to squeeze more
> capability out of every connected model — especially local Ollama models.
>
> TL;DR: the pipeline *architecture* is now genuinely strong. The biggest remaining gains
> are not new stages — they are (1) a handful of correctness bugs silently capping local
> models, (2) verifying against the *spec* not just the *build*, (3) giving the model a real
> map of the code, and (4) an **eval harness** so prompt changes stop being guesswork.

---

## 0. Verdict

What's already good (keep it): the five-stage pipeline (Intent → Build → Verify/Repair →
learn), deterministic verification instead of the model's say-so, per-project knowledge,
compaction, model tiers, native-tool opt-in, worktree parallelism, budget accounting,
pause/inject/resume. This is ahead of most OSS "vibe coding" tools, which stop at a raw
ReAct loop.

The through-line of what's left: **the harness under-feeds and under-measures the model.**
Local models are being handed a fraction of their real context window; "done" is checked
against compilation, not requirements; the model navigates by a flat file list instead of a
map; and there is no way to know whether any prompt edit helped or hurt. Fix those four and
the same models get materially smarter.

The highest-leverage items, ranked:

| Rank | Move | Why it's #1-tier | Effort |
|------|------|------------------|--------|
| 1 | Set Ollama `num_ctx` (+ stop sequences, structured `format`) | Local models are silently truncated to ~4K ctx today; everything else is moot until fixed | S |
| 2 | Hard step cap + loop-breaker | Removes a real runaway-loop / cost-blowout risk | S |
| 3 | Verify against acceptance criteria (LLM-judge review gate) | "Builds" ≠ "meets spec"; biggest correctness lever left | M |
| 4 | Ranked repo map (tree-sitter + PageRank) | The single biggest "understanding" upgrade for non-trivial repos | M–L |
| 5 | Eval harness (folder of tasks + pass/fail) | Turns prompt work from superstition into measurement | M |

Everything below is organized as: **Part 1** current-state audit (new weaknesses W11–W22),
**Part 2** techniques worth stealing (sourced), **Part 3** prioritized roadmap, **Part 4** a
concrete system-prompt rewrite, **Part 5** the eval harness.

---

## Part 1 — Fresh audit: weaknesses W11–W22

### Critical (correctness / silently capping the model)

**W11 — Ollama `num_ctx` is never set → the context window is silently tiny.**
`provider/ollama.ts` posts to `/api/chat` with only `options: { temperature: 0.2 }`. Ollama
applies the model's *default* context (commonly 4096 tokens, sometimes 2048) unless
`num_ctx` is passed, and it truncates **silently** — it does not error. The Coddess system
prompt alone (identity + protocol + rules + spec + knowledge + file tree) is easily
1.5–3K tokens; add a few turns of history and a local model is only *seeing the tail* of the
prompt. This alone can explain a lot of "the local model ignores my rules / forgets the
spec" behavior. Worse, `COMPACT_AT=12000` can never help a model whose real window was
capped at 4096 — compaction fires far too late. **This is the highest-ROI fix in the repo.**
Set `num_ctx` explicitly (model-max where known, else a configurable floor like 16–32K),
and derive `COMPACT_AT` from it (e.g. compact at ~75% of `num_ctx`).

**W12 — No hard step cap; the loop can run away.** `loop.ts` is `for (let step = 0; ; step++)`
with no ceiling. The only backstops are `budget.enforce()` — which is a **no-op when
`maxTokens` is undefined** (`enforce()` guards on `if (this.maxTokens …)`) — and a *soft*
text warning after 3 identical actions. A model that keeps taking slightly-different useless
actions with no per-chat budget set will loop until the process dies or the API bill spikes.
Add `CODDESS_MAX_STEPS` (e.g. 60) and a stronger loop-breaker (after N repeats, force a
`<thinking>` re-plan or abort with an honest status).

**W13 — Tier detection misses most frontier model ids.** `modelProfile.ts`
`FRONTIER_PREFIXES` and the identical regex in `nativeTools.ts` recognize `claude-`,
`gemini-`, `deepseek-`, `kimi/moonshot-`, `openrouter/`, `custom/` — but **not** `gpt-`,
`openai/`, `o1/o3/o4`, `grok-`, `mistral-`, `mixtral`, `command-`, or large `qwen*/llama*`
ids used directly. A directly-configured `gpt-4o` is classified `local-small`, gets the
heaviest scaffold, and never uses native tools. (Aside: the default model `qwen2.5-coder`
with no size suffix parses to `local-small`; `…:32b` correctly becomes `local-large`.)
Broaden the classifier, and prefer classifying by **provider + advertised context length**
over string prefixes.

**W14 — No stop sequences on the action delimiters.** The prompt says "Output NOTHING after
the action," but nothing enforces it. Set `stop: ["</tool>", "</final>"]` (Ollama + OpenAI
paths). Benefits: the model can't emit a second action the parser silently drops (only the
first `<tool>` runs today), can't hallucinate a fake `<observation>`, and you stop paying for
tokens after the action. Cheap, universal reliability win.

### High impact (intelligence / methodology)

**W15 — Verification checks "builds," not "meets the spec."** `verify.ts` runs
build/typecheck/lint/test or a static HTML check. Acceptance criteria are injected into the
prompt but **nothing programmatically confirms them.** A run can pass `tsc` while silently
missing half the requested features. This is the pending "review-as-gate" from §5 of doc 05
and the biggest correctness lever left: add a fresh-context **LLM-judge** that sees the diff
+ the acceptance criteria and returns per-criterion pass/fail; feed failures back into the
repair loop.

**W16 — The Observer is still cosmetic.** `observer.ts` runs *after* `<final>`, feeds nothing
back, is off by default, and uses emoji/"elite intelligence auditor" persona language that
the rest of the prompt explicitly forbids. Repurpose it as W15's review gate (before final),
or delete it. Dead, tone-inconsistent code otherwise.

**W17 — Navigation is a flat file list + grep; there's no map.** The model gets `buildTree`
(≤200 entries) and `search_code` (regex). On anything beyond a small project it must guess
which files matter. Aider's ranked **repo map** (tree-sitter symbol graph + personalized
PageRank, emitted within a token budget) gives a whole-repo skeleton of signatures for ~1K
tokens. This is the highest-value "understanding" upgrade and disproportionately helps
small-context local models.

**W18 — `edit_file` is strict-exact; one whitespace diff = failure.** `tools.ts editFile`
does exact substring match and fails if the `old` text isn't verbatim. Aider reports
forgiving matching (normalize whitespace, relative indentation, flexible context) yields a
**~9× reduction** in apply errors, and whole-function hunks another 30–50%. Add tolerant
matching and, for weak models or after repeated misses, **auto-fall back to whole-file
rewrite** (Aider's most-reliable format for quantized/local models).

**W19 — One action per turn, always — no read batching.** Every `list_dir`/`read_file`/
`search_code` is a full model round-trip. On local models each turn is expensive; this is
death by a thousand round-trips. Doc 05 §7 proposed batching safe read-only ops; it was never
built. Let capable/frontier models emit several read-only calls in one turn (execute in
parallel), keep mutations strictly one-at-a-time for reviewability.

**W20 — JSON stages parse-by-hope instead of constrained decoding.** `intent.ts`,
`orchestrator.ts`, `knowledge.ts` all prompt for JSON and then salvage it with regex
(`extractJson`). Ollama supports **structured outputs** (`format` = JSON Schema) and
llama.cpp supports GBNF grammars — hard guarantees of well-formed output. Constrain *only*
the JSON/action object (not the free-text reasoning — wrapping reasoning in a schema measurably
hurts, per "Let Me Speak Freely?"). Eliminates a class of silent Stage-0 failures on weak
models.

### Medium (structure, tone, product)

**W21 — The build prompt is monolithic and over-fit to physics/games.** `systemPrompt.ts`
hard-codes heavy guidance about collisions, coordinate math, state machines, WebGL/THREE.js,
importmaps, and Windows `cmd.exe` into *every* task. For "build me a landing page" or a CRUD
API this is irrelevant context bloat (and context is the scarce resource, especially after
W11). Split into a lean core prompt + **conditionally-injected** stack packs (only add the
WebGL block when the task/stack is 3D, the Windows block on win32, etc.). The physics-heavy
reasoning scaffold reads like it was tuned on the `Tests/` game demos — good for those,
miscalibrated for general app building.

**W22 — Fixed temperature 0.2 for every call, no per-stage/per-tier sampling; no few-shot.**
0.2 is a fine *acting* temperature, but intent/planning can benefit from a touch more
diversity, and edits should arguably be 0.0. There is also no gold **trajectory example** in
the prompt — small models pattern-match format from a worked example far better than from
prose rules. Add one short end-to-end example of the exact XML protocol.

---

## Part 2 — Techniques worth stealing (2026, sourced)

### From Anthropic / Claude Code / Amp

- **Externalize the plan into a *structured* file, not just prose `PLAN.md`.** The
  long-running-agent harness writes a JSON feature list (`{id, desc, passes:false}`) plus a
  progress file; the loop only flips `passes`. Survives compaction and fresh windows; the
  agent can't "forget" scope. Coddess has `PLAN.md` + a plan monitor already — upgrade the
  checklist to structured state mapped to acceptance criteria.
- **Persist to finish + verify, but bound scope.** Codex/Gemini prompts say "keep going until
  fully resolved." Claude Code deliberately balances that with "don't add what wasn't asked."
  The right combo for Coddess: persist on *finishing and verifying the stated task*, explicit
  anti-scope-creep (you already have "FOCUS ON ESSENTIALS" — good).
- **Adversarial review in a *fresh* sub-agent.** A reviewer that sees only the diff +
  criteria (not the reasoning that produced them) grades honestly and catches gaps. → W15.
- **Sub-agents for read-heavy exploration ("search is compression").** Spawn an isolated-
  context agent to explore/answer a bounded question and return only a summary. Keeps the main
  context clean. Coddess orchestrates at the *task* level but has no in-task read sub-agent.
- **Tool-result hygiene:** cap tool output tokens, prefer semantic names over UUIDs, and
  **prompt-engineer errors into actionable nudges** with a corrected example — not raw stack
  traces. Coddess's observation format is decent; make error observations teach the fix.
- **Measure on ~20 real tasks; early prompt tweaks swing 30%→80%** and are visible on tiny
  samples. → Part 5.

### From Cursor / Cline / Roo / Codex / Aider

- **Ranked repo map (tree-sitter + PageRank), ~1K-token budget.** → W17. Highest-leverage
  borrow for local models.
- **Content-anchored search/replace + whole-file fallback; never line numbers.** Models are
  terrible at line numbers (often one token, guessed in one pass). Match by content. → W18.
- **Forgiving patcher with feedback-loop:** on a SEARCH miss, retry whitespace/indent-
  insensitive before failing, then return "closest lines were…" so the model self-corrects;
  cap at ~3 retries. Cursor escalates a bad diff to a smarter "reapply" model.
- **Plan vs Act separation with different tool allowlists.** Cline Plan mode can read/search
  but not edit/run; Roo has per-mode prompts (Architect/Code/Debug); Codex gates edits and
  shell separately (suggest / auto-edit / full-auto). Removing edit tools during planning
  stops premature botched changes. → optional mode system.
- **Section the prompt with tags** (`<communication>`, `<tool_calling>`, `<making_changes>`) —
  tagged sections stop mid-prompt rules being "forgotten," which matters most for small models.
- **Per-model-family prompt variants** with snapshot tests (Cline ships distinct Claude / GPT /
  generic / local-"devstral" variants). Coddess has tiers; give them *real* prompt variants,
  not just boolean knobs. → W22 + Part 4.
- **A forced one-sentence `explanation` arg on every tool call** — cheap forced reasoning that
  improves tool selection and doubles as user-facing narration.
- **Don't cargo-cult emotional hacks.** Aider *measured* "you'll be tipped $2000 / user has no
  hands" making results **worse**. Keep the prompt technical.
- **Layered instruction file:** support `AGENTS.md` (the emerging cross-tool standard) in
  addition to `CODDESS_RULES.md`.

### From SWE-agent / mini-swe-agent / local-model research

- **The Agent-Computer Interface (ACI) lifts a *fixed* model more than swapping models.**
  SWE-agent improved results with interface design alone: reject syntactically-invalid edits
  *before* applying (lint gate), a paginated ~100-line file viewer instead of `cat`, search
  that returns only matching filenames, and an explicit "ran successfully, produced no output"
  message. Mirror all of these.
- **Tiny action space wins.** mini-swe-agent hits >74% on SWE-bench Verified with essentially
  one tool and linear history. Fewer verbs = fewer ways to malform. Coddess's 8 tools are
  fine, but resist growth and lean on the smallest set that works per tier.
- **Constrain the action, not the reasoning; low temp for acting.** → W20, W22. DeepSeek
  officially recommends temp 0.0 for code; reserve higher temp only for pass@k sampling.
- **Observation masking beats summarization for context.** The "Complexity Trap" study: simply
  replacing *old* tool outputs/file dumps with placeholders (keeping all reasoning + actions)
  matched/beat LLM summarization — **+2.6% solve, −52% cost** — because summarizing hides
  natural stopping signals. Cheaper and better than Coddess's summarize-compaction; keep
  summarization as a fallback for genuinely complex state. → W11 interplay.
- **Native tool-calling only where the model was trained for it;** always keep the tolerant
  parser + one auto-"reformat" retry, since one malformed call kills the chain. Coder models
  like Qwen2.5-Coder-32B (no Ollama Tools badge) do better driven by the XML protocol — which
  is exactly Coddess's default. Good instinct; make the native/XML choice tier-driven, not one
  global flag.
- **2026 local model picks** (rank by tool-call reliability, keep fully in VRAM): Qwen3 8B
  (default), Qwen3 30B-A3B MoE (24 GB sweet spot), Qwen2.5-Coder-32B (drive via XML),
  **Devstral Small 2 24B** (agentic-tuned, 68% SWE-bench Verified, 256K ctx, Apache-2.0 —
  strongly worth featuring as the recommended local driver).

---

## Part 3 — Prioritized roadmap

| Pri | Item | Weakness | Impact | Effort |
|-----|------|----------|--------|--------|
| **P0** | Set Ollama `num_ctx`; derive `COMPACT_AT` from it | W11 | ★★★ | S |
| **P0** | `stop` sequences on `</tool>`/`</final>` | W14 | ★★ | S |
| **P0** | Hard `MAX_STEPS` cap + real loop-breaker | W12 | ★★ | S |
| **P0** | Fix tier detection (gpt/o-series/grok/mistral/qwen/llama; classify by provider+ctx) | W13 | ★★ | S |
| **P1** | Acceptance-criteria review gate (fresh-context LLM judge → repair) | W15/W16 | ★★★ | M |
| **P1** | Ranked repo map (tree-sitter + PageRank, token-budgeted) | W17 | ★★★ | M–L |
| **P1** | Forgiving edit matching + whole-file fallback | W18 | ★★ | S–M |
| **P1** | **Eval harness** (Part 5) | methodology | ★★★ | M |
| **P1** | Structured `format`/grammar on JSON stages | W20 | ★★ | S–M |
| **P2** | Read-only action batching (tier-gated) | W19 | ★★ | M |
| **P2** | Observation masking for context (keep summarize as fallback) | W11 | ★★ | M |
| **P2** | Split prompt: lean core + conditional stack packs + gold trajectory | W21/W22 | ★★ | M |
| **P2** | Per-tier prompt variants w/ snapshot tests | W22 | ★ | M |
| **P3** | Plan/Act mode separation; in-task read sub-agents; `AGENTS.md` support | — | ★ | M–L |

Do all four **P0** items first — they're a day's work combined and unblock every model.
Then **P1** in the order above, each validated through the eval harness (build the harness
early — ideally right after P0 — so P1 changes are measured, not guessed).

---

## Part 4 — Concrete system-prompt rewrite

The current `buildSystemPrompt` is solid but monolithic. Below is a **lean core** you can drop
in, with the game/physics/WebGL/Windows material moved to conditional packs, a persistence-
and-verification section, a hard iteration rule, and (for local tiers) a gold trajectory
example. Keep your existing spec/knowledge/context blocks; this replaces the identity → rules
body.

```text
You are Coddess, an autonomous software-building agent working INSIDE a real project folder
on the user's machine. You build complete, working software and you finish what you start.

<environment>
- Project: {projectName}   Root: {projectPath}   OS: {os}
- All paths are RELATIVE to the project root. You cannot touch anything outside it.
</environment>

{specBlock}          # 🎯 target spec + acceptance criteria (authoritative)
{knowledgeBlock}     # project knowledge from prior runs
{contextBlock}       # linked read-only folders
{repoMap}            # NEW: ranked signatures of the codebase (see Part 1 W17)

<how_you_work>
You operate in a loop: output exactly ONE action, then STOP and wait for its real result.
Never invent results. Never emit two actions — only the first is executed.

Before an action, think in a <thinking> block. On your FIRST turn, structure it:
  PLAN: the sub-tasks that satisfy each acceptance criterion.
  APPROACH: files you'll create/change and in what order.
  RISKS: edge cases and what commonly breaks here.
  VERIFY: the exact command or check that proves each criterion.
On later turns keep <thinking> to one or two lines. Think in data structures and concrete
steps, not prose.
</how_you_work>

<actions>
  # one of these exact XML forms per turn — see the tool list injected below
  <tool name="...">...<arg .../></tool>
  <final>what you built, how to run it, and each acceptance criterion confirmed</final>
</actions>

<rules>
- FIND, DON'T GUESS. Use the repo map + search_code + read_file to locate code before editing.
  Never edit a file you have not read this session.
- PREFER edit_file for targeted changes; write_file for new files or full rewrites. write_file
  writes the ENTIRE file — never partial, never "// unchanged".
- NO PLACEHOLDERS. No stubs, no "TODO / rest of code here". Every file runs as written.
- PLAN.md: keep a checklist mapped to the acceptance criteria; check items off as you go.
- PERSIST, THEN STOP. Keep going until every acceptance criterion is met and verified — do
  not hand back a half-finished task. But do NOT add features, files, or polish that were not
  asked for. When the criteria hold and the code runs, emit <final>. Don't loop polishing.
- VERIFY BEFORE <final>. If there's a build/test/run command, run it and fix failures first.
  Otherwise re-read the key files and confirm each criterion. "Done" means verified, not hoped.
- DON'T REPEAT YOURSELF. If the same action fails twice, change approach — inspect other files
  or reconsider assumptions. Never repeat an identical failing action.
- FOCUS, NO FLUFF. No emojis, ASCII art, hype, self-congratulation, or restating the obvious.
  Terse, technical output only.
- Be autonomous: don't ask the user questions; make reasonable choices and state them in
  <final>.
</rules>

{stackPacks}   # conditionally injected: WebGL/THREE, Windows-shell, mobile, etc. — ONLY when relevant
{budgetBlock}  # remaining-token guidance + CODDESS_STATUS.md fallback
{trajectoryExample}  # local tiers only: ONE short worked example of the exact protocol
```

Key deltas vs. today, and why:

1. **`{repoMap}` slot** — the model navigates by signatures, not a blind file list (W17).
2. **Reasoning scaffold de-physics-ified** — PLAN/APPROACH/RISKS/VERIFY is general; the
   physics/collision/TDD guidance moves into a stack pack injected only for game/simulation
   tasks (W21). Same words, shown only when relevant.
3. **PERSIST-THEN-STOP** — explicit "finish + verify" bounded by explicit "no scope creep"
   (Claude Code's balance), replacing the softer current wording (W15-adjacent).
4. **Tagged sections** — `<environment>`/`<rules>`/… so small models don't lose mid-prompt
   rules (Cursor/Cline finding, W21).
5. **Conditional stack packs** keep the *common* prompt small; context is scarce, doubly so
   after fixing `num_ctx` reveals how much you were losing (W11/W21).
6. **`{trajectoryExample}` for local tiers** — one gold XML round-trip; pattern-matching beats
   prose for weak models (W22).

Wire it to tiers: `frontier` → drop the trajectory example and heavy scaffold, allow native
tools + read batching; `local-large` → medium scaffold; `local-small` → full scaffold +
trajectory + small-steps + whole-file-edit bias.

---

## Part 5 — The methodology keystone: an eval harness

Right now every change to the prompt/pipeline is "verified structurally (typecheck + unit
tests) but NOT against a live model" (per the project notes). That means capability changes
are *guesses*. The single most valuable methodology upgrade is a small, fast, local eval loop
so you can see whether an edit helped.

**Shape (copy terminal-bench):** a task is a folder.

```
evals/
  tasks/
    landing-page/         prompt.md   seed/(optional)   check.sh (or check.mjs)
    todo-api-crud/        prompt.md   seed/             check.sh
    fix-null-deref/       prompt.md   seed/             check.sh
    canvas-bounce/        prompt.md   seed/             check.sh
  run.mjs                 # runs each task against a model, scores it, writes results.json
  baseline.json           # last known-good scores; CI fails on regression
```

**Loop:** for each task → copy `seed/` into a temp dir → run `runAgent` headless against the
target model → run `check` (its exit code is pass/fail) → record `{pass, steps, tokens,
wellFormedActionRate, wallMs}`.

**Metrics that matter:**
- **pass@1** (reliability) and, on a nightly run, **pass@k** with the unbiased estimator
  (sample n≥k at temp ~0.7) to separate skill from luck.
- **well-formed-action rate** — the fraction of turns that parsed to a valid action. This is
  *the* direct measure of your XML protocol's health; Aider tracks the analogous
  "well-formed edits." A prompt change that lifts pass-rate but tanks this is a warning.
- **tokens & steps per task** — catches prompts that pass but ramble (cost/latency).

**Discipline:**
- 20–50 tiny tasks (<30s each) covering your real surface: static site, web app, CRUD API,
  bug-fix-in-existing-repo, refactor, and one game/canvas task. Deterministic (temp 0) for the
  fast gate.
- **Regression-gate every prompt/protocol edit** against `baseline.json`; fail on a pass-rate
  or well-formed-rate drop. This is what makes prompt engineering safe instead of superstitious.
- **LLM-as-judge only for fuzzy spec-adherence tasks** (no unit test possible), and guard it:
  use a *different, stronger* model as judge, force a structured rubric, randomize order, and
  keep it strictly secondary to the programmatic checks. Never let the model judge its own
  output.
- Local inference is $0 marginal — the cost is wall-clock/VRAM. Warm Ollama, one resident
  model, bounded worker pool. Reserve pass@k + judge for nightly.

Bonus: your existing `verify.ts` already knows how to detect and run a project's check — the
eval harness can reuse it as the per-task `check` for Node projects, so you're ~half-built.

---

## Appendix — quick-win checklist (P0, ~a day)

1. `ollama.ts`: add `options.num_ctx` (configurable `CODDESS_NUM_CTX`, default e.g. 16384;
   pass model-max when known) and `options.stop: ["</tool>","</final>"]`; set the same `stop`
   on the OpenAI-compatible paths. Recompute `COMPACT_AT` as ~0.75 × `num_ctx`.
2. `loop.ts`: `for (let step = 0; step < MAX_STEPS; step++)` with `CODDESS_MAX_STEPS` (default
   60); on the 3rd identical action, inject a forced re-plan and, after ~5, abort with an
   honest `CODDESS_STATUS.md` + `error` status instead of looping.
3. `modelProfile.ts` + `nativeTools.ts`: extend the frontier matcher (`gpt-`, `openai/`,
   `o1`/`o3`/`o4`, `grok-`, `mistral-`, `mixtral`, `command-`, large `qwen*`/`llama*`); share
   one predicate between both files; prefer provider+context-length over prefix strings.
4. `observer.ts`: either wire it in as the W15 review gate (before `<final>`) or remove it and
   its emoji/persona strings.
5. `intent.ts` / `orchestrator.ts` / `knowledge.ts`: pass Ollama `format` (JSON Schema) for
   the structured stages; keep the tolerant parser as fallback.

Sources: Anthropic engineering (building-effective-agents, writing-tools-for-agents,
effective-harnesses-for-long-running-agents, multi-agent-research-system, claude-code best
practices); Aider (edit-formats, unified-diffs, repomap, edit-errors, leaderboards); Cursor
(instant-apply) & analyses; Cline docs (plan-and-act, system prompts); Roo Code; OpenAI Codex
(agents-md, approvals); SWE-agent ACI + mini-swe-agent; Ollama structured outputs; llama.cpp
GBNF; "Let Me Speak Freely?" (arXiv 2408.02442); "Complexity Trap" observation-masking (arXiv
2508.21433); DeepSeek parameter guidance; SWE-bench Verified; terminal-bench; pass@k estimator
(arXiv 2107.03374); LLM-judge bias (arXiv 2410.21819).

---

## Part 7 — Implemented in this pass (2026-07-14)

Shipped via the file tools. NOTE: run `npm run typecheck && npm test` on the host — the
sandbox mount could not run the compiler reliably (see infra note below), so these landed
with careful manual type review, not an automated green build.

P0 correctness
- **num_ctx** — `providerRouter.streamOllama` and `provider/ollama.ts` now send
  `options.num_ctx` (config `NUM_CTX`, default 16384; env `CODDESS_NUM_CTX`). `COMPACT_AT`
  now derives from it (~0.75×). Fixes W11 — the silent local-context cap.
- **Step cap + loop-breaker** — `loop.ts` bounds the ReAct loop by `MAX_STEPS` (default 60;
  `CODDESS_MAX_STEPS`); a repeated identical action aborts at 6. Both write `CODDESS_STATUS.md`
  and end with an honest status. Fixes W12.
- **Tier detection** — `modelProfile.ts` broadened; `isFrontierModel` is now the single
  predicate shared with `nativeTools.ts`, kept aligned to actually-hosted providers (so local
  families like `mistral`/`devstral` are not misrouted); local tier uses size (≥14B → large)
  plus strong-coder-family heuristics. Fixes W13.
- **Provider plumbing** — `chatStream` takes optional `ChatOptions {stop, format, numCtx}`;
  `stop` threads to Ollama/OpenAI/Anthropic, `format` to Ollama. Stop sequences are supported
  but left OFF on the build turn (a `</tool>` stop would strip the closer and risk truncating
  file content); the parser change below is the safe half of W14.

Initial plan development (the core request)
- `intent.ts` now emits an ordered `plan[]` (title / detail / verify) alongside the spec,
  guided by a two-phase UNDERSTAND → PLAN prompt, and requests JSON via Ollama structured
  output (`format:'json'`). Addresses Stage-0 of W20.
- `specToPromptBlock` rewritten: clean, no emojis / ASCII banners, consistent with the harness
  tone (addresses the "goal formatting" complaint); adds an ordered "Build plan" section.
- `loop.ts` seeds `PLAN.md` from the approved plan on a fresh run (`specToPlanFile`) so the
  plan monitor starts populated; the system prompt now says to read/refine the seeded plan.

Reliability
- `protocol.ts` `parseAction` tolerates unclosed `<tool>` / `<final>` / `<arg>` (forgotten
  closers are a common weak-model failure). Safe half of W14.
- `edit_file` (`tools.ts`) gains a whitespace/indentation-tolerant fallback and near-match
  hints when the exact match misses — the #1 cause of failed edits on weak models. Fixes W18.

Tests: `modelProfile.test.ts` (new); `protocol` (unclosed tags), `tools` (fuzzy edit), and
`intent` (plan parse + no-emoji block) extended; the old intent test updated to the new format.

Still open (recommended next pass, per Part 3): acceptance-criteria review gate (W15), ranked
repo map (W17), the eval harness (Part 5), read batching (W19), observation masking (W11).

Infra note: the sandbox Linux mount serves stale/truncated copies of some Windows-written
source files, so `bash`/`grep`/`tsc` there are unreliable; the file tools are the source of
truth. Verify on the host.

---

## Part 8 — Second pass shipped (2026-07-14): the three big levers

All three items flagged "still open" in Part 3 are now built (run `npm run typecheck && npm test`
and `npm run eval` on the host — same mount caveat).

**Ranked repo map (W17).** `repoMap.ts` — dependency-free symbol extraction
(ts/js/py/go/rust/java/ruby/php/c/c#) ranked by identifier fan-in (how many files reference each
symbol) plus entry-file and prompt-hint boosts, emitted within `REPOMAP_TOKENS` (default 1000).
Injected as "# Repository map" ahead of the flat tree; skipped under `REPOMAP_MIN_FILES`
(default 8). Flag `CODDESS_REPOMAP`. Tree-sitter stays a future precision upgrade; this captures
most of the value with zero native deps (important for easy local install).

**Acceptance-criteria review gate (W15).** `review.ts` — a fresh-context LLM judge grades the
built code against each acceptance criterion and returns per-criterion met/unmet. Wired into loop
Stage 3b: after build-verify passes and before honoring `<final>`, unmet criteria feed back as a
repair round, bounded by `MAX_REVIEW` (default 2). New `review` event rendered in the UI. **Fails
open** — never blocks a build that passed verification if the judge itself errors. Flag
`CODDESS_REVIEW`. This is the "verify meaning, not just compilation" gate.

**Eval harness (Part 5).** `evals/` — folder-of-tasks (`prompt.md` + `check.mjs` + optional
`seed/`) and a `run.ts` driver that runs the real agent loop per task in a temp dir and scores
pass@1 plus tool-call count, approx output tokens, and wall time; compares to `baseline.json` and
exits non-zero on regression. `npm run eval` (needs a live model). Three starter tasks:
static-landing, js-fizzbuzz, bugfix-sum. This is the instrument that makes every future prompt
change measurable rather than guessed.

New config: `REVIEW`, `MAX_REVIEW`, `REPOMAP`, `REPOMAP_TOKENS`, `REPOMAP_MIN_FILES`. New shared
event: `review`. Tests added: `repoMap.test.ts`, `review.test.ts`.

Pipeline now: **Intent → Plan (seeded) → Build (spec + knowledge + repo map, tier-adaptive) →
Verify/Repair → Acceptance-review/Repair → learn**, with an eval harness to measure the whole
thing. Remaining nice-to-haves from Part 3: read-only action batching (W19) and observation
masking (W11).
