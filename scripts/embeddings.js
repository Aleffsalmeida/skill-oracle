'use strict';

const FETCH_TIMEOUT_MS = 30000;

async function embedOpenAI(texts, apiKey) {
  const BATCH = 2048;
  const all = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: batch }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    data.data.sort((a, b) => a.index - b.index);
    all.push(...data.data.map((d) => d.embedding));
  }
  return all;
}

async function embedGemini(texts, apiKey) {
  const BATCH = 100;
  const all = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const requests = batch.map((text) => ({
      model: 'models/text-embedding-004',
      content: { parts: [{ text }] },
    }));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
          signal: ctrl.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const data = await res.json();
    all.push(...data.embeddings.map((e) => e.values));
  }
  return all;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function centroid(vectors) {
  if (!vectors.length) return null;
  const dim = vectors[0].length;
  const c = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) c[i] += v[i];
  return c.map((val) => val / vectors.length);
}

async function embedTexts(texts, { provider, key }) {
  if (provider === 'openai') return embedOpenAI(texts, key);
  if (provider === 'gemini') return embedGemini(texts, key);
  throw new Error(`Unknown provider: ${provider}`);
}

module.exports = { embedTexts, cosineSimilarity, centroid };
