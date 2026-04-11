---
name: react-structure
description: >
  React enterprise architecture guidelines for structuring scalable, production-grade
  applications. Use when scaffolding a new React project, reviewing project structure,
  setting up feature slices, choosing state management, configuring data fetching,
  or making architectural decisions in a React/TypeScript codebase. Covers folder
  structure, routing (TanStack Router, React Router v7, Next.js App Router), TanStack
  Query v5, Zustand, React Compiler, Vite 6, Turbopack, Vitest, Playwright, Tailwind v4,
  and Server Components. Keywords: React architecture, project structure, feature slices,
  DDD, enterprise React, folder layout, monorepo, Nx, Turborepo.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# React Enterprise Architecture Guidelines (2026)

Feature-first, enterprise-grade React architecture that scales across teams and codebases. Assumes **TypeScript strict**, modern tooling (**Vite 6** or **Next.js 16 App Router**), and emphasizes **feature isolation**, **data-access boundaries**, **performance**, and **operability**.

---

## 1) High-Level Structure

```
src/
  app/
    providers/                # app-level providers (query client, i18n, theme)
    routing/                  # router setup & guards
    layouts/                  # app chrome (top bar, sidebar, auth shell)
    config/                   # runtime config loader & tokens
    errors/                   # boundary, fallback UI, error instrumentation
  shared/                     # reusable & stateless UI/utilities
    ui/                       # presentational components (buttons, cards, table)
    forms/                    # form controls, hooks, schemas, validators
    hooks/                    # generic hooks not tied to a feature
    utils/                    # pure TS helpers
    styles/                   # design tokens, mixins, global CSS
  features/                   # domain-driven feature slices (lazy where possible)
    users/
      index.ts                # public API for the feature
      routes.tsx              # feature routes (SPA) or page segments (Next.js)
      components/             # presentational, feature-scoped
      pages/                  # feature shells/screens
      api/                    # data-access (clients, models, adapters)
      state/                  # local store/facade (Zustand)
      testing/                # test builders/mocks
  test/                       # global test utilities
  main.tsx                    # app bootstrap (SPA) or entry (Next.js client)
```

**Philosophy**
- Organize by **feature/domain**, not by technical layer.
- Keep **shared** stateless and UI-only; keep **data-access** inside the owning feature.
- Prefer **co-location**: tests, styles, stories next to implementation.

> **Next.js (App Router)**: Map features to `app/(features)/<feature>` segments and keep UI/data boundaries the same. For an SPA, use TanStack Router or React Router v7 + Vite 6.

---

## 2) Core App Wiring

- **Routing**: TanStack Router (new SPA — type-safe params/search), React Router v7 (existing SPA), or Next.js App Router.
- **Providers**: Create `app/providers` to host QueryClientProvider, ThemeProvider, I18nProvider, StoreProvider, etc.
- **Runtime config**: Load from `/config.json` (or env) early; expose via a typed context or simple module.
- **Errors**: Global `ErrorBoundary` + error reporting (Sentry, etc.).
- **Layouts**: App chrome (top bar + sidebar) lives in `app/layouts/`, not in `shared` or features. Use `<Outlet />` (React Router) or `{children}` (Next.js) for content slots.

**Example (SPA, Vite 6)**
```tsx
// main.tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={appRouter} />
    </AppProviders>
  </StrictMode>
);
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
  forms/
    Form/
    TextField/
    PhoneInput/
    validators.ts
  hooks/
    useDebounce.ts
    useToggle.ts
  utils/
    date.ts
    array.ts
  styles/
    tokens.css
    globals.css
```

**Rules**
- **No data fetching** or business logic here.
- Components are presentational (props in, callbacks out).
- Keep design-system atoms/molecules here; domain widgets stay inside features.
- Prefer **shadcn/ui** or **Radix** primitives for accessible, unstyled components.

> **React Compiler note**: With React Compiler stable (1.0), manual `React.memo` wrapping is no longer needed in most cases. The compiler auto-memoizes at the expression level. Retain manual memoization only at third-party library interop boundaries where identity comparison is explicitly required.

---

## 4) Feature Slices (DDD-style)

Each feature encapsulates UI, data-access, and local state.

```
features/users/
  index.ts                   # exports public units (components/hooks)
  routes.tsx                 # SPA route config for this feature
  pages/
    UsersListPage.tsx        # screen/shell: orchestrates data + renders UI
    UserCreatePage.tsx
    UserEditPage.tsx
  components/
    UsersTable.tsx           # presentational
    UserCard.tsx
    UserForm.tsx             # shared between create/edit
  api/
    users.client.ts          # HTTP client
    users.models.ts          # DTOs & ViewModels
    users.adapter.ts         # DTO <-> VM mappings
    queries.ts               # TanStack Query v5 hooks
  state/
    users.store.ts           # Zustand store for UI state
  testing/
    builders.ts
```

**Rules**
- **Pages** orchestrate (compose hooks, handle navigation), **components** render.
- **api/** keeps backend specifics (endpoints, DTOs) isolated; never leak raw DTOs to components.
- Only export what other features need via `index.ts`.
- Reuse the **same form** component for create/edit — pass `defaultValues` and an `onSubmit` handler.

---

## 5) Data Fetching & Caching (TanStack Query v5)

- Prefer **TanStack Query v5** for server cache, retries, de-duplication, and invalidation.
- One **query key namespace per feature** (e.g., `['users', 'list']`).
- **Mutations**: invalidate queries or update cache conservatively; co-locate mutations with queries.
- **Suspense-first**: Use `useSuspenseQuery` for simpler loading states with `<Suspense>` boundaries.
- For **Next.js**, use **Server Components** for data you don't need on the client; fall back to Client components with Query when interactivity is needed.

**v5 key changes from v4**:
- Single object parameter for all hooks (no overloads).
- `onSuccess`/`onError`/`onSettled` callbacks removed from `useQuery` — handle in calling code.
- `keepPreviousData` removed — use `placeholderData: (prev) => prev`.
- `useErrorBoundary` renamed to `throwOnError`.
- Infinite queries require explicit `initialPageParam`.

**Example**
```ts
// features/users/api/queries.ts
export const usersKeys = {
  all: ['users'] as const,
  list: () => [...usersKeys.all, 'list'] as const,
  detail: (id: string) => [...usersKeys.all, 'detail', id] as const,
};

export function useUsers() {
  return useSuspenseQuery({
    queryKey: usersKeys.list(),
    queryFn: api.users.list,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.users.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: usersKeys.all }),
  });
}
```

---

## 6) State Management Strategy

| State type | Solution |
|---|---|
| **Server cache** | **TanStack Query v5** — do *not* mirror into client stores |
| **Local UI state** | `useState` / `useReducer` inside components |
| **Cross-feature client state** (auth, theme, feature flags) | **Zustand** (lightweight, ~3KB) |
| **Complex atomic state** (many interdependent values) | **Jotai** (fine-grained reactivity) |
| **Legacy large codebases** | **Redux Toolkit** + feature slices (maintain, don't adopt fresh) |

- **Zustand** is the recommended default for client state. Simple API, tiny bundle, works with Server Components.
- Do **not** adopt Redux for new projects unless already embedded in the codebase.
- If you adopt Redux, follow **Redux Toolkit + feature slices** and keep side effects in RTK Query or thunks.

---

## 7) API Boundary & Models

- Keep HTTP clients **inside each feature** under `api/`.
- Map **DTO ↔ ViewModel** with adapters to decouple UI from backend changes.
- Handle **auth/error/trace** via Axios/Fetch interceptors or a wrapper client at `app/providers`.
- Prefer **generated clients** from OpenAPI/GraphQL, wrapped by thin facades.

**Example**
```ts
// users.adapter.ts
export const toUserVM = (dto: UserDto): UserVM => ({
  id: dto.id,
  name: `${dto.firstName} ${dto.lastName}`,
  role: dto.role ?? 'user',
});
```

---

## 8) Routing

### SPA — TanStack Router (recommended for new projects)
Type-safe routes, params, and search params with full inference and autocomplete. Built-in data loading and caching. DevTools included.

### SPA — React Router v7 (existing projects)
Library mode for traditional SPA. Adequate for most use cases; lacks built-in type-safe params.

### Next.js App Router
Feature routes under `app/(features)/users` with `page.tsx` per route. Use route groups for layout boundaries.

**Layout pattern**:
- Layouts are **app chrome** in `app/layouts/` — not feature code.
- `PageHeader` renders **inside** each page's `<main>` content area.
- Put auth guards at the **layout route** to protect entire sections.

```
app/
  layout.tsx                   # global minimal layout/providers
  (dashboard)/
    layout.tsx                 # top bar + sidebar + {children}
    users/
      page.tsx                 # list
      new/page.tsx             # create
      [id]/edit/page.tsx       # edit
  (public)/
    layout.tsx
    login/page.tsx
```

---

## 9) React Compiler

**React Compiler 1.0** is stable (October 2025). It is a build-time Babel plugin that performs automatic expression-level memoization via static analysis.

**Impact on your code**:
- `useMemo`, `useCallback`, and `React.memo` are **largely unnecessary** for new code.
- The compiler inserts memoization more granular than hand-written equivalents.
- Retain manual memoization **only** at third-party library interop boundaries.
- Backward compatible to React 17+ via `react-compiler-runtime`.

**Adoption**:
1. Enable in build config (Vite plugin or `reactCompiler: true` in `next.config.ts`).
2. Fix ESLint issues (auto-fixable rules available).
3. Validate with React Profiler.
4. Progressively remove manual memoization.

---

## 10) Performance

- **Measure first** (React Profiler, Chrome DevTools). Optimize hot paths only.
- The React Compiler handles most memoization — avoid premature manual optimization.
- Split code by **route** and **component-level** with dynamic imports.
- Avoid prop drilling; prefer composition (`children` pattern).
- For lists: stable keys, windowing (`@tanstack/react-virtual`), and stable item render.
- In Next.js, prefer **Server Components + streaming SSR** to reduce client JS and improve INP/TBT.
- **`<ViewTransition>`** (canary): Wraps browser View Transitions API for smooth route animations. Safe to experiment, not production-critical yet.
- **Suspense boundaries**: Use nested `<Suspense>` for granular loading states and streaming.

---

## 11) Security & Compliance

- Escape/sanitize any HTML; avoid `dangerouslySetInnerHTML`.
- Content Security Policy (CSP); avoid inline scripts/styles.
- Handle secrets on the server; never ship secrets to the client bundle.
- Auth tokens: use `Secure`, `HttpOnly` cookies where possible; rotate and refresh securely.
- In Next.js, use Server Actions for mutations — endpoints are unguessable and unused actions are tree-shaken.

---

## 12) Styling

- **Tailwind CSS v4** is the recommended default. New Oxide engine (10x faster builds), CSS-first configuration, zero runtime cost — ideal for Server Components.
- Pair with **shadcn/ui** for accessible, customizable component primitives.
- **CSS Modules** remain a solid zero-runtime alternative for teams preferring scoped CSS.
- **styled-components / Emotion**: In maintenance mode as of 2025. Do **not** adopt for new projects — runtime overhead is a liability with Server Components. Migrate existing usage to Tailwind or CSS Modules.
- Centralize design tokens (colors, spacing, typography) in `shared/styles`.
- Co-locate component-specific styles with their component files.

---

## 13) Observability & Reliability

- Global error boundary + error logger.
- Instrument fetch/axios for request/response logs and correlation IDs.
- Capture Web Vitals (**INP**, **LCP**, **CLS**) and ship to analytics/observability.
- Feature-level error UIs (EmptyState, Retry) for degraded modes.

---

## 14) Testing

| Layer | Tool | Notes |
|---|---|---|
| **Unit / Component** | **Vitest** + React Testing Library | Co-locate `*.test.ts(x)` with code. Vitest is ~6x faster cold start than Jest, native ESM/TS support. |
| **API mocking** | **MSW** (Mock Service Worker) | Intercept at the network level for realistic mocks. |
| **Integration** | Vitest + real providers (QueryClient, Router) | Test screens with actual provider tree. |
| **E2E** | **Playwright** | 3-5 critical flows in CI. UI Mode for time-traveling debugger. |

- Jest is valid only for legacy Webpack/Babel codebases where migration cost is prohibitive.
- Factories/builders under `features/*/testing` and `test/`.
- **Vitest Browser Mode** can run tests in real browsers via Playwright providers — bridges unit and integration testing.

---

## 15) Build Tools

| Tool | Use case |
|---|---|
| **Vite 6** | Standalone React SPAs. Fastest HMR, broadest plugin support. Environment API for multi-target dev. |
| **Turbopack** | Next.js projects. Default bundler in Next.js 16. |
| **Rspack** | Webpack migration without full rewrite (Rust-based, Webpack-compatible). |

---

## 16) Tooling & Governance

- **TypeScript strict mode** — mandatory, no exceptions. TS 5.8+ with granular return-type checking.
- **Path aliases** for `@app`, `@shared`, `@features/*`.
- **ESLint** + **Prettier**; add custom rules to forbid cross-feature imports except via `features/*/index.ts` public API.
- **React Compiler ESLint plugin** for detecting code patterns that block optimization.
- Consider **Nx/Turborepo** for monorepos: cached builds, affected tests, and **module boundary linting** via tags (`type:feature`, `type:shared`).

```json
{
  "paths": {
    "@app/*": ["src/app/*"],
    "@shared/*": ["src/shared/*"],
    "@features/*": ["src/features/*"]
  }
}
```

---

## 17) Configuration & Environments

- Build-time env (Vite `import.meta.env` / Next.js `process.env`) for non-sensitive flags.
- Runtime config fetched from `/config.json` (or server) at startup.
- Feature flags via provider; guard routes/sections by flags.

---

## 18) CI/CD & Quality Gates

- Lint, typecheck, unit + integration tests on PRs.
- E2E smoke on main; preview deployments for feature branches.
- Bundle/route analyzer in CI; enforce budgets.
- Dependency review & security scanning.

---

## 19) Example: Users Feature (SPA)

### Routing (TanStack Router)
```tsx
// features/users/routes.tsx
export const usersRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/users',
  component: UsersListPage,
});

export const userCreateRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/users/new',
  component: UserCreatePage,
});

export const userEditRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/users/$id/edit',
  component: UserEditPage,
});
```

### List Page
```tsx
// features/users/pages/UsersListPage.tsx
export function UsersListPage() {
  const { data } = useUsers(); // useSuspenseQuery
  return (
    <main className="container">
      <PageHeader title="Users" subtitle="Manage accounts" />
      <UsersTable users={data} />
    </main>
  );
}
```

### Create / Edit with Shared Form
```tsx
// Create
<main className="container">
  <PageHeader title="Add User" />
  <UserForm onSubmit={(input) => createUser.mutate(input)} />
</main>

// Edit
<main className="container">
  <PageHeader title="Edit User" />
  <UserForm defaultValues={toFormValues(user)} onSubmit={(input) => updateUser.mutate({ id, input })} />
</main>
```

---

## 20) Layout Pattern (SPA)

```
src/app/layouts/
  AppLayout.tsx      # top bar + sidebar + <Outlet />
  AuthLayout.tsx
```

```tsx
const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/users', element: <UsersListPage /> },
      { path: '/users/new', element: <UserCreatePage /> },
      { path: '/users/:id/edit', element: <UserEditPage /> },
      { index: true, element: <Navigate to="/users" replace /> },
    ],
  },
  {
    element: <AuthLayout />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
]);
```

---

## Summary Table

| Layer | Purpose | Rules |
|---|---|---|
| **app/** | Wiring (routing, providers, layouts, config) | No feature code here |
| **shared/** | Stateless UI + generic hooks/utils | No data fetching/HTTP |
| **features/** | Domain UI + data + local store | Export via `index.ts` |
| **test/** | Global test utils | Reuse across features |

## Recommended Stack (2026)

| Concern | Tool |
|---|---|
| Framework | **Vite 6** (SPA) or **Next.js 16** (SSR/RSC) |
| Language | **TypeScript 5.8+ strict** |
| Compiler | **React Compiler 1.0** |
| Routing (SPA) | **TanStack Router** (new) / **React Router v7** (existing) |
| Server cache | **TanStack Query v5** |
| Client state | **Zustand** |
| Forms | **React Hook Form** |
| Styling | **Tailwind CSS v4** + **shadcn/ui** |
| Unit testing | **Vitest** + **React Testing Library** |
| E2E testing | **Playwright** |
| API mocking | **MSW** |
| Monorepo | **Nx** or **Turborepo** |
