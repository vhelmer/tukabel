# Manifest: `azet-game.yaml`

Everything the platform needs to know about a game lives in `azet-game.yaml` at the repo root. The game declares its own settings, and the CMS turns them into a form. The schema is implemented in `packages/manifest` and is the single source of truth for the CLI, CI and CMS.

## Example

```yaml
id: word-snake
name: Slovný had
sdk: 1
entry: dist/index.html
category: word            # word | logic | number | reflex | quiz | other
orientation: portrait     # portrait | landscape | any
session: 2-5min           # under-2min | 2-5min | 5-15min | 15min-plus
description: Spájaj písmená do slov skôr, ako had narazí do steny.
howTo:                    # shown under „Ako hrať“ on the start and pause screens (HOW-1)
  - Ťahaj prstom cez susedné písmená.
  - { text: Každé slovo predĺži hada., image: assets/howto/grow.png }   # a line with a picture (HOW-3)

scoring:
  metric: points          # points | time | moves
  higherIsBetter: true
  min: 0
  max: 10000
  minSeconds: 10          # completions faster than this are rejected

levels:
  mode: daily             # none | daily | endless
  replay: true            # can the player play again after completing

endScreen: full           # full | compact | none (a hub of many short rounds, HUB-1, HUB-7)

window:                   # the game's window (WIN-1); without it the 560 px column on desktop
  desktop: { width: 1280, aspect: "16:9" }   # px or full; W:H or free
  mobile: { width: full, aspect: free }

settings:                 # JSON Schema subset → CMS form
  wordLength:
    type: integer
    title: Dĺžka slov
    default: 5
    minimum: 4
    maximum: 7
  timeLimit:
    type: integer
    title: Časový limit (s)
    default: 120
    minimum: 30
  difficulty:
    type: string
    title: Obťažnosť
    enum: [easy, medium, hard]
    default: medium
  snakeColor:
    type: string
    format: color
    title: Farba hada
    default: '#1273ea'

metrics:                  # optional, max 100 (MET-1, HUB-4)
  - id: words
    title: Nájdené slová
    type: integer           # integer | number | duration (seconds)
    better: higher          # higher | lower
    min: 0
    max: 200

badges:                   # optional, max 50 (BDG-1, HUB-4)
  - id: first-win
    title: Prvá výhra
    description: Vyhraj svoju prvú hru.
    icon: assets/badges/first-win.svg
    award: game             # game.award('first-win'), cosmetic
  - id: word-master
    title: Majster slov
    description: Nájdi aspoň 20 slov v jednej hre.
    icon: assets/badges/word-master.png
    rule: { when: 'metric:words', op: '>=', value: 20 }
  - id: expert
    title: Expert
    description: Vyhraj na ťažkej obtiažnosti do minúty.
    icon: assets/badges/expert.svg
    rule:                   # all conditions on the same play (BDG-8)
      all:
        - { when: 'metric:difficulty', op: '>=', value: 3 }
        - { when: time, op: '<=', value: 60 }
        - { when: success, op: '>=', value: 1 }
  - id: na-vlne
    title: Na vlne
    description: Vyhraj 5 hier za sebou.
    icon: assets/badges/na-vlne.svg
    rule: { when: winsInARow, op: '>=', value: 5 }

leaderboards:             # optional, max 100 (docs/GAME-SERVICES.md, HUB-4)
  - id: top-words
    title: Najviac slov týždňa
    metric: metric:words    # score | metric:<id>
    period: week            # day | week | month | all
    aggregation: best       # best | sum | count

events:                   # optional, see "Events"
  - name: word_found
    description: Hráč našiel slovo.
    props:
      - name: length
        type: number

assets:
  icon: assets/icon.svg   # square, SVG or PNG ≥ 256 px
  cover: assets/cover.png # 1200×630, landing tiles and sharing

realtime:                 # optional, multiplayer through the platform, see "Realtime" (RTM)
  maxPlayers: 2           # room size 2–50, default 8
  quickMatch: 2           # players per quick match, 2…maxPlayers, default 2
  stateWrites: any        # any | host
  waitSeconds: 120        # a room nobody else joins closes after this (10–600), RTM-13
  authority: members      # members | referee (the backend decides every room, REF)
  # bots:                 # only with authority: referee, see "Realtime" (BOT)
  #   levels: [easy, hard]
  #   after: 20

progression:              # optional, the game's own player levels, see "Progression" (PRG)
  source: points          # points | plays | metric:<id>
  levels: [0, 50, 150, 400]
  titles: [Nováčik, Učeň, Majster, Legenda]

matches:                  # optional, asynchronous turn-based matches, see "Matches" (MAT)
  players: 2              # seats 2–8, default 2
  turnSeconds: 86400      # a missed turn loses by forfeit after this, 60 s – 7 days
  inviteSeconds: 86400    # a match nobody joined expires after this
  authority: members      # members | backend

network:
  allow: []               # extra origins the game may call (connect-src)

backend:                  # optional, see "Backend"
  path: backend/
  port: 8080
  health: /health
  database: postgres      # none | postgres
  realtime: false
  resources: small        # small | medium
  secrets: []
```

## Fields

| Field | Required | Type | Rules |
|---|---|---|---|
| `id` | yes | string | `^[a-z][a-z0-9-]{2,39}$`; must equal the game slug in the CMS |
| `name` | yes | string | 1–60 chars |
| `sdk` | yes | integer | Protocol version the game targets (`1`) |
| `entry` | yes | string | Path inside the build output, usually `dist/index.html` |
| `category` | yes | enum | `word`, `logic`, `number` (number puzzles such as sudoku, v1.10.0), `reflex`, `quiz`, `other` |
| `orientation` | no | enum | Default `any`; a hint for tiles and tooling, the shell does not rotate or lock the screen (use `window` for the shape) |
| `session` | no | enum | Typical session length, shown on tiles |
| `description` | no | string | ≤ 200 chars, shown on the start screen and tiles |
| `howTo` | no | list | How to play: 1–8 lines of ≤ 140 chars (rules, controls), shown under „Ako hrať“ on the start and pause screens (HOW-1). A line is text, or `{ text, image }` with a picture shown left of the text (HOW-3): a path in the repo like `assets.icon`, `svg`, `png`, `jpg`, `jpeg`, `webp` or `gif` (lowercase), drawn at 80 × 80 px (`contain`), so a square of 160 px or more looks sharp. Publishing copies it to `__azg/howto/<line>.<ext>`; `azg validate` and the zip upload fail when it is missing. The text is what a screen reader reads, so say what the picture shows |
| `window` | no | object | The game's window on desktop and mobile, see "Window" (WIN-1). Without it the 560 px column |
| `scoring.metric` | yes | enum | `points`, `time`, `moves` |
| `scoring.higherIsBetter` | yes | boolean | `false` for time and moves |
| `scoring.min` / `max` | no | number | Server rejects scores outside the range |
| `scoring.minSeconds` | no | number | Default 3. A play shorter than this does not count (`too_fast`); for speed games (Míny, reaction games) set `1` |
| `levels.mode` | no | enum | Default `none`. `daily` gives every player the same seed per day |
| `levels.replay` | no | boolean | Default `true` |
| `pauseButton` | no | boolean | Default `true`: the shell's pause button (top right) while the game runs. `false`: no button; the game draws its own and calls `game.pause()`, which opens the same pause screen (PSE-1, [SDK contract](sdk-contract.md#a-games-own-pause-button-pse-1-sdk-1100)). A hidden tab still pauses the game |
| `backButton` | no | boolean | Default `true`: the shell's round „←“ arrow (top left) while the game runs. `false`: no arrow over the running game, for a game with its own „Späť“ (a hub, BCK-1); the start and pause screens keep „← Späť na hry“, so keep a way to pause |
| `endScreen` | no | enum | Default `full`: the shell's end screen after every play. `compact`: a small result card over the game and the next play starts at once (HUB-1, a hub of many mini games, see [SDK contract](sdk-contract.md) "One result per play"); `none`: the same without the card, the game shows the result itself from `game.onResult()` (HUB-7). Both need `levels.replay: true` |
| `settings` | no | object | See below; max 30 settings |
| `metrics` | no | list | See "Metrics"; max 100 (a completion sends at most 10 `stats`) |
| `badges` | no | list | See "Badges"; max 50 |
| `currencies` | no | list | See "Currencies, items and earn rules"; max 10 |
| `items` | no | list | See "Currencies, items and earn rules"; max 300 |
| `earn` | no | list | See "Currencies, items and earn rules"; max 40 |
| `events` | no | list | See "Events"; max 50 |
| `assets.icon` | yes | path | Must exist in the repo |
| `assets.cover` | no | path | Must exist in the repo |
| `realtime` | no | object | See "Realtime" (RTM); enables `game.realtime` |
| `progression` | no | object | See "Progression" (PRG); the game's own player levels |
| `network.allow` | no | string[] | HTTPS origins only; reviewed on promotion to production |
| `backend` | no | object | See below |

Unknown top-level fields fail validation, so typos are caught early.

## Window

The shell draws the game in the window the game asks for (WIN-1, D-94). Each side has two keys:

| Key | Values | Default when `window:` is there |
|---|---|---|
| `width` | CSS px 320–3840, or `full` | `full`: all the width the page gives |
| `aspect` | `W:H` between 1:4 and 4:1 (`16:9`, `4:3`, `1:1`, `9:16`), or `free` | `free`: the whole height |

- `desktop` applies while the space for the game is wider than 640 px and higher than 500 px; `mobile` otherwise (a phone held either way, a narrow article column, the builder's phone frame).
- A fixed `aspect` makes the window as large as fits both ways and keeps the shape; the rest is the theme background. `free` fills the height, so the game must lay itself out for any height.
- Without `window:` a game keeps what it always had: a 560 px column on desktop and the whole screen on a phone. Declaring `window: {}` gives the whole page on both.
- In an article (`/embed.js`) the box takes the same window: at most `width` wide, with a fixed `aspect` in that shape (never taller than the screen), with `free` 640 px high. `data-height` on the snippet still sets the height. Only live games: a hidden game in an article gets the 560 × 640 box.
- Try it with `azg dev` (viewports up to „wide desktop (1440)“) and in the builder's mobile and desktop preview.

```yaml
window:                       # a wide board on a computer, the whole phone on a phone
  desktop: { width: full, aspect: "16:10" }
  mobile: { aspect: free }
```

## Settings

`settings` is a map of setting name → schema. Supported schemas:

| Type | Extra keywords | CMS control |
|---|---|---|
| `integer`, `number` | `minimum`, `maximum`, `multipleOf` | Number input (slider if both bounds are set and the range ≤ 100 steps) |
| `boolean` | – | Switch |
| `string` | `minLength`, `maxLength`, `pattern` | Text input |
| `string` + `enum` | `enumTitles` (optional labels) | Select |
| `string` + `format: color` | – | Colour picker |
| `array` of `string` | `maxItems` | Tag list (for example word lists) |

Every setting needs `title` and `default`. `description` becomes help text. Setting names match `^[a-z][a-zA-Z0-9]{0,39}$`. Names that look like secrets (`*key*`, `*secret*`, `*token*`, `*password*`) are rejected: secrets belong in `backend.secrets`.

**Values across versions:** values are stored per tenant. When a new version adds a setting, its default applies until someone changes it. When a version removes a setting, its stored value is archived (audit log) and no longer sent. When a value no longer matches the new schema (for example out of range), the default applies and the CMS shows a warning.

## Metrics

`metrics` declares numbers a game reports with each result besides the score (MET-1, D-43). The game sends them as `game.complete({ score, stats: { <id>: number } })`, a backend as `stats` in `submitResult` (docs/SDK-CONTRACT.md).

| Field | Required | Rules |
|---|---|---|
| `id` | yes | `^[a-z][a-zA-Z0-9_]{1,39}$`, unique |
| `title` | yes | 1–40 chars, Slovak, shown to players |
| `type` | yes | `integer`, `number` or `duration` (seconds, ≥ 0) |
| `better` | yes | `higher` or `lower`; the direction for leaderboards and badges |
| `unit` | no | ≤ 10 chars |
| `min` / `max` | no | `min` ≤ `max`; values outside are dropped with `statsRejected: out_of_range` |

## Badges

`badges` declares what a player can earn in the game (BDG-1, D-45). Every badge has exactly one award path:

| Field | Required | Rules |
|---|---|---|
| `id` | yes | `^[a-z][a-z0-9-]{1,39}$`, unique in the game |
| `title` | yes | 1–40 chars, Slovak |
| `description` | yes | 1–120 chars, Slovak |
| `icon` | yes | Path in the repo; SVG, or PNG at least 128 × 128 px; must exist |
| `award: game` | one of | The game awards it with `game.award('<id>')`; **cosmetic**, never counted in tenant badges, leaderboards or statistics |
| `award: backend` | one of | The game backend awards it through `POST /api/v1/results` (BE-6); trusted |
| `rule` | one of | The server awards it on a validated result; trusted |

A rule is declarative, no code (BDG-1.2): `{ when, op, value, period? }` with `op` `>=` or `<=`, `value` a number, `period` `day`, `week` or `all` (default; for `completions`), and `when` one of:

| `when` | The value |
|---|---|
| `score` | The play's score |
| `metric:<id>` | A declared metric of the play |
| `time` | The play's seconds (`timeSeconds` of `complete()`, else the measured time) |
| `success` | `1` for a won play (`complete({ success: true })`), `0` for a lost one; a play without `success` meets no `success` condition |
| `winsInARow` | The player's won plays of this game in a row, this one included (up to 100); a lost play or one without `success` ends the run, rejected and practice plays do not count |
| `streak` / `gameStreak` | The shared streak / the streak in this game (days) |
| `completions` | The player's validated plays of the game in `period` |

**Several conditions** (BDG-8): `rule: { all: [ … ] }` with 2–5 conditions of the same form; the badge is awarded by a play on which every one holds. A rule has either `all` or one condition. For „or“ declare two badges. Send `success` in `complete()` for `success` and `winsInARow` badges; `azg dev` lists each badge's conditions. Publishing copies badge icons into the bundle under `__azg/badges/<id>.<ext>`.

## Currencies, items and earn rules

A game can have its own currency and items; the platform keeps the ledger (ECO-1, docs/GAME-SERVICES.md "Currency and shop"). The game spends and buys through the SDK; it never earns by itself (docs/SDK-CONTRACT.md "Currency, shop and inventory").

```yaml
currencies:
  - { id: pismenka, title: Písmenká, icon: assets/economy/pismenka.svg, max: 9999, dailyEarnCap: 200 }
items:
  - id: druhy-zivot
    title: Druhý život
    icon: assets/economy/druhy-zivot.svg
    price: { currency: pismenka, amount: 30 }
    maxPerPlayer: 3
earn:
  - { currency: pismenka, from: 'metric:letters', rate: 1, max: 50 }
```

| Field | Required | Rules |
|---|---|---|
| `currencies[].id` | yes | `^[a-z][a-z0-9-]{1,39}$`, unique in the game |
| `currencies[].title` | yes | 1–40 chars, Slovak |
| `currencies[].icon` | yes | SVG or PNG path in the repo; must exist |
| `currencies[].max` | yes | Integer 1–1 000 000: the highest balance a player can hold |
| `currencies[].dailyEarnCap` | no | Integer ≤ `max`: the most a player earns per day over all trusted paths |
| `currencies[].scope` | no | `game` (default) or `tenant`: shared between the tenant's games that declare the same id; usable only after an editor enables it |
| `items[].id`, `title`, `icon` | yes | Same rules as for currencies |
| `items[].price` | yes | `{ currency, amount }`: a declared currency and an integer 1–1 000 000. The only price there is; the game never sends one |
| `items[].stackable` | no | Default `true`; `false` means a player owns it at most once |
| `items[].maxPerPlayer` | no | Integer 1–10 000; at most 1 for a non-stackable item |
| `earn[].currency` | yes | A declared currency |
| `earn[].from` | yes | `score` or `metric:<id>` (a declared metric) |
| `earn[].rate` | yes | Number > 0 and ≤ 1000; a validated play earns `floor(value × rate)` |
| `earn[].max` | no | Integer: the most one play earns by this rule |

Earn rules apply only to validated plays (not rejected, not practice); the result is then capped by `dailyEarnCap` and `max`.

## Leaderboards

`leaderboards` declares boards the game ships with ([Game services](game-services.md)). On publish the CMS creates each one as a game board (LBD-1) of this game, or updates the board with the same `id` from an earlier version; editors can still change titles and limits in the admin, where the board shows as "from the game". The game reads it with `game.leaderboards.get('<id>')`.

| Field | Required | Rules |
|---|---|---|
| `id` | yes | `^[a-z][a-z0-9-]{1,39}$`, unique in the game |
| `title` | yes | 1–60 chars, Slovak, shown to players |
| `metric` | yes | `score` or `metric:<id>` of a declared metric (LBD-1.5) |
| `period` | yes | `day`, `week`, `month` or `all` (Bratislava days, LBD-1.4) |
| `aggregation` | yes | `best`, `sum` or `count` (LBD-1.1) |

At most 100 boards. The other board settings (`minPlayers`, `topN`, `tieBreak`) take the LBD-1 defaults and are edited in the CMS.

## Events

`events` declares the custom events the game sends with `game.track(name, props)` (docs/EVENTS.md). It is optional and additive: a game without it behaves as before. The shell records plays, clicks and errors on its own, so declare only what is specific to the game.

| Field | Required | Rules |
|---|---|---|
| `name` | yes | `^[a-z][a-z0-9_]{1,39}$` (the `track()` name rule), unique |
| `description` | yes | 1–200 chars; what happened, for the CMS and the data team |
| `props` | no | Up to 20; each `{ name, type, description? }` with `name` `^[a-z][a-zA-Z0-9_]{0,39}$` (unique in the event), `type` `string`, `number` or `boolean`, `description` ≤ 120 chars |

A prop name that looks like personal data (e-mail, phone, names, Azet ID…, docs/EVENTS.md "Limits") fails validation. In development, a `track()` of an undeclared event or prop logs a warning.

## Backend

| Field | Default | Meaning |
|---|---|---|
| `path` | `backend/` | Folder with a `Dockerfile` |
| `port` | `8080` | Port the container listens on |
| `health` | `/health` | Must return 200 when ready |
| `database` | `none` | `postgres` provisions a schema and passes `DATABASE_URL` |
| `realtime` | `false` | WebSocket upgrade to the team's **own** backend through the proxy. Not the platform multiplayer: for that use the top-level `realtime:` block (D-77) |
| `resources` | `small` | `small` = 0.25 CPU / 256 MB, `medium` = 0.5 CPU / 512 MB |
| `secrets` | `[]` | Names of secrets injected as env vars from Vault (values never in the repo or CMS) |

The backend receives `Authorization: Bearer <player token>` on every proxied request; verify it with `@azet/games-server`:

```ts
import { verifyPlayerToken } from '@azet/games-server';

const claims = await verifyPlayerToken(req.headers.authorization);
// claims.id (player key), claims.loggedIn, claims.nickname, claims.tenant, claims.game, claims.session, claims.version
```

**On rin-apps (D-76, D-83).** _Live since 21 Oct (AZG-321): from a game repo in the group `rin-apps/azet-games-hry` ([What you can use](capabilities.md#own-backends-on-the-cluster))._ Backends run in the namespace `rin-apps` as `azgb-<tenant>-<slug>` (AZG-321). On the default branch, `ci/game.yml` builds `backend/` into `harbor.rintools.sk/communities/rin/azg-backend-<tenant>-<slug>:sha-<short>` (job `azg:backend`). `azg backend deploy` (job `azg:backend-deploy`) then sends `{ image, digest }` to the CMS. The CMS writes the values file from **this manifest of the published version**: `port`, `health`, `database`, `resources` and `secrets` never come from CI. Then ArgoCD rolls the backend out (chart `packages/backends-chart`). The container runs:

- as a non-root user (UID 10001) with a read-only root filesystem; only `/tmp` is writable (64 MB);
- with `PORT`, `AZG_TENANT`, `AZG_GAME`, `AZG_API` (the CMS inside the cluster), `DATABASE_URL` for `database: postgres`, and every `secrets` name as an env var from Vault `rin-apps/azet-games-backends/<tenant>/<slug>`;
- `health` serves as the startup, readiness and liveness probe.

`database: postgres` gives the game its own role and schema `g_<tenant>_<slug>` (`-` → `_`) in the database `azg_backends`. That schema is the default `search_path`. Other games' schemas and `public` are closed to it (BE-3.1). A backend accepts connections only from the CMS proxy and can reach only DNS, the CMS API and Postgres. There is no internet access. CI v1 builds only `path: backend/`.

## Realtime

> **Approved by Lukáš on 19 Oct (AZG-316, RTM, PRD §5.31).** `azg validate` checks the block; `azg dev` runs the room engine with these values (AZG-323). Reference game: `games/tap-race`.

The top-level `realtime:` block lets the game use the platform's realtime multiplayer service through `game.realtime` (docs/SDK-CONTRACT.md "Realtime multiplayer"). Without the block the room calls (`join`, `create`, `quickMatch`, `playBot`) reject with `realtime_disabled`; players online (`game.realtime.online`) work in every game. The CMS reads the values from the played version's manifest, never from the game.

| Field | Default | Rules |
|---|---|---|
| `maxPlayers` | `8` | Integer 2–50; a full room answers `room_full` |
| `quickMatch` | `2` | Integer 2…`maxPlayers`; players per `quickMatch()` when the game does not pass `players` |
| `stateWrites` | `any` | `any`: every member may write the room state; `host`: only the host (authoritative games), others get `forbidden` |
| `authority` | `members` | `members`: the players' browsers decide (messages between members, any member writes the state as `stateWrites` allows). `referee`: the game's backend decides every room (REF, D-81): members send only to it, only it writes the state, ends rooms and reports results; needs a `backend:` block ([Game services](game-services.md) "Referee") |
| `waitSeconds` | `120` | Integer 10–600 (RTM-13): a room that never gets a second member closes after this with `close` reason `expired` (an invite nobody accepted). A room that has started never expires as waiting |
| `bots.levels` | `[normal]` | 1–5 unique ids `^[a-z][a-z0-9-]{0,19}$` (BOT-1, D-84): the levels `game.realtime.playBot({ level })` accepts; the first is the default. The whole `bots:` block needs `authority: referee` (the referee plays the bots) |
| `bots.after` | none | Integer 5–120: a quick match that waited this long gets bots for its free seats (BOT-3). Without it bots come only from `playBot()` |

Anything else (unknown keys, out-of-range values, `quickMatch` above `maxPlayers`) fails `azg validate`. Realtime works in sandbox tenants (`azet-hackathon`); production tenants answer `realtime_disabled` until Lukáš enables them (RTM-9.2). This block has nothing to do with `backend.realtime`, which concerns a team's own backend.

## Progression

> **PRD §5.37 PRG-1, D-85 (21 Oct).** Every game can have its own levels next to the platform level (PLV-1).

The CMS computes the player's level in this game from their counted plays (validated, not practice, a signed-in or nicknamed player) and returns it in `game.player.get().gameLevel` and in the `profile` of every room member ([Game services](game-services.md) "Own levels").

| Field | Default | Rules |
|---|---|---|
| `source` | `points` | `points`: this game's points; `plays`: the number of counted plays; `metric:<id>`: the sum of a metric declared in `metrics:` |
| `levels` | – | Required. 2–100 numbers ≥ 0: where level 1, 2, 3 … starts; the first is `0`, strictly ascending |
| `titles` | none | One Slovak title per level, 1–24 characters (e.g. `Nováčik`, `Majster`) |

The active version's `progression:` counts, over all plays of the game (also older versions). Changing the levels in a new version re-levels every player at once; the plays themselves never change.

## Matches

> **Approved by Lukáš on 21 Oct (MAT, D-82, PRD §5.34).** `azg validate` checks the block; `azg dev` keeps the matches of every tab in memory with the same rules.

The top-level `matches:` block lets the game use asynchronous turn-based matches through `game.matches` (docs/GAME-SERVICES.md "Matches"): an invite code or quick pairing, seats, a turn, a state the CMS keeps for days. Without the block every `game.matches` call rejects with `matches_disabled`. The CMS reads the values from the version a match was opened in.

| Field | Default | Rules |
|---|---|---|
| `players` | `2` | Integer 2–8; the seats of a match (a game may open smaller matches with `create({ players })`) |
| `turnSeconds` | `86400` | Integer 60–604800; the member on turn who does not move in time loses by forfeit |
| `inviteSeconds` | `86400` | Integer 60–604800; a match still waiting for players expires |
| `authority` | `members` | `members`: players move from the game (fine for casual games, a modified client can cheat); `backend`: only the game backend moves and finishes (`@azet/games-server` `matches`), players send their moves to it through `game.api.fetch`. `backend` needs a `backend:` block |

Anything else (unknown keys, out-of-range values) fails `azg validate`. Matches are independent of `realtime:`: a game can use both (live play while both are online, the match for the result).

## Validation

```bash
azg validate            # manifest, assets, SDK version
azg validate --json     # machine-readable errors: [{ path, message }]
```
