# Coddess eval harness

A small, fast, local benchmark so changes to the prompt / pipeline are **measured, not guessed**
(see `docs/06-intelligence-upgrades.md` Part 5). Each task runs the real agent loop against a
model, then a programmatic check decides pass/fail.

## Run it

Requires Ollama running with the model pulled (or API keys configured), because it talks to a
**live model**.

```bash
npm run eval                        # all tasks, compared to baseline.json
npm run eval -- static-landing      # a single task
npm run eval -- --update-baseline   # save current results as the baseline
CODDESS_EVAL_MODEL=llama3.1:8b npm run eval
```

Output is a per-task PASS/FAIL line with tool-call count, approx output tokens, and wall time,
then `pass@1` and any regressions vs `baseline.json` (non-zero exit on regression — wire this
into a pre-commit or CI step to keep prompt edits honest).

## Add a task

Create `evals/tasks/<name>/`:

- `prompt.md` — the build request handed to the agent.
- `check.mjs` — run as `node check.mjs <projectDir>`; **exit 0 = PASS**, non-zero = FAIL.
  Assert against the files the agent produced in `<projectDir>`.
- `seed/` *(optional)* — files copied into the project dir before the run (for bug-fix /
  existing-repo tasks).

Keep tasks small (< ~30s) and checks objective (build/import/parse), reserving an LLM judge for
genuinely fuzzy criteria. Cover your real surface: static site, JS/TS function, CRUD API, a
bug-fix-in-existing-repo, a refactor, and one canvas/game task.

## Metrics

`pass@1` is the headline. Also logged per task: tool-call count and approx output tokens (catch
prompts that pass but ramble) and wall time. Results are written to `evals/results.json`.

## Note

This driver imports `runAgent` directly and runs each task in a temp dir; failed runs leave the
temp project on disk (path printed) for inspection. It uses the default pipeline flags, so it
exercises intent → build → verify → acceptance-review end to end.
