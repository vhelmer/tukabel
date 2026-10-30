# PRD: Azet Games CMS v1 (hackathon)

| | |
|---|---|
| **Version** | 1.38.0 |
| **Status** | Draft |
| **Author** | Lukáš Jopčík |
| **Date** | 29 Oct 2026 |
| **Supersedes** | Phase 1 of [Games CMS PRD 1.0.0](../../docs/prd/azet-hry-cms/PRD.md) |

> **In short:** v1 is the CMS that hackathon teams build games on. A team registers a game with one command, pushes code to GitLab, and CI/CD publishes it to the CMS. The game runs in a shared shell that handles loading, start and end screens, branding, login, streaks and events. Product staff configure games, branding and the landing page in the CMS. Agents do the same through the `azg` CLI.

---

## 1. Problem

- The hackathon at the end of October needs a platform. Without one, every team builds its own hosting, login, scoring and data, and none of the results can go live on Azet.
- Puzzlr owns the games, the level generators and the player data. We cannot add our own games to it.
- Puzzlr spreads configuration over five modules and leaks other tenants' configuration (`tenantConfig.list`). We need one clear place to configure things, and strict isolation.

## 2. Goals and success criteria

| Goal | Measured by | Target |
|---|---|---|
| Fast start | Time from `azg login` to the team's game on the hackathon landing page | ≤ 15 min |
| No infrastructure work for teams | Teams that needed help with deploys, hosting or databases | 0 |
| Every game gets motivation for free | Hackathon games with a working streak, points and weekly leaderboard | 100 % |
| Safe iteration | Time to roll a broken version back | ≤ 1 min, one click or command |
| A path to production | A hackathon game can be promoted to `azet` without a rewrite | yes |
| Agent-ready | Every CMS action is available through the API and CLI | 100 % |

## 3. Users

| User | Needs |
|---|---|
| **Hackathon team** | Register a game, build it locally with a realistic shell, deploy by `git push`, tune settings without rebuilding |
| **Participant who does not program** | Make a game with an AI assistant from a ready starter, upload it as a .zip in the CMS, understand what is wrong when it is rejected (v1.2.0) |
| **Organizer / jury** | See all games and their live numbers, switch games on and off, pick winners, promote a game |
| **Product (Azet)** | Configure branding, the landing page and placements; approve what goes to production |
| **Admin** | Manage tenants, members, tokens and quotas |
| **Agent in Multica** | Read and change configuration, propose changes for production, all through a scoped token |
| **Player** | A game that loads fast, looks like Azet, remembers progress, and gives a reason to come back tomorrow |

## 4. Scope

### In v1

- Game registration (CLI and CMS) that creates the GitLab repo, CMS record, deploy token and preview URL
- `azet-game.yaml` manifest with a JSON Schema `settings` block rendered as a form in the CMS
- `@azet/games-sdk` and the game shell (iframe + postMessage)
- GitLab CI template: validate, build, contract test, publish, activate; preview per merge request
- Immutable versions with one-step rollback
- Optional game backend: SDK key-value store, or a containerized backend with Postgres
- CMS screens: Games, Game detail, Appearance, Landing, Tenants, Tokens, Audit log
- Tenants `azet`, `koktejl`, `azet-hackathon` with strict isolation and promotion between them
- `azg` CLI with config-as-code (`config pull/diff/push`)
- Motivation core: shared daily streak, points, weekly leaderboard, percentile
- Events with the hashed Azet ID, stored in Postgres and ready for export to DTM
- Two reference games built on the SDK: Daily Quiz and Snake (with a Postgres backend)
- Publishing without the CLI: starter package per game, no-build HTML template with an AI prompt, .zip upload in the CMS (v1.2.0, D-35)
- CLI, SDK and backend helpers installable from the CMS itself (`/downloads`, D-34), and an in-CMS guide
- Players & stats (v1.3.0, D-41): tenant statistics, game metrics, configurable leaderboards, badges, sharing, private leagues and the player profile (§5.15–5.20)
- Error pages (v1.5.0, D-52): 403, 404, session expired and 500 in the admin, Slovak 404/500 on the public hosts, error screens in the shell (§5.21)
- Nicknames for players without login (v1.6.0, D-54): a nickname on the device puts an anonymous player on the boards with points and streaks; boards show from 1 player (LBD-5)
- Badge icons and texts in the CMS (v1.7.0, D-55): icons for tenant badges, per-tenant title, description and icon of game badges (BDG-7)
- Azet ID login for players (v1.8.0, D-56): the `azet` IdentityProvider over Azet OAuth (rin-oauth on dev); signed-in players get points, streaks, boards, leagues and a profile on their account (AUTH)
- Game services for complex games (v1.9.0, D-58): player, nickname, points and boards through the SDK and the game backend; games declare their own boards (GSV)
- In-game currency, shop and inventory (v1.10.0, D-60): games declare currencies and items; the platform keeps the wallet, currency is earned only on trusted paths (ECO)
- Player moderation (v1.11.0, D-61): rename or block nicknames, hide players from boards, freeze their economy, time-limited bans, reports from players and automatic flags in a moderation queue (MOD)
- Player analytics (v1.12.0, D-57): one event catalog for every game (`docs/EVENTS.md`), statistics split by player kind with D30 return, the funnel and top custom events, and a Players page with the player detail and timeline (§5.23–5.24)
- Azet „nova“ games pages and the Halloween template (v1.13.0, D-63): default Azet navigation, new landing, light/dark/device/Halloween (THM-4)
- External games such as Puzzlr on the games pages (v1.13.0, D-64, EXT)
- Tournaments and seasons (v1.14.0, D-62): a tournament page with prizes, a live board, frozen winners for the prize handling, a season board (§5.28)
- Admin guide and docs for AI assistants (v1.15.0, D-65): ADMIN.md, the docs API and `azg docs` / `azg ai setup`, offered after `azg login` (HLP-2, HLP-3)
- Admin audit fixes (v1.15.1, D-69): the moderator's weekly board lists every ranked player, every signed-in player has a profile code, archived games stay in the statistics game table, the tournament form offers live games only (MOD-1.4, PRF-3.2, STA-2.2, TRN-1.6)
- The end screen says why a play did not move the daily challenge; a play over midnight counts for the day it started (v1.15.2, D-71, SHR-3.1)
- End screen and player login in the games pages' look, and „← Späť na hry“ from every game (v1.16.0, D-73, AZG-296): SHL-1.1, SHL-2.2, AUTH-4.1
- A past day's challenge play counts toward today's daily challenge, without bonus points; it stays practice for everything else (v1.16.1, D-71, SHR-3.1)
- The daily challenge card's „Hrať“ opens a game that moves the challenge instead of always the first game (v1.16.2, THM-4.2, RET-1; Lukáš could not finish "Zahraj 3 rôzne hry" because the button kept opening a game he had already played)
- Self-service access and teams (v1.17.0, D-75): company people join the hackathon by e-mail domain, choose or create a team, invite colleagues with a link, and sign in with their own password instead of the shared access code: MEM-1..MEM-6
- Realtime multiplayer (v1.18.0, D-77, D-78): one realtime service in our cluster; games join rooms, see who is there, exchange messages and share a small room state through `game.realtime`, the shell holds the WebSocket (§5.31, RTM)
- Per-IP caps on the realtime service (v1.18.1, AZG-339, approved by Lukáš 20 Oct): one client IP can hold only so many sockets, so a single client cannot take every slot of the service (RTM-7.9).
- A team's live game is on the hackathon landing without an editor (v1.19.0, approved by Lukáš 21 Oct): in a sandbox tenant live games the layout does not mention follow in a „Hry tímov“ section (LND-5). Found in the fresh-account E2E run: a team set its game Live and could not find it on the hackathon page.
- Multiplayer after the first developer test (v1.20.0, D-80–D-82, Lukáš 21 Oct: „všetko“): rooms that end (waiting rooms expire, invite codes, per-player limits, the rooms in the CMS, one result per play explained), a backend **referee** for authoritative results (REF), and persistent asynchronous turn-based **matches** (MAT), with reference games and multiplayer patterns in the Hackathon guide: RTM-13..RTM-17, REF-1..REF-6, MAT-1..MAT-7; the docs checked against the code (HLP-4)
- A strong multiplayer platform (v1.21.0, D-84–D-86, Lukáš 21 Oct: „dáva zmysel to mať v platforme“, „brutálne silnú platformu“): **bots** the referee plays (on request or when a quick match waits too long; practice, never counted), **one WebSocket per game session** opened at start for every game with the **players online** count, a **verified profile** of every room member (platform level from lifetime points, the game's own level, this week's points and rank), a **nickname required** for multiplayer (the shell asks), the game's **own levels** (`progression:`), a one-tap **copy of the invite code**, and only the referee's result counting in a referee game: §5.35–§5.37 (BOT, PRS, NICK, PLV, PRG, REF-7, RTM-18)
- Developer experience from the platform research (v1.22.0, D-87; Nakama, PlayFab, Photon, Colyseus, Playroom, Rune, CrazyGames, Poki): **invite links** that open a friend straight at the table, **React hooks** (`@azet/games-sdk/react`) and an **error catalogue** with the player texts: §5.38 (INV, HOOK, HLP-5). v1.22.1: the room call waits for the nickname dialog (NICK-1) instead of failing after 10 s; docs checked against the code
- Badges with several conditions and wins in a row (v1.27.0, D-90, Ivana 25 Oct, Lukáš 26 Oct „ok to znie fajn“): `rule: { all: [...] }`, and the values `time`, `success` and `winsInARow` in rules: BDG-8
- Sign in to a sandbox tenant's games with the CMS account (v1.28.0, D-91, Lukáš 27 Oct „tu by mi malo fungovať rovnaké prihlásenie ako do CMS“): „Prihlásiť sa cez CMS účet“ next to the test Azet login on sandbox tenants: §5.40 (CML)
- Hub games made of many mini games (v1.29.0, D-92, Lukáš 27 Oct „vsetko priprav, kvalitne, a vsetko zapracuj rovno“ for the Brloh concept): a compact result card instead of the end screen with the next play started at once, the platform's verdict for the game, tilt controls and room in the manifest for many mini games: §5.41 (HUB, SNS)
- Economy and identity for hub games (v1.30.0, D-93, the same request): items from the game backend without a price, the device's wallet, items and saves moving to the account at login, the player's visibility for the game and tournaments over one game's metric: §5.42 (GRT, MRG, PSV, TRN-8)
- Feedback of a hackathon developer after the clean-up (v1.31.0, D-94, D-95, Ivana 28 Oct; Lukáš: „herne okno na desktop / mobil nemozeme v cms obmedzovat, nech si kazda hra definuje ake okno chce mat“): the game's own window on desktop and mobile, how to play on the start and pause screens, the manifest's icon and cover right after publish, one place for „← Späť na hry“, `azg teams list`, and the CLI saying when it or the game's SDK is old: §5.43 (WIN, HOW, ART, SHL-1.3, TMS, CLI-9)
- Links to articles from a game (v1.32.0, D-96, Matej 28 Oct: a word search from the most read articles that sends players to the article): `game.openLink(url)` through the shell; and the replay button's text (D-97, Michal 28 Oct: „Hrať ďalší level“ instead of „Hrať znova“): §5.44 (OPL, RPL)
- External games of a team (v1.38.0, D-104, Roman 29 Oct: „nejde mi zaregistrovat hru na externu urlcku v cms“, the CMS answered „Not available to game-limited tokens or team members“): in a sandbox tenant a team member registers the team's own external games and their covers, the landing stays with editors: EXT-4
- A hub without the shell's back arrow (v1.37.0, D-103, 29 Oct: a hub team with its own „Späť“ asked for a manifest setting „like endScreen: none“): `backButton: false`: BCK-1
- Faster loading of games and the landing (v1.36.0, D-102, Lukáš 29 Oct: „hry sa nacitavaju strasne pomaly, je to nieco co vieme zrychlit?“): the games origin keeps files in memory, sends text compressed and small WebP copies of covers: §5.47 (PERF-1)
- A hub without the result card (v1.35.0, D-101, 29 Oct: a hub team's agent found no way to hide „Výsledok kola“; Lukáš: „dorob nech mozeme setnut“): `endScreen: none`, the game shows the verdict itself: HUB-7
- Tournaments of a team's own games (v1.34.0, D-100, Erik 28 Oct: „toto je vec, čo by vedela byť ako turnaj, len taký fukot … akurát to je vo vašej moci“; Lukáš: open it to the teams): in a sandbox tenant a team member runs tournaments over the team's games, prizes and results stay with editors: §5.46 (TRN-9)
- `azg dev` on a phone (v1.33.2, Matej 28 Oct: on the phone he saw more of the debugger than of the game): the game fills the screen, the tools wait behind a button: SDK-4.4
- Room for every mini game of a hub (v1.33.1, D-99, Martin 28 Oct for Brloh: „tím CMS zvýši limit metrík a rebríčkov, naša štruktúra sa nemení“): up to 100 metrics and 100 boards in a manifest: HUB-4
- A game's own pause button and pictures in how to play (v1.33.0, D-98, Barbora 28 Oct: „to tlačidlo pauza v pravom hornom rohu by si mohol vyhodiť … v úvode, kde sú inštrukcie, mať možnosť customizovať návod, pridať obrázky“): `pauseButton: false` with `game.pause()`, and `howTo` lines with a picture: §5.45 (PSE, HOW-3)
- An empty team ends (v1.26.1, Lukáš 26 Oct: „ak z tímu odídu všetci účastníci, mal by sa zmazať, ak neobsahuje žiadne hry“): the last member out of a team without games removes it and frees the name; a team left empty earlier can be created again: MEM-3.6
- Feedback of a hackathon developer (v1.26.0, Ivana 25 Oct): SDK-4.1–4.3 (`azg dev` replay timing, Halloween, `--host` for phones), CLI-8 (deploy token in a file, slug notice), PRV-1 (unpublished game page), guide: speed games, points, badge conditions, Node.js
- npm 12 and agents in a container (v1.25.1, found by Multica agents in ifWorkspace, 25 Oct): DIST-1.3, DIST-1.4, D-89
- Audit log for editors only and requests in words from every member in Change proposals (v1.25.0): MEM-7, MEM-8
- Team rename, a Vue template and `azg login` on Windows (v1.24.0, hackathon feedback): MEM-3.5, REG-10, CLI-2
- CMS members link their own Azet account (v1.23.0, D-88): one identity for the CMS and the games, members marked „Team“ among the players, no tournament prizes for members: §5.39 (LNK)

### Not in v1

- Badge templates library, badge simulation, the full Motivation module with previews (phase 3 of PRD 1.0.0). Badges themselves are in v1.3.0 (§5.18)
- Phillip triggers, evening reminders, newsletter blocks
- Stored levels with a 31-day schedule and alerts (v1 uses a daily seed)
- Paywall and entitlement profiles
- Rebuilding the four Puzzlr games
- Grafana dashboards (v1 shows numbers in the CMS)

## 5. Functional requirements

Priority: **Must** = needed for the hackathon. **Should** = in v1 if time allows, otherwise right after. **Could** = later.

Every requirement has acceptance criteria `<ID>.n`. Tests reference them by ID.

### 5.1 Registration (REG)

| ID | Requirement | Priority |
|---|---|---|
| REG-1 | `azg games create` and the CMS "Add game" button register a game with name, slug, team and template | Must |
| REG-2 | Registration creates the GitLab repo `azet-games/<tenant>/<slug>` from the chosen template | Must |
| REG-3 | Registration creates the CMS record in status `draft` in the current tenant | Must |
| REG-4 | Registration creates a deploy token scoped to this game and tenant and stores it as a CI variable in the repo | Must |
| REG-5 | Registration returns a preview URL that shows the game after the first push | Must |
| REG-6 | Local mode: without GitLab credentials, registration scaffolds the template into a local folder and skips REG-2/REG-4 | Must |
| REG-7 | A game can be published from a .zip uploaded in the CMS, with the same checks and the same result as `azg publish` (D-35) | Must |
| REG-8 | The CMS offers a starter package per game: any template filled in for the game, including a no-build HTML starter with the SDK as one file and a prompt for AI assistants (D-35) | Must |
| REG-9 | **Add game** in the CMS starts with the way the team works: (a) **a finished game (.zip)**: name and id come from its `azet-game.yaml`, the game is added and the package published in one step, live at once if the person may activate; (b) **without programming**: the game is added and the dialog shows the starter, the AI prompt and the upload in three steps; (c) **with code (CLI)**: nothing is added, the dialog shows the `azg` commands with the name and template filled in. A taken id or a broken package is explained before or after the step, never lost. (1.23.2, Lukáš 23 Oct: „flow pridania hry je nejasný, chcem rovno nahodiť zip“) | Must |
| REG-10 | Templates cover the frameworks teams know: `html`, `vanilla-ts`, `react`, `vue` (Vue 3 single-file components, `vue-tsc` in the build), `phaser`, `pixi`; each is the same small working game and passes `azg validate` and `azg contract` (1.24.0, hackathon feedback 23 Oct: „kódim vo Vue, React neovládam“) | Must |

- **REG-1.1** Given a logged-in member of `azet-hackathon`, `azg games create --name "Word Snake" --template phaser` exits 0 and prints the slug, repo URL and preview URL.
- **REG-1.2** A slug that already exists in the tenant is rejected with a clear message. The same slug in another tenant is allowed.
- **REG-1.3** Slugs match `^[a-z][a-z0-9-]{2,39}$`.
- **REG-4.1** The deploy token can publish versions of this game only. Using it for another game or tenant returns 403.
- **REG-5.1** Before the first push, the preview URL shows a "waiting for first build" screen, not an error.
- **REG-9.1** E2E: the zip path adds and publishes a game live from its package; a non-zip and a taken id are refused with a message; the starter path shows the 3 steps; the code path fills in the commands and its template list is not clipped by the dialog.
- **REG-7.1** A zipped project (the folder itself or just its files) becomes a finalized version whose bundle is identical to what `azg publish` uploads; it can be activated in the same step.
- **REG-7.2** Hidden files and zip junk (`.gitignore`, `__MACOSX`, `node_modules`, …) are ignored; absolute paths and `..` are rejected.
- **REG-7.3** Every rejection lists its problems with a machine-readable code (`invalid_zip`, `too_large`, `unsafe_path`, `manifest_missing`, `manifest_invalid`, `id_mismatch`, `entry_missing`, `asset_missing`); the CMS explains each in Slovak. Nothing is stored for a rejected upload. The unpacked size is limited like a bundle (zip bombs).
- **REG-7.4** Without an explicit version the upload uses `package.json`'s version if it is free, otherwise the next patch; versions stay immutable.
- **REG-7.5** Upload needs `versions:write` (and `versions:activate` to activate); deploy tokens never activate in production tenants; games of other tenants are not found.
- **REG-8.1** The starter package has the template's files with `{{slug}}`/`{{name}}` filled in and `@azet/*` dependencies pointing at this CMS's `/downloads`; unknown templates are rejected.
- **REG-8.2** The HTML starter contains `azet-games-sdk.js` and `AI-PROMPT.md`, and uploads unchanged as a valid, playable version.

### 5.2 Manifest (MAN)

| ID | Requirement | Priority |
|---|---|---|
| MAN-1 | One `azet-game.yaml` file describes the game: id, name, SDK version, entry, category, orientation, scoring, levels, settings, assets, backend | Must |
| MAN-2 | The `settings` block is JSON Schema (draft 2020-12 subset). The CMS renders it as a form | Must |
| MAN-3 | The manifest is validated by the same package in CLI, CI and CMS | Must |
| MAN-4 | Adding a setting in a new version uses its default. Removing a setting archives its stored value | Must |

- **MAN-2.1** Supported setting types: `integer`, `number`, `string`, `boolean`, `string` with `enum`, `string` with `format: color`. Each may have `title`, `description`, `default`, `minimum`, `maximum`.
- **MAN-3.1** An invalid manifest fails `azg validate` and the CI `validate` job with the field path and reason.
- **MAN-4.1** After publishing a version without setting `x`, the CMS no longer shows `x`, and the audit log records the archived value.

### 5.3 SDK and shell (SDK, SHL)

| ID | Requirement | Priority |
|---|---|---|
| SDK-1 | `game.init()` returns settings, level (date, seed), theme, locale, player (logged-in flag, nickname) | Must |
| SDK-2 | `ready()`, `onStart`, `onPause`, `onResume`, `progress()`, `complete()`, `track()` as defined in SDK-CONTRACT | Must |
| SDK-3 | `game.store` (player and shared key-value) and `game.api.fetch` for game backends | Must |
| SDK-4 | The SDK works in the local dev shell (`azg dev`) with a fake player, theme switcher and viewport presets | Must |

- **SDK-4.1** (1.26.0) The dev shell measures `scoring.minSeconds` from each Play, also „Hrať znova“ in the same session, like the server (a play row per `start` event).
- **SDK-4.2** (1.26.0) The dev shell offers every theme a game can get, also Halloween (THM-4: the dark theme in the Halloween colours), with the same colours the CMS sends.
- **SDK-4.3** (1.26.0) `azg dev --host [address]` serves shell and game on the network (the LAN address, or the given one), so the game can be tried on a phone on the same Wi-Fi.
- **SDK-4.4** (1.33.2) On a screen narrower than 600 px (a phone on `azg dev --host`) the game fills the screen like for a player; the toolbar, settings, badges and event log open from the „azg“ button in the bottom left corner and close again. A wider screen keeps the computer layout.
| SHL-1 | The shell renders loading, start, game, pause and end screens around the game iframe | Must |
| SHL-2 | The end screen shows score, streak, percentile and the configured next step. Every section must have a target | Must |
| SHL-3 | The game runs in a sandboxed iframe on a separate origin and has no access to Azet cookies | Must |
| SHL-4 | The shell passes theme values as CSS custom properties and in `init().theme` | Must |
| SHL-5 | The shell enforces a CSP. Network access is limited to the CMS API, the game's own backend and an allowlist from the manifest | Must |
| PRV-1 | (1.26.0) On a sandbox tenant the play page of a draft or of a game without an active version says so and links the newest uploaded version (`?v=`); production tenants keep the plain 404 | Should |
| SHL-6 | An embeddable game block (`<script>` + `data-game` + `data-tenant`) with reserved size (the game's window, WIN-3) and lazy loading | Should |

- **SHL-6.1** On a tenant host, `/embed.js` mounts each `data-game` block of its own tenant as a lazy iframe with reserved size (WIN-3); `/embed/<slug>` renders the shell of a live game.
- **SHL-6.2** The embed page may be framed only by the tenant's own site and the article origins configured for that tenant (`embedOrigins`); the games origin allows the same origins for that tenant's bundles only. Any other origin, including another tenant's article site, is refused.
- **SHL-6.3** A tenant host never serves another tenant's embed, and another tenant cannot embed the game (TEN-2.1).
- **SHL-6.4** The game detail shows a copyable embed snippet pointing at the tenant host.
- **SDK-2.1** If the game does not call `ready()` within 10 s, the shell shows an error screen with "Try again".
- **SDK-2.2** `complete()` with an invalid payload is rejected in development with a console error that names the field.
- **SHL-1.1** „← Späť na hry“ leads from every game to the tenant's games landing: a labelled pill in the top left corner of the stage on the start and pause screens, the same place as a round arrow while playing (SHL-1.3; until v1.31.0 next to the pause button), and a link under the end screen actions. Leaving needs no confirmation; an unfinished play is just not completed (`abandon`). In an article embed (SHL-6) the landing opens in a new tab. Each click records `back_click` with `where` (`start`, `playing`, `paused`, `end`; docs/EVENTS.md).
- **SHL-2.1** Saving an end screen section without a target is rejected by the API.
- **SHL-2.2** The end screen has the look of the games pages (THM-4, D-73): the same font, outline pills, surfaces and colours from the tenant theme (light, dark, Halloween), no hard-coded colour. Order: a play that did not count (rejected, restricted, practice) first, the challenge result, the score as the large number with the points and the percentile, then streak, daily challenge (with a progress bar) and weekly board side by side, the new badges, the tournament, the configured links, the login offer and the prompts; then the actions grouped: „Hrať znova“ primary, „Zdieľať výsledok“ and „Vyzvi priateľa“ secondary in one row, „← Späť na hry“ last. It fits a 360 px phone without sideways scrolling; the builder preview shows the same layout.
- **SHL-3.1** `document.cookie` inside the game iframe cannot read Azet session cookies (contract test).

### 5.4 CI/CD and versions (CI, VER)

| ID | Requirement | Priority |
|---|---|---|
| CI-1 | A game repo needs one `include:` line to get the full pipeline | Must |
| CI-2 | Jobs: `validate`, `build`, `contract`, `budget`, `publish`, `activate` (main only) | Must |
| CI-3 | Each merge request gets a preview version and a comment with its URL | Should |
| CI-4 | The contract job runs the game in a headless shell and checks `ready()`, `complete()`, console errors and forbidden network calls | Must |
| VER-1 | Versions are immutable and have their own URL | Must |
| VER-2 | Rollback to any previous version in one click or one command | Must |
| VER-3 | Production (`azet`, `koktejl`) is never activated automatically | Must |

- **CI-4.1** A game that never calls `ready()` fails the contract job with a log and a screenshot.
- **VER-2.1** After rollback the landing page serves the previous version within 60 s.
- **VER-3.1** A deploy token from `azet-hackathon` cannot activate a version in `azet`.

### 5.5 Game backend (BE)

| ID | Requirement | Priority |
|---|---|---|
| BE-1 | Level 1: `game.store.player` and `game.store.shared` key-value storage, isolated per tenant, game and player, with quotas | Must |
| BE-2 | Level 2: a `backend/` folder with a Dockerfile, declared in the manifest, built and run by the platform | Must |
| BE-3 | Level 2 backends get a dedicated Postgres schema and user, passed as `DATABASE_URL` | Must |
| BE-4 | Requests from the game reach the backend through the CMS proxy with a signed player token. `@azet/games-server` verifies it | Must |
| BE-5 | `azg backend add --db postgres` scaffolds a working backend (Node or Python) | Should |
| BE-6 | Backends can report results directly (`POST /v1/results` with a game token) | Should |

- **BE-1.1** A player's value written in game A cannot be read by game B or by another player.
- **BE-3.1** One game's database user cannot read another game's schema.
- **BE-4.1** A request without a valid signed token is rejected by `@azet/games-server` with 401.
- In local mode, Level 2 backends run in Docker. In `rin-apps` they run as Kubernetes deployments in the tenant namespace (after the move).

### 5.6 Game settings in the CMS (GAM)

| ID | Requirement | Priority |
|---|---|---|
| GAM-1 | Status per tenant: `draft`, `live`, `hidden` (link only), `disabled` | Must |
| GAM-2 | Active version selector with version history and rollback | Must |
| GAM-3 | Settings form generated from the manifest, values stored per tenant | Must |
| GAM-4 | Start screen: on/off, title, rules, button label | Must |
| GAM-5 | Loading screen: logo, text, minimum display time | Must |
| GAM-6 | End screen: section order (score, streak, percentile, next game, article, daily quiz), each with a target | Must |
| GAM-7 | Motivation: counts toward the shared streak, points multiplier, included in the weekly leaderboard | Must |
| GAM-8 | Access: everyone or logged-in players only | Must |
| GAM-9 | Schedule: live from / until | Should |
| GAM-10 | Live preview next to every form (mobile 375 px and desktop, light and dark) | Must |
| GAM-11 | Switch a game on and off (`live` / `disabled`), archive it (soft delete: data kept, slug freed) and restore it | Must |
| GAM-12 | Game builder: the form, the live preview and click-to-edit on one screen; every field shows the value players get when it is left empty (D-51) | Must |

- **GAM-3.1** Changing a setting takes effect on the next game load without a new build.
- **GAM-10.1** The preview reflects unsaved form changes.
- **GAM-10.2** The preview stays next to the form at every admin width from 1024 px; below that it is a panel the editor opens from the form. It never moves below the form.
- **GAM-10.3** Focusing a field shows the screen it changes, with sample data: loading (held, no timer), start, end (sample score, streak, percentile, a new badge, the share button), the running game (settings, appearance), and for leaderboard, badge and share settings the matching board, badge or share card. The preview never creates sessions, plays or events.
- **GAM-12.1** Clicking an editable element in the preview (loading text, start title, rules and button, an end section, the accent colour) opens its field and focuses it.
- **GAM-12.2** An empty field shows the value players get instead (shell copy, game name, manifest description, manifest setting default, tenant theme) and is marked as the default; a changed field can be reset to the default, which stores nothing.
- **GAM-12.3** The builder covers every per-game setting the API accepts, including the loading logo (GAM-5) and the settings added by LBD-1, BDG and SHR; a setting without a preview screen is a defect.
- **GAM-11.1** An archived game is disabled and gone from the game list, the API, the landing page and public play (404); its versions, players and plays are kept, and the archive is in the audit log.
- **GAM-11.2** In production tenants, archiving with an agent token creates a proposal instead.
- **GAM-11.3** The slug of an archived game can be registered again; the new game never writes into the archived game's bundles.
- **GAM-11.4** An admin restores an archived game as `disabled` (switching it on is a separate step); restore fails with 409 while another game uses the slug.

### 5.7 Appearance (THM)

| ID | Requirement | Priority |
|---|---|---|
| THM-1 | Tenant theme: primary and accent colours, font, corner radius, light and dark mode | Must |
| THM-2 | Per-game overrides: accent colour, icon, cover, loading background. Everything defaults to the tenant theme | Must |
| THM-3 | Defaults from Azet design tokens: primary `#1273ea`, Koktejl `#ed1137`, font Excon | Must |
| THM-4 | The public games pages (landing, leaderboard, profile) use the default Azet navigation and footer and the Azet „nova“ look (Figma „Azet Gamifikacia“, D-63); the tenant picks the template light, dark, device or **Halloween**. Halloween applies only to the games pages and the games, and changes only the background (`#1c032f`); text, surfaces and outlines are derived from it | Should |

- **THM-1.1** A game with no overrides renders in the tenant theme.
- **THM-2.1** An editor uploads per game an icon (square PNG, WebP or SVG, 128–1024 px, ≤ 256 KB), a cover (16:9 PNG, WebP or JPEG, 640–2560 px wide, ≤ 1 MB) and a loading background (PNG, WebP or JPEG, sides 320–4096 px, ≤ 1 MB). Type and dimensions are read from the file, not from the request; anything else is rejected with `422` and changes nothing.
- **THM-2.2** Uploaded assets are served from the games origin under an immutable, content-hashed path, never from the admin host; replacing an asset stores a new path. On the next load the shell uses them (icon, cover on the start screen, loading background on the loading screen), the landing tile and game list show the cover (without one: the icon on the game's accent colour) and the share card OG image (SHR-2) shows the cover.
- **THM-2.3** Removing an override falls back to the default: the manifest icon, the manifest cover or none, the tenant background (THM-1.1).
- **THM-2.4** An SVG with scripts, event handlers, `foreignObject`, a DTD or a reference to anything but its own fragments or an inline raster image is rejected; assets are served with a CSP that allows no scripts and no network (D-53).
- **THM-2.5** Upload, replace and remove follow the rules of the other game settings and are audited; agent tokens in production tenants get `403` (an upload cannot become a proposal); another tenant's game is `404` (TEN-2.1).
- **THM-2.6** The builder's Appearance section has the three uploads with the default shown (manifest icon, no cover, tenant background) and Reset to default; the preview updates live, and clicking the icon, cover or loading background in it opens the field (GAM-12.1).
- **THM-4.1** The navigation is its own component (`lib/nova/AzetNav`): portals with the Bratislava weather (Open-Meteo, cached 30 min, left out on failure) and the date with the Slovak name day, the sticky main row (logo, search, sections, Azet Mail, player or „Prihlásenie“), the services row with Hry current; below 1024 px the portals and sections are hidden and the search takes its own row, as in the new Azet catalog (whose navigation stays unchanged).
- **THM-4.2** The landing shows the games as cards (chips: the editor label and the category, cover, name, description, „Hrať“, session length), category tabs when there is more than one category (`?k=<category>`), the top 3 with an in-app picker (this week, this month, all time, the tenant's other public boards) and „Zobraziť celý rebríček“, today's challenge (RET-1; its „Hrať“ opens a game that moves the challenge: the challenge's game, or for a "different games" challenge the first landing game the player has not counted today, and no button when none is left), the three benefits and the footer.
- **THM-4.3** With the Halloween template the pages have the background `#1c032f` and the illustration next to the title, and games receive `mode: dark` with the Halloween colours; the admin and other tenants are unaffected.

### 5.8 Landing page (LND)

| ID | Requirement | Priority |
|---|---|---|
| LND-1 | Sections in a drag-and-drop order (for example *Today's games*, *Daily quiz*, *From the hackathon*, *New*) | Must |
| LND-2 | Game tiles in a section: on/off, order, size (small, medium, large), label | Must |
| LND-3 | Featured game of the day, schedulable by date | Should |
| LND-4 | Changes are drafts until published. Publishing is recorded in the audit log | Must |
| LND-5 | In a sandbox tenant (the hackathon) every live game the published layout does not mention is shown after the sections in a „Hry tímov“ section, sorted by name, medium tiles. Production tenants show only the layout | Must |

- **LND-2.1** Switching a tile off removes it from the public landing page after publishing, within 60 s.
- **LND-5.1** A game the layout mentions anywhere (featured, or a tile, also one switched off or in a section switched off) is not added to „Hry tímov“: switching its tile off is how an editor hides a live game from the hackathon page. Games that are not live, archived or outside their live window are not added; external games only appear where the editor puts them.

### 5.9 Tenants (TEN)

| ID | Requirement | Priority |
|---|---|---|
| TEN-1 | Tenants `azet`, `koktejl`, `azet-hackathon`, each with its own games, settings, landing page, players and data | Must |
| TEN-2 | The tenant is derived from the session or token, never trusted from a request parameter | Must |
| TEN-3 | No endpoint lists tenants or their configuration, except for superadmins | Must |
| TEN-4 | No secrets in tenant or game configuration. Secrets live in Vault (or `.env` locally) | Must |
| TEN-5 | Promotion copies a game and its active version from `azet-hackathon` to `azet` as a draft. Going live needs product approval | Must |
| TEN-6 | Postgres row-level security enforces tenant isolation as a second layer | Must |

- **TEN-2.1** A token from `azet-hackathon` gets 404 for any game in `azet`, even with the correct slug.
- **TEN-6.1** A query without the tenant context set returns no rows.

### 5.10 CLI and agents (CLI)

| ID | Requirement | Priority |
|---|---|---|
| CLI-1 | `azg` covers every CMS action (see CLI.md) | Must |
| CLI-2 | People log in with a browser device flow. Agents use `AZG_TOKEN`. `azg login` opens the default web browser on macOS, Linux and Windows (on Windows through `url.dll`, not `explorer`, which can open the file browser; 1.24.0, hackathon feedback 23 Oct) | Must |
| CLI-3 | Tokens are scoped by tenant, games and permissions, expire (default 90 days) and are stored hashed | Must |
| CLI-4 | `azg api ops --json` lists the operations a token may call | Must |
| CLI-5 | `config pull/diff/push` round-trips a tenant's configuration as YAML | Must |
| CLI-6 | In `azet` and `koktejl`, agent tokens can only create change proposals. People approve them | Must |
| CLI-7 | `--json` on every command, meaningful exit codes | Must |
| CLI-8 | (1.26.0) `azg games create` never prints the deploy token: it saves it to `<slug>/.azg/deploy-token` (mode 600, git-ignored) and says the slug is permanent (Ivana 25 Oct: shared screens, AI assistant logs) | Must |

- **CLI-5.1** `config pull` followed by `config push` with no edits reports "no changes".
- **CLI-6.1** `config push` with an agent token in `azet` creates a proposal and prints its URL. Nothing changes until approval.

### 5.11 Motivation core (MOT)

| ID | Requirement | Priority |
|---|---|---|
| MOT-1 | Shared daily streak: a day counts when the player completes at least one game. Time zone Europe/Bratislava | Must |
| MOT-2 | Per-game streak | Must |
| MOT-3 | Points: base points per completion × game multiplier, plus the game's own score normalized to 0–100 | Must |
| MOT-4 | Weekly leaderboard (Monday 00:00 reset), logged-in players and players with a nickname (LBD-5) only, shown once it has at least N players | Must |
| MOT-5 | Percentile on the end screen ("better than 78 % of players today") | Must |
| MOT-6 | Nicknames pass a deny-list filter | Must |

- **MOT-1.1** Completing two games on the same day increases the shared streak by one.
- **MOT-4.1** With fewer than the minimum players, the leaderboard shows an encouraging empty state.

### 5.12 Data (DAT)

| ID | Requirement | Priority |
|---|---|---|
| DAT-1 | Every event (start, progress, complete, custom, store write) carries tenant, game, version, session and the hashed Azet ID (or anonymous ID) | Must |
| DAT-2 | Events are stored in Postgres and exportable to DTM (format agreed with the data team) | Must |
| DAT-3 | Per-game numbers in the CMS: players, completions, average time, return rate, for today and the last 7 days | Must |
| DAT-4 | Respect marketing consent. Player data can be deleted on request | Must |

### 5.13 Distribution (DIST)

| ID | Requirement | Priority |
|---|---|---|
| DIST-1 | The CLI, the SDK and the backend helpers are installable from the CMS itself, without an npm registry or tokens (D-34) | Must |

- **DIST-1.1** `GET /downloads/<file>` serves the packed tarballs (`azet-games-<pkg>-<version>.tgz`, an unversioned alias of the latest), the single-file SDK and `index.json`, and nothing else.
- **DIST-1.2** `npm i -g --allow-remote=all <cms>/downloads/azet-games-cli.tgz` gives an `azg` that talks to that CMS by default; games it scaffolds depend on that CMS's tarballs, and `azg validate` accepts them.
- **DIST-1.3** `azg contract` from a globally installed CLI uses the Playwright of the game project; when Chromium does not start, it says why (missing browser, missing system libraries) instead of „Playwright is not installed“.
- **DIST-1.4** (1.25.1) Works with npm 12, which refuses tarball URLs by default: the install command carries `--allow-remote=all`, and every project whose `package.json` points at the CMS downloads (scaffold, starter .zip, `azg backend add`) gets an `.npmrc` with `allow-remote=all` (D-89). `azg api call` writes a binary answer (.zip, images) as bytes, so `> starter.zip` gives a valid zip.

### 5.14 Guide (HLP)

| ID | Requirement | Priority |
|---|---|---|
| HLP-1 | The CMS shows the documentation (docs/) as pages in a fixed hierarchy, starting with an overview of the whole flow, with this CMS's real URLs and downloads | Should |

- **HLP-1.1** The overview and the game's upload tab show the CLI install command of this CMS; links between documents stay in the CMS; diagrams are drawn.
- **HLP-1.2** The upload tab shows the AI prompt filled in for the game, with a copy button.

| ID | Requirement | Priority |
|---|---|---|
| HLP-2 | An admin guide (ADMIN.md) walks editors and agents through setting up a tenant: members, tokens and scopes, looks and templates, games, landing, external games, challenges, badges, leaderboards, tournaments, moderation, statistics, economy — each step with the admin page and the API call | Should |
| HLP-3 | The documentation is readable with any token (`GET /api/v1/docs`, `/docs/{slug}` as Markdown); `azg docs` lists, prints and pulls it, and `azg ai setup` (offered right after `azg login`) downloads it into `.azg/docs/` and writes `CLAUDE.md` / `AGENTS.md` so an AI assistant reads the platform rules before it acts | Should |

- **HLP-3.1** Without a valid token the docs API is `401`; an unknown slug is `404`; the Markdown is the file the CMS renders.
- **HLP-3.3** (1.23.1) The Markdown links between documents name the pulled files (`](game-services.md#…)`), so `.azg/docs` works on case-sensitive file systems.
- **HLP-3.2** `azg ai setup` keeps an existing `CLAUDE.md` / `AGENTS.md` and replaces only its azg block; run again, it updates the block and the docs.

| ID | Requirement | Priority |
|---|---|---|
| HLP-4 | The docs say what the code does (developer test, 21 Oct): every `ts` code sample and type in SDK-CONTRACT, GAME-SERVICES, MANIFEST and HACKATHON typechecks against the published SDK and server packages in CI, field tables name the same types as the code (`string`, `number`, `null`), and ARCHITECTURE and DEPLOY draw the storage that runs (bundles and assets in Postgres, no S3) | Must |

- **HLP-4.1** A test extracts the code samples and type tables of those documents and fails on a sample that does not compile or a field whose documented type differs from the SDK's declaration; the mismatches it finds on 21 Oct are fixed in the docs or, where the docs describe the intended behaviour, in the code.

### Players & stats (v1.3.0)

Approved by Lukáš on 12 Oct (D-41). The module gives editors numbers per tenant and game, and gives players reasons to compare, collect and share. Rules for every requirement in §5.15–5.20:

- **Untrusted client.** Anything that comes from the game or the shell is untrusted. Leaderboards, trusted badges and statistics of results use only validated plays (`plays.rejected` empty, checks of SDK-CONTRACT §8), including metrics (§5.16).
- **Tenant isolation as everywhere.** Every new table is tenant-scoped with RLS (TEN-6); every new endpoint has a cross-tenant test (TEN-2.1).
- **Player identity.** Player-bound features use the existing `IdentityProvider` player key (ARCHITECTURE §5). Azet ID (AZG-15) is deferred; tests use the dev player. **Anonymous players** are device-only: their plays count in statistics, they see their badges and best results on the same device, and they get no leagues, no public profile and no place on any leaderboard (D-47).
- **GDPR.** New player data (settings, badges, league membership, shared results) is removed by the DAT-4 delete path and appears in the events export where it is an event (PRF-6).
- **SDK freeze.** The SDK and manifest additions (MET-1–3, BDG-1–2, SHR-1) are additive to protocol 1 and land **before 22 Oct** so hackathon teams can use them (D-46). `docs/SDK-CONTRACT.md` and `docs/MANIFEST.md` are changed by the implementing Dev Platform issue together with the code; this PRD states what they must add.

Must requirements of this module are listed in `docs/ac-deferred.json` (D-50) until the implementing issue adds their tests; that issue removes the entry.

### 5.15 Tenant statistics (STA)

| ID | Requirement | Priority |
|---|---|---|
| STA-1 | A CMS page "Statistics" (roles `admin` and `product`) shows tenant-wide numbers for a period: players per day / week / month (logged-in vs anonymous), starts, completions, completion rate (start → complete funnel), average play time, D1 and D7 return, streak distribution | Should |
| STA-2 | A per-game table on the same page with the same numbers per game, sortable, with comparison to the previous period of the same length | Should |
| STA-3 | The game detail shows the same charts for one game, extending DAT-3 | Should |
| STA-4 | Numbers come from existing data (plays, sessions, events, streaks; DAT-1) with no SDK change, through a daily rollup table (D-42) | Should |
| STA-5 | CSV export of the per-game table | Could |

- **STA-1.1** Definitions: *player* = distinct player key with at least one start in the period, split by `logged_in` of the session; *start* = a play row; *completion* = a play with `completed_at` that was not rejected; *completion rate* = completions / starts; *average play time* = mean `time_seconds` of completions; *D1 return* = share of players whose first play in the tenant (or game) was on day X and who played again on X+1; *D7* = played again on any day X+1…X+7; *streak distribution* = logged-in players by current shared streak in buckets 1, 2–3, 4–7, 8–14, 15–30, 31+. Days are Europe/Bratislava days (MOT-1).
- **STA-1.2** Period filter: today, last 7 days, last 30 days, a custom range up to 366 days; granularity day / week (Monday) / month. Today is computed live; past days come from the rollup.
- **STA-1.3** A `viewer` or `team` member and any agent token without `games:read` gets 403 for the statistics endpoints; a game-limited token sees only its games and never the tenant totals.
- **STA-2.1** The comparison shows the absolute and relative change against the previous period; a game with no data in either period shows "–", not 0 %.
- **STA-2.2** A game archived after it had plays in the period stays in the per-game table, marked *Archived* and without a link, so the rows add up to the tenant totals.
- **STA-4.1** With 1 000 000 plays over 90 days in a tenant, the Statistics page API answers in ≤ 500 ms p95 for a 90-day range (integration test with seeded rollups, timing asserted on the query, not on the network).
- **STA-4.2** The rollup for day X is recomputed idempotently (re-running it gives the same rows) and a late completion on day X is included by the next run; numbers from the rollup equal numbers computed from raw plays for the same day.
- **STA-4.3** A tenant never sees another tenant's numbers, also not through the rollup table (TEN-2.1, TEN-6.1).

### 5.16 Game metrics (MET)

| ID | Requirement | Priority |
|---|---|---|
| MET-1 | A game declares up to 100 metrics (10 before v1.29.0, 40 before v1.33.1, HUB-4) in `azet-game.yaml` (`metrics:`): `id`, `title`, `type` (`integer` / `number` / `duration` in seconds), `better` (`higher` / `lower`), optional `unit`, `min`, `max` | Must |
| MET-2 | The game sends metric values with the result: `game.complete({ score, stats: { <id>: number } })`; backends send the same `stats` object to `POST /results` (BE-6) | Must |
| MET-3 | The server validates `stats` against the manifest of the played version like the score and stores the values per play | Must |
| MET-4 | Statistics show averages and distributions of a game's metrics in the game detail (STA-3) | Should |

- **MET-1.1** Metric ids match `^[a-z][a-zA-Z0-9_]{1,39}$` and are unique; `title` 1–40 chars (Slovak, shown to players); `unit` ≤ 10 chars; `min` ≤ `max`. A wrong declaration fails `azg validate`, the CI `validate` job and the CMS upload with the field path (MAN-3.1).
- **MET-2.1** `stats` is optional; a game without `metrics:` that sends no `stats` behaves exactly as before (protocol 1 stays backwards compatible).
- **MET-2.2** In development (`azg dev`, the dev shell, the contract test) `complete()` with an undeclared metric, a non-finite value, a non-integer for `integer`, a negative `duration` or a value outside `min`/`max` logs a console error that names the metric (as SDK-2.2).
- **MET-3.1** On the server an invalid `stats` object does not reject the score: the play's score counts by the existing rules, its metrics are not stored, and the response carries `statsRejected: "<reason>"` (`undeclared`, `invalid_type`, `out_of_range`) so the end screen and the developer see why (as D-18).
- **MET-3.2** Metrics of rejected plays (too fast, out of range) are stored for diagnostics but never count in leaderboards, badges or metric statistics.
- **MET-3.3** A backend result (BE-6) with `stats` replaces the stats the shell sent for that play, like the score.
- **MET-3.4** The `html`, `vanilla-ts` and `phaser` templates, a reference game and `AI-PROMPT.md` show how to declare and send one metric.

### 5.17 Leaderboards (LBD)

| ID | Requirement | Priority |
|---|---|---|
| LBD-1 | Editors (`product`, `admin`) configure leaderboards per game: metric (`score` or a declared metric), period (`day` / `week` / `month` / `all` / `campaign` with from–to dates), aggregation (`best` / `sum` / `count`), minimum players N, tie-break, top N | Should |
| LBD-2 | Tenant leaderboards: the existing points leaderboard (MOT-4) becomes the tenant's default board with the same settings, plus "event" boards by points over a selected set of games and a period | Should |
| LBD-3 | The public leaderboard page on the tenant host renders any configured board: top N plus "your position" for the ranked player (logged in or with a nickname), and the board's empty state | Should |
| LBD-4 | Boards rank logged-in players and players with a nickname (LBD-5) only, from validated plays only, and show only players who opted in (PRF-1) | Should |
| LBD-5 | A player without login can choose a nickname on the end screen or the public leaderboard page (D-54). The nickname is stored on the device player key per tenant and is the opt-in to public boards; from then on the player earns points and streaks and is ranked and listed like a logged-in player, bound to the device. Still no leagues and no public profile | Should |

- **LBD-1.1** `best` takes the best value per player in the period, in the metric's `better` direction (for `score`, `scoring.higherIsBetter`); `sum` adds values; `count` counts validated completions (metric ignored).
- **LBD-1.2** Tie-break: `earliest` (the player who reached the value first ranks higher, default) or `fastest` (lower `time_seconds` of the deciding play). Equal after the tie-break → same rank.
- **LBD-1.3** Top N between 3 and 100 (default 10); N players between 1 and 100 (default 1, D-54; also the MOT-4 default board). Below N the board shows the encouraging empty state (MOT-4.1).
- **LBD-1.4** Periods reset at 00:00 Europe/Bratislava; `week` starts on Monday; `campaign` needs `from` ≤ `to` and ranks plays in that range only.
- **LBD-1.5** A board whose metric is no longer declared by the active version stays readable with its stored values and shows a warning in the CMS; it cannot be saved with an undeclared metric.
- **LBD-2.1** An event board over games A and B ranks the points of A and B only; a game of another tenant cannot be selected (404).
- **LBD-3.1** "Your position" shows the player's rank and value even outside the top N and the player's own row is highlighted; an anonymous player without a nickname sees the nickname field instead (LBD-5).
- **LBD-3.2** The leaderboard page answers in ≤ 300 ms p95 at 100 000 plays in the period (integration test).
- **LBD-4.1** A rejected play, a play with `statsRejected` (for metric boards) and a cosmetic badge never change a board.
- **LBD-4.2** Nicknames on boards pass the deny list (MOT-6); a player who did not opt in is counted for N but not listed, and sees their own position.
- **LBD-5.1** A nickname has 2–20 characters (letters, digits, space, `_ . -`) and must not contain a word of the tenant deny list (MOT-6); a device can change it at most 5 times a Bratislava day (`429` after that). Signed-in players keep the nickname of their account (`403`).
- **LBD-5.2** Plays count for points, streaks and boards only from the moment the nickname exists; earlier plays of the device never count. The nickname does not give leagues (LEA-2.1) or a public profile (PRF-4).
- **LBD-5.3** The end screen of an anonymous player without a nickname shows the field "Zadaj prezývku a objav sa v rebríčku" with an Uložiť button instead of the PRF-5 prompt; after saving it shows the player's rank (`me`) on the default board. The public leaderboard page shows the same field.
- **LBD-5.4** Two devices with the same nickname are two players. When listed entries collide, the second and later ones in rank order get a short disambiguator (`Lukas #2`).
- **LBD-5.5** The nickname belongs to one tenant (another tenant does not see or use it), and the DAT-4 delete removes it.
- **LBD-5.6** After a counted play the end screen shows the player's place on the weekly board ("1. miesto", the week's points) with a link to the leaderboard page, for signed-in players and players with a nickname alike (Lukáš, 13 Oct).

### 5.18 Badges (BDG)

| ID | Requirement | Priority |
|---|---|---|
| BDG-1 | A game declares up to 50 badges (20 before v1.29.0, HUB-4) in `azet-game.yaml` (`badges:`): `id`, `title`, `description`, `icon` (asset path), and either a server `rule` or `award: game` / `award: backend` | Must |
| BDG-2 | `game.award('<id>')` awards a declared `award: game` badge from the game; such awards are **cosmetic** and marked so (D-45) | Must |
| BDG-3 | The server evaluates `rule` badges on every validated result (score, metrics, per-game and shared streaks, number of completions); these awards are **trusted** | Should |
| BDG-4 | A game backend awards `award: backend` badges through the BE-6 results path (`badges: ['<id>']` in `POST /results`); trusted | Should |
| BDG-5 | Editors define tenant badges in the CMS with the same rule language over several games (e.g. "played every live game this week", "7-day shared streak") | Should |
| BDG-6 | The end screen shows "new badge" for awards of this play; the player profile (PRF-3) shows all badges, cosmetic ones marked | Should |
| BDG-8 | (1.27.0) A game badge's rule combines up to 5 conditions that must all hold on the same play, and can look at the play's time, whether it was won and the player's wins in a row in the game | Should |
| BDG-7 | Editors set badge icons and texts in the CMS: upload an icon for each tenant badge, and override the title, description and icon of a game badge for their tenant (D-55) | Should |

- **BDG-1.1** Badge ids match `^[a-z][a-z0-9-]{1,39}$` and are unique per game; `title` 1–40 chars, `description` ≤ 120 chars (Slovak); the icon must exist (SVG or PNG ≥ 128 px). A badge has exactly one award path.
- **BDG-1.2** Rule language (no code): `{ when: score | metric:<id> | streak | gameStreak | completions, op: '>=' | '<=', value: number }`, optionally `period: day | week | all`. A rule on an undeclared metric fails validation.
- **BDG-2.1** `game.award()` with an undeclared id, an id with a `rule`, or `award: backend` returns `{ ok: false, error: { code: 'invalid_payload' } }` and awards nothing; in development it logs a console error. Repeated awards of the same badge are idempotent.
- **BDG-2.2** Cosmetic badges never count toward tenant badges, leaderboards or statistics, and the API and profile return them with `trust: "cosmetic"`.
- **BDG-3.1** A rule badge is awarded at most once per player and badge; a rejected play never awards one.
- **BDG-4.1** A backend award for a badge that is not `award: backend`, or for a session of another game or tenant, is rejected (`422` / `404`) and audited.
- **BDG-5.1** Tenant badges are stored per tenant; a badge of tenant A is never evaluated on or shown in tenant B.
- **BDG-7.1** An editor uploads, replaces and removes the icon of a tenant badge (square PNG, WebP or SVG, 128–1024 px, ≤ 256 KB) with the THM-2.1 and THM-2.4 checks; it is served from the games origin under an immutable, content-hashed path with the image-only CSP, and `GET /badges` returns `iconUrl`. The Badges page has the upload in the create/edit dialog and shows the icons in the list.
- **BDG-7.2** Per game badge, an editor overrides the title (1–40 chars), description (1–120 chars, Slovak) and icon for their tenant; an empty field is the manifest value, shown as the default with Reset to default (GAM-12.2). The rule and the award path never change. The `complete` response, the badge list and profile (BDG-6, PRF-3) and the admin lists show the effective values. The builder's Badges section lists the game's badges with icon, title and description, editable in place; the preview shows the focused badge as "Nový odznak" with its unsaved texts (GAM-10.3) and clicking it opens its field (GAM-12.1).
- **BDG-7.3** A badge without an icon gets a generated one (its first letter on the badge colour), so the end screen and the profile never show a bare star.
- **BDG-7.4** Icon and text writes are audited; agent tokens in production tenants get `403` (no proposal path); a badge or game of another tenant is `404` (TEN-2.1).
- **BDG-8.1** (1.27.0) `rule: { all: [condition, …] }` with 2–5 conditions of the BDG-1.2 form; the badge is awarded by a play on which every condition holds. A rule has either `all` or one `when`/`op`/`value`, never both (validation error); a metric in any condition must be declared. Rules with one condition stay as they are.
- **BDG-8.2** (1.27.0) `when: time` is the play's seconds (`timeSeconds` of `complete()` or the backend result, else the measured time); `when: success` is `1` for a won play (`success: true`) and `0` for a lost one. A play that does not report `success` meets no `success` condition.
- **BDG-8.3** (1.27.0) `when: winsInARow` is the number of the player's latest validated plays of the game that were won, this play included, up to 100; a lost play or one without `success` ends the run, rejected and practice plays are not part of it. Game badges only; tenant badges and daily challenges keep their rule language.
- **BDG-6.1** Anonymous players keep badges on the device's player key and see them on the end screen; they are lost with the anonymous ID (no merge on login in v1.3.0).

### 5.19 Sharing and leagues (SHR, LEA)

| ID | Requirement | Priority |
|---|---|---|
| SHR-1 | `game.share({ text })` lets the game provide the share text of the current result (e.g. a Wordle-style grid); the shell uses it for the share button on the end screen | Must |
| SHR-2 | Result card: a share link on the tenant host with an OG image generated by the server from the validated result (game, score, streak, the game's share text) | Should |
| SHR-3 | Challenge link: a friend opens the link and plays the same daily level (same date and seed); the end screen compares both results | Should |
| LEA-1 | Private leagues: a logged-in player creates a league with a name and gets a join code; others join with the code | Should |
| LEA-2 | Each league has a leaderboard among its members over the tenant's points or a chosen game board (LBD-1 settings) | Should |
| LEA-3 | League names pass the nickname deny list (MOT-6) | Should |

- **SHR-1.1** Share text is plain text, ≤ 280 chars and ≤ 8 lines; longer text is rejected with `too_large`. It is never rendered as HTML (`textContent`, OG image text rendering), and URLs in it are not linked.
- **SHR-1.2** Without `game.share()` the shell builds a default share text from the game name, score and streak.
- **SHR-2.1** The OG image and the card page show only validated data from the server; a rejected play cannot be shared as a result. The card page works without login and contains no player key.
- **SHR-2.2** *Share result* copies only the link to the clipboard, ready to send to a friend: the result card (which shows the score and the share text), or the game itself for a rejected play. *Challenge* copies only the challenge link. The OS share sheet opens only when the browser has no clipboard (Lukáš, 13 Oct).
- **SHR-3.1** The challenge link is signed and carries the game, level date and the challenger's play; opening it after the day passed plays that day's seed as practice: no points, streak, leaderboard or badges (D-48). It is still a real play today, so it counts toward today's daily challenge (a signed-in or nicknamed player; completing the challenge with it gives no bonus points, D-71). Only games with `levels.mode: daily`. A same-day challenge play counts like any play, also toward today's daily challenge. When a play does not move the daily challenge, the end screen says why in one Slovak line (not signed in, rejected result, game already played today for a "different games" challenge, challenge of another game; D-71).
- **SHR-3.2** A tampered or expired (30 days) challenge link opens the game normally with a short message.
- **LEA-1.1** Join codes are 8 characters, unguessable, rate-limited; a league has at most 200 members; the owner can remove members, rename and close it.
- **LEA-1.2** Joining a league shows the player's nickname to the members of that league only, even without the public opt-in (PRF-1).
- **LEA-2.1** A league never includes players of another tenant; anonymous players get `403` on every league endpoint (list, create, join, detail, rename, close, members); with leagues off `404` wins (PRF-2.1).
- **LEA-3.1** A league name containing a denied word is rejected with the same message as a nickname.

### 5.20 Player profile and privacy (PRF)

| ID | Requirement | Priority |
|---|---|---|
| PRF-1 | Player settings: nickname shown or anonymous, appear on public leaderboards (opt-in, default off, D-49), profile shareable (default off) | Should |
| PRF-2 | Tenant settings: leagues on/off, sharing (cards and challenges) on/off | Should |
| PRF-3 | Player profile on the public tenant host: badges, current and best streaks, best results per game, leagues | Should |
| PRF-4 | Anonymous players get the device-only experience: end screen, badges and best results on the device, no leagues, no public profile, no leaderboard unless they choose a nickname (LBD-5) | Should |
| PRF-5 | When a logged-in player first qualifies for a public board, the end screen asks once whether to appear on leaderboards; anonymous players get the nickname field instead (LBD-5.3) | Should |
| PRF-6 | The DAT-4 delete removes the new player data (settings, badges, league memberships, owned leagues, shared cards) | Should |

- **PRF-1.1** Until a player opts in, public boards list them neither by nickname nor anonymously; their own position stays visible to them (LBD-4.2). For an anonymous player, choosing a nickname is the opt-in (LBD-5).
- **PRF-1.2** Settings are stored per tenant and player key; they are not readable by another player or tenant.
- **PRF-2.1** With leagues off, league endpoints return 404 and the shell hides league UI; with sharing off, the share button and challenge links are gone and existing card links return 404.
- **PRF-3.1** A profile that is not shareable is visible only to its owner; another player gets 404 (not 403).
- **PRF-3.2** Every signed-in player has a profile code from their first play or league join, whether or not the profile is shareable; rows created before that rule get one by migration (0021). A code never changes. Anonymous players have none.
- **PRF-6.1** After a delete, the player's badges, settings and memberships are gone, leagues they owned are closed, their card links return 404, and the audit log records counts only (as today).

### 5.21 Error pages (ERR)

Lukáš, 13 Oct (D-52): every error state a person can reach in a browser gets a designed page instead of a blank or framework screen.

| ID | Requirement | Priority |
|---|---|---|
| ERR-1 | Admin error pages in the Phillip design, light and dark: no access (403), not found (404), session expired, unexpected error (500) | Must |
| ERR-2 | Player-facing error pages in Slovak: 404 and 500 on the public hosts in the tenant theme, a neutral page for an unknown host or tenant, and error screens in the shell | Must |

- **ERR-1.1** A signed-in member whose role does not include an admin page (e.g. Tokens for a team member, Statistics and Badges for team and viewer members) gets a `403` page inside the admin that says what is not allowed, shows their role and tenant, names who can grant access (the tenant admins) and links back to Games. A signed-in user who is a member of no tenant gets a `403` page instead of the sign-in page.
- **ERR-1.2** An unknown game, version, document or admin URL shows a `404` page inside the admin with links back to Games and to the game search.
- **ERR-1.3** An admin page opened without a valid session goes to sign-in with that page as the return path (only admin pages of the same host); when the browser still had an expired session the sign-in page says so; after signing in the user is back on the same page.
- **ERR-1.4** An unexpected error shows an apology, Retry and an error reference id (the digest in the server log, or a client id logged in the browser console); never the error message, stack or other internals.
- **ERR-2.1** An unknown or switched-off game, an unknown profile or card and any unknown path on a tenant host show a Slovak `404` page in the tenant theme with a link to the tenant landing.
- **ERR-2.2** An unexpected error on a public page shows a Slovak page with Retry and the error reference; no internals.
- **ERR-2.3** An unknown host or tenant shows a neutral Slovak `404` page without any tenant branding.
- **ERR-2.4** In the shell, a game that fails to load or times out, being offline and a refused session (`403` production version, `429` rate limit, `404` game off) show a Slovak error screen in the shell style with Retry where it makes sense; the game frame is never left blank. The screen is reachable from the preview API (`controller.preview('error', { reason })`, ARCHITECTURE §3); the SDK protocol does not change.
- **ERR-2.5** API errors stay JSON in the API error format; the pages are only for browser navigation (`GET`/`HEAD` accepting `text/html`), other requests to an unknown path keep a plain `404`.

### 5.22 Player login (AUTH)

Lukáš, 13 Oct (AZG-15, D-56): players sign in with Azet ID through Azet OAuth (authorization code + PKCE). On dev the OAuth server is rin-oauth; production needs the real Azet OAuth client (BUILD-PLAN H-5).

| ID | Requirement | Priority |
|---|---|---|
| AUTH-1 | Azet login on the tenant host: `GET /auth/login?return=<path>` redirects to Azet OAuth, `GET /auth/callback` signs the player in and returns to the same game. Enabled only when the `AZET_OAUTH_*` configuration is set; without it the fake/anonymous behaviour stays | Must |
| AUTH-2 | `POST /auth/logout` ends the player session; it accepts only same-origin requests (CSRF) | Must |
| AUTH-3 | The player key is the HMAC of the Azet `idUser` (same HMAC space as DTM `userstats.iduser`); the raw id and the OAuth tokens are never stored. The nickname is the Azet nick when it passes the nickname rules and the deny list (MOT-6), otherwise `Hráč` | Must |
| AUTH-4 | The shell and the public pages offer „Prihlásiť sa cez Azet“ to players who are not signed in, and show the signed-in player's nickname with „Odhlásiť“ (the nickname field of LBD-5.3 only for players who are not signed in) | Should |

- **AUTH-4.1** The login entry points have the look of the games pages (D-73): „Prihlásiť sa cez Azet“ on the start and end screens is the outline pill (on the end screen in the card „Prihlás sa a zbieraj body aj sériu“), the signed-in chip shows the initial, the nickname and „Odhlásiť“, like the player pill and its menu in the navigation of the games pages (THM-4.1). The login page itself belongs to Azet OAuth; its dev stand-in rin-oauth stays unstyled.
- **AUTH-1.1** Without all of `AZET_OAUTH_BASE_URL`, `AZET_OAUTH_CLIENT_ID`, `AZET_OAUTH_CLIENT_SECRET` and `AZET_OAUTH_PUBLIC_KEY`, `/auth/*` returns `404` and players stay anonymous (D-54) or the local fake player (D-29).
- **AUTH-1.2** Login keeps the state and the PKCE verifier in a short-lived (10 min) signed HttpOnly cookie and sends the S256 challenge; the code is exchanged on the server with the client secret, which never reaches the browser.
- **AUTH-1.3** The callback is rejected with `400` and no session when the state does not match the login cookie of this tenant, the access token has a bad signature, is expired or has another audience, or the token or profile request fails.
- **AUTH-1.4** The return path is a path on the same host only (no scheme, `//host`, backslash or whitespace); anything else goes to the tenant landing.
- **AUTH-1.5** The session is a signed `HttpOnly; Secure; SameSite=Lax` cookie of the tenant host, valid for 30 days without refresh; a session of one tenant is not valid on another tenant (TEN-2).
- **AUTH-2.1** A logout `POST` whose `Origin` is not the tenant's public origin gets `403` and keeps the session.
- **AUTH-3.1** A signed-in player gets everything limited to logged-in players (points, streaks, boards after the PRF-1 opt-in, leagues, profile, badges). Anonymous device data is not merged into the account (D-47), except the wallet, items and cloud saves since v1.30.0 (MRG-1).

### 5.23 Event catalog and player analytics (EVT)

Lukáš, 13 Oct (AZG-186, D-57): "statistics for signed-in players, user detail and similar data we can pull; the more data and events the better, everything documented and ready for every game". The catalog is [EVENTS.md](events.md). The SDK protocol does not change: the shell sends the new events, and custom events keep `track` (SDK freeze, D-46). The `events:` manifest field is additive.

| ID | Requirement | Priority |
|---|---|---|
| EVT-1 | One documented, versioned event catalog for every game (`docs/EVENTS.md`, shown in the CMS docs). The shell sends the automatic events without game code: `session_start`, `loading_done`, `start_click`, `start` (the play start; there is no separate `play_start`), `pause`, `resume`, `visibility_hidden`, `complete`, `abandon`, `error`, `share_click`, `challenge_click`, `nickname_set`, `login_click`, `login_done`, `leaderboard_open`, `badge_awarded`, `replay` and `back_click` | Should |
| EVT-2 | Every event passes the server limits: catalog types only, payload size, rate per session, and no personal data in the payload | Should |
| EVT-3 | Every stored event and play carries the tenant, game, version, session, player key (hashed), player kind (`signed_in`, `nickname`, `anonymous`), the time and the Bratislava play date. The player kind comes from the identity layer | Should |
| EVT-4 | Statistics split by player kind (players, plays, completion rate, average time, D1/D7/D30 return, streaks), the funnel session → loading done → play start → complete → share or replay, and the top custom events per game; today live, past days from the nightly rollup (D-42) | Should |
| EVT-5 | The DTM export (DAT-2) carries the new fields (`playDate`, `playerKind`, `name`), and the columns are documented in `docs/EVENTS.md` and `docs/DEPLOY.md`. The player key stays in the HMAC space of DTM `userstats.iduser` | Should |
| EVT-6 | Games declare their custom events in `azet-game.yaml` (`events:` with name, description and props). `azg validate` checks the declaration, and the dev shell warns on undeclared events (as MET-2.2). The templates and `games/snake` show `track()` with an `events:` block | Should |

- **EVT-1.1** The server stores every catalog type and drops any other type without an error to the shell. A shell event fires once at its moment (shell unit tests, Dev Platform).
- **EVT-1.2** A custom event is `track` with a `name` matching `^[a-z][a-z0-9_]{1,39}$` and object `props` ≤ 1 KB; anything else is dropped.
- **EVT-2.1** The serialized payload is at most 4 KB, else it is stored as `{ truncated: true }`. A session stores at most 300 events a minute and 2 000 in total, and extra events are dropped.
- **EVT-2.2** Payload keys of the personal-data deny list (one list for the SDK, the shell and the server, docs/EVENTS.md "Limits"; e.g. `email`, `phone`, `password`, `azetId`, `firstName`, `address`, `ip`) are removed at any depth, and strings that look like e-mail addresses become `[redacted]`. `_redacted` counts the removals. Nothing of it reaches the database.
- **EVT-3.1** The kind of a play is the kind at its start, and the completion updates it (a nickname chosen during the play counts). Events and plays before D-57 have no stored kind: statistics take `logged_in` and `ranked`, and the export takes the player's current kind.
- **EVT-4.1** A player has one kind a day: the highest of their plays that day (signed in, then nickname, then anonymous). The kinds add up to the totals. *D30 return* is the share of a cohort that played again on any day X + 1 … X + 30, counted once the window is over. Days before the split show only in the totals.
- **EVT-4.2** A funnel step counts the distinct sessions of a day with an event of the step (`session_start`; `loading_done`; `start`; `complete`; `share_click`, `challenge_click` or `replay`), summed over the days and games of the period. The rollup is idempotent and tenant-isolated (STA-4.2, STA-4.3).
- **EVT-4.3** The game statistics list the 10 most frequent custom event names of the period, with events and sessions.
- **EVT-6.1** An `events:` entry has a `name` (as EVT-1.2, unique), a `description` (1–200 characters) and optional `props` (at most 20, each with a unique name, a type `string`, `number` or `boolean` and an optional description ≤ 120 characters; docs/MANIFEST.md "Events"). A wrong declaration fails `azg validate`, the CI `validate` job and the CMS upload with the field path (MAN-3.1).

### 5.24 Players in the admin (PLY)

| ID | Requirement | Priority |
|---|---|---|
| PLY-1 | A "Players" page in the admin (roles `admin` and `product`) lists signed-in players and players with a nickname, searchable by nickname, profile code or reference | Should |
| PLY-2 | The player detail shows the kind, first and last seen, plays per game with the best and last score, points by week, streaks, badges with icons, leagues and the public-board opt-in | Should |
| PLY-3 | The detail shows a timeline of the player's recent events, filterable by game and type | Should |
| PLY-4 | The DAT-4 delete is available from the detail (admins only), with a confirm dialog | Should |

- **PLY-1.1** `viewer` and `team` members, tokens without a member role and game-limited callers get `403` (the page shows ERR-1.1).
- **PLY-1.2** Anonymous players without a nickname are never listed or opened (`404`); they count only in the statistics (EVT-4).
- **PLY-1.3** The search matches a nickname substring, an exact profile code or an exact reference.
- **PLY-2.1** The admin never shows the player key, an anonymous ID or an Azet ID, neither in the HTML nor in the API responses. A player is addressed by the reference `p-` + the first 16 hex characters of the SHA-256 of the player key, shown next to the profile code.
- **PLY-2.2** Every open of a player detail is written to the audit log (`player.view`), and every timeline read too (`player.events`), with the reference as the target and never the key.
- **PLY-2.3** A player of another tenant is `404` in the list, the detail, the timeline and the delete (TEN-2.1).

### 5.25 Game services (GSV)

Lukáš, 13 Oct (AZG-191, D-58): a complex game draws its own UI and still uses the platform: the same boards, nicknames, points and streaks as the shell, through a small API in `@azet/games-sdk` (browser, through the shell) and `@azet/games-server` (the game's backend). Documented in [GAME-SERVICES.md](game-services.md); endpoints in [API.md](api.md#game-services-gsv-d-58).

| ID | Requirement | Priority |
|---|---|---|
| GSV-1 | `game.player.get()` returns the player of the session: kind (`signed-in`, `nickname`, `anonymous`), nickname, public profile code, this week's points and rank, the shared and the game streak | Should |
| GSV-2 | `game.player.setNickname(name)` sets the LBD-5 nickname of an anonymous player with the end screen's rules and errors, so a game can show its own nickname UI | Should |
| GSV-3 | `game.player.login()` asks the shell to start the Azet ID login (AUTH); the game never sees credentials or the player key | Should |
| GSV-4 | `game.leaderboards.list()` / `.get(id, { around, limit })` and the same reads from the game backend return the boards of the game and of the tenant it counts for, with the LBD rules. Scores reach boards only through `complete` and `POST /results` | Should |
| GSV-5 | A game declares its own boards in `azet-game.yaml` (`leaderboards:`); the CMS creates them as game boards on publish, editors keep control of titles and limits, and the builder shows them as "From the game" | Should |
| GSV-6 | `game.points.get()` and the backend's `getPlayerSummary(player)` return this week's points and rank and the lifetime points | Should |
| GSV-7 | Cloud save (`game.store.player`, `game.store.shared`) is documented with its limits and patterns (save slots, a daily state) | Should |
| GSV-8 | Game services authenticate with the play token (browser) or the game token (backend), take the tenant, game and player from the token, are rate limited and never return the player key | Should |
| GSV-9 | The SDK additions are additive to protocol 1 (SDK-CONTRACT); the shell proxies the calls; `MemoryAdapter` and `azg dev` answer them with sample data; the templates and Snake show an in-game Top 5 and the player's nickname; HACKATHON.md has a "Game services" section | Should |

- **GSV-1.1** An anonymous player without a nickname gets `kind: anonymous`, `nickname: null`, no points, rank or streaks; after choosing a nickname `kind: nickname` and, after a counted play, the week's points, rank and streaks.
- **GSV-1.2** A signed-in player gets `kind: signed-in`; the profile `code` only when the profile is shareable (PRF-3), otherwise `null`.
- **GSV-2.1** The nickname rules are LBD-5.1 (2–20 characters, deny list, 5 changes a day, `403` when signed in) with the same error codes as the end screen.
- **GSV-4.1** `list()` returns the default board, the tenant and event boards the game counts for and the game's own boards; another game's board is not listed.
- **GSV-4.2** `get()` ranks validated plays of signed-in and nicknamed players, lists only opted-in players, applies the deny list and `#2` disambiguators, returns `me` and `enoughPlayers`; `around: me` returns the entries around the player; `limit` is 1–50.
- **GSV-4.3** No game-services call writes a score; a game cannot submit a score other than through `complete` (validated) or the backend's `submitResult` (BE-6).
- **GSV-4.4** The game backend lists and reads the same boards with its game token; `me` is the player of a given play session of its game.
- **GSV-5.1** Activating a version creates each newly declared board as a game board; a later version updates what the board ranks (metric, period, aggregation) and keeps the title and limits editors set; editors cannot change what a declared board ranks (`422`).
- **GSV-5.2** A declared board the CMS cannot rank (undeclared metric, unknown period, invalid or duplicate id) is skipped; `azg validate` reports it.
- **GSV-6.1** Lifetime points are the sum of the points of all counted plays of the player in the tenant.
- **GSV-6.2** `getPlayerSummary(player)` returns the GSV-1 shape for the player of a session of the token's game; a session of another game or tenant is `404`.
- **GSV-8.1** Without a valid play token every browser-side call is `401`; the backend calls need a game token (`403` for other tokens).
- **GSV-8.2** No response contains the player key.
- **GSV-8.3** The tenant and game come from the token: a board or session of another tenant or game is `404` (TEN-2.1).
- **GSV-8.4** Reads are limited per session (120 a minute) and per game token (600 a minute), with `429` beyond.
### 5.26 Currency, shop and inventory (ECO)

Lukáš, 13 Oct (AZG-196, D-60): a game can have its own currency (coins, gems, Písmenká …) and items, kept safely by the platform, so teams do not build a wallet themselves. The browser can only spend; currency is earned on trusted paths.

| ID | Requirement | Priority |
|---|---|---|
| ECO-1 | A game declares `currencies:` (id, Slovak title, icon, `max` balance, optional `dailyEarnCap`, scope `game` or `tenant`), `items:` (id, title, icon, price `{ currency, amount }`, `stackable`, optional `maxPerPlayer`) and `earn:` rules in `azet-game.yaml`; `azg validate` checks them | Should |
| ECO-2 | The platform keeps an append-only ledger per tenant and player (currency, delta, item, reason, source `rule`/`backend`/`client-spend`/`admin`, idempotency key, session, time) with materialized balances and item counts that never go negative; all writes run in the tenant transaction under RLS | Should |
| ECO-3 | Currency is earned only on trusted paths: the manifest's `earn:` rules on a validated play, the game backend with its game token (`wallet.credit`, `submitResult({ currency })`) and an admin adjust. There is no client-side earn | Should |
| ECO-4 | `game.wallet.get()`, `game.wallet.spend()`, `game.shop.buy()`, `game.inventory.get()` and `game.inventory.consume()` work for every player of the session (signed-in, nickname, anonymous on the device key without merge on login); writes are idempotent by key | Should |
| ECO-5 | Admin: the game builder's *Economy* section shows the declared currencies, items and earn rules (read-only), totals in circulation, earned and spent per day and the top items; admins see a player's balances and ledger and can make an audited manual adjust with a reason | Should |
| ECO-6 | A tenant switch "Economy enabled", on by default in sandbox tenants and off in production tenants until an editor enables it; a second switch enables shared (`scope: tenant`) currencies | Should |
| ECO-7 | GAME-SERVICES.md "Currency and shop", API.md, MANIFEST.md and SDK-CONTRACT.md (additive) document the economy; the starter template has an example and Had earns Písmenká and sells "Druhý život" (one extra life a day) on the hackathon tenant | Should |
| ECO-8 | `wallet_earn`, `wallet_spend`, `item_buy` and `item_consume` are recorded as events and listed in the event catalog | Should |

- **ECO-1.1** The CMS uses only usable declarations (a valid, unique id; an item's price in a declared currency; an earn rule on `score` or a declared metric with a positive rate) and skips the rest; a currency without `max` has the platform maximum (1 000 000).
- **ECO-1.3** A `scope: tenant` currency is shared by the tenant's games only while shared currencies are enabled; before that it is not usable (`invalid_payload`) and not listed in `wallet.get()`.
- **ECO-2.1** The application role cannot change a ledger row; balances and item counts have a database check against negative values.
- **ECO-2.2** Every applied spend, buy, consume and earn writes its event (ECO-8).
- **ECO-2.3** The DAT-4 player delete removes the player's ledger rows, balances and items.
- **ECO-3.1** Earn rules credit `floor(value × rate)` of `score` or `metric:<id>`, at most the rule's `max`, once per play and rule, only for a validated play (not rejected, not practice); `complete` returns `earned`.
- **ECO-3.2** The backend's `wallet.credit` and `submitResult({ currency })` need the game token, take the player from a play session of the token's game and are idempotent by key (by session for results); an undeclared currency is `422`.
- **ECO-3.3** No browser-side call earns currency: the wallet endpoint has no earn op and the credit endpoint refuses a play token.
- **ECO-3.4** Rule and backend credits respect the currency's `max` and `dailyEarnCap` (per Europe/Bratislava day); a cap cuts the amount (`capped`) instead of failing.
- **ECO-4.1** The same key with the same operation applies once and answers `duplicate: true`; the same key with another operation is `409` `conflict`. Keys are per player and game.
- **ECO-4.2** `buy` charges the item's price from the manifest of the played version; a price in the request is ignored.
- **ECO-4.3** A spend or buy above the balance is `409` `insufficient_funds` and changes nothing.
- **ECO-4.4** Parallel writes of one player are serialized: parallel spends never overdraw and a key used in parallel applies once.
- **ECO-4.5** Buying beyond `maxPerPlayer`, or a second non-stackable item, is `409` `quota`.
- **ECO-4.6** `consume` removes owned items, `409` `insufficient_items` above the owned count.
- **ECO-4.7** Signed-in and anonymous players have wallets on their player key; a device wallet moves to the account at login since v1.30.0 (MRG-1; not merged before, D-47).
- **ECO-5.1** `GET /games/{slug}/economy` returns the definitions, totals in circulation and holders, earned and spent per day for 14 days and the top 5 items.
- **ECO-5.2** Admins read a player's balances, items and newest ledger entries in their tenant.
- **ECO-5.3** The adjust needs the `admin` role (`members:write`) and a reason, keeps the balance within 0 and `max` and is audited (`wallet.adjust`).
- **ECO-5.4** Agent tokens in production tenants get `403` for the adjust.
- **ECO-6.1** With the economy off every wallet call is `403` `economy_disabled`, plays earn nothing and backend results are stored without crediting.

### 5.27 Moderation (MOD)

Lukáš, 13 Oct (AZG-201, D-61): public nicknames (D-54), leaderboards and the coming in-game currency need moderation tools before the Azet launch. The moderated player is addressed by an opaque id (the leaderboard `entryId`), never by the player key.

| ID | Requirement | Priority |
|---|---|---|
| MOD-1 | Moderator actions on a player in the admin, from the report queue, a nickname search and any row of the weekly leaderboard: rename or block the nickname, hide from public boards, freeze the economy, ban; each with its reverse | Must |
| MOD-2 | Rename resets the nickname to a neutral `Hráč 1234` and asks the player for a new one; block also adds the nickname to the tenant deny list | Must |
| MOD-3 | A hidden player keeps playing and sees their own rank; public boards skip them | Must |
| MOD-4 | A frozen player can neither earn nor spend the in-game currency (AZG-196) until the freeze is lifted | Must |
| MOD-5 | A banned player's plays stop counting (no points, boards, streaks or badges) and the end screen says "Tvoj účet je obmedzený"; bans are time-limited or permanent and reversible | Must |
| MOD-6 | Players report a listed nickname ("Nahlásiť") on the public leaderboard page and through the SDK (`game.leaderboards.report(entryId, reason)`); reports go to a moderation queue in the admin | Must |
| MOD-7 | An improbable score is flagged into the queue as "suspicious score"; nothing is taken from the player automatically | Must |
| MOD-8 | A nickname flood from one address is refused and logged | Must |

- **MOD-1.1** Every action needs a reason (1–500 characters); a ban needs a duration. An unknown player or one of another tenant is `404`.
- **MOD-1.2** Every action is audited as `player.moderate` (target = the player id, the reason and the ban's end in `after`) and listed in the player's history in the admin, newest first. The player key never appears in the admin or the API.
- **MOD-1.3** Members `admin` and `product` moderate (scope `players:moderate`); viewers, team members, game-limited tokens and agent tokens in production tenants get `403`.
- **MOD-1.4** The weekly board on the *Moderation* page lists every ranked player, also those the public board skips (no opt-in, hidden or banned; PRF-1.1, MOD-3, MOD-5.2), each marked "Not on the public board", so every row can be moderated. The public board keeps the ranks, so its numbering can skip (LBD-4.2).
- **MOD-2.1** After a rename the boards list the player as `Hráč` + 4 digits; their plays keep counting. The next end screen (and the public leaderboard page) asks for a new nickname (`nicknameReset`, `nicknamePrompt`); choosing one ends the reset. A signed-in player keeps the reset nickname instead of the account's and may choose a new one this way.
- **MOD-2.2** Block adds the nickname (lower case) to the tenant deny list (MOT-6), so nobody in the tenant can choose it again; other tenants are not affected. The deny list matches inside names, so a nickname shorter than 4 characters is only reset, not added.
- **MOD-5.1** Durations: 1 day, 7 days, permanent. An expired ban no longer restricts; lifting a ban makes the next play count. Plays during the ban are stored as `restricted` and never count, also after the ban ends. A backend result (BE-6) of a banned player returns `restricted: true`.
- **MOD-5.2** The completion of a banned player returns `restricted: true` (not `rejected`), `points: null` and no streaks, percentile, weekly rank or badges; public boards skip the player during the ban.
- **MOD-6.1** Reasons `nickname` (vulgárna prezývka), `cheating` (podvod), `other` (iné). A device sends at most 5 reports per Bratislava day (`429`); its own entry is `422`, an unknown entry `404`. Every listed board entry except the player's own carries an `entryId`.
- **MOD-6.2** The admin page *Moderation* lists open reports newest first, grouped by player, with the actions inline and "dismiss"; any action or dismissal resolves the player's open reports. The sidebar shows the count of open reports.
- **MOD-7.1** A counted play is suspicious when its score is beyond the game's p99.9 in its scoring direction (validated plays of the last 30 days, at least 100 of them), or when the game has `scoring.max` and the score is within 5 % of the range below it in less than `minSeconds` × 2. One flag per play.
- **MOD-8.1** More than 20 new nicknames (a device's first nickname) from one address in an hour are refused with `429`, and each refusal is logged (`nickname_flood`).
- **MOD-8.2** (1.23.1) The limit counts per tenant, and a sandbox tenant allows 200 (the hackathon office and the VPN reach it from one address). The refusal carries `code: 'flood'`; the shell says „Z tejto siete si teraz vybralo prezývku priveľa hráčov. Skús to o chvíľu.“ and `setNickname` rejects with `reason: 'flood'`, not the player's own daily limit.

### 5.28 Tournaments and seasons (TRN)

Lukáš, 13 Oct (D-62): campaigns like "Týždeň hier na Azete" get a tournament around an event board (LBD-2).

| ID | Requirement | Priority |
|---|---|---|
| TRN-1 | Editors (`product`, `admin`; in a sandbox tenant also team members over their own games, TRN-9) create tournaments on an admin page *Tournaments*: title, description, banner, games, window from–to in Bratislava time, metric and aggregation (an event board over the games, LBD-1), eligibility (signed-in only, or also nickname players), prizes per rank range, rules text, an optional season tag, and draft or published. A tenant may run several at once | Should |
| TRN-2 | Players see the tournament: the public page `/turnaj/<slug>` on the tenant host (banner, countdown, rules, prizes, live board with top N and "your position", the games with *Hrať*), a hero card on the landing page for each live tournament, "Turnaj: si 7." with a link on the end screen of a play that counted, and `game.tournaments.get()` in the SDK | Should |
| TRN-3 | At the end the board is frozen. Editors see the winners (nickname, player code, value, prize) and export them as CSV for the prize handling, and confirm the results; only then does the public page show the winners | Should |
| TRN-4 | Seasons: tournaments with the same season tag form a season; the season page `/sezona/<season>` sums the points over the season's tournament windows | Should |
| TRN-5 | The admin list shows the participation of each tournament (players and plays that count) | Should |
| TRN-6 | Tournament events `tournament_view`, `tournament_play`, `tournament_finish` in the event catalog (AZG-186) | Should |
| TRN-7 | Before confirming, the winners are checked against the moderation reports (AZG-201) | Should |

- **TRN-1.1** The window is entered in Bratislava time and stored as instants (DST included); `endsAt` after `startsAt` (`422`). A play counts when it started at or after the start and completed before the end; plays before, plays still running at the end, practice and rejected plays never count.
- **TRN-1.2** The slug is unique per tenant (`409`); another tenant may use the same slug. `score` needs exactly one game, `points` any number (1–50) of the tenant's games; a game of another tenant is `404`. Prize ranges (up to 20, ranks 1–100) must not overlap (`422`).
- **TRN-1.3** Eligibility `everyone` ranks signed-in players and players with a nickname (LBD-5); `signed_in` ranks signed-in players only.
- **TRN-1.4** A draft is hidden: its page is `404`, the SDK does not list it and the end screen does not show it. Published, the status follows the window: `scheduled`, `live`, `finished`.
- **TRN-1.5** Writes are for `product` and `admin` members and `landing:write` tokens (`403` for viewers, team members and game-limited tokens, agent tokens in production tenants) and audited. The banner goes through the THM-2.1 cover checks and is served from the games origin with the image-only CSP.
- **TRN-1.6** The admin form offers only the tenant's live games, plus the games a tournament already has (a draft or switched-off game cannot be played); the prize rows have column headers (from, to, prize).
- **TRN-2.1** The public page works without login. The live board lists only players who opted in (PRF-1) and shows the viewer's own place. A draft, an unknown slug or another tenant's tournament is `404`.
- **TRN-2.2** `game.tournaments.get()` lists the published tournaments of the game: scheduled, live and finished in the last 14 days. `me` is the player's place on the live board or, after the end, on the confirmed frozen board, `null` otherwise. Without tournaments it resolves with `[]` (SDK-CONTRACT, additive to protocol 1).
- **TRN-2.3** The end screen shows the tournament place only after a play that counted in a live tournament of that game (the one ending soonest when there are several); the link goes to the tournament page.
- **TRN-3.1** The first read after the end freezes the ranking down to `max(topN, last prize rank)`. Later plays and nickname or opt-in changes never move a rank, and a change of the ranking settings (games, window, metric, aggregation, tie-break, top N, eligibility) is `409`.
- **TRN-3.2** Winners carry the nickname, the player code (PRF-3, for Azet support), the value and the prize of the rank, never an e-mail or other contact data. The winners and the CSV are for `product` and `admin` (`403` otherwise); a CSV cell never starts a spreadsheet formula.
- **TRN-3.3** Confirming before the end is `409`. The finished page shows "results pending" until confirmed, then the frozen top N of the players who opted in (PRF-1).
- **TRN-3.4** The DAT-4 delete removes the player's frozen row; the other ranks stay as frozen.
- **TRN-4.1** The season board sums the points of all plays that counted in any started tournament window of the season (top 20 and your position); an unknown season is `404`.
- **TRN-5.1** Participation counts the plays that count in the window (TRN-1.1) and their distinct players.
- **TRN-6.1**, **TRN-7.1** Deferred until AZG-186 and AZG-201 are merged (D-62). Until then the confirm dialog asks the editor to check the moderation reports.

### 5.29 External games (EXT)

Lukáš, 14 Oct (AZG-273, D-64): the games pages also show games that live elsewhere — today the Puzzlr games on azet.sk/hry (Elektrikár, Sudoku, Maliar, Staviteľ) — so players see one Azet games offer while those games move over.

| ID | Requirement | Priority |
|---|---|---|
| EXT-1 | Editors (admin, product) add, edit, disable and delete external games of the tenant: name, slug, https URL, description, category, session length and source (Puzzlr or other); every change is audited | Should |
| EXT-2 | An external game has a cover with the THM-2.1 cover rules, stored on the games origin under `<tenant>/__external/<id>/` | Should |
| EXT-4 | In a sandbox tenant a `team` member (CMS session or personal token) lists, adds, edits, deletes and gives a cover to the external games of the own team (v1.38.0, D-104). A game a team member adds belongs to the team (`team`); editors see every external game, may name a team or none (`team` in the body), and their games without a team stay theirs. Another team's and the editors' external games are not listed and `404` for every write; naming another team, or none, is `403` (`path: team`). Placing a game on the landing and publishing stay with editors; a viewer, a team member without a team and every team member of a production tenant get `403`. The CMS shows External games to team members of sandbox tenants | Must |
| EXT-3 | The landing places external games by slug like games; on the public pages they are cards like the other games that open the game's URL; the CMS marks them with their source | Should |

- **EXT-1.1** A slug used by a game or another external game is `409`; the URL must be https; the category is a manifest category (`number` included).
- **EXT-1.2** An external game of one tenant is never listed, changed, placed or deleted in another (TEN-2.1).
- **EXT-4.1** A team member adds, edits, gives a cover to and deletes an external game; it belongs to the team and is audited. **EXT-4.2** Another team's and the editors' external games are not listed and `404` for every write. **EXT-4.3** Naming another team or none is `403` with `path: team`; an editor gives a game to a team, whose members then manage it. **EXT-4.4** Landing publish stays `403` for the team member; a viewer and a team member of a production tenant get `403`. **EXT-4.5** An external game of another tenant is never reached (TEN-2.1).
- **EXT-3.1** A disabled or deleted external game disappears from the public pages; a game with the same slug wins over an external one.

### 5.30 Self-service access and teams (MEM)

Lukáš, 16 Oct (D-75): many people of the company need the hackathon CMS, without an admin adding each one, and teams invite their own colleagues. Okta (AZG-3, AZG-14) replaces the access code later; the same auto-join then applies to Okta sign-ins.

| ID | Requirement | Priority |
|---|---|---|
| MEM-1 | A sandbox tenant lists e-mail domains (azet-hackathon: `ringier.sk`, `azet.sk`) and a role (viewer or team); a person of such a domain who signs in gets a user and a membership with that role and no team | Must |
| MEM-2 | A team member without a team chooses one before anything else: create a team, or join one with an invite link | Must |
| MEM-3 | Team members invite colleagues with an invite link of their team (valid 7 days); a new link makes the earlier ones stop working; members see the team and can leave it | Must |
| MEM-4 | Editors (product, admin) see every team, its members and its invite link | Should |
| MEM-5 | People sign in with their e-mail and their own password; the shared access code works only until they set one, and they must set one after signing in with it | Must |
| MEM-6 | Admins reset a member's password; the member then signs in with the access code once and sets a new one | Should |
| MEM-7 | (1.25.0) The audit log (page, menu and `GET /api/v1/audit`) is for editors (product, admin) and tenant-wide tokens; team members and viewers do not see it (Lukáš, 23 Oct) | Must |
| MEM-8 | (1.25.0) Every member writes a request in words in **Change proposals** (what they want changed, set up or made); team members and viewers see only their own requests; a product or admin person marks it done or rejects it, never the author (Lukáš, 23 Oct: „change proposals by mali mať možnosť napísať, čo chcú upraviť, nastaviť a spraviť“) | Must |

- **MEM-1.1** Auto-join is idempotent (one membership per tenant); an e-mail whose domain no tenant lists and that is not already a user cannot sign in. Audit `member.auto_join`.
- **MEM-1.2** Admins (`members:write`) set the domains and the role on the Members page or with `PUT /api/v1/settings` (`autoJoinDomains`, `autoJoinRole`: viewer or team only); invalid domains are `422`.
- **MEM-1.3** Production tenants never auto-join: setting domains there is `422`, and the sign-in lookup only reads sandbox tenants.
- **MEM-2.1** Team names are 2–40 characters (letters, digits, space, `-`, `_`, `.`), unique per tenant case-insensitively (also against teams that only exist on members or games). A team member without a team cannot register a game (`409`). Audit `team.create`.
- **MEM-3.1** „My team“ (`/admin/team`, `GET /api/v1/team`): the team, its members and its game count.
- **MEM-3.2** The invite link (`POST /api/v1/team/invite`) is signed (HMAC), names the tenant, the team and the link version, and expires after 7 days; `?reset=1` bumps the version (audit `team.invite_reset`).
- **MEM-3.3** Opening `/admin/join/<token>` signs in first and comes back; a team member joins (switching teams moves them; their games stay with the old team), an editor sees they have access already; an expired, replaced or forged link is a friendly error (`422` with `code` `expired`, `replaced` or `invalid`); a link of another tenant is `404` in the API. Audit `team.join`.
- **MEM-3.5** (1.24.0) Renaming (`PATCH /api/v1/team` `{ name }`, editors `?team=`; „My team“ → **Rename team**): the same name rules as MEM-2.2; the name moves on the members, the games (archived too) and the invite row in one transaction; invite links name their invite row, so links copied before the rename keep working; a name of another team (case-insensitive) is `409`; audit `team.rename`. Lukáš, 23 Oct: „potrebujeme userom možnosť meniť názov tímu“.
- **MEM-3.4** Leaving (`POST /api/v1/team/leave`) sets no team and sends the member back to MEM-2; audit `team.leave`.
- **MEM-3.6** (1.26.1) When the last member leaves a team that has no games (archived games do not count: they keep the team's name, and an editor who restores one sees it under that team), the team is removed: its invite row goes, so its name is free and it is no longer among the editors' teams; the same when a member switches teams with an invite or an editor moves or removes the last member; audit `team.delete`. A team with games stays without members (an editor invites someone to it). Creating a team whose name belongs to an empty team (no members, no games that are not archived; e.g. left behind before 1.26.1) creates it anew with a new link version, so earlier links of it stop working. Found when a hackathon developer left her team and could neither create it again nor be invited.
- **MEM-5.1** Passwords are hashed with scrypt (node:crypto, salted), never returned or logged; the access code is compared in constant time.
- **MEM-5.2** After signing in with the access code without a password, every admin page leads to „Your password“ until one is set (at least 10 characters, not the access code, typed twice); then the team step (MEM-2).
- **MEM-5.3** „Account and password“ in the user menu needs the current password; `POST /api/v1/account/password` is for sessions only (CSRF header), tokens get `403`. Audit `user.password_set`.
- **MEM-5.4** Failed sign-in attempts are limited to 10 per e-mail and address in 10 minutes; a successful sign-in starts the count again.
- **MEM-6.1** `POST /api/v1/members/{id}/password-reset` (`members:write`) clears the password of a member of the caller's tenant (another tenant's member is `404`); audit `user.password_reset`.

### 5.31 Realtime multiplayer (RTM)

Lukáš, 19 Oct (AZG-315, D-77, D-78): one realtime multiplayer service for every hackathon game, in our cluster, so teams do not build their own WebSocket backends. A game joins a room, sees who is in it, sends and receives messages and keeps a small shared room state through `game.realtime` in `@azet/games-sdk`. Lukáš approved the API shape, the manifest block and D-77/D-78 on 19 Oct ("Postav to najkvalitnejšie ako vieme"), with the quality bar below (RTM-1.4, RTM-3.5–3.6, RTM-4.5, RTM-6.4, RTM-7.7–7.8, RTM-9.3–9.4, RTM-12.2) as part of Done (SDK-CONTRACT "Realtime multiplayer"); service design in [ARCHITECTURE.md](architecture.md#11-realtime-service).

| ID | Requirement | Priority |
|---|---|---|
| RTM-1 | `game.realtime` in `@azet/games-sdk`: join a named room or a quick match, presence (members, join, leave, host), messages to the room or to one member, a shared room state, leave. Additive to protocol 1; a game that does not use it behaves exactly as before | Must |
| RTM-2 | The shell holds the session's one WebSocket to the realtime service and proxies every `game.realtime` call and event over postMessage (D-77). The games origin CSP does not change; no token or service URL reaches the game | Must |
| RTM-3 | The shell gets a short-lived realtime ticket from `POST /api/v1/play/session/realtime` with the play token. Tenant, game, version, session and player come from the signed ticket, never from the client; rooms are per tenant and game | Must |
| RTM-4 | Rooms: a room id chosen by the game, or a quick match that pairs N players of the same game version; a room size limit from the manifest; the first member is the host and the host passes on when it leaves; presence join and leave | Must |
| RTM-5 | Messages are relayed by the server, to every other member or to one member, in the order the server received them, with the sender's member id | Must |
| RTM-6 | Room state: one JSON document per room changed by JSON Merge Patches, applied in arrival order (last writer wins per key), each applied patch increments the room's `version`; an optional `ifVersion` makes a write conditional; the manifest can limit writes to the host | Must |
| RTM-7 | Limits: messages and bytes per second per connection and per room, message, patch and state size, room size, rooms per game, connections per service; idle and heartbeat timeouts; a short reconnect grace; behaviour on a service restart | Must |
| RTM-8 | A game opts in with a `realtime:` block in `azet-game.yaml` (`maxPlayers`, `quickMatch`, `stateWrites`); `azg validate` checks it; without it every `game.realtime` call rejects with `realtime_disabled` | Must |
| RTM-9 | The service is a small Node WebSocket server in this repo (`apps/realtime`), deployed by the same chart as a second Deployment with its own host (`azet-games-realtime.rin.rinapps.dev`), one replica (documented limit), `/health` with the build SHA, enabled for sandbox tenants only | Must |
| RTM-10 | `azg dev` runs the same room engine in memory, so several tabs of the dev shell play together; the `MemoryAdapter` (builder preview) answers with a one-tab room; `azg contract` keeps passing for every game and template | Must |
| RTM-11 | The shell records `room_join` and `room_leave` with counts and no personal data (EVENTS.md) | Must |
| RTM-12 | SDK-CONTRACT (additive section), GAME-SERVICES "Multiplayer", MANIFEST, HACKATHON, ARCHITECTURE, DEPLOY and EVENTS document it; a two-player reference game `games/tap-race` is playable by two browsers on the hackathon host; the cluster smoke plays it with two browser contexts | Must |

- **RTM-1.1** `game.realtime.join(roomId)` resolves with a `Room` once the member is in the room, with the current members, host, state and version; `quickMatch({ players })` resolves when the server has formed a room of `players` members, rejects with `timeout` after `timeoutSeconds` (default 30, at most 120) and with `cancelled` when its `signal` aborts.
- **RTM-1.2** A session is in at most one room at a time; `join` or `quickMatch` while in a room rejects with `conflict`. After `leave()` (or a `close` event) the session may join another room.
- **RTM-1.3** Every call before `init()` rejects with `not_initialized`; on a platform without realtime (an older shell or CMS) with `realtime_disabled`.
- **RTM-1.4** Every rejection is a `GameError` with one of the documented codes (typed in the SDK). After `leave()` or `close` the room holds no listener and the SDK no subscription for it (a test joins and leaves 100 times and counts listeners).
- **RTM-2.1** The games origin `connect-src` is unchanged by the feature (`gameOriginHeaders` test); `init`, every `realtime` response and every realtime event carry no token, ticket or service URL.
- **RTM-2.2** The shell accepts `realtime` messages only with the session nonce, like every other message (SDK-CONTRACT §4), and closes the WebSocket when the page unloads, the game crashes or the shell shows its error screen.
- **RTM-3.1** `POST /play/session/realtime` returns `{ url, ticket, expiresAt }`; the ticket is an ES256 JWT signed with the player-token key, `aud` `azg-realtime`, valid 60 s and accepted once. Without a valid play token `401`.
- **RTM-3.2** The endpoint answers `403` `realtime_disabled` for a game version without a `realtime:` block, a production tenant, or a service without a configured URL, and `403` `forbidden` for a banned player (MOD); the service refuses a ticket with another `aud`, an expired or reused ticket and a player token of a game backend (`4001 unauthorized`).
- **RTM-3.3** Room ids are namespaced by tenant and game on the server: the same id in another game or tenant is another room (TEN-2.1); a member list never contains a member of another tenant or game.
- **RTM-3.4** No frame the service sends to a client contains the player key, the session id or the ticket. A member is identified by an opaque member id, stable for the session in that room; `nickname` is the player's nickname for signed-in and nickname players (MOD-hidden or reset nicknames: `null`), `null` for anonymous players. Since v1.21.0 a room needs a nickname (NICK-1), and hiding the nickname from boards (PRF-1) does not hide it from the members of a room.
- **RTM-3.5** Ticket checks have one test each: a reused ticket, a ticket older than 60 s, another `aud`, a game backend's player token and a forged signature are refused (`4001`); after the CMS rotates its signing key, a ticket with the new key is accepted without restarting the service and one with a removed key is refused.
- **RTM-3.6** No secret on the wire: an integration test records every frame the service and the shell send to clients during a full play (join, messages, state, reconnect, leave) and asserts that none contains the player key, the session id or a ticket. Cross-tenant and cross-game tests: the same room id in another tenant or game never shares members, messages or state. The wire protocol is fuzzed (malformed JSON, unknown ops, wrong types, oversized and binary frames): the process never crashes, the offending connection gets `invalid_payload` or is closed, every other connection is unaffected. The Critic does a security review of the service, the ticket endpoint and the shell bridge against ARCHITECTURE §9.
- **RTM-4.1** A room id is 1–64 characters `A–Z a–z 0–9 _ -`; an invalid one rejects with `invalid_payload`. Joining a full room rejects with `room_full`.
- **RTM-4.2** Quick match pairs only sessions of the same tenant, game and version that asked for the same `players`; `players` is 2…`maxPlayers` (default the manifest's `quickMatch`).
- **RTM-4.3** The host is the earliest joined member; when the host leaves, the next earliest member becomes host and every member gets a `host` event. A room is deleted 60 s after its last member left; its state goes with it.
- **RTM-4.4** Every member gets `join` and `leave` events for the other members; `leave` carries `reason` `left`, `disconnected` (reconnect grace expired) or `idle`.
- **RTM-4.5** The room engine (`packages/realtime`) has no I/O and is tested exhaustively on its own: join, leave and host hand-over; quick match pairing with timeouts, `cancel`, odd numbers of waiting sessions and sessions asking for different `players`; every limit of RTM-7 at and just over its value; idle close; a reconnect within 15 s keeps the member id; a second connection of the same session closes the first with `replaced`.
- **RTM-5.1** `send(data)` delivers to every other member, `send(data, { to })` to one member; the sender never gets its own message back; an unknown `to` is dropped with a dev warning. Two clients in one room receive each other's messages in send order (integration test).
- **RTM-5.2** A message is any JSON value ≤ 4 KB serialized; a larger one rejects with `too_large` and is not sent.
- **RTM-6.1** `setState(patch)` applies an RFC 7386 JSON Merge Patch (`null` deletes a key) and resolves with the new `version`; every member, the writer included, gets a `state` event with the patch, the full new version number and the writer's member id. Members that join later get the current state and version.
- **RTM-6.2** `setState(patch, { ifVersion })` applies only when the room's version equals `ifVersion`, otherwise rejects with `conflict` and the current version.
- **RTM-6.3** A patch is ≤ 4 KB, the state ≤ 16 KB after the patch (`too_large`, nothing changes). With `stateWrites: host` a write from a non-host member rejects with `forbidden`.
- **RTM-6.4** Property-style tests: for random sequences of joins, leaves, merge patches and conditional writes from several members, every member's state after the last event equals the server's state and version.
- **RTM-7.1** Per connection at most 20 messages and state writes a second (burst 40) and 32 KB a second; per room at most 200 a second; beyond that the service drops the frame and answers `rate_limited` to the sender, and closes a connection that stays above the limit for 10 s.
- **RTM-7.2** Room size: `maxPlayers` from the manifest, 2–50, default 8. At most 200 rooms per game and 2 000 connections per service (`room_full` / `unavailable`).
- **RTM-7.3** The shell sends a heartbeat every 20 s; the service closes a connection without any frame for 60 s. A room without any message or state write for 30 minutes is closed for every member with `close` reason `idle`.
- **RTM-7.4** After a dropped connection the shell reconnects with a new ticket; within 15 s the member returns to the room with the same member id and host role and gets the current state, the game sees `reconnecting` and `reconnected` events; after 15 s the others get `leave` (`disconnected`) and the game gets `close` (`disconnected`).
- **RTM-7.5** On a service restart all rooms and their state are lost: members get `close` with reason `restart` (graceful shutdown) or `disconnected` (crash). Documented as the one-replica limit.
- **RTM-7.6** Load sanity: 50 clients in one room, each sending 4 messages a second for 60 s, get every message within the limits and a p95 relay time under 100 ms in the cluster; the service stays under its memory limit.
- **RTM-7.7** The load test (RTM-7.6) also holds 2 000 connections spread over rooms on one replica and reports the p95 relay time; it runs in CI or as a documented script (DEPLOY.md) whose last run's numbers are recorded.
- **RTM-7.8** Killing or restarting the service during a play: the shells show `reconnecting`, then the games get `close` (`restart` or `disconnected`) and end cleanly (no hung screen, „Hrať znova“ works).
- **RTM-7.9** Per client IP (the hop the ingress adds to `X-Forwarded-For`) at most 10 sockets still authenticating and 200 open; above that the upgrade is refused with `429` (`Retry-After: 5`), the shell reports `unavailable`, and the refusal is counted in `/metrics` (`azg_realtime_upgrades_rejected_total{reason="per_ip"}`). An upgrade without the header behind the ingress is not capped and is counted (`azg_realtime_upgrades_without_client_ip_total`). `REALTIME_MAX_AUTH_PENDING_PER_IP` and `REALTIME_MAX_CONNECTIONS_PER_IP` override the caps (`0` = off). Approved by Lukáš on 20 Oct.
- **RTM-8.1** `realtime.maxPlayers` 2–50 (default 8), `realtime.quickMatch` 2…`maxPlayers` (default 2), `realtime.stateWrites` `any` (default) or `host`; anything else fails `azg validate`. The CMS reads them from the played version's manifest, never from the client.
- **RTM-9.1** The service holds no secret: it verifies tickets with the CMS public JWKS. Its Deployment uses the CMS image (another command), so one `image.tag` deploys both; its `/health` returns the same `sha` as the CMS `/api/health`.
- **RTM-9.2** Realtime is enabled for sandbox tenants (`azet-hackathon`); production tenants (`azet`, `koktejl`) answer `realtime_disabled` until Lukáš enables them.
- **RTM-9.3** Before stage 2 builds on it, a `wss://` echo through the real F5 ingress on the cluster measures that the upgrade works and how long an idle connection stays open; the numbers go to DEPLOY.md and answer Q-13. If F5 blocks upgrades, it is raised to Martin at once as a class-C decision.
- **RTM-9.4** Observability: structured JSON logs without personal data (no nickname, player key, session id or message content), `/health` (liveness, with `sha`) and `/ready` (readiness: JWKS loaded, accepting connections), and a Prometheus metrics endpoint for Grafana with rooms, connections, frames in and out, and dropped frames by reason.
- **RTM-10.1** `azg dev` serves the realtime endpoint on the dev shell's origin; two tabs of the dev shell join the same room, see each other's presence, messages and state (Playwright e2e with two browser contexts).
- **RTM-10.2** The `MemoryAdapter` room has the player as the only member and host, applies state writes and never opens a network connection; quick match there rejects with `timeout` at once (one tab never forms a match), so the builder preview never hangs.
- **RTM-11.1** `room_join` (`mode` `named` or `quick`, `players` after the join, `maxPlayers`) and `room_leave` (`reason`, `players` left, `durationMs`) carry no room id, member id, nickname or message content.
- **RTM-12.1** `games/tap-race`: quick match of 2, the host starts a countdown through the room state, each tap is a message, the first to 30 taps wins; both players `complete()` with their own taps as score; playable by two browsers on azet-games-hackathon.

- **RTM-12.2** Done for AZG-315 = deployed in our cluster, `games/tap-race` playable by two real browsers on azet-games-hackathon both by quick match and by a room id, the cluster smoke plays it with two browser contexts, Release Manager `DEPLOY_VERIFIED: PASS`; the SDK stays additive (contract test and SDK size test green) and every RTM entry is removed from `docs/ac-deferred.json`.

### 5.32 Multiplayer rooms that end (RTM-13 – RTM-17)

Lukáš, 21 Oct (D-80), after the first developer test: a host waiting for an invited friend waits for ever, one player can open rooms until the game has none left, the CMS cannot see the rooms, and nothing says that a play keeps only its first result. Additive to §5.31; games that use the 20 Oct API keep working.

| ID | Requirement | Priority |
|---|---|---|
| RTM-13 | A room is **waiting** until it first has two members and **playing** from then on. A waiting room expires after `realtime.waitSeconds` (manifest, 10–600, default 120): its members get `close` with reason `expired`. `game.realtime.create()` opens a room with a server-made 6-character code to share (no collisions, no guessing); `join(code, { create: false })` joins only an existing room and rejects with `not_found` otherwise. Joining a playing room that has been full and lost a member is allowed (rejoin of a friend) | Must |
| RTM-14 | Per player (the player key of the ticket, across sessions and tabs) at most 3 rooms and quick-match waits at once and at most 20 new rooms in 10 minutes; beyond that `join`, `create` and `quickMatch` reject with `limit_reached`. Quick match: leaving the page or `cancel` removes the wait at once; a second `quickMatch` of the same player replaces the first wait | Must |
| RTM-15 | The CMS shows the game's rooms: **Games → game → Multiplayer** lists waiting and playing rooms (code, players, age, started, last activity) and the last 24 h (rooms created, started, expired, ended by reason, median length), refreshed every 10 s; an editor can close one room or every room of the game (reason `closed`, audit log). The service answers only a CMS-signed admin ticket (`aud: azg-realtime-admin`, 60 s) | Must |
| RTM-16 | One play keeps one result: the first `complete()` (or the backend's `submitResult`) of a session counts. The SDK does not send a second `complete()` of a play and logs a console warning (dev shell and builder); the server refuses one (`409`); a repeated `submitResult` with the same result is idempotent (`duplicate: true`), a different one `409`. The dev shell logs a console warning on a second `complete()` in one session, and SDK-CONTRACT, GAME-SERVICES and HACKATHON say how a multi-round or multiplayer game reports (once, at the end; each player for themselves; with a referee the backend reports) | Must |
| RTM-17 | Reference games with e2e like `games/tap-race`: `games/piskvorky` (tic-tac-toe 3×3 by invite code or quick match, with a referee, §5.33) and the turn-based pattern for asynchronous play (§5.34). The Hackathon guide gets a "Multiplayer patterns" section: invite by code, quick match and queue, lobby, turns, a player who drops out (forfeit after the grace), host hand-over, rematch | Must |

- **RTM-13.1** Engine tests: a waiting room expires at `waitSeconds` and not before; a second member stops the timer for good (the room stays playing even if members leave and come back); `create()` codes are 6 characters of `A–Z 2–9` without `0 O 1 I`, unique among live rooms of the game; `join(code, { create: false })` on an unknown or expired code rejects with `not_found`.
- **RTM-14.1** Engine tests at and just over each limit: the 4th concurrent room or wait of one player and the 21st creation in 10 minutes reject with `limit_reached`; rooms of other players are unaffected; a second `quickMatch` of the same player cancels the first wait (the first promise rejects with `cancelled`).
- **RTM-15.1** `GET /admin/rooms?tenant&game` of the service (admin ticket) returns rooms without member ids, nicknames, session ids or room state; `POST /admin/rooms/close` closes one or all. A play ticket or a ticket of another tenant or game is refused (`401`). Prometheus gets counters of rooms created, started, expired and closed by reason.
- **RTM-16.1** Integration test: two `complete()` calls in one session store one result, the first; the second is refused with `409`.

### 5.33 Room referee: authoritative multiplayer (REF)

Lukáš, 21 Oct (D-81): the result of a multiplayer game must not be up to the players' browsers. A game can name its backend the **referee** of its rooms: the backend receives every member's moves, decides, sends the room what happened and reports each player's result itself.

| ID | Requirement | Priority |
|---|---|---|
| REF-1 | `realtime.authority: referee` in the manifest (default `members`, the 20 Oct behaviour) makes the game's backend the referee of every room of the game. `azg validate` requires a `backend:` block for it | Must |
| REF-2 | The backend gets a referee ticket from `POST /api/v1/realtime/referee` with its game token (60 s, single use, `aud: azg-realtime`, role `referee`, tenant and game from the token) and keeps one WebSocket to the service; `@azet/games-server` `createReferee({ onJoin, onLeave, onMessage, onClose })` and the Python template's `azg_referee.py` hold the connection, reconnect with a new ticket and expose `send(room, data, { to })`, `setState(room, patch)`, `end(room, { results })` and `kick(room, member)` | Must |
| REF-3 | In a referee game a member's `send` goes only to the referee (never to the other members), a member's `setState` rejects with `forbidden`, and only the referee writes the state and messages the members (`from: "referee"`). The referee gets `join`, `leave` (with reason), `message` and room `close` events; a member is given to the referee with its member id, its play session, player key, nickname and `loggedIn` (server to server only, never to another member) | Must |
| REF-4 | Without a connected referee, `join`, `create` and `quickMatch` of a referee game reject with `unavailable`; when the referee disconnects, its rooms keep their state for 15 s and then close with reason `referee_lost`; a newer referee connection of the same game replaces the older one and takes over its rooms | Must |
| REF-5 | Results: `end(room, { results: { [memberId]: { score, success?, stats? } } })` submits each member's result for its play session through `POST /api/v1/results` (BE-6: same checks, one result per session) and closes the room with reason `ended`; the shell's own `complete()` then only drives the end screen | Must |
| REF-6 | `azg dev --backend` runs the referee against the dev shell's room engine, with no CMS; `games/piskvorky` plays end to end in two browser contexts with the referee (e2e), and in the cluster once game backends run there (AZG-321) | Must |

- **REF-2.1** The referee ticket endpoint refuses a personal or CMS token (`403`), a game token of another game or a game without `authority: referee` in its active version (`403 realtime_disabled`), and is rate-limited per game (10 a minute).
- **REF-3.1** Security tests: a member cannot pose as the referee (a `from` or op of the referee in a client frame is `invalid_payload`), cannot read the referee's view of other members, and a referee ticket of game A is refused for rooms of game B; the no-secret recording test (RTM-3.6) also covers the referee path: no session id or player key in any frame to a member.

### 5.34 Asynchronous turn-based matches (MAT)

Lukáš, 21 Oct (D-82): games like piškvorky or chess are played over hours or days: invite a friend, play a move, come back tomorrow, several matches at once. A realtime room lives in memory for one sitting; a match lives in the CMS database.

| ID | Requirement | Priority |
|---|---|---|
| MAT-1 | `game.matches` in the SDK: `create({ players })` (returns the match with a 6-character invite code), `join(code)`, `quick({ players })` (pairs with a waiting match of the same game and version, or opens one), `list()` (the player's open and last 20 finished matches of this game), `get(id)`, `move(id, { patch, ifVersion })`, `resign(id)`, `onChange(id, listener)`. A `matches:` block in the manifest opts in (`players` 2–8, `turnSeconds`, `inviteSeconds`, `authority`) | Must |
| MAT-2 | Matches are stored per tenant (RLS) with members in seat order, the state (JSON, ≤ 16 KB, merge patches as RTM-6), `version`, `turn` (seat), status `waiting` → `active` → `finished` or `expired`, and the result. They survive restarts and deploys | Must |
| MAT-3 | Turns: only the member on turn may `move` (`not_your_turn`); a move passes the turn to the next seat unless the patch is from the referee or says `keepTurn`. A member who does not move within `turnSeconds` (60 s – 7 days, default 1 day) loses by forfeit; a waiting match expires after `inviteSeconds` (default 1 day); `resign` ends the match as a loss for the resigning member | Must |
| MAT-4 | `matches.authority: backend` lets only the game backend move and finish (`@azet/games-server` `matches.move` / `matches.finish`, game token): players send their move to the backend (`game.api.fetch`), which validates it. Default `members`: the client moves and the last move may finish the match (documented as cheatable, fine for casual games) | Must |
| MAT-5 | Finishing a match records one result per member like a play (points, leaderboards, streak, daily challenge, badges, MOT/LBD rules; guests count once nicknamed); a forfeit or resignation counts as a loss with score 0 for that member and a win for the others | Must |
| MAT-6 | Limits: 20 open matches per player and game, 50 new matches per player and day, 30 moves a minute per player (`limit_reached`). The shell tells a signed-in player "Si na ťahu" on the landing (count, link to the game); `onChange` polls every 5 s while the game is open and pushes immediately when both players are online through the realtime service | Should |
| MAT-7 | The CMS lists a game's matches (open, finished, expired; counts and median length) on **Games → game → Multiplayer**, without states or player keys | Should |

- **MAT-1.1** API and SDK tests for each call, the state machine (waiting → active when the last seat is taken; finished; expired) and every error (`not_found`, `full`, `not_your_turn`, `conflict` with `ifVersion`, `forbidden` for non-members and for client moves with `authority: backend`, `limit_reached`).
- **MAT-3.1** Turn and invite timeouts run in the CMS (a CronJob or the next read, whichever comes first) and are tested with a fake clock; a forfeit is visible to both members on their next `get`/`onChange`.
- **MAT-5.1** Integration test: a finished 2-player match gives each member exactly one result, the winner's points and the loser's played game, and a second `finish` is refused.

### 5.35 Bots (BOT)

Lukáš, 21 Oct (D-84): a player who has nobody to play with plays a bot; the bot must be fair (the server plays it) and must not farm points.

| ID | Requirement | Priority |
|---|---|---|
| BOT-1 | `realtime.bots` in the manifest: `levels` (1–5 ids `^[a-z][a-z0-9-]{0,19}$`, default `[normal]`) and optional `after` (5–120 s). Bots need `realtime.authority: referee`: the referee plays them; `azg validate` refuses bots without it | Must |
| BOT-2 | `game.realtime.playBot({ level })` opens a playing room of the player and `quickMatch − 1` bots of that level; bots are members `{ id: 'bot-1', nickname: 'Bot', host: false, bot: true }` and `room.bots` is `{ level, ids }`. A game without bots gets `forbidden`, an unknown level `invalid_payload`, no connected referee `unavailable`; a bot room counts for the player limits (RTM-14) and shows in the CMS as mode `bot` | Must |
| BOT-3 | With `after`, a quick match that waited that long gets bots for the free seats of everyone waiting (the room's `bots` says so); a real player who comes earlier still matches; without `after` nothing changes | Must |
| BOT-4 | The referee gets the room with `bots` (`r_room`), plays them by writing the state itself; `@azet/games-server` `RefereeRoom.bots` and `azg_referee.py` `room.bots` expose them | Must |
| BOT-5 | A game against bots is practice: `end()` of our referee SDKs reports the players with `practice: true` and skips the bots; `POST /results` with `practice: true` stores the play as practice (no points, boards, streaks, badges or currency) | Must |

- **BOT-2.1** Engine tests for each error and for the members and `bots` of the snapshot; shell test through `playBot`; `azg dev` test with a local referee (practice result, no bot result).
- **BOT-4.1** `games/piskvorky` has an easy and a hard bot; the hard bot never loses (an exhaustive test over every line of play), and the e2e plays a whole game against the easy bot.

### 5.36 One socket per session, presence and nickname (RTM-18, PRS, NICK)

Roman (developer), 21 Oct: every quick match opened a new connection; the socket should stay for the whole session, like on Nakama or PlayFab (D-86).

| ID | Requirement | Priority |
|---|---|---|
| RTM-18 | The shell opens one WebSocket per game session once the game is ready, for every game of a tenant with realtime (`features.realtime` of the session), and keeps it between rooms (leave, cancel, timeout, a closed room); it closes after 5 minutes without a room and on unload. `game.realtime.connect()` connects ahead of the first room. A game without a `realtime:` block gets a presence-only ticket (`rooms: false`; `join`/`create`/`quickMatch`/`playBot` reject with `realtime_disabled`). The service allows 20 000 sockets and 500 per client IP | Must |
| PRS-1 | Players online per game: the answer to `auth` carries `online`, and every player of a game hears the new number when it changed (at most every 5 s); `game.realtime.online` and `game.realtime.onPresence(fn)`. The frame carries a number only | Must |
| PRS-2 | Every member carries `profile`, signed by the CMS in the ticket: `{ level, gameLevel: { level, title } \| null, week, rank }` (rank only for a player listed on boards, PRF-1); the referee sees the same; a moderator-hidden player has none, bots have none. The service keeps only these fields | Must |
| NICK-1 | A room needs a nickname: without one `join`, `create`, `quickMatch` and `playBot` reject with `nickname_required`; the shell then asks the player over the game (dialog „Ako ťa majú volať?“), saves it, connects again with a new ticket and retries once; a cancel, or no answer within 2 minutes (the dialog closes itself), rejects to the game. The game's room call waits for the dialog: room calls time out after 150 s, not after the 10 s request timeout. A nickname saved on the end screen or by `player.setNickname` reaches the next ticket | Must |

- **RTM-18.1** Shell test: three rooms, a cancelled quick match and a room the server closed use one socket; the socket closes after the idle time. Engine and service: 20 000 / 500 caps; presence-only sessions get `realtime_disabled` for rooms.
- **NICK-1.1** Shell test: without a nickname the dialog handler is asked, the retry joins with the new name; a cancel and a shell without the dialog reject `nickname_required`; a player who answers after 30 s still gets the room (1.22.1).

### 5.37 Levels and referee-only results (PLV, PRG, REF-7)

Lukáš, 21 Oct (D-85): „level podľa celkových bodov“, and „každá hra môže mať svoje levely, body a mechaniky“.

| ID | Requirement | Priority |
|---|---|---|
| PLV-1 | The platform level of a player in a tenant from lifetime points of counted plays: level n starts at 50·n·(n−1) points (1 at 0, 2 at 100, 3 at 300, 4 at 600, 5 at 1 000), at most 99. `game.player.get().level` is `{ level, points, from, next }`; the same function is exported by the SDK (`platformLevel`) and used by the CMS | Must |
| PRG-1 | `progression:` in the manifest: `source` (`points` of this game, default; `plays` counted plays; `metric:<id>` sum of a declared metric), `levels` (2–100 starts, the first 0, strictly ascending) and optional `titles` (one per level, ≤ 24 characters, Slovak). The CMS computes the game level from counted plays of the active version's `progression`; `game.player.get().gameLevel` is `{ level, title, value, from, next }` or null | Must |
| REF-7 | In a version with `realtime.authority: referee` only the backend's result counts: the shell's `complete()` before it is stored without points, streaks, challenge, badges or currency and answers `refereePending: true` (end screen: „Výsledok potvrdzuje server hry“); the referee's result then replaces it and counts. A referee game calls `complete()` after the room closed with `ended` | Must |

- **PLV-1.1** Unit tests of every level boundary up to 99; integration test of `player.get()` before and after a counted play.
- **REF-7.1** Integration test: a client `complete({ score: 900 })` earns nothing, the referee's `{ score: 200 }` then counts.

### 5.38 Invite links, React hooks, error catalogue (INV, HOOK, HLP-5)

Lukáš, 21 Oct: „researchuj tie platformy a kľudne dostavaj … aby vedeli, keď si načítajú CLI, všetko používať“. From the research (D-87): CrazyGames, Poki and Discord give games invite links that open into the room; Playroom ships React hooks; Rune and Colyseus document every error with what to do.

| ID | Requirement | Priority |
|---|---|---|
| INV-1 | `game.invite.link({ room?, params? })` returns `{ url }`: the game page with `azg_invite=<base64url of { r, p }>`; `room` is a room id (RTM-4.1), `params` at most 10 keys `^[a-z][a-zA-Z0-9_]{0,31}$` of booleans, finite numbers or strings ≤ 64 characters, ≤ 512 bytes as JSON. The page opened from it passes `ctx.invite` `{ room, params }` to the game once (a replay starts without it) and removes it from the address bar; a malformed or empty invite is `null`. Events `invite_link` and `invite_open` carry only whether a room was in it. Outside a game page (builder) `unavailable` | Must |
| HOOK-1 | `@azet/games-sdk/react` (React ≥ 18 as an optional peer dependency): `useRoom(room)` (members, me, host, state, version, `closed`, `reconnecting`; re-renders on every change, no listener left after unmount), `useOnline()` (PRS-1) and `usePlayer()` (`player.get()` with `reload`); one `game` shared with the main entry | Must |
| HLP-5 | SDK-CONTRACT §7 has an error catalogue: for every `GameError` code when it happens, what the game does and the Slovak text for the player | Should |

- **INV-1.1** Unit tests of encode/decode and every refused request; the piškvorky e2e copies a link and opens a second browser straight at the table.
- **HOOK-1.1** Hook tests with React DOM: re-render on join, state and close, zero listeners after unmount, the presence count.

### 5.39 CMS members link their Azet account (LNK)

Lukáš, 21 Oct: „aby sa tí, čo sú v CMS, vedeli rovnako prihlásiť aj tým Azet OAuth, ak budú hrať hry, aby to mali rovnaké … daj do doku aj jasne“. The CMS sign-in stays a company sign-in (password, Okta later, D-75): an Azet account is a consumer account anyone can create, without company MFA or offboarding, and Azet OAuth returns no e-mail to match a member by. So a member **links** their Azet account once instead (D-88).

| ID | Requirement | Priority |
|---|---|---|
| LNK-1 | A signed-in CMS person (a session, never a token) links their own Azet account: **Account and password → Your Azet account → Link Azet account**. The CMS makes a signed link request (10 minutes, one tenant, a nonce stored on the user, the newest request only) and opens `/auth/link?k=…` on the tenant's public host; that starts the normal Azet login (the registered `/auth/callback`, D-56) with the request in the signed login state. The callback only **holds** the player key (the HMAC of `idUser`, never the Azet ID) on the user (one key per request: its first Azet login; the same request opened again is `expired`), signs the person in as a player on that host and sends a signed proof (5 minutes, bound to a hash of the held key) back to the CMS account page in the same browser; the page confirms it with the person's own CMS session (`POST /api/v1/account/azet/confirm`), and only then is the account linked. Outcomes: `linked`, `expired` (an old, used, tampered or foreign request or proof), `taken` (the Azet account is linked to another person), `mismatch` (the proof belongs to another CMS person: a link request sent to someone else links nothing). Unlink any time. Audited (`user.azet_link_hold`, `user.azet_link`, `user.azet_unlink`); two people confirming the same Azet account at once end as `taken` | Must |
| LNK-2 | A player whose key a member of **this** tenant linked is a member's player: the admin's Players list and detail mark them **Team** (the member's name on hover, `member` in `GET /players`), and tournament results (`GET /tournaments/{id}/winners`, CSV) keep their rank but give them no prize; the prize ranks count only the other players (a member 1st: the player 2nd gets the 1st prize). Who is a member is frozen with the board when the tournament ends, so a later link or unlink never moves a prize. Public boards and pages do not change | Must |

- **LNK-1.1** Route test with a mock Azet OAuth server: request → `/auth/link` → login → callback → linked, the player session set, only the player key stored, audited.
- **LNK-1.2** A request finished as the member and then opened by a player holds only the member's key, and the kept proof links the member's own account. Single use: an older request after a newer one, a used one, a tampered one, one of another tenant and a reused or forged proof end as `expired`; a request finished by another person's Azet login and confirmed by another session is `mismatch` and links nothing.
- **LNK-1.3** The same Azet account for a second person is `taken`; again for the same person is fine.
- **LNK-1.4** Unlink; tokens get `403`; a session write without the CSRF header is `403`; without `AZET_OAUTH_*` the status says `available: false` and the request is `409`.
- **LNK-2.1** Players search marks the member in their tenant only; tournament winners skip the member for prizes (rank kept, CSV column `member`); a board frozen before the link, and an unlink after the freeze, change nothing.

### 5.40 Sign in to the games with the CMS account (CML)

Lukáš, 27 Oct: „tu by mi malo fungovať rovnaké prihlásenie ako do CMS, ale nejde mi“. LNK (§5.39) links an Azet account, but on dev the Azet login is rin-oauth, which knows only test accounts, so nobody from the CMS has an Azet account to link there. On **sandbox** tenants (the hackathon) people sign in to the games with the CMS sign-in they already have; production tenants keep Azet ID only (D-91).

| ID | Requirement | Priority |
|---|---|---|
| CML-1 | On a sandbox tenant with Azet login configured, `GET /auth/cms?return=<path>` on the tenant host keeps a random state in a signed cookie (10 minutes, `__Host-` on https) and sends the browser to the CMS page `/admin/player-login?tenant&state`. A CMS person signed in there who is a member of that tenant goes back to `/auth/cms-callback` with a signed ticket for that state (2 minutes) that carries a nonce stored on the person (the newest ticket only); without a CMS session they sign in first, and someone who must set a password first sets it, and both come back. The callback uses the nonce up on its first try, whatever the outcome, so a ticket works once; it signs the player in (`azg_player`, D-56) only when the ticket is for this tenant, for the state of this browser's cookie (cleared), not expired, and the person is still a member. Production tenants: `404` | Must |
| CML-2 | The player is the person's own: the linked Azet account's player key when there is one (LNK), else a CMS player key (the Azet HMAC over `cms-member:<user id>`, never equal to an Azet key) stored on the user on first use. Either way the admin marks the player **Team** and tournament prizes skip them (LNK-2). The nickname is the first name when it passes the nickname rules (MOT-6), else `Hráč`; public boards still need the player's opt-in (PRF-1.1). Every sign-in is audited (`user.cms_player_login`) | Must |
| CML-3 | On a sandbox tenant `/auth/login` shows a choice: „Prihlásiť sa cez CMS účet“ (CML-1) and „Prihlásiť sa testovacím Azet účtom“ (`/auth/login?via=azet`, AUTH-1). Every login entry point keeps linking `/auth/login`, so the shell and the SDK do not change. Production tenants go straight to Azet | Must |

- **CML-1.1** Route test: `/auth/cms` → CMS page with the member's session → ticket → callback → `303` to the return path with the player session; the state cookie is cleared.
- **CML-1.2** Without a CMS session the CMS page sends to `/admin/login?next=/admin/player-login?…`; a person who must set a password first goes to `/admin/account/password?next=/admin/player-login?…`, which continues there after the password.
- **CML-1.3** A person who is no member of the tenant (or of none) gets `403`; a production tenant: `/auth/cms` is `404`, the CMS page `403`, a ticket minted for it signs nobody in; without `AZET_OAUTH_*` every CML route is `404`; a malformed state is `404`.
- **CML-1.4** A ticket without this browser's state cookie, with another login's state, tampered, for another tenant, older than 2 minutes or with a forged nonce signs nobody in (`400`). A ticket tried once in another browser never works afterwards; after a successful callback the same ticket and cookie again are `400`; a newer ticket makes an older one `400`.
- **CML-1.5** A membership that ends between the ticket and the callback signs nobody in.
- **CML-1.6** A return path to another host (`//host`, a URL, a backslash) ends on the tenant's landing, also on the choice page.
- **CML-2.1** The player key is the CMS player key, stored on the user, the nickname the first name; the admin's member lookup (LNK-2) finds it; the sign-in is audited.
- **CML-2.2** With a linked Azet account the player is that account (no CMS key stored); after an unlink the CMS key, the same on every later sign-in.
- **CML-3.1** A sandbox tenant's `/auth/login` shows both choices with the return path; `?via=azet` and a production tenant redirect to Azet.

### 5.41 Hub games: many mini games in one game (HUB, SNS)

Lukáš, 27 Oct, on the Brloh concept (a room in a panel block where every object is a mini game, 31 mini games, one wallet): „prejdi si, aj riziká … či to vieme na našom CMS postaviť“, then „vsetko priprav, kvalitne, a vsetko zapracuj rovno“. One play keeps one result and ends on the end screen (RTM-16), so a hub with a round every minute showed the full end screen after each round, and „Hrať znova“ was the only way back into the hub. A manifest also held only 10 metrics, 5 boards and 50 items (D-92).

| ID | Requirement | Priority |
|---|---|---|
| HUB-1 | The manifest's `endScreen` is `full` (default; also every version stored before it), `compact` or `none` (HUB-7, v1.35.0); `compact` and `none` need `levels.replay: true` (`azg validate`: „compact starts the next play at once, so it needs levels.replay: true“) | Must |
| HUB-2 | With `compact` a completion shows no end screen: a small result card at the top of the running game, under the shell's buttons, with the score and `+N b`, then a new badge, a completed daily challenge and a tournament place, or instead why the play did not count (rejected, practice, a restricted player, a referee result pending), and a line asking for a nickname when the round would have counted with one. Taps pass through the card to the game; it hides after 4 s or on its × (a labelled button), and a status region that stays in the page announces it. The shell then starts the next play at once: the game gets `start`, no `replay` event is recorded (that stays the player's „Hrať znova“), and leaving the page during such a play records no `abandon`. The end screen's nickname, public-board and reminder prompts do not show, and the server keeps the one-time board and reminder prompts for a game with an end screen; the game offers the nickname and login itself (`game.player.setNickname`, `game.player.login`, HUB-3 `nicknamePrompt`). The builder's end-screen preview shows the card with the sample | Must |
| HUB-3 | `game.onResult(cb)` (SDK 1.7.0, protocol message `result`) tells every game, compact or not, what the platform made of the play it completed, before the end screen or the card and before the next `start`: `{ score, points, earned, rejected, practice, badges: [{ id, title }], dailyChallengeCompleted, tournamentRank, nicknamePrompt, nicknameReset }`. `earned` is the currency the earn rules credited (after the caps); `nicknamePrompt` says the play would have counted with a nickname, or that a moderator reset it (`nicknameReset`); `azg dev` sends the same. Read only: nothing in it can be sent back, and it never carries the player key, the session or moderation details | Must |
| HUB-4 | A manifest holds up to 100 metrics, 40 earn rules, 100 boards, 300 items, 10 currencies and 50 badges (from 10, 10, 5, 50, 5, 20; metrics and boards 40 in v1.29.0–1.33.0, D-99). A completion still carries at most 10 `stats` (one mini game reports its own) | Must |
| HUB-5 | A compact game counts at most 60 plays of a player an hour (completed, not rejected): the next one is stored as rejected `too_many` (no points, streak, boards, badges or currency) and the card says „Za poslednú hodinu si odohral veľa kôl …“. Without a click between plays nothing else paces them (independent review, 27 Oct). `azg dev` does not cap | Must |
| HUB-6 | `start` and `complete` events open and close plays, so they are not counted in a session's 2 000 events (EVT-2.1) and have their own limit of 60 a minute; the other events keep EVT-2.1. A hub plays hundreds of rounds in one session without its plays being dropped | Must |
| HUB-7 | With `none` a completion works as with `compact` (HUB-2, HUB-5, HUB-6: the next play starts at once, no `replay` or `abandon`, the hourly cap, no one-time board or reminder prompt) but the shell shows nothing: no card and no status announcement. The game tells the player the verdict from `game.onResult()` (HUB-3), including why a round did not count; the builder's end-screen preview shows the game without anything of the shell's (v1.35.0, D-101) | Must |
| SNS-1 | The game frame may use the accelerometer and the gyroscope (`allow` of the shell's iframe and of the `embed.js` iframe), for tilt controls; the sandbox does not change. On iOS the game itself must ask with `DeviceMotionEvent.requestPermission()` from a tap, and Safari may still refuse it inside a frame (not yet tried on an iPhone), so a game always keeps a touch fallback | Must |

- **HUB-1.1** `endScreen` defaults to `full`, `compact` is accepted; **HUB-1.2** another value, and `compact` with `levels.replay: false`, are refused with the path.
- **HUB-2.1** After a completion the end screen stays hidden, the card shows the score and points, and the game gets `start` again; the next round completes and counts on its own.
- **HUB-2.2** The card hides after 4 s and on a tap; **HUB-2.3** a rejected, practice or restricted play shows why and no points; **HUB-2.4** badges, the daily challenge and the tournament place show.
- **HUB-2.5** The automatic next play records `start` without `replay`, and leaving during it records no `abandon`; **HUB-2.6** a play the player started still records `abandon`.
- **HUB-2.7** `full`, and a game info without the field, keep the end screen; **HUB-2.8** the builder preview of the end screen shows the card.
- **HUB-2.9** Two rounds in one session are two counted plays with their own points; **HUB-2.10** a compact game never takes the one-time board prompt, so the first game with an end screen still asks; **HUB-2.11** a capped play, an anonymous round and a reset nickname each show their line.
- **HUB-5.1** The 61st counted play in an hour is `too_many` and earns nothing; **HUB-5.2** a game with the full end screen has no cap, and rejected plays do not count toward it.
- **HUB-6.1** A session past its 2 000 events still opens and completes plays; **HUB-6.2** `start` and `complete` pass the total, within 60 a minute, in their order.
- **HUB-3.1** `onResult` gets points, earned currency, badges and the daily challenge, after the play's `start` and before the next one; **HUB-3.2** a rejected play says so with the full end screen too; HUB-2.11 covers `nicknamePrompt` and `nicknameReset`.
- **HUB-7.1** `none` is accepted, and refused with `levels.replay: false`; **HUB-7.2** after a completion neither the card nor the end screen shows and nothing is announced, the game gets `start` again without `replay` and hears the verdict; **HUB-7.3** the builder preview of the end screen shows nothing of the shell; **HUB-7.4** the server counts a `none` game like a compact one (the hourly cap, no board prompt).
- **HUB-4.1** The new maximums are accepted; **HUB-4.2** one more of each is refused.
- **SNS-1.1** The shell's frame allows `accelerometer` and `gyroscope` with the sandbox unchanged; **SNS-1.2** so does the `embed.js` frame.

### 5.42 Economy and identity for hub games (GRT, MRG, PSV, TRN-8)

Lukáš, 27 Oct, the same Brloh request („vsetko priprav, kvalitne, a vsetko zapracuj rovno“). Rewards in a hub (a season step, a chest, a claw-machine prize, a set bonus) are items, but an item could only be bought; an anonymous player who signed in lost the coins, items and room they had built on the device (D-47); a game that lists other players' rooms could not tell who opted in to being shown or who a moderator hid; and a tournament ranked only points or the score of one game, while a hub's mini game is a metric (D-93).

| ID | Requirement | Priority |
|---|---|---|
| GRT-1 | The game backend gives a declared item without a price: `wallet.grant(player, item, n, key, { reason })` of `@azet/games-server` (1.5.0), `POST /api/v1/wallet/grant` with the game token, `{ session, item, n?, key, reason? }` → `{ item, quantity, duplicate? }`. Once per key (the same key for another grant `409 conflict`); the item's `stackable` and `maxPerPlayer` hold (`409 quota`); an undeclared item or a bad `n` is `422`; a frozen player `403 economy_frozen`; the economy off `403 economy_disabled`. The ledger records `grant`, the event log `item_grant`. The browser has no grant | Must |
| MRG-1 | When a player signs in on a tenant host (Azet ID, or the CMS account on a sandbox, CML), what the browser's anonymous key holds there moves to the account in one transaction: balances of currencies a game still declares (a shared one only with *Shared currencies* on), items, and `game.store.player` keys the account does not have yet (up to its 100 a game; the account's own saves win). What does not fit stays on the device: the account's `max`, `stackable`, `maxPerPlayer`, and at most one `dailyEarnCap` of a currency per move. A device belongs to the account of its first move, and an account takes at most one move a Bratislava day (kept in `device_merges`), so many devices are no way around the daily cap; what did not fit moves at a login on a later day. The Azet login state cookie is `__Host-` on https (as the CML one), so a state planted from a sibling host cannot sign a victim in as the attacker and move the victim's device to the attacker. The login waits at most 3 s for the move. Nothing of the wallet moves with the economy off or either side frozen (MOD-4); the saves do. Ledger rows `merge` on both sides; the daily cap is not used up. Points, streaks, badges, boards and the nickname stay with the device. A failed move never fails the login. The player delete (DAT-4) removes the move records | Must |
| PSV-1 | `game.player.get()` and the backend's `getPlayerSummary` carry `visibility: { publicBoards, hidden }`: the player's opt-in to public boards (PRF-1) and whether a moderator hides or bans them (MOD-3, MOD-5), so a game that lists players itself (visits to rooms) shows only players who opted in and are not hidden | Must |
| TRN-8 | A tournament of exactly one game may rank `metric:<id>`, a metric that game's active version declares (`best` follows the metric's `better`); several games or an undeclared metric are `422`. The editor offers the metrics of the one selected game; the public page shows the bare value | Must |

- **GRT-1.1** A grant gives the items, once per key, records `item_grant` and takes no price; the key for another grant is `409`. **GRT-1.2** `stackable` and `maxPerPlayer` are `quota`. **GRT-1.3** An undeclared item, `n: 0`, another game's session (`404`), a wrong token (`401`), a frozen player and a production tenant with the economy off are refused. **GRT-1.4** The shell wallet has no grant op. **GRT-1.5** `wallet.grant` sends the game token and checks its arguments before calling the CMS.
- **MRG-1.1** The CMS login with the device's cookie moves balances, items and saves, records the move and writes `merge` ledger rows, which the builder's economy statistics count neither as earned nor as spent. **MRG-1.2** `max`, one daily cap a move, non-stackable and `maxPerPlayer` leave the rest on the device. **MRG-1.3** A device stays with its first account; an account takes one move a day; the rest of a device moves the next day; an empty device is no move. **MRG-1.7** On https the Azet login state is a `__Host-` cookie without a domain. **MRG-1.8** The login waits at most 3 s, and a failing tenant lookup does not fail it. **MRG-1.4** A frozen side moves only the saves; *Shared currencies* off keeps the shared balance; the economy off moves only the saves. **MRG-1.5** The account's own saves win, up to 100 keys. **MRG-1.6** Only an anonymous device to a signed-in key; a failing move returns nothing and never throws.
- **PSV-1.1** `visibility` follows the opt-in, a hide and a ban (and its end), for the backend and the game.
- **TRN-8.1** A metric tournament ranks the metric of the game's plays in the window; a round without the metric does not count. **TRN-8.2** Several games, an undeclared metric and a malformed one are `422`. **TRN-8.3** The form gets each game's metrics.

### 5.43 The game's window and developer feedback (WIN, HOW, ART, SHL-1.3, TMS, CLI-9)

Ivana's feedback after the clean-up of 28 Oct (Míny, team „if“), and Lukáš the same day: „herne okno na desktop / mobil nemozeme v cms obmedzovat, nech si kazda hra definuje ake okno chce mat“. The shell drew every game in a 560 px column, so Míny Expert (30×16) scrolled even on a laptop and an article got a 560 × 640 box; „← Späť na hry“ stood in the middle of a wide page; a draft had no icon or cover in the CMS until they were uploaded again; nothing listed the teams; and azg 0.3.15 said nothing about 0.3.18 and started a new game on SDK 1.6.2 (D-94, D-95).

| ID | Requirement | Priority |
|---|---|---|
| WIN-1 | `window:` in `azet-game.yaml` says the window the game wants, per side: `desktop` and `mobile`, each `width` (CSS px 320–3840, or `full`) and `aspect` (`W:H` between 1:4 and 4:1, or `free` = the whole height). Without `window:` a game keeps the 560 px column on desktop and the whole screen on a phone; with it, what a side leaves out is `full` and `free`, so the CMS narrows nothing the game did not ask for | Must |
| WIN-2 | The shell sits on a stage that fills the box the page gives it and draws the window inside it, centred: at most `width` wide, with a fixed `aspect` as large as fits both ways (letterboxed in the theme background). The `mobile` side applies while the stage is at most 640 px wide or 500 px high (a phone held either way, or a narrow article column). The play page, the article embed, the builder preview (mobile and desktop frames) and `azg dev` (with a new 1440 px viewport) all draw it | Must |
| WIN-3 | `/embed.js` sizes each article box by the game's window: at most `width` wide; with a fixed `aspect` the box keeps that shape and is never taller than the screen; with a free one it is 640 px high. `data-height` (320–1200 px) still sets the height. The mobile side applies when the box would be at most 640 px wide or 500 px high, the shell's rule. The loader lists the windows of live games only (a hidden game's slug stays private; it gets the 560 px box), and a failing lookup gives the 560 px box rather than a broken loader | Must |
| HOW-1 | `howTo:` in `azet-game.yaml`: how to play, 1–8 lines of at most 140 characters (rules, controls) | Should |
| HOW-2 | The shell shows the lines under „Ako hrať“ on the start screen (after the description, before „Hrať“) and on the pause screen (before „Pokračovať“) | Should |
| ART-1 | A game's detail (`GET /games`, `GET /games/{slug}`), the admin tile and the builder show the manifest's icon and cover right after `azg publish`: those of the active version, else of the newest uploaded version (a draft); `iconUrl` and `coverUrl` are what the game shows, `assets` stays the uploaded overrides (THM-2), which win | Must |
| SHL-1.3 | „← Späť na hry“ has one place on every screen: the top left corner of the stage, so on a wide screen at the page edge and not at the narrow game window; a labelled pill on the start and pause screens and only its round arrow while playing | Should |
| TMS-1 | `GET /api/v1/teams` (scope `games:read`, op `teams.list`) lists the tenant's teams with member and game counts and `member` for the caller's own team; names and counts only (members and invite links stay on the team page, MEM-3.1, MEM-4). People see it (a team member checks their own team); tokens limited to some games (deploy, a game's agent token) get `403`. `azg teams list` (or `azg teams`) prints them and marks yours with ● | Must |
| CLI-9 | The CLI reads what the platform serves (`/downloads/index.json`, D-34): after `azg login`, `whoami`, `publish` and `games create` it prints one line to stderr when a newer CLI exists, with the update command (CLI-9.1); `games create` points a new project at the platform's SDK and CLI versions and, for the html template, takes the platform's `azet-games-sdk.js` (CLI-9.2); `azg publish` says when the game's SDK is older than the platform's (CLI-9.3). Warnings only, 2 s at most, off with `AZG_NO_UPDATE_CHECK=1`. Versions, aliases and hashes of the index must be well-formed, and the single-file SDK is written only when its sha256 is the index's (no redirects) (CLI-9.4) | Must |

- **WIN-1.1** Without `window:` the 560 px column and the whole phone. **WIN-1.2** A width in px or `full` and an aspect `W:H` or `free` per side are accepted. **WIN-1.3** What a declared window leaves out is `full` and `free`. **WIN-1.4** Widths outside 320–3840, other keys, malformed aspects and shapes beyond 1:4 or 4:1 are refused.
- **WIN-2.1** The shell sits on a stage that fills the box; without a window the 560 px column. **WIN-2.2** The game's width and shape per side reach the stage. **WIN-2.3** A fixed shape fits the stage both ways; mobile applies up to 640 px wide or 500 px high. **WIN-2.4** `update()` changes the window without a remount. **WIN-2.5** `destroy()` removes the stage. **WIN-2.6** In a browser, the play page of a game without `window:` draws the 560 px column on a 1280 px monitor and the whole phone at 390 px, with „← Späť na hry“ at the page's top left. **WIN-2.7** In a browser, a 16:9 window fits by height on a wide stage and by width on a narrow one, honours a width cap, and the stage switches to the mobile side at 640 px wide or 500 px high.
- **WIN-3.1** The loader carries the windows of games that declare one; others keep the 560 px box. **WIN-3.2** A fixed shape sizes the box by its ratio, never taller than the screen; `data-height` still wins; mobile up to 640 px. **WIN-3.3** The embed page hands the shell the window and the how-to-play lines. **WIN-3.4** The play page no longer narrows the game.
- **HOW-1.1** Up to 8 short lines; empty, long or too many are refused. **HOW-2.1** The start screen lists them under „Ako hrať“ after the description, before „Hrať“. **HOW-2.2** The pause screen shows them before „Pokračovať“. **HOW-2.3** Without `howTo` (or only blank lines) there is no list.
- **ART-1.1** A draft shows the icon and cover of its newest upload in the detail and the list; `assets` stays the overrides. **ART-1.2** Once a version is active its manifest gives the art; an uploaded icon overrides it.
- **SHL-1.3** The control is on the stage, outside the game window, in the top left corner on the start, play and pause screens; only its arrow while playing (WIN-2.6 measures it at the page edge).
- **TMS-1.1** Every team with member and game counts; `member` marks the caller's own team. **TMS-1.2** A token without a person sees the teams, none of them as its own. **TMS-1.3** It needs `games:read` (401 without a token, 403 without the scope); `azg api ops` lists it. **TMS-1.4** `azg teams list` (and `azg teams`) prints the table and marks yours; `--json` gives the items. **TMS-1.5** A deploy or agent token limited to a game gets `403`.
- **CLI-9.1** A newer CLI is one stderr line with the update command; the same or a newer CLI, the dev CLI, a failing or slow server and `AZG_NO_UPDATE_CHECK=1` print nothing. **CLI-9.2** `games create` takes the platform's versions and single-file SDK. **CLI-9.3** `azg publish` warns about an older SDK in the game. **CLI-9.4** Malformed versions, aliases and hashes from the index are dropped; a single-file SDK that does not match the index's sha256, or comes through a redirect, is not written.

### 5.44 Links to articles and the replay button (OPL, RPL)

Matej, 28 Oct: a word search (osemsmerovka) made from the most read articles should also promote them („Potrebujete pomôcť s riešením? Prečítajte si článok“), but the game frame's sandbox has neither `allow-popups` nor `allow-top-navigation`, so a link in the game does nothing. His proposal: „game.openLink(url) spracované shellom, s kontrolou https a povolenými doménami azet.sk a koktejl.azet.sk, s udalosťou article_click“ (D-96).

| ID | Requirement | Priority |
|---|---|---|
| OPL-1 | `game.openLink(url)` (SDK 1.9.0, protocol message `link`): the shell opens an `https://` URL on `azet.sk` or a subdomain (≤ 2048 characters, no user, password or port; the shell checks it, the game frame is not trusted) in a new tab with `opener` cleared and answers `{ opened: 'tab' }`; when the browser blocks the tab it shows a button „Otvoriť článok ↗“ at the bottom of the game for 12 s and answers `{ opened: 'button' }`. One link a second (`rate_limited`), at most 10 a visit (`limit_reached`); a shell that does not know the message makes the SDK fail with `unavailable` after 3 s; without a handler (no shell UI) `unavailable`; the builder preview opens nothing. Each link records `article_click` `{ host, path, opened }`, never the query or fragment. The sandbox of the game frame stays as it is | Must |

Michal, 28 Oct: „ked skoncim level, tak vidim obrazovku s hrat znova, ja chcem az tam je Hrat dalsi level alebo nieco podobne ale neda sa to overridnut“ (D-97).

| ID | Requirement | Priority |
|---|---|---|
| RPL-1 | `game.setReplayLabel(text \| null)` (SDK 1.9.0, protocol message `replay_label`): the end screen's replay button says `text` (one line, 1–30 characters, plain text) for the rest of the visit, until the game changes it; `null` brings back the CMS's text or „Hrať znova“. Set while the end screen shows, the button changes at once; the text survives a new session after „Skúsiť znova“. Control, format (bidi, zero-width), separator and markup characters are refused. A shell that does not know the message makes the SDK fail with `unavailable` after 3 s. The button still starts the next play | Must |
| RPL-2 | Editors set the replay button's text for every play in the builder (**Screens → End screen → Replay button text**, `screens.end.button`, ≤ 30 characters); the game's `setReplayLabel()` wins over it | Should |

- **RPL-1.1** Without a text the button says „Hrať znova“; the CMS text replaces it. **RPL-1.2** The game's text wins over the CMS, holds for the next plays, and `null` brings the CMS text back. **RPL-1.3** A text set while the end screen shows replaces the button at once. **RPL-1.4** Empty, longer than 30 characters, several lines, markup, bidi and zero-width characters are refused. **RPL-1.5** A shell from before SDK 1.9.0 never answers: `setReplayLabel` and `openLink` fail with `unavailable` after 3 s.
- **RPL-2.1** `screens.end.button` is stored with the sections and reaches the shell page. **RPL-2.2** More than 30 characters is refused.
- **OPL-1.1** A checked link opens in a new tab without `opener` and records `article_click` with the page only. **OPL-1.2** A blocked tab becomes a button that opens the link in a new tab (`noopener noreferrer`), closes with ×, hides by itself. **OPL-1.3** `http:`, other hosts, look-alikes (`azet.sk.evil.sk`, `notazet.sk`), credentials and non-URLs are refused by the shell (`invalid_payload` with the reason), and nothing opens. **OPL-1.2** The button hides after 12 s and when tapped. **OPL-1.4** A second link within a second is `rate_limited`; the limit lifts after a second; the 11th link of a visit is `limit_reached`. **OPL-1.5** The builder preview opens nothing. **OPL-1.6** The server stores `article_click` with its fields.

### 5.45 A game's own pause button and pictures in how to play (PSE, HOW-3)

Barbora, 28 Oct: „to tlačidlo ‚pauza‘ v pravom hornom rohu by si mohol vyhodiť“, „respektíve mohli by sme overridnúť dizajn? V úvode, kde sú inštrukcie, tak mať možnosť tiež si customizovať návod, pridať obrázky atď.“ The shell's pause button covered the game's own controls in the top right corner, and „Ako hrať“ took text only (D-98).

| ID | Requirement | Priority |
|---|---|---|
| PSE-1 | `pauseButton: false` in `azet-game.yaml` (default `true`) hides the shell's pause button. `game.pause()` (SDK 1.10.0, protocol message `pause_request`) opens the shell's pause screen as its button does: the game hears `onPause`, and `onResume` after „Pokračovať“; it answers `{ paused: true }`, or `{ paused: false }` and changes nothing when nothing is playing. A shell that does not know the message makes the SDK fail with `unavailable` after 3 s; the builder preview pauses nothing. A hidden tab still pauses every game. The play page, the article embed, the builder and `azg dev` follow the manifest | Must |
| HOW-3 | A `howTo` line may be `{ text, image }`: a picture from the repo (`svg`, `png`, `jpg`, `jpeg`, `webp`, `gif`, never outside the repo) that the shell shows left of its text at 80 × 80 px. `azg publish` and the zip upload copy it to `__azg/howto/<line>.<ext>`; `azg validate` and the zip upload refuse a missing one. The shell takes only `http(s)` or site-relative picture URLs, and a picture that fails to load is removed with its text kept. The picture is decoration (`alt=""`): the text says what it shows. The start and pause screens stay the platform's | Should |

- **PSE-1.1** The shell shows its pause button while playing; `pauseButton: false` hides it. **PSE-1.2** `game.pause()` opens the pause screen like the button; the game hears `onPause`, and `onResume` on „Pokračovať“. **PSE-1.3** With nothing playing, `game.pause()` changes nothing and answers `paused: false`. **PSE-1.4** A shell from before SDK 1.10.0 never answers: `game.pause()` fails with `unavailable` after 3 s. **PSE-1.5** `pauseButton` defaults to `true`; other values than a boolean are refused. **PSE-1.6** The CMS hands `pauseButton: false` to the shell page.
- **HOW-3.1** Text lines and `{ text, image }` lines mix. **HOW-3.2** A line without text, too long, with unknown keys, or a picture outside the repo or of another type is refused. **HOW-3.3** The shell shows a picture left of its text (`alt=""`); plain lines stay bullets. **HOW-3.4** A picture URL that is not `http(s)` or site-relative is left out and its text stays. **HOW-3.5** Publishing copies each picture to `__azg/howto/<line>.<ext>`, and the shell gets its URL. **HOW-3.6** A picture that fails to load is removed. **HOW-3.7** The zip upload copies the pictures and reports a missing one. **HOW-3.8** The shell page gets each picture as a URL in the version's bundle. **HOW-3.9** `azg validate` reports a missing picture.

### 5.46 Tournaments of a team's own games (TRN-9)

Erik, 28 Oct, about his multiplayer game: „toto je vec, čo by vedela byť ako turnaj, len taký fukot … akurát to je vo vašej moci“. Lukáš: open tournaments to the teams and see what they come up with.

| ID | Requirement | Priority |
|---|---|---|
| TRN-9 | In a sandbox tenant a `team` member (CMS session or personal token) creates, edits and deletes tournaments, and their banners, over the games of the own team, also games not yet live. Tournaments with another team's game do not exist for them (`404`); they list only their own. Prizes and the season stay as editors set them (`403` with the path `prizes` / `season` on a change), and the winners, their confirmation and deleting a tournament with prizes or confirmed results stay with editors. Production tenants and viewers are unchanged (`403`). Admin → Tournaments shows a team member its tournaments, its games, no prize, season or winners controls, and a note on whom to ask for prizes | Must |

- **TRN-9.1** A team member creates, edits (banner included) and deletes a tournament over its own games, also over a game that is not live yet.
- **TRN-9.2** Another team's game is `404`, also next to an own game.
- **TRN-9.3** Prizes and a season are refused with their path; an edit that sends the prizes and season an editor set back unchanged keeps them, dropping them is refused.
- **TRN-9.4** The list holds only the team's tournaments; reading, editing, deleting and the banner of another team's tournament are `404`.
- **TRN-9.5** Winners and confirm are `403` for a team member; a tournament with prizes or confirmed results cannot be deleted by it (`403`).
- **TRN-9.6** A viewer, and a team member of a production tenant, cannot write tournaments (`403`); the production team member cannot list them.
- **TRN-9.7** A tournament of another tenant is `404`.

### 5.47 Fast loading (PERF-1)

Lukáš, 29 Oct: „hry sa nacitavaju strasne pomaly, je to nieco co vieme zrychlit?“ Measured on the hackathon tenant the same day: on a phone the landing loaded 3.4 MB of covers for tiles 306 px wide (covers are 1 200–1 920 px PNGs of 300–650 KB), the games origin sent scripts uncompressed (one game 1.36 MB of JavaScript) and read every file from Postgres (`BUNDLE_STORAGE=postgres`) on every request.

| ID | Requirement | Priority |
|---|---|---|
| PERF-1 | The games origin (`/files`) keeps the files it served in the pod's memory (up to 192 MB, least recently used out first; a write or delete in the pod forgets them at once, another pod's copy lives at most 10 minutes; an archived game's bundle is refused before the cache, D-68). It sends HTML, JavaScript, CSS, JSON, SVG, WASM and text compressed by `Accept-Encoding` (brotli, else gzip; `Vary: Accept-Encoding`). For a PNG, JPEG or WebP `?w=160|320|640|960|1280` answers a WebP copy that wide (never wider than the picture, never larger than it; another width gets the original). The landing tiles and the shell's cover, icon and loading background ask for the copies with `srcset`; `azg dev` and the local games origin ignore `?w=` and send the original | Must |

- **PERF-1.1** A script is sent brotli or gzip by `Accept-Encoding`, the same bytes once unpacked, and plain without it; an image is not compressed again.
- **PERF-1.2** `?w=320` of a 1 200 px cover is a 320 px WebP smaller than the original; an unlisted width or an SVG gets the original; a small picture is never enlarged.
- **PERF-1.3** Storage is read once per file while it stays cached; a write or delete forgets it; `HEAD` answers headers only.
- **PERF-1.4** `imageSrcSet` lists the copies for a PNG, JPEG or WebP URL only (not for SVG, `data:` or a URL with a query).
- **PERF-1.5** The shell's cover, icon and loading background carry `srcset` and `sizes`; an SVG keeps its plain `src`.
### 5.48 A game's own way back (BCK)

29 Oct: a hub team's agent: „Požiadať tím platformy o nastavenie v manifeste na skrytie šípky, napríklad pre hub, ktorý má vlastné ‚Späť‘. Platforma podobne pridala endScreen: none.“ The shell's round „←“ arrow sat in the top left corner of the running game next to the hub's own „Späť“ (from a mini game to the room), so the player had two back buttons that went to different places (D-103).

| ID | Requirement | Priority |
|---|---|---|
| BCK-1 | `backButton: false` in `azet-game.yaml` (default `true`; also every version stored before it) hides the shell's „←“ arrow while the game runs. The start and pause screens keep „← Späť na hry“ and the end screen its button, so the player always has a way out: the shell's pause button, or `game.pause()` from the game's own (PSE-1). The CMS shell, the embed, the builder preview and `azg dev` follow it | Must |

- **BCK-1.1** `backButton` defaults to `true`, `false` is accepted, another value is refused with the path.
- **BCK-1.2** With `false` the arrow is gone while playing and stays on the start and pause screens with its link; without it the arrow shows as before.
- **BCK-1.3** The play and embed pages pass `backButton: false` to the shell, and nothing for a game without it.


## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Shell first paint < 1 s on 4G. Game block reserves its height (no layout shift) |
| Mobile | Mobile first, tested at 375 px |
| Security | Tenant isolation in code and in Postgres RLS; sandboxed games; CSP; hashed tokens; no secrets in config |
| Privacy | Hashed Azet ID only; consent respected; delete on request |
| Accessibility | CMS screens keyboard-operable, WCAG 2.1 AA contrast |
| Language | Code, docs, comments and the CMS admin UI in English (D-39). Player-facing copy (landing, leaderboard, shell, game texts) is Slovak (Azet audience) |
| Operations | Local: Docker Compose. After the move: rin-apps cluster, ArgoCD, Grafana |

## 7. Milestones

| Milestone | Date | Done when |
|---|---|---|
| M1 Walking skeleton | 14 Oct | A sample game registered locally, published by script, playing in the shell, events in Postgres |
| M2 CMS core | 18 Oct | Games, settings form, appearance, landing editor, tenants, tokens |
| M3 CLI + CI | 21 Oct | `azg` end-to-end, CI template green on a test repo, preview per MR |
| M4 SDK freeze | 23 Oct | Contract frozen, both reference games pass, docs published |
| M5 Move | 26 Oct | Running on rin-apps, Multica workspace with agents, GitLab group ready |
| M6 Dry run | 28 Oct | A test team goes from zero to a live game in ≤ 15 min |
| P5 Realtime API agreed | 22 Oct | **Met 19 Oct:** Lukáš approved the `game.realtime` shape, the manifest block, D-77 and D-78 (AZG-316); SDK, shell and the protocol section land before the 23 Oct freeze |
| P6 Realtime live | 27 Oct | Service deployed, `games/tap-race` played by two browsers on the hackathon host, cluster smoke extended (RTM) |
| Hackathon | ~30 Oct | |
| P1 Contract additions (v1.3.0) | 21 Oct | MET-1–3, BDG-1–2, SHR-1 in SDK, manifest, templates and docs; deferrals removed |
| P2–P4 Players & stats | 29 Oct / 13 Nov | Statistics and leaderboards before the hackathon; badges, sharing, leagues and profile after it ([BUILD-PLAN.md](build-plan.md#players--stats-v130)) |

Details in [BUILD-PLAN.md](build-plan.md).

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The SDK contract changes after the hackathon | High | Freeze on 23 Oct, validate on two different reference games, version the protocol |
| Two weeks is tight for this scope | High | Must/Should split; Shoulds drop first; walking skeleton by 14 Oct |
| GitLab or cluster permissions are not ready for the move | High | Local mode works end-to-end; request access now (see DECISIONS) |
| Azet login integration is unknown | Medium | Identity behind an adapter; fake provider locally; anonymous play always works |
| Too many game backends for the cluster | Medium | Quotas per tenant; Level 1 store covers most games |
| DTM export format unknown | Medium | Store events in Postgres first; export is a separate job |
| v1.3.0 contract additions miss the 23 Oct freeze | High | Only the contract parts are Must; they land first (P1, 21 Oct) on one issue that changes code and docs together; everything else builds on them later |
| Public leaderboards empty after the opt-in (PRF-1) | Medium | One-time end-screen prompt (PRF-5); until PRF-1 ships, MOT-4 behaves as today |
| Client-reported metrics or awards used for cheating | Medium | Validation against the manifest, cosmetic marking of game awards, boards and trusted badges from validated plays only (D-45) |
| The F5 ingress does not pass WebSocket upgrades or cuts idle connections | High | Dev CMS proves a `wss://` echo through F5 on the realtime host before building on it, measures the upgrade and the idle timeout and records them in DEPLOY.md (RTM-9.3); 20 s heartbeat; sysadmins asked early (Q-13). If F5 blocks upgrades: class-C decision to Martin at once, no silent workaround |
| One realtime replica: a restart or crash drops every room during the hackathon | Medium | Graceful `restart` close, games offer „Hrať znova“; no deploys of the service during hackathon play hours; horizontal scaling only after v1 (D-78) |
| The `game.realtime` shape misses the 23 Oct freeze | High | API approved on 19 Oct (AZG-316); the SDK, shell and protocol land first in stage 2; later changes are additive only |

## 9. Open questions

Tracked in [DECISIONS.md](decisions.md#open-questions).
