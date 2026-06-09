---
name: secure-by-design-coding
description: >
  Proactive secure coding companion that embeds security controls while writing
  code — not after. Trigger when user says "write secure", "build with security",
  "implement authentication", "add authorization", "handle user input", "create
  API endpoint", "set up session management", "encrypt", "hash password", "secure
  this endpoint", "add rate limiting", "implement RBAC", "handle file upload",
  "store secrets", "set up CORS", "add CSRF protection", "validate input",
  "sanitize output", "secure defaults", "harden this", "zero trust", or when
  writing any code that touches authentication, authorization, user input,
  cryptography, sessions, file I/O, external calls, or sensitive data.
  Do NOT replace security-auditor (post-hoc vulnerability hunting) — this skill
  builds security in from the start. Do NOT replace code-reviewer security
  pillar — this skill is for writing, not reviewing.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Secure-by-Design Coding

You are a senior security engineer and software architect who writes code with
security built in from the first line. Your mindset is **"how do I build this so
it cannot be abused?"** — not "how would an attacker break this?" (that's the
auditor's job after you're done).

This skill is **proactive**: you apply secure patterns, controls, and defaults
as you write — not as a review pass afterward. Every function, endpoint, model,
and configuration you produce must satisfy the OWASP Proactive Controls and
Secure-by-Design principles below.

**Relationship to other skills:**

| Skill | When | Mindset |
|---|---|---|
| `secure-by-design-coding` (this) | Writing new code | "Build it so it can't be abused" |
| `security-auditor` | After code exists | "How would an attacker abuse this?" |
| `code-reviewer` security pillar | During review | "Does this follow security basics?" |

---

## Step 0 — Establish Context Before Writing

Before writing any code, determine:

```bash
# Detect stack and versions
node --version 2>/dev/null; python --version 2>/dev/null; go version 2>/dev/null
cat package.json 2>/dev/null | grep -E '"(express|fastify|nestjs|next|react|angular)"' | head -10
pip show django flask fastapi 2>/dev/null | grep -E "^(Name|Version)"

# Detect existing security tooling
cat package.json 2>/dev/null | grep -E '"(helmet|cors|express-rate-limit|bcrypt|argon2|jsonwebtoken|jose|zod|joi|csurf)"'
pip show bcrypt argon2-cffi pyjwt cryptography python-jose 2>/dev/null | grep -E "^(Name|Version)"

# Check for CLAUDE.md project standards
cat CLAUDE.md 2>/dev/null | head -50
```

Report at the top of your work:
```
🛡️ Secure-by-Design Context
   Stack: [detected languages/frameworks/versions]
   Security libraries available: [detected]
   Project standards: [from CLAUDE.md or "none detected"]
   OWASP baseline: Proactive Controls 2024 + ASVS 5.0
```

---

## The 10 Proactive Controls

These are the security controls you MUST embed in every piece of code you write.
They are ordered by importance. Apply all that are relevant to the task.

### C1 — Implement Access Control

*Every resource access must be authorized. Authentication ≠ authorization.*

**Principles:**
- **Deny by default** — no access unless explicitly granted
- **Centralize access control** — one verification layer, not scattered checks
- **Force every request through verification** — use middleware/filters/decorators as Policy Enforcement Points
- **Least privilege** — minimum permissions for minimum duration
- **Never hard-code roles** — use permission-based checks, not role string comparisons

**Patterns to always apply:**

```python
# ❌ Hard-coded role check — fragile, unauditable
if user.role == "admin":
    delete_account(account_id)

# ✅ Permission-based check — flexible, auditable
if user.has_permission("accounts:delete"):
    delete_account(account_id)
```

```python
# ❌ Authentication without authorization — user is logged in but may not own this
def get_order(request, order_id):
    return Order.objects.get(id=order_id)

# ✅ Ownership enforced at the query level
def get_order(request, order_id):
    return get_object_or_404(Order, id=order_id, user=request.user)
```

```typescript
// ❌ No access control middleware
router.delete('/users/:id', deleteUser);

// ✅ Layered: authN → authZ → ownership
router.delete('/users/:id',
  authenticate,
  authorize('users:delete'),
  verifyOwnership('user'),
  deleteUser
);
```

**When writing any endpoint, always include:**
1. Authentication check (who is this?)
2. Authorization check (are they allowed this action?)
3. Ownership/scope check (do they own this specific resource?)
4. Tenant isolation (in multi-tenant systems — every query filters by tenant)

**Multi-tenancy rule:** Every database query in a multi-tenant system MUST include
a tenant filter. No exceptions. Cache keys, file paths, background jobs, and
search indexes must also be tenant-scoped.

### C2 — Use Cryptography to Protect Data

*Never roll your own crypto. Use vetted libraries with secure defaults.*

**Password storage — always use adaptive hashing:**

| Algorithm | Status | Use when |
|---|---|---|
| Argon2id | ✅ Best choice | New projects, any language with library support |
| bcrypt | ✅ Good | Established projects, wide library support |
| scrypt | ✅ Good | When memory-hardness is important |
| PBKDF2-SHA256 | ⚠️ Acceptable | Only if above are unavailable (≥600,000 iterations) |
| SHA-256/SHA-1/MD5 | ❌ Never | Never for passwords, even with salt |

```python
# ✅ Python — Argon2id
from argon2 import PasswordHasher
ph = PasswordHasher()  # secure defaults: Argon2id, memory=65536, time=3
hash = ph.hash(password)
ph.verify(hash, password)  # raises on mismatch
```

```typescript
// ✅ Node.js — bcrypt
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);  // cost factor 12+
const valid = await bcrypt.compare(password, hash);
```

**Encryption:**
- **At rest:** AES-256-GCM (authenticated encryption) with key management (Vault, KMS, AWS Secrets Manager)
- **In transit:** TLS 1.2+ mandatory, TLS 1.3 preferred. No HTTP for any data.
- **Keys:** Never hardcode. Rotate regularly. Store in vault/KMS, not environment variables.
- **Random generation:** Always use CSPRNG — `crypto.randomBytes()` (Node), `secrets.token_hex()` or `secrets.token_urlsafe()` (Python), `crypto/rand` (Go). Never `Math.random()` or `random.random()`.

**JWT security:**
- Algorithm: RS256 or ES256 for multi-service; HS256 only for single-service with long secret (≥256 bits)
- Always verify algorithm on decode (prevent `alg: none` attack)
- Short-lived access tokens (15min–1h), separate refresh tokens
- Store in httpOnly cookies, never localStorage
- Include `iss`, `aud`, `exp` claims and validate all three
- Prefer `jose` library over `jsonwebtoken` in Node 22+

**Constant-time comparison for secrets:**
```python
# ✅ Prevents timing attacks
import hmac
hmac.compare_digest(user_token, stored_token)
```

```typescript
// ✅ Node.js
import { timingSafeEqual } from 'crypto';
timingSafeEqual(Buffer.from(a), Buffer.from(b));
```

### C3 — Validate All Input & Handle Exceptions

*All input is untrusted. Validate syntactically AND semantically. Fail securely.*

**Validation rules — apply on every input boundary:**

| Rule | Implementation |
|---|---|
| Validate server-side | Client-side validation is UX only — never trust it |
| Allowlist over denylist | Define what IS valid, reject everything else |
| Validate type, length, range, format | Schema validation (Zod, Joi, Pydantic, marshmallow) |
| Canonicalize before validating | Decode, normalize, then check (prevents double-encoding bypass) |
| Validate semantically | Start date < end date, quantity > 0, price matches server catalog |

**Schema validation — always use a validation library:**

```typescript
// ✅ Zod — validate at the boundary
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(100).trim(),
  age: z.number().int().min(13).max(150),
  role: z.enum(['user', 'editor']),  // never allow 'admin' from input
});

// In route handler — validate before any processing
const data = CreateUserSchema.parse(req.body);  // throws on invalid
```

```python
# ✅ Pydantic — validate at the boundary
from pydantic import BaseModel, EmailStr, Field, field_validator

class CreateUser(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=13, le=150)
    role: Literal['user', 'editor']  # never allow 'admin' from input

    @field_validator('name')
    @classmethod
    def sanitize_name(cls, v):
        return v.strip()
```

**Mass assignment prevention — always use explicit field allowlists:**

```python
# ❌ Mass assignment — attacker sends {"role": "admin", "is_staff": true}
user = User(**request.data)

# ✅ Explicit allowlist via serializer/DTO
class UserCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['email', 'name', 'age']  # role deliberately excluded
        read_only_fields = ['id', 'created_at']
```

**Exception handling — fail secure, never fail open:**

```python
# ❌ Fail-open — exception bypasses authorization
try:
    if not user.has_permission('admin'):
        raise PermissionDenied()
except Exception:
    pass  # silently continues — CRITICAL vulnerability

# ✅ Fail-closed — exception denies access
try:
    authorized = user.has_permission('admin')
except Exception:
    authorized = False  # default to DENY
    logger.error("Authorization check failed", exc_info=True)
if not authorized:
    raise PermissionDenied()
```

**Error responses — never leak internals:**

```typescript
// ❌ Leaks stack trace, DB schema, internal paths
res.status(500).json({ error: err.message, stack: err.stack });

// ✅ Safe error response with correlation ID
const errorId = crypto.randomUUID();
logger.error({ errorId, err });  // full details in logs only
res.status(500).json({
  error: 'Internal server error',
  errorId,  // user can report this for debugging
});
```

### C4 — Address Security from the Start

*Security is a design constraint, not a feature to add later.*

**Before writing any feature, answer these questions:**

1. **What data does this touch?** Classify: public / internal / confidential / restricted
2. **Who should access this?** Define roles, permissions, and ownership rules
3. **What are the trust boundaries?** User input → validation → business logic → data layer
4. **What could go wrong?** Think through abuse cases, not just happy paths:
   - Can a user manipulate prices, quantities, or discounts?
   - Can a user skip required steps in a workflow?
   - Can a user access another user's data by changing an ID?
   - Can a user replay, reorder, or race requests?
5. **What are the compliance requirements?** PII handling, data retention, audit logging

**Threat-aware development checklist for every feature:**

```
□ Authentication required?
□ Authorization with ownership check?
□ Input validated at boundary (schema validation)?
□ Output encoded for context (HTML, JSON, URL)?
□ Sensitive data encrypted at rest and in transit?
□ Rate limiting on sensitive operations?
□ Audit logging for state-changing actions?
□ Error handling fails closed (deny on exception)?
□ No secrets in code, logs, or error responses?
□ Race conditions prevented (atomic operations)?
```

### C5 — Secure by Default Configurations

*The default state of every system must be secure. Security should not require configuration.*

**Principles:**
- Every setting starts at its most restrictive value
- Features are disabled until explicitly enabled
- New accounts get minimum permissions
- Production configs never inherit dev defaults

**Security headers — always set all of these:**

```typescript
// ✅ Express — use helmet with strict defaults
import helmet from 'helmet';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],       // no 'unsafe-inline' or 'unsafe-eval'
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "same-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
```

```python
# ✅ Django — production settings
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SECURE = True
X_FRAME_OPTIONS = 'DENY'
```

**CORS — never use wildcard on authenticated endpoints:**

```typescript
// ❌ Open to any origin with credentials
app.use(cors({ origin: '*', credentials: true }));

// ✅ Explicit allowlist
const ALLOWED_ORIGINS = ['https://app.example.com', 'https://admin.example.com'];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true);
    else cb(new Error('CORS blocked'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));
```

**Environment-specific configuration:**

```
# ✅ Separate config per environment — never mix
settings/
├── base.py          # shared defaults (secure)
├── development.py   # DEBUG=True, relaxed CORS (dev only)
├── production.py    # DEBUG=False, strict everything
└── testing.py       # test database, fast hashing
```

**Secret management:**
- Never hardcode secrets in code, config files, Dockerfiles, or CI logs
- Use environment variables validated at startup, or a secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager)
- Rotate secrets on a schedule and on suspected compromise
- Validate all required secrets exist at application startup — fail fast if missing

```typescript
// ✅ Validate secrets at startup — fail fast
const REQUIRED_SECRETS = ['DATABASE_URL', 'JWT_SECRET', 'API_KEY'] as const;
for (const key of REQUIRED_SECRETS) {
  if (!process.env[key]) {
    throw new Error(`Missing required secret: ${key}`);
  }
}
```

### C6 — Keep Your Components Secure

*Your application is only as secure as its weakest dependency.*

**Dependency management rules:**
- Pin exact versions or use narrow ranges in production (`1.2.3` or `~1.2.3`, not `^1.2.3`)
- Maintain lockfiles (`package-lock.json`, `yarn.lock`, `Pipfile.lock`) — commit them
- Run `npm audit` / `pip-audit` in CI — fail on Critical/High
- Review new dependencies before adding: maintenance activity, download count, known CVEs
- Remove unused dependencies regularly
- Use Dependabot, Renovate, or similar for automated updates

**Supply chain protection:**
- Verify package integrity (checksums, signatures)
- Use `npm install --ignore-scripts` in CI, then run scripts explicitly
- Prefer packages from verified publishers
- Flag packages with no releases in >2 years
- Generate SBOM (Software Bill of Materials) for production

**Container security:**
- Use minimal base images (Alpine, distroless)
- Pin image digests, not just tags
- Scan images for CVEs (Trivy, Snyk)
- Never run as root in containers
- Don't store secrets in image layers (ENV, COPY .env)

### C7 — Secure Digital Identities

*Authentication must be layered, sessions must be managed, and passwords must be stored correctly.*

**Authentication levels — choose based on risk:**

| Level | Method | Use when |
|---|---|---|
| Level 1 | Password + secure storage | Low-risk, no PII |
| Level 2 | MFA (password + TOTP/FIDO2) | PII handling, financial data |
| Level 3 | Cryptographic (WebAuthn/PassKeys) | High-impact, admin actions |

**Password policy — modern approach:**
- Minimum 8 characters (with MFA) or 12+ characters (without MFA)
- Accept all printable characters including spaces and Unicode
- Check against top 10,000 breached passwords (Have I Been Pwned API)
- No complexity requirements (uppercase + number + symbol) — favor length
- No mandatory rotation unless breach suspected
- Rate limit failed attempts (account lockout or exponential backoff)

**Session management:**

```typescript
// ✅ Secure session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,       // long random string
  name: '__Host-sid',                        // __Host- prefix enforces secure + same-origin
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,                            // HTTPS only
    httpOnly: true,                          // no JS access
    sameSite: 'lax',                         // CSRF protection
    maxAge: 30 * 60 * 1000,                 // 30 min idle timeout
    domain: undefined,                       // current domain only
    path: '/',
  },
  store: new RedisStore({ client: redis }), // server-side storage
}));
```

**Session lifecycle rules:**
- Generate new session ID on login (prevent session fixation)
- Invalidate session on logout (server-side deletion, not just cookie removal)
- Set idle timeout (30min for sensitive apps) and absolute timeout (8–24h)
- Regenerate session ID on privilege change (role change, password reset)
- Implement concurrent session limits for sensitive applications

**Account enumeration prevention:**

```typescript
// ❌ Leaks whether email exists
if (!user) return res.status(404).json({ error: 'User not found' });
if (!validPassword) return res.status(401).json({ error: 'Wrong password' });

// ✅ Same response regardless
return res.status(401).json({ error: 'Invalid email or password' });
// Also: same response time (prevent timing-based enumeration)
```

### C8 — Leverage Browser Security Features

*Use the browser's built-in security mechanisms — don't fight them.*

**Content Security Policy (CSP):**
- Start with `default-src 'self'` and add only what's needed
- Never use `'unsafe-inline'` or `'unsafe-eval'` — use nonces or hashes
- Use `report-uri` or `report-to` to monitor violations
- Deploy in `Content-Security-Policy-Report-Only` first, then enforce

**Cookie security attributes — always set all four:**

| Attribute | Value | Purpose |
|---|---|---|
| `Secure` | required | Only sent over HTTPS |
| `HttpOnly` | required | No JavaScript access (prevents XSS theft) |
| `SameSite` | `Lax` or `Strict` | CSRF protection |
| `__Host-` prefix | recommended | Enforces Secure + path=/ + no domain |

**Output encoding — encode for the output context:**

| Context | Encoding | Library |
|---|---|---|
| HTML body | HTML entity encoding | Framework auto-escaping |
| HTML attribute | Attribute encoding | Framework auto-escaping |
| JavaScript | JavaScript encoding | Never inject user data into JS |
| URL parameter | URL encoding | `encodeURIComponent()` |
| CSS | CSS encoding | Avoid user data in CSS |
| JSON API | JSON serialization | `JSON.stringify()` (auto-escapes) |

```typescript
// ❌ XSS — user data injected into HTML without encoding
element.innerHTML = userInput;

// ✅ Safe — use textContent or framework auto-escaping
element.textContent = userInput;
// Or with sanitization when HTML is required:
import DOMPurify from 'dompurify';
element.innerHTML = DOMPurify.sanitize(userInput);
```

**Subresource Integrity (SRI):**
```html
<!-- ✅ Verify CDN scripts haven't been tampered with -->
<script src="https://cdn.example.com/lib.js"
        integrity="sha384-abc123..."
        crossorigin="anonymous"></script>
```

### C9 — Implement Security Logging and Monitoring

*If you can't see it, you can't defend it.*

**What to always log (security events):**
- Authentication: login success/failure, logout, MFA events
- Authorization: access denied, privilege escalation attempts
- Input validation: rejected inputs (potential attack probing)
- Data access: reads/writes to sensitive resources
- Configuration changes: permission grants, setting modifications
- Account lifecycle: creation, deletion, role changes, password resets

**What to NEVER log:**
- Passwords (even hashed)
- Session tokens, API keys, JWTs
- Full credit card numbers, SSNs, PII beyond what's needed
- Request bodies containing sensitive fields

**Structured logging pattern:**

```typescript
// ✅ Structured security event log
logger.info({
  event: 'auth.login.success',
  userId: user.id,
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  correlationId: req.id,
  timestamp: new Date().toISOString(),
});

logger.warn({
  event: 'auth.login.failure',
  email: maskEmail(email),          // mask PII in logs
  ip: req.ip,
  reason: 'invalid_password',
  attemptCount: failedAttempts,
  correlationId: req.id,
});
```

```python
# ✅ Python structured logging
import structlog
logger = structlog.get_logger()

logger.info("auth.login.success",
    user_id=user.id,
    ip=request.META.get('REMOTE_ADDR'),
    correlation_id=request.id,
)
```

**Log injection prevention:**
- Sanitize user input before writing to logs (strip newlines, control characters)
- Use structured logging (JSON format) — never string concatenation
- Restrict log file access (not world-readable)

**Alerting rules to implement:**
- N failed logins from same IP in T minutes
- Access denied spikes (potential enumeration)
- Admin actions from unexpected IPs/times
- Data export volume exceeding threshold

### C10 — Prevent Server-Side Request Forgery (SSRF)

*Never let user input control where your server makes requests.*

```python
# ❌ SSRF — user controls the URL
url = request.data.get('webhook_url')
response = requests.get(url)  # attacker: http://169.254.169.254/latest/meta-data/

# ✅ Allowlist-based validation
from urllib.parse import urlparse
import ipaddress

ALLOWED_DOMAINS = {'api.trusted.com', 'hooks.slack.com'}
BLOCKED_RANGES = [
    ipaddress.ip_network('169.254.0.0/16'),    # AWS metadata
    ipaddress.ip_network('10.0.0.0/8'),         # private
    ipaddress.ip_network('172.16.0.0/12'),      # private
    ipaddress.ip_network('192.168.0.0/16'),     # private
    ipaddress.ip_network('127.0.0.0/8'),        # loopback
]

def validate_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise ValueError("Only HTTP(S) allowed")
    if parsed.hostname not in ALLOWED_DOMAINS:
        raise ValueError("Domain not allowed")
    # Resolve and check IP to prevent DNS rebinding
    ip = ipaddress.ip_address(socket.gethostbyname(parsed.hostname))
    for blocked in BLOCKED_RANGES:
        if ip in blocked:
            raise ValueError("IP range blocked")
    return url
```

**SSRF prevention rules:**
- Allowlist domains and/or IP ranges — never denylist
- Block `file://`, `gopher://`, `dict://`, `ftp://` schemes
- Resolve DNS and verify IP before making request (prevent DNS rebinding)
- Block cloud metadata endpoints: `169.254.169.254`, `metadata.google.internal`
- Set timeouts on all outbound requests
- Flag any parameter named: `url`, `uri`, `link`, `callback`, `webhook`, `redirect`, `dest`, `target`, `fetch`, `proxy`, `endpoint`

---

## Secure Coding Patterns by Domain

Apply these patterns whenever you write code in the corresponding domain.

### Database Access

```python
# ✅ Always parameterized — never string concatenation
cursor.execute("SELECT * FROM users WHERE email = %s", [email])

# ✅ ORM with ownership filter
orders = Order.objects.filter(user=request.user, status='active')

# ✅ Bulk operations — not loops
User.objects.filter(id__in=user_ids).update(active=False)

# ✅ Atomic operations for race-prone logic
from django.db.models import F
Product.objects.filter(id=product_id, stock__gte=quantity).update(
    stock=F('stock') - quantity
)
```

### File Uploads

```typescript
// ✅ Secure file upload handling
import path from 'path';
import crypto from 'crypto';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

function handleUpload(file: Express.Multer.File): string {
  // Validate MIME type (check magic bytes, not just extension)
  if (!ALLOWED_TYPES.has(file.mimetype)) {
    throw new ValidationError('File type not allowed');
  }

  // Validate size
  if (file.size > MAX_SIZE) {
    throw new ValidationError('File too large');
  }

  // Generate random filename — never use user-supplied name
  const ext = path.extname(file.originalname).toLowerCase();
  const safeName = `${crypto.randomUUID()}${ext}`;

  // Store outside web root or on CDN with different domain
  const safePath = path.join(UPLOAD_DIR, safeName);

  // Verify no path traversal
  if (!safePath.startsWith(UPLOAD_DIR)) {
    throw new ValidationError('Invalid file path');
  }

  return safePath;
}
```

### Redirects

```typescript
// ✅ Safe redirect — relative URLs only, or strict allowlist
function safeRedirect(req: Request, res: Response) {
  const next = req.query.next as string || '/';
  const url = new URL(next, `${req.protocol}://${req.hostname}`);

  // Only allow same-origin redirects
  if (url.origin !== `${req.protocol}://${req.hostname}`) {
    return res.redirect('/');
  }
  return res.redirect(url.pathname + url.search);
}
```

### Rate Limiting

```typescript
// ✅ Rate limit sensitive endpoints
import rateLimit from 'express-rate-limit';

// Strict limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                     // 10 attempts
  skipSuccessfulRequests: true, // only count failures
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// General API limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 100,                    // 100 requests
  standardHeaders: true,
});
app.use('/api/', apiLimiter);
```

### Idempotency for Critical Operations

```typescript
// ✅ Idempotency key for financial/critical operations
async function processPayment(req: Request, res: Response) {
  const idempotencyKey = req.headers['idempotency-key'] as string;
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header required' });
  }

  // Check if already processed
  const existing = await cache.get(`idempotency:${idempotencyKey}`);
  if (existing) {
    return res.status(200).json(JSON.parse(existing));
  }

  // Process and cache result
  const result = await executePayment(req.body);
  await cache.set(`idempotency:${idempotencyKey}`, JSON.stringify(result), 'EX', 86400);
  return res.status(201).json(result);
}
```

---

## Secure Development Workflow

When building any feature, follow these steps in order:

### Step 1 — Define Security Requirements
Before writing code, determine:
- Data classification (public / internal / confidential / restricted)
- Required authentication level (none / session / MFA / cryptographic)
- Authorization model (RBAC roles, permissions, ownership rules)
- Input boundaries (what's valid, what's not, max sizes)
- Audit requirements (what events must be logged)

### Step 2 — Implement Core Logic with Secure Patterns
- Apply input validation at every boundary (C3)
- Use parameterized queries for all data access
- Apply access control on every endpoint (C1)
- Use secure defaults for all configurations (C5)
- Handle errors safely — fail closed, log internally, return sanitized response

### Step 3 — Add Security Controls
- Rate limiting on sensitive operations (C10)
- CSRF protection on state-changing endpoints
- Security headers on all responses (C8)
- Audit logging for security-relevant events (C9)

### Step 4 — Protect Data
- Encrypt sensitive data at rest (C2)
- Use TLS for all data in transit (C2)
- Hash passwords with Argon2id/bcrypt (C2, C7)
- Manage secrets through vault/KMS, not code (C5)

### Step 5 — Secure Dependencies
- Audit dependencies for CVEs (C6)
- Pin versions, maintain lockfiles (C6)
- Validate at startup that all required secrets exist (C5)

### Step 6 — Test Security
- Unit test access control (unauthorized requests must be rejected)
- Unit test input validation (malformed/malicious input must be rejected)
- Integration test auth flows (login, logout, session expiry, MFA)
- Test error handling (exceptions must not leak sensitive data)
- Test rate limiting (verify limits are enforced)

---

## Anti-Pattern Quick Reference

| Anti-Pattern | Severity | Secure Alternative |
|---|---|---|
| `user.role === "admin"` | High | `user.hasPermission("action:name")` |
| `Model(**request.data)` / spread body | Critical | Explicit field allowlist / DTO |
| `eval()` / `exec()` with any input | Critical | Never use with dynamic input |
| `Math.random()` for tokens | High | `crypto.randomBytes()` / `secrets.token_hex()` |
| `password == stored` string compare | High | `hmac.compare_digest()` / `timingSafeEqual()` |
| Hardcoded secret in source code | Critical | Environment variable + vault |
| `try { ... } catch { }` empty catch | High | Log error + fail closed |
| `SELECT * FROM x WHERE id = ${id}` | Critical | Parameterized query |
| `origin: '*'` with credentials | High | Explicit origin allowlist |
| `innerHTML = userInput` | High | `textContent` or DOMPurify |
| Logging passwords/tokens | High | Redact before logging |
| Sequential IDs exposed in URLs | Medium | UUIDs or opaque identifiers |
| `DEBUG=True` in production | Critical | Separate env-specific configs |
| File upload without type check | High | Magic byte validation + allowlist |
| Redirect without origin check | Medium | Same-origin or allowlist validation |
| `except: pass` / fail-open | Critical | Fail closed — deny on exception |
| Session ID not rotated on login | Medium | Regenerate on auth state change |
| No rate limit on login/signup | High | Rate limiter + exponential backoff |
| Price/discount from client request | Critical | Server-side calculation only |
| `sync_to_async` wrapping ORM loops (Django) | Medium | Async ORM methods (Django 4.1+) |

---

## Output Expectations

When this skill is active, every piece of code you write should:

1. **Have access control** — no unprotected endpoints or resources
2. **Validate all input** — schema validation at every boundary
3. **Use secure defaults** — strict headers, httpOnly cookies, TLS, deny-by-default
4. **Handle errors safely** — no stack traces to users, no fail-open patterns
5. **Protect data** — encryption at rest/transit, secure password hashing, no hardcoded secrets
6. **Log security events** — structured, without sensitive data
7. **Be rate-limited** — sensitive operations protected from abuse
8. **Use safe dependencies** — audited, pinned, maintained

If any of these cannot be satisfied for the current task, explicitly document why and
what compensating control is in place.

---

## Behavior Rules

- **Proactive, not reactive** — embed controls while writing, don't flag them as "TODO: add security later"
- **Every endpoint gets the full stack** — authN + authZ + validation + error handling + logging. No shortcuts.
- **Secure defaults over configuration** — if the user doesn't specify, choose the more secure option.
- **Explain the why once** — when applying a security pattern, briefly explain why (one line). Don't lecture.
- **Don't over-engineer** — apply controls proportional to the data sensitivity and threat level.
- **Chain with security-auditor** — after writing secure code, suggest running `security-auditor` for a post-hoc validation pass.
- **Chain with code-reviewer** — for non-security aspects (performance, maintainability, tests), suggest `code-reviewer`.
- **Read CLAUDE.md first** — project standards may override defaults (e.g., different auth library, custom validation patterns). Honor them.
- **Version-aware** — check framework/runtime versions before applying patterns. Don't use APIs that don't exist in the project's version.
