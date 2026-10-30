# Event catalog

Catalog version **1** (AZG-186, PRD §5.23 EVT, D-57). This page lists every event the platform records for a game: the events the shell sends on its own, the custom events a game adds with `game.track()`, the fields every stored event carries and the limits. The same events exist for every game. A game gets the shell events without writing any code.

The list of shell event types is `SHELL_EVENT_TYPES` in `@azet/games-shell` (`packages/shell/src/events.ts`). The shell sends events in batches to `POST /api/v1/play/session/events` (docs/API.md). It sends them every 2 s, before `complete`, and when the player leaves the page. Analytics never block or break gameplay: a failed batch is retried with the next one.

## Fields of every stored event

The server adds these fields from the play token, never from the request (DAT-1):

| Field | Meaning |
|---|---|
| `tenant` | Tenant of the page the game was played on |
| `game`, `version` | The game and the version that was played |
| `session` | One play session, from page load to page leave (it can contain several plays with *Play again*) |
| `playerKey` | The player's hashed key, in the HMAC space of DTM `userstats.iduser`, so signed-in players join with Azet data in DTM. Never the raw Azet ID |
| `playerKind` | `signed_in`, `nickname` (an anonymous device with a nickname, D-47) or `anonymous` |
| `type` | One of the types below |
| `payload` | The event's fields below; JSON |
| `ts` | When it happened (the client time, capped at the time the batch arrived) |
| `playDate` | The Bratislava calendar day of `ts` (YYYY-MM-DD), the same day as the daily level |

The DTM export columns for these fields are documented in [DEPLOY.md](deploy.md).

## Shell events (automatic)

| type | When | payload |
|---|---|---|
| `session_start` | The session started, before the game gets `init` | `playerKind`, `entry` (`landing`: from a page of the same host · `embed`: the shell runs inside another page's frame · `challenge`: opened from a challenge link · `direct`: anything else), `referrer` (the origin of the referring page only, or null), `device` (`mobile` < 640 px wide ≤ `tablet` < 1024 px ≤ `desktop`), `viewport` (`<w>x<h>`), `themeMode` (`light`/`dark`), `levelMode` |
| `loading_done` | The game called `ready()` | `ms`: time from the shell booting the game to `ready()` |
| `start_click` | The player pressed Play on the start screen (not sent when the start screen is off) | – |
| `start` | A play started (the catalog's *play start*; it opens the play in `plays`) | – |
| `progress` | The game reported progress (`game.progress()`, at most 1 per second) | the game's object |
| `pause` / `resume` | The play was paused (pause button, `game.pause()`, hidden tab) or resumed | – |
| `visibility_hidden` | The tab or app went to the background | `state`: the shell state at that moment |
| `complete` | The game reported its result | `score`, `timeSeconds`, `success`, `details`, `stats` as sent by the game |
| `abandon` | The player left the page, or the shell was closed, during a play that has no `complete`. Not for the play a compact (hub) game's shell started by itself after a result (HUB-2): the player is in the hub then | `elapsedMs`: wall-clock time since the play started |
| `replay` | The player pressed *Play again*; a `start` follows. A compact (hub) game's next play after a result records only its `start` (HUB-2) | – |
| `error` | The shell showed its error screen, or the game reported an error | `source: 'shell'` with `reason` (ERR-2: `load`, `timeout`, `offline`, `forbidden`, `not_found`, `rate_limited`, `session`, `unsupported`, `crash`), or `source: 'game'` with `message` (≤ 500 chars). An error before a session exists (the game never loaded, the session was refused) cannot be sent |
| `share_click` | The share button on the end screen | – |
| `challenge_click` | The challenge button on the end screen | – |
| `leaderboard_open` | The leaderboard link on the end screen, or the game read a board (`game.leaderboards.get`) | – from the end screen; `source: 'game'`, `board` from the game |
| `nickname_set` | An anonymous player saved a nickname: on the end screen (LBD-5), from the game (`player.setNickname`) or in the shell's dialog before a multiplayer room (NICK-1) | `source`: absent (end screen), `game` or `room` |
| `login_click` | The login link on the start or end screen | – |
| `back_click` | „← Späť na hry“: the player left the game for the tenant landing (SHL-1.1). An unfinished play then also records `abandon` | `where`: `start`, `playing`, `paused` or `end` |
| `login_done` | The first session after a `login_click` in this tab is signed in | – |
| `badge_awarded` | A badge was awarded: by the server with the result, or a new `award: game` badge | `badge` (id), `trust` (`trusted` or `cosmetic`) |
| `room_join` | The game joined a realtime room (RTM-11) | `mode` (`named`, `quick` or `bot`, BOT-2), `players` (members after the join), `maxPlayers`. No room id, member id, nickname or message content |
| `room_leave` | The game left a realtime room or the room closed | `reason` (`left`, `idle`, `restart`, `disconnected`, `replaced`, `rate_limited`, `expired`, `closed`, `ended`, `referee_lost`), `players` (members left in the room, as last known), `durationMs` |
| `invite_link` | The game made an invite link (INV-1) | `room`: `yes` or `no`. Never the code or the params |
| `invite_open` | The page was opened from an invite link (INV-1) | `room`: `yes` or `no` |
| `article_click` | The game opened an article with `game.openLink()` (OPL-1) | `host`, `path` (≤ 200 chars; never the query or fragment), `opened`: `tab` or `button` (the browser blocked the tab; the shell showed a button) |
| `track` | A custom event of the game, see below | `name`, `props` |

The builder preview in the CMS records no click events.

## Custom events (`game.track`)

A game adds its own events with `game.track(name, props)` (docs/SDK-CONTRACT.md). They are stored with `type: 'track'`. The game should declare them in `events:` of `azet-game.yaml` (docs/MANIFEST.md "Events"), with a description and typed props, so the CMS and the data team know what they mean:

```yaml
events:
  - name: word
    description: Had poskladal celé slovo.
    props:
      - name: word
        type: string
        description: Poskladané slovo
      - name: words
        type: number
```

`azg validate` checks the declarations. In the dev shell (`azg dev`, `azg contract`), a `track()` of an undeclared event, an undeclared prop or a prop of the wrong type logs a console **warning** naming it. The event is still recorded, and `azg contract` does not fail on warnings.

Examples in the repo: every starter template (`target_hit`, `star_caught`), Had in `games/snake` (`letter`, `word`, `news`) and Daily Quiz (`answer`).

## Limits

| What | Limit | When exceeded |
|---|---|---|
| Event name | `^[a-z][a-z0-9_]{1,39}$` | `track()` throws `invalid_payload` |
| `props` | JSON ≤ 1 KB | `track()` throws `too_large` |
| Rate | 60 custom events per minute | Extra events dropped, dev warning |
| Per session | 300 custom events | Extra events dropped, dev warning |
| Personal data | No prop key (at any depth) that looks like personal data: e-mail, phone, address, names, birth date, IP, Azet ID or user id, passwords, tokens, IBAN or card numbers (`PII_KEY_RE` in `@azet/games-sdk/protocol`) | Event dropped by the SDK and the shell, dev console error; `azg validate` rejects such a prop in `events:` |
| Batch | ≤ 100 events per request | The shell splits larger batches |

The deny list checks keys, not values: a game must never put personal data into any prop. Shell events carry no personal data. The referrer is reduced to its origin, and the shell never sends a nickname, an Azet ID or a token.

## Versioning

The catalog is versioned with this page. Adding an event type or a payload field is additive and keeps the version. Renaming or removing one is a new catalog version with a DECISIONS entry. The SDK protocol does not change for new shell events, because the shell sends them, not the game.

## Server limits (EVT-2)

The SDK and the shell apply the limits above. The server applies these limits to every event again before it stores it. Analytics never break gameplay: a broken event is dropped or cleaned, and the shell never gets an error for it.

| Rule | Limit | What happens |
|---|---|---|
| Event type | Only the types in this catalog | Other types are dropped |
| Custom event name and props | Name and `props` size as in [Limits](#limits) | The event is dropped |
| Payload size | 4 KB serialized | The payload becomes `{ "truncated": true }` |
| Rate per session | 300 events a minute, 2 000 per session; at most 100 per request. `start` and `complete` are outside the 2 000 and have their own 60 a minute (HUB-6) | Extra events are dropped |
| Personal data | The deny list of [Limits](#limits) (`PII_KEY_RE` in `@azet/games-sdk/protocol`, the same list the SDK and the shell use), at any depth; the key is compared lower-case without separators. The top-level `name` of a `track` event is the event name, not personal data | The key is removed, and, on the server only, a string that looks like an e-mail address becomes `"[redacted]"`. `_redacted` counts what was removed |

There is one deny list for the SDK, the shell, `azg validate` and the server: `PII_KEY_RE` in `@azet/games-sdk/protocol`.

## Where the events go

- **Player timeline.** The admin shows the recent events of one player on the Players page (PLY-3). Opening it is audited.
- **Statistics** (EVT-4). The rollup counts the funnel steps per game and day: `session_start`, then `loading_done`, `start`, `complete`, and finally `share_click`, `challenge_click` or `replay`. Each step counts the distinct sessions of that day with an event of the step. The rollup also counts events and sessions per type and per custom name. Today is computed live from `events`, and past days come from the nightly rollup (D-42).
- **DTM export** (DAT-2, EVT-5). `GET /api/v1/events/export` returns NDJSON, one event per line:

| Column | Type | Meaning |
|---|---|---|
| `ts` | ISO 8601 | Event time |
| `playDate` | `YYYY-MM-DD` | Europe/Bratislava day of `ts` |
| `tenant`, `game`, `version` | string | Tenant slug, game slug, version |
| `session` | uuid | Play session |
| `player` | string | `playerKey` above; signed-in players join DTM `userstats.iduser` |
| `playerKind` | string | `signed_in`, `nickname` or `anonymous` (for events before catalog 1, the player's kind at export time) |
| `loggedIn` | boolean | The player is signed in now |
| `marketingConsent` | boolean | Honour it before any marketing use (DAT-4) |
| `type` | string | Event type from this catalog |
| `name` | string or null | Custom event name for `track` |
| `payload` | object | The cleaned payload |

Deleting a player's data (DAT-4) removes their events from the timeline, the export and the rollup bitmaps. The counts in the statistics stay.

## Versioning

The catalog is versioned with this page. Adding an event type or a payload field is additive and keeps the version. Renaming or removing one is a new catalog version with a DECISIONS entry. The SDK protocol does not change for new shell events, because the shell sends them, not the game.
