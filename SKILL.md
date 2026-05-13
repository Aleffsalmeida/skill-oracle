---
name: skill-oracle
description: Universal Dynamic Orchestrator for Skills, Agents, Plugins, and MCP servers. Single entry point that indexes the full Claude Code ecosystem (5000+ assets), routes user tasks to domain Master Agents, debates ambiguous matches, suggests related domains proactively, and falls back to find-skills when no local match exists. Use as the FIRST step before any non-trivial task; replaces the legacy local-only skill matcher.
argument-hint: "[task description] [--rebuild | --optimize | --stats | --list-domains | --no-debate]"
user-invocable: true
allowed-tools: Read, Bash, Task, Glob
---

# Skill Oracle — Universal Dynamic Orchestrator

You are the **single entry point** for all asset discovery in Claude Code. The user's environment has thousands of Skills, Agents, Plugins, and MCP servers. Loading them all at boot is impossible. Your job:

1. Keep a fresh **unified index** of every asset.
2. **Route** the user's task to the right **Master Agent** (one per domain).
3. Let each Master Agent **debate internally** and return only the top 3-5 picks.
4. **Synthesize** picks across multiple domains when the task spans them.
5. **Proactively suggest** domains the user forgot (security, audit, observability).
6. **Fall back** to `find-skills` when no local asset matches.

---

## When to Invoke

- User asks "is there a skill / tool / agent / plugin for X?"
- Before any non-trivial task — discover the best available asset before doing the work manually.
- User says `/skill-oracle <task>` or `/skill-oracle` alone (general status).
- Another agent calls `Skill("skill-oracle")`.

---

## Flags

| Flag | Purpose |
|------|---------|
| *(none)* | Standard: route task to master agents and return picks |
| `--rebuild` | Force re-scan + re-classify; produces fresh `oracle-index.json` |
| `--optimize` | Run environment optimizer (lazy-loading) — dry-run by default; pass `--apply` to write |
| `--stats` | Show counts: total assets, by type, by domain, last build time |
| `--list-domains` | List all 20 domains with asset counts and master agent names |
| `--no-debate` | Skip Step 3 debate; return ranked candidates as-is (cheapest path) |

---

## Procedure

### Step 0 — Bootstrap detection

Check whether `~/.claude/oracle-index.json` exists. Path on Windows: `C:\Users\<user>\.claude\oracle-index.json`.

**If missing or `--rebuild`:**

Run the full bootstrap pipeline:

```bash
node ~/.claude/skills/skill-oracle/scripts/scanner.js     # builds index
node ~/.claude/skills/skill-oracle/scripts/classifier.js  # assigns domains + masters
node ~/.claude/skills/skill-oracle/scripts/gen-masters.js # regenerates agent .md files
```

Then copy `agents/*.md` to `~/.claude/agents/` so the Task tool can discover them:

```bash
node ~/.claude/skills/skill-oracle/scripts/install-agents.js
```

After bootstrap, **offer optimization**:

> "Index built. Run `/skill-oracle --optimize --apply` to disable non-Oracle SessionStart hooks (lazy-loading mode). Requires a Claude Code restart."

### Step 1 — Delta detection

Index exists. Read its `generated_at`. If > 24h old, silently run `scanner.js` + `classifier.js` in background (or invoke `scripts/auto-rebuild.js`). Continue immediately with whatever data is current — do not block.

### Step 2 — Parse the user task

Extract the user's intent. Identify candidate domains using these heuristics:

- **Direct keywords** — match against each domain's `keywords[]` in `oracle-index.json.domains[]`.
- **Co-occurrence** — tasks like "build website with payments" -> `web-dev` + `finance-billing`.
- **Implicit needs** — any task that produces or modifies code -> consider `security-audit` + `testing-qa` as proactive suggestions.

Output a short list: `domains = ["web-dev", "finance-billing"]` (1-3 domains, max 5).

### Step 3 — Dispatch to Master Agents (parallel)

For each identified domain `D`, invoke its Master Agent via the **Task tool**:

```
Task(subagent_type="oracle-master-<D>", prompt="<task description>\n\nReturn top 5 best-fit assets from your cluster.")
```

**Invoke all masters in parallel** — single response with multiple `Task` calls.

Each master returns its top 3-5 picks following the structure defined in `oracle-master-<D>.md`.

### Step 4 — Synthesize

Collect all picks. Deduplicate by `asset.id`. Re-rank by:
- Score returned by master
- Cross-domain reinforcement (asset that appeared in 2+ masters wins)
- Type preference: `skill` > `agent` > `plugin` > `mcp` for declarative tasks; reverse for exploratory tasks

Present **top 5 final** with invocation guidance:

```
## Oracle picks for: <task summary>

### Direct matches
1. **<name>** — <type> · score <n> · domain <D>
   Why: <one sentence>
   Invoke: <Skill("id") / Task(subagent_type="x") / mcp__server__tool>

2. ...
```

### Step 5 — Proactive consulting (gap analysis)

After main picks, scan for **forgotten domains**:

| If task involves | Suggest |
|------------------|---------|
| Code changes / new feature | `security-audit`, `testing-qa` |
| User-facing UI | `design-ui`, `data-analytics` |
| Production deploy | `observability`, `devops-infra` |
| Data handling | `database-data`, `security-audit` (privacy) |
| Payments / billing | `security-audit` (PCI), `finance-billing` |
| Multi-step automation | `tooling-meta`, `productivity` |

Output as:

```
### You may also want
> `security-audit` (oracle-master-security) — your task touches auth flows; recommend a review pass.
> `testing-qa` (oracle-master-testing) — new code without tests usually regresses.
```

Each suggestion is **one line + ask if the user wants it included**. Don't dispatch automatically.

### Step 6 — Fallback to ecosystem search

If **no master returned a strong match** (all scores below threshold), invoke the `find-skills` skill automatically:

```
Skill("find-skills") with the task description
```

Apply the same safety criteria the legacy oracle used:

| Criterion | Requirement |
|-----------|-------------|
| Install count | >= 1,000 preferred; show explicitly |
| GitHub stars | >= 500 required; < 100 blocked |
| License | MIT, Apache 2.0, BSD only |
| Last commit | < 6 months |
| Code safety | No `eval`, `base64 -d`, no unknown `curl \| sh` |
| Author | Identifiable (not anonymous) |

When a found-skills result passes all checks AND the user accepts, **auto-index it**:

```bash
node ~/.claude/skills/skill-oracle/scripts/scanner.js
node ~/.claude/skills/skill-oracle/scripts/classifier.js
```

The new asset is immediately available in future invocations.

---

## Flag handlers (shortcut paths)

### `--stats`

Read `oracle-index.json`. Report:

```
Oracle index: <total> assets indexed at <generated_at> (<ago>)
  by type: <skills> skills, <agents> agents, <plugins> plugins, <mcp> mcp
  top 8 domains:
    <domain>: <count>
    ...
```

### `--list-domains`

Read `oracle-index.json.domains[]`. Print all 20 in a table: `id | label | master_agent | asset_count`.

### `--rebuild`

Run Step 0 bootstrap pipeline. Confirm new counts.

### `--optimize`

Run the optimizer:

```bash
node ~/.claude/skills/skill-oracle/scripts/optimizer.js          # dry-run
node ~/.claude/skills/skill-oracle/scripts/optimizer.js --apply  # write changes
```

If user passes `--apply`, the optimizer creates `settings.json.oracle-<UTC>.bak` and moves non-Oracle SessionStart hooks to `_oracle_disabled_hooks[]` for safe reversal. Tell the user to **restart Claude Code**.

### `--no-debate`

Pass `constraints: { no_debate: true }` when invoking master agents. They skip Step 3 (debate) and return ranked top-5 directly. Cheaper, less precise.

---

## Index Schema Reference

```jsonc
{
  "version": 2,
  "generated_at": "ISO-8601",
  "stats": {
    "total": 5152,
    "by_type": { "skill": 4184, "agent": 384, "plugin": 573, "mcp": 11 },
    "by_domain": { "web-dev": 412 },
    "by_master": { "oracle-master-web": 412 }
  },
  "domains": [
    { "id": "web-dev", "label": "Web Development", "master_agent": "oracle-master-web", "asset_count": 412 }
  ],
  "assets": [
    {
      "id": "skill:<plugin>/<name>",
      "type": "skill | agent | plugin | mcp",
      "name": "...",
      "description": "<= 400 chars",
      "path": "<absolute>",
      "source": "user:* | plugin:* | settings.json#mcpServers",
      "hash": "<12-char sha256 prefix — delta detection>",
      "user_invocable": true,
      "model": null,
      "domain": "web-dev",
      "master_agent": "oracle-master-web",
      "keywords": ["react", "nextjs"],
      "last_seen": "ISO-8601"
    }
  ]
}
```

---

## Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Index missing | First run | Run `--rebuild` |
| Master agent not found | `agents/` not synced | Re-run `install-agents.js`; manually copy `agents/oracle-master-*.md` to `~/.claude/agents/` |
| No domain matched | Niche task | Falls back to `find-skills` (Step 6) |
| Index stale (> 24h) | auto-rebuild hook missing | Add the auto-rebuild SessionStart hook (see README) |
| Optimization rolled back | Wrong hook disabled | Restore from `settings.json.oracle-<UTC>.bak`, edit `KEEP_HOOK_PATTERNS` in `scripts/optimizer.js` |

---

## Scope Discipline

- **Oracle never executes the user task.** It selects and dispatches.
- **Never read full SKILL.md content** of every asset — read only those returned in top-5 if depth is requested.
- **Cap final output at 2000 tokens** — concise picks with paths and invocation hints only.
- **One master per domain, one domain per asset** — no overlap, no duplication.

---

## Notes

- The Oracle replaces the legacy `build-index.js` (skill-only, schema v1). The new pipeline is `scanner.js` -> `classifier.js` -> master agents.
- `build-index.js` is kept for backward compatibility but is deprecated.
- Bootstrap detection makes the Oracle self-installing: invoking `/skill-oracle` on a fresh checkout builds everything needed on first run.
- For the find-skills ecosystem fallback to work, install the `find-skills` skill separately.
