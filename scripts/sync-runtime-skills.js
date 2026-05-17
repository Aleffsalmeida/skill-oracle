'use strict';

/**
 * Materialize cached plugin skills into the Codex runtime skill root.
 *
 * Oracle indexes plugin/cache skills, but Codex/Overclock only auto-invokes
 * skills that exist under the active runtime skill roots. This bridge copies
 * plugin-provided skill directories into ~/.codex/skills without overwriting
 * user-owned skills. Directories managed by this script carry an
 * .oracle-managed.json marker and can be refreshed on subsequent bootstraps.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();
const CLAUDE_ROOT = path.join(HOME, '.claude');
const CODEX_SKILLS_ROOT = process.env.ORACLE_CODEX_SKILLS_ROOT || path.join(HOME, '.codex', 'skills');
const PLUGIN_CACHE = path.join(CLAUDE_ROOT, 'plugins', 'cache');
const MARKETPLACES_ROOT = path.join(CLAUDE_ROOT, 'plugins', 'marketplaces');
const MANAGED_MARKER = '.oracle-managed.json';

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return '';
  }
}

function hashDirectory(dir) {
  const files = walk(dir)
    .filter((file) => path.basename(file) !== MANAGED_MARKER)
    .sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relative = path.relative(dir, file).replace(/\\/g, '/');
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(from, to);
      } catch (error) {
        if (error && error.code === 'ENOENT') continue;
        throw error;
      }
    }
  }
}

function sleepMs(ms) {
  const shared = new SharedArrayBuffer(4);
  const view = new Int32Array(shared);
  Atomics.wait(view, 0, 0, ms);
}

function removeDir(dir) {
  if (!fs.existsSync(dir)) return;
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return;
    } catch (error) {
      lastError = error;
      if (!error || !['ENOTEMPTY', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
      sleepMs(60 * (attempt + 1));
    }
  }
  if (lastError) throw lastError;
}

function parseFrontmatterName(skillMd) {
  const content = safeRead(skillMd);
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return path.basename(path.dirname(skillMd));
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key !== 'name') continue;
    return line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '') || path.basename(path.dirname(skillMd));
  }
  return path.basename(path.dirname(skillMd));
}

function skillNameToDir(name) {
  return String(name || '')
    .trim()
    .replace(/[\\/:]+/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function discoverSkillDirs() {
  const candidates = [];
  const roots = [PLUGIN_CACHE, MARKETPLACES_ROOT];
  for (const root of roots) {
    for (const skillMd of walk(root).filter((file) => path.basename(file) === 'SKILL.md')) {
      const dir = path.dirname(skillMd);
      const name = parseFrontmatterName(skillMd);
      const outputDirName = skillNameToDir(name);
      if (!outputDirName) continue;
      candidates.push({
        name,
        outputDirName,
        sourceDir: dir,
        source: path.relative(CLAUDE_ROOT, dir).replace(/\\/g, '/'),
        hash: hashDirectory(dir),
      });
    }
  }
  candidates.sort((a, b) => {
    if (a.outputDirName !== b.outputDirName) return a.outputDirName.localeCompare(b.outputDirName);
    return a.source.localeCompare(b.source);
  });
  return candidates;
}

function readMarker(dst) {
  const markerPath = path.join(dst, MANAGED_MARKER);
  try {
    return JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function writeMarker(dst, item) {
  const marker = {
    managed_by: 'skill-oracle',
    name: item.name,
    source: item.source,
    source_hash: item.hash,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dst, MANAGED_MARKER), JSON.stringify(marker, null, 2), 'utf8');
}

function syncRuntimeSkills(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  fs.mkdirSync(CODEX_SKILLS_ROOT, { recursive: true });

  const seen = new Set();
  const stats = {
    scanned: 0,
    installed: 0,
    updated: 0,
    skipped_existing: 0,
    skipped_duplicate: 0,
    skipped_missing: 0,
    unchanged: 0,
    dry_run: dryRun,
    root: CODEX_SKILLS_ROOT,
  };

  for (const item of discoverSkillDirs()) {
    stats.scanned += 1;
    if (seen.has(item.outputDirName)) {
      stats.skipped_duplicate += 1;
      continue;
    }
    seen.add(item.outputDirName);
    if (stats.installed + stats.updated >= limit) break;

    const dst = path.join(CODEX_SKILLS_ROOT, item.outputDirName);
    const marker = readMarker(dst);
    const exists = fs.existsSync(dst);
    if (exists && !marker) {
      stats.skipped_existing += 1;
      continue;
    }
    if (marker && marker.source_hash === item.hash && fs.existsSync(path.join(dst, 'SKILL.md'))) {
      stats.unchanged += 1;
      continue;
    }

    if (!dryRun) {
      removeDir(dst);
      copyDir(item.sourceDir, dst);
      if (!fs.existsSync(path.join(dst, 'SKILL.md'))) {
        removeDir(dst);
        stats.skipped_missing += 1;
        continue;
      }
      writeMarker(dst, item);
    }
    if (exists) stats.updated += 1;
    else stats.installed += 1;
  }

  return stats;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const json = argv.includes('--json');
  const limitFlag = argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitFlag ? Number(limitFlag.split('=')[1]) : Infinity;
  const stats = syncRuntimeSkills({ dryRun, limit });
  if (json) {
    process.stdout.write(JSON.stringify(stats, null, 2) + '\n');
  } else {
    process.stdout.write(
      `oracle runtime skill sync: scanned=${stats.scanned} installed=${stats.installed} updated=${stats.updated} unchanged=${stats.unchanged} skipped_existing=${stats.skipped_existing} skipped_duplicate=${stats.skipped_duplicate} skipped_missing=${stats.skipped_missing}\n`
    );
  }
}

module.exports = {
  syncRuntimeSkills,
};
