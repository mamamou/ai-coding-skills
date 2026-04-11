---
name: code-reviewer-node
description: >
  Node.js/Express/TypeScript-specific code review overlay. Extends the universal
  code-reviewer skill with Node.js version-aware rules. Trigger when reviewing
  Express route handlers, middleware, REST controllers, GraphQL resolvers, Apollo
  Server setup, JWT/OAuth middleware, Bull/BullMQ job processors, or any .ts/.js
  file in a Node.js backend project. Keywords: Express, REST API, GraphQL, Apollo,
  JWT, OAuth, BullMQ, Bull, queue, middleware, TypeScript strict, tsconfig, req, res,
  next, router. Do NOT trigger for frontend React/Vue/Angular code in the same repo
  (use code-reviewer-react for those) or for infrastructure/IaC files.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Code Reviewer — Node.js / Express Overlay

This skill extends `code-reviewer` (the universal skill). Always apply the universal
skill's full checklist first, then apply the Node.js-specific rules in this file on top.

**Composition order:**
1. Run `code-reviewer` (universal pillars: correctness, security, performance, DRY, tests, docs)
2. Run this overlay (Node.js/Express/TypeScript-specific rules below)
3. Report findings from both in a single unified output

---

## Step 0 — Detect Versions First (always, before reviewing anything)

Run these commands before touching any code. Version determines which rules apply.

```bash
# Node.js runtime version
node --version
cat .nvmrc 2>/dev/null
cat .node-version 2>/dev/null

# Package manager and key dependencies
cat package.json | grep -E '"(node|engines|typescript|express|graphql|apollo-server|bullmq|bull|jsonwebtoken|zod|joi|helmet|express-rate-limit)"'

# TypeScript config
cat tsconfig.json 2>/dev/null | grep -E '"(strict|target|module|moduleResolution)"'

# Check if ESM or CJS
cat package.json | grep '"type"'
```

Report at the top of your review:
```
🔍 Environment: Node.js vX.Y | TypeScript X.Y | Express X.Y | ESM/CJS
    Packages: [graphql, apollo-server, bullmq/bull, jsonwebtoken, zod/joi — versions]
```

Then apply the version-specific rules below that match.

---

## Node.js Version Rules

### Node 18 — ❌ EOL since April 2025
- **Flag as Critical**: Node 18 is end-of-life with no security patches.
- Flag any deployment config (`Dockerfile`, `.nvmrc`, `engines` in `package.json`) targeting Node 18.
- Suggest immediate migration to Node 22 (Active LTS).
- Specific issues: older `fs`/`url`/`crypto` behaviors removed in 20+; flag `url.parse()` → use `new URL()`.

### Node 20 — ⚠️ Maintenance LTS (EOL April 2026)
- Flag as Warning: Node 20 exits LTS in April 2026 — plan migration to Node 22.
- `require()` of ESM modules still requires workaround — flag ugly `createRequire` hacks; they'll be fixed on Node 22.
- `url.parse()` still works but flag it: use `new URL()` instead.
- Native `fetch` is stable — flag `node-fetch` or `axios` used only for simple GET/POST where native fetch suffices.

### Node 22 — ✅ Active LTS (recommended)
- **Best target for new and migrated projects.**
- Native `fetch` is fully stable — flag `node-fetch` package as unnecessary for simple requests.
- `require(ESM)` works from 22.12+ without flags — flag `createRequire` workarounds.
- `url.parse()` emits DEP0169 warning — flag any usage; replace with `new URL()`.
- `--experimental-permission` model redesigned — flag old permission flags if present.
- V8 12.4: better performance, no code changes needed.

---

## TypeScript Rules (strict mode)

- **`strict: true` in `tsconfig.json`** — flag if missing. In a strict project, also flag:
  - `any` types on request handlers, resolver args, or job payloads — replace with typed interfaces.
  - `as any` casts — flag each one; they hide bugs.
  - Non-null assertions (`!`) without a guard — flag unsafe use.
  - Untyped `req.body`, `req.params`, `req.query` — must be typed:
    ```ts
    // ❌ Untyped
    const { email } = req.body;

    // ✅ Typed with Zod or interface
    const { email } = CreateUserSchema.parse(req.body);
    ```
- **`"moduleResolution": "bundler"` or `"node16"`** — flag if using `"node"` (legacy) in a new project with ESM.
- **`"target"` vs runtime** — flag `target: "es5"` on Node 20/22; use `"es2022"` or higher.
- Flag missing `@types/*` packages for dependencies that have them available.
- Flag `tsconfig.json` missing `"paths"` configuration causing deep relative imports (`../../../../utils`).

---

## Express-Specific Review Checklist

### 🛣️ Routing & Middleware Order
- **Middleware order matters in Express** — flag security middleware (`helmet`, `cors`, rate limiting, auth) placed after route definitions.
  ```ts
  // ❌ Helmet applied after routes — security headers missing on those routes
  app.get('/users', usersRouter);
  app.use(helmet());

  // ✅ Helmet first
  app.use(helmet());
  app.get('/users', usersRouter);
  ```
- Flag missing `express.json()` or `express.urlencoded()` body parsers when handlers access `req.body`.
- Flag `body-parser` package usage — it's bundled in Express 4.16+ as `express.json()`.
- Flag missing global error handler (`app.use((err, req, res, next) => {...})`) — unhandled errors leak stack traces.
- Flag `next()` called after `res.send()` / `res.json()` — double response bug.
- Flag missing `return` before `res.send()` in conditional branches — causes "headers already sent" errors.

### 🔐 Security (Express-specific, extends universal pillar)
- **`helmet()`** — flag any Express app not using `helmet` middleware. Helmet sets: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `X-XSS-Protection`, and more.
- **CORS** — flag `cors({ origin: '*' })` in production; must whitelist specific origins.
- **Rate limiting** — flag routes (especially auth endpoints: `/login`, `/register`, `/reset-password`) missing `express-rate-limit` or equivalent.
- **Input validation** — flag any `req.body`, `req.query`, `req.params` used without validation. Must use Zod, Joi, or equivalent before entering business logic:
  ```ts
  // ❌ Raw body access — no validation
  const user = await createUser(req.body.email, req.body.password);

  // ✅ Validated first
  const { email, password } = CreateUserSchema.parse(req.body);
  const user = await createUser(email, password);
  ```
- **Parameter pollution** — flag missing `hpp` middleware if query params are used for filtering.
- **`express.static`** — flag serving directories with sensitive files; check path traversal risk.
- **SQL/NoSQL injection** — flag string-concatenated queries; always use parameterized queries or ORM.
- **Secrets in code** — flag hardcoded `JWT_SECRET`, API keys, or DB credentials; must use `process.env` with validation at startup.

### ⚡ Performance (Express-specific)
- **Blocking operations in route handlers** — flag `fs.readFileSync`, `JSON.parse` on large payloads, heavy CPU loops. Use async `fs.promises.*` or offload to worker threads.
- **Unbounded queries** — flag endpoints returning database results without pagination (`limit`/`offset` or cursor).
- **Async/await error handling** — flag `async` route handlers without try/catch or an async error wrapper:
  ```ts
  // ❌ Unhandled promise rejection crashes Express
  app.get('/users', async (req, res) => {
    const users = await getUsers(); // if this throws, Express doesn't catch it
    res.json(users);
  });

  // ✅ Wrapped
  app.get('/users', asyncHandler(async (req, res) => {
    const users = await getUsers();
    res.json(users);
  }));
  ```
- **Missing `compression` middleware** — flag large JSON API responses without gzip compression.
- **Connection pooling** — flag new DB connections created per request; use a shared pool.

---

## JWT / OAuth Review Checklist

### JWT
- **Secret strength** — flag `JWT_SECRET` that is short, hardcoded, or a simple word. Must be a long random string from environment.
- **Algorithm** — flag `{ algorithm: 'none' }` (critical). Flag `HS256` for multi-service architectures; prefer `RS256`/`ES256` (asymmetric).
- **Claims validation** — flag `jwt.verify()` calls that don't check `iss`, `aud`, `exp`:
  ```ts
  // ❌ No audience/issuer check
  const decoded = jwt.verify(token, secret);

  // ✅ Full claims validation
  const decoded = jwt.verify(token, secret, {
    algorithms: ['RS256'],
    audience: process.env.JWT_AUDIENCE,
    issuer: process.env.JWT_ISSUER,
  });
  ```
- **Token storage guidance** — flag comments or docs suggesting `localStorage` for JWTs; use `httpOnly` cookies.
- **Refresh token rotation** — flag implementations issuing new access tokens without rotating the refresh token.
- **Token expiry** — flag very long-lived access tokens (`expiresIn: '30d'`); access tokens should be short-lived (15min–1h); use refresh tokens for longevity.
- **`jsonwebtoken` vs `jose`** — flag `jsonwebtoken` in Node 22 projects for new code; `jose` is more modern and supports Web Crypto API natively.

### OAuth 2.1 / OIDC
- **PKCE** — flag public clients (SPAs, mobile) using Authorization Code flow without PKCE.
- **`state` parameter** — flag OAuth flows missing CSRF state validation.
- **Redirect URI validation** — flag open redirect risks in callback handlers.
- **Token introspection** — flag resource servers that only decode JWTs without verifying signature or calling introspection endpoint.
- **Scope validation** — flag middleware that authenticates but doesn't check required scopes.

---

## GraphQL / Apollo Review Checklist (if present)

### Schema & Resolvers
- **Introspection in production** — flag `introspection: true` (or omitted, as it defaults to `true` in dev) in production Apollo Server config. Should be `process.env.NODE_ENV !== 'production'`.
- **Query depth limit** — flag Apollo Server missing `depthLimit` plugin — unbounded nested queries are a DoS vector.
- **Query complexity limit** — flag missing `costLimit` or `complexityLimit` plugin for production APIs.
- **N+1 in resolvers** — flag resolvers that call the database inside a field that is queried per parent object. Must use DataLoader:
  ```ts
  // ❌ N+1 — one DB call per user in the list
  posts: async (user) => await Post.findAll({ where: { userId: user.id } }),

  // ✅ DataLoader batches into one query
  posts: async (user, _, { loaders }) => loaders.postsByUserId.load(user.id),
  ```
- **Auth at resolver level** — flag resolvers that assume authentication is handled upstream without verifying. Use a schema directive or guard per resolver/field.
- **Untyped resolver args** — flag `args: any` on resolvers; use generated types from `graphql-codegen`.
- **Error exposure** — flag `formatError` not configured; Apollo default may expose stack traces in production.
- **Mutations without input validation** — flag mutations accessing `args` directly without Zod/Joi validation.
- **Subscriptions** — flag WebSocket subscriptions missing auth check on connection `onConnect`.

---

## Bull / BullMQ Queue Review Checklist (if present)

- **Idempotency** — flag job processors that are not idempotent (safe to retry). Jobs can be executed more than once on failure.
- **`attempts` + `backoff`** — flag jobs with no retry strategy:
  ```ts
  // ❌ No retry — job silently disappears on failure
  queue.add('send-email', { to: email });

  // ✅ With retry and exponential backoff
  queue.add('send-email', { to: email }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
  ```
- **Sensitive data in payloads** — flag PII, tokens, or passwords stored in job data (Redis stores in plaintext by default). Pass IDs and look up data from the DB in the processor instead.
- **Failed job handling** — flag queues missing a `failed` event listener or dead letter queue strategy.
- **Connection reuse** — flag new Redis connections created per queue instance; use a shared connection:
  ```ts
  // ❌ New connection per queue
  const emailQueue = new Queue('email', { connection: { host, port } });
  const smsQueue = new Queue('sms', { connection: { host, port } });

  // ✅ Shared connection
  const connection = new IORedis({ host, port, maxRetriesPerRequest: null });
  const emailQueue = new Queue('email', { connection });
  const smsQueue = new Queue('sms', { connection });
  ```
- **Worker concurrency** — flag default concurrency (1) for I/O-bound jobs; consider increasing.
- **Job stalling** — flag missing `stalledInterval` config for long-running jobs.
- **BullMQ vs Bull** — flag `bull` (legacy) in new Node 22 projects; prefer `bullmq` (active development, better TypeScript support).

---

## REST API Design Checklist

- **HTTP method semantics** — flag `GET` endpoints with side effects, `POST` used for reads, `DELETE` with a body.
- **Status codes** — flag wrong codes: `200` for created resources (should be `201`), `200` for empty results (should be `204`), `500` for client errors (should be `4xx`).
- **Error response shape** — flag inconsistent error formats across endpoints. Standardize:
  ```ts
  { error: { code: 'VALIDATION_ERROR', message: '...', details: [...] } }
  ```
- **Pagination** — flag list endpoints missing `limit`/`offset` or cursor params.
- **Versioning** — flag APIs with no version prefix (`/v1/`) in a project that has multiple consumers.
- **`Content-Type` header** — flag responses missing `Content-Type: application/json` when returning JSON.
- **Idempotency keys** — flag `POST` endpoints for financial or critical operations missing idempotency key support.

---

## Testing Checklist (Node.js-specific)

- Flag test files not using `supertest` for HTTP integration tests on Express routes.
- Flag tests hitting a real database without using test containers (Testcontainers, Docker Compose) for reproducible isolation.
- Flag missing `afterAll` / `afterEach` cleanup (open handles prevent Jest from exiting).
- Flag `jest.setTimeout` set very high globally — symptom of slow or hanging tests.
- Flag tests calling real third-party APIs — must be mocked with `nock`, `msw`, or `jest.mock`.

---

## Unified Output Format

Use the same format as `code-reviewer` (universal). Add a Node.js context line:

```
🔍 Environment: Node.js v22.x | TypeScript 5.x | Express 4.x | ESM
    Packages: graphql 16.x, apollo-server 4.x, bullmq 5.x, jsonwebtoken 9.x, zod 3.x

## Code Review Summary
[... standard universal format ...]

### 🟢 Node.js-Specific Issues
[Issues found by this overlay, using the same severity/format as universal]
```

---

## Behavior Rules (Node.js-specific additions)

- **Version first, always** — never apply version rules without detecting the runtime first. Node 18 EOL is a Critical-level finding.
- **`async` error handling is non-negotiable** — unhandled promise rejections in Express crash the process silently in older setups and terminate in Node 15+. Always flag.
- **Middleware order is security-critical** — `helmet`, CORS, rate limiting, and auth must come before route handlers. Flag any violation.
- **Sensitive data in queues** — treat job payloads like logs: no secrets, no PII, no tokens.
- **Delegate deep security audits** → `security-auditor` skill if available.
