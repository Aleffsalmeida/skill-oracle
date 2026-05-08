---
name: skill-oracle
description: Find the best skill for any task — searches your full local library (all 3 skill roots) AND silently checks the skills.sh ecosystem in parallel, surfacing only the best options from both. Use when you need to find the right skill, or when the user asks "is there a skill for X".
argument-hint: "[task description] [--compare | --list | --stats | --rebuild]"
user-invocable: true
allowed-tools: Read, Bash
---

# Skill Oracle

Finds the best skill for any task by searching your full local library and the skills.sh ecosystem simultaneously. Shows local results first, appends ecosystem options only when they offer something meaningfully better.

## When to Use

- User asks "is there a skill for X?" or "do you have a tool for X?"
- You want to verify the best skill before starting a complex task
- User asks "what skills do you have?" or "what can you do?"
- User says `/skill-oracle [task description]`

## Flags

| Flag | What it does |
|------|--------------|
| *(none)* | Search local + silently enrich with ecosystem |
| `--compare` | Show ALL ecosystem results, not just better ones |
| `--list` | List every indexed skill grouped by root |
| `--stats` | Total count, breakdown by root, last rebuild date |
| `--rebuild` | Force rebuild the index right now |

---

## Execution

### `--rebuild`

Run:
```bash
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```
Report how many skills were indexed.

### `--stats`

Read `~/.claude/skill-index.json` and report:
- Total skills indexed
- Count per root (`~/.claude/skills/`, `learned/`, `imported/`)
- `generated_at` timestamp and how many hours ago that was

### `--list`

Read `~/.claude/skill-index.json` and list every skill grouped by root:
```
~/.claude/skills/ (42 skills)
  • brainstorming — [description snippet]
  • gsd-ship — [description snippet]
  ...

~/.claude/skills/learned/ (12 skills)
  ...
```

### Standard search (default)

**Step 1 — Load the index**

Read `~/.claude/skill-index.json`.
On Windows: `C:\Users\<username>\.claude\skill-index.json`

If the file is missing, tell the user to run:
```bash
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

**Step 2 — Match local skills semantically**

For each skill in the index, score relevance by:
1. `description` — does it describe this type of task?
2. `when_to_use` — does it explicitly name this scenario?
3. `name` — does the name suggest this domain?

Use **semantic similarity**, not exact keywords. "React performance" matches "why is my component re-rendering". "Code review" matches "check my PR before merging".

**Step 3 — Show top local results immediately**

Present the top 3–5 matches:

```
## Skills Found for: [task summary]

### From your library

1. [skill name]
   Why: [one sentence explaining the match]
   Invoke: `/skill-name` or `Skill("skill-id")`

2. [skill name]
   ...
```

If no local skill matches well, note this clearly — do not fabricate a match.

**Step 4 — Enrich with ecosystem (always, silently)**

Always invoke `find-skills` to check the skills.sh ecosystem, regardless of whether a local match was found. Apply this logic:

| Situation | What to do |
|-----------|------------|
| Ecosystem skill has >2× installs of the best local match AND covers the task better | Append under **“Also worth considering”** |
| Ecosystem skill is essentially what’s already installed locally | Skip silently |
| No local match was found | Show ecosystem results as primary results |
| `--compare` flag used | Show ALL ecosystem results regardless of quality |

**Before showing any ecosystem skill, all safety criteria must pass:**

| Criterion | Requirement |
|-----------|-------------|
| Install count | ≥ 1,000 preferred; always show the number explicitly |
| GitHub stars | ≥ 500 required; block if < 100 |
| Source reputation | Official orgs (`vercel-labs`, `anthropics`) weighted higher |
| Author | Must be identifiable — anonymous = blocked |
| License | MIT, Apache 2.0, or BSD only |
| Last commit | < 6 months ago |
| Code safety | No `eval`, `base64 -d`, or unknown `curl \| sh` in scripts |

**Never recommend an ecosystem skill that fails any criterion.**

**Step 5 — Final output**

```
## Skills Found for: [task]

### From your library
1. [name] — [why it fits]
   Invoke: `/name`

2. [name] — [why it fits]
   Invoke: `/name`

### Also worth considering    ← only if ecosystem has something better
↗ [ecosystem-skill]  (12,500 installs · 890★ · vercel-labs)
   What it adds: [what this offers that local skills don’t]
   Install: `npx skills add owner/repo@skill-name`
```

If the ecosystem adds nothing new: **omit the section entirely**. No mention, no noise.

---

## Index Format Reference

```json
{
  "generated_at": "ISO timestamp",
  "total": 86,
  "skills": [
    {
      "id": "skill-dir-name",
      "name": "Display Name",
      "description": "up to 350 chars",
      "when_to_use": "up to 400 chars",
      "path": "/absolute/path",
      "has_scripts": true,
      "user_invocable": true,
      "model": null
    }
  ]
}
```

## Notes

- Index covers 3 roots: `~/.claude/skills/`, `~/.claude/skills/learned/`, `~/.claude/skills/imported/`
- ECC’s built-in discovery misses the top-level root — skill-oracle covers all three
- Skills with `user-invocable: false` are indexed but shown only when directly relevant
- Ecosystem enrichment requires the `find-skills` skill to be installed
- The index is a snapshot — new skills installed after last rebuild won’t appear until rebuilt
