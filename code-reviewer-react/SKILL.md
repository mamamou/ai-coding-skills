---
name: code-reviewer-react
description: >
  React/TypeScript-specific code review overlay. Extends the universal code-reviewer
  skill with React version-aware rules. Trigger when reviewing React components, hooks,
  context, Suspense boundaries, Server Components, Client Components, React Router,
  TanStack Query, Zustand, Redux, React Hook Form, or any .tsx/.jsx file in a React
  project. Keywords: React, useState, useEffect, useCallback, useMemo, useRef,
  useContext, useReducer, useTransition, Suspense, memo, RSC, Server Component,
  Client Component, TanStack Query, Zustand, React Hook Form, Next.js, Vite, prop
  drilling, key prop. Do NOT trigger for Angular or Vue files in the same monorepo.
  (updated 2026-03-28)
license: MIT
metadata:
  author: Marwen Amamou | amamoumarwen@gmail.com
  version: "1.0.0"
---

# Code Reviewer — React Overlay

This skill extends `code-reviewer` (the universal skill). Always apply the universal
skill's full checklist first, then apply the React-specific rules in this file on top.

**Composition order:**
1. Run `code-reviewer` (universal pillars: correctness, security, performance, DRY, tests, docs)
2. Run this overlay (React/TypeScript-specific rules below)
3. Report findings from both in a single unified output

---

## Step 0 — Detect Versions First (always, before reviewing anything)

Run these commands before touching any code. Version determines which rules apply.

```bash
# React and key dependency versions
cat package.json | grep -E '"(react|react-dom|react-router|@tanstack|zustand|redux|react-hook-form|next|vite|typescript|react-compiler)"' | head -20

# Check if React Compiler is enabled
cat babel.config.* next.config.* vite.config.* 2>/dev/null | grep -i "compiler\|babel-plugin-react-compiler" | head -5

# Check for legacy APIs still in use
grep -r "ReactDOM\.render\|ReactDOM\.hydrate\|forwardRef\|createClass" src/ --include="*.tsx" --include="*.jsx" -l 2>/dev/null | head -5

# Check for Server vs Client Components (Next.js App Router)
grep -r "\"use client\"\|\"use server\"" src/ app/ --include="*.tsx" -l 2>/dev/null | head -5
```

Report at the top of your review:
```
🔍 Environment: React vX.Y | TypeScript X.Y | Framework: Next.js X.Y / Vite / CRA
    Compiler: Enabled / Disabled | RSC: Yes / No | Router: App Router / Pages / React Router vX
    State: TanStack Query / Zustand / Redux / Context only
```

Then apply the version-specific rules below.

---

## React Version Rules

### React 17
- **Legacy JSX transform** — flag missing `import React from 'react'` if new JSX transform is not configured.
- No concurrent features — don't suggest `useTransition`, `useDeferredValue`, `Suspense` for data fetching.
- Flag `ReactDOM.render()` — upgrade path to `createRoot()` needed before moving to React 18+.
- **⚠️ EOL** — flag as Warning; no active maintenance. Suggest upgrade to React 18 minimum.

### React 18
- **Concurrent rendering available** — flag expensive synchronous renders that could use `useTransition` to stay responsive.
- **Automatic batching** — flag manual `ReactDOM.flushSync()` used unnecessarily; state updates are batched automatically in React 18 including in `setTimeout`, `Promise`, native events.
- **`Suspense` for data** — flag `useEffect` + `useState` for data fetching; prefer TanStack Query with Suspense or `use()` (React 19).
- **`StrictMode` double-invocation** — flag `useEffect` cleanup missing; Strict Mode intentionally double-fires effects in dev. Missing cleanup = real bug.
- **`createRoot` required** — flag `ReactDOM.render()` as Critical; it was removed in React 19.
- **`useDeferredValue`** — suggest for heavy filter/search lists where typing responsiveness matters.

### React 19 ✅ Current
- **React Compiler** — if the compiler is enabled (`babel-plugin-react-compiler` or Next.js `reactCompiler`), flag manual `useMemo`, `useCallback`, and `React.memo` as **unnecessary noise** — the compiler handles memoization automatically. Flag them as Low priority cleanup.
- **`forwardRef` deprecated** — flag `React.forwardRef()` in new code; `ref` is now a regular prop:
  ```tsx
  // ❌ Legacy forwardRef (deprecated in React 19)
  const Input = React.forwardRef<HTMLInputElement, Props>((props, ref) => (
    <input ref={ref} {...props} />
  ));

  // ✅ ref as prop (React 19)
  function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> }) {
    return <input ref={ref} {...props} />;
  }
  ```
- **`ReactDOM.render()` removed** — flag as Critical. Must use `createRoot()`.
- **`ReactDOM.hydrate()` removed** — flag as Critical. Must use `hydrateRoot()`.
- **Actions API** — flag manual `isPending` state + `try/catch` patterns for form submissions; use `useActionState` + `useFormStatus`:
  ```tsx
  // ❌ Manual pending/error state (React 18 pattern)
  const [isPending, setIsPending] = useState(false);
  const handleSubmit = async () => {
    setIsPending(true);
    try { await submit(data); } finally { setIsPending(false); }
  };

  // ✅ useActionState (React 19)
  const [state, submitAction, isPending] = useActionState(submit, null);
  ```
- **`use()` hook** — flag `useEffect` data fetching in components that could use `use(promise)` with Suspense.
- **`useOptimistic`** — flag optimistic UI patterns implemented manually with `useState` + rollback logic; suggest `useOptimistic`.
- **`string` refs removed** — flag `ref="myRef"` string refs (very old pattern) as Critical.
- **New JSX transform required** — flag `import React from 'react'` used only for JSX (not needed with new transform).

---

## React-Specific Review Checklist

### 🔑 Keys & Lists
- **Missing `key` prop** — flag any `.map()` rendering elements without a `key`.
- **`key={index}` on mutable lists** — flag `key={index}` on lists that can be reordered, filtered, or have items added/removed; use a stable unique ID:
  ```tsx
  // ❌ Index as key — causes state bugs on reorder/filter
  {users.map((user, i) => <UserCard key={i} user={user} />)}

  // ✅ Stable ID
  {users.map(user => <UserCard key={user.id} user={user} />)}
  ```
- **`key` on fragments** — flag missing `key` on `<Fragment>` in mapped lists.

### 🪝 Hooks

#### useEffect
- **Data fetching in `useEffect`** — flag `useEffect` + `useState` for API calls in React 18/19 projects. Recommend TanStack Query, `use()` + Suspense, or RSC:
  ```tsx
  // ❌ Manual fetch — no caching, no deduplication, race conditions
  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers);
  }, []);

  // ✅ TanStack Query — caching, deduplication, background refetch
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: fetchUsers });
  ```
- **Missing cleanup** — flag `useEffect` with subscriptions, timers, or event listeners missing a cleanup `return` function.
- **Derived state in `useEffect`** — flag `useEffect` used to set state derived from props or other state; compute during render instead:
  ```tsx
  // ❌ Derived state in effect — extra render cycle
  useEffect(() => { setFullName(`${firstName} ${lastName}`); }, [firstName, lastName]);

  // ✅ Computed during render
  const fullName = `${firstName} ${lastName}`;
  ```
- **Missing dependencies** — flag `useEffect` with incomplete dependency arrays. Every reactive value used inside must be in the array.
- **Stale closure** — flag callbacks inside `useEffect` referencing state/props that aren't in the dependency array.
- **`useEffect` for event handlers** — flag `useEffect` used to handle button clicks or user interactions; use event handlers directly.

#### useMemo / useCallback / React.memo
- **With React Compiler enabled** — flag all three as unnecessary; the compiler handles this automatically. Remove them as Low priority cleanup.
- **Without React Compiler** — flag *over-use*: `useMemo`/`useCallback` on cheap operations adds overhead. Only memoize when: (a) computation is provably expensive (profiler evidence), or (b) referential equality matters for a child wrapped in `React.memo`.
- **`React.memo` without stable props** — flag `React.memo` on components receiving new object/array/function references every render — memoization is defeated.

#### useState / useReducer
- **Derived state in `useState`** — flag state that is just a transformation of other state or props; compute during render.
- **Object spread for state updates** — flag state updates missing spread of previous state:
  ```tsx
  // ❌ Overwrites entire state object
  setState({ name: 'Alice' });

  // ✅ Preserve other fields
  setState(prev => ({ ...prev, name: 'Alice' }));
  ```
- **`useReducer` for complex state** — suggest `useReducer` when: multiple `useState` values are always updated together, next state depends on previous state, or state has complex update logic.
- **Lazy state initialization** — flag expensive initial state computation passed directly to `useState`; use initializer function:
  ```tsx
  // ❌ Runs on every render
  const [state, setState] = useState(expensiveComputation());

  // ✅ Runs once
  const [state, setState] = useState(() => expensiveComputation());
  ```

#### useRef
- **Mutable values without re-render** — flag `useState` used for values that don't need to trigger re-renders (e.g., previous values, timers, DOM references); use `useRef`.
- **DOM access timing** — flag `ref.current` accessed during render (before mount); DOM refs are only available after mount.

#### useContext
- **Context for frequently changing values** — flag `Context` used for high-frequency state (mouse position, scroll position); causes all consumers to re-render. Use Zustand or split contexts.
- **Prop drilling vs Context** — flag prop drilling more than 2-3 levels deep as a suggestion to evaluate Context or a state manager.

### ⚡ Performance

- **Conditional rendering with `&&`** — flag `{count && <Component />}` — renders `0` when count is 0. Use ternary:
  ```tsx
  // ❌ Renders "0" to DOM when count is 0
  {count && <UserList />}

  // ✅ Renders nothing
  {count > 0 && <UserList />}
  // or
  {count ? <UserList /> : null}
  ```
- **Waterfall fetches** — flag sequential `await` calls for independent data; use `Promise.all()`:
  ```tsx
  // ❌ Sequential — slow
  const user = await fetchUser(id);
  const posts = await fetchPosts(id);

  // ✅ Parallel
  const [user, posts] = await Promise.all([fetchUser(id), fetchPosts(id)]);
  ```
- **Barrel imports** — flag `import { Button } from '../components'` barrel files; import directly to avoid bundling unused exports.
- **Code splitting** — flag large components imported statically that could be lazy-loaded:
  ```tsx
  // ❌ Eager import — increases initial bundle
  import HeavyChart from './HeavyChart';

  // ✅ Lazy import — split into separate chunk
  const HeavyChart = lazy(() => import('./HeavyChart'));
  ```
- **Inline object/array props** — flag object or array literals created inline in JSX passed to memoized children — creates new reference every render:
  ```tsx
  // ❌ New array reference on every render
  <List items={[1, 2, 3]} />

  // ✅ Stable reference
  const ITEMS = [1, 2, 3];
  <List items={ITEMS} />
  ```
- **`useDeferredValue` for heavy lists** — suggest for search/filter inputs rendering large lists; keeps input responsive.
- **`useTransition` for non-urgent updates** — flag navigation or tab-switching state updates that block input; mark as transitions.

### 🌐 Server Components / RSC (if Next.js App Router or RSC framework)

- **`'use client'` boundary placement** — flag `'use client'` placed too high in the tree, converting entire subtrees to client components unnecessarily. Push boundaries as deep as possible.
- **Hooks in Server Components** — flag `useState`, `useEffect`, `useContext` etc. in Server Components (no `'use client'` directive) — these crash at runtime.
- **Data fetching in Server Components** — flag `useEffect` + `useState` for data in RSC projects; fetch directly in Server Components:
  ```tsx
  // ✅ Server Component — fetch directly, no useEffect
  async function UserList() {
    const users = await fetchUsers(); // runs on server
    return users.map(u => <UserCard key={u.id} user={u} />);
  }
  ```
- **Serialization** — flag passing non-serializable values (functions, class instances, `Date` objects) from Server to Client Components as props — must be JSON-serializable.
- **`React.cache()`** — flag repeated identical fetches in Server Components without `React.cache()` for per-request deduplication.
- **`after()` (Next.js 15+)** — flag non-blocking post-response work (analytics, logging) blocking the response; use `after()`.

### 🔄 State Management

**State management decision guide (flag misuse):**

| State type | Right tool |
|---|---|
| Local component state | `useState` / `useReducer` |
| Shared UI state (modals, theme) | Zustand or Context |
| Server/API data | TanStack Query |
| Form state | React Hook Form |
| Global complex state with effects | Redux Toolkit or Zustand |

- **Redux for server state** — flag Redux storing API data that TanStack Query would handle better (loading, caching, refetch, invalidation). Note: Zustand is often used alongside TanStack Query for client-side UI state — only flag Zustand when it duplicates server-state caching.
- **`useEffect` for server state** — flag manual `useEffect` fetch + `useState` loading/error pattern; replace with TanStack Query.
- **TanStack Query mutation cache** — flag mutations not calling `queryClient.invalidateQueries()` or using `onSuccess` to update cache after a mutation that affects a list.
- **Zustand slice isolation** — flag a single large Zustand store for unrelated state; split into feature slices.
- **Context re-render problem** — flag a single large Context value object where part of the state changes frequently; split into separate contexts or use Zustand.

### 📝 Forms (React Hook Form)

- **Uncontrolled vs controlled** — flag mixing `react-hook-form` `register()` with `useState` for the same field — pick one approach.
- **Validation** — flag form submissions without `resolver` (Zod/Yup) schema validation; always validate before processing.
- **`useFormStatus`** — flag manual `isSubmitting` state when `useFormStatus` (React 19) is available.
- **`defaultValues`** — flag forms missing `defaultValues` in `useForm()` — causes uncontrolled-to-controlled warnings.

### 🔐 Security (React-specific)

- **`dangerouslySetInnerHTML`** — flag any use without explicit sanitization (`DOMPurify` or equivalent). This is an XSS vector.
- **User-controlled URLs in `href`/`src`** — flag dynamic `href={userInput}` without validation — allows `javascript:` injection.
- **Sensitive data in state** — flag passwords, tokens, or PII stored in component state that gets serialized to RSC payloads or localStorage.
- **`eval()` / `new Function()`** — flag any dynamic code execution.

---

## Anti-Patterns Quick Reference

Flag these immediately when spotted:

| Anti-pattern | Severity | Fix |
|---|---|---|
| `ReactDOM.render()` | Critical | Use `createRoot()` |
| `ReactDOM.hydrate()` | Critical | Use `hydrateRoot()` |
| `dangerouslySetInnerHTML` without sanitization | Critical | Use DOMPurify |
| `key={index}` on mutable lists | High | Use stable unique ID |
| `useEffect` for data fetching | High | Use TanStack Query or RSC |
| Missing `useEffect` cleanup | High | Add cleanup return function |
| `{count && <Comp />}` pattern | High | Use ternary |
| Derived state in `useEffect` | High | Compute during render |
| Sequential `await` for independent data | High | Use `Promise.all()` |
| Hooks in Server Components | Critical | Add `'use client'` or remove hooks |
| Non-serializable props from Server to Client | High | Serialize data before passing |
| `useMemo`/`useCallback` with React Compiler | Low | Remove — compiler handles it |
| `forwardRef` in React 19 | Low | Use ref as prop |
| Barrel imports for large libs | Medium | Direct imports |
| Lazy state init as expression `useState(fn())` | Medium | Use `useState(() => fn())` |
| Redux storing API data | Medium | Use TanStack Query |
| Large Context with frequent updates | Medium | Split context or use Zustand |
| Missing `key` on mapped elements | High | Add stable `key` prop |
| Stale closure in `useEffect` | High | Fix dependencies |

---

## Unified Output Format

Use the same format as `code-reviewer` (universal). Add a React context line:

```
🔍 Environment: React v19.x | TypeScript 5.x | Next.js 15.x (App Router)
    Compiler: Enabled | RSC: Yes | TanStack Query v5 | Zustand v5

## Code Review Summary
[... standard universal format ...]

### ⚛️ React-Specific Issues
[Issues found by this overlay, using the same severity/format as universal]
```

---

## Behavior Rules (React-specific additions)

- **Version first, always** — never apply compiler-specific or React 19 rules without confirming the version. Flagging `useMemo` as unnecessary is only valid when the React Compiler is confirmed enabled.
- **`useEffect` is not for data fetching** — in React 18/19 projects, this is always flagged. Exceptions: external subscriptions, DOM side effects, `window` event listeners.
- **Don't over-flag memoization** — without the compiler, `useMemo`/`useCallback` are sometimes correct. Only flag when profiler evidence is absent AND the overhead isn't justified.
- **RSC boundary decisions are architectural** — flag incorrect hook usage in Server Components as Critical, but don't opine on where to place the boundary without context.
- **Delegate deep security audits** → `security-auditor` skill if available.
- **React Native is out of scope** — this skill covers React for web. React Native has different rules (no DOM, different performance model).
