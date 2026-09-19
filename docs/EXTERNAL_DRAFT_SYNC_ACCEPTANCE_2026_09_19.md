# Yahoo/ESPN companion: acceptance ledger

Status: implemented for controlled testing, NOT enabled or verified live.

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
