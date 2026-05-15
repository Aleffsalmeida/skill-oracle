'use strict';

/**
 * oracle-query.js - local/Codex-compatible Oracle runner.
 *
 * This script executes the Oracle selection path without Claude Code's Task
 * subagent dispatcher. It reads ~/.claude/oracle-index.json, detects relevant
 * domains from a natural-language task, ranks assets directly, and prints the
 * top picks. It is intentionally deterministic and dependency-free.
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
const SYNTHESIS_MODEL = process.env.ORACLE_SYNTHESIS_MODEL || 'gpt-5.4-mini';
const STRONG_MATCH_THRESHOLD = 5;
const MAX_DOMAINS = 5;
const DEFAULT_LIMIT = 5;
const MIN_TOKEN_LENGTH = 3;
const SHORT_TOKEN_ALLOWLIST = new Set(['ai', 'ml', 'ui', 'ux', 'qa', '3d']);
const STRONG_AUTHOR_SOURCES = ['agents:', 'codex:', 'user:'];
const PREFERRED_SKILLS = new Set([
  'brandkit',
  'skill-oracle',
  'imagegen-frontend-web',
  'imagegen-frontend-mobile',
  'high-end-visual-design',
  'design-taste-frontend',
  'frontend-design',
  'impeccable',
  'react:components',
]);
const GENERIC_QUERY_TOKENS = new Set(['app', 'skill', 'plugin', 'agent', 'tool', 'tools']);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'of', 'on', 'or', 'the', 'to', 'with', 'without', 'using', 'use',
  'o', 'os', 'a', 'as', 'de', 'da', 'das', 'do', 'dos', 'e', 'em', 'na',
  'nas', 'no', 'nos', 'para', 'por', 'com', 'sem', 'um', 'uma', 'uns',
  'umas', 'ao', 'aos', 'que', 'como',
]);
const ACTION_WORDS = new Set([
  'add', 'build', 'change', 'create', 'fix', 'implement', 'make', 'need',
  'setup', 'update', 'write',
  'melhorar', 'corrigir', 'criar', 'fazer', 'ajustar', 'usar', 'quero',
]);

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
    kw: ['design-system', 'ui', 'ux', 'figma', 'canva', 'brand', 'branding', 'palette', 'typography', 'wireframe', 'prototype', 'accessibility', 'a11y', 'wcag', 'visual', 'mockup', 'minimalist', 'logo', 'icon', 'icone', 'ícone', 'identidade', 'simbolo', 'símbolo', 'topbar', 'taskbar', 'botao', 'botão', 'botoes', 'botões', 'shortcut', 'atalho', 'remotion', 'stitch-design', 'stitch', 'imagegen', 'image-gen', 'image-direction', 'motion-design', 'animation', 'frontend-design', 'design-taste', 'taste-design', 'high-end-visual', 'polish', 'impeccable', 'image-to-code', 'visual-design', 'emil-design', 'component-design', 'ui-design', 'interface-design', 'hyperframe', 'hyperframes', 'video', 'motion', 'lottie', 'gsap', 'animejs', 'composition', 'render', 'liquid-glass', 'industrial-brutalist', 'brandkit'],
  },
  {
    id: 'mobile',
    proactive: ['testing-qa'],
    kw: ['mobile', 'ios', 'android', 'react-native', 'expo', 'flutter', 'swift', 'kotlin', 'swiftui', 'jetpack', 'xcode', 'dart', 'cocoapods', 'gradle'],
  },
  {
    id: 'data-analytics',
    proactive: [],
    kw: ['analytics', 'dashboard', 'visualization', 'chart', 'metric', 'kpi', 'posthog', 'mixpanel', 'amplitude', 'segment', 'tableau', 'looker', 'metabase', 'forecasting', 'time-series'],
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
    kw: ['shopify', 'woocommerce', 'wordpress', 'ecommerce', 'cart', 'checkout', 'product-catalog', 'inventory', 'fulfillment', 'sku', 'storefront'],
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
];

const TYPE_PRIORITY = { skill: 4, agent: 3, mcp: 2, plugin: 1 };

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
    'bundle_names must contain at most 5 canonical asset names only, with no domain prefixes, ids, markdown, bullets, or extra text.',
    'Choose the best cross-domain bundle for the task. Prefer the smallest set that covers the intent well.',
    `Task: ${task}`,
    `Domains: ${domains.join(', ')}`,
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
    '',
    'Options:',
    '  --limit <n>       Number of final picks to print (default: 5)',
    '  --domain <id>     Force one or more domains; repeatable',
    '  --json            Print machine-readable JSON',
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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9.+#-]+/)
    .filter((token) => token && token.length > 1)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !ACTION_WORDS.has(token));
}

function buildTokenSet(text) {
  return new Set(tokenize(text));
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
  };
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
  const taskTokens = buildTokenSet(text);
  let score = 0;
  const matched = [];
  for (const kw of domain.kw) {
    const normalizedKw = normalize(kw);
    if (taskTokens.has(normalizedKw)) {
      score += normalizedKw.length > 4 ? 4 : 3;
      matched.push(normalizedKw);
      continue;
    }
    if (text.includes(normalizedKw)) {
      score += normalizedKw.length > 4 ? 2 : 1;
      matched.push(kw);
    }
  }
  return { id: domain.id, score, matched };
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
      return {
        ...domain,
        score: domain.score + intentBoost,
      };
    })
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

  if (domains.length >= 3) score += 2;
  else if (domains.length >= 2) score += 1;

  if (picks.length >= 5) score += 1;
  if (tokens.length >= 18) score += 1;
  if (/\b(parallel|architecture|system|migration|refactor|rewrite|end-to-end|multi-step|cross-domain)\b/.test(text)) score += 1;
  if (/\b(debug|fix|repair|review|audit|test|validate)\b/.test(text)) score += 1;

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

function scoreAsset(asset, taskTokens) {
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
  if (STRONG_AUTHOR_SOURCES.some((prefix) => sourceText.startsWith(prefix))) score *= 1.12;
  if (PREFERRED_SKILLS.has(asset.name)) score *= 1.18;
  if (intents.branding && /brandkit|logo|brand|visual|design/.test(assetName)) score *= 1.18;
  if ((intents.ui || intents.shortcuts) && /frontend|design-taste|impeccable|ui-toolkit|design/.test(assetName)) score *= 1.16;
  if (intents.desktop && /electron|frontend|ui|design/.test(assetName)) score *= 1.12;
  if (asset.user_invocable) score *= 1.2;
  if (asset.type === 'skill') score *= 1.1;
  return { score, matched: Array.from(new Set(matched)).slice(0, 8) };
}

function enrichRankedAsset(asset, domain, result) {
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
    invoke: invocationHint(asset),
  };
}

function canonicalAssetKey(asset) {
  return [
    normalize(asset.type),
    normalize(asset.name),
    normalize(asset.invoke),
  ].join('::');
}

function invocationHint(asset) {
  if (asset.type === 'skill') return `Skill("${asset.name}")`;
  if (asset.type === 'agent') return `Task(subagent_type="${asset.name}")`;
  if (asset.type === 'mcp') return `mcp__${asset.name}__*`;
  return `plugin:${asset.name}`;
}

function scoreSupportingFit(asset, domainId, intents) {
  let score = 0;
  if (asset.type === 'skill') score += 3;
  else if (asset.type === 'agent') score += 2;
  else score += 1;

  score += Math.min(asset.workflow_terms?.length || 0, 6) * 0.3;
  score += Math.min(asset.capability_terms?.length || 0, 6) * 0.25;

  const name = normalize(asset.name);
  if (domainId === 'design-ui' && /brand|design|frontend|ui|visual/.test(name)) score += 2;
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

function buildRecommendedBundle(domainReports, picks, task) {
  const intents = intentBoosts(task);
  const bundle = [];
  const seen = new Set();
  const taskText = normalize(task);

  const preferredByIntent = [];
  if (intents.branding) preferredByIntent.push(['brandkit', 'impeccable', 'high-end-visual-design']);
  if (intents.ui || intents.shortcuts) preferredByIntent.push(['design-taste-frontend', 'frontend-design', 'ui-toolkit/web', 'react:components']);
  if (intents.desktop) preferredByIntent.push(['design-taste-frontend', 'frontend-design', 'zoom-meeting-sdk-electron']);
  if (/\boracle\b/.test(taskText) || (/\bskill/.test(taskText) && /\bjunt/.test(taskText))) {
    preferredByIntent.unshift(['skill-oracle', 'workspace-surface-audit', 'plugin-structure']);
  }

  for (const report of domainReports) {
    const primary = (report.bundle || [])[0];
    if (!primary) continue;
    const key = canonicalAssetKey(primary);
    if (seen.has(key)) continue;
    bundle.push(primary);
    seen.add(key);
    if (bundle.length >= 4) return bundle.slice(0, 4);
  }

  for (const report of domainReports) {
    for (const asset of (report.bundle || []).slice(1)) {
      const key = canonicalAssetKey(asset);
      if (seen.has(key)) continue;
      bundle.push(asset);
      seen.add(key);
      if (bundle.length >= 4) return bundle.slice(0, 4);
    }
  }

  for (const names of preferredByIntent) {
    for (const name of names) {
      const asset = picks.find((candidate) => candidate.name === name)
        || domainReports.flatMap((report) => report.top || []).find((candidate) => candidate.name === name);
      if (asset && !seen.has(canonicalAssetKey(asset))) {
        bundle.push(asset);
        seen.add(canonicalAssetKey(asset));
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

  return bundle.slice(0, 4);
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

async function selectAssets(idx, task, options = {}) {
  // Keyword-based domain detection (baseline)
  const domainIds = detectDomains(task, idx, options.domains || []);
  const taskTokens = tokenize(task);

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
    const filteredKeyword = domainIds.filter((id) => (centroidScores.get(id) || 0) >= 0.25);

    // Add high-confidence embedding-only domains the keywords missed
    const embOnly = [...centroidScores.entries()]
      .filter(([id, sim]) => sim >= 0.5 && !filteredKeyword.includes(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([id]) => id);

    const merged = [...new Set([...filteredKeyword, ...embOnly])].slice(0, MAX_DOMAINS);
    // Fallback: if filtering removed everything, keep top keyword domain
    finalDomainIds = merged.length > 0 ? merged : domainIds.slice(0, 1);
  }

  const byKey = new Map();
  const domainReports = [];

  for (const domainId of finalDomainIds) {
    const domain = idx.domains.find((d) => d.id === domainId);
    if (!domain) continue;

    const assets = idx.assets.filter((asset) => asset.master_agent === domain.master_agent);
    const ranked = assets
      .map((asset) => {
        const result = scoreAsset(asset, taskTokens);
        let { score } = result;

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

        return enrichRankedAsset(asset, domain, { score, matched: result.matched });
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
  const bundle = buildRecommendedBundle(domainReports, rankedPicks, task);
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
    fallbackRecommended: picks.length === 0,
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
  lines.push(`Domains: ${result.domains.join(', ')}`);
  if (result.embeddingUsed) lines.push('Mode: semantic (keyword + embedding hybrid)');
  if (result.modelHints) {
    lines.push(`Model hint: ${result.modelHints.complexity} | Claude=${result.modelHints.claude} | Codex=${result.modelHints.codex}`);
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
    lines.push('No strong local match. Recommend fallback to find-skills ecosystem search.');
  } else {
    if (result.bundle && result.bundle.length) {
      lines.push('Recommended bundle:');
      result.bundle.slice(0, 4).forEach((asset, index) => {
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
      lines.push(`   Why: matched ${asset.matched.join(', ') || 'task context'}`);
      lines.push(`   Invoke: ${asset.invoke}`);
    });
  }

  if (result.suggestions.length) {
    lines.push('');
    lines.push('You may also want:');
    for (const s of result.suggestions) {
      lines.push(`- ${s.domain} (${s.master_agent}) - ${s.asset_count} assets`);
    }
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

  const result = await selectAssets(idx, args.task, args);
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
  selectAssets,
  loadIndex,
  main,
};
