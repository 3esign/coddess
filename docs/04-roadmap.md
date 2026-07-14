# Coddess — Roadmap

Phased path from empty repo to a usable v1. The MVP is the **vertical slice**: kanban → worktree → agent run → diff → merge. Everything else defers until that slice works end to end.

---

## Phase 0 — Foundations (scaffold)

**Goal:** a monorepo that boots a server and a React app that talk over WebSocket.

- pnpm monorepo: `apps/server` (Node/Fastify + WS), `apps/web` (React/Vite), `packages/agent-core` (native loop), `packages/executors` (CLI wrappers), `packages/shared` (event schema + types).
- Define the **`NormalizedEntry` event schema** and the WebSocket protocol first — everything consumes it.
- SQLite (via a light ORM or `better-sqlite3`) for kanban/task state; git for code state.
- Health-check: server streams a dummy event, web renders it live.

**Exit:** `pnpm dev` runs server + web; a hand-injected event appears in the browser in real time.

---

## Phase 1 — MVP vertical slice

**Goal:** one real agent run, start to merge, driven from the board.

1. **Folder selection & repo detection** — point at a local git repo.
2. **WorktreeManager** — create a `git worktree` + branch per task; prune on completion.
3. **One executor** — start with the **NativeLoopExecutor** (Vercel AI SDK) *or* the **ClaudeCodeExecutor** (stream-json), whichever is faster to get end-to-end. Tools scoped to the worktree.
4. **Kanban board** — columns Backlog → In Progress → Review → Done; creating a card in In Progress provisions a worktree and starts the agent.
5. **Task view** — live agent log (from the normalized event stream) + a diff tab.
6. **Diff review** — `@git-diff-view/react`, per-file hunks, Approve → merge to base, Reject → drop branch.
7. **Key vault** — OS keychain storage for at least one provider; keys server-side only.

**Exit:** create a task, an agent edits the repo in its worktree, you review the diff on the board, approve, and it merges to the base branch — without touching a terminal.

---

## Phase 2 — Hybrid engine & parallelism

**Goal:** multiple agents, multiple providers, in parallel.

- Second engine mode live: whichever of native-loop / Claude Code wasn't built in Phase 1, plus **Codex** and **Aider** executors.
- **Executor registry** + command-override layering + the error taxonomy surfaced in the UI.
- **Provider router**: Anthropic, OpenAI, Google, Ollama; model picker fed by **models.dev**.
- **Parallel runs** — several worktrees/agents at once; board shows live status per card.
- **PTY tab** — node-pty + xterm.js for interactive agents.
- Encrypted-vault fallback for headless/Docker key storage.

**Exit:** run three different agents on three tasks simultaneously, each in its own worktree, all visible on one board.

---

## Phase 3 — Review, merge & cost polish

**Goal:** the review/merge experience that is the differentiator.

- Inline diff comments that feed back to the agent as a follow-up prompt (`spawnFollowUp`).
- Keep/drop-hunks partial merge + conflict flagging.
- One-click PR with AI-generated description.
- Side-by-side "race mode" comparison of two agents on the same task.
- Live tokens/cost per run and per model; per-project spend view.
- Optional gateway provider (OpenAI-compatible base URL → LiteLLM / OpenRouter).

**Exit:** a reviewer can comment, partially merge, compare approaches, and see cost — all in-app.

---

## Phase 4 — Safety, ecosystem & reach (toward v1)

**Goal:** trustworthy defaults and community extensibility.

- Opt-in **Docker workspace** behind the existing `Workspace` interface (safe mode).
- Per-task permission policies; dangerous-tool approval routed to the board.
- **Executor plugin API** documented so the community can add agents; ACP harness for Gemini/Qwen/Copilot.
- Task dependencies / pipelines; task templates/recipes.
- Remote/mobile-friendly UI; self-host + reverse-proxy docs and origin controls.
- Full run replay from the event log.

**Exit (v1):** a stranger can install Coddess, add a key, orchestrate several agents safely on their repo, and extend it with a new executor.

---

## Later / optional

- Hosted/remote multi-tenant tier with E2B/Firecracker microVM sandboxing.
- Semantic merge-conflict assistance.
- Team boards, sharing, and auth.

---

## Cross-cutting throughout

- **Security:** keys server-side only, redacted logs, never auto-push/merge without review.
- **The event log is sacred:** native loop and every CLI executor emit the same schema; UI/persistence/merge stay agent-agnostic.
- **Ship the slice, then widen:** resist building executors/providers/features until the kanban → worktree → diff → merge loop is solid.

## Immediate next actions

1. Build the clickable HTML **mockup** (`mockup/dashboard.html`) to lock the UX before code.
2. Seed **`README.md`** (done alongside these docs).
3. Scaffold the **Phase 0** monorepo.
