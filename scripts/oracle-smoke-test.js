'use strict';

/**
 * oracle-smoke-test.js - validates the local/Codex Oracle path.
 *
 * This smoke test does not require Claude Code's Task dispatcher. It checks
 * the index, master-agent installation, query ranking, and helper scripts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { loadIndex, selectAssets, DEFAULT_INDEX } = require('./oracle-query');

const HOME = os.homedir();
const CLAUDE_ROOT = path.join(HOME, '.claude');
const AGENTS_ROOT = path.join(CLAUDE_ROOT, 'agents');
const REQUIRED_SCRIPTS = [
  'scanner.js',
  'classifier.js',
  'gen-masters.js',
  'install-agents.js',
  'auto-rebuild.js',
  'optimizer.js',
  'oracle-query.js',
];

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

function checkScripts() {
  for (const script of REQUIRED_SCRIPTS) {
    const full = path.join(__dirname, script);
    assertCheck(fs.existsSync(full), `missing script: ${full}`);
  }
}

function checkIndex(idx) {
  assertCheck(idx.version === 2, 'oracle-index.json must use schema version 2');
  assertCheck(idx.stats && idx.stats.total > 0, 'index stats.total must be > 0');
  assertCheck(Array.isArray(idx.assets) && idx.assets.length === idx.stats.total, 'assets length must match stats.total');
  assertCheck(Array.isArray(idx.domains) && idx.domains.length === 20, 'index must contain 20 domains');
  assertCheck(idx.domains.every((d) => d.id && d.master_agent), 'all domains must include id and master_agent');
}

function checkAgents(idx) {
  assertCheck(fs.existsSync(AGENTS_ROOT), `agents directory not found: ${AGENTS_ROOT}`);
  const expected = idx.domains.map((d) => `${d.master_agent}.md`);
  const missing = expected.filter((file) => !fs.existsSync(path.join(AGENTS_ROOT, file)));
  assertCheck(missing.length === 0, `missing master agents: ${missing.join(', ')}`);
}

function checkQuery(idx) {
  const task = 'build a React dashboard with Stripe billing and Playwright tests';
  const result = selectAssets(idx, task, { limit: 5 });
  for (const domain of ['web-dev', 'testing-qa', 'finance-billing']) {
    assertCheck(result.domains.includes(domain), `query should include domain ${domain}`);
  }
  assertCheck(result.picks.length > 0, 'query should return at least one strong pick');
}

function checkAutoRebuild() {
  const full = path.join(__dirname, 'auto-rebuild.js');
  const result = spawnSync(process.execPath, [full], { encoding: 'utf8', timeout: 120000 });
  assertCheck(result.status === 0, `auto-rebuild failed: ${result.stderr || result.stdout}`);
}

function main() {
  const checks = [
    ['scripts present', () => checkScripts()],
    ['index valid', () => checkIndex(loadIndex(DEFAULT_INDEX))],
    ['master agents installed', () => checkAgents(loadIndex(DEFAULT_INDEX))],
    ['local query works', () => checkQuery(loadIndex(DEFAULT_INDEX))],
    ['auto-rebuild works', () => checkAutoRebuild()],
  ];

  const passed = [];
  for (const [label, fn] of checks) {
    fn();
    passed.push(label);
    console.log(`ok - ${label}`);
  }

  const idx = loadIndex(DEFAULT_INDEX);
  console.log(`\nOracle smoke test passed: ${idx.stats.total} assets, ${idx.domains.length} domains.`);
  return passed.length;
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`[oracle-smoke-test] failed: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main };
