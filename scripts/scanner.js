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
const CODEX_ROOT = path.join(HOME, '.codex');
const USER_AGENTS_ROOT = path.join(HOME, '.agents');
const INDEX_PATH = path.join(CLAUDE_ROOT, 'oracle-index.json');

const SKILLS_ROOTS = [
  path.join(CLAUDE_ROOT, 'skills'),
  path.join(CLAUDE_ROOT, 'skills', 'learned'),
  path.join(CLAUDE_ROOT, 'skills', 'imported'),
  path.join(CODEX_ROOT, 'skills'),
  path.join(USER_AGENTS_ROOT, 'skills'),
];
const AGENTS_ROOT = path.join(CLAUDE_ROOT, 'agents');
const PLUGINS_ROOT = path.join(CLAUDE_ROOT, 'plugins');
const PLUGIN_CACHE = path.join(PLUGINS_ROOT, 'cache');
const PLUGIN_REGISTRY = path.join(PLUGINS_ROOT, 'installed_plugins.json');
const SETTINGS_PATH = path.join(CLAUDE_ROOT, 'settings.json');

const HEAD_BYTES = 0; // 0 = read full file for richest semantic profile
const PREVIEW_CHARS = 3000;
const SUMMARY_CHARS = 600;
const MAX_TERMS = 32;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'before', 'by', 'for', 'from', 'if', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'use', 'using', 'when',
  'with', 'without', 'you', 'your',
  'o', 'os', 'a', 'as', 'ao', 'aos', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas',
  'no', 'nos', 'para', 'por', 'que', 'se', 'sem', 'ser', 'uma', 'um', 'uns', 'umas', 'quando',
  'como', 'com', 'ou', 'sua', 'seu', 'suas', 'seus',
]);
const HEADING_PRIORITY = /(when|use|invoke|procedure|workflow|process|checklist|steps|implementation|guidance|approach|constraints|guardrails|overview|summary|usage|how)/i;

function hashShort(s) {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
}

function safeRead(p, bytes) {
  try {
    if (bytes && bytes > 0) {
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

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9+#./:-]+/)
    .filter(Boolean)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOPWORDS.has(token));
}

function stripFrontmatter(content) {
  return String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function cleanText(text) {
  return String(text || '')
    .replace(/`{1,3}[^`]*`{1,3}/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, ' ')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text, maxChars) {
  const value = cleanText(text);
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function splitSections(content) {
  const body = stripFrontmatter(content);
  const lines = body.split(/\r?\n/);
  const sections = [];
  let current = { heading: 'overview', lines: [] };

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) {
      if (current.lines.length || current.heading !== 'overview') sections.push(current);
      current = { heading: match[2].trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length || current.heading !== 'overview') sections.push(current);
  return sections
    .map((section) => ({
      heading: section.heading,
      text: cleanText(section.lines.join('\n')),
    }))
    .filter((section) => section.text || section.heading !== 'overview');
}

function topTermsFromTexts(texts, limit = MAX_TERMS) {
  const freq = new Map();
  for (const text of texts) {
    for (const token of tokenize(text)) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

function summarizeBody(body, fallback = '') {
  const text = cleanText(body);
  if (!text) return truncate(fallback, SUMMARY_CHARS);
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (!paragraphs.length) return truncate(fallback, SUMMARY_CHARS);
  const preferred = paragraphs.find((part) => HEADING_PRIORITY.test(part)) || paragraphs[0];
  return truncate(preferred, SUMMARY_CHARS);
}

function collectSectionText(sections, pattern, limit = 2) {
  return sections
    .filter((section) => pattern.test(normalize(section.heading)))
    .slice(0, limit)
    .map((section) => truncate(section.text, PREVIEW_CHARS / 2))
    .filter(Boolean);
}

function buildSemanticProfile(content, frontmatter = {}) {
  const sections = splitSections(content);
  const body = stripFrontmatter(content);
  const overview = sections.find((section) => section.heading === 'overview')?.text || '';
  const objectives = collectSectionText(sections, /(goal|objective|purpose|aim|mission|overview|summary|about)/i, 4);
  const useWhen = [
    frontmatter.description || '',
    ...collectSectionText(sections, /(when|invoke|use|applies|fit|trigger|activate|call)/i, 8),
  ].filter(Boolean);
  const workflow = collectSectionText(sections, /(procedure|workflow|process|checklist|steps|implementation|flow|instruction|how)/i, 4);
  const constraints = collectSectionText(sections, /(constraints|guardrails|rules|policy|anti-pattern|safety|limit|boundary)/i, 3);
  const headings = sections.map((section) => section.heading).filter(Boolean).slice(0, 20);
  const capabilityTerms = topTermsFromTexts([
    frontmatter.name || '',
    frontmatter.description || '',
    overview,
    ...objectives,
    ...useWhen,
    ...workflow,
    ...constraints,
    ...headings,
  ]);
  const workflowTerms = topTermsFromTexts(workflow, 20);

  return {
    content_summary: summarizeBody(body, frontmatter.description || ''),
    content_preview: truncate(body, PREVIEW_CHARS),
    objectives: objectives.slice(0, 4),
    use_when: useWhen.slice(0, 8),
    workflow_terms: workflowTerms,
    capability_terms: capabilityTerms,
    section_keywords: topTermsFromTexts(headings, 16),
    constraint_terms: topTermsFromTexts(constraints, 12),
  };
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
  const semantic = buildSemanticProfile(head, fm);
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
    content_summary: semantic.content_summary,
    content_preview: semantic.content_preview,
    objectives: semantic.objectives,
    use_when: semantic.use_when,
    workflow_terms: semantic.workflow_terms,
    capability_terms: semantic.capability_terms,
    section_keywords: semantic.section_keywords,
    constraint_terms: semantic.constraint_terms,
    last_seen: null,
  };
}

function buildAgentAsset(agentMdPath, source) {
  const head = safeRead(agentMdPath, HEAD_BYTES);
  const fm = parseFrontmatter(head);
  const semantic = buildSemanticProfile(head, fm);
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
    content_summary: semantic.content_summary,
    content_preview: semantic.content_preview,
    objectives: semantic.objectives,
    use_when: semantic.use_when,
    workflow_terms: semantic.workflow_terms,
    capability_terms: semantic.capability_terms,
    section_keywords: semantic.section_keywords,
    constraint_terms: semantic.constraint_terms,
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
        const relativeToClaude = path.relative(CLAUDE_ROOT, root);
        const relativeToCodex = path.relative(CODEX_ROOT, root);
        const relativeToAgents = path.relative(USER_AGENTS_ROOT, root);
        let source = `user:${relativeToClaude}`;
        if (!relativeToCodex.startsWith('..')) source = `codex:${relativeToCodex}`;
        else if (!relativeToAgents.startsWith('..')) source = `agents:${relativeToAgents}`;
        out.push(buildSkillAsset(skillMd, source));
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
