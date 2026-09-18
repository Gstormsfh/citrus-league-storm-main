# Connected Draft Desk release

## Delivered by this change

- The draft room opens a purchased user's desk automatically in the background. The room exposes a Desk tab and a ready banner; no JSON export/import is required.
- Availability follows the existing authenticated room subscription, including confirmed picks, keepers, and undos. The desk does not create another connection or submit picks.
- Rankings read the complete published remaining-season population, use the league's ScoringCalculator, and select that league's top 300. Publication identifiers are checked across paginated reads. No PDF snapshot fills missing live values.
- Private notes and targets persist per account, league, product, and player. Version checks prevent overwriting another tab. Save failures remain visible, preserve local edits, and offer a backup.
- Mobile shows projected stats under rows, with distinct goalie fields and a player notebook. Returning to Players keeps the desk mounted. Desktop keeps the board and player details together.
- Access uses the canonical checkout entitlement. Refund/expiry and membership removal block subsequent reads and writes. Native unowned accounts receive no purchase link or upsell.

## Verification

- Web: 408 test files, 5,199 tests passed.
- Server: 169 test files, 2,648 tests passed; one existing file/six tests skipped.
- Shared/server type builds and web production build passed. Changed web files passed lint.
- Browser layout fixture: desktop, 390px, and 320px. Checked player stats, separate goalie fields, note preservation across navigation, pick removal, undo restoration, and no horizontal page overflow at 320px. This is synthetic layout evidence, not a new real-draft acceptance claim.
- Entitlement-note migration installed and verified in staging and production. Anonymous reads and authenticated deletes denied. No notes were removed. Security-advisor findings unchanged (staging 154, production 164); existing findings are not represented as resolved.

## Explicit release boundaries

This change does not activate Stripe checkout, publish revised projection numbers, deploy the full PDF rendering service, add Yahoo/ESPN integration, or certify the complete paid bundle. The payment owner must keep checkout disabled until full delivery acceptance passes.

## Legacy retirement

The old `draft_kit_pdf_purchases` access gate must not be used for new delivery. Existing audit/payment records must be retained, not deleted. This desk release does not import the old PDF purchase service or its checkout/webhook routes. PDF delivery must use the same `DraftKitAccessService` before launch.

## Runtime health and load

Failures to verify entitlement, membership, publication, or scoring fail closed with a visible retry message. Failed refreshes identify the last published edition. Opens and saves are audited without private note text. Publication pagination happens once per desk open, not on every pick; live availability is derived locally from the room's existing subscription. Request limits and note-size limits apply server-side.
