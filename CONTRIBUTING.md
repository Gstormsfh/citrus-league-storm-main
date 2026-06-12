# Contributing

Quick reference for working in this repo. The canonical, full standards live in
[`CLAUDE.md`](CLAUDE.md) under **"Git Workflow & Collaboration Standards"** — if this file
and CLAUDE.md ever disagree, CLAUDE.md wins.

## The flow

1. **Branch off the tip of `master`**: `git checkout master && git pull && git checkout -b <prefix>/<short-slug>`
   - Prefixes: `feat/`, `fix/`, `refactor/`, `perf/`, `test/`, `docs/`, `build/`, `ops/`, `chore/`
   - Example: `fix/playoff-alive-set`
2. **One branch = one logical change.** Unrelated discoveries get their own issue/branch.
3. **Commit with [Conventional Commits](https://www.conventionalcommits.org/)**:
   `type(scope): imperative lowercase description` — no `Co-Authored-By`, no AI attribution.
4. **Open a PR** using the template (What / Why / How). The PR title must itself be a valid
   conventional commit — it becomes the squash commit subject (CI enforces this).
5. **CI green, then squash merge.** Squash is the only merge method.
6. **Delete the branch** after merge (local and remote).

## Dev setup

```bash
npm install
npm run dev:all      # web (port 8080) + API server (port 3001)
npm run test         # web tests (Vitest)
npm run test:server  # server tests
```

Python pipeline: see `docs/DATA_PIPELINE_MASTER_GUIDE.md`. Note the tracked `data_pipeline`
symlink at the repo root — do not rename or remove it (CI depends on it).

## Before every PR

- Tests for new service methods and regression tests for bug fixes.
- Run the Security Checklist in `CLAUDE.md` (RLS, `auth.uid()`, no secrets, no `SELECT *`).

## Repo cleanup

In-flight cleanup work is tracked in [`docs/CLEANUP_PLAYBOOK.md`](docs/CLEANUP_PLAYBOOK.md).
