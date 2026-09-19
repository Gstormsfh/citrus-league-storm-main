# Docked companion acceptance, September 19, 2026

Status: implemented locally, not production-enabled. This is evidence of separate
layers, not a claim that the installed paid customer journey has passed.

## Delivered code

- Chrome side panel reuses the actual Draft Desk instead of opening a diagnostic
  receiver at connection time. Search, projected totals, targets, notes, authored
  research and 2–10 player comparisons are in that panel.
- Compact comparisons collapse the picker after two selections. Additional
  players can be added without burying the charts under a permanent player list.
- Server handoff uses existing published projections/shared scoring, requires
  active purchase before and after preparation, and requires complete reviewed
  provider mappings. No provider login credentials enter the extension.
- Website sign-in preserves the exact supported extension pairing fragment;
  arbitrary fragments and native routing remain excluded.
- Read-only Settings capture opens an explicit Citrus settings review and Apply
  step. Normal Create League submission remains the only creation action.
- Authored research is attached from the existing guide files, with dates,
  source links and revision/deployment checks. No fallback generated paragraph.

## Real provider observations

Yahoo free eight-team, sixteen-round mock 2295476 was entered through the Yahoo
UI. It used ordinary autopicks; this test did not reset or undo other managers'
draft. The pure DOM reader observed 57, 89 and 93 confirmed picks with Players
and the right-hand Picks panel open. The counter agreed at each successful read.
Switching to Queue returned an explicit need-results failure; returning to Picks
recovered updates before reload.

Reloading during the mock demonstrated that Yahoo's Picks feed only contains
post-re-entry picks. The partial feed was rejected. Results → Round by Round
subsequently supplied all 128 picks and a completed counter of 129. The added
prefix-recovery code is unit-tested: it requires overlap with a recovered ledger
and rejects gaps, conflicts, rollback and changed owners. The complete
reload → Results → Players prefix path still needs installed-browser acceptance
in another active mock; do not describe that specific path as live-verified.

Earlier ESPN practice-reader evidence remains in
`EXTERNAL_DRAFT_SYNC_ACCEPTANCE_2026_09_19.md`. Those observations alone do not
prove delivery to the newly packaged side panel.

## Identity reconciliation

- 603 ESPN and 522 Yahoo public player identities were observed through visible
  player-directory searches. Only IDs, names, teams and positions were saved.
  No provider projections or authored writeups were copied into Citrus.
- The current staging canonical directory snapshot contains 1,342 unique player
  IDs. It is a matching reference, not a new projection source.
- Each provider covers the reviewed kit's 300 players: 297 name/team matches and
  three individually reviewed exceptions. The full directory correctly exposed
  the same-name Vancouver Pettersson ambiguity that a top-300-only match missed.
- ESPN exceptions: Cutter Gauthier and Adam Fantilli have FA labels; their actual
  player cards confirm names, forward roles and jerseys 61/19. Elias Pettersson
  is explicitly the forward, not the same-named defenceman.
- Yahoo exceptions: the forward Elias Pettersson, Max/Maxim Shabanov and
  Thomas/Tommy Novak. Official NHL links support the name aliases. See the
  exception evidence file for exact references and source snapshots.
- Review scripts do not write the crosswalk. These results have **not** been
  promoted to staging or production `external_player_ids` in this work.

Evidence inputs live in `docs/evidence/browser-*-20260919.json`. The exception
validator rejects source drift rather than creating a general nickname rule.

## Automated and visual checks

- Extension Node tests: 83 passing, including strict manifests, source isolation,
  complete/partial history, rollback, suffix recovery, handoff binding, notebook
  persistence and disconnect-versus-save races.
- Web component/flow tests: 126 passing across 17 files, including existing
  desktop/mobile Draft Desk behaviour, ten-player comparison, handoff failures,
  native exclusion, auth return and settings review. A failed settings refresh
  clears the previous Apply review instead of leaving stale settings actionable.
- Focused server tests: 16 passing for publication/crosswalk, authored research,
  disabled flags, purchase/revocation checks, native boundary and route inputs.
- Web/server TypeScript checks and whitespace checks passed.
- The actual component was inspected at 420px in Chrome: dense stat rows,
  research detail, search and comparison controls. This component review uses
  explicitly simulated picks, not a provider connection.
- Production-config and isolated local-preview packages build successfully.

## Local installed test ready for operator

The existing unpacked local-preview folder has been rebuilt. Its manifest remains
restricted to loopback handoff, not the production website. Port 8776 serves an
explicit no-purchase QA handoff using the complete 300-player identity review.
The test board is labelled LOCAL QA. No entitlement is granted on the website.

Chrome requires the operator to Reload **Citrus Draft Connection LOCAL Preview**
at `chrome://extensions`. This protected action cannot be automated here. Then
test actual side-panel open, kit attachment, search/research/comparison, picks,
reload/recovery and notebook persistence in authorized mock/practice drafts.

## Still not launch-approved

1. The installed end-to-end customer path, including paid website handoff, remains
   unverified. No claim of Chrome Web Store publication is made.
2. Crosswalk promotion and deployed editorial configuration remain outstanding.
3. ESPN goalie overtime-loss points and Yahoo game-winning goals are not supplied
   by the current canonical forecast. Settings review blocks unsupported nonzero
   fields. Sidebar FPTS are labelled as kit scoring, not verified provider scoring.
4. League import currently covers supported settings only. Player rosters,
   managers, history, keepers, auction/category formats and broader integration
   scope are not completed by this change.
5. Distribution/privacy/provider review, production feature enablement and the
   separate payment launch checks remain open. No production deployment, Stripe
   purchase, native sync/build or Apple Build 22 change was performed here.
