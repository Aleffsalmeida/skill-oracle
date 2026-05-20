'use strict';
const readline = require('readline');
const { saveApiKey } = require('./embed-config');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

async function main() {
  console.log('\n=== Oracle Embedding Setup ===\n');
  console.log('Semantic embeddings improve skill matching accuracy.\n');
  console.log('Supported providers:');
  console.log('  1. OpenAI  (text-embedding-3-small) — recommended, ~$0.00002/1K tokens');
  console.log('  2. Gemini  (text-embedding-004)     — free tier available\n');

  const choice = (await ask('Choose provider [1/2, default=1]: ')).trim();
  const provider = choice === '2' ? 'gemini' : 'openai';

  const envKey = provider === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY';
  const source = provider === 'openai'
    ? 'platform.openai.com/api-keys'
    : 'aistudio.google.com/app/apikey';
  console.log(`\nGet your key at: ${source}`);
  const key = (await ask(`${envKey}: `)).trim();

  if (!key) {
    console.log('No key entered. Setup cancelled.');
    rl.close();
    process.exit(0);
  }

  saveApiKey(provider, key);
  console.log('\n✓ Saved. Run oracle bootstrap to build embedding index:');
  console.log('  node ~/.claude/skills/skill-oracle/scripts/oracle-bootstrap.js --install\n');
  rl.close();
}

main().catch((err) => {
  console.error(err.message);
  rl.close();
  process.exit(1);
});
