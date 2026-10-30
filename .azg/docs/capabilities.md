# What you can use

Everything the platform gives a hackathon game, whether it works today, how to use it and its limits. State of **27 Oct 2026** (`@azet/games-sdk` 1.8.0, `@azet/games-server` 1.5.0, `azg` 0.3.18; the versions the CMS serves now are in `https://azet-games-cms.rin.rinapps.dev/downloads/index.json`). The [Hackathon guide](hackathon.md) shows how to build a game step by step; this page is the checklist of what you can build *with*.

**Status**

- **Live**: works on the hackathon tenant (`https://azet-games-hackathon.rin.rinapps.dev`, VPN) and in `azg dev`.
- **Sandbox only**: works on `azet-hackathon`; the production tenants (`azet`, `koktejl`) refuse it until it is enabled there.
- **Local only**: works in `azg dev`, not yet on the cluster.
- **Not available**: there is no API for it. Do not build around it.

## The game and the shell

| What | Status | How | Limits, notes |
|---|---|---|---|
| Lifecycle | Live | `await game.init()`, `game.ready()`, `game.onStart/onPause/onResume`, `game.complete({ score, timeSeconds, success })` ([SDK contract](sdk-contract.md) §2) | `ready()` within 10 s. One `complete()` per play. The shell draws the start, pause and end screens; do not build them |
| Settings from the CMS | Live | `settings:` in `azet-game.yaml` → a form in the CMS → `ctx.settings`, `game.onSettingsChange` ([Manifest](manifest.md#settings)) | JSON Schema subset; changes need no rebuild |
| Look: tenant theme, light/dark, Halloween | Live | `--azg-*` CSS variables or `ctx.theme`, `game.onThemeChange` ([SDK contract](sdk-contract.md) §5) | Never hard-code colours |
| UI kit | Live | `azet-games-ui.css` (in the `html` starter) or `import '@azet/games-sdk/ui.css'` ([Hackathon guide](hackathon.md#ui-kit)) | Buttons, HUD, cards, dialog, toast, progress, segmented control, list, badge/chip; 44 px targets, no JS, about 3 KB gzipped. Needs SDK ≥ 1.1.0 |
| The game's window | Live | `window:` in `azet-game.yaml`: width (px or `full`) and shape (`W:H` or `free`) for desktop and mobile ([Manifest](manifest.md#window)) | Without it the 560 px column on desktop. Applies on the play page, in articles, the builder and `azg dev` |
| How to play | Live | `howTo:` in `azet-game.yaml`, up to 8 lines; a line may be `{ text, image }` with a picture from the repo ([Manifest](manifest.md#fields)) | Shown under „Ako hrať“ on the start and pause screens; pictures 80 × 80 px left of their line |
| Own pause button | Live | `pauseButton: false` in `azet-game.yaml` + `game.pause()` from the game's button ([SDK contract](sdk-contract.md#a-games-own-pause-button-pse-1-sdk-1100)) | The shell's pause screen as usual; a hidden tab still pauses. Needs SDK ≥ 1.10.0 |
| Links to articles | Live | `game.openLink('https://www.azet.sk/…')` from a tap ([SDK contract](sdk-contract.md#links-to-articles-opl-1-sdk-190)) | `https://` on azet.sk and its subdomains only; a new tab, or a button when the browser blocks it; one a second; records `article_click` |
| Replay button text („Hrať ďalší level“) | Live | `game.setReplayLabel(text)` before `complete()`; editors: Screens → End screen | 1–30 characters, holds for the visit; the game's text wins over the CMS's |
| Ad placeholder | Live (placeholder only) | `<div class="azg-ad-slot"></div>`, `data-size="320x100"` | Only a labelled box („Reklama“). No ad code, no third-party scripts (the CSP blocks them) |
| Hub of mini games | Live | `endScreen: compact` (or `none`, without the card) in `azet-game.yaml`, one metric, board and earn rule per mini game, `game.onResult()` ([Game services](game-services.md#a-hub-of-mini-games)) | Each round is its own play; a result card instead of the end screen, the next play starts at once; at most 60 counted rounds of a player an hour. Up to 100 metrics and boards, 40 earn rules, 300 items, 10 currencies, 50 badges |
| Rewards as items | Live | The backend: `wallet.grant(player, item, n, key)` ([Game services](game-services.md#4-rewards-items-from-the-backend-grt-1)) | A declared item without a price, once per key, within `stackable` / `maxPerPlayer`. Not from the browser |
| Signing in keeps the device's wallet and saves | Live | Nothing to do: the Azet and CMS-account logins move them ([Game services](game-services.md#5-signing-in-keeps-what-the-device-built-mrg-1)) | A device stays with its first account; one move an account a day, at most one `dailyEarnCap` a currency per move, the rest the next day. Points, streaks, badges and boards stay with the device |
| Who may be shown | Live | `player.get().visibility` / `getPlayerSummary(...).visibility` | `{ publicBoards, hidden }`: list players in your own UI only with the opt-in and not hidden |
| Tournament over a mini game | Live | Editors pick `metric:<id>` of one game in **Tournaments** | One game only; the metric must be declared by its active version |
| Verdict of a play | Live | `game.onResult((r) => …)`: points, earned currency, badges, daily challenge, tournament place ([SDK contract](sdk-contract.md)) | Read only; every game gets it |
| Tilt controls | Live (not yet tried on a phone) | `DeviceOrientationEvent` / `DeviceMotionEvent` in the game; the frame allows `accelerometer` and `gyroscope` | iOS needs `DeviceMotionEvent.requestPermission()` from a tap and may refuse it in a frame; keep touch controls |
| Daily level | Live | `ctx.level.seed` / `ctx.level.date` (`levels.mode: daily` in the manifest) | The same seed for every player on a Bratislava day |
| Custom analytics | Live | `game.track('name', props)` + `events:` in the manifest ([Events](events.md)) | No personal data in props (dropped). Sessions, loads, plays, pauses, shares and errors are recorded with no code |
| Network calls | Live (opt-in) | `network.allow` in the manifest ([Manifest](manifest.md)) | Everything else is blocked by the CSP. No cookies, no `localStorage`: use `game.store` |

## Players and motivation

| What | Status | How | Limits, notes |
|---|---|---|---|
| Player, nickname | Live | `game.player.get()`, `game.player.setNickname()` ([Game services](game-services.md#player)) | Nicknames: 2–20 characters, deny list, 5 changes a day. Anonymous players without a nickname earn nothing |
| Azet ID login | Live | The shell offers it; `game.player.login()` to start it from the game | Leaves the page and comes back. `started: false` in `azg dev` |
| Your own Azet account in the CMS | Live | CMS → your name → **Account and password** → **Link Azet account** ([Admin guide](admin.md#1-people-and-roles)) | The CMS sign-in stays as it is. Your player is marked **Team** in the admin and gets no tournament prizes; one Azet account per person |
| Points and streaks | Live | Automatic from `complete()`; read with `game.points.get()` / `player.get().streak` | Only counted plays (within `scoring`, signed-in or nicknamed) |
| Levels | Live | Platform level from lifetime points: `player.get().level` (`platformLevel()` in the SDK); the game's own levels with titles: `progression:` in the manifest → `player.get().gameLevel` ([Game services](game-services.md#own-levels-progression)) | Computed by the CMS from counted plays; level n of the platform starts at 50·n·(n−1) points, at most 99. Both are in every room member's `profile` |
| Leaderboards | Live | Shell end screen and landing; in the game `game.leaderboards.list/get`; own boards in `leaderboards:` ([Game services](game-services.md#leaderboards)) | `limit` 1–50. **No score submit from the browser**: scores only via `complete()` or the backend's `submitResult` |
| Reporting a nickname | Live | `game.leaderboards.report(entryId, reason)` | 5 a day per device |
| Badges | Live | Rules in `badges:` (counted by the server), also several conditions (`all`), time, win and wins in a row; `game.award(id)` for `award: game` badges ([Manifest](manifest.md#badges)) | `award()` badges are cosmetic and never count for boards; up to 5 conditions a rule, wins in a row up to 100 |
| Metrics | Live | `metrics:` in the manifest + `complete({ stats })` ([Manifest](manifest.md#metrics)) | At most 10 per play; invalid stats are dropped, the score still counts |
| Daily challenge | Live | Shell end screen and landing; `game.challenge.get()` to show it in the game | Read-only; the server counts progress |
| Tournaments | Live | Editors set them up in the CMS; on the hackathon your team too, over its own games (**Tournaments** in the CMS, TRN-9); `game.tournaments.get()` to show one in the game ([Game services](game-services.md#tournaments)) | A game does nothing extra to take part; results from a referee backend count too. Prizes and confirming winners: ask the hackathon admins |
| Leagues | Live (shell and landing only) | Players create and join leagues on the tenant pages | No SDK call |
| Share and result cards | Live | The end screen's „Zdieľať výsledok“; `game.share({ text })` sets the text | ≤ 280 characters, ≤ 8 lines, plain text |
| Challenge a friend | Live | The shell's challenge link; only for games with `levels.mode: daily` | The friend plays the same daily level; a past day is practice |

## Data, economy and multiplayer

| What | Status | How | Limits, notes |
|---|---|---|---|
| Cloud save | Live | `game.store.player` (per player), `game.store.shared` (per game): `get/set/delete/incr/list` ([Game services](game-services.md#cloud-save)) | JSON ≤ 16 KB per key; 100 keys per player, 10 000 shared. Never ranked |
| Currency, shop, inventory | Sandbox only | `currencies:`, `items:`, `earn:` in the manifest; `game.wallet`, `game.shop.buy`, `game.inventory` ([Game services](game-services.md#currency-and-shop)) | The game never earns currency itself. Every write takes a `key`. Off in production tenants until editors enable the economy (`economy_disabled`) |
| Realtime multiplayer | Sandbox only | `realtime:` in the manifest + `game.realtime.quickMatch()`, `create()` (invite code) and `join(code, { create: false })` ([Game services](game-services.md#multiplayer)); example `games/tap-race`; **authoritative** with `authority: referee`: the game's backend decides every room and reports the results (`createReferee` / `azg_referee.py`, example `games/piskvorky`, which runs on the cluster; a team's referee is its own backend, see "Own backends on the cluster"); the CMS shows and closes live rooms (game → *Multiplayer*). **Bots** the referee plays (`realtime.bots`, `playBot({ level })`, practice), **players online** (`game.realtime.online`), a verified **profile** of every member (platform level, game level, week points, rank), a **nickname** required for rooms (the shell asks), one socket per session from the start (`connect()`), **invite links** (`game.invite.link({ room })` → `ctx.invite`), **React hooks** (`@azet/games-sdk/react`: `useRoom`, `useOnline`, `usePlayer`) | 2–50 players a room, 200 rooms a game, 3 rooms or waits and 20 new rooms per 10 min a player, 20 000 connections in total and 500 per client IP; a room nobody joins closes after `waitSeconds` (default 2 min); messages ≤ 4 KB, room state ≤ 16 KB, 20 messages a second per player. One replica: a restart closes every room. Scores still go through `complete()` |
| Turn-based matches | Live | `matches:` in the manifest + `game.matches.create()` / `join(code)` / `quick()` / `move()` ([Game services](game-services.md#matches)); example `games/piskvorky-async` | 2–8 seats; kept by the CMS for days (turn 60 s – 7 days, then forfeit); state ≤ 16 KB; 20 open matches per player and game, 30 moves a minute. Results are recorded for every member when the match ends; `authority: backend` makes the game backend the referee (note: `matches:` says `backend`, `realtime:` says `referee`) |
| Own game backend | Sandbox only | `azg backend add` (Node or Python 3.11+; Postgres needs Docker locally), `azg dev --backend`, `game.api.fetch('/path')` ([Manifest](manifest.md#backend)); on the cluster through a game repo in the GitLab group `rin-apps/azet-games-hry` ([below](#own-backends-on-the-cluster)) | 0.25–0.5 CPU, 256–512 MB, read-only, no internet; its own Postgres schema. One replica. Archiving the game does not stop the backend (ArgoCD prune is off): ask the organizers |

## Making and shipping a game

| What | Status | How | Limits, notes |
|---|---|---|---|
| Templates | Live | `azg games create --template html \| vanilla-ts \| react \| vue \| phaser \| pixi` | All six pass the cluster smoke test (create → build → contract → publish → live) |
| Without programming | Live | CMS → **Games → Add game** → download the starter .zip → change it with the AI prompt → upload the .zip | Same checks as `azg publish`; errors explained in Slovak |
| CLI | Live | `npm i -g --allow-remote=all https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz`; `azg login`, `games create`, `dev`, `validate`, `contract`, `publish --activate`, `games set`, `games archive`. Everything else in the [API](api.md), such as leaderboards, badges, challenges, tournaments, moderation, players, events export, icons and covers, goes through `azg api call <METHOD> <path>` ([CLI](cli.md)) | Node.js 22+, VPN. `azg ai setup` puts these docs into `.azg/docs/` for Claude Code |
| Versions and rollback | Live | Every publish or upload is a new immutable version; activate an older one in the CMS or with `azg games versions`, `activate`, `rollback` | A version number is never reused (`409`: bump `version`) |
| Game statistics | Live | CMS → game → overview | Players, completions, average time, return rate |

## Own backends on the cluster

Since 21 Oct game backends run in our cluster next to the CMS. GitLab CI builds the image; you publish and deploy from your laptop on the VPN, because the CI runners cannot reach the CMS.

1. `azg backend add` (on the VPN): it puts `@azet/games-server` into `backend/vendor/` so the image builds without the CMS. Develop with `azg dev --backend`.
2. Ask the organizers to add you to the GitLab group **`rin-apps/azet-games-hry`** (Developer). Create a project there with your game's slug as its path and push your game folder, `backend/` included. `.gitlab-ci.yml`:
   ```yaml
   include:
     - project: sysadmins/kubernetes/clusters/com/repo/helm-charts-apps/rin-apps/rin-azet-games-cms
       ref: development
       file: ci/backend.yml
   ```
   No variables are needed: the Harbor login and the runners come from the group.
3. A push to the default branch builds `backend/` and pushes it to Harbor. The job's last lines print the command for the next step.
4. On your laptop, in the game folder: `azg publish --activate` (the game, as always) and the printed `azg backend deploy --image … --digest …`. ArgoCD rolls the backend out in a minute or two; from then on `game.api.fetch()` reaches it on the hackathon host.

A backend that reports results or is a [referee](game-services.md) needs its game token: the organizers put it into Vault as `AZG_GAME_TOKEN` and you declare it in `backend.secrets`. Archiving the game does not stop its backend (ArgoCD prune is off): ask the organizers to remove it. Games without a deployed backend keep working: catch `GameError` `no_backend` like Had does.

## Not available

- **Content APIs** (today's articles, deep links into Azet content): there is no `content.*` or deeplink call in the SDK.
- **Writing scores** from the browser, or currency earned by the game itself. These are refused by design.
- **Ads, payments, third-party scripts, cookies, `localStorage`.**
- **Realtime and the economy on production tenants** (`azet`, `koktejl`) until they are enabled there.

## Gotchas worth knowing

- **Old SDK from the npm cache.** The SDK is downloaded from the CMS as `azet-games-sdk-<version>.tgz`, and npm caches that URL forever. If a build fails with `"./ui.css" is not exported` or `game.realtime` is missing, your `package.json` still points at an old `azet-games-sdk-<version>.tgz`: change it to the current version from `/downloads/index.json` (or create the game again) and run `npm install`. The same when `playBot`, `online` or `game.invite` is missing.
- **Multiplayer after a publish.** A table code is shared across game versions: after a publish, every player reloads and starts a new table ([Game services](game-services.md#multiplayer)).
- **Realtime "unavailable".** One network address can hold at most 500 realtime connections (and 10 that are still connecting); every open game holds one. A whole office behind one address shares that limit. Tell the organizers if players get `unavailable` while others play.
- **Keep the top corners free.** While the game runs the shell draws the round „← Späť na hry“ arrow in the top left corner and its pause button in the top right (44 px each, 8 px in, so about 60 × 60 px each). `pauseButton: false` frees the right one (draw your own and call `game.pause()`), `backButton: false` the left one (the way out stays on the pause screen). The UI kit's `.azg-hud` sits between them (it keeps both 60 px free, also without the pause button).
