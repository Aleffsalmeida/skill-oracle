'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getApiKey, EMBED_INDEX } = require('./embed-config');
const { embedTexts, centroid } = require('./embeddings');

const INDEX_FILE = path.join(os.homedir(), '.claude', 'oracle-index.json');

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripFrontmatter(content) {
  return String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function splitIntoChunks(text, maxChars = 1400, overlap = 180) {
  const chunks = [];
  const body = String(text || '').replace(/\r/g, '').trim();
  if (!body) return chunks;
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + maxChars, body.length);
    if (end < body.length) {
      const boundary = body.lastIndexOf('\n\n', end);
      if (boundary > start + Math.floor(maxChars * 0.55)) end = boundary + 2;
    }
    const chunk = body.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= body.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function assetText(asset) {
  return [
    `${asset.name}: ${asset.description || ''}`,
    asset.content_summary || '',
    Array.isArray(asset.use_when) ? `Use when: ${asset.use_when.join(', ')}` : '',
    Array.isArray(asset.capability_terms) ? `Capabilities: ${asset.capability_terms.join(', ')}` : '',
    Array.isArray(asset.workflow_terms) ? `Workflow: ${asset.workflow_terms.join(', ')}` : '',
  ].filter(Boolean).join('. ').slice(0, 4096);
}

function assetChunks(asset) {
  const raw = [
    `# ${asset.name}`,
    `Description: ${asset.description || ''}`,
    asset.content_summary || '',
    Array.isArray(asset.use_when) ? `Use when:\n- ${asset.use_when.join('\n- ')}` : '',
    Array.isArray(asset.workflow_terms) ? `Workflow terms: ${asset.workflow_terms.join(', ')}` : '',
    Array.isArray(asset.capability_terms) ? `Capability terms: ${asset.capability_terms.join(', ')}` : '',
    Array.isArray(asset.section_keywords) ? `Section keywords: ${asset.section_keywords.join(', ')}` : '',
    Array.isArray(asset.constraint_terms) ? `Constraint terms: ${asset.constraint_terms.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');
  return splitIntoChunks(raw, 1600, 220).slice(0, 6).map((chunk, index) => ({
    id: `${asset.name}#chunk${index + 1}`,
    text: chunk,
  }));
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

  const chunks = assets.flatMap((asset) => assetChunks(asset).map((chunk) => ({
    asset,
    chunk,
  })));

  console.log(`[oracle-embed] Embedding ${assets.length} assets in ${chunks.length} chunks via ${apiConfig.provider}...`);

  let vectors;
  try {
    vectors = await embedTexts(chunks.map((item) => item.chunk.text), apiConfig);
  } catch (err) {
    console.error('[oracle-embed] Embedding failed:', err.message);
    process.exit(1);
  }

  const domainMap = {};
  for (let i = 0; i < chunks.length; i++) {
    const d = chunks[i].asset.domain || 'misc';
    if (!domainMap[d]) domainMap[d] = [];
    domainMap[d].push(vectors[i]);
  }

  const domainCentroids = {};
  for (const [domain, vecs] of Object.entries(domainMap)) {
    domainCentroids[domain] = centroid(vecs);
  }

  const result = {
    version: '1.0.0',
    schema: 'oracle-embeddings-v2',
    provider: apiConfig.provider,
    model: apiConfig.provider === 'openai' ? 'text-embedding-3-small' : 'text-embedding-004',
    built_at: new Date().toISOString(),
    asset_count: assets.length,
    chunk_count: chunks.length,
    assets: assets.map((asset) => {
      const assetVectors = [];
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].asset === asset) assetVectors.push(vectors[i]);
      }
      return {
        id: asset.name,
        domain: asset.domain || 'misc',
        vector: centroid(assetVectors),
        chunk_count: assetVectors.length,
      };
    }),
    chunks: chunks.map((item, i) => ({
      id: item.chunk.id,
      asset_id: item.asset.name,
      domain: item.asset.domain || 'misc',
      vector: vectors[i],
    })),
    domain_centroids: domainCentroids,
  };

  fs.writeFileSync(EMBED_INDEX, JSON.stringify(result), 'utf8');
  console.log(`[oracle-embed] Saved ${assets.length} asset embeddings, ${chunks.length} chunk embeddings + ${Object.keys(domainCentroids).length} domain centroids → ${EMBED_INDEX}`);
}

main().catch((err) => {
  console.error('[oracle-embed]', err.message);
  process.exit(1);
});
