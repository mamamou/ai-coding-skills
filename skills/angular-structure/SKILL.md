---
name: angular-structure
description: >
  Angular enterprise architecture guidelines for structuring scalable, production-grade
  applications. Use when scaffolding a new Angular project, reviewing project structure,
  setting up feature slices, choosing state management, configuring data fetching,
  or making architectural decisions in an Angular/TypeScript codebase. Covers folder
  structure, signals, standalone components, new control flow, deferrable views, zoneless
  change detection, NgRx SignalStore, httpResource, functional guards/interceptors,
  typed reactive forms, esbuild + Vite, Vitest, Playwright, Tailwind v4, SSR with
  incremental hydration, and Nx monorepos. Keywords: Angular architecture, project
  structure, feature slices, DDD, enterprise Angular, folder layout, monorepo, Nx,
  signals, standalone, zoneless.
  (updated 2026-03-30)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Angular Enterprise Architecture Guidelines (2026)

Feature-first, enterprise-grade Angular architecture that scales across teams and codebases. Assumes **TypeScript strict**, modern tooling (**esbuild + Vite**, Angular 21+), and emphasizes **feature isolation**, **signals-first reactivity**, **performance**, and **operability**.

---

## 1) High-Level Structure

```
src/
  app/
    app.component.ts              # root component (thin shell)
    app.config.ts                 # application providers
    app.routes.ts                 # top-level route definitions
    core/                         # singleton services, guards, interceptors
      auth/
        auth.service.ts
        auth.guard.ts
        auth.interceptor.ts
      error/
        global-error-handler.ts
      layout/
        header.component.ts
        sidebar.component.ts
        footer.component.ts
    shared/                       # reusable & stateless UI/utilities
      ui/                         # presentational components (buttons, cards, table)
      directives/                 # generic directives
      pipes/                      # generic pipes
      utils/                      # pure TS helpers
      styles/                     # design tokens, mixins, global CSS
    features/                     # domain-driven feature slices
      users/
        user-list/
          user-list.component.ts
        user-detail/
          user-detail.component.ts
        user-form/
          user-form.component.ts
        data-access/
          users.service.ts
          users.store.ts
          users.model.ts
        users.routes.ts
  environments/
    environment.ts
    environment.prod.ts
  assets/
  styles/
    tokens.css
    globals.css
  main.ts                         # app bootstrap
```

**Philosophy**
- Organize by **feature/domain**, not by technical layer.
- Keep **shared** stateless and UI-only; keep **data-access** inside the owning feature.
- Prefer **co-location**: tests, styles, stories next to implementation.
- **Standalone components** are the default — no `NgModule` for new code.

> **Nx Monorepo**: For large orgs, extract features into domain libraries (`packages/products/feat-product-list`, `packages/products/data-access`) and enforce module boundaries via tags (`type:feature`, `type:shared`, `scope:products`).

---

## 2) Core App Wiring

- **Bootstrap**: `app.config.ts` hosts all root providers (`provideRouter`, `provideHttpClient`, `provideZonelessChangeDetection`, etc.).
- **Routing**: Standalone routes in `app.routes.ts` with lazy-loaded feature routes.
- **Layout**: App chrome (header + sidebar + footer) lives in `core/layout/`, not in `shared` or features. Use `<router-outlet />` for content slots.
- **Errors**: Global `ErrorHandler` + error reporting (Sentry, etc.).
- **Runtime config**: Load from `/config.json` or environment files; expose via a typed service.

**Example**
```typescript
// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(
      withInterceptors([authInterceptor, errorInterceptor]),
      withFetch()
    ),
    provideZonelessChangeDetection(),
    provideClientHydration(withEventReplay(), withIncrementalHydration()),
  ],
};
```

```typescript
// main.ts
bootstrapApplication(AppComponent, appConfig);
```

---

## 3) Shared Layer (Stateless & Reusable)

```
shared/
  ui/
    PageHeader/
    DataTable/
    EmptyState/
    Skeleton/
    Button/
    Modal/
  directives/
    click-outside.directive.ts
    autofocus.directive.ts
  pipes/
    date-format.pipe.ts
    truncate.pipe.ts
  utils/
    date.ts
    array.ts
  styles/
    tokens.css
    globals.css
```

**Rules**
- **No data fetching** or business logic here.
- Components are presentational (inputs in, outputs out).
- Keep design-system atoms/molecules here; domain widgets stay inside features.
- Prefer **Angular CDK** primitives for accessible, unstyled components.
- Use `ChangeDetectionStrategy.OnPush` on all shared components.

---

## 4) Feature Slices (DDD-style)

Each feature encapsulates UI, data-access, and local state.

```
features/users/
  users.routes.ts               # lazy-loaded route config for this feature
  user-list/
    user-list.component.ts      # smart: orchestrates data + renders UI
    user-list.component.html
    user-list.component.spec.ts
  user-detail/
    user-detail.component.ts
  user-form/
    user-form.component.ts      # shared between create/edit
  data-access/
    users.service.ts            # HTTP client
    users.store.ts              # NgRx SignalStore
    users.model.ts              # DTOs & ViewModels
    users.adapter.ts            # DTO <-> VM mappings
  testing/
    builders.ts                 # test factories/mocks
```

**Rules**
- **Smart components** (pages) orchestrate state and navigation; **dumb components** render.
- **data-access/** keeps backend specifics (endpoints, DTOs) isolated; never leak raw DTOs to components.
- Reuse the **same form** component for create/edit — pass `defaultValues` via signal inputs and an `onSubmit` output.
- Cross-feature imports should go through a barrel `index.ts` if needed — prefer minimal cross-feature coupling.

---

## 5) Signals — Reactivity Model

Angular's signals system is the foundation of modern Angular reactivity. All signal primitives are **stable** as of Angular 20+.

### Core Primitives

```typescript
// Writable signal
const count = signal(0);
count.set(5);
count.update(v => v + 1);

// Computed (read-only, memoized, lazy)
const doubled = computed(() => count() * 2);

// LinkedSignal (writable computed — resets when source changes)
const options = signal(['express', 'standard']);
const selected = linkedSignal(() => options()[0]);
selected.set(options()[1]); // manual override allowed

// Effect (side effects — runs asynchronously)
effect(() => {
  console.log('Count changed:', count());
});
```

### Signal-Based Component APIs

```typescript
@Component({
  selector: 'app-user-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ name() }}</h2>
    @if (isAdmin()) { <span>Admin</span> }
  `
})
export class UserCardComponent {
  // Signal inputs (replaces @Input())
  name = input.required<string>();
  role = input<string>('viewer');

  // Computed from inputs
  isAdmin = computed(() => this.role() === 'admin');

  // Model signal (two-way binding with [(value)])
  value = model<string>('');

  // Signal outputs (replaces @Output())
  saved = output<void>();

  // Signal queries (replaces @ViewChild / @ContentChild)
  myInput = viewChild<ElementRef>('myInput');
  panels = contentChildren(PanelComponent);
}
```

**Best practices**
- Prefer `computed()` for derived values (memoized, lazy).
- Use `linkedSignal()` only when you need both reactivity AND manual writes.
- Use `effect()` sparingly — last resort for side effects (logging, analytics, external APIs).
- Use `untracked()` to read signals without creating dependencies.

---

## 6) New Control Flow Syntax

The built-in control flow (stable since Angular 17) replaces `*ngIf`, `*ngFor`, `*ngSwitch`:

```html
<!-- @if / @else if / @else -->
@if (user(); as user) {
  <h1>Welcome, {{ user.name }}</h1>
} @else {
  <h1>Please log in</h1>
}

<!-- @for with track (required) -->
@for (item of items(); track item.id) {
  <app-item-card [item]="item" />
} @empty {
  <p>No items found.</p>
}

<!-- @switch -->
@switch (status()) {
  @case ('loading') { <app-spinner /> }
  @case ('error') { <app-error [message]="error()" /> }
  @case ('success') { <app-content [data]="data()" /> }
}
```

**Key advantages**
- Better type narrowing in templates.
- `track` expression is required in `@for` (performance guarantee).
- `@empty` block for empty collections.
- Contextual variables: `$index`, `$count`, `$first`, `$last`, `$even`, `$odd`.

---

## 7) Deferrable Views (`@defer`)

```html
@defer (on viewport; prefetch on idle) {
  <app-heavy-chart [data]="chartData()" />
} @placeholder (minimum 200ms) {
  <div class="skeleton-chart"></div>
} @loading (after 100ms; minimum 500ms) {
  <app-spinner />
} @error {
  <p>Failed to load chart component.</p>
}
```

**Available triggers**

| Trigger | Behavior |
|---|---|
| `on idle` | Browser reaches idle state (default) |
| `on immediate` | After non-deferred content renders |
| `on timer(5s)` | After specified delay |
| `on viewport` | Placeholder enters viewport |
| `on interaction` | User clicks or presses key |
| `on hover` | Mouse enters or focusin |
| `when condition` | Custom boolean expression |

**Prefetching**: `prefetch on idle` loads JavaScript before the trigger fires, so rendering is instant when triggered. Reduces initial bundle size by 30-50%.

---

## 8) Data Fetching

### httpResource (Reactive — Experimental)

```typescript
@Component({ ... })
export class ProductListComponent {
  private category = input<string>('all');

  // Auto re-fetches when category changes
  products = httpResource<Product[]>(() => `/api/products?category=${this.category()}`);
}
```

**Template usage**:
```html
@if (products.hasValue()) {
  @for (product of products.value(); track product.id) {
    <app-product-card [product]="product" />
  }
} @else if (products.isLoading()) {
  <app-spinner />
} @else if (products.error()) {
  <app-error [error]="products.error()" />
}
```

**Key points**
- `httpResource` is for **read operations only** (GET).
- For mutations (POST/PUT/DELETE), use `HttpClient` directly.
- Built on `HttpClient` — supports interceptors, testing with `HttpTestingController`.
- Cancels in-flight requests when dependencies change.

### HttpClient (Mutations & Legacy)

```typescript
@Injectable({ providedIn: 'root' })
export class UsersService {
  private http = inject(HttpClient);
  private baseUrl = '/api/users';

  getAll() {
    return this.http.get<UserDto[]>(this.baseUrl);
  }

  create(input: CreateUserInput) {
    return this.http.post<UserDto>(this.baseUrl, input);
  }

  update(id: string, input: UpdateUserInput) {
    return this.http.put<UserDto>(`${this.baseUrl}/${id}`, input);
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
```

### Functional Interceptors

```typescript
// auth.interceptor.ts
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).getToken();
  if (token) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};

// error.interceptor.ts
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    retry({ count: 2, delay: 1000 }),
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) inject(AuthService).logout();
      return throwError(() => error);
    })
  );
};
```

---

## 9) State Management Strategy

| State type | Solution |
|---|---|
| **Simple / local** | Plain `signal()` + `computed()` inside components |
| **Medium feature state** | `signalState()` (NgRx Signals) |
| **Complex / enterprise** | **NgRx SignalStore** — shared state, side effects, plugins |
| **Legacy large codebases** | **NgRx Store** (Redux) — maintain, don't adopt fresh |

### NgRx SignalStore (Recommended)

```typescript
// features/users/data-access/users.store.ts
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { withEntities, setAllEntities } from '@ngrx/signals/entities';
import { rxMethod } from '@ngrx/signals/rxjs-interop';

type UsersState = {
  isLoading: boolean;
  filter: string;
};

export const UsersStore = signalStore(
  { providedIn: 'root' },
  withState<UsersState>({ isLoading: false, filter: '' }),
  withEntities<User>(),
  withComputed((store) => ({
    filteredUsers: computed(() =>
      store.entities().filter(u => u.name.includes(store.filter()))
    ),
  })),
  withMethods((store, usersService = inject(UsersService)) => ({
    updateFilter(filter: string) {
      patchState(store, { filter });
    },
    loadUsers: rxMethod<void>(
      pipe(
        tap(() => patchState(store, { isLoading: true })),
        switchMap(() => usersService.getAll()),
        tap(users => patchState(store, setAllEntities(users), { isLoading: false }))
      )
    ),
  }))
);
```

**Key patterns**
- One **SignalStore per feature** domain.
- Co-locate state, updaters, and effects in a single store file.
- Use `patchState()` for immutable state updates.
- Use `rxMethod()` from `@ngrx/signals/rxjs-interop` for async side effects.
- Use `{ providedIn: 'root' }` for global stores; provide at route level for scoped stores.

---

## 10) Routing

### Standalone Route Configuration

```typescript
// app.routes.ts
export const appRoutes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      {
        path: 'users',
        loadChildren: () => import('./features/users/users.routes')
          .then(m => m.USERS_ROUTES),
        canMatch: [() => inject(AuthService).isAuthenticated()],
      },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.component')
          .then(m => m.DashboardComponent),
        canActivate: [authGuard],
        resolve: { stats: statsResolver },
      },
    ],
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component')
      .then(m => m.LoginComponent),
  },
];
```

### Feature Routes

```typescript
// features/users/users.routes.ts
export const USERS_ROUTES: Routes = [
  { path: '', component: UserListComponent },
  { path: 'new', component: UserFormComponent },
  { path: ':id', component: UserDetailComponent },
  { path: ':id/edit', component: UserFormComponent },
];
```

### Functional Guards & Resolvers

```typescript
// core/auth/auth.guard.ts
export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.isAuthenticated()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

// Functional resolver
export const userResolver: ResolveFn<User> = (route) => {
  return inject(UsersService).getById(route.paramMap.get('id')!);
};
```

**Key patterns**
- **Functional guards and resolvers** — class-based are deprecated.
- Use `canMatch` instead of `canLoad` (deprecated) — prevents lazy loading code user cannot access.
- `loadChildren` for feature route files; `loadComponent` for single-component routes.
- Scoped providers via `providers` array on route config.

---

## 11) Forms

### Typed Reactive Forms (Production Standard)

```typescript
interface UserForm {
  name: FormControl<string>;
  email: FormControl<string>;
  address: FormGroup<{
    street: FormControl<string>;
    city: FormControl<string>;
  }>;
}

@Component({ ... })
export class UserFormComponent {
  private fb = inject(NonNullableFormBuilder);
  private defaultValues = input<UserVM | null>(null);

  form = this.fb.group<UserForm>({
    name: this.fb.control('', [Validators.required, Validators.minLength(2)]),
    email: this.fb.control('', [Validators.required, Validators.email]),
    address: this.fb.group({
      street: this.fb.control(''),
      city: this.fb.control(''),
    }),
  });

  submitted = output<UserFormValue>();

  constructor() {
    effect(() => {
      const defaults = this.defaultValues();
      if (defaults) this.form.patchValue(defaults);
    });
  }

  onSubmit() {
    if (this.form.valid) {
      this.submitted.emit(this.form.getRawValue());
    }
  }
}
```

> **Signal Forms** (experimental in Angular 21) use a single `[field]` directive and signal-based form models. Not production-ready yet — use typed Reactive Forms.

---

## 12) Styling

- **Tailwind CSS v4** is the recommended default. New Oxide engine (10x faster builds), CSS-first configuration, zero runtime cost.
- **Angular CDK** for accessible, unstyled component primitives.
- **Component-scoped styles** with `ViewEncapsulation.Emulated` (default) — styles are automatically scoped.
- Use `:host` for component-level styling.
- **styled-components / Emotion**: Not applicable in Angular. Avoid CSS-in-JS runtime approaches.
- Centralize design tokens in `shared/styles/tokens.css`.
- Co-locate component-specific styles with their component files.

```css
/* styles.css (global) — Tailwind v4 */
@import "tailwindcss";
```

```typescript
@Component({
  styles: `
    :host { display: block; }
  `,
  template: `
    <div class="flex items-center gap-4 p-4 rounded-lg bg-white shadow">
      <ng-content />
    </div>
  `
})
```

---

## 13) Performance

### Zoneless Change Detection (Default in Angular 21+)

```typescript
// app.config.ts
providers: [
  provideZonelessChangeDetection(),
]
```

**Benefits**: 60% faster startup, smaller bundle (no zone.js), no more `ExpressionChangedAfterItHasBeenChecked` errors. Requires signals-based reactivity.

### Performance Checklist

- Use `@defer` for below-the-fold and heavy components (30-50% bundle reduction).
- Use `track` in `@for` with stable unique IDs (never use object references).
- Use `computed()` for derived values (memoized, lazy).
- Use `httpResource` with reactive signals (auto-cancels stale requests).
- Enable incremental hydration for SSR apps.
- Use `NgOptimizedImage` for image optimization.
- Use `ChangeDetectionStrategy.OnPush` everywhere (or go zoneless).
- Split code by **route** with `loadChildren` / `loadComponent`.

---

## 14) Security & Compliance

- Angular **auto-sanitizes** interpolated values in templates (HTML, styles, URLs).
- Avoid `innerHTML` with untrusted data; use `DomSanitizer.bypassSecurityTrustHtml()` only when absolutely necessary.
- Use `Renderer2` instead of direct DOM manipulation (`ElementRef.nativeElement`).
- Content Security Policy (CSP); avoid inline scripts/styles. Angular supports **Trusted Types** API.
- **CSRF**: `HttpClient` handles CSRF tokens via the double-submit cookie pattern.
- Auth tokens: use `Secure`, `HttpOnly`, `SameSite` cookies where possible.
- Use `withFetch()` in `provideHttpClient()` for modern fetch API.
- Functional route guards for authentication/authorization.
- Handle secrets on the server; never ship secrets to the client bundle.

---

## 15) Server-Side Rendering & Hydration

```typescript
// app.config.server.ts
export const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideServerRouteConfig([
      { path: '', renderMode: RenderMode.Server },
      { path: 'about', renderMode: RenderMode.Prerender },
    ]),
  ],
};

// app.config.ts — client hydration
providers: [
  provideClientHydration(
    withEventReplay(),
    withIncrementalHydration()
  ),
]
```

### Incremental Hydration

```html
@defer (hydrate on viewport) {
  <app-product-reviews />
}

@defer (hydrate on interaction) {
  <app-comment-form />
}

@defer (hydrate never) {
  <app-static-footer />
}
```

Hydration triggers: `on viewport`, `on interaction`, `on idle`, `on timer`, `on hover`, `when condition`, `never`.

---

## 16) Testing

| Layer | Tool | Notes |
|---|---|---|
| **Unit / Component** | **Vitest** | Default in Angular 21+ CLI. ~6x faster cold start than Jest, native ESM/TS. |
| **Component integration** | Vitest + `TestBed` | Test components with real providers, interceptors, stores. |
| **E2E** | **Playwright** | 3-5 critical flows in CI. UI Mode for time-traveling debugger. |
| **API mocking** | **MSW** or `HttpTestingController` | Intercept at the network level for realistic mocks. |

```typescript
// user-list.component.spec.ts
describe('UserListComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [provideHttpClientTesting()],
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
  });

  it('should display users', async () => {
    const fixture = TestBed.createComponent(UserListComponent);
    const httpTesting = TestBed.inject(HttpTestingController);

    fixture.detectChanges();
    httpTesting.expectOne('/api/users').flush([{ id: '1', name: 'Alice' }]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Alice');
  });
});
```

- Co-locate `*.spec.ts` with source files.
- Factories/builders under `features/*/testing/` and `test/`.
- Jest is valid only for legacy projects where migration cost is prohibitive.

---

## 17) Build Tools

| Tool | Use case |
|---|---|
| **esbuild + Vite** | Default Angular CLI builder. Fastest builds, zero config. |
| **Nx** | Enterprise monorepos. Cached builds, affected tests, module boundary linting. |

Angular CLI uses esbuild for compilation and Vite for the dev server by default since Angular 17. No `vite.config.ts` needed.

```json
{
  "build": { "builder": "@angular-devkit/build-angular:application" },
  "serve": { "builder": "@angular-devkit/build-angular:dev-server" },
  "test":  { "builder": "@angular/build:unit-test" }
}
```

---

## 18) Tooling & Governance

- **TypeScript strict mode** — mandatory, no exceptions. TS 5.8+.
- **Path aliases** for `@app`, `@shared`, `@features/*`, `@core`.
- **ESLint** (`@angular-eslint`) + **Prettier**; add custom rules to forbid cross-feature imports.
- **`inject()` function** preferred over constructor injection — use Angular's migration schematic (`ng generate @angular/core:inject`).
- Consider **Nx** for monorepos: cached builds, affected tests, and **module boundary linting** via tags (`type:feature`, `type:shared`, `scope:users`).

```json
{
  "paths": {
    "@app/*": ["src/app/*"],
    "@core/*": ["src/app/core/*"],
    "@shared/*": ["src/app/shared/*"],
    "@features/*": ["src/app/features/*"]
  }
}
```

---

## 19) CI/CD & Quality Gates

- Lint, typecheck, unit + integration tests on PRs.
- E2E smoke on main; preview deployments for feature branches.
- Bundle analyzer in CI; enforce budgets.
- Dependency review & security scanning.
- Nx `affected` commands to only test/build what changed.

---

## 20) API Boundary & Models

- Keep HTTP clients **inside each feature** under `data-access/`.
- Map **DTO <-> ViewModel** with adapters to decouple UI from backend changes.
- Handle **auth/error/trace** via functional interceptors at `app.config.ts`.
- Prefer **generated clients** from OpenAPI/GraphQL, wrapped by thin facades.

```typescript
// users.adapter.ts
export const toUserVM = (dto: UserDto): UserVM => ({
  id: dto.id,
  name: `${dto.firstName} ${dto.lastName}`,
  role: dto.role ?? 'user',
});
```

---

## 21) Example: Users Feature

### Routes
```typescript
// features/users/users.routes.ts
export const USERS_ROUTES: Routes = [
  { path: '', component: UserListComponent },
  { path: 'new', component: UserFormComponent },
  { path: ':id', component: UserDetailComponent },
  { path: ':id/edit', component: UserFormComponent },
];
```

### List Page (Smart Component)
```typescript
// features/users/user-list/user-list.component.ts
@Component({
  standalone: true,
  imports: [PageHeader, UsersTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="container">
      <app-page-header title="Users" subtitle="Manage accounts" />
      @if (store.isLoading()) {
        <app-spinner />
      } @else {
        <app-users-table
          [users]="store.filteredUsers()"
          (edit)="onEdit($event)"
        />
      }
    </main>
  `,
})
export class UserListComponent implements OnInit {
  protected store = inject(UsersStore);
  private router = inject(Router);

  ngOnInit() {
    this.store.loadUsers();
  }

  onEdit(user: User) {
    this.router.navigate(['/users', user.id, 'edit']);
  }
}
```

### Create / Edit with Shared Form
```html
<!-- Create -->
<main class="container">
  <app-page-header title="Add User" />
  <app-user-form (submitted)="store.createUser($event)" />
</main>

<!-- Edit -->
<main class="container">
  <app-page-header title="Edit User" />
  <app-user-form [defaultValues]="user()" (submitted)="store.updateUser(id(), $event)" />
</main>
```

---

## 22) Layout Pattern

```
core/layout/
  layout.component.ts       # header + sidebar + <router-outlet />
  header.component.ts
  sidebar.component.ts
```

```typescript
// app.routes.ts
export const appRoutes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: 'users', loadChildren: () => import('./features/users/users.routes').then(m => m.USERS_ROUTES) },
      { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
      { path: '', redirectTo: 'users', pathMatch: 'full' },
    ],
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login.component').then(m => m.LoginComponent),
  },
];
```

---

## Summary Table

| Layer | Purpose | Rules |
|---|---|---|
| **core/** | Singletons (auth, layout, error handling, interceptors) | App-wide, instantiated once |
| **shared/** | Stateless UI + generic directives/pipes/utils | No data fetching/HTTP |
| **features/** | Domain UI + data-access + local store | Export minimally, isolate dependencies |
| **environments/** | Build-time config | Non-sensitive flags only |

## Recommended Stack (2026)

| Concern | Tool |
|---|---|
| Framework | **Angular 21+** (standalone, zoneless) |
| Language | **TypeScript 5.8+ strict** |
| Reactivity | **Signals** (`signal`, `computed`, `linkedSignal`, `effect`) |
| Routing | **Standalone routes** with `loadChildren` / `loadComponent` |
| Data fetching | **httpResource** (reads) + **HttpClient** (mutations) |
| Client state | **NgRx SignalStore** (complex) / plain signals (simple) |
| Forms | **Typed Reactive Forms** (`NonNullableFormBuilder`) |
| Styling | **Tailwind CSS v4** + **Angular CDK** |
| Unit testing | **Vitest** + **TestBed** |
| E2E testing | **Playwright** |
| API mocking | **MSW** or **HttpTestingController** |
| Build | **esbuild + Vite** (Angular CLI default) |
| Monorepo | **Nx** |
| SSR | **Angular SSR** with incremental hydration |
