# Coddess Reasoning & Intelligence Pipeline — Analysis & Upgrade Design

> Goal: maximize the capability Coddess extracts from *any* connected model —
> from a 7B local Ollama model to a frontier API model — when turning a prompt
> (even a vague one) into working software. This doc traces the current pipeline,
> diagnoses where intelligence leaks out, and specifies a staged redesign.

---

## 1. The pipeline today (as-is)

A single trace, from keystroke to code:

1. **Prompt intake.** User types free text in a chat and picks a label
   (Feature / Bug Fix / …). The client prepends `[TASK: LABEL]` and sends a WS
   `run` message. That's the entire "understanding" step — the raw string goes
   straight to the model.
2. **System prompt assembly** (`systemPrompt.ts`): identity, environment, a flat
   file listing (≤200 entries), the strict one-action XML protocol, a list of
   rules, an optional token-budget section, and a quality bar. Concurrency
   warnings and `CODDESS_RULES.md` are appended.
3. **ReAct loop** (`loop.ts`): the model streams one action — an optional
   `<thinking>` block plus exactly one `<tool>` or `<final>`. `protocol.ts`
   regex-parses it, the tool runs, the result is fed back as an `<observation>`,
   and the loop repeats until `<final>` or the 40-step cap.
4. **Tools** (`tools.ts`): `list_dir`, `read_file`, `write_file`, `edit_file`,
   `run`. All scoped to the project root.
5. **Termination.** The model itself decides it is done by emitting `<final>`.
   An optional post-run "Observer" critique may run (off by default).

The engine is solid mechanically (streaming, pause/resume, persistence). The
*intelligence* layer — how we help the model think, understand, and self-correct
— is thin. Everything rides on one system prompt and the model's first-try
guess.

---

## 2. Where intelligence leaks out

| # | Weakness | Symptom | Root cause |
|---|----------|---------|------------|
| W1 | **No intent step.** Vague prompts go straight into execution. | Model builds the wrong thing confidently. | Prompt is never transformed into a spec; rules literally say "don't ask, assume." |
| W2 | **Unstructured, optional reasoning.** `<thinking>` is free-text and skippable. | Weak/local models jump to code with no plan; brittle logic. | No enforced reasoning scaffold (decompose → plan → risks → verify). |
| W3 | **No verification/repair loop.** "Make it run" is a soft rule; `<final>` is the model's opinion. | Ships code that doesn't build/run; no self-correction from real errors. | Termination isn't tied to any executed check or acceptance criteria. |
| W4 | **No definition of done.** Nothing to verify against. | "Done" is subjective; missing requirements go unnoticed. | Intent never becomes checkable acceptance criteria. |
| W5 | **Blind codebase navigation.** Only `list_dir` + `read_file`; no search. | Model reads the wrong files or misses where a symbol lives. | No `search_code`/grep; the model guesses file locations. |
| W6 | **Naive context growth.** Full transcript resent every turn; budget abort is the only limit. | Long tasks hit the budget and die mid-build. | No compaction/summarization, no relevant-file retrieval. |
| W7 | **One-size prompt.** Identical scaffolding for a 7B model and Claude. | Frontier models are over-constrained; small models are under-supported. | No model-capability profile driving scaffolding depth. |
| W8 | **No cross-run memory.** Each chat is isolated; only `PLAN.md` persists. | Conventions/decisions/pitfalls relearned every time. | No project knowledge base fed back into the prompt. |
| W9 | **Cosmetic reviewer.** The Observer critique runs *after* the end and feeds nothing back. | Insight arrives too late to change the output. | Review isn't a gate; it doesn't loop into repair. |
| W10 | **Serial, brittle protocol.** One regex-parsed action per turn. | Many round-trips; parse misfires on complex content. | Text protocol with no batching of safe reads, no native tool-calling path. |

The through-line: **the system executes before it understands, and stops before
it verifies.** Those are the two highest-value gaps.

---

## 3. Target pipeline (to-be)

Turn the single ReAct loop into an explicit five-stage pipeline. Each stage is
cheap, inspectable, and skippable when the model/task doesn't need it.

```
             ┌──────────────────────────────────────────────────────────────┐
  raw prompt │  0. INTENT      1. PLAN        2. BUILD       3. VERIFY/REPAIR │  4. REVIEW
  ──────────▶│  ──────────▶    ──────────▶    ──────────▶    ──────────▶      │ ──────────▶ done
             │  spec +         ordered        ReAct loop     run build/tests  │  diff vs
             │  assumptions    steps +        w/ search &    parse errors →   │  spec &
             │  + acceptance   file plan      scaffolded     repair (bounded) │  criteria
             │  criteria                      reasoning      until green      │  gate
             └──────────────────────────────────────────────────────────────┘
                    ▲                                             │
                    └──────────── project knowledge base ─────────┘  (read at 0, updated at 4)
```

- **Stage 0 — Intent compiler (NEW).** One cheap call transforms the raw prompt
  + repo snapshot into a structured **spec**: restated goal, explicit
  assumptions, chosen stack, file plan, and **acceptance criteria**. This is how
  we "understand intent even when the prompt is unclear" — gaps are filled with
  sensible defaults *and surfaced*, so the user (or the next stage) sees exactly
  what will be built. Low-confidence points become 1–3 assumptions shown in the
  UI; the run proceeds without blocking (optional confirm mode later).
- **Stage 1 — Plan.** The spec becomes an ordered, checkable plan (steps → target
  files → how each is verified). Persisted as `PLAN.md` *and* structured state.
- **Stage 2 — Build.** The existing ReAct loop, now anchored to the approved
  spec, with a **reasoning scaffold** and a `search_code` tool.
- **Stage 3 — Verify/Repair (NEW — biggest correctness lever).** Before "done",
  run the project's build/test/lint (via the `run` tool). Parse failures, feed
  them back, and repair in a bounded loop. `<final>` is only honored once
  acceptance criteria are satisfied (or the budget/iteration cap is hit, with an
  honest status).
- **Stage 4 — Review & learn.** Self-review the diff against the spec; update the
  project knowledge base with new conventions/decisions/pitfalls.

---

## 4. Components to ADD

- **Intent compiler** (`intent.ts`): prompt → `Spec { goal, assumptions[], stack,
  files[], acceptanceCriteria[], openQuestions[] }`. Emits a `spec` event the UI
  renders as a card. Cheap, single call, model-adaptive verbosity.
- **Acceptance criteria** threaded through the whole run and used as the
  definition of done in Stage 3.
- **`search_code` tool**: grep across the project (regex, file-glob filter) so the
  model locates symbols instead of guessing.
- **Verify/Repair controller**: derive or accept a verify command; on `<final>`,
  ensure verification happened; on failure, loop with parsed errors (bounded).
- **Reasoning scaffold**: a compact required structure inside `<thinking>`
  (Decompose → Approach → Risks/Edge cases → Verification), scaled by model tier.
- **Context manager**: compaction of old turns (summarize tool spam), plus
  relevant-file retrieval so long tasks don't blow the budget.
- **Project knowledge base** (`.coddess/knowledge.md`): conventions, architecture
  decisions, known pitfalls — injected into the system prompt, updated at Stage 4.
- **Model-capability profiles**: map a model id → tier (`local-small`,
  `local-large`, `frontier`) → scaffolding depth, sampling, and whether to use
  native tool-calling.

## 5. Components to REMOVE / change

- **Post-run Observer critique (as-is)** → repurpose into the Stage-4 review that
  *gates* the final and feeds Stage 3, instead of a cosmetic trailing message.
- **"Never ask the user anything"** → soften to a single, optional, non-blocking
  intent confirmation for ambiguous prompts (assumptions surfaced up front).
- **Unbounded transcript** → replace with context compaction + retrieval.
- **Pure full-file `write_file` habit** → keep pushing `edit_file` + `search_code`
  for targeted changes (cheaper, cleaner diffs, better for weak models' budgets).

---

## 6. Model-capability adaptation ("shine on local")

One prompt cannot be optimal for a 7B model and Claude. Introduce a tier:

- **local-small (≤ ~8B):** maximum structure. Mandatory reasoning scaffold,
  smaller steps, `edit_file` strongly preferred, more explicit examples, tighter
  file plan. Intent + acceptance criteria matter *most* here — small models drift
  without a north star.
- **local-large (~14–70B):** moderate scaffold, trust planning more.
- **frontier (API):** lean scaffold, allow native tool-calling and safe batching,
  fewer guardrails, let the model reason freely.

The tier is derived from the model id/provider and drives `systemPrompt` knobs.
This is the concrete answer to "maximize the power of AI models" across the board:
*give each model exactly the amount of scaffolding it needs and no more.*

---

## 7. Protocol upgrades

- Keep the XML action protocol as the **universal fallback** (any Ollama model
  works). For providers with real tool-calling (Anthropic/OpenAI/Gemini), add a
  **native tool-calling path** — more reliable parsing, structured args, and
  parallel read-only calls. Hybrid, tier-driven.
- Allow **batching of safe read-only ops** (list/read/search) in one turn to cut
  round-trips; keep mutations one-at-a-time for reviewability.

---

## 8. Prioritized roadmap

| Pri | Upgrade | Impact | Effort | Why now |
|-----|---------|--------|--------|---------|
| **P0** | Intent/Spec stage + acceptance criteria | ★★★ | M | Fixes "understand vague intent" and gives Stage 3 a target. |
| **P0** | `search_code` tool | ★★ | S | Cheap, immediately improves navigation for every model. |
| **P0** | Reasoning scaffold (model-adaptive) | ★★ | S | Direct reasoning quality lift, biggest on local models. |
| **P1** | Verify/Repair loop | ★★★ | M–L | Largest correctness lever; needs live-model tuning. |
| **P1** | Model-capability profiles | ★★ | M | Unlocks "shine on local" + "trust frontier". |
| **P1** | Project knowledge base | ★★ | M | Compounding gains across runs. |
| **P2** | Context compaction + retrieval | ★★ | L | Enables large/long projects. |
| **P2** | Native tool-calling (hybrid) | ★★ | L | Reliability + speed on API models. |
| **P2** | Review-as-gate (repurpose Observer) | ★ | M | Quality gate feeding repair. |

## 9. Being built in this pass (P0)

1. **Intent/Spec pre-flight stage** — `intent.ts`, wired before the build loop,
   with a `spec` event + UI card and acceptance criteria carried into the run.
2. **`search_code` tool** — grep across the project, with tests.
3. **Model-adaptive reasoning scaffold** in the system prompt, anchored to the
   approved spec, plus a **verify-before-final** gate against acceptance criteria.

P1/P2 (verify/repair automation, capability profiles, knowledge base, context
compaction, native tool-calling) are specified above and staged next.

---

## 10. Update — Verify/Repair loop shipped (P1)

Stage 3 is now implemented (`verify.ts` + loop integration):

- On `<final>`, the harness runs verification deterministically rather than
  trusting the model's say-so. Strategy is auto-detected: a Node project's
  `build` / `typecheck` / `test` script (or a `.coddess/verify.cmd` override) is
  run via the shell; a no-build project falls back to a **static check** that the
  HTML entry exists and its local asset references resolve.
- On failure, the parsed output is fed back and the agent continues, bounded by
  `CODDESS_MAX_REPAIRS` (default 3). Each attempt emits a `verify` event the UI
  renders (green pass / amber repairing).
- Flags: `CODDESS_VERIFY=0` disables; command verification only runs when the
  shell tool is enabled. Static verification always runs.

Remaining P1/P2 (unchanged): project knowledge base, context compaction +
retrieval, native tool-calling, review-as-gate.

---

## 11. Update — Project knowledge base shipped (P1)

The cross-cutting knowledge base from §4 is now implemented (`knowledge.ts`):

- **Store**: `.coddess/knowledge.json` (canonical) + a rendered, human-editable
  `.coddess/knowledge.md`, holding durable facts in four buckets — conventions,
  architecture, pitfalls, commands.
- **Read**: injected into every run's system prompt as "# Project knowledge
  (learned from previous runs)", so the agent stops relearning the same things.
- **Update**: after a run finishes `done`, a cheap distiller call extracts NEW
  durable facts from the transcript; merging is deterministic (trim, dedup
  case-insensitively, cap 20/bucket) so the model can't erase what's known. A
  brief "📚 Learned N new project fact(s)" note appears in the log.
- **Flag**: `CODDESS_KNOWLEDGE=0` disables read + update.

Pipeline now: Intent → Build (spec + knowledge-anchored, model-adaptive) →
Verify/Repair, with knowledge compounding across runs. Remaining P2: context
compaction/retrieval for long tasks, native tool-calling, review-as-gate,
worktree-backed parallel tasks.

---

## 12. Update — Orchestration + capability changes

- **Autonomous orchestrator** (orchestrator.ts): a high-level goal is decomposed
  into an ordered set of subtasks (architectural intelligence) and executed
  automatically through the awaitable `runAgent`, in one chat so context carries
  forward. This replaces the manual kanban with a plan-and-execute "Auto-build".
- **Automatic task classification**: the intent stage now labels the task; the
  manual selector is gone.
- **Git is an internal agent capability** (`git` tool) rather than a UI panel —
  the agent connects, commits, pushes, tracks, and clones GitHub repos on demand
  via natural language, using the user's existing credentials.
- **Model menu is user-managed** (add custom/OpenRouter models, hide/restore any).

---

## 13. Update — Context compaction shipped (P2)

The context-management item from §4 is implemented (`compaction.ts`). When the
message history for a run crosses `CODDESS_COMPACT_AT` tokens (default 12000),
the older turns are summarized into a compact, authoritative synopsis (system
prompt + the last `CODDESS_COMPACT_KEEP` turns are kept verbatim), so long tasks
continue instead of failing on the context window. Summarization is one cheap
model call, with a drop-oldest fallback. `CODDESS_COMPACTION=0` disables it.

Remaining P2: native tool-calling for API providers (hybrid with the XML
fallback); orchestrator subtasks in parallel git worktrees.

---

## 14. Update — Native tool-calling + parallel worktrees (P2)

- **Native tool-calling** (nativeTools.ts): provider-native structured tool calls
  for frontier providers (OpenAI + Anthropic formats, with a `finish` tool),
  behind `CODDESS_NATIVE_TOOLS=1`. The XML protocol remains the universal default
  and the Ollama path, so this is additive and cannot regress the working loop.
- **Parallel orchestration** (`CODDESS_ORCH_PARALLEL=1`): orchestrator subtasks
  run in isolated git worktrees/branches concurrently (bounded), then merge back;
  conflicts are surfaced for review. Sequential stays the default.

This closes the P2 roadmap. Both are opt-in and want live-model/API smoke testing.
