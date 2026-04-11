---
name: angular-security
description: >
  Angular frontend security best practices for building secure, production-grade
  applications. Use when writing or reviewing security-sensitive Angular code,
  configuring authentication, handling user input, setting up CSP, securing
  Angular SSR, or hardening an Angular application. Covers OWASP 2025, XSS
  prevention, DomSanitizer, template injection, CSRF/XSRF, HttpClient security,
  Angular SSR vulnerabilities (CVE-2025-59052), XSRF token leakage
  (CVE-2025-66035), stored XSS via SVG (CVE-2025-66412), AutoCSP, Trusted
  Types, zoneless Angular, functional guards/interceptors, NgRx security,
  supply chain, and deployment hardening. Keywords: Angular security, XSS,
  CSRF, CSP, DomSanitizer, bypassSecurityTrust, template injection, AOT,
  Angular SSR, HttpClient, XSRF, route guards, NgRx, signals, zoneless.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Angular Frontend Security Best Practices (2026)

A comprehensive guide for building secure, production-grade Angular applications. Covers **Angular 19+**, **@angular/ssr**, and aligns with **OWASP Top 10:2025**.

---

## 1. Authentication & Session Management

### Requirements

- **Token storage**: Store access tokens in memory (Angular service), NEVER in localStorage/sessionStorage
- **Refresh tokens**: Store in HttpOnly, Secure, SameSite cookies
- **Token expiration**: Implement automatic server-side refresh before expiration
- **Logout**: Clear all tokens, call backend invalidation, redirect to login
- **Session timeout**: Implement inactivity timeout with warning before logout
- **Multi-tab sync**: Synchronize auth state across browser tabs (BroadcastChannel API)
- **Token injection**: Automatically inject tokens via HttpClient interceptors
- **Secure redirects**: Validate redirect URLs to prevent open redirect vulnerabilities

### Angular Pattern

```typescript
// Store tokens in memory only — never localStorage
@Injectable({ providedIn: "root" })
export class AuthService {
  private accessToken: string | null = null;

  setToken(token: string) {
    this.accessToken = token; // Memory only
  }

  getToken(): string | null {
    return this.accessToken;
  }

  clearToken() {
    this.accessToken = null;
  }
}

// Functional interceptor for token injection (Angular 17+)
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getToken();

  if (token) {
    req = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        return inject(AuthService)
          .refresh()
          .pipe(switchMap(() => next(req)));
      }
      return throwError(() => error);
    }),
  );
};

// Register in app config
provideHttpClient(withInterceptors([authInterceptor]));
```

### What NOT to Do

- Store tokens in localStorage or sessionStorage (vulnerable to XSS)
- Store sensitive data in cookies without HttpOnly flag
- Include tokens in URL parameters
- Keep users logged in indefinitely without re-authentication
- Use class-based `HttpInterceptor` (deprecated — use functional interceptors)

---

## 2. Template Security & XSS Prevention

### Angular's Built-in Sanitization

Angular automatically sanitizes values in templates across **five security contexts**: HTML, Style, URL, Resource URL, and Script. This is the primary XSS defense.

### Critical: AOT vs JIT

- **AOT (default)**: Prevents template injection entirely. Templates compile at build time — user input cannot become template syntax.
- **JIT**: Trusts template code at runtime. If templates are dynamically generated with user input, full XSS is possible.
- **Rule**: NEVER use JIT in production. Ensure `ngJitMode` is `false` in server builds.

### Template Injection Test

If `{{ 7*7 }}` entered as user input renders as `49`, Client-Side Template Injection (CSTI) is present. AOT prevents this; JIT does not.

### DomSanitizer Bypass Methods

Each bypass creates a potential XSS vector. Audit every usage:

```typescript
// ❌ DANGEROUS — bypasses all sanitization
this.sanitizer.bypassSecurityTrustHtml(userInput);

// ✅ SAFE — sanitize first, then bypass
const sanitized = DOMPurify.sanitize(userInput);
this.sanitizer.bypassSecurityTrustHtml(sanitized);

// ✅ BEST — use Angular's auto-sanitization
{
  {
    userInput;
  }
} // Angular auto-escapes in templates
```

When Trusted Types are enforced, bypass calls use the `angular#unsafe-bypass` policy, making them auditable.

### CVE-2025-66412 — Stored XSS via SVG/MathML

Angular's template compiler had an incomplete security schema for SVG animation attributes (`animate`, `set`, `animateMotion`, `animateTransform`) and MathML attributes. Malicious `javascript:` URLs in these attributes bypassed sanitization.

**Fix**: Update to Angular 19.2.17+.

### Rules

- Never concatenate user input into Angular template strings
- Audit all `bypassSecurityTrust*` calls — each is a potential XSS vector
- Use DOMPurify before any bypass call
- Keep Angular patched for SVG/MathML sanitization fixes
- Prefer `[innerHTML]="userContent"` (auto-sanitized) over bypass methods

---

## 3. HttpClient Security

### XSRF Protection (Built-in)

Angular `HttpClient` automatically reads `XSRF-TOKEN` cookie and sets `X-XSRF-TOKEN` header on mutating requests (POST/PUT/DELETE).

```typescript
provideHttpClient(
  withXsrfConfiguration({
    cookieName: "CUSTOM_XSRF_TOKEN",
    headerName: "X-Custom-Xsrf-Header",
  }),
);
```

### Critical: CVE-2025-66035 — XSRF Token Leakage

Protocol-relative URLs (`//evil.com/api`) were incorrectly treated as same-origin, causing Angular to attach XSRF tokens to attacker-controlled domains.

**Fix**: Update to Angular 19.2.16+.

### withFetch() Implications

`withFetch()` switches from `XMLHttpRequest` to the Fetch API:

- Recommended for SSR applications (performance)
- Credentials handling differs: Fetch uses `credentials: "include"` vs XHR's `withCredentials: true`
- CORS behavior has subtle differences — may surface issues in SSR
- Test thoroughly when switching

### Functional vs Class-Based Interceptors

Class-based interceptors (`HttpInterceptor` interface) still work but **functional interceptors via `withInterceptors()` are the modern pattern**:

- More predictable ordering (array order)
- Better tree-shaking
- Security-relevant: interceptor order matters for auth, error handling, and retry logic

### XSSI Protection

Angular auto-strips the `)]}',\n` prefix from JSON responses (XSSI prevention).

### Request Configuration

```typescript
// Configure secure HTTP client
provideHttpClient(
  withInterceptors([authInterceptor, errorInterceptor]),
  withXsrfConfiguration({
    cookieName: "XSRF-TOKEN",
    headerName: "X-XSRF-TOKEN",
  }),
  withFetch(), // For SSR
);
```

---

## 4. Route Protection & Authorization

### Functional Guards (Angular 17+ — class-based deprecated)

```typescript
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(["/login"], {
      queryParams: { returnUrl: state.url },
    });
  }

  const requiredRole = route.data["role"];
  if (requiredRole && !authService.hasRole(requiredRole)) {
    return router.createUrlTree(["/unauthorized"]);
  }

  return true;
};

// Route configuration
{
  path: "admin",
  canActivate: [authGuard],
  data: { role: "admin" },
  loadComponent: () => import("./admin.component"),
}
```

### Important

- Guards are **client-side only** — they are a UX mechanism, NOT a security boundary
- Server-side authorization is mandatory
- Lazy-loaded modules can be fetched by any client regardless of guards
- Put guards at **layout routes** to protect entire sections
- `CanLoad` is deprecated — use `CanMatch` instead

---

## 5. Angular SSR Security (@angular/ssr)

### Critical: CVE-2025-59052 — Cross-Request Data Leakage (CVSS 7.1)

Angular's SSR platform reused a shared global injector across concurrent requests. Under load, **User A's auth tokens, session data, or query results could leak to User B**.

**Fix**: Update to Angular 19.2.17+. `bootstrapApplication` now requires per-request `BootstrapContext`.

### SSRF via Header Injection

Angular's URL reconstruction trusted `Host`, `X-Forwarded-Host`, `X-Forwarded-Port`, `X-Forwarded-Proto`, `X-Forwarded-Prefix` headers without validation. Attackers could steer internal requests and steal Authorization headers.

**Fix**: Configure `allowedHosts` in `angular.json`:

```json
{
  "security": {
    "allowedHosts": ["example.com", "*.example.com"]
  }
}
```

Or via `NG_ALLOWED_HOSTS` environment variable.

### Open Redirect via X-Forwarded-Prefix

Enabled phishing and SEO hijacking. Patched in same advisory.

### SSR Security Rules

- Update to Angular 19.2.17+ (per-request isolation)
- Configure `allowedHosts` to prevent SSRF
- Ensure `ngJitMode: false` in server builds
- Use absolute URLs instead of `req.headers` for URL construction
- Never share state across requests — use per-request services
- If unable to upgrade: disable SSR via server routes or builder options

---

## 6. Content Security Policy (CSP)

### AutoCSP (Angular 19 — Developer Preview)

Angular 19 introduced automatic hash-based Strict CSP generation. Enable in `angular.json`:

```json
{
  "projects": {
    "my-app": {
      "architect": {
        "build": {
          "options": {
            "security": {
              "autoCsp": true
            }
          }
        }
      }
    }
  }
}
```

This generates CSP hashes for inline scripts in `index.html`, preventing unauthorized script execution.

### Zone.js and CSP

Zone.js monkey-patches async APIs, which can conflict with strict CSP policies banning `unsafe-eval`.

**Solution: Go Zoneless**

```typescript
// Angular 19 (experimental)
provideExperimentalZonelessChangeDetection();

// Angular 20+ (stable)
provideZonelessChangeDetection();
```

Benefits:

- Eliminates `unsafe-eval` CSP conflict
- ~20% bundle size reduction
- Clean stack traces (no Zone-specific frames)
- Relies on Signals for change detection

Remove `zone.js` from `polyfills` in `angular.json` (both build and test targets).

### Trusted Types

Configure these policies in your CSP header:

- `angular` — core framework code
- `angular#bundler` — lazy-loaded chunk files
- `angular#unsafe-bypass` — DomSanitizer bypass calls (audit these!)
- `angular#unsafe-jit` — JIT compiler (should NOT appear in production)

### Minimum CSP for Angular

```
default-src 'self';
style-src 'self' 'nonce-{random}';
script-src 'self' 'nonce-{random}';
```

Security headers should be configured at the **server/CDN level**:

```
Content-Security-Policy: [see above]
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

---

## 7. Input Validation & Sanitization

### Requirements

- Validate all user inputs on the client (UX) AND server (security boundary)
- Use Angular Validators + schema validation (Zod) for type-safe validation
- Sanitize all user-generated HTML content
- Validate file types, sizes, and names before upload
- Never execute user input as code

### Angular Pattern

```typescript
import { Validators, FormBuilder } from "@angular/forms";
import DOMPurify from "dompurify";

// Reactive form with validation
this.form = this.fb.group({
  email: ["", [Validators.required, Validators.email]],
  age: ["", [Validators.required, Validators.min(18), Validators.max(120)]],
  username: [
    "",
    [
      Validators.required,
      Validators.minLength(3),
      Validators.maxLength(20),
      Validators.pattern(/^[a-zA-Z0-9_]+$/),
    ],
  ],
});

// Sanitize HTML (pipe)
@Pipe({ name: "safeHtml", standalone: true })
export class SafeHtmlPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(html: string): SafeHtml {
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["b", "i", "em", "strong", "a"],
      ALLOWED_ATTR: ["href"],
    });
    return this.sanitizer.bypassSecurityTrustHtml(sanitized);
  }
}

// Usage in template
<div [innerHTML]="userContent | safeHtml"></div>
```

---

## 8. Signals and Security

Angular Signals (stable in v19) do not introduce new security vulnerabilities:

- **No XSS vector**: Signal values pass through Angular's template sanitization. `{{ mySignal() }}` is sanitized like `{{ myProperty }}`.
- **State exposure risk**: Signals are synchronous. If a `signal()` holds sensitive data (tokens, PII), it's accessible to any code with a reference. Follow principle of least privilege.
- **`computed()` signals**: Lazily evaluated — no stale security state leaking.
- **`effect()` timing**: Runs after change detection. Be cautious about effects that write sensitive data to localStorage.
- **`linkedSignal()`**: Derived writable signals — ensure they don't expose source data to broader scopes.

---

## 9. State Management Security (NgRx)

### DevTools in Production

```typescript
// MUST disable in production
provideStoreDevtools({
  maxAge: 25,
  logOnly: environment.production,
  // Exclude sensitive properties even in dev
  actionSanitizer: (action) => ({
    ...action,
    payload: action.payload?.password
      ? { ...action.payload, password: "***" }
      : action.payload,
  }),
});
```

### SignalStore (@ngrx/signals)

`withDevtools()` has the same exposure concerns — apply production exclusion patterns.

### State Persistence Rules

- Libraries like `ngrx-store-localstorage` persist to localStorage — never store tokens or PII
- Encrypt sensitive data before persisting
- Clear persisted state on logout
- Implement version migration for state structure changes (prevent deserialization attacks)

---

## 10. Supply Chain Security

### Critical Angular CVEs (2025)

| CVE            | Package             | Impact                      | Fix      |
| -------------- | ------------------- | --------------------------- | -------- |
| CVE-2025-66412 | `@angular/compiler` | Stored XSS via SVG/MathML   | 19.2.17+ |
| CVE-2025-66035 | `@angular/common`   | XSRF token leakage          | 19.2.16+ |
| CVE-2025-59052 | `@angular/ssr`      | SSR cross-request data leak | 19.2.17+ |

### esbuild Vulnerability

CVE-2024-23334 affected esbuild <= 0.24.2 (dev server exposed files). Angular CLI uses esbuild internally. Force upgrade:

```json
// package.json
{
  "overrides": {
    "esbuild": ">=0.25.0"
  }
}
```

### Angular-Specific Risks

- **SVG-based XSS**: Malicious SVGs in dependency packages can trigger XSS through Angular's template compiler
- **ng add schematics**: Execute arbitrary code — audit all third-party schematics
- **ng update**: Does not perform security audits — always run `npm audit` after updates
- **Angular EOL**: Aggressive cycle — v18 already EOL. Unsupported versions get no security patches

### Defense Strategies

- Commit lockfiles; pin exact versions in production
- Run `npm audit` / `pnpm audit` in CI
- 7-14 day adoption delay for new packages
- Use Socket.dev, Snyk for real-time threat detection
- SRI for CDN resources

---

## 11. Secure Build & Deployment

### Environment Files — NOT Secret Storage

```typescript
// environment.prod.ts — compiled into the bundle!
export const environment = {
  production: true,
  apiUrl: "https://api.example.com",
  // ❌ NEVER put secrets here — they are bundled into client code
};

// ✅ Use runtime config fetched from server for sensitive values
```

### Angular CLI Build Configuration

```json
// angular.json — production configuration
{
  "configurations": {
    "production": {
      "optimization": true,
      "sourceMap": false,
      "namedChunks": false,
      "extractLicenses": true,
      "outputHashing": "all",
      "security": {
        "autoCsp": true
      }
    }
  }
}
```

### Rules

- **Source maps**: Disable in production. If using Sentry, upload maps then delete from deployment
- **Environment files**: Never contain secrets — use runtime config from server
- **AutoCSP**: Enable for hash-based CSP protection
- **console.log**: Strip in production builds
- Known issue: `ng serve` with esbuild may inject inline source maps even when disabled (angular/angular-cli#31331)

---

## 12. Secure Data Handling

### Rules

- Never store passwords, tokens, or PII in localStorage/sessionStorage
- Store sensitive data in Angular services (memory) only
- Clear all stored data on logout
- Mask sensitive data in UI
- Never log sensitive data to console in production

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

## 13. Error Handling & Logging

```typescript
import * as Sentry from "@sentry/angular";

// Global error handler
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: Error) {
    Sentry.captureException(error);
    // Don't log sensitive data
    console.error("Application error:", error.message);
  }
}

// Register
(provideAppInitializer(() => {
  Sentry.init({
    dsn: environment.sentryDsn,
    beforeSend(event) {
      if (event.user) delete event.user.email;
      return event;
    },
  });
}),
  { provide: ErrorHandler, useClass: GlobalErrorHandler });
```

### Rules

- Implement global error handler
- Display user-friendly messages — never expose stack traces
- Log to monitoring service (Sentry) — never log tokens, passwords, or PII
- Strip console.log in production

---

## 14. Testing Security

### Tools

| Layer             | Tool                                  |
| ----------------- | ------------------------------------- |
| Unit/Component    | **Vitest** or Karma + Jasmine         |
| Security scanning | **Socket.dev**, **Snyk**, `npm audit` |
| E2E               | **Playwright**                        |
| Accessibility     | **axe-core**                          |

### Security Test Examples

```typescript
describe("AuthGuard", () => {
  it("should redirect unauthenticated users to login", () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isAuthenticated: () => false } },
      ],
    });

    const guard = TestBed.runInInjectionContext(() =>
      authGuard({} as any, { url: "/dashboard" } as any),
    );

    expect(guard).toEqual(
      jasmine.objectContaining({ queryParams: { returnUrl: "/dashboard" } }),
    );
  });
});

describe("XSS Prevention", () => {
  it("should sanitize dangerous HTML", () => {
    const malicious = '<img src=x onerror=alert("XSS")>';
    const sanitized = DOMPurify.sanitize(malicious);
    expect(sanitized).not.toContain("onerror");
  });
});
```

---

## 15. OWASP Top 10:2025 — Angular Relevance

| Rank    | Category                                     | Angular Relevance                                                          |
| ------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| **A01** | Broken Access Control                        | **High** — route guards are client-side only; server must enforce          |
| **A02** | Security Misconfiguration                    | **High** — CSP, CORS, JIT in production, debug flags                       |
| **A03** | **Supply Chain Failures** (NEW)              | **Critical** — SVG-based XSS, esbuild CVE, npm attacks                     |
| **A04** | Cryptographic Failures                       | Medium — token handling, HTTPS                                             |
| **A05** | Injection                                    | **Angular-specific** — template injection (CSTI) if JIT; SVG/MathML bypass |
| **A06** | Insecure Design                              | High — SSR shared injector (CVE-2025-59052)                                |
| **A07** | Auth Failures                                | High — see Section 1                                                       |
| **A08** | Software & Data Integrity                    | High — CI/CD, ng add schematics                                            |
| **A09** | Logging & Alerting Failures                  | Medium — client-side error reporting                                       |
| **A10** | **Mishandling Exceptional Conditions** (NEW) | Medium — error handler, fail closed                                        |

---

## 16. Monitoring & Compliance

### Monitoring

- **Error monitoring**: Sentry with Angular integration
- **Performance**: Track Core Web Vitals (INP, LCP, CLS)
- **Security events**: Track failed auth attempts, unauthorized access
- **Alerts**: Set up alerts for critical errors and security events

### Compliance (where applicable)

- **GDPR**: Cookie consent, data deletion, data export
- **CCPA/CPRA**: California privacy law requirements
- **Cookie consent**: Display and manage consent banner
- **Analytics opt-out**: Provide opt-out for tracking

---

## Security Checklist

Before deploying to production:

### Authentication & Authorization

- [ ] Tokens stored in service (memory) or HttpOnly cookies, not localStorage
- [ ] Refresh tokens in HttpOnly, Secure, SameSite cookies
- [ ] Functional route guards + server-side authorization enforcement
- [ ] Session timeout with inactivity detection
- [ ] Functional interceptors for token injection (not class-based)

### Template & XSS

- [ ] AOT compilation (JIT disabled in production)
- [ ] All `bypassSecurityTrust*` calls audited and paired with DOMPurify
- [ ] No user input concatenated into template strings
- [ ] Angular 19.2.17+ (SVG/MathML XSS fix)

### HttpClient & CSRF

- [ ] XSRF configuration set up
- [ ] Angular 19.2.16+ (XSRF token leakage fix)
- [ ] No protocol-relative URLs in API calls
- [ ] Custom headers on requests

### SSR

- [ ] Angular 19.2.17+ (cross-request data leak fix)
- [ ] `allowedHosts` configured
- [ ] Per-request isolation verified
- [ ] `ngJitMode: false` in server builds

### CSP & Trusted Types

- [ ] AutoCSP enabled (Angular 19+)
- [ ] Zoneless change detection (no `unsafe-eval` needed)
- [ ] Trusted Types policies configured
- [ ] Security headers at server/CDN level

### Supply Chain

- [ ] Lockfiles committed
- [ ] Dependencies audited (`npm audit` in CI)
- [ ] esbuild >= 0.25.0
- [ ] Third-party schematics audited before `ng add`

### Build & Deploy

- [ ] Source maps disabled in production
- [ ] No secrets in environment files
- [ ] console.log stripped in production
- [ ] AutoCSP enabled

### State & Data

- [ ] NgRx DevTools disabled in production
- [ ] No sensitive data in localStorage
- [ ] Persisted state encrypted and cleared on logout

### Monitoring

- [ ] Error monitoring configured (Sentry)
- [ ] Security events tracked
- [ ] Alerts for critical errors
- [ ] Incident response plan documented
