# Citrus docked draft companion

Read-only ESPN and Yahoo hockey readers with a native Chrome side panel.
**Not a production release.** `DRAFT_KIT_BROWSER_COMPANION_ENABLED` remains off
by default. No native build or App Store purchase flow is changed.

## Actual sidebar tools

- Citrus player search, rankings and projected stat totals.
- Targets, notes, local-session save status and notebook backup.
- Original dated Citrus guide research with sources where available. No filler.
- Two to ten player comparisons with stable colours, selectable axes, area maps,
  raw totals and fantasy-scoring impact.
- Confirmed-pick availability with explicit interrupted/stale states.

Connecting opens the side panel, not a full-screen tab. One-time setup opens
Citrus only after an explicit click. The signed-in website verifies purchase
server-side and returns the board to the exact paired session. No auth token or
provider credentials enter the extension. Users still draft on ESPN/Yahoo.

## Build and review

From the repository root:

```sh
node --test apps/draft-bridge-extension/*.test.mjs
node apps/draft-bridge-extension/build.mjs /tmp/citrus-companion-build

# Actual component at narrow width, explicitly SIMULATED draft events:
node apps/draft-bridge-extension/review.mjs REVIEWED_DESK.html EDITORIAL_DIRECTORY

# Installed extension, actual provider DOM, loopback-only QA handoff:
node apps/draft-bridge-extension/preview.mjs REVIEWED_DESK.html EDITORIAL_DIRECTORY OBSERVED_IDENTITIES.json CANONICAL_DIRECTORY.json
```

Load the output folder, never the source directory. Chrome requires an operator
to load/reload unpacked extensions at `chrome://extensions`; browser automation
cannot perform that protected action.

The installed preview prints a new folder and serves port 8776. Its manifest
allows only the loopback handoff, without widening the production manifest.
Its explicit QA attachment uses only players matched against the supplied
canonical directory. Exclusions are listed and the board is labelled as a
subset. This is not a purchase test. Production requires every board player to
have a reviewed, unique provider ID and never uses that subset mechanism.

The component review on port 8786 uses synthetic event IDs. Those IDs never
enter the installed preview or production crosswalk.

## Source behaviour

**ESPN:** read Rules once and recover Pick History with All Rounds. Its visible
message feed supports returning to Players. Rollbacks must explicitly be marked
Rolled back; conflicting or incomplete sources pause updates.

**Yahoo:** keep the Picks sidebar open while browsing Players. At re-entry Yahoo
only rebuilds that feed from the re-entry point. Open Results → Round by Round
to recover full history. Returning to Players can retain a recovered prefix only
when the visible suffix overlaps and agrees. Gaps, changed owners, rollback or
replacement conflicts require full recovery. Room IDs are not invented into
Yahoo API league keys; manager labels are not invented into other teams' IDs.

Full confirmed coverage must agree with the pick counter. Missing/ambiguous IDs
on the board block its paid handoff. Unknown picks outside the fully mapped
board do not affect it. Unsupported scoring is never silently zeroed or
fabricated into projections. Kit scoring is not claimed as verified source scoring.

The review command accepts an optional fifth argument: a reviewed identity
exceptions JSON. Each manual exception must still match both saved snapshots;
this never adds a general nickname/fuzzy-matching rule. The 2026-09-19 review
maps all 300 board players on each provider using 297 name/team matches and
three individually reviewed exceptions per provider. No mappings are promoted
to a database by either review script.

## Read-only league settings

On the provider's Settings page, choose Read league settings. The sidebar shows
captured values and unsupported fields. Explicit review opens Citrus's Create
League form; explicit Apply copies supported settings. Only submitting the
normal form creates a Citrus league. Unsupported nonzero categories or roster
slots block automatic prefill. This does not import player rosters, managers,
history or keepers.

## Safety and failure signals

- Temporary activeTab access; top-frame isolated-world DOM reads only.
- No persistent host permissions, content scripts, cookies, private APIs,
  sockets, framework-state reads, analytics or background network connections.
- Exact origin/path/top-frame/tab/nonce binding on external handoffs.
- Session storage expires after six hours. Disconnect or source-tab closure
  removes it; closing the setup tab does not disconnect the sidebar.
- Serialized saves/source writes; disconnect wins over in-flight work.
- Two-second non-overlapping polls, six-second freshness limit. Failed reads
  retain the last confirmed board and explicitly label the interruption.
- Notes are session-local, not promised account or cross-device sync.

## Open release gates

1. Installed side panel with actual picks, full board, paid handoff, reload,
   undo and final pick. Component and reader tests do not prove that whole path.
2. Complete reviewed crosswalk, published research configuration and supported
   scoring verification. ESPN OTL and Yahoo GWG need explicit handling; current
   canonical projections do not supply those categories.
3. Keeper/auction/category formats, full league-import scope, distribution,
   privacy/provider review and production feature enablement.
4. Separate payment launch approval and production purchase verification.

See `docs/DOCKED_COMPANION_ACCEPTANCE_2026_09_19.md` for evidence, not release claims.

Chrome references: [sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel),
[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
[external messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging),
[externally connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable).
