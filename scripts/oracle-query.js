'use strict';

/**
 * oracle-query.js - local/Codex-compatible Oracle runner.
 *
 * This script executes the Oracle selection path without Claude Code's Task
 * subagent dispatcher. It reads ~/.claude/oracle-index.json, detects relevant
 * domains from a natural-language task, ranks assets directly, and prints the
 * top picks. It is intentionally deterministic and dependency-free.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { run: runBootstrap } = require('./oracle-bootstrap');

const HOME = os.homedir();
const DEFAULT_INDEX = path.join(HOME, '.claude', 'oracle-index.json');
const STRONG_MATCH_THRESHOLD = 5;
const MAX_DOMAINS = 5;
const DEFAULT_LIMIT = 5;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into',
  'of', 'on', 'or', 'the', 'to', 'with', 'without', 'using', 'use',
]);
const ACTION_WORDS = new Set([
  'add', 'build', 'change', 'create', 'fix', 'implement', 'make', 'need',
  'setup', 'update', 'write',
]);

const DOMAIN_KEYWORDS = [
  {
    id: 'web-dev',
    proactive: ['testing-qa', 'security-audit'],
    kw: ['react', 'nextjs', 'next.js', 'vercel', 'frontend', 'tailwind', 'vue', 'svelte', 'astro', 'remix', 'vite', 'webpack', 'turbopack', 'shadcn', 'html', 'css', 'browser', 'spa', 'ssr', 'dashboard'],
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
    kw: ['design-system', 'ui', 'ux', 'figma', 'canva', 'brand', 'palette', 'typography', 'wireframe', 'prototype', 'accessibility', 'a11y', 'wcag', 'visual', 'mockup', 'minimalist'],
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
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--preflight') out.preflight = true;
    else if (arg === '--stats') out.stats = true;
    else if (arg === '--list-domains') out.listDomains = true;
    else if (arg === '--rebuild') out.rebuild = true;
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
  if (!Array.isArray(idx.domains)) throw new Error('Malformed index: missing domains[]');
  return idx;
}

function normalize(s) {
  return String(s || '').toLowerCase();
}

function tokenize(s) {
  return normalize(s)
    .split(/[^a-z0-9.+#-]+/)
    .filter((token) => token && token.length > 1)
    .filter((token) => !STOPWORDS.has(token))
    .filter((token) => !ACTION_WORDS.has(token));
}

function scoreDomainText(task, domain) {
  const text = normalize(task);
  let score = 0;
  const matched = [];
  for (const kw of domain.kw) {
    if (text.includes(kw)) {
      score += kw.length > 4 ? 3 : 2;
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

function scoreAsset(asset, taskTokens) {
  const nameText = normalize(`${asset.name} ${asset.id}`);
  const descText = normalize(asset.description);
  const keywordText = Array.isArray(asset.keywords) ? asset.keywords.map(normalize) : [];
  let score = 0;
  const matched = [];

  for (const token of taskTokens) {
    if (token.length < 2) continue;
    let tokenScore = 0;
    if (nameText.includes(token)) tokenScore += 5;
    if (descText.includes(token)) tokenScore += 2;
    if (keywordText.some((kw) => kw.includes(token) || token.includes(kw))) tokenScore += 1;
    if (tokenScore > 0) {
      score += tokenScore;
      matched.push(token);
    }
  }

  if (asset.user_invocable) score *= 1.2;
  if (asset.type === 'skill') score *= 1.1;
  return { score, matched: Array.from(new Set(matched)).slice(0, 8) };
}

function invocationHint(asset) {
  if (asset.type === 'skill') return `Skill("${asset.name}")`;
  if (asset.type === 'agent') return `Task(subagent_type="${asset.name}")`;
  if (asset.type === 'mcp') return `mcp__${asset.name}__*`;
  return `plugin:${asset.name}`;
}

function selectAssets(idx, task, options = {}) {
  const taskTokens = tokenize(task);
  const domainIds = detectDomains(task, idx, options.domains || []);
  const byId = new Map();
  const domainReports = [];

  for (const domainId of domainIds) {
    const domain = idx.domains.find((d) => d.id === domainId);
    if (!domain) continue;

    const assets = idx.assets.filter((asset) => asset.master_agent === domain.master_agent);
    const ranked = assets
      .map((asset) => {
        const result = scoreAsset(asset, taskTokens);
        return {
          id: asset.id,
          name: asset.name,
          type: asset.type,
          domain: domain.id,
          master_agent: domain.master_agent,
          score: Number(result.score.toFixed(2)),
          matched: result.matched,
          description: asset.description || '',
          path: asset.path,
          source: asset.source,
          invoke: invocationHint(asset),
        };
      })
      .filter((asset) => asset.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    domainReports.push({
      domain: domain.id,
      master_agent: domain.master_agent,
      asset_count: assets.length,
      matches: ranked.length,
      top: ranked.slice(0, 5),
    });

    for (const asset of ranked) {
      const existing = byId.get(asset.id);
      if (!existing || asset.score > existing.score) {
        byId.set(asset.id, asset);
      } else if (existing && asset.domain !== existing.domain) {
        existing.score = Number((existing.score + 1).toFixed(2));
      }
    }
  }

  const picks = Array.from(byId.values())
    .filter((asset) => asset.score >= STRONG_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || DEFAULT_LIMIT);

  return {
    task,
    domains: domainIds,
    picks,
    domainReports,
    suggestions: proactiveSuggestions(task, domainIds, idx),
    fallbackRecommended: picks.length === 0,
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
  lines.push('');

  if (!result.picks.length) {
    lines.push('No strong local match. Recommend fallback to find-skills ecosystem search.');
  } else {
    result.picks.forEach((asset, index) => {
      lines.push(`${index + 1}. ${asset.name} - ${asset.type} - score ${asset.score} - ${asset.domain}`);
      lines.push(`   Why: matched ${asset.matched.join(', ') || 'task context'}`);
      lines.push(`   Invoke: ${asset.invoke}`);
      lines.push(`   Path: ${asset.path}`);
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

  const result = selectAssets(idx, args.task, args);
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
