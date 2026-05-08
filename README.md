# skill-oracle

A Claude Code skill that breaks the **~32 skill visibility ceiling** — indexes all locally installed skills and enables semantic discovery across your entire collection.

## The Problem

Claude Code's `available_skills` section shows ~32 skills at session start (roughly 1% of the context window floor). If you have hundreds or thousands of skills installed, most are invisible — Claude can't invoke what it can't see.

## How It Works

1. **`build-index.js`** scans all 3 skill roots and writes `~/.claude/skill-index.json`
2. **`auto-rebuild.js`** runs at session start via a `SessionStart` hook — rebuilds if index is > 24h stale
3. When invoked, Claude reads the full index and performs **semantic matching** to surface the best skill for any task

## Installation

```bash
npx skills add Aleffsalmeida/skill-oracle
```

Or manually:

```bash
git clone https://github.com/Aleffsalmeida/skill-oracle ~/.claude/skills/skill-oracle
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

Then add the `SessionStart` hook to `~/.claude/settings.json`:

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

## Usage

```
/skill-oracle deploy a Next.js app to Vercel
/skill-oracle --compare fix a memory leak in React
```

Or just ask Claude: *"is there a skill for X?"* — skill-oracle activates automatically.

## Skill Roots Covered

| Root | Description |
|------|-------------|
| `~/.claude/skills/` | Primary skills |
| `~/.claude/skills/learned/` | Skills learned from sessions |
| `~/.claude/skills/imported/` | Skills imported from external sources |

## Ecosystem Comparison

Add `--compare` to also search the [skills.sh](https://skills.sh) ecosystem. Safety criteria applied automatically:
- ≥ 500 GitHub stars
- Open license (MIT, Apache 2.0, BSD)
- Author identifiable
- Last commit < 6 months ago
- No obfuscated code (`eval`, `base64 -d`, unknown `curl | sh`)

## Index Format

```json
{
  "generated_at": "2026-01-01T00:00:00.000Z",
  "total": 86,
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

## Zero Dependencies

Pure Node.js — no `npm install` needed. YAML frontmatter parsed with regex.

## License

MIT
