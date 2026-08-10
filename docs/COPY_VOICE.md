# CITRUS VOICE — the copy spec (architect-authored D6, 2026-08-09; U7 = conformance sweep against this file)

**Provenance (INS-16):** grounded in a full harvest of shipped strings — `grep -rhoE 'title: "[^"]+"' pages/ | sort | uniq -c` → **55× "Error"**, 4× "Success", plus a healthy long tail of specific titles. The voice below is not aspiration; it's the good bones we already shipped, made law.

## The voice, five rules

1. **Name the actor.** "Bedard is yours." / "Lime is on the clock." — never "the operation."
2. **Say what happened, then what's next.** Every message is a state change + a door.
3. **Errors own the blame.** The app failed, not the user. "Couldn't reach the draft room — retrying. Your pick is safe." Never "You must…" when "To do X, do Y" works.
4. **Hockey-literate warmth, no baby talk.** Puck drops, benches, waivers — our users know the game. No "Oops!!", no "Uh oh".
5. **Brevity budgets:** toast title ≤ 4 words (a STATE, not a verdict); description ≤ 2 sentences; empty-state primary line ≤ 8 words.

## Banned vocabulary (hard bans — U7 sweeps these to zero)

`title: "Error"` (55 shipped — every one gets a specific state title) · `title: "Success"` (the description already says what succeeded — title names the state: "Pick's In", "Claim Submitted") · "Oops" / "Something went wrong" (naked) · "No data" / "No X found" (empty-state idiom instead) · "Failed to fetch" / raw error codes surfaced to users (log them; speak human).

## Toast taxonomy

**Title = the state, specific.** Shipped good bones — KEEP this register: "Not Your Turn" · "Player Locked" · "Roster Full" · "Draft Required" · "Waiver Claim Submitted" · "Joined League!" **Description = what happened + the door.** Shipped good bones: "Rosters for past dates are frozen and cannot be changed." (honest, specific — could add the door: "…Pick today or a future date.")

## The rewrite table (harvested before → after; U7 applies the PATTERN, not just these rows)

| Shipped (real string) | Rewrite | Why |
|---|---|---|
| `"Error"` + "Team not found." | **"Can't Find That Team"** + "It may have been removed. Head back to the league page and we'll re-sync." | State title; door added |
| `"Error"` + generic fetch-fail descriptions | **"Connection Hiccup"** + "Couldn't reach the rink. Retrying — your roster is safe." | App owns blame; safety promise where TRUE (only promise safety when the operation is idempotent/unsaved-nothing-lost) |
| "You must complete the draft before adding free agents." | "Free agency opens after the draft. Finish your draft first — then the market's all yours." | Same fact, door not wall |
| "You must be logged in and have a team to add players." | "Sign in with a team to add players." + CTA to /auth where the surface allows | Shorter, actionable |
| "Player cannot be placed in that position." | "That slot doesn't fit. [Name] plays [POS] — try a [POS] or bench slot." | Names actor + the fix (use real POS vars where in scope) |
| "Demo Mode - Read Only" ×4 | **"Demo League"** + "Look around freely — changes stay off in the demo. Create your league to play for real." | Invitation, not restriction |
| "Sign Up Required" | "Save Your Spot" + "Create a free account to keep this league." | Door framing |
| `"Success"` ×4 | Name the state: "Pick's In" / "Lineup Saved" / "Claim Submitted" / "League Updated" | Title carries information |

**Preserved verbatim (already at bar):** "Not Your Turn", "Player Locked", "Roster Full", "Waiver Claim Submitted", "Joined League!", "Only players with official IR/LTIR status can be placed in IR slots." (specific, honest — optionally add the door).

## Empty states (shipped U2 idiom — now law)

Four-part stack, in order: **✦ kicker** (jbmono 10px, tracking-0.32em, orange-soft, ✦ prefix) → **primary** (pastel-cream bold, ≤8 words, a MOMENT not an apology) → **context** (white/55, one sentence, when it changes) → **one #FF6B1A verb** (only where the next action is one tap). Shipped exemplars: "✦ Preseason / The league is still filling up." · "✦ Nothing on the wire / The news feed is quiet." · "✦ Everyone's still alive" (survivor). Art slots per ART_GENERATION_QUEUE placement map.

## Loading vocabulary (StormyLoading `message` prop — shipped M-2 set is canonical)

"Loading your league…" · "Loading the matchup…" · "Loading the standings…" · "Loading your roster…" · "Loading free agents…" · "Loading the playoff bracket…" — pattern: *"Loading [the/your] [surface]…"*, ≤4 words after Loading. Kicker "STORMY IS ON IT" is component-fixed — never duplicate it in messages.

## Exemplar (T12P-5 finding — reference for state-driven banners)

`apps/web/src/components/draft/v2/ConnectionBanner.tsx` is the canonical implementation for state-driven fatal + transient banner copy. All six states there — connecting/resyncing (transient inline) · reconnecting (countdown + Retry) · fatal-auth ("You're no longer authorized to access this draft" + "Sign in again") · fatal-lobby ("This draft is no longer available" + "Back to GM Office") · fatal-not-initialized ("Waiting on your commissioner" + Retry) · fatal-server ("Can't reach the draft server" + Retry + Reload + collapsible technical details) — hit the taxonomy exactly: state-name titles, warm bodies that own blame, one clear door per state. When authoring new banner copy elsewhere, mirror this file.

## U7 CONFORMANCE ORDER (terminal)

Copy-only commits, batched per page, tests untouched: (1) census the 55 `title: "Error"` sites (command+count per the reporting rule); (2) rewrite each via the taxonomy — specific state title + blame-owning description + door; keep every fact; where a description already carries the fact, only the title changes; (3) the 4 "Success" titles → state names; (4) the Demo-mode ×4 → "Demo League" framing; (5) NO safety promises ("your X is safe") unless the operation truly lost nothing — verify before writing; (6) draft-surface toasts: copy-only changes ARE allowed under the guard, but flag each in the report. Report before/after counts: `grep -c 'title: "Error"' → 0` is the exit criterion.
