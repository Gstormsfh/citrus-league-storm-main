# Yahoo/ESPN companion: acceptance ledger

Status: controlled test implementation only. The ESPN public-mock acceptance
FAILED: the current read endpoint did not expose picks during the observed draft.
Neither provider is enabled or verified for customer live syncing.

## Boundaries

- Website only. Existing native-origin rejection, runtime guards and native
  bundle audit apply. No iOS Build 22 change or submission.
- Read-only. No source picks, queues, rosters or Citrus leagues are mutated.
- Purchase verification before and after provider reads. Verified JWT identity,
  not a caller-supplied user ID. Yahoo member GUID checked against source teams.
  ESPN public data may be read; private data needs the user's provider session
  and a matching source member. Credentials never persist to a table or log.
- Existing source parsers and scoring translation feed the existing published
  projection service. Absent source weights are zero, not Citrus defaults.
  Unsupported categories refuse to produce misleading points rankings.
- Source draft snapshots replace whole availability sets, allowing undo/reset.
  Missing collections, contradictory picks and ambiguous player mappings never
  clear the prior board. Only established high-confidence crosswalk IDs are used.
- Browser polling every 15 seconds, paused while hidden, no overlapping poll,
  abort on account/source change or disconnect. Failed/partial refresh keeps
  old availability with a stale warning. A 30-second receipt watchdog is included.
  Provider receipt time is NOT a guarantee of the provider data's freshness.
- External notes/targets remain in the tab with a progress-export option. They
  are not advertised as cloud-saved. Disconnect warns before clearing them.

## Tests completed

Provider contracts: 15 tests; gateway/scoring: 7; route release/auth gates: 6;
browser lifecycle: 8. Existing ESPN transport tests now check a bounded timeout.
These are fixtures and mocks, not proof that a provider exposes picks mid-draft.
Full web/server suites passed with the gated additions (see release ledger).

## Required before either switch can be enabled

1. User supplies a disposable league and confirms permission for real draft
   actions. Read-only checks are fine on an actual league; do not reset it.
2. Confirm active Yahoo Fantasy API provisioning and applicable permission for
   the expanded companion use. Existing OAuth config names are present in
   production; that alone does not prove API authorization.
3. Capture sanitized authenticated provider responses during actual picks,
   keeper placement, an undo and reconnect. Confirm these endpoints expose
   picks during the draft, not merely a completed recap. If not, a different
   permitted integration mechanism is required; do not pretend polling fixes it.
4. Test a public and private ESPN hockey league. Current session-value entry is
   a technical testing path, not the intended final effortless consumer UX.
   Never extract the user's browser cookies with automation.
5. Match provider player IDs for all relevant draftable players. Unknown IDs
   are not automatically fuzzy-matched. Confirm namesake and traded-player cases.
6. Resolve Yahoo refresh-token coordination across multiple tabs and API
   instances. The existing import token provider lives for one job; reusing it
   for frequent stateless polls is not an approved draft-night architecture yet.
   Provider caching, throttling/backoff and multi-instance load tests remain.
7. Browser acceptance of account switching, scoring changes, network failure,
   late replies, keepers, reset and compare availability against the real host.
8. Enable only the independently verified provider. Update package copy to
   distinguish automatic Citrus events from provider-polled availability.

## Stripe state

User supplied evidence of GST/HST registration. Existing Stripe registration was
already recorded. Completed tax-monitoring setup using the account's existing
business address and existing electronically supplied services category. Stopped
before paid Tax Basic activation (0.5% per transaction, no monthly fee), awaiting
explicit approval. No tax identifier is stored in the repository. Automatic
filing is not included in that plan. Checkout remains disabled.

## Real-account inspection and disposable leagues (September 19, 2026)

The user supplied both league links and explicitly authorized creating free,
disposable leagues and test draft actions. Existing customer leagues remain
read-only. No invitations were sent and no additional accounts were created.

- Yahoo test league: `128040`, **Citrus QA Disposable 2026**. Created by copying
  the supplied league's settings, without copying its managers. Draft unscheduled.
  Private. Yahoo requires four joined teams and an even team count before it can
  finalize. One manager is joined; no placeholder-team creation option was found
  in the inspected commissioner tools.
- ESPN test league: `609963081`, **Citrus QA Disposable 2026**. Four-team H2H points,
  snake draft, unscheduled. Briefly made viewable for the public read-client check,
  then restored to private. No league invitations or public recruitment.
  ESPN says all managers must join before the draft can run.
- Additional disposable managers/accounts requested from the user. A mock draft
  or an offline result is not proof of live league-pick synchronization.
- Supplied ESPN real league was not reactivated for 2027. No reactivation or
  reminder email was performed.
- Supplied Yahoo real league's draft is September 20 at 20:00 EDT. It is not a
  disposable test fixture and must not be reset or populated with test picks.

### Verified source observations and fixes

The real ESPN endpoint returned HTTP 200 while the test league was viewable.
Its 88 preallocated slots all used numeric `playerId: -1`, `keeper: false`;
`drafted` and `inProgress` were both false. `keeperCount` was zero and teams did
not include `draftStrategy`. The adapter now interprets this as waiting with zero
selected players, validates slot identities even for empty slots, and rejects
missing IDs, other negative IDs and contradictory completed-draft placeholders.
The standalone reader now requests `mSettings` for the keeper-count check.
The history parser also excludes unfilled sentinel rows from imported picks.

After the fix, a second real read returned waiting/zero picks successfully.
After restoring private visibility, a credential-free read was refused with
`NeedsCredentialsError`. This verifies public/private boundaries, NOT private
credential connection or mid-draft picks.

ESPN also sends zero-weight derived stat rows (including points). The companion
now ignores only zero-weight rows for points leagues before translation. Nonzero
unsupported weights still block rankings. The browser no longer labels an
unknown source draft status as live. Regression tests cover these differences.

### Remaining compatibility findings

- The supplied Yahoo settings award game-winning goals; the published desk
  projection contract does not supply that stat.
- Default ESPN points settings award goalie overtime losses; the published desk
  contract does not supply that stat either. After the zero-weight fix, the real
  ESPN scoring check correctly names overtime losses as the blocker.
- Do not zero these weights or invent projections just to open the companion.
  Matching these leagues requires an audited extension of the canonical
  projection publication, shared scorer adapter and all consuming surfaces.
- Production `/import` currently offers screenshots for Yahoo and explicitly
  says one-tap connection is pending. Signed-in Yahoo browser access is not an
  authenticated Citrus OAuth connection or proof of approved API provisioning.
- Useful product requirements observed: explicit draft-readiness checklist;
  imported scoring review before connection; forward/utility slot awareness;
  goalie minimums and position caps; traded-pick/keeper ownership; visible source
  freshness; and a clear return to the provider draft. These are requirements,
  not claims that every item has been implemented.

Local checks for this revision: 67 targeted server tests, all 325 import tests
(overlapping coverage), 10 browser-component tests, server and web typechecks.
A CI-only test-helper header type error was corrected.
Neither provider release switch has been enabled. No native build changed.

## Live mock investigation (September 19, 08:38–08:53 UTC)

The user explicitly approved free mock participation and exploration. No paid
subscriptions were activated. No real customer league was drafted or reset.

### ESPN: completed public mock, failed source-sync acceptance

- Launched league-specific practice `943083829` from disposable league
  `609963081`, using its four-team settings and ESPN's automated opponents.
  The practice room ran; pause and the confirmed undo dialog were exercised
  only there. A credential-free call to its league endpoint was refused.
- Joined free public **Pro 8-Team H2H Points Mock**, ID `1026536089`, at seat 3.
  Observed its full 22-round draft reach completion. The room included automated
  opponents. Our team received McDavid at overall pick 3; do not treat this as
  evidence of a successful Citrus pick command. Citrus does not submit host picks.
- The existing `EspnClient` returned HTTP 200 for this mock's metadata and 176
  empty draft slots before play. The existing `ExternalDraftSnapshotService`
  parsed it successfully. This established transport/schema compatibility only.
- Twelve bounded samples, 15 seconds apart from `08:41:11.525Z` through
  `08:43:58.772Z`, all returned `in_progress` with zero selected players.
  The visible room meanwhile showed picks, including MacKinnon at 1,
  Kucherov at 2 and McDavid at 3, and progressed through later rounds.
- An independent `mRoster` read at `08:43:07.951Z` also returned zero roster
  entries for all eight teams. That view is not a demonstrated workaround.
- A later read at `08:44:42.869Z` still returned zero picks during the draft.
  After the browser displayed completion, the same endpoint returned HTTP 404.
  No completed recap was recovered by that endpoint in this test.
- Conclusion: this transport failed **for this mock**. Do not extrapolate that
  all private/real ESPN league behavior is identical, but do not enable the
  current polling implementation or promise live picks based on HTTP 200.
  Receipt time and `inProgress` are insufficient proof of pick freshness.

### Yahoo: real mock interaction, not authenticated API acceptance

- Joined free H2H category mock **Wash Out 2294412**, with other participants
  plus automated teams. This is separate from real league `4651`.
- Entered Yahoo's draft client and clicked Draft for McDavid. The UI confirmed
  him as the last pick and added him to our roster. Inspected Players, Board,
  Results, Standings, queue controls and expanded layout. Screenshots were
  displayed in the task. No undo/reset was attempted in this shared room.
- Reloaded the same Yahoo room during round 13. It rejoined at round 14 and
  retained the drafted roster and pick numbers, including McDavid at 1 and
  Fantilli at 140. This is Yahoo's reconnect behavior, not Citrus sync proof.
- Yahoo subsequently displayed Draft Complete with our 16/16 roster and team,
  round-by-round and position-grid recap tabs. ESPN's isolated practice was
  resumed after its undo test and also reached completion. No test draft was
  left paused or waiting for our participation at the end of the investigation.
- The draft-client ID is a mock ID, not an authenticated Yahoo API league key.
  Do not fabricate a game key or interpret the parent league's results as this
  mock. No Yahoo OAuth/API live snapshot was verified.
- The mock's category scoring is outside the current points-only companion.
  No Citrus settings were modified to pretend otherwise.

### Consequences for implementation

- Keep both release switches OFF. Fix source transport before marketing sync.
- Prefer a user-authorized, least-privilege browser bridge for further ESPN
  investigation, with mock/real league identity explicitly separated. Its
  production acceptance must include source player IDs, full-board resync,
  reconnect, undo, permissions, privacy and extension distribution. It is a
  proposed next path, not an implemented or validated integration.
- Do not extract browser cookies, copy member-bearing draft URLs into return
  links, or scrape hidden app state to get around the failed transport.
- External companion now links back to its host league in a separate tab and
  correctly names the host draft room in its pick instructions. It explicitly
  distinguishes Citrus targets from the host autopick queue. Native guards stay.
- See `DRAFT_ROOM_FIELD_STUDY_2026_09_19.md` for sourced product observations and
  the prioritized Citrus implementation plan.

Validation for the navigation revision: 20 focused web tests passed, web
typecheck (`tsc --noEmit -p tsconfig.app.json`) and targeted ESLint passed.
The preceding source-parser commit `8a7cd9c4` passed all PR CI checks. These
navigation changes do not constitute a deployed browser acceptance test.

## Opt-in DOM bridge implementation and real reader tests

Added `apps/draft-bridge-extension` as a separate desktop-only development
preview. No production source flag, checkout flag, native bundle or provider
account setting was changed. The extension is not published or installed yet.

Real ESPN isolated practice: `300751171`, launched from disposable league
`609963081`, four teams, 22 rounds, automated opponents. No real league changed.

The same self-contained `captureEspnDraft` function used by the extension was
run as read-only DOM inspection against the real room:

1. Read all 18 confirmed picks while paused at pick 19. Verified provider player
   IDs, team IDs, roster slots and every displayed scoring field, including OTL.
2. Used ESPN's League Manager UI to undo Kyle Connor at pick 18. Initial strict
   coverage check correctly refused the stale card. Inspection showed ESPN keeps
   that card with `is-rolled-back` and the displayed text `Rolled back`.
3. Added the explicit rollback handling and verified 17 picks remained, ending
   with Tage Thompson at pick 17. Added regression tests from this DOM contract.
4. Reloaded the practice room. ESPN restored the draft but not the Picks message
   feed. The reader correctly refused to infer an empty draft from that feed.
5. Opened Pick History / All Rounds. Its player rows include ESPN headshot IDs,
   overall picks and fantasy-team names. Added full-ledger recovery and verified
   all 17 picks, then returned to Players and verified the same full capture.
6. Resumed the isolated practice. Subsequent reads captured 23 and 78 confirmed
   picks. The last read returned **88 picks and `finished`**, ending with Igor
   Shesterkin at pick 88. A screenshot of the completed room was shown in task.
   No practice draft remains paused.

Automated validation: 40 tests passed across reader, worker message-boundary and
receiver tests. Included in the existing web CI job. Checks cover incomplete
history, rollback, duplicate/conflicting identity, changed league/rules, source
failure, expiry, disconnect, unauthorized origins/frames/tabs, stale snapshots,
and inert rendering of markup-like names. These are unit tests, not an installed
extension or customer acceptance result.

**Outstanding:** Chrome's browser-control URL policy blocks extension management.
The operator was asked to load the generated local preview folder manually.
Until that happens, actual service-worker injection, permission lifetime and
extension-to-web message delivery remain unverified. The local receiver is a
connection review, not the paid Draft Desk. Server-authorized player-ID mapping,
canonical scoring compatibility, Yahoo, real-league/keeper/auction coverage and
extension distribution remain release gates. Do not market live Yahoo/ESPN sync.
