'use strict';

/**
 * install-agents.js — copy generated oracle-master-*.md files
 * from <skill-oracle>/agents/ into ~/.claude/agents/
 * so the Task tool can discover them as subagents.
 *
 * Idempotent. Overwrites only oracle-master-* files (never touches user agents).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(__dirname, '..', 'agents');
const DST = path.join(os.homedir(), '.claude', 'agents');

function run() {
  if (!fs.existsSync(SRC)) throw new Error(`No agents source dir at ${SRC}. Run gen-masters.js first.`);
  if (!fs.existsSync(DST)) fs.mkdirSync(DST, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(SRC)) {
    if (!f.startsWith('oracle-master-') || !f.endsWith('.md')) continue;
    fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
    copied++;
  }
  return { copied, dst: DST };
}

if (require.main === module) {
  try {
    const r = run();
    process.stdout.write(`install-agents: copied ${r.copied} master agents to ${r.dst}\n`);
  } catch (e) {
    process.stderr.write(`[install-agents] error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { run };
