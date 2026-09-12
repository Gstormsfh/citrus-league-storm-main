# Draft Kit sales readiness — September 12, 2026

**Not ready to take payment.** Presentation and artifact corrections are prepared on `codex/draft-kit-sale-readiness`; the live checkout intentionally remains unavailable. The product scope, price/currency and payment provider need founder decisions before payment implementation can be completed.

## Product boundaries

The interactive Draft Kit is a signed-in desktop website. `DesktopProduct` excludes it from native apps and phone web. It is not delivered by an Apple build update. The configurable PDF/workbook generator is a separate local tool with immutable source snapshots; it is not a hosted customer download service.

The current kit/suite prices in `tiers.ts` are documented shell defaults, not a confirmed offer. `DraftKitPricing` does not display purchase controls; `/api/draft-kit/checkout` returns unavailable. Do not advertise a purchasable kit, universal phone access, or guest writing that has not been published.

## Corrections prepared here

- Replaced the website's cover-art placeholder with existing Citrus branding and typography.
- Position switches select the correct cohort's player; selecting a club move opens the board/card. Deep-linked selections retain their cohort.
- Failed loads/refreshes expose a retry control. A transient refresh error retains the last loaded board.
- Paid cards explain missing complete projections; kit-tier written notes show the suite access boundary.
- PDF availability notes format attribution fields instead of dumping nested dictionaries, before-images and internal hashes. Adoption and review dates remain distinct from observed injury and recovery dates. Raw source records are unchanged.
- McDavid's supplied featured image depicted a goalie; it now uses the attributed `mcdavid.jpg` cover photograph. Tkachuk's supplied image depicted an arena. Panarin's original image identity was not established by this review (his supplied snapshot lists LAK); both panels use branded monograms while awaiting verified replacement images. All eleven featured callouts remain.

## Evidence

- Web Draft Kit/card/navigation/refresh tests: 32 passed.
- Server Draft Kit service and custom league-scoring tests: 38 passed.
- Display-attribution regressions: 3 passed; nested source input remains unchanged.
- Final web TypeScript compilation passed after all client additions.
- New default review PDF: `output/pdf/Citrus-Draft-Kit-Sales-Review-DRAFT.pdf`, 190 pages. All 1,266 rendered ranking/focus rows match independently recalculated fantasy points. Main ranked coverage and all 32 team guides are preserved. Nested availability dictionaries are absent. Cover, featured callouts and affected team-note pages were visually inspected.
- Review PDF SHA256: `05c3873606b91880f645e0d1a9933c64a4f051a7e5fff52b9e8c24d0739fc27c`.
- Input is the preserved `30e04ff11722` runtime adapter from the guide worktree. No source rates, exposure, publication, league settings, prior exports, production deployment or Apple submission were changed.

## Gates before selling

| Gate | Required acceptance | Status |
|---|---|---|
| Confirm offer | Downloads, desktop web access or both; price/currency; season/access term; exact supported contents | Founder decision pending |
| Payment | Provider account and configured product; hosted checkout; signed webhook; idempotent fulfillment; cancellation and payment failure | Not implemented |
| Paid access | Successful purchase grants only its buyer the correct access; expired/refunded purchases follow confirmed policy; refresh/login and nonbuyer isolation verified | Payment-to-entitlement path absent |
| Downloads | Buyer can retrieve the exact PDF/workbook edition after checkout and on return visits; access checks prevent cross-account downloads; missing artifact errors handled | Customer delivery absent |
| Guide content | Resolve conflicting/outdated team notes and unsupported forecasts; label projected roles and snapshot date; confirm the paid forecast coverage promised | Editorial review remains |
| Photographs and marks | Verify every original image's identity and documented commercial-use basis; replace uncleared assets; preserve credits for licensed additions | Incomplete; original commercial permissions were not supplied |
| Written analysis | Confirm published contents/bylines for each offered tier; do not sell an empty reading layer as completed content | Published premium-content audit pending |
| Freshness | Define whether purchase buys an immutable edition or season updates; bind downloads to an identified source and scoring preset | Decision and customer-facing copy pending |
| Support | Confirm support owner/contact, refund/access policy and a tested recovery path for paid buyers | Pending |
| Final acceptance | Complete a test-mode purchase, webhook replay, return-login, authorized download, failed payment and refund/revocation; visually test the final deployed offer and page on supported browsers | Cannot complete until payment/delivery exist |

Purchase remains disabled. Passing renderer tests and a polished PDF do not certify payment, fulfillment, premium content, asset rights or predictive accuracy.
