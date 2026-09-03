# Draft Kit blurbs

The written half of the Draft Kit. One `.md` file per blurb; the percentile
cards and the club-change list are computed and need nothing from you.

## Write one

    cp _TEMPLATE.md mcdavid-volume-floor.md

Edit it. Keep `publish: false` until it's ready.

## Check it

    python data-pipeline/draftkit/load_blurbs.py

Dry run. Validates every file, resolves player names to ids, and prints what
would change. Errors name the file and the line:

    mcdavid-volume-floor.md:4  tier must be one of free|kit|suite, got 'paid'
    hughes-usage.md            'Jack Hughes' matches 2 players — use player_id.
                               Candidates: 8481559 (NJD, C), 8480069 (VAN, D)

Nothing is written while anything is invalid.

## Publish

    python data-pipeline/draftkit/load_blurbs.py --apply

Idempotent: a file's row id is derived from its path, so editing and
re-running updates that row in place. **Renaming a file creates a new row**
and leaves the old one behind — `--prune-sql` prints the cleanup statement,
and never runs it for you.

## Rules the loader enforces before the database sees anything

| Rule | Why |
|---|---|
| `author` required | `author_name` is `NOT NULL`. A blurb with no byline is not publishable — attribution *is* the content here. |
| `source_name` and `source_url` together or neither | A credit with nothing to click, or a link with no credit, is not a state this content may be in. |
| Published rows get a date, set once | A publication timestamp that moves on every re-run is worse than none. |
| An ambiguous player name is an error | Publishing your read on the centre under the defenceman's card is the kind of mistake that reads as carelessness about the whole product. |

## Requires

`VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment — the
same pair every other pipeline script uses. `draft_kit_blurbs` has **no write
policy**, so the service role is the only way in, by design: a client that
could write here would be indistinguishable from an editor.
