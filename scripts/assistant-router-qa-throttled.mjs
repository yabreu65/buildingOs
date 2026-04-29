#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";

const BUILDINGOS_BASE = process.env.BUILDINGOS_BASE_URL || "http://localhost:4000";
const YORYI_BASE = process.env.YORYI_BASE_URL || "http://localhost:4001";
const LOGIN_EMAIL = process.env.QA_LOGIN_EMAIL || "admin@adminreal.test";
const LOGIN_PASSWORD = process.env.QA_LOGIN_PASSWORD || "DevPass!123";

const REQUEST_DELAY_MS = Number(process.env.QA_REQUEST_DELAY_MS || 900);
const BATCH_SIZE = Number(process.env.QA_BATCH_SIZE || 8);
const BATCH_PAUSE_MS = Number(process.env.QA_BATCH_PAUSE_MS || 5000);
const RETRY_DELAYS_MS = [2000, 5000, 10000];
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(value) {
  return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function summarize(text, max = 140) {
  const oneLine = String(text || "").replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}...` : oneLine;
}

function extractOutput(payload) {
  if (payload?.answer) return summarize(payload.answer);
  if (payload?.message) return summarize(payload.message);
  if (payload?.error) return summarize(payload.error);
  if (payload?.raw) return summarize(payload.raw);
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
  const normalizedInput = normalize(input || "");
  const isClarification = responseType === "clarification" || answer.includes("necesito") || answer.includes("aclara") || answer.includes("reformula");
  const isGenericMenu = answer.includes("elegi una opcion") || answer.includes("decime si queres saldo");
  const isAggregateInput =
    normalizedInput.includes("top") ||
    normalizedInput.includes("ranking") ||
    normalizedInput.includes("morosos") ||
    normalizedInput.includes("morosidad") ||
    normalizedInput.includes("aging") ||
    normalizedInput.includes("antiguedad") ||
    normalizedInput.includes("resumen") ||
    normalizedInput.includes("que torres") ||
    normalizedInput.includes("por torre") ||
    normalizedInput.includes("unidades con deuda") ||
    normalizedInput.includes("listame unidades con deuda");
  const hasUnitAndBuildingInInput =
    /(?:unidad|apartamento|depto|departamento|apto|uf)\s+[a-z0-9-]+/.test(normalizedInput) &&
    /(?:torre|edificio|bloque)\s+[a-z0-9]+/.test(normalizedInput);

  if (httpStatus === 409 || httpStatus === 429 || answer.includes("limit") || answer.includes("quota") || answer.includes("rate")) {
    return { status: "SKIP", cause: "NO_EVALUABLE throttled/quota/rate" };
  }

  if (httpStatus >= 400) {
    const message = normalize(response?.message || response?.error || response?.raw || "");
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

  if (isAggregateInput) {
    if (isGenericMenu) {
      return { status: "FAIL", cause: "MAL aggregate query returned generic menu" };
    }
    if (answer.includes("necesito ambos datos exactos") || answer.includes("unidad y torre exactas")) {
      return { status: "FAIL", cause: "MAL aggregate query incorrectly asked for unit+tower" };
    }
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
    if (source !== "live_data") return { status: "FAIL", cause: `answerSource=${source || "none"} expected live_data` };
    if (!looksDebtAnswer) return { status: "FAIL", cause: "No debt-status answer pattern detected" };
    if (answer.includes("necesito ambos datos exactos") || answer.includes("unidad y torre exactas")) return { status: "FAIL", cause: "Asked for unit+tower despite being present" };
    return { status: "PASS", cause: "OK" };
  }

  if (type === "p3" || type === "p2") {
    if (["summary", "list", "exact"].includes(responseType) || isClarification) return { status: "PASS", cause: "OK" };
    return { status: "FAIL", cause: `Unexpected responseType=${responseType || "none"}` };
  }

  if (type === "p1" || type === "p2b" || type === "p0") {
    if (response?.answer && response.answer.trim().length > 0) return { status: "PASS", cause: "OK" };
    return { status: "FAIL", cause: "Empty answer" };
  }

  if (type === "ambiguo") {
    const normalizedInput = normalize(input || "");
    const isCase41Like = normalizedInput.includes("cuanto debe la unidad 1203 torre a");
    const looksDebtAnswer = answer.includes("deuda") || answer.includes("saldo") || answer.includes("no tiene deuda");
    if (isCase41Like && source === "live_data" && looksDebtAnswer) return { status: "PASS", cause: "OK" };
    if (isClarification) return { status: "PASS", cause: "OK" };
    return { status: "FAIL", cause: "Expected clarification" };
  }

  if (type === "mutation") {
    if (isClarification || answer.includes("solo consulta") || answer.includes("no puedo") || answer.includes("no ejecut")) return { status: "PASS", cause: "OK" };
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

async function postWithRetry(url, payload, headers = {}) {
  let attempt = 1;
  let result = await postJson(url, payload, headers);
  while (result.status === 429 && attempt <= RETRY_DELAYS_MS.length) {
    const delayMs = RETRY_DELAYS_MS[attempt - 1];
    await sleep(delayMs);
    attempt += 1;
    result = await postJson(url, payload, headers);
  }
  return { ...result, attempts: attempt };
}

async function login() {
  const res = await postJson(`${BUILDINGOS_BASE}/auth/login`, {
    email: LOGIN_EMAIL,
    password: LOGIN_PASSWORD,
  });
  if (!res.ok || !res.json?.accessToken) throw new Error(`Login failed (${res.status})`);
  const membership = res.json.memberships?.[0];
  return {
    token: res.json.accessToken,
    userId: res.json.user?.id,
    tenantId: membership?.tenantId,
    membershipId: membership?.id || "membership-1",
    role: membership?.roles?.[0] || "TENANT_ADMIN",
  };
}

async function run() {
  const auth = await login();
  const sessionId = `buildingos:${auth.tenantId}:${auth.membershipId}`;
  const rows = [];

  for (let i = 0; i < PROMPTS.length; i += 1) {
    const [id, input, type, page] = PROMPTS[i];

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

    await sleep(REQUEST_DELAY_MS);

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

    const yoryiRes = await postWithRetry(
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
        attempts: 1,
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
        attempts: yoryiRes.attempts,
      },
    });

    await sleep(REQUEST_DELAY_MS);

    const indexInBatch = (i + 1) % BATCH_SIZE;
    if (indexInBatch === 0 && i + 1 < PROMPTS.length) {
      await sleep(BATCH_PAUSE_MS);
    }
  }

  const summary = rows.reduce(
    (acc, row) => {
      for (const layer of [row.buildingos, row.yoryi]) {
        acc.total += 1;
        if (layer.status === "PASS") acc.pass += 1;
        else if (layer.status === "FAIL") acc.fail += 1;
        else if (layer.status === "SKIP") acc.skip += 1;
      }
      return acc;
    },
    { total: 0, pass: 0, fail: 0, skip: 0 },
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

  const qaDir = new URL("../docs/qa/", import.meta.url);
  const jsonPath = new URL("../docs/qa/assistant-router-qa-throttled-results.json", import.meta.url);
  const mdPath = new URL("../docs/qa/assistant-router-qa-throttled-report.md", import.meta.url);
  await mkdir(qaDir, { recursive: true });

  const outJson = {
    generatedAt: new Date().toISOString(),
    buildingosBase: BUILDINGOS_BASE,
    yoryiBase: YORYI_BASE,
    requestDelayMs: REQUEST_DELAY_MS,
    batchSize: BATCH_SIZE,
    batchPauseMs: BATCH_PAUSE_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    rows,
    summary,
    expectedCases: EXPECTED_CASE_COUNT,
    observedCases: uniqueCaseIds.size,
    missingCases,
    categorySummary,
  };

  await writeFile(jsonPath, JSON.stringify(outJson, null, 2));

  let md = "# Assistant Router QA Throttled Report\n\n";
  md += `- Generated at: ${outJson.generatedAt}\n`;
  md += `- BuildingOS base: ${BUILDINGOS_BASE}\n`;
  md += `- yoryi base: ${YORYI_BASE}\n`;
  md += `- Request delay: ${REQUEST_DELAY_MS}ms\n`;
  md += `- Batch size: ${BATCH_SIZE}\n`;
  md += `- Batch pause: ${BATCH_PAUSE_MS}ms\n`;
  md += `- Retry delays: ${RETRY_DELAYS_MS.join(", ")}ms\n`;
  md += `- Total checks: ${summary.total}\n`;
  md += `- Pass: ${summary.pass}\n`;
  md += `- Fail: ${summary.fail}\n`;
  md += `- Skip: ${summary.skip}\n\n`;
  md += `- Missing cases: ${missingCases.length > 0 ? missingCases.join(", ") : "none"}\n`;
  md += `- NEEDS_CONTRACT: ${categorySummary.needsContract}\n`;
  md += `- MAL agregadas: ${categorySummary.agregadasMal}\n`;
  md += `- MAL menu_generico: ${categorySummary.menuGenerico}\n`;
  md += `- NO_EVALUABLE: ${categorySummary.noEvaluable}\n\n`;
  md += "| # | Input | Layer | Route | Output | Source | Type | HTTP | Attempts | Status | Cause |\n";
  md += "|---|---|---|---|---|---|---|---|---|---|---|\n";

  for (const row of rows) {
    md += `| ${row.id} | ${row.input} | BuildingOS | ${row.buildingos.route} | ${row.buildingos.output} | ${row.buildingos.answerSource || "n/a"} | ${row.buildingos.responseType || "n/a"} | ${row.buildingos.httpStatus} | ${row.buildingos.attempts} | ${row.buildingos.status} | ${row.buildingos.cause} |\n`;
    md += `| ${row.id} | ${row.input} | yoryi | ${row.yoryi.route}${row.yoryi.intentCode ? ` (${row.yoryi.intentCode})` : ""} | ${row.yoryi.output} | ${row.yoryi.answerSource || "n/a"} | ${row.yoryi.responseType || "n/a"} | ${row.yoryi.httpStatus} | ${row.yoryi.attempts} | ${row.yoryi.status} | ${row.yoryi.cause} |\n`;
  }

  await writeFile(mdPath, md);

  console.log(`Saved JSON: ${jsonPath.pathname}`);
  console.log(`Saved report: ${mdPath.pathname}`);

  const gateFailed =
    summary.fail > 0 ||
    missingCases.length > 0 ||
    categorySummary.needsContract > 0 ||
    categorySummary.noEvaluable > 0;

  if (gateFailed) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
