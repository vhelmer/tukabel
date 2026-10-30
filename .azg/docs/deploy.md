# Deployment (rin-apps)

The CMS runs on the rin-apps Kubernetes cluster like every other rin-apps project: GitLab `rin-apps/rin-azet-games-cms` → CI builds the image into Harbor → the `deploy:values` job commits the new `image.tag` → ArgoCD syncs the Helm chart at the repo root.

## Hosts

| Host | What | Notes |
|---|---|---|
| `azet-games-cms.rin.rinapps.dev` | CMS admin, management API, CLI login | Session cookies live only here |
| `azet-games-hackathon.rin.rinapps.dev` | Public pages of `azet-hackathon` (`/`, `/play/<slug>`, `/leaderboard`, `/embed/<slug>`, `/embed.js`) + play API | No admin, no management API |
| `azet-games.rin.rinapps.dev`, `azet-games-koktejl.rin.rinapps.dev` | Public pages of `azet` / `koktejl` | Same rules |
| `azet-games-files.rin.rinapps.dev` | Games origin: bundle files only | CORS `*`, sandbox CSP, `frame-ancestors` = admin + public hosts + the bundle tenant's embed origins |
| `azet-games-realtime.rin.rinapps.dev` | Realtime service (RTM-9): WebSocket `/v1`, `/health`, `/ready`, `/metrics` | Only the shell connects (D-77), with a ticket; no cookies, no pages |

Routing is done by `apps/cms/proxy.ts` from `ADMIN_HOST`, `FILES_HOST` and `TENANT_HOSTS` (set by the chart from `values.yaml` → `hosts`). The hosts are on the internal `rinapps.dev` domain (VPN). Real Azet domains come later (Q-10).

**Embed origins (SHL-6).** `values.yaml` → `embedOrigins` lists, per tenant, the article sites that may frame that tenant's game embed; the chart passes them as `EMBED_ORIGINS` (`azet=https://azet.sk https://*.azet.sk,koktejl=…`). The tenant's own public host is always allowed; a tenant without an entry can be embedded only on its own site. Only `https://host` and `https://*.domain` are accepted (plus `http://localhost` / `127.0.0.1` for local tests); anything else is dropped, so a typo cannot widen or break the policy. Other public pages keep `frame-ancestors 'self' https://*.azet.sk https://*.koktejl.sk`; the admin and API are never framed.

**The same player in an article (D-93).** The player cookies (`azg_anon`, `azg_player`) are `SameSite=Lax`, so a browser sends them into an embed only when the article and the tenant host are the same site. The hosts are on `*.rin.rinapps.dev` today: in an article on `azet.sk` every embedded play is a new anonymous player, and what they earn there does not reach their games on the tenant host. For coins from articles (a hub like Brloh) the production tenant host must be under `azet.sk` (for example `hry.azet.sk`, DNS and the Ingress by the sysadmins); a test article for the hackathon must be under `rinapps.dev`.

## Chart

| Resource | Sync wave | Purpose |
|---|---|---|
| ExternalSecret `azet-games-cms` | −3 | App secrets from Vault |
| ExternalSecret `azet-games-cms-postgres` (hook) | −3 | Postgres superuser password for the bootstrap |
| Job `db-bootstrap` (hook) | −2 | Database `azet_games`, roles `azg_owner`, `azg_app` (no BYPASSRLS), `azg_definer` (NOLOGIN BYPASSRLS) on `rin-postgres` |
| Job `migrate` (hook) | −1 | Drizzle migrations + `db/rls.sql` as the owner, then the idempotent seed (tenants, themes, landing pages, `SEED_ADMINS`) |
| Deployment | 1 | Next.js standalone, read-only root filesystem, `/tmp` and `.next/cache` as emptyDir |
| CronJob `stats-rollup` | 2 | Nightly statistics rollup (STA-4, D-42) at `statsRollup.schedule` (default `15 0 * * *`, `timeZone: Europe/Bratislava`, `concurrencyPolicy: Forbid`) as `azg_app`; recomputes the last 31 days of every tenant (D30 cohorts, the funnel and the event counts, EVT-4), idempotent. Off with `statsRollup.enabled: false` |
| CronJob `streak-reminders` | 2 | Streak reminder e-mails (RET-3) at `streakReminders.schedule` (default `0 18 * * *`, `timeZone: Europe/Bratislava`, `concurrencyPolicy: Forbid`) as `azg_app`, with the play-token secret for the signed links. `streakReminders.mode` = `dry-run` (default: records and logs who would get a reminder, sends nothing) or `off`; there is no live mode until the Phillip communicator integration is approved. Off with `streakReminders.enabled: false` |
| CronJob `matches-sweep` | 2 | Match timeouts (MAT-3.1, D-82) at `matchesSweep.schedule` (default `*/5 * * * *`, `concurrencyPolicy: Forbid`) as `azg_app`: expires invites nobody joined and forfeits missed turns in every tenant and records the results. Reads of the game's matches apply the same timeouts, so a missed run only delays results. Off with `matchesSweep.enabled: false` |
| ExternalSecret `azet-games-cms-smoke` | 2 | Test credentials of the cluster smoke from Vault (below); `ignore-healthcheck`, so a missing key changes nothing else |
| Job `smoke-<image tag>` | 2 | The [cluster smoke](#cluster-smoke) of the deployed commit, once per image tag; image `azet-games-cms-smoke:<tag>` (`Dockerfile.smoke`). Off with `clusterSmoke.enabled: false` |
| Service + 5 Ingresses (F5) | – | One Ingress per host |
| Deployment, Service, Ingress `realtime` | 2 | The [realtime service](#realtime-service) on `realtime.host`: the app image with `node apps/realtime/dist/server.mjs`, one replica, `Recreate`. In the last wave, after the CMS Deployment, so it never holds the CMS rollout; off with `realtime.enabled: false` |
| `ws-echo` ConfigMap, Deployment, Service, Ingress | – | WebSocket echo on `wsEcho.host` (`azet-games-ws-echo.rin.rinapps.dev`), the F5 diagnostic of Q-13 ([below](#websockets-through-f5)) |

The CronJobs get the same env (`azg.cronEnv` in `templates/_helpers.tpl`): the `azg_app` URL plus the runtime secrets `server/env.ts` requires in production (`PLAY_TOKEN_SECRET`, `NEXTAUTH_SECRET`, `PLAYER_TOKEN_PRIVATE_KEY`), because a bundled script loads `env.ts` as soon as any import reaches it (`apps/cms/scripts/cron-env.test.ts` checks this). They sit in wave 2, after the Deployment: a CronJob stays Degraded until its next run succeeds, and ArgoCD stops a sync at a Degraded wave, so a failed nightly run delays only the CronJob update, not the rollout. `restartPolicy: Never` keeps the failed pods and their logs with the failed Job (`failedJobsHistoryLimit: 3`).

Game bundles are stored in Postgres (`bundle_files`, D-30), so the Deployment is stateless and needs no volume.

## WebSockets through F5

Q-13 / RTM-9.3 (AZG-322): before the realtime service (RTM-9) was built on it, a WebSocket echo was measured behind the real F5 ingress (BIG-IP via CIS, the same virtual server as every other host) on the realtime host. `templates/ws-echo.yaml` runs `files/ws-echo.js` (no dependencies, mounted from a ConfigMap) with the app image. It answers `GET /health`, returns every text frame and never pings, so an idle close always comes from the path (F5, CIS, kube-proxy). The echo now stays on its own host, `azet-games-ws-echo.rin.rinapps.dev` (`values.yaml` → `wsEcho`), as the F5 WebSocket diagnostic. ArgoCD does not prune (`prune: false`), so `wsEcho.enabled: false` alone would leave its resources behind; delete them by hand when switching it off.

Measure from a VPN machine or a pod:

```bash
node scripts/ws-echo-probe.mjs wss://azet-games-ws-echo.rin.rinapps.dev/v1 --idle-max 2400
node scripts/ws-echo-probe.mjs wss://azet-games-ws-echo.rin.rinapps.dev/v1 --idle-max 2400 --keepalive 20
```

Measured on 19 Oct 2026 against `azet-games-realtime.rin.rinapps.dev` (the echo's first host), through the real F5 (VIP `10.96.64.110`): from a pod in the cluster (AZG-322) and from a VPN client (Lukáš):

| Measurement | Pod in the cluster | VPN client |
|---|---|---|
| Upgrade (`101 Switching Protocols`) through F5 | **works**; F5 adds its pool persistence cookie `BIGipServer…` to the 101 response (harmless, the service has one replica) | **works** |
| `GET /health` | 200 | 200 |
| Upgrade time (DNS + TCP + TLS + 101) | 318–594 ms (8 runs) | 384 ms |
| Echo round trip | p50 2.4–3.1 ms, p95 3.0–8.7 ms (20–50 frames) | ~100 ms |
| Idle connection, no frame in either direction | **still open after 40 min** (2 400 s, the probe's limit) | **still open after 15 min** (900 s, the test's limit) |
| With a frame every 20 s (the shell heartbeat, RTM-7.3) | still open after 40 min | – |
| Other closes seen | `1006` when the echo pod was replaced by a deploy (912 s into a run); expected, see "Restarts drop every room" | – |

The F5 idle timeout for a WebSocket is therefore at least 40 minutes (no close was seen). The 20 s heartbeat and the service's own 60 s timeout have a wide margin. The ~100 ms round trip from the VPN client is the VPN path; from inside the cluster the round trip is a few milliseconds.

So F5 neither blocks the upgrade nor closes idle WebSockets within 40 minutes. The limits that apply are the service's own (60 s without a frame, 30 min idle room; RTM-7.3). No class-C escalation was needed.

## Realtime service

RTM-9, D-78, [ARCHITECTURE.md §11](architecture.md#11-realtime-service). `apps/realtime` is a `ws` server around the room engine of `packages/realtime`. The Docker build bundles it into `apps/realtime/dist/server.mjs` (esbuild, no `node_modules` needed), and `templates/realtime.yaml` runs it from the **same image** as the CMS. One `image.tag` therefore deploys both, and `/health` reports the same `sha` as the CMS `/api/health` (RTM-9.1). The `docker:build` job starts it from the built image and checks that sha.

| Setting | Value |
|---|---|
| Host | `realtime.host` = `azet-games-realtime.rin.rinapps.dev` (F5 Ingress, health monitor `GET /health`) |
| Port | 3010 (`REALTIME_PORT`; the image sets `PORT=3000` for the CMS), Service port 80 |
| `REALTIME_JWKS_URL` | `https://<hosts.admin>/api/v1/.well-known/jwks.json`: the CMS public keys, reached through F5 (an in-cluster call would hit `proxy.ts` with an unknown host) |
| `JWKS_CACHE_MAX_AGE_MS` | `realtime.jwksCacheMaxAgeMs` = 300 000. A ticket with an unknown `kid` refetches the set (at most every 10 s), so a new CMS key works at once; a removed key is refused at most 5 min after the CMS stops publishing it (RTM-3.5) |
| CMS side | `REALTIME_URL` = `wss://<realtime.host>/v1`, set on the CMS Deployment only while `realtime.enabled`; without it the ticket endpoint answers `realtime_disabled` |
| Secrets | none: tickets are checked against the public JWKS, `jti`s are kept in memory until they expire |
| Replicas | 1, `strategy: Recreate`, rooms in memory (D-78) |
| Resources | requests 50m / 96Mi, limits 1 CPU / 512Mi (`realtime.resources`) |

**Endpoints.** `GET /health` (liveness) → `{ status, sha, rooms, connections }`. `GET /ready` (readiness) is `200` once the CMS JWKS is loaded and `503` before that and during shutdown; the service retries the JWKS with backoff, so it becomes ready by itself once the CMS answers. `GET /metrics` serves Prometheus text for Grafana (RTM-9.4):

| Metric | Type |
|---|---|
| `azg_realtime_ready`, `azg_realtime_connections`, `azg_realtime_rooms`, `azg_realtime_members`, `azg_realtime_quick_queued` | gauge |
| `azg_realtime_frames_in_total`, `azg_realtime_frames_out_total` | counter |
| `azg_realtime_dropped_frames_total{reason}` (`rate_limited`, `too_large`, `invalid_payload`, `unknown_target`, `not_in_room`, `internal`) | counter |
| `azg_realtime_tickets_accepted_total`, `azg_realtime_tickets_refused_total{reason}` (`malformed`, `signature`, `audience`, `expired`, `reused`, `claims`, `jwks_unavailable`) | counter |
| `azg_realtime_upgrades_total`, `azg_realtime_upgrades_rejected_total{reason}` (`path`, `shutdown`, `per_ip`), `azg_realtime_upgrades_without_client_ip_total`, `azg_realtime_closes_total{code}`, `azg_realtime_slow_consumers_total` | counter |
| `azg_realtime_process_resident_memory_bytes`, `azg_realtime_process_heap_used_bytes` | gauge |

The WebSocket is `wss://<host>/v1`; any other upgrade path is `404`. **Logs** are JSON lines (`time`, `level`, `event` + allow-listed fields: tenant and game slugs, mode, reason, counts, close codes). A nickname, player key, session id, ticket or message content never reaches a log line (RTM-9.4). Frames above 64 KB are closed by `ws` (`1009`), frames between 8 KB and 64 KB are answered `too_large` by the engine, and a client whose unread frames pass 1 MB is cut off (`slow_consumers`).

**Capacity since v1.21.0 (RTM-18, D-86).** Every open game of a sandbox tenant now holds one socket (presence, instant rooms), not only players in a room, so the service allows **20 000 connections** and **500 per client IP**. An idle socket costs a few KB in the one Node process (the 2 000-connection load sanity used 131 MB with traffic); watch `azg_realtime_connections` and the process memory in Grafana during the hackathon. **Per-IP caps (AZG-339).** The 20 000 connections of the service (RTM-7.2) also count sockets that have not authenticated yet, so one client could fill them. The upgrade is therefore refused with `429` (`Retry-After: 5`, counted as `azg_realtime_upgrades_rejected_total{reason="per_ip"}`, the shell shows `unavailable`) when the client IP already has **10 sockets still authenticating** (`RT_LIMITS.authPendingPerIp`) or **500 sockets open** (`RT_LIMITS.connectionsPerIp`). The client IP is the last `X-Forwarded-For` hop, the one the F5 appends (`TRUST_PROXY=1` on the realtime Deployment), as in the CMS (ARCHITECTURE §9 "Rate-limit bypass"); earlier hops are ignored. An upgrade without `X-Forwarded-For` behind the F5 is not capped and counted in `azg_realtime_upgrades_without_client_ip_total`: after a deploy that counter must stay `0` while players connect, otherwise the F5 does not forward the client IP on WebSocket upgrades and the caps do nothing. Players behind one NAT share a cap: if `per_ip` rejections show up for real players (a school or office on one public IP), raise the caps in `RT_LIMITS`. `REALTIME_MAX_CONNECTIONS_PER_IP` and `REALTIME_MAX_AUTH_PENDING_PER_IP` override them (`0` = off; the local load test turns them off).

**Restarts drop every room (RTM-7.5).** Every deploy changes the image tag and restarts the pod. On SIGTERM every client gets `{ t: 'close', reason: 'restart' }` and close code `1001`, and the shells end their games cleanly. A crash closes without that frame (`disconnected`). **Do not merge to `development` during hackathon play hours.** Scaling out needs a shared pub/sub and room affinity and is out of v1.

**Cluster smoke.** The smoke Job and the realtime Deployment share wave 2, so the smoke can start before the new realtime pod is up. A realtime check in it must first wait until `https://<realtime.host>/health` reports the Job's own `sha`.

**Load sanity (RTM-7.6, RTM-7.7).** `npm run load -w apps/realtime` starts the service as a child process with a throwaway key and its own JWKS. It runs two phases: 50 clients in one room, each sending 4 messages a second for 60 s; then 2 000 connections in rooms of 4, each sending 1 message a second for 60 s. It prints the relay time from sender to every other member (measured in the load process) and what was delivered, and exits 1 on a lost message or a p95 ≥ 100 ms. Against the cluster it takes real tickets from a tenant host (`--cms https://azet-games-hackathon.rin.rinapps.dev --tenant azet-hackathon --game <slug with realtime:> --room-size <≤ maxPlayers> --connections <n>`). Session starts are limited to 120 a minute per IP, so a cluster run with many connections takes minutes to set up, and one client IP holds at most 200 sockets (per-IP caps above), so `--connections` above 200 needs several client machines. **Do not run the cluster load test during hackathon play hours:** its connections count against the 2 000 of the service.

Last run (AZG-322, 19 Oct 2026, local child process on the dev pod, Node 22, 16 cores; client and service on the same machine):

| Phase | Clients / rooms | Messages sent → deliveries expected / delivered | Dropped | Relay p50 / p95 / p99 / max | Service RSS |
|---|---|---|---|---|---|
| One room | 50 / 1 | 11 963 → 586 187 / 586 187 | 0 | 7.4 / 21.6 / 34.5 / 82.9 ms | 99 MB |
| Spread | 2 000 / 500 | 119 857 → 359 571 / 359 571 | 0 | 3.7 / 22.6 / 53.3 / 132.2 ms | 131 MB |

**Locally** run `npm run dev -w apps/realtime` (port 3010, JWKS of the local CMS on port 3000) and start the CMS with `REALTIME_URL=ws://localhost:3010/v1`.

## Referees of our games

Our own reference games with `realtime.authority: referee` (REF, D-81) run their referee in this chart (`templates/referees.yaml`, values `referees`): the Docker build bundles each backend into `referees/<slug>.mjs` and a Deployment per game (1 replica, Recreate, last wave, `ignore-healthcheck`) runs it from the CMS image. The CMS gives referee tickets the in-cluster realtime URL (`REALTIME_REFEREE_URL` = `ws://<release>-realtime/v1`), so referees never go through the F5; results go to the CMS Service with the game's token.

| Game | Vault key `kubernetes/com-k8s-development/rin-apps/azet-games-referees` |
|---|---|
| `piskvorky` (azet-hackathon) | `PISKVORKY_GAME_TOKEN`: a game token, `kind: agent`, scope `results:write`, limited to the game |

In-cluster callers reach the CMS on its Service names (`INTERNAL_HOSTS`, set by the chart): there `proxy.ts` serves only the backend APIs (`/api/v1/results`, `/realtime/referee`, `/wallet/credit`, `/game/player|leaderboards|matches`, the JWKS) and 404s everything else. Game backends of AZG-321 use the same names (`backends-chart` `cms.apiUrl`).

To add one: bundle it in the Dockerfile, add `{ slug, tokenKey }` to `referees.games`, mint the token (Admin → Tokens, or `POST /api/v1/tokens`) and put it in Vault. Without the key only that pod waits (`CreateContainerConfigError`) and the game's rooms answer `unavailable`. **Teams' backends never run here:** they get their own namespace through `packages/backends-chart` (AZG-321).

## Downloads (CLI and SDK)

The Docker build runs `scripts/pack-packages.mjs --api $AZG_DEFAULT_API` and copies the tarballs to `/app/downloads` (`DOWNLOADS_DIR`), which the CMS serves under `/downloads` on the admin host (D-34). CI passes `AZG_DEFAULT_API=$CMS_URL` (`.gitlab-ci.yml` variables), so the CLI downloaded from the cluster talks to the cluster by default; the `docker:build` smoke test checks that `/downloads/index.json` carries that URL.

Releasing a new CLI or SDK = bump `version` in `packages/<pkg>/package.json` and merge. Old versioned tarballs disappear with the old image, but games keep building as long as the current image serves their pinned version – so bump the SDK only for real changes, and keep protocol 1 additive (SDK-CONTRACT).

## Vault

Secret `kubernetes/com-k8s-development/rin-apps/azet-games-cms` (KV v2; mount = the whole path prefix, see the rin-desk notes):

| Key | Content |
|---|---|
| `AZG_OWNER_PASSWORD`, `AZG_APP_PASSWORD` | Hex passwords for the DB roles (URL-safe) |
| `NEXTAUTH_SECRET`, `PLAY_TOKEN_SECRET` | 64 hex chars each |
| `PLAYER_TOKEN_PRIVATE_KEY` | ES256 private key, PKCS8 PEM |
| `LOGIN_PASSCODE` | Interim sign-in until Okta (D-32); share only with people who need CMS access |
| `GITLAB_URL`, `GITLAB_TOKEN`, `GITLAB_GAMES_GROUP_ID` | Optional: repo creation for registered games (H-1) |
| `BACKENDS_GITOPS_TOKEN` | Project access token of `rin-apps/rin-azet-games-backends` (role Maintainer, scope `api`, may push to `development`) for [game backend deploys](#game-backends). Without it `POST /games/{slug}/backend/deploy` answers `502` |
| `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`, `OKTA_ISSUER` | Later (H-3); then remove `LOGIN_PASSCODE` |
| `AZET_OAUTH_BASE_URL`, `AZET_OAUTH_CLIENT_ID`, `AZET_OAUTH_CLIENT_SECRET`, `AZET_OAUTH_PUBLIC_KEY` | Azet ID login for players (AUTH, D-56). Dev: rin-oauth (`https://rin-oauth.rin.rinapps.dev`, client `azet-games`, redirect URIs `https://<tenant host>/auth/callback`), the public key is the RS256 PEM of its access tokens. All four set = login on; any missing = players stay anonymous. **Production** needs the real Azet OAuth client and its redirect URIs (H-5, a human step) |
| `AZET_ID_HMAC_KEY` | Optional on dev, required for production: the HMAC key of the player key, the same key as DTM `userstats.iduser` (H-5). Without it a key derived from `PLAY_TOKEN_SECRET` is used, so dev player keys change once it is set |

Secret `kubernetes/com-k8s-development/rin-apps/azet-games-cms-smoke` (only for the [cluster smoke](#cluster-smoke); `clusterSmoke.vaultKey`). The app never sees it:

| Key | Content |
|---|---|
| `SMOKE_LOGIN_EMAIL` | An existing CMS user with the admin role in `azet-hackathon` |
| `SMOKE_AZET_USER`, `SMOKE_AZET_PASSWORD` | The rin-oauth test user `test01` (reserved for the smoke; Vault `rin-oauth`, `OAUTH_SEED_USERS`) |

The smoke takes the CMS passcode from `LOGIN_PASSCODE` above.

## CI

`.gitlab-ci.yml` follows the rin-first-project template:

| Job | When | What |
|---|---|---|
| `test` | MR, development | lint, typecheck, Vitest with a Postgres service, AC coverage |
| `helm:lint` | MR, development | `helm lint` + `helm template` of this chart and of `packages/backends-chart` (game backends) |
| `security:deps` | development | `npm audit` (informational) |
| `docker:build` | MR, development | image `sha-<sha>` (MR: `mr-<sha>`), `latest` on development, OCI labels (revision, source, created, ref, pipeline URL, `sk.rintools.task` from `Refs AZG-n`), production smoke test |
| `security:image-scan` | development | trivy HIGH/CRITICAL + SBOM (informational) |
| `docker:build-smoke` | MR, development | image `azet-games-cms-smoke` with the same tag as the app image (`Dockerfile.smoke`: the Playwright image of `e2e` + the monorepo dependencies + the spec); checks that the spec loads |
| `deploy:values` | development | `scripts/bump_values.py` writes `image.tag` and the pod annotations `rin-apps/deployed-at`, `-commit`, `-mr`; commit `[skip ci]` pushed with the deploy key (`GITOPS_DEPLOY_*` variables); `resource_group` per branch |
| `smoke:cluster` | manual only | the [cluster smoke](#cluster-smoke) spec from a GitLab runner; the runners cannot reach the cluster hosts (AZG-312), so play it only from a runner that can. After a deploy the smoke runs inside the cluster instead; informational (`allow_failure`), report in `apps/cms/cluster-report/` |
| `check:deploy-drift` | schedule (every 15 min) | fails when HEAD of development is not a deploy commit and is older than 30 min (a merge that never reached the cluster; younger merges are still deploying) |

The image bakes in `BUILD_SHA`, `BUILD_VERSION` (image tag) and `BUILD_TIME`; `/api/health` returns them as `sha`, `version`, `builtAt`. CI runs the Playwright e2e suite (`e2e` job) against a production build (`next build` + `next start`) with a migrated and seeded Postgres; on failure the HTML report and traces are job artifacts (`apps/cms/playwright-report/`, `apps/cms/test-results/`). The job sets `AZG_E2E_DEV_PLAYER=1` so the fake player works in that build; the CMS ignores it whenever a host layout (`ADMIN_HOST`, `FILES_HOST`, `TENANT_HOSTS`) or a non-loopback `CMS_ORIGIN` is set, and it is never set in the chart.

## Cluster smoke

The cluster smoke checks the deployed CMS, not a local one: the spec `apps/cms/e2e-cluster/cluster-smoke.spec.ts` (AZG-308). The GitLab runners cannot reach the `*.rin.rinapps.dev` hosts (connect timeout, AZG-312), so after every deploy it runs **inside the cluster**: the chart creates the Job `rin-azet-games-cms-azet-games-cms-smoke-<image tag>` (`templates/cluster-smoke.yaml`) from the image `azet-games-cms-smoke:<image tag>`, which `docker:build-smoke` builds from the same commit (`Dockerfile.smoke`: the Playwright image of the `e2e` job, where npm may fetch the CLI tarball from `/downloads` and Chromium can hold the test player's Azet ID session). Nothing runs from a laptop.

**It never blocks or fails the ArgoCD sync** (unlike the stats-rollup CronJob in AZG-297):

- It is not a hook: ArgoCD keeps a sync operation open while a hook runs. The Job is a plain resource in wave 2, the last wave, so it starts after the new Deployment is healthy, and the operation ends as soon as the wave is applied.
- `argocd.argoproj.io/ignore-healthcheck: "true"` keeps a running or failed smoke out of the Application's health; `compare-options: IgnoreExtraneous` keeps the Jobs of earlier tags out of its sync status (auto-prune is off; Kubernetes deletes a finished Job after `clusterSmoke.ttlSecondsAfterFinished`, 3 days).
- One Job per image tag: Jobs are immutable, so a sync of an unchanged tag leaves the finished Job alone. A manual sync after the TTL removed it runs the smoke again. `backoffLimit: 0`, `restartPolicy: Never`, `activeDeadlineSeconds` 6000 (above the spec budgets below).

The Job uses the public hosts (`CLUSTER_CMS_URL` = `https://<hosts.admin>`, `CLUSTER_HACKATHON_URL` = the `azet-hackathon` host), not the Service: the CMS routes by Host (`proxy.ts`), and the CLI, the bundles and the browser use the public URLs anyway. `CLUSTER_EXPECTED_SHA` is the image tag without `sha-`, so the spec checks that `/api/health` serves exactly the commit of the smoke image.

**Where the report is.** The Job log. `apps/cms/e2e-cluster/run-in-cluster.sh` runs the spec with the list reporter, prints `health.json`, `cleanup.json` and `templates.txt`, and ends with one line:

```
CLUSTER_SMOKE: PASS|FAIL|SKIPPED sha=<sha> passed=<n> failed=<n> skipped=<n>
```

`SKIPPED` = the secrets are missing (below). The Job fails (exit code of Playwright) on `FAIL`. Read it during deploy-verify through the ArgoCD API (skill argocd-readonly): find the pod of the Job `…-smoke-sha-<sha>` in `resource-tree`, then `GET /api/v1/applications/rin-azet-games-cms/pods/<pod>/logs?namespace=rin-apps&tailLines=400&follow=false`. The pod keeps its log until the TTL. The HTML report and the Had end screen screenshot stay in the pod (emptyDir) and are not kept.

What the spec does, in order:

1. Waits until `/api/health` serves the expected commit (`CLUSTER_EXPECTED_SHA` in the cluster, `CI_COMMIT_SHORT_SHA` in a development CI run; up to 20 min), then mints two 1-day tokens from the passcode session in `azet-hackathon` (`smoke-cluster`: `games:read`, `games:write`, `versions:write`, `versions:activate`; `smoke-cluster-read`: `games:read`).
2. Installs the CLI from `<cms>/downloads/azet-games-cli.tgz` and runs `scripts/smoke-templates.mjs` (every template through create → build → validate → contract → publish → bundle → live → archive).
3. Publishes `apps/cms/e2e/fixtures/probe` as a fresh slug, plays it twice on the hackathon host through Azet ID (rin-oauth), and checks the wallet, shop, inventory, store, award and error results. Then plays Had (`games/snake`) to its end screen.
4. Archives the probe: its bundle must be 404 within 90 s and its deploy token must answer 401 (D-68).
5. Checks the error order (401 without credentials, 403 for a `games:read` token on a write before body validation, JSON 404 for a missing game) and `GET /members` with a `games:read` token → 403.
6. Cleanup in `afterAll`: archives the probe if it is still live, revokes every token of the run and checks that they answer 401 (`cleanup.json`).

The wallet of the test player persists between runs (per tenant), so the checks compare balances relative to the first play. Probe fixture: `dailyEarnCap` is high and the "insufficient funds" purchase uses an item that can never be bought, so the checks hold on any run day.

**Secrets.** In the cluster: `SMOKE_LOGIN_PASSCODE` = `LOGIN_PASSCODE` of the app secret; `SMOKE_LOGIN_EMAIL`, `SMOKE_AZET_USER`, `SMOKE_AZET_PASSWORD` from the Vault secret `azet-games-cms-smoke` ([Vault](#vault)). All four are optional in the Job: without them every test skips and the log says `SKIPPED`. **Personal passwords (MEM-5, D-75):** the smoke account signs in with the access code only until it has a password, and after such a sign-in the admin asks for a password first, so the smoke needs a dedicated admin account with its own password: sign in once as `SMOKE_LOGIN_EMAIL` with the access code, set a password, and store it as `SMOKE_LOGIN_PASSWORD` in `azet-games-cms-smoke` (the spec then signs in with it). The ExternalSecret and the Job are created in the same wave, so the very first Job after the Vault secret appears may still skip; the next deploy has it. When Okta replaces the passcode (H-3), the smoke needs another way to mint its tokens.

The manual CI job `smoke:cluster` takes the same names as masked, protected CI variables (Settings → CI/CD → Variables, set by Martin or Lukáš), so they exist only on `development`; on any other branch the spec skips. To run it: CI/CD → Pipelines → Run pipeline, then play `smoke:cluster` (only useful from a runner that reaches the hosts). Run locally with `npm run smoke:cluster` only with the same variables exported and never against production.

The time budgets of the spec (health wait and setup 25 min, templates 30, player services 15, archive 3, error order 5, cleanup 5) stay below both the Job's `activeDeadlineSeconds` (100 min) and the CI job timeout (100 min), so cleanup always runs before the run is killed; change them together.

## Game backends

Backends of games run in the namespace `rin-apps` as `azgb-<tenant>-<slug>` (D-76, AZG-321): the ArgoCD project of rin-* repos deploys only there. They are not part of this chart: the generic chart [`packages/backends-chart`](../packages/backends-chart/README.md) is copied to the root of the GitLab repo `rin-apps/rin-azet-games-backends`, and ArgoCD deploys every `values/<tenant>/<slug>.yaml` there.

1. On the default branch of a game repo, `ci/game.yml` builds `backend/` and pushes `harbor.rintools.sk/communities/rin/azg-backend-<tenant>-<slug>:sha-<short>` (`azg:backend`), then `azg backend deploy` (`azg:backend-deploy`) calls `POST /api/v1/games/{slug}/backend/deploy` with the game's deploy token ([API.md](api.md#games)).
2. The CMS writes the values file from the manifest of the active version and commits it to `development` of the backends repo (the only branch ArgoCD syncs) through the GitLab API (`[skip ci]`; unchanged content = no commit). It registers the Service URL `http://azgb-<tenant>-<slug>.rin-apps.svc.cluster.local`, which the default `BACKEND_URL_PATTERN` of production allows.
3. ArgoCD syncs the backend. Its env gets `AZG_API` = the CMS Service inside the cluster (`cms.apiUrl` of the backends chart). The backend fetches `/.well-known/jwks.json` and posts `/api/v1/results` there, so that host is an `ADMIN_HOST` alias (`values.yaml` → `hosts.adminAliases`; `proxy.ts` answers 404 for a Host it does not know). Keep both values in step: `apps/cms/proxy.test.ts` fails when they differ.

| What | Where |
|---|---|
| GitLab API URL, repo and branch of the writes | `BACKENDS_GITLAB_URL` (default `https://gitlab.rintools.sk`), `BACKENDS_GITOPS_PROJECT` (default `sysadmins/kubernetes/clusters/com/repo/helm-charts-apps/rin-apps/rin-azet-games-backends`), `BACKENDS_GITOPS_BRANCH` (default `development`), in `values.yaml` → `env` when they change |
| Write access of the CMS | `BACKENDS_GITOPS_TOKEN` in the app secret ([Vault](#vault)). The CMS image has no `git`, so it writes through the GitLab API with a project access token instead of an SSH deploy key |
| Secrets of the backends (`backend.secrets`) and the provisioner password | Vault `kubernetes/com-k8s-development/rin-apps/azet-games-backends` (`<tenant>/<slug>` per backend, `PROVISIONER_PASSWORD` at the root), read by the ExternalSecrets of the backends chart |
| Lint of the backends chart | `helm:lint` CI job: `helm lint` + `helm template` of `packages/backends-chart` against its `test-values/` |

Setup (AZG-321, all in our hands): the backends repo with a copy of the chart, `PROVISIONER_PASSWORD` and `BACKENDS_GITOPS_TOKEN` in Vault. The database `azg_backends` and the role `azg_backend_provisioner` are created by the chart's bootstrap Job (rin-postgres superuser from Vault `rin-postgres`, like this chart's `db-bootstrap`).

## First deploy checklist

1. Vault secret created (above).
2. GitLab project `rin-apps/rin-azet-games-cms` (the `rin-` prefix is required: the rin-apps ArgoCD ApplicationSet only discovers `rin-*` repos; renamed on 11 Oct, the Vault secret, chart, image and hosts keep the `azet-games` names), default branch `development`, `GITOPS_DEPLOY_*` CI variables, deploy key with write access.
3. Push → pipeline green → `values.yaml` bumped → ArgoCD syncs (the ApplicationSet discovers a new repo within ~1 h).
4. `https://azet-games-cms.rin.rinapps.dev/api/health` answers with the build SHA.
5. Sign in with e-mail + passcode; create a token (`node apps/cms/dist-scripts/create-token.mjs --tenant azet-hackathon` in the pod, or the Tokens screen).
6. Publish the reference games against the cluster (`AZG_API=https://azet-games-cms.rin.rinapps.dev azg publish --activate`) and check the public host.
7. Install the CLI from the cluster (`npm i -g --allow-remote=all https://azet-games-cms.rin.rinapps.dev/downloads/azet-games-cli.tgz`), `azg login`, and upload a starter .zip in the CMS (game → Nahrať hru).

Tenants start with empty landing sections: promote games (game → promote) and publish the landing page per tenant in the CMS.

## DTM export

`GET /api/v1/events/export?from=<ISO>&to=<ISO>` (token with `games:read`, not game-limited) returns the tenant's events as NDJSON, at most 31 days and 100 000 events per call (DAT-2). Each line has the columns `ts`, `playDate`, `tenant`, `game`, `version`, `session`, `player`, `playerKind`, `loggedIn`, `marketingConsent`, `type`, `name` and `payload`. They are described in [EVENTS.md](events.md#where-the-events-go). `player` is the HMAC player key in the space of DTM `userstats.iduser`, so signed-in players join Azet data in DTM. Anonymous players are `anon:<uuid>`. A DTM loader pulls one day per call, from 00:00 to 24:00 Europe/Bratislava, after the nightly rollup. It must honour `marketingConsent`.
