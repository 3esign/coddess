# Coddess — Vision

## The one-line pitch

**Coddess is the open-source, cross-platform "mission control" for AI coding agents** — a local BYOK dashboard where you point at a folder, spin up any agent (Claude Code, Codex, Aider, or a native multi-provider loop) on parallel git worktrees, watch them work on a kanban board, and review + merge their diffs.

## Why now (the market gap)

Mid-2026 research found the engine layer is commoditized and abundant — OpenCode, OpenHands, Cline, Goose, Aider, Kilo are all BYOK, multi-provider, and mature. The **orchestration layer**, however, is fragmented and unstable, and every viable option is missing at least one of {open-source, cross-platform, web-based, truly BYOK}:

- **Vibe Kanban** — the closest reference (Apache-2.0, kanban → worktree → diff → PR, exactly Coddess's loop) — is **sunsetting** after its parent shut down. It validates the niche and leaves code to learn from, and reopens the gap.
- **Conductor** — polished, but **macOS-only and closed-source**.
- **Crystal** — **deprecated** (Feb 2026), redirected to a commercial successor.
- **Claude Squad** — **TUI-only**.
- **Kilo Agent Manager** — locked **inside VS Code**.
- Most orchestrators wrap only subscription-gated Claude Code / Codex rather than being engine-agnostic BYOK.

**There is no open-source, web-based, cross-platform, engine-agnostic kanban control plane for coding agents.** That is the whitespace Coddess owns.

## Differentiators

1. **Mission control, not a chat box.** A kanban board *is* the primary interface: the queue of agent runs, their live status, and their review gates in one view. Most tools give you one agent and a chat pane.
2. **Engine-agnostic + BYOK.** Any agent, any provider, your keys, no markup, no lock-in. Native loop for provider-agnostic runs; CLI executors for people who love their existing agent.
3. **Cross-platform web app.** Runs anywhere Node runs — Mac, Windows, Linux, and remotely from a browser. Not a Mac-only native app, not an IDE extension.
4. **Parallelism done safely.** One worktree per task means real parallel agents without stepping on each other, and review-before-merge means the blast radius is always a branch you can throw away.
5. **Review is first-class, not an afterthought.** Inline-comment diff review that feeds comments straight back to the agent; keep/drop-hunks merge with conflict flagging; side-by-side comparison when two agents attempt the same task.
6. **Open source.** Permissive license, self-hostable, auditable key handling. The trust story competitors with closed clients can't tell.

## Name

Working name **Coddess** (open-source code). Kept for now; a naming pass can come before public launch. Candidate directions if we rename: something evoking *mission control / orchestration* rather than yet another "code" name.

## Who it's for

- Solo developers and small teams who want to run several agents at once without a subscription tier deciding which agent they use.
- People who already live in Claude Code / Codex / Aider and want a board to orchestrate them instead of juggling terminals and tmux.
- Privacy-conscious / self-hosting users who want their keys in their own OS keychain and their code never leaving their machine.

## Feature brainstorm (beyond MVP)

**Orchestration & workflow**
- Task dependencies / pipelines (task B starts when A merges) — an unsolved gap across the ecosystem.
- Task templates / recipes (reusable prompts + agent + config) shareable across a team.
- "Race mode" — same task to N agents/models, compare results side by side, keep the best.
- Auto-fan-out: split a large task into subtasks across worktrees.

**Review & merge**
- Semantic (not just file-level) merge conflict help — flag when two agents changed the same logic.
- One-click PR with AI-generated title/body; batch-merge a column.
- Review comments as the next agent instruction (close the loop in-app).

**Safety & environments**
- Opt-in Docker "safe mode" workspace for untrusted templates.
- Per-task permission policies (auto vs supervised); dangerous-tool approval routed to the board.
- Remote/mobile control — kick off and review runs from a phone.

**Cost & observability**
- Live tokens/cost per run and per model, using the models.dev catalog.
- Per-project budgets and spend caps (LiteLLM-style) when a gateway is configured.
- Full replay of any run from its event log.

**Ecosystem**
- Executor plugin API so the community can add new CLI agents.
- MCP server support surfaced per task.
- Import/export boards; shareable task recipes.

## Non-goals (for now)

- Not an IDE or editor — it orchestrates agents, it doesn't replace VS Code.
- Not a hosted SaaS — local-first; a hosted tier is a *later*, optional escalation.
- Not a model provider — BYOK, always.
