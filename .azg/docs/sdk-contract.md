# SDK contract (protocol 1)

This is the contract between a game and the game shell. **It is frozen on 23 October 2026.** Status 11 Oct: feature-complete and verified with two reference games (Daily Quiz, Snake) and four templates; only additive changes until the freeze. After that, protocol 1 only gets additive, backwards-compatible changes. Anything else becomes protocol 2, and the shell keeps supporting protocol 1.

Games use `@azet/games-sdk`, which implements this protocol. The raw message format is documented so that the shell, the dev shell and the contract test can be verified against it.

## 1. Responsibilities

| The shell does | The game does |
|---|---|
| Loading screen, start screen, pause, end screen | Gameplay |
| Branding (theme values, fonts) | Uses theme values (`--azg-*` CSS custom properties or `init().theme`) |
| Player identity, login prompt | Nothing |
| Streaks, points, leaderboard, percentile | Reports `complete()` with its score |
| Events to the data pipeline (docs/EVENTS.md): session, loading, plays, clicks, errors | Optional custom events via `track()`, declared in `events:` |
| Persistence and backend access | Uses `game.store` and `game.api.fetch` |

## 2. SDK API

```ts
import { game } from '@azet/games-sdk';

const ctx = await game.init();
// ctx.settings  Record<string, unknown>   values from the CMS, validated against the manifest
// ctx.level     { date: '2026-10-30', seed: 'b3f1…', mode: 'daily' | 'endless' | 'none' }
// ctx.theme     Theme (see §5)
// ctx.locale    'sk'
// ctx.player    { loggedIn: boolean, nickname: string | null }
// ctx.env       'dev' | 'preview' | 'live'
// ctx.invite    { room: string | null, params } | null   the invite link this page was opened from (INV-1)

game.ready();                              // assets loaded; the shell hides the loading screen
game.onStart(() => startGame());           // player pressed Play (or start screen is off)
game.onPause(() => pause());
game.onResume(() => resume());
game.onThemeChange((theme) => applyTheme(theme));       // live preview in the CMS
game.onSettingsChange((settings) => applySettings(settings)); // live preview in the CMS
game.onResult((r) => showCoins(r.earned.mince ?? 0)); // HUB-3: what the platform made of the completed play

game.progress({ step: 3, of: 10 });        // optional; throttled to 1 per second
game.complete({ score: 840, timeSeconds: 95, success: true, details: { words: 12 }, stats: { words: 12 } });
game.track('hint_used', { n: 1 });         // custom event

await game.share({ text: 'Slovný had 3/6\n🟩🟩🟨⬜⬜' }); // share text for the end screen (before complete)
const award = await game.award('first-win'); // { ok: true, badge, trust: 'cosmetic', new } | { ok: false, error }
const today = await game.challenge.get();    // DailyChallenge | null (RET-1)
helpButton.onclick = () => game.openLink('https://www.azet.sk/clanok/…'); // OPL-1: { opened: 'tab' | 'button' }
game.setReplayLabel('Hrať ďalší level').catch(() => {}); // RPL-1: the end screen's replay button; null = default
myPauseButton.onclick = () => game.pause(); // PSE-1, with pauseButton: false: { paused: boolean }

await game.store.player.get('save');
await game.store.player.set('save', { level: 4 });
await game.store.player.delete('save');
await game.store.shared.incr('total-words', 1);
await game.store.shared.list('levels', { limit: 20 });   // keys with this prefix

const res = await game.api.fetch('/moves', { method: 'POST', body: JSON.stringify(move) });

const me = await game.player.get();          // { kind, nickname, code, points: { week, rank, lifetime }, streak, level, gameLevel, visibility }
await game.player.setNickname('Zuzka');      // anonymous players; same rules and errors as the end screen
await game.player.login();                   // { started } – the shell starts the Azet ID login
const boards = await game.leaderboards.list();
const top = await game.leaderboards.get('default', { around: 'top', limit: 5 }); // { board, entries, me, enoughPlayers }
const points = await game.points.get();      // { week, rank, lifetime }
const entryId = top.entries[0]?.entryId;      // absent on the player's own entry
if (entryId) await game.leaderboards.report(entryId, 'nickname'); // nickname | cheating | other
const tournaments = await game.tournaments.get(); // [{ slug, title, status, startsAt, endsAt, url, me }]
```

`init()` must be called once, before anything else. All other calls before `init()` resolves throw.

### One result per play (RTM-16)

A play is one session, from the shell's start to its end screen. **It keeps one result:** the first `complete()` (or the backend's `submitResult`, BE-6) is the one that counts for points, leaderboards, streaks, challenges and badges. The SDK does not send a later `complete()` of the same play and logs a console warning; a later `submitResult` for the session answers `duplicate: true` with the same result, or `409 conflict` with a different one. "Hrať znova" starts a new play with its own result.

- **Several rounds or levels in one play:** keep the running score in the game and call `complete()` once, after the last round. Use `game.progress()` for in-between updates.
- **Multiplayer:** every player's browser is its own play and reports its own result with its own `complete()`; nothing reports for another player. With a referee backend (PRD §5.33) the backend reports each player's result with `submitResult` and the shell's `complete()` only shows the end screen.
- **Who scores:** a result earns points and a place on boards only for a signed-in player or an anonymous player who chose a nickname (LBD-5.2); other plays are stored but not ranked.
- **Many mini games in one game (a hub, HUB):** declare `endScreen: compact` in `azet-game.yaml`. Each round is still its own play with one result, but after its `complete()` the shell shows a small result card at the top of the game, under the shell's buttons (score, `+N b`, a badge, the daily challenge), instead of the end screen and sends `start` again right away, so the game stays in its hub. Taps pass through the card to the game; it hides after 4 s or on its ×. The end screen's nickname, public-board and reminder prompts do not show (and are kept for a game with an end screen): offer `game.player.setNickname()` and `game.player.login()` in the game when `onResult` says `nicknamePrompt`. A compact game counts at most 60 plays of a player an hour; more are rejected `too_many` (HUB-5). `endScreen: none` is the same without the card (HUB-7): the game shows the result from `game.onResult()` itself.

### The verdict of a play (HUB-3, SDK 1.7.0)

```ts
game.onResult((r) => {
  // r: { score, points, earned: { mince: 30 }, rejected: null | 'too_fast' | 'out_of_range' | 'too_many', practice,
  //      badges: [{ id, title }], dailyChallengeCompleted, tournamentRank, nicknamePrompt, nicknameReset }
  if (r.rejected) showToast('Toto kolo sa nezapočítalo.');
  else animateCoins(r.earned.mince ?? 0);
});
```

After each completion the shell tells the game what the server decided, once, before the end screen or the compact card and before the next `start`. Every game gets it; it is optional. `points` is `null` when the play earned none (an anonymous player without a nickname, a rejected or practice play), `earned` is the currency the manifest's earn rules credited after `max` and `dailyEarnCap` (`{}` when none), `badges` the badges this play awarded. `nicknamePrompt` is `true` when the play would have counted with a nickname (an anonymous player) or a moderator reset the nickname (`nicknameReset`): a hub asks with `game.player.setNickname()` or offers `game.player.login()`, because its result card has no nickname field. `rejected: 'too_many'` is a compact game's play over 60 counted plays of the player in the last hour (HUB-5). Nothing in it can be sent back; read balances with `game.wallet.get()`.

### Links to articles (OPL-1, SDK 1.9.0)

The game frame is sandboxed without pop-ups or top navigation, so an `<a href>` or `window.open` in the game does nothing. `game.openLink(url)` asks the shell instead: „Potrebuješ pomôcť? Prečítaj si článok“.

- The URL must be `https://` on `azet.sk` or a subdomain (`www.azet.sk`, `koktejl.azet.sk`, …), at most 2048 characters, without a user, password or port. Anything else is `invalid_payload` with the reason (the shell checks it; in `azg dev` the reason is also on the console).
- The shell opens it in a new tab without a way back to the game page (`opener` cleared) and answers `{ opened: 'tab' }`. When the browser blocks the tab, the shell shows a button „Otvoriť článok ↗“ at the bottom of the game for 12 s and answers `{ opened: 'button' }`; one tap opens it.
- Call it from the player's tap or click: browsers let a page open a tab only right after the player's action.
- One link a second (`rate_limited`), at most 10 a visit (`limit_reached`). The builder preview opens nothing. A shell from before SDK 1.9.0 (a stale `azg dev`, a cached embed) does not know the message: the call fails with `unavailable` after 3 s. Each link records `article_click` (docs/EVENTS.md) with the host and path, never the query or fragment.

### The replay button (RPL-1, SDK 1.9.0)

The end screen's primary button says „Hrať znova“. A game with levels calls `game.setReplayLabel('Hrať ďalší level')` after a won level, before `complete()`; the text holds for the rest of the visit (also on later end screens) until the game changes it, and `setReplayLabel(null)` brings back the default. One line, 1–30 characters, plain text (`invalid_payload` otherwise). Set while the end screen shows, it replaces the button at once; it survives „Skúsiť znova“ after an error. Do not `await` it before `complete()` (call it, or `.catch(() => {})`): a shell from before SDK 1.9.0 does not know it and the call fails with `unavailable` after 3 s. Plain text only: no line breaks, `<`, `>`, control, bidi or zero-width characters.

The button still starts the next play (`onStart`, a `replay` event); which level that play is, is the game's: keep the level in `game.store.player` and load it in `onStart`. Editors can set a text for every play in the CMS (`screens.end.button`, RPL-2); the game's text wins. Compact end screens (HUB) have no button.

### A game's own pause button (PSE-1, SDK 1.10.0)

While the game runs, the shell draws a round pause button in the top right corner of the game window. A game that needs that corner, or wants a pause button in its own look, sets `pauseButton: false` in `azet-game.yaml` and calls `game.pause()` from its own button:

- The shell opens its pause screen exactly as after its own button: the game hears `onPause`, the pause screen shows „Ako hrať“ and „Pokračovať“, and the game hears `onResume` when the player continues. Keep pausing and resuming in `onPause` / `onResume`, not in the button's handler.
- It resolves `{ paused: true }`; `{ paused: false }` when nothing was playing (the start screen, already paused, the end screen) and nothing changed. The builder preview pauses nothing.
- A shell from before SDK 1.10.0 (a stale `azg dev`, a cached embed) does not know the message: the call fails with `unavailable` after 3 s.
- A hidden tab still pauses every game, with or without the button. With `pauseButton: false` and no button of its own, the player cannot pause, so always draw one.
- **The back arrow (BCK-1).** `backButton: false` takes the shell's round „←“ arrow off the running game, for a game with its own „Späť“ (a hub going from a mini game back to its room). The start and pause screens keep „← Späť na hry“: the pause screen is how a player leaves a hub, so with `pauseButton: false` too your own pause button must call `game.pause()`.

### Events (AZG-186)

The shell records the events of docs/EVENTS.md on its own; they need no protocol message. `game.track()` is unchanged. Declaring custom events in `events:` (docs/MANIFEST.md) is optional; in development an undeclared event or prop logs a console warning, never an error. A `track()` whose props contain a key that looks like personal data is dropped with a dev console error, by the SDK and again by the shell.

### Metrics, badges and share text (PRD 1.3.0, D-46)

Additive to protocol 1: a game that uses none of them behaves exactly as before (MET-2.1).

- **`complete({ stats })`** sends the values of the metrics the game declares in `metrics:` of `azet-game.yaml` (docs/MANIFEST.md "Metrics"), keyed by metric id, at most 10. `stats` is optional. An invalid `stats` object never costs the score: the score counts by the usual rules, the server drops the stats and answers `statsRejected: 'undeclared' | 'invalid_type' | 'out_of_range'` (MET-3.1, D-43). In development (`azg dev`, the dev shell, `azg contract`) the shell logs a console error naming the metric for an undeclared metric, a non-finite value, a non-integer for `integer`, a negative `duration` or a value outside `min`/`max` (MET-2.2).
- **`game.award(id)`** awards a badge declared with `award: game` (docs/MANIFEST.md "Badges"). Such awards are **cosmetic**: returned with `trust: 'cosmetic'`, never counted in tenant badges, leaderboards or statistics (D-45). It never throws: an undeclared id, a `rule` badge or an `award: backend` badge returns `{ ok: false, error: { code: 'invalid_payload' } }`, awards nothing and logs a console error in development (BDG-2.1). Repeated awards of the same badge are idempotent (`new: false`).
- **`game.share({ text })`** sets the share text of the current play (SHR-1); it appears on the result card, whose link the end screen's share button copies (SHR-2.2); a new `start` clears it. Plain text, ≤ 280 characters and ≤ 8 lines; longer text rejects with `too_large`, an empty one with `invalid_payload` (SHR-1.1). The shell never renders it as HTML and does not link URLs in it. Without `share()` the shell builds the text from the game name, score and streak (SHR-1.2).

### Currency, shop and inventory (ECO, AZG-196)

Additive to protocol 1: a game that declares no `currencies:` and makes no wallet calls behaves exactly as before. The currencies and items come from `azet-game.yaml` (docs/MANIFEST.md "Currencies, items and earn rules"); the platform keeps the ledger, so a game never builds its own wallet. Guide with examples: docs/GAME-SERVICES.md "Currency and shop".

```ts
const balances = await game.wallet.get();                       // { pismenka: 120 }
await game.wallet.spend('pismenka', 10, { key: 'hint-3f2a', reason: 'hint' });
const s = await game.shop.buy('druhy-zivot', { key: crypto.randomUUID() }); // price from the manifest
const items = await game.inventory.get();                       // { 'druhy-zivot': 1 }
await game.inventory.consume('druhy-zivot', 1, { key: `life-${ctx.level.date}` });
// every write resolves with { balances, inventory, duplicate }
```

- **No earning from the game (anti-cheat, ECO-3).** There is no earn call and no earn message: the shell refuses any wallet op other than `get`, `spend`, `buy`, `inventory` and `consume`. Currency is earned only on trusted paths: the manifest's `earn:` rules on a validated `complete` (never on a rejected or practice play) and the game backend (`wallet.credit` or `submitResult({ currency })`, §8). Both respect the currency's `max` and `dailyEarnCap` and the rule's per-play `max`.
- **Idempotency (ECO-4).** Every write carries a `key`; the same key with the same operation applies once and answers the current state with `duplicate: true`; the same key with a different operation answers `conflict`. Keys are per player and game. Use a fresh key per user action (`crypto.randomUUID()`), or a meaningful one to apply something once (`life-<date>`: one extra life per day).
- **The price comes from the manifest (ECO-4).** `buy` sends only the item id; the shell drops every other field and the server charges `items[].price`.
- **Never negative.** A spend or buy above the balance answers `insufficient_funds`, a consume above the owned count `insufficient_items`; nothing changes. Two parallel spends never overdraw.
- **Limits.** Buying beyond `maxPerPlayer` (or a second non-stackable item) answers `quota`. An undeclared currency or item answers `invalid_payload` (in development the shell also logs a console error).
- **Who has a wallet.** Signed-in and nickname players; an anonymous player's wallet is kept on the device key (D-47) and moves to the account when the player signs in on that device (MRG-1). With the tenant's economy switched off every call answers `economy_disabled`; a game should then hide its shop.

### Game services (GSV, additive since 13 Oct 2026)

Additive to protocol 1: `game.player`, `game.points` and `game.leaderboards` read the player, their points and the boards, and let an anonymous player choose a nickname, so a game with its own UI uses the same data as the shell. The full guide with examples is [GAME-SERVICES.md](game-services.md).

- The shell proxies every call to the CMS with the session's play token; the game iframe has no CMS cookies. A platform without game services answers `backend_error`.
- **Read only.** No message writes a score: scores reach leaderboards only through `complete` (§8) or a backend's `submitResult` (BE-6).
- `setNickname` follows LBD-5: a rejection carries `reason` (`invalid`, `denied`, `too_many`, `flood`, `signed_in`) and the Slovak message of the shell's nickname field.
- `leaderboards.get(id)` takes a board id from `list()`, a `leaderboards:` id from the manifest, or `'default'`; every call records a `leaderboard_open` event.
- `leaderboards.report(entryId, reason)` reports a listed entry to the tenant's moderators (MOD-6, PRD §5.27, D-61); `entryId` comes from `get()` and is absent on the player's own entry. `reason` is `nickname`, `cheating` or `other`. 5 reports a day per device (`rate_limited`); an unknown or own entry rejects with `invalid_payload`.

### Daily challenge and streak freeze (Retention, AZG-206)

Additive to protocol 1 (13 Oct, before the freeze): a game that does not call it behaves exactly as before.

- **`game.challenge.get()`** resolves the tenant's daily challenge for today with the player's progress, or `null` when the tenant has none today (or the platform offers none, e.g. an older dev shell). It is read-only: the server counts progress from validated completions, a game cannot advance it. A game may show it, e.g. "Denná výzva: 1/2" in its own UI.

  ```ts
  interface DailyChallenge {
    date: string;        // Bratislava day, YYYY-MM-DD
    title: string;       // Slovak, plain text, e.g. "Zahraj 2 rôzne hry"
    progress: number;    // 0…target
    target: number;
    completed: boolean;
    bonusPoints: number; // added to the points of the completing play
    streak: number;      // days in a row the player completed the daily challenge
  }
  ```

  Only these fields reach the game. Errors reject like `store`: `timeout`, `backend_error`; before `init()` `not_initialized`.
- **End screen (shell only, no game call).** The shell shows the challenge progress after a play ("Denná výzva 1/2" with its title, or "Denná výzva splnená! +N b" on the completing play), "Séria zachránená ❄️" on the streak card when a streak freeze kept the shared streak over a missed day, and once, for a signed-in player with a 3-day shared streak, the question "Pripomenúť mi sériu?" (default off). The completion result carries `dailyChallenge`, `sharedStreak.freezeUsed` and `reminderPrompt`; the server decides all three.
- **Freeze rule** shared by the server and the dev shell: `nextStreakWithFreeze` in `@azet/games-shell` keeps a shared streak over a gap of at most one missed Bratislava day when the player holds a freeze (one freeze per missed day); a longer gap restarts it.
- `azg dev` simulates both: `MemoryAdapter` options `dailyChallenge: { title, target, bonusPoints }` (every counted play is one step) and `streakFreezes`.

### Tournaments (TRN-2)

Additive to protocol 1: a game that does not call it behaves exactly as before.

- **`game.tournaments.get()`** resolves with the tournaments of the tenant this game is part of, scheduled, live and those finished in the last 14 days, by start, each `{ slug, title, status: 'scheduled' | 'live' | 'finished', startsAt, endsAt, url, me }`. `startsAt`/`endsAt` are ISO 8601 instants (the window is set in Bratislava time); `url` is the public tournament page (`/turnaj/<slug>` on the tenant host), `null` in the dev shell; `me` is `{ rank, value }`, the player's place and value on the live board or, after the end, on the confirmed frozen board; `null` while the player is not ranked and on a finished tournament until its results are confirmed. A platform or a game without tournaments resolves with `[]`, never an error. Other failures reject with a `GameError` like `store` (e.g. `timeout`). Read-only: what counts toward a tournament is decided by the server from the normal `complete()`, the game does nothing extra.
- **End screen.** When a play counted in a live tournament, the shell shows "Turnaj: si 7." with the tournament title and a link to its page. The game does nothing for it.

### Realtime multiplayer (RTM)

> **Status: approved by Lukáš on 19 Oct (AZG-316), implemented in `@azet/games-sdk`, the shell and `azg dev` (AZG-323); part of the contract frozen on 23 Oct (additive changes only afterwards).** Deployed on the cluster since 20 Oct (`azet-games-realtime.rin.rinapps.dev`, `apps/realtime`, RTM-9) and enabled for the sandbox tenant `azet-hackathon`; production tenants (`azet`, `koktejl`) reject every call with `realtime_disabled` until enabled (RTM-9.2). Per-IP caps: RTM-7.9. Additive to protocol 1: a game that does not use it behaves exactly as before. Rules and acceptance criteria: PRD §5.31 (RTM); decisions D-77 (the shell holds the WebSocket) and D-78 (service, limits). **Rooms that end (21 Oct, PRD §5.32, D-80, additive):** `create()` with invite codes, `join(code, { create: false })`, waiting rooms expire (`expired`), per-player limits (`limit_reached`), editors close rooms in the CMS (`closed`). **Multiplayer 1.21 (21 Oct, PRD §5.35–§5.37, D-84–D-86, additive):** one socket per game session from the start (`connect()`, players online), bots (`playBot`), a verified `profile` of every member, a nickname required for rooms (`nickname_required`, the shell asks).

A game declares `realtime:` in `azet-game.yaml` (docs/MANIFEST.md "Realtime") and then joins rooms of its own game in its tenant. The shell holds the connection to the realtime service; the game never sees a token, a URL, a session id or a player key.

```ts
interface RealtimeMember {
  id: string;               // opaque, stable for this session in this room
  nickname: string | null;  // every player in a room has one (NICK-1); null only for players a moderator hid
  host: boolean;
  bot?: true;               // BOT-2: a bot the game's referee plays ('bot-1' …); never the host
  profile?: RealtimeProfile; // PRS-2: verified by the platform when the player connected; absent for bots
}

interface RealtimeProfile {
  level: number;                                          // platform level from lifetime points (PLV-1)
  gameLevel: { level: number; title: string | null } | null; // this game's level (PRG-1), null without progression:
  week: number;                                           // this week's points
  rank: number | null;                                    // place on the default board; null when the player is not listed
}

interface Room {
  readonly id: string;                         // the id given to join(), the invite code of create(), 'q-<random>' for a quick match or 'b-<random>' against bots
  readonly me: RealtimeMember;
  readonly members: readonly RealtimeMember[]; // me included, in join order
  readonly host: RealtimeMember;
  readonly state: Readonly<Record<string, unknown>>; // current shared state (a frozen copy)
  readonly version: number;                    // increments with every applied state write
  readonly maxPlayers: number;
  readonly referee: boolean;                   // REF: the game's backend decides; send() then reaches only it
  readonly bots: { readonly level: string; readonly ids: readonly string[] } | null; // BOT-2: practice, never counted

  send(data: unknown, opts?: { to?: string }): void;  // to all others, or one member id; JSON ≤ 4 KB
  setState(patch: Record<string, unknown>, opts?: { ifVersion?: number }): Promise<{ version: number }>;
  leave(): Promise<void>;

  on(event: 'join', fn: (member: RealtimeMember) => void): () => void;
  on(event: 'leave', fn: (member: RealtimeMember, reason: 'left' | 'disconnected' | 'idle') => void): () => void;
  on(event: 'host', fn: (member: RealtimeMember) => void): () => void;
  on(event: 'message', fn: (data: unknown, from: RealtimeMember) => void): () => void;
  on(event: 'state', fn: (state: Readonly<Record<string, unknown>>, change: { patch: Record<string, unknown>; version: number; from: RealtimeMember }) => void): () => void;
  on(event: 'reconnecting' | 'reconnected', fn: () => void): () => void;
  on(event: 'close', fn: (reason: 'left' | 'idle' | 'restart' | 'disconnected' | 'replaced' | 'rate_limited' | 'expired' | 'closed' | 'ended' | 'referee_lost') => void): () => void;
  on(event: 'error', fn: (error: GameError) => void): () => void; // e.g. a dropped send: rate_limited
}

const room = await game.realtime.join('stol-7');            // a room id chosen by the game (opened when nobody is in it)
const invite = await game.realtime.create();                // a new room with a 6-character invite code: invite.id, e.g. 'K7MP2X'
const friend = await game.realtime.join('K7MP2X', { create: false }); // only an existing room, else `not_found`
const match = await game.realtime.quickMatch({ players: 2, timeoutSeconds: 30, signal }); // the server pairs players
const practice = await game.realtime.playBot({ level: 'easy' }); // BOT-2: against bots the referee plays
const { url } = await game.invite.link({ room: invite.id }); // INV-1: a link that opens the friend at this table
await game.realtime.connect();                              // RTM-18: optional, e.g. when the lobby opens
game.realtime.online;                                       // PRS-1: players of this game online now, or null
game.realtime.onPresence((online) => showOnline(online));   // at most every 5 s, returns an unsubscribe
```

Example (the core of `games/tap-race`):

```ts
const ctx = await game.init();
game.ready();
game.onStart(async () => {
  const room = await game.realtime.quickMatch({ players: 2 });
  let taps = 0;
  const others = new Map<string, number>();
  room.on('message', (data, from) => {
    if ((data as { t?: string }).t === 'tap') others.set(from.id, (data as { n: number }).n);
    drawRivals(others);
  });
  room.on('state', (state) => {
    if (state.phase === 'go') enableButton();
    if (state.winner) finish(state.winner === room.me.id);
  });
  room.on('leave', () => showWaiting('Súper odišiel'));
  if (room.me.host) {
    await room.setState({ phase: 'countdown', at: Date.now() + 3000 });
    setTimeout(() => room.setState({ phase: 'go' }), 3000);
  }
  onTap(async () => {
    room.send({ t: 'tap', n: ++taps });
    if (taps === 30) {
      // only the first writer wins: the second write sees another version and gets `conflict`
      await room.setState({ winner: room.me.id }, { ifVersion: room.version }).catch(() => {});
    }
  });
  function finish(won: boolean) {
    game.complete({ score: taps, success: won });
    room.leave();
  }
});
```

- **One room at a time.** `join`, `create`, `quickMatch` or `playBot` while in a room (or while another of them is still pending) rejects with `conflict`; after `leave()` or a `close` event the game may join again. Rooms are per tenant and game: the same id in another game is another room. A full room rejects with `room_full`; an invalid id (not 1–64 characters `A–Z a–z 0–9 _ -`) with `invalid_payload`.
- **Invite codes and waiting rooms (RTM-13).** `create()` opens a room with a server-made code of 6 characters `A–Z 2–9` without the look-alikes `0 O 1 I`, unique among the game's live rooms: show it (or put it in a link) and let the friend `join(code, { create: false })`, which rejects with `not_found` for a mistyped or expired code instead of opening an empty room. A room is **waiting** until it first has two members and **playing** from then on. A waiting room closes after `realtime.waitSeconds` (manifest, 10–600, default 120) with `close` reason `expired`: tell the host nobody came and offer to invite again or quick match. Once a room has started it never expires as waiting, also when members leave and come back.
- **Referee (REF, D-81).** With `realtime.authority: referee` the game's backend decides every room: `room.referee` is `true`, `send()` reaches only the referee, `setState()` rejects with `forbidden`, and the referee's messages and state writes come `from` `{ id: 'referee', nickname: null, host: false }`. Join, create and quick match reject with `unavailable` while the referee is not connected. `close` reasons `ended` (the referee ended the game, results are reported by the backend) and `referee_lost` (the backend was gone for more than 15 s). **Only the referee's result counts (REF-7).** In a game with `authority: referee` the score a `complete()` passes is never stored, in every mode of the game (a single-player mode of such a game counts nothing either). A `complete()` before the referee reported stores nothing and the end screen says „Výsledok potvrdzuje server hry“; a `complete()` after it shows the referee's result. So call `complete()` after the room closed with `ended`, with a fallback timer (piškvorky waits 6 s) in case `ended` never comes (`referee_lost`). `complete()` returns nothing; the game does not learn which case it was. [Game services](game-services.md) "Referee".
- **One socket per session (RTM-18, D-86).** On a platform with realtime the shell connects every game session once the game is `ready()`, also games without a `realtime:` block (they get presence only; their `join`, `create`, `quickMatch` and `playBot` reject with `realtime_disabled`). The socket stays between rooms: the next `create`, `join`, `quickMatch` or `playBot` needs no new ticket. A session the shell connected at start (or that called `connect()`) keeps it while the page is open and gets it back by itself when the service drops it (restart, a background tab); a socket the shell opened only for a room closes after 5 minutes without a room. It closes when the page goes away. `connect()` resolves once connected (call it when the lobby opens if the game wants to be sure).
- **Players online (PRS-1).** `game.realtime.online` is the number of players with this game open right now (this one included), `null` until connected; `onPresence(fn)` hears every change, at most every 5 s. Show it in the lobby („Práve hrá 23 hráčov“). It is a count only, never who.
- **Who plays (PRS-2).** Every member has `profile` from the platform, not from the game: `level` (the platform level, PLV-1), `gameLevel` (`{ level, title }` of the game's `progression:`, PRG-1), `week` (this week's points) and `rank` (only for players listed on boards). A game cannot change it, so „Zuzka · level 7“ next to the board is trustworthy. It is the state when the socket connected (the session keeps one socket), so points won in this session show from the next session. Bots have no profile.
- **Nickname (NICK-1).** A room needs a nickname. Without one the shell shows „Ako ťa majú volať?“ over the game, saves the nickname and retries; the call waits for that (room calls time out after 150 s, not 10 s). Only when the player cancels, or does not answer within 2 minutes, does the call reject with `nickname_required` (say „Na hru s ostatnými potrebuješ prezývku.“). Hiding the nickname from boards does not hide it from the players of a room.
- **Bots (BOT, D-84).** With `realtime.bots` (needs `authority: referee`) `playBot({ level })` opens a playing room of the player and `quickMatch − 1` bots: members with `bot: true`, nickname `Bot`, ids `bot-1` …, and `room.bots` is `{ level, ids }`. With `realtime.bots.after` a quick match that waited that long gets bots for its free seats; with `after` longer than the quick match's `timeoutSeconds` the bot comes 1.5 s before the timeout. The referee moves for the bots. A bot game is **practice**: the result never earns points, ranks, streaks, badges or currency. Errors: `forbidden` (no `realtime.bots`), `invalid_payload` (a level not in `levels`), `unavailable` (no referee).
- **Invite links (INV-1, D-87).** `game.invite.link({ room?, params? })` resolves with `{ url }`, the game page with `azg_invite=…`. The friend who opens it starts the game with `ctx.invite` = `{ room, params }`. It comes once per page load (a reload or „Skúsiť znova“ does not bring it back), but `ctx` keeps it for the whole page, also through „Hrať znova“: take it into a variable, clear that after the first join, and catch `not_found` for an expired code (sample in [Game services](game-services.md#2-get-into-a-room)). `params` are at most 10 small values (`^[a-z][a-zA-Z0-9_]{0,31}$` keys; booleans, finite numbers, strings ≤ 64 characters; ≤ 512 bytes): a level, a mode. Anyone can build such a link: validate `ctx.invite` like any input. Errors: `invalid_payload` (a bad room or params), `unavailable` (no game page, e.g. the builder preview).
- **React (HOOK-1).** `import { useRoom, useOnline, usePlayer } from '@azet/games-sdk/react'`: `useRoom(room)` gives `{ members, me, host, state, version, closed, reconnecting }` and re-renders on every change; `useOnline()` the players online; `usePlayer()` `{ player, error, reload }`. They remove their listeners on unmount. They use the default `game` (not a `new Game()`); `usePlayer()` loads once on mount, so mount it after `init()` resolved (or call `reload()`); `useRoom` does not re-render on `message` (use `room.on('message', …)`), and a room that is already closed shows `closed: null`.
- **Per-player limits (RTM-14).** One player (counted by their player key across tabs and sessions) has at most 3 rooms or quick-match waits at once and opens at most 20 new rooms in 10 minutes; beyond that `join`, `create` and `quickMatch` reject with `limit_reached`. A new `quickMatch` of the same player replaces their earlier wait in another tab (that one rejects with `cancelled`). Joining an existing room is not a new room.
- **Quick match** pairs `players` sessions (2…`maxPlayers`, default the manifest's `quickMatch`) of the same game **version**, so a new deploy never pairs incompatible builds. It rejects with `timeout` after `timeoutSeconds` (default 30, at most 120) and with `cancelled` when `signal` aborts. The request timeout of §6 does not apply to it.
- **Presence and host.** `members` lists everyone in join order; the host is the earliest joined member, and when it leaves the next one becomes host (`host` event). Use the host for anything that needs one authority (countdowns, dealing cards, the end of a round).
- **Messages** go through the server, to every other member or to `to`; the sender never gets its own message back. They arrive in the order the server received them. `send` is fire-and-forget: a message over 4 KB throws `too_large` synchronously; a dropped one (rate limit) raises an `error` event.
- **Room state** is one JSON object changed by [JSON Merge Patches](https://www.rfc-editor.org/rfc/rfc7386) (`null` deletes a key; nested objects merge, arrays are replaced). Writes are applied in the order the server receives them (last writer wins per key), each one increments `version`, and every member, the writer included, gets a `state` event. `ifVersion` makes a write conditional (`conflict` when someone wrote first). With `stateWrites: host` in the manifest only the host may write (`forbidden` otherwise). Late joiners get the current state. The state lives only while the room has members (60 s after the last one left it is gone) and is lost on a service restart: never keep scores or progress only there, use `complete()`, `game.store` or a backend.
- **Connection.** The shell reconnects by itself; within 15 s the game sees `reconnecting` then `reconnected` and keeps its member id and host role; after that `close` (`disconnected`). `close` reasons: `left` (own `leave()`), `idle` (30 minutes without a message or state write), `restart` (the service restarted, all rooms are gone), `disconnected`, `replaced` (the same session connected again, e.g. a second shell), `rate_limited` (stayed above the limit), `expired` (a waiting room nobody joined in time, RTM-13), `closed` (an editor closed the room in the CMS, RTM-15, or the referee removed the player), `ended` (the referee ended the game), `referee_lost` (the game's referee was gone for more than 15 s). Offer „Hrať znova“ after a `close`.
- **Scores stay trusted-path only.** Realtime messages never write a score, a wallet or a badge; each player still ends with `complete()` (or the game's backend with `submitResult`).
- **In development** `azg dev` runs the same room engine in memory: open the dev shell in two tabs to play against yourself. The CMS builder preview (`MemoryAdapter`) gives a room with only the player; quick match there rejects with `timeout` at once.
- **After `reconnected`** `members`, `host`, `state` and `version` are the room as it is now; messages sent while the connection was down are not replayed, state writes are (they are in `state`). On a closed room `send` throws and `setState` rejects with `conflict`; `leave` does nothing.
- **Platform support.** A shell without realtime never answers a `realtime` message, so `join` and `quickMatch` reject with `realtime_disabled` after the request timeout of §6 (for `quickMatch` after `timeoutSeconds` + 10 s). A current shell always answers before that (`unavailable` when the service cannot be reached within 8 s).
- **Limits in the shell.** The shell enforces the per-session frame limit before the service does (20 a second, burst 40): a dropped `send` raises an `error` event `rate_limited`, a dropped `setState` rejects with `rate_limited`.

#### Wire protocol (shell ↔ realtime service)

The shell, `azg dev` (`ws://localhost:<port>/__azg/realtime`) and the realtime service (`wss://<realtime host>/v1`) speak the same JSON text frames; the room engine `@azet/games-realtime` (`packages/realtime`) defines them and is shared by all three. Games never see this layer.

| Direction | Frames |
|---|---|
| shell → service | `{ t: 'auth', ticket }` (the first frame, within 5 s), `{ t: 'join', id, room, create? }`, `{ t: 'create', id }`, `{ t: 'quick', id, players?, timeoutSeconds? }`, `{ t: 'bot', id, level? }`, `{ t: 'cancel', id }`, `{ t: 'leave', id }`, `{ t: 'send', data, to? }`, `{ t: 'state', id, patch, ifVersion? }`, `{ t: 'ping' }` (every 20 s) |
| service → shell | `{ t: 'ok', id, room?, version?, resumed?, online? }`, `{ t: 'presence', online }`, `{ t: 'error', id?, code, version? }`, `{ t: 'joined', room }`, `{ t: 'member_join', member }`, `{ t: 'member_leave', member, reason }`, `{ t: 'host', member }`, `{ t: 'message', from, data }`, `{ t: 'state', patch, version, from }`, `{ t: 'close', reason }`, `{ t: 'pong' }` |

- The game's referee (REF) authenticates with a referee ticket and then sends `{ t: 'r_send', room, data, to? }`, `{ t: 'r_state', id, room, patch, ifVersion? }`, `{ t: 'r_end', id, room }`, `{ t: 'r_kick', id, room, member }` and receives `{ t: 'r_room', room }` (with each member's `session`, `player`, `loggedIn`), `{ t: 'r_join', room, member }`, `{ t: 'r_leave', room, member, reason }`, `{ t: 'r_message', room, from, data }`, `{ t: 'r_close', room, reason }`. These frames never go to members; a member frame with an `r_` op is `invalid_payload`.
- `auth` is answered with `{ t: 'ok', id: 'auth', resumed, online }` (`online`: PRS-1). When the session still had a room within the 15 s grace, `resumed` is `true` and `{ t: 'joined', room }` follows with the same member id; the shell then emits `reconnected` with that room.
- `room` is `{ id, referee?, bots?, me, members, host, state, version, maxPlayers }`; `member` is `RealtimeMember` (with `bot` and `profile`); the referee's `r_room` carries `mode` (`named`, `quick` or `bot`) and `bots`; `from` is a member id. The shell maps it to the game's `{ room: id, … }` and passes only these fields.
- A `state` write is answered after its `state` frame, so the writer's room is current when `setState` resolves.
- Close codes: `4001` unauthorized (bad, reused or expired ticket; the game sees `forbidden`), `4008` rate limited, `4009` replaced, `1001` restart, `1013` unavailable (connection cap), `4000` heartbeat timeout (60 s without a frame). Frames above 8 KB, binary frames and malformed frames get `{ t: 'error', code: 'invalid_payload' | 'too_large' }` and the connection stays open.

### Matches (MAT, additive since 21 Oct 2026)

Asynchronous turn-based matches kept by the CMS (PRD §5.34, D-82; usage in GAME-SERVICES "Matches"). Like every service the call goes through the shell with the session; the game never sees a player key.

```ts
interface MatchesService {
  create(options?: { players?: number }): Promise<MatchData>;  // invite code in `code`
  join(code: string): Promise<MatchData>;                      // 6 characters A–Z 2–9, any case
  quick(options?: { players?: number }): Promise<MatchData>;
  list(): Promise<MatchList>;                                  // { open: MatchData[]; finished: MatchData[] }
  get(id: string): Promise<MatchData>;
  move(id: string, patch: Record<string, unknown>, options?: { ifVersion?: number; keepTurn?: boolean; finish?: MatchFinish }): Promise<MatchData>;
  resign(id: string): Promise<MatchData>;
  onChange(id: string, listener: (match: MatchData) => void): () => void; // polls every 5 s
}
interface MatchFinish { winner: number | null; scores?: number[] }
interface MatchData {
  id: string; code: string | null; status: 'waiting' | 'active' | 'finished' | 'expired';
  players: number; seat: number; turn: number | null; myTurn: boolean;
  members: Array<{ seat: number; nickname: string | null; me: boolean; outcome: 'win' | 'loss' | 'draw' | null; score: number | null }>;
  state: Record<string, unknown>; version: number;
  turnDeadline: string | null; expiresAt: string | null;   // ISO 8601
  endReason: 'finished' | 'forfeit' | 'resigned' | 'expired' | null; winner: number | null;
  createdAt: string; updatedAt: string;
}
```

The SDK and the shell check every request with the same function (`checkMatchRequest`); the shell forwards only the fields of the op. A finished match records each member's result itself (§8): the game reports nothing for it, and a `complete()` of a session that was open when the match ended returns that result once.

## 3. Lifecycle

```
game loads ──hello──▶ shell
game ◀──init──────── shell          (settings, level, theme, player, nonce)
game ──ready────────▶ shell          (≤ 10 s after hello, else error screen)
                      shell shows start screen
game ◀──start─────── shell
game ──progress*────▶ shell
game ◀──pause/resume─ shell          (tab hidden, pause button, game.pause())
game ──complete─────▶ shell
game ◀──result────── shell          (HUB-3: the server's verdict)
                      shell shows end screen (endScreen: compact: a result card; none: nothing)
game ◀──start─────── shell          ("Play again", if the game allows replay; compact: at once)
```

A game may call `complete()` once per `start`. A second call before the next `start` is ignored with a dev warning.

## 4. Messages

Every message is an object posted with `window.postMessage`:

```ts
interface Message {
  azg: 1;              // protocol version
  type: string;
  id?: string;         // request id for request/response pairs
  nonce?: string;      // required on every game → shell message after init
  payload?: unknown;
}
```

The game posts to `window.parent` with target origin `*` (the game runs on an opaque origin and cannot know the shell's origin for certain). The shell posts to the iframe with target origin `*` because the iframe's origin is opaque. The shell accepts a message only if `event.source === iframe.contentWindow` and, after `init`, the nonce matches. Nothing secret is sent to the game: settings, theme and nickname only.

### Game → shell

| type | payload | Response |
|---|---|---|
| `hello` | `{ sdk: string, protocol: 1 }` | `init` |
| `ready` | – | – |
| `progress` | `object`, ≤ 1 KB JSON | – |
| `complete` | `{ score: number, timeSeconds?: number, success?: boolean, details?: object, stats?: Record<string, number> }` (details ≤ 2 KB, stats ≤ 10 metrics) | – |
| `track` | `{ name: string, props?: object }` (name `^[a-z][a-z0-9_]{1,39}$`, props ≤ 1 KB, no personal-data keys) | – |
| `store` | `{ op: 'get'|'set'|'delete'|'incr'|'list', scope: 'player'|'shared', key: string, value?: unknown, by?: number, limit?: number }` | `response` |
| `fetch` | `{ path: string, method?: string, headers?: Record<string,string>, body?: string }` | `response` |
| `award` | `{ badge: string }` (`^[a-z][a-z0-9-]{1,39}$`) | `response` with `{ trust: 'cosmetic', new: boolean }` |
| `share` | `{ text: string }` (≤ 280 chars, ≤ 8 lines) | `response` |
| `wallet` | `{ op: 'get'|'inventory' }`, `{ op: 'spend', currency, amount, key, reason? }`, `{ op: 'buy', item, key }`, `{ op: 'consume', item, n?, key }` | `response` with `{ balances: Record<string, number>, inventory: Record<string, number>, duplicate? }` |
| `player` | `{ op: 'get' }`, `{ op: 'nickname', nickname: string }` or `{ op: 'login' }` | `response` with the player summary, `{ nickname, me }` or `{ started: boolean }` |
| `leaderboard` | `{ op: 'list' }`, `{ op: 'get', board: string, around?: 'top' \| 'me', limit?: 1–50 }` or `{ op: 'report', entryId: string, reason: 'nickname' \| 'cheating' \| 'other' }` | `response` with `LeaderboardInfo[]`, `{ board, entries, me, enoughPlayers }` or `null` |
| `challenge` | `{}` | `response` with `DailyChallenge \| null` (RET-1) |
| `tournaments` | `{}` | `response` with `{ tournaments: Tournament[] }` (TRN-2) |
| `realtime` (RTM) | `{ op: 'join', room, create? }`, `{ op: 'create' }`, `{ op: 'quick', players?, timeoutSeconds? }`, `{ op: 'bot', level? }`, `{ op: 'connect' }`, `{ op: 'cancel' }`, `{ op: 'leave' }`, `{ op: 'state', patch, ifVersion? }`; `{ op: 'send', data, to? }` has no response | `response`; `join`/`create`/`quick`/`bot` with `{ room, me, members, host, state, version, maxPlayers, referee?, bots? }`, `state` with `{ version }` |
| `invite` (INV-1) | `{ room?, params? }` | `response` with `{ url }` |
| `link` (OPL-1) | `{ url }` | `response` with `{ opened: 'tab' \| 'button' }`; `invalid_payload`, `rate_limited`, `unavailable` |
| `replay_label` (RPL-1) | `{ text: string \| null }` | `response`; `invalid_payload` |
| `pause_request` (PSE-1) | `{}` | `response` with `{ paused: boolean }`; `unavailable` |
| `matches` (MAT) | `{ op: 'create'\|'quick', players? }`, `{ op: 'join', code }`, `{ op: 'list' }`, `{ op: 'get'\|'resign', id }`, `{ op: 'move', id, patch, ifVersion?, keepTurn?, finish? }` | `response` with `MatchData`, or `{ open, finished }` for `list` |
| `error` | `{ message: string, stack?: string }` | – |

### Shell → game

| type | payload |
|---|---|
| `init` | `{ nonce, settings, level, theme, locale, player, env, invite? }` |
| `start` | – |
| `result` (HUB-3) | `{ score, points: number \| null, earned: Record<string, number>, rejected: 'too_fast' \| 'out_of_range' \| 'too_many' \| null, practice: boolean, badges: { id, title }[], dailyChallengeCompleted: boolean, tournamentRank: number \| null, nicknamePrompt: boolean, nicknameReset: boolean }` |
| `pause` / `resume` | – |
| `theme` | `Theme` |
| `settings` | `Record<string, unknown>` |
| `response` | `{ ok: true, data } | { ok: false, error: { code, message, reason? } }` with the request `id`; `reason` only for nickname errors |
| `realtime` (RTM) | `{ event: 'join' \| 'leave' \| 'host', member, reason? }`, `{ event: 'message', data, from }`, `{ event: 'state', patch, version, from }`, `{ event: 'reconnecting' }`, `{ event: 'reconnected', room? }` (`room` as in the `join` response), `{ event: 'close', reason }`, `{ event: 'error', code }`, `{ event: 'presence', online }` (not tied to a room); `member` and `from` are `RealtimeMember` |

## 5. Theme

```ts
interface Theme {
  mode: 'light' | 'dark';
  colors: {
    primary: string; onPrimary: string; accent: string;
    background: string; surface: string;
    text: string; textMuted: string; border: string;
    success: string; danger: string;
  };
  font: { family: string; cssUrl: string | null };
  radius: number; // px
}
```

The SDK also sets CSS custom properties on `document.documentElement`: `--azg-primary`, `--azg-on-primary`, `--azg-accent`, `--azg-background`, `--azg-surface`, `--azg-text`, `--azg-text-muted`, `--azg-border`, `--azg-success`, `--azg-danger`, `--azg-font`, `--azg-radius`. It loads `font.cssUrl` if present.

**UI kit (additive, AZG-317).** The SDK package also ships `@azet/games-sdk/ui.css` (in the `html` starter: `azet-games-ui.css`): plain CSS components (`azg-*` classes, a few `data-*` attributes) built only on the variables above, so they follow the theme without code. It is optional, has no JavaScript and does not change the protocol; it stays below 10 KB gzipped. `.azg-ad-slot` is an empty ad placeholder only. Components and markup: [HACKATHON.md](hackathon.md#ui-kit).

## 6. Limits

| What | Limit | When exceeded |
|---|---|---|
| Time from `hello` to `ready` | 10 s | Shell shows an error screen with "Try again" |
| `progress` rate | 1 per second | Extra messages dropped |
| `track` rate | 60 per minute | Extra events dropped, dev warning |
| `track` per session | 300 | Extra events dropped, dev warning |
| `track` props | No key that looks like personal data (`PII_KEY_RE`, docs/EVENTS.md "Limits") | Event dropped, dev console error |
| Request timeout (`store`, `fetch`) | 10 s | `response` with `code: 'timeout'` |
| Store key | 1–128 chars, `^[A-Za-z0-9:_./-]+$` | `code: 'invalid_key'` |
| Store value | JSON ≤ 16 KB | `code: 'too_large'` |
| Player keys per game | 100 | `code: 'quota'` |
| Shared keys per game | 10 000 | `code: 'quota'` |
| `fetch` body | ≤ 256 KB | `code: 'too_large'` |
| `complete.stats` | ≤ 10 declared metrics, finite numbers | stats dropped, `statsRejected` (score counts) |
| Share text | ≤ 280 characters, ≤ 8 lines, plain text | `code: 'too_large'` |
| Wallet `amount`, `n` | Integer 1–1 000 000 | `code: 'invalid_payload'` |
| Wallet `key` | 1–64 chars, `^[A-Za-z0-9:_.-]+$`; required for writes | `code: 'invalid_payload'` |
| Wallet `reason` | Like a `track` name | `code: 'invalid_payload'` |
| Game-service calls (`player`, `leaderboard`) | 30 per minute per session | `code: 'rate_limited'` |
| `leaderboard` `limit` | 1–50 | `code: 'invalid_payload'` |
| `leaderboards.report` | 5 a day per device (the CMS counts) | `code: 'rate_limited'` |
| Realtime message, state patch | JSON ≤ 4 KB | `code: 'too_large'` |
| Realtime room state | JSON ≤ 16 KB after the patch | `code: 'too_large'`, nothing changes |
| Realtime frames (messages + state writes) | 20 a second per session (burst 40), 32 KB a second; 200 a second per room | Frame dropped, `error` event `rate_limited`; 10 s above the limit closes the room for the session (`close` `rate_limited`) |
| Realtime room size | manifest `realtime.maxPlayers`, 2–50 (default 8); 200 rooms per game | `code: 'room_full'` |
| Realtime waiting room | manifest `realtime.waitSeconds`, 10–600 (default 120) until a second member joins | `close` reason `expired` |
| Realtime per player | 3 rooms or waits at once, 20 new rooms per 10 minutes | `code: 'limit_reached'` |
| Realtime quick match | `timeoutSeconds` ≤ 120 (default 30) | `code: 'timeout'` |
| Realtime room calls (`join`, `create`, `playBot`) | Answer within 150 s (9 s, or after the nickname dialog, which closes itself after 2 minutes) | `code: 'realtime_disabled'` (a shell without realtime) |
| Bot level | One of `realtime.bots.levels` (`^[a-z][a-z0-9-]{0,19}$`) | `code: 'invalid_payload'` |
| Invite `params` | ≤ 10 keys `^[a-z][a-zA-Z0-9_]{0,31}$`; booleans, finite numbers or strings ≤ 64 characters; ≤ 512 bytes as JSON | `code: 'invalid_payload'` |

## 7. Error codes

`not_initialized`, `invalid_payload`, `invalid_key`, `too_large`, `quota`, `timeout`, `no_backend`, `backend_error`, `unauthorized`, `rate_limited`.

Wallet calls add `insufficient_funds`, `insufficient_items`, `conflict` (an idempotency key reused for another operation) and `economy_disabled` (ECO-4). The CMS wallet endpoints answer with the same names as their API error `code`, so the shell passes them to the game unchanged.

Realtime calls (RTM) add `realtime_disabled` (no `realtime:` block, a production tenant or a platform without realtime), `room_full`, `forbidden` (a non-host state write with `stateWrites: host`, a banned player), `cancelled` (quick match aborted or replaced by a newer one of the same player), `unavailable` (the service is down or full), `not_found` (`join(code, { create: false })` of no live room), `limit_reached` (RTM-14 per-player limits) and use `conflict` (already in a room, or `ifVersion` lost).

Multiplayer 1.21 adds `nickname_required` (a room without a nickname after the player cancelled the shell's nickname dialog, NICK-1) and uses `realtime_disabled` for rooms of a game without a `realtime:` block (RTM-18), `forbidden` for `playBot` without `realtime.bots` and `unavailable` for `playBot` without a connected referee (BOT-2).

Match calls (MAT) add `matches_disabled` (no `matches:` block or a platform without matches), `not_found`, `full`, `not_your_turn` and `limit_reached` (20 open matches, 50 new a day, 30 moves a minute), and use `forbidden` (not a member; a member move with `authority: backend`), `conflict` (the match is not active, or `ifVersion` lost) and `too_large` (the state over 16 KB).

### Error catalogue (HLP-5)

Every `GameError` has `code` (below) and an English `message` for the console; never show the message to players. What to do and what to tell the player:

| `code` | When | What the game does | Text for the player (Slovak) |
|---|---|---|---|
| `not_initialized` | A call before `await game.init()` | Fix the code: `init()` first | – |
| `invalid_payload` | Arguments the SDK or the shell refuses (wrong type, unknown level or op, a bad invite) | Fix the call; the message says what is wrong | – |
| `invalid_key` | A store key outside 1–128 characters `A–Z a–z 0–9 : _ . / -` | Fix the key | – |
| `too_large` | Store value over 16 KB, a `fetch` body over 256 KB, a message or patch over 4 KB, room or match state over 16 KB, share text over 280 characters | Send less; split the data | – |
| `quota` | More than 100 player keys or 10 000 shared keys of the game | Delete keys you no longer need, or put more in one key | „Uloženie sa nepodarilo.“ |
| `timeout` (quick match) | A quick match nobody joined within `timeoutSeconds` | Offer to try again, a bot or an invite | „Nikto sa nenašiel. Skús to o chvíľu.“ |
| `timeout` (request) | Any other request without an answer within 10 s (store, fetch, player, …) | Offer to try again | „Nepodarilo sa to. Skús to znova.“ |
| `no_backend` | `game.api.fetch()` in a game without a deployed backend | Play on without it (like Had) | – |
| `backend_error` | The game's backend failed or a nickname could not be saved | Retry once; keep the game playable | „Niečo sa pokazilo. Skús to znova.“ |
| `unauthorized` | The action needs a signed-in or an anonymous player (e.g. a signed-in player sets a nickname) | Hide the action for that player | – |
| `rate_limited` | Too many calls: 20 realtime frames a second, 30 game-service calls a minute, 5 reports a day | Slow down; drop extra frames | „Pomalšie, prosím.“ |
| `insufficient_funds` / `insufficient_items` | The player cannot pay or consume | Show the price and the balance | „Nemáš dosť mincí.“ |
| `conflict` | A wallet key reused for another write; already in a room (or another room call pending); `ifVersion` lost; a closed room or match | Read again and retry; leave the room first | – |
| `economy_disabled` | The tenant has no economy (production until enabled) | Hide the shop | – |
| `realtime_disabled` | No `realtime:` block (rooms), a production tenant, a platform without realtime | Hide multiplayer; offer single player | „Hra pre dvoch tu zatiaľ nie je dostupná.“ |
| `room_full` | The room has `maxPlayers` members | Offer a new table or a quick match | „Stôl je plný.“ |
| `forbidden` | `setState` in a referee room or by a non-host with `stateWrites: host`; `playBot` without `realtime.bots`; a match move of a non-member, or of a member with `matches.authority: backend`; a banned player | Fix the flow; for a ban show nothing extra (the shell explains) | – |
| `cancelled` | The game aborted a quick match, or the same player started another one | Nothing (it was intended) | – |
| `unavailable` | The realtime service or the game's referee is not reachable; invite links outside a game page | Offer to try again in a moment | „Herný server je nedostupný. Skús to o chvíľu.“ |
| `not_found` | A table code or a match that does not exist (any more) | Ask for the code again | „Stôl s týmto kódom neexistuje alebo už skončil.“ |
| `limit_reached` | 3 rooms or waits at once, 20 new rooms in 10 minutes; 20 open matches, 50 new matches a day, 30 moves a minute | Ask the player to close other tabs or finish matches | „Máš otvorených priveľa stolov.“ |
| `nickname_required` | A room without a nickname after the player cancelled the shell's dialog | Offer the room again; the shell asks once more | „Na hru s ostatnými potrebuješ prezývku.“ |
| `matches_disabled` | No `matches:` block or a platform without matches | Hide asynchronous play | – |
| `full` | A match has all its seats | Offer another match | „Zápas je už plný.“ |
| `not_your_turn` | A move out of turn in a match | Wait for `onChange`; disable the board | „Teraz je na ťahu súper.“ |

Nickname errors also carry `reason` (`invalid`, `denied`, `too_many`, `flood`, `signed_in`); show the shell's texts for them (Game services "Nickname").

## 8. Score handling

The shell sends `complete` to `POST /api/v1/play/<slug>/sessions/<id>/complete`. The server:

- rejects scores outside `scoring.min`/`scoring.max` from the manifest,
- rejects completions faster than `scoring.minSeconds` (default 3 s),
- checks `stats` against `metrics:` of the played version: an invalid object is dropped with `statsRejected`, the score still counts (MET-3.1); metrics of rejected plays are stored for diagnostics only and never count (MET-3.2),
- computes points (MOT-3) and updates streaks and leaderboards.

Games with a backend can report authoritative results through `POST /api/v1/results` with their game token. Then the shell's `complete` only drives the end screen. In a game with `realtime.authority: referee` only the backend's result counts, in every mode of the game: a `complete` before it stores nothing (the shell's end screen gets `refereePending: true` and says the server confirms it), one after it shows the backend's result (REF-7).

**One result per play.** A play keeps its first result: a second `complete` in the same play returns the first completion and changes nothing (start a new play, "Hrať znova", for another result). A finished match (MAT-5) records one result per member in a play of its own; a `complete` of a session that was open when the match ended returns that result once instead of counting again.

### Authoritative results from a backend (BE-6)

The backend reports the result of a play session with `submitResult` from `@azet/games-server`. It takes the session from the verified player token, so a backend can only report sessions that went through its own proxy:

```ts
import { submitResult, verifyPlayerToken } from '@azet/games-server';

const player = await verifyPlayerToken(req.headers.authorization);
const result = await submitResult({ session: player.session, score: 120, timeSeconds: 42, stats: { moves: 14 } });
// result.points, result.rejected ('out_of_range' | 'too_fast'), result.statsRejected, result.duplicate
```

Configuration: `AZG_GAME_TOKEN` (the game token; tenant and game come from it, never from the body) and `AZG_API` (CMS base URL). Without a token `submitResult` refuses to start.

Request `POST /api/v1/results`, `Authorization: Bearer <game token>`:

| Field | Type | |
|---|---|---|
| `session` | string | Play session id (`player.session`) |
| `score` | number | Finite; checked against `scoring.min`/`scoring.max` |
| `timeSeconds` | number ≥ 0 | Optional; the session's own timing when omitted |
| `success` | boolean | Optional |
| `details` | object | Optional |
| `stats` | object | Optional; metric values like `complete.stats`. Replaces the stats the shell sent for this play (MET-3.3) |
| `badges` | string[] | Optional; ids of `award: backend` badges declared in `azet-game.yaml` that this result earns, at most 20 (BDG-4); any other id refuses the whole result |
| `currency` | object | Optional; `{ <currency id>: <integer ≥ 1> }` earned by this result (ECO-3). Credited once per session, capped by `max` and `dailyEarnCap`; the response's `credited` holds what was actually credited |
| `practice` | boolean | Optional; `true` stores the play as practice: no points, boards, streaks, badges or currency (BOT-5, a game against bots). `RefereeRoom.end()` sets it for rooms with bots |

Response `200`: `{ session, score, points, rejected?, statsRejected?, duplicate?, badges?, credited? }` — `points` is `null` for guests and rejected results. The checks are the same as for `complete`. One result per session: the same result again answers `200` with `duplicate: true`, a different one `409 conflict`. Other errors use the API error format (`401 unauthorized` for a missing or invalid token, `403 forbidden` for a token that is not a game token — `results:write` limited to exactly one game — or a CMS session, `404 not_found` for a session of another game or tenant, `422 validation_failed` for an invalid body); `submitResult` throws them as `ResultError` with `status`, `code`, `message` and `details`.

### Items from a backend (GRT-1)

`wallet.grant(player, item, n, key, { reason })` from `@azet/games-server` (1.5.0) gives `n` of a declared item without a price, once per key: `POST /api/v1/wallet/grant`, `Authorization: Bearer <game token>`, body `{ session, item, n?, key, reason? }` → `200 { item, quantity, duplicate? }`. `409 quota` (`maxPerPlayer`, a non-stackable item owned already), `409 conflict` (the key used for another grant), `422 validation_failed` (an undeclared item, a bad `n` or key), `403 economy_frozen` / `economy_disabled`; token errors as for results. It throws them as `ResultError`.

### Currency from a backend (ECO-3)

A backend credits currency the player earned outside a result with `wallet.credit` from `@azet/games-server`:

```ts
import { verifyPlayerToken, wallet } from '@azet/games-server';

const player = await verifyPlayerToken(req.headers.authorization);
const r = await wallet.credit(player, 'pismenka', 30, `level-3:${player.session}`, { reason: 'level_done' });
// r.balance, r.credited (after the caps), r.capped, r.duplicate
```

Request `POST /api/v1/wallet/credit`, `Authorization: Bearer <game token>`, body `{ session, currency, amount, key, reason? }`: the player comes from the play session, tenant and game from the token. Response `200`: `{ currency, balance, credited, capped?, duplicate? }`. A cap cuts the amount instead of refusing it (`capped: true`). The same `key` again answers `duplicate: true` without crediting; the key with a different amount or session answers `409 conflict`. `422 validation_failed` for an undeclared currency or an invalid amount or key, `403 economy_disabled` when the tenant's economy is off; token errors as for results. `wallet.credit` throws them as `ResultError`.

## 9. Versioning

- `azg` and CI check `sdk` in the manifest against the SDK version in `package.json`.
- The shell reads `protocol` from `hello`. Unknown protocol → error screen "This game needs a newer platform".
- New optional fields and new message types are allowed in protocol 1. Games must ignore unknown message types.
