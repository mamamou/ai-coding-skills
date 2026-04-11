---
name: react-security
description: >
  React frontend security best practices for building secure, production-grade
  applications. Use when writing or reviewing security-sensitive React code,
  configuring authentication, handling user input, setting up CSP, securing
  Server Components/Actions, or hardening a React/Next.js application.
  Covers OWASP 2025, XSS prevention, CSRF, auth patterns, token storage,
  Server Components security (CVE-2025-55182), Next.js middleware/proxy
  hardening, supply chain security, CSP with Vite 6/Next.js 16, Zustand/
  TanStack Query security, DOMPurify sanitization, and deployment hardening.
  Keywords: React security, XSS, CSRF, CSP, authentication, authorization,
  Server Actions, Server Components, OWASP, supply chain, npm audit,
  DOMPurify, Content-Security-Policy, HttpOnly cookies.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# React Frontend Security Best Practices (2026)

A comprehensive guide for building secure, production-grade React applications. Covers **React 19**, **Next.js 16**, **Vite 6**, and aligns with **OWASP Top 10:2025**.

---

## 1. Authentication & Session Management

### Requirements

- **Token storage**: Store access tokens in memory (React state/context) or HttpOnly cookies — NEVER in localStorage/sessionStorage
- **Refresh tokens**: Store in HttpOnly, Secure, SameSite cookies
- **Token expiration**: Implement automatic server-side refresh before expiration
- **Logout**: Clear all tokens, call backend invalidation, redirect to login
- **Session timeout**: Implement inactivity timeout with warning before logout
- **Multi-tab sync**: Synchronize auth state across browser tabs (BroadcastChannel API)
- **Token injection**: Automatically inject tokens via interceptors
- **Secure redirects**: Validate redirect URLs to prevent open redirect vulnerabilities

### Auth Libraries (2026)

| Library                | Status                      | Best for                                                 |
| ---------------------- | --------------------------- | -------------------------------------------------------- |
| **Better Auth**        | Active, recommended         | New projects — TypeScript-first, plugin system, SSO/SAML |
| **Clerk**              | Active, hosted              | Pre-built UI, managed backend, free up to 10K MAU        |
| **Auth.js (NextAuth)** | Maintenance mode            | Existing projects only — security patches only           |
| **Lucia Auth**         | **Deprecated** (March 2025) | Do not use — plan migration                              |

### React Pattern

```typescript
// Store tokens in memory only
const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);

  return (
    <AuthContext.Provider value={{ accessToken, setAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
};

// Token injection via interceptor
api.interceptors.request.use((config) => {
  const token = getAccessToken(); // from memory/context
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401 with token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await refreshAccessToken();
      return api.request(error.config);
    }
    return Promise.reject(error);
  }
);
```

### What NOT to Do

- Store tokens in localStorage or sessionStorage (vulnerable to XSS)
- Store sensitive data in cookies without HttpOnly flag
- Include tokens in URL parameters
- Keep users logged in indefinitely without re-authentication

---

## 2. Server Components & Server Actions Security

### Critical: CVE-2025-55182 — "React2Shell" (CVSS 10.0)

An unauthenticated **remote code execution** vulnerability in React Server Components' Flight protocol. Affected all RSC frameworks (Next.js, React Router, Waku, etc.). Insecure deserialization allowed arbitrary server-side code execution via a single crafted HTTP request.

**Affected**: `react-server-dom-webpack`, `react-server-dom-parcel`, `react-server-dom-turbopack` (React 19.0–19.2.0). Apps were vulnerable even without directly implementing Server Functions.

**Fix**: Update to React 19.0.4+, 19.1.5+, or 19.2.4+.

### Securing Server Actions

Server Actions are **public HTTP endpoints**. Treat them as API routes:

```typescript
"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";

const updateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export async function updateUser(formData: FormData) {
  // 1. Always authenticate
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  // 2. Always validate input
  const parsed = updateUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) throw new Error("Invalid input");

  // 3. Always authorize
  if (session.user.id !== formData.get("userId")) {
    throw new Error("Forbidden");
  }

  // 4. Perform the operation
  await db.user.update({ where: { id: session.user.id }, data: parsed.data });
}
```

### Server Components Rules

- **Never pass sensitive data** from Server to Client Components via props — it appears in the serialized Flight payload
- **Never rely on client-side checks alone** — always enforce authorization server-side
- Keep React and framework versions patched immediately
- Use typed validation (Zod) for all Server Action inputs
- Consider `next-safe-action` for type-safe Server Actions with built-in validation

---

## 3. Next.js Security Hardening

### Middleware/Proxy Authorization Bypass (CVE-2025-29927, CVSS 9.1)

Attackers could bypass all middleware by sending an `x-middleware-subrequest` header. Fixed in Next.js 15.2.3+.

### Next.js 16 Changes

- **`middleware.ts` renamed to `proxy.ts`** — clarifies this is a network boundary, NOT a security boundary
- **Auth must live in Route Handlers, Server Actions, and the Data Access Layer** — never rely solely on proxy for authorization
- **`"use cache"` directive** — include user-bound arguments; call `updateTag()` after auth/role mutations to avoid stale cached permissions

### CSP in Next.js 16

```typescript
// proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'nonce-${nonce}';
    img-src 'self' data: https:;
    font-src 'self';
    connect-src 'self' https://api.yourdomain.com;
    frame-ancestors 'none';
    base-uri 'self';
    form-action 'self';
  `.replace(/\n/g, "");

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", cspHeader);
  response.headers.set("x-nonce", nonce);
  return response;
}
```

Next.js automatically extracts the nonce during rendering and applies it to script/style tags.

---

## 4. Route Protection & Authorization

### Requirements

- Protect routes that require authentication
- Implement role/permission-based access
- Ensure guards check before lazy-loaded modules
- Redirect to login with return URL for protected routes
- Component-level guards for sensitive UI within public routes

### React Pattern (React Router v7 / TanStack Router)

```typescript
const ProtectedRoute = ({
  children,
  requiredRole,
}: {
  children: ReactNode;
  requiredRole?: string;
}) => {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRole && !user.roles.includes(requiredRole)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
```

**Important**: Client-side route guards are UX convenience only. **Always enforce authorization on the server** (in Server Actions, API routes, or data access layer).

---

## 5. Input Validation & Sanitization

### Requirements

- Validate all user inputs on the client (UX) AND server (security boundary)
- Sanitize all user-generated content before rendering
- Use schema validation (Zod) for type-safe validation
- Validate file types, sizes, and names before upload
- Validate and sanitize URLs to prevent `javascript:` protocol injection
- Never execute user input as code (`eval()`, `Function()`)

### Sanitization

```typescript
import DOMPurify from "dompurify";
import { z } from "zod";

// Schema validation
const userSchema = z.object({
  email: z.string().email(),
  age: z.number().min(18).max(120),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
});

// Sanitize HTML content — encapsulate in a reusable component
function SafeHTML({ html }: { html: string }) {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "i", "em", "strong", "a"],
    ALLOWED_ATTR: ["href"],
  });
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

// File upload validation
function validateFile(file: File): boolean {
  const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (!allowedTypes.includes(file.type)) throw new Error("Invalid file type");
  if (file.size > maxSize) throw new Error("File too large");
  return true;
}
```

### Safer Alternatives to `dangerouslySetInnerHTML`

- **`react-markdown`** — converts Markdown to React components without innerHTML; inherently XSS-safe
- **`html-react-parser`** — parses HTML into JSX elements (still sanitize input first)
- **Best practice**: Flag raw `dangerouslySetInnerHTML` in code scanning; always pair with DOMPurify

### Built-in Protection

React **auto-escapes** values in JSX by default — `{userInput}` is safe. The risk is only with `dangerouslySetInnerHTML` or when constructing HTML strings manually.

---

## 6. Cross-Site Scripting (XSS) Prevention

### Content Security Policy (CSP)

#### Vite 6 (SPA)

Vite has no built-in nonce support. Configure CSP through your server/hosting layer:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.yourdomain.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

#### Next.js 16

Use nonce-based CSP generated per-request in `proxy.ts` (see Section 3).

#### Tailwind v4

Tailwind v4 generates styles at build time (CSS file output) — compatible with `style-src` hash or nonce. No inline styles by default, which simplifies CSP.

### React Patterns

```typescript
// ❌ BAD — raw user input
<div dangerouslySetInnerHTML={{ __html: userInput }} />

// ✅ GOOD — sanitized
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userInput) }} />

// ✅ BETTER — avoid dangerouslySetInnerHTML entirely
<div>{userInput}</div>  // React auto-escapes
```

### Development vs Production

- Development may require `'unsafe-eval'` (React debugging tools)
- Production should **never** need `'unsafe-eval'`

---

## 7. Cross-Site Request Forgery (CSRF) Protection

### Requirements

- Use CSRF tokens for state-changing operations
- Set SameSite=Strict or Lax on cookies
- Validate Origin and Referer headers on backend
- Add custom headers (`X-Requested-With`) to AJAX requests
- Never use GET for state-changing operations

### React Pattern

```typescript
// Configure CSRF in axios
axios.defaults.xsrfCookieName = "csrftoken";
axios.defaults.xsrfHeaderName = "X-CSRFToken";
axios.defaults.headers.common["X-Requested-With"] = "XMLHttpRequest";
```

### Next.js Server Actions

Server Actions use POST and automatically compare `Origin` vs `Host` headers. SameSite cookies provide the default CSRF protection.

---

## 8. Secure Data Handling & Storage

### Rules

- **Never** store passwords, tokens, or PII in localStorage/sessionStorage
- Store sensitive data in memory (React state/context) only
- Clear all stored data on logout
- Mask sensitive data (credit cards, SSNs) in UI
- Never log sensitive data to console in production
- Don't expose sensitive data in error messages

### Data Masking

```typescript
const maskCreditCard = (cc: string): string => cc.replace(/\d(?=\d{4})/g, "*");
// "1234567890123456" → "************3456"

const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
};
// "user@example.com" → "us***@example.com"
```

---

## 9. API Communication Security

### Requirements

- **HTTPS only** — never make requests over HTTP
- **Request cancellation** — use `AbortController` (axios `CancelToken` is deprecated)
- **Timeouts** — set appropriate timeouts for all requests
- **Response validation** — validate API response schema before using data
- **Error handling** — handle errors gracefully without exposing internals

### Request Cancellation (AbortController)

```typescript
useEffect(() => {
  const controller = new AbortController();

  api
    .get("/users", { signal: controller.signal })
    .then(({ data }) => setUsers(data))
    .catch((err) => {
      if (!axios.isCancel(err)) throw err; // Ignore cancellation
    });

  return () => controller.abort();
}, []);
```

### Response Validation

```typescript
import { z } from "zod";

const responseSchema = z.object({
  success: z.boolean(),
  data: z.object({ id: z.string(), name: z.string() }),
});

api.interceptors.response.use((response) => {
  const validated = responseSchema.parse(response.data);
  return { ...response, data: validated };
});
```

---

## 10. Supply Chain Security

### Critical: OWASP 2025 — A03: Software Supply Chain Failures (NEW)

Supply chain attacks are now a top-3 OWASP category. The npm ecosystem has seen major incidents:

| Date     | Incident                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------- |
| Sep 2025 | CISA alert: 18 popular npm packages (chalk, debug, ansi-styles) compromised via maintainer phishing |
| Nov 2025 | Self-replicating npm worm: 796 packages, 132M monthly downloads                                     |
| Jan 2026 | "PackageGate": 6 zero-days across npm, pnpm, vlt, Bun undermining lockfile trust                    |

### Vite-Specific Threats

- **CVE-2025-31125** (actively exploited): Arbitrary file read via manipulated query parameters in Vite dev server
- **CVE-2025-30208**: `@fs` path traversal bypass
- Malicious Vite plugins undetected for 2+ years (6,200+ downloads)

### Defense Strategies

- **Commit lockfiles** to version control — always
- **Pin exact versions** in production dependencies
- **pnpm v10**: Disables automatic `postinstall` scripts; use `allowBuilds` to whitelist trusted packages
- **7-14 day adoption delay** for new packages/major updates
- **Tools**: Socket.dev (real-time threat detection), Snyk, npm audit
- **Audit regularly**: `npm audit` / `pnpm audit` in CI
- **SRI for CDN resources**:

```html
<script
  src="https://cdn.example.com/library.js"
  integrity="sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/ux..."
  crossorigin="anonymous"
></script>
```

---

## 11. State Management Security

### Zustand

- **DevTools**: `devtools` middleware must be explicitly disabled in production

```typescript
import { devtools } from "zustand/middleware";

const useStore = create(
  process.env.NODE_ENV === "development" ? devtools(storeImpl) : storeImpl,
);
```

- **Never store server data in Zustand** — TanStack Query handles caching
- **Never persist auth tokens via Zustand** — use HttpOnly cookies
- If persisting to localStorage: encrypt with CryptoJS; clear on logout

### TanStack Query

- DevTools are **automatically excluded** from production bundles (safe by default)
- DevTools accept a `nonce` prop for strict CSP environments
- **Persistence** (localStorage/sessionStorage persisters): Be aware cached API responses may contain sensitive data; clear on logout
- Disable DevTools in staging: `process.env.NODE_ENV` check or `enabled: false`

---

## 12. Secure Build & Deployment

### Environment Variables

```bash
# .env — never commit secrets
VITE_API_URL=https://api.example.com
# Don't prefix secrets with VITE_ — they get bundled into client code
```

### Vite 6 Production Config

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    sourcemap: false, // Disable in production
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
  },
});
```

### Rules

- Disable source maps in production (or restrict access via server config)
- Never commit secrets to the repository
- Inject secrets at build time via CI/CD
- Remove console.log in production builds
- Use immutable deployments with rollback capability

---

## 13. Security Headers

Configure at the **server/CDN level** (not in the app):

```
Content-Security-Policy: [see sections 3 and 6]
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Note**: Setting security headers via `<meta>` tags (react-helmet) is a fallback — server-side headers are more reliable and harder to bypass.

---

## 14. Error Handling & Logging

### Requirements

- Implement error boundaries to catch rendering errors
- Display user-friendly error messages — never expose stack traces
- Log errors to monitoring service (Sentry) — never log passwords, tokens, or PII
- Remove console.log in production

### React Pattern

```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  beforeSend(event) {
    // Filter sensitive data before sending
    if (event.user) delete event.user.email;
    return event;
  },
});

// Error boundary (use Sentry.ErrorBoundary or custom)
<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
  <App />
</Sentry.ErrorBoundary>
```

---

## 15. Testing Security

### Tools

| Layer             | Tool                                  |
| ----------------- | ------------------------------------- |
| Unit/Component    | **Vitest** + React Testing Library    |
| Security scanning | **Socket.dev**, **Snyk**, `npm audit` |
| E2E               | **Playwright**                        |
| Accessibility     | **axe-core**                          |
| Performance       | **Lighthouse**                        |

### Security Test Examples

```typescript
import { render } from "@testing-library/react";
import DOMPurify from "dompurify";

test("sanitizes XSS attempt", () => {
  const malicious = '<img src=x onerror=alert("XSS")>';
  const { container } = render(
    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(malicious) }} />
  );
  expect(container.querySelector("img")).not.toHaveAttribute("onerror");
});

test("protected route redirects unauthenticated users", () => {
  render(<ProtectedRoute><Dashboard /></ProtectedRoute>);
  expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
});
```

---

## 16. Monitoring & Incident Response

- **Error monitoring**: Sentry, Bugsnag, or LogRocket
- **Performance**: Track Core Web Vitals (INP, LCP, CLS)
- **Security events**: Track failed auth attempts, unauthorized access
- **Analytics**: Privacy-respecting options (Plausible, Fathom)
- **Alerts**: Set up alerts for critical errors and security events
- **Incident response plan**: Document procedures for security incidents

---

## 17. Compliance & Privacy

Where applicable:

- **GDPR**: Cookie consent, data deletion, data export, data minimization
- **CCPA/CPRA**: California privacy law requirements
- **Cookie consent**: Display and manage consent banner; honor preferences
- **Analytics opt-out**: Provide opt-out for tracking
- **Third-party scripts**: Disclose and manage trackers

---

## 18. OWASP Top 10:2025 — React Relevance

| Rank    | Category                                     | React Relevance                                                                                   |
| ------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **A01** | Broken Access Control                        | **High** — client-side guards are UX only; enforce on server                                      |
| **A02** | Security Misconfiguration                    | **High** — CSP, CORS, debug modes in prod                                                         |
| **A03** | **Supply Chain Failures** (NEW)              | **Critical** — npm ecosystem attacks                                                              |
| **A04** | Cryptographic Failures                       | Medium — token handling, HTTPS                                                                    |
| **A05** | Injection                                    | Lower for React (JSX auto-escapes) — still risk with `dangerouslySetInnerHTML` and Server Actions |
| **A06** | Insecure Design                              | Medium — threat modeling for RSC architecture                                                     |
| **A07** | Auth Failures                                | High — see Section 1                                                                              |
| **A08** | Software & Data Integrity                    | High — CI/CD pipeline security                                                                    |
| **A09** | Logging & Alerting Failures                  | Medium — client-side error reporting                                                              |
| **A10** | **Mishandling Exceptional Conditions** (NEW) | Medium — error boundaries, fail closed                                                            |

---

## Security Checklist

Before deploying to production:

### Authentication & Authorization

- [ ] Tokens stored in memory or HttpOnly cookies, not localStorage
- [ ] Refresh tokens in HttpOnly, Secure, SameSite cookies
- [ ] Route guards + server-side authorization enforcement
- [ ] Session timeout with inactivity detection
- [ ] React and framework versions patched (React2Shell fix)

### Server Components / Actions

- [ ] All Server Actions validate input (Zod)
- [ ] All Server Actions check authentication and authorization
- [ ] No sensitive data leaked via Server-to-Client props
- [ ] React ≥ 19.0.4 / 19.1.5 / 19.2.4

### Input & Output

- [ ] All user inputs validated with schemas
- [ ] HTML sanitized with DOMPurify
- [ ] File uploads validated (type, size, name)
- [ ] No eval() or Function() constructor
- [ ] No raw dangerouslySetInnerHTML

### XSS & CSRF

- [ ] CSP configured (nonce-based for Next.js, header-based for Vite)
- [ ] SameSite cookies configured
- [ ] Custom headers on AJAX requests
- [ ] SRI for CDN resources

### Supply Chain

- [ ] Lockfiles committed
- [ ] Dependencies pinned and audited
- [ ] npm audit / Socket.dev in CI
- [ ] Vite patched (CVE-2025-31125)

### Build & Deploy

- [ ] Source maps disabled in production
- [ ] No secrets prefixed with VITE* / NEXT_PUBLIC*
- [ ] console.log removed in production
- [ ] Security headers configured at server/CDN

### State & Data

- [ ] Zustand DevTools disabled in production
- [ ] No sensitive data in localStorage
- [ ] API responses validated before use
- [ ] All stored data cleared on logout

### Monitoring

- [ ] Error monitoring configured (Sentry)
- [ ] Security events tracked
- [ ] Alerts for critical errors
- [ ] Incident response plan documented
