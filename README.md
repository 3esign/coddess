# Coddess ⚙️🚀

<div align="center">

**Open-source, Bring-Your-Own-Key (BYOK) mission control dashboard for autonomous AI coding agents.**

[![Build Status](https://github.com/3esign/coddess/actions/workflows/ci.yml/badge.svg)](https://github.com/3esign/coddess/actions)
[![License: MIT](https://img.shields.io/github/license/3esign/coddess)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![GitHub stars](https://img.shields.io/github/stars/3esign/coddess?style=social)](https://github.com/3esign/coddess/stargazers)

<br />

<img src="assets/banner.png" alt="Coddess Banner" width="100%" style="max-width: 800px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.3);" />

</div>

---

## 🌟 The Vision

AI coding engines have become commoditized—excellent headless runtimes exist everywhere (Aider, Claude Code, Cline, Roo Code). However, the **orchestration and visual control plane** is still in its infancy. Most agent interfaces are either locked to terminal sessions, confined within a single IDE window, or run as closed-source subscription-gated services.

**Coddess is an open-source, engine-agnostic, local-first visual control plane.** It bridges the gap between raw, headless AI coding agents and local execution control. 

Point Coddess at any local directory, connect it to your preferred LLM provider (Ollama, Anthropic, Gemini, OpenRouter, DeepSeek, or any Custom API), and guide your agent through a structured, multi-root visual workspace. 

---

## 🛠️ Key Features

*   **🌐 Grouped Multi-API Provider Router** — Bring your own API keys for **OpenRouter, Anthropic (Claude), Google (Gemini), DeepSeek, Kimi**, or connect local/remote **Ollama** and **Custom OpenAI-compatible endpoints**.
*   **🧠 Persistent Project Memory** — Every project maintains its persistent state. Coddess automatically saves and resumes the agent's full chat history and workflow logs.
*   **📋 Autonomous Planning & Specification** — The agent compiles vague user prompts into a structured `Spec` (intent compiler) and follows a strict protocol, writing/updating a `PLAN.md` file as it builds.
*   **🛡️ Git Worktree & Branch Isolation** — Run multiple agent tasks simultaneously on parallel git worktrees, preventing destructive changes to your active working directory.
*   **🔬 Automated Verification & Repair** — Upon completion, Coddess automatically executes project verification scripts (builds, tests, typechecks). If they fail, the agent enters a self-repair loop (up to a custom retry limit) to fix compiling or runtime errors before finalizing.
*   **📚 Compounding Project Knowledge Base** — Coddess distills newly learned facts and architectural guidelines after every run, maintaining a compounding `knowledge.json` that is fed back into subsequent agent loops.
*   **📂 Interactive File Explorer** — Navigate, create directories, and review code side-by-side with the agent's thought logs without leaving the browser interface.
*   **⚡ Mid-Run Event Injection** — Type comments or inject new instructions into the running agent queue; the agent intercepts and processes instructions on the next turn.

---

## 📐 Architecture & System Design

Coddess utilizes a lightweight Fastify-based backend and a React-based Vite frontend. The server structures all activities into a **Normalized Event Stream**, rendering thinking blocks, surgical file diffs, and verification steps in real-time.

```mermaid
graph TD
    A[React Web Dashboard] <-->|WebSockets & REST| B[Node.js / Fastify Server]
    B --> C[Orchestration Engine]
    
    subgraph Agent Loop [Intelligence Harness]
        C --> D[Intent Compiler & Spec Builder]
        D --> E[Model Capability Profiler]
        E --> F[Execution Loop & Tool Harness]
        F -->|XML / Structured Tooling| G[Observer & Critique]
        F --> H[Verification & Self-Repair]
        H --> I[Knowledge Distiller]
    end

    subgraph Operations & Data
        F <-->|Surgical Edit / Search| J[Filesystem & Workspace]
        F <-->|Branching / Parallel Worktrees| K[Git Manager]
        I <-->|Memory Persistence| L[.coddess/knowledge.json]
    end

    subgraph API Router
        F <--> M[Provider Gateway]
        M <--> N[Ollama / Local]
        M <--> O[Frontier APIs: Anthropic, Gemini, DeepSeek, Custom]
    end
    
    style Agent Loop fill:#1f2937,stroke:#3b82f6,stroke-width:2px;
    style Operations & Data fill:#111827,stroke:#10b981,stroke-width:1px;
    style API Router fill:#111827,stroke:#8b5cf6,stroke-width:1px;
```

---

## 🚀 Getting Started

### Prerequisites

*   **Node.js** 20+ installed
*   **Git** installed and available in path
*   **Ollama** (optional, for local-first execution: `ollama run qwen2.5-coder`)

### Setup & Launch

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/3esign/coddess.git
    cd coddess
    ```

2.  **Install workspace dependencies:**
    ```bash
    npm install
    ```

3.  **Run in development mode:**
    ```bash
    npm run dev
    ```
    *   **Frontend Dashboard:** [http://localhost:8922](http://localhost:8922)
    *   **Backend API Server:** [http://localhost:8921](http://localhost:8921)

---

## ⚙️ Configuration & Environment Variables

You can configure Coddess via environment variables or manage keys directly in the **Settings** panel of the web dashboard. Keys are stored locally and encrypted at rest (`.data/.masterkey`).

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `CODDESS_PORT` | `8921` | Fastify backend API port |
| `VITE_PORT` | `8922` | Vite React frontend development port |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama service host |
| `CODDESS_MODEL` | `qwen2.5-coder` | Default model when a project has none |
| `CODDESS_MAX_STEPS` | `40` | Safety limit on agent loops before auto-termination |
| `CODDESS_ORCH_PARALLEL` | `0` | Set to `1` to enable parallel subtask worktree execution |
| `CODDESS_NATIVE_TOOLS` | `0` | Set to `1` to enable JSON tool-calling schemas for supporting models |
| `CODDESS_ALLOW_SHELL` | `1` | Set to `0` to completely block arbitrary command execution |

---

## 📖 Deep Dives & Docs

For extensive design, vision, and roadmap breakdowns, explore the `docs/` folder:
*   [Landscape Comparison & Gap Analysis](docs/01-landscape.md)
*   [Backend & Agent Architecture Design](docs/02-architecture.md)
*   [Vision & Differentiators](docs/03-vision.md)
*   [Project Roadmap (MVP to v1)](docs/04-roadmap.md)
*   [Agent Reasoning Pipeline Blueprint](docs/05-reasoning-pipeline.md)

---

## 🤝 Contributing

We welcome open-source contributions! Whether you're fixing bugs, adding new provider configurations, or improving the agent's system prompt, we're glad to have you.

1.  Review our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).
2.  Before submitting a PR, make sure all tests pass:
    ```bash
    npm run typecheck
    npm test
    ```
3.  Sign the development log by running `npm run diary` to describe your changes.

---

## 📄 License

This project is licensed under the permissive **MIT License** — see the [LICENSE](LICENSE) file for details.
