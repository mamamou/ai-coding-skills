# Code Skills

A collection of production-grade [Claude Code Skills](https://code.claude.com/docs/en/skills) for code review, secure coding, and security auditing. Built by combining OWASP standards, real-world patterns, and battle-tested checklists into comprehensive, actionable skill definitions.

Compatible with **Claude Code** and any agent supporting the `SKILL.md` format.

## Skills

### Code Review

| Skill | Description | Size |
|---|---|---|
| [code-reviewer](code-reviewer/) | Universal code reviewer — correctness, security (OWASP 2025), performance, maintainability, tests, documentation. Foundation skill that all overlays extend. | 8 KB |
| [code-reviewer-angular](code-reviewer-angular/) | Angular overlay — version-aware rules for Angular 17–20+, signals, RxJS, SSR, NgRx, Material. Runs universal reviewer first, then applies Angular-specific checks. | 19 KB |
| [code-reviewer-django](code-reviewer-django/) | Django overlay — version-aware rules for Django 3–5, DRF, Celery, async ORM, Python 3.8–3.12. | 12 KB |
| [code-reviewer-node](code-reviewer-node/) | Node.js overlay — Express, JWT/OAuth, GraphQL/Apollo, BullMQ, TypeScript strict mode, Node 18–22. | 15 KB |
| [code-reviewer-react](code-reviewer-react/) | React overlay — React 17–19, hooks, RSC/Next.js App Router, TanStack Query, Zustand, React Hook Form. | 18 KB |

### Security

| Skill | Description | Size |
|---|---|---|
| [security-auditor](security-auditor/) | Post-hoc security audit with a threat-actor mindset. Three layers: OWASP Top 10:2025 static analysis, access control & authorization audit, pen test pattern recognition. Read-only — finds vulnerabilities, doesn't fix them. | 21 KB |
| [secure-by-design-coding](secure-by-design-coding/) | Proactive secure coding companion that embeds security controls while writing code. Based on OWASP Proactive Controls C1–C10 and the Secure-by-Design Framework. Writes secure code from the start instead of finding flaws after. | 32 KB |

## Architecture

```
code-skills/
├── code-reviewer/               # Universal foundation (all languages)
│   └── SKILL.md
├── code-reviewer-angular/       # Angular overlay (extends universal)
│   └── SKILL.md
├── code-reviewer-django/        # Django overlay (extends universal)
│   └── SKILL.md
├── code-reviewer-node/          # Node.js overlay (extends universal)
│   └── SKILL.md
├── code-reviewer-react/         # React overlay (extends universal)
│   └── SKILL.md
├── security-auditor/            # Dedicated security audit (read-only)
│   └── SKILL.md
└── secure-by-design-coding/     # Proactive secure coding (read + write)
    └── SKILL.md
```

### How they work together

```
┌─────────────────────────────────────────────────────────┐
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
│   OWASP Top 10:2025 + ASVS 5.0                         │
│   Read-only — reports findings, never modifies code     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Recommended workflow

1. **Write** with `secure-by-design-coding` active — security controls are embedded as you go
2. **Review** with `code-reviewer` + framework overlay — catch correctness, performance, and design issues
3. **Audit** with `security-auditor` — final security validation before deploy

## Installation

### Claude Code (project-specific)

Copy the desired skill directories into your project's `.claude/skills/` folder:

```bash
# Copy a single skill
cp -r /path/to/code-skills/code-reviewer .claude/skills/

# Or copy all skills
for dir in /path/to/code-skills/*/; do
  cp -r "$dir" .claude/skills/
done
```

### Global (available in all projects)

Copy skills into your global Claude Code skills directory:

```bash
cp -r /path/to/code-skills/code-reviewer ~/.claude/skills/
```

## Key Features

- **Version-aware** — every skill gates rules by framework and runtime version (Angular 17–20+, Django 3–5, Node 18–22, React 17–19, Python 3.8–3.12)
- **OWASP 2025 aligned** — Top 10:2025, Proactive Controls 2024, ASVS 5.0, Secure-by-Design Framework
- **Code examples** — not just rules, but concrete patterns in TypeScript, Python, and framework-specific code
- **Anti-pattern tables** — quick-reference tables mapping bad patterns to secure alternatives with severity
- **Composable** — overlays extend the universal reviewer; skills chain together in a natural workflow
- **No overlap** — each skill has a clear scope and trigger. The universal reviewer doesn't duplicate overlay rules, the auditor doesn't duplicate the coding skill.

## Standards & References

| Standard | Version | Used by |
|---|---|---|
| [OWASP Top 10](https://owasp.org/Top10/) | 2025 | security-auditor, code-reviewer |
| [OWASP Proactive Controls](https://top10proactive.owasp.org/) | 2024 | secure-by-design-coding |
| [OWASP Secure-by-Design Framework](https://owasp.org/www-project-secure-by-design-framework/) | 0.5.0 | secure-by-design-coding |
| [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) | 5.0 | security-auditor, secure-by-design-coding |
| [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) | Latest | All skills |

## License

MIT
