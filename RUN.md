# Running the Coddess test build

A thin, working vertical slice: add a project folder → describe what to build → a local model (via Ollama) runs an autonomous agent loop that writes files into that folder, streamed live to the dashboard.

## Prerequisites

- **Node.js 20+** (`node -v`)
- **[Ollama](https://ollama.com)** running locally, with a capable coding model pulled. Recommended:
  ```
  ollama pull qwen2.5-coder
  ```
  (Any instruction-following model works — `qwen2.5-coder`, `llama3.1`, `deepseek-coder-v2`, etc. Bigger = better at following the build protocol.)

## Start

From the repo root (`D:\Projekti\Coddess`):

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

- `npm run dev` starts the server (port 3001) and the web dashboard (port 5173) together.
- Make sure Ollama is running (`ollama serve`, or the desktop app). The sidebar shows a green dot when it's reachable.

## Use it

1. **Add a project** — paste a folder path into the sidebar (e.g. `D:\Projekti\test-site`) and click **Add project**. Point it at an empty folder to watch it build from scratch, or an existing one to have it work in context.
2. **Pick a model** — top-right dropdown lists your installed Ollama models. The choice is saved per project.
3. **Describe the build** — e.g. *"Build a responsive landing page for a coffee shop with a hero, menu, and contact section."* Press **Run agent** (or ⌘/Ctrl+Enter).
4. **Watch** — the agent's thinking, tool calls (`write_file`, `read_file`, `list_dir`, `run`), and results stream into the left pane. Files appear in the right pane as they're written; click any file to view it.

## Config (optional env vars)

| Var | Default | Purpose |
|---|---|---|
| `CODDESS_PORT` | `3001` | Server port |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama endpoint |
| `CODDESS_MODEL` | `qwen2.5-coder` | Default model when a project has none |
| `CODDESS_MAX_STEPS` | `40` | Safety cap on agent loop iterations |
| `CODDESS_ALLOW_SHELL` | on | Set to `0` to disable the `run` shell tool |

## What this test build is (and isn't) — yet

**Is:** per-project dashboards, a model-agnostic agent loop driven entirely by the system prompt (`apps/server/src/agent/systemPrompt.ts` — the "intelligence harness"), scoped file tools, live streamed events, an editable file view.

**Not yet:** git worktrees, kanban board, diff-review-gated merge, multiple providers, parallel tasks. Those are the next phases in [`docs/04-roadmap.md`](docs/04-roadmap.md).

## Where to give feedback / tune

- **The system prompt is the product.** If runs feel dumb, verbose, or go off-protocol, that's the first place to iterate: `apps/server/src/agent/systemPrompt.ts`.
- **The action protocol** (how the model asks for tools) lives in `apps/server/src/agent/protocol.ts`.
- **Tools** the agent can use: `apps/server/src/agent/tools.ts`.
