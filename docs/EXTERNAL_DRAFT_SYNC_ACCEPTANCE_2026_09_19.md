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

The user offered two leagues; links and disposable-draft confirmation are pending.
