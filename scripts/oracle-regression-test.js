'use strict';

const {
  loadIndex,
  selectAssets,
  DEFAULT_INDEX,
  estimateComplexity,
  recommendedModels,
  parallelExecutionPlan,
} = require('./oracle-query');

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
    expectedPickNames: ['brandkit'],
    expectedResultNames: ['brandkit', 'stitch-design-taste', 'design-md'],
    expectedUnavailableNames: ['design-system', 'impeccable', 'frontend-design'],
  },
  {
    name: 'electron-shortcuts-ui',
    task: 'quero uma skill para atalhos de tabela e interface electron',
    expectedDomains: ['web-dev', 'design-ui'],
    expectedPickNames: ['awesome-design-md', 'design-taste-frontend'],
    expectedUnavailableNames: ['ui-ux-pro-max', 'impeccable', 'frontend-design'],
  },
  {
    name: 'oracle-multi-skill-composition',
    task: 'preciso que o oracle junte as melhores skills para interface electron com identidade visual e atalhos do app',
    expectedDomains: ['tooling-meta', 'web-dev', 'design-ui'],
    expectedPickNames: ['skill-oracle', 'brandkit', 'design-taste-frontend'],
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
    expectedResultNames: ['react:components', 'design-taste-frontend', 'ui-ux-expert'],
    expectedUnavailableNames: ['ui-ux-pro-max', 'impeccable', 'frontend-design'],
  },
  {
    name: 'marketplace-design-skills-visible',
    task: 'quero usar UI UX Pro Max e awesome design para melhorar uma dashboard SaaS',
    expectedDomains: ['design-ui', 'web-dev'],
    expectedResultNames: ['awesome-design-md', 'design-taste-frontend'],
    expectedUnavailableNames: ['ui-ux-pro-max', 'impeccable', 'polish', 'frontend-design'],
  },
  {
    name: 'operations-ecosystem-fullstack-no-marketing-noise',
    task: 'implementar melhorias no ecossistema de operações com entidade Agentes, Instagram vinculado a cooperações, dashboards analíticos, React Supabase, schema banco de dados, APIs, soft delete e lixeira de operadores',
    expectedDomains: ['design-ui', 'web-dev', 'database-data', 'data-analytics'],
    forbiddenDomains: ['marketing-growth'],
    expectedResultNames: ['awesome-design-md', 'react:components', 'design-taste-frontend', 'shadcn-ui'],
    expectedUnavailableNames: ['ui-ux-pro-max', 'impeccable', 'supabase', 'postgres-patterns'],
    expectedWorkflowNames: ['using-superpowers', 'brainstorming', 'writing-plans'],
    expectParallelRecommended: true,
  },
  {
    name: 'mixed-logo-and-ui',
    task: 'criar logo premium identidade visual e melhorar design UI UX da tela inicial do app',
    expectedDomains: ['design-ui'],
    expectedResultNames: ['brandkit', 'design-taste-frontend', 'stitch-design'],
    expectedUnavailableNames: ['ui-ux-pro-max', 'impeccable', 'frontend-design'],
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
    expectedResultNames: ['pricing-strategy', 'paywall-upgrade-cro', 'churn-prevention'],
    expectedUnavailableNames: ['stripe-best-practices'],
  },
  {
    name: 'mobile-app-design',
    task: 'desenhar telas premium para aplicativo mobile iOS e Android',
    expectedDomains: ['mobile', 'design-ui'],
    expectedResultNames: ['imagegen-frontend-mobile'],
    expectedUnavailableNames: ['ios-hig-design'],
  },
  {
    name: 'docs-file-workflow',
    task: 'editar contrato em docx gerar pdf e criar planilha xlsx de resumo',
    expectedDomains: ['docs-content'],
    expectedResultNames: ['copy-editing', 'writing-plans'],
    expectedUnavailableNames: ['docx', 'pdf', 'xlsx'],
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
    expectedResultNames: ['design-taste-frontend', 'stitch-design'],
    expectedUnavailableNames: ['impeccable', 'ux-heuristics', 'refactoring-ui'],
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
    expectedResultNames: ['remotion', 'motion-advisor'],
    expectedUnavailableNames: ['hyperframes', 'remotion-to-hyperframes', 'remotion-video-creation'],
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
  const unavailableNames = new Set((result.unavailable || []).map((pick) => pick.name));
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
  for (const name of testCase.expectedUnavailableNames || []) {
    assertCheck(
      unavailableNames.has(name),
      `[${testCase.name}] expected ${name} in unavailable, got ${Array.from(unavailableNames).join(', ')}`
    );
    assertCheck(
      !resultNames.has(name),
      `[${testCase.name}] expected ${name} to stay out of picks/bundle, got ${Array.from(resultNames).join(', ')}`
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
  const simplePlan = parallelExecutionPlan(
    'corrigir typo em um botao',
    ['design-ui'],
    { preflight: { executor: { name: 'pane_spawn' }, runtime: 'Overclock' } },
    recommendedModels('simple')
  );
  assertCheck(simplePlan.modelPolicy.defaultModel === 'claude-haiku-4-5', 'simple pane plan must explicitly use Haiku');
  const heavyPlan = parallelExecutionPlan(
    'implementar dashboard com api banco de dados rls testes playwright e auditoria de seguranca',
    ['web-dev', 'database-data', 'data-analytics', 'security-audit'],
    { preflight: { executor: { name: 'pane_spawn' }, runtime: 'Overclock' } },
    recommendedModels('heavy')
  );
  assertCheck(heavyPlan.modelPolicy.defaultModel === 'claude-opus-4-7', 'heavy pane plan must explicitly use Opus');
  assertCheck(
    heavyPlan.workstreams.every((item) => item.model),
    'each visible-pane workstream must include an explicit model'
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
