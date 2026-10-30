# Game services

A game that draws its own UI can still use the platform: the same leaderboards, nicknames, points and streaks as the shell, and its own currency and shop, through a small API.

- **In the browser:** `@azet/games-sdk` (`game.player`, `game.leaderboards`, `game.points`, `game.store`, `game.wallet`, `game.shop`, `game.inventory`, `game.realtime`, `game.matches`, `game.invite`; React hooks in `@azet/games-sdk/react`).
- **On the game backend:** `@azet/games-server` (`getPlayerSummary`, `getLeaderboard`, `listLeaderboards`, `submitResult`, `wallet.credit`, `createReferee` for realtime rooms, `matches` for turn-based matches).

Everything here is additive to protocol 1 ([SDK contract](sdk-contract.md) "Game services"). A game that uses none of it behaves exactly as before. The shell answers every call; the game iframe has no CMS cookies, so the shell sends it to the CMS with the session's play token ([API](api.md)). `azg dev` and the `MemoryAdapter` answer with sample data, so you can build offline.

## Player

```ts
const me = await game.player.get();
// {
//   kind: 'signed-in' | 'nickname' | 'anonymous',
//   nickname: 'Zuzka' | null,
//   code: 'K7QW2M9X' | null,          // public profile code (/u/{code}); signed-in players only
//   points: { week: 120, rank: 4 | null, lifetime: 900 },
//   streak: { shared: { current: 2, best: 5 } | null, game: { current: 1, best: 3 } | null },
//   level: { level: 4, points: 900, from: 600, next: 1000 },              // platform level (PLV-1)
//   gameLevel: { level: 2, title: 'Hráč', value: 7, from: 5, next: 15 } | null, // this game's level (PRG-1)
//   visibility: { publicBoards: true, hidden: false },                       // PSV-1
// }
```

- `kind`: `signed-in` (Azet ID), `nickname` (an anonymous player who chose a nickname on this device) or `anonymous`. Only `signed-in` and `nickname` players earn points and appear on boards.
- `points.week` and `points.rank` are this week's points and place on the tenant's default weekly board (MOT-4). `rank` is `null` before a counted play this week. `points.lifetime` sums every counted play in the tenant.
- `level` is the **platform level** (PLV-1, D-85): the same in every game, from lifetime points. Level n starts at 50·n·(n−1) points: 1 at 0, 2 at 100, 3 at 300, 4 at 600, 5 at 1 000 … up to 99. `from` and `next` are where this level started and the next one starts (`null` at 99), for a progress bar: `(points − from) / (next − from)`. `platformLevel(points)` from `@azet/games-sdk` computes the same.
- `visibility` (PSV-1): `publicBoards` is the player's opt-in to public boards (PRF-1), `hidden` is true while a moderator hides or bans them. A game that lists players itself (rooms to visit, a gallery) shows only players with `publicBoards` and without `hidden`, the same rule as the boards. The backend gets the same from `getPlayerSummary`.
- `gameLevel` is **your game's own level** (PRG-1) when the manifest has `progression:` (below), else `null`. The CMS computes it from counted plays, so a changed client cannot raise it. `gameLevel(progression, value)` from `@azet/games-sdk` computes the same (for a preview of the next level).

### Own levels (progression)

Every game can have its own levels, titles and mechanics on top of the platform level. Declare what counts and where each level starts ([Manifest](manifest.md) "Progression"):

```yaml
progression:
  source: plays            # points (this game's points, default) | plays (counted plays) | metric:<id> (sum of a metric)
  levels: [0, 5, 15, 40, 100]
  titles: [Nováčik, Hráč, Stratég, Majster, Veľmajster]
```

```ts
const { gameLevel } = await game.player.get();
if (gameLevel) showBadge(`${gameLevel.title ?? 'Level'} ${gameLevel.level}`, gameLevel.next);
```

What a level unlocks (a harder mode, a skin, a bigger board) is your game's mechanic: read `gameLevel.level` and decide. For things the player keeps or spends use the economy (Currency and shop); for per-player saves use the cloud save.

### Nickname

```ts
try {
  const { nickname, me } = await game.player.setNickname('Zuzka');
  // me: { rank, nickname, points, me: true } on the default board, or null before a counted play
} catch (err) {
  // err.code / err.reason / err.message (Slovak, the same copy as the shell's nickname field)
}
```

For anonymous players only, under the same rules as the end screen's nickname field (LBD-5, D-54): 2–20 characters (letters, digits, space, `_ . -`), the tenant deny list, and 5 changes a day. One network address may also create only so many **new** nicknames an hour (MOD-8: 200 on a sandbox tenant like the hackathon, 20 on production tenants); a whole office or the VPN counts as one address. Choosing a nickname is the opt-in to public boards. Errors:

| `code` | `reason` | When |
|---|---|---|
| `invalid_payload` | `invalid` | Too short, too long or a forbidden character |
| `invalid_payload` | `denied` | A word from the tenant deny list |
| `rate_limited` | `too_many` | The sixth change today |
| `rate_limited` | `flood` | Too many new nicknames from this network in the last hour (MOD-8); try again later |
| `unauthorized` | `signed_in` | A signed-in player keeps their Azet ID nickname |
| `backend_error` | – | The CMS could not be reached |

`err.message` is the Slovak text the shell shows, so a game can show it in its own UI.

### Login

```ts
const { started } = await game.player.login();
```

Asks the shell to start the Azet ID login (AUTH-1), which leaves the game page and comes back to it. `started: false` when the player is already signed in or the page has no login (for example `azg dev`, the CMS builder or a tenant without Azet ID).

## Points

```ts
const { week, rank, lifetime } = await game.points.get();
```

The same numbers as `player.get().points`.

**How a score becomes points (MOT-3).** A counted play earns `round((50 + 50 × s) × multiplier)`, where `s` is the score placed in the manifest's `scoring.min`–`scoring.max` range (0–1, turned around when `higherIsBetter: false`; 0.5 without a range) and the multiplier is the game's `motivation.pointsMultiplier` in the CMS (default 1). So every counted play earns 50–100 points at multiplier 1; a score of 200 in a 0–10 000 range earns 51. Declare a realistic range, or the score barely matters.

## Leaderboards

```ts
const boards = await game.leaderboards.list();
// [{ id, key, title, scope: 'game' | 'tenant' | 'event', metric, period, isDefault }]

const top = await game.leaderboards.get('default', { limit: 5 });
const near = await game.leaderboards.get('top-score', { around: 'me', limit: 7 });
// { board, entries: [{ entryId, rank, nickname, value, me }], me: { rank, nickname, value, me: true } | null, enoughPlayers }
```

- `list()` returns the boards of this game and the tenant's boards (the default weekly points board first).
- `get(id)` takes an `id` from `list()`, a `key` (the board's id in `leaderboards:` of `azet-game.yaml`) or `'default'`. An unknown board rejects with `invalid_payload`.
- `around`: `top` (default) lists from rank 1, `me` lists the entries around the player. `limit` is 1–50 (default 10).
- The rules are the public board's (LBD-3, LBD-4): only players who opted in are listed (others still count for ranks and `minPlayers`), nicknames pass the deny list, colliding nicknames get `#2`, `#3`, and below the board's `minPlayers` `entries` is empty with `enoughPlayers: false`. `me` is the player's own entry, also when they are not listed.
- Every `get()` records a `leaderboard_open` event (`source: 'game'`).

### Reporting a player

```ts
await game.leaderboards.report(entry.entryId, 'nickname'); // 'nickname' | 'cheating' | 'other'
```

Moderation is PRD §5.27 (MOD-6, D-61). Put a "Nahlásiť" button next to every listed nickname that has an `entryId` and let the player pick a reason: `nickname` (vulgárna prezývka), `cheating` (podvod) or `other` (iné). The report goes to the tenant's moderation queue in the CMS; moderators can rename or block the nickname, hide the player from the boards or restrict their account. The player's own entry has no `entryId`.

| `code` | When |
|---|---|
| `invalid_payload` | No `entryId`, an unknown reason, an unknown entry or the player's own entry |
| `rate_limited` | The sixth report today from this device |
| `backend_error` | The CMS could not be reached, or a platform without moderation |

A moderated player sees it in the shell: after a nickname reset the end screen asks for a new nickname (the board shows `Hráč 1234` until then), and a restricted player's end screen says "Tvoj účet je obmedzený" and nothing counts.

### Anti-cheat rule: no score submit from the client

There is no call that writes to a leaderboard. Scores reach boards only through:

1. `game.complete({ score })`, which the server checks against `scoring` (range, minimum play time, SDK-CONTRACT §8), or
2. the backend's `submitResult` with the game token (BE-6), for games whose backend owns the score.

Everything in the browser can be forged, so a game must never try to report scores another way (store, `track`, its own backend writing "scores" that it then shows as the platform's board).

One play keeps one result: the first `complete()` or `submitResult` of a session counts and later ones do not ([SDK contract](sdk-contract.md#one-result-per-play-rtm-16)). A game with several rounds reports once, after the last round; only signed-in and nicknamed players are ranked. A game made of many separate mini games reports each round as its own play instead ("A hub of mini games" below).

### Boards declared by the game

A game can declare its own boards in `azet-game.yaml` ([Manifest](manifest.md) "Leaderboards"). The CMS creates them as game boards (LBD-1) when a version is published; editors can still change titles and limits in the admin, where they show as "from the game".

```yaml
leaderboards:
  - id: top-score
    title: Top 5 týždňa
    metric: score            # score | metric:<id>
    period: week             # day | week | month | all
    aggregation: best        # best | sum | count
```

## Cloud save

`game.store` keeps JSON values on the platform. Nothing to set up; it works in `azg dev` in memory.

| | `game.store.player` | `game.store.shared` |
|---|---|---|
| Whose | The current player in this game (Azet ID or the device of an anonymous player) | Everyone in this game, in this tenant |
| Keys | 100 per player | 10 000 |
| Value | JSON ≤ 16 KB | JSON ≤ 16 KB |
| Calls | `get`, `set`, `delete`, `incr`, `list(prefix)` | the same |

Keys are 1–128 characters of `A–Z a–z 0–9 : _ . / -`. Over a limit the call rejects with `quota`, `too_large` or `invalid_key`. Anonymous players keep their data only on the device that wrote it, until they sign in: then the device's keys the account does not have yet move to the account (MRG-1, below).

**Save slots:**

```ts
await game.store.player.set('slot:1', { level: 4, hp: 80 });
const slots = await game.store.player.list('slot:', { limit: 3 }); // [{ key: 'slot:1', value: … }]
```

**Daily state** (one save per day, today's key from the level date):

```ts
const ctx = await game.init();
const key = `day:${ctx.level.date}`;
const today = (await game.store.player.get<{ tries: number }>(key)) ?? { tries: 0 };
await game.store.player.set(key, { tries: today.tries + 1 });
```

**A shared counter** (for example how many words all players found):

```ts
const total = await game.store.shared.incr('words-found', 3);
```

The store is not a leaderboard: its values are written by the client and are never ranked.

## Currency and shop

A game can have its own currency (coins, gems, Písmenká …) and items. The platform keeps the ledger: balances never go negative, every write is idempotent, and editors see the economy in the CMS. A game does not build a wallet itself.

### 1. Declare the economy

```yaml
# azet-game.yaml
currencies:
  - { id: coins, title: Mince, icon: assets/coin.svg, max: 9999, dailyEarnCap: 200 }
items:
  - { id: extra-life, title: Život navyše, icon: assets/heart.svg, price: { currency: coins, amount: 20 }, maxPerPlayer: 3 }
  - { id: golden-skin, title: Zlatý had, icon: assets/skin.svg, price: { currency: coins, amount: 150 }, stackable: false }
earn:
  - { currency: coins, from: score, rate: 0.1, max: 50 }   # 10 % of the score, at most 50 per play
```

`azg validate` checks the fields, the icons and that prices and earn rules name declared currencies and metrics.

### 2. Earning: trusted paths only

The anti-cheat rule: **the game in the browser never earns currency.** There is no earn call in the SDK, and the shell refuses one. Currency is credited by:

- **Earn rules** in the manifest, on every validated play (not on a rejected one, not on a challenge practice): `floor(value × rate)` with `from: score` or `from: metric:<id>`, at most `max` per play.
- **The game backend**, which verified the play itself:

```ts
import { submitResult, verifyPlayerToken, wallet } from '@azet/games-server';

const player = await verifyPlayerToken(req.headers.authorization);
// with the result of the play, once per session
await submitResult({ session: player.session, score: 120, currency: { coins: 30 } });
// or any time, once per key
await wallet.credit(player, 'coins', 10, `daily-bonus:${today}`);
```

Every path respects the currency's `max` and `dailyEarnCap`; a cap cuts the amount (`capped: true`) instead of failing.

### 3. Spending, the shop and the inventory

```ts
import { game, GameError } from '@azet/games-sdk';

const coins = (await game.wallet.get()).coins;          // balances by currency id
const items = await game.inventory.get();               // { 'extra-life': 1 }

try {
  // The price comes from the manifest; the game only names the item.
  const { balances, inventory } = await game.shop.buy('extra-life', { key: crypto.randomUUID() });
} catch (err) {
  if (err instanceof GameError && err.code === 'insufficient_funds') showMessage('Nemáš dosť mincí.');
}

await game.wallet.spend('coins', 5, { key: crypto.randomUUID(), reason: 'hint' });
await game.inventory.consume('extra-life', 1, { key: `life-${ctx.level.date}` }); // at most once a day
```

- **Keys.** Every write takes a `key`. The same key applies once: a retry after a lost connection answers `duplicate: true` and changes nothing. Use a fresh key per player action, or a meaningful one (`life-<date>`) to allow something once.
- **Errors** (`GameError.code`): `insufficient_funds`, `insufficient_items`, `quota` (`maxPerPlayer` or a non-stackable item owned already), `conflict` (a key reused for another operation), `invalid_payload` (an undeclared currency or item), `economy_disabled`, `economy_frozen` (a moderator froze this player's currency, MOD-4: show the wallet read-only; plays still count but earn nothing).
- **Economy off.** Editors switch the economy on per tenant (on in the sandbox, off in production until enabled). When it is off, every call answers `economy_disabled`: hide the shop and let the game run without it.
- **Players.** Signed-in and nickname players keep their wallet in the tenant; an anonymous player's wallet stays on the device until they sign in, and then moves to the account (MRG-1, below).

### 4. Rewards: items from the backend (GRT-1)

A reward that is an item (a season step, a chest, a prize) is given by the game backend, never bought:

```ts
import { verifyPlayerToken, wallet } from '@azet/games-server';

const player = await verifyPlayerToken(req.headers.authorization);
const r = await wallet.grant(player, 'zlaty-terc', 1, `season-1:step-30`, { reason: 'season' });
// r: { item: 'zlaty-terc', quantity: 1, duplicate?: true }
```

The item must be declared in `items:` (its price is not used). The same key applies once; `stackable` and `maxPerPlayer` hold (`quota`); a frozen player gets nothing (`economy_frozen`). The browser has no grant call.

### 5. Signing in keeps what the device built (MRG-1)

An anonymous player earns, buys and saves on their device key. When they sign in on that browser (Azet ID, or the CMS account on the hackathon), the platform moves it to the account: balances of the currencies a game still declares, items, and `game.store.player` keys the account does not have yet. What does not fit stays on the device (the account's `max`, `stackable`, `maxPerPlayer`), and a currency moves at most one `dailyEarnCap` at a time. A device stays with the account of its first move, and an account takes one move a day, so the rest of a big device wallet moves on the following days. Points, streaks, badges, boards and the nickname stay with the device. So a hub can offer „Prihlás sa a nič nestratíš“ after the first round. A game needs no code for it; read the wallet and the saves again after the page comes back from the login.

### 6. Try it locally

`azg dev` runs the wallet in memory with the manifest's currencies, items and earn rules, and starts every currency at 100 (or `max` when lower) so the shop can be tried before earning. Undeclared currencies and items log a console error.

### Example: Had

The reference game `games/snake` earns **Písmenká** from eaten letters (`earn: { from: 'metric:letters', rate: 1, max: 50 }`, at most 200 a day) and sells **Druhý život** for 30 Písmenká. When the snake crashes and the player owns a life, the game consumes one with the key `life-<date>`, so one extra life works once a day, and the snake goes on with its score (`games/snake/src/economy.ts`).

## A hub of mini games

A game can be a hub: a room, a map or a menu where every object starts a short mini game (PRD §5.41, D-92). Each round is its own play with its own result, so points, boards, earn rules, badges and the daily challenge work per round as for any game.

```yaml
# azet-game.yaml
endScreen: compact            # a result card instead of the end screen; the next play starts at once (none: no card)
scoring: { metric: points, higherIsBetter: true, min: 0, max: 1000, minSeconds: 3 }
levels: { mode: daily, replay: true }
metrics:                      # one or two per mini game, up to 100
  - { id: vytah, title: Výťah, type: integer, better: higher }
  - { id: kompot, title: Kompót, type: integer, better: higher }
leaderboards:                 # up to 100
  - { id: vytah, title: Výťah týždňa, metric: 'metric:vytah', period: week, aggregation: best }
  - { id: kompot, title: Kompót týždňa, metric: 'metric:kompot', period: week, aggregation: best }
currencies:
  - { id: mince, title: Mince, icon: assets/coin.svg, max: 100000, dailyEarnCap: 300, scope: tenant }
earn:                         # up to 40
  - { currency: mince, from: 'metric:vytah', rate: 2, max: 40 }
  - { currency: mince, from: 'metric:kompot', rate: 0.05, max: 40 }
```

```ts
game.onStart(() => showRoom());                       // also the start the shell sends after each round
async function playRound(id: 'vytah' | 'kompot') {
  const raw = await runMiniGame(id, ctx.level.seed + id); // a seed of its own from the daily seed
  game.complete({ score: normalize(id, raw), timeSeconds: raw.seconds, stats: { [id]: raw.value } });
}
game.onResult((r) => {
  if (r.rejected) return showToast('Toto kolo sa nezapočítalo.');
  addCoinsToRoom(r.earned.mince ?? 0);                 // what the earn rules really credited
});
```

- **One scoring range.** `scoring` is one per game and decides the points (50–100 per counted play) and the range check, so put every mini game's score on the same scale (e.g. 0–1 000). Rank each mini game on its own metric.
- **One round, one `complete()`.** Send only the round's own metric in `stats` (at most 10 per completion). Pass `timeSeconds` of the round: the play also spans the time the player spent in the hub.
- **The result card.** The shell shows it at the top of the game, under its own buttons (about 60–160 px from the top), for 4 s; taps pass through it, so put no important text there while it shows. The end screen's nickname, board and reminder prompts do not show, so offer `game.player.setNickname()` and `game.player.login()` in the hub („Ulož si mince“) when `onResult` says `nicknamePrompt`.
- **Your own result instead of the card.** `endScreen: none` keeps everything of `compact` but the card (HUB-7). Then the game tells the player what counted from `onResult`: the points, the coins and, when `rejected` is set, that the round did not count (`too_fast`, `too_many`, `restricted` …), or the player never learns why.
- **Pacing.** A hub counts at most 60 plays of a player an hour (HUB-5); more are stored as rejected `too_many` and earn nothing. `azg dev` does not cap.
- **Limits per manifest.** 100 metrics, 40 earn rules, 100 boards, 300 items, 10 currencies, 50 badges; more boards can be added by editors in the CMS over the declared metrics.
- **The same mini game in an article.** Publish it again as its own small game (its own slug) with the same `scope: tenant` currency: its plays earn into the same wallet once the tenant's *Shared currencies* switch is on. Items stay in the hub (an item belongs to one game). An embedded player is the same player only when the article is on the same site as the tenant host (cookies are `SameSite=Lax`).
- **Rewards and signing in.** Give reward items from the backend (`wallet.grant`, above); a player who signs in keeps the device's coins, items and room (MRG-1, above). A room others can visit belongs in your backend, shown only for players whose `visibility` allows it (PSV-1); `game.store.shared` can be written by every player.
- **A tournament over one mini game.** Editors pick its metric (`metric:vytah`) for a tournament of the hub game (TRN-8).
- **Tilt.** The game frame may use the accelerometer and gyroscope (SNS-1); on iOS ask with `DeviceMotionEvent.requestPermission()` from a tap and keep touch controls as a fallback.

## Tournaments

Editors run tournaments in the CMS (PRD §5.28, D-62): a window in Bratislava time, a set of games, a metric and prizes. What counts is decided by the server from the normal `complete()` (or a backend result): a play counts when it started at or after the start and completed before the end. A game does nothing extra to take part.

### Show the tournament in the game

`game.tournaments.get()` is read-only and optional (SDK-CONTRACT "Tournaments"):

```ts
const tournaments = await game.tournaments.get();
const live = tournaments.find((t) => t.status === 'live');
if (live) showBanner(`${live.title}${live.me ? ` · si ${live.me.rank}.` : ''}`, live.url);
```

- **List.** The published tournaments that include this game: `scheduled`, `live` and those finished in the last 14 days, by start. Each is `{ slug, title, status, startsAt, endsAt, url, me }`.
- **`me`.** `{ rank, value }` of the player on the live board, or on the frozen board once the results are confirmed; `null` otherwise (not ranked yet, results pending, a player who is not eligible).
- **`url`.** The public tournament page `/turnaj/<slug>` on the tenant host; open it with `target="_top"`. It is `null` in the dev shell.
- **No tournaments.** A tenant or game without tournaments resolves with `[]`, never an error; other failures reject with a `GameError` (e.g. `timeout`), as for `store`.

### End screen

After a play that counted in a live tournament, the shell shows "Turnaj: si 7." with a link to the tournament page, below the score, the streak, daily challenge and weekly board and the new badges (SHL-2.2). The game does nothing for it.

### Who is ranked

- **Eligibility.** `everyone` ranks signed-in players and anonymous players with a nickname (LBD-5); `signed_in` ranks signed-in players only. Anonymous players without a nickname never count.
- **Public boards.** Only players who opted in (PRF-1) are listed; everyone sees their own place.
- **After the end.** The board is frozen; later plays do not move a rank. Winners are public only after an editor confirms them.

### Try it locally

`azg dev` resolves `game.tournaments.get()` with `[]`, so the game must work without tournaments.

## Multiplayer

Two or more players in one game, through the platform's realtime service (PRD §5.31 RTM, D-77, D-78): rooms, who is in them, messages and a small shared state. You need no WebSocket server of your own. The full API is in the [SDK contract](sdk-contract.md) "Realtime multiplayer".

### 1. Declare it

```yaml
realtime:
  maxPlayers: 2      # room size 2–50, default 8
  quickMatch: 2      # players per quick match, default 2
  stateWrites: any   # any | host (only the host writes the room state)
  waitSeconds: 120   # a room nobody joins closes after this (10–600)
```

Without the block the room calls (`join`, `create`, `quickMatch`, `playBot`) reject with `realtime_disabled`; players online (`online`, `onPresence`) work in every game ([Manifest](manifest.md) "Realtime").

### 2. Get into a room

```ts
// the server pairs two players of the same game version
const room = await game.realtime.quickMatch({ players: 2, timeoutSeconds: 60 });
// or invite a friend: a new room with a 6-character code to share (room.id, e.g. 'K7MP2X')
const table = await game.realtime.create();
// the friend joins only that room; a mistyped or expired code rejects with `not_found`
const same = await game.realtime.join('K7MP2X', { create: false });
// or a room id the game derives itself (opened by the first one): 1–64 characters A–Z a–z 0–9 _ -
const daily = await game.realtime.join('daily-2026-10-21');
// or practice against bots the referee plays (needs realtime.bots, see 6. Bots)
const training = await game.realtime.playBot({ level: 'easy' });
// a link that opens a friend straight at this table: copy it, the friend taps it
const { url } = await game.invite.link({ room: table.id, params: { mode: 'duo' } });
await navigator.clipboard.writeText(url);
```

The friend's game starts with `ctx.invite` (`{ room, params }`): join right after start. It comes once per page load, but `ctx` keeps it through „Hrať znova“, so take it once; anyone can build a link, so check it, and an old link rejects with `not_found`:

```ts
import { game, GameError } from '@azet/games-sdk';

const ctx = await game.init();
let invitedTo = ctx.invite?.room && /^[A-Z2-9]{6}$/.test(ctx.invite.room) ? ctx.invite.room : null;
game.onStart(async () => {
  const code = invitedTo;
  invitedTo = null; // „Hrať znova“ starts without it
  if (!code) return showLobby();
  try {
    await game.realtime.join(code, { create: false });
  } catch (e) {
    if (e instanceof GameError && e.code === 'not_found') return showLobby('Tento stôl už neexistuje.');
    throw e;
  }
});
```

In React use the hooks of `@azet/games-sdk/react` instead of wiring `room.on(...)` by hand:

```ts
import { useOnline, useRoom } from '@azet/games-sdk/react';
import type { Room } from '@azet/games-sdk';

function Table({ room }: { room: Room }) {
  const { members, state, closed } = useRoom(room); // re-renders on join, leave, host, state, close
  const online = useOnline();                        // players of the game online now
  return null; // draw members, state and online
}
```

The shell connects every game session when the game is ready, so a room starts at once; `await game.realtime.connect()` when the lobby opens makes sure. `game.realtime.online` is how many players have this game open right now (`onPresence(fn)` for changes): show „Práve hrá 23 hráčov“ in the lobby. A room needs a nickname: a player without one is asked by the shell before the room opens. The shell shows „Ako ťa majú volať?“ over the game; `create()`, `join()`, `quickMatch()` and `playBot()` stay pending meanwhile (up to 150 s; the dialog closes itself after 2 minutes) and then open the room. Only a cancel (or no answer) rejects with `nickname_required`. The nickname is saved like one from the end screen and counts for this play already: the player is ranked for this round.

A session is in one room at a time (`conflict` otherwise). `room.members` lists everyone in join order, `room.me` is the player, `room.host` the earliest member. A full room rejects with `room_full`; a quick match rejects with `timeout` when nobody comes and with `cancelled` when you abort its `signal` (or the same player starts another quick match in another tab). A room nobody else joins closes after `waitSeconds` (default 2 minutes) with `close` reason `expired`: tell the host and offer to invite again. One player has at most 3 rooms or waits at once and opens at most 20 rooms in 10 minutes (`limit_reached`).

### 3. Play

```ts
room.on('join', (m) => showPlayer(m));
room.on('leave', (m, reason) => removePlayer(m));        // left, disconnected, idle
room.on('message', (data, from) => onMove(data, from));   // never your own messages
room.send({ t: 'move', x: 3 });                           // to everyone else; { to: member.id } for one
room.on('state', (state, { version, from }) => draw(state));
await room.setState({ phase: 'go' });                     // JSON Merge Patch, null deletes a key
await room.setState({ winner: room.me.id }, { ifVersion: room.version }); // only if nobody wrote first
```

- **One authority.** Let the host decide anything that must happen once (countdown, dealing, the end of a round): `if (room.me.host) …`, and react to `host` when the host leaves.
- **Messages vs state.** Messages are fire-and-forget events (taps, moves); the state is what a late joiner or a reconnecting player must see (phase, turn, board). The state is lost when the room empties or the service restarts.
- **Scores stay trusted.** Each player ends with their own `game.complete()`, once per play (only the first result of a play counts, [SDK contract](sdk-contract.md#one-result-per-play-rtm-16)); nothing in a room writes a score, currency or badge. For results the players cannot forge, make your backend the referee of the rooms (PRD §5.33): it decides and reports each player's result with `submitResult`.
- **Connection.** The shell reconnects by itself: `reconnecting`, then `reconnected` (state and members are current again). Handle `close` (`restart`, `disconnected`, `replaced`, `idle`, `rate_limited`, `expired`, `closed` by an editor in the CMS): end the round cleanly and let the player start again.
- **Players.** Every player in a room has a `nickname` (the shell asks for one first). `profile` is what the platform verified when they connected: `level` (platform level), `gameLevel` (`{ level, title }` of your `progression:`), `week` (this week's points) and `rank` (place on the default board, `null` when the player is not listed). Show „Zuzka · level 7“ next to the board; the game cannot change it. Bots have `bot: true` and no profile. No player key or session id ever reaches the game.

```ts
const rival = room.members.find((m) => m.id !== room.me.id);
const label = rival?.bot ? 'Bot' : `${rival?.nickname ?? 'Súper'}${rival?.profile ? ` · level ${rival.profile.level}` : ''}`;
```
- **Versions share table codes.** Quick match pairs only players of the same game version, but a named room is keyed by tenant, game and room id, not by version: a player still on an old tab and one on the new version can land at the same table code. The room also keeps the `maxPlayers` and `stateWrites` of the version that created it until it closes (60 s after the last member leaves), so a changed `realtime:` block applies only to rooms created after the change. After you publish, have every player reload and start a new table. If you change the format of your messages or state, put a small version field in them (`{ v: 2, t: 'move', … }`) and ignore what you do not understand.

### 4. Try it locally

`azg dev` runs the same room engine in memory: open the dev shell in two browser tabs and play against yourself (quick match pairs the two tabs). The CMS builder preview gives a room with only the player, and quick match there rejects with `timeout` at once, so design a waiting screen. `games/tap-race` is a complete two-player example (quick match or an invite code from `create()`, host countdown, first to 30 taps wins). The CMS shows the game's live rooms under **Games → game → Multiplayer**.

### 5. Referee: the backend decides (authoritative)

Without a referee every browser in the room is trusted: it can send any move and report any score. For a game where that matters (piškvorky, cards, anything with a winner), make the game's backend the **referee** of its rooms (PRD §5.33 REF, D-81):

```yaml
realtime:
  maxPlayers: 2
  authority: referee   # needs a backend: block
backend:
  path: backend/
```

In a referee game a member's `room.send(data)` reaches only the referee (never the other players), `room.setState()` rejects with `forbidden`, `room.referee` is `true`, and everything the referee sends or writes comes `from` the member `{ id: 'referee', nickname: null, host: false }`. Join, create and quick match reject with `unavailable` while the backend's referee is not connected.

The backend (Node, `@azet/games-server`):

```ts
import { createReferee } from '@azet/games-server';

createReferee({
  async onJoin(room) {
    if (room.members.length === 2) await room.setState({ turn: room.members[0]!.id, cells: Array(9).fill(null) });
  },
  async onMessage(room, from, data) {
    const cell = (data as { cell?: number }).cell;
    if (room.state.turn !== from.id || typeof cell !== 'number') return room.send({ t: 'refused' }, { to: from.id });
    // … check and apply the move, then tell everyone
    await room.setState({ cells: next, turn: other.id });
    if (won) await room.end({ results: { [from.id]: { score: 2, success: true }, [other.id]: { score: 0 } } });
  },
  async onLeave(room, member) {
    // the one who stays wins by forfeit: end() with results for both, the leaver's loss included
  },
});
```

- Each member comes with `session` (their play session), `player` (a stable hash, the same person in another room), `nickname`, `loggedIn` and `profile` (the same verified profile the players see). `session` and `player` never reach the other players.
- `room.end({ results })` reports each member's result for their session through `POST /api/v1/results` (the same checks as `complete()`: range, minimum time, one result per play) and closes the room with reason `ended`. List **every human member**, also one who left (a forfeit loss); a member you leave out gets no result. Bots are skipped by themselves.
- **Only this result counts (REF-7).** In a game with `authority: referee` the score of the game's `complete()` is never stored, in every mode (also a single-player mode of the same game). A `complete()` before the referee reported stores nothing (the end screen says „Výsledok potvrdzuje server hry“); one after it shows the referee's result. So the game calls `complete()` after `close` with reason `ended`, with a fallback timer in case `ended` never comes:

```ts
let outcome: { score: number; success: boolean } | null = null;
room.on('state', (s) => {
  if (s.winner !== undefined && !outcome) outcome = { score: s.winner === room.me.id ? 2 : 0, success: s.winner === room.me.id };
});
let done = false;
const finish = () => {
  if (!outcome || done) return;
  done = true;
  game.complete(outcome); // shows the end screen with the referee's result
};
room.on('close', (reason) => {
  if (reason === 'ended') finish(); // the referee has reported
  else if (outcome) setTimeout(finish, 6_000); // referee_lost: still show an end screen
});
```
- Timers (a move clock, a forfeit after a disconnect) run in the backend. A player who drops out has 15 s to come back before you get `onLeave`.
- One referee connection per game: a second instance of the backend takes over (the first stops). If the backend is gone for more than 15 s, its rooms close with reason `referee_lost`; a backend that comes back sooner gets them again in `onRoom` with their state.
- Python backends: `azg_referee.py` in the Python template does the same (`Referee(on_message=…)`, `await room.set_state(…)`, `await room.end(results=…)`).
- Locally `azg dev --backend` runs it against the dev shell (no CMS: results are logged, not reported). On the cluster a team's referee is its game backend, deployed from the game repo ([What you can use](capabilities.md#own-backends-on-the-cluster)) with `AZG_GAME_TOKEN` in `backend.secrets`; `games/piskvorky` already runs on the cluster as the platform's example (DEPLOY.md "Referees of our games").

`games/piskvorky` is the complete example: invite code or quick match, the referee picks who starts, checks every move, keeps a 30 s move clock, decides win, draw, timeout and forfeit, and reports both results.

### 6. Bots

Nobody to play with? Let the referee play a bot (PRD §5.35 BOT, D-84). Declare the levels, and optionally fill a quick match with a bot after a wait:

```yaml
realtime:
  authority: referee
  bots:
    levels: [easy, hard]   # 1–5 ids; the first is the default
    after: 20              # optional: a quick match that waited 20 s gets a bot
```

The game asks for one with `game.realtime.playBot({ level: 'hard' })`. The room has the player and `quickMatch − 1` bots (`room.bots` is `{ level, ids: ['bot-1'] }`, the bots are members with `bot: true`), and it plays at once. In the backend the room comes with `room.bots`; the referee moves for the bot by writing the state like for a player:

```ts
import { createReferee } from '@azet/games-server';

createReferee({
  async onRoom(room) {
    if (room.bots) await startGame(room, room.members[0]!.id, room.bots.ids[0]!); // the player against the bot seat
  },
  async onMessage(room, from, data) {
    await applyMove(room, from.id, data);
    if (room.bots && !gameOver(room)) setTimeout(() => void applyMove(room, room.bots!.ids[0]!, botMove(room, room.bots!.level)), 700);
  },
});
```

A game against bots is **practice**: `room.end({ results })` reports the players with `practice: true` and skips the bots, so a win never earns points, ranks, streaks, badges or currency (Python: `room.bots`, `await room.end(results=…)` the same). Tell the player („Tréning s botom – nezapočítava sa do bodov“). `games/piskvorky` has an easy bot (wins when it can, blocks half the time) and a hard one (minimax, never loses).

## Matches

Turn-based games played over hours or days, like piškvorky or chess: invite a friend with a code, play a move, come back tomorrow, several matches at once (PRD §5.34 MAT, D-82). The CMS keeps the match, so it survives a closed tab, a deploy and a night. Use `game.realtime` (above) for live play while both players are online; use `game.matches` when a match must outlive the sitting. A game can use both.

### 1. Declare it

```yaml
matches:
  players: 2           # seats 2–8, default 2
  turnSeconds: 86400   # a missed turn loses by forfeit (60 s – 7 days)
  inviteSeconds: 86400 # a match nobody joined expires
  authority: members   # members | backend
```

Without the block every `game.matches` call rejects with `matches_disabled` ([Manifest](manifest.md) "Matches").

### 2. Open or join a match

```ts
const m = await game.matches.create();            // m.code = 'K7P2QX': show it, the friend types it
const joined = await game.matches.join('k7p2qx'); // any case; the last seat starts the match
const quick = await game.matches.quick();         // pairs with a waiting player, or waits (status 'waiting')
const { open, finished } = await game.matches.list(); // the player's matches of this game
```

A match is `{ id, code, status, players, seat, turn, myTurn, members, state, version, turnDeadline, expiresAt, endReason, winner, … }`. `status` goes `waiting` → `active` → `finished` (or `expired` when nobody joined in time). Seat 0 (the creator) moves first. `members[].nickname` is `null` for players without one: show „Hráč 2“. No player key ever reaches the game.

### 3. Take turns

```ts
const stop = game.matches.onChange(m.id, (match) => draw(match)); // at once, then every 5 s on a change
if (match.myTurn) await game.matches.move(m.id, { cells: { 4: 'x' } });          // passes the turn
await game.matches.move(m.id, { cells: { 8: 'x' } }, { finish: { winner: match.seat } }); // the winning move
await game.matches.move(m.id, { cells: { 2: 'o' } }, { finish: { winner: null } });       // a draw
await game.matches.resign(m.id);                                                         // gives up
```

- `move` merges the patch into the state (JSON Merge Patch, `null` deletes a key; the state ≤ 16 KB, a patch ≤ 4 KB) and passes the turn to the next seat; `keepTurn: true` keeps it (a second move in the same turn), `ifVersion` makes it conditional (`conflict` when someone moved first).
- Only the member on turn moves (`not_your_turn`). A member who does not move within `turnSeconds` loses by forfeit; the other members see `endReason: 'forfeit'` on their next read.
- `finish.scores` (one per seat) sets the scores; without it the winner gets `scoring.max` (else 1), the others `scoring.min` (else 0), a draw halfway between.

### 4. Results

When a match finishes (a finishing move, a forfeit, a resignation) the platform records **one result per member**, like a play: points, leaderboards, streaks, the daily challenge and badges (a guest counts once they chose a nickname). The game does not report the match itself. If the game calls `game.complete()` in a session that was open when the match ended, the end screen shows that match result once; it does not count twice. A game that also has a single-player mode reports those plays with `complete()` as usual.

**One play, one result.** Outside matches, a play keeps its first result: a second `complete()` in the same play returns the first completion and changes nothing. A multi-round game reports once, at the end.

### 5. Authority

With `authority: members` (default) the players' browsers move and finish: fine for casual games, but a modified client can cheat. With `authority: backend` only the game backend moves and finishes: players send their move to the backend (`game.api.fetch('/move', …)`), which checks it against the rules and calls `matches.move` / `matches.finish` from `@azet/games-server` (below). A member's `move` then rejects with `forbidden`.

### 6. Limits and local play

20 open matches per player and game, 50 new matches a day, 30 moves a minute (`limit_reached`). `azg dev` keeps the matches of every tab in memory with the same rules: open the dev shell in two tabs to play against yourself. The CMS builder preview keeps them in the page, so a match there never gets a second player. Signed-in players see „Si na ťahu“ on the tenant's games page when a match waits for their move. Editors see the game's matches on **Games → game → Multiplayer**.

## From a game backend

The backend reads the same data with its game token (`AZG_GAME_TOKEN`, `AZG_API`; see SDK-CONTRACT §8). The player is the one of a play session of this game (`player.session` of the verified player token), so a backend reads only players who play through its own proxy.

```ts
import { getLeaderboard, getPlayerSummary, listLeaderboards, verifyPlayerToken } from '@azet/games-server';

const player = await verifyPlayerToken(req.headers.authorization);
const summary = await getPlayerSummary(player);                  // same shape as game.player.get()
const boards = await listLeaderboards();
const board = await getLeaderboard('default', { player, around: 'me', limit: 5 });
```

With `matches.authority: backend` the backend is the referee of the game's matches:

```ts
import { matches, verifyPlayerToken } from '@azet/games-server';

async function onMove(req: Request, body: { match: string; move: unknown }): Promise<Response> {
  const player = await verifyPlayerToken(req.headers);
  const m = await matches.get(body.match);                     // members carry `player` (the player key)
  const seat = m.members.find((x) => x.player === player.id)?.seat;
  if (m.status !== 'active' || seat === undefined || seat !== m.turn || !legal(m.state, body.move)) return new Response(null, { status: 409 });
  const next = apply(m.state, body.move);
  if (wins(next, seat)) await matches.finish(m.id, { winner: seat });
  else await matches.move(m.id, next, { turn: (seat + 1) % m.players, ifVersion: m.version });
  return new Response(null, { status: 204 });
}
```

Requests: `GET /api/v1/game/player?session=<id>`, `GET /api/v1/game/leaderboards` and `GET /api/v1/game/leaderboards/{id}?session=&around=top|me&limit=1–50` (API.md "Game services"), `Authorization: Bearer <game token>`. Errors are thrown as `ResultError` (`status`, `code`, `message`, `details`): `401` for a missing or invalid token, `403` for a token that is not a game token, `404` for a session or board of another game or tenant, `422` for invalid parameters. Without a token the functions refuse to start.

## Limits

| What | Limit | When exceeded |
|---|---|---|
| Game-service calls (`player`, `points`, `leaderboards`) | 30 a minute per play session in the shell; the CMS limits again | `rate_limited` |
| `leaderboards.get` `limit` | 1–50 | `invalid_payload` |
| Matches | 20 open per player and game, 50 new a day, 30 moves a minute; state ≤ 16 KB, patch ≤ 4 KB | `limit_reached`, `invalid_payload` / `too_large` |
| Nickname changes | 5 a day per device | `rate_limited`, `reason: 'too_many'` |
| `leaderboards.report` | 5 a day per device | `rate_limited` |
| A platform without game services (an older CMS) | – | `backend_error`; draw nothing |
| Realtime message, state patch | JSON ≤ 4 KB | `too_large` |
| Realtime room state | JSON ≤ 16 KB | `too_large`, nothing changes |
| Realtime messages and state writes | 20 a second per session (burst 40), 32 KB a second; 200 a second per room | `error` event / `rate_limited`; 10 s above the limit closes the room (`close` `rate_limited`) |
| Realtime rooms | 2–50 players (manifest), 200 rooms per game; a room closes after 30 minutes without a message or state write | `room_full`; `close` `idle` |
