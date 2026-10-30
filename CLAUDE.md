<!-- azg:start -->

# Azet Games (azg)

This project uses the Azet Games CMS (https://azet-games-cms.rin.rinapps.dev). Its documentation is downloaded in `.azg/docs/`
(refresh with `azg docs pull`; one document: `azg docs <slug>`). **Read it before you change anything.**

Read first, by task:

- What the platform offers today (status, how, limits): [What you can use](.azg/docs/capabilities.md).
- Building or changing a game: [Hackathon guide](.azg/docs/hackathon.md), [SDK contract](.azg/docs/sdk-contract.md), [Manifest](.azg/docs/manifest.md); leaderboards, nickname, points, cloud save, currency and shop: [Game services](.azg/docs/game-services.md); events: [Event catalog](.azg/docs/events.md).
- Setting up a tenant (landing, looks, Puzzlr games, challenges, badges, tournaments, moderation, tokens): [Admin guide](.azg/docs/admin.md) and [API](.azg/docs/api.md).
- The `azg` commands and exit codes: [CLI](.azg/docs/cli.md).

Rules that always hold:

- A game talks to the platform only through `@azet/games-sdk` (`game.*`); it never sets scores on boards itself — results go through `game.complete()` or the backend's `submitResult`.
- No cookies, `localStorage`, `sessionStorage` or IndexedDB: the game runs on an opaque origin where they fail; keep data with `game.store`.
- No personal data in events or props; Slovak text for players, English in code and docs.
- `azg validate` and `azg contract` must pass before `azg publish`; versions are immutable.
- The API acts with the logged-in token (`azg whoami`, `azg api ops` lists what it may call, `azg api call <METHOD> <path>` calls any endpoint of the API doc); in production tenants agent writes become proposals.

All documents:

- [How it works](.azg/docs/overview.md) – The flow of a game and the parts of the platform.
- [Admin guide](.azg/docs/admin.md) – Set up a tenant step by step: members, tokens for agents, looks, landing, Puzzlr games, challenges, badges, tournaments, moderation.
- [Hackathon guide](.azg/docs/hackathon.md) – From zero to a live game, with and without programming.
- [What you can use](.azg/docs/capabilities.md) – Every platform feature for a game: status today, how to use it, limits, and what is not available.
- [SDK contract](.azg/docs/sdk-contract.md) – The game ↔ shell protocol, limits and error codes.
- [Game services](.azg/docs/game-services.md) – Player, nickname, points, leaderboards, cloud save, currency and shop from a game and its backend.
- [Manifest](.azg/docs/manifest.md) – azet-game.yaml: settings, scoring, assets.
- [CLI](.azg/docs/cli.md) – Every azg command and exit code.
- [Event catalog](.azg/docs/events.md) – Every event the platform records, its fields and limits.
- [API](.azg/docs/api.md) – REST endpoints, scopes, upload and downloads.
- [Architecture](.azg/docs/architecture.md) – Components, data model and security.
- [Deploy](.azg/docs/deploy.md) – Hosts, Helm chart, Vault and CI.
- [Engineering](.azg/docs/engineering.md) – Code standards and quality gates.
- [PRD](.azg/docs/prd.md) – Requirements and acceptance criteria.
- [Decisions](.azg/docs/decisions.md) – Why things are the way they are.
- [Build plan](.azg/docs/build-plan.md) – Phases, status and human prerequisites.

<!-- azg:end -->
