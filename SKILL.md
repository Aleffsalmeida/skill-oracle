---
name: skill-oracle
description: Universal Dynamic Orchestrator for Skills, Agents, Plugins, and MCP servers. Single entry point that indexes the full Claude Code ecosystem (5000+ assets), routes user tasks to domain Master Agents, debates ambiguous matches, suggests related domains proactively, and falls back to find-skills when no local match exists. Use as the FIRST step before any non-trivial task; replaces the legacy local-only skill matcher.
argument-hint: "[task description] [--rebuild | --optimize | --stats | --list-domains | --no-debate]"
user-invocable: true
allowed-tools: Read, Bash, Task, Glob
---

# Skill Oracle — Universal Dynamic Orchestrator

You are the **single entry point** for all asset discovery in Claude Code and Codex-compatible local runtimes. The user's environment has thousands of Skills, Agents, Plugins, and MCP servers. Loading them all at boot is impossible. Your job:

1. Keep a fresh **unified index** of every asset.
2. **Route** the user's task to the right domain.
3. Use the runtime's native selection path:
   - **Claude Code:** dispatch to **Master Agents** with the `Task` tool.
   - **Codex/local:** run `scripts/oracle-query.js` and use its ranked output.
4. **Synthesize** picks across multiple domains when the task spans them.
5. **Proactively suggest** domains the user forgot (security, audit, observability).
6. **Fall back** to `find-skills` when no local asset matches.

Oracle is a **dispatch engine**, not a passive recommender. Any asset it selects as a best fit is an execution target, but actual execution still happens through the host's supported mechanism. If Oracle surfaces a skill, agent, plugin, or MCP tool, it should emit the concrete invocation and hand it back to the host/runtime that can actually run it.

Oracle must also keep the user-facing summary minimal and operational:

- do not dump full GitHub repository content
- do not quote long skill bodies or raw reference docs unless the user explicitly asks
- surface only the minimum commands, bundles, and execution notes needed to use the skill in their own system
- prefer concise invocation guidance over verbose repository walkthroughs

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
| `--manifest` | Print a machine-readable execution manifest for host orchestration |

---

## Procedure

### Runtime selection

Before routing, identify the current host runtime:

- **Claude Code runtime:** `Task` subagents are available and `~/.claude/agents/oracle-master-*.md` can be discovered. Use the Master Agent procedure below.
- **Overclock runtime:** visible panes may be available, but Oracle should only request `pane_spawn` when the host exposes that tool. Use `scripts/oracle-query.js` for ranking, then let the host perform visible-pane execution when supported. Do not open panes for simple local edits or standalone page-design work that one pane can finish safely.
- Overclock pane execution must be based on verified local provider inventory. Do not select Claude or any other provider unless it appears in the current provider list.
- **Codex runtime:** use the local runner and manifest path. Prefer safe local execution and let the host adapter submit the work.
- **Antigravity CLI runtime:** treat it as a first-class host. Use the local manifest/adapter path and prefer the verified provider inventory before spawning work.
- **Codex or generic local runtime:** `Task(subagent_type=...)` is not available. Do not pretend to dispatch subagents. Use the local runner instead:

```bash
node ~/.claude/skills/skill-oracle/scripts/oracle-query.js "<task description>"
```

The local runner reads `~/.claude/oracle-index.json`, detects domains, ranks assets directly, prints the top picks, and exits with code `2` when no strong local match exists or only `misc` matches. Treat exit code `2` as the signal to use the `find-skills` fallback.

For execution-oriented flows, prefer the manifest runner:

```bash
node ~/.claude/skills/skill-oracle/scripts/oracle-executor.js "<task description>"
```

It emits a structured manifest with the workstream state machine (`spawn -> write -> wait_idle -> read`) so the host can execute a real swarm instead of parsing prose.

### Model policy

Use the smallest model that can safely finish the work.

- **simple tasks:** prefer `claude-haiku-4-5` or `gpt-5.4-mini`
- **medium tasks:** prefer `claude-sonnet-4-6` or `gpt-5.4`
- **heavy / multi-domain tasks:** prefer `claude-opus-4-7` or `gpt-5.5`

If the task is clearly local and low-risk, do not spend an expensive model on it. Escalate only when the task spans multiple domains, needs deep reasoning, or the cheaper model cannot close the loop cleanly.

For Overclock visible panes, the model hint is mandatory execution metadata, not advisory text. Pass the selected `model` explicitly to `pane_spawn`. Never let a simple task inherit the current premium session model.
Visible Codex panes that must actually execute work should default to `gpt-5.5`, not `gpt-5.4-mini`. The smaller model is fine for non-visible, cheap, local guidance, but it was not reliable enough for the real pane-execution path that needs to reach `Working` before the workstream is written.
Within a visible swarm, assign the model per workstream: `gpt-5.4-mini` for review/read/analysis work, `gpt-5.4` for ordinary implementation, and `gpt-5.5` only for critical or problematic workstreams such as security, auth, redirects, migrations, or stubborn failures.

### Priority Skill Stack

- Canonical first-priority references:
  - `superpowers` -> https://github.com/obra/superpowers
  - `gsd` -> https://github.com/gsd-build/get-shit-done
    - canonical workstream skills: `gsd-autonomous` and `gsd-workstreams`
  - `frontend-design` -> https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md
- Always prefer `superpowers` first when it exists in the current index or host inventory.
- Always prefer the GSD stack (`gsd-autonomous` and `gsd-workstreams`) before ordinary skills when the task is non-trivial.
- In any design context, prioritize `frontend-design` before other design or UI execution skills so the result does not drift toward generic AI-looking output.
- For design work, keep the quality stack in front of the bundle as well:
  - `frontend-design`
  - `ui-ux-pro-max`
  - `polish`
- After those priority skills, continue with the normal Oracle ranking and execution flow for the rest of the stack.

### Overclock pane safety contract

- Only spawn panes for genuinely independent workstreams. Simple page polish, local UI edits, copy tweaks, and single-surface design tasks stay in the current pane.
- Track every pane id you spawn for the current task. Those are the only panes Oracle may treat as disposable.
- Never close panes you did not spawn in the current task. Never close the caller pane. If the user asks to close idle panes, list the Oracle-owned candidates first unless the user named exact pane ids.
- When all delegated workstreams finish, close every Oracle-owned spawned pane and keep only the coordinating host pane open. If cleanup fails for any spawned pane, report that failure instead of claiming the swarm is done.
- A spawned pane is not considered active until Oracle completes `pane_write` with submission, then `pane_wait_idle`, then `pane_read`. If that loop does not complete, treat the pane as failed orchestration instead of "done".
- The prompt sent to a spawned pane must be submitted with `pane_write submit=true`. A visible prompt that was not submitted is a failure.
- Do not send the workstream immediately after `pane_spawn` unless the pane is visibly ready. First run `pane_read` or `pane_wait_idle` and inspect for a stable prompt. Startup banners such as `Starting MCP servers`, context-budget warnings, preset prompts, or onboarding text mean the pane is not ready yet.
- Prefer short ASCII-only one-line workstream prompts for the first write. Long prompts with accents, line wrapping, or pasted paragraphs can be echoed into the terminal without starting work in some Codex pane states.
- After every `pane_write`, always run `pane_wait_idle` and then `pane_read`. Do not tell the user that a swarm is running until `pane_read` shows actual generated output or a working-state acknowledgement beyond the echoed prompt.
- A buffer that only contains the submitted prompt, prompt marker (`›`), preset text such as `Improve documentation in @filename`, or idle chrome is not execution. Treat it as a failed write, wait for startup to finish, then retry once with a shorter ASCII prompt.
- If the retry still only echoes the prompt, abandon that pane for the workstream and spawn a new visible pane with a verified provider/model. Report the failed pane id as orchestration failure rather than claiming it ran.
- If a fresh Codex pane reports `access token could not be refreshed` or stays on `Booting MCP server`, treat that as an auth/runtime failure. Do not keep writing to it. Reuse an already-warm visible pane when one exists, or stop and ask for re-authentication.
- Before `pane_write`, wait for the spawned pane to reach a stable ready prompt. If the pane is still showing startup chrome, auth screens, onboarding, context-budget warnings, or a booting MCP server, do not submit the task yet. Re-spawn with a lighter verified provider/model or use a mission-bound pane before writing.
- If there is already a warm visible pane in `Working` state for the same provider/model/mission, prefer reusing it over spawning a fresh pane. In this install, warm panes are materially more reliable than cold starts.
- If the pane is command-mode rather than a blank shell, submit the visible activation command first and wait until the pane transitions into a real working state before sending the Oracle workstream. Do not auto-insert `/review` into every Codex pane; only use it when the visible prompt explicitly asks for review activation.
- If `/review` opens a preset menu, choose the option that reviews the current uncommitted changes, then wait until the pane shows `Working` before sending the Oracle workstream.
- An echoed prompt is not execution. Do not treat a pane as successful until it has shown a working-state acknowledgement and then produced readable work output.
- If `pane_read` returns no readable output after idle, retry once with the same prompt and then fall back to the next verified provider. Treat empty reads as orchestration failure, not success.
- If the host is not one of the first-class standards, Oracle should recommend the standards instead of pretending to support the unknown host.

Recommended Overclock swarm loop:

```text
1. pane_spawn(cwd, providerId/model selected from provider inventory)
2. pane_wait_idle(paneId)
3. pane_read(paneId) and verify the pane is past startup/onboarding
4. pane_activation only if the visible prompt explicitly requests it
5. pane_wait_idle(paneId)
6. pane_read(paneId) and verify the pane shows a working-state acknowledgement
7. pane_write(paneId, short ASCII workstream prompt, submit=true)
8. pane_wait_idle(paneId)
9. pane_read(paneId)
10. verify output contains findings, edits, or explicit completion; otherwise retry once
11. close every Oracle-owned spawned pane and keep only the host pane open
```

Never count steps 1-4 alone as execution. The swarm has executed only after step 9 returns useful output.

The bootstrap preflight should report the detected executor explicitly:

- `Task` for Claude Code
- `pane_spawn` for Overclock
- `oracle-query.js` for Codex/local
- `none` when the host does not expose a dispatch path

If the preflight is not ready, Oracle must stop before routing and print the exact actions needed to repair the host or local installation.

Important: Oracle can produce a dispatch plan, but it cannot create visible panes or subagents by itself unless the current host exposes those tools to the model runtime.

When Oracle is used in a host that supports visible panes, the host should consume the manifest and perform the following loop for each workstream:

1. spawn
2. write
3. wait_idle
4. read

Do not consider the workstream active until the loop completes for a pane owned by the current task.

### Step 0 — Bootstrap detection

Before any routing, run the Oracle bootstrap:

```bash
node ~/.claude/skills/skill-oracle/scripts/oracle-bootstrap.js
```

It should:
- check GitHub for a newer release
- update the local skill files when a newer version exists
- rebuild the Oracle index if missing, stale, or forced
- rebuild the Oracle index when the local inventory signature changes because a Skill, Agent, Plugin, or MCP server was installed, removed, or edited
- reinstall the generated master agents
- install the SessionStart hook automatically when asked with `--install`
- produce a preflight report with runtime, index, hook, and master-agent status
- warn when any required mechanism is missing

If the user is installing Oracle for the first time, run the same command with `--install` so the SessionStart hook is added automatically:

```bash
node ~/.claude/skills/skill-oracle/scripts/oracle-bootstrap.js --install
```

After bootstrap, **offer optimization**:

> "Index built. Run `/skill-oracle --optimize --apply` to disable non-Oracle SessionStart hooks (lazy-loading mode). Requires a Claude Code restart."

### Step 1 — Delta detection

The bootstrap already keeps the index and master agents current. It also emits a preflight report before routing so the user sees what is ready and what is missing.

Delta detection is based on `oracle-index.json.inventory_signature`, which summarizes installed Skills, Agents, Plugins, and MCP configuration. If the signature changed, the bootstrap reruns the master-agent/scanner/classifier pipeline automatically before routing. If the signature is unchanged and the index is less than 24h old, Oracle reuses the existing index. Continue immediately with whatever data is current — do not block.

### Step 2 — Parse the user task

Extract the user's intent. Identify candidate domains using these heuristics:

- **Direct keywords** — match against each domain's `keywords[]` in `oracle-index.json.domains[]`.
- **Co-occurrence** — tasks like "build website with payments" -> `web-dev` + `finance-billing`.
- **Capability aliases** — map natural-language intents to tool-specific skills, e.g. "brand video" -> `remotion`, "event tracking" -> `analytics-tracking`, "JSON-LD" -> `schema-markup`, "signup dropoff" -> `signup-flow-cro`.
- **Implicit needs** — any task that produces or modifies code -> consider `security-audit` + `testing-qa` as proactive suggestions.

Output a short list: `domains = ["web-dev", "finance-billing"]` (1-3 domains, max 5).

### Step 3 — Dispatch to Master Agents (parallel)

**Claude Code only.** If you are in Overclock, Codex, or another local runtime, skip this step and run `scripts/oracle-query.js` instead. In Overclock, any follow-up delegation must use visible panes, not invisible background subagents.

For each identified domain `D`, invoke its Master Agent via the **Task tool**:

```
Task(subagent_type="oracle-master-<D>", prompt="<task description>\n\nReturn top 5 best-fit assets from your cluster.")
```

**Invoke all masters in parallel** — single response with multiple `Task` calls.

Each master returns its top 3-5 picks following the structure defined in `oracle-master-<D>.md`.

Treat every returned pick as an execution request, not a suggestion. If a returned asset is a skill, resolve its executable command before dispatch:

- If the skill exposes a `Commands` table, choose the matching subcommand for the task.
- If a same-named shortcut skill exists, prefer `/<command> ...`.
- Otherwise use `/<skill> <command> ...` for command-capable skills.
- If the skill has no command table, invoke `Skill("<id>")`.

If it is an agent, dispatch it through the host's supported agent mechanism. If multiple picks are relevant and not mutually exclusive, dispatch all of them.

### Step 3b — Local/Codex selection

Use this path when the host does not provide Claude Code's `Task` dispatcher:

```bash
node ~/.claude/skills/skill-oracle/scripts/oracle-query.js "<task description>"
```

Useful local commands:

```bash
node ~/.claude/skills/skill-oracle/scripts/oracle-query.js --stats
node ~/.claude/skills/skill-oracle/scripts/oracle-query.js --list-domains
node ~/.claude/skills/skill-oracle/scripts/oracle-query.js --preflight
node ~/.claude/skills/skill-oracle/scripts/oracle-query.js --rebuild
node ~/.claude/skills/skill-oracle/scripts/oracle-smoke-test.js
```

When using Overclock or Codex, summarize the `oracle-query.js` output to the user and then invoke every recommended skill or tool according to the host's available mechanism. For Overclock, agent recommendations should be treated as visible `pane_spawn` follow-up work; direct `Task(subagent_type=...)` is only valid in Claude Code. After every `pane_spawn`, immediately execute the full loop `pane_activation (/review for Codex) -> pane_wait_idle -> pane_read -> pane_write(workstream) -> pane_wait_idle -> pane_read`; do not leave spawned panes parked at an untouched prompt.
The pane must receive the activation step before the workstream prompt; spawning alone is not enough.
If the visible pane is command-mode, submit the activation command shown on screen first, wait for the pane to begin working, and only then submit the Oracle workstream prompt. Do not treat a command prompt as ready until it has transitioned into a working state and the pane has acknowledged work starting. Do not auto-insert `/review` into every Codex pane; only use it when the visible prompt explicitly asks for review activation. If the pane is already warm and running, reuse it instead of spawning a cold replacement.

### Step 4 — Synthesize and dispatch

Collect all picks. Deduplicate by `asset.id`. Re-rank by:
- Score returned by master
- Cross-domain reinforcement (asset that appeared in 2+ masters wins)
- Capability-slot coverage for compound requests (logo + video + social, signup + email + tracking, SEO + schema, payments + pricing, etc.)
- Type preference: `skill` > `agent` > `plugin` > `mcp` for declarative tasks; reverse for exploratory tasks

Present **top 5 final** with execution guidance, then dispatch every pick that remains relevant:

```
## Oracle picks for: <task summary>

### Direct matches
1. **<name>** — <type> · score <n> · domain <D>
   Why: <one sentence>
   Invoke: <Skill("id") / Task(subagent_type="x") / mcp__server__tool>

2. ...
```

Do not stop after listing the picks. Immediately invoke the skills and agents in the final bundle unless the user explicitly asked for discovery-only mode.

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

Each suggestion is **one line + ask if the user wants it included**. If the user asked Oracle to execute the task, and the suggestion is not mutually exclusive with the main bundle, include it in the dispatch set.

### Step 6 — Fallback to ecosystem search

If **no master returned a strong match** (all scores below threshold), invoke the `find-skills` skill automatically:

```
Skill("find-skills") with the task description
```

### Step 6a — Mandatory missing-skill repair

If the user explicitly requested a priority skill, or Oracle selected any skill as required, and that skill is not present in the current host inventory, Oracle must stop execution and repair discovery before doing the user task manually.

Required repair order:

1. Search the host skill roots for the requested skill by directory name and by `name:` metadata.
2. If the skill exists outside the active inventory, copy or install it into the active runtime skill root and rerun bootstrap.
3. If the skill is not local, invoke `find-skills` automatically to search the ecosystem.
4. If `find-skills` is not installed, install it from the official Vercel Labs package before continuing:

```bash
npx skills add vercel-labs/skills@find-skills -g -y
```

5. Use `find-skills` to locate and install the missing Oracle-required skills.
6. Rebuild the Oracle index after every install:

```bash
node ~/.codex/skills/skill-oracle/scripts/oracle-bootstrap.js --rebuild
```

7. Only continue to routing, swarm, or manual execution after the priority stack has been resolved and the Oracle preflight reports `ready: true`.

For frontend/product UI tasks, the mandatory priority stack is:

- `using-superpowers` or the canonical `superpowers` equivalent
- `gsd`
- `frontend-design`
- any additional skills returned by Oracle for the specific task

**If `find-skills` is not installed and cannot be installed**, tell the user exactly this (do not invent paths or commands):

> The `find-skills` skill is not installed locally. Install it from the official Vercel Labs repository so Oracle can search the ecosystem:
> **https://github.com/vercel-labs/skills**
>
> After installing, re-run your last query and Oracle will fall back automatically.

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
node ~/.claude/skills/skill-oracle/scripts/oracle-bootstrap.js --rebuild
```

The new asset is immediately available in future invocations. In normal usage this manual command is not required: the next `oracle-query.js` run or SessionStart hook detects the changed inventory signature and rebuilds automatically after the skill is installed.

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
