# OSCode Development Diary

A chronological record of design decisions, implementation steps, and feature additions for the OSCode Mission Control builder platform.

---

## 2026-07-13 05:47 UTC | Initial Local Setup
- **Action**: Installed packages and launched the local dev environment.
- **Details**: Ran `npm install` followed by `npm run dev` in the workspace root.
- **Result**: Server listening at port 3001, Vite frontend at port 5173.

## 2026-07-13 05:50 UTC | Dynamic Port Configuration
- **Action**: Modified dev scripts to support custom ports.
- **Details**: Updated `apps/web/vite.config.ts` to read ports dynamically from `process.env.VITE_PORT` and `process.env.OSCODE_PORT` (for server proxying).
- **Result**: Allows the user to run multiple instances or override default ports in case of conflict.

## 2026-07-13 05:52 UTC | Port Conflicts Resolved (High Ports)
- **Action**: Moved the dev instances to highly unoccupied ports.
- **Details**: Switched to port `8922` for the web interface and `8921` for the API server.
- **Result**: Successfully resolved conflicts where ports 5173-5176 were already taken on the host machine.

## 2026-07-13 05:57 UTC | Auto-Creation of Folders & OS Dialog Experiment
- **Action**: Allowed creating projects in non-existent folders and experimented with native folder pickers.
- **Details**:
  - Modified `apps/server/src/store.ts` to automatically call `fs.mkdirSync(..., { recursive: true })` if the folder doesn't exist when a project is added.
  - Added a backend route `GET /api/system/dialog/folder` which spawns PowerShell's `FolderBrowserDialog` to select a path.
- **Result**: Entering a new folder name automatically constructs the directory on the host. However, the OS-level browser button did not work due to session-level constraints.

## 2026-07-13 06:16 UTC | Web-Based File Explorer Migration & Diary Setup
- **Action**: Moving from a native OS-level dialog to an in-app browser dialog.
- **Details**:
  - Found that native OS-level window dialogs fail because the Node server runs inside a headless terminal session (Session 0) and cannot interact with the user's interactive desktop window station.
  - Designing a web-based folder explorer in React (`FolderExplorerModal.tsx`) that talks to new API routes `/api/system/fs/list` and `/api/system/fs/mkdir`.
  - Initialized this development diary and interactive signing tool.

## 2026-07-13 06:22 UTC | Antigravity (AI Agent)
- **Action**: Interaction Sign-in
- **Details**: Implemented folder-level rules loading (`OSCODE_RULES.md`) and added it to the agent loop system prompt context. Created the initial `OSCODE_RULES.md` to document ports, folder explorer mechanics, and development diary guidelines.

## 2026-07-13 06:50 UTC | Antigravity (AI Agent)
- **Action**: Interaction Sign-in
- **Details**: Implemented Multi-API Provider routing for OpenRouter, Anthropic (Claude), Google (Gemini), DeepSeek, Kimi, and Custom OpenAI-compatible endpoints. Added settings backend, settings UI page in React, and unified grouped models selector. Overhauled the presentation concept and main README.md for open source publishing.
## 2026-07-13 13:09 UTC | Antigravity (AI Agent)
- **Action**: Interaction Sign-in
- **Details**: Upgraded OSCode's core system prompt rules (`apps/server/src/agent/systemPrompt.ts`) to maximize reasoning and prevent cheating or incomplete logical structures. Enforced three new strict rules: (1) prohibiting any placeholder comments or stub/mock functions, (2) demanding step-by-step mathematical and logical modeling inside the `<thinking>` tag for physics, collisions, or formulas before emitting code, and (3) enforcing zero conversational token waste to maximize direct, effective actions.






















## 2026-07-13 | Coddess Hardening + Orchestration MVP
- **Rename**: OSCode → Coddess across code, packages (@coddess/*), docs. Env vars accept CODDESS_* with OSCODE_* fallback (no-break).
- **Security**: API keys now encrypted at rest (AES-256-GCM, machine-bound key in .data/.masterkey, 0600) instead of plaintext settings.json. Env-var keys still win.
- **Refactor**: loop.ts split into budget.ts (token accounting), chatStore.ts (chat persistence), observer.ts (critique). The post-run Observer critique is now OFF by default (CODDESS_ENABLE_CRITIQUE=1 to enable) — it was burning an extra model call every run.
- **New tool**: edit_file (surgical search/replace) so the agent stops rewriting whole files. Taught in the system prompt; unit-tested.
- **Git + Review**: git.ts (status/diff/commit/discard/worktrees) + REST endpoints. New "Review" tab renders colorized diffs and commits/discards changes.
- **Kanban**: tasksStore.ts + endpoints + "Tasks" board (queued/running/review/done); "Run" sends a card to the agent.
- **Verified**: server+web typecheck clean; 12 unit tests pass (protocol, edit_file, path-escape) + git integration test; web builds.

## 2026-07-13 | Reasoning Pipeline — analysis + P0 upgrades
- **Design doc**: docs/05-reasoning-pipeline.md — full as-is trace, weakness map (W1–W10), and a staged to-be pipeline (Intent → Plan → Build → Verify/Repair → Review) with add/remove lists, model-capability adaptation, and a prioritized roadmap.
- **Stage 0 — Intent compiler** (intent.ts): turns a vague prompt into a structured Spec (goal, assumptions, stack, files, acceptance criteria, open questions) BEFORE building. Emits a `spec` event rendered as a UI card; injected into the build system prompt as "# Approved specification". CODDESS_INTENT=0 to disable.
- **Model-capability tiers** (modelProfile.ts): local-small / local-large / frontier → scales scaffolding depth. Structured reasoning + small steps for local; lean for frontier.
- **Reasoning scaffold**: system prompt now requires a Decompose/Approach/Risks/Verify thinking block on turn 1 (structured tiers), anchored to the acceptance criteria.
- **search_code tool**: grep across the project so the model finds code instead of guessing. Tested.
- **Verify-before-final gate**: if acceptance criteria exist and no verification command was run, the loop nudges the agent once to verify (build/test) before honoring <final>.
- **Verified**: server+web typecheck clean; 18 unit tests (protocol, edit_file, search_code, intent parser) + git test pass; web bundle builds.
- Next (from the doc, P1): automate the full verify→repair loop, model-capability sampling, project knowledge base, context compaction, native tool-calling.

## 2026-07-13 | Verify → Repair loop (pipeline Stage 3)
- **verify.ts**: auto-detects a verification command (build/typecheck/test from package.json, or a .coddess/verify.cmd override); for no-build projects runs a static check that the HTML entry's local asset refs resolve.
- **loop.ts**: on <final>, the harness runs verification deterministically. On failure it feeds the errors back and the agent keeps working — bounded by CODDESS_MAX_REPAIRS (default 3). "Done" is no longer just the model's opinion.
- **verify event**: new NormalizedEntry kind rendered in the log (green passed / amber repairing) with the command + output.
- **Flags**: CODDESS_VERIFY=0 disables; CODDESS_MAX_REPAIRS sets the round cap; command verification requires the shell tool (static check always runs).
- **Verified**: server+web typecheck clean; 24 unit tests (protocol, edit_file, search_code, intent, verify) + git test pass; web bundle builds.

## 2026-07-13 | Project knowledge base (compounding memory)
- **knowledge.ts**: per-project .coddess/knowledge.json (+ human-editable knowledge.md) of conventions / architecture / pitfalls / commands.
- **Read**: injected into every run's system prompt so the agent reuses learned conventions instead of rediscovering them.
- **Update**: after a 'done' run, a distiller call extracts NEW durable facts; deterministic merge (trim + case-insensitive dedup + cap 20/category) prevents the model from erasing known facts. Emits a "📚 Learned N fact(s)" note.
- **Flag**: CODDESS_KNOWLEDGE=0 disables.
- **Verified**: server+web typecheck clean; 28 unit tests (incl. 4 knowledge: merge/dedup/cap, JSON parse, save-load-render) + git test pass; web builds.

## 2026-07-13 | Orchestration, auto-classify, internal git, model menu, composer redesign
- **Auto-classify**: the intent compiler now classifies the task (Feature/Bug Fix/Refactor/Optimization/Research/Chore) automatically. Removed the manual label dropdown and the [TASK:] prepend; the detected label shows on the spec card.
- **Autonomous orchestrator** (orchestrator.ts): removed the manual Tasks/kanban tab. New "Auto-build" tab — state a high-level goal, Coddess plans an architecture (ordered subtasks) and executes them automatically via the agent loop (refactored to an awaitable runAgent), feeding context forward. Live task board + orchestration events. WS 'orchestrate' message.
- **Git internalized**: removed the Review tab/button. Added a first-class 'git' agent tool (tokenized argv, runs `git` directly, no shell injection) so the agent can init/commit/connect remotes/push/pull/track/clone GitHub repos on demand via natural language. Documented in the system prompt.
- **Model menu management**: Settings.modelOverrides {added, hidden}; aggregateModels applies them. Settings UI adds custom models (incl. any OpenRouter model id), and hides/restores any provider's models.
- **Composer redesign**: Pause/Stop are symbol-only (⏸/⏹); sliders + token counter + action buttons consolidated into a single row under the textbox.
- **Verified**: server+web typecheck clean; 33 tests pass (added tokenizeArgs + orchestrator plan tests); web bundle builds.

## 2026-07-13 | UI overhaul + mid-run queue + focus
- **Reasoning kept**: model narration/reasoning is now captured every turn (extractReasoning strips only action tags) and rendered as an always-visible "reasoning" block — it no longer vanishes when the turn ends.
- **Inputs visible immediately**: the user prompt is emitted before the intent stage runs, so it shows the instant you send. Panel renamed "Activity log".
- **Queue while running**: new inject queue (agent/injections.ts) — you can type while the agent works; the message is queued and drained at the next step, injected as a user message the model reasons about before continuing (WS 'inject', Queue button / Enter).
- **Layout**: header (project + model + toggles) / middle chat entity (activity + composer) / right files panel are now separate; left and right panels are collapsible (toggle buttons + reopen) and resizable (drag handles); right panel visually separated (border + bg).
- **Composer**: token counters have hover tooltips; slider max is editable via double-click; Pause hardened (runId ref); Pause/Stop are symbol-only.
- **Projects**: compact list (no big icons) with per-item remove (✕) and scroll.
- **Focus, no fluff**: system prompt now forbids emojis/decorative/presentation flourishes and filler — terse, technical, essential output only.
- **Verified**: server+web typecheck clean; 32 tests + git test pass; web builds.
- Deferred: real-time connect/disconnect of extra folders as temporary context (multi-root scoping — needs tools/fsutil changes; next).

## 2026-07-13 | Linked context folders + full-height files panel
- **Temporary context folders**: Project.contextDirs — link/unlink extra folders in real time (sidebar, under the selected project). The agent can read_file/list_dir/search_code them via absolute paths (read-only); writes stay scoped to the project root (resolveRead vs resolveInProject). Linked folders' trees are injected into the system prompt. New REST endpoints + store add/removeContextDir; tested.
- **Files panel full height**: restructured ProjectView — pview is now a flex row of pmain (header + tabs + activity/composer) and the files aside, so the files panel spans the full window height, visually separate from the header.
- **Verified**: server+web typecheck clean; 33 tests (added context read/scope test) + git test pass; web builds.

## 2026-07-13 | Context compaction (long-task support)
- **compaction.ts**: when the running message history exceeds CODDESS_COMPACT_AT tokens (default 12000), the older turns are summarized into a compact synopsis via a cheap model call while the system prompt + last CODDESS_COMPACT_KEEP recent turns (default 6) are kept verbatim; the run then continues instead of dying on the context window. Falls back to dropping oldest turns if summarization fails. Flag CODDESS_COMPACTION=0 to disable. Wired into runAgent before each model turn; emits a note when it compacts.
- **Verified**: server+web typecheck clean; 39 tests (added 6 compaction tests) + git test pass; web builds.

## 2026-07-13 | Parallel worktrees + native tool-calling (P2)
- **Parallel orchestration** (opt-in, CODDESS_ORCH_PARALLEL=1): each subtask runs in its own git worktree/branch concurrently (bounded by CODDESS_ORCH_CONCURRENCY, default 2), commits, and merges back into the main tree; merges are serialized and conflicts leave the branch for review (git.abortMerge). Sequential remains the default. Worktree lifecycle validated by a git test (add → commit → merge → remove).
- **Native tool-calling** (opt-in, CODDESS_NATIVE_TOOLS=1): nativeTools.ts exposes the Coddess tool set (plus a finish tool) as OpenAI- and Anthropic-format schemas, a capability check, and chatWithTools() for a structured turn. The loop uses it only for supporting providers when the flag is on; the XML protocol stays the universal default (and Ollama path), so nothing can regress. Schema builders + response parsers are unit-tested.
- **Verified**: server+web typecheck clean; 46 tests (added native-tool + worktree tests) pass; web builds.
- Both features default OFF and not runtime-tested against live models/APIs — owner should smoke-test before relying on them.

## 2026-07-14 05:37:00 UTC | Antigravity (AI Agent)
- **Action**: Interaction Sign-in
- **Details**: Polished the project with standard community templates (LICENSE, Code of Conduct, Contributing guidelines, GitHub issue/PR templates, Actions CI workflow), generated a custom futuristic banner, overhauled the README, initialized Git, excluded the heavy local Tests directory, and published to GitHub at https://github.com/3esign/coddess.
