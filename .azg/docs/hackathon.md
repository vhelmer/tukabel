# Hackathon guide

Build a game, push it, play it on Azet. This page is everything a team needs; the deeper docs are linked at the end.

> **What works today?** [What you can use](capabilities.md) lists every feature (SDK calls, services, multiplayer, UI kit, backends) with its status, how to use it and its limits. Own game backends run on the cluster from a game repo in the GitLab group `rin-apps/azet-games-hry` ([Own backends on the cluster](capabilities.md#own-backends-on-the-cluster)).

Everything runs on the VPN. The CMS is at **https://azet-games-cms.rin.rinapps.dev**; its **Documentation** page (after you sign in) has this guide and the full reference, with copy-ready commands for this CMS. On the command line the same documents come with any login or token: `azg docs` lists them, `azg docs hackathon` prints one, `azg docs pull` saves them all.

**Getting in and your team.** Sign in with your company e-mail (`@ringier.sk`, `@azet.sk`) and the access code from the organizers: you are in the hackathon right away. Set your own password (the CMS asks; from then on only your password works). Then **create your team**, or open the invite link a teammate sent you. Under **My team** you copy the team's invite link for your colleagues; everyone in the team sees and changes the team's games. If you left your team and were its last member, create it again under the same name (a team with games stays: ask the organizers for its invite link).

**Play as yourself.** On the hackathon games page press **Prihlásiť sa** → **Prihlásiť sa cez CMS účet**: you play with your CMS account, no other name or password (if you are not signed in to the CMS, you sign in there first and come back). In the admin your player is marked **Team**, and members of the tenant get no tournament prizes ([Admin guide](admin.md#1-people-and-roles)). „Prihlásiť sa testovacím Azet účtom“ is for rin-oauth test accounts only.

**What you need.** A laptop on the VPN. For the CLI: **Node.js 22 or newer** (`node --version`; install from https://nodejs.org). Without programming you need only the browser.

There are two ways to make a game. Both end the same way: an immutable version in the CMS, played inside the Azet shell.

## Without programming (15 minutes)

| Step | Where | What happens |
|---|---|---|
| 1. Add the game | CMS → **Games → Add game → Start without programming**, type the name | The game exists (draft) and the dialog shows the next 3 steps |
| 2. Get the starter | **Download .zip** in the dialog (or the game's **Upload** tab) | A small working game: `index.html`, `azet-games-sdk.js`, `azet-game.yaml`, `AI-PROMPT.md` |
| 3. Make it yours | Paste `AI-PROMPT.md` (or **Copy the AI prompt** in the Upload tab) into ChatGPT or Claude, add what game you want, save the answer into `index.html` (and `azet-game.yaml`) | The prompt carries all platform rules, so the game fits the shell |
| 4. Upload | Zip the folder → game → **Upload** tab → **Upload game** | The CMS checks the package, explains problems in plain words, and publishes a new version |
| 5. Play and go live | **View game**; when happy, switch it **On** in the games list (status Live) | Players see it on the hackathon page, in „Hry tímov“ |

**Already have the game as a .zip?** (with `azet-game.yaml` inside, e.g. from an AI assistant or a teammate) **Games → Add game → Upload a finished game (.zip)**: the CMS reads the name and id from `azet-game.yaml`, adds the game and publishes it in one step, live at once if you tick it. **With code?** **Add game → Build with code (CLI)** shows the `azg` commands with your game's name filled in (next section).

Every upload is a new version (1.0.0, 1.0.1, …); older ones stay and can be activated again.

## With the CLI (15 minutes to a live game)

| Step | Command | What happens |
|---|---|---|
| 1. Install the CLI | `npm i -g --allow-remote=all https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz` | `azg` is available and talks to the hackathon CMS (Node.js 22+) |
| 2. Log in | `azg login` | Your browser opens; confirm the code, pick **Azet Hackathon**. Answer **Y** to prepare the folder for Claude Code: it downloads these docs into `.azg/docs/` and writes `CLAUDE.md`, so your AI assistant knows the platform (later: `azg ai setup`) |
| 3. Register | `azg games create --name "Môj had" --template phaser` | The game exists in the CMS (draft), the folder `moj-had/` is created from the template, and you get a preview URL. The deploy token is saved to `moj-had/.azg/deploy-token` (git-ignored, never printed): you don't need it while you are logged in, it is only for CI outside the hackathon. The slug (`moj-had`) is part of the game's address and cannot be changed later; the name can |
| 4. Run it | `cd moj-had && npm install && npm run dev:azg` | The game runs inside the real Azet shell on http://localhost:5170. On your phone: `npm run dev:azg -- --host` (`azg dev --host` for `html`) and open the printed address on the same Wi-Fi: the game fills the phone's screen, the dev tools are behind the „azg“ button in the bottom left corner. The toolbar switches brand (Azet, Koktejl, Halloween), light and dark, and viewports |
| 5. Ship it | `npm run build && npx azg publish --activate` (with your login, on the VPN); the first time also `azg games set moj-had status=live`. On the hackathon you always publish from your laptop: a `git push` only builds a backend image ([Own backends](capabilities.md#own-backends-on-the-cluster)) | A new version is active; once the game is Live, players find it on the hackathon page in „Hry tímov“ (until the organizers place it elsewhere) |

Templates: `html` (no build), `vanilla-ts`, `react`, `vue` (Vue 3, single-file components), `phaser`, `pixi`. Every template is a small working game you can change. `npx azg contract` runs the same contract test as CI (needs `npm i -D playwright && npx playwright install chromium` in the game). The `html` template has no npm scripts and no local CLI: run the installed `azg dev`, `azg contract` and `azg publish` in its folder (`npx azg` would look for an unrelated npm package).

Developers can also use the upload: `npm run build`, zip the project (with `dist/`) and upload it in the CMS – the CMS publishes only the build output, like `azg publish`.

## The SDK in one screen

```ts
import { game } from '@azet/games-sdk';

const ctx = await game.init();      // settings, daily level seed, theme, player
game.ready();                        // assets loaded – the shell hides its loading screen
game.onStart(() => start());         // the player pressed Play
game.onPause(() => pause());         // tab hidden or pause button
game.onResume(() => resume());
game.progress({ step: 3 });          // optional
game.track('powerup', { kind: 'x' }); // optional analytics, declared under events:
game.complete({ score, timeSeconds, success: true }); // the shell shows score, streak, ranking
```

- **Do not build** a start screen, end screen, login, leaderboard or streaks: the shell does that for every game. To show them inside the game, read them with the game services (below).
- **Leave the top corners free:** while the game runs, the shell draws the round „← Späť na hry“ arrow in the top left corner and its pause button in the top right (44 px buttons, 8 px from the edges, about 60 × 60 px each). Put your own HUD between or below them (the UI kit's `.azg-hud` does). Need the right corner, or a pause button in your look? `pauseButton: false` in `azet-game.yaml` and `game.pause()` from your own button. Your game has its own „Späť“ (a hub)? `backButton: false` takes the arrow off the running game; „← Späť na hry“ stays on the pause screen. The end screen after `complete()` shows the score first, then the streak, daily challenge and weekly board, and the buttons „Hrať znova“, „Zdieľať výsledok“ and „← Späť na hry“, all in the tenant's look (D-73).
- **„Hrať znova“ starts the next round in the same page:** `onStart` runs again without a reload. Reset all round state (score, timers, a „done“ flag) in `onStart`, not at load, or the second `complete()` never comes.
- **Daily levels:** `ctx.level.seed` is the same for every player today. Seed your random generator with it.
- **Theme:** use the `--azg-*` CSS variables (`--azg-primary`, `--azg-background`, `--azg-text`, …) or `ctx.theme`; the game then fits Azet and Koktejl automatically.
- **Settings:** add them to `azet-game.yaml` → they appear as a form in the CMS → you read them from `ctx.settings`. No rebuild needed to change them.
- **Saving data:** `await game.store.player.set('save', data)` (per player) or `game.store.shared` (per game).
- **Coins and a shop:** declare `currencies`, `items` and `earn` in `azet-game.yaml`; the platform credits coins after a valid result, the game reads `game.wallet.get()` and buys with `game.shop.buy('<item>', { key: crypto.randomUUID() })`. The game cannot give coins itself. See [GAME-SERVICES.md](game-services.md) "Currency and shop" and the Had game.
- **Own backend:** `npx azg backend add --db postgres` (Node) or `npx azg backend add --db postgres --lang python` (FastAPI, needs Python 3.11+), then `await game.api.fetch('/scores')`. Run both with `npx azg dev --backend`. The backend must verify the player token on every request: the template does it already (`@azet/games-server` or `backend/azg_auth.py`). On the cluster it runs from your game repo in the GitLab group `rin-apps/azet-games-hry` ([What you can use](capabilities.md#own-backends-on-the-cluster)).

## Game services

Want your own leaderboard panel, the player's nickname or points inside the game? Use the platform's instead of building them, so they match the shell and count everywhere ([Game services](game-services.md)):

```ts
const top = await game.leaderboards.get('default', { limit: 5 }); // or a board from `leaderboards:` in azet-game.yaml
const me = await game.player.get();                                // nickname, points this week, rank, streaks
await game.player.setNickname('Zuzka');                            // anonymous players
```

- Scores reach leaderboards **only** through `game.complete()` (or your backend's `submitResult`). There is no way to submit a score from the browser, by design.
- `game.store.player` / `game.store.shared` are your cloud save: save slots, a daily state, shared counters.
- The `html` and `vanilla-ts` templates have a `showTop()` panel; `games/snake` shows a Top 5 and the nickname field. Everything works offline in `npx azg dev` with sample players.
- **Turn-based over days** (piškvorky, chess, a word duel): `matches:` in azet-game.yaml and `game.matches` — invite a friend with a 6-character code or `quick()` pairing, `move()` passes the turn, a missed turn loses by forfeit, several matches at once, and each player's result counts like a play when the match ends ([Game services](game-services.md#matches)). Live play while both are online is `game.realtime`; a game can use both. Example: `games/piskvorky-async`.
- **One play, one result.** The first `game.complete()` of a play counts; a second one returns the first. A game with rounds reports once, at the end.

## UI kit

Buttons, a HUD, panels and dialogs that look like Azet in every theme (light, dark, Halloween, every tenant), without designing them: plain CSS on the `--azg-*` variables, 44 px touch targets, no JavaScript, about 3 KB gzipped.

- `html` starter: `azet-games-ui.css` is in the package and linked in `index.html`.
- Build templates: `import '@azet/games-sdk/ui.css';` (the `vanilla-ts` template does it).
- Every component on one page: `packages/sdk/ui-demo.html` in the monorepo.

```html
<div class="azg-hud"> <!-- between the shell's back arrow (top left) and pause button (top right) -->
  <span class="azg-hud__item"><span class="azg-hud__label">Skóre</span> 120</span>
  <span class="azg-hud__item"><span class="azg-hud__label">Čas</span> 0:42</span>
  <span class="azg-hud__item azg-lives" aria-label="2 životy"><span aria-hidden="true">♥</span><span aria-hidden="true">♥</span><span aria-hidden="true" data-lost>♥</span></span>
</div>
<section class="azg-card azg-stack">
  <h2 class="azg-title">Obtiažnosť</h2>
  <div class="azg-segmented" role="radiogroup" aria-label="Obtiažnosť">
    <label><input type="radio" name="level" checked /><span>Ľahká</span></label>
    <label><input type="radio" name="level" /><span>Ťažká</span></label>
  </div>
  <progress class="azg-progress" value="3" max="10" aria-label="Postup"></progress>
  <div class="azg-row">
    <button class="azg-btn">Hrať</button>
    <button class="azg-btn" data-variant="secondary">Nápoveda</button>
    <button class="azg-icon-btn" data-variant="ghost" aria-label="Zvuk">🔊</button>
  </div>
</section>
<dialog class="azg-dialog" id="quit" aria-labelledby="quit-title"> <!-- quit.showModal() -->
  <h2 class="azg-title" id="quit-title">Naozaj skončiť?</h2>
  <form method="dialog" class="azg-dialog__actions"><button class="azg-btn" data-variant="ghost">Späť</button></form>
</dialog>
<div class="azg-toasts" role="status" aria-live="polite"><div class="azg-toast" data-open data-tone="success">+10 bodov!</div></div>
```

| Component | Markup | Variants |
|---|---|---|
| Button | `<button class="azg-btn">` | `data-variant="secondary" \| "ghost" \| "danger"`, `data-size="sm" \| "lg"`, `data-block` |
| Icon button | `<button class="azg-icon-btn" aria-label="…">` | `data-variant="primary" \| "ghost"` |
| Card / panel | `.azg-card`, `.azg-panel` (solid, with a shadow) | `.azg-title`, `.azg-muted`, `.azg-row`, `.azg-stack` inside |
| Dialog | `<dialog class="azg-dialog" aria-labelledby="…">` + `<form method="dialog" class="azg-dialog__actions">` | open with `showModal()`; buttons inside the form close it without JS |
| Toast | `.azg-toasts[role=status][aria-live=polite] > .azg-toast[data-open]` | `data-tone="success" \| "danger"`; remove `data-open` to hide |
| HUD | `.azg-hud > .azg-hud__item` (+ `.azg-hud__label`), `.azg-lives` with `[data-lost]` | `data-tone="danger"` on an item (time running out) |
| Progress | `<progress class="azg-progress" value max aria-label="…">` | `data-tone="success" \| "danger" \| "accent"` |
| Segmented control | `.azg-segmented[role=radiogroup][aria-label] > label > input[type=radio] + span` | – |
| List | `<ol class="azg-list"><li>… <span class="azg-list__meta">…</span></li>` | `aria-current` on the player's row |
| Badge / chip | `.azg-badge` (label), `<button class="azg-chip" aria-pressed>` (toggle) | `data-tone="primary" \| "accent" \| "success" \| "danger"` |
| Ad placeholder | `<div class="azg-ad-slot"></div>` (300 × 250, label „Reklama“) | `data-size="320x100"` |

`.azg-ad-slot` is **only a placeholder** that shows where an ad could go: no ad code, no third-party scripts (the games CSP blocks them anyway). Monetization is out of scope for the hackathon.

## Data about your game

**You get for free**, with no code: sessions (how players arrived, device, signed-in or not), loading time, plays started and finished, abandoned plays, pauses, replays, shares, challenges, leaderboard opens, badges and errors. They feed the statistics in the CMS. The full list is in the [event catalog](events.md).

**You can add** what is specific to your game: call `game.track('word', { word, words })` at moments worth counting and declare the event under `events:` in `azet-game.yaml` (name, description, props). `azg dev` warns about events you forgot to declare. Never put personal data (e-mail, phone, names) in props: such events are dropped.

## Rules your game must follow

| Rule | Why | Checked by |
|---|---|---|
| Call `game.ready()` within 10 s | Otherwise players see an error screen | `azg contract`, CI |
| No calls to other domains (unless listed in `network.allow`) | Player privacy and security | CSP + `azg contract` |
| No `eval()` / `new Function()` | Blocked by the games origin CSP | Browser |
| No cookies or `localStorage` | The game runs on an opaque origin; use `game.store` | Browser |
| Scores within `scoring.min`–`max`, a play longer than `scoring.minSeconds` (default 3 s; **for speed games such as Míny or reaction games set `minSeconds: 1`**) | Fair leaderboards | Server |
| Currency is earned only by `earn:` rules or your backend, never by the game | No free coins from a tampered client | Shell + server |
| Bundle under 5 MB (hard limit 20 MB) | Mobile players | CI (warning), upload |
| Mobile and touch first: plays on a 360 px wide phone, every control works with a finger (44 px targets, no hover-only actions, no keyboard-only controls), fits the frame without page scrolling | Most Azet players are on phones | `azg dev` viewport presets, review |
| Content within the [content rules](#content-rules) | Azet is a family brand with advertisers | Review at promotion |
| Licensed assets and libraries only | We may put winners on Azet | Review at promotion |

### Content rules

Draft, until the organizers confirm it.

- **Not allowed:** sexual or nude content (no NSFW), gambling with real money or anything that looks like a casino with real stakes, hate, discrimination or mocking of groups, drugs, real weapons as a theme, self-harm, realistic gore, real people or brands without permission, political campaigning.
- **Fine:** cartoon or arcade violence (bumping, defeating monsters, zombies, a skeleton falling apart), Halloween horror without gore, competitive and timed games, humour that does not target people.
- **Text for players** is in Slovak, polite, no swearing. Player nicknames are moderated by the platform.
- When unsure, ask the organizers before you build it.

## Multiplayer patterns

How to build the usual multiplayer flows on the platform (RTM-17). Live play is `game.realtime` (rooms in memory, for one sitting); play over hours or days is `game.matches` (stored in the CMS). Both are in [Game services](game-services.md).

| You want | Use | Watch out |
|---|---|---|
| **Invite a friend** | `game.realtime.create()` → show `room.id` (6 characters) and a „Pozvať odkazom“ button: `game.invite.link({ room: room.id })`; the friend's game gets `ctx.invite.room` and joins it at start (`join(code, { create: false })`) | A mistyped or old code rejects with `not_found`. Nobody came within `waitSeconds` (default 2 min): `close` reason `expired`, tell the host and offer to invite again |
| **Random opponent** (queue) | `game.realtime.quickMatch({ players: 2, timeoutSeconds: 60, signal })` | Show "Hľadám súpera…" with a cancel button (`signal`); `timeout` when nobody comes; leaving the page cancels the wait. With `realtime.bots.after` a bot takes the seat instead of a timeout |
| **Nobody to play with** | A **bot**: `realtime.bots` + `game.realtime.playBot({ level: 'easy' })`; the referee moves for it (`room.bots`) | Practice: never counts for points or boards; say so on the screen („Tréning s botom“). **Bots need your own backend as the referee** (`azg backend add`, `realtime.authority: referee`, `createReferee` that moves for `room.bots.ids`), locally `azg dev --backend`, on the cluster a deployed backend. Without a connected referee `playBot` rejects with `unavailable`. Plan half a day |
| **Show who plays** | `room.members[i].nickname` and `.profile` (`level`, `gameLevel`, `week`, `rank`), verified by the platform | Every player in a room has a nickname (the shell asks); bots have `bot: true` and no profile |
| **Lobby with a live count** | `game.realtime.online` + `game.realtime.onPresence(n => …)` for „Práve hrá 23 hráčov“. The shell connects every game session when the game is ready, so the number is there from the start (`connect()` only waits for that connection) | A number only, never who; updates at most every 5 s; `null` before the first connection |
| **Copy or share the code** | A „Kopírovať kód“ button with `navigator.clipboard.writeText(room.id)` (the game frame may write the clipboard); select the code as a fallback | Copy only on a tap; reading the clipboard is not allowed |
| **Lobby** before the game starts | A room with a `phase: 'lobby'` in its state; players mark ready, the host (or the referee) switches to `playing` | `room.host` changes when the host leaves (`host` event); only the host starts |
| **Turns** (piškvorky, cards) | A **referee** (`realtime.authority: referee`): the backend keeps the board and whose turn it is and refuses wrong moves | Without a referee any browser can cheat; with `stateWrites: host` the host's browser is the authority, which is fine for casual games |
| **A player drops out** | They have 15 s to come back (same member id); then the others get `leave` (`disconnected`) | Decide the rule: forfeit (the referee or the host ends the game), wait, or play on. Never leave the others on a frozen screen |
| **Rematch** | After the end screen „Hrať znova“ starts a new play: `create()` a new room or `quickMatch` again | A play keeps one result; a new round in the same play does not count again |
| **Several games at once**, play over days | `game.matches` (asynchronous turn-based): invite code, `move`, `list()` of open matches, turn timeouts with forfeit | A game session is in one realtime room at a time, and the room ends with the sitting |
| **Scores you can trust** | Each player's own `complete()`; with a referee, `room.end({ results })` in the backend and the game's `complete()` after `close` `ended` | One play keeps its first result (SDK-CONTRACT "One result per play"): report once, at the end. In a referee game the score the browser sends is ignored: only the referee's result counts. Still call `complete()` after `ended`, so the shell shows the end screen with that result; called earlier, it stores nothing and returns `refereePending: true` (REF-7) |
| **Your own levels** | `progression:` in the manifest (points, plays or a metric; level starts and titles) → `game.player.get().gameLevel`, also in every member's `profile` | Computed by the CMS from counted plays; the platform level (`level`) is the same in every game |

Play the examples on the hackathon page; their source is in the CMS repository (ask the organizers for read access): `games/tap-race` (quick match and invite code, host-driven race), `games/piskvorky` (referee: invite, turns, move clock, forfeit, both results from the backend, an easy and a hard bot, players online, „Ty vs Zuzka · level 7“, copy the code, own levels Nováčik → Veľmajster). The CMS shows a game's live rooms under **Games → game → Multiplayer**.

> **„Level“ means four things.** Keep them apart:
> - **Platform level** (`player.get().level`, `profile.level`): from the player's lifetime points in the tenant, the same in every game (level n from 50·n·(n−1) points, max 99). The platform computes it; the game only shows it.
> - **Game level** (`player.get().gameLevel`, `profile.gameLevel`): your game's own levels and titles from `progression:` in the manifest.
> - **Daily level** (`levels.mode: daily`, `ctx.level.seed`): the same puzzle for everyone today.
> - **Bot level** (`realtime.bots.levels`, `playBot({ level })`): how strong the bot plays, e.g. `easy`, `hard`.

## Questions developers ask

| Question | Answer |
|---|---|
| Is there a shared API for scores, saves and world state? | Yes. Scores go only through `game.complete()` (or your backend's `submitResult`) to the leaderboards. Progress, save slots and daily state go to `game.store.player`; state shared by all players of the game (a world counter, a community goal) to `game.store.shared` (JSON up to 16 KB per key, `incr` for counters). See [Game services](game-services.md). |
| Realtime multiplayer? | Yes, on the hackathon tenant (not yet on Azet and Koktejl), without your own server: add `realtime:` to `azet-game.yaml` and use `game.realtime` (rooms by id or quick match, presence, messages, a small shared state, up to 50 players a room). Every player in a room needs a nickname; the shell asks for one. Try it with `azg dev` in two browser tabs; `games/tap-race` is a complete two-player example. Invite by code with `create()`; for games that must not trust the browsers make your backend the referee (`games/piskvorky`). See [Multiplayer patterns](#multiplayer-patterns) and [Game services](game-services.md) "Multiplayer". |
| Can I run a tournament of my game (say an hour-long blitz)? | Yes: CMS → **Tournaments** → **New tournament**, over your team's games (also before the game is live, to try it). Pick the window, the metric (`score`, a metric your game declares, or `points`) and write the rules; **Publish** puts it on `/turnaj/<slug>` and in `game.tournaments.get()`. Results from a referee backend count, games against bots do not. For prizes ask the hackathon admins ([Admin guide](admin.md#10-tournaments)). |
| Can my game have its own backend? | Yes, locally with `azg dev --backend` and on the cluster from a game repo in the GitLab group `rin-apps/azet-games-hry` ([What you can use](capabilities.md#own-backends-on-the-cluster)). `azg backend add` (Node or Python, optional Postgres). Backends run in our cluster next to the CMS; `game.api.fetch()` reaches them through the platform proxy. On a push to the default branch, CI (`ci/backend.yml`) builds `backend/` into Harbor and prints the `azg backend deploy` command you run on your laptop on the VPN. Your backend runs read-only and non-root, with at most 0.5 CPU / 512 MB and only `/tmp` writable. It has no internet access: data goes to its own Postgres schema, and secrets go to Vault (ask the organizers) and are declared in `backend.secrets`. See [Manifest](manifest.md#backend). |
| Shared UI, look and feel? | The shell already draws the start and end screens, pause, login, sharing and challenges in the tenant's look. Inside the game use the theme variables (`--azg-primary`, `--azg-background`, `--azg-text`, …, [SDK contract](sdk-contract.md)) so light, dark and Halloween work. For buttons, dialogs, the HUD and toasts use the [UI kit](#ui-kit) (`azet-games-ui.css`). |
| My game has several rounds (or two players) and only the first score counts? | One play keeps one result: the first `game.complete()` counts, later ones are ignored (with a console warning). Keep the score in the game and call `complete()` once, after the last round; in multiplayer every player reports their own result. Only signed-in players and players with a nickname are ranked. See [SDK contract](sdk-contract.md#one-result-per-play-rtm-16). |
| My game is a room or a menu with many mini games; the end screen after every round is in the way? | Set `endScreen: compact` in `azet-game.yaml`: after each round the shell shows a small result card over the game and starts the next play at once, and `game.onResult()` tells the game the points and coins it got (at most 60 counted rounds of a player an hour). One metric, board and earn rule per mini game (up to 100 metrics and boards, 40 earn rules). Want your own result instead of the card? `endScreen: none`. See [Game services](game-services.md#a-hub-of-mini-games). |
| A link to an article from my game („Prečítaj si článok“)? | A plain `<a href>` or `window.open` does nothing in the game frame (sandbox). Call `game.openLink('https://www.azet.sk/…')` from the player's tap: the shell opens it in a new tab (or shows a button „Otvoriť článok ↗“ when the browser blocks the tab) and records `article_click`. Only `https://` on azet.sk and its subdomains (koktejl.azet.sk, …). |
| The end screen says „Hrať znova“, I want „Hrať ďalší level“? | `game.setReplayLabel('Hrať ďalší level').catch(() => {})` after a won level, before `game.complete()` (no need to wait for it); it holds until you change it, `null` brings back „Hrať znova“. The button starts the next play as before, so keep the level in `game.store.player` and start it in `game.onStart`. |
| Tilt the phone to steer? | The game frame allows the accelerometer and gyroscope. On iOS ask with `DeviceMotionEvent.requestPermission()` from a tap; Safari may still refuse inside a frame, so keep tapping left and right as a fallback. |
| Why does every play earn 50–100 points? | On purpose: the shared weekly board of the tenant rewards coming back and playing every day, not only skill, so players of every game meet on it (`round((50 + 50 × s) × multiplier)`, [Game services](game-services.md#points)). Skill gets its own board: declare it in `leaderboards:` of `azet-game.yaml` with `aggregation: best` on `score` or on a metric (e.g. the best time on Hard, a metric with `better: lower`) and show it in the game with `game.leaderboards.get('<id>')`. A game of skill should have one |
| Badges with two conditions (Hard **and** under 60 s) or „5 wins in a row“? | `rule: { all: [{ when: 'metric:difficulty', op: '>=', value: 3 }, { when: time, op: '<=', value: 60 }, { when: success, op: '>=', value: 1 }] }` and `rule: { when: winsInARow, op: '>=', value: 5 }`; send `success: true` or `false` in `complete()`. The server counts the run from the stored plays, so it is trusted ([Manifest](manifest.md#badges), CLI ≥ 0.3.16) |
| Languages? | Slovak only. `ctx.locale` is always `sk`; write player texts in Slovak. |
| Monetization, ads, payments? | Not part of the hackathon. The platform places Azet ads around the game. If your design needs a spot for an ad, use the UI kit's placeholder `<div class="azg-ad-slot"></div>` (a box labelled „Reklama“, 300×250, or `data-size="320x100"`). No ad code, no payments, no third-party scripts (the CSP blocks them). Virtual currency and a shop exist ([Game services](game-services.md)). |
| Performance limits? | `game.ready()` within 10 s, bundle under 5 MB (20 MB hard), aim for 60 fps on a mid-range phone; pause your loop on `onPause`. |
| Touch, responsive? | Required, see the rules above. Test with the viewport presets of `azg dev` (375 px phone to a 1440 px monitor). |
| My game needs more than the 560 px column on a computer (a 30×16 board)? | Say the window you want in `azet-game.yaml`: `window: { desktop: { width: full, aspect: "16:10" }, mobile: { aspect: free } }`. Width in px or `full`, shape `W:H` or `free`, separately for desktop and mobile; the play page, articles, the builder and `azg dev` follow it ([Manifest](manifest.md#window)). Without `window:` the 560 px column stays. The shell's buttons sit over the game's top corners (← top left, pause top right), so keep your score and HUD out of the top 60 px at the sides. |
| Where do the rules and controls go? | `howTo:` in `azet-game.yaml`, up to 8 short lines; the shell shows them under „Ako hrať“ on the start screen and in the pause. |
| Pictures in the rules (a gesture, the power-ups)? | Make a line `{ text: Potiahni prstom doľava., image: assets/howto/swipe.png }`: the picture shows left of the text at 80 × 80 px (svg, png, jpg, webp or gif; a square of 160 px looks sharp). `azg publish` and the zip upload take it along. The start screen itself stays the platform's (login, points, challenges), so the rules go there and not in a screen of your own. |
| The pause button covers my HUD, or I want my own? | `pauseButton: false` in `azet-game.yaml` removes the shell's button; draw yours and call `game.pause()` (SDK 1.10.0): the shell's pause screen opens and your `onPause` / `onResume` run as before. A hidden tab still pauses. |
| The game tile in the CMS has no icon after `azg publish`? | It shows the manifest's `assets.icon` and `assets.cover` from the newest upload, also before the version is active; an icon uploaded in the CMS (Appearance tab) overrides it. |
| My game runs on our own site; can it be on the games page? | Yes, as an external game: **CMS → External games → Add external game**, with the https URL (ideally with `?utm_source=azet_hry`), category, session length and a 16:9 cover (EXT-4). It belongs to your team; ask an admin to put it on the landing page. |
| My game loads slowly? | The platform sends your scripts compressed and covers as small WebP copies (PERF-1), so the rest is the bundle: build for production (`vite build`, no source maps in `dist`), keep pictures in WebP or JPEG at the size you draw them, load sounds and later levels after `game.ready()`, and keep big data out of the first script (one game shipped 1.4 MB of JavaScript). Look at the Network tab of the browser on a phone-sized window with „Fast 4G“. |
| Which teams exist, am I still in mine? | `azg teams list` (● is yours), or `azg api call GET /teams`. |
| `azg` says „A newer azg is available“? | Run the printed `npm i -g --allow-remote=all …`; `azg publish` also says when your game's SDK is older than the platform's. A new game from `azg games create` always gets the current SDK. |
| NSFW, violence? | See the [content rules](#content-rules). |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Hra sa načítava príliš dlho" | `game.ready()` is never called, or `game.init()` threw – check the browser console of the game frame |
| Game loads in Vite but not in the shell | Serve with CORS (`server.cors: { origin: '*' }` is in every template's `vite.config.ts`) and keep `base: './'` |
| `Refused to connect … Content Security Policy` | Add the origin to `network.allow` in `azet-game.yaml`, or go through your backend |
| PixiJS: "does not allow unsafe-eval" | Keep `import 'pixi.js/unsafe-eval'` at the top (the template has it) |
| "Výsledok sa nezapočítal – hra skončila príliš rýchlo" | The play was shorter than `scoring.minSeconds`; lower it in the manifest if your game is that fast |
| Upload: "The package belongs to another game" (`id_mismatch`) | The zip is another game's starter. Download this game's starter and move your files into it |
| Upload: "The main game file is missing" (`entry_missing`) | For build templates, run `npm run build` before zipping (`dist/` must be in the zip) |
| `npm i -g …azet-games-cli.tgz` fails to connect | You are not on the VPN |
| `npm i -g …` fails with `EACCES: permission denied` | The global npm folder belongs to root. Don't use `sudo`: run `npx -y --allow-remote=all -p https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz azg login`, or set `npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to `PATH` ([CLI](cli.md#install)) |
| Preview link without `?v=` says the game is not published yet | The game is a draft or has no active version. Open the link with `?v=<version>` (the page offers the newest), or activate a version and set `status=live` |
| `npm i` fails with `EALLOWREMOTE` (npm 12) | npm 12 refuses packages from a URL. Install the CLI with `npm i -g --allow-remote=all …`; in a game created before CLI 0.3.14 add the line `allow-remote=all` to `.npmrc` in the game folder ([CLI](cli.md#install)) |
| `azg contract` says Chromium is missing | `npx playwright install chromium` |
| `azg contract`: "Chromium does not start … system libraries are missing" (Linux, a container) | The browser's libraries (libnss3, libglib …) are not installed: `sudo npx playwright install-deps chromium`, or run it in an image that has them (`mcr.microsoft.com/playwright`) |
| Backend pod restarts or is never ready | `health` must answer 200 within 2 minutes of start, on `PORT`. Write only to `/tmp`, and do not call the internet |
| `azg backend deploy`: image refused (exit 2) | The image must be `harbor.rintools.sk/communities/rin/azg-backend-<tenant>-<slug>` of your game. Set `AZG_TENANT` in CI if your token is for another tenant |
| A `GameError` with a `code` you don't know | Every code, when it happens and the Slovak text to show the player: [SDK contract §7](sdk-contract.md#error-catalogue-hlp-5) |
| „Z tejto siete si teraz vybralo prezývku priveľa hráčov“ (`rate_limited`, `reason: 'flood'`) | One network address may create at most 200 new nicknames an hour on the hackathon (20 on Azet and Koktejl), and a whole office or the VPN is one address. Wait a while or tell the organizers |
| `azg publish`: 409 version exists | Versions are immutable: bump `version` in `package.json` |
| Build fails with `"./ui.css" is not exported`, or `game.realtime` is undefined | `package.json` still points at an old `…/azet-games-sdk-<version>.tgz` and npm keeps that file in its cache. Change it to the current version from `https://azet-games-cms.rin.rinapps.dev/downloads/index.json` and run `npm install` (D-79). The same fix when `playBot`, `online` or `game.invite` is missing |
| Multiplayer: `unavailable` while others can play | One network address holds at most 500 realtime connections (10 still connecting); every open game holds one. A whole office behind one address shares it: tell the organizers |
| `game.api.fetch()` throws `no_backend` on the hackathon host | The game's backend is not deployed (no game repo with `ci/backend.yml` yet, its CI has not finished, or `azg backend deploy` was not run; [What you can use](capabilities.md#own-backends-on-the-cluster)). Catch `GameError` `no_backend` and keep the game playable (as `games/snake` does). If your game waits for the backend before `ready()`, it stays on „Načítavam hru…“. Test the backend with `azg dev --backend` |
| Multiplayer: after a publish, players at the same table code see odd messages or state, or the old room size | A table code (`game.realtime.join('…')`) is shared across game versions, and a room keeps the `maxPlayers` / `stateWrites` of the version that created it until it closes (60 s after the last player leaves). After publishing, every player reloads and starts a new table. If you change the message or state format, put a small `v` field in it and ignore what you do not understand ([Game services](game-services.md) "Multiplayer") |

## Jury and organizers

- The CMS shows every game's players, completions, average time and return rate (Games → game → Prehľad).
- Each merge request gets a preview link; versions can be rolled back in one click.
- Winners are promoted to Azet as drafts (Games → game → promote); they go live after product review.

## Further reading

[What you can use](capabilities.md) · [SDK contract](sdk-contract.md) · [Game services](game-services.md) · [Manifest](manifest.md) · [Events](events.md) · [CLI](cli.md) · [API](api.md) · [Architecture](architecture.md)
