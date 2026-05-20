'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { run: runBootstrap } = require('./oracle-bootstrap');
const {
  DEFAULT_INDEX,
  loadIndex,
  selectAssets,
  buildExecutionManifest,
} = require('./oracle-query');
const { detectExecutor } = require('./oracle-bootstrap');

function resolveOverclockMcpUrl() {
  if (process.env.OVERCLOCK_MCP_URL) return process.env.OVERCLOCK_MCP_URL;
  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Overclock', 'mcp-config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.mcpServers?.overclock?.url || null;
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {
    taskParts: [],
    json: false,
    indexPath: DEFAULT_INDEX,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') out.json = true;
    else if (arg === '--index') out.indexPath = argv[++i];
    else out.taskParts.push(arg);
  }

  out.task = out.taskParts.join(' ').trim();
  return out;
}

function formatExecutionManifest(manifest) {
  if (!manifest) return 'No execution manifest available.';

  const lines = [];
  lines.push(`Oracle executor manifest v${manifest.version}`);
  lines.push(`Runtime: ${manifest.runtime}`);
  lines.push(`Executor: ${manifest.executor}`);
  lines.push(`State machine: ${manifest.host_contract.state_machine.join(' -> ')}`);
  lines.push('');
  for (const workstream of manifest.workstreams || []) {
    lines.push(`${workstream.id}: ${workstream.description}`);
    lines.push(`  state: ${workstream.state}`);
    lines.push(`  model: ${workstream.model || 'n/a'}`);
    lines.push(`  prompt: ${workstream.pane_prompt}`);
  }
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.task) {
    console.error('Usage: node scripts/oracle-executor.js "<task>" [--json]');
    return 1;
  }

  const preflight = await runBootstrap({
    update: true,
    repair: true,
    installHook: true,
    quiet: true,
  });

  if (!preflight.preflight.ready) {
    const payload = { blocked: true, preflight };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else console.error('Oracle executor blocked: host is not ready.');
    return 1;
  }

  const executor = preflight.preflight.executor || detectExecutor(preflight.preflight.runtime);
  const overclockMcpUrl = resolveOverclockMcpUrl();
  if ((executor?.name || '') === 'pane_spawn' && overclockMcpUrl) {
    // If the host publishes an MCP URL, verify that pane tools are actually exposed.
    try {
      const sse = await fetch(overclockMcpUrl, {
        headers: { Accept: 'text/event-stream' },
      });
      const reader = sse.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (!buf.includes('sessionId=')) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      const sessionId = (buf.match(/sessionId=([a-f0-9-]+)/i) || [])[1];
      if (!sessionId) {
        throw new Error('Could not confirm MCP session id.');
      }
      const post = async (body) => fetch(`${overclockMcpUrl.replace('/sse', '')}/messages?sessionId=${sessionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'skill-oracle', version: '1.0' } } });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      let out = '';
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
        if (out.includes('"tools":') || out.includes('pane_spawn')) break;
      }
      await reader.cancel().catch(() => {});
      if (!/"name"\s*:\s*"pane_spawn"/.test(out)) {
        const payload = {
          blocked: true,
          reason: 'Overclock MCP server is reachable, but it does not expose pane_spawn or any pane tools.',
          mcp_url: overclockMcpUrl,
        };
        if (args.json) console.log(JSON.stringify(payload, null, 2));
        else console.error('Oracle executor blocked: pane_spawn is not exposed by the Overclock MCP server.');
        return 1;
      }
    } catch (error) {
      const payload = {
        blocked: true,
        reason: `Could not verify pane tools: ${error.message}`,
      };
      if (args.json) console.log(JSON.stringify(payload, null, 2));
      else console.error(`Oracle executor blocked: ${error.message}`);
      return 1;
    }
  }

  const idx = loadIndex(args.indexPath);
  const result = await selectAssets(idx, args.task, {
    executor: preflight.preflight.executor,
    preflight,
  });
  const manifest = buildExecutionManifest({
    task: args.task,
    picks: result.picks,
    bundle: result.bundle,
    dispatchPlan: result.dispatchPlan,
    parallelPlan: result.parallelPlan,
    preflight,
  });

  if (args.json) console.log(JSON.stringify(manifest, null, 2));
  else console.log(formatExecutionManifest(manifest));
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`[oracle-executor] error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  formatExecutionManifest,
};
