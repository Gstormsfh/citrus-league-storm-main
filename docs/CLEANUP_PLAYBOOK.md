# Repo Cleanup Playbook

Working checklist for bringing the repo to a state where multiple people and agents can
collaborate cleanly. Items are ordered roughly by impact. Each item should land as its own
small PR (or repo-settings change) per the Git Workflow standards in `CLAUDE.md`.

Status: `[ ]` todo · `[x]` done · `[?]` needs owner decision

## 1. Collaboration foundations

- [x] Codify branching strategy, commit conventions, PR flow, and multi-agent rules in
      `CLAUDE.md` ("Git Workflow & Collaboration Standards" section).
- [x] Add `.github/PULL_REQUEST_TEMPLATE.md` (What / Why / How).
- [x] Add `CONTRIBUTING.md` (human quick-reference; `CLAUDE.md` stays canonical).
- [x] Add `.github/workflows/conventions.yml` — blocks non-conventional PR titles (the title
      becomes the squash commit subject); branch naming is advisory-only since auto-generated
      agent branches can't choose their names.
- [x] Add `.editorconfig` (LF + indent consistency across Mac/Windows editors).
- [x] Add `.github/CODEOWNERS` (@Gstormsfh auto-requested on every PR; becomes enforceable
      once branch protection lands).
- [ ] [?] Optional: GitHub issue templates. Skipped for now — issue tracking currently lives
      in `docs/REGISTRY.md` + `ENGINEERING.md` § entries; adopt only if the team moves to
      GitHub Issues.
- [ ] **Enable branch protection on `master`** — there is currently none (GitHub API returns
      404 for the protection config). Recommended settings, needs repo admin:
  - Require a pull request before merging.
  - Require the CI workflow to pass.
  - Restrict merge method to **squash only**.
  - Enable **"Automatically delete head branches"** (repo → Settings → General).

## 2. Branch hygiene

- [ ] Purge stale remote branches: 112 remote branches exist, **91 under `claude/`**
      (auto-generated agent branches). Plan:
  1. `git branch -r --merged origin/master` — batch-delete anything already merged.
  2. For unmerged ones, list with last-commit date and confirm with owner before deleting.
- [ ] Going forward, agents must use `prefix/short-slug` branch names (per `CLAUDE.md`) —
      no new `claude/*` branches.

## 3. CI hardening

- [ ] **Make the web typecheck blocking.** `ci.yml` ends the tsc step with
      `|| echo "::warning::..."`, so type errors can never fail CI. Either fix outstanding
      type errors and drop the escape hatch, or add a ratchet (error count must not grow).
      Prerequisite for "CI must be green before merge" to be meaningful.
- [ ] Audit the other workflows (`main.yml`, `playoff-*.yml`, `*-deploy.yml`, `rls-audit.yml`)
      for the same soft-fail pattern and for secrets exposure on PR triggers
      (one such hole was already closed in #274).

## 4. Tracked files that shouldn't be (or vice versa)

- [ ] `data/` — 12 CSV data files are tracked in git; the directory is ~57MB on disk.
      [?] Decide: move analysis artifacts out of git (object storage / release assets) and
      gitignore the directory, or keep a small curated subset.
- [ ] `.metadata` (Flutter artifact) at repo root — the project is not Flutter (the
      `.gitignore` even has a "Flutter (not part of this project)" section). Remove it and
      the Flutter gitignore entries together.
- [ ] `docs/` binary business artifacts (`Citrus_Pitch_Deck.pptx`, `Citrus_Business_Model.xlsx`,
      `Pitch Deck - Most Recent Citrus.pdf`) — [?] binaries bloat git history; move to
      Drive/storage and link, or accept the cost deliberately.
- [ ] `.gitignore` has a broad `*.db` pattern (added by tooling) — fine today, but it will
      silently ignore any legitimate future `.db` file. Narrow it if that ever happens.

## 5. Python package-name shims (two mechanisms for one problem)

- [ ] `data_pipeline` at the repo root is a **tracked symlink** to `data-pipeline/`, bridging
      the hyphen/underscore mismatch (Python module names can't contain hyphens). CI
      (`main.yml`, `playoff-sync.yml`) depends on it and `main.yml` says "do not rename".
      `data-pipeline/_bootstrap.py` solves the same problem cross-platform (the symlink
      breaks on Windows checkouts without developer mode) and is imported by ~49 scripts.
      Candidate consolidation: migrate the CI inline snippets to `_bootstrap` (or
      `pip install -e`), then drop the symlink — one mechanism instead of two. Low urgency;
      do not touch the symlink before CI is migrated.

## 6. docs/ organization

- [ ] `docs/` has 50+ files at one level: ADRs, runbooks, postmortems, one-off audits,
      completed-phase reports, demo scripts, and pitch material side by side. Proposal:
  - Keep `docs/adr/` and `docs/RUNBOOKS/` as-is.
  - Add `docs/postmortems/` and `docs/archive/` (completed one-off audits/reports such as
    `DEAD_CODE_CLEANUP_COMPLETE.md`, `MULTI_USER_SCALABILITY_COMPLETE.md`,
    `FINAL_RESULTS_SUMMARY.md`).
  - `docs/REGISTRY.md` stays the canonical known-issues registry; this playbook folds into
    it or gets deleted when complete.
- [ ] Update any inbound links after moving files (grep for filenames before moving).

## 7. Code-level cleanup (survey, then file individually)

- [ ] `apps/web/src/services/` → `@/api/` client migration is documented as in-flight in
      `CLAUDE.md`. Inventory which services remain, and whether any are dead.
- [ ] Duplicate scoring util: `apps/web/src/utils/scoringUtils.ts` is flagged in `CLAUDE.md`
      as "will be removed once migration is complete" — check if that's now possible.
- [ ] `data-pipeline/debug/` one-off fix/check scripts — archive or delete those tied to
      already-resolved incidents.
