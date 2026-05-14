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
    name: 'fullstack-billing-tests',
    task: 'build a React dashboard with Stripe billing and Playwright tests',
    expectedDomains: ['web-dev', 'finance-billing', 'testing-qa'],
    expectedPickNames: ['react:components', 'playwright'],
  },
];

function checkCase(idx, testCase) {
  const result = selectAssets(idx, testCase.task, { limit: 8 });
  for (const domain of testCase.expectedDomains) {
    assertCheck(result.domains.includes(domain), `[${testCase.name}] expected domain ${domain}, got ${result.domains.join(', ')}`);
  }

  const pickNames = new Set(result.picks.map((pick) => pick.name));
  assertCheck(
    testCase.expectedPickNames.some((name) => pickNames.has(name)),
    `[${testCase.name}] expected one of ${testCase.expectedPickNames.join(', ')} in picks, got ${Array.from(pickNames).join(', ')}`
  );

  return {
    name: testCase.name,
    domains: result.domains,
    picks: result.picks.map((pick) => pick.name),
  };
}

function main() {
  const idx = loadIndex(DEFAULT_INDEX);
  const reports = CASES.map((testCase) => checkCase(idx, testCase));
  for (const report of reports) {
    console.log(`ok - ${report.name}: ${report.domains.join(', ')} -> ${report.picks.join(', ')}`);
  }
  console.log(`\nOracle regression test passed: ${reports.length} cases.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[oracle-regression-test] failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, CASES };
