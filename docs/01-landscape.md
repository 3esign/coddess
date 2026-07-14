# Coddess Landscape Analysis — Open-Source AI Coding Agents (Mid-2026)

> Research date: 2026-07-12. All star counts and statuses reflect the mid-2026 landscape and are approximate — GitHub metrics move fast. Sources cited inline.

## Purpose

Coddess is an open-source, BYOK (bring-your-own-API-key) "vibe coding" dashboard: point it at a folder, and orchestrate multiple AI agents to build software. Its intended differentiator is a **"mission control" kanban board that orchestrates parallel agents on git worktrees with first-class diff review** — a web-based, provider-agnostic, cross-platform control plane.

This document surveys the current open-source competition across two overlapping categories:

1. **Coding agents** — the underlying engines (OpenHands, Aider, Cline, Kilo Code, OpenCode, Crush, Goose, Plandex, etc.).
2. **Orchestrators / control planes** — the tools that run many agents in parallel (Vibe Kanban, Conductor, Nimbalyst, Claude Squad, Kilo Agent Manager).

Coddess sits in category 2 but with a distinctive web-first, kanban-centric, BYOK posture.

---

## Comparison Table — Coding Agents

| Tool | License | Stack | BYOK / Multi-provider | Local folder | Orchestration / parallel | UI | ~Stars | Activity | Key gaps / complaints |
|------|---------|-------|----------------------|--------------|--------------------------|-----|--------|----------|-----------------------|
| **OpenHands** (ex-OpenDevin) | MIT | Python | Yes — any LLM via OpenRouter, direct keys, Ollama | Yes (sandboxed Docker) | Planning Mode (beta); single primary CodeAct agent | Web UI + CLI + cloud | ~70–79k | Very active (v1.6.0 Mar 2026, K8s support) | Heavy Docker setup; resource-hungry; not a lightweight local dashboard |
| **Aider** | Apache-2.0 | Python | Yes — 100+ LLMs, local models | Yes (git-native) | None (single session) | CLI/terminal | ~40–45k | Active but slower release pace | Terminal-only, no UI; steep curve; historically edit-only |
| **Cline** | Apache-2.0 | TypeScript | Yes — many providers, OpenRouter | Yes | None native (single agent, Plan/Act) | VS Code / JetBrains extension | ~58k | Very active | BYOK token costs unpredictable ($50–500/mo heavy use); single-agent |
| **Roo Code** | Apache-2.0 | TypeScript | Yes | Yes | Multi-mode | VS Code extension | ~22k (archived) | **Archived May 2026** — team pivoted to Roomote (Slack cloud agent) | Discontinued as IDE tool |
| **Kilo Code** | MIT / Apache-2.0 | TypeScript | Yes — 500+ models, top OpenRouter consumer | Yes | **Agent Manager (GA Apr 2026): parallel subagents + git worktree isolation** | VS Code / JetBrains / CLI / Cloud | ~16–20k | Very active, ~1.5M users; merged Roo+Cline lineage | IDE-bound; worktree orchestration lives inside VS Code, not a standalone board |
| **Continue.dev** | Apache-2.0 | TS | Yes | Yes | Async PR agents | IDE ext / CLI | ~20k+ | **Acquired by Cursor 2026; OSS repo read-only, v2.0 final** | OSS effectively frozen; pivoted to "Continuous AI" PR agents |
| **Void** | Apache-2.0 | TS (VS Code fork) | Yes | Yes | None | Full IDE | ~28k | **Paused 2025**, may not resume | Development halted |
| **OpenCode** (SST/opencode-ai) | MIT | TypeScript | Yes — 75+ providers | Yes | Session-based; TUI | Terminal (TUI) + client/server | ~160–178k | Extremely active; most-starred OSS coding agent | Terminal-first; no native visual board/kanban |
| **Crush** (Charm) | MIT (FSL-ish; verify) | Go | Yes | Yes | Session-based | Polished TUI | smaller community | Active (Charm team + original author) | Smaller ecosystem; TUI-only |
| **Goose** (Block → Linux Foundation/AAIF) | Apache-2.0 | Rust | Yes — 15+ providers, Ollama | Yes | **Subagents (parallel) + Recipes (YAML workflows)** | Desktop app + CLI + API | ~38–50k | Very active; donated to LF AAIF Dec 2025 | MCP-heavy config; subagents not surfaced as a visual board |
| **Plandex** | MIT | Go | Yes — Anthropic/OpenAI/Google/OpenRouter/OSS | Yes | Cumulative diff-review sandbox; autonomy modes | Terminal | ~11k | Active; **cloud winding down 2026**, self-host focus | Terminal-only; no parallel-agent board |
| **bolt.diy** | MIT | TS | Yes — OpenAI/Anthropic/Ollama/Gemini/etc. | In-browser (WebContainer) | None | Web app (self-host) | ~15k+ | Active | App-prototyping focus, not repo-scale orchestration |
| **Dyad** | Apache-2.0 (src/pro closed) | TS/Electron | Yes | Yes (local) | None | Desktop app | growing | Active | Single-agent app builder; Lovable/Bolt alternative |
| **srcbook** | Apache-2.0 | TS | Yes | Yes | None | Web notebook | mid | Active | TS-notebook niche, not general orchestration |
| **gptme** | MIT | Python | Yes — many | Yes | Background jobs; persistent agents | CLI | ~4.3k | Active (v0.31 Jan 2026) | Small; hacker/DIY autonomous-agent focus |

## Comparison Table — Orchestrators / Control Planes (Coddess's direct category)

| Tool | License | Platform | Agents wrapped | Worktree isolation | Diff review | Board / kanban UI | Web-based? | Status |
|------|---------|----------|----------------|--------------------|-------------|-------------------|-----------|--------|
| **Vibe Kanban** | Apache-2.0 | Desktop/local (Rust) | Claude Code, Codex, any CLI agent | Yes | Yes (in-app) | **Yes — kanban board** | Local web UI | **Bloop shut down Apr 2026; now community-maintained**, ~14.6k stars |
| **Conductor** | Proprietary | macOS-only native app | Claude Code, Codex | Yes | Yes + merge/PR flow | No (session list) | No | Active, closed-source, Mac-only |
| **Nimbalyst** | MIT (desktop+iOS) | macOS/Win/Linux + iOS | Claude Code, Codex | Yes | Yes | Visual workspace + editors | Native apps | Active; Crystal successor |
| **Claude Squad** | MIT | Terminal (tmux) | Claude Code, Aider, Codex, etc. | Yes | Terminal diffs | No — TUI | No | Active |
| **Kilo Agent Manager** | MIT | Inside VS Code | Kilo subagents | Yes | VS Code diffs | Panel, not kanban | No (IDE) | Active (GA Apr 2026) |
| **Crystal** | — | Desktop | Claude Code, Codex | Yes | Yes | No | No | **Deprecated Feb 2026 → Nimbalyst** |

---

## Prose Notes by Tool

### The dominant engines
- **OpenCode (SST)** is the runaway popularity leader (~160–178k stars), a terminal-native TypeScript agent supporting 75+ providers with a client/server architecture. It is the go-to BYOK engine but ships no visual board. ([Developers Digest](https://www.developersdigest.tech/blog/opencode-developer-guide-2026), [sst/opencode](https://github.com/sst/opencode))
- **OpenHands** (~70–79k) is the most capable autonomous "software engineer" but is Docker-heavy and cloud-oriented; its Planning Mode (v1.6.0, Mar 2026) hints at orchestration but it is not a multi-agent board. ([vibecoding.app](https://vibecoding.app/blog/openhands-review), [theaiagentindex](https://theaiagentindex.com/agents/openhands))
- **Cline (~58k)** and **Kilo Code (~16–20k, ~1.5M users)** dominate the IDE-extension space. Kilo merged the Roo + Cline lineages and shipped **Agent Manager (GA Apr 2026)** — parallel subagents with git-worktree isolation — the closest incumbent to Coddess's worktree orchestration, but confined inside VS Code. ([frontman.sh](https://frontman.sh/blog/best-open-source-ai-coding-tools-2026/), [explainx.ai](https://www.explainx.ai/blog/kilo-code-ai-coding-agent-guide-2026), [kilo.ai](https://kilo.ai/compare/roo-vs-cline-vs-kilo))
- **Aider (~40–45k)** remains the beloved terminal purist — git-native, tree-sitter repo maps, 100+ LLMs — but single-session, no UI, slower release cadence. ([toolbrain.net](https://toolbrain.net/aider-review-2026/), [github.com/aider-ai/aider](https://github.com/aider-ai/aider))
- **Goose (~38–50k)**, now under the Linux Foundation's Agentic AI Foundation, offers **parallel subagents + YAML "Recipes"** and deep MCP extensibility — powerful but config-heavy and not surfaced visually. ([effloow.com](https://effloow.com/articles/goose-open-source-ai-agent-review-2026), [aaif.io](https://aaif.io/projects/goose/))
- **Plandex (~11k)** pioneered the **cumulative diff-review sandbox** and 2M-token context for large tasks; terminal-only, cloud winding down in favor of self-host. ([vibecodinghub.org](https://vibecodinghub.org/tools/plandex), [github.com/plandex-ai/plandex](https://github.com/plandex-ai/plandex))

### Consolidation and casualties (2026 was a culling year)
- **Roo Code archived (May 2026)** — team declared "IDEs are not the future," pivoted to Roomote (Slack cloud agent). ([wetheflywheel](https://wetheflywheel.com/en/comparisons/opencode-vs-roo-code-vs-cline/))
- **Continue.dev acquired by Cursor (2026)** — OSS repo read-only, v2.0 final. ([vibecoding.app](https://vibecoding.app/blog/continue-dev-review))
- **Void paused (2025)**, may not resume as an IDE. ([stoneforge.ai](https://stoneforge.ai/blog/open-source-ai-coding-agents/))
- **Crystal deprecated (Feb 2026) → Nimbalyst.** ([nimbalyst.com](https://nimbalyst.com/blog/best-git-worktree-tools-ai-coding-2026/))
- **Vibe Kanban's parent Bloop shut down (Apr 2026)**; project survives as community-maintained Apache-2.0. ([vibekanban.com/blog/shutdown](https://www.vibekanban.com/blog/shutdown))

### App builders (adjacent, not direct competitors)
- **bolt.diy** (self-host Bolt fork, WebContainer, BYOK) and **Dyad** (local Apache-2.0 app builder, v0/Lovable/Bolt alternative) target *from-scratch app generation* in-browser/desktop, not repo-scale multi-agent orchestration. **srcbook** is a TS-notebook niche; **gptme** (~4.3k) is a hacker-oriented terminal autonomous agent. ([github.com/stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy), [github.com/dyad-sh/dyad](https://github.com/dyad-sh/dyad), [gptme.org](https://gptme.org/))

### The orchestrator field (Coddess's real competition)
Git worktrees became "load-bearing" for AI coding in Q1 2026, and a wave of parallel-agent control planes followed ([augmentcode.com](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)):
- **Vibe Kanban** is the clearest expression of the "agent kanban board" idea — issues on a board, agents in worktree workspaces, diffs reviewed in-app — but now on best-effort community support after Bloop's collapse. ([elite-ai-assisted-coding.dev](https://elite-ai-assisted-coding.dev/p/vibe-kanban-tool-review))
- **Conductor** is a polished but **macOS-only, closed-source** Mac app for parallel Claude Code/Codex. ([nimbalyst.com](https://nimbalyst.com/compare/nimbalyst-vs-conductor/))
- **Nimbalyst** (MIT, cross-platform desktop + iOS) is the most feature-rich open successor to Crystal, but it is a native-app visual workspace, not a web dashboard. ([nimbalyst.com](https://nimbalyst.com/blog/best-multi-agent-desktop-apps-claude-code-codex-2026/))
- **Claude Squad** is terminal/tmux-based worktree juggling — powerful for TUI lovers, no visual board. ([augmentcode.com](https://www.augmentcode.com/tools/open-source-agent-orchestrators))

---

## Gap Analysis — Where Coddess Can Win

Synthesizing the survey, the ecosystem has **plenty of engines and a fragmented, unstable orchestrator layer**. Concrete gaps:

1. **No open-source, web-based, cross-platform kanban control plane.** The kanban-board orchestration idea is validated (Vibe Kanban) but that project lost its backer; the best-maintained alternatives are either **macOS-only + closed** (Conductor), **native desktop/iOS apps** (Nimbalyst), **TUI** (Claude Squad), or **locked inside VS Code** (Kilo Agent Manager). A truly **browser-based, OS-agnostic dashboard** is an open niche. Coddess's web-first posture is a genuine differentiator.

2. **Engine lock-in.** Most orchestrators wrap only Claude Code and Codex (subscription-gated). A **BYOK, provider-agnostic** board that can drive *any* engine (OpenCode, Aider, Goose, Plandex, or raw API keys) sidesteps the subscription rate-limit pain users complain about ([morphllm](https://www.morphllm.com/comparisons/claude-code-alternatives)) and the unpredictable BYOK cost anxiety ([morphllm cline-alternatives](https://www.morphllm.com/comparisons/cline-alternatives)).

3. **Worktree sprawl and semantic merge conflicts are unsolved.** Vibe Kanban users report **20 tasks → 20 worktree folders bloating disk**, and note that worktrees prevent *file-level* conflicts but not *semantic* ones ([elite-ai-assisted-coding.dev](https://elite-ai-assisted-coding.dev/p/vibe-kanban-tool-review)). Coddess can differentiate with **lifecycle management** (auto-cleanup, worktree GC) and **conflict/merge-aware review**, not just spawning worktrees.

4. **Safety defaults are a liability.** Vibe Kanban runs agents with `--dangerously-skip-permissions` by default; users flagged it as a DevOps security risk. A **diff-review-gated, approval-first** workflow (nothing merges until a human approves the diff) is both a trust and a differentiation lever.

5. **No task dependencies / pipelines.** Users want "task B waits for task A" — not clearly supported anywhere. A kanban board is the natural home for **dependency edges and staged pipelines** across parallel agents.

6. **Diff review is fragmented from orchestration.** Plandex nailed the diff sandbox but in a terminal; Conductor nails review but Mac-only. **Unifying board + worktree + rich web diff review + merge/PR flow** in one open, BYOK surface is the whitespace.

### Positioning summary
> Coddess's opportunity: be the **open-source, web-based, BYOK "mission control"** the ecosystem lost when Vibe Kanban's backer folded and that Conductor keeps closed and Mac-only — a kanban board that orchestrates *any* agent across git worktrees, with approval-gated diff review, worktree lifecycle management, and task dependencies as first-class features.

The engines are commoditized and abundant; the **orchestration + review UX layer is unstable, fragmented, and mostly non-web**. That is exactly where Coddess should plant its flag.
