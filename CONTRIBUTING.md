# Contributing to Coddess ⚙️🚀

First of all, thank you for taking the time to contribute! Coddess is built on the belief that visual mission control dashboards are the key to unlocking the full power of autonomous AI coding agents. 

We want to build a welcoming, extensive, and humbled community. Please read this guide before making contributions.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please report any unacceptable behavior to **scumutator@gmail.com**.

---

## How to Get Involved

### 1. Reporting Bugs
- Search existing issues to see if the bug has already been reported.
- If not, open a new issue using the **Bug Report** template.
- Provide a clear description, reproduction steps, expected behavior, and system environment details.

### 2. Suggesting Features
- We love hearing new ideas! Open an issue using the **Feature Request** template.
- Explain the problem your feature resolves and outline the proposed implementation/design.

### 3. Submitting Pull Requests
- Fork the repository and create your branch from `main`.
- Keep your changes focused. If you are solving multiple unrelated issues, please submit separate pull requests.
- Write clear commit messages using the [Conventional Commits](https://www.conventionalcommits.org/) format (e.g., `feat: add custom OpenAI endpoint support`, `fix: resolve PTY buffer scroll overflow`).
- Ensure all tests and typechecks pass before submitting.

---

## Local Development Setup

To set up Coddess locally for development:

1. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/coddess.git
   cd coddess
   ```

2. **Install dependencies:**
   We use standard npm workspaces. Install all dependencies from the root:
   ```bash
   npm install
   ```

3. **Run the dev server & dashboard:**
   ```bash
   npm run dev
   ```
   This command starts the Fastify backend and the Vite React frontend concurrently.
   - Vite frontend: `http://localhost:8922`
   - Fastify API server: `http://localhost:8921`

4. **Verify changes (Typecheck & Test):**
   ```bash
   npm run typecheck
   npm test
   ```

---

## Workspace Structure

- `apps/web/`: React frontend interface built with Vite and TailwindCSS/Vanilla CSS.
- `apps/server/`: Fastify API server running the agent orchestration, WebSocket streams, and local file tools.
- `packages/shared/`: Shared TypeScript models, utility functions, and configurations.
- `docs/`: Extensive design, landscape analysis, and architectural documentation.

---

## Signing the Development Diary

We maintain a chronological record of changes in `DEVELOPMENT_DIARY.md`. Before opening a pull request, you should append a description of your changes to the diary. You can do this by running:

```bash
npm run diary
```

And entering your details.

---

## Review Process

- All pull requests will be reviewed by maintainers.
- We check that:
  - TypeScript compiles clean without `--noEmit` errors.
  - All automated tests pass.
  - The code is clean, readable, and includes appropriate comments.
