'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const ORACLE_EMBED_DIR = path.join(os.homedir(), '.claude', 'oracle-embed');
const ORACLE_EMBED_ENV = path.join(ORACLE_EMBED_DIR, '.env');
const EMBED_INDEX = path.join(os.homedir(), '.claude', 'oracle-embeddings.json');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const cfg = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    cfg[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return cfg;
}

function getApiKey() {
  if (process.env.OPENAI_API_KEY) return { provider: 'openai', key: process.env.OPENAI_API_KEY };
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return { provider: 'gemini', key: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY };
  }
  const cfg = readEnvFile(ORACLE_EMBED_ENV);
  if (cfg.OPENAI_API_KEY) return { provider: 'openai', key: cfg.OPENAI_API_KEY };
  if (cfg.GEMINI_API_KEY) return { provider: 'gemini', key: cfg.GEMINI_API_KEY };
  return null;
}

function saveApiKey(provider, key) {
  if (!fs.existsSync(ORACLE_EMBED_DIR)) fs.mkdirSync(ORACLE_EMBED_DIR, { recursive: true });
  const envKey = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  fs.writeFileSync(ORACLE_EMBED_ENV, `${envKey}=${key}\n`, { encoding: 'utf8', mode: 0o600 });
}

module.exports = { getApiKey, saveApiKey, EMBED_INDEX, ORACLE_EMBED_DIR };
