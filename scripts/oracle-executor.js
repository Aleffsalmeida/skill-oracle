'use strict';

const { run: runBootstrap } = require('./oracle-bootstrap');
const {
  DEFAULT_INDEX,
  loadIndex,
  selectAssets,
  buildExecutionManifest,
} = require('./oracle-query');

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
  lines.push(`Provider: ${manifest.selected_provider || 'n/a'}`);
  lines.push(`Model: ${manifest.selected_model || 'n/a'}`);
  lines.push(`State machine: ${manifest.host_contract.state_machine.join(' -> ')}`);
  lines.push(`Working ack required: ${manifest.host_contract.working_ack_required ? 'yes' : 'no'}`);
  lines.push(`Command activation required: ${manifest.host_contract.command_mode_activation_required ? 'yes' : 'no'}`);
  lines.push('');
  for (const workstream of manifest.workstreams || []) {
    lines.push(`${workstream.id}: ${workstream.description}`);
    lines.push(`  state: ${workstream.state}`);
    lines.push(`  provider: ${workstream.provider_id || 'n/a'}`);
    lines.push(`  model: ${workstream.model || 'n/a'}`);
    lines.push(`  spawn provider: ${workstream.pane_spawn?.provider_id || 'n/a'}`);
    lines.push(`  spawn model: ${workstream.pane_spawn?.model || 'n/a'}`);
    lines.push(`  activation: ${workstream.activation_command || 'n/a'}`);
    lines.push(`  prompt: ${workstream.pane_prompt}`);
    if (workstream.pane_activation?.content) {
      lines.push(`  activation submit: ${workstream.pane_activation.content}`);
    }
    lines.push(`  submit: ${workstream.pane_write?.submit ? 'true' : 'false'}`);
    lines.push(`  read retry: ${workstream.output_capture_policy?.empty_read_is_failure ? 'enabled' : 'disabled'}`);
    lines.push(`  probe: ${workstream.output_capture_policy?.probe_sentinel || 'n/a'}`);
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

  // The host runtime owns pane execution. Oracle only emits the manifest
  // and should not block on MCP tool discovery that may be internal to the host.

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
