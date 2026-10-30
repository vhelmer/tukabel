# Build plan

v1 is built locally between 11 and 23 October, moved to `rin-apps` and a Multica workspace between 24 and 26 October, and rehearsed on 27–28 October before the hackathon (~30 October).

The order is chosen so that the riskiest part, the SDK contract, works end-to-end first and has the longest time to settle before the freeze.

## Progress

| Phase | Planned | Done | Notes |
|---|---|---|---|
| L0 Foundation | 11 Oct | 11 Oct | Postgres 5433, owner/app/definer roles, RLS with FORCE |
| L1 Contract | 12 Oct | 11 Oct | SDK 3.1 KB gz, framework-free shell, dev shell |
| L2 Play path / M1 | 13–14 Oct | 11 Oct | Bundles on disk + separate origin; play token; plays table |
| L3 CMS core | 14–16 Oct | 11 Oct | NextAuth dev/Okta, game editor with live preview |
| L4 Tenant features / M2 | 17–18 Oct | 11 Oct | Proposals, config as code, promotion, leaderboard |
| L5 CLI | 19–20 Oct | 11 Oct | Device login, all commands, exit codes |
| L6 CI + templates / M3 | 20–21 Oct | 11 Oct | 4 templates pass the contract test; MR previews |
| L7 Game backends | 22 Oct | 11 Oct | ES256 player tokens, proxy with SSRF guard, Snake |
| L8 Hardening | 23 Oct | 11 Oct | e2e suite, AC coverage 99 %, security review, HACKATHON.md |

Built ahead of plan, so the time until 23 Oct goes to the human prerequisites, the move, and a dry run with a real team.

## Phases

| Phase | Dates | Scope | Requirements | Exit check |
|---|---|---|---|---|
| **L0 Foundation** | 11 Oct | Monorepo, tooling, Docker Compose, Drizzle schema, RLS, seed (3 tenants, users, theme) | TEN-1, TEN-6 | `npm run lint typecheck test` green; RLS tests pass |
| **L1 Contract** | 12 Oct | `packages/manifest`, `packages/sdk`, shell protocol, dev shell | MAN-1–4, SDK-1–2, SDK-4, SHL-3–4 | Sample game passes the handshake in the dev shell |
| **L2 Play path** | 13 Oct | Versions API, bundle upload (local disk), `/play/<slug>` shell, play sessions, events, store, streaks, points, percentile | VER-1, SHL-1–2, SDK-3, BE-1, MOT-1–5, DAT-1 | A published game is playable, completion updates streak and points |
| **M1 Walking skeleton** | 14 Oct | Daily Quiz reference game on the SDK | | Register → publish (script) → play → complete, events in Postgres |
| **L3 CMS core** | 14–16 Oct | Auth, Games list, Game detail, settings form from schema, screens, motivation, access, live preview | GAM-1–10, REG-1, REG-3, SHL-2.1 | Product user configures a game and sees it change in the preview |
| **L4 Tenant features** | 17–18 Oct | Appearance, landing editor + public landing, tokens, members, audit log, promotion, proposals | THM-1–3, LND-1–4, TEN-2–5, CLI-3, CLI-6 | Cross-tenant tests pass for every endpoint |
| **M2 CMS core** | 18 Oct | | | All Must CMS screens work |
| **L5 CLI** | 19–20 Oct | `azg` complete, device flow, config as code | CLI-1–7 | `config pull → push` round-trips; agent token creates proposals in `azet` |
| **L6 CI and templates** | 20–21 Oct | `ci/game.yml`, contract runner, budget, 4 templates, GitLab repo creation, local mode | CI-1–4, REG-2, REG-4–6 | Template repo on GitLab: push → version in CMS; MR → preview |
| **M3 CLI + CI** | 21 Oct | | | A new game goes from `azg games create` to live by `git push` |
| **L7 Game backends** | 22 Oct | Backend proxy, player tokens, JWKS, `@azet/games-server`, `azg backend add`, `azg dev --backend` | BE-2–6 | Word Snake leaderboard backend works through the proxy |
| **L8 Freeze and hardening** | 23 Oct | Word Snake reference game, security review, docs, AC coverage, performance pass | all Must | **SDK frozen**; `ac:coverage` shows no missing Must criteria |
| **M4 SDK freeze** | 23 Oct | | | |
| **Move** | 24–26 Oct | See below | | |
| **M5 Live on rin-apps** | 26 Oct | | | Hackathon tenant reachable on its host; agents working the backlog |
| **Dry run** | 27–28 Oct | A test team (not us) starts from zero | | ≤ 15 min to a live game; fixes merged |
| **Hackathon** | ~30 Oct | | | |

Shoulds (SHL-6, CI-3, GAM-9, LND-3, BE-5, BE-6, and the v1.3.0 Shoulds) are dropped first if a phase slips. The Must list is not negotiable for the freeze.

## Players & stats (v1.3.0)

PRD 1.3.0 §5.15–5.20, approved 12 Oct (D-41). Built on `development` in the Multica workspace next to the hackathon work; the contract part goes first because of the 23 Oct freeze.

| Phase | Dates | Scope | Requirements | Track | Exit check |
|---|---|---|---|---|---|
| **P1 Contract additions** | 13–21 Oct | SDK and manifest: `metrics:`, `complete.stats`, `badges:`, `game.award`, `game.share`; `SDK-CONTRACT.md`, `MANIFEST.md`, templates, `AI-PROMPT.md`, dev shell checks. CMS: validate and store `stats`, BE-6 `stats`/`badges`, award and share endpoints | MET-1–3, BDG-1–2, SHR-1 | Dev Platform + Dev CMS | Deployed and verified by **21 Oct** (one day of slack before the 22 Oct deadline); `ac-deferred.json` entries removed |
| **P2 Statistics and leaderboards** | 20–29 Oct | `stats_daily` rollup, Statistics page, game detail charts; leaderboard records, editor UI, public board page | STA-1–4, MET-4, LBD-1–4 | Dev CMS | Jury can read live numbers per game; MOT-4 board unchanged as the default record |
| **P3 Badges** | 2–6 Nov | Rule engine, backend awards, tenant badges in the CMS, end-screen "new badge" | BDG-3–6 | Dev CMS (shell part Dev Platform) | A rule badge is awarded once from a validated play; cosmetic awards marked |
| **P4 Sharing, leagues, profile** | 4–13 Nov | Result card + OG image, challenge link, private leagues, player and tenant privacy settings, profile, GDPR delete of new data | SHR-2–3, LEA-1–3, PRF-1–6 | Dev CMS + Dev Platform (shell) | Opt-in respected on every public board; DAT-4 delete covers the new tables |

P2 is useful for the hackathon (jury numbers) but is a Should: it yields to the move, the dry run and hackathon support. P3 and P4 start after the hackathon. Anything P1 slips past 21 Oct is reported the same day; the contract parts may only be added after the freeze as additive changes with a DECISIONS entry.

## Move to rin-apps and Multica (24–26 Oct)

Follows the RAMP bootstrap pattern (per-repo project in `rin-apps`, ArgoCD auto-discovery, Multica workspace with agents).

1. **Repo:** push to `rin-apps/rin-azet-games-cms` (GitLab; `rin-` prefix needed for ArgoCD discovery), protected `main`, merge commits, pipelines must succeed.
2. **Chart:** Helm chart from the rin-apps template; ingress hosts for the CMS, the hackathon tenant and the games origin; DB bootstrap job (database; roles `azg_owner`, `azg_app` without `BYPASSRLS`, `azg_definer NOLOGIN BYPASSRLS` granted to `azg_owner` – see `apps/cms/db/init/00-roles.sql`; migrations as a pre-sync hook).
3. **Secrets:** Vault `rin-apps/azet-games-cms` (DB, NextAuth, Okta, JWT signing key, GitLab token, storage keys).
4. **Storage:** done differently (11 Oct, D-30): game bundles and assets are stored in Postgres (`bundle_files`), so no object storage is needed for v1; object storage stays an open question for later (Q-07).
5. **Game backends:** namespace and quota for `azet-hackathon` backends; CI job that builds the image and writes the GitOps values.
6. **GitLab group for game repos** and a token that may create projects in it.
6a. **Publish packages** – done differently (11 Oct, D-34): the CMS packs `@azet/games-sdk`, `-server` and the bundled `-cli` as built JavaScript and serves them under `/downloads`; scaffolded games depend on those tarballs. A registry (H-7) is optional now.
7. **Multica workspace** `azet-games` with agents: Board Manager, Scheduler, Dev (CMS), Dev (SDK/CLI), Tester, Critic, Release Manager. Backlog = remaining Shoulds, hackathon support, phase 3 of PRD 1.0.0.
8. **rin-agents** canon: workspace config and skills (this repo's docs as context).

## Human prerequisites (request now)

| # | What | Who | Needed by |
|---|---|---|---|
| H-1 | GitLab group for game repos + project-create token | GitLab admins | 20 Oct (L6 tests), 24 Oct |
| H-2 | Hosts and TLS: CMS, `hry-hackathon.azet.sk`, games origin | Sysadmins (F5) | 24 Oct |
| H-3 | Okta application for the CMS | IT | 24 Oct (dev provider until then) |
| H-4 | Object storage reachable from the rin-apps cluster – not needed for v1, bundles live in Postgres (D-30) | Sysadmins | later (Q-07) |
| H-5 | Azet login for production: the real Azet OAuth client (redirect URIs `https://<tenant host>/auth/callback`) and the DTM HMAC key (`AZET_ID_HMAC_KEY`) in Vault. Dev runs on rin-oauth (D-56) | Azet backend team + Lukáš | before the `azet` go-live |
| H-6 | DTM export format for game events | Data team | after the hackathon is fine |
| H-7 | npm token for the `@azet` / `@koktejl` registry (to use `@koktejl/ui`; not needed for our packages, D-34) | Azet frontend | nice to have |
| H-8 | Hackathon date, number of teams, participants outside Ringier? | Organizers | 18 Oct |
