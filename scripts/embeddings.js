'use strict';

const FETCH_TIMEOUT_MS = 30000;
const GEMINI_PARALLEL = 20; // max concurrent embedContent requests

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

async function embedOneGemini(text, apiKey, model) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: ctrl.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embedding.values;
}

async function embedGemini(texts, apiKey) {
  const model = 'gemini-embedding-2';
  const all = [];
  for (let i = 0; i < texts.length; i += GEMINI_PARALLEL) {
    const batch = texts.slice(i, i + GEMINI_PARALLEL);
    const vectors = await Promise.all(batch.map((text) => embedOneGemini(text, apiKey, model)));
    all.push(...vectors);
    // Brief pause between batches to respect rate limits
    if (i + GEMINI_PARALLEL < texts.length) await new Promise((r) => setTimeout(r, 200));
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
