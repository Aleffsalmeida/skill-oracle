'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const INDEX_PATH = path.join(os.homedir(), '.claude', 'skill-index.json');
const BUILD_SCRIPT = path.join(__dirname, 'build-index.js');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

try {
  let needsRebuild = true;

  if (fs.existsSync(INDEX_PATH)) {
    try {
      const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      const ageMs = Date.now() - Date.parse(index.generated_at);
      needsRebuild = Number.isNaN(ageMs) || ageMs > MAX_AGE_MS;
    } catch {
      needsRebuild = true;
    }
  }

  if (needsRebuild) {
    // spawnSync: no shell invocation, safe path args
    const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
      stdio: 'inherit',
      timeout: 30000,
    });
    if (result.error) {
      process.stderr.write(`[skill-oracle] rebuild failed: ${result.error.message}\n`);
    }
  }
} catch (e) {
  process.stderr.write(`[skill-oracle] auto-rebuild error: ${e.message}\n`);
}

process.exit(0);
