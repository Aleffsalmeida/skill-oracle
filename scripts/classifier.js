'use strict';

/**
 * Classifier — assigns each asset to a domain + master agent.
 *
 * Strategy: keyword-weighted scoring (deterministic, zero deps).
 *   - Name match  = 3pts
 *   - Desc match  = 1pt
 *   - Tie → first domain in DOMAINS order
 *   - No match    → 'misc'
 *
 * Reads / writes ~/.claude/oracle-index.json (in place).
 * Run after scanner.js.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const INDEX_PATH = path.join(os.homedir(), '.claude', 'oracle-index.json');

const DOMAINS = [
  {
    id: 'web-dev', label: 'Web Development', master: 'oracle-master-web',
    kw: ['react', 'nextjs', 'next.js', 'vercel', 'frontend', 'tailwind', 'vue', 'svelte', 'astro', 'remix', 'vite', 'webpack', 'turbopack', 'shadcn', 'html', 'css', 'browser', 'spa', 'ssr'],
  },
  {
    id: 'backend-api', label: 'Backend / APIs', master: 'oracle-master-backend',
    kw: ['fastapi', 'express', 'django', 'rails', 'flask', 'grpc', 'graphql', 'rest-api', 'endpoint', 'springboot', 'nestjs', 'laravel', 'webhook', 'middleware', 'serverless', 'lambda', 'cloudflare-workers'],
  },
  {
    id: 'database-data', label: 'Database / Data', master: 'oracle-master-database',
    kw: ['sql', 'postgres', 'postgresql', 'mongo', 'mongodb', 'mysql', 'sqlite', 'dynamodb', 'cosmos', 'redis', 'snowflake', 'databricks', 'clickhouse', 'supabase', 'orm', 'prisma', 'migration', 'schema', 'warehouse', 'etl', 'dbt', 'airflow', 'fairdb', 'cockroach', 'planetscale'],
  },
  {
    id: 'devops-infra', label: 'DevOps / Infrastructure', master: 'oracle-master-devops',
    kw: ['docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'helm', 'cicd', 'ci-cd', 'pipeline', 'deploy', 'deployment', 'aws', 'gcp', 'azure', 'cloudflare', 'railway', 'fly.io', 'netlify', 'gitops', 'kustomize', 'argo', 'argocd', 'jenkins', 'github-actions'],
  },
  {
    id: 'security-audit', label: 'Security / Audit', master: 'oracle-master-security',
    kw: ['security', 'vulnerability', 'vuln', 'pentest', 'owasp', 'auth', 'oauth', 'jwt', 'cryptography', 'encryption', 'sql-injection', 'xss', 'csrf', 'secret', 'gdpr', 'hipaa', 'soc2', 'pci', 'compliance', 'audit', 'firewall', 'cors', 'sast', 'dast'],
  },
  {
    id: 'testing-qa', label: 'Testing / QA', master: 'oracle-master-testing',
    kw: ['test', 'tdd', 'jest', 'vitest', 'pytest', 'cypress', 'playwright', 'selenium', 'mutation', 'snapshot', 'coverage', 'e2e', 'unit-test', 'integration-test', 'load-test', 'smoke', 'qa', 'regression', 'fuzz'],
  },
  {
    id: 'design-ui', label: 'Design / UI / UX', master: 'oracle-master-design',
    kw: ['design-system', 'ui', 'ux', 'ui-ux', 'ui-ux-pro-max', 'figma', 'canva', 'brand', 'branding', 'palette', 'typography', 'wireframe', 'prototype', 'accessibility', 'a11y', 'wcag', 'visual', 'mockup', 'liquid-glass', 'minimalist', 'industrial-brutalist', 'logo', 'icon', 'icone', 'ícone', 'identidade', 'simbolo', 'símbolo', 'brandkit', 'remotion', 'hyperframe', 'hyperframes', 'higgsfield', 'higgs-field', 'stitch-design', 'stitch', 'imagegen', 'image-gen', 'image-direction', 'motion-design', 'animation', 'frontend-design', 'design-taste', 'taste-design', 'high-end-visual', 'polish', 'impeccable', 'image-to-code', 'visual-design', 'emil-design', 'component-design', 'ui-design', 'interface-design'],
  },
  {
    id: 'ai-ml', label: 'AI / ML', master: 'oracle-master-ai',
    kw: ['ai', 'llm', 'gpt', 'claude', 'openai', 'anthropic', 'langchain', 'langgraph', 'langfuse', 'genkit', 'adk', 'rag', 'embedding', 'vector', 'training', 'ml', 'pytorch', 'tensorflow', 'huggingface', 'prompt', 'eval', 'fine-tune', 'inference', 'agent-sdk', 'vertex', 'gemini', 'mistral', 'cohere', 'groq', 'ollama', 'transformer'],
  },
  {
    id: 'mobile', label: 'Mobile', master: 'oracle-master-mobile',
    kw: ['mobile', 'ios', 'android', 'react-native', 'expo', 'flutter', 'swift', 'kotlin', 'swiftui', 'jetpack', 'xcode', 'dart', 'cocoapods', 'gradle'],
  },
  {
    id: 'data-analytics', label: 'Data / Analytics', master: 'oracle-master-analytics',
    kw: ['analytics', 'dashboard', 'visualization', 'chart', 'metric', 'kpi', 'posthog', 'mixpanel', 'amplitude', 'segment', 'tableau', 'looker', 'metabase', 'forecasting', 'time-series', 'clustering', 'regression-analysis', 'ga4', 'gtm', 'google-analytics', 'google analytics', 'tag-manager', 'tag manager', 'utm', 'utms', 'tracking', 'conversion-tracking', 'event-tracking', 'attribution'],
  },
  {
    id: 'marketing-growth', label: 'Marketing / Growth', master: 'oracle-master-marketing',
    kw: ['marketing', 'seo', 'ads', 'growth', 'content-strategy', 'copywriting', 'social', 'tiktok', 'instagram', 'linkedin', 'facebook', 'meta-ads', 'google-ads', 'retention', 'funnel', 'cro', 'email-sequence', 'newsletter', 'referral', 'cold-email', 'launch', 'paid-ads', 'klaviyo'],
  },
  {
    id: 'crypto-web3', label: 'Crypto / Web3', master: 'oracle-master-crypto',
    kw: ['crypto', 'blockchain', 'ethereum', 'solana', 'defi', 'nft', 'wallet', 'token', 'dex', 'dao', 'smart-contract', 'solidity', 'web3', 'metamask', 'onchain', 'on-chain', 'mempool', 'staking', 'arbitrage', 'flash-loan', 'derivative', 'rugpull'],
  },
  {
    id: 'productivity', label: 'Productivity', master: 'oracle-master-productivity',
    kw: ['notion', 'slack', 'gmail', 'calendar', 'google-drive', 'sheets', 'meeting', 'task-manage', 'todo', 'reminder', 'kanban', 'asana', 'jira', 'linear', 'trello', 'clickup', 'evernote', 'obsidian', 'apple-notes', 'onenote'],
  },
  {
    id: 'finance-billing', label: 'Finance / Billing', master: 'oracle-master-finance',
    kw: ['stripe', 'billing', 'invoice', 'payment', 'subscription', 'revenue', 'accounting', 'tax', 'finance', 'quickbooks', 'plaid', 'ramp', 'fondo', 'finta', 'paywall', 'pricing-strategy'],
  },
  {
    id: 'docs-content', label: 'Docs / Content', master: 'oracle-master-docs',
    kw: ['documentation', 'docs', 'readme', 'wiki', 'manual', 'tutorial', 'guide', 'copyedit', 'copy-editing', 'writing', 'article', 'blog', 'docx', 'pdf', 'xlsx', 'pptx'],
  },
  {
    id: 'tooling-meta', label: 'Tooling / Meta', master: 'oracle-master-tooling',
    kw: ['skill-creator', 'plugin', 'subagent', 'claude-md', 'hook', 'oracle', 'meta', 'config', 'settings', 'onboard', 'session-report', 'agent-creator', 'plugin-validator', 'mcp-server', 'mcp-builder'],
  },
  {
    id: 'observability', label: 'Observability', master: 'oracle-master-observability',
    kw: ['log', 'trace', 'tracing', 'monitor', 'observability', 'apm', 'alert', 'incident', 'sentry', 'datadog', 'newrelic', 'grafana', 'prometheus', 'sla', 'sli', 'uptime', 'synthetic-monitoring', 'real-user-monitoring'],
  },
  {
    id: 'ecommerce', label: 'E-commerce', master: 'oracle-master-ecommerce',
    kw: ['shopify', 'woocommerce', 'wordpress', 'ecommerce', 'cart', 'checkout', 'product-catalog', 'inventory', 'fulfillment', 'sku', 'storefront'],
  },
  {
    id: 'crm-sales', label: 'CRM / Sales', master: 'oracle-master-crm',
    kw: ['crm', 'sales', 'hubspot', 'salesforce', 'pipedrive', 'attio', 'intercom', 'salesloft', 'outreach', 'lead-magnet', 'prospect', 'pipeline-sales', 'apollo', 'instantly', 'clari', 'mindtickle'],
  },
  { id: 'misc', label: 'Miscellaneous', master: 'oracle-master-misc', kw: [] },
];

function tokenize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function semanticText(asset) {
  return tokenize([
    asset.description,
    asset.content_summary,
    asset.content_preview,
    ...(Array.isArray(asset.use_when) ? asset.use_when : []),
    ...(Array.isArray(asset.workflow_terms) ? asset.workflow_terms : []),
    ...(Array.isArray(asset.capability_terms) ? asset.capability_terms : []),
    ...(Array.isArray(asset.section_keywords) ? asset.section_keywords : []),
    ...(Array.isArray(asset.constraint_terms) ? asset.constraint_terms : []),
  ].join(' '));
}

function scoreDomain(asset, domain) {
  if (!domain.kw.length) return { score: 0, matched: [] };
  const nameText = tokenize(`${asset.name} ${asset.id}`);
  const descText = tokenize(asset.description);
  const semText = semanticText(asset);
  let score = 0;
  const matched = [];
  for (const kw of domain.kw) {
    if (nameText.includes(kw)) { score += 3; matched.push(kw); }
    else if (descText.includes(kw)) { score += 2; matched.push(kw); }
    else if (semText.includes(kw)) { score += 2; matched.push(kw); }
  }
  return { score, matched };
}

function classify(asset) {
  let best = { id: 'misc', master: 'oracle-master-misc', score: 0, matched: [] };
  for (const d of DOMAINS) {
    const { score, matched } = scoreDomain(asset, d);
    if (score > best.score) {
      best = { id: d.id, master: d.master, score, matched };
    }
  }
  return best;
}

function run() {
  const t0 = Date.now();
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`Index not found at ${INDEX_PATH} — run scanner.js first`);
  }
  const idx = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  if (!Array.isArray(idx.assets)) throw new Error('Malformed index: missing assets[]');

  const byDomain = {};
  const byMaster = {};

  for (const asset of idx.assets) {
    const { id, master, matched } = classify(asset);
    asset.domain = id;
    asset.master_agent = master;
    asset.keywords = matched.slice(0, 8);
    byDomain[id] = (byDomain[id] || 0) + 1;
    byMaster[master] = (byMaster[master] || 0) + 1;
  }

  idx.stats.by_domain = byDomain;
  idx.stats.by_master = byMaster;
  idx.domains = DOMAINS.map((d) => ({
    id: d.id, label: d.label, master_agent: d.master, asset_count: byDomain[d.id] || 0,
  }));
  idx.classified_at = new Date().toISOString();
  idx.classify_ms = Date.now() - t0;

  fs.writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2), 'utf8');
  return idx;
}

if (require.main === module) {
  try {
    const idx = run();
    process.stdout.write(`oracle-classifier: classified ${idx.stats.total} assets across ${idx.domains.length} domains in ${idx.classify_ms}ms\n`);
    const sorted = Object.entries(idx.stats.by_domain).sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [d, n] of sorted) process.stdout.write(`  ${d}: ${n}\n`);
  } catch (e) {
    process.stderr.write(`[oracle-classifier] error: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = { run, classify, DOMAINS };
