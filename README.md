# AI Coding Skills

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg) ![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-8A2BE2) ![SKILL.md](https://img.shields.io/badge/format-SKILL.md-blue) ![OWASP](https://img.shields.io/badge/OWASP-2025-red) ![Skills](https://img.shields.io/badge/skills-15-brightgreen) ![Last Commit](https://img.shields.io/github/last-commit/marmamou/ai-coding-skills) ![Stars](https://img.shields.io/github/stars/marmamou/ai-coding-skills?style=social)

A collection of production-grade Skills for code review, secure coding, and security auditing. Built by combining OWASP standards, real-world patterns, and battle-tested checklists into comprehensive, actionable skill definitions.

Compatible with **Claude Code** and any agent supporting the `SKILL.md` format.

## Skills

### Code Review

| Skill                                           | Description                                                                                                                                                        | Size  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| [code-reviewer](code-reviewer/)                 | Universal code reviewer — correctness, security (OWASP 2025), performance, maintainability, tests, documentation. Foundation skill that all overlays extend.       | 8 KB  |
| [code-reviewer-angular](code-reviewer-angular/) | Angular overlay — version-aware rules for Angular 17–20+, signals, RxJS, SSR, NgRx, Material. Runs universal reviewer first, then applies Angular-specific checks. | 19 KB |
| [code-reviewer-django](code-reviewer-django/)   | Django overlay — version-aware rules for Django 3–5, DRF, Celery, async ORM, Python 3.8–3.12.                                                                      | 12 KB |
| [code-reviewer-node](code-reviewer-node/)       | Node.js overlay — Express, JWT/OAuth, GraphQL/Apollo, BullMQ, TypeScript strict mode, Node 18–22.                                                                  | 15 KB |
| [code-reviewer-react](code-reviewer-react/)     | React overlay — React 17–19, hooks, RSC/Next.js App Router, TanStack Query, Zustand, React Hook Form.                                                              | 18 KB |

### Security

| Skill                                               | Description                                                                                                                                                                                                                        | Size  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| [security-auditor](security-auditor/)               | Post-hoc security audit with a threat-actor mindset. Three layers: OWASP Top 10:2025 static analysis, access control & authorization audit, pen test pattern recognition. Read-only — finds vulnerabilities, doesn't fix them.     | 21 KB |
| [secure-by-design-coding](secure-by-design-coding/) | Proactive secure coding companion that embeds security controls while writing code. Based on OWASP Proactive Controls C1–C10 and the Secure-by-Design Framework. Writes secure code from the start instead of finding flaws after. | 32 KB |
| [angular-security](angular-security/)               | Angular frontend security reference — XSS, DomSanitizer, template injection, CSRF/XSRF, HttpClient security, CSP, Angular SSR hardening, OWASP 2025. Load when writing or reviewing security-sensitive Angular code.               | 23 KB |
| [react-security](react-security/)                   | React frontend security reference — XSS, CSRF, auth patterns, token storage, CSP, Server Components/Actions, Next.js hardening, OWASP 2025. Load when writing or reviewing security-sensitive React code.                          | 24 KB |

### Architecture

| Skill                                   | Description                                                                                                                                                                                                                                  | Size  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| [angular-structure](angular-structure/) | Angular enterprise architecture — folder structure, feature slices, signals, standalone components, new control flow, deferrable views, zoneless, state management, data fetching. Use when scaffolding or restructuring an Angular project. | 27 KB |
| [react-structure](react-structure/)     | React enterprise architecture — folder structure, feature slices, routing (TanStack Router, React Router v7, Next.js App Router), TanStack Query, state management, data fetching. Use when scaffolding or restructuring a React project.    | 18 KB |

### Data & Libraries

| Skill                                   | Description                                                                                                                                                                                                           | Size |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| [postgres](postgres/)                   | PostgreSQL best practices — query optimization, schema design, indexing, security, operations, performance tuning. Load when working with Postgres databases.                                                         | 7 KB |
| [graphene-django](graphene-django/)     | Graphene-Django best practices — N+1 prevention, query optimization, schema design, security, caching, testing. Load when working with graphene-django GraphQL APIs.                                                  | 4 KB |
| [strawberry-django](strawberry-django/) | Strawberry-Django best practices — DjangoOptimizerExtension, DataLoaders, type-hint-first schemas, CRUD mutations, filters/pagination/Relay, permission extensions, security hardening, async/subscriptions, testing. | 5 KB |

### Maintenance

| Skill                               | Description                                                                                                                                                                                                                                                                    | Size |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| [library-updater](library-updater/) | Dependency upgrade audit for any stack (npm, pip/poetry/uv, Composer, cargo, Go, Maven/Gradle, NuGet, Bundler, pub, hex). Checks latest versions against each other (peer/runtime constraints), researches breaking changes, scans the codebase for impact, and writes a wave-based upgrade report. Report-only. | 9 KB |

## Architecture

```
ai-coding-skills/
├── code-reviewer/               # Universal foundation (all languages)
├── code-reviewer-angular/       # Angular overlay (extends universal)
├── code-reviewer-django/        # Django overlay (extends universal)
├── code-reviewer-node/          # Node.js overlay (extends universal)
├── code-reviewer-react/         # React overlay (extends universal)
├── security-auditor/            # Dedicated security audit (read-only)
├── secure-by-design-coding/     # Proactive secure coding (read + write)
├── angular-security/            # Angular-specific security reference
├── react-security/              # React-specific security reference
├── angular-structure/           # Angular enterprise architecture guide
├── react-structure/             # React enterprise architecture guide
├── postgres/                    # PostgreSQL best practices reference
├── graphene-django/             # Graphene-Django GraphQL reference
├── strawberry-django/           # Strawberry-Django GraphQL reference
└── library-updater/             # Dependency upgrade audit (report-only)
```

Every skill directory contains a `SKILL.md` (the canonical format Claude reads). Some skills also ship a `references/` folder with deeper material loaded on demand, or a `scripts/` folder with helpers the skill runs.

### How they work together

The skills split into two groups: **workflow skills** that drive a lifecycle phase (plan → write → review → audit) and **reference skills** that load on demand when the work touches a specific framework, library, or database.

```
┌─────────────────────────────────────────────────────────┐
│                Planning & Architecture                  │
│                                                         │
│   angular-structure    react-structure                  │
│   "Lay out the project so it can scale"                 │
│   Folder structure, state management, data fetching     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   Writing Code                          │
│                                                         │
│   secure-by-design-coding                               │
│   "Build it so it can't be abused"                      │
│   OWASP Proactive Controls C1–C10                       │
│   Writes code with security controls baked in           │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   Reviewing Code                        │
│                                                         │
│   code-reviewer (universal)                             │
│   ┌───────────┬───────────┬───────────┬───────────┐     │
│   │  Angular  │  Django   │  Node.js  │   React   │     │
│   │  overlay  │  overlay  │  overlay  │  overlay  │     │
│   └───────────┴───────────┴───────────┴───────────┘     │
│   Runs universal first, then framework-specific rules   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   Auditing Security                     │
│                                                         │
│   security-auditor                                      │
│   "How would an attacker abuse this?"                   │
│   OWASP Top 10:2025 + ASVS 5.0                          │
│   Read-only — reports findings, never modifies code     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                   Maintaining                           │
│                                                         │
│   library-updater                                       │
│   "What can we upgrade, and what breaks if we do?"      │
│   Cross-compatibility, breaking changes, code impact    │
│   Report-only — never touches manifests or lockfiles    │
│                                                         │
└─────────────────────────────────────────────────────────┘

                  ▲ loaded on demand during any phase ▲

┌─────────────────────────────────────────────────────────┐
│                     Reference Skills                    │
│                                                         │
│   angular-security    react-security                    │
│   postgres            graphene-django                   │
│   strawberry-django                                     │
│                                                         │
│   Pulled in when the work touches a specific framework, │
│   database, or library. Not tied to a single phase.     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Recommended workflow

1. **Plan** with `angular-structure` or `react-structure` when scaffolding a new project or reshaping an existing one
2. **Write** with `secure-by-design-coding` active — security controls are embedded as you go
3. **Review** with `code-reviewer` + framework overlay — catch correctness, performance, and design issues
4. **Audit** with `security-auditor` — final security validation before deploy
5. **Maintain** with `library-updater` — periodic dependency audit that plans upgrades in safe waves

Reference skills (`postgres`, `graphene-django`, `strawberry-django`, `angular-security`, `react-security`) load automatically whenever the work touches their domain, regardless of which phase you're in.

## Installation

### Via `npx` (recommended)

No cloning required:

```bash
# Install all skills
npx skills add mamamou/ai-coding-skills

# Install a single skill
npx skills add mamamou/ai-coding-skills --skill code-reviewer

# Target a specific agent (e.g. Claude Code)
npx skills add mamamou/ai-coding-skills -a claude-code
```

### Manual copy

Skills live under `skills/<name>/`. Copy the directories you want into your agent's skills folder.

**Claude Code (project-specific):**

```bash
# Clone, then copy a single skill
cp -r /path/to/ai-coding-skills/skills/code-reviewer .claude/skills/

# Or copy all skills
for dir in /path/to/ai-coding-skills/skills/*/; do
  cp -r "$dir" .claude/skills/
done
```

**Global (available in all projects):**

```bash
cp -r /path/to/ai-coding-skills/skills/code-reviewer ~/.claude/skills/
```

## Key Features

- **Version-aware** — every skill gates rules by framework and runtime version (Angular 17–20+, Django 3–5, Node 18–22, React 17–19, Python 3.8–3.12)
- **OWASP 2025 aligned** — Top 10:2025, Proactive Controls 2024, ASVS 5.0, Secure-by-Design Framework
- **Code examples** — not just rules, but concrete patterns in TypeScript, Python, and framework-specific code
- **Anti-pattern tables** — quick-reference tables mapping bad patterns to secure alternatives with severity
- **Composable** — overlays extend the universal reviewer; skills chain together in a natural workflow
- **No overlap** — each skill has a clear scope and trigger. The universal reviewer doesn't duplicate overlay rules, the auditor doesn't duplicate the coding skill.

## Standards & References

| Standard                                                                                      | Version | Used by                                   |
| --------------------------------------------------------------------------------------------- | ------- | ----------------------------------------- |
| [OWASP Top 10](https://owasp.org/Top10/)                                                      | 2025    | security-auditor, code-reviewer           |
| [OWASP Proactive Controls](https://top10proactive.owasp.org/)                                 | 2024    | secure-by-design-coding                   |
| [OWASP Secure-by-Design Framework](https://owasp.org/www-project-secure-by-design-framework/) | 0.5.0   | secure-by-design-coding                   |
| [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)       | 5.0     | security-auditor, secure-by-design-coding |
| [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)                               | Latest  | All skills                                |

## License

MIT
