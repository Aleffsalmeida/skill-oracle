---
name: skill-oracle
description: Find the best locally installed skill for any task. Reads ~/.claude/skill-index.json and semantically matches against task context. Use when you need to discover which skill to invoke, when the user asks "is there a skill for X", or when you want to verify you're using the right tool before starting a complex task.
argument-hint: "[task description or project context]"
user-invocable: true
allowed-tools: Read, Bash
---

# Skill Oracle

Finds the best locally installed skill for any task using semantic matching against the local skill index. Falls back to ecosystem search when no local skill matches.

## When to Use

Use this skill when:
- User asks "is there a skill for X" or "do you have a tool for X"
- You want to verify the best skill before starting a complex task
- User asks "what skills do you have" or "what can you do"
- You're about to start a non-trivial task and want to check if a specialized skill exists
- User says `/skill-oracle [task description]`

## Instructions

### Step 1 — Load the Index

Read the skill index:

```
~/.claude/skill-index.json
```

On Windows: `C:\Users\<username>\.claude\skill-index.json`

Use the `Read` tool with the absolute path. If the file doesn't exist, tell the user to run:
```
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

### Step 2 — Semantic Matching

Read the full `skills` array from the index. For each skill, evaluate relevance based on:

1. **`description`** — does it describe this type of task?
2. **`when_to_use`** — does it explicitly cover this scenario?
3. **`name`** — does the name suggest this domain?

Score conceptually — look for **semantic similarity**, not just keyword overlap. A skill about "React performance" is relevant to "why is my component re-rendering". A skill about "code review" is relevant to "check my PR before merging".

### Step 3 — Output Top Results

Present the **top 3–5 matches** in this format:

```
## Skills Found for: [task summary]

### 1. [skill name]
**Match reason:** [why this fits — 1 sentence]
**Invocation:** `/skill-name` or `Skill("skill-id")`
**Path:** [skill path]

### 2. [skill name]
...
```

**If no local skills match well** (confidence is low or none are clearly relevant), proceed to Step 4 automatically. Do NOT tell the user "no skill found" before searching the ecosystem.

### Step 4 — Ecosystem Search (automatic fallback or `--compare`)

Triggered automatically when no strong local match exists, OR when user adds `--compare`.

1. Invoke the `find-skills` skill to search the skills.sh ecosystem
2. **Apply ALL safety criteria below** before presenting any result — never recommend a skill that fails any criterion
3. Present ecosystem results clearly labeled as "from the ecosystem — not yet installed"
4. If local skill is sufficient, say so and skip ecosystem recommendation

#### Safety Criteria (mandatory — all must pass)

| Criterion | Requirement |
|-----------|-------------|
| Install count | ≥ 1,000 installs preferred; be explicit about low install counts |
| GitHub stars | ≥ 500 stars on source repo; < 100 stars = do not recommend |
| Source reputation | Official sources (`vercel-labs`, `anthropics`, known orgs) carry more weight |
| Author | Identifiable — not anonymous |
| License | Open: MIT, Apache 2.0, or BSD only |
| Recency | Last commit < 6 months ago |
| Code safety | No obfuscated code: no `eval`, no `base64 -d` in scripts, no unknown `curl \| sh` |

**When presenting an ecosystem skill, always show:**
- Install count and star count explicitly
- Source/author
- The install command
- Any safety concern if borderline (e.g. "low install count — proceed with caution")

**Never recommend if:**
- Author is anonymous or unverifiable
- Any obfuscated code pattern is present
- License is proprietary or missing
- Repo has < 100 stars AND < 500 installs

## Index Format Reference

```json
{
  "generated_at": "ISO timestamp",
  "total": 42,
  "skills": [
    {
      "id": "skill-dir-name",
      "name": "Display Name",
      "description": "up to 350 chars",
      "when_to_use": "up to 400 chars",
      "path": "/absolute/path/to/skill",
      "has_scripts": true,
      "user_invocable": true,
      "model": null
    }
  ]
}
```

## Rebuilding the Index

If the index is stale or missing:

```bash
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

The index auto-rebuilds at session start if > 24h old (via SessionStart hook in `~/.claude/settings.json`).

## Notes

- Index covers all 3 skill roots: `~/.claude/skills/`, `~/.claude/skills/learned/`, `~/.claude/skills/imported/`
- Skills with `user-invocable: false` are indexed but not shown to users by default — include them only when directly relevant
- The index is a snapshot; new skills installed after last rebuild won't appear until rebuild
- Ecosystem search via `find-skills` requires the `find-skills` skill to be installed
