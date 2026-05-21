'use strict';

const {
  loadIndex,
  selectAssets,
  DEFAULT_INDEX,
  estimateComplexity,
  recommendedModels,
  parallelExecutionPlan,
  resolveSkillInvocation,
  buildDispatchPlan,
} = require('./oracle-query');
const { detectExecutor } = require('./oracle-bootstrap');

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

const CASES = [
  {
    name: 'logo-brandkit',
    task: 'melhorar logo e icone de app electron estilo igual ao simbolo roxo enviado pelo usuario',
    expectedDomains: ['design-ui'],
    expectedPickNames: ['brandkit'],
  },
  {
    name: 'mixed-visual-shortcuts',
    task: 'melhorar logo e icone do app electron para seguir o simbolo roxo de referencia do usuario e ajustar atalhos visuais dos botoes',
    expectedDomains: ['design-ui', 'web-dev'],
    expectedPickNames: ['brandkit'],
  },
  {
    name: 'design-system-ptbr',
    task: 'preciso de skill para design system e identidade visual',
    expectedDomains: ['design-ui'],
    expectedPickNames: ['design-system', 'refactoring-ui'],
  },
  {
    name: 'electron-shortcuts-ui',
    task: 'quero uma skill para atalhos de tabela e interface electron',
    expectedDomains: ['web-dev', 'design-ui'],
    expectedPickNames: ['design-taste-frontend', 'frontend-design', 'impeccable'],
  },
  {
    name: 'oracle-multi-skill-composition',
    task: 'preciso que o oracle junte as melhores skills para interface electron com identidade visual e atalhos do app',
    expectedDomains: ['tooling-meta', 'web-dev', 'design-ui'],
    expectedPickNames: ['superpowers', 'frontend-design', 'brandkit', 'design-taste-frontend'],
    expectSynthesisUsed: true,
  },
  {
    name: 'fullstack-billing-tests',
    task: 'build a React dashboard with Stripe billing and Playwright tests',
    expectedDomains: ['web-dev', 'finance-billing', 'testing-qa'],
    expectedPickNames: ['react:components', 'playwright'],
  },
  {
    name: 'ga4-tracking-direct',
    task: 'configurar GA4 Google Analytics Tag Manager eventos de conversao UTMs e tracking de signup',
    expectedDomains: ['data-analytics'],
    expectedPickNames: ['analytics-tracking'],
  },
  {
    name: 'brand-video-logo-natural',
    task: 'preciso criar uma identidade visual premium com logo novo e gerar um video motion de apresentacao da marca para redes sociais',
    expectedDomains: ['design-ui'],
    expectedResultNames: ['brandkit'],
    expectedAnyResultNames: ['hyperframes', 'remotion', 'remotion-video-creation', 'remotion-to-hyperframes'],
  },
  {
    name: 'ui-ux-no-brandkit-bias',
    task: 'melhorar UI UX pro max da interface frontend do produto',
    expectedDomains: ['design-ui', 'web-dev'],
    forbiddenDomains: ['finance-billing'],
    expectedResultNames: ['ui-ux-pro-max', 'impeccable', 'frontend-design'],
  },
  {
    name: 'marketplace-design-skills-visible',
    task: 'quero usar UI UX Pro Max e awesome design para melhorar uma dashboard SaaS',
    expectedDomains: ['design-ui', 'web-dev'],
    expectedResultNames: ['ui-ux-pro-max', 'polish'],
  },
  {
    name: 'operations-ecosystem-fullstack-no-marketing-noise',
    task: 'implementar melhorias no ecossistema de operações com entidade Agentes, Instagram vinculado a cooperações, dashboards analíticos, React Supabase, schema banco de dados, APIs, soft delete e lixeira de operadores',
    expectedDomains: ['design-ui', 'web-dev', 'database-data', 'data-analytics'],
    forbiddenDomains: ['marketing-growth'],
    expectedResultNames: ['awesome-design-md', 'ui-ux-pro-max', 'impeccable', 'react:components', 'supabase'],
    expectedWorkflowNames: ['using-superpowers', 'brainstorming', 'writing-plans'],
    expectParallelRecommended: true,
  },
  {
    name: 'mixed-logo-and-ui',
    task: 'criar logo premium identidade visual e melhorar design UI UX da tela inicial do app',
    expectedDomains: ['design-ui'],
    expectedResultNames: ['brandkit', 'impeccable', 'frontend-design'],
  },
  {
    name: 'signup-onboarding-ga4',
    task: 'quero otimizar cadastro onboarding emails e medir eventos no GA4',
    expectedDomains: ['marketing-growth', 'data-analytics'],
    expectedResultNames: ['signup-flow-cro', 'email-sequence', 'analytics-tracking'],
  },
  {
    name: 'seo-schema-ai-search',
    task: 'preciso melhorar SEO com schema json ld e aparecer em respostas de IA',
    expectedDomains: ['marketing-growth', 'docs-content'],
    expectedResultNames: ['seo-audit'],
    expectedAnyResultNames: ['schema-markup', 'technical-seo', 'seo'],
  },
  {
    name: 'stripe-pricing-paywall',
    task: 'preciso configurar Stripe checkout assinatura pricing e paywall',
    expectedDomains: ['finance-billing'],
    forbiddenDomains: ['ecommerce'],
    expectedResultNames: ['stripe-best-practices', 'pricing-strategy'],
  },
  {
    name: 'mobile-app-design',
    task: 'desenhar telas premium para aplicativo mobile iOS e Android',
    expectedDomains: ['mobile', 'design-ui'],
    expectedResultNames: ['imagegen-frontend-mobile', 'ios-hig-design'],
  },
  {
    name: 'docs-file-workflow',
    task: 'editar contrato em docx gerar pdf e criar planilha xlsx de resumo',
    expectedDomains: ['docs-content'],
    expectedResultNames: ['docx', 'pdf', 'xlsx'],
  },
  {
    name: 'negated-domain-noise',
    task: 'calcular genealogia ritual de uma lingua ficticia alienigena sem relacao com software marketing design dados ou automacao',
    forbiddenDomains: ['marketing-growth', 'design-ui', 'web-dev'],
    expectFallbackRecommended: true,
  },
  {
    name: 'negated-commerce-noise',
    task: 'melhorar produto pro max com experiencia mais fluida sem billing pagamentos ou checkout',
    forbiddenDomains: ['finance-billing', 'ecommerce'],
    expectedDomains: ['design-ui'],
    expectedResultNames: ['impeccable'],
  },
  {
    name: 'broad-negation-fallback',
    task: 'criar ritual alienigena sem software marketing design dados automacao pagamento crm crypto loja',
    forbiddenDomains: ['marketing-growth', 'design-ui', 'web-dev', 'finance-billing', 'crm-sales', 'crypto-web3', 'ecommerce', 'security-audit'],
    expectFallbackRecommended: true,
  },
  {
    name: 'github-mcp-misc-no-fallback',
    task: 'usar GitHub para revisar issues PRs e buscar contexto do repositorio',
    expectedDomains: ['misc'],
    expectedResultNames: ['github'],
    expectFallbackRecommended: false,
  },
  {
    name: 'video-motion-hyperframes',
    task: 'criar video motion com cenas animadas, captions, voiceover e export em hyperframes',
    expectedDomains: ['design-ui', 'web-dev'],
    expectedResultNames: ['hyperframes', 'hyperframes-cli', 'remotion-to-hyperframes'],
  },
  {
    name: 'electron-login-ui-motion-not-video',
    task: 'reestruturar identidade visual e fluxo de transicao da tela de login e dashboard do bot electron com logo atomica, background cosmico, top bar, painel de configuracao e animacao de autenticacao com fade-out, centralizacao da logo, explosao e reveal do dashboard',
    expectedDomains: ['design-ui', 'web-dev'],
    forbiddenDomains: ['data-analytics'],
    expectedResultNames: ['motion', 'impeccable', 'design-taste-frontend'],
  },
  {
    name: 'motion-division-explicit-prompt',
    task: 'implementar transicao de login do bot electron usando Motion Division Motion com motion react para orbitas, explosao, centralizacao da logo e reveal do dashboard',
    expectedDomains: ['design-ui', 'web-dev'],
    forbiddenDomains: ['data-analytics'],
    expectedResultNames: ['motion', 'frontend-design'],
  },
];

async function checkCase(idx, testCase) {
  const result = await selectAssets(idx, testCase.task, { limit: 8 });
  for (const domain of testCase.expectedDomains || []) {
    assertCheck(result.domains.includes(domain), `[${testCase.name}] expected domain ${domain}, got ${result.domains.join(', ')}`);
  }
  for (const domain of testCase.forbiddenDomains || []) {
    assertCheck(!result.domains.includes(domain), `[${testCase.name}] forbidden domain ${domain}, got ${result.domains.join(', ')}`);
  }

  const pickNames = new Set(result.picks.map((pick) => pick.name));
  const resultNames = new Set([...result.picks, ...result.bundle].map((pick) => pick.name));
  if (testCase.expectedPickNames) {
    assertCheck(
      testCase.expectedPickNames.some((name) => pickNames.has(name)),
      `[${testCase.name}] expected one of ${testCase.expectedPickNames.join(', ')} in picks, got ${Array.from(pickNames).join(', ')}`
    );
  }
  for (const name of testCase.expectedResultNames || []) {
    assertCheck(
      resultNames.has(name),
      `[${testCase.name}] expected ${name} in picks or bundle, got ${Array.from(resultNames).join(', ')}`
    );
  }
  if (testCase.expectedAnyResultNames) {
    assertCheck(
      testCase.expectedAnyResultNames.some((name) => resultNames.has(name)),
      `[${testCase.name}] expected one of ${testCase.expectedAnyResultNames.join(', ')} in picks or bundle, got ${Array.from(resultNames).join(', ')}`
    );
  }
  if (testCase.expectFallbackRecommended === true) {
    assertCheck(result.fallbackRecommended, `[${testCase.name}] expected fallbackRecommended=true`);
  } else {
    if (testCase.expectFallbackRecommended === false) {
      assertCheck(!result.fallbackRecommended, `[${testCase.name}] expected fallbackRecommended=false`);
    }
    assertCheck(result.bundle.length > 0, `[${testCase.name}] expected non-empty bundle`);
    assertCheck(result.virtualMasters.length > 0, `[${testCase.name}] expected virtual masters report`);
  }
  if (testCase.expectSynthesisUsed) {
    assertCheck(result.synthesisUsed, `[${testCase.name}] expected synthesisUsed=true`);
  }
  if (testCase.expectedWorkflowNames) {
    const workflowNames = new Set((result.processWorkflow || []).map((step) => step.name));
    for (const name of testCase.expectedWorkflowNames) {
      assertCheck(
        workflowNames.has(name),
        `[${testCase.name}] expected workflow ${name}, got ${Array.from(workflowNames).join(', ')}`
      );
    }
  }
  if (testCase.expectParallelRecommended === true) {
    assertCheck(result.parallelPlan?.recommended, `[${testCase.name}] expected parallelPlan.recommended=true`);
    assertCheck((result.parallelPlan?.workstreams || []).length >= 2, `[${testCase.name}] expected at least 2 workstreams`);
  }

  return {
    name: testCase.name,
    domains: result.domains,
    picks: result.picks.map((pick) => pick.name),
    bundle: result.bundle.map((pick) => pick.name),
  };
}

async function main() {
  const idx = loadIndex(DEFAULT_INDEX);
  const reports = [];
  for (const testCase of CASES) {
    reports.push(await checkCase(idx, testCase));
  }
  assertCheck(
    estimateComplexity('corrigir typo em um botao', ['design-ui'], []) === 'simple',
    'simple local UI edits must stay on the cheap model tier'
  );
  assertCheck(
    recommendedModels('simple').claude === 'claude-haiku-4-5',
    'simple Claude model must be claude-haiku-4-5'
  );
  const impeccableSkill = {
    name: 'impeccable',
    type: 'skill',
    path: 'C:\\Users\\aleff\\.claude\\skills\\impeccable\\SKILL.md',
  };
  const layoutInvocation = resolveSkillInvocation(
    impeccableSkill,
    'ajustar layout src/pages/BotAccess.tsx',
    null
  );
  assertCheck(
    /^\/impeccable layout\s+src\/pages\/BotAccess\.tsx$/i.test(layoutInvocation.invoke),
    `expected layout command invocation, got ${layoutInvocation.invoke}`
  );
  const polishInvocation = resolveSkillInvocation(
    impeccableSkill,
    'polish src/pages/BotAccess.tsx',
    null
  );
  assertCheck(
    /^\/polish\s+src\/pages\/BotAccess\.tsx$/i.test(polishInvocation.invoke),
    `expected pinned polish invocation, got ${polishInvocation.invoke}`
  );
  assertCheck(
    polishInvocation.mechanism === 'pinned-command',
    `expected pinned-command mechanism, got ${polishInvocation.mechanism}`
  );
  assertCheck(
    estimateComplexity('fazer design da pagina metodo legalizada', ['design-ui', 'web-dev'], []) !== 'heavy',
    'standalone page design work must not escalate to the heavy tier'
  );
  const uiPlan = parallelExecutionPlan(
    'fazer design da pagina metodo legalizada',
    ['design-ui', 'web-dev'],
    { preflight: { executor: { name: 'pane_spawn' }, runtime: 'Overclock' } }
  );
  assertCheck(!uiPlan.recommended, 'standalone page design must not auto-open parallel panes');
  assertCheck(uiPlan.orchestrationPolicy?.paneSpawnAllowed === false, 'simple page design must explicitly forbid extra pane spawn');
  const pageResult = await selectAssets(idx, 'fazer design da pagina metodo legalizada', { limit: 8 });
  assertCheck(!pageResult.domains.includes('database-data'), 'standalone page design must not pull database-data without explicit db signal');
  assertCheck(!pageResult.parallelPlan?.recommended, 'standalone page design result must not recommend parallel panes');
  const designPriorityResult = await selectAssets(idx, 'refazer design da homepage com visual premium e nada genérico', { limit: 8 });
  assertCheck(
    designPriorityResult.bundle?.[0]?.name === 'using-superpowers',
    `expected using-superpowers to lead the design bundle, got ${designPriorityResult.bundle?.[0]?.name}`
  );
  assertCheck(
    designPriorityResult.bundle.some((asset) => asset.name === 'frontend-design'),
    'design bundle must include frontend-design'
  );
  assertCheck(
    designPriorityResult.bundle.some((asset) => asset.name === 'gsd'),
    'design bundle must include the priority GSD stack'
  );
  const heavyPlan = parallelExecutionPlan(
    'implementar dashboard com api banco de dados rls testes playwright e auditoria de seguranca',
    ['web-dev', 'database-data', 'data-analytics', 'security-audit'],
    { preflight: { executor: { name: 'pane_spawn' }, runtime: 'Overclock' } }
  );
  assertCheck(heavyPlan.recommended, 'cross-domain backend/security work should still recommend parallel panes');
  assertCheck(heavyPlan.orchestrationPolicy?.ownership?.closeOnlyOwnedPanes, 'heavy pane plan must enforce owned-pane-only cleanup');
  assertCheck(
    Array.isArray(heavyPlan.orchestrationPolicy?.executionLoop) && heavyPlan.orchestrationPolicy.executionLoop.join(' -> ').includes('pane_write submit=true'),
    'heavy pane plan must require the full pane execution loop'
  );
  const overclockResult = await selectAssets(
    idx,
    'refazer o projeto Estrelagithub com leaderboard premium, Supabase e GitHub OAuth',
    { preflight: { preflight: { executor: { name: 'pane_spawn' }, runtime: 'Overclock' } } }
  );
  assertCheck(
    overclockResult.dispatchPlan?.selected_provider === 'codex-cli',
    `expected codex-cli to be selected for Overclock execution, got ${overclockResult.dispatchPlan?.selected_provider}`
  );
  assertCheck(
    Array.isArray(overclockResult.executionManifest?.workstreams) &&
      overclockResult.executionManifest.workstreams.every((workstream) => workstream.pane_write?.submit === true),
    'Overclock workstreams must require pane_write submit=true'
  );
  assertCheck(
    Array.isArray(overclockResult.executionManifest?.workstreams) &&
      overclockResult.executionManifest.workstreams.every((workstream) => workstream.pane_spawn?.override_host_session === true),
    'Overclock workstreams must override the host session when spawning panes'
  );
  assertCheck(
    Array.isArray(overclockResult.executionManifest?.workstreams) &&
      overclockResult.executionManifest.workstreams.every((workstream) => workstream.output_capture_policy?.empty_read_is_failure === true),
    'Overclock workstreams must treat empty read as failure'
  );
  assertCheck(
    Array.isArray(overclockResult.executionManifest?.workstreams) &&
      overclockResult.executionManifest.workstreams.every((workstream) => workstream.output_capture_policy?.probe_sentinel === 'PING_OMEGA_123'),
    'Overclock workstreams must carry the probe sentinel'
  );
  assertCheck(
    Array.isArray(overclockResult.executionManifest?.stages) &&
      overclockResult.executionManifest.stages.some((stage) => stage.id === 'spawn_ready'),
    'Overclock execution manifest must include spawn_ready stage'
  );
  assertCheck(
    overclockResult.executionManifest?.host_contract?.output_capture_required === true,
    'Overclock host contract must require output capture'
  );
  assertCheck(
    overclockResult.dispatchPlan?.host_adapter?.preWriteReadiness?.required === true,
    'Overclock host adapter must require pre-write readiness'
  );
  const commandModeDispatch = buildDispatchPlan({
    task: 'refazer o projeto Estrelagithub com leaderboard premium e GitHub OAuth',
    picks: [{
      name: 'superpowers',
      type: 'skill',
      domain: 'tooling-meta',
      invoke: 'using-superpowers',
      invocation: { mechanism: 'command' },
    }],
    bundle: [{
      name: 'superpowers',
      type: 'skill',
      domain: 'tooling-meta',
      invoke: 'using-superpowers',
      invocation: { mechanism: 'command' },
    }],
    parallelPlan: {
      recommended: true,
      executor: 'pane_spawn',
      workstreams: ['Revisar a superfície visível do pane e aplicar o prompt real após a ativação do comando'],
    },
    modelHints: {
      complexity: 'simple',
      codex: 'gpt-5.4-mini',
    },
    executor: { name: 'pane_spawn' },
    preflight: { preflight: { runtime: 'Overclock', executor: { name: 'pane_spawn' } } },
    providerInventory: {
      providers: [
        {
          id: 'codex-cli',
          label: 'Codex CLI',
          type: 'cli',
          models: ['gpt-5.4-mini'],
          available: true,
        },
      ],
    },
  });
  assertCheck(
    commandModeDispatch.selected_provider === 'codex-cli',
    `expected command-mode dispatch to prefer codex-cli, got ${commandModeDispatch.selected_provider}`
  );
  assertCheck(
    commandModeDispatch.selected_model === 'gpt-5.4-mini',
    `expected command-mode dispatch to prefer gpt-5.4-mini, got ${commandModeDispatch.selected_model}`
  );
  assertCheck(
    Array.isArray(commandModeDispatch.parallel_workstreams) &&
      commandModeDispatch.parallel_workstreams[0]?.pane_prompt?.includes('submit that activation command first'),
    'command-mode dispatch must instruct activating the visible command before the workstream prompt'
  );
  assertCheck(
    Array.isArray(commandModeDispatch.notes) &&
      commandModeDispatch.notes.some((note) => /command-mode panes/i.test(note)),
    'command-mode dispatch must document the command-mode pane behavior'
  );
  assertCheck(
    detectExecutor('antigravity').name === 'agy',
    `expected antigravity runtime to resolve to agy, got ${detectExecutor('antigravity').name}`
  );
  const antigravityResult = await selectAssets(
    idx,
    'refazer o projeto Estrelagithub com leaderboard premium, Supabase e GitHub OAuth',
    { preflight: { preflight: { executor: { name: 'agy' }, runtime: 'Antigravity' } } }
  );
  assertCheck(
    antigravityResult.dispatchPlan?.host_adapter?.adapter === 'antigravity-cli-adapter',
    `expected antigravity-cli-adapter, got ${antigravityResult.dispatchPlan?.host_adapter?.adapter}`
  );
  assertCheck(
    antigravityResult.dispatchPlan?.host_adapter?.supported === true,
    'antigravity must be treated as a first-class host'
  );
  assertCheck(
    antigravityResult.parallelPlan?.executor === 'agy',
    `expected antigravity parallel executor to be agy, got ${antigravityResult.parallelPlan?.executor}`
  );
  for (const report of reports) {
    console.log(`ok - ${report.name}: ${report.domains.join(', ')} -> picks ${report.picks.join(', ')} | bundle ${report.bundle.join(', ')}`);
  }
  console.log(`\nOracle regression test passed: ${reports.length} cases.`);
}

if (require.main === module) {
  try {
    main().catch((error) => {
      console.error(`[oracle-regression-test] failed: ${error.message}`);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(`[oracle-regression-test] failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, CASES };
