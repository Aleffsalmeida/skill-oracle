'use strict';

/**
 * oracle-query.js - local/Codex-compatible Oracle runner.
 *
 * This script executes the Oracle selection path without Claude Code's Task
 * subagent dispatcher. It reads ~/.claude/oracle-index.json, detects relevant
 * domains from a natural-language task, ranks assets directly, and prints the
 * execution bundle. It is intentionally deterministic and dependency-free.
 *
 * When oracle-embeddings.json exists and an API key is configured, semantic
 * embedding similarity is used to augment keyword-based domain detection and
 * asset scoring (hybrid: keyword score + embedding bonus).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { run: runBootstrap } = require('./oracle-bootstrap');

const HOME = os.homedir();
const DEFAULT_INDEX = path.join(HOME, '.claude', 'oracle-index.json');
const EMBED_INDEX = path.join(HOME, '.claude', 'oracle-embeddings.json');
const OVERCLOCK_APPDATA_DIR = path.join(HOME, 'AppData', 'Roaming', 'Overclock');
const OVERCLOCK_PROVIDERS_PATH = path.join(OVERCLOCK_APPDATA_DIR, 'providers.json');
const OVERCLOCK_MCP_CONFIG_PATH = path.join(OVERCLOCK_APPDATA_DIR, 'mcp-config.json');
const OVERCLOCK_MAIN_LOG_PATH = path.join(OVERCLOCK_APPDATA_DIR, 'logs', 'main.log');
const SYNTHESIS_MODEL = process.env.ORACLE_SYNTHESIS_MODEL || 'gpt-5.4-mini';
const OUTPUT_PROBE_SENTINEL = process.env.ORACLE_OUTPUT_PROBE || 'PING_OMEGA_123';
const STRONG_MATCH_THRESHOLD = 5;
const MAX_DOMAINS = 5;
const DEFAULT_LIMIT = 5;
const MIN_TOKEN_LENGTH = 3;
const SHORT_TOKEN_ALLOWLIST = new Set(['ai', 'ml', 'ui', 'ux', 'qa', '3d']);
const STRONG_AUTHOR_SOURCES = ['agents:', 'codex:', 'user:'];
const PROVIDER_KEY_ALIASES = {
  claude: 'claude-oauth',
  'claude-oauth': 'claude-oauth',
  codex: 'codex-cli',
  'codex-cli': 'codex-cli',
  gemini: 'gemini-cli',
  'gemini-cli': 'gemini-cli',
  kimi: 'kimi-cli',
  'kimi-cli': 'kimi-cli',
  antigravity: 'antigravity-cli',
  'antigravity-cli': 'antigravity-cli',
  mimo: 'mimo-DMlOoB',
  'mimo-dmloob': 'mimo-DMlOoB',
};
const PREFERRED_EXECUTION_PROVIDER_ORDER = [
  'codex-cli',
  'gemini-cli',
  'kimi-cli',
  'antigravity-cli',
  'mimo-DMlOoB',
  'claude-oauth',
];
const FIRST_CLASS_HOSTS = new Set(['overclock', 'claude-code', 'codex', 'antigravity']);
const PREFERRED_SKILLS = new Set([
  'skill-oracle',
  'using-superpowers',
  'superpowers',
  'gsd',
  'gsd-autonomous',
  'gsd-workstreams',
  'awesome-design-md',
  'ui-ux-pro-max',
  'impeccable',
  'polish',
  'motion',
  'imagegen-frontend-web',
  'imagegen-frontend-mobile',
  'high-end-visual-design',
  'emil-design-eng',
  'design-taste-frontend',
  'frontend-design',
  'shadcn-ui',
  'react:components',
  'supabase',
  'postgres-patterns',
  'playwright',
]);
const GENERIC_QUERY_TOKENS = new Set(['app', 'skill', 'plugin', 'agent', 'tool', 'tools']);
const NOISY_PRODUCT_TOKENS = new Set(['pro', 'max', 'plus']);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'of', 'on', 'or', 'the', 'to', 'with', 'without', 'using', 'use',
  'o', 'os', 'a', 'as', 'de', 'da', 'das', 'do', 'dos', 'e', 'em', 'na',
  'nas', 'no', 'nos', 'para', 'por', 'com', 'sem', 'um', 'uma', 'uns',
  'umas', 'ao', 'aos', 'que', 'como',
  'relacao', 'relação', 'related', 'relation',
]);
const ACTION_WORDS = new Set([
  'add', 'build', 'change', 'create', 'fix', 'implement', 'make', 'need',
  'setup', 'update', 'write',
  'melhorar', 'corrigir', 'criar', 'fazer', 'ajustar', 'usar', 'quero',
]);
const NEGATION_CUES = new Set([
  'without', 'except', 'excluding', 'exclude', 'not',
  'sem', 'exceto', 'excluir', 'excluindo', 'nao', 'não',
]);
const NEGATION_BREAKS = new Set([
  'but', 'then', 'with', 'using',
  'mas', 'entao', 'então', 'com', 'usando',
]);
const HARNESS_DIRS = [
  '.claude', '.cursor', '.gemini', '.codex', '.agents',
  '.trae', '.trae-cn', '.pi', '.opencode', '.kiro', '.rovodev',
];
const PIN_MARKER = '<!-- impeccable-pinned-skill -->';
const COMMAND_INTENTS = [
  { command: 'craft', re: /\b(craft|build|create|make|implement|compose)\b/ },
  { command: 'shape', re: /\b(shape|brief|plan|define)\b/ },
  { command: 'teach', re: /\b(teach|context|setup|prepare)\b/ },
  { command: 'document', re: /\b(document|docs|doc|write up)\b/ },
  { command: 'extract', re: /\b(extract|pull out|tokens|components)\b/ },
  { command: 'critique', re: /\b(critique|review)\b/ },
  { command: 'audit', re: /\b(audit|a11y|accessibility|performance|responsive|checks?)\b/ },
  { command: 'polish', re: /\b(polish|refine|cleanup|clean up|improve|tighten|smooth)\b/ },
  { command: 'bolder', re: /\b(bolder|louder|dramatic|more expressive)\b/ },
  { command: 'quieter', re: /\b(quieter|subtle|tone down|less intense)\b/ },
  { command: 'distill', re: /\b(distill|simplify|reduce|essence)\b/ },
  { command: 'harden', re: /\b(harden|edge cases|production|robust)\b/ },
  { command: 'onboard', re: /\b(onboard|empty state|first run|activation)\b/ },
  { command: 'animate', re: /\b(animate|motion|transition|micro-interaction)\b/ },
  { command: 'colorize', re: /\b(color|palette|theme)\b/ },
  { command: 'typeset', re: /\b(typography|type|font|text)\b/ },
  { command: 'layout', re: /\b(layout|spacing|grid|rhythm|arrange|page|screen|responsive)\b/ },
  { command: 'delight', re: /\b(delight|personality|surprise)\b/ },
  { command: 'overdrive', re: /\b(overdrive|extreme|ambitious)\b/ },
  { command: 'clarify', re: /\b(clarify|copy|label|labels|error)\b/ },
  { command: 'adapt', re: /\b(adapt|mobile|desktop|responsive)\b/ },
  { command: 'optimize', re: /\b(optimize|performance|perf)\b/ },
  { command: 'live', re: /\b(live|browser)\b/ },
];

function findLocalSkill(name) {
  const roots = [
    path.join(HOME, '.claude', 'skills'),
    path.join(HOME, '.codex', 'skills'),
    path.join(HOME, '.agents', 'skills'),
  ];
  for (const root of roots) {
    const skillPath = path.join(root, name, 'SKILL.md');
    if (fs.existsSync(skillPath)) return skillPath;
  }
  return null;
}

function findProjectRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    if (
      fs.existsSync(path.join(dir, '.git')) ||
      fs.existsSync(path.join(dir, 'package.json')) ||
      fs.existsSync(path.join(dir, 'skills-lock.json'))
    ) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return path.resolve(startDir);
}

function skillRootCandidates(projectRoot = findProjectRoot()) {
  const roots = new Set([
    path.join(HOME, '.claude', 'skills'),
    path.join(HOME, '.codex', 'skills'),
    path.join(HOME, '.agents', 'skills'),
  ]);
  for (const harness of HARNESS_DIRS) {
    roots.add(path.join(projectRoot, harness, 'skills'));
  }
  return Array.from(roots).filter((root) => fs.existsSync(root));
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_error) {
    return '';
  }
}

function parseSkillCommands(skillText) {
  const lines = String(skillText || '').split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => /^\s*##+\s+Commands\b/i.test(line));
  if (sectionStart === -1) return [];
  const start = lines.findIndex((line, index) => index > sectionStart && /^\s*\|\s*Command\s*\|/i.test(line));
  if (start === -1) return [];

  const commands = [];
  for (let i = start + 2; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || !line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const rawName = cells[0].replace(/`/g, '').trim();
    const name = rawName.split(/\s+/)[0];
    if (!name || /^-+$/.test(name)) continue;
    commands.push({
      name,
      category: cells[1] || '',
      description: cells[2] || '',
      reference: cells[3] || '',
    });
  }
  return commands;
}

function normalizeTaskTarget(task) {
  const text = String(task || '').trim();
  const pathMatch = text.match(/(?:[A-Za-z]:\\|\.{1,2}[\\/]|[A-Za-z]:\/|[^\s"'`]+\.[A-Za-z0-9]{2,})(?:[^\s"'`)]*)?/);
  if (pathMatch && pathMatch[0]) return pathMatch[0].replace(/[.,;:]+$/, '');
  const quoted = text.match(/["'`](.+?)["'`]/);
  if (quoted && quoted[1]) return quoted[1].trim();
  return '';
}

function selectSkillCommand(commands, task, skillName = '') {
  if (!Array.isArray(commands) || commands.length === 0) return null;
  const text = normalize(task);
  const tokens = positiveTokens(task);
  let best = null;

  for (const command of commands) {
    let score = 0;
    const name = normalize(command.name);
    const description = normalize(command.description);
    if (text.includes(name)) score += 12;
    for (const token of tokens) {
      if (name === token) score += 10;
      else if (name.includes(token)) score += 4;
      if (description.includes(token)) score += 1.5;
    }
    for (const intent of COMMAND_INTENTS) {
      if (intent.command === command.name && intent.re.test(text)) score += 10;
    }
    if (skillName === 'impeccable') {
      if (command.name === 'layout' && /\b(layout|spacing|grid|page|screen|responsive|dashboard)\b/.test(text)) score += 8;
      if (command.name === 'polish' && /\b(polish|refine|improve|cleanup|tighten)\b/.test(text)) score += 8;
    }
    if (best === null || score > best.score) {
      best = { ...command, score };
    }
  }

  if (!best || best.score <= 0) {
    const fallback = commands.find((command) => command.name === 'polish') || commands[0];
    return fallback ? { ...fallback, score: 0 } : null;
  }
  return best;
}

function shortcutExists(command, projectRoot = findProjectRoot()) {
  const roots = skillRootCandidates(projectRoot);
  for (const root of roots) {
    const shortcutPath = path.join(root, command, 'SKILL.md');
    if (fs.existsSync(shortcutPath)) {
      return shortcutPath;
    }
  }
  return null;
}

function resolveSkillInvocation(asset, task, options = {}, projectRoot = findProjectRoot()) {
  const skillName = asset?.name || '';
  if (!skillName) {
    return { invoke: 'Skill("unknown")', mechanism: 'skill', command: null, pinned: false };
  }

  const executor = options?.executor || null;
  const allowPaneSpawn = Boolean(options?.allowPaneSpawn);
  const skillPath = asset?.path || findLocalSkill(skillName);
  const skillText = skillPath ? readTextFile(skillPath) : '';
  const commands = parseSkillCommands(skillText);
  const target = normalizeTaskTarget(task);
  const command = selectSkillCommand(commands, task, skillName);

  if (commands.length > 0 && command) {
    const pinnedPath = shortcutExists(command.name, projectRoot);
    const suffix = target ? ` ${target}` : '';
    if (pinnedPath) {
      return {
        invoke: `/${command.name}${suffix}`,
        mechanism: 'pinned-command',
        command: command.name,
        pinned: true,
        skill: skillName,
        target,
        pinned_path: pinnedPath,
      };
    }
    return {
      invoke: `/${skillName} ${command.name}${suffix}`.trim(),
      mechanism: 'skill-command',
      command: command.name,
      pinned: false,
      skill: skillName,
      target,
      pinned_path: null,
    };
  }

  if (allowPaneSpawn && normalize(executor?.name || process.env.ORACLE_EXECUTOR || '') === 'pane_spawn') {
    return {
      invoke: `pane_spawn visible pane, then submit a pane_write prompt to use ${skillName}`,
      mechanism: 'pane_spawn',
      command: null,
      pinned: false,
      skill: skillName,
      target,
      pinned_path: null,
    };
  }

  return {
    invoke: `Skill("${skillName}")`,
    mechanism: 'skill',
    command: null,
    pinned: false,
    skill: skillName,
    target,
    pinned_path: null,
  };
}

function executionPromptForAsset(asset, task, selectedModel) {
  const target = asset?.invocation?.target || normalizeTaskTarget(task);
  if (asset?.invocation?.mechanism === 'pane_spawn') {
    const parts = [
      `Spawn a visible pane and use ${asset.name} to complete the task.`,
      `Task: ${task}`,
      'Submit this prompt with pane_write submit=true before waiting for idle.',
    ];
    if (target) parts.push(`Target: ${target}`);
    if (selectedModel) parts.push(`Model: ${selectedModel}`);
    parts.push('Execute the skill, wait for idle, and report back with the result.');
    return parts.join('\n');
  }
  return null;
}

function fallbackGuidance(task) {
  const findSkillsPath = findLocalSkill('find-skills');
  if (!findSkillsPath) {
    return {
      available: false,
      skill: 'find-skills',
      install_url: 'https://github.com/vercel-labs/skills',
      message: 'find-skills is not installed locally. Install it from the official Vercel Labs repository, then rerun this query so Oracle can search the external skill ecosystem safely.',
    };
  }
  return {
    available: true,
    skill: 'find-skills',
    path: findSkillsPath,
    invoke: `Skill("find-skills") with task: ${task}`,
    after_accept: [
      'Install the accepted skill using the find-skills recommendation.',
      'Rerun Oracle or start a new session; the inventory signature will trigger an automatic rebuild.',
      'Oracle will classify it into the right domain/master agent and use it on the next query.',
    ],
  };
}

function buildHostAdapterPolicy(runtimeName, executorName, visiblePanes) {
  const supported = FIRST_CLASS_HOSTS.has(runtimeName);
  const adapter =
    runtimeName === 'overclock' ? 'overclock-pane-adapter'
      : runtimeName === 'claude-code' ? 'claude-task-adapter'
        : runtimeName === 'codex' ? 'codex-local-adapter'
          : runtimeName === 'antigravity' ? 'antigravity-cli-adapter'
            : 'fallback-standard-adapter';
  return {
    runtime: runtimeName || 'unknown',
    supported,
    adapter,
    execution_mode: visiblePanes
      ? 'visible-pane-swarm'
      : runtimeName === 'claude-code'
        ? 'task-subagents'
        : runtimeName === 'antigravity'
          ? 'cli-adapter'
          : 'local-manifest',
    fallback_recommendations: supported
      ? []
      : ['overclock', 'claude-code', 'codex', 'antigravity'],
    preWriteReadiness: visiblePanes
      ? {
          required: true,
          probe: 'stable prompt visible',
          disallowStates: [
            'startup screen',
            'auth screen',
            'onboarding',
            'context budget warning',
          ],
          fallbackAction: 're-spawn with a lighter verified provider/model or mission-bound pane before writing the prompt.',
        }
      : null,
    note: supported
      ? 'First-class host: Oracle can adapt natively.'
      : 'Unsupported host: Oracle should recommend one of the first-class standards.',
  };
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function normalizeProviderKey(value) {
  return normalize(value);
}

function canonicalProviderId(value) {
  const key = normalizeProviderKey(value);
  return PROVIDER_KEY_ALIASES[key] || String(value || '').trim();
}

function parseOverclockAutoDetectedProviders(logText) {
  const match = String(logText || '').match(/\[providers\]\s+auto-detected:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((part) => canonicalProviderId(part.trim()))
    .filter(Boolean);
}

function detectExecutionProviderInventory() {
  const providersJson = readJsonSafe(OVERCLOCK_PROVIDERS_PATH, null) || {};
  const mcpConfig = readJsonSafe(OVERCLOCK_MCP_CONFIG_PATH, null) || {};
  const logText = readTextFile(OVERCLOCK_MAIN_LOG_PATH);
  const providerMap = new Map();

  const upsertProvider = (provider) => {
    if (!provider || !provider.id) return;
    const id = canonicalProviderId(provider.id);
    const current = providerMap.get(id) || {
      id,
      label: provider.label || id,
      type: provider.type || 'unknown',
      host: provider.host || null,
      models: [],
      source: provider.source || 'providers.json',
      available: false,
      confidence: 'low',
    };
    const mergedModels = new Set([...(current.models || []), ...(provider.models || [])].filter(Boolean));
    providerMap.set(id, {
      ...current,
      ...provider,
      id,
      models: Array.from(mergedModels),
      available: true,
      confidence: provider.confidence || current.confidence || 'medium',
    });
  };

  for (const provider of providersJson.providers || []) {
    upsertProvider({
      ...provider,
      id: provider.id,
      available: true,
      confidence: 'medium',
    });
  }

  for (const [rawId, enabled] of Object.entries(providersJson.builtinEnabled || {})) {
    if (!enabled) continue;
    const id = canonicalProviderId(rawId);
    upsertProvider({
      id,
      label: id === 'claude-oauth' ? 'Claude via OAuth' : id,
      type: 'builtin',
      host: 'overclock',
      models: (providersJson.builtinModels || {})[rawId] || [],
      source: 'providers.json',
      confidence: 'medium',
    });
  }

  for (const id of parseOverclockAutoDetectedProviders(logText)) {
    if (!providerMap.has(id)) {
      upsertProvider({
        id,
        label: id,
        type: 'auto-detected',
        host: 'overclock',
        models: [],
        source: 'main.log',
        confidence: 'high',
      });
    } else {
      const existing = providerMap.get(id);
      providerMap.set(id, { ...existing, confidence: existing.confidence === 'medium' ? 'high' : existing.confidence });
    }
  }

  let activeProviderId = null;
  let activeModel = null;
  try {
    const overclockUrl = mcpConfig?.mcpServers?.overclock?.url || '';
    if (overclockUrl) {
      const parsed = new URL(overclockUrl);
      activeProviderId = canonicalProviderId(parsed.searchParams.get('providerId'));
      activeModel = parsed.searchParams.get('model') || null;
    }
  } catch (_error) {
    activeProviderId = null;
    activeModel = null;
  }

  const providers = Array.from(providerMap.values()).sort((a, b) => {
    const aIndex = PREFERRED_EXECUTION_PROVIDER_ORDER.indexOf(a.id);
    const bIndex = PREFERRED_EXECUTION_PROVIDER_ORDER.indexOf(b.id);
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
  });
  const availableProviderIds = providers.map((provider) => provider.id);

  return {
    providers,
    providersById: Object.fromEntries(providers.map((provider) => [provider.id, provider])),
    availableProviderIds,
    activeProviderId: activeProviderId && availableProviderIds.includes(activeProviderId) ? activeProviderId : null,
    activeModel,
    available: availableProviderIds.length > 0,
    source: {
      providers_json: fs.existsSync(OVERCLOCK_PROVIDERS_PATH),
      mcp_config: fs.existsSync(OVERCLOCK_MCP_CONFIG_PATH),
      main_log: fs.existsSync(OVERCLOCK_MAIN_LOG_PATH),
    },
  };
}

function chooseProviderModel(provider, complexity = 'simple', options = {}) {
  if (!provider) return null;
  const providerId = canonicalProviderId(provider.id);
  const visiblePanes = Boolean(options.visiblePanes);
  const models = Array.isArray(provider.models) ? provider.models.filter(Boolean) : [];
  const fromInventory = provider.inventory_model_map || {};
  const pickByIndex = (index) => {
    if (!models.length) return null;
    return models[Math.min(index, models.length - 1)] || models[0] || null;
  };

  if (providerId === 'codex-cli') {
    if (visiblePanes) return MODEL_HINTS.codex.simple || pickByIndex(0);
    return MODEL_HINTS.codex[complexity] || pickByIndex(0);
  }
  if (providerId === 'claude-oauth') {
    return MODEL_HINTS.claude[complexity] || pickByIndex(0);
  }
  if (fromInventory.simple || fromInventory.medium || fromInventory.heavy) {
    return fromInventory[complexity] || fromInventory.medium || fromInventory.simple || models[0] || null;
  }

  if (complexity === 'heavy') return pickByIndex(2) || pickByIndex(models.length - 1);
  if (complexity === 'medium') return pickByIndex(1) || pickByIndex(0);
  return pickByIndex(0);
}

function selectExecutionProvider(task, complexity, providerInventory = null, options = {}) {
  const text = normalize(task);
  const inventory = providerInventory || detectExecutionProviderInventory();
  const explicitClaude = /\b(claude|anthropic)\b/.test(text);
  const preferredOrder = explicitClaude
    ? ['claude-oauth', 'codex-cli', 'gemini-cli', 'kimi-cli', 'antigravity-cli', 'mimo-DMlOoB']
    : PREFERRED_EXECUTION_PROVIDER_ORDER;
  const available = new Set(inventory.availableProviderIds || []);

  let providerId = preferredOrder.find((id) => available.has(id)) || inventory.activeProviderId || null;
  if (!providerId) {
    const first = (inventory.providers || [])[0];
    providerId = first ? first.id : null;
  }

  const provider = providerId ? inventory.providersById?.[providerId] || null : null;
  const model = chooseProviderModel(provider, complexity, options);

  return {
    providerId,
    provider,
    model,
    available: Boolean(provider && available.has(providerId)),
    explicitClaude,
    reason: provider
      ? `${provider.id} selected from local provider inventory${explicitClaude ? ' (explicit Claude request)' : ''}.`
      : 'No verified provider inventory found; host must choose a safe fallback.',
  };
}

const MODEL_HINTS = {
  claude: {
    simple: 'claude-haiku-4-5',
    medium: 'claude-sonnet-4-6',
    heavy: 'claude-opus-4-7',
  },
  codex: {
    simple: 'gpt-5.4-mini',
    medium: 'gpt-5.4',
    heavy: 'gpt-5.5',
  },
};

const DOMAIN_KEYWORDS = [
  {
    id: 'web-dev',
    proactive: ['testing-qa', 'security-audit'],
    kw: ['react', 'nextjs', 'next.js', 'vercel', 'frontend', 'tailwind', 'vue', 'svelte', 'astro', 'remix', 'vite', 'webpack', 'turbopack', 'shadcn', 'html', 'css', 'browser', 'spa', 'ssr', 'dashboard', 'electron', 'shortcut', 'atalho', 'botoes', 'botões'],
  },
  {
    id: 'backend-api',
    proactive: ['security-audit', 'testing-qa'],
    kw: ['fastapi', 'express', 'django', 'rails', 'flask', 'grpc', 'graphql', 'rest-api', 'endpoint', 'springboot', 'nestjs', 'laravel', 'webhook', 'middleware', 'serverless', 'lambda', 'cloudflare-workers', 'api'],
  },
  {
    id: 'database-data',
    proactive: ['security-audit'],
    kw: ['sql', 'postgres', 'postgresql', 'mongo', 'mongodb', 'mysql', 'sqlite', 'dynamodb', 'cosmos', 'redis', 'snowflake', 'databricks', 'clickhouse', 'supabase', 'orm', 'prisma', 'migration', 'schema', 'warehouse', 'etl', 'dbt', 'airflow'],
  },
  {
    id: 'devops-infra',
    proactive: ['observability', 'security-audit'],
    kw: ['docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm', 'cicd', 'ci-cd', 'pipeline', 'deploy', 'deployment', 'aws', 'gcp', 'azure', 'cloudflare', 'railway', 'fly.io', 'netlify', 'gitops', 'github-actions'],
  },
  {
    id: 'security-audit',
    proactive: [],
    kw: ['security', 'vulnerability', 'vuln', 'pentest', 'owasp', 'auth', 'oauth', 'jwt', 'cryptography', 'encryption', 'sql-injection', 'xss', 'csrf', 'secret', 'gdpr', 'hipaa', 'soc2', 'pci', 'compliance', 'audit', 'firewall', 'cors', 'sast', 'dast'],
  },
  {
    id: 'testing-qa',
    proactive: [],
    kw: ['test', 'tests', 'testing', 'tdd', 'jest', 'vitest', 'pytest', 'cypress', 'playwright', 'selenium', 'mutation', 'snapshot', 'coverage', 'e2e', 'unit-test', 'integration-test', 'load-test', 'smoke', 'qa', 'regression', 'fuzz'],
  },
  {
    id: 'ai-ml',
    proactive: ['testing-qa'],
    kw: ['ai', 'llm', 'gpt', 'claude', 'openai', 'anthropic', 'langchain', 'langgraph', 'langfuse', 'genkit', 'adk', 'rag', 'embedding', 'vector', 'training', 'ml', 'pytorch', 'tensorflow', 'huggingface', 'prompt', 'eval', 'fine-tune', 'inference', 'agent-sdk', 'vertex', 'gemini'],
  },
  {
    id: 'design-ui',
    proactive: ['data-analytics'],
    kw: ['design-system', 'ui', 'ux', 'figma', 'canva', 'brand', 'branding', 'palette', 'typography', 'wireframe', 'prototype', 'accessibility', 'a11y', 'wcag', 'visual', 'mockup', 'minimalist', 'logo', 'icon', 'icone', 'ícone', 'identidade', 'simbolo', 'símbolo', 'topbar', 'taskbar', 'botao', 'botão', 'botoes', 'botões', 'shortcut', 'atalho', 'remotion', 'stitch-design', 'stitch', 'imagegen', 'image-gen', 'image-direction', 'motion-design', 'animation', 'frontend-design', 'design-taste', 'taste-design', 'high-end-visual', 'polish', 'impeccable', 'image-to-code', 'visual-design', 'emil-design', 'component-design', 'ui-design', 'interface-design', 'hyperframe', 'hyperframes', 'higgsfield', 'higgs-field', 'video', 'motion', 'lottie', 'gsap', 'animejs', 'composition', 'render', 'liquid-glass', 'industrial-brutalist', 'brandkit'],
  },
  {
    id: 'mobile',
    proactive: ['testing-qa'],
    kw: ['mobile', 'ios', 'android', 'react-native', 'expo', 'flutter', 'swift', 'kotlin', 'swiftui', 'jetpack', 'xcode', 'dart', 'cocoapods', 'gradle'],
  },
  {
    id: 'data-analytics',
    proactive: [],
    kw: ['analytics', 'dashboard', 'visualization', 'chart', 'metric', 'kpi', 'posthog', 'mixpanel', 'amplitude', 'segment', 'tableau', 'looker', 'metabase', 'forecasting', 'time-series', 'ga4', 'gtm', 'google-analytics', 'google analytics', 'tag-manager', 'tag manager', 'utm', 'utms', 'tracking', 'conversion-tracking', 'event-tracking', 'attribution'],
  },
  {
    id: 'marketing-growth',
    proactive: ['data-analytics'],
    kw: ['marketing', 'seo', 'ads', 'growth', 'content-strategy', 'copywriting', 'social', 'tiktok', 'instagram', 'linkedin', 'facebook', 'meta-ads', 'google-ads', 'retention', 'funnel', 'cro', 'email-sequence', 'newsletter', 'referral', 'cold-email', 'launch', 'paid-ads'],
  },
  {
    id: 'crypto-web3',
    proactive: ['security-audit'],
    kw: ['crypto', 'blockchain', 'ethereum', 'solana', 'defi', 'nft', 'wallet', 'token', 'dex', 'dao', 'smart-contract', 'solidity', 'web3', 'metamask', 'onchain'],
  },
  {
    id: 'productivity',
    proactive: ['tooling-meta'],
    kw: ['notion', 'slack', 'gmail', 'calendar', 'google-drive', 'sheets', 'meeting', 'task-manage', 'todo', 'reminder', 'kanban', 'asana', 'jira', 'linear', 'trello', 'clickup'],
  },
  {
    id: 'finance-billing',
    proactive: ['security-audit'],
    kw: ['stripe', 'billing', 'invoice', 'payment', 'payments', 'subscription', 'revenue', 'accounting', 'tax', 'finance', 'quickbooks', 'plaid', 'ramp', 'paywall', 'pricing-strategy'],
  },
  {
    id: 'docs-content',
    proactive: [],
    kw: ['documentation', 'docs', 'readme', 'wiki', 'manual', 'tutorial', 'guide', 'copyedit', 'copy-editing', 'writing', 'article', 'blog', 'docx', 'pdf', 'xlsx', 'pptx'],
  },
  {
    id: 'tooling-meta',
    proactive: ['testing-qa'],
    kw: ['skill-creator', 'plugin', 'subagent', 'claude-md', 'hook', 'oracle', 'meta', 'config', 'settings', 'onboard', 'session-report', 'agent-creator', 'plugin-validator', 'mcp-server', 'mcp-builder', 'codex'],
  },
  {
    id: 'observability',
    proactive: [],
    kw: ['log', 'trace', 'tracing', 'monitor', 'observability', 'apm', 'alert', 'incident', 'sentry', 'datadog', 'newrelic', 'grafana', 'prometheus', 'sla', 'sli', 'uptime'],
  },
  {
    id: 'ecommerce',
    proactive: ['finance-billing'],
    kw: ['shopify', 'woocommerce', 'wordpress', 'ecommerce', 'cart', 'product-catalog', 'inventory', 'fulfillment', 'sku', 'storefront'],
  },
  {
    id: 'crm-sales',
    proactive: ['data-analytics'],
    kw: ['crm', 'sales', 'hubspot', 'salesforce', 'pipedrive', 'attio', 'intercom', 'salesloft', 'outreach', 'lead-magnet', 'prospect', 'pipeline-sales', 'apollo'],
  },
];

const INTENT_PATTERNS = [
  { re: /\b(logo|icone|icon|simbolo|símbolo|brand|branding|identidade visual)\b/, domains: ['design-ui'] },
  { re: /\b(atalho|shortcut|hotkey|botoes|botões|botao|botão)\b/, domains: ['web-dev', 'design-ui'] },
  { re: /\b(electron|janela|taskbar|topbar|barra do windows)\b/, domains: ['web-dev', 'design-ui'] },
  { re: /\b(claude code|codex|oracle|plugin|skill|hook|setup)\b/, domains: ['tooling-meta'] },
  { re: /\b(ga4|gtm|google analytics|tag manager|utm|utms|tracking|conversion tracking|event tracking|attribution)\b/, domains: ['data-analytics'] },
];

const CAPABILITY_INTENTS = [
  {
    id: 'ui-interface',
    re: /\b(ui|ux|interface|tela|layout|dashboard|frontend|componentes|component|design de interface|produto|app shell|visual hierarchy|hierarquia visual)\b/,
    domains: ['design-ui', 'web-dev'],
    skills: ['ui-ux-pro-max', 'impeccable', 'frontend-design', 'design-taste-frontend', 'refactoring-ui', 'ux-heuristics', 'ui-ux-expert', 'ui-styling', 'stitch-design'],
  },
  {
    id: 'logo-brand',
    re: /\b(logo|icone|icon|simbolo|brand|branding|identidade visual|brand kit|brandkit|marca|manual da marca)\b/,
    domains: ['design-ui'],
    skills: ['brandkit', 'design', 'brand', 'high-end-visual-design', 'stitch-design-taste', 'imagegen-frontend-web', 'impeccable'],
  },
  {
    id: 'video-motion',
    re: /\b(video|videos|reel|shorts|story|stories|apresentacao|brand video|demo video|walkthrough|trailer|redes sociais|hyperframes|hyperframe|higgsfield|higgs field|remotion|render|timeline|captions|voiceover)\b/,
    domains: ['design-ui', 'web-dev'],
    skills: ['hyperframes', 'hyperframes-cli', 'higgsfield', 'higgs-field', 'remotion', 'remotion-video-creation', 'remotion-to-hyperframes', 'website-to-hyperframes', 'frontend-slides'],
  },
  {
    id: 'ui-motion-live',
    re: /\b(motion|animacao|animar|animated|animation|transition|transicao|transição|micro-interaction|microinteracao|microinteração|spring|gesture|shared layout|orbitas|órbitas|orbita|órbita|explosao|explosão|shockwave|reveal|fade-in|fade out|fade-out|logo energetica|logo energética|pulse|pulsar|authenticate|autenticar|login transition)\b/,
    domains: ['design-ui', 'web-dev'],
    skills: ['motion', 'impeccable', 'design-taste-frontend', 'frontend-design', 'frontend-slides', 'react:components'],
  },
  {
    id: 'social-creative',
    re: /\b(redes sociais|social media|linkedin|tiktok|facebook|x\/twitter|twitter|post social|criativo|ad creative|anuncio|anuncios|ads|instagram (post|reel|story|stories|ads|anuncio|anuncios|criativo|copy|content|conteudo))\b/,
    domains: ['marketing-growth', 'design-ui'],
    skills: ['social-content', 'ad-creative', 'paid-ads', 'imagegen-frontend-web'],
  },
  {
    id: 'fullstack-product-ui',
    re: /\b(implementar|build|criar|atualizar|melhorar|refatorar|dashboard|painel|pagina|página|formulario|formulário|modal|tabela|ui|ux|interface|react|vite|shadcn|tailwind|supabase|schema|banco de dados|migration|migracao|migração|rls|edge function|api)\b/,
    domains: ['design-ui', 'web-dev', 'database-data'],
    skills: ['awesome-design-md', 'ui-ux-pro-max', 'impeccable', 'design-taste-frontend', 'react:components', 'shadcn-ui', 'supabase', 'postgres-patterns'],
  },
  {
    id: 'supabase-schema',
    re: /\b(supabase|schema|banco de dados|database|postgres|postgresql|migration|migracao|migração|rls|edge function|edge functions|api|tabela|entidade|relacionamento|foreign key|soft delete)\b/,
    domains: ['database-data', 'web-dev'],
    skills: ['supabase', 'postgres-patterns', 'tech-lead-architect'],
  },
  {
    id: 'analytics-dashboard',
    re: /\b(dashboard|dashboards|painel|grafico|gráfico|metricas|métricas|analitico|analiticos|analítica|analíticas|analytics|kpi|funil|lucro|percentual|comparativo|tendencia|tendência|periodo|período)\b/,
    domains: ['data-analytics', 'design-ui', 'web-dev'],
    skills: ['ui-ux-pro-max', 'impeccable', 'awesome-design-md', 'design-taste-frontend', 'react:components'],
  },
  {
    id: 'analytics-tracking',
    re: /\b(ga4|gtm|google analytics|tag manager|utm|utms|tracking|conversion tracking|event tracking|attribution|mensuracao|medir conversao|eventos de conversao)\b/,
    domains: ['data-analytics'],
    skills: ['analytics-tracking', 'product-tracking-generate-implementation-guide', 'configuring-experiment-analytics'],
  },
  {
    id: 'experimentation',
    re: /\b(a\/b|ab test|a b test|split test|experimento|experimentos|variant|variante|hipotese|significancia|testar duas versoes)\b/,
    domains: ['marketing-growth', 'data-analytics'],
    skills: ['ab-test-setup', 'configuring-experiment-analytics', 'creating-experiments'],
  },
  {
    id: 'signup-onboarding',
    re: /\b(signup|sign up|cadastro|registro|registration|trial|onboarding|ativacao|activation|aha moment|primeira sessao|dropoff|abandono)\b/,
    domains: ['marketing-growth', 'data-analytics'],
    skills: ['signup-flow-cro', 'onboarding-cro', 'email-sequence', 'analytics-tracking'],
  },
  {
    id: 'seo-schema',
    re: /\b(seo|schema|json-ld|rich snippet|sitemap|trafego organico|ranking|google search|ai overview|ai search|llm seo|programmatic seo)\b/,
    domains: ['marketing-growth', 'docs-content'],
    skills: ['seo-audit', 'schema-markup', 'ai-seo', 'programmatic-seo', 'site-architecture'],
  },
  {
    id: 'payments-billing',
    re: /\b(stripe|pagamento|pagamentos|checkout|billing|assinatura|subscription|invoice|fatura|pricing|preco|precos|paywall|churn|cancelamento)\b/,
    domains: ['finance-billing', 'marketing-growth', 'security-audit'],
    skills: ['stripe-best-practices', 'pricing-strategy', 'paywall-upgrade-cro', 'churn-prevention', 'finance-billing-ops'],
  },
  {
    id: 'security-review',
    re: /\b(seguranca|security|vulnerabilidade|vulnerability|owasp|pentest|auth|oauth|jwt|xss|csrf|sql injection|secrets|compliance|soc2|pci|gdpr|auditoria)\b/,
    domains: ['security-audit', 'testing-qa'],
    skills: ['security-review', 'security-scan', 'compliance-audit', 'claude-setup-audit'],
  },
  {
    id: 'testing-browser',
    re: /\b(playwright|cypress|selenium|e2e|teste end to end|testes end to end|browser test|visual regression|regression test|qa|coverage)\b/,
    domains: ['testing-qa'],
    skills: ['playwright', 'e2e-testing', 'browser-qa', 'testing-visual-regression'],
  },
  {
    id: 'docs-files',
    re: /\b(pdf|docx|xlsx|planilha|documento|contrato|relatorio|presentation|pptx|slides|manual|documentacao|readme)\b/,
    domains: ['docs-content'],
    skills: ['pdf', 'docx', 'xlsx', 'copy-editing', 'writing-plans'],
  },
  {
    id: 'mobile-app',
    re: /\b(mobile|ios|android|app nativo|react native|expo|flutter|swiftui|kotlin|app store|google play)\b/,
    domains: ['mobile', 'design-ui'],
    skills: ['imagegen-frontend-mobile', 'ios-hig-design', 'swiftui-patterns', 'flutter-dart-code-review'],
  },
  {
    id: 'ecommerce-shop',
    re: /\b(shopify|woocommerce|loja online|ecommerce|e-commerce|carrinho|produto|sku|storefront|checkout extensions)\b/,
    domains: ['ecommerce', 'finance-billing'],
    skills: ['shopify-use-shopify-cli', 'shopify-storefront-headless', 'shopify-functions', 'shopify-checkout-extensions'],
  },
  {
    id: 'crm-sales',
    re: /\b(crm|hubspot|salesforce|pipeline|lead|leads|prospeccao|prospeccao|cold email|outbound|sales enablement|revops|demo script)\b/,
    domains: ['crm-sales', 'marketing-growth'],
    skills: ['revops', 'sales-enablement', 'cold-email', 'lead-magnets'],
  },
];

const TYPE_PRIORITY = { skill: 4, agent: 3, mcp: 2, plugin: 1 };
const EXPLICIT_SIGNAL_DOMAINS = new Set([
  'security-audit',
  'finance-billing',
  'database-data',
  'ecommerce',
  'crypto-web3',
  'crm-sales',
]);
const STRICT_DOMAIN_SIGNALS = {
  'security-audit': /\b(seguranca|segurança|security|auth|oauth|jwt|xss|csrf|owasp|pentest|secret|secrets|compliance|soc2|pci|gdpr|vulnerability|vulnerabilidade|audit|auditoria)\b/,
  'finance-billing': /\b(stripe|billing|invoice|payment|payments|pagamento|pagamentos|assinatura|subscription|revenue|tax|finance|pricing|paywall|checkout|churn|cancelamento)\b/,
  'database-data': /\b(supabase|database|banco de dados|banco|sql|postgres|postgresql|schema|migration|migracao|migração|rls|foreign key|soft delete|edge function|edge functions|relacionamento|entidade|api)\b/,
  ecommerce: /\b(shopify|woocommerce|wordpress|ecommerce|e-commerce|loja online|cart|carrinho|product-catalog|inventory|sku|storefront)\b/,
  'crypto-web3': /\b(crypto|blockchain|ethereum|solana|defi|nft|wallet|token|dex|dao|smart contract|solidity|web3|metamask|onchain)\b/,
  'crm-sales': /\b(crm|sales|hubspot|salesforce|pipedrive|attio|intercom|lead|leads|pipeline|prospect|outbound|cold email|revops)\b/,
};
const DOMAIN_NEGATION_SIGNALS = {
  'web-dev': /\b(software|frontend|backend|web|app|codigo|código|code|api|dashboard)\b/,
  'backend-api': /\b(api|backend|server|endpoint|webhook)\b/,
  'database-data': /\b(dados|data|database|banco|sql|postgres|analytics|metricas|métricas)\b/,
  'design-ui': /\b(design|ui|ux|interface|visual|logo|marca|branding)\b/,
  'marketing-growth': /\b(marketing|growth|seo|ads|copy|social|funil|funnel|lead|leads)\b/,
  'finance-billing': /\b(billing|pagamento|pagamentos|payment|payments|checkout|stripe|pricing|paywall|assinatura|subscription|finance)\b/,
  ecommerce: /\b(ecommerce|e-commerce|loja|shopify|woocommerce|checkout|cart|carrinho|produto|sku)\b/,
  'crypto-web3': /\b(crypto|blockchain|wallet|token|ethereum|solana|web3|dex|nft)\b/,
  'crm-sales': /\b(crm|hubspot|salesforce|sales|vendas|pipeline|lead|leads|outbound)\b/,
  'security-audit': /\b(seguranca|segurança|security|auth|jwt|compliance|audit|auditoria|vulnerability|vulnerabilidade)\b/,
  'testing-qa': /\b(test|tests|teste|testes|qa|playwright|cypress|e2e|coverage)\b/,
  'data-analytics': /\b(analytics|dados|metricas|métricas|dashboard|ga4|tracking|eventos|conversao|conversão)\b/,
};

const ANALYTICS_EXPLICIT_SIGNALS = /\b(analytics|analitico|analiticos|analítica|analíticas|metricas|métricas|kpi|chart|charts|grafico|gráfico|grafico[s]?|gráfico[s]?|tracking|ga4|gtm|google analytics|tag manager|utm|utms|attribution|funnel|funil|posthog|mixpanel|amplitude|looker|tableau|metabase|comparativo|tendencia|tendência|periodo|período|lucro|percentual)\b/;
const UI_SHELL_TRANSITION_SIGNALS = /\b(login|auth|autenticar|autenticacao|autenticação|topbar|top bar|header|background|logo|identidade visual|configuracao|configuração|painel de configuracao|painel de configuração|dashboard shell|app shell|transicao|transição|fade|explosao|explosão|orbitas|órbitas|reveal)\b/;

// Lazy-load embedding modules — silently skipped if not installed
let _embedMods = null;
function getEmbedMods() {
  if (_embedMods !== null) return _embedMods;
  try {
    _embedMods = {
      config: require('./embed-config'),
      embed: require('./embeddings'),
    };
  } catch (_) {
    _embedMods = false;
  }
  return _embedMods;
}

function getEmbeddingLookup(embedData) {
  const byAsset = new Map();
  const byDomain = new Map();
  const byChunkAsset = new Map();

  for (const asset of embedData.assets || []) {
    if (asset && asset.id && asset.vector) {
      byAsset.set(asset.id, asset);
    }
  }

  for (const chunk of embedData.chunks || []) {
    if (!chunk || !chunk.asset_id || !chunk.vector) continue;
    if (!byChunkAsset.has(chunk.asset_id)) byChunkAsset.set(chunk.asset_id, []);
    byChunkAsset.get(chunk.asset_id).push(chunk.vector);
  }

  for (const [domain, vector] of Object.entries(embedData.domain_centroids || {})) {
    if (vector) byDomain.set(domain, vector);
  }

  return { byAsset, byDomain, byChunkAsset };
}

function scoreEmbeddingVector(queryVector, vector, cosineSimilarity) {
  if (!queryVector || !vector) return 0;
  return cosineSimilarity(queryVector, vector);
}

async function synthesizeBundleWithOpenAI({ task, domainReports, picks, bundle, domains, apiConfig }) {
  if (!apiConfig || apiConfig.provider !== 'openai' || !apiConfig.key) return null;

  const prompt = [
    'Return only JSON with keys bundle_names, reasoning, caution.',
    'bundle_names must contain at most 6 canonical asset names only, with no domain prefixes, ids, markdown, bullets, or extra text.',
    'Choose the best cross-domain bundle for the task. Prefer the deterministic bundle unless it misses an important domain.',
    'Do not write reasoning or caution that contradicts the deterministic bundle.',
    `Task: ${task}`,
    `Domains: ${domains.join(', ')}`,
    `Deterministic bundle: ${(bundle || []).map((asset) => asset.name).join(', ')}`,
    'Candidates:',
    ...domainReports.slice(0, 4).map((report) => {
      const names = (report.bundle || report.top || []).slice(0, 3).map((asset) => asset.name).join(', ');
      return `- ${report.domain}: ${names}`;
    }),
  ].join('\n');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiConfig.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SYNTHESIS_MODEL,
        input: prompt,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const textParts = [];
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      textParts.push(data.output_text.trim());
    }
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (!item || !Array.isArray(item.content)) continue;
        for (const content of item.content) {
          if (content && typeof content.text === 'string' && content.text.trim()) {
            textParts.push(content.text.trim());
          }
        }
      }
    }
    const text = textParts.join('\n').trim();
    if (!text) return null;
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.bundle_names)) return null;
    if (Array.isArray(parsed.caution)) {
      parsed.caution = parsed.caution.join(' | ');
    }
    return parsed;
  } catch (_error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function registerLookup(lookup, asset) {
  if (!asset) return;
  const keys = new Set();
  if (asset.id) keys.add(String(asset.id));
  if (asset.name) keys.add(String(asset.name));
  if (asset.invoke && typeof asset.invoke === 'string') {
    const match = asset.invoke.match(/["']([^"']+)["']/);
    if (match && match[1]) keys.add(match[1]);
  }
  if (asset.domain && asset.name) {
    keys.add(`${asset.domain}.${asset.name}`);
    keys.add(`${asset.domain}/${asset.name}`);
    keys.add(`${asset.domain}:${asset.name}`);
  }
  if (asset.id && asset.id.includes(':')) {
    keys.add(asset.id.split(':').pop());
  }
  if (asset.id && asset.id.includes('/')) {
    keys.add(asset.id.split('/').pop());
  }
  if (asset.name && asset.name.includes('.')) {
    keys.add(asset.name.split('.').pop());
  }
  for (const key of keys) {
    lookup.set(normalize(key), asset);
  }
}

function buildSynthesisLookup(picks, rankedPicks, domainReports) {
  const lookup = new Map();
  for (const asset of [...picks, ...rankedPicks, ...domainReports.flatMap((report) => report.top || [])]) {
    registerLookup(lookup, asset);
  }
  return lookup;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/oracle-query.js "<task>"',
    '  node scripts/oracle-query.js --stats',
    '  node scripts/oracle-query.js --list-domains',
    '  node scripts/oracle-query.js --rebuild',
    '  node scripts/oracle-query.js --preflight',
    '  node scripts/oracle-query.js --manifest "<task>"',
    '',
    'Options:',
    '  --limit <n>       Number of final picks to print (default: 5)',
    '  --domain <id>     Force one or more domains; repeatable',
    '  --json            Print machine-readable JSON',
    '  --manifest        Print execution manifest JSON only',
    '  --index <path>    Use a custom oracle-index.json',
    '  --no-embed        Disable embedding enhancement for this query',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {
    taskParts: [],
    domains: [],
    limit: DEFAULT_LIMIT,
    indexPath: DEFAULT_INDEX,
    json: false,
    manifest: false,
    preflight: false,
    stats: false,
    listDomains: false,
    rebuild: false,
    help: false,
    noEmbed: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--manifest') out.manifest = true;
    else if (arg === '--preflight') out.preflight = true;
    else if (arg === '--stats') out.stats = true;
    else if (arg === '--list-domains') out.listDomains = true;
    else if (arg === '--rebuild') out.rebuild = true;
    else if (arg === '--no-embed') out.noEmbed = true;
    else if (arg === '--limit') out.limit = Number(argv[++i] || DEFAULT_LIMIT);
    else if (arg === '--domain') out.domains.push(argv[++i]);
    else if (arg === '--index') out.indexPath = path.resolve(argv[++i]);
    else out.taskParts.push(arg);
  }

  if (!Number.isFinite(out.limit) || out.limit < 1) out.limit = DEFAULT_LIMIT;
  out.task = out.taskParts.join(' ').trim();
  return out;
}

function loadIndex(indexPath) {
  if (!fs.existsSync(indexPath)) {
    throw new Error(`Index not found at ${indexPath}. Run --rebuild first.`);
  }
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (!Array.isArray(idx.assets)) throw new Error('Malformed index: missing assets[]');
  if (!Array.isArray(idx.domains) || idx.domains.length !== 20) {
    throw new Error('Malformed index: missing domains[] or incomplete domain classification. Run --rebuild first.');
  }
  return idx;
}

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9.+#-]+/)
    .filter((token) => token && token.length > 1)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !NOISY_PRODUCT_TOKENS.has(token))
    .filter((token) => !ACTION_WORDS.has(token));
}

function buildTokenSet(text) {
  return new Set(tokenize(text));
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsKeyword(text, normalizedKw) {
  if (!normalizedKw) return false;
  if (/^[a-z0-9.+#-]+$/.test(normalizedKw)) {
    return new RegExp(`(^|[^a-z0-9.+#-])${escapeRegex(normalizedKw)}($|[^a-z0-9.+#-])`).test(text);
  }
  return text.includes(normalizedKw);
}

function negatedTokenSet(text) {
  const rawTokens = normalize(text)
    .split(/[^a-z0-9.+#-]+/)
    .filter(Boolean);
  const negated = new Set();
  for (let i = 0; i < rawTokens.length; i += 1) {
    if (!NEGATION_CUES.has(rawTokens[i])) continue;
    for (let j = i + 1; j < Math.min(rawTokens.length, i + 14); j += 1) {
      const token = rawTokens[j];
      if ((token === 'com' || token === 'with') && j <= i + 3) continue;
      if (NEGATION_BREAKS.has(token)) break;
      if (STOPWORDS.has(token) || ACTION_WORDS.has(token)) continue;
      negated.add(token);
    }
  }
  return negated;
}

function positiveTokens(task) {
  const negated = negatedTokenSet(task);
  return tokenize(task).filter((token) => !negated.has(token));
}

function negatedTextWindows(task) {
  const text = normalize(task);
  const windows = [];
  const cueRe = /\b(without|except|excluding|exclude|not|sem|exceto|excluir|excluindo|nao|não)\b/g;
  let match;
  while ((match = cueRe.exec(text)) !== null) {
    windows.push(text.slice(match.index, match.index + 180));
  }
  return windows;
}

function domainBlocksFromNegation(task) {
  const windows = negatedTextWindows(task);
  if (!windows.length) return new Set();
  const blocked = new Set();
  for (const [domain, re] of Object.entries(DOMAIN_NEGATION_SIGNALS)) {
    if (windows.some((window) => re.test(window))) blocked.add(domain);
  }
  return blocked;
}

function isMeaningfulToken(token) {
  return token.length >= MIN_TOKEN_LENGTH || SHORT_TOKEN_ALLOWLIST.has(token);
}

function intentBoosts(task) {
  const text = normalize(task);
  return {
    branding: /\b(logo|icone|icon|simbolo|simbolo|brand|branding|identidade visual|identidade)\b/.test(text),
    ui: /\b(interface|ui|ux|visual|layout|botao|botao|botoes|botoes|tabela|table)\b/.test(text),
    desktop: /\b(electron|desktop|taskbar|topbar|janela|barra do windows)\b/.test(text),
    shortcuts: /\b(atalho|shortcut|hotkey)\b/.test(text),
    videoMotion: /\b(video|motion|animacao|animar|reel|shorts|story|stories|apresentacao|walkthrough|trailer|redes sociais)\b/.test(text),
    analytics: /\b(ga4|gtm|google analytics|tag manager|utm|tracking|attribution|mensuracao|conversao)\b/.test(text),
  };
}

function hasUiInterfaceIntent(task) {
  return matchedCapabilityIntents(task).some((intent) => intent.id === 'ui-interface');
}

function matchedCapabilityIntents(task) {
  const text = positiveTokens(task).join(' ');
  return CAPABILITY_INTENTS.filter((intent) => intent.re.test(text));
}

function hasExplicitDomainSignal(task, domainId) {
  if (domainBlocksFromNegation(task).has(domainId)) return false;
  if (STRICT_DOMAIN_SIGNALS[domainId]) {
    return STRICT_DOMAIN_SIGNALS[domainId].test(normalize(task));
  }
  const domain = DOMAIN_KEYWORDS.find((item) => item.id === domainId);
  const textScore = domain ? scoreDomainText(task, domain).score : 0;
  const capabilityScore = matchedCapabilityIntents(task)
    .some((intent) => intent.domains.includes(domainId));
  return textScore > 0 || capabilityScore;
}

function semanticSegments(asset) {
  return {
    summary: normalize(asset.content_summary || ''),
    preview: normalize(asset.content_preview || ''),
    useWhen: Array.isArray(asset.use_when) ? asset.use_when.map(normalize) : [],
    workflow: Array.isArray(asset.workflow_terms) ? asset.workflow_terms.map(normalize) : [],
    capability: Array.isArray(asset.capability_terms) ? asset.capability_terms.map(normalize) : [],
    headings: Array.isArray(asset.section_keywords) ? asset.section_keywords.map(normalize) : [],
    constraints: Array.isArray(asset.constraint_terms) ? asset.constraint_terms.map(normalize) : [],
  };
}

function buildAssetSemanticTokens(asset) {
  const segments = semanticSegments(asset);
  return {
    summary: buildTokenSet(segments.summary),
    preview: buildTokenSet(segments.preview),
    useWhen: new Set(segments.useWhen.flatMap((text) => tokenize(text))),
    workflow: new Set(segments.workflow.flatMap((text) => tokenize(text))),
    capability: new Set(segments.capability.flatMap((text) => tokenize(text))),
    headings: new Set(segments.headings.flatMap((text) => tokenize(text))),
    constraints: new Set(segments.constraints.flatMap((text) => tokenize(text))),
  };
}

function scoreDomainText(task, domain) {
  const text = normalize(task);
  const taskTokens = new Set(positiveTokens(task));
  const negated = negatedTokenSet(task);
  let score = 0;
  const matched = [];
  for (const kw of domain.kw) {
    const normalizedKw = normalize(kw);
    const kwTokens = tokenize(normalizedKw);
    if (kwTokens.length && kwTokens.every((token) => negated.has(token))) continue;
    if (taskTokens.has(normalizedKw)) {
      score += normalizedKw.length > 4 ? 4 : 3;
      matched.push(normalizedKw);
      continue;
    }
    if (!kwTokens.some((token) => negated.has(token)) && containsKeyword(text, normalizedKw)) {
      score += normalizedKw.length > 4 ? 2 : 1;
      matched.push(kw);
    }
  }
  return { id: domain.id, score, matched };
}

function isProductImplementationContext(task) {
  const text = normalize(task);
  return /\b(implementar|build|criar|atualizar|refatorar|feature|sistema|app|react|vite|frontend|supabase|schema|banco de dados|migration|migracao|rls|edge function|api|dashboard|painel|pagina|página|formulario|formulário|modal|tabela|crud|soft delete|entidade|relacionamento)\b/.test(text);
}

function hasMarketingExecutionIntent(task) {
  const text = normalize(task);
  return /\b(marketing|seo|ads|anuncio|anuncios|copywriting|copy|conteudo|content|post|reel|story|stories|social media|redes sociais|campanha|growth|cro|email|newsletter|launch|lancamento|lançamento|paid ads|google ads|meta ads|linkedin ads|instagram ads|criativo|criativos)\b/.test(text);
}

function hasExplicitAnalyticsIntent(task) {
  return ANALYTICS_EXPLICIT_SIGNALS.test(normalize(task));
}

function isUiShellTransitionContext(task) {
  const text = normalize(task);
  return UI_SHELL_TRANSITION_SIGNALS.test(text)
    && /\b(dashboard|painel|interface|ui|ux|frontend|electron|app)\b/.test(text);
}

function adjustDomainScoreForContext(task, domainScore) {
  if (domainScore.id === 'marketing-growth') {
    if (!isProductImplementationContext(task) || hasMarketingExecutionIntent(task)) return domainScore;

    const noisyOnly = domainScore.matched.length > 0
      && domainScore.matched.every((kw) => ['instagram', 'social', 'linkedin', 'facebook', 'tiktok'].includes(normalize(kw)));

    if (!noisyOnly) return domainScore;

    return {
      ...domainScore,
      score: 0,
      matched: [],
    };
  }

  if (
    domainScore.id === 'data-analytics'
    && isUiShellTransitionContext(task)
    && !hasExplicitAnalyticsIntent(task)
  ) {
    return {
      ...domainScore,
      score: 0,
      matched: [],
    };
  }

  return domainScore;
}

function detectDomains(task, idx, forcedDomains = []) {
  if (forcedDomains.length) {
    return forcedDomains
      .filter((id) => idx.domains.some((d) => d.id === id))
      .slice(0, MAX_DOMAINS);
  }

  const scored = DOMAIN_KEYWORDS
    .map((domain) => scoreDomainText(task, domain))
    .map((domain) => {
      const intentBoost = INTENT_PATTERNS
        .filter((rule) => rule.re.test(normalize(task)) && rule.domains.includes(domain.id))
        .reduce((sum, _rule) => sum + 4, 0);
      const capabilityBoost = matchedCapabilityIntents(task)
        .filter((intent) => intent.domains.includes(domain.id))
        .filter(() => !EXPLICIT_SIGNAL_DOMAINS.has(domain.id) || hasExplicitDomainSignal(task, domain.id))
        .reduce((sum, _intent) => sum + 8, 0);
      return {
        ...domain,
        score: domain.score + intentBoost + capabilityBoost,
      };
    })
    .map((domain) => adjustDomainScoreForContext(task, domain))
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((d) => d.id);

  const unique = [];
  for (const id of scored) {
    if (!unique.includes(id) && idx.domains.some((d) => d.id === id)) unique.push(id);
  }

  if (!unique.length) unique.push('misc');
  return unique.slice(0, MAX_DOMAINS);
}

function estimateComplexity(task, domains, picks) {
  const text = normalize(task);
  const tokens = tokenize(task);
  let score = 0;
  const simpleLocalEdit = /\b(typo|copy|texto|label|rotulo|r[oó]tulo|botao|botão|cor|padding|margin|espacamento|espaçamento|icone|ícone)\b/.test(text)
    && /\b(corrigir|ajustar|trocar|mudar|renomear|alterar|fix)\b/.test(text)
    && !/\b(api|database|banco|schema|migration|migracao|migração|security|seguranca|segurança|auth|rls|test|teste|playwright|dashboard|arquitetura|architecture|refactor|rewrite)\b/.test(text);
  const standaloneUiTask = /\b(ui|ux|design|frontend|pagina|página|page|layout|form|modal|componente|landing)\b/.test(text)
    && !/\b(api|database|banco|schema|migration|migracao|migração|security|seguranca|segurança|auth|rls|test|teste|playwright|checkout|payment|pagamento|stripe|pix|arquitetura|architecture|refactor|rewrite)\b/.test(text);
  const riskyReview = /\b(review|audit|auditoria|validate)\b/.test(text)
    && /\b(security|seguranca|segurança|auth|rls|payment|pagamento|stripe|pix|production|producao|produção|database|banco|schema|migration|migracao|migração)\b/.test(text);

  if (domains.length >= 3) score += 2;
  else if (domains.length >= 2) score += 1;

  if (picks.length >= 5 && !standaloneUiTask) score += 1;
  if (tokens.length >= 18) score += 1;
  if (/\b(parallel|architecture|arquitetura|system|migration|migracao|migração|refactor|rewrite|end-to-end|multi-step|cross-domain)\b/.test(text)) score += 1;
  if (/\b(debug|fix|repair)\b/.test(text)) score += 1;
  if (riskyReview) score += 1;
  if (/\b(test|tests|teste|testes|playwright)\b/.test(text) && !standaloneUiTask) score += 1;
  if (/\b(security|seguranca|segurança|auth|rls)\b/.test(text)) score += 1;
  if (/\b(production|producao|produção|payments|pagamentos|billing|checkout|dados sensiveis|dados sensíveis)\b/.test(text)) score += 1;
  if (simpleLocalEdit) score = Math.min(score, 1);
  else if (standaloneUiTask) score = Math.min(score, 2);

  if (score <= 1) return 'simple';
  if (score <= 3) return 'medium';
  return 'heavy';
}

function recommendedModels(complexity) {
  return {
    complexity,
    claude: MODEL_HINTS.claude[complexity],
    codex: MODEL_HINTS.codex[complexity],
  };
}

function scoreAsset(asset, taskTokens, activeCapabilityIntents = []) {
  const taskText = normalize(taskTokens.join(' '));
  const nameText = normalize(`${asset.name} ${asset.id}`);
  const descText = normalize(asset.description);
  const segments = semanticSegments(asset);
  const keywordText = Array.isArray(asset.keywords) ? asset.keywords.map(normalize) : [];
  const nameTokens = buildTokenSet(nameText.replace(/[:/]/g, ' '));
  const descTokens = buildTokenSet(descText);
  const keywordTokens = new Set(keywordText.flatMap((kw) => tokenize(kw)));
  const semanticTokens = buildAssetSemanticTokens(asset);
  let score = 0;
  const matched = [];

  for (const token of taskTokens) {
    if (!isMeaningfulToken(token)) continue;
    if (GENERIC_QUERY_TOKENS.has(token)) continue;
    let tokenScore = 0;
    if (nameTokens.has(token)) tokenScore += 6;
    if (descTokens.has(token)) tokenScore += 3;
    if (keywordTokens.has(token)) tokenScore += 2;
    if (semanticTokens.useWhen.has(token)) tokenScore += 4;
    if (semanticTokens.capability.has(token)) tokenScore += 4;
    if (semanticTokens.workflow.has(token)) tokenScore += 3;
    if (semanticTokens.headings.has(token)) tokenScore += 2;
    if (semanticTokens.summary.has(token)) tokenScore += 2;
    if (semanticTokens.preview.has(token)) tokenScore += 1;
    if (!tokenScore && token.length >= 5) {
      if (nameText.includes(token)) tokenScore += 2;
      if (descText.includes(token)) tokenScore += 1;
      if (segments.summary.includes(token)) tokenScore += 2;
      if (segments.preview.includes(token)) tokenScore += 1;
    }
    if (tokenScore > 0) {
      score += tokenScore;
      matched.push(token);
    }
  }

  const sourceText = normalize(asset.source || '');
  const assetName = normalize(asset.name);
  const intents = intentBoosts(taskTokens.join(' '));
  const capabilityMatches = activeCapabilityIntents.filter((intent) => intent.skills.some((name) => normalize(name) === assetName));
  const hasUiMotionLive = activeCapabilityIntents.some((intent) => intent.id === 'ui-motion-live');
  const hasVideoMotion = activeCapabilityIntents.some((intent) => intent.id === 'video-motion');
  if (STRONG_AUTHOR_SOURCES.some((prefix) => sourceText.startsWith(prefix))) score *= 1.12;
  if (PREFERRED_SKILLS.has(asset.name)) score *= 1.18;
  if (/\bawesome design\b/.test(taskText) && assetName === 'awesome-design-md') {
    score += 55;
    matched.push('awesome-design');
  }
  if (/\bawesome design\b/.test(taskText) && assetName === 'polish') {
    score += 40;
    matched.push('awesome-design');
  }
  if (capabilityMatches.length) {
    score += capabilityMatches.length * 14;
    for (const intent of capabilityMatches) matched.push(intent.id);
  }
  if (intents.branding && /brandkit|logo|brand|visual|design/.test(assetName)) score *= 1.18;
  if (intents.branding && assetName === 'brandkit') {
    score += 35;
    matched.push('logo-brand');
  }
  if (
    activeCapabilityIntents.some((intent) => intent.id === 'ui-interface')
    && activeCapabilityIntents.some((intent) => intent.id === 'logo-brand')
    && assetName === 'brandkit'
  ) score *= 0.92;
  if (hasUiMotionLive && /motion|impeccable|design-taste|frontend-design|frontend-slides|react:components/.test(assetName)) score *= 1.34;
  if (hasUiMotionLive && /remotion|hyperframe|higgsfield|website-to-hyperframes/.test(assetName)) score *= 0.9;
  if (hasVideoMotion && /hyperframe|higgsfield|higgs-field|remotion|video|slides|lottie|gsap|animejs/.test(assetName)) score *= 1.32;
  if (intents.analytics && /analytics|tracking|experiment|posthog|event/.test(assetName)) score *= 1.18;
  if ((intents.ui || intents.shortcuts) && /ui-ux-pro-max|ui-styling|frontend|design-taste|impeccable|ui-toolkit|design/.test(assetName)) score *= 1.2;
  if (intents.desktop && /electron|frontend|ui|design/.test(assetName)) score *= 1.12;
  if (asset.user_invocable) score *= 1.2;
  if (asset.type === 'skill') score *= 1.1;
  return { score, matched: Array.from(new Set(matched)).slice(0, 8) };
}

function enrichRankedAsset(asset, domain, result, executor = null, task = '', projectRoot = findProjectRoot()) {
  const invocation = asset.type === 'skill'
    ? resolveSkillInvocation(asset, task, executor, projectRoot)
    : {
        invoke: invocationHint(asset, task, executor, projectRoot),
        mechanism: null,
        command: null,
        pinned: false,
        skill: asset.name,
        target: normalizeTaskTarget(task),
        pinned_path: null,
      };
  const segments = semanticSegments(asset);
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    domain: domain.id,
    master_agent: domain.master_agent,
    score: Number(result.score.toFixed(2)),
    matched: result.matched,
    description: asset.description || '',
    content_summary: asset.content_summary || '',
    use_when: Array.isArray(asset.use_when) ? asset.use_when : [],
    workflow_terms: Array.isArray(asset.workflow_terms) ? asset.workflow_terms : [],
    capability_terms: Array.isArray(asset.capability_terms) ? asset.capability_terms : [],
    section_keywords: Array.isArray(asset.section_keywords) ? asset.section_keywords : [],
    semantic_strength: {
      use_when: segments.useWhen.length,
      workflow: segments.workflow.length,
      capability: segments.capability.length,
    },
    path: asset.path,
    source: asset.source,
    invoke: invocation.invoke,
    invocation,
  };
}

function canonicalAssetKey(asset) {
  return normalize(asset.name);
}

function assetTypeFit(asset, task) {
  const text = normalize(task);
  if (asset.type === 'skill') return 0;
  if (asset.type === 'agent') {
    return /\b(agent|especialista|expert|review|audit|auditoria|deep dive|second opinion|subagent)\b/.test(text) ? 2 : -4;
  }
  if (asset.type === 'mcp') {
    return /\b(mcp|browser|navegador|github|repo|pull request|pr|issue|web search|pesquisar na web|buscar na web|internet|docs atuais|documentacao atual|context7|playwright|chrome|tavily|exa|memory|memoria)\b/.test(text) ? 4 : -8;
  }
  if (asset.type === 'plugin') {
    if (/\b(plugin|extension|extensao|claude plugin|mcpb|install plugin|instalar plugin)\b/.test(text)) return 3;
    if (/\b(ui|ux|design|video|motion|logo|brand|frontend|hyperframe|hyperframes)\b/.test(text) && /ui|ux|design|video|motion|brand|hyperframe|hyperframes/.test(normalize(asset.name))) return -1;
    return -20;
  }
  return 0;
}

function invocationHint(asset, task, executor = null, projectRoot = findProjectRoot()) {
  if (asset.type === 'skill') {
    return resolveSkillInvocation(
      asset,
      task,
      {
        executor,
        allowPaneSpawn: normalize(executor?.name || process.env.ORACLE_EXECUTOR || '') === 'pane_spawn',
      },
      projectRoot,
    ).invoke;
  }
  if (asset.type === 'agent') {
    const executorName = normalize(executor?.name || process.env.ORACLE_EXECUTOR || '');
    if (executorName === 'pane_spawn') {
      return `pane_spawn visible pane, then prompt it to use ${asset.name}`;
    }
    if (executorName === 'oracle-query.js' || executorName === 'local-runner') {
      return `local guidance only: ${asset.name}`;
    }
    return `Task(subagent_type="${asset.name}")`;
  }
  if (asset.type === 'mcp') return `mcp__${asset.name}__*`;
  return `plugin:${asset.name}`;
}

function overclockOrchestrationPolicy(recommended) {
  return {
    paneSpawnAllowed: Boolean(recommended),
    spawnScope: recommended
      ? 'Open panes only for independent workstreams in the current task.'
      : 'Do not open extra panes; keep execution in the current pane.',
    ownership: {
      trackSpawnedPaneIds: true,
      closeOnlyOwnedPanes: true,
      forbidClosingCallerPane: true,
      requireExplicitUserSelectionForForeignPanes: true,
    },
    executionLoop: [
      'pane_spawn',
      'spawn_ready',
      'pane_write submit=true',
      'pane_wait_idle',
      'pane_read',
    ],
    preWriteReadiness: {
      required: true,
      probe: 'stable prompt visible',
      disallowStates: [
        'startup screen',
        'auth screen',
        'onboarding',
        'context budget warning',
      ],
      fallbackAction: 're-spawn with a lighter verified provider/model or mission-bound pane before writing the prompt.',
    },
    outputCapture: {
      required: true,
      probeSentinel: OUTPUT_PROBE_SENTINEL,
      emptyReadIsFailure: true,
      retryStrategy: 'same-pane-once-then-fallback-provider',
      maxAttempts: 2,
    },
    cleanupPolicy: {
      requireIdleCheck: true,
      requireExecutionLoopCompletion: true,
      failureMode: 'If the loop is incomplete, report failed orchestration instead of treating the pane as done or disposable.',
    },
  };
}

function scoreSupportingFit(asset, domainId, intents) {
  let score = 0;
  if (asset.type === 'skill') score += 3;
  else if (asset.type === 'agent') score += 2;
  else score += 1;

  score += Math.min(asset.workflow_terms?.length || 0, 6) * 0.3;
  score += Math.min(asset.capability_terms?.length || 0, 6) * 0.25;

  const name = normalize(asset.name);
  if (domainId === 'design-ui' && /brand|design|frontend|ui|ux|visual|hyperframe|motion|video/.test(name)) score += 2;
  if (domainId === 'web-dev' && /frontend|react|electron|playwright|shadcn|component/.test(name)) score += 2;
  if (intents.desktop && /electron|desktop/.test(name)) score += 1.5;
  if (intents.shortcuts && /frontend|design|component|react/.test(name)) score += 1.5;
  if (intents.branding && /brand|logo|visual|design/.test(name)) score += 1.5;
  return score;
}

function buildVirtualMasterReport(domain, ranked, task) {
  const intents = intentBoosts(task);
  const primary = ranked[0] || null;
  const supporting = [];
  const seen = new Set(primary ? [canonicalAssetKey(primary)] : []);

  for (const asset of ranked
    .map((candidate) => ({ candidate, fit: scoreSupportingFit(candidate, domain.id, intents) }))
    .sort((a, b) => (b.candidate.score + b.fit) - (a.candidate.score + a.fit))) {
    const key = canonicalAssetKey(asset.candidate);
    if (seen.has(key)) continue;
    supporting.push(asset.candidate);
    seen.add(key);
    if (supporting.length >= 2) break;
  }

  const matchedCapabilities = Array.from(new Set(
    ranked.slice(0, 5).flatMap((asset) => [
      ...(asset.matched || []),
      ...(asset.capability_terms || []).slice(0, 3),
      ...(asset.workflow_terms || []).slice(0, 2),
    ])
  )).slice(0, 10);

  const thesisParts = [];
  if (primary) thesisParts.push(`${primary.name} lidera`);
  if (supporting.length) thesisParts.push(`apoios: ${supporting.map((asset) => asset.name).join(', ')}`);
  if (matchedCapabilities.length) thesisParts.push(`sinais: ${matchedCapabilities.slice(0, 4).join(', ')}`);

  return {
    domain: domain.id,
    master_agent: domain.master_agent,
    asset_count: ranked.length,
    matches: ranked.length,
    top: ranked.slice(0, 5),
    bundle: [primary, ...supporting].filter(Boolean).slice(0, 3),
    matchedCapabilities,
    thesis: thesisParts.join(' | '),
  };
}

function buildRecommendedBundle(idx, domainReports, picks, task, executor = null, projectRoot = findProjectRoot()) {
  const intents = intentBoosts(task);
  const MAX_BUNDLE_SIZE = 9;
  const bundle = [];
  const seen = new Set();
  const taskText = normalize(task);
  const activeCapabilityIntents = matchedCapabilityIntents(task);
  const designContext = isProductImplementationContext(task) || /\b(design|ui|ux|frontend|interface|visual|layout)\b/.test(taskText);
  const videoContext = /\b(video|motion|hyperframes|remotion|reel|shorts|video-edit|video edit)\b/.test(taskText);
  const databaseContext = /\b(supabase|schema|banco de dados|database|postgres|migration|migracao|migração|rls|edge function|api|soft delete|tabela|entidade|relacionamento)\b/.test(taskText);
  const seoContext = /\b(seo|schema markup|json[- ]ld|technical seo|indexing|rich results|search console)\b/.test(taskText);
  const docsContext = /\b(docx|pdf|xlsx|spreadsheet|planilha|documento|document|files?|file workflow)\b/.test(taskText);
  const resolveAsset = (name) => findAssetByName(idx, name)
    || picks.find((candidate) => candidate.name === name)
    || domainReports.flatMap((report) => report.top || []).find((candidate) => candidate.name === name);
  const pushIfAvailable = (name) => {
    const asset = resolveAsset(name);
    if (asset && !seen.has(canonicalAssetKey(asset))) {
      const domain = idx.domains.find((candidate) => candidate.id === asset.domain || candidate.master_agent === asset.master_agent)
        || idx.domains.find((candidate) => candidate.id === 'tooling-meta')
        || { id: asset.domain || 'misc', master_agent: asset.master_agent || 'oracle-master-misc' };
      const enriched = asset.invoke
        ? asset
        : enrichRankedAsset(
            asset,
            domain,
            {
              score: Number.isFinite(asset.score) ? asset.score : STRONG_MATCH_THRESHOLD,
              matched: Array.isArray(asset.matched) ? asset.matched : ['required-priority-stack'],
            },
            executor,
            task,
            projectRoot,
          );
      bundle.push(enriched);
      seen.add(canonicalAssetKey(enriched));
      return true;
    }
    return false;
  };

  const preferredByIntent = [];
  for (const intent of activeCapabilityIntents) {
    preferredByIntent.push(intent.skills);
  }
  preferredByIntent.unshift(['using-superpowers', 'superpowers', 'gsd', 'gsd-autonomous', 'gsd-workstreams']);
  if (designContext || intents.shortcuts || intents.branding) {
    preferredByIntent.unshift(['frontend-design', 'design-taste-frontend', 'impeccable']);
  }
  if (intents.branding) preferredByIntent.push(['brandkit', 'design', 'brand', 'impeccable', 'high-end-visual-design']);
  if (intents.ui || intents.shortcuts) preferredByIntent.push(['awesome-design-md', 'ui-ux-pro-max', 'impeccable', 'design-taste-frontend', 'frontend-design', 'high-end-visual-design', 'emil-design-eng', 'shadcn-ui', 'react:components']);
  if (intents.desktop) preferredByIntent.push(['design-taste-frontend', 'frontend-design', 'zoom-meeting-sdk-electron']);
  if (activeCapabilityIntents.some((intent) => intent.id === 'ui-motion-live')) {
    preferredByIntent.push(['motion', 'impeccable', 'design-taste-frontend', 'frontend-design', 'frontend-slides', 'react:components']);
  }
  if (activeCapabilityIntents.some((intent) => intent.id === 'video-motion')) {
    preferredByIntent.push(['hyperframes', 'higgsfield', 'higgs-field', 'remotion', 'remotion-video-creation', 'remotion-to-hyperframes', 'website-to-hyperframes', 'frontend-slides']);
  }
  if (videoContext) {
    preferredByIntent.unshift(['hyperframes', 'hyperframes-cli', 'remotion-video-creation', 'remotion-to-hyperframes', 'remotion', 'frontend-slides']);
  }
  if (/\bawesome design\b/.test(taskText)) preferredByIntent.unshift(['awesome-design-md', 'polish']);
  if (isProductImplementationContext(task)) {
    preferredByIntent.unshift(['awesome-design-md', 'ui-ux-pro-max', 'impeccable', 'design-taste-frontend']);
    preferredByIntent.push(['react:components', 'shadcn-ui', 'frontend-design']);
  }
  if (/\b(supabase|schema|banco de dados|database|postgres|migration|migracao|migração|rls|edge function|api|soft delete|tabela|entidade|relacionamento)\b/.test(taskText)) {
    preferredByIntent.push(['supabase', 'postgres-patterns', 'supabase-migration-deep-dive']);
  }
  if (/\b(dashboard|painel|grafico|gráfico|metricas|métricas|kpi|funil|lucro|percentual|comparativo|tendencia|tendência)\b/.test(taskText)) {
    preferredByIntent.push(['ui-ux-pro-max', 'impeccable', 'awesome-design-md', 'design-taste-frontend']);
  }
  if (/\b(ga4|gtm|google analytics|tag manager|utm|utms|tracking|conversion tracking|event tracking|attribution)\b/.test(taskText)) {
    preferredByIntent.unshift(['analytics-tracking', 'product-tracking-generate-implementation-guide', 'configuring-experiment-analytics']);
  }
  if (seoContext) {
    preferredByIntent.unshift(['seo-audit', 'schema-markup', 'technical-seo', 'seo']);
  }
  if (docsContext) {
    preferredByIntent.unshift(['docx', 'pdf', 'xlsx']);
  }
  if (/\boracle\b/.test(taskText) || (/\bskill/.test(taskText) && /\bjunt/.test(taskText))) {
    preferredByIntent.unshift(['skill-oracle', 'workspace-surface-audit', 'plugin-structure']);
  }

  const requiredBundleNames = [];
  requiredBundleNames.push('using-superpowers', 'gsd');
  if (designContext) {
    requiredBundleNames.push('frontend-design');
  }
  if (isProductImplementationContext(task)) {
    requiredBundleNames.push('awesome-design-md');
  }
  if (/\bawesome design\b/.test(taskText)) {
    requiredBundleNames.push('polish');
  }
  if (intents.branding) {
    requiredBundleNames.push('brandkit');
  }
  if (databaseContext) {
    requiredBundleNames.push('supabase', 'postgres-patterns');
  }
  if (seoContext) {
    requiredBundleNames.push('seo-audit', 'schema-markup', 'technical-seo', 'seo');
  }
  if (docsContext) {
    requiredBundleNames.push('docx', 'pdf', 'xlsx');
  }
  if (videoContext) {
    requiredBundleNames.push('hyperframes', 'hyperframes-cli', 'remotion-video-creation', 'remotion-to-hyperframes', 'remotion');
  }
  if (designContext && !videoContext && !isProductImplementationContext(task)) {
    requiredBundleNames.push('ui-ux-pro-max', 'polish');
  }
  if (isProductImplementationContext(task)) {
    requiredBundleNames.push('impeccable', 'ui-ux-pro-max', 'react:components');
  }

  for (const name of requiredBundleNames) {
    pushIfAvailable(name);
  }

  for (const names of preferredByIntent) {
    for (const name of names) {
      if (pushIfAvailable(name)) {
        break;
      }
    }
  }

  for (const report of domainReports) {
    const primary = (report.bundle || [])[0];
    if (!primary) continue;
    const key = canonicalAssetKey(primary);
    if (seen.has(key)) continue;
    bundle.push(primary);
    seen.add(key);
    if (bundle.length >= MAX_BUNDLE_SIZE) return bundle.slice(0, MAX_BUNDLE_SIZE);
  }

  for (const report of domainReports) {
    for (const asset of (report.bundle || []).slice(1)) {
      const key = canonicalAssetKey(asset);
      if (seen.has(key)) continue;
      bundle.push(asset);
      seen.add(key);
      if (bundle.length >= MAX_BUNDLE_SIZE) return bundle.slice(0, MAX_BUNDLE_SIZE);
    }
  }

  for (const names of preferredByIntent) {
    for (const name of names) {
      if (pushIfAvailable(name)) {
        break;
      }
    }
  }

  for (const report of domainReports.slice(0, 3)) {
    const asset = (report.top || [])[0];
    if (asset && !seen.has(canonicalAssetKey(asset))) {
      bundle.push(asset);
      seen.add(canonicalAssetKey(asset));
    }
  }

  return bundle.slice(0, MAX_BUNDLE_SIZE);
}

function mergeBundleIntoPicks(bundle, picks, limit) {
  const merged = [];
  const seen = new Set();

  for (const asset of [...bundle, ...picks]) {
    const key = canonicalAssetKey(asset);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(asset);
    if (merged.length >= limit) break;
  }

  return merged;
}

function findAssetByName(idx, name) {
  return (idx.assets || []).find((asset) => asset.name === name || asset.id === `skill:${name}` || asset.id === name) || null;
}

function workflowRecommendations(idx, task, domains) {
  const text = normalize(task);
  const tokenCount = tokenize(task).length;
  const nonTrivial = tokenCount >= 8 || domains.length >= 2 || isProductImplementationContext(task);
  const featureWork = /\b(build|create|add|implement|update|refactor|feature|app|dashboard|ui|ux|schema|migration|soft delete|criar|implementar|atualizar|melhorar|sistema|pagina|página|formulario|formulário)\b/.test(text);
  const multiStep = domains.length >= 3 || /\b(schema|migration|database|supabase|api|ui|dashboard|soft delete|lixeira|rls|multi-step|end-to-end|banco de dados)\b/.test(text);
  const projectRoot = findProjectRoot();

  const names = [];
  if (nonTrivial) names.push('using-superpowers');
  if (featureWork) names.push('brainstorming');
  if (multiStep) names.push('writing-plans');

  const seen = new Set();
  return names
    .filter((name) => {
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((name) => {
      const asset = findAssetByName(idx, name);
      const resolved = asset ? resolveSkillInvocation(asset, task, null, projectRoot) : null;
      return {
        name,
        type: asset?.type || 'skill',
        domain: asset?.domain || 'tooling-meta',
        source: asset?.source || 'expected-local-skill',
        path: asset?.path || null,
        invoke: resolved?.invoke || `Skill("${name}")`,
        invocation: resolved || null,
        available: Boolean(asset),
      };
    });
}

function parallelExecutionPlan(task, domains, preflight) {
  const text = normalize(task);
  const executorName = normalize(preflight?.preflight?.executor?.name || preflight?.executor?.name || '');
  const runtimeName = normalize(preflight?.preflight?.runtime || preflight?.runtime || '');
  const visiblePaneExecutor = executorName === 'pane_spawn';
  const explicitSwarm = /\b(swarm|parallel|paralelo|paralela|pane|panes|agents|agentes|workstreams|subagents|multi-agent|orquestracao|orquestração)\b/.test(text);
  const multiStepRisk = /\b(parallel|architecture|arquitetura|api|schema|migration|migracao|migração|soft delete|lixeira|rls|security|seguranca|segurança|test|tests|teste|testes|playwright|multi-step|end-to-end|cross-domain|banco de dados|database|auth|checkout|payment|pagamento|stripe|pix)\b/.test(text);
  const heavy = explicitSwarm || domains.length >= 3 || (domains.length >= 2 && multiStepRisk);

  if (!heavy) {
    return {
      recommended: false,
      executor: visiblePaneExecutor ? 'pane_spawn' : 'none',
      reason: 'Task does not clearly split into independent workstreams.',
      orchestrationPolicy: overclockOrchestrationPolicy(false),
      workstreams: [],
    };
  }

  const workstreams = [];
  if (explicitSwarm && (domains.includes('design-ui') || domains.includes('web-dev') || /\b(ui|ux|react|frontend|surface|interface|visual|layout)\b/.test(text))) {
    workstreams.push('Design critique: inspect the current surface, identify generic UI patterns, and propose a sharper premium direction');
    workstreams.push('Implementation pass: edit the app surface, components, and CSS while preserving existing data flow');
    workstreams.push('Validation pass: run typecheck/build and review responsive, accessibility, and regression risks');
  }
  if (domains.includes('database-data') || /\b(supabase|schema|postgres|migration|rls|soft delete|banco de dados)\b/.test(text)) {
    workstreams.push('Database/Supabase schema, RLS, migrations, soft delete, restore semantics');
  }
  if (domains.includes('design-ui') || domains.includes('web-dev') || /\b(ui|ux|react|frontend|form|modal|pagina|página)\b/.test(text)) {
    workstreams.push('React UI/UX components, forms, page flows, shadcn integration');
  }
  if (domains.includes('data-analytics') || /\b(dashboard|grafico|gráfico|metricas|métricas|kpi|funil|comparativo)\b/.test(text)) {
    workstreams.push('Analytics dashboards, grouping, period comparison, funnel metrics');
  }
  if (/\b(test|qa|security|audit|auditoria|playwright|rls|delete|exclusao|exclusão)\b/.test(text)) {
    workstreams.push('QA/security review, Playwright checks, RLS and destructive-action audit');
  }

  return {
    recommended: workstreams.length >= 2,
    executor: visiblePaneExecutor
      ? 'pane_spawn'
      : runtimeName === 'claude-code'
        ? 'Task'
        : runtimeName === 'codex'
          ? 'oracle-query.js'
          : runtimeName === 'antigravity'
            ? 'agy'
            : 'visible-pane-required',
    model: visiblePaneExecutor ? null : null,
    reason: visiblePaneExecutor
      ? 'Independent workstreams can run in visible Overclock panes.'
      : runtimeName === 'claude-code'
        ? 'Use Claude Code Task subagents for independent workstreams.'
        : runtimeName === 'codex'
          ? 'Use the Codex local runner and manifest execution.'
          : runtimeName === 'antigravity'
            ? 'Use the Antigravity CLI adapter and local manifest execution.'
            : 'Use visible panes/agents only; do not use invisible Task subagents in Overclock.',
    orchestrationPolicy: overclockOrchestrationPolicy(workstreams.length >= 2),
    workstreams: workstreams.slice(0, 4),
  };
}

function buildDispatchPlan({ task, picks, bundle, parallelPlan, modelHints, executor, preflight, providerInventory }) {
  const executorName = normalize(executor?.name || '');
  const runtimeName = normalize(preflight?.preflight?.runtime || preflight?.runtime || '');
  const visiblePanes = executorName === 'pane_spawn' || parallelPlan?.executor === 'pane_spawn';
  const executionTarget = selectExecutionProvider(task, modelHints?.complexity || 'simple', providerInventory, {
    visiblePanes,
  });
  const selectedProviderId = executionTarget.providerId;
  const selectedModel = executionTarget.model || (runtimeName === 'claude-code'
    ? modelHints?.claude || null
    : modelHints?.codex || modelHints?.claude || null);
  const mode = parallelPlan?.recommended ? 'parallel' : 'single';
  const taskPrompt = String(task || '').trim();
  const workstreamAssets = (description) => {
    const text = normalize(description);
    const matched = picks.filter((asset) => {
      const domain = normalize(asset.domain || '');
      const name = normalize(asset.name || '');
      if (/(database|schema|rls|migration|supabase|postgres|soft delete|banco de dados)/.test(text)) {
        return /database-data|backend-api|devops-infra|security-audit/.test(domain) || /supabase|postgres|schema|migration|rls/.test(name);
      }
      if (/(dashboard|analytics|metric|kpi|funnel|period comparison)/.test(text)) {
        return /data-analytics|web-dev|design-ui/.test(domain) || /analytics|dashboard|chart|metric|posthog/.test(name);
      }
      if (/(qa|security|playwright|audit|destructive-action|RLS)/.test(text)) {
        return /testing-qa|security-audit/.test(domain) || /playwright|test|security|audit|rls/.test(name);
      }
      if (/(ui|ux|react|frontend|page|form|shadcn)/.test(text)) {
        return /design-ui|web-dev/.test(domain) || /react|ui|ux|frontend|design|shadcn/.test(name);
      }
      return false;
    });
    return matched.length ? matched.slice(0, 3) : picks.slice(0, 3);
  };

  const buildFallbackProviders = (selectedProviderId) => {
    const providers = Array.isArray(providerInventory?.providers) ? providerInventory.providers : [];
    const preferred = providers
      .map((provider) => provider.id)
      .filter(Boolean);
    const ordered = [
      selectedProviderId,
      ...PREFERRED_EXECUTION_PROVIDER_ORDER,
      ...preferred,
    ]
      .map((id) => canonicalProviderId(id))
      .filter((id, index, array) => id && array.indexOf(id) === index);
    return ordered.filter((id) => id !== selectedProviderId);
  };

  const buildPanePrompt = (description, index, assets) => {
    const lines = [
      `Execute this Oracle workstream: ${description}.`,
      `User task: ${taskPrompt}`,
      '',
      'Instructions:',
      '0. Submit this payload immediately with pane_write submit=true.',
      `0a. Your first visible line must be exactly: ${OUTPUT_PROBE_SENTINEL}.`,
      '0b. Before submitting the workstream, inspect the pane surface and only write after the visible prompt is stable.',
      '0c. If the pane is showing a command-style Codex prompt such as "Run /review on my current changes", submit that activation command first, wait for the pane to enter Working, and then continue with the workstream prompt.',
      '1. Follow the user task exactly.',
      '2. Use the selected model for the pane.',
      '3. Produce only the result needed for this workstream.',
      '4. If you need to touch files, make the minimal safe change.',
      '5. Do not leave the pane sitting at a shell prompt.',
      '6. If the pane reaches idle but no readable output is captured, retry once with the same prompt and then fall back to the next verified provider.',
    ];
    if (Array.isArray(assets) && assets.length) {
      lines.push('');
      lines.push('Oracle execution targets:');
      for (const asset of assets) {
        lines.push(`- ${asset.name}: ${asset.invoke}`);
      }
    }
    if (index === 0) {
      lines.splice(1, 0, 'This is the first workstream in the current dispatch plan.');
    }
    return lines.join('\n');
  };

  return {
    mode,
    host: visiblePanes ? 'overclock' : (FIRST_CLASS_HOSTS.has(runtimeName) ? runtimeName : 'local'),
    complexity: modelHints?.complexity || 'simple',
    selected_provider: selectedProviderId,
    selected_provider_reason: executionTarget.reason,
    host_adapter: buildHostAdapterPolicy(runtimeName, executorName, visiblePanes),
    models: {
      claude: modelHints?.claude || null,
      codex: modelHints?.codex || null,
    },
    selected_model: selectedModel,
    selected_model_reason: executionTarget.provider
      ? `Use ${selectedProviderId}${selectedModel ? ` / ${selectedModel}` : ''} from the verified local provider inventory.`
      : modelHints?.complexity === 'simple'
        ? 'Simple task; use the cheapest safe model.'
        : modelHints?.complexity === 'medium'
          ? 'Moderate task; use a mid-tier model.'
          : 'Heavy task; use the strongest model available.',
    provider_inventory: providerInventory ? {
      available_provider_ids: providerInventory.availableProviderIds || [],
      active_provider_id: providerInventory.activeProviderId || null,
      active_model: providerInventory.activeModel || null,
      providers: (providerInventory.providers || []).map((provider) => ({
        id: provider.id,
        label: provider.label,
        type: provider.type,
        models: provider.models || [],
        available: Boolean(provider.available),
        confidence: provider.confidence || 'low',
      })),
    } : null,
    execution_target_count: Math.max(picks.length, bundle.length),
    execution_required: picks.map((asset) => ({
      name: asset.name,
      type: asset.type,
      domain: asset.domain,
      invoke: asset.invoke,
      mechanism: asset.invocation?.mechanism || null,
      command: asset.invocation?.command || null,
      pane_prompt: executionPromptForAsset(asset, task, selectedModel),
      pane_spawn: {
        provider_id: selectedProviderId,
        model: selectedModel,
        override_host_session: true,
      },
      pane_write: (() => {
        const prompt = executionPromptForAsset(asset, task, selectedModel);
        return prompt
          ? {
              submit: true,
              content: prompt,
            }
          : null;
      })(),
      output_capture_policy: {
        required: true,
        probe_sentinel: OUTPUT_PROBE_SENTINEL,
        empty_read_is_failure: true,
        retry_strategy: 'same-pane-once-then-fallback-provider',
        max_attempts: 2,
        fallback_providers: buildFallbackProviders(selectedProviderId).slice(0, 3),
      },
      provider_id: selectedProviderId,
      model: selectedModel,
    })),
    parallel_workstreams: parallelPlan?.recommended
      ? parallelPlan.workstreams.map((item, index) => {
          const assets = workstreamAssets(item);
          const panePrompt = buildPanePrompt(item, index, assets);
          return {
            description: item,
            executor: parallelPlan.executor,
            provider_id: selectedProviderId,
            model: selectedModel,
            assets: assets.map((asset) => ({
              name: asset.name,
              type: asset.type,
              domain: asset.domain,
              invoke: asset.invoke,
              mechanism: asset.invocation?.mechanism || null,
            })),
            pane_prompt: panePrompt,
            pane_spawn: {
              provider_id: selectedProviderId,
              model: selectedModel,
              override_host_session: true,
            },
            pane_write: {
              submit: true,
              content: panePrompt,
            },
            output_capture_policy: {
              required: true,
              probe_sentinel: OUTPUT_PROBE_SENTINEL,
              empty_read_is_failure: true,
              retry_strategy: 'same-pane-once-then-fallback-provider',
              max_attempts: 2,
              fallback_providers: buildFallbackProviders(selectedProviderId).slice(0, 3),
            },
          };
        })
      : [],
    notes: [
      visiblePanes
        ? 'Spawn one visible pane per independent workstream, pass the selected provider and selected model explicitly, and submit only after the pane surface is stable. For Codex command-mode panes, activate the command shown on screen first (for example /review) before sending the workstream prompt.'
        : 'Host does not expose visible panes; execute in the current runtime or route to a supported executor.',
      visiblePanes
        ? 'Before pane_write, wait for the spawned pane to show a stable ready prompt. If the pane still shows startup chrome, auth screens, onboarding, context-budget warnings, or a booting MCP server, treat it as not ready and re-spawn or fallback. If the prompt surface is command-mode, send the visible activation command first and only then the Oracle workstream.'
        : null,
      !FIRST_CLASS_HOSTS.has(runtimeName)
        ? 'If the host cannot adapt cleanly, recommend the first-class standards: Overclock, Claude Code, Codex, or Antigravity CLI.'
        : null,
      'Do not downgrade execution-ready picks into discovery-only recommendations.',
      'If a pane is spawned, complete pane_write -> pane_wait_idle -> pane_read before treating the workstream as active.',
      'If a Codex pane is command-mode, use the visible activation command on the pane first, then submit the workstream prompt after the pane starts working.',
      `If pane_read returns no readable output, retry with the same prompt once and use ${OUTPUT_PROBE_SENTINEL} as the visible probe before falling back to the next verified provider.`,
    ].filter(Boolean),
  };
}

function buildExecutionManifest({ task, picks, bundle, dispatchPlan, parallelPlan, preflight }) {
  const visiblePanes = dispatchPlan?.host === 'overclock';
  const stages = [
    { id: 'spawn', label: 'spawn visible pane', required: visiblePanes },
    { id: 'spawn_ready', label: 'wait until pane is ready for input', required: visiblePanes },
    { id: 'write', label: 'submit prompt with submit=true', required: visiblePanes },
    { id: 'wait_idle', label: 'wait for idle', required: visiblePanes },
    { id: 'read', label: 'read result', required: visiblePanes },
  ];

  const workstreams = (dispatchPlan?.parallel_workstreams || []).map((item, index) => ({
    id: `workstream-${index + 1}`,
    description: item.description,
    executor: item.executor,
    provider_id: item.provider_id || dispatchPlan?.selected_provider || null,
    model: item.model,
    state: visiblePanes ? 'pending' : 'host-managed',
    assets: item.assets || [],
    pane_prompt: item.pane_prompt,
    pane_spawn: item.pane_spawn || {
      provider_id: item.provider_id || dispatchPlan?.selected_provider || null,
      model: item.model || dispatchPlan?.selected_model || null,
      override_host_session: true,
    },
    pane_write: item.pane_write || {
      submit: true,
      content: item.pane_prompt,
    },
    output_capture_policy: item.output_capture_policy || {
      required: true,
      probe_sentinel: OUTPUT_PROBE_SENTINEL,
      empty_read_is_failure: true,
      retry_strategy: 'same-pane-once-then-fallback-provider',
      max_attempts: 2,
      fallback_providers: [],
    },
    completion_criteria: [
      'prompt submitted',
      'pane reached idle',
      'pane output read',
      `probe sentinel captured: ${OUTPUT_PROBE_SENTINEL}`,
    ],
    ownership: {
      close_only_owned_panes: true,
      never_close_caller_pane: true,
      track_spawned_pane_ids: true,
    },
  }));

  return {
    version: 1,
    task,
    runtime: preflight?.preflight?.runtime || 'unknown',
    executor: dispatchPlan?.host || 'local',
    host_adapter: dispatchPlan?.host_adapter || null,
    selected_provider: dispatchPlan?.selected_provider || null,
    selected_model: dispatchPlan?.selected_model || null,
    provider_inventory: dispatchPlan?.provider_inventory || null,
    supported_hosts: ['overclock', 'claude-code', 'codex', 'antigravity'],
    host_contract: {
      visible_panes: visiblePanes,
      dispatch_style: visiblePanes ? 'visible-pane-swarm' : 'local-plan',
      state_machine: ['spawn', 'spawn_ready', 'write', 'wait_idle', 'read'],
      pane_write_submission_required: true,
      empty_read_is_failure: true,
      output_capture_required: true,
      spawn_ready_required: true,
    },
    stages,
    bundle: (bundle || []).map((asset) => ({
      name: asset.name,
      type: asset.type,
      domain: asset.domain,
      invoke: asset.invoke,
      mechanism: asset.invocation?.mechanism || null,
    })),
    picks: (picks || []).map((asset) => ({
      name: asset.name,
      type: asset.type,
      domain: asset.domain,
      invoke: asset.invoke,
      mechanism: asset.invocation?.mechanism || null,
      command: asset.invocation?.command || null,
    })),
    workstreams,
  };
}

async function selectAssets(idx, task, options = {}) {
  // Keyword-based domain detection (baseline)
  const domainIds = detectDomains(task, idx, options.domains || []);
  const taskTokens = positiveTokens(task);
  const executor = options.executor || options.preflight?.preflight?.executor || null;
  const projectRoot = options.projectRoot || findProjectRoot();
  const activeCapabilityIntents = matchedCapabilityIntents(task);
  const blockedDomains = domainBlocksFromNegation(task);

  // Embedding enhancement: load pre-built vectors and embed the query
  let queryVector = null;
  let embedData = null;
  let embedLookup = null;
  let apiConfig = null;
  if (!options.noEmbed) {
    const mods = getEmbedMods();
    if (mods && fs.existsSync(EMBED_INDEX)) {
      try {
        embedData = JSON.parse(fs.readFileSync(EMBED_INDEX, 'utf8'));
        embedLookup = getEmbeddingLookup(embedData);
        apiConfig = mods.config.getApiKey();
        if (apiConfig) {
          const [v] = await mods.embed.embedTexts([task.slice(0, 512)], apiConfig);
          queryVector = v;
        }
      } catch (_) {
        embedData = null;
        queryVector = null;
      }
    }
  }

  // Embedding-enhanced domain selection: filter false positives + add missed domains
  let finalDomainIds = domainIds;
  if (queryVector && embedData && embedData.domain_centroids) {
    const { cosineSimilarity } = getEmbedMods().embed;

    // Score every domain against the query vector
    const centroidScores = new Map(
      DOMAIN_KEYWORDS.map((d) => [
        d.id,
        embedLookup.byDomain.get(d.id)
          ? scoreEmbeddingVector(queryVector, embedLookup.byDomain.get(d.id), cosineSimilarity)
          : 0,
      ]),
    );

    // Filter keyword-detected domains: drop those with low centroid similarity (false positives)
    const filteredKeyword = domainIds.filter((id) => (centroidScores.get(id) || 0) >= 0.25 || hasExplicitDomainSignal(task, id));

    // Add high-confidence embedding-only domains the keywords missed
    const embOnly = [...centroidScores.entries()]
      .filter(([id, sim]) => sim >= 0.5 && !filteredKeyword.includes(id))
      .filter(([id]) => !EXPLICIT_SIGNAL_DOMAINS.has(id) || hasExplicitDomainSignal(task, id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    const merged = [...new Set([...filteredKeyword, ...embOnly])].slice(0, MAX_DOMAINS);
    // Fallback: if filtering removed everything, keep top keyword domain
    finalDomainIds = merged.length > 0 ? merged : domainIds.slice(0, 1);
  }

  const explicitDomainIds = domainIds.filter((id) => hasExplicitDomainSignal(task, id));
  finalDomainIds = [...new Set([...explicitDomainIds, ...finalDomainIds])].slice(0, MAX_DOMAINS);

  if (!(options.domains || []).length) {
    finalDomainIds = finalDomainIds
      .filter((id) => !blockedDomains.has(id))
      .filter((id) => !(id === 'marketing-growth' && isProductImplementationContext(task) && !hasMarketingExecutionIntent(task)))
      .filter((id) => !EXPLICIT_SIGNAL_DOMAINS.has(id) || hasExplicitDomainSignal(task, id));
    if (!finalDomainIds.length) finalDomainIds = ['misc'];
  }

  const byKey = new Map();
  const domainReports = [];

  for (const domainId of finalDomainIds) {
    const domain = idx.domains.find((d) => d.id === domainId);
    if (!domain) continue;

    const assets = idx.assets.filter((asset) => asset.master_agent === domain.master_agent);
    const ranked = assets
      .map((asset) => {
        const result = scoreAsset(asset, taskTokens, activeCapabilityIntents);
        let { score } = result;
        score += assetTypeFit(asset, task);

        // Additive embedding bonus: semantically similar assets get a boost
        if (queryVector && embedLookup) {
          const assetEmbed = embedLookup.byAsset.get(asset.name);
          const chunkVectors = embedLookup.byChunkAsset.get(asset.name) || [];
          const cosine = getEmbedMods().embed.cosineSimilarity;
          const sims = [];
          if (assetEmbed && assetEmbed.vector) sims.push(scoreEmbeddingVector(queryVector, assetEmbed.vector, cosine));
          for (const vec of chunkVectors) sims.push(scoreEmbeddingVector(queryVector, vec, cosine));
          const sim = sims.length ? Math.max(...sims) : 0;
          // Bonus up to +27.5 for sim=1.0 (threshold at 0.45 to cut noise)
          if (sim > 0.45) score += (sim - 0.45) * 50;
        }

        return enrichRankedAsset(asset, domain, { score, matched: result.matched }, executor, task, projectRoot);
      })
      .filter((asset) => asset.score > 0)
      .sort((a, b) => {
        const typeDelta = (TYPE_PRIORITY[b.type] || 0) - (TYPE_PRIORITY[a.type] || 0);
        if (Math.abs(b.score - a.score) < 0.75 && typeDelta !== 0) return typeDelta;
        return b.score - a.score;
      })
      .slice(0, 10);

    domainReports.push(buildVirtualMasterReport(domain, ranked, task));

    for (const asset of ranked) {
      const key = canonicalAssetKey(asset);
      const existing = byKey.get(key);
      if (!existing || asset.score > existing.score) {
        byKey.set(key, asset);
      } else if (existing && asset.domain !== existing.domain) {
        existing.score = Number((existing.score + 1).toFixed(2));
      }
    }
  }

  const rankedPicks = Array.from(byKey.values())
    .filter((asset) => asset.score >= STRONG_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || DEFAULT_LIMIT);
  const bundle = buildRecommendedBundle(idx, domainReports, rankedPicks, task, executor, projectRoot);
  const picks = mergeBundleIntoPicks(bundle, rankedPicks, options.limit || DEFAULT_LIMIT);

  let synthesis = null;
  const topGap = rankedPicks.length >= 2 ? rankedPicks[0].score - rankedPicks[1].score : Infinity;
  const ambiguous = finalDomainIds.length >= 2 && (topGap < 4 || picks.length >= 3 || /\boracle\b|\bjunt|bundle|compo/i.test(normalize(task)));
  if (ambiguous) {
    synthesis = await synthesizeBundleWithOpenAI({
      task,
      domainReports,
      picks,
      bundle,
      domains: finalDomainIds,
      apiConfig,
    });
  }

  if (synthesis && Array.isArray(synthesis.bundle_names) && synthesis.bundle_names.length) {
    const lookup = buildSynthesisLookup(picks, rankedPicks, domainReports);
    const llmBundle = synthesis.bundle_names
      .map((name) => lookup.get(normalize(name)))
      .filter(Boolean);
    if (llmBundle.length) {
      synthesis.bundle = llmBundle.map((asset) => asset.name);
      synthesis.bundle_names = llmBundle.map((asset) => asset.name);
      synthesis.resolved_bundle = llmBundle;
      picks.splice(0, picks.length, ...mergeBundleIntoPicks(llmBundle, rankedPicks, options.limit || DEFAULT_LIMIT));
    }
  }

  const complexity = estimateComplexity(task, finalDomainIds, picks);
  const modelHints = recommendedModels(complexity);
  const providerInventory = detectExecutionProviderInventory();
  const taskTokensForFallback = positiveTokens(task).filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
  const directTaskMatch = picks.some((asset) => {
    const haystack = normalize(`${asset.name} ${asset.id}`);
    return taskTokensForFallback.some((token) => haystack.includes(token));
  });

  const fallbackRecommended = picks.length === 0
    || (finalDomainIds.length === 1 && finalDomainIds[0] === 'misc' && !directTaskMatch);
  const processWorkflow = workflowRecommendations(idx, task, finalDomainIds);
  const parallelPlan = parallelExecutionPlan(task, finalDomainIds, options.preflight || { executor });
  const dispatchPlan = buildDispatchPlan({
    task,
    picks,
    bundle,
    parallelPlan,
    modelHints,
    executor,
    preflight: options.preflight,
    providerInventory,
  });
  const executionManifest = buildExecutionManifest({
    task,
    picks,
    bundle,
    dispatchPlan,
    parallelPlan,
    preflight: options.preflight,
  });

  return {
    task,
    domains: finalDomainIds,
    embeddingUsed: queryVector !== null,
    picks,
    bundle,
    domainReports,
    virtualMasters: domainReports.map((report) => ({
      domain: report.domain,
      master_agent: report.master_agent,
      thesis: report.thesis,
      bundle: (report.bundle || []).map((asset) => asset.name),
    })),
    synthesis,
    synthesisUsed: Boolean(synthesis),
    suggestions: proactiveSuggestions(task, finalDomainIds, idx),
    processWorkflow,
    parallelPlan,
    dispatchPlan,
    executionManifest,
    fallbackRecommended,
    fallback: fallbackRecommended ? fallbackGuidance(task) : null,
    modelHints,
  };
}

function proactiveSuggestions(task, domainIds, idx) {
  const suggestions = new Set();
  const text = normalize(task);
  const codeLike = /\b(build|create|add|implement|fix|refactor|code|app|api|feature)\b/.test(text);

  if (codeLike) {
    suggestions.add('testing-qa');
    suggestions.add('security-audit');
  }

  for (const domainId of domainIds) {
    const meta = DOMAIN_KEYWORDS.find((d) => d.id === domainId);
    for (const id of (meta && meta.proactive) || []) suggestions.add(id);
  }

  return Array.from(suggestions)
    .filter((id) => !domainIds.includes(id))
    .filter((id) => idx.domains.some((d) => d.id === id))
    .slice(0, 4)
    .map((id) => {
      const domain = idx.domains.find((d) => d.id === id);
      return { domain: id, master_agent: domain.master_agent, asset_count: domain.asset_count };
    });
}

function formatStats(idx) {
  const byType = idx.stats && idx.stats.by_type ? idx.stats.by_type : {};
  const topDomains = Object.entries((idx.stats && idx.stats.by_domain) || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => `  ${id}: ${count}`)
    .join('\n');
  return [
    `Oracle index: ${idx.stats.total} assets indexed at ${idx.generated_at}`,
    `  by type: ${byType.skill || 0} skills, ${byType.agent || 0} agents, ${byType.plugin || 0} plugins, ${byType.mcp || 0} mcp`,
    '  top domains:',
    topDomains,
  ].join('\n');
}

function formatDomains(idx) {
  return idx.domains
    .map((d) => `${d.id.padEnd(18)} ${String(d.asset_count).padStart(5)}  ${d.master_agent}`)
    .join('\n');
}

function formatResult(result) {
  const lines = [];
  lines.push(`Oracle local picks for: ${result.task}`);
  lines.push(`Domains: ${(result.domains || []).join(', ')}`);
  lines.push('Dispatch mode: execute every recommended asset that is available in the current runtime');
  if (result.embeddingUsed) lines.push('Mode: semantic (keyword + embedding hybrid)');
  if (result.modelHints) {
    lines.push(`Model hint: ${result.modelHints.complexity} | Claude=${result.modelHints.claude} | Codex=${result.modelHints.codex}`);
  }
  if (result.dispatchPlan) {
    lines.push(`Execution plan: ${result.dispatchPlan.mode} on ${result.dispatchPlan.host}`);
    if (result.dispatchPlan.host_adapter) {
      lines.push(`Host adapter: ${result.dispatchPlan.host_adapter.adapter} (${result.dispatchPlan.host_adapter.execution_mode})`);
      if (result.dispatchPlan.host_adapter.supported) {
        lines.push('Host class: first-class');
      } else if (Array.isArray(result.dispatchPlan.host_adapter.fallback_recommendations) && result.dispatchPlan.host_adapter.fallback_recommendations.length) {
        lines.push(`Host class: unsupported; recommend ${result.dispatchPlan.host_adapter.fallback_recommendations.join(', ')}`);
      }
    }
    lines.push(`Selected model: ${result.dispatchPlan.selected_model || 'n/a'} (${result.dispatchPlan.selected_model_reason})`);
    if (result.dispatchPlan.models) {
      lines.push(`Model matrix: Claude=${result.dispatchPlan.models.claude || 'n/a'} | Codex=${result.dispatchPlan.models.codex || 'n/a'}`);
    }
  }
  if (result.executionManifest) {
    lines.push(`Execution manifest: ${result.executionManifest.version} (${result.executionManifest.host_contract.dispatch_style})`);
    if (Array.isArray(result.executionManifest.supported_hosts)) {
      lines.push(`Supported hosts: ${result.executionManifest.supported_hosts.join(', ')}`);
    }
    lines.push(`State machine: ${(result.executionManifest.host_contract.state_machine || []).join(' -> ')}`);
    lines.push(`Workstreams: ${result.executionManifest.workstreams.length}`);
  }
  if (result.synthesis && result.synthesis.reasoning) {
    lines.push('LLM synthesis: active');
    lines.push(`Synthesis: ${result.synthesis.reasoning}`);
    if (result.synthesis.caution) {
      lines.push(`Caution: ${result.synthesis.caution}`);
    }
    lines.push('');
  }
  lines.push('');

  if (!result.picks.length) {
    lines.push('No strong local match. Fallback required: use find-skills ecosystem search.');
    if (result.fallback?.available) {
      lines.push(`Fallback invoke: ${result.fallback.invoke}`);
      lines.push(`find-skills path: ${result.fallback.path}`);
      lines.push('After accepting a result, Oracle will rebuild automatically when the installed inventory changes.');
    } else {
      lines.push('The `find-skills` skill is not installed locally.');
      lines.push('Install it from the official Vercel Labs repository so Oracle can search the ecosystem:');
      lines.push('https://github.com/vercel-labs/skills');
    }
  } else {
    if (result.processWorkflow && result.processWorkflow.length) {
      lines.push('Recommended workflow:');
      result.processWorkflow.forEach((step, index) => {
        const availability = step.available ? '' : ' (not indexed in current inventory)';
        lines.push(`  ${index + 1}. ${step.name} -> ${step.invoke}${availability}`);
      });
      lines.push('');
    }
    if (result.bundle && result.bundle.length) {
      lines.push('Execution bundle:');
      result.bundle.slice(0, 6).forEach((asset, index) => {
        lines.push(`  ${index + 1}. ${asset.name} (${asset.domain}) -> ${asset.invoke}`);
      });
      lines.push('');
    }
    if (result.virtualMasters && result.virtualMasters.length) {
      lines.push('Virtual masters:');
      result.virtualMasters.slice(0, 3).forEach((report) => {
        lines.push(`  - ${report.domain} via ${report.master_agent}: ${report.thesis}`);
      });
      lines.push('');
    }
    result.picks.slice(0, 5).forEach((asset, index) => {
      lines.push(`${index + 1}. ${asset.name} - ${asset.type} - score ${asset.score} - ${asset.domain}`);
      lines.push(`   Why: matched ${(asset.matched || []).join(', ') || 'task context'}`);
      lines.push(`   Invoke: ${asset.invoke}${asset.invocation?.mechanism ? ` [${asset.invocation.mechanism}]` : ''}`);
    });
    lines.push('');
    lines.push('Execution rule: treat every pick above as mandatory unless the user explicitly asked for discovery-only mode or the assets are mutually exclusive.');
  }

  if (result.parallelPlan && result.parallelPlan.recommended) {
    lines.push('');
    lines.push(`Parallel execution: ${result.parallelPlan.executor}`);
    lines.push(`Reason: ${result.parallelPlan.reason}`);
    if (result.parallelPlan.orchestrationPolicy) {
      lines.push(`Policy: ${result.parallelPlan.orchestrationPolicy.spawnScope}`);
      lines.push('Ownership guard: close only Oracle-owned panes from the current task; never close the caller pane.');
      lines.push(`Execution loop: ${(result.parallelPlan.orchestrationPolicy.executionLoop || []).join(' -> ')}`);
    }
    result.parallelPlan.workstreams.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item}`);
    });
  }

  if (result.suggestions.length) {
    lines.push('');
    lines.push('Companion domains to include when they are not mutually exclusive:');
    for (const s of result.suggestions) {
      lines.push(`- ${s.domain} (${s.master_agent}) - ${s.asset_count} assets`);
    }
  }

  if (result.dispatchPlan?.parallel_workstreams?.length) {
    lines.push('');
    lines.push('Dispatch workstreams:');
    result.dispatchPlan.parallel_workstreams.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.description} -> ${item.executor} using ${item.model || 'runtime-default model'}`);
      lines.push(`     Prompt: ${item.pane_prompt}`);
      if (Array.isArray(item.assets) && item.assets.length) {
        lines.push('     Targets:');
        for (const asset of item.assets) {
          lines.push(`       - ${asset.name}: ${asset.invoke}${asset.mechanism ? ` [${asset.mechanism}]` : ''}`);
        }
      }
    });
  }

  return lines.join('\n');
}

function formatBlockingPreflight(preflight) {
  const lines = [];
  lines.push('Oracle blocked: the host is not ready for routing.');
  lines.push(`Runtime: ${preflight.preflight.runtime}`);
  lines.push(`Executor: ${preflight.preflight.executor?.name || 'unknown'} (${preflight.preflight.executor?.kind || 'unknown'})`);
  lines.push(`Index: ${preflight.preflight.index_exists ? 'present' : 'missing'}${preflight.preflight.index_fresh ? ' / fresh' : ' / stale'}`);
  lines.push(`Masters: ${preflight.preflight.masters_installed}/${preflight.preflight.masters_expected}`);
  lines.push(`Session hook: ${preflight.preflight.session_hook_installed ? 'installed' : 'missing'}`);

  const actions = preflight.preflight.required_actions || preflight.preflight.warnings || [];
  if (actions.length) {
    lines.push('What to do:');
    for (const action of actions) {
      lines.push(`- ${action}`);
    }
  }

  lines.push('Run `node ~/.claude/skills/skill-oracle/scripts/oracle-bootstrap.js --install` to repair local configuration when the host supports it.');
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const preflight = await runBootstrap({
    update: true,
    repair: true,
    forceRepair: args.rebuild,
    installHook: true,
    preflightOnly: args.preflight,
    quiet: Boolean(args.json),
  });

  if (preflight.warnings.length && !args.json) {
    for (const warning of preflight.warnings) {
      console.error(`[oracle-bootstrap] warning: ${warning}`);
    }
  }

  if (!preflight.preflight.ready) {
    if (args.json) {
      console.log(JSON.stringify({ blocked: true, preflight }, null, 2));
    } else {
      console.error(formatBlockingPreflight(preflight));
    }
    return 1;
  }

  const idx = loadIndex(args.indexPath);

  if (args.stats) {
    if (args.json) console.log(JSON.stringify(idx.stats, null, 2));
    else console.log(formatStats(idx));
    return 0;
  }

  if (args.listDomains) {
    if (args.json) console.log(JSON.stringify(idx.domains, null, 2));
    else console.log(formatDomains(idx));
    return 0;
  }

  if (!args.task) {
    if (args.preflight) {
      if (args.json) {
        console.log(JSON.stringify(preflight, null, 2));
      } else {
        console.log(`Oracle preflight: ${preflight.preflight.ready ? 'ready' : 'attention needed'}`);
        console.log(`Runtime: ${preflight.preflight.runtime}`);
        console.log(`Executor: ${preflight.preflight.executor?.name || 'unknown'} (${preflight.preflight.executor?.kind || 'unknown'})`);
        console.log(`Index: ${preflight.preflight.index_exists ? 'present' : 'missing'}${preflight.preflight.index_fresh ? ' / fresh' : ' / stale'}`);
        console.log(`Masters: ${preflight.preflight.masters_installed}/${preflight.preflight.masters_expected}`);
        console.log(`Session hook: ${preflight.preflight.session_hook_installed ? 'installed' : 'missing'}`);
        if (preflight.preflight.warnings.length) {
          console.log(`Missing: ${preflight.preflight.warnings.join(' | ')}`);
        }
      }
      return preflight.preflight.ready ? 0 : 1;
    }

    console.log(usage());
    return 1;
  }

  const result = await selectAssets(idx, args.task, { ...args, executor: preflight.preflight.executor, preflight });
  if (args.manifest) {
    console.log(JSON.stringify(result.executionManifest || null, null, 2));
    return 0;
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(formatResult(result));
  return result.fallbackRecommended ? 2 : 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((e) => {
    console.error(`[oracle-query] error: ${e.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_INDEX,
  DOMAIN_KEYWORDS,
  detectDomains,
  estimateComplexity,
  selectAssets,
  recommendedModels,
  parallelExecutionPlan,
  resolveSkillInvocation,
  buildExecutionManifest,
  parseSkillCommands,
  loadIndex,
  main,
};
