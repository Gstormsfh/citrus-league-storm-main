# Postmortem — <Short incident name>

**Incident:** <one-line what happened>
**Date:** <YYYY-MM-DD of the incident, not of this writeup>
**Duration:** <minutes-to-hours of user-visible impact>
**Severity:** <S0 full outage / S1 major feature broken / S2 partial/degraded>
**Status:** <draft / under review / accepted>
**Author:** <your name>
**Document owner:** <usually CTO or tech lead>

> Copy this file, rename to `docs/POSTMORTEM_<DATE>_<SLUG>.md`, fill in
> every section. A postmortem that skips sections tends to miss the root
> cause. If a section genuinely doesn't apply, write "N/A — why."

---

## TL;DR

One paragraph, max five sentences. A reader who has 30 seconds should
leave knowing: what broke, who it affected, what the root cause was,
and whether it's fixed.

---

## Impact

- **Users affected:** <number / percentage / which cohorts>
- **User-visible symptom:** <what did people actually see>
- **Duration:** <start time → end time, with timezone>
- **Data loss / corruption:** <none / yes, scoped to… / yes, irreversible — escalate>
- **Money at stake:** <lost revenue, cost overrun, refund liability, reputation>

If the incident involves data loss or corruption, escalate before
finishing the postmortem. Do not wait for the document.

---

## Timeline

All times in Mountain Time unless noted. Prefer log excerpts over
reconstructed memory.

- **HH:MM** — <event>
- **HH:MM** — <event>
- **HH:MM** — <event>
- **HH:MM** — Incident mitigated.
- **HH:MM** — Incident resolved (root-cause fix deployed, monitoring clean).

---

## What went wrong

### Root cause

State the root cause in plain English. If there were multiple
contributing factors (usually true — see `docs/LIVE_DRAFT_DISASTER_POSTMORTEM.md`
for the canonical example of a superposition failure), list each one
and whether it was sufficient on its own to cause the incident.

### Contributing factors

- Factor 1 — explanation
- Factor 2 — explanation

### Why our defenses didn't catch it

- Automated tests: <did they run, did they fail, did they pass falsely>
- CI gates: <any budget/lint/typecheck that should have caught this>
- Monitoring/alerting: <did we page, did we see it, how long until we knew>
- Pre-deploy review: <did a human see the change; if yes, what did they miss>

---

## What went right

Always include this section. Calls out the defenses that did fire so we
know to protect them. Examples: fast rollback, graceful degradation,
a teammate noticing the alert and paging correctly.

---

## Action items

Use the table format so these can be tracked. Every item must have an
owner and a deadline. "Someone should think about it" is not an action.

| Priority | Item | Owner | Deadline | Status |
| --- | --- | --- | --- | --- |
| P0 | <blocking next similar incident> | @handle | YYYY-MM-DD | Open |
| P1 | <preventive, important> | @handle | YYYY-MM-DD | Open |
| P2 | <hygiene / long-term> | @handle | YYYY-MM-DD | Open |

**Priority meanings:**

- **P0** — Must land before the next user-facing event of the same class.
  If this is a draft incident, before the next draft. Block other work.
- **P1** — Important; land within two weeks. Prevents the next incident
  but isn't blocking the next event.
- **P2** — Hygiene. Track, don't drop, but allow to coexist with feature work.

---

## Lessons learned

One or two paragraphs. This is the section future engineers actually
read when searching for "have we seen this before." Be honest about
process failures, not just technical ones. Examples:

- "We reviewed the PR but nobody ran the specific flow that broke."
- "The pre-deploy runbook exists but nobody executed it."
- "We had the monitoring signal but no alert rule on it."

---

## Related incidents and docs

- <link to a past postmortem that had overlapping root cause>
- <link to the runbook(s) relevant to the fix>
- <link to the migration / PR / deploy that introduced the bug>

---

## Appendix

### Logs

Paste or link to key log excerpts. Scrub any PII first.

### Graphs / screenshots

Attach or link to the exact metric graphs that tell the story. Don't
assume the dashboard still exists in a month — consider pasting
screenshots.

### Commands that were run during mitigation

List the exact `gcloud` / `supabase` / SQL commands used. If this
incident recurs, the next person should be able to copy-paste.
