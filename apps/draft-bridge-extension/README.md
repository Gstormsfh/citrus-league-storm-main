# Citrus draft connection preview

Opt-in, read-only ESPN hockey draft reader plus a local receiver. This is **not
a released integration**, not a replacement for purchase authorization, and not
included in a native build. Yahoo is not implemented in this extension.

## Run locally

From the repository root:

```sh
node --test apps/draft-bridge-extension/*.test.mjs
node apps/draft-bridge-extension/preview.mjs
```

The second command prints an unpacked extension folder and starts a loopback-only
receiver on port 8776. It makes a separate development manifest restricted to
that receiver. It does not widen the production manifest or use production APIs.

1. In Chrome, open `chrome://extensions`, enable Developer mode, and load the
   printed folder with **Load unpacked**. Browser automation cannot perform this
   protected settings action; the operator must do it.
2. Open an isolated ESPN hockey practice draft after it has started.
3. Open **Rules**, then **Pick History**, with **All Rounds** selected. Open the
   preview extension and choose **Connect this ESPN draft**.
4. The extension opens a paired local review tab. Make picks in ESPN. The local
   review never makes a pick, changes a queue or modifies the league.
5. After reloading ESPN, open Pick History again if the review asks for it.
6. Disconnect in the review or close either tab to remove the pairing.

Restarting the preview command creates a fresh folder. Source changes require
rebuilding the unpacked package and reloading the extension in Chrome. Do not
install the source manifest against the live site: its receiver is not integrated
into the paid web app yet.

## Contract and safeguards

- The action grants temporary `activeTab` access only to the chosen source tab.
  `scripting` runs the self-contained reader in the top frame's isolated world.
- Reads UI DOM: draft identity, team selector, scoring/roster tables, round and
  current-pick counter, pick messages and the dedicated Pick History grids.
- Player IDs come from ESPN headshot URLs already attached to player rows.
  Missing identity fails closed. Names are not guessed or matched fuzzily.
- ESPN's `is-rolled-back` card must also visibly say `Rolled back` before it is
  excluded. Recovery reads the Pick History ledger because ESPN does not restore
  the message feed after a page reload.
- Pick coverage must be contiguous and match the current-pick counter. Duplicate
  identities, conflicting sources, changed rules and changed leagues pause
  updates. Missing rows never clear the last good snapshot.
- Only the explicitly paired receiver tab, at the exact configured origin/path
  and in the top frame, may request snapshots. A random per-pair token alone is
  insufficient. The extension does not accept page-specified source tab IDs.
- State is held in the extension's own `chrome.storage.session`, expires after
  six hours, and is removed on disconnect/tab closure. No browser login/session
  storage is accessed. No cookies, framework internals or sockets are read.
- No persistent host permissions, content scripts, remote code, analytics or
  network requests. The extension CSP denies network connections.
- Receiver polling is every two seconds, without overlap. Unresponsive or old
  snapshots show an explicit paused state, retaining the prior picks. Text is
  inserted with `textContent`, not interpreted as HTML.

## Evidence and limits

See `docs/EXTERNAL_DRAFT_SYNC_ACCEPTANCE_2026_09_19.md`. The reader was exercised
against real ESPN hockey practice DOM, including a manager undo, page reload,
Pick History recovery and return to Players. Unit tests also cover the extension
messaging boundary and receiver failure states. Those are **not** evidence of an
installed extension delivering to the real paid Draft Desk.

Remaining release gates:

- Actual installed Chrome extension to paired receiver, including suspension,
  tab reload/closure, source switching, repeated undo and final pick.
- Paid server-side access checks and provider-ID-to-Citrus crosswalk resolution.
  This receiver displays provider IDs; it does not treat them as NHL IDs.
- Reconcile supported league scoring against the existing canonical projection
  source. ESPN's default goalie overtime-loss points are preserved in the source
  snapshot, not silently dropped or invented in Citrus's forecast.
- Robust keeper, auction and public/private real-league verification. A snake
  practice result does not establish those formats.
- Yahoo implementation and independent verification.
- Distribution, privacy/disclosure and provider terms review before advertising
  availability. No Chrome Web Store approval is implied.

Chrome primary references:

- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [External messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Externally connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)
- [Origin/port match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
