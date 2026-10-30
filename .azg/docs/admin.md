# Admin guide

How to set up and run a tenant, step by step: in the CMS admin and with the API (for scripts and AI agents). Every step names the admin page first and the API call second; the full reference is [API](api.md).

The CMS is at **https://azet-games-cms.rin.rinapps.dev/admin**. Sign in with your e-mail and **your own password**; the first time, use the shared access code (Vault `rin-apps/azet-games-cms`, key `LOGIN_PASSCODE`) and the CMS asks you to set a password (MEM-5, D-75). Change it later under your name → **Account and password**. Then pick the tenant in the header. Public pages live on the tenant's own host, e.g. **https://azet-games-hackathon.rin.rinapps.dev**.

## 1. People and roles

**Admin → Members.** Add a person by e-mail and give a role:

| Role | Can |
|---|---|
| `viewer` | Read everything, change nothing |
| `team` | Games: create, upload versions, activate |
| `product` | `team` + landing, looks, badges, challenges, leaderboards, tournaments, external games, moderation, statistics (in a sandbox tenant `team` runs the tournaments and external games of its own team, TRN-9, EXT-4) |
| `admin` | Everything, including members and tokens |

API: `POST /api/v1/members` `{ email, name?, role, team? }`, `PATCH /api/v1/members/{id}` `{ role?, team? }` (scope `members:write`).

**Let colleagues in without adding each one (sandbox tenants only, MEM-1).** Members → **Self-service access**: e-mail domains (the hackathon: `ringier.sk`, `azet.sk`) and a role (`team` or `viewer`). Anyone of these domains who signs in gets that role and no team yet. API: `PUT /api/v1/settings` `{ autoJoinDomains, autoJoinRole }` (scope `members:write`). Production tenants never let people in by domain.

**Teams (MEM-2, MEM-3).** A `team` member without a team chooses one first: **Create a team**, or **Join a team** with an invite link. Under **My team** a member copies the team's invite link (valid 7 days) and sends it to colleagues; **New link** makes earlier links stop working. **Rename team** changes the name everywhere at once: members, games and invite links keep working (MEM-3.5). When the last member leaves a team without games, the team is removed and its name is free again; a team with games stays and an editor invites someone to it (MEM-3.6). Editors (`product`, `admin`) pick any team there, copy its link or rename it. Members still move people between teams with the role and team fields here.

**Passwords (MEM-5, MEM-6).** Someone who forgot their password: Members → **Reset password**; they sign in with the access code once and set a new one. API: `POST /api/v1/members/{id}/password-reset`. Okta replaces the access code and the passwords later (AZG-3).

**Play on the hackathon with your CMS account (CML, D-91).** On a sandbox tenant (the hackathon) the games page's **Prihlásiť sa** offers **Prihlásiť sa cez CMS účet**: the browser goes to the CMS, and if you are signed in there and a member of that tenant, you are back on the games page signed in as your own player, marked **Team**. Not signed in to the CMS? Sign in, and it continues. Someone who is no member of the tenant sees „Tvoj účet v CMS nie je členom tohto prostredia hier.“ Production tenants offer Azet ID only; there, link your Azet account as below.

**Your Azet account: one identity for the CMS and the games (LNK, D-88).** You sign in to the CMS as before; you do **not** sign in to the CMS with Azet. To play as yourself and be recognised as a member, link the Azet account you play with, once:

1. In the CMS, top right → your name → **Account and password**.
2. Under **Your Azet account** press **Link Azet account**.
3. The Azet login opens on the tenant's games page (e.g. `azet-games-hackathon.rin.rinapps.dev`). Sign in with **your own** Azet account.
4. You are back on the account page in the CMS, which finishes the link with your CMS session: „Your Azet account is linked.“ You are also signed in on the games page as that player.

Do it in **one browser**, signed in to the CMS. A link started by someone else never links: „This Azet login was started by another CMS account.“

What it changes:

| Where | Effect |
|---|---|
| Admin → Players | Your player has the badge **Team** (your name on hover); colleagues see who of the players are members of this tenant |
| Tournaments → Winners (and the CSV) | Members keep their rank, but get no prize: the prizes go to the next players (a member 1st → the player 2nd gets the 1st prize). Column `member` in the CSV. Who is a member is fixed when the board is frozen (the first time anyone opens the results after the end): linking or unlinking later moves no prize |
| The games and public boards | Nothing: you play, earn points and appear on boards like any player |

Good to know:

- **Only you link yourself.** Admins cannot link someone else, and tokens cannot link anyone.
- **One Azet account per person.** An Azet account already linked to a colleague ends with „This Azet account is already linked to another person“: sign in to Azet with your own.
- **The link request is valid 10 minutes and for one Azet login.** Signed in to Azet with the wrong account? Sign out of Azet first (otherwise Azet signs you straight back in with it), then press the button again for a new request. „The link request expired“ means the same.
- **Membership decides, per tenant.** You are marked Team in the tenants you are a member of; your link is one for all of them.
- **Unlink** on the same page at any time; your plays stay, they are just no longer marked as a member's.
- The CMS stores only the hashed player key, never your Azet ID or Azet password. API: `GET · POST · DELETE /api/v1/account/azet` (your own session only).

## 2. Tokens for scripts and AI agents

**Admin → Tokens → Create token.** Pick the scopes the script needs (least privilege). The value is shown once. A **game token** for a backend: **For → A game backend (results, wallet credits)**, pick the game, **Create token**. It carries only `results:write` and works for that one game (the list shows „only <slug>“); put it into Vault as `AZG_GAME_TOKEN` and declare it in `backend.secrets`. Only admins see this option. API: `azg api call POST /tokens --data '{"name":"had-backend","scopes":["results:write"],"games":["<game id>"]}'` (the id from `azg api call GET /games/had`).

```bash
export AZG_API=https://azet-games-cms.rin.rinapps.dev
export AZG_TOKEN=azg_…                       # the token value
curl -s -H "Authorization: Bearer $AZG_TOKEN" $AZG_API/api/v1/me        # who am I, tenant, scopes
curl -s -H "Authorization: Bearer $AZG_TOKEN" $AZG_API/api/v1/ops       # every operation this token may call
curl -s -H "Authorization: Bearer $AZG_TOKEN" $AZG_API/api/v1/docs      # this documentation, as Markdown
```

| Scope | For |
|---|---|
| `games:read` | Reading games, stats, badges, boards, docs |
| `games:write`, `versions:write`, `versions:activate` | Games, versions, external games, badges, challenges |
| `theme:write` | Looks |
| `landing:write` | Landing page, leaderboards, tournaments |
| `players:moderate` | Moderation |
| `results:write` (one game) | A game backend's results and wallet credits; only on an agent token limited to one game, never on a personal or `azg login` token |
| `members:write`, `tokens:write` | People and tokens |

In a **production** tenant (`azet`, `koktejl`) an agent token's game changes (settings, archive, activating a version), landing page, theme and config document writes become **proposals** that a person approves in **Admin → Change proposals**; its other writes (badges, challenges, leaderboards, tournaments, moderation, members, tokens, uploads) are refused with `403`. In a sandbox tenant (`azet-hackathon`) they apply at once.

**Requests from members (MEM-8).** Anyone in the tenant writes in **Change proposals** what they want changed, set up or made (a game on the landing, a tournament, access…). Team members and viewers see only their own requests and whether they are done; a `product` or `admin` person sees all of them, does the work and clicks **Mark done** (or **Reject**). The **Audit log** is for `product` and `admin` only (MEM-7). The full scope list is in [API](api.md#scopes).

**For AI assistants:** with the CLI, `azg login` offers to prepare the folder for Claude Code (or run `azg ai setup` later). It downloads these documents into `.azg/docs/` and writes `CLAUDE.md` / `AGENTS.md`, so the assistant reads the platform rules before it acts. Without the CLI, an agent reads `GET /api/v1/docs` and `GET /api/v1/docs/{slug}` with its token.

## 3. Looks: theme and template

**Admin → Appearance.** Colours, font, corner radius, logo and the **template** of the games pages:

| Template | What players see |
|---|---|
| Light | Azet light look |
| Dark | Azet dark look |
| Follow the device | Light or dark by the player's device |
| **Halloween** | The dark look on the Halloween background, with the illustration next to the title; games get the dark theme in Halloween colours. Only the games pages, never the admin |

Save, then **Publish**. API: `GET/PUT /api/v1/theme` (the draft, `mode`: `light` · `dark` · `auto` · `halloween`), `POST /api/v1/theme/publish`.

## 4. Games

- **Add a game:** Admin → **Games → Add game** (template "HTML, no programming" or a code template), or `azg games create`. Teams then follow the [Hackathon guide](hackathon.md).
- **Go live:** switch the game **On** in the games list (status Live), or `PATCH /api/v1/games/{slug}` `{ "status": "live" }`.
- **Settings, texts, screens, motivation:** the game's builder tabs; `PATCH /api/v1/games/{slug}`.
- **Replay button:** **Screens → End screen → Replay button text** (`screens.end.button`, ≤ 30 characters) replaces „Hrať znova“ for every play; a game that sets its own text with `game.setReplayLabel()` (for example „Hrať ďalší level“ after a won level) wins over it (RPL-2).
- **Icon, cover, loading background:** the builder's **Appearance** tab; `PUT /api/v1/games/{slug}/assets/{icon|cover|loadingBackground}` with the raw image Without an upload the game shows the manifest's icon and cover, from the newest upload until a version is active (ART-1).
- **The game's window:** the game sets it in its manifest (`window:`, WIN-1); the CMS does not narrow it. The embed snippet's box follows it; add `data-height="…"` (320–1200 px) to the snippet only to force a height.
- **Badge texts and icons:** the builder's **Badges** tab; `PATCH /api/v1/games/{slug}/badges/{badge}`, `PUT …/icon`.

## 5. Landing page

**Admin → Landing page.** Title, intro, featured game and sections; each section has tiles (a game or an external game, size, optional label such as „Najhranejšia“, on/off). **Save draft**, then **Publish**.

In the hackathon tenant (sandbox) a team's game appears on the public page as soon as it is live, in a „Hry tímov“ section after yours (LND-5); place its tile in a section to move it, or place the tile and switch it off to hide the game. Azet and Koktejl show only what you place.

The public page groups the games by category in tabs (Všetky hry, Logické, Číselné, …), shows the week's top 3 with a period picker, today's challenge and the live tournaments.

API: `GET/PUT /api/v1/landing` (the draft), `POST /api/v1/landing/publish`; a single tile: `POST/DELETE /api/v1/landing/tiles`.

## 6. External games (Puzzlr)

Games hosted elsewhere — the Puzzlr games on azet.sk/hry — shown next to ours. **Admin → External games → Add external game**: name, slug, game URL (https, ideally with UTM parameters), description, category, session length, source (Puzzlr), and a **cover** (16:9 PNG, WebP or JPEG, 640–2560 px wide, ≤ 1 MB). They are marked **Puzzlr** in the CMS. Then place them on the landing like a game (step 5).

**A team's own external game (EXT-4, sandbox tenants).** A team member sees **External games** too, with the team's games only: **Add external game** puts the game in the own team, and the team edits it and uploads its cover. Placing it on the landing stays with you: add the tile and **Publish**. You can also hand a game to a team: **Team** in the game's dialog (empty = editors only).

```bash
curl -s -X POST -H "Authorization: Bearer $AZG_TOKEN" -H 'Content-Type: application/json' $AZG_API/api/v1/external-games \
  -d '{"slug":"elektrikar","name":"Elektrikár","description":"Prepoj všetky body jedným ťahom","url":"https://www.azet.sk/hry/elektrikar/?utm_source=azet_hry","category":"logic","session":"2-5min"}'
curl -s -X PUT -H "Authorization: Bearer $AZG_TOKEN" -H 'Content-Type: image/png' --data-binary @elektrikar.png $AZG_API/api/v1/external-games/elektrikar/cover
```

Categories: `word` (Slovné), `logic` (Logické), `number` (Číselné), `reflex` (Postrehové), `quiz` (Kvízy), `other`.

## 7. Daily challenges

**Admin → Daily challenges.** Plan a challenge for a day (title shown to players, goal, optional game, bonus points); days without a plan use the rotation. Players see it on the landing with progress and a countdown to midnight, and on the end screen after each play; when a play did not move it, the end screen says why (game already played today for a "different games" goal, not signed in, rejected result, a goal for another game). A play from a past day's challenge link counts toward today's challenge, without the bonus points.

API: `GET /api/v1/challenges`, `PUT /api/v1/challenges/{YYYY-MM-DD}` `{ "title": "Dokonči 3 hry", "rule": { "when": "completions", "op": ">=", "value": 3 }, "bonusPoints": 50 }`.

## 8. Badges

**Admin → Badges.** Tenant badges over several games (e.g. "3 challenges in a row"), with an icon. Game badges come from each game's manifest; their texts and icons are overridden in the game's builder.

API: `POST /api/v1/badges` `{ slug, title, description, rule, games? }`, `PUT /api/v1/badges/{id}/icon`.

## 9. Leaderboards

**Admin → Leaderboards.** The default weekly board plus tenant, game and event boards (metric, period, aggregation, minimum players). API: `GET/POST /api/v1/leaderboards`.

## 10. Tournaments

**Admin → Tournaments → New tournament.**

1. Title, description and rules (Slovak, shown to players), slug (the page is `/turnaj/<slug>` on the tenant host).
2. Games (only live games are offered), window from–to (Bratislava time), metric (`points` over any games, `score` of one game, or a metric the one game declares, such as a hub's mini game, TRN-8) and aggregation (`best` · `sum` · `count`).
3. Eligibility (everyone with a nickname, or signed-in only), prizes per rank range (from, to, prize), optional season tag, banner (16:9).
4. **Publish** (status scheduled). While live it is a hero card on the landing, and the end screen of a counted play shows "Turnaj: si 7.".
5. After the end the board is frozen: **Winners** (CSV export for the prizes), then **Confirm results** — only then are the winners public. Members of the tenant who linked their Azet account are marked **Team** and get no prize; the next players get the prizes ([Your Azet account](#1-people-and-roles)).

API: `POST /api/v1/tournaments` `{ slug, title, games, startsAt, endsAt, metric, aggregation, eligibility, prizes?, rules?, status }`, `PUT …/{id}/banner`, `GET …/{id}/winners?format=csv`, `POST …/{id}/confirm`.

**Teams run their own (sandbox tenants, TRN-9).** On the hackathon a team member sees **Tournaments** with the team's tournaments and creates one over the team's games (also before a game is live, to try it): window, metric, rules, banner. Prizes, the season and the winners stay with you: when a team's tournament should have prizes, add them in its edit dialog; the team then keeps them when it edits. A team never sees or changes another team's tournament.

## 11. Moderation

**Admin → Moderation.** Reports from players („Nahlásiť“ on the leaderboard page or from a game) and suspicious scores, newest first, plus a nickname search and the weekly board. The weekly board lists every ranked player, also those the public board skips (no opt-in, hidden or banned) with the badge "Not on the public board"; that is why the public board can jump from rank 3 to 6. Every action needs a reason and is audited:

| Action | Effect |
|---|---|
| Rename / Block nickname | The nickname becomes „Hráč 1234“ and the player chooses a new one; block also adds it to the deny list |
| Hide / Show | Public boards skip the player |
| Freeze / Unfreeze economy | The player can neither spend nor earn the in-game currency |
| Ban 1 day / 7 days / permanent, Unban | The player's plays stop counting |
| Dismiss | Close the reports without an action |

API (scope `players:moderate`): `GET /api/v1/moderation/reports`, `GET /api/v1/moderation/players?q=`, `POST /api/v1/moderation/players/{id}` `{ action, reason, duration? }`.

## 12. Players, statistics and data

- **Admin → Statistics:** plays, players signed in and not signed in (nickname and anonymous players together), players by kind (signed in, nickname, anonymous), funnel, retention; per game in the builder. The funnel counts only sessions with shell events, so it can show fewer sessions than players. An archived game with plays in the period stays in the game table with the badge "Archived". "Signed in" and "Not signed in" count the players of the selected period by whether they were signed in for their plays, so they can differ from the Players page (D-72).
- Dates and times in the admin are Bratislava time, `DD.MM.YYYY HH:mm`.
- **Admin → Players:** search a player by nickname, reference or profile code (every signed-in player has one), their plays, events, badges and wallet; delete a player (data deletion). **Team** marks a member of this tenant who linked their Azet account (LNK-2). The Players page shows each player's current state (signed in or a nickname on a device) and has no period, so its numbers are not the Statistics split.
- Export events: `GET /api/v1/events/export?from=&to=` (NDJSON).

## 13. Economy

**Admin → Leaderboards** (section *Economy*): in-game currencies on/off for the tenant (on in the sandbox, off in production until enabled) and shared currencies. Games declare currencies and shops in their manifest ([Game services](game-services.md)). API: `GET/PUT /api/v1/settings/economy`.

## 13a. Multiplayer rooms

**Games → game → Multiplayer** (every game; without a `realtime:` block or in a production tenant it says why it is empty). **Live rooms** of the game on the realtime service (invite code or room id, quick match, invite or against bots, waiting or playing, players, how long open, last activity) and the last 24 hours (rooms opened, started, expired while waiting, ended, closed as idle or by an editor, median play time), refreshed every 10 s. Counted since the realtime service last started. The players in a room, their nicknames and the room state are never shown. **Close** ends one invite or room-id room (quick-match and bot rooms have no id to pick; **Close all rooms** ends them too); **Close all rooms** ends every room of the game: the players see the game end (`close` reason `closed`); both are in the audit log. API: `GET /api/v1/games/{slug}/rooms`, `POST /api/v1/games/{slug}/rooms/close`. Below, **Matches** lists the game's turn-based matches (MAT-7).

**Nothing to set here for bots, levels or players online.** Bots (`realtime.bots`), the game's own levels (`progression:`), the nickname rule for rooms and the online count come from the game's manifest and the platform; the CMS has no switch for them. The platform level of a player is computed from their points. Details: [Manifest](manifest.md), [Game services](game-services.md#multiplayer).

## 14. A new tenant from scratch (checklist)

1. Members (step 1) and, for agents, a token (step 2).
2. Appearance and template, Publish (step 3).
3. Games live (step 4) and external games (step 6).
4. Landing sections and tiles, Publish (step 5).
5. Optional: challenges plan, badges, boards, a tournament (steps 7–10).
6. Open the tenant host and check the page on a phone.
