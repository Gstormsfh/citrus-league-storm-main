# Draft-room field study: what Citrus should bring over

Observed September 19, 2026 in authorized Yahoo/ESPN free hockey mocks.
This is a product and integration study, not a statement of launch readiness.
No competitor projections, editorial copy or artwork were imported into Citrus.

## The key finding

Access to league metadata is not access to live draft picks. ESPN's public mock
was readable but its HTTP league snapshot stayed empty while its browser draft
progressed. The current Citrus adapter therefore failed this mock's live-sync
acceptance. See the acceptance ledger for times, IDs and read results.

## What was actually observed

| Pattern | Evidence in the room | Citrus application |
| --- | --- | --- |
| Persistent draft context | Yahoo keeps the clock, current pick and picks until our turn above all tabs; ESPN shows a pick-order strip | A compact persistent header shared by rankings, compare and notes; never infer time-to-pick from a stale source |
| Preparation beside the board | Queue beside the player list, roster slots alongside it | Keep Citrus shortlist and roster needs visible together on desktop; use one-tap panels on mobile |
| Queue has consequences | Yahoo explicitly says autodraft draws from its queue | Citrus research targets must remain visibly distinct from the actual host queue unless a separately tested write integration exists |
| Complete league rules in context | ESPN Rules shows roster slot counts, position caps and every active scoring weight, including goalie OTL | A scoring-readiness check before opening the companion; identify unsupported stats by name rather than silently zeroing them |
| Fast draft history | ESPN separates Pick History from its colored board; Yahoo has Board and team Results | Keep availability, pick ownership and historical selection review accessible without destroying search/compare state |
| Roster-strength view | Yahoo Standings compares team category totals while drafting | Evaluate contributions to the user's roster, not just raw player rank; category ratios must be computed from appropriate totals, never summed |
| Data-source choice is explicit | Both show projected and prior-season stats; Yahoo distinguishes expert rank, ADP and paid composite options | Preserve Citrus projection provenance and distinguish our rankings from host ADP. Do not imply ADP is another projection |
| Adjustable information density | Yahoo toggle changes the space allocated to side panels and stats | Use deliberate compact/expanded desktop layouts; do not compress three desktop columns into a phone |
| Safe correction tools | ESPN's isolated practice requires pause for manager functions and confirms that undo removes later picks too | Test full snapshot reconciliation, including picks being restored to availability; never test destructive changes in a shared customer draft |
| Completion is a distinct state | ESPN shows a finished roster and share card | Offer a useful draft recap while clearly distinguishing projections from a guaranteed grade or outcome |

## Recommended order for Citrus

1. **Prove the connection.** A mock, then an authorized real draft, must show the
   same player, team and pick in the host and Citrus. Validate late joining,
   undo/keepers, source outages and complete recovery. A fresh HTTP response
   containing an old/empty board must not count as a healthy live feed.
2. **Make connection easy.** For ESPN, investigate a desktop browser companion
   that the user explicitly enables for the draft tab. No copying session
   cookies. Scope access to supported provider pages, with disconnect and clear
   stale-state warnings. Yahoo official OAuth remains an independent avenue
   requiring approved access and its own live-draft proof.
3. **Keep context visible.** Source, league, turn status, confirmed pick count
   and next action in one header. Host return link must preserve the Citrus tab.
4. **Make roster fit explainable.** Existing Citrus projections and the user's
   supported scoring drive comparisons. Show open eligible slots and the
   player's marginal contribution before attempting elaborate recommendations.
   Never borrow host projections to conceal a missing Citrus field.
5. **Make research immediate.** Keep the existing 2–10-player compare, notes,
   targets and player research reachable without leaving draft context. A
   target is not an autopick instruction. Preserve context on mobile back/close.
6. **Add practice as onboarding.** ESPN demonstrates that a league-specific
   automated practice can remove the need to recruit test managers. Citrus can
   use its own draft engine for a clearly isolated rehearsal, but a simulated
   Citrus event feed does not prove Yahoo/ESPN syncing.

## External integration research

FantasyPros explicitly documents a Chrome extension for ESPN live and mock
draft syncing and says that flow does not support mobile phones/tablets:
[ESPN setup guide](https://support.fantasypros.com/hc/en-us/articles/115001362368-How-do-I-sync-my-ESPN-draft-with-the-Draft-Assistant).
Its Yahoo guide also describes an extension-based flow and requires the actual
mock draft-room URL, not the waiting-room URL:
[Yahoo live/mock setup](https://support.fantasypros.com/hc/en-us/articles/360034462253-How-do-I-use-the-FantasyPros-Browser-Extension-with-my-Yahoo-live-and-mock-drafts).
These establish a competitor integration pattern, not verified FantasyPros
hockey support or permission for Citrus to reuse its implementation.

Yahoo's official documentation describes OAuth and league draft-results
resources, but that description alone does not establish mock or mid-draft
availability for Citrus:
[Yahoo Fantasy API](https://sports.yahoo.com/developer/docs/).

## Non-negotiable release boundaries

- Neither external provider is customer-ready based on this investigation.
- Existing numeric projection sources remain unchanged.
- Default ESPN OTL and the supplied Yahoo league's GWG remain scoring gaps.
- Extension installation/distribution, privacy review and live transport proof
  are unfinished work, not a switch that has already been built.
- Website work must not change the submitted iOS Build 22 or introduce native
  purchase messaging. No native builds were run during this study.
- No paid external subscription, production checkout activation or real charge
  was performed for this research.
