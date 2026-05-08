# skill-oracle

<p align="center">
  <img src="assets/demo.svg" alt="skill-oracle demo" width="760"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Claude%20Code-orange?style=flat-square" alt="platform"/>
  <img src="https://img.shields.io/badge/license-MIT-22863a?style=flat-square" alt="license"/>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="node"/>
  <img src="https://img.shields.io/badge/zero%20dependencies-pure%20Node.js-blue?style=flat-square" alt="deps"/>
</p>

Claude Code loads around 32 skills at session start. If you have hundreds installed, most are invisible — Claude can’t invoke what it can’t see.

**skill-oracle breaks that limit.** It builds a searchable index of every skill you have — across all 3 skill roots — and lets Claude find the right one through semantic matching. It also silently checks the skills.sh ecosystem in parallel, surfacing alternatives only when they’re genuinely better than what you already have.

---

## How it works

**1. At session start** — `auto-rebuild.js` checks if your index is over 24 hours old. If so, it rebuilds silently in the background. Nothing interrupts your work.

**2. When you ask** — Claude reads the full index and matches semantically. Not by keyword. Not by exact name. By understanding what each skill *does* and whether it fits your task.

**3. In parallel** — `find-skills` checks the skills.sh ecosystem at the same time. If it finds something with meaningfully more installs or better coverage, it appears under “Also worth considering”. If not, nothing extra is shown — no noise.

---

## Installation

### Step 1 — Install the skill files

```bash
npx skills add Aleffsalmeida/skill-oracle
```

### Step 2 — Add the auto-rebuild hook *(one-time setup, ~30 seconds)*

Open `~/.claude/settings.json` and add the following inside your `"hooks"` section:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/skill-oracle/scripts/auto-rebuild.js",
            "timeout": 30,
            "async": true,
            "statusMessage": "Checking skill index..."
          }
        ]
      }
    ]
  }
}
```

This keeps your index fresh automatically every 24 hours. Without this hook, skill-oracle still works — you’ll just need to rebuild the index manually (Step 3) whenever you install new skills.

### Step 3 — Build the index for the first time

```bash
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

Expected output: `skill-oracle: indexed 86 skills → ~/.claude/skill-index.json`

---

> **Ecosystem enrichment** (the parallel search) requires the `find-skills` skill to be installed. Without it, skill-oracle still works — it just searches your local library only.

---

## Usage

Ask naturally — no special syntax needed:

```
is there a skill for deploying to Vercel?
do you have something for React testing?
what skill should I use to debug a memory leak?
```

Or invoke directly:

```
/skill-oracle deploy a Next.js app
/skill-oracle fix a memory leak in React
/skill-oracle --compare set up CI/CD pipeline
/skill-oracle --list
/skill-oracle --stats
/skill-oracle --rebuild
```

---

## Flags

| Flag | What it does |
|------|--------------|
| *(none)* | Search local library + silently enrich with ecosystem |
| `--compare` | Show **all** ecosystem results, not just the ones better than local |
| `--list` | List every indexed skill, grouped by root directory |
| `--stats` | Show total count, breakdown by root, and when the index was last built |
| `--rebuild` | Rebuild the index right now, without restarting the session |

---

## What gets indexed

| Root | What lives here |
|------|-----------------|
| `~/.claude/skills/` | Your primary installed skills |
| `~/.claude/skills/learned/` | Skills learned and saved from sessions |
| `~/.claude/skills/imported/` | Skills imported from external sources |

Claude Code’s built-in discovery misses the top-level root. skill-oracle covers all three.

---

## Ecosystem safety

When `find-skills` returns results, every skill is filtered before it’s shown to you. A skill only appears if it passes **all** of the following:

| Check | Requirement |
|-------|-------------|
| Install count | ≥ 1,000 preferred — always shown explicitly |
| GitHub stars | ≥ 500 required; blocked below 100 |
| Source | Official orgs (`vercel-labs`, `anthropics`) weighted higher |
| Author | Must be identifiable — anonymous is blocked |
| License | MIT, Apache 2.0, or BSD only |
| Last commit | Less than 6 months ago |
| Code | No `eval`, `base64 -d`, or unknown `curl \| sh` |

A skill only appears under “Also worth considering” if it clears all checks **and** offers something your local skills don’t already cover.

---

## Compatibility

| Platform | Status |
|----------|--------|
| Claude Code | ✅ Full support |
| Gemini CLI | ⚠️ Scripts work — no SKILL.md integration yet |
| GitHub Copilot CLI | ⚠️ Scripts work — no plugin integration yet |
| Any Node.js ≥ 18 | ✅ `build-index.js` runs anywhere |

The indexer and auto-rebuild scripts are pure Node.js with zero dependencies — they run on macOS, Linux, and Windows. The `/skill-oracle` slash command is currently Claude Code native.

---

## Rebuilding manually

```bash
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

---

## License

MIT — by [Aleffsalmeida](https://github.com/Aleffsalmeida)
