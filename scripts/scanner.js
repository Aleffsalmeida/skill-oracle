'use strict';

/**
 * Universal Scanner — discovers all Claude Code assets
 *   - Skills (SKILL.md): user dirs + plugin caches
 *   - Agents (.md):       user agents/ + plugin agents/
 *   - Plugins:            plugins/installed_plugins.json + plugin.json
 *   - MCP servers:        settings.json mcpServers
 *
 * Writes oracle-index.json v2 with sha256 hash per asset for delta detection.
 * Zero external deps. Streaming + bounded reads (no full content kept).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();
const CLAUDE_ROOT = path.join(HOME, '.claude');
const INDEX_PATH = path.join(CLAUDE_ROOT, 'oracle-index.json');

const SKILLS_ROOTS = [
  path.join(CLAUDE_ROOT, 'skills'),
  path.join(CLAUDE_ROOT, 'skills', 'learned'),
  path.join(CLAUDE_ROOT, 'skills', 'imported'),
];
const AGENTS_ROOT = path.join(CLAUDE_ROOT, 'agents');
const PLUGINS_ROOT = path.join(CLAUDE_ROOT, 'plugins');
const PLUGIN_CACHE = path.join(PLUGINS_ROOT, 'cache');
const PLUGIN_REGISTRY = path.join(PLUGINS_ROOT, 'installed_plugins.json');
const SETTINGS_PATH = path.join(CLAUDE_ROOT, 'settings.json');

const HEAD_BYTES = 4096; // read first 4KB of each .md — enough for frontmatter + heading

function hashShort(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function safeRead(p, bytes) {
  try {
    if (bytes) {
      const fd = fs.openSync(p, 'r');
      const buf = Buffer.alloc(bytes);
      const n = fs.readSync(fd, buf, 0, bytes, 0);
      fs.closeSync(fd);
      return buf.slice(0, n).toString('utf8');
    }
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v = line.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function walkSync(root, opts = {}) {
  const maxDepth = opts.maxDepth ?? 6;
  const filter = opts.filter ?? (() => true);
  const results = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory() && depth < maxDepth) {
        stack.push({ dir: full, depth: depth + 1 });
      } else if (ent.isFile() && filter(full, ent.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

// ---------- asset builders ----------

function buildSkillAsset(skillMdPath, source) {
  const head = safeRead(skillMdPath, HEAD_BYTES);
  const fm = parseFrontmatter(head);
  const dir = path.dirname(skillMdPath);
  return {
    id: `skill:${path.basename(dir)}`,
    type: 'skill',
    name: fm.name || path.basename(dir),
    description: (fm.description || '').slice(0, 400),
    path: skillMdPath,
    source,
    hash: hashShort(head),
    user_invocable: fm['user-invocable'] !== 'false',
    model: fm.model || null,
    last_seen: null,
  };
}

function buildAgentAsset(agentMdPath, source) {
  const head = safeRead(agentMdPath, HEAD_BYTES);
  const fm = parseFrontmatter(head);
  const name = fm.name || path.basename(agentMdPath, '.md');
  return {
    id: `agent:${name}`,
    type: 'agent',
    name,
    description: (fm.description || '').slice(0, 400),
    path: agentMdPath,
    source,
    hash: hashShort(head),
    user_invocable: true,
    model: fm.model || null,
    last_seen: null,
  };
}

function buildMcpAsset(name, def) {
  const sig = JSON.stringify(def || {});
  return {
    id: `mcp:${name}`,
    type: 'mcp',
    name,
    description: (def && def.description) || `MCP server: ${name}`,
    path: SETTINGS_PATH,
    source: 'settings.json#mcpServers',
    hash: hashShort(sig),
    user_invocable: false,
    command: (def && def.command) || null,
    last_seen: null,
  };
}

// ---------- discovery ----------

function discoverSkills() {
  const out = [];
  const seen = new Set();

  // User skill roots
  for (const root of SKILLS_ROOTS) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMd = path.join(root, e.name, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        const id = `skill:${e.name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(buildSkillAsset(skillMd, `user:${path.relative(CLAUDE_ROOT, root)}`));
      }
    }
  }

  // Plugin cache skills — walk deep
  if (fs.existsSync(PLUGIN_CACHE)) {
    const files = walkSync(PLUGIN_CACHE, {
      maxDepth: 8,
      filter: (full, name) => name === 'SKILL.md',
    });
    for (const skillMd of files) {
      const dir = path.dirname(skillMd);
      const skillName = path.basename(dir);
      const pluginFolder = path.relative(PLUGIN_CACHE, skillMd).split(path.sep)[1] || 'unknown';
      const id = `skill:${pluginFolder}/${skillName}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const asset = buildSkillAsset(skillMd, `plugin:${pluginFolder}`);
      asset.id = id;
      out.push(asset);
    }
  }

  return out;
}

function discoverAgents() {
  const out = [];
  const seen = new Set();

  // User agents
  if (fs.existsSync(AGENTS_ROOT)) {
    const files = walkSync(AGENTS_ROOT, {
      maxDepth: 4,
      filter: (full, name) => name.endsWith('.md'),
    });
    for (const f of files) {
      const asset = buildAgentAsset(f, 'user:agents');
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      out.push(asset);
    }
  }

  // Plugin cache agents
  if (fs.existsSync(PLUGIN_CACHE)) {
    const files = walkSync(PLUGIN_CACHE, {
      maxDepth: 8,
      filter: (full) => full.includes(`${path.sep}agents${path.sep}`) && full.endsWith('.md'),
    });
    for (const f of files) {
      const pluginFolder = path.relative(PLUGIN_CACHE, f).split(path.sep)[1] || 'unknown';
      const asset = buildAgentAsset(f, `plugin:${pluginFolder}`);
      asset.id = `agent:${pluginFolder}/${asset.name}`;
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      out.push(asset);
    }
  }

  return out;
}

function discoverPlugins() {
  const out = [];
  if (!fs.existsSync(PLUGIN_REGISTRY)) return out;
  let reg;
  try { reg = JSON.parse(safeRead(PLUGIN_REGISTRY)); } catch { return out; }
  const plugins = (reg && reg.plugins) || {};
  for (const [fqName, installs] of Object.entries(plugins)) {
    const [name] = fqName.split('@');
    const first = Array.isArray(installs) ? installs[0] : null;
    const installPath = first && first.installPath;
    const pluginJson = installPath ? path.join(installPath, '.claude-plugin', 'plugin.json') : null;
    let description = '';
    let version = (first && first.version) || null;
    if (pluginJson && fs.existsSync(pluginJson)) {
      try {
        const data = JSON.parse(safeRead(pluginJson));
        description = data.description || '';
        version = data.version || version;
      } catch { /* skip malformed */ }
    }
    out.push({
      id: `plugin:${name}`,
      type: 'plugin',
      name,
      description: description.slice(0, 400),
      path: installPath || PLUGIN_REGISTRY,
      source: 'plugins/installed_plugins.json',
      hash: hashShort(fqName + (version || '')),
      user_invocable: false,
      version,
      fq_name: fqName,
      last_seen: null,
    });
  }
  return out;
}

function discoverMcp() {
  const out = [];
  if (!fs.existsSync(SETTINGS_PATH)) return out;
  let settings;
  try { settings = JSON.parse(safeRead(SETTINGS_PATH)); } catch { return out; }
  const servers = (settings && settings.mcpServers) || {};
  for (const [name, def] of Object.entries(servers)) {
    out.push(buildMcpAsset(name, def));
  }
  return out;
}

// ---------- main ----------

function build() {
  const t0 = Date.now();
  const now = new Date().toISOString();

  const skills = discoverSkills();
  const agents = discoverAgents();
  const plugins = discoverPlugins();
  const mcps = discoverMcp();

  const assets = [...skills, ...agents, ...plugins, ...mcps];
  for (const a of assets) {
    a.last_seen = now;
    if (!('domain' in a)) a.domain = null;
    if (!('master_agent' in a)) a.master_agent = null;
    if (!('keywords' in a)) a.keywords = [];
  }

  const byType = {};
  for (const a of assets) byType[a.type] = (byType[a.type] || 0) + 1;

  const index = {
    version: 2,
    generated_at: now,
    build_ms: Date.now() - t0,
    stats: {
      total: assets.length,
      by_type: byType,
      by_domain: {},
      by_master: {},
    },
    domains: [],
    assets,
  };

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  return index;
}

if (require.main === module) {
  try {
    const idx = build();
    process.stdout.write(
      `oracle-scanner: ${idx.stats.total} assets indexed (` +
      `${idx.stats.by_type.skill || 0} skills, ` +
      `${idx.stats.by_type.agent || 0} agents, ` +
      `${idx.stats.by_type.plugin || 0} plugins, ` +
      `${idx.stats.by_type.mcp || 0} mcp) in ${idx.build_ms}ms → ${INDEX_PATH}\n`
    );
  } catch (e) {
    process.stderr.write(`[oracle-scanner] error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { build, discoverSkills, discoverAgents, discoverPlugins, discoverMcp };
