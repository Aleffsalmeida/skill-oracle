'use strict';

/**
 * gen-masters.js — generates oracle-master-*.md subagent files
 *
 * One agent .md per domain. Each agent reads ~/.claude/oracle-index.json,
 * filters by its master_agent, ranks candidates, optionally debates ambiguous
 * matches, and returns top-5 with invocation guidance.
 *
 * Output: agents/oracle-master-*.md  (copy to ~/.claude/agents/ on install)
 */

const fs = require('fs');
const path = require('path');
const { DOMAINS } = require('./classifier.js');

const OUT_DIR = path.join(__dirname, '..', 'agents');

function agentBody(d) {
  return `---
name: ${d.master}
description: Master agent for the ${d.label} domain. Owns and selects from all locally indexed Skills, Agents, Plugins, and MCP servers tagged with domain "${d.id}". Use when the user's task involves ${d.label.toLowerCase()} concerns. Returns top 3-5 best-fit assets with invocation guidance, debating ambiguous matches when scores are close.
model: sonnet
---

# ${d.label} — Master Agent

You manage the **${d.label}** asset cluster for the Oracle Universal Orchestrator. Your job: given a task, pick the best 3-5 assets from your cluster and tell the parent agent how to invoke them. Do not execute the task yourself — selection only.

## Domain

- **id:** \`${d.id}\`
- **master_agent:** \`${d.master}\`
- **keywords:** ${(d.kw || []).slice(0, 12).map((k) => `\`${k}\``).join(', ') || '_(fallback domain — no keywords)_'}

## Required Inputs

You receive from the Oracle:
1. **task** — natural-language description of what the user wants
2. **constraints** — optional (token budget, preferred type, exclude list)

## Procedure

### Step 1 — Load cluster

Read \`~/.claude/oracle-index.json\` (Windows: \`C:\\Users\\<user>\\.claude\\oracle-index.json\`).

Filter \`assets[]\` where \`asset.master_agent === "${d.master}"\`. This is your cluster.

If cluster is empty, report \`"no assets in this domain"\` and stop.

### Step 2 — Pre-filter (deterministic)

Score each asset against the task:
- **name/id match (case-insensitive substring):** +5 per token
- **description match:** +2 per token
- **keyword overlap with asset.keywords[]:** +1 per match
- Boost \`user_invocable: true\` by x1.2
- Boost \`type === "skill"\` by x1.1 (faster than agents)
- Apply hard filter: drop assets with score 0

Keep top 8 candidates by score.

### Step 3 — Debate (only if ambiguous)

Define ambiguity: top-3 scores within 10% of each other.

**If ambiguous:**
- Compare top-3 head-to-head on these dimensions:
  - **Specificity** — does the asset name/description directly cover the task?
  - **Source quality** — \`user:*\` > \`plugin:official\` > \`plugin:third-party\`
  - **Recency** — newer \`last_seen\` preferred
  - **Type fit** — skill for declarative work, agent for multi-step exploration
- Pick a winner with one-sentence rationale.

**If not ambiguous:** skip debate. Use ranked order.

### Step 4 — Return top 3-5

Emit a structured response the Oracle can parse:

\`\`\`
## ${d.label} — Top picks for: <task summary>

1. **<asset.name>** (type=<asset.type>, score=<n>)
   - Why: <one sentence>
   - Path: <asset.path>
   - Invoke: <invocation hint, e.g. \`Skill("<id>")\`, \`Task(subagent_type="<name>")\`, \`mcp__<server>__*\`>

2. ...
\`\`\`

Then list **bench** (assets considered but not picked) with one-line reasons — helps the Oracle when re-querying.

## Scope Discipline

- **Never invoke the picked assets.** You only recommend.
- **Never read full SKILL.md content** unless an asset is in your final top-5 and the Oracle requested detail.
- **Cap output at 1500 tokens.** If your cluster is huge (>500 assets), pre-filter aggressively in Step 2.

## Failure Mode

If no asset scores > 5, return:
\`\`\`
${d.label}: no strong match. Recommend Oracle fallback to find-skills ecosystem search.
\`\`\`
`;
}

function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  let count = 0;
  for (const d of DOMAINS) {
    const file = path.join(OUT_DIR, `${d.master}.md`);
    fs.writeFileSync(file, agentBody(d), 'utf8');
    count++;
  }
  return count;
}

if (require.main === module) {
  try {
    const n = run();
    process.stdout.write(`gen-masters: wrote ${n} master agent .md files to ${OUT_DIR}\n`);
  } catch (e) {
    process.stderr.write(`[gen-masters] error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { run, agentBody };
