# REST API v1

One API serves the CMS UI, the `azg` CLI, CI pipelines and agents. Base path `/api/v1`. JSON in and out. Every operation the current token may call: `azg api ops`.

## Authentication

| Caller | How |
|---|---|
| CMS UI | NextAuth session cookie + CSRF header |
| CLI (people) | `Authorization: Bearer azg_…` from the device flow |
| Agents | `Authorization: Bearer azg_…` created in the CMS |
| CI | `Authorization: Bearer azg_…` deploy token (CI variable `AZG_DEPLOY_TOKEN`) |
| Game backend | `Authorization: Bearer azg_…` game token (`AZG_GAME_TOKEN`, see [Results](#results-from-a-game-backend)) |
| Game shell | Play session cookie on the tenant host |

**The tenant always comes from the session or token.** No endpoint accepts a tenant parameter, and none lists tenants (tenants come from the seed, DEPLOY.md). A resource in another tenant returns 404, not 403, so its existence does not leak.

## Scopes

| Scope | Allows |
|---|---|
| `games:read` | List and read games, versions, stats |
| `games:write` | Create games; change status, settings, screens, motivation, access, schedule |
| `versions:write` | Publish versions (CI) |
| `versions:activate` | Activate and roll back versions |
| `theme:write` | Change the tenant theme and game appearance |
| `landing:write` | Edit and publish the landing page |
| `promote` | Promote games to another tenant |
| `tokens:write` | Manage tokens |
| `members:write` | Manage members |
| `proposals:decide` | Approve or reject proposals |
| `results:write` | Report authoritative results and wallet credits (game tokens only; never on a personal token, D-70) |
| `players:moderate` | Moderate players: report queue, rename, block, hide, freeze, ban (members `product` and `admin`) |

Agent tokens in production tenants (`kind=production`) can call write endpoints, but the call creates a **proposal** (`202 Accepted` + `proposal` object) instead of applying the change.

## Errors

```json
{ "error": { "code": "validation_failed", "message": "settings.timeLimit must be >= 30", "details": [{ "path": "settings.timeLimit", "message": "must be >= 30" }] } }
```

Codes: `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409), `validation_failed` (422), `payload_too_large` (413), `rate_limited` (429), `internal` (500), `bad_gateway` (502: a system the CMS writes to, e.g. the backends GitOps repo, refused the write).

Credentials and the scope are checked before the body: a write without them is `401` / `403` whatever it sends, and `422` describes a body only to a caller who may make the change (D-68).

A detail may carry its own `code` when a client should explain the problem in its own words, e.g. the zip upload: `{ "path": "id", "message": "…", "code": "id_mismatch" }`.

API errors are always this JSON, also on the public hosts. The designed error pages (ERR-1, ERR-2, D-52) are for browser navigation only: an unknown path on a tenant host or an unknown host renders a page only for `GET`/`HEAD` requests that accept `text/html`; anything else, and every `/api/*` path, keeps a plain or JSON `404` (ERR-2.5).

## Endpoints

### Session and discovery

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/me` | any | Current user or token, tenant, scopes |
| GET | `/ops` | any | Operations this token may call (for agents, `azg api ops`). Any endpoint on this page can be called from the CLI with `azg api call <METHOD> <path>` ([CLI](cli.md#account)) |
| GET | `/docs` | any | The documentation index `{ docs: [{ slug, title, group, summary, url }] }` (HLP-3, `azg docs`) |
| GET | `/docs/{slug}` | any | One document as `text/markdown` — the same text as the CMS Documentation page (HLP-3) |
| POST | `/auth/device` | – | Start device login → `user_code`, `verification_url`, `device_code` |
| POST | `/auth/device/token` | – | Poll with `device_code` → token when approved: a personal token with the scopes of the person's role, without `results:write` (D-70) |
| GET · POST | `/session` | CMS session only | *Internal (the admin UI).* `GET` → the signed-in person `{ user, tenant: { slug, kind, role, team }, memberships, scopes }`; `POST { tenant }` with `x-azg-csrf: 1` switches the tenant cookie (`204`; a tenant you are not a member of is `404`). Tokens get `401`: they are bound to one tenant |
| POST | `/auth/device/approve` | CMS session only | *Internal (the browser page of `azg login`).* `{ userCode: "ABCD-EFGH", tenant }` with `x-azg-csrf: 1` approves a device login for one of your tenants → `204` |
| GET | `/.well-known/jwks.json` | – | Public keys of player tokens (game backends) and realtime tickets (the realtime service, RTM-3.5) |

### Games

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/games` | `games:read` | List games in the tenant |
| POST | `/games` | `games:write` | Register a game `{ name, slug, team, template }` → game, deploy token (once), preview URL, `repo` (GitLab URL or error; `null` in local mode), `mode` |
| GET | `/games/{slug}` | `games:read` | Game with active version and resolved configuration; also `playUrl`, `embedUrl` and `embedSnippet` (SHL-6) |
| PATCH | `/games/{slug}` | `games:write` | Change `name`, `status`, `settings`, `screens`, `motivation`, `access`, `liveFrom`, `liveUntil`, `theme`. `settings` is merged into the stored values; a setting set to `null` is removed, so the game gets the manifest default again (GAM-12.2). `screens`, `motivation` and `theme` replace the stored object: a field left out has its default. `theme` takes `accent` only; uploaded assets are kept (see below) |
| PUT | `/games/{slug}/assets/{kind}` | `games:write` | Upload or replace the per-game `icon`, `cover` or `loadingBackground` (THM-2, raw image body), see below |
| DELETE | `/games/{slug}/assets/{kind}` | `games:write` | Remove the override: the game falls back to the manifest icon / cover and the tenant theme (THM-2.3) |
| GET | `/games/{slug}/matches` | `games:read` | The game's asynchronous matches for the Multiplayer tab: counts by status, median length, the latest 50 (MAT-7, see [Matches](#matches-mat-d-82)) |
| GET | `/games/{slug}/badges` | `games:read` | The active version's badges with this tenant's overrides (BDG-7.2), see [Badge icons and texts](#badge-icons-and-texts-bdg-7-d-54) |
| PATCH | `/games/{slug}/badges/{badge}` | `games:write` | Override or reset `{ title?, description? }` of a game badge in this tenant |
| PUT | `/games/{slug}/badges/{badge}/icon` | `games:write` | Upload or replace this tenant's icon of a game badge (raw image body) |
| DELETE | `/games/{slug}/badges/{badge}/icon` | `games:write` | Remove the icon override: players get the manifest icon again |
| GET | `/games/{slug}/settings-schema` | `games:read` | JSON Schema of the active version's settings |
| GET | `/games/{slug}/stats?range=today|7d` | `games:read` | Players, completions, average time, return rate |
| POST | `/games/{slug}/promote` | `promote` | `{ to }` → draft copy in the target tenant |
| GET | `/games/{slug}/backend` | `games:read` | The registered backend `{ backend: { url, status, updatedAt } \| null }` |
| PUT | `/games/{slug}/backend` | `versions:write` | Register the URL the CMS proxies `/play/session/backend/*` to `{ url }`, or remove it with `{ url: null }` (`azg backend set-url`) → `{ backend }` |
| POST | `/games/{slug}/backend/deploy` | `versions:write` (game deploy token, sandbox tenants) | CI deploys the game backend on rin-apps `{ image, digest }` → `{ image, url, valuesPath, commit }` (BE-2, D-76), see below |
| POST | `/games/{slug}/archive` | `games:write` | Archive (soft delete): sets `disabled` and `archivedAt`; the game is gone from lists, the landing page and public play (404), the games origin stops serving its bundles (404, D-68) and its deploy token is revoked; data is kept and the slug can be registered again. Agent tokens in production tenants get a proposal (`202`) |
| POST | `/games/{slug}/restore` | `games:write` + `members:write` (admins) | Restore the most recently archived game with this slug, still `disabled`; its bundles are served again within a minute. The deploy token stays revoked: publish with a member's login (`azg publish`), or upload in the CMS. `409` while another game uses the slug. Not for game-limited tokens, team members or agent tokens in production tenants (no proposal path) |

**Per-game assets (THM-2, D-53).** `PUT` takes the image as the raw body (any `Content-Type`; the type and dimensions are read from the file): `icon` square PNG, WebP or SVG, 128–1024 px (SVG: square `viewBox`), ≤ 256 KB; `cover` 16:9 PNG, WebP or JPEG, 640–2560 px wide, ≤ 1 MB; `loadingBackground` PNG, WebP or JPEG, sides 320–4096 px, ≤ 1 MB. An SVG with scripts, event handlers, `foreignObject`, a DTD or references other than `#fragment` and inline `data:image/png|jpeg|webp` is refused. A wrong file is `422` with `details[0]` `{ path: "<kind>", message }`, a `Content-Length` over the limit `413`, an unknown kind `404`. The file is stored on the games origin under `<tenant>/__theme/<game id>/<kind>-<hash>.<ext>` (immutable; a replaced file is deleted) and served with an image-only CSP. Both calls return the game; game objects carry `assets: { icon, cover, loadingBackground }` (the uploaded overrides: URL on the games origin, `null` = default) and `theme` keeps the storage keys. **What the game shows (ART-1):** `iconUrl` and `coverUrl` are the override, else the manifest's `assets.icon` / `assets.cover` of the active version, else of the newest uploaded version, so a draft has its art right after `azg publish`; `null` only before the first upload (and `coverUrl` without a cover). Uploads and removals are audited (`game.asset.put`, `game.asset.remove`). Agent tokens in production tenants get `403` (an upload cannot become a proposal). Config documents (`/config`) carry `theme.accent` only; a push keeps the uploads.

**Backend deploy (BE-2, D-76).** The `azg:backend-deploy` job of `ci/game.yml` (`azg backend deploy`) sends `{ image, digest }`: the image CI pushed (`harbor.rintools.sk/communities/rin/azg-backend-<tenant>-<slug>:<tag>`) and its digest (`sha256:<64 hex>`). Only a deploy token limited to the game, in a sandbox tenant: a personal or agent token and every production tenant are `403`, another game of the tenant `403`, an unknown game `404`. The tenant and the game come from the token, so the image must be the repository of this tenant and game. The CMS reads the manifest of the **active version**; without `backend` it is `409`. A foreign image or a malformed digest is `422` with `details[0].path` `image` / `digest`. Otherwise the CMS writes `values/<tenant>/<slug>.yaml` (`backendValues()` of `@azet/games-manifest`: image pinned by digest, `port`, `health`, `database`, `resources` and `secrets` from the manifest, never from CI) to the repo `rin-apps/rin-azet-games-backends` with the commit `chore(backend): <tenant>/<slug> -> <tag> [skip ci]`; the same content again makes no commit (`commit: null`). It then registers `http://<slug>.azet-games-<tenant>.svc.cluster.local` as the game's backend URL (`status: deployed`) and audits `backend.deploy`. When the GitOps repo refuses the write the answer is `502` and nothing is registered. ArgoCD rolls the backend out ([DEPLOY.md](deploy.md#game-backends)).

**On / off** is the game status, not a separate endpoint: on = `PATCH /games/{slug} { "status": "live" }`, off = `PATCH /games/{slug} { "status": "disabled" }` (a disabled game returns 404 in public play and is not on the landing page). `hidden` keeps a game playable by link only. Game objects carry `archivedAt` (`null` unless archived).

### Statistics (STA, MET-4, D-42)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/stats` | `games:read`, members `admin` / `product` | Tenant statistics for a period: totals, a series by day / week / month, the shared-streak distribution, retention numbers (RET-4) and a per-game table (archived games with plays in the period included, `archived: true`), each with the previous period |
| GET | `/stats/games/{slug}` | `games:read`, members `admin` / `product` | The same numbers for one game, its game-streak distribution, its metric statistics (MET-4) and its top custom events (EVT-4.3) |

**Query.** `period` = `today`, `7d` (default), `30d` or `custom` with `from` and `to` (`YYYY-MM-DD`, Europe/Bratislava days, `to` not in the future, at most 366 days); `granularity` = `day` (default), `week` (buckets start on Monday) or `month`. The previous period has the same length and ends the day before `from`. Invalid values → `422`.

**Access (STA-1.3).** Members with role `viewer` or `team` and tokens without `games:read` get `403`. A game-limited token gets only its games: `/stats` returns `games` with those games and `null` for `totals`, `previousTotals`, `change`, `series` and `streaks`; another game's `/stats/games/{slug}` is `404`.

**Numbers (STA-1.1).** `players` (`playersLoggedIn` + `playersAnonymous`) = distinct player keys with a start in the period (or bucket); `starts` = plays; `completions` = completed plays that were not rejected; `completionRate` = completions / starts in %; `avgSeconds` = mean `time_seconds` of completions; `d1Return` / `d7Return` = % of players whose first play in the tenant (or game) was on day X and who played again on X + 1 / on X + 1 … X + 7, over the days X of the period whose window has ended before today. Rates and averages without a base are `null`. `streaks` = signed-in players by their current streak (`shared` on `/stats`, the game's own on `/stats/games/{slug}`) in buckets `1`, `2-3`, `4-7`, `8-14`, `15-30`, `31+`; a streak whose last day is before yesterday is over.

**Player kinds, funnel and custom events (EVT-4, D-57).** Both endpoints add `kinds: { signed_in, nickname, anonymous }`, each with the numbers of `totals` for the players of that kind (a player has one kind a day, the highest of their plays; the kinds add up to the totals; `null` for game-limited callers on `/stats`), `d30Return` in every numbers object (as D7 with X + 1 … X + 30), and `funnel: [{ step, sessions }]` with the steps `sessions`, `loaded`, `started`, `completed` and `sharedOrReplayed` (distinct sessions per day with an event of the step, [EVENTS.md](events.md); on `/stats` over the caller's games). `streaks[]` adds `nickname`: players with a device nickname in the bucket (`players` stays signed-in players). `/stats/games/{slug}` adds `customEvents: [{ name, events, sessions }]`, the 10 most frequent `track` names of the period.

**Comparison (STA-2.1).** `change.<field>` = `{ absolute, relative }` against `previousTotals` (`relative` in %, `null` when the previous value is 0); the whole `change` of a game without plays in both periods is `null` per field (shown as "–").

**Metrics (MET-4).** `metrics[]` follows the `metrics:` of the active version: `{ id, title, unit, type, better, plays, avg, median, min, max, histogram }`, from completed, not rejected plays with stored values (MET-3.2); `histogram` = 10 equal-width bins `{ from, to, plays }` between `min` and `max` (empty without values).

**Retention (RET-4).** `/stats` adds `retention: { challengeCompletions, challengeViews, freezesUsed, remindersSent, remindersClicked, reminderClickRate, returnBySawChallenge: { saw, didNotSee } }` for the period, computed live from the retention tables (`null` for a game-limited token). `challengeViews` = player-days that saw the daily challenge (landing card or `game.challenge.get()`); `remindersSent` includes dry-run sends; `reminderClickRate` = clicks / sends in % (`null` without sends). `returnBySawChallenge.saw` / `.didNotSee` = `{ players, d1, d7 }`: new players of the period (first completed play in the tenant) split by whether they saw the challenge on that first day, and how many of them completed a play again on the next day / within 7 days.

**Source (STA-4, D-42).** Past days come from the rollup tables `stats_daily` (counts, sums, return cohorts and one bit per player in `stats_players`, per `kind`), `stats_funnel_daily` and `stats_events_daily`, recomputed for the last 31 days by the CronJob `stats-rollup` after midnight Europe/Bratislava (`node apps/cms/dist-scripts/stats-rollup.mjs [days]`, idempotent; locally `npm run stats:rollup -w apps/cms`); today is computed live from `plays` and `events`. The DAT-4 player delete also clears the player's bit and index (response field `deleted.statsDays`).

### Tenant badges (BDG-5, D-45)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/badges` | `games:read` | The tenant's badges `{ badges: [{ id, slug, title, description, rule, games, enabled, iconUrl, defaultIcon, holders, updatedAt }] }` |
| POST | `/badges` | `games:write` | Create `{ slug, title, description, rule, games?, enabled? }` → `201` |
| PATCH | `/badges/{id}` | `games:write` | Replace `{ title, description, rule, games?, enabled? }` (the `slug` is fixed) |
| DELETE | `/badges/{id}` | `games:write` | Delete → `204`; players who hold it lose it; its icon file is deleted |
| PUT | `/badges/{id}/icon` | `games:write` | Upload or replace the badge icon (BDG-7.1, raw image body) → the badge |
| DELETE | `/badges/{id}/icon` | `games:write` | Remove the icon: the badge gets the generated icon again → the badge |

Tenant-wide: game-limited tokens and team members get `403`, and agents in production tenants cannot write (`403`, no proposal path). `slug` follows the badge id rules (`^[a-z][a-z0-9-]{1,39}$`, unique per tenant, a duplicate is `409`), `title` 1–40 and `description` 1–120 characters (Slovak, shown to players). `games` are game slugs the rule looks at; empty = every game of the tenant; an unknown slug is `422`. Writes are audited (`badge.create`, `badge.update`, `badge.delete`, target the slug). A badge of another tenant is `404` (BDG-5.1).

**Rule.** The manifest's rule language (BDG-1.2) over the badge's games: `{ when, op, value, period? }` with `when` = `streak` (shared streak), `completions` (completed, not rejected plays of those games), `games` (distinct games of those games with such a play) or `challengeStreak` (daily challenges completed in a row, RET-1; the migration creates `vyzvy-3`, `vyzvy-7` and `vyzvy-30` for the existing tenants); `op` `>=` or `<=`; `value` a number ≥ 0, or `"live"` with `when: games` (= all of those games that are live right now, so `{ when: "games", op: ">=", value: "live", period: "week" }` is "played every live game this week"); `period` `day`, `week` (from Monday, Europe/Bratislava) or `all` (default) narrows `completions` and `games`.

### Daily challenges (RET-1)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/challenges[?from=YYYY-MM-DD&days=n]` | `games:read` | The plan from `from` (default today, Europe/Bratislava) for `days` days (1–62, default 14): `{ challenges: [{ day, title, rule, game, bonusPoints, planned, completions }] }`; days without a plan show the fallback rotation (`planned: false`) |
| PUT | `/challenges/{day}` | `games:write` | Plan or replace the challenge of a day `{ title, rule, game?, bonusPoints? }` → the day; today or later only (`422` for a past day) |
| DELETE | `/challenges/{day}` | `games:write` | Remove the plan → `204`; the rotation fills the day again; `404` when the day has no plan |

Tenant-wide like tenant badges: game-limited tokens and team members get `403`, agents in production tenants cannot write. Writes are audited (`challenge.plan`, `challenge.unplan`, target the day). `title` 1–60 characters (Slovak, shown to players). `rule` = `{ when, op: ">=", value }` in the badge rule language (BDG-1.2) read as a goal for one day: `when` = `games` (different games completed; no `game`), `completions` (completed plays, of `game` if set), `score` (best score in `game`) or `metric:<id>` (sum of the metric in `game`; the game's active version must declare it); `value` an integer 1–1 000 000; `score` and `metric:` need `game` (`422` with `details[0].path` `game`). `bonusPoints` 0–10 000 (default 0). Only counted plays count (completed, not rejected, not practice, by a signed-in or nicknamed player, LBD-5.2). **Fallback rotation:** an unplanned day takes one of the built-in templates (`Zahraj 2 rôzne hry`, `Dokonči 3 hry`, `Zahraj 3 rôzne hry`, `Dokonči 2 hry`) by day; `games` templates only when the tenant has that many live games; no live game = no challenge.

### Badge icons and texts (BDG-7, D-55)

**Icons.** `PUT …/icon` takes the image as the raw body with the THM-2.1 icon rules (D-53): square PNG, WebP or SVG, 128–1024 px (SVG: square `viewBox`), ≤ 256 KB, type and size read from the file, SVGs with active content or external references refused. A wrong file is `422` with `details[0]` `{ path: "icon", message }`, a `Content-Length` over the limit `413`. Icons are stored on the games origin under `<tenant>/__badges/<tenant badge id>/icon-<hash>.<ext>` or `<tenant>/__badges/<game id>/<badge id>-<hash>.<ext>` (immutable; a replaced or removed file is deleted) and served with the image-only CSP of the per-game assets.

**Generated icon (BDG-7.3).** A badge without an icon gets `iconUrl` = an SVG `data:` URL: the first letter of the effective title on the badge colour (a fixed palette, picked from the badge id, so a badge keeps its colour). `GET /badges` returns `defaultIcon: true` for such tenant badges.

**Game badge overrides (BDG-7.2).** `GET /games/{slug}/badges` → `{ badges: [{ id, award, title, description, iconUrl, defaults: { title, description, iconUrl }, overrides: { title, description, iconUrl } }] }` for the badges the active version declares: `award` is `rule`, `game` or `backend`; the top-level values are what players get, `defaults` the manifest values, `overrides` this tenant's values (`null` = the manifest value). `PATCH` takes `{ title?, description? }` (`title` 1–40, `description` 1–120 characters, Slovak); `null` or `""` resets the field, a field left out is kept, any other field (e.g. `rule`) is `422`. All three calls return the badge in the `GET` shape. A badge the active version does not declare is `404`. The rule and the award path never change; overrides are per tenant and a promoted game starts without them.

**Effective values.** Everywhere a badge is shown to players or editors, the overrides replace the manifest values: the `complete` response and `GET /play/{tenant}/badges` (BDG-6), the profile (PRF-3) and the builder's Badges section.

**Access.** Game badge calls follow the game routes (game-limited tokens only for their games, another tenant's game `404`). Tenant badge icons are tenant-wide like the other tenant badge calls. Agent tokens in production tenants get `403` for every badge write (uploads cannot become proposals). Writes are audited: `badge.icon.put`, `badge.icon.remove` (target the slug), `game.badge.update`, `game.badge.icon.put`, `game.badge.icon.remove` (target `<game slug>:<badge id>`). Config documents (`/config`) do not carry badge overrides or icons.

**Evaluation (BDG-3, BDG-3.1).** On every completed play that is not rejected, from the shell (`complete`) or a backend (`/results`), the server evaluates the played version's `rule` badges and the enabled tenant badges that include the game. Game rules: `score` and `metric:<id>` are this play's values (a metric dropped by MET-3.1 never matches), `streak` / `gameStreak` the current shared / game streak, `completions` the player's validated plays of this game in the `period`. Each badge is awarded at most once per player and stored as `trust: "trusted"`; a rejected play awards nothing. Cosmetic awards (`game.award()`) never count (BDG-2.2). Anonymous players get badges on their device's player key (BDG-6.1, D-47).
### Leaderboards (LBD, D-44)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/leaderboards` | `games:read` | The tenant's boards; the default board (MOT-4) first |
| POST | `/leaderboards` | `landing:write` | Create a board → `201` |
| GET · PUT · DELETE | `/leaderboards/{id}` | `games:read` · `landing:write` | Read, replace or delete a board (`204`) |

Body of `POST` / `PUT`: `{ title, scope, game?, games?, metric, period, from?, to?, aggregation, minPlayers?, tieBreak?, topN? }`. `title` (1–60 chars) is shown to players, so it is Slovak.

- `scope`: `game` (one `game` by slug; `metric` is `score` or `metric:<id>` declared by its active version), `tenant` (all games that take part in the leaderboard, `motivation.weeklyLeaderboard`) or `event` (`games`: 1–50 slugs). Tenant and event boards rank `points`. A slug that is not a game of the caller's tenant is `404` (LBD-2.1).
- `period`: `day`, `week` (from Monday), `month`, `all` or `campaign` with `from` ≤ `to` (`YYYY-MM-DD`); days are Bratislava days of the play's start (LBD-1.4).
- `aggregation`: `best` (the best value per player; `score` follows `scoring.higherIsBetter`, a metric its `better`), `sum` or `count` (validated completions, the metric is ignored); sums and counts rank higher first (LBD-1.1).
- `tieBreak`: `earliest` (default; who reached the value first — for `sum` and `count` the completion of the last counted play) or `fastest` (lower `time_seconds` of the deciding play; for `sum` and `count` the total). Equal after the tie-break → the same rank (LBD-1.2).
- `topN` 3–100 (default 10), `minPlayers` 1–100 (default 1, D-54) (LBD-1.3).
- A metric the active version does not declare cannot be saved (`422`, LBD-1.5). A saved board whose metric was dropped later stays readable and returns `metricDeclared: false`.
- The default board is the tenant's MOT-4 weekly points board (`scope: tenant`, `metric: points`, `period: week`, `aggregation: sum`, `minPlayers: 1`, `topN: 20`). It is created with these settings on first listing, can be edited but stays a `tenant` board, and cannot be deleted (`409`).
- Writes: members `product` and `admin` and tokens with `landing:write` (`403` for viewers, team members, game-limited tokens and agent tokens in production tenants). Every write is audited (`leaderboard.create` / `.update` / `.delete`).

Response: `{ id, title, scope, game, games, metric, metricDeclared, period, from, to, aggregation, minPlayers, tieBreak, topN, isDefault, manifestId }`.

**Boards from the game (GSV-5).** A game can declare boards in `leaderboards:` of `azet-game.yaml` (`id`, `title`, `metric` = `score` or a declared metric, `period` `day`/`week`/`month`/`all`, `aggregation`). Activating a version (and promoting a game) creates each new `id` as a `game` board with the LBD-1.3 defaults and `manifestId` = that id; for an existing one it updates `metric`, `period` and `aggregation` and keeps the title, `topN`, `minPlayers` and `tieBreak` editors set. A `PUT` that changes `scope`, `game`, `metric`, `period`, `from`, `to` or `aggregation` of such a board is `422` (the game decides what it ranks). Deleting it works as for other boards; the next activated version that declares it creates it again. Boards the manifest no longer declares stay. The builder's Leaderboards section and the Leaderboards page mark them "From the game". Entries the CMS cannot rank (unknown period, undeclared metric, invalid or duplicate id) are skipped.

### Tournaments (TRN, AZG-211)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/tournaments` | `games:read` | The tenant's tournaments with `status` and `participation` |
| POST | `/tournaments` | `landing:write` (or a team member in a sandbox tenant, TRN-9) | Create a tournament → `201` |
| GET · PUT · DELETE | `/tournaments/{id}` | `games:read` · `landing:write` | Read, replace or delete a tournament (`204`; its page, banner and frozen results go with it) |
| PUT · DELETE | `/tournaments/{id}/banner` | `landing:write` | Upload (raw image body) or remove the banner → the tournament |
| GET | `/tournaments/{id}/winners[?format=csv]` | `landing:write` | The frozen board for the prize handling `{ slug, confirmedAt, confirmedBy, winners: [{ rank, nickname, playerCode, value, prize, listed, member }] }`; `?format=csv` downloads it (columns `rank,nickname,player_code,value,prize,member`). A `member` (a member of this tenant who linked their Azet account, LNK-2, frozen with the board at the end) keeps the rank but has `prize: null`; the prize ranks count only the other players |
| POST | `/tournaments/{id}/confirm` | `landing:write` | Confirm the results → the winners; only then are they public |

Body of `POST` / `PUT`: `{ slug, title, description?, games, startsAt, endsAt, metric, aggregation, tieBreak?, topN?, eligibility, prizes?, rules?, season?, status }`.

- `slug` 2–60 characters `a–z`, `0–9`, `-`, unique in the tenant (`409`); the public page is `/turnaj/{slug}` on the tenant host. `title` (1–80), `description` (≤ 2000) and `rules` (≤ 5000, plain text) are shown to players, so they are Slovak.
- `games`: 1–50 game slugs of the caller's tenant (another tenant's game `404`). The ranking is an event board over these games (LBD-2) with the LBD engine: `metric` `points` (any number of games), `score` (exactly one game, `422` otherwise; `best` follows `scoring.higherIsBetter`) or `metric:<id>` (exactly one game whose active version declares the metric, `422` otherwise; `best` follows the metric's `better`, TRN-8), `aggregation` `best` / `sum` / `count`, `tieBreak` and `topN` as for leaderboards (LBD-1.1–1.3).
- `startsAt`, `endsAt`: ISO 8601 instants **with an offset** (`2026-10-20T18:00:00+02:00`); the admin enters Bratislava time and the page sends its offset (DST included). `endsAt` must be after `startsAt` (`422`). A play counts when it started at or after `startsAt` and completed before `endsAt`; everything else (plays before, plays still running at the end, practice and rejected plays) never counts.
- `eligibility`: `everyone` (signed-in players and anonymous players with a nickname, LBD-5) or `signed_in` (signed-in players only).
- `prizes`: up to 20 `{ from, to, text }` rank ranges 1–100 (e.g. `1–1`, `2–3`, `4–10`); `from` ≤ `to`, ranges must not overlap (`422`, `details[0].path` `prizes.<i>.from`).
- `season`: optional tag (`a–z`, `0–9`, `-`); tournaments with the same tag form a season (see the season page below).
- `status`: `draft` (hidden: the public page is `404`, no SDK listing, no end-screen rank) or `scheduled` (published). The response `status` is `draft`, `scheduled` (before `startsAt`), `live` or `finished` (from `endsAt`). Several tournaments may be live at once.
- Writes: members `product` and `admin` and tokens with `landing:write` (`403` for viewers, game-limited tokens and agent tokens in production tenants). **Team members of a sandbox tenant (TRN-9)** read and write the tournaments whose games are all their team's (also games not yet live) and their banners; a tournament or game of another team is `404`, the list holds only their own. They cannot add or change prizes or the season (`403`, `details[0].path` `prizes` / `season`; send back what an editor set), see the winners, confirm them, or delete a tournament with prizes or confirmed results (`403`). In production tenants team members get `403`. Every write is audited (`tournament.create` / `.update` / `.delete` / `.banner.put` / `.banner.remove` / `.confirm`). Another tenant's tournament is `404` on every endpoint.

Response: `{ id, slug, title, description, bannerUrl, games, startsAt, endsAt, metric, aggregation, tieBreak, topN, eligibility, prizes, rules, season, status, frozen, confirmedAt, participation: { players, plays } }`; `participation` counts the plays that count in the window and their distinct players.

**Banner.** `PUT …/banner` takes the image as the raw body with the THM-2.1 cover rules: 16:9 PNG, WebP or JPEG, 640–2560 px wide, ≤ 1 MB, type and size read from the file (`422` `{ path: "banner" }`, `413` over the size). Stored on the games origin under `<tenant>/__tournaments/<id>/banner-<hash>.<ext>` (immutable, a replaced file is deleted) with the image-only CSP of the per-game assets; `bannerUrl` is its URL, `null` without one.

**Freeze, winners and confirmation.** At `endsAt` the board is frozen: the first read after the end (any endpoint or page) stores the ranking down to `max(topN, last prize rank)` and gives every ranked player a player code (their profile code, PRF-3). Later plays, nickname or opt-in changes never move a rank; `PUT` may still change texts, banner, prizes, season and status, but a change of `games`, `startsAt`, `endsAt`, `metric`, `aggregation`, `tieBreak`, `topN` or `eligibility` is `409`. `GET …/winners` (`409` before the end) returns `{ slug, confirmedAt, confirmedBy, winners: [{ rank, nickname, playerCode, value, prize, listed }] }`: every ranked player, opted in or not, with the player's own nickname, the player code for Azet support and the prize of the rank; never an e-mail or other contact data. `?format=csv` returns the same as `text/csv` (`rank,nickname,player_code,value,prize`; cells that would start a spreadsheet formula are prefixed with `'`). `POST …/confirm` (`409` before the end, idempotent afterwards) records who confirmed when; check the winners against the moderation reports before confirming. The DAT-4 delete removes the player's frozen row (`deleted.tournamentResults`); the other ranks stay as frozen.

**Public pages (TRN-2, TRN-4, no login).** `/turnaj/{slug}` on the tenant host shows the banner, the window in Bratislava time with a countdown, the description, rules, eligibility and prizes, the live board (top N of the players who opted in, PRF-1, plus "your position") and the games with *Hrať*. After the end it shows "results pending" until confirmed, then the frozen top N of the players who opted in (masked as for leaderboards; players who did not opt in are left out, the listed ranks can have gaps) and the viewer's own place. A draft, an unknown slug or another tenant's tournament is `404`. The landing page shows every live tournament as a hero card. `/sezona/{season}` lists the season's published tournaments and a season board: the points of all plays that counted in any started tournament window of the season, summed (top 20 + your position); an unknown season is `404`.

### Player features (PRF-2)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/settings` | `games:read` | The tenant's player feature switches `{ leagues, sharing }` (both `true` until changed), and who joins by e-mail domain `{ autoJoinDomains, autoJoinRole, autoJoinAvailable }` (MEM-1; empty and unavailable in production tenants) |
| PUT | `/settings` | `landing:write` (switches), `members:write` (auto-join) | Change `{ leagues?, sharing? }` (audited `settings.players`) and/or `{ autoJoinDomains?, autoJoinRole? }` (`viewer` or `team`; sandbox tenants only, else `422`; audited `settings.auto_join`) |

Writes as for leaderboards: members `product` and `admin` and tokens with `landing:write`; `403` for game-limited tokens and agent tokens in production tenants. With `leagues: false` every league endpoint is `404`, profiles list no leagues and the session start returns `features.leagues: false` so the shell hides league UI. With `sharing: false` `card` and `challenge` are `404`, existing card pages and OG images are `404`, a challenge token opens the game normally without a `challenge` field, and the session start returns `features.sharing: false` so the shell hides the share button (PRF-2.1). The admin page *Leaderboards* has the same two switches.

### Versions

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/games/{slug}/versions` | `games:read` | Version history |
| POST | `/games/{slug}/versions` | `versions:write` | Start a publish `{ version, kind, ref, commitSha, manifest }` → version in state `uploading` + upload URL template |
| PUT | `/games/{slug}/versions/{version}/files/{path}` | `versions:write` | Upload one file (raw body), path relative to the build output; icon/cover go to `__azg/icon.<ext>` / `__azg/cover.<ext>` |
| POST | `/games/{slug}/versions/{version}/finalize` | `versions:write` | Check the entry and icon exist, freeze the version (`ready`) |
| POST | `/games/{slug}/versions/{version}/activate` | `versions:activate` | Make it the active version (rollback = activate an older one) |
| POST | `/games/{slug}/upload` | `versions:write` (+ `versions:activate` with `activate`) | Publish from a zipped project in one call (REG-7, D-35), see below |
| GET | `/games/{slug}/starter?template=html` | `games:read` | The game's starter package as a .zip (REG-8): template files filled in, `@azet/*` dependencies pointing at `/downloads`, the single-file SDK for `html` |

#### Upload a zipped project

`multipart/form-data` with `file` (the .zip, at most the bundle limit, 20 MB), optional `version` and `activate=true`.

- The zip may contain the project folder or its files. The project is the folder with `azet-game.yaml`; with a build step (`entry: dist/index.html`) only the build output is published, plus the icon and cover, exactly like `azg publish`.
- Hidden files, `__MACOSX` and `node_modules` are skipped; absolute paths and `..` are rejected.
- Without a build step (`entry: index.html`) the project folder is published, except the project files at its root: `azet-game.yaml`, `package.json`, `package-lock.json`, `README.md`, `AI-PROMPT.md`, `CLAUDE.md`, `AGENTS.md` and `backend/`. `azg publish` uses the same rule.
- Version: `version` if given, else `package.json`'s version if it is free, else the next patch after the highest `x.y.z` (`1.0.0` for the first).
- `201` → the version (`state: ready`, `active`), `files`, `bytes`, manifest `warnings`, `previewUrl`.
- `422` → `details[].code` is one of `invalid_zip`, `too_large`, `unsafe_path`, `manifest_missing`, `manifest_invalid`, `id_mismatch`, `entry_missing`, `asset_missing`. Nothing is stored. `409` when the version exists, `403` without the scopes or when a deploy token tries to activate in a production tenant.

```bash
curl -H "Authorization: Bearer $AZG_TOKEN" -F file=@hra.zip -F activate=true "$AZG_API/api/v1/games/hviezdy/upload"
```

### External games (EXT, D-64)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/external-games` | `games:read` | `{ externalGames: [{ id, slug, name, description, url, category, session, source, coverUrl, team, enabled, updatedAt }] }` |
| POST | `/external-games` | `games:write` | Add `{ slug, name, url, category, description?, session?, source?, team?, enabled? }` → `201`; a slug used by a game or another external game is `409` |
| PATCH | `/external-games/{slug}` | `games:write` | Change any field but the slug |
| DELETE | `/external-games/{slug}` | `games:write` | Delete → `204`; its cover is deleted and its landing tiles stop rendering |
| PUT | `/external-games/{slug}/cover` | `games:write` | Upload or replace the cover (raw image body, THM-2.1 cover rules) |
| DELETE | `/external-games/{slug}/cover` | `games:write` | Remove the cover |

Tenant-wide like tenant badges: game-limited callers get `403`, agent tokens in production tenants `403`. EXT-4: in a sandbox tenant a `team` member works with the external games of its own team (`team`): its new game belongs to the team, another team's or an editors' game is `404`, and a `team` other than its own is `403` (`path: team`); editors may set `team` or `null`. Landing tiles place an external game by its slug (`PUT /landing` accepts the slugs of enabled and disabled external games).

### Appearance and landing

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/theme` | `games:read` | Draft and published tenant theme |
| PUT | `/theme` | `theme:write` | Save the draft |
| POST | `/theme/publish` | `theme:write` | Publish the draft |
| GET | `/landing` | `games:read` | Draft and published landing page |
| PUT | `/landing` | `landing:write` | Save the draft (sections, tiles, featured) |
| POST | `/landing/tiles` | `landing:write` | Place or move one tile in the draft `{ game, section, size?: small\|medium\|large, order?, label? (≤ 30), enabled? }` → `{ draft }` (`azg landing place`; a proposal in production tenants) |
| DELETE | `/landing/tiles` | `landing:write` | Remove one tile from the draft `{ game, section }` → `{ draft }` (`azg landing remove`) |
| POST | `/landing/publish` | `landing:write` | Publish the draft |

**Template (THM-4, D-63).** The theme's `mode` is `light`, `dark`, `auto` (follows the device) or `halloween`. `halloween` styles the public games pages with the Halloween background and sends games `mode: dark` with the Halloween colours; any other value is `422`.

### Config as code

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/config` | `games:read` | Whole tenant configuration as one document (games, theme, landing) |
| POST | `/config/diff` | `games:read` | Diff a document against the current state |
| PUT | `/config` | write scopes for every changed area | Apply a document (or create a proposal) |

### Players and data (PLY, DAT, D-57)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/players?q=` | `games:read`, members `admin` / `product` | Up to 50 signed-in and nickname players, newest activity first; `q` matches a nickname substring, an exact profile code or an exact reference (PLY-1). Each row has `member`: the name of a member of this tenant who linked this Azet account (LNK-2), else `null` |
| GET | `/players/{ref}` | `games:read`, members `admin` / `product` | One player (PLY-2); audited `player.view` |
| GET | `/players/{ref}/events?game=&type=&before=` | `games:read`, members `admin` / `product` | The player's events, newest first, 100 at a time; `before` (ISO time) pages back (PLY-3); audited `player.events` |
| DELETE | `/players/{key}` | `members:write` | DAT-4 delete by player key or by reference `p-…` (PLY-4); not for game-limited callers or agents in production tenants |
| GET | `/events/export?from=&to=` | `games:read`, not game-limited | DAT-2 export, NDJSON, at most 31 days and 100 000 events |

**Access (PLY-1.1).** Only sessions and personal tokens of `admin` and `product` members; `viewer` and `team` members, agent and deploy tokens and game-limited callers get `403`. A player is addressed by its reference `ref` = `p-` + the first 16 hex characters of the SHA-256 of the player key; the key, the anonymous ID and the Azet ID are never returned (PLY-2.1). Anonymous players without a nickname and players of another tenant are `404` (PLY-1.2, PLY-2.3). A malformed `before` is `422`. `Cache-Control: no-store`.

**Player.** List rows are `{ ref, kind, nickname, code, firstSeen, lastSeen, plays }` (`kind` = `signed_in` / `nickname`, `code` = the public profile code or `null`). The detail adds `settings: { publicBoards, showNickname, profileShareable }`, `marketingConsent`, `games: [{ slug, name, plays, completions, best, last, lastPlayed }]` (best in the game's scoring direction, from valid non-practice plays), `pointsByWeek: [{ week, points }]` (last 12 weeks, weeks start on Monday), `streaks: [{ scope, game, current, best, lastDate }]`, `badges` (as BDG-6) and `leagues: [{ name, owner, closed }]`. Timeline events are `{ ts, game, version, type, name, payload }` plus `types` (every type the player has).

**Export (DAT-2, EVT-5).** One JSON object per line: `{ ts, playDate, tenant, game, version, session, player, playerKind, loggedIn, marketingConsent, type, name, payload }`; the columns are described in [EVENTS.md](events.md#where-the-events-go).

### Moderation (MOD, D-61)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/moderation/reports` | `players:moderate` | Open reports grouped by player → `{ open, players: [{ player, reports }] }`, the player with the newest report first |
| GET | `/moderation/players?q=` | `players:moderate` | Players whose nickname contains `q` (at least 2 characters, at most 20 results) → `{ players: [player] }` |
| GET | `/moderation/players/{id}` | `players:moderate` | `{ player, reports, history }` |
| POST | `/moderation/players/{id}` | `players:moderate` | One action `{ action, reason, duration? }` → the same shape as `GET` |

A `player` is `{ id, nickname, loggedIn, nicknameRequired, hidden, economyFrozen, bannedUntil, permanentBan }`; `id` is the player's id in this tenant (the same as a leaderboard `entryId`), never the player key. `bannedUntil` is the ISO end of an active ban, else `null`. A report is `{ id, reason, nickname, details, createdAt }`: `reason` `nickname`, `cheating`, `other` (from players) or `suspicious_score` (MOD-7, `details` `{ score, seconds, p999?, nearMax? }`); `nickname` is the one listed when reported. `history` is `[{ at, actor, action, reason, until }]`, newest first, from the audit log.

Actions (MOD-1 to MOD-5), each needing `reason` (1–500 characters):

- `rename`: the nickname becomes `Hráč` + 4 digits and `nicknameRequired: true`; the player's next completion returns `nicknameReset: true` and `nicknamePrompt: true`, and `PUT /play/{tenant}/nickname` (allowed then also for a signed-in player) ends the reset. A signed-in player's session start no longer overwrites the nickname with the account's.
- `block`: as `rename`, and the nickname (lower case, at least 4 characters, because the list matches inside names) is added to the tenant deny list (MOT-6).
- `hide` / `unhide`: public boards skip the player; they still count for ranks and see their own `me`.
- `freeze` / `unfreeze`: the in-game economy (AZG-196) refuses the player's earn and spend.
- `ban` with `duration` `1d`, `7d` or `permanent` / `unban`: while banned, completions and backend results are stored as `restricted` and count for nothing (see below), and public boards skip the player.
- `dismiss`: closes the open reports without an action.

Every action except `unhide`, `unfreeze` and `unban` resolves the player's open reports. Every action is audited as `player.moderate` with the player id as target and `{ action, reason, until, … }` in `after`. `403` for viewers, team members, game-limited tokens and agent tokens in production tenants (also for reads); `404` for an unknown id or a player of another tenant; `422` for a missing reason, an unknown action or a ban without `duration`.

### Proposals, tokens, members, audit

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/proposals` | `games:read` | Open and decided proposals; team members and viewers get only their own (MEM-8) |
| POST | `/proposals` | `games:read` | A request in words `{ text }` (3–2000 characters) → `201` proposal with `change: { kind: 'request', text }`; people only (sessions, personal tokens), agent tokens `403` (MEM-8). Approving marks it done; nothing is replayed |
| POST | `/proposals/{id}/approve` · `/reject` | `proposals:decide` | Decide |
| GET · POST · DELETE | `/tokens`, `/tokens/{id}` | `tokens:write` | Manage tokens. `POST` `{ name (1–60), kind: 'agent' \| 'user' (default agent), scopes: [...], games?: [<game id>], expiresInDays?: 1–365 (default 90) }` → `{ id, value, expiresAt }` (the value is returned only here). `games` takes game **ids** (UUID, from `GET /games/{slug}`), not slugs; a game token is `{ kind: 'agent', scopes: ['results:write'], games: [<id>] }` ([Results](#results-from-a-game-backend)). `GET` → `{ items }` |
| GET · POST · PATCH · DELETE | `/members`, `/members/{id}` | `members:write` | Manage members and roles |
| GET · POST · DELETE | `/account/azet` | Your own session only (tokens `403`; writes need `x-azg-csrf: 1`) | Your Azet account (LNK-1, D-88). `GET` → `{ available, linked, linkedAt }` (`available: false` without Azet login on the platform). `POST` → `{ url }`: open it in the browser; it is `/auth/link?k=<signed request>` on the tenant host (10 minutes, the newest request only, one Azet login per request) and returns to `/admin/account/password?azet_proof=<proof>` (or `?azet=expired \| taken`). `POST /account/azet/confirm` `{ proof }` with the same person's session → `{ outcome: 'linked' \| 'expired' \| 'taken' \| 'mismatch', status }` (the account page does this by itself). `409` without Azet login. `DELETE` unlinks → the status. Audited `user.azet_link`, `user.azet_unlink` |
| POST | `/members/{id}/password-reset` | `members:write` | Clear a member's personal password (MEM-6); they sign in with the access code once and set a new one. Another tenant's member is `404`; audited `user.password_reset` |
| GET | `/teams` | `games:read` | The tenant's teams (TMS-1, op `teams.list`): `{ items: [{ name, member, members, games }] }`; `member` is true for the caller's own team (always false for agent tokens, which have no team), `games` counts games that are not archived. Names and counts only; members and the invite link are on `/team`. A token limited to some games gets `403` |
| GET | `/team` (`?team=` for editors) | `games:read` | The caller's team `{ team, members[{ name, email, role }], games, teams, role }` (MEM-3.1); people only (sessions, personal tokens) |
| POST | `/team` | `games:write` | Create a team `{ name }` and be in it (team members without a team, MEM-2.1) → `201`; a taken name (case-insensitive) is `409`, except the name of an empty team (no members, no games), which is created anew (MEM-3.6) |
| POST | `/team/invite` (`?reset=1`, `?team=` for editors) | `games:write` | The team's invite link `{ url, path, team, expiresAt }`, valid 7 days; `reset=1` makes earlier links stop working (MEM-3.2) |
| POST | `/team/join` | `games:write` | Join with `{ token }` (the link or its token) → `{ team, joined }`; expired / replaced / forged → `422` with `details[0].code` `expired`, `replaced`, `invalid`; another tenant's invite → `404` (MEM-3.3) |
| PATCH | `/team` (`?team=` for editors) | `games:write` | Rename the team `{ name }` → `{ team }` (MEM-3.5): members, games and invite links follow; a name of another team (case-insensitive) is `409`, no team (or none picked) `409` |
| POST | `/team/leave` | `games:write` | Leave the team (MEM-3.4); not in a team → `409`; the last member out of a team without games removes the team (MEM-3.6) |
| POST | `/account/password` | session only | Set or change your own password `{ current?, password, confirm }` (MEM-5.3; `current` when you have one; ≥ 10 characters, not the access code); tokens get `403` |
| GET | `/audit?target=&actor=&limit=` | `games:read` | Audit log; for editors and tenant-wide tokens, team members and viewers get `403` (MEM-7) |

### Play (used by the shell, not by the CLI)

The tenant of a public play page is part of its URL (`/t/{tenant}/play/{slug}` locally, the tenant host in production). Session start returns a signed **play token**; every later call sends it as `Authorization: Bearer <play token>` and the server takes the tenant, game, session and player from it.

| Method | Path | Purpose |
|---|---|---|
| POST | `/play/{tenant}/{slug}/sessions` | Start a play session `{ prefer?, version?, challenge? }` → `sessionId`, `nonce`, `playToken`, init payload, game info (incl. the scoring direction `higherIsBetter` for the challenge verdict), `features: { leagues, sharing, realtime }` (PRF-2; `realtime`: the shell connects the session to the realtime service, RTM-18), `challenge` (only with a challenge token, SHR-3). Sets the anonymous-player cookie. `version` (preview of a specific version) only in sandbox tenants |
| POST | `/play/session/events` | Batch of 1–100 shell events `{ events: [{ type, payload, ts }] }` → `204` (`start` opens a play). Only the types of [EVENTS.md](events.md) are stored; the server drops other types, cleans personal-data keys and limits a session to 300 events a minute and 2 000 in total, without an error (EVT-2); `start` and `complete` are not counted in the total but have their own limit of 60 a minute (HUB-6), so a hub plays hundreds of rounds in one session |
| POST | `/play/session/complete` | Completion `{ score, timeSeconds?, success?, details?, stats? }` → points, streaks, percentile, `rejected` (too fast / out of range / `too_many`: a compact game's play over 60 counted plays of the player in the last hour, HUB-5), `statsRejected` (see below), `boardPrompt: true` once (PRF-5, see below), `nicknamePrompt: true` (LBD-5, see below), `dailyChallenge`, `sharedStreak.freezeUsed`, `reminderPrompt: true` once (RET, see below), `restricted: true` / `nicknameReset: true` (MOD, see below), `refereePending: true` (a game with `realtime.authority: referee` before its referee reported: nothing stored, REF-7) |
| POST | `/play/session/daily-challenge` | `game.challenge.get()`: today's challenge with the player's progress → `{ challenge: { date, title, progress, target, completed, bonusPoints, streak } \| null }` (RET-1, see below) |
| POST | `/play/session/award` | `game.award()`: `{ badge }` → `{ badge, trust: "cosmetic", new }` (BDG-2, see below) |
| POST | `/play/session/share` | `game.share()`: `{ text }` → `204`; the share text of the session's latest play (SHR-1, see below) |
| POST | `/play/session/card` | Result card of the session's latest finished play → `201 { code, url, imageUrl }` (SHR-2, see below) |
| POST | `/play/session/challenge` | Challenge link to the same daily level → `201 { url, expiresAt }` (SHR-3, see below) |
| POST | `/play/session/report` | `game.leaderboards.report()`: `{ entryId, reason }` → `204` (MOD-6, see below) |
| POST | `/play/session/tournaments` | `game.tournaments.get()`: `{ tournaments: [{ slug, title, status, startsAt, endsAt, url, me }] }` (TRN-2, see below) |
| POST | `/play/session/store` | Key-value store `{ op: get|set|delete|incr|list, scope, key, value?, by?, limit? }`. SDK error codes in `error.details[0].path` |
| ANY | `/play/session/backend/{path}` | Proxy to the game backend with a player token (L7) |
| GET | `/play/{tenant}/badges` | The current player's badges in the tenant (BDG-6, see below) |
| GET | `/play/{tenant}/leaderboard[?board=<id>]` | The tenant's default weekly board (MOT-4), or a configured board (LBD-3, see below) |
| GET · PUT | `/play/{tenant}/settings` | The player's privacy settings (PRF-1, see below) |
| PUT | `/play/{tenant}/nickname` | An anonymous player chooses a nickname `{ nickname }` → `{ nickname, me }` (LBD-5, see below) |
| POST | `/play/{tenant}/reports` | "Nahlásiť" on the leaderboard page: `{ entryId, reason }` → `204` (MOD-6, see below) |
| GET · POST | `/play/{tenant}/leagues` | The player's leagues `{ leagues: [...] }`; create one `{ name, board? }` → `201` (LEA-1, see below) |
| POST | `/play/{tenant}/leagues/join` | Join with a code `{ code }` (LEA-1.1) |
| GET · PATCH · DELETE | `/play/{tenant}/leagues/{id}` | Members and the league board (LEA-2); rename `{ name }` and close (`204`) for the owner |
| DELETE | `/play/{tenant}/leagues/{id}/members/{memberId}` | The owner removes a member, a member leaves (`204`) |
| GET | `/play/{tenant}/profile/{code}` | A player profile (PRF-3, see below) |
| GET · POST | `/play/reminders/unsubscribe?t=<token>` | One-click unsubscribe from streak reminder e-mails (signed link, no login) → a Slovak HTML page; `400` for an invalid link (RET-3, see below) |
| GET | `/play/reminders/open?t=<token>` | The reminder's deep link: records the click → `302` to the player's last game (RET-3) |
| GET | `/play/session/player` | `game.player.get()`: the player of the play token (GSV-1, see [Game services](#game-services-gsv-d-58)) |
| GET | `/play/session/points` | `game.points.get()`: `{ week, rank, lifetime }` (GSV-6) |
| PUT | `/play/session/nickname` | `game.player.setNickname(name)`: `{ nickname }` → `{ nickname, me }` (GSV-2) |
| GET | `/play/session/leaderboards` | `game.leaderboards.list()` → `{ leaderboards: [...] }` (GSV-4) |
| GET | `/play/session/leaderboards/{id}?around=top\|me&limit=` | `game.leaderboards.get(id, { around, limit })` (GSV-4) |
| POST | `/play/session/wallet` | `game.wallet.*`, `game.shop.buy`, `game.inventory.*`: `{ op, … }` → `{ balances, inventory, duplicate? }` (ECO-4, see [Currency and shop](#currency-and-shop-eco-d-60)) |
| POST | `/play/session/matches` | `game.matches.*`: `{ op, … }` → a match or `{ open, finished }` (MAT-1, see [Matches](#matches-mat-d-82)) |
| POST | `/play/session/realtime` | A realtime ticket for the shell's WebSocket → `{ url, ticket, expiresAt }` (RTM-3, D-77, see below) |
| POST | `/api/dev/player?name=` | **Local only:** log in as a fake player (empty name = log out) |

**Realtime tickets (RTM-3, D-77).** `POST /play/session/realtime` with the play token and no body (anything sent is ignored) returns `{ url, ticket, expiresAt }`: `url` is the realtime service (`wss://azet-games-realtime.rin.rinapps.dev/v1`, `REALTIME_URL`), `ticket` an ES256 JWT signed with the player-token key (`kid` of `/.well-known/jwks.json`), `iss` `azet-games-cms`, `aud` `azg-realtime`, `sub` the player key, a random `jti`, `exp` = `iat` + 60 s (`expiresAt`), and the claims `tenant` and `game` (slugs), `version` (version id), `session`, `nickname`, `maxPlayers`, `quickMatch`, `stateWrites`, `waitSeconds`, `authority` and `bots` (from the `realtime:` block of the played version's manifest with its defaults: 8, 2, `any`, 120, `members`, none; RTM-8.1, BOT-1), and `profile` `{ level, gameLevel, week, rank }` of a player with a nickname (PRS-2: platform level, the game's level, this week's points, the rank only with `showNickname`). A version without a `realtime:` block gets a ticket with `rooms: false` (presence only, RTM-18). `nickname` is the player's nickname for signed-in and nickname players, `null` for anonymous players, for a nickname a moderator hid (MOD-3) or reset (until the player chose a new one, MOD-2) and for a deny-listed one (RTM-3.4); hiding it from boards (PRF-1) does not hide it in rooms (NICK-1). A session with `nickname: null` cannot enter a room (`nickname_required`). The service accepts a ticket once and only within 60 s; the shell asks for a new one on every (re)connect. Errors: `401` without a valid play token; `403` with `details[0].path` `realtime_disabled` when the tenant is a production tenant (`azet`, `koktejl`; sandbox only until Lukáš enables them, RTM-9.2) or no service is configured; `403` `forbidden` for a banned player (MOD-5); `404` when the token's version does not belong to its game. At most 30 calls a minute per session (`429`), `Cache-Control: no-store`. The ticket is never passed to the game (D-77).

**Leaderboards (MOT-4, LBD-3, LBD-4).** Without `board` the response is the MOT-4 weekly board `{ weekStart, enoughPlayers, minPlayers, entries: [{ entryId?, rank, nickname, points, me }], me }` built from the tenant's default board. With `board=<id>` it is `{ board: { id, title, scope, game: { slug, name } | null, metric, period, aggregation, topN }, from, to, enoughPlayers, minPlayers, entries: [{ entryId?, rank, nickname, value, me }], me }`. Another tenant's board, a malformed id and a board of a game that is not live are `404`. Only completed, not rejected plays of signed-in players and of anonymous players who had chosen a nickname (LBD-5) count; for metric boards also not `statsRejected` ones; cosmetic badges never count (LBD-4.1). `entries` holds the top N once at least `minPlayers` players are ranked (else `[]`); `me` is the caller's rank and value even outside the top N, `null` for anonymous players without a nickname (LBD-3.1). Nicknames pass the tenant deny list (MOT-6). Only players who opted in to public boards (`publicBoards`, PRF-1) are listed; everyone else still counts for `minPlayers` and the ranks (the listed ranks can have gaps) and sees their own position in `me` (PRF-1.1, LBD-4.2). Players a moderator hid or banned are not listed either (MOD-3, MOD-5). A player who chose `showNickname: false` is listed as `Hráč`. Colliding listed nicknames get `#2`, `#3` (LBD-5.4).

**Entry ids and reports (MOD-6, D-61).** Every listed entry of a public board (both shapes above) except the caller's own carries `entryId`, an opaque id of the listed player in this tenant; league boards have none. `POST /play/{tenant}/reports` (JSON, the player from the request's cookie, which it sets for a first-time visitor) and `POST /play/session/report` (play token) take `{ entryId, reason }` with `reason` `nickname`, `cheating` or `other` and queue the report for the tenant's moderators → `204`. An unknown entry or one of another tenant is `404`, the caller's own entry or another reason `422`, the sixth report of a device in a Bratislava day `429` (MOD-6.1); an address gets at most 60 requests a minute.

**Moderated players (MOD-2, MOD-5, D-61).** A completion of a banned player is stored but counts for nothing: `restricted: true`, `points: null`, no streaks, percentile, `weeklyRank` or badges, and no `rejected`, `loginRequired` or nickname prompt; the shell says "Tvoj účet je obmedzený". A backend result (`POST /results`) of a banned player returns `restricted: true` and `points: null`. After a moderator reset of the nickname the completion returns `nicknameReset: true` and `nicknamePrompt: true` until the player chooses a new one. A counted play with an improbable score is added to the moderation queue as `suspicious_score` (MOD-7.1) and still counts.

**Metrics (MET-2, MET-3, D-43).** `stats` is an object `{ <metric id>: number }` checked against the `metrics:` of the played version's manifest. An invalid object never fails the request and never costs the score: its values are dropped as a whole, the result counts by the usual rules and the response carries `statsRejected`: `undeclared` (an id the version does not declare, or any `stats` when it declares no metrics), `invalid_type` (not an object, not a finite number, a non-integer for `integer`) or `out_of_range` (outside `min`/`max`, a negative `duration`). Valid values are stored per play, also on a rejected play (too fast / out of range) for diagnostics; such plays never count (MET-3.2).

**Awards (BDG-2, D-45).** Only a badge the played version declares with `award: game` can be awarded; anything else (undeclared id, a `rule` badge, `award: backend`, not a string) is `422` with `details[0]` `{ path: "invalid_payload", code: "invalid_payload" }` and awards nothing. A badge is held once per player and game: a repeat returns `200` with `new: false`. These awards come from the client and are always stored and returned with `trust: "cosmetic"`; they never count toward tenant badges, leaderboards or statistics.

**Weekly rank on the end screen (LBD-5.6).** After a counted play `complete` (and the end screen of a backend result) returns `weeklyRank: { rank, points }`: the player's place and points on the tenant's default weekly board, also when the player is not listed (PRF-1.1). Absent when the play did not count.

**Tournaments in the game (TRN-2).** `POST /play/session/tournaments` lists the published tournaments that include the session's game: `scheduled`, `live` and those finished in the last 14 days, by start. `url` is the public page (`/turnaj/{slug}`, locally `/t/{tenant}/turnaj/{slug}`); `me` is `{ rank, value }` of the session's player on the live board or, after the end, on the confirmed frozen board; `null` otherwise. After a play that counted in a live tournament of the game, `complete` (and the end screen of a backend result) returns `tournament: { slug, title, rank, url }` (the tournament ending soonest when there are several); absent otherwise. `Cache-Control: no-store`, at most 60 calls a minute per session.

**Badges on the end screen and in the profile (BDG-6).** `complete` returns `badges` when the play has awards: everything awarded during this play (rule, backend and tenant badges, and the game's cosmetic `award()` calls), each `{ id, title, description, iconUrl, trust, game, awardedAt }`; `game` is the game slug, `null` for a tenant badge; `title`, `description` and `iconUrl` are the effective values (BDG-7): the tenant's override, else the manifest value (the published icon `__azg/badges/<id>.<ext>` in the bundle) or, for tenant badges, the badge's own; a badge without an icon gets the generated one (BDG-7.3), so `iconUrl` is `null` only for a badge whose game or declaration is gone. Without awards the field is absent. `GET /play/{tenant}/badges` returns `{ badges: [...] }` in the same shape for the player of the request (Azet ID or the anonymous-player cookie, never a parameter): all their badges in this tenant, cosmetic ones with `trust: "cosmetic"` (BDG-2.2). Anonymous players see only the badges of their device's key (BDG-6.1). `Cache-Control: no-store`.

**Share text (SHR-1.1, D-48).** Plain text, at most 280 characters (Unicode code points) and 8 lines; longer is `413` with `details[0]` `{ path: "too_large", code: "too_large" }`, a non-string is `422` `invalid_payload`. The text is stored verbatim on the session's latest play (an empty string clears it) and is never rendered as HTML. Before the shell's `start` event there is no play yet → `409`.

**Result cards (SHR-2, D-48).** `card` makes one card per play (a repeat returns the same `code`). The session's latest finished play must not be rejected: a rejected play is `422` with `details[0].code` `rejected`, no finished play yet is `409`. `url` is the public card page on the tenant host, `/r/{code}` (locally `/t/{tenant}/r/{code}`), `imageUrl` its OG image `/r/{code}/og` (PNG 1200×630, `Cache-Control: public, max-age=300`). Both work without login and show only server data: game name, score, the game streak when the card was made and the share text, drawn as plain text; never the player key. A card whose play is gone (DAT-4, response field `deleted.cards`), later rejected by the game backend, or whose game is archived or disabled is `404`; so is a code on another tenant's host.

**Challenge links (SHR-3, D-48).** `challenge` signs the game, the level date and the challenger's play for 30 days and returns the play page URL with `?c=<token>`. Only games whose played version has `levels.mode: daily`; otherwise `422` `not_daily`; a rejected play is `422` `rejected`, a practice play `422` `practice`. The play page sends the token as `challenge` when it starts the session; the response then carries
`challenge: { valid: true, date, practice, opponent: { score, success, timeSeconds } }` and `init.level` is that date with its seed. A past `date` is **practice**: the result returns `practice: true`, `points: null`, no streaks, no percentile, and the play never counts for leaderboards or badges (SHR-3.1). A tampered or expired token, one of another tenant or game, a game without daily levels or a challenger play that is gone gives `challenge: { valid: false, message }` and today's level as usual (SHR-3.2).

**Player login (AUTH, D-56).** Not under `/api/v1`: on the tenant host (locally `/t/{tenant}/…`) `GET /auth/login?return=<path>` redirects to Azet OAuth (code + PKCE S256), `GET /auth/callback` checks the state against the signed login cookie, exchanges the code server-side, verifies the access token (RS256, expiry, audience) and reads `/resource`, then sets the `azg_player` session cookie (HttpOnly, SameSite=Lax, Secure on https, 30 days) and answers `303` to the same-host return path; any failure is `400` without a session. `POST /auth/logout?return=<path>` clears it (`303`); a request whose `Origin` is not the tenant's public origin is `403`. On a sandbox tenant `GET /auth/login` first shows a choice (CML-3): `GET /auth/cms?return=<path>` signs in with the CMS account (CML-1: state cookie `__Host-azg_cms_login` on https, the CMS page `/admin/player-login?tenant&state` answers `303` to `GET /auth/cms-callback?ticket=…` for a member of the tenant, else `403`; the callback sets `azg_player` or answers `400`; production tenants `404`), and `?via=azet` goes straight to Azet. `GET /auth/link?k=<signed request>` starts the same login for a CMS member linking their Azet account (LNK-1; the request comes from `POST /api/v1/account/azet`); the callback then holds the key and answers `303` to the CMS account page with `?azet_proof=<proof>` (or `?azet=expired \| taken`) instead of the return path; the CMS session confirms the proof. An invalid request goes to the account page with `expired`. All four are `404` when the `AZET_OAUTH_*` configuration is missing. Every player endpoint below treats a valid session of the same tenant as the signed-in player; a session of another tenant is ignored.

**Player settings (PRF-1, PRF-4, PRF-5, D-49).** The player is the one of the request (Azet ID or the dev player; never a parameter); settings are per tenant (PRF-1.2). `GET` returns `{ loggedIn, nickname, showNickname, publicBoards, profileShareable, streakReminder, profileUrl }`; defaults are `showNickname: true`, `publicBoards: false`, `profileShareable: false`, `streakReminder: false` (RET-3). `profileUrl` is the player's own profile page on the tenant host, `/u/{code}` (locally `/t/{tenant}/u/{code}`); `null` for anonymous players. `PUT { showNickname?, publicBoards?, profileShareable?, streakReminder? }` returns the same shape; anonymous players get `403` (device-only, PRF-4). The first counted completion of a signed-in player who has not opted in returns `boardPrompt: true` exactly once; the shell then asks whether to appear on public boards and answers with `PUT { publicBoards }` (any answer, and any earlier change of `publicBoards`, ends the prompt). `Cache-Control: no-store` on every player endpoint.

**Nickname for anonymous players (LBD-5, D-54).** `PUT /play/{tenant}/nickname` with a JSON body `{ nickname }` stores a nickname on the anonymous player key of the request (the `azg_anon` device cookie; never a parameter), for this tenant only. The nickname is trimmed (inner whitespace collapsed) and has 2–20 characters: letters, digits, space, `_`, `.` and `-`. Anything else is `422` with `details[0].path` `nickname`. A word of the tenant deny list is `422` with `details[0]` `{ path: "nickname", code: "denied" }` and the same Slovak message as a league name (MOT-6). A device can change its nickname 5 times a Bratislava day; saving the current nickname again is not a change. The sixth change is `429` (`rate_limited`), and an address gets at most 60 requests a minute and at most 20 new nicknames (a device's first) an hour per tenant, 200 on a sandbox tenant (MOD-8.2: an office or the VPN is one address); beyond that `429` with `details[0].code: 'flood'`, logged as `nickname_flood` (MOD-8.1). A signed-in player gets `403`, because they keep the nickname of their account, except after a moderator reset it (MOD-2.1). The response is `{ nickname, me }`, where `me` is the player's entry on the tenant's default board in the MOT-4 shape (`{ rank, nickname, points, me: true }`), or `null` before a counted play.

Choosing a nickname is the opt-in to public boards (`publicBoards: true`, PRF-1). From then on the player's completions and backend results (BE-6) earn points and streaks, and they count for every board. Earlier plays of the device never count. Settings `GET` returns the anonymous player's `nickname` and `publicBoards`, the session start returns it in `init.player.nickname` (`loggedIn` stays `false`), and the leaderboard returns `me` for them. Leagues stay `403` and there is no profile (`profileUrl: null`, settings `PUT` `403`). A valid completion that did not count because the player is anonymous without a nickname returns `loginRequired: true` and `nicknamePrompt: true`, and the shell shows the nickname field. A nicknamed player gets `loginRequired: false` and no `nicknamePrompt`. Two devices with the same nickname are two players: when listed entries of a board collide (ignoring case), the second and later ones in rank order are shown as `Lukas #2`, `Lukas #3`. The DAT-4 delete removes the nickname with the player row. New boards default to `minPlayers: 1`.

**Daily challenge (RET-1).** Every Bratislava day the tenant has one challenge (planned in `/challenges`, else the fallback rotation). `daily-challenge` and the landing card return it with the player's progress: `progress` 0…`target`, `completed`, `bonusPoints`, and `streak` = days in a row with a completed challenge (today included once completed); `{ challenge: null }` when the tenant has none today. Each call records that the player saw it (RET-4). After a counted play `complete` returns `dailyChallenge` with the same fields; the play that completes it adds `completedNow: true`, and its `bonusPoints` are already in `points` (and in the play's stored points, so they count on every board). A challenge is completed at most once a day per player; a backend result (BE-6) counts the same way. A play counts for the challenge of the Bratislava day it started, also when it is completed after midnight. When the play did not move an open challenge, `dailyChallenge` (today's, unchanged) adds `miss` and the end screen says why in one line: `sign_in` (anonymous without a nickname, LBD-5.2), `rejected` (the result was rejected), `same_game` (a "different games" challenge and this game already counted today) or `other_game` (the challenge is about another game). A past day's challenge play (practice, SHR-3.1) is a real play today: it moves today's challenge like a counted play (signed-in or nicknamed player, not rejected) and the completion keeps `practice: true`; if it completes the challenge, the completion is recorded with `bonusPoints` 0 and no points are added (D-71). Absent when there is no challenge or the player is restricted (MOD-5).

**Streak freeze (RET-2).** A signed-in player has 1 free freeze per Monday–Sunday week (Europe/Bratislava). When the shared streak would restart after exactly one missed day and a freeze is left, the freeze keeps it: the streak continues (`current` + 1) and `sharedStreak.freezeUsed: true`. A gap of two or more days restarts the streak even with freezes; a play yesterday or already today uses none. Anonymous players (also with a nickname) have no freezes. Game streaks are never frozen. Used freezes are recorded per missed day (`freezesUsed` in RET-4).

**Streak reminders (RET-3).** Opt-in per tenant via the player settings `streakReminder` (default `false`). The first counted completion that brings a signed-in player **with marketing consent** to a 3-day shared streak returns `reminderPrompt: true` exactly once; the shell asks "Pripomenúť mi sériu?" and answers with `PUT { streakReminder }` (any answer, and any earlier change of `streakReminder`, ends the prompt). The CronJob `streak-reminders` (`0 18 * * *` Europe/Bratislava, `node apps/cms/dist-scripts/streak-reminders.mjs`, locally `npm run streak:reminders -w apps/cms`) picks, per tenant, signed-in players with marketing consent who opted in, whose shared streak was last extended yesterday (active and not played today), and who got no reminder today; each gets one `reminder_sends` row a day (never twice a day). `STREAK_REMINDERS` = `dry-run` (default; values `streakReminders.mode`) records and logs `{ mode, sendId, tenant, player, streak, sender: "Azet.sk", subject: "Nestrať sériu X dní" }` (never the signed links) and **sends nothing**; `off` does nothing. Live sending through the Phillip communicator is not implemented yet; test e-mails may only go to `testuser1@azet.sk`. The e-mail's two links are signed for 30 days with the tenant, player and send: `open` records the first click (RET-4 click-through) and redirects to the last game on the tenant host (else the landing); `unsubscribe` sets `streakReminder: false` in that tenant only. A tampered or expired link, or one used for the other purpose, is `400`. The DAT-4 delete removes the player's challenge completions and views, used freezes and reminder sends (`deleted.retention`).

**Leagues (LEA-1–3).** Signed-in players only; anonymous players get `403` on every league endpoint, the list included (LEA-2.1); with leagues off every league endpoint is `404` for everyone first (PRF-2.1). The player is the one of the request and the tenant is the one of the URL, so a league never has members of another tenant and another tenant's code or id is `404`. `POST` bodies must be JSON (`Content-Type: application/json`). A league is `{ id, name, code, owner, members, board: { id, title } }`; `board.id` `null` is the tenant's default points board, otherwise `board` on create is the id of a board on the public leaderboard page (another tenant's or a hidden board is `404`). `name` is 1–40 characters and must not contain a word of the tenant deny list: `422` with `details[0]` `{ path: "name", code: "denied" }` and the same message as a nickname (LEA-3.1). `code` is 8 characters from `A–Z` without `I`, `O` and `2–9` (40 random bits); join accepts it in any case. Join is idempotent, `409` when the league has 200 members, `404` for an unknown or closed code, and limited to 10 attempts a minute per player and 60 per address (`429`, LEA-1.1); create is limited to 10 a minute per player. `GET /leagues/{id}` (members only, others `404`) adds `memberList: [{ id, nickname, owner, me }]` (an `id`, never the player key) and `leaderboard: { metric, period, aggregation, from, to, entries: [{ rank, nickname, value, me }] }`: the league's board ranked over its members only, every ranked member listed with their nickname whatever their public opt-in (LEA-1.2); the board's `minPlayers` and `topN` do not apply. The owner renames (`PATCH`) and closes (`DELETE`, the code stops working); a non-owner gets `403`. A member removes themselves (leave); the owner removes anyone except themselves (`409`, close instead).

**Profiles (PRF-3, PRF-3.1).** `GET /play/{tenant}/profile/{code}` and the page `/u/{code}` show `{ nickname, me, shareable, badges, streak: { current, best } | null, games: [{ slug, name, bestScore, streak }], leagues: [{ name }] }`: all badges in the BDG-6 shape (cosmetic ones `trust: "cosmetic"`), the shared streak, the best validated score per live game (in its scoring direction) with the game streak, and open leagues (none when leagues are off). A profile that is not `profileShareable` is visible only to its owner; anyone else, an unknown code and a code of another tenant get `404`. The response never contains the player key.

**Player delete (PRF-6, PRF-6.1).** The DAT-4 delete (`DELETE /players/{key}`) also removes the player's settings (they live on the player row), badges and league memberships, and closes the leagues the player owned (their `owner` is cleared); the profile and card links then return `404`. The response adds `deleted.leagueMemberships`, `deleted.leaguesClosed` and `deleted.tournamentResults` (TRN-3); the audit log records counts only. Reports about the player go with the player row, reports the player sent are counted in `deleted.reportsSent` (MOD-6).

Errors of `store`, `award` and `share` carry the SDK error code in `error.details[0].path` (and `code`), which the shell maps to the game's `{ ok: false, error: { code } }`.

### Embed (SHL-6, public pages on tenant hosts)

Not under `/api/v1`. An article embeds a game with the snippet from the game detail (`embedSnippet`, Overview tab in the CMS):

```html
<script async src="https://<tenant host>/embed.js" data-game="quiz" data-tenant="azet"></script>
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/embed.js` | Loader (locally `/t/{tenant}/embed.js`). Puts a lazy `<iframe>` in a box of reserved size right after every `script[data-game]` of **its own tenant**. The box takes the game's window (WIN-3, manifest `window`): at most its `width`; with a fixed `aspect` that shape, never taller than the screen; with `free` 640 px high; the `mobile` side when the box would be ≤ 640 px wide or ≤ 500 px high (the shell's rule). Without `window:` (and for hidden games, whose slugs the public loader does not list) 560 px wide and 640 px high. `data-height` 320–1200 px sets the height in every case. Unknown tenant → 404 |
| GET | `/embed/{slug}` | Compact game shell (locally `/t/{tenant}/embed/{slug}`), active version only. Unknown, archived, disabled or another tenant's game → 404 |

The embed page sends `Content-Security-Policy: frame-ancestors 'self' <origins>`, where `<origins>` are the article sites configured for that tenant only (`EMBED_ORIGINS`, [DEPLOY.md](deploy.md)); any other origin cannot frame it. The games origin adds the same origins to `frame-ancestors` of that tenant's bundles. Embedded anonymous players may get a new ID per load, because browsers do not keep the first-party cookie inside a third-party frame.

### Game services (GSV, D-58)

What a game reads about its player and its boards, from the browser through the shell (`@azet/games-sdk`, play token) or from its backend (`@azet/games-server`, game token). The game draws its own UI; the rules are the platform's: the same boards, nicknames, points and streaks as the shell. Every response is `Cache-Control: no-store` and never contains the player key.

**Play token (shell).** `Authorization: Bearer <play token>` as for the other `/play/session/*` calls; the tenant, game and player come from the token, never from the request. Without a valid token `401`. The reads share a limit of 120 requests a minute per session (`429`).

- `GET /play/session/player` → `{ kind, nickname, code, points: { week, rank, lifetime }, streak: { shared, game }, level: { level, points, from, next }, gameLevel: { level, title, value, from, next } | null, visibility: { publicBoards, hidden } }` (`level` the platform level PLV-1, `gameLevel` the game's `progression:` PRG-1, `visibility` the PRF-1 opt-in and a moderator's hide or ban, PSV-1; GAME-SERVICES.md "Player"). `kind` is `signed-in`, `nickname` (anonymous with an LBD-5 nickname) or `anonymous`; `nickname` is `null` for `anonymous`. `code` is the public profile code (`/u/{code}`, PRF-3) of a signed-in player whose profile is shareable, otherwise `null`. `points.week` and `points.rank` are the player's points and rank on the tenant's default weekly board (MOT-4; `0` and `null` before a counted play this week, the rank also when the player is not listed, PRF-1.1), `points.lifetime` the sum of points of all their counted plays in the tenant. `streak.shared` and `streak.game` are the current shared streak and this game's streak (`0` once a day was missed).
- `GET /play/session/points` → the `points` object of the player response.
- `PUT /play/session/nickname` `{ nickname }` → `{ nickname, me }`: the LBD-5 nickname of the token's anonymous player with exactly the rules, errors and the MOD-8 limit on new nicknames of `PUT /play/{tenant}/nickname` (`422` `nickname` / `denied`, `429` after 5 changes a day or 60 requests a minute per address, `403` for a signed-in player unless a moderator reset their nickname (MOD-2.1)); in addition 20 requests a minute per session.
- `GET /play/session/leaderboards` → `{ leaderboards: [{ id, title, scope, metric, period, aggregation, source }] }`: the tenant's default board (`id: "default"`) and tenant boards when the game takes part in the leaderboard (`motivation.weeklyLeaderboard`), event boards that include the game and the game's own boards. `id` is the manifest id for boards the game declares (`source: "game"`, GSV-5), otherwise the board id (`source: "cms"`).
- `GET /play/session/leaderboards/{id}?around=top|me&limit=1–50` (defaults `top`, `10`) → `{ board, from, to, enoughPlayers, minPlayers, entries: [{ entryId?, rank, nickname, value, me }], me }`. `entryId` is the report id of another listed player (MOD-6; what `game.leaderboards.report(entryId, …)` sends), absent on the caller's own row; no entry carries a player key (GSV-8.2). `id` is an id from the list. Ranking is the LBD rule set: validated plays of signed-in and nicknamed players (LBD-4, LBD-5), only opted-in players listed (PRF-1.1), the deny list (MOT-6) and `#2` for colliding nicknames (LBD-5.4); `entries` is empty while `enoughPlayers` is `false`. `top` lists the first `limit` entries; `me` lists `limit` listed entries around the player (within the first 500 ranks; deeper down the top entries and `me`). `me` is the player's entry or `null`. Another game's or tenant's board and an unknown id are `404`; an invalid `around` or `limit` is `422`.

**No client-side score submit.** No game-services endpoint writes a score. A score reaches the boards only through the shell's validated `complete` or the backend's `POST /results` (BE-6).

**Game token (backend).** The game token of [Results](#results-from-a-game-backend) (`results:write` limited to one game; others `403`, none `401`), 600 requests a minute per token. A `session` is a play session id of the token's game (`player.session` of the verified player token); one of another game or tenant is `404`, a malformed one `422`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/game/player?session=<id>` | `getPlayerSummary(player)`: the player response above for the player of the session |
| GET | `/game/leaderboards` | The game's boards, as `GET /play/session/leaderboards` |
| GET | `/game/leaderboards/{id}?around=&limit=&session=` | A board as above; `me` is the session's player (`null` without `session`) |

### Currency and shop (ECO, D-60)

A game's own currencies and items, declared in `currencies:`, `items:` and `earn:` of `azet-game.yaml` (MANIFEST.md). The platform keeps the wallet: an append-only ledger with balances and item counts that never go negative; every write is idempotent by `key` and the writes of one player are serialized, so two parallel spends never overdraw. Balances of a `scope: game` currency and all items belong to the player in that game; a `scope: tenant` currency is shared by the tenant's games, but only while the tenant's *Shared currencies* switch is on (otherwise the game behaves as if it did not declare it). Anonymous players have a wallet on their device key (D-47); at login it moves to the account (MRG-1, see "Device to account at login"). Amounts, prices and balances are integers up to 1 000 000.

**Earning: trusted paths only (ECO-3).** There is no earn call for the browser. Currency is credited by:

- the manifest's `earn:` rules on `complete` (and on `POST /results`) of a validated play, never a rejected or practice play: `floor(value × rate)` of `score` or `metric:<id>`, at most the rule's `max`, once per play and rule. `complete` returns what was credited as `earned: { <currency>: n }` (absent when nothing);
- the game backend: `POST /wallet/credit` or `currency` in `POST /results` (below);
- an admin adjust (ECO-5.3).

Rules and backend credits respect the currency's `max` balance and `dailyEarnCap` (the sum of earnings per Europe/Bratislava day); a cap cuts the amount (`capped: true`, `credited` = what fitted) instead of failing. Admin adjusts are not counted in the daily cap.

**Play token (shell).** `POST /play/session/wallet`, `Authorization: Bearer <play token>`, 120 requests a minute per session (`429`), `Cache-Control: no-store`, never the player key. Body `{ op, currency?, amount?, item?, n?, key?, reason? }`; unknown fields (a `price`) are ignored.

| `op` | Fields | Effect |
|---|---|---|
| `get`, `inventory` | – | Read only |
| `spend` | `currency`, `amount`, `key`, `reason?` | Takes `amount` of the currency |
| `buy` | `item`, `key` | Takes the item's manifest price and adds one item (ECO-4.2) |
| `consume` | `item`, `n?` (default 1), `key` | Removes `n` owned items |

Response `200`: `{ balances: { <currency>: n }, inventory: { <item>: n }, duplicate? }`; `balances` lists every usable currency of the game (`0` when none yet), `inventory` only owned items; writes answer `duplicate: false`, or `true` when the `key` was already used for the same operation (nothing changes). `key`: 1–64 characters `A–Z a–z 0–9 . _ : -`, per player and game; the keys of the browser, of the game backend and of the platform's own credits are separate, so a key the browser sends never collides with a backend or result credit. Errors carry the SDK code in `details[0].path` (as for the store): `409` `insufficient_funds` (balance below the amount or price), `insufficient_items`, `quota` (`maxPerPlayer`, or a second non-stackable item), `conflict` (the key was used for another operation); `422` `invalid_payload` (unknown op, undeclared currency or item, amount not an integer 1–1 000 000, invalid key); `403` `economy_disabled` (the tenant's economy is off); `401` without a valid play token. `403` `economy_frozen`: a moderator froze the player's currency (MOD-4); spends, buys, consumes and backend credits are refused, earn rules and result credits give `0` while the play still counts.

**Game token (backend).** The game token of [Results](#results-from-a-game-backend) (`results:write` limited to one game; others `403`, none `401`), 600 requests a minute per token. `session` is a play session of the token's game; another game's or tenant's session is `404`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/wallet/credit` | `wallet.credit(player, currency, amount, key)`: body `{ session, currency, amount, key, reason? }` → `{ currency, balance, credited, capped?, duplicate? }` |
| POST | `/wallet/grant` | `wallet.grant(player, item, n, key)` (GRT-1): body `{ session, item, n?, key, reason? }` → `{ item, quantity, duplicate? }`; a declared item without a price, once per key, within `stackable` and `maxPerPlayer` (`409 quota`); `422` for an undeclared item or a bad `n`; `403 economy_frozen` / `economy_disabled`. Ledger `grant`, event `item_grant` |
| GET | `/game/wallet?session=<id>` | `{ balances, inventory }` of the session's player |

`/wallet/credit` is idempotent by `key` for the player and game: the same key with the same currency, amount and session → `duplicate: true` and nothing credited again; with anything else `409` `conflict`. Errors as above (`422` `invalid_payload`, `403` `economy_disabled`).

**Admin (ECO-5).**

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/games/{slug}/rooms` | `games:read` | The builder's *Multiplayer* section (RTM-15): `{ enabled, reason?, rooms: [{ id, mode: 'named' \| 'quick' \| 'bot', phase: 'waiting' \| 'playing', players, maxPlayers, createdAt, startedAt, lastActivity }], history: { created, started, ended: { empty, idle, expired, closed }, medianPlayMs } \| null }` from the realtime service (no member ids, nicknames or room state; quick rooms have `id: 'quick'`, bot rooms `id: 'bot'`, so only named rooms can be closed one by one). `enabled: false` with `reason` for a production tenant, no configured service or an active version without `realtime:`; `502` when the service does not answer |
| POST | `/games/{slug}/rooms/close` | `games:write` | `{ room? }` closes that room (id or invite code) or, without `room`, every room of the game; members get `close` reason `closed`. → `{ closed }`. Audited (`game.rooms_close`) |
| GET | `/games/{slug}/economy` | `games:read` | The builder's *Economy* section: `{ enabled, sharedCurrencies, currencies: [{ id, title, icon, scope, max, dailyEarnCap, inCirculation, holders }], items, earn, days: [{ day, currency, earned, spent }], topItems: [{ item, bought }] }` (the last 14 days) |
| GET | `/players/{key}/wallet` | `members:write` | A player's `{ balances: [{ game, scope, currency, balance }], items: [{ game, item, quantity }], ledger: [...] }` (newest 100 ledger entries) |
| POST | `/players/{key}/wallet/adjust` | `members:write` | `{ game, currency, amount, reason }`: adds `amount` (negative to take) → `{ currency, balance }`; audited (`wallet.adjust`) |
| GET · PUT | `/settings/economy` | `games:read` · `landing:write` | The tenant switches `{ economy, sharedCurrencies }` |

The adjust is for admins only (`members:write`); game-limited tokens and agent tokens in production tenants get `403`. `reason` is 3–200 characters; the balance must stay within `0` (`409` `insufficient_funds`) and the currency's `max` (`422`). `economy` defaults to `true` in sandbox tenants and `false` in production tenants until an editor switches it on (audited `settings.economy`); while it is off every wallet call is `403` `economy_disabled`, plays earn nothing and `/results` stores the result without crediting. The DAT-4 player delete also removes the player's ledger, balances and items (`deleted.wallet`).

**Device to account at login (MRG-1, D-93).** The Azet callback (`/auth/callback`) and the CMS-account callback (`/auth/cms-callback`) move what the browser's anonymous key (`azg_anon`) holds on the tenant to the signed-in player, in one transaction: balances of currencies a game's active version still declares (a `scope: tenant` one only with *Shared currencies* on), items, and `game.store.player` keys the account lacks (up to 100 a game). What does not fit stays on the device: the account's `max`, `stackable`, `maxPerPlayer`, and at most one `dailyEarnCap` of a currency per move. A device belongs to the account of its first move and an account takes at most one move a Bratislava day (`device_merges`), so what did not fit moves at a later login; nothing of the wallet moves with the economy off or either side frozen. Ledger rows `op: merge`, `source: merge` on both sides; no earn events and no use of the daily cap. A failed move never fails the login.

**Events (ECO-8).** Applied operations add `wallet_earn`, `wallet_spend`, `item_buy`, `item_consume` and `item_grant` (GRT-1) to the event log (`payload`: `currency`, `amount`, `item`, `n`, `source`, `reason`), so they are in the event export.

### Matches (MAT, D-82)

Asynchronous turn-based matches (`game.matches`, docs/GAME-SERVICES.md "Matches"): seats, a turn, a state of up to 16 KB changed by JSON Merge Patches (RFC 7386, as the realtime room state), stored per tenant in the CMS database so a match lasts for days. A game opts in with `matches:` in `azet-game.yaml` (MANIFEST.md); without it every call is `403` `matches_disabled`.

**Play token (shell).** `POST /play/session/matches`, `Authorization: Bearer <play token>`, 240 requests a minute per session (`429`), `Cache-Control: no-store`. The player is the token's player; the response never contains a player key or session. Body `{ op, … }`:

| `op` | Fields | Answer |
|---|---|---|
| `create` | `players?` (2…`matches.players`, default `matches.players`) | A new `waiting` match with seat 0 and an invite `code` |
| `join` | `code` (6 characters, any case) | The match with the player seated; the last seat makes it `active` with seat 0 on turn. A member joining again gets the match unchanged. `404` `not_found` for an unknown, full, started or expired code |
| `quick` | `players?` | Seats the player in the oldest `waiting` quick match of the same game **version** and `players`, or opens one (no code); the same player asking again gets its own wait |
| `list` | – | `{ open: [match…], finished: [match…] }`: the player's `waiting`/`active` matches of this game and the last 20 `finished`/`expired` ones, newest first |
| `get` | `id` | The match |
| `move` | `id`, `patch`, `ifVersion?`, `keepTurn?`, `finish?` | Merges `patch` (≤ 4 KB), increments `version`, passes the turn to the next seat unless `keepTurn`, resets the turn deadline. `finish: { winner: <seat> \| null, scores?: [one per seat] }` ends the match with this move |
| `resign` | `id` | An active match ends: `loss` for the player, `win` for the others (`endReason: "resigned"`); a waiting match the player opened is closed (`expired`, no results) |

A match: `{ id, code, status, players, seat, turn, myTurn, members: [{ seat, nickname, me, outcome, score }], state, version, turnDeadline, expiresAt, endReason, winner, createdAt, updatedAt }`. `status` is `waiting` → `active` → `finished`, or `expired`; `endReason` `finished`, `forfeit`, `resigned` or `expired`; `code` only while an invite match waits; `turnDeadline` (ISO 8601) only while active, `expiresAt` only while waiting; `winner` the winning seat once finished (`null` for a draw). `nickname` is the player's current nickname, `null` without one or with `showNickname: false` (PRF-1).

Errors carry the SDK code in `details[0].path` (as for the store): `404` `not_found`; `403` `forbidden` (not a member, or a member move with `matches.authority: backend`), `matches_disabled`; `409` `full`, `not_your_turn`, `conflict` (the match is not active, or `ifVersion` differs); `413` `too_large` (the state would exceed 16 KB); `422` `invalid_payload`; `429` `limit_reached`: 20 open matches per player and game, 50 new matches per player, game and day, 30 moves a minute per player (MAT-6).

**Timeouts (MAT-3).** A `waiting` match expires `matches.inviteSeconds` after it was opened; the member on turn who does not move within `matches.turnSeconds` loses by forfeit (`endReason: "forfeit"`, a loss for that seat and a win for the others). Every call of the game applies them first, and the CronJob `matches-sweep` (every 5 minutes) applies them when nobody plays.

**Results (MAT-5).** A finished match records one result per member like a backend result (`POST /results`: points, boards, streaks, daily challenge, badges, earn rules; a guest counts once nicknamed), in a play session of its own that starts when the member joined. Scores without `finish.scores`, and of a forfeit or resignation: winner `scoring.max` (else 1), the others `scoring.min` (else 0), a draw halfway between. When the shell's `complete()` of a session that was open while the match finished arrives, it returns that match result once instead of counting another play.

**Game token (backend, MAT-4).** `POST /game/matches` with the game token of [Results](#results-from-a-game-backend), 1 200 requests a minute per game. Body `{ op: "get", id }`, `{ op: "move", id, patch, ifVersion?, turn? }` (the backend may move at any time; the turn stays unless `turn` sets it) or `{ op: "finish", id, winner, scores? }` → the match with `members: [{ seat, player, nickname, outcome, score }]`, where `player` is the member's player key (`player.id` of a verified player token), without `seat`, `myTurn` and `me`. With `matches.authority: backend` only this path moves and finishes. A match of another game is `404`.

**Admin (MAT-7).** `GET /games/{slug}/matches` (`games:read`) → `{ counts: { waiting, active, finished, expired }, medianSeconds, recent: [{ id, status, kind, players, seated, endReason, createdAt, updatedAt, finishedAt }] }`: no states, nicknames or player keys. The DAT-4 player delete keeps the player's seats for the other members with an anonymous key (`deleted.matchSeats`).

### Results from a game backend

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/results` | `results:write` (game token) | Authoritative result of a play session (BE-6); `practice: true` stores it as practice (a game against bots, BOT-5). In a version with `realtime.authority: referee` only this result counts: the shell's `complete` before it answers `refereePending: true` and earns nothing (REF-7) |
| POST | `/realtime/referee` | `results:write` (game token) | REF-2: `{ url, ticket, expiresAt }` for the game's backend to connect to the realtime service as the referee of the game's rooms (60 s, single use; `@azet/games-server` `createReferee` and `azg_referee.py` call it). `403` `realtime_disabled` for a production tenant, no configured service or an active version without `realtime.authority: referee`; personal and deploy tokens `403`; 10 a minute per game (`429`) |

A **game token** is an API token with the scope `results:write` limited to exactly one game (`POST /tokens` with `{ scopes: ["results:write"], games: ["<game id>"] }`). Tenant and game come from the token. Other tokens, also `results:write` without a game limit, personal (`azg login`) and deploy tokens and CMS sessions get `403`. A personal token never carries `results:write`: `POST /tokens` with `kind: "user"` and that scope is `403`, and a personal token stored with it before D-70 is treated as if it did not have it.

Body `{ session, score, timeSeconds?, success?, details?, stats?, badges?, currency?, practice? }`: `practice: true` (a game against bots, BOT-5) stores the play as practice: no points, boards, streaks, badges, currency or daily challenge; `session` is the play session id (`claims.session` of the player token), `score` a finite number, `timeSeconds` ≥ 0 (the session's own timing when omitted), `details` an object kept in the audit log, `stats` the metric values (MET-2), checked as for `/play/session/complete`.

- The checks are the same as for `/play/session/complete`: `scoring.min`/`scoring.max` → `rejected: "out_of_range"`, faster than `scoring.minSeconds` since the play started → `rejected: "too_fast"`. Rejected and guest results get `points: null`.
- The result is written to the session's latest play (a play is created when the shell's `start` has not arrived yet) and counts for points, streaks and the leaderboard like a completion. It replaces a result the shell already sent; after it, the shell's `complete` returns this result and changes nothing (SDK-CONTRACT §8).
- `stats` replace the values the shell sent for the play (MET-3.3); without `stats` the shell's values stay. Invalid `stats` are dropped with `statsRejected` and the score still counts; the shell's later `complete` returns the same `statsRejected`.
- `badges` (BDG-4) are up to 20 badge ids the played version declares with `award: backend`; they are awarded as `trusted` together with the rule and tenant badges the result earns (see [Tenant badges](#tenant-badges-bdg-5-d-45)), unless the result is rejected. Any other id (undeclared, a `rule` badge, `award: game`) is `422` with `details[0]` `{ path: "badges", code: "invalid_badge" }`, and nothing of the request is stored (BDG-4.1). A refused award, also with a session of another game or tenant (`404`), is audited as `play.badges_rejected` with the token as actor and the token's game as target. On a duplicate result valid badges are ignored.
- `currency` (ECO-3.2) is `{ <currency id>: positive integer }`, credited to the session's player once per session together with the manifest's earn rules, unless the result is rejected or practice, and within the currency's `max` and `dailyEarnCap`. An undeclared currency is `422` (nothing is stored); with the tenant's economy off the result is stored without crediting.
- One result per session: the same score again → `200` with `duplicate: true`; a different score → `409 conflict`.
- Every result is in the audit log (`play.result`, actor `token:<name>`, target the game slug).

Response `200`: `{ session, score, points, rejected?, restricted?, statsRejected?, badges?, credited?, duplicate? }` (`restricted: true` for a banned player, MOD-5); `badges` = the ids this result awarded (backend and rule badges), absent when none; `credited` = the currency credited after the caps (`{ <currency>: n }`), present when the request had `currency` or an earn rule credited something. Errors: `401` missing or invalid token, `403` not a game token, `404` session of another game or tenant, `409` different result, `422` invalid body.

### Downloads (no authentication, admin host only)

Served from the CMS root, not under `/api/v1` (D-34). Written by `scripts/pack-packages.mjs` during the Docker build.

| Method | Path | Purpose |
|---|---|---|
| GET | `/downloads/azet-games-cli.tgz` | Latest CLI (`npm i -g --allow-remote=all <cms>/downloads/azet-games-cli.tgz`); also `azet-games-sdk.tgz`, `azet-games-server.tgz` |
| GET | `/downloads/azet-games-<pkg>-<version>.tgz` | A specific version, cached as immutable; scaffolded games pin these |
| GET | `/downloads/azet-games-sdk.js` | The SDK as one ES module for games without a build step |
| GET | `/downloads/index.json` | Package versions, file names, sha256 and the CLI's default API |

