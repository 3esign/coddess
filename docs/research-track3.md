# Research Track 3 — Architecture Deep Dive

**Date:** 2026-07-12
**Scope:** Concrete architecture for Coddess's hybrid agent engine — pluggable CLI executors, a native TS agent loop, git worktree isolation, PTY handling, sandboxing, and diff-review UI. Recommendations are opinionated and tuned for a local-first, BYOK, TypeScript full-stack app.

---

## TL;DR recommendations

| Concern | Pick | Why |
|---|---|---|
| Native agent loop | **Vercel AI SDK 6** (`streamText` + `stopWhen`/`stepCountIs` + `tools`) | Multi-provider by design, first-class streaming + tool loop, TS-native, matches locked stack decision. |
| CLI wrapping | **Executor plugin interface** modeled on Vibe Kanban's `StandardCodingAgentExecutor` (spawn / follow-up / normalize-logs) | Proven pattern for normalizing 10+ heterogeneous CLIs into one event schema. |
| Isolation | **One git worktree + branch per task** (LocalContainerService pattern) | Zero-conflict parallelism, cheap, native to git, no daemon. |
| Sandbox (v1) | **None — run directly on host worktree**, with an optional Docker executor later | Local-first + BYOK users trust their own machine; matches Vibe Kanban/Aider defaults. Add opt-in Docker/E2B for untrusted/remote. |
| Terminal | **node-pty + xterm.js over WebSocket** | The universal, VS Code-proven pattern for interactive CLI agents. |
| Diff review | **@git-diff-view/react** (Shiki-backed) primary; Monaco DiffEditor for full-file edit | Fast, small bundle, GitHub-style UI, parses unified diff directly. |

---

## 1. Executor pattern: wrapping CLI coding agents (Vibe Kanban)

Vibe Kanban (BloopAI, Rust backend + React frontend, distributed as `npx vibe-kanban`) is the reference implementation for "wrap any CLI agent as a plugin." Its abstraction layer normalizes Claude Code, Codex, Gemini CLI, Cursor Agent, Copilot, Amp, opencode, Qwen, Droid, etc. into a single interface. ([overview](https://deepwiki.com/BloopAI/vibe-kanban), [executor traits](https://deepwiki.com/BloopAI/vibe-kanban/3.1-executor-architecture-and-traits))

### The `StandardCodingAgentExecutor` interface

Each agent implements a common trait. Translated to a TypeScript interface for Coddess:

```ts
interface CodingAgentExecutor {
  // Start a fresh run with the initial prompt. Returns a handle to the child process.
  spawn(ctx: RunContext, prompt: string): Promise<SpawnedChild>;
  // Continue an existing agent session (resume by session id / conversation).
  spawnFollowUp(ctx: RunContext, sessionId: string, prompt: string): Promise<SpawnedChild>;
  // Optional: start a dedicated review pass.
  spawnReview?(ctx: RunContext, prompt: string): Promise<SpawnedChild>;
  // Turn the child's raw stdout/stderr into a stream of NormalizedEntry events.
  normalizeLogs(child: SpawnedChild): AsyncIterable<NormalizedEntry>;
  // Query available models/agents/permission modes (progressive JSON patches to the UI).
  discoverOptions?(): AsyncIterable<JsonPatch>;
  // Inject the approval service so the agent can request permission mid-run.
  useApprovals?(svc: ApprovalService): void;
  // Auth / binary-present check ("claude login" required? binary on PATH?).
  getAvailability(): Promise<AvailabilityInfo>;
  // MCP config file path, preset config, runtime overrides...
}

interface SpawnedChild {
  child: ChildProcess;           // the OS process group
  exitSignal: Promise<number>;   // resolves on completion
  cancel(): void;                // cooperative cancellation token
}
```

Key design points worth copying:

- **Enum/registry dispatch.** Vibe Kanban uses a `CodingAgent` enum with `enum_dispatch`; in TS use a registry `Map<AgentId, CodingAgentExecutor>` populated at startup. A discriminant type (`BaseCodingAgent`) is stored in the DB per task so a run can be reconstructed.
- **`CmdOverrides` layering.** Every executor exposes `base_command_override` (e.g. swap `claude` for `npx claude-code`), `additional_params` (extra CLI flags), and `env`. Config resolves base → profile default → runtime override. This is how they support "YOLO" profiles: `CLAUDE_CODE: dangerously_skip_permissions`, `GEMINI: yolo`, `CURSOR_AGENT: force`, `OPENCODE: auto_approve`, `DROID: autonomy=skip-permissions-unsafe`.
- **Process spawning via a process-group wrapper** (`command-group` in Rust). In Node the equivalent is spawning with `detached`/process-group semantics so you can kill the whole subtree on cancel (agents spawn children). Consider `tree-kill` or spawning under a PTY.
- **Error taxonomy.** `ExecutorError` = `ExecutableNotFound` (binary missing from PATH), `AuthRequired` (needs `claude login`), `SpawnError` (I/O), `FollowUpNotSupported`. Surface these distinctly in the UI — they are the top user-facing failure classes.

### Capturing output — the normalization layer

Raw agent stdout/stderr is converted into structured `NormalizedEntry` objects with a small closed type set: `AssistantMessage` (model text), `ToolUse` (shell/edit/search with args), `ErrorMessage`. ([log processing](https://deepwiki.com/BloopAI/vibe-kanban/3.1-executor-architecture-and-traits))

Three ingestion strategies, chosen per agent:

1. **JSON-line protocol** — Claude Code, Amp, Droid, Cursor emit streaming JSON (`--output-format stream-json` for Claude Code). Parse line-delimited JSON. This is the cleanest path and should be preferred whenever the CLI supports it.
2. **ACP (Agent Client Protocol)** — Gemini, Qwen, Copilot speak ACP; a shared `AcpAgentHarness` normalizes them. ACP is emerging as a cross-agent stdio JSON-RPC standard worth tracking for Coddess.
3. **Server/event protocol** — opencode runs a local server and Coddess would consume its event stream.

**Takeaway for Coddess:** define one internal `NormalizedEntry` event schema, and per-executor adapters that map (a) JSON-stream, (b) ACP, or (c) raw-PTY-text into it. The board UI, diff view, and persistence all consume this normalized stream — never raw agent bytes.

### Approval / permission integration

Executors receive an `ApprovalService` and, depending on the agent, either map Coddess's `PermissionPolicy` to the agent's own flags (`Auto` ↔ `yolo`/`skip-permissions`; `Supervised` ↔ interactive) or intercept `AskUserQuestion`-style prompts and route them to the UI. For a dashboard you generally want to run agents in auto/skip-permission mode inside an isolated worktree and gate risk at the **merge/diff-review** step instead of per-tool prompts.

---

## 2. OpenHands architecture — reusable patterns

OpenHands is the reference for a **native, event-sourced agent runtime with a sandbox**. Its V1 "Software Agent SDK" (GA ~April 2026) is the current shape. ([events docs](https://docs.openhands.dev/sdk/arch/events), [SDK paper](https://arxiv.org/html/2511.03690v1), [event storage](https://deepwiki.com/All-Hands-AI/OpenHands/12.2-event-storage-and-replay))

Core components:

- **Stateless Agent** — emits **Actions**; holds no mutable state itself.
- **Conversation** — runs the loop and owns an **append-only EventLog**.
- **Workspace** — a local process *or* Docker container that executes Actions and returns **Observations**.
- **LLM** — wrapped by LiteLLM for multi-provider.

The central abstraction is the **event stream**: every interaction is either an `Action` (agent decided to do X) or an `Observation` (result of X), both typed models, appended chronologically. This log *is* the agent's memory and the perception–action loop; the controller feeds the event history to the LLM, gets the next Action, executes it in the Workspace, appends the Observation, repeats. V1 moves event storage from files to Postgres (V0 file storage deprecating April 2026).

**What to reuse in Coddess (don't copy wholesale — OpenHands is Python + heavy):**

- **Event-sourced action/observation log per task.** Persist an append-only event stream per run. It gives you: replay, resumable sessions, the WebSocket feed to the UI, and audit — all for free from one source of truth. This unifies both engine modes: the *native loop* and the *CLI executors* both just append normalized events.
- **Runtime abstraction** = "Workspace that executes an Action and returns an Observation." For Coddess this maps to: host worktree (default) vs Docker (opt-in) behind one `Workspace` interface — mirrors OpenHands' local-process-vs-container split.
- **LiteLLM-style provider indirection** — Coddess gets this from the Vercel AI SDK instead.

Note the convergence: Vibe Kanban's `NormalizedEntry` stream and OpenHands' `Event` log are the same idea. **Standardize Coddess on one event bus** consumed over WebSocket.

---

## 3. Native agent loop SDK — recommendation: Vercel AI SDK 6

Three candidates for the embeddable "native loop." ([SDK comparison](https://dev.to/muhammad_moeed/claude-agent-sdk-vs-vercel-ai-sdk-6-which-to-pick-in-2026-2jj), [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control), [Vercel agents guide](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk))

| SDK | Strengths | Weaknesses for Coddess |
|---|---|---|
| **Vercel AI SDK 6** | Multi-provider (OpenAI, Anthropic, Google, OpenRouter, Ollama, 13+) with no core rewrite; `streamText`/`generateText` with built-in tool loop; `stopWhen: stepCountIs(n)` loop control; `needsApproval` one-line human-in-loop; TS/React native; AI Elements UI + Sandbox add-ons. | Tools/sandbox/FS are BYO (a plus for a bespoke agent — you own the tool set). |
| **Claude Agent SDK (TS)** | Same runtime as Claude Code: built-in file/shell tools, subagents, hooks, prompt caching + auto-compaction, strong MCP. Best "give the agent a computer" DX. | Anthropic-first — undercuts the multi-provider BYOK requirement. **Better used as a CLI *executor*** (wrap Claude Code) than as the provider-agnostic native loop. |
| **OpenAI Agents SDK (JS)** | Clean handoff/triage multi-agent model. | Weaker multi-provider story; handoff model is not what a single coding loop needs. |

**Recommendation: Vercel AI SDK 6 is the native loop.** It is the only option that directly satisfies Coddess's locked "multi-provider routing" decision, and its `streamText` + `tools` + `stopWhen` is exactly a coding agent loop:

```ts
const result = streamText({
  model: registry.resolve(task.provider, task.model), // anthropic | openai | google | openrouter | ollama
  system: codingSystemPrompt,
  messages,
  tools: { readFile, writeFile, runShell, gitDiff, applyPatch }, // scoped to the worktree
  stopWhen: stepCountIs(50),        // loop-control safety cap (default is 20)
  // needsApproval on dangerous tools -> route to UI approval
});
for await (const part of result.fullStream) { eventBus.append(task.id, toNormalizedEntry(part)); }
```

The SDK auto-orchestrates: appends each model response, executes tool calls, re-invokes until a stop condition or a text-only answer. Default stop is `stepCountIs(20)` (raise deliberately). Use `fullStream` to feed the same normalized event bus the CLI executors write to — so native and wrapped agents are indistinguishable to the UI.

**Keep the Claude Agent SDK in the toolbox** as (a) a premium CLI executor and (b) a reference for context-compaction/subagent patterns you may reimplement on top of the AI SDK later.

---

## 4. PTY handling — node-pty + xterm.js

Standard, VS Code-proven stack for interactive CLI agents in the browser. ([node-pty](https://github.com/microsoft/node-pty), [xterm.js](https://xtermjs.org/), [pattern writeup](https://dev.to/saisandeepvaddi/how-to-create-web-based-terminals-38d))

Architecture:

```
xterm.js (browser)  <--WebSocket-->  Node server  <-- node-pty -->  agent CLI process
   onData -> ws.send                  pty.write(input)
   term.write(output) <- ws.onmessage pty.onData -> ws.send(output)
```

- **node-pty** forks a real pseudo-terminal (Linux/macOS via forkpty, Windows via ConPTY on 1809+), keeping the session alive and making agents that expect a TTY (progress bars, colors, interactive prompts) behave correctly. Prefer this over plain `child_process` for any interactive agent.
- **xterm.js** renders in-browser; use `@xterm/addon-fit` for resize and forward `cols/rows` to `pty.resize()` so full-screen TUI agents lay out correctly.
- **WebSocket, not HTTP** — real-time bidirectional, keeps progress bars smooth.
- **Two consumption modes** in Coddess: (1) attach xterm for a live interactive terminal tab; (2) for JSON-stream/ACP agents, tee the PTY output through the normalizer to produce structured events *and* optionally show the raw terminal. Vibe Kanban favors structured JSON where the CLI supports it and only falls back to raw PTY when it must.
- One PTY per running task; multiplex over a single WS with a task-id channel, or one WS per task.

---

## 5. Sandboxing — none (host) for v1, Docker/E2B opt-in later

Spectrum, fastest→most-isolated. ([sandboxing comparison](https://amux.io/guides/ai-agent-sandboxing/), [E2B vs Docker vs microVM](https://agentmarketcap.ai/blog/2026/04/10/sandboxed-code-execution-ai-agents-e2b-modal-daytona))

| Option | Isolation | Startup | Fit for local-first BYOK |
|---|---|---|---|
| **None — direct on host worktree** | Process only (user's own machine) | ~0 | ✅ **Default.** User already trusts their machine and their own keys; matches Vibe Kanban / Aider / Claude Code defaults. |
| **Docker container** | Shared host kernel; seccomp/namespace/network policy | ~27–90 ms | Opt-in for extra safety or reproducible env; requires Docker installed. |
| **gVisor (Modal)** | User-space kernel intercepting syscalls | sub-second | Cloud/managed; overkill locally. |
| **Firecracker microVM (E2B)** | Own kernel per sandbox | ~150 ms | Strongest boundary; ~24h session cap, self-host complexity, network-policy gaps. For a hosted/remote Coddess tier, not local. |

**Recommendation:**
- **v1 = no sandbox.** Isolation is provided by the **git worktree** (blast radius = one branch/dir), plus the ability to review the diff before merge. This is the right call for a local-first app: users install it to work on *their* repos on *their* machine with *their* keys. Docker-by-default would add friction (install Docker, mount volumes, bind node-pty into the container) for little benefit to the trust model.
- **Design the `Workspace` interface now** (OpenHands-style: `exec(action) -> observation`, plus filesystem + terminal) so a **Docker executor** can be dropped in later without touching the agent loop. Docker becomes valuable for: untrusted/community task templates, reproducible toolchains, and any future remote/multi-tenant mode — where **E2B/Firecracker** is the escalation.
- Regardless of sandbox: scope the native loop's tools to the worktree path, and never auto-`git push`/merge without review.

---

## 6. Diff-review UI

Show a git diff of the worktree branch vs base, with per-hunk/per-file approve/reject, then merge. ([git-diff-view](https://mrwangjusttodo.github.io/git-diff-view/), [react-diff-view](https://github.com/otakustay/react-diff-view), Monaco DiffEditor)

| Library | Model | Notes |
|---|---|---|
| **@git-diff-view/react** (Shiki-backed) | Parses unified diff string directly; split/unified; inline widgets | **Primary pick.** Reported ~280 ms initial render, ~28 MB, ~40 kb bundle, 60 fps scroll vs react-diff-view (~4.2 s, 142 MB, 87 kb). Shiki gives 100+ language highlighting, GitHub-style UI, and supports inline comment/action widgets — ideal for approve/reject affordances. Multi-framework (React/Vue/Solid/Svelte) future-proofs. |
| **react-diff-view** | Parses `git diff` output; hunk-level API, decorations, comment widgets | Mature, battle-tested, most flexible for custom per-hunk controls; heavier/slower. Good fallback if git-diff-view lacks a needed hook. |
| **Monaco DiffEditor** | Full editor side-by-side | Use for **editable** diffs / letting the user tweak before accept, and for large single-file edits. Heavy (~monaco), but you likely already ship Monaco for any in-app editing. |
| **Shiki (raw)** | Highlighter only | Underpins git-diff-view; only use directly if building a bespoke renderer. |

**Recommendation:** `@git-diff-view/react` for the review pane. Backend computes the diff with a git lib (isomorphic-git or shelling to `git diff <base>...<task-branch>`), streams it to the UI, and renders per-file with hunk-level **Approve / Reject** controls that build a partial-apply set. Approving = `git merge`/cherry-pick or apply-selected-hunks into base; rejecting = drop the worktree branch. Add inline-comment widgets (both libs support them) to feed a follow-up prompt back to the executor (`spawnFollowUp`) — closing the review→revise loop.

---

## Putting it together (Coddess component map)

```
React (board / task view: chat · terminal · diff)
        │  WebSocket (normalized event stream)
        ▼
Node/Fastify server
  ├─ Task queue + Kanban state (SQLite)
  ├─ WorktreeManager       git worktree add per task -> branch
  ├─ EventBus              append-only NormalizedEntry log per task (OpenHands-style)
  ├─ Executor registry ────┬─ NativeLoopExecutor (Vercel AI SDK 6, multi-provider tools)
  │                        ├─ ClaudeCodeExecutor (CLI, stream-json)
  │                        ├─ CodexExecutor / AiderExecutor (CLI/PTY)
  │                        └─ ... (ACP harness for Gemini/Qwen/Copilot)
  ├─ Workspace iface       host(default) | docker(opt-in) | e2b(remote, later)
  ├─ PTY manager           node-pty <-> xterm.js
  ├─ ApprovalService       diff-review gated merge
  └─ Key vault (encrypted BYOK)
```

The unifying insight from both references: **one normalized event stream + one worktree per task**. Native loop and every wrapped CLI both write the same event schema; the UI, persistence, and diff/merge flow are agent-agnostic.

---

## Sources

- Vibe Kanban overview — https://deepwiki.com/BloopAI/vibe-kanban
- Vibe Kanban executor traits — https://deepwiki.com/BloopAI/vibe-kanban/3.1-executor-architecture-and-traits
- Vibe Kanban repo — https://github.com/BloopAI/vibe-kanban
- Vibe Kanban worktree strategy — https://starlog.is/articles/ai-dev-tools/bloopai-vibe-kanban/
- OpenHands events — https://docs.openhands.dev/sdk/arch/events
- OpenHands Software Agent SDK paper — https://arxiv.org/html/2511.03690v1
- OpenHands event storage/replay — https://deepwiki.com/All-Hands-AI/OpenHands/12.2-event-storage-and-replay
- Claude Agent SDK vs Vercel AI SDK 6 — https://dev.to/muhammad_moeed/claude-agent-sdk-vs-vercel-ai-sdk-6-which-to-pick-in-2026-2jj
- Claude Agent SDK overview — https://code.claude.com/docs/en/agent-sdk/overview
- AI SDK loop control — https://ai-sdk.dev/docs/agents/loop-control
- AI SDK stepCountIs — https://ai-sdk.dev/docs/reference/ai-sdk-core/step-count-is
- Build AI agents with Vercel AI SDK — https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk
- node-pty — https://github.com/microsoft/node-pty
- xterm.js — https://xtermjs.org/
- Web terminal pattern — https://dev.to/saisandeepvaddi/how-to-create-web-based-terminals-38d
- AI agent sandboxing (Docker/E2B/Firecracker/gVisor) — https://amux.io/guides/ai-agent-sandboxing/
- Sandboxed code execution 2026 (E2B vs Modal vs Daytona) — https://agentmarketcap.ai/blog/2026/04/10/sandboxed-code-execution-ai-agents-e2b-modal-daytona
- git-diff-view — https://mrwangjusttodo.github.io/git-diff-view/
- react-diff-view — https://github.com/otakustay/react-diff-view
