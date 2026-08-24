# Toronto Game Day: three jobs for the terminal

Paste this whole file in. It has Nano Banana and the skills; this is the
context it does not have.

**Read the first line of each job before you start generating anything. Two of
the three are downloads, not renders, and they are worth more than any render
in this file.**

---

## What changed since the last brief

The build is no longer a set of quizzes. Five of the ten games now play out
against a real Leafs game, event by event: **Anaheim at Toronto, 12 March 2026,
Scotiabank Arena, Toronto down 1-3 in the second and winning 6-4.** Every shot
is a row out of `nhl_shots` with the shipped model's expected-goals value
attached. A score bug runs across the top of every page and the games settle
against the official box score.

The page furniture changed with it:

- the home page is a dense list, not twelve 300px cartoon panels
- the page headers lead with the club mark, not a mascot portrait
- the nav is words
- one typeface, Toronto navy and white, one orange accent
- no em dashes anywhere

**The characters are not the problem and they are not being removed.** They
were the front door and they are now the garnish. That was the whole argument.

---

## Job 1: the crest. A file, not a render. Ten minutes.

The build draws an eleven-point placeholder leaf. It has been rejected nine
times and it deserved to be. **Do not generate it and do not draw it.** A
diffusion model smears crisp vector marks, and an approximation of a crest
every person in that room has known since they were six is worse than none.

Get the real asset as a file. Save it as:

```
art/crest.png          (or crest.svg converted to png, 512px, transparent)
```

Then `python3 bake_art.py && python3 build.py`. It replaces the placeholder in
the nav, every page header, every locker-room row and the score bug in one go.
The slot is wired and waiting.

The real mark, for checking whatever you get: 31 points for 1931, 17 veins for
1917, 13 of them across the top for the thirteen Cups, wordmark inside, no
outline.

---

## Job 2: headshots. Also a download. Highest value in this file.

He asked for headshots and he was right to. A club app leads with players'
faces. The build currently draws a numbered navy sweater per player, which is
honest but is not a face.

**The real headshots exist and the database already holds every URL.** They are
the NHL's own mug shots, the same ones the league's app uses:

```
Auston Matthews   34  https://assets.nhle.com/mugs/nhl/20252026/TOR/8479318.png
William Nylander  88  https://assets.nhle.com/mugs/nhl/20252026/TOR/8477939.png
John Tavares      91  https://assets.nhle.com/mugs/nhl/20252026/TOR/8475166.png
Matthew Knies     23  https://assets.nhle.com/mugs/nhl/20252026/TOR/8482720.png
Morgan Rielly     44  https://assets.nhle.com/mugs/nhl/20252026/TOR/8476853.png
Jake McCabe       22  https://assets.nhle.com/mugs/nhl/20252026/TOR/8476931.png
Chris Tanev        8  https://assets.nhle.com/mugs/nhl/20252026/TOR/8475690.png
Max Domi          11  https://assets.nhle.com/mugs/nhl/20252026/TOR/8477503.png
O. Ekman-Larsson  95  https://assets.nhle.com/mugs/nhl/20252026/TOR/8475171.png
Calle Jarnkrok    19  https://assets.nhle.com/mugs/nhl/20252026/TOR/8475714.png
Easton Cowan      53  https://assets.nhle.com/mugs/nhl/20252026/TOR/8484158.png
Dakota Joshua     81  https://assets.nhle.com/mugs/nhl/20252026/TOR/8478057.png
Anthony Stolarz   41  https://assets.nhle.com/mugs/nhl/20252026/TOR/8476932.png
Michael Pezzetta  61  https://assets.nhle.com/mugs/nhl/20252026/TOR/8479543.png
Philippe Myers    51  https://assets.nhle.com/mugs/nhl/20252026/TOR/8479026.png
Jacob Quillan     26  https://assets.nhle.com/mugs/nhl/20252026/TOR/8484901.png
Steven Lorentz    18  https://assets.nhle.com/mugs/nhl/20252026/TOR/8478904.png
Troy Stecher      28  https://assets.nhle.com/mugs/nhl/20252026/TOR/8479442.png
Matt Benning      33  https://assets.nhle.com/mugs/nhl/20252026/TOR/8476988.png
Henry Thrun        3  https://assets.nhle.com/mugs/nhl/20252026/TOR/8481567.png
Ryan Tverberg     77  https://assets.nhle.com/mugs/nhl/20252026/TOR/8482525.png
Marshall Rifai    83  https://assets.nhle.com/mugs/nhl/20252026/TOR/8483546.png
Dakota Mermis     36  https://assets.nhle.com/mugs/nhl/20252026/TOR/8477541.png
```

The full list is in the database if you want it generated rather than pasted:

```sql
select i.full_name, d.jersey_number, i.headshot_url
from nhl_player_identity i
join lateral (select jersey_number, team_abbrev from player_directory pd
              where pd.player_id = i.player_id order by season desc limit 1) d on true
where d.team_abbrev = 'TOR' and i.headshot_url is not null
order by i.full_name;
```

**Save each one as `art/hs-<lastname>.png`, lower case, no accents, no spaces:**

```
art/hs-matthews.png
art/hs-nylander.png
art/hs-tavares.png
art/hs-ekman-larsson.png      <- hyphen kept, it is part of the name
art/hs-rielly.png
...
```

Then `python3 bake_art.py && python3 build.py`. The baker globs `art/hs-*`, no
manifest to edit. Every player row, every head-to-head card, every over/under
line and every picker row swaps to the real face with the jersey number kept in
the corner. **Anyone you do not deliver keeps his sweater**, so ship one or all
twenty-three and nothing breaks either way.

Two rules on the files:

- keep them square and keep the crop the NHL shipped, do not re-crop tight
- keep the transparent background; the build sits them on navy

If a licence question comes up: these are the league's own mug shots, shown in
a pitch to the club whose players they are. That is normal pitch practice, and
he should say so out loud in the room rather than let a screenshot say it.

---

## Job 3: one render. This is the only generative job left.

The asset library is not the bottleneck and has not been for a while. Six kit
props, ten arena plates, five medals, three textures, three empty states, four
characters and twelve cut-outs are already in the file. **Do not generate more
of those.**

There is exactly one thing the build wants and does not have: **a wide, empty,
dark plate of an NHL arena bowl** to sit behind the score bug and the home
page header. Right now that strip is flat navy. It is fine. It could be the
thing that makes the whole page feel like a building.

**Prompt:**

> A wide cinematic photograph of an empty NHL arena bowl seen from high in the
> stands, looking down across the ice surface at a shallow angle. The house
> lights are down and the ice is lit, so the sheet glows pale blue-white and
> the seating falls away into deep shadow. Deep navy blue dominates (#00205B,
> #00102E). The empty seats are navy. Clean fresh ice with faint skate cuts, no
> people anywhere, no players, no staff, no crowd.
>
> COMPOSITION IS NOT OPTIONAL: this sits behind headline type, so the LEFT 60%
> of the frame must stay dark, low contrast, and empty of any focal detail. All
> the light and all the interest lives in the RIGHT 40%. Nothing crosses the
> middle of the frame that would fight a line of text.
>
> ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO SIGNAGE, NO LOGOS, NO
> SCOREBOARD GRAPHICS, NO CENTRE-ICE LOGO, NO ADVERTISING BOARDS. Every surface
> that would normally carry writing is blank. No team marks of any kind.
>
> Photographic, not illustrated. Not a render, not a game engine, not a
> cartoon. 21:9, 2560x1080.

Save as `art/tex-bowl.webp`.

**How to tell it worked:** lay a white headline across the left third at 34px.
If you can read it without a scrim, it worked. If you needed to darken the
image to read the type, the composition failed and no amount of CSS fixes it.

**Fatal, reject and regenerate:**

- any text, any signage, any centre-ice logo, any advertising board
- any person in frame
- a bright object in the left 60%
- it reads as 3D-rendered rather than photographed

---

## What not to spend time on

- **more mascot renders.** Twelve exist and they are good. They are on the
  bench now, not because they are bad but because a club page leads with the
  club.
- **the ten `hero-*` single composites** from the previous brief. Those slots
  are dead: the illustrated page banners were removed. Do not generate them.
- **anything with type in it.** Every label in this build is live HTML so it
  stays legible, translatable and correct when the data changes. Baked type in
  an image is a bug waiting for the roster to change.

---

## Verifying whatever you ship

Everything below has to stay green. It all currently is.

```
python3 bake_art.py && python3 build.py
node realsite.mjs        # serves over real HTTP, 5 device profiles, must print ALL PASSED
node verify.mjs          # every game played end to end, must print CONSOLE ERRORS: none
node audit_hub.mjs       # contrast, must print no fail= lines
SKIN=bc node audit_hub.mjs
node mobsweep.mjs        # must print no horizontal overflow at 390px
node offline.mjs         # must print external requests: NONE
node classcheck.mjs      # class-name collisions, seven have shipped in this build already
```

`realsite.mjs` is the one that matters. It stands up an HTTP server, loads the
build on desktop, laptop, iPhone, Pixel and iPad, walks all thirteen panels,
runs the game clock to the final buzzer, settles all three live slates, taps a
real scoring chance in Call It, and fails on a single console error or one
pixel of horizontal overflow.

## The constraints that have not moved

- one file, no network, opens at a rink with the wifi off
- real data only, nothing simulated, nothing invented
- if the database does not cover something, it does not ship and the interface
  says so out loud
