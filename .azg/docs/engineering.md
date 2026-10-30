# Engineering standards

These rules apply to every change, by people or agents. They follow the conventions of Azet frontend repos (Koktejl, azet-hp) so that Azet developers feel at home.

## 1. Language and style

- **English everywhere:** code, identifiers, comments, docs, commit messages, MR descriptions, and the CMS admin UI (copy in `apps/cms/messages/en.ts`, D-39). Player-facing copy (public landing, leaderboard, the game shell) is Slovak, for the Azet audience: `apps/cms/messages/sk.ts` and `packages/shell/src/messages.ts`. No hard-coded copy in components.
- **Design system:** the admin uses Phillip's tokens and component specs (`apps/cms/ui/phillip-tokens.css`, D-38). Colours, radii and fonts come from `ui/theme.ts`; components never hard-code values. Use `Button variant="go"` only for the one commit action of a view.
- TypeScript `strict`. No `any` without a comment explaining why.
- Prettier: single quotes, trailing commas, 100 columns, 2 spaces, semicolons (same as Koktejl).
- ESLint 9 flat config: `next/core-web-vitals` + `next/typescript` + `prettier`.
- Path alias `@/*` inside `apps/cms`.
- Comments explain *why*, not *what*. Every non-obvious decision gets a comment or a DECISIONS entry.

## 2. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19 |
| Styling | styled-components 6 with an SSR registry; theme tokens in `apps/cms/theme` |
| Data | Postgres 17, Drizzle ORM, SQL migrations |
| Validation | Zod for API input; Ajv for manifest JSON Schema |
| Auth | NextAuth (Okta in production, dev provider locally) |
| Tests | Vitest (unit, integration), Playwright (e2e, contract) |
| Packages | npm workspaces, `package-lock.json` committed |
| Node | 22 LTS or newer (Azet build image runs Node 26) |

## 3. Architecture rules

- **Tenant isolation is never optional.** Every DB access goes through `withTenant(tenantId, fn)`, which opens a transaction and sets `app.tenant_id`. Direct `db` access outside it is a lint error (`no-restricted-imports`).
- The tenant comes from the session or token only. Never read it from the request body, query or path. The one exception is the public play/landing address (`/t/<tenant>/…`, the tenant host in production): it selects which public site is shown, never grants access to anything private, and every later play call takes the tenant from the signed play token.
- Route handlers stay thin: parse input (Zod) → call a service in `apps/cms/server/services` → map the result. Services hold the logic and are unit-tested.
- Every write goes through a service that writes the audit log in the same transaction.
- No secrets in the DB, config documents or the repo. Read them from env (`apps/cms/server/env.ts` validates env at startup).
- The SDK has zero runtime dependencies and must stay below 8 KB gzipped (11 Oct: 3.1 KB; the shell 10 KB).
- Anything in `packages/manifest` must run in Node and in the browser.

## 4. Testing

| Layer | Tool | Rule |
|---|---|---|
| Services, manifest, SDK, CLI | Vitest | Every branch with a requirement ID has a test |
| API routes | Vitest against a real Postgres (Docker) | Every endpoint has a cross-tenant test (TEN-2.1) |
| RLS | SQL tests | Every tenant-scoped table: no rows without `app.tenant_id` (TEN-6.1) |
| UI flows | Playwright | Golden paths: register → publish → configure → play → complete |
| Contract | Playwright + the real shell | Both reference games and every template |

Tests reference acceptance criteria in their names: `it('REG-1.2 rejects a duplicate slug in the same tenant', …)`. `npm run ac:coverage` lists Must criteria without a test.

Coverage targets: services and packages 90 % lines; the SDK and manifest 95 %.

## 5. Quality gates (CI and before every merge)

```bash
npm run lint
npm run typecheck
npm run test           # unit + integration
npm run test:e2e
npm run ac:coverage    # fails if a Must criterion has no test
```

A change is done when all gates pass, the relevant docs are updated in the same MR, and no Must criterion lost coverage.

A change to what `@azet/games-sdk`, `@azet/games-server` or `@azet/games-cli` publishes bumps that package's `version` in the same MR (D-79): the CMS serves `/downloads/<name>-<version>.tgz` as immutable and npm caches it by URL, so the same version with new contents never reaches a machine that installed it once.

After every deploy of `development`, the cluster smoke checks the deployed cluster (templates through the CLI, player services through Azet ID, archive, scopes; DEPLOY.md "Cluster smoke"). It runs inside the cluster as a chart Job per image tag, because the GitLab runners cannot reach the cluster hosts; its verdict is the last line of the Job log (`CLUSTER_SMOKE: PASS|FAIL|SKIPPED`), which the Release Manager reads during deploy-verify. It is informational: it never blocks or fails the ArgoCD sync, never runs in MR pipelines, and is not a merge gate. The CI job `smoke:cluster` runs the same spec by hand only.

## 6. Git

- Branches: `feature/<id>-<short>`, `fix/<id>-<short>`. Default branch `main`.
- Conventional commits: `feat(sdk): add store.list`, `fix(cms): …`.
- Stage only the files you changed. Never `git add -A`.
- One MR = one concern, with a description that links requirement IDs.

## 7. Docs

- Contract changes (SDK, manifest, API, CLI) update the matching doc in the same MR.
- After 23 Oct, SDK contract changes need a DECISIONS entry and must be additive.
- The docs say what the code does (HLP-4): `packages/sdk/test/docs-samples.test.ts` typechecks every `ts` sample of SDK-CONTRACT, GAME-SERVICES, MANIFEST and HACKATHON against the workspace SDK and server, checks the shapes the samples describe in comments (`// { kind: 'signed-in' | 'nickname' | 'anonymous', … }`, `// ctx.env  'dev' | 'preview' | 'live'`), compares a type the docs spell out (`interface Room { … }`) with the exported one, and compares field tables it knows (the results request) with their type. A sample that is deliberately not complete TypeScript gets `<!-- docs-check: skip (why) -->` on the line before its fence.
