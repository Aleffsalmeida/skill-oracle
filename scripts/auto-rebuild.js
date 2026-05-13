'use strict';

/**
 * auto-rebuild.js — SessionStart hook entry point.
 *
 * If the oracle-index.json is missing or > 24h old, runs the unified
 * pipeline:  scanner.js -> classifier.js
 *
 * Legacy: also keeps the old skill-index.json fresh for backward compat
 * with skill-only consumers.
 *
 * Silent: never blocks session start. Logs to stderr on failure only.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ORACLE_INDEX = path.join(os.homedir(), '.claude', 'oracle-index.json');
const LEGACY_INDEX = path.join(os.homedir(), '.claude', 'skill-index.json');
const SCANNER = path.join(__dirname, 'scanner.js');
const CLASSIFIER = path.join(__dirname, 'classifier.js');
const LEGACY_BUILDER = path.join(__dirname, 'build-index.js');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isStale(p) {
  if (!fs.existsSync(p)) return true;
  try {
    const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
    const ageMs = Date.now() - Date.parse(idx.generated_at);
    return Number.isNaN(ageMs) || ageMs > MAX_AGE_MS;
  } catch {
    return true;
  }
}

function spawn(script) {
  return spawnSync(process.execPath, [script], { stdio: 'inherit', timeout: 60000 });
}

try {
  if (isStale(ORACLE_INDEX)) {
    const a = spawn(SCANNER);
    if (a.error) process.stderr.write(`[oracle] scanner failed: ${a.error.message}\n`);
    const b = spawn(CLASSIFIER);
    if (b.error) process.stderr.write(`[oracle] classifier failed: ${b.error.message}\n`);
  }

  if (fs.existsSync(LEGACY_BUILDER) && isStale(LEGACY_INDEX)) {
    const c = spawn(LEGACY_BUILDER);
    if (c.error) process.stderr.write(`[oracle] legacy build-index failed: ${c.error.message}\n`);
  }
} catch (e) {
  process.stderr.write(`[oracle] auto-rebuild error: ${e.message}\n`);
}

process.exit(0);
