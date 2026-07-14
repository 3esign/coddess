# HANDOFF — Coddess: Open Source Vibe Coding Dashboard

**Status:** Direction locked with owner. Research + build not started. Folder is empty except this file. Pick up from "Next steps".

## What we're building
Open-source alternative to Codex/Cursor-style tooling: a **dashboard** where users add their own API keys (BYOK), point at a local folder, and orchestrate AI coding agents to build software inside it.

## Decisions (confirmed by owner — do NOT re-ask)
1. **Form factor:** Local web app — local server + browser UI (like Vibe Kanban / OpenHands). Full folder/process access, cross-platform.
2. **Agent engine:** Hybrid — (a) native agent loop via provider APIs (Anthropic, OpenAI, Google, OpenRouter, Ollama…) AND (b) pluggable executors wrapping existing CLI agents (Claude Code, Codex CLI, Aider…).
3. **Stack:** TypeScript full-stack — Node backend + React frontend. Vercel AI SDK for multi-provider routing; node-pty + xterm.js for terminals.
4. **MVP:** Orchestration board — kanban of tasks → each task runs an agent in parallel (git worktrees) → review diffs → merge. "Mission control" is the differentiator.

## Next steps (in order)
1. **Research** (web, current 2026 state — knowledge cutoffs are stale here). Three parallel tracks:
   - **Landscape:** OpenHands, Aider, Cline, Roo/Kilo Code, Continue.dev, Void, OpenCode (SST), Crush, Goose, Plandex, bolt.diy, Dyad, srcbook + newer entrants. Per tool: license, BYOK support, folder access, orchestration features, UI approach, activity/stars, user complaints → gap analysis.
   - **Orchestration UIs + gateways:** Vibe Kanban, Conductor, Crystal, claude-squad, claudecodeui/opcode; UI patterns (kanban, worktree panes, diff review). Gateways: LiteLLM, OpenRouter, Vercel AI SDK/Gateway, models.dev. How OSS apps store keys securely.
   - **Architecture deep dive:** how Vibe Kanban wraps CLI agents as executors + manages worktrees; OpenHands event stream + sandbox runtime; Claude Agent SDK / OpenAI Agents SDK as embeddable loops; PTY handling; sandboxing options (none/Docker/E2B); diff review UIs.
2. **Write docs** into `docs/`: `01-landscape.md` (comparison + gaps), `02-architecture.md` (components: server, agent runtime, executor plugin API, worktree manager, key vault, event bus/WebSocket, React board UI), `03-vision.md` (name, differentiators, feature brainstorm), `04-roadmap.md` (phased MVP → v1).
3. **Seed repo:** `README.md` with vision + architecture sketch.
4. **Mockup:** single-file clickable HTML dashboard mockup (`mockup/dashboard.html`) — board view, task detail with agent log + diff tab, settings/API-keys screen.
5. **Then scaffold:** monorepo (pnpm), `apps/server` (Node/Fastify + WS), `apps/web` (React/Vite), `packages/agent-core` (native loop), `packages/executors` (CLI wrappers). Kanban → worktree → agent run → diff → merge as the vertical slice.

## Architecture sketch (starting point, refine with research)
Browser UI (React: board, task view: chat/terminal/diff) ⇄ WebSocket ⇄ Node server (task queue, git worktree per task, executor registry, provider router, encrypted key store) → agents run in worktrees of the user-selected folder.

## Owner preferences
Concise, direct communication. Proactive/creative mode — bring ideas, don't wait to be asked. Research → analyze → brainstorm → build.
