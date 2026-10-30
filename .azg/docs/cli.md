# `azg` CLI

`azg` (package `@azet/games-cli`) does everything the CMS does, through the same API. People and agents use the same commands; what a caller may do depends only on its token.

## Install

The CMS serves the CLI itself (D-34); no npm registry or token is needed, only the VPN and Node.js 22+:

```bash
npm i -g --allow-remote=all https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz
azg login                     # browser device flow against that CMS
azg tenant use azet-hackathon
```

`--allow-remote=all` is for npm 12, which refuses packages from a URL without it (`EALLOWREMOTE`); npm 11 only warns that it does not know the option. Games scaffolded by the CLI, starters from the CMS and `azg backend add` write an `.npmrc` with `allow-remote=all` for the same reason, so `npm install` in the game works with npm 12 too (D-89). A game created before CLI 0.3.14 needs that line added to its `.npmrc` by hand.

**`EACCES: permission denied` (macOS, Linux):** the global npm folder belongs to root. Do not use `sudo`; either run the CLI without installing it,

```bash
npx -y -p https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz azg login
```

or move npm's global folder into your home once and install again:

```bash
mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc   # bash: ~/.bash_profile
export PATH="$HOME/.npm-global/bin:$PATH"
npm i -g --allow-remote=all https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz
```

A CLI installed from a CMS talks to that CMS by default (the URL is baked in when the image is built). Update by running the same `npm i -g --allow-remote=all …` again; `azg --version` shows the version. Games scaffolded by this CLI depend on the same CMS's tarballs (`…/downloads/azet-games-sdk-<version>.tgz`), so `npm install` in a game works without a registry too.

**Update notice (CLI-9).** After `azg login`, `whoami`, `publish` and `games create` the CLI asks the CMS which CLI and SDK it serves (`/downloads/index.json`) and prints one line to stderr when yours is older:

```
! A newer azg is available: 0.3.15 → 0.3.19 (SDK 1.8.0). Update: npm i -g --allow-remote=all <cms>/downloads/azet-games-cli.tgz
```

`azg publish` also says when the game uses an older SDK (with `npm i <cms>/downloads/azet-games-sdk-<version>.tgz`, or for the html template `curl -o azet-games-sdk.js <cms>/downloads/azet-games-sdk.js`). `azg games create` always starts a game on the platform's current SDK, even with an older CLI. The check never fails a command, waits 2 s at most and stays off stdout, so `--json` output is unchanged; `AZG_NO_UPDATE_CHECK=1` turns it off.

Inside the monorepo, `npm run azg -- <command>` runs the TypeScript sources; `npm run pack` (`scripts/pack-packages.mjs`) builds the same tarballs into `dist-packages/` (served by `npm run dev` under `/downloads`).

## Global options

| Option | Env | Meaning |
|---|---|---|
| `--api <url>` | `AZG_API` | API base URL (default from `~/.config/azg/config.json`, else the CMS the CLI was downloaded from, else `http://localhost:3000`) |
| `--token <t>` | `AZG_TOKEN` | Bearer token (agents, CI) |
| `--json` | | Machine-readable output |

Global options may come before or after the command (`azg --json games list` or `azg games list --json`). A token is bound to one tenant; people with several memberships switch with `azg tenant use <slug>`.

**A token instead of `azg login`** (CI, agents, a machine without a browser): `export AZG_TOKEN=azg_…` and every command uses it; `azg login` and `azg tenant use` are not needed. The docs and `CLAUDE.md` that `azg login` offers are then not written: run `azg ai setup` yourself.

Exit codes: `0` ok · `1` usage error · `2` validation failed · `3` unauthorized or forbidden · `4` not found · `5` conflict · `6` proposal created (change pending approval) · `10` server or network error.

## Commands

### Account

| Command | Does |
|---|---|
| `azg login [--no-browser] [--ai \| --no-ai]` / `azg logout` | Device flow login (`--no-browser` only prints the URL to open); token stored in the OS keychain (file fallback). Afterwards it asks whether to prepare the folder for Claude Code / an AI assistant (`azg ai setup`); `--ai` does it without asking, `--no-ai` skips it |
| `azg whoami` | User or token, tenant, scopes |
| `azg tenant use <slug>` | Switch tenant (people only) |
| `azg api ops` | Operations the current token may call |
| `azg api call <method> <path> [--data <json\|@file.json>] [--file <path> [--type <mime>]] [--out <file>]` | Call **any** endpoint of [API](api.md) with the stored login or `AZG_TOKEN`, for everything without its own command: leaderboards, badges, challenges, tournaments, leagues, moderation, players, events export, game assets, external games, economy, teams. `<path>` is relative to `/api/v1` (`/leaderboards` = `/api/v1/leaderboards`); a full URL is refused, so the token only goes to the configured CMS. `--data` sends JSON, `--file` sends the file as the raw body (type from the extension: png, jpg, webp, svg, zip, csv, json, yaml), and `--out` saves the answer (CSV exports, images). It prints the JSON answer; with `--json` it prints `{ status, body, savedTo }`. Exit codes are the same as for every command (`6` = the write became a proposal in a production tenant). Examples: `azg api call GET /leaderboards`, `azg api call POST /badges --data @badge.json`, `azg api call PUT /games/snake/assets/icon --file icon.png`, `azg api call GET "/tournaments/halloween/winners?format=csv" --out winners.csv` |

### Documentation and AI assistants (HLP-3)

| Command | Does |
|---|---|
| `azg docs` | The CMS documentation: slug, title and summary of every document |
| `azg docs <slug>` | One document as Markdown (e.g. `azg docs hackathon`, `azg docs admin`) |
| `azg docs pull [--dir .azg/docs]` | Download every document as Markdown |
| `azg ai setup [--dir .]` | `docs pull` into `.azg/docs/` plus `CLAUDE.md` and `AGENTS.md` that tell Claude Code (or Codex, …) what to read first and the platform rules; an existing file keeps its content, the azg block between `<!-- azg:start -->` and `<!-- azg:end -->` is replaced |

### Developing a game

| Command | Does |
|---|---|
| `azg games create --name <n> [--slug <s>] [--team <t>] [--template <html|vanilla-ts|react|vue|phaser|pixi>]` | Register the game (draft) and create the folder `<slug>/` from the template (default `vanilla-ts`); it prints the preview URL and saves the deploy token to `<slug>/.azg/deploy-token` (mode 600, added to `.gitignore`, never printed; `--json` gives `deployTokenFile`; only for CI, a logged-in `azg publish` does not need it). The slug is part of the game's address and cannot be changed later. `html` has no build step: `index.html` + `azet-games-sdk.js` + `AI-PROMPT.md`. A GitLab repo is created only when the CMS has GitLab configured; for a backend on the hackathon you create the project in `rin-apps/azet-games-hry` yourself ([Own backends](capabilities.md#own-backends-on-the-cluster)) |
| `azg dev [--backend] [--dist <dir>] [--game-url <url> [--game-cmd <command>]] [--host [address]]` | Run the game in the local dev shell (brand switcher Azet, Koktejl and Halloween, light and dark, fake player, viewport presets up to „wide desktop (1440)“ to try the manifest's `window`, WIN-2); `--host` opens it on the network for a phone on the same Wi-Fi (on a phone the game fills the screen and the tools open from the „azg“ button in the bottom left corner, SDK-4.4): shell and game use the computer's LAN address (or the one given), and a `vite` game command gets `--host 0.0.0.0`; open the printed address, also on the computer (not localhost). Plain http on a LAN address is not a secure context, so browser APIs that need https (clipboard) may not work there; `--game-url` puts the game's own dev server (Vite) in the shell instead of a build, and `--game-cmd` starts that server too and stops it with the shell (the build templates' `npm run dev:azg` is `--game-url http://localhost:5173/ --game-cmd "vite --port 5173 --strictPort"`, so it is the one command to run); with `--game-url` alone and nothing answering there, it says to start `npm run dev`; `--backend` also runs `backend/` on the host (Node: `node --watch`; Python: `uvicorn --reload` in `backend/.venv`, created on first run with the newest `python3.x` ≥ 3.11 on PATH; with only an older Python, for example the macOS system 3.9, it stops with an install hint, and a `.venv` from an old Python is refused with "delete backend/.venv") and its Postgres in Docker. The dev shell logs every event in its event log and warns on a `track()` of an event or prop not declared in `events:`. With `realtime:` in the manifest the dev shell runs the realtime room engine in memory (RTM-10): open it in two tabs to play against yourself. `dev` and `contract` serve the folder of `entry` in `azet-game.yaml` (`dist/` for build templates, the project folder for `html`); `--dist` overrides it |
| `azg validate` | Validate the manifest (including `events:`, docs/EVENTS.md), assets and SDK version |
| `azg contract [--dist <dir>]` | Run the contract test locally (same as CI): headless Chromium, the real shell, `ready()` within 10 s, starts on Play, no console errors, no calls outside the games origin + `network.allow`. Needs Playwright in the game project (`npm i -D playwright && npx playwright install chromium`); a global `azg` loads it from there |
| `azg publish [--kind release|preview] [--version v] [--activate]` | Upload the build output as a new version and print its preview URL (CI uses this). Never uploads `node_modules` or hidden files; for a game without a build step also not the project files at the root (`azet-game.yaml`, `package.json`, `README.md`, `AI-PROMPT.md`, `backend/`, …), the same rule as the zip upload |
| `azg backend add [--db postgres|none] [--lang node|python]` | Scaffold `backend/` and add it to the manifest. `node` (default) verifies player tokens with `@azet/games-server`; `python` is a FastAPI starter with the same endpoints (`/health`, `/scores`) and token rules (`azg_auth.py`), a Dockerfile and pytest tests |
| `azg backend set-url <slug> <url\|none>` | Register the URL the CMS uses to reach a backend you host yourself (`PUT /games/{slug}/backend`); `none` removes it. Not needed on rin-apps: `backend deploy` registers the URL |
| `azg backend deploy [slug] --image <ref> --digest sha256:<hex>` | Deploy the backend image CI pushed (rin-apps, D-76): the CI job of `ci/backend.yml` prints this command with the image and digest; run it on your laptop on the VPN. The slug defaults to `id` in `azet-game.yaml`, which must declare `backend`. `POST /games/{slug}/backend/deploy` with `{ image, digest }`. The CMS accepts only `harbor.rintools.sk/communities/rin/azg-backend-<tenant>-<slug>` of the token's tenant and game. It writes `values/<tenant>/<slug>.yaml` in `rin-apps/rin-azet-games-backends` from the published manifest, pinned by digest, and registers `http://<slug>.azet-games-<tenant>.svc.cluster.local` as the backend URL. It prints `{ image, url, valuesPath, commit }` (`commit: null` = unchanged). Exit codes: `1` malformed digest, `2` the manifest declares no backend or the image is refused (`422`), `3` a token of another game, `4` unknown game |

### Managing games

| Command | Does |
|---|---|
| `azg games list` | Games in the tenant |
| `azg teams list` (or `azg teams`) | The tenant's teams with members and games; ● marks your team (TMS-1). `--json` gives `[{ name, member, members, games }]` |
| `azg games get <slug>` | Game, active version, configuration |
| `azg games set <slug> key=value …` | Change fields, for example `status=live access=logged-in settings.timeLimit=90 screens.start.title="Hraj!"` |
| `azg games enable <slug>` / `azg games disable <slug>` | Switch a game on (`status: live`) or off (`status: disabled`); the same `PATCH /games/{slug}` as `set status=…` |
| `azg games archive <slug> [--yes]` | Archive (soft delete): the game disappears from lists, the landing page and public play, its bundles are no longer served (the active version's files can answer from a cache for up to a minute) and its deploy token is revoked; its data is kept and the slug can be reused. Asks to type the slug back; without a terminal (agents, CI, `--json`) `--yes` is required, otherwise exit code `1` |
| `azg games restore <slug>` | Undo an archive |
| `azg games versions <slug>` | Version history |
| `azg games activate <slug> <version>` | Activate a version |
| `azg games rollback <slug> [--to <version>]` | Activate the previous (or given) version |
| `azg games stats <slug> [--range today|7d]` | Numbers |
| `azg games promote <slug> --to <tenant>` | Promote a game |

In production tenants an agent token's `enable`, `disable` and `archive` create a proposal (exit code `6`), like every other write. `restore` has no proposal path: an agent token in a production tenant is refused (exit code `3`) and a person has to restore the game.

### Appearance and landing

| Command | Does |
|---|---|
| `azg theme get` / `azg theme set primary=#1273ea radius=12 …` | Tenant theme draft |
| `azg theme publish` | Publish the theme |
| `azg landing show` | Landing page draft as a table |
| `azg landing place <slug> --section <id> [--size small|medium|large] [--order n] [--label <text>]` | Place or move a tile |
| `azg landing remove <slug> --section <id>` | Remove a tile |
| `azg landing publish` | Publish the landing page |

### Config as code

| Command | Does |
|---|---|
| `azg config pull [-o file.yaml]` | Whole tenant configuration as YAML |
| `azg config diff file.yaml` | What would change |
| `azg config push file.yaml` | Apply (or create a proposal, exit code 6) |

### Administration

| Command | Does |
|---|---|
| `azg tokens list` / `create --name <n> --kind agent --scopes games:read,games:write [--games a,b] [--expires 90d]` / `revoke <id>` | Tokens |
| `azg members list` / `add <email> --role team --team <t>` / `remove <email>` | Members |
| `azg proposals list` / `approve <id>` / `reject <id>` | Proposals |
| `azg audit [--target <slug>] [--limit 50]` | Audit log |

## Config file format

```yaml
tenant: azet-hackathon
theme:
  mode: light
  colors: { primary: '#1273ea', accent: '#ffa10f' }
  font: { family: Excon }
  radius: 12
landing:
  sections:
    - id: today
      title: Dnešné hry
      tiles:
        - { game: word-snake, size: large, label: Nové }
        - { game: daily-quiz, size: medium }
games:
  word-snake:
    status: live
    access: everyone
    settings: { wordLength: 5, timeLimit: 90 }
    screens:
      start: { enabled: true, title: Slovný had, button: Hrať }
      end:
        sections:
          - { type: score }
          - { type: streak }
          - { type: next-game, target: daily-quiz }
    motivation: { sharedStreak: true, pointsMultiplier: 1, weeklyLeaderboard: true }
```

Versions, tokens, members and data are not part of the config document.
