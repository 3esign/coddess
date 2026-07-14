# Coddess — Architecture

**Status:** design, informed by mid-2026 research (see `01-landscape.md`, `research-track2.md`, `research-track3.md`).
**Stack (locked):** TypeScript full-stack — Node backend + React frontend. Local web app (local server + browser UI).

---

## 1. Guiding principles

1. **BYOK, local-first.** Users bring their own API keys; the app runs on their machine, works on their repos. No hosted detour, no vendor markup, no telemetry by default.
2. **One normalized event stream.** The native agent loop and every wrapped CLI agent emit the *same* append-only event schema. The UI, persistence, and diff/merge flow are agent-agnostic — they never touch raw agent bytes.
3. **One git worktree per task.** Parallelism is provided by git, not by heavyweight sandboxes. Blast radius = one branch/dir; risk is gated at diff review, not per-tool prompts.
4. **Hybrid engine.** A native multi-provider agent loop *and* pluggable executors that wrap existing CLI agents, behind one interface.
5. **Everything is resumable.** Because state is an event log + git, sessions can be replayed, resumed, and audited.

---

## 2. Component map

```
React (board · task view: chat / terminal / diff · settings)
        │  WebSocket (normalized event stream)
        ▼
Node / Fastify server
  ├─ Kanban + task store        (SQLite: workflow state; git: code state)
  ├─ WorktreeManager            git worktree add per task → branch
  ├─ EventBus                   append-only NormalizedEntry log per task
  ├─ Executor registry ─────┬─  NativeLoopExecutor  (Vercel AI SDK — multi-provider)
  │                         ├─  ClaudeCodeExecutor  (CLI, stream-json)
  │                         ├─  CodexExecutor / AiderExecutor (CLI / PTY)
  │                         └─  ACP harness (Gemini / Qwen / Copilot)
  ├─ Workspace interface        host (default) | docker (opt-in) | e2b (remote, later)
  ├─ PTY manager                node-pty ⇄ xterm.js
  ├─ ProviderRouter             Anthropic · OpenAI · Google · Ollama · (OpenRouter/LiteLLM base URL)
  ├─ ApprovalService            diff-review-gated merge
  └─ Key vault                  OS keychain + encrypted fallback (BYOK)
```

**The unifying insight (from Vibe Kanban's `NormalizedEntry` and OpenHands' event log):** standardize on one event bus + one worktree per task. Native and wrapped agents become indistinguishable to everything above the executor layer.

---

## 3. The agent engine (hybrid)

### 3a. Native loop — Vercel AI SDK

The native loop is the default executor and the only one that directly satisfies the locked multi-provider/BYOK requirement. `streamText` + `tools` + `stopWhen: stepCountIs(n)` *is* a coding-agent loop: the SDK appends each model response, executes tool calls, and re-invokes until a stop condition or a text-only answer.

```ts
const result = streamText({
  model: router.resolve(task.provider, task.model), // anthropic | openai | google | openrouter | ollama
  system: codingSystemPrompt,
  messages,
  tools: { readFile, writeFile, runShell, gitDiff, applyPatch }, // scoped to the worktree path
  stopWhen: stepCountIs(50),   // deliberate safety cap (SDK default is 20)
});
for await (const part of result.fullStream) {
  eventBus.append(task.id, toNormalizedEntry(part));
}
```

Tools are scoped to the task's worktree path. Dangerous tools carry a `needsApproval` flag routed to the UI. `fullStream` feeds the same normalized event bus the CLI executors write to.

### 3b. CLI executors — the plugin interface

Modeled on Vibe Kanban's `StandardCodingAgentExecutor`, translated to TypeScript:

```ts
interface CodingAgentExecutor {
  spawn(ctx: RunContext, prompt: string): Promise<SpawnedChild>;
  spawnFollowUp(ctx: RunContext, sessionId: string, prompt: string): Promise<SpawnedChild>;
  spawnReview?(ctx: RunContext, prompt: string): Promise<SpawnedChild>;
  normalizeLogs(child: SpawnedChild): AsyncIterable<NormalizedEntry>;
  discoverOptions?(): AsyncIterable<JsonPatch>;   // models / modes → progressive UI patches
  useApprovals?(svc: ApprovalService): void;
  getAvailability(): Promise<AvailabilityInfo>;   // binary on PATH? auth needed?
}

interface SpawnedChild {
  child: ChildProcess;          // spawned as a process group so the whole subtree can be killed
  exitSignal: Promise<number>;
  cancel(): void;
}
```

Design points carried over:

- **Registry dispatch.** A `Map<AgentId, CodingAgentExecutor>` populated at startup; the chosen agent's discriminant is stored per task so a run can be reconstructed.
- **Command override layering.** Each executor exposes base-command / extra-flags / env overrides, resolved base → profile → runtime. This is how "auto-approve" profiles are expressed per agent.
- **Process-group spawning** so cancel kills the whole subtree (agents spawn children).
- **Error taxonomy:** `ExecutableNotFound`, `AuthRequired`, `SpawnError`, `FollowUpNotSupported` — surfaced distinctly in the UI; these are the top user-facing failure classes.

### 3c. Output normalization

Raw stdout/stderr becomes structured `NormalizedEntry` events — a small closed set: `AssistantMessage`, `ToolUse` (with args), `ErrorMessage`. Three ingestion strategies chosen per agent:

1. **JSON-line** (Claude Code `--output-format stream-json`, Amp, Cursor, Droid) — preferred whenever supported.
2. **ACP (Agent Client Protocol)** — Gemini, Qwen, Copilot; a shared ACP harness normalizes them. An emerging cross-agent stdio JSON-RPC standard worth tracking.
3. **Server/event protocol** — opencode runs a local server whose event stream is consumed directly.

The board UI, diff view, and persistence consume only the normalized stream.

---

## 4. Worktree & workspace model

- **One `git worktree` + branch per task** (Vibe Kanban's LocalContainerService pattern). Zero-conflict parallelism, cheap, native to git, no daemon.
- Moving a card to **In Progress** provisions the workspace: worktree + branch + terminal + (optional) dev server.
- **`Workspace` interface** (OpenHands-style `exec(action) → observation`, plus filesystem + terminal) abstracts *where* actions run: `host` (default) | `docker` (opt-in) | `e2b` (remote, later). Defining it now means a Docker executor drops in later without touching the agent loop.
- Worktree lifecycle management (create, track, prune) is first-class — worktree sprawl is a known pain point Coddess should solve, not inherit.

---

## 5. Sandboxing

**v1 = no sandbox.** Isolation is the git worktree (blast radius = one branch/dir) plus review-before-merge. This matches the trust model of a local-first BYOK app (users run it on their own machine, on their own repos, with their own keys) and the defaults of Vibe Kanban / Aider / Claude Code. Docker-by-default would add real friction (install Docker, mount volumes, bind node-pty into the container) for little gain.

Escalation path, already accommodated by the `Workspace` interface:

| Option | Isolation | Startup | When |
|---|---|---|---|
| **None — host worktree** | process only | ~0 | **Default (v1).** |
| **Docker container** | shared kernel + seccomp/namespaces | ~30–90 ms | Opt-in: extra safety, reproducible toolchains, untrusted task templates. |
| **Firecracker microVM (E2B)** | own kernel per sandbox | ~150 ms | Future hosted/remote/multi-tenant tier only. |

Always: scope the native loop's tools to the worktree path; never auto-`git push`/merge without review.

---

## 6. Provider routing & BYOK

Because Coddess is BYOK + local + open-source, it does **not** hard-wire a hosted aggregator.

- **Native adapter layer** talks to each provider directly — Anthropic, OpenAI, Google, plus **Ollama** for local models — normalizing to one internal streaming + tool-call shape. The Vercel AI SDK provides this adapter layer without hand-writing every provider client.
- **Optional gateway provider.** Power users can point at an OpenAI-compatible base URL — **self-hosted LiteLLM** (MIT, $0 markup, built-in virtual keys / budgets / metrics) or **OpenRouter** (hosted breadth; BYOK free for the first 1M req/mo). Since both are OpenAI-compatible, this is one extra adapter, not a rewrite.
- **Model catalog** comes from **models.dev** (MIT, open pricing/spec DB) to power the model picker and per-run cost math — no hand-maintained price tables.

---

## 7. Secure key storage

Keys live **only in the Node backend**, never shipped to the React client. Storage backends, in preference order:

1. **OS keychain (default).** macOS Keychain / Windows Credential Manager (DPAPI) / Linux libsecret via a maintained keytar-style native module. The OS encrypts under the user's login; the app only calls get/set and never persists plaintext.
2. **Encrypted-at-rest vault (fallback for headless/Docker).** AES-256-GCM with a key derived from a user master password via Argon2id. Fresh random 96-bit nonce per encryption, store the auth tag, never use the password directly as the key.
3. **Env vars** — dev / container / CI only; plaintext on disk, never the desktop default.

Cross-cutting: per-provider entries, redact keys in logs, handle the user deleting the OS entry out from under the app. Note the process boundary — OS encryption protects at-rest and against other apps, not a compromised in-process Node runtime.

---

## 8. Terminal (PTY)

Standard VS Code-proven stack: **node-pty + xterm.js over WebSocket.**

```
xterm.js (browser)  ⇄ WebSocket ⇄  Node server  ⇄ node-pty ⇄  agent CLI process
```

node-pty forks a real pseudo-terminal (forkpty on Unix, ConPTY on Windows) so agents expecting a TTY (colors, progress bars, interactive prompts) behave. Use `@xterm/addon-fit` and forward `cols/rows` to `pty.resize()`. One PTY per running task, multiplexed over a WS with a task-id channel. Two modes: live interactive terminal tab, and tee-through-normalizer for JSON/ACP agents (structured events *and* optional raw terminal).

---

## 9. Diff review

Backend computes `git diff <base>...<task-branch>` (via a git lib or shelling out) and streams it to the UI. Rendering uses **@git-diff-view/react** (Shiki-backed: ~40 kb, GitHub-style, fast, supports inline comment/action widgets) as the primary pane, with **Monaco DiffEditor** for editable/full-file diffs.

Per-file, hunk-level **Approve / Reject** controls build a partial-apply set:
- Approve → merge / cherry-pick / apply-selected-hunks into base.
- Reject → drop the worktree branch.
- Inline comments feed a follow-up prompt back to the executor (`spawnFollowUp`), closing the review → revise loop without leaving the app.

---

## 10. Event & persistence model

- **Append-only event log per task** (OpenHands-style Action/Observation, generalized to `NormalizedEntry`). This single source of truth gives replay, resumable sessions, the WebSocket UI feed, and audit for free.
- **SQLite** for workflow/kanban state; **git** for code state. Clean separation: the repo is the source of truth for code, the DB for orchestration.
- WebSocket streams the normalized events to the board and task views live.

---

## 11. What we deliberately borrow vs. avoid

**Borrow:** Vibe Kanban's executor trait + kanban→worktree lifecycle; OpenHands' event-sourced action/observation log + Workspace abstraction; Conductor's polished per-agent workspace UX; Sculptor's keep/drop-hunks merge + container "safe mode" (as opt-in); opcode's usage/cost dashboard; Crystal's side-by-side agent comparison.

**Avoid:** Mac-only/closed distribution (Conductor); Docker-by-default friction (Sculptor as *required*); TUI-only reach (claude-squad); IDE-bound orchestration (Kilo Agent Manager); `--dangerously-skip-permissions` as an unadvertised default (Vibe Kanban) — Coddess gates risk at review instead.
