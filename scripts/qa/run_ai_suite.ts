import * as fs from 'fs';
import * as path from 'path';

interface TestQuestion {
  id: string;
  role: string;
  question: string;
  set: string;
}

interface TestResult {
  id: string;
  set: string;
  role: string;
  question: string;
  fallbackPath: string | null;
  resolvedIntentCode: string | null;
  gatewayOutcome: string | null;
  resolvedLevel: string | null;
  actualResponse: string;
  passed: boolean;
  failReason: string | null;
  traceId: string | null;
}

interface SetStats {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

const MAPPED_ROLES: Record<string, string> = {
  RES: 'RESIDENT',
  ADM: 'TENANT_ADMIN',
  ROB: 'OPERATOR',
};

const TENANT_ID = 'cmolm3euv0000kcgekpdj6nl1';
const BUILDING_ID = 'cmollskdb000114j0gtgxd3wc';
const API_BASE = process.env.ASSISTANT_API_URL || 'http://localhost:4001';

const FALLBACK_PATHS_PASS_RES_ADM = [
  'intent_library_answer',
  'intent_library_tool_success',
  'intent_library_clarification',
  'intent_library_no_match',
  'cache_hit',
  'cache_miss',
];

const FALLBACK_PATHS_FAIL_RES_ADM = [
  'blocked_rbac',
  'privacy_denied',
  'routing_no_match',
  'classifier',
  'knowledge',
  'templates',
];

const FALLBACK_PATHS_PASS_ROB = [
  'blocked_rbac',
  'privacy_denied',
  'invalid_entities',
  'hitl_created',
  'rag_no_sources',
  'p0_enforced_no_data',
];

function parseQuestions(content: string): TestQuestion[] {
  const questions: TestQuestion[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const setMatch = trimmed.match(/^(\w+)-(\d+)\.\s+(.+)$/);
    if (setMatch) {
      const id = setMatch[1];
      let role = 'RESIDENT';
      let set = 'RES';

      if (id.startsWith('ADM')) {
        role = 'TENANT_ADMIN';
        set = 'ADM';
      } else if (id.startsWith('ROB')) {
        role = 'OPERATOR';
        set = 'ROB';
      }

      questions.push({
        id,
        role: MAPPED_ROLES[set] || role,
        question: setMatch[3],
        set,
      });
    }
  }
  return questions;
}

function extractMetadata(apiResponse: Record<string, unknown>): Partial<TestResult> {
  const provenance = (apiResponse.provenance as Record<string, unknown>) || {};
  const context = (apiResponse.context as Record<string, unknown>) || {};
  const extra = (context.extra as Record<string, unknown>) || {};
  const intentLibraryState = (extra.__intentLibraryState as Record<string, unknown>) || {};

  const fallbackPath = (provenance.fallbackPath as string) ||
    (context.fallbackPath as string) ||
    (intentLibraryState.fallbackPath as string) ||
    null;

  const resolvedIntentCode = (provenance.intentCode as string) ||
    (provenance.resolvedIntentCode as string) ||
    (context.resolvedIntentCode as string) ||
    null;

  const gatewayOutcome = (provenance.gatewayOutcome as string) ||
    (context.gatewayOutcome as string) ||
    null;

  const resolvedLevel = (context.resolvedLevel as string) ||
    (provenance.resolvedLevel as string) ||
    null;

  return { fallbackPath, resolvedIntentCode, gatewayOutcome, resolvedLevel };
}

function validateResult(result: TestResult): { passed: boolean; reason: string | null } {
  const { set, fallbackPath, resolvedIntentCode, gatewayOutcome, actualResponse } = result;

  const responseLower = actualResponse.toLowerCase();

  if (fallbackPath === 'rate_limited' || actualResponse.includes('429') || responseLower.includes('límite temporal')) {
    return { passed: null, reason: 'Rate limited - skipped' };
  }

  if (set === 'RES' || set === 'ADM') {
    if (fallbackPath && FALLBACK_PATHS_FAIL_RES_ADM.some(fp => fallbackPath.includes(fp))) {
      return { passed: false, reason: `Unexpected fallback: ${fallbackPath}` };
    }

    if (fallbackPath && FALLBACK_PATHS_PASS_RES_ADM.some(fp => fallbackPath.includes(fp))) {
      return { passed: true, reason: null };
    }

    if (gatewayOutcome === 'success' || gatewayOutcome === 'denied') {
      return { passed: true, reason: null };
    }

    if (resolvedIntentCode && resolvedIntentCode !== 'UNKNOWN') {
      return { passed: true, reason: null };
    }

    if (responseLower.includes('clarification')) {
      return { passed: true, reason: null };
    }

    return { passed: false, reason: `Unclassified response: ${fallbackPath || 'unknown'}` };
  }

  if (set === 'ROB') {
    if (fallbackPath && FALLBACK_PATHS_PASS_ROB.some(fp => fallbackPath.includes(fp))) {
      return { passed: true, reason: null };
    }

    if (gatewayOutcome === 'denied') {
      return { passed: true, reason: null };
    }

    if (responseLower.includes('no puedo') || responseLower.includes('sin autorización') || responseLower.includes('permiso')) {
      return { passed: true, reason: null };
    }

    return {
      passed: false,
      reason: `Unexpected success for ROB: gateway=${gatewayOutcome}, fallbackPath=${fallbackPath}`,
    };
  }

  return { passed: false, reason: 'Unknown set' };
}

async function callAssistant(question: string, role: string): Promise<Partial<TestResult>> {
  const url = `${API_BASE}/assistant/chat`;

  const body = {
    message: question,
    context: {
      tenantId: TENANT_ID,
      userId: 'test-user-qa',
      role,
      buildingId: BUILDING_ID,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as Record<string, unknown>;

    const responseStr = JSON.stringify(data).toLowerCase();

    if (responseStr.includes('429') || responseStr.includes('límite')) {
      return {
        fallbackPath: 'rate_limited',
        resolvedIntentCode: null,
        gatewayOutcome: null,
        resolvedLevel: null,
        actualResponse: 'Rate limited',
        traceId: null,
      } as Partial<TestResult>;
    }

    const metadata = extractMetadata(data);

    return {
      ...metadata,
      actualResponse: (data.answer as string) || JSON.stringify(data).substring(0, 200),
      traceId: (data.auditId as string) || null,
    } as Partial<TestResult>;
  } catch (err) {
    return {
      fallbackPath: 'error',
      resolvedIntentCode: null,
      gatewayOutcome: null,
      resolvedLevel: null,
      actualResponse: `Error: ${err instanceof Error ? err.message : String(err)}`,
      traceId: null,
    } as Partial<TestResult>;
  }
}

async function runTests() {
  const inputPath = process.argv[2] || '/mnt/data/ai_test_questions.md';
  const outputPath = process.argv[3] || 'docs/qa/ai_test_report.md';

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputPath, 'utf-8');
  const questions = parseQuestions(content);

  console.log(`[QA] Found ${questions.length} questions (STRICT EVALUATION)`);
  console.log(`[QA] Endpoint: ${API_BASE}/assistant/chat`);

  const results: TestResult[] = [];
  let requestCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    process.stdout.write(`[${i + 1}/${questions.length}] ${q.id} (${q.set})... `);

    const apiResult = await callAssistant(q.question, q.role);

    requestCount++;
    if (requestCount % 15 === 0) {
      await new Promise(r => setTimeout(r, 800));
    }

    const fullResult: TestResult = {
      ...apiResult,
      id: q.id,
      set: q.set,
      role: q.role,
      question: q.question,
      passed: false,
      failReason: null,
      traceId: apiResult.traceId || null,
      actualResponse: apiResult.actualResponse || '',
    } as TestResult;

    const validation = validateResult(fullResult);
    fullResult.passed = validation.passed;
    fullResult.failReason = validation.reason;

    console.log(`${fullResult.passed ? 'PASS' : 'FAIL'}: ${fullResult.failReason || fullResult.fallbackPath || fullResult.gatewayOutcome || 'OK'}`);

    results.push(fullResult);
  }

  const setStats: Record<string, SetStats> = {
    RES: { total: 0, passed: 0, failed: 0, passRate: 0 },
    ADM: { total: 0, passed: 0, failed: 0, passRate: 0 },
    ROB: { total: 0, passed: 0, failed: 0, passRate: 0 },
  };

  const skippedCount = { RES: 0, ADM: 0, ROB: 0 };

  for (const r of results) {
    const stats = setStats[r.set];
    stats.total++;
    if (r.passed === null) {
      skippedCount[r.set as keyof typeof skippedCount]++;
    } else if (r.passed) {
      stats.passed++;
    } else {
      stats.failed++;
    }
  }

  for (const set of Object.keys(setStats)) {
    const stats = setStats[set];
    const effective = stats.total - skippedCount[set as keyof typeof skippedCount];
    stats.passRate = effective > 0 ? (stats.passed / effective) * 100 : 0;
  }

  const failedTests = results.filter(r => r.passed === false);

  const skippedTests = results.filter(r => r.passed === null);

  const failureReasons: Record<string, number> = {};
  for (const r of failedTests) {
    const key = r.failReason || r.fallbackPath || 'Unknown';
    failureReasons[key] = (failureReasons[key] || 0) + 1;
  }

  const topFailures = Object.entries(failureReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  let report = `# AI Test Report (STRICT Evaluation)

Generated: ${new Date().toISOString()}

## Summary

- **Total Questions**: ${results.length}
- **Passed**: ${results.filter(r => r.passed === true).length}
- **Failed**: ${failedTests.length}
- **Skipped**: ${skippedTests.length}
- **Pass Rate (excl. skipped)**: ${((setStats.RES.passRate + setStats.ADM.passRate + setStats.ROB.passRate) / 3).toFixed(1)}%

## Pass Rate by Set (excl. skipped)

| Set | Total | Passed | Failed | Skipped | Pass Rate |
|-----|-------|--------|--------|--------|-----------|
| RES | ${setStats.RES.total} | ${setStats.RES.passed} | ${setStats.RES.failed} | ${skippedCount.RES} | ${setStats.RES.passRate.toFixed(1)}% |
| ADM | ${setStats.ADM.total} | ${setStats.ADM.passed} | ${setStats.ADM.failed} | ${skippedCount.ADM} | ${setStats.ADM.passRate.toFixed(1)}% |
| ROB | ${setStats.ROB.total} | ${setStats.ROB.passed} | ${setStats.ROB.failed} | ${skippedCount.ROB} | ${setStats.ROB.passRate.toFixed(1)}% |

## Failed Tests

| ID | Set | Rol | Pregunta | Motivo |
|----|-----|-----|----------|-------|
`;

  for (const r of failedTests.slice(0, 50)) {
    report += `| ${r.id} | ${r.set} | ${r.role} | ${r.question.substring(0, 30)} | ${r.failReason || r.fallbackPath} |\n`;
  }

  report += `
## Top 10 Failure Reasons

`;
  for (const [reason, count] of topFailures) {
    report += `- **${reason}**: ${count}\n`;
  }

  if (!fs.existsSync(path.dirname(outputPath))) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  }

  fs.writeFileSync(outputPath, report);
  console.log(`\n[QA] Report: ${outputPath}`);

  if (failedTests.length > 0 && skippedTests.length < results.length) {
    console.log(`\n⚠️  ${failedTests.length} tests failed (${skippedTests.length} skipped due to rate limit)`);
    process.exit(1);
  }
}

runTests().catch(console.error);