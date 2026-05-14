'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const HOME = os.homedir();
const CLAUDE_ROOT = path.join(HOME, '.claude');
const INDEX_PATH = path.join(CLAUDE_ROOT, 'oracle-index.json');
const SETTINGS_PATH = path.join(CLAUDE_ROOT, 'settings.json');
const LOCAL_MANIFEST_PATH = path.join(REPO_ROOT, 'oracle-manifest.json');
const REMOTE_MANIFEST_URL = 'https://raw.githubusercontent.com/Aleffsalmeida/skill-oracle/main/oracle-manifest.json';
const REMOTE_RAW_BASE = 'https://raw.githubusercontent.com/Aleffsalmeida/skill-oracle/main';
const BOOTSTRAP_SCRIPTS = ['scanner.js', 'classifier.js', 'gen-masters.js', 'install-agents.js'];
const SESSION_HOOK_COMMAND = 'node ~/.claude/skills/skill-oracle/scripts/auto-rebuild.js';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10000;
const REQUIRED_MASTER_COUNT = 20;

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeVersion(version) {
  const parts = String(version || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) parts.push(0);
  return parts.map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(a, b) {
  const left = normalizeVersion(a);
  const right = normalizeVersion(b);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

function isIndexFresh() {
  if (!fs.existsSync(INDEX_PATH)) return false;
  const idx = readJson(INDEX_PATH, null);
  if (!idx || !idx.generated_at) return false;
  const ageMs = Date.now() - Date.parse(idx.generated_at);
  return Number.isFinite(ageMs) && ageMs <= MAX_AGE_MS;
}

function detectRuntime() {
  const env = process.env;
  const hints = [
    ['overclock', env.OVERCLOCK_APP || env.OVERCLOCK_WORKSPACE || fs.existsSync(path.join(HOME, '.overclock-app'))],
    ['codex', env.CODEX_HOME || env.CODEX],
    ['claude-code', env.CLAUDE_CODE || env.CLAUDE_HOME || fs.existsSync(CLAUDE_ROOT)],
  ];

  for (const [runtime, hit] of hints) {
    if (hit) return runtime;
  }

  return 'unknown';
}

function countInstalledMasters() {
  try {
    return fs.readdirSync(path.join(CLAUDE_ROOT, 'agents'))
      .filter((file) => file.startsWith('oracle-master-') && file.endsWith('.md')).length;
  } catch (_error) {
    return 0;
  }
}

function buildPreflightReport() {
  const indexExists = fs.existsSync(INDEX_PATH);
  const settingsExists = fs.existsSync(SETTINGS_PATH);
  const settings = settingsExists ? readJson(SETTINGS_PATH, null) : null;
  const runtime = detectRuntime();
  const remoteManifest = readJson(LOCAL_MANIFEST_PATH, null);
  const mastersInstalled = countInstalledMasters();
  const hookInstalled = settings ? sessionHookExists(settings) : false;
  const indexFresh = isIndexFresh();

  return {
    runtime,
    index_exists: indexExists,
    index_fresh: indexFresh,
    settings_exists: settingsExists,
    session_hook_installed: hookInstalled,
    masters_installed: mastersInstalled,
    masters_expected: REQUIRED_MASTER_COUNT,
    manifest_version: remoteManifest?.version || '0.0.0',
    ready: indexExists && indexFresh && hookInstalled && mastersInstalled >= REQUIRED_MASTER_COUNT,
    warnings: [
      !indexExists ? 'Oracle index is missing.' : null,
      !indexFresh ? 'Oracle index is stale or invalid.' : null,
      !settingsExists ? '~/.claude/settings.json is missing.' : null,
      settingsExists && !hookInstalled ? 'Oracle SessionStart hook is missing.' : null,
      mastersInstalled < REQUIRED_MASTER_COUNT ? `Only ${mastersInstalled}/${REQUIRED_MASTER_COUNT} Oracle master agents are installed.` : null,
      runtime === 'unknown' ? 'Runtime could not be identified from local environment hints.' : null,
    ].filter(Boolean),
  };
}

function sessionHookExists(settings) {
  const sessionStarts = ((settings.hooks || {}).SessionStart) || [];
  for (const group of sessionStarts) {
    for (const hook of group.hooks || []) {
      const command = String(hook.command || '').toLowerCase();
      if (command.includes('skill-oracle/scripts/auto-rebuild.js')) {
        return true;
      }
    }
  }
  return false;
}

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

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const res = await fetch(url, {
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}

function scriptPath(name) {
  return path.join(__dirname, name);
}

function runScript(name, args = []) {
  const full = scriptPath(name);
  const result = spawnSync(process.execPath, [full, ...args], { stdio: 'inherit', timeout: 120000 });
  if (result.error) {
    throw new Error(`${name} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
}

async function downloadManifestFile(relativePath) {
  const safePath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const localPath = path.join(REPO_ROOT, safePath);
  const remoteUrl = `${REMOTE_RAW_BASE}/${safePath}`;
  const content = await fetchText(remoteUrl);
  ensureDir(localPath);
  fs.writeFileSync(localPath, content, 'utf8');
  return { path: localPath, url: remoteUrl };
}

async function syncRemoteManifest(manifest) {
  const paths = Array.isArray(manifest.paths) ? manifest.paths : [];
  for (const relativePath of paths) {
    await downloadManifestFile(relativePath);
  }
  return paths.length;
}

function ensureSessionHook() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    return { applied: false, reason: 'settings.json not found' };
  }

  const original = readJson(SETTINGS_PATH, null);
  if (!original) {
    throw new Error(`settings.json is malformed at ${SETTINGS_PATH}`);
  }

  if (sessionHookExists(original)) {
    return { applied: false, reason: 'already installed' };
  }

  const next = JSON.parse(JSON.stringify(original));
  next.hooks = next.hooks || {};
  next.hooks.SessionStart = next.hooks.SessionStart || [];
  next.hooks.SessionStart.push({
    hooks: [
      {
        type: 'command',
        command: SESSION_HOOK_COMMAND,
        timeout: 60,
        async: true,
        statusMessage: 'Checking Oracle index...'
      }
    ]
  });

  const backup = `${SETTINGS_PATH}.oracle-${nowStamp()}.bak`;
  fs.copyFileSync(SETTINGS_PATH, backup);
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');

  return { applied: true, backup_path: backup };
}

async function fetchRemoteManifestSafe(warnings) {
  try {
    return { manifest: await fetchJson(REMOTE_MANIFEST_URL), error: null };
  } catch (error) {
    return { manifest: null, error: error.message };
  }
}

function getLocalManifest() {
  const manifest = readJson(LOCAL_MANIFEST_PATH, null);
  return manifest && manifest.version ? manifest : { version: '0.0.0', paths: [] };
}

async function run(options = {}) {
  const {
    update = true,
    repair = true,
    forceRepair = false,
    installHook = false,
    preflightOnly = false,
    quiet = false,
  } = options;

  const warnings = [];
  const actions = {
    updated: false,
    repaired: false,
    hookInstalled: false,
    updateFrom: null,
    updateTo: null,
    remoteFetchError: null,
  };

  const localManifest = getLocalManifest();
  const remoteState = update ? await fetchRemoteManifestSafe(warnings) : { manifest: null, error: null };
  const remoteManifest = remoteState.manifest;
  actions.remoteFetchError = remoteState.error;
  const preflight = buildPreflightReport();

  if (remoteManifest && compareVersions(remoteManifest.version, localManifest.version) > 0 && !preflightOnly) {
    await syncRemoteManifest(remoteManifest);
    actions.updated = true;
    actions.updateFrom = localManifest.version;
    actions.updateTo = remoteManifest.version;
  }

  const manifestToUse = remoteManifest || localManifest;
  const needRepair = repair && !preflightOnly && (forceRepair || !isIndexFresh() || actions.updated);

  if (needRepair) {
    for (const script of BOOTSTRAP_SCRIPTS) {
      runScript(script);
    }
    actions.repaired = true;
  }

  if (installHook && !preflightOnly) {
    const hookResult = ensureSessionHook();
    actions.hookInstalled = hookResult.applied;
    if (hookResult.applied && hookResult.backup_path) {
      actions.backupPath = hookResult.backup_path;
    }
  } else {
    const settings = readJson(SETTINGS_PATH, null);
    if (!settings) {
      warnings.push('Oracle SessionStart hook could not be verified because ~/.claude/settings.json is missing.');
    } else if (!sessionHookExists(settings)) {
      warnings.push('Oracle SessionStart hook is not installed. Run `node ~/.claude/skills/skill-oracle/scripts/oracle-bootstrap.js --install` once to enable automatic preflight.');
    }
  }

  return {
    local_version: localManifest.version,
    remote_version: remoteManifest && remoteManifest.version ? remoteManifest.version : localManifest.version,
    manifest_version: manifestToUse.version || localManifest.version,
    actions,
    preflight,
    warnings,
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const installHook = argv.includes('--install');
  const noUpdate = argv.includes('--no-update');
  const noRepair = argv.includes('--no-repair');
  const preflightOnly = argv.includes('--preflight');
  const quiet = argv.includes('--quiet');

  run({
    update: !noUpdate,
    repair: !noRepair,
    installHook,
    preflightOnly,
    quiet,
  }).then((out) => {
    if (!quiet) {
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      if (out.preflight) {
        process.stdout.write(`[oracle-bootstrap] runtime: ${out.preflight.runtime}\n`);
        process.stdout.write(`[oracle-bootstrap] ready: ${out.preflight.ready ? 'yes' : 'no'}\n`);
        if (out.preflight.warnings.length) {
          process.stdout.write(`[oracle-bootstrap] missing: ${out.preflight.warnings.join(' | ')}\n`);
        }
      }
      if (out.actions.updated) {
        process.stdout.write(`[oracle-bootstrap] updated from ${out.actions.updateFrom} to ${out.actions.updateTo}\n`);
      }
      if (out.actions.hookInstalled) {
        process.stdout.write(`[oracle-bootstrap] installed SessionStart hook${out.actions.backupPath ? ` (backup: ${out.actions.backupPath})` : ''}\n`);
      }
      for (const warning of out.warnings) {
        process.stdout.write(`[oracle-bootstrap] warning: ${warning}\n`);
      }
    }
  }).catch((error) => {
    process.stderr.write(`[oracle-bootstrap] error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  compareVersions,
  ensureSessionHook,
  isIndexFresh,
  run,
  sessionHookExists,
};
