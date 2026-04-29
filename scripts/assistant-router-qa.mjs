#!/usr/bin/env node

const BUILDINGOS_BASE = process.env.BUILDINGOS_BASE_URL || "http://localhost:4000";
const YORYI_BASE = process.env.YORYI_BASE_URL || "http://localhost:4001";
const LOGIN_EMAIL = process.env.QA_LOGIN_EMAIL || "admin@adminreal.test";
const LOGIN_PASSWORD = process.env.QA_LOGIN_PASSWORD || "DevPass!123";

const FIX_COMMIT = process.env.QA_FIX_COMMIT || "N/A";
const ALLOWED_ANSWER_SOURCES = new Set(["live_data", "knowledge", "fallback"]);
const ALLOWED_RESPONSE_TYPES = new Set(["exact", "summary", "list", "clarification"]);

const PROMPTS = [
  ["1", "cuanto debe la unidad A-1203 de la torre A", "deuda_exacta", "payments"],
  ["2", "cuanto debe la unidad A-1203 del edificio A", "deuda_exacta", "payments"],
  ["3", "cuanto debe la unidad A-1203 del bloque A", "deuda_exacta", "payments"],
  ["4", "deuda unidad A-1203 torre A", "deuda_exacta", "payments"],
  ["5", "saldo pendiente unidad A-1203 torre A", "deuda_exacta", "payments"],
  ["6", "adeuda la unidad A-1203 torre A", "deuda_exacta", "payments"],
  ["7", "esta al dia la unidad A-1203 torre A", "deuda_exacta", "payments"],
  ["8", "expensas adeudadas unidad A-1203 torre A", "deuda_exacta", "payments"],
  ["9", "cuanto debe la unidad 1203 torre A", "formato_unidad", "payments"],
  ["10", "cuanto debe la unidad 12-03 torre A", "formato_unidad", "payments"],
  ["11", "cuanto debe la unidad 12-3 torre A", "formato_unidad", "payments"],
  ["12", "saldo UF 1203 torre A", "formato_unidad", "payments"],
  ["13", "cuanto debe depto 03 piso 12 torre A", "formato_unidad", "payments"],
  ["14", "como viene la morosidad este mes?", "p3", "dashboard"],
  ["15", "resumen de deuda del edificio", "p3", "dashboard"],
  ["16", "top morosos", "p3", "dashboard"],
  ["17", "que torres deben mas?", "p3", "dashboard"],
  ["18", "comparame deuda de este mes vs mes pasado", "p3", "dashboard"],
  ["19", "quien es el residente principal de la unidad A-1203 torre A", "p1", "units"],
  ["20", "telefono del residente de la unidad A-1203 torre A", "p1", "units"],
  ["21", "listame unidades con deuda", "p1", "payments"],
  ["22", "unidades con deuda en torre A", "p1", "payments"],
  ["23", "pagos de la unidad A-1203", "p1", "payments"],
  ["24", "ultimo pago de la unidad A-1203", "p1", "payments"],
  ["25", "busca pagos de abril torre A", "p2b", "payments"],
  ["26", "filtra cargos pendientes por torre A", "p2b", "charges"],
  ["27", "mostrame reclamos abiertos del edificio A", "p2b", "tickets"],
  ["28", "buscar unidad 1203", "p2b", "units"],
  ["29", "deuda aging", "p2", "reports"],
  ["30", "deuda por antiguedad", "p2", "reports"],
  ["31", "evolucion de morosidad ultimos 6 meses", "p2", "reports"],
  ["32", "deuda por torre ultimos 3 meses", "p2", "reports"],
  ["33", "cobranzas del mes", "p2", "reports"],
  ["34", "tendencia de pagos vs cargos", "p2", "reports"],
  ["35", "necesito ver pagos", "p0", "payments"],
  ["36", "abrir dashboard de finanzas", "p0", "dashboard"],
  ["37", "quiero ver reportes", "p0", "reports"],
  ["38", "necesito ver reclamos", "p0", "tickets"],
  ["39", "buscar documentos del edificio", "p0", "documents"],
  ["40", "cuanto debe la unidad 1203", "ambiguo", "payments"],
  ["41", "cuanto debe la unidad 1203 torre A", "ambiguo", "payments"],
  ["42", "deuda torre A", "ambiguo", "payments"],
  ["43", "unidad A-1203 edificio", "ambiguo", "payments"],
  ["44", "crea un cargo a la unidad A-1203", "mutation", "charges"],
  ["45", "registra un pago de 10000", "mutation", "payments"],
  ["46", "cambia el residente de la unidad", "mutation", "units"],
];
const EXPECTED_CASE_COUNT = PROMPTS.length;

function normalize(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function summarize(text, max = 140) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}...` : oneLine;
}

function extractOutput(payload) {
  if (payload?.answer && String(payload.answer).trim().length > 0) {
    return summarize(payload.answer);
  }
  if (payload?.message) {
    return summarize(payload.message);
  }
  if (payload?.error) {
    return summarize(payload.error);
  }
  if (payload?.raw) {
    return summarize(payload.raw);
  }
  return "";
}

function routeFromYoryi(yoryiResponse) {
  const intent = yoryiResponse?.provenance?.sources?.find((s) => s?.metadata?.intentCode)?.metadata?.intentCode;
  if (!intent) return "unknown";
  if (intent.includes("TREND") || intent.includes("AGING") || intent.includes("SUMMARY") || intent.includes("TOP")) return "P2/P3";
  if (intent.includes("SEARCH") || intent.includes("FILTER")) return "P2B";
  if (intent.includes("UNIT_DEBT") || intent.includes("RESIDENT") || intent.includes("PAYMENT")) return "P1";
  return "P0";
}

function evaluate(type, response, layer, httpStatus, input) {
  const answer = normalize(response?.answer);
  const sourceRaw = response?.answerSource;
  const responseTypeRaw = response?.responseType || response?.metadata?.responseType;
  const source = typeof sourceRaw === "string" ? sourceRaw.toLowerCase() : null;
  const responseType = typeof responseTypeRaw === "string" ? responseTypeRaw.toLowerCase() : null;
  const isClarification = responseType === "clarification" || answer.includes("necesito") || answer.includes("aclara") || answer.includes("reformula");
  const normalizedInput = normalize(input || "");
  const isAggregateInput =
    normalizedInput.includes("top") ||
    normalizedInput.includes("ranking") ||
    normalizedInput.includes("morosos") ||
    normalizedInput.includes("morosidad") ||
    normalizedInput.includes("aging") ||
    normalizedInput.includes("antiguedad") ||
    normalizedInput.includes("por torre") ||
    normalizedInput.includes("que torres") ||
    normalizedInput.includes("resumen") ||
    normalizedInput.includes("unidades con deuda") ||
    normalizedInput.includes("listame unidades con deuda");
  const hasUnitAndBuildingInInput =
    /(?:unidad|apartamento|depto|departamento|apto|uf)\s+[a-z0-9-]+/.test(normalizedInput) &&
    /(?:torre|edificio|bloque)\s+[a-z0-9]+/.test(normalizedInput);
  const isGenericMenu = answer.includes("elegi una opcion") || answer.includes("decime si queres saldo");

  if (httpStatus === 409 || httpStatus === 429 || answer.includes("limit") || answer.includes("quota") || answer.includes("rate")) {
    return { status: "SKIP", cause: "NO_EVALUABLE throttled/quota/rate" };
  }

  if (httpStatus >= 400) {
    return { status: "FAIL", cause: `HTTP ${httpStatus}` };
  }

  if (!source || !responseType) {
    return { status: "FAIL", cause: "NEEDS_CONTRACT missing answerSource/responseType" };
  }
  if (!ALLOWED_ANSWER_SOURCES.has(source)) {
    return { status: "FAIL", cause: `NEEDS_CONTRACT invalid answerSource=${source}` };
  }
  if (responseType === "metric" || responseType === "answer") {
    return { status: "FAIL", cause: `NEEDS_CONTRACT invalid responseType=${responseType}` };
  }
  if (!ALLOWED_RESPONSE_TYPES.has(responseType)) {
    return { status: "FAIL", cause: `NEEDS_CONTRACT invalid responseType=${responseType}` };
  }

  if (isAggregateInput && isGenericMenu) {
    return { status: "FAIL", cause: "MAL aggregate query returned generic menu" };
  }
  if (isAggregateInput && (answer.includes("necesito ambos datos exactos") || answer.includes("unidad y torre exactas"))) {
    return { status: "FAIL", cause: "MAL aggregate query incorrectly asked for unit+tower" };
  }
  if (hasUnitAndBuildingInInput && isGenericMenu) {
    return { status: "FAIL", cause: "MAL unit+building query returned generic menu" };
  }

  if (type === "deuda_exacta" || type === "formato_unidad") {
    const looksDebtAnswer =
      answer.includes("deuda") ||
      answer.includes("saldo") ||
      answer.includes("al dia") ||
      answer.includes("no tiene deuda") ||
      answer.includes("no encontre unidad") ||
      answer.includes("no encontre la unidad");
    if (source !== "live_data") {
      return { status: "FAIL", cause: `answerSource=${source || "none"} expected live_data` };
    }
    if (!looksDebtAnswer) {
      return { status: "FAIL", cause: "No debt-status answer pattern detected" };
    }
    if (answer.includes("necesito ambos datos exactos") || answer.includes("unidad y torre exactas")) {
      return { status: "FAIL", cause: "Asked for unit+tower despite being present" };
    }
    return { status: "PASS", cause: "OK" };
  }

  if (type === "p3" || type === "p2") {
    if (["summary", "list", "exact"].includes(responseType) || isClarification) {
      return { status: "PASS", cause: "OK" };
    }
    return { status: "FAIL", cause: `Unexpected responseType=${responseType || "none"}` };
  }

  if (type === "p1" || type === "p2b" || type === "p0") {
    if (response?.answer && response.answer.trim().length > 0) {
      return { status: "PASS", cause: "OK" };
    }
    return { status: "FAIL", cause: "Empty answer" };
  }

  if (type === "ambiguo") {
    const isCase41Like = normalizedInput.includes("cuanto debe la unidad 1203 torre a");
    const looksDebtAnswer = answer.includes("deuda") || answer.includes("saldo") || answer.includes("no tiene deuda");
    if (isCase41Like && source === "live_data" && looksDebtAnswer) {
      return { status: "PASS", cause: "OK" };
    }
    if (isClarification) return { status: "PASS", cause: "OK" };
    return { status: "FAIL", cause: "Expected clarification" };
  }

  if (type === "mutation") {
    if (isClarification || answer.includes("solo consulta") || answer.includes("no puedo") || answer.includes("no ejecut")) {
      return { status: "PASS", cause: "OK" };
    }
    return { status: "FAIL", cause: "Expected mutation blocked clarification" };
  }

  return { status: "FAIL", cause: "Unknown test type" };
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: response.status, ok: response.ok, json };
}

async function login() {
  const res = await postJson(`${BUILDINGOS_BASE}/auth/login`, {
    email: LOGIN_EMAIL,
    password: LOGIN_PASSWORD,
  });
  if (!res.ok || !res.json?.accessToken) {
    throw new Error(`Login failed (${res.status})`);
  }
  const membership = res.json.memberships?.[0];
  return {
    token: res.json.accessToken,
    userId: res.json.user?.id,
    tenantId: membership?.tenantId,
    role: membership?.roles?.[0] || "TENANT_ADMIN",
  };
}

async function run() {
  const auth = await login();
  const sessionId = `qa-${Date.now()}`;
  const rows = [];

  for (const [id, input, type, page] of PROMPTS) {
    const buildingOsReq = {
      message: input,
      page,
      context: { extra: { sessionId, uiPage: `/tenant/${page}` } },
    };

    const buildingOsRes = await postJson(
      `${BUILDINGOS_BASE}/tenants/${auth.tenantId}/assistant/chat`,
      buildingOsReq,
      { authorization: `Bearer ${auth.token}` },
    );

    const yoryiReq = {
      message: input,
      sessionId,
      context: {
        appId: "buildingos",
        tenantId: auth.tenantId,
        userId: auth.userId,
        role: auth.role,
        route: `/tenant/${page}`,
        currentModule: page,
      },
    };

    const yoryiRes = await postJson(
      `${YORYI_BASE}/assistant/chat`,
      yoryiReq,
      {
        "x-app-id": "buildingos",
        "x-tenant-id": auth.tenantId,
        "x-user-id": auth.userId,
        "x-user-role": auth.role,
      },
    );

    const appEval = evaluate(type, buildingOsRes.json, "BuildingOS", buildingOsRes.status, input);
    const yoryiEval = evaluate(type, yoryiRes.json, "yoryi", yoryiRes.status, input);

    rows.push({
      id,
      type,
      input,
      buildingos: {
        httpStatus: buildingOsRes.status,
        route: buildingOsRes.json?.metadata?.routeFamily || (buildingOsRes.json?.metadata?.gatewayOutcome ? "YORYI_BRIDGE" : "LIVE_DATA_STRICT_OR_LOCAL"),
        output: extractOutput(buildingOsRes.json),
        answerSource: buildingOsRes.json?.metadata?.rawAnswerSource || buildingOsRes.json?.answerSource || null,
        responseType: buildingOsRes.json?.responseType || null,
        status: appEval.status,
        cause: appEval.cause,
      },
      yoryi: {
        httpStatus: yoryiRes.status,
        route: routeFromYoryi(yoryiRes.json),
        output: extractOutput(yoryiRes.json),
        answerSource: yoryiRes.json?.answerSource || null,
        responseType: yoryiRes.json?.responseType || null,
        intentCode: yoryiRes.json?.provenance?.sources?.find((s) => s?.metadata?.intentCode)?.metadata?.intentCode || null,
        status: yoryiEval.status,
        cause: yoryiEval.cause,
      },
      fixCommit: FIX_COMMIT,
    });
  }

  const outJson = {
    generatedAt: new Date().toISOString(),
    buildingosBase: BUILDINGOS_BASE,
    yoryiBase: YORYI_BASE,
    rows,
  };

  const outputPath = new URL("../docs/qa/assistant-router-qa-results.json", import.meta.url);
  const reportPath = new URL("../docs/qa/assistant-router-qa-report.md", import.meta.url);

  await import("node:fs/promises").then((fs) => fs.mkdir(new URL("../docs/qa/", import.meta.url), { recursive: true }));
  await import("node:fs/promises").then((fs) => fs.writeFile(outputPath, JSON.stringify(outJson, null, 2)));

  const header = "| # | Input | Layer | Route | Output | Source | Status | Cause | Fix Commit |\n|---|---|---|---|---|---|---|---|---|\n";
  const lines = [];
  for (const row of rows) {
    lines.push(`| ${row.id} | ${row.input} | BuildingOS | ${row.buildingos.route} | ${row.buildingos.output} | ${row.buildingos.answerSource || "n/a"} | ${row.buildingos.status} | ${row.buildingos.cause} | ${row.fixCommit} |`);
    lines.push(`| ${row.id} | ${row.input} | yoryi | ${row.yoryi.route}${row.yoryi.intentCode ? ` (${row.yoryi.intentCode})` : ""} | ${row.yoryi.output} | ${row.yoryi.answerSource || "n/a"} | ${row.yoryi.status} | ${row.yoryi.cause} | ${row.fixCommit} |`);
  }

  const summary = rows.reduce(
    (acc, row) => {
      acc.total += 2;
      if (row.buildingos.status === "PASS") acc.pass += 1;
      if (row.yoryi.status === "PASS") acc.pass += 1;
      return acc;
    },
    { total: 0, pass: 0 },
  );

  const uniqueCaseIds = new Set(rows.map((row) => String(row.id)));
  const missingCases = [];
  for (let i = 1; i <= EXPECTED_CASE_COUNT; i += 1) {
    const id = String(i);
    if (!uniqueCaseIds.has(id)) {
      missingCases.push(id);
    }
  }

  const categorySummary = rows.reduce(
    (acc, row) => {
      for (const layer of [row.buildingos, row.yoryi]) {
        const cause = normalize(layer.cause || "");
        if (layer.status === "SKIP") acc.noEvaluable += 1;
        if (cause.includes("aggregate")) acc.agregadasMal += 1;
        if (cause.includes("generic menu")) acc.menuGenerico += 1;
        if (cause.includes("needs_contract")) acc.needsContract += 1;
      }
      return acc;
    },
    { noEvaluable: 0, agregadasMal: 0, menuGenerico: 0, needsContract: 0 },
  );

  const skipped = rows.reduce((acc, row) => {
    if (row.buildingos.status === "SKIP") acc += 1;
    if (row.yoryi.status === "SKIP") acc += 1;
    return acc;
  }, 0);

  const md = `# Assistant Router QA Report\n\n- Generated at: ${new Date().toISOString()}\n- BuildingOS base: ${BUILDINGOS_BASE}\n- yoryi base: ${YORYI_BASE}\n- Total checks: ${summary.total}\n- Pass: ${summary.pass}\n- Skip: ${skipped}\n- Fail: ${summary.total - summary.pass - skipped}\n- Missing cases: ${missingCases.length > 0 ? missingCases.join(", ") : "none"}\n- NEEDS_CONTRACT: ${categorySummary.needsContract}\n- MAL agregadas: ${categorySummary.agregadasMal}\n- MAL menu_generico: ${categorySummary.menuGenerico}\n- NO_EVALUABLE: ${categorySummary.noEvaluable}\n\n## Results\n${header}${lines.join("\n")}\n\n## Execution\n- node scripts/assistant-router-qa.mjs\n- npm test -- assistant.service.spec.ts read-only-query.service.spec.ts tools.service.spec.ts\n- npm test (apps/api)\n\n## Raw artifact\n- docs/qa/assistant-router-qa-results.json\n`;

  await import("node:fs/promises").then((fs) => fs.writeFile(reportPath, md));

  console.log(`Saved JSON: ${outputPath.pathname}`);
  console.log(`Saved report: ${reportPath.pathname}`);

  const failures = rows.flatMap((row) => {
    const out = [];
    if (row.buildingos.status === "FAIL") out.push({ id: row.id, layer: "BuildingOS", input: row.input, cause: row.buildingos.cause });
    if (row.yoryi.status === "FAIL") out.push({ id: row.id, layer: "yoryi", input: row.input, cause: row.yoryi.cause });
    return out;
  });
  if (failures.length > 0) {
    console.log("Failures:");
    for (const f of failures) {
      console.log(`- [${f.id}] ${f.layer}: ${f.input} -> ${f.cause}`);
    }
    process.exitCode = 2;
  }

  if (missingCases.length > 0 || categorySummary.needsContract > 0 || categorySummary.noEvaluable > 0) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
