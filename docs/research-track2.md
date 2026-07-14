# Coddess Research — Track 2

Current-as-of mid-2026 web research for **Coddess**, an open-source BYOK "vibe coding" dashboard
(local Node + React web app; add API keys, point at a folder, orchestrate AI coding agents in parallel
on git worktrees with a kanban "mission control" board).

Two areas covered:

- **Area A** — Orchestration UIs (tools that run/coordinate multiple coding-agent sessions).
- **Area B** — Provider gateways / multi-provider routing + secure API-key storage.

All claims cite live URLs inline. Figures (stars, versions, dates) are as observed July 2026.

---

## Area A — Orchestration UIs for coding agents

### At-a-glance comparison

| Tool | License | Stars (Jul 2026) | Platform / stack | Isolation model | Primary UI metaphor | Status |
|---|---|---|---|---|---|---|
| **Vibe Kanban** (BloopAI) | Apache-2.0 | ~27.1k | Local web app via `npx`; Rust backend + React/TS; SQLite | **Git worktree per workspace** (+ branch, terminal, dev server) | **Kanban board** -> workspaces | **Sunsetting** (still OSS, self-hostable) |
| **Conductor** (Melty Labs) | Closed-source, free app (BYO Claude/Codex sub) | n/a (YC co.) | macOS only (Apple Silicon) | Git worktree per agent | Multi-pane / per-agent workspaces | Active |
| **Crystal** (Stravu) -> **Nimbalyst** | MIT (Crystal) | Crystal archived | Electron desktop | Git worktree per session | Session list + diff/compare panes | **Crystal deprecated Feb 2026** (v0.3.5); succeeded by Nimbalyst (commercial) |
| **claude-squad** (smtg-ai) | AGPL-3.0 | ~7.9k | Terminal (Go) TUI | Git worktree + **tmux** session per agent | Terminal panes / session switcher | Active |
| **claudecodeui / CloudCLI** (siteboon) | AGPL-3.0-or-later | ~12.4k | Web + mobile UI (Node) | Wraps Claude Code sessions (no worktree layer of its own) | Chat + project/session manager, remote/mobile | Active |
| **opcode** (formerly Claudia; winfunc) | AGPL-3.0 | ~21k | Desktop, **Tauri 2** | Session-based; custom agents, background agents | Chat GUI + agent/usage dashboards | Active (rebranded from Claudia mid-2025) |
| **Sculptor** (Imbue) | Source-available (see repo) | — | Desktop; **Docker containers** | **Container per agent** (not just worktree) | Parallel-agent cards + "Pairing Mode" | Active |

Sources: [Vibe Kanban repo](https://github.com/BloopAI/vibe-kanban) - [Conductor](https://www.conductor.build/) / [YC](https://www.ycombinator.com/companies/conductor) - [Crystal repo](https://github.com/stravu/crystal) - [claude-squad repo](https://github.com/smtg-ai/claude-squad) - [claudecodeui repo](https://github.com/siteboon/claudecodeui) - [opcode repo](https://github.com/winfunc/opcode) - [Sculptor repo](https://github.com/imbue-ai/sculptor) - overview: [Augment Code - 9 open-source agent orchestrators](https://www.augmentcode.com/tools/open-source-agent-orchestrators), [Nimbalyst - best Claude Code GUIs 2026](https://nimbalyst.com/blog/best-claude-code-gui-tools-2026/)

### Detailed notes

**Vibe Kanban (the closest reference architecture for Coddess).**
Rust backend + React/TS frontend, launched with a single `npx vibe-kanban`, local-first: **code state
in Git, workflow state in SQLite** ([repo](https://github.com/BloopAI/vibe-kanban)). Its explicit
workflow — *plan on kanban -> each workspace gives an agent a branch + terminal + dev server -> review
diffs with inline comments -> open PR / merge* — is almost exactly Coddess's intended loop. It supports
**10+ agents** (Claude Code, Codex, Gemini CLI, GitHub Copilot, Amp, Cursor, OpenCode, Droid, CCR, Qwen)
behind one board, and ships a built-in **preview browser with devtools + device emulation**. It is
**self-hostable** (Docker, reverse-proxy notes, `VK_ALLOWED_ORIGINS` origin control) and uses git worktree
cleanup logic (`DISABLE_WORKTREE_CLEANUP` for debugging).
**Important 2026 update:** the project is **sunsetting** ([shutdown announcement](https://www.vibekanban.com/blog/shutdown)),
which is *good news for Coddess* — it validates the exact niche and leaves an Apache-2.0 codebase to learn
from, while the market gap reopens. Architecture writeup: [Starlog](https://starlog.is/articles/ai-dev-tools/bloopai-vibe-kanban/),
review: [Eleanor Berger](https://elite-ai-assisted-coding.dev/p/vibe-kanban-tool-review).

**Conductor (Melty Labs).** Free native **macOS** app (Apple Silicon), BYO Claude/Codex subscription; runs
several Claude Code sessions in parallel, each in its own git worktree/branch, with a clean per-agent
workspace pane ([conductor.build](https://www.conductor.build/),
[madewithlove review](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/),
[The New Stack hands-on](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/)).
Closed-source and Mac-only — the exact gap Coddess fills (cross-platform, OSS, BYOK). Take its polished
per-agent workspace UX, not its distribution model.

**Crystal -> Nimbalyst (Stravu).** Crystal was an MIT Electron desktop app for parallel Codex/Claude Code
sessions in worktrees with strong diff/compare panes; **deprecated 26 Feb 2026 (v0.3.5)** and redirected to
the commercial **Nimbalyst** ([repo](https://github.com/stravu/crystal),
[Nimbalyst](https://nimbalyst.com/crystal/)). MIT code remains a good reference for the
"compare two agents' approaches side by side" pattern.

**claude-squad (smtg-ai).** AGPL-3.0 Go **terminal** app; manages multiple agents (Claude Code, Codex,
OpenCode, Amp, Aider) each in an **isolated git worktree + tmux session**, with a TUI session switcher and
per-edit review ([repo](https://github.com/smtg-ai/claude-squad),
[DEV writeup](https://dev.to/stevengonsalvez/claude-squad-run-multiple-ai-agents-in-parallel-without-the-mess-1hfl)).
Good source for the worktree+process-supervision plumbing Coddess needs on the backend; UI is terminal-only.

**claudecodeui / CloudCLI (siteboon).** AGPL-3.0 **web + mobile** UI that manages Claude Code / OpenCode /
Cursor CLI / Codex sessions remotely ([repo](https://github.com/siteboon/claudecodeui)). Notable for the
**remote/mobile** angle (control agents from your phone) and being a Node web app like Coddess — but it does
not add its own worktree/kanban orchestration layer.

**opcode (formerly Claudia; winfunc).** AGPL-3.0, **Tauri 2** desktop, ~21k stars — the most popular
Claude Code GUI. Focus is a polished chat interface, **custom agents, secure background agents, and
usage/cost dashboards** rather than kanban/worktree orchestration ([repo](https://github.com/winfunc/opcode),
[opcode.sh](https://opcode.sh/)). Copy its **usage-tracking dashboard** and custom-agent editor.

**Sculptor (Imbue).** The distinct one: each agent runs in its own **Docker container sandbox** (not just a
worktree), so agents can't touch your local repo until you approve. **"Pairing Mode"** pulls a container's
work into your local repo/IDE with one click and keeps git state synced for live testing; merge UI lets you
**keep-what-you-want / drop-what-you-don't** and auto-flags conflicts
([announce](https://imbue.com/blog/sculptor-announce), [product](https://imbue.com/sculptor/),
[repo](https://github.com/imbue-ai/sculptor), [fast containers](https://imbue.com/blog/containers)).
Container isolation is stronger than worktrees but heavier; consider it an optional "safe mode" for Coddess.

### UX patterns worth copying (Area A)

1. **Kanban -> workspace lifecycle (Vibe Kanban).** Cards move `Backlog -> In Progress -> Review -> Done`; hitting
   "In Progress" *provisions a workspace* = worktree + branch + terminal + dev server. The board doubles as
   mission control and as the queue of agent runs. This is Coddess's spine.
2. **Per-agent isolated workspace with branch + terminal + live dev server + preview browser** (Vibe Kanban,
   Conductor). Each agent run is fully self-contained; user can open a terminal into the worktree and see a
   live preview without leaving the app.
3. **Inline-comment diff review that feeds back to the agent** (Vibe Kanban). Reviewer leaves comments on the
   diff; comments are sent to the agent as the next instruction — no context switch to GitHub. Pair with a
   **"keep/drop hunks + auto conflict flag"** merge step (Sculptor) and **side-by-side approach comparison**
   (Crystal) when running the same task with two agents/models.
4. **PR automation + usage/cost dashboard** (Vibe Kanban PRs with AI-generated descriptions; opcode usage
   tracking). One click to open a PR with generated title/body; a persistent panel showing tokens/cost per
   agent run and per model. (Optional 5th: **container "safe mode"** and **remote/mobile control** from
   Sculptor and claudecodeui if Coddess wants those later.)

---

## Area B — Provider gateways, multi-provider routing & secure key storage

### Gateway comparison

| Gateway | License / hosting | Normalization | Streaming | Tool calling | Cost/usage tracking | Fee | BYOK |
|---|---|---|---|---|---|---|---|
| **LiteLLM** (BerriAI) | MIT, **self-host** (Python proxy/SDK) + paid enterprise | 100+ providers -> OpenAI format (or native) | Yes | Yes | Built-in: virtual keys, budgets, Prometheus `/metrics`, spend/audit logs | **$0 markup** (OSS) | Native (your keys) |
| **OpenRouter** | Hosted SaaS | 400+ models / 60+ providers, OpenAI-style API | Yes | Yes | Dashboard analytics, per-provider price/latency | 5.5% on credit purchases; **BYOK free for first 1M req/mo, then 5%** | Yes (60+ providers) |
| **Vercel AI Gateway** (+ AI SDK) | Hosted; tied to AI SDK | Many providers via AI SDK | Yes | Yes (AI SDK tools) | Credits then pay-as-you-go | **$0 markup** (incl. own keys); $5/mo starter credit | Yes |
| **Requesty** | Hosted (Rust) | 400+ models, OpenAI-compatible endpoint | Yes | Yes | Built-in analytics + caching | Flat **5% markup**; caching often offsets | Yes |
| **models.dev** (SST) | **MIT, OSS data** | *Not a gateway* — model **catalog/pricing DB** (JSON API + typed SDK) | n/a | n/a | Provides pricing metadata to compute cost | Free | n/a |
| **Portkey / Bifrost / LLM Gateway** | OSS self-host (MIT/OSS) | Multi-provider, OpenAI-compatible | Yes | Yes | Varies | $0 (self-host) | Yes |

Sources: [LiteLLM repo](https://github.com/BerriAI/litellm) / [docs](https://docs.litellm.ai/docs/) -
[OpenRouter BYOK](https://openrouter.ai/docs/guides/overview/auth/byok) / [pricing](https://openrouter.ai/pricing) /
[1M free BYOK](https://openrouter.ai/blog/announcements/1-million-free-byok-requests-per-month/) -
[Vercel vs OpenRouter (Inworld)](https://inworld.ai/resources/ai-gateway-comparison) -
[Requesty comparison](https://www.requesty.ai/blog/best-llm-routing-platforms-compared-2026-requesty-portkey-litellm-openrouter) -
[models.dev](https://models.dev/) / [repo](https://github.com/anomalyco/models.dev) -
gateway roundups: [MCP.Directory 2026](https://mcp.directory/blog/vercel-ai-gateway-vs-portkey-vs-openrouter-vs-litellm-2026),
[Klymentiev](https://klymentiev.com/blog/llm-gateway-guide),
[TrueFoundry LiteLLM vs OpenRouter](https://www.truefoundry.com/blog/litellm-vs-openrouter),
[Braintrust - best LLM gateways](https://www.braintrust.dev/articles/best-llm-gateways-2026).

### How they normalize across providers

The market splits cleanly: **hosted aggregators built for breadth** (OpenRouter, Requesty, Vercel AI Gateway)
vs **self-hostable proxies built for control** (LiteLLM, Portkey, Bifrost)
([TrueFoundry](https://www.truefoundry.com/blog/litellm-vs-openrouter)). Nearly all expose a single
**OpenAI-compatible endpoint** and transparently translate provider dialects — e.g., normalizing **Anthropic's
SSE stream format to OpenAI's** so streaming + tool-calling work uniformly across Anthropic / OpenAI / Google /
Ollama ([DEV self-hosted proxy writeup](https://dev.to/sabahattink/i-built-a-self-hosted-llm-proxy-that-supports-12-providers-claude-gpt-4o-gemini-ollama-3ej1)).

- **LiteLLM** — 100+ providers incl. **Ollama** for local models, one OpenAI-compatible endpoint (or native
  passthrough), **self-hosted with $0 markup**, and the richest built-in ops layer: **virtual keys, per-project
  budgets, spend/cost tracking, Prometheus `/metrics`, audit logs, guardrails**. OSS build already includes the
  proxy + Admin UI + keys + budgets ([ALMtoolbox](https://www.almtoolbox.com/blog/litellm-ai-gateway-cost-tracking-guardrails-budgets/),
  [Local AI Master](https://localaimaster.com/blog/ai-gateway-litellm)). Enterprise add-ons ($250/mo basic) add SSO/JWT.
- **OpenRouter** — widest hosted catalog, least setup; **BYOK is effectively free** up to 1M requests/month
  (then 5%), so users' own Anthropic/OpenAI/Google keys are billed by the underlying provider while OpenRouter
  handles failover + spend controls ([BYOK docs](https://openrouter.ai/docs/guides/overview/auth/byok)).
- **Vercel AI Gateway** — best if already in the Vercel/AI-SDK ecosystem; $0 markup incl. own keys.
- **Requesty** — managed, flat 5%, strong caching (40-60% savings) and low latency.
- **models.dev** — not a router; the **open pricing/spec catalog** (JSON at `/api.json`, `/models.json`,
  `/catalog.json`, plus a typed SDK with offline snapshot) Coddess can pull to render model pickers and compute
  per-run cost ([models.dev](https://models.dev/), [repo](https://github.com/anomalyco/models.dev)).

### Recommended gateway approach for Coddess

Because Coddess is **BYOK + local + open-source**, do **not** hard-wire a hosted aggregator. Recommended:

1. **Talk to each provider natively via a thin internal adapter layer** (Anthropic, OpenAI, Google, plus
   **Ollama** for local) so users' own keys hit providers directly — no third-party markup, no data detour,
   true BYOK. Normalize to one internal streaming + tool-call shape (OpenAI-style is the de-facto lingua franca).
   The **Vercel AI SDK** is a strong candidate for this adapter layer if Coddess wants to avoid writing every
   provider client by hand while staying self-hosted.
2. **Optionally allow an OpenRouter or LiteLLM base URL** as a single "gateway provider" for power users who
   want 400+ models / failover / central budgets — since both are OpenAI-compatible, this is one extra adapter,
   not a rewrite. LiteLLM is the recommended *self-hosted* option (MIT, $0 markup, built-in budgets/metrics)
   for users who want a gateway they control.
3. **Use models.dev's open catalog** for the model list, capability flags, and pricing to power the model
   picker and per-run cost/usage tracking — no need to hand-maintain price tables.

### Secure API-key storage — best practices

Coddess is a **local Node web app** (not Electron), so `safeStorage` (Electron-only) doesn't directly apply,
but the underlying OS-keychain strategy does. Ranked recommendation:

1. **OS keychain via a Node native module (best default).** Use **keytar-style** access to
   **macOS Keychain / Windows Credential Manager (DPAPI) / Linux libsecret (gnome-keyring / kwallet)**. The
   secret is stored/encrypted by the OS under the user's login; the app only calls `getPassword` / `setPassword`
   and never persists plaintext ([keytar](https://github.com/atom/node-keytar),
   [Cameron Nokes guide](https://cameronnokes.com/blog/how-to-securely-store-sensitive-information-in-electron-with-node-keytar/)).
   Note keytar is archived; in 2026 use a maintained equivalent, and on Linux require `libsecret-1-dev`. Electron
   apps get this "for free" via `safeStorage` (macOS Keychain / Windows DPAPI / Linux libsecret)
   ([Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)).
2. **Encrypted-at-rest config as fallback** (when no keychain is available, e.g. headless Linux/Docker).
   Encrypt keys with **AES-256-GCM** using a key **derived from a user master password via a strong KDF**
   (Argon2id / scrypt / PBKDF2). Critical correctness rules: **never reuse a (key, nonce) pair**, generate a
   fresh random 96-bit nonce per encryption, store the auth tag, and **never use the password directly as the
   key** ([AES-256-GCM guide](https://shattered.io/aes-256-encryption-nodejs/)). Prefer Node's `KeyObject` API
   over raw string/Buffer keys.
3. **Environment variables / `.env`** — acceptable for dev/self-host-in-a-container, but plaintext on disk;
   gate behind clear docs and never the default for desktop users.
4. **Cross-cutting rules regardless of backend:** keep keys **server-side only** (Node process), never ship
   them to the React client or embed in the bundle; scope keys to the main process; store per-provider entries;
   handle the user deleting the OS entry out from under you; redact keys in logs; and remember process-level
   boundaries — anything running Node in-process can read decrypted secrets, so OS encryption protects
   at-rest/other-apps, not a compromised local process
   ([safeStorage limitations](https://chenguangliang.com/en/posts/blog169_electron-credential-storage-security/)).

**Recommendation:** default to **OS keychain (keytar-style)** with an **AES-256-GCM + Argon2id master-password
vault** as the portable fallback, and **env vars** only for container/CI. Keys live only in the Node backend.

---

## Sources (consolidated)

- Vibe Kanban: https://github.com/BloopAI/vibe-kanban - https://www.vibekanban.com/blog/shutdown - https://starlog.is/articles/ai-dev-tools/bloopai-vibe-kanban/ - https://elite-ai-assisted-coding.dev/p/vibe-kanban-tool-review
- Conductor: https://www.conductor.build/ - https://www.ycombinator.com/companies/conductor - https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/ - https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/
- Crystal / Nimbalyst: https://github.com/stravu/crystal - https://nimbalyst.com/crystal/
- claude-squad: https://github.com/smtg-ai/claude-squad - https://dev.to/stevengonsalvez/claude-squad-run-multiple-ai-agents-in-parallel-without-the-mess-1hfl
- claudecodeui: https://github.com/siteboon/claudecodeui
- opcode / Claudia: https://github.com/winfunc/opcode - https://opcode.sh/ - https://claudiacode.com/
- Sculptor: https://imbue.com/blog/sculptor-announce - https://imbue.com/sculptor/ - https://github.com/imbue-ai/sculptor - https://imbue.com/blog/containers
- Roundups: https://www.augmentcode.com/tools/open-source-agent-orchestrators - https://nimbalyst.com/blog/best-claude-code-gui-tools-2026/ - https://nimbalyst.com/blog/best-agent-management-tools-2026/
- LiteLLM: https://github.com/BerriAI/litellm - https://docs.litellm.ai/docs/ - https://www.almtoolbox.com/blog/litellm-ai-gateway-cost-tracking-guardrails-budgets/ - https://localaimaster.com/blog/ai-gateway-litellm
- OpenRouter: https://openrouter.ai/docs/guides/overview/auth/byok - https://openrouter.ai/pricing - https://openrouter.ai/blog/announcements/1-million-free-byok-requests-per-month/
- Vercel AI Gateway / comparisons: https://inworld.ai/resources/ai-gateway-comparison - https://mcp.directory/blog/vercel-ai-gateway-vs-portkey-vs-openrouter-vs-litellm-2026 - https://klymentiev.com/blog/llm-gateway-guide - https://www.truefoundry.com/blog/litellm-vs-openrouter - https://www.braintrust.dev/articles/best-llm-gateways-2026
- Requesty: https://www.requesty.ai/blog/best-llm-routing-platforms-compared-2026-requesty-portkey-litellm-openrouter
- models.dev: https://models.dev/ - https://github.com/anomalyco/models.dev
- Key storage: https://github.com/atom/node-keytar - https://www.electronjs.org/docs/latest/api/safe-storage - https://cameronnokes.com/blog/how-to-securely-store-sensitive-information-in-electron-with-node-keytar/ - https://shattered.io/aes-256-encryption-nodejs/ - https://chenguangliang.com/en/posts/blog169_electron-credential-storage-security/
