'use strict';

const { loadIndex, selectAssets, DEFAULT_INDEX } = require('./oracle-query');

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
    expectedResultNames: ['brandkit', 'remotion'],
  },
  {
    name: 'ui-ux-no-brandkit-bias',
    task: 'melhorar UI UX pro max da interface frontend do produto',
    expectedDomains: ['design-ui', 'web-dev'],
    forbiddenDomains: ['finance-billing'],
    expectedResultNames: ['impeccable', 'frontend-design'],
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
    expectedResultNames: ['seo-audit', 'schema-markup'],
  },
  {
    name: 'stripe-pricing-paywall',
    task: 'preciso configurar Stripe checkout assinatura pricing e paywall',
    expectedDomains: ['finance-billing'],
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
  if (testCase.expectFallbackRecommended) {
    assertCheck(result.fallbackRecommended, `[${testCase.name}] expected fallbackRecommended=true`);
  } else {
    assertCheck(result.bundle.length > 0, `[${testCase.name}] expected non-empty bundle`);
    assertCheck(result.virtualMasters.length > 0, `[${testCase.name}] expected virtual masters report`);
  }
  if (testCase.expectSynthesisUsed) {
    assertCheck(result.synthesisUsed, `[${testCase.name}] expected synthesisUsed=true`);
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
