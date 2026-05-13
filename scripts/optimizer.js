'use strict';

/**
 * optimizer.js — environment optimizer for lazy-loading Claude Code.
 *
 * Strategy:
 *   - SessionStart hooks: keep oracle/system-critical, disable others
 *   - mcpServers: report-only (do not auto-disable; user judgment required)
 *
 * Default: dry-run (prints diff). Use --apply to write changes.
 *
 * Safety: always writes settings.json.oracle-<UTC-stamp>.bak before changes.
 * Reversible: disabled hooks are moved to `_oracle_disabled_hooks` (not deleted).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

// Hooks we keep — oracle bootstrap + commonly-needed system hooks.
// Match against the command string (substring, case-insensitive).
const KEEP_HOOK_PATTERNS = [
  'skill-oracle/scripts/auto-rebuild',
  'skill-oracle/scripts/scanner',
  'oracle-bootstrap',
];

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    '-' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds())
  );
}

function shouldKeepHook(hookEntry) {
  const cmd = (hookEntry && hookEntry.command) || '';
  const lc = cmd.toLowerCase();
  return KEEP_HOOK_PATTERNS.some((p) => lc.includes(p.toLowerCase()));
}

function analyze(settings) {
  const sessionStarts = ((settings.hooks || {}).SessionStart) || [];
  const candidates = [];
  for (const group of sessionStarts) {
    const inner = (group && group.hooks) || [];
    for (const h of inner) {
      if (!shouldKeepHook(h)) candidates.push(h);
    }
  }
  const mcp = settings.mcpServers || {};
  return {
    session_start_total: sessionStarts.reduce((n, g) => n + ((g.hooks || []).length), 0),
    session_start_disable: candidates.length,
    candidates_hooks: candidates.map((h) => ({
      command: h.command || '(no command)',
      timeout: h.timeout,
      async: !!h.async,
    })),
    mcp_total: Object.keys(mcp).length,
    mcp_names: Object.keys(mcp),
  };
}

function applyOptimization(settings) {
  const next = JSON.parse(JSON.stringify(settings));
  next.hooks = next.hooks || {};
  const sessionStarts = next.hooks.SessionStart || [];

  const keptGroups = [];
  const disabled = [];

  for (const group of sessionStarts) {
    const innerKept = [];
    for (const h of (group.hooks || [])) {
      if (shouldKeepHook(h)) innerKept.push(h);
      else disabled.push(h);
    }
    if (innerKept.length) keptGroups.push(Object.assign({}, group, { hooks: innerKept }));
  }

  next.hooks.SessionStart = keptGroups;

  next._oracle_disabled_hooks = next._oracle_disabled_hooks || [];
  for (const h of disabled) {
    next._oracle_disabled_hooks.push({
      stage: 'SessionStart',
      disabled_at: new Date().toISOString(),
      hook: h,
    });
  }

  return next;
}

function run({ apply = false } = {}) {
  if (!fs.existsSync(SETTINGS)) {
    throw new Error(`settings.json not found at ${SETTINGS}`);
  }
  const original = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  const report = analyze(original);

  if (!apply) {
    return { mode: 'dry-run', report, applied: false };
  }

  if (report.session_start_disable === 0) {
    return { mode: 'apply', report, applied: false, reason: 'nothing to disable' };
  }

  const backup = `${SETTINGS}.oracle-${nowStamp()}.bak`;
  fs.copyFileSync(SETTINGS, backup);

  const next = applyOptimization(original);
  fs.writeFileSync(SETTINGS, JSON.stringify(next, null, 2), 'utf8');

  return {
    mode: 'apply',
    report,
    applied: true,
    backup_path: backup,
    restart_required: true,
  };
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  try {
    const out = run({ apply });
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    if (out.applied) {
      process.stdout.write('\n[oracle-optimizer] settings.json optimized. RESTART Claude Code to apply.\n');
      process.stdout.write(`[oracle-optimizer] backup: ${out.backup_path}\n`);
    } else if (apply) {
      process.stdout.write('\n[oracle-optimizer] nothing changed.\n');
    } else {
      process.stdout.write('\n[oracle-optimizer] dry-run only. Pass --apply to write changes.\n');
    }
  } catch (e) {
    process.stderr.write(`[oracle-optimizer] error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { run, analyze, applyOptimization };
