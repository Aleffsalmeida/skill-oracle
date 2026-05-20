'use strict';

const FETCH_TIMEOUT_MS = 30000;

async function embedOpenAI(texts, apiKey) {
  const BATCH = 500; // ~130k tokens per request, under OpenAI's 300k limit
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

const GEMINI_MODEL = 'gemini-embedding-2';
const GEMINI_PARALLEL = 10;
const GEMINI_GAP_MS = 6500; // 10 req per 6.5s ≈ 92 RPM, under free tier 100 RPM

async function embedOneGemini(text, apiKey, retries = 5) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`,
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
    if (res.ok) {
      const data = await res.json();
      return data.embedding.values;
    }
    if (res.status === 429 && attempt < retries) {
      let waitMs = 35000;
      try {
        const body = await res.json();
        const details = body.error && body.error.details;
        const retryInfo = Array.isArray(details) && details.find((d) => d['@type'] && d['@type'].includes('RetryInfo'));
        if (retryInfo && retryInfo.retryDelay) {
          const secs = parseInt(retryInfo.retryDelay, 10);
          if (Number.isFinite(secs)) waitMs = (secs + 2) * 1000;
        }
      } catch (_) {}
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  }
}

async function embedGemini(texts, apiKey) {
  const all = [];
  for (let i = 0; i < texts.length; i += GEMINI_PARALLEL) {
    const batch = texts.slice(i, i + GEMINI_PARALLEL);
    const start = Date.now();
    const vectors = await Promise.all(batch.map((t) => embedOneGemini(t, apiKey)));
    all.push(...vectors);
    const elapsed = Date.now() - start;
    const done = Math.min(i + GEMINI_PARALLEL, texts.length);
    if (done < texts.length && elapsed < GEMINI_GAP_MS) {
      await new Promise((r) => setTimeout(r, GEMINI_GAP_MS - elapsed));
    }
    if (done % 100 === 0 || done >= texts.length) {
      process.stdout.write(`[oracle-embed] progress: ${done}/${texts.length}\n`);
    }
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
