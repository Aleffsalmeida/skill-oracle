# skill-oracle

Claude Code can only see ~32 skills at session start. If you have hundreds installed, most are invisible — Claude can't invoke what it can't see.

skill-oracle fixes that. It indexes every skill you have installed and lets Claude find the right one for any task through semantic matching — not keyword search, not menus.

## How it works

The moment a session starts, skill-oracle checks whether your index is fresh. If it's been more than 24 hours since the last build, it silently rebuilds it in the background. No configuration. No commands to remember.

When you ask "is there a skill for X?" or invoke `/skill-oracle`, Claude reads the full index — all 3 skill roots, every installed skill — and reasons semantically about which ones fit. A skill about "React performance" surfaces for "why is my component re-rendering". A skill about "code review" surfaces for "check my PR before merging".

If you add `--compare`, it goes further: searches the [skills.sh](https://skills.sh) ecosystem and applies safety criteria before recommending anything from the internet.

## Installation

### Claude Code

```bash
npx skills add Aleffsalmeida/skill-oracle
```

Then add the SessionStart hook to `~/.claude/settings.json`:

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

### Manual

```bash
git clone https://github.com/Aleffsalmeida/skill-oracle ~/.claude/skills/skill-oracle
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

Then add the hook above to `~/.claude/settings.json`.

## Usage

```
/skill-oracle deploy a Next.js app to Vercel
/skill-oracle fix a memory leak in React
/skill-oracle --compare set up a CI/CD pipeline
```

Or just ask Claude naturally — *"is there a skill for X?"* and skill-oracle activates.

## What gets indexed

| Root | What lives here |
|------|----------------|
| `~/.claude/skills/` | Your primary skills |
| `~/.claude/skills/learned/` | Skills learned from sessions |
| `~/.claude/skills/imported/` | Skills imported from external sources |

ECC's built-in discovery misses the top-level root. skill-oracle covers all three.

## Ecosystem safety criteria

When using `--compare`, only skills that pass all of these get recommended:

- ≥ 500 GitHub stars on the source repo
- Open license (MIT, Apache 2.0, BSD)
- Author identifiable (not anonymous)
- Last commit < 6 months ago
- No obfuscated code (`eval`, `base64 -d`, unknown `curl | sh`)

## Zero dependencies

Pure Node.js. No `npm install`. YAML frontmatter parsed with regex. Works on macOS, Linux, and Windows.

## Index format

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

## Rebuilding manually

```bash
node ~/.claude/skills/skill-oracle/scripts/build-index.js
```

## License

MIT — by [Aleffsalmeida](https://github.com/Aleffsalmeida)
