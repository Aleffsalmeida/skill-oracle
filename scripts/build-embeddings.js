'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getApiKey, EMBED_INDEX } = require('./embed-config');
const { embedTexts, centroid } = require('./embeddings');

const INDEX_FILE = path.join(os.homedir(), '.claude', 'oracle-index.json');

function assetText(asset) {
  return [
    `${asset.name}: ${asset.description || ''}`,
    asset.content_summary || '',
    Array.isArray(asset.use_when) ? `Use when: ${asset.use_when.join(', ')}` : '',
    Array.isArray(asset.capability_terms) ? `Capabilities: ${asset.capability_terms.join(', ')}` : '',
    Array.isArray(asset.workflow_terms) ? `Workflow: ${asset.workflow_terms.join(', ')}` : '',
  ].filter(Boolean).join('. ').slice(0, 4096);
}

async function main() {
  const apiConfig = getApiKey();
  if (!apiConfig) {
    console.error('[oracle-embed] No API key found. Run: node scripts/setup.js');
    process.exit(1);
  }

  if (!fs.existsSync(INDEX_FILE)) {
    console.error('[oracle-embed] oracle-index.json not found. Run oracle bootstrap first.');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  const assets = index.assets || [];

  if (!assets.length) {
    console.log('[oracle-embed] No assets in index.');
    return;
  }

  console.log(`[oracle-embed] Embedding ${assets.length} assets via ${apiConfig.provider}...`);

  let vectors;
  try {
    vectors = await embedTexts(assets.map(assetText), apiConfig);
  } catch (err) {
    console.error('[oracle-embed] Embedding failed:', err.message);
    process.exit(1);
  }

  const domainMap = {};
  for (let i = 0; i < assets.length; i++) {
    const d = assets[i].domain || 'misc';
    if (!domainMap[d]) domainMap[d] = [];
    domainMap[d].push(vectors[i]);
  }

  const domainCentroids = {};
  for (const [domain, vecs] of Object.entries(domainMap)) {
    domainCentroids[domain] = centroid(vecs);
  }

  const result = {
    version: '1.0.0',
    schema: 'oracle-embeddings',
    provider: apiConfig.provider,
    model: apiConfig.provider === 'openai' ? 'text-embedding-3-small' : 'text-embedding-004',
    built_at: new Date().toISOString(),
    asset_count: assets.length,
    assets: assets.map((a, i) => ({ id: a.name, domain: a.domain || 'misc', vector: vectors[i] })),
    domain_centroids: domainCentroids,
  };

  fs.writeFileSync(EMBED_INDEX, JSON.stringify(result), 'utf8');
  console.log(`[oracle-embed] Saved ${assets.length} embeddings + ${Object.keys(domainCentroids).length} domain centroids → ${EMBED_INDEX}`);
}

main().catch((err) => {
  console.error('[oracle-embed]', err.message);
  process.exit(1);
});
