---
name: code-reviewer-angular
description: >
  Angular/TypeScript-specific code review overlay. Extends the universal code-reviewer
  skill with Angular version-aware rules. Trigger when reviewing Angular components,
  services, directives, pipes, guards, resolvers, NgRx stores/effects, RxJS streams,
  Apollo Angular GraphQL, HttpClient calls, SSR (Angular Universal), or any .ts/.html
  file in an Angular project. Keywords: Angular, standalone, component, NgRx, signal,
  computed, effect, RxJS, Observable, HttpClient, inject(), OnPush, @if, @for, router,
  guard, resolver, lazy loading, Angular Material, SSR, hydration. Do NOT trigger for
  Node.js backend code in the same monorepo (use code-reviewer-node for that) or for
  plain TypeScript utilities with no Angular imports.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Code Reviewer — Angular Overlay

This skill extends `code-reviewer` (the universal skill). Always apply the universal
skill's full checklist first, then apply the Angular-specific rules in this file on top.

**Composition order:**
1. Run `code-reviewer` (universal pillars: correctness, security, performance, DRY, tests, docs)
2. Run this overlay (Angular/TypeScript-specific rules below)
3. Report findings from both in a single unified output

---

## Step 0 — Detect Versions First (always, before reviewing anything)

Run these commands before touching any code. Version determines which rules apply.

```bash
# Angular and CLI version
cat package.json | grep -E '"(@angular/core|@angular/cli|@angular/material|@ngrx|@apollo/client|apollo-angular|typescript|rxjs)"' | head -20

# Check if zoneless is configured
grep -r "provideZoneless\|provideExperimentalZoneless\|zone.js" src/ --include="*.ts" -l 2>/dev/null | head -5

# Check standalone vs module-based
grep -r "NgModule\|standalone:" src/ --include="*.ts" -l 2>/dev/null | head -10

# Check for legacy structural directives still in use
grep -r "\*ngIf\|\*ngFor\|\*ngSwitch" src/ --include="*.html" -l 2>/dev/null | head -5
```

Report at the top of your review:
```
🔍 Environment: Angular vX.Y | TypeScript X.Y | RxJS X.Y
    NgRx: X.Y (if present) | Apollo Angular: X.Y (if present)
    Mode: Standalone / Module-based / Mixed | Zoneless: Yes / No / Not yet
```

Then apply the version-specific rules below.

---

## Angular Version Rules

### Angular 17
- New control flow (`@if`, `@for`, `@switch`) introduced — flag new code still using `*ngIf`/`*ngFor`; suggest migration.
- `standalone: true` is now the default recommended approach — flag new `NgModule`-based components without justification.
- `@for` **requires `track`** — flag any `@for` loop missing `track user.id` (or equivalent stable key). Never `track $index` on mutable lists.
- Deferrable views (`@defer`) available — flag large components that could benefit from deferred loading.
- TypeScript 5.2+ required — flag `tsconfig` targeting lower versions.

### Angular 18
- Signals API **stable** — flag `BehaviorSubject` used for simple local/component state; suggest `signal()`.
- Zoneless change detection available as experimental (`provideExperimentalZonelessChangeDetection`) — don't flag usage, but flag missing `OnPush` on new components regardless.
- esbuild + Vite is the default builder — flag `angular.json` still using webpack (`@angular-devkit/build-angular:browser`) for new projects.
- Angular Material 3 stable — flag Material 2 component APIs that were renamed.

### Angular 19
- **`standalone: true` is the default** — flag `@Component({ standalone: false })` unless the component is intentionally module-based for a documented reason. Flag components declared in `NgModule.declarations` — Angular 19 will throw `NG2007`.
- `httpResource()` available (experimental, 19.2+) — acceptable for component-level data fetching; flag it being used in service layers (keep services using `HttpClient`).
- ⚠️ **EOL May 19, 2026** — flag projects pinned to Angular 19 as High priority. Suggest immediate migration to Angular 20.
- XSS CVE fixed in 19.2.18 (SVG `href`/`xlink:href` bypass) — flag projects on Angular 19 < 19.2.18 as Critical.

### Angular 20+ ✅ Current recommended
- Signals fully stable — `effect()`, `linkedSignal()`, `input()`, `output()`, `model()` all stable.
- **`ngIf`, `ngFor`, `ngSwitch` are deprecated** — flag any new code using structural directives; flag existing code as Medium priority for migration.
- `provideZonelessChangeDetection` (renamed from `provideExperimentalZonelessChangeDetection`) — flag old name as breaking in 20.
- TypeScript 5.8+ required, Node 20+ required — flag `package.json` engines or `tsconfig.json` targeting lower versions.
- View Engine metadata completely removed — flag any library dependency still referencing View Engine.

**Upcoming (Angular 21):**
- Signal Forms expected — once available, flag `FormGroup`/`FormControl` in new Angular 21+ projects; suggest Signal Forms.

---

## Angular-Specific Review Checklist

### 🏗️ Components

- **`OnPush` change detection** — flag every component missing `changeDetection: ChangeDetectionStrategy.OnPush`. This is non-negotiable for performance-conscious teams.
  ```ts
  // ❌ Default change detection — scans entire tree
  @Component({ selector: 'app-user' })

  // ✅ OnPush — only updates when inputs change or signals notify
  @Component({
    selector: 'app-user',
    changeDetection: ChangeDetectionStrategy.OnPush,
  })
  ```

- **`inject()` function** — flag constructor injection in new code; use `inject()` exclusively:
  ```ts
  // ❌ Constructor injection (legacy)
  constructor(private readonly userService: UserService) {}

  // ✅ inject() function
  private readonly userService = inject(UserService);
  ```

- **Signal inputs/outputs (v17.1+)** — flag `@Input()`/`@Output()` + `EventEmitter` in new components on Angular 17+; prefer `input()`, `output()`, `model()`:
  ```ts
  // ❌ Legacy decorator inputs
  @Input({ required: true }) user!: User;
  @Output() selected = new EventEmitter<User>();

  // ✅ Signal-based
  readonly user = input.required<User>();
  readonly selected = output<User>();
  ```

- **`subscribe()` in components** — flag direct `.subscribe()` calls in component code; use `toSignal()` or `async` pipe instead:
  ```ts
  // ❌ Manual subscription — memory leak risk
  ngOnInit() {
    this.userService.getUser().subscribe(u => this.user = u);
  }

  // ✅ toSignal — auto-cleaned up
  readonly user = toSignal(this.userService.getUser());
  ```

- **`@for` track** — flag `@for` loops missing a stable `track` expression:
  ```html
  <!-- ❌ Missing track — full DOM re-render on any change -->
  @for (user of users()) {
    <app-user-card [user]="user" />
  }

  <!-- ✅ Stable key -->
  @for (user of users(); track user.id) {
    <app-user-card [user]="user" />
  }
  ```

- **Template safety** — flag `[innerHTML]` bindings without `DomSanitizer`. Flag `bypassSecurityTrustHtml()` / `bypassSecurityTrustUrl()` without documented justification — these bypass Angular's XSS protection.

- **`CommonModule` imports** — flag `CommonModule` in standalone component imports; use specific imports (`NgIf`, `NgFor`, `AsyncPipe`) or preferably the new control flow syntax instead.

- **NgModule in new features** — flag new `NgModule` creation on Angular 17+; all new code should be standalone.

### ⚡ Signals

- **`signal()` for local state** — flag `BehaviorSubject` used for component or feature-local state where `signal()` would suffice.

- **`computed()` for derived state** — flag computed values re-derived manually in multiple places; extract to `computed()`:
  ```ts
  // ❌ Manual derivation, duplicated
  get activeUsers() { return this.users().filter(u => u.active); }

  // ✅ computed — memoized, reactive
  readonly activeUsers = computed(() => this.users().filter(u => u.active));
  ```

- **`effect()` side effects** — flag `effect()` used to derive or transform state (that's `computed()`'s job). `effect()` is for side effects only (logging, localStorage, external calls).

- **`signal.asReadonly()`** — flag writable signals exposed publicly from services; expose `asReadonly()`:
  ```ts
  // ❌ Writable signal leaked — consumers can mutate
  readonly users = signal<User[]>([]);

  // ✅ Expose read-only; mutate only through service methods
  private readonly _users = signal<User[]>([]);
  readonly users = this._users.asReadonly();
  ```

- **`toSignal()` with `initialValue`** — flag `toSignal()` calls on Observables that may not emit immediately without an `initialValue` or `{ requireSync: true }` — results in `undefined` signal until first emission.

- **`linkedSignal()` (v19+)** — flag complex `computed()` + `effect()` combinations that reset a signal when another changes; `linkedSignal()` is the cleaner pattern.

### 🔁 RxJS

**Rule of thumb: RxJS for async/events, Signals for state. Convert at component boundary with `toSignal()`.**

- **Unsubscribed observables** — flag `.subscribe()` without cleanup. Acceptable patterns: `takeUntilDestroyed()`, `async` pipe, `toSignal()`. Flag `ngOnDestroy` + manual `Subscription` arrays in new code — use `takeUntilDestroyed(this.destroyRef)` instead:
  ```ts
  // ❌ Manual unsubscribe boilerplate
  private sub = new Subscription();
  ngOnInit() { this.sub.add(obs$.subscribe(...)); }
  ngOnDestroy() { this.sub.unsubscribe(); }

  // ✅ takeUntilDestroyed
  obs$.pipe(takeUntilDestroyed()).subscribe(...);
  ```

- **`switchMap` for cancellable requests** — flag `mergeMap` or `concatMap` on search/autocomplete streams where only the latest result matters.

- **Error handling** — flag Observable chains missing `catchError` — unhandled errors complete the stream and break the UI.

- **`BehaviorSubject` as state** — flag `BehaviorSubject` used for state that is: (a) local to a component, (b) synchronous, (c) not shared across features. Replace with `signal()`.

- **Nested subscriptions** — flag `.subscribe()` inside another `.subscribe()` — use `switchMap`, `mergeMap`, or `combineLatest` instead.

### 🗺️ Routing & Lazy Loading

- **Lazy loading** — flag `loadComponent` / `loadChildren` not used for feature routes. Every feature route should be lazy-loaded:
  ```ts
  // ❌ Eager — entire module loaded upfront
  { path: 'users', component: UsersComponent }

  // ✅ Lazy — loaded on demand
  { path: 'users', loadComponent: () => import('./users/users.component') }
  ```

- **Functional guards** — flag class-based `CanActivate` / `CanDeactivate` guards in Angular 15+ projects; use functional guards:
  ```ts
  // ❌ Class-based guard (legacy)
  @Injectable()
  export class AuthGuard implements CanActivate { ... }

  // ✅ Functional guard
  export const authGuard: CanActivateFn = (route, state) => {
    return inject(AuthService).isAuthenticated()
      ? true
      : inject(Router).createUrlTree(['/login']);
  };
  ```

- **`input.fromRoute()` (v17.1+)** — flag components using `ActivatedRoute.snapshot.params` or `paramMap` subscriptions; prefer `input.fromRoute()` where route inputs are enabled.

- **`withComponentInputBinding()`** — flag projects not enabling route component input binding in `provideRouter()` — required for `input.fromRoute()` to work.

- **Route prefetching** — flag critical user flows without `prefetch` strategy on lazy routes.

### 🌐 HttpClient & REST

- **Services, not components** — flag `HttpClient` injected directly in a component; all HTTP calls belong in services.

- **`httpResource()` (v19.2+)** — acceptable for component-level reactive data fetching. Flag it inside services (use `HttpClient` there).

- **Error handling** — flag HTTP calls without `catchError` or error state handling in the UI.

- **Typed HTTP responses** — flag `http.get('/api/users')` without a type parameter; always use `http.get<User[]>('/api/users')`.

- **Interceptors** — flag class-based `HttpInterceptor` in Angular 15+ projects; use functional interceptors:
  ```ts
  // ✅ Functional interceptor
  export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const token = inject(AuthService).getToken();
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  };
  ```

- **Retry logic** — flag API calls that should retry on transient failures (network errors) without `retry()` or `retryWhen()`.

### 🔐 Authentication (JWT / OAuth / Guards)

- **Route guards** — flag protected routes missing `canActivate` with an auth guard.
- **Token storage** — flag JWT stored in `localStorage`; prefer `httpOnly` cookies or `sessionStorage` with XSS mitigations.
- **Token refresh** — flag implementations that don't handle `401` responses with token refresh logic in an interceptor.
- **`isAuthenticated` as signal** — flag auth state exposed as Observable where `signal()` + `toSignal()` would be cleaner for template consumption.
- **Role-based access** — flag guards checking only authentication, not authorization (roles/permissions) for admin or privileged routes.
- **OAuth `state` parameter** — flag OAuth redirect flows missing CSRF state validation.

### 📦 NgRx

- **Tiered state rule** — flag NgRx used for purely local component state; use `signal()` instead. NgRx is for: global state, cross-feature shared data, and complex side effects.

- **NgRx Signal Store (v17+)** — flag class-based `@ngrx/store` for new features in modern Angular apps; prefer `signalStore()`:
  ```ts
  // ✅ NgRx Signal Store pattern
  export const UsersStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withComputed(({ users }) => ({
      activeUsers: computed(() => users().filter(u => u.active))
    })),
    withMethods((store, usersService = inject(UsersService)) => ({
      loadUsers: rxMethod<void>(
        pipe(
          switchMap(() => usersService.getAll()),
          tapResponse({
            next: users => patchState(store, { users }),
            error: console.error
          })
        )
      )
    }))
  );
  ```

- **Effects** — flag side effects (HTTP calls, routing, notifications) placed directly in reducers or components; use NgRx Effects or `withMethods` + `rxMethod`.
- **Selectors** — flag repeated `store.select()` calls for the same data; extract to reusable selectors.
- **`patchState`** — flag direct state mutation attempts; always use `patchState()` in Signal Store methods.

### 🎨 Angular Material

- **Theming** — flag direct color values in component styles that should use Material theme tokens.
- **`MatFormFieldModule`** — flag form fields missing proper `appearance` attribute.
- **Accessibility** — flag `mat-icon` buttons missing `matTooltip` or `aria-label`.
- **Module vs standalone imports** — flag importing entire `MatButtonModule` where only `MatButton` directive is needed (standalone tree-shaking).

### 🖥️ Angular Universal / SSR

- **`isPlatformBrowser()`** — flag direct `window`, `document`, or `localStorage` access without platform check; these crash during SSR:
  ```ts
  // ❌ Crashes on server
  ngOnInit() { localStorage.setItem('key', 'value'); }

  // ✅ Platform-safe
  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('key', 'value');
    }
  }
  ```

- **`afterNextRender()` / `afterRender()`** — flag `ngAfterViewInit` used for browser-only DOM operations in SSR apps; use `afterNextRender()` (runs only in browser).

- **`TransferState`** — flag SSR apps making the same HTTP request on both server and client; use `TransferState` or `httpResource()` to cache server-fetched data.

- **Incremental hydration (v19+)** — flag large, below-the-fold components not using `@defer` with hydration triggers.

- **Event replay** — flag SSR apps on v18+ not enabling `withEventReplay()` in `provideClientHydration()` — user interactions before hydration are lost.

### 🔵 GraphQL / Apollo Angular (if present)

- **Typed queries** — flag Apollo `useQuery` / `gql` calls without generated TypeScript types; use `graphql-codegen`.
- **`watchQuery` vs `query`** — flag `query()` used where the UI needs live cache updates; use `watchQuery()`.
- **Loading/error states** — flag components using Apollo without handling `loading` and `error` states in the template.
- **`fetchPolicy`** — flag missing `fetchPolicy` on queries where stale data is a concern.
- **Mutations and cache** — flag mutations not updating the Apollo cache (`update` function or `refetchQueries`) when they modify list data.

---

## Anti-Patterns Quick Reference

Flag these immediately when spotted:

| Anti-pattern | Severity | Fix |
|---|---|---|
| `*ngIf` / `*ngFor` in new code (v17+) | Medium | Use `@if` / `@for` |
| `@for` without `track` | High | Add `track item.id` |
| `subscribe()` in component body | High | Use `toSignal()` or `async` pipe |
| Constructor injection | Low | Use `inject()` |
| `@Input()` / `@Output()` in new code (v17.1+) | Low | Use `input()` / `output()` |
| `BehaviorSubject` for local state | Medium | Use `signal()` |
| `effect()` for state derivation | High | Use `computed()` |
| Writable `signal` exposed from service | Medium | Use `.asReadonly()` |
| `NgModule` for new features (v17+) | Medium | Use standalone components |
| `CommonModule` in standalone imports | Low | Import specific directives |
| Direct `window`/`document` in SSR app | Critical | Use `isPlatformBrowser()` |
| HTTP call in component | Medium | Move to service |
| `[innerHTML]` without sanitizer | Critical | Use `DomSanitizer` or restructure |
| Missing `OnPush` | Medium | Add `ChangeDetectionStrategy.OnPush` |
| Nested `.subscribe()` | High | Use `switchMap`/`combineLatest` |
| Unsubscribed observable | High | Use `takeUntilDestroyed()` |
| Angular 19 < 19.2.18 | Critical | Update — XSS CVE |
| Angular 19 (EOL May 2026) | High | Migrate to Angular 20 |

---

## Unified Output Format

Use the same format as `code-reviewer` (universal). Add an Angular context line:

```
🔍 Environment: Angular v20.x | TypeScript 5.8 | RxJS 7.x
    NgRx Signal Store: v19.x | Apollo Angular: N/A
    Mode: Standalone | Zoneless: Developer Preview enabled

## Code Review Summary
[... standard universal format ...]

### 🅰️ Angular-Specific Issues
[Issues found by this overlay, using the same severity/format as universal]
```

---

## Behavior Rules (Angular-specific additions)

- **Version first, always** — never apply version rules without detecting Angular version. Angular 19 EOL and XSS CVE are Critical-level findings.
- **Signals-first mindset for state, RxJS for streams** — don't flag RxJS in service layers; do flag RxJS `BehaviorSubject` replacing `signal()` in component state.
- **`OnPush` is always required** — no exceptions for new components regardless of version.
- **SSR is high-risk** — `window`/`document`/`localStorage` without platform guard is always Critical in SSR projects.
- **Don't refactor working NgRx to Signals** — if existing class-based NgRx works, flag as Low/suggestion only; don't gate a PR on it.
- **Delegate deep security audits** → `security-auditor` skill if available.
