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
const { run: runBootstrap } = require('./oracle-bootstrap');
const { computeInventorySignature } = require('./scanner');

const ORACLE_INDEX = path.join(os.homedir(), '.claude', 'oracle-index.json');
const LEGACY_INDEX = path.join(os.homedir(), '.claude', 'skill-index.json');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const QUIET_MODE = process.env.ORACLE_QUIET_MODE !== '0';

function hasValidIndex(p) {
  if (!fs.existsSync(p)) return false;
  try {
    JSON.parse(fs.readFileSync(p, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

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

function inventoryChanged(p) {
  if (!fs.existsSync(p)) return true;
  try {
    const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
    return !idx.inventory_signature || idx.inventory_signature !== computeInventorySignature();
  } catch {
    return true;
  }
}

(async () => {
  try {
    const changed = inventoryChanged(ORACLE_INDEX);
    const stale = isStale(ORACLE_INDEX);

    if (QUIET_MODE && hasValidIndex(ORACLE_INDEX) && !changed && !stale) {
      return;
    }

    await runBootstrap({
      update: true,
      repair: true,
      forceRepair: changed || stale,
      installHook: false,
      quiet: QUIET_MODE,
    });
  } catch (e) {
    process.stderr.write(`[oracle] auto-rebuild error: ${e.message}\n`);
  }
})();
