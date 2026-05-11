/**
 * Script de Test E2E Mejorado - Asistente AI San Cristóbal
 * 80+ preguntas con variaciones avanzadas
 */

const BASE_URL = process.env.API_URL || 'http://localhost:4000';
const ADMIN_EMAIL = 'admin@sancristobal.test';
const ADMIN_PASSWORD = 'DevPass!123';
const fs = require('fs');

async function login() {
  console.log('🔑 Autenticando...');
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  const membership = data.memberships?.[0];
  if (!membership) throw new Error('No membership');
  console.log(`✅ Logueado: ${data.user.email} | Tenant: ${membership.tenantId}\n`);
  return { token: data.accessToken, tenantId: membership.tenantId };
}

async function ask(token, tenantId, category, id, question, expectedKeywords = []) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/tenants/${tenantId}/assistant/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
      },
      body: JSON.stringify({ message: question, page: 'dashboard' }),
    });

    const latencyMs = Date.now() - start;
    const data = await res.json();

    let status = 'PASS';
    let error = undefined;

    if (!res.ok) {
      status = 'FAIL';
      error = `HTTP ${res.status}: ${data.message || 'Unknown'}`;
    } else if (data.answer?.includes('Entendí tu consulta')) {
      status = 'FAIL';
      error = 'Fallback';
    } else if (expectedKeywords.length > 0) {
      const missing = expectedKeywords.filter((k) =>
        !data.answer?.toLowerCase().includes(k.toLowerCase())
      );
      if (missing.length > 0) {
        status = 'WARNING';
        error = `Faltan: ${missing.join(', ')}`;
      }
    }

    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} [${id}] ${question.substring(0, 55)}... (${latencyMs}ms)`);
    if (error) console.log(`   └─ ${error}`);

    return { category, id, question, status, response: data.answer?.substring(0, 180) || '', latencyMs, error };
  } catch (err) {
    const latencyMs = Date.now() - start;
    console.log(`❌ [${id}] ${question.substring(0, 55)}... ERROR`);
    console.log(`   └─ ${err.message}`);
    return { category, id, question, status: 'FAIL', response: '', latencyMs, error: err.message };
  }
}

async function runTests() {
  console.log('🏗️  Test E2E Mejorado - Asistente AI - Residencia San Cristóbal\n');
  const { token, tenantId } = await login();
  const results = [];
  const q = async (cat, id, question, keywords = []) => {
    const r = await ask(token, tenantId, cat, id, question, keywords);
    results.push(r);
  };

  // ============================================================
  // A. RESIDENTES - Variaciones extendidas
  // ============================================================
  console.log('\n📋 A. Residentes/Ocupantes (15 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Residentes', 'A1', 'Quien vive en el departamento 0101 de la Torre A', ['residente']);
  await q('Residentes', 'A2', 'Residente del apartamento 0102 de la Torre A', ['residente']);
  await q('Residentes', 'A3', 'Inquilino del depto 0103 de la Torre B', ['residente']);
  await q('Residentes', 'A4', 'Propietario del departamento 0104 de la Torre A', ['propietario']);
  await q('Residentes', 'A5', 'Quien habita en la unidad 0105 de la Torre B', ['residente']);
  await q('Residentes', 'A6', 'Ocupante del apartamento 0106', ['necesito', 'edificio']);
  await q('Residentes', 'A7', 'Residente del departamento 9999 de la Torre A', ['no encontré']);
  // NUEVAS VARIACIONES
  await q('Residentes', 'A8', 'Persona que vive en el depto 0107 de la Torre A', ['residente']);
  await q('Residentes', 'A9', 'Dueno del apartamento 0108 de la Torre B', ['propietario']);
  await q('Residentes', 'A10', 'Habitante de la unidad 0109 de la Torre A', ['residente']);
  await q('Residentes', 'A11', 'Quien reside en el departamento 0110 de la Torre B', ['residente']);
  await q('Residentes', 'A12', 'Arrendatario del depto 0111 de la Torre A', ['residente']);
  await q('Residentes', 'A13', 'Locatario del apartamento 0112 de la Torre B', ['residente']);
  await q('Residentes', 'A14', 'Titular de la unidad 0113 de la Torre A', ['residente']);
  await q('Residentes', 'A15', 'Quien ocupa el departamento 0114 de la Torre B', ['residente']);

  // ============================================================
  // B. DEUDA UNIT - Variaciones extendidas
  // ============================================================
  console.log('\n📋 B. Deuda (Unit-Level) (12 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Deuda-Unit', 'B1', 'Cuanto debe el departamento 0101 de la Torre A', ['deuda', 'USD']);
  await q('Deuda-Unit', 'B2', 'Deuda del apartamento 0102 de la Torre B', ['deuda']);
  await q('Deuda-Unit', 'B3', 'Que saldo tiene el depto 0103 de la Torre A', ['saldo']);
  await q('Deuda-Unit', 'B4', 'Cuanto adeuda la unidad 0104 de la Torre B', ['adeuda']);
  await q('Deuda-Unit', 'B5', 'Monto de deuda del departamento 0105 de la Torre A', ['monto']);
  await q('Deuda-Unit', 'B6', 'Importe pendiente del apartamento 0106 de la Torre A', ['importe']);
  await q('Deuda-Unit', 'B7', 'La unidad 0107 de la Torre B esta al dia', ['deuda', 'saldo']);
  await q('Deuda-Unit', 'B8', 'Deuda del departamento 0201 de la Torre A', ['deuda']);
  // NUEVAS VARIACIONES
  await q('Deuda-Unit', 'B9', 'Expensas del depto 0108 de la Torre B', ['deuda']);
  await q('Deuda-Unit', 'B10', 'Cuanto debe el apto 0109 de la Torre A', ['deuda']);
  await q('Deuda-Unit', 'B11', 'Situacion de pagos de la unidad 0110 de la Torre B', ['deuda']);
  await q('Deuda-Unit', 'B12', 'Estado de cuenta del departamento 0111 de la Torre A', ['deuda']);

  // ============================================================
  // C. DOCUMENTOS UNIT
  // ============================================================
  console.log('\n📋 C. Documentos (Unit-Level) (6 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Documentos-Unit', 'C1', 'Documentos del departamento 0101 de la Torre A');
  await q('Documentos-Unit', 'C2', 'Archivos del apartamento 0102 de la Torre B');
  await q('Documentos-Unit', 'C3', 'PDFs de la unidad 0103 de la Torre A');
  await q('Documentos-Unit', 'C4', 'Comprobantes del depto 0104 de la Torre B');
  await q('Documentos-Unit', 'C5', 'Planillas del departamento 0105 de la Torre A');
  await q('Documentos-Unit', 'C6', 'Expedientes del apartamento 0106 de la Torre B');

  // ============================================================
  // D. TICKETS UNIT
  // ============================================================
  console.log('\n📋 D. Tickets (Unit-Level) (6 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Tickets-Unit', 'D1', 'Tickets del departamento 0101 de la Torre A', ['ticket']);
  await q('Tickets-Unit', 'D2', 'Reclamos del apartamento 0102 de la Torre B', ['reclamo']);
  await q('Tickets-Unit', 'D3', 'Problemas de la unidad 0103 de la Torre A', ['problema']);
  await q('Tickets-Unit', 'D4', 'Averias del depto 0104 de la Torre B', ['averia']);
  await q('Tickets-Unit', 'D5', 'Solicitudes del departamento 0105 de la Torre A', ['solicitud']);
  await q('Tickets-Unit', 'D6', 'Incidentes del apartamento 0106 de la Torre B', ['incidente']);

  // ============================================================
  // E. PAGOS UNIT
  // ============================================================
  console.log('\n📋 E. Pagos (Unit-Level) (8 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Pagos-Unit', 'E1', 'Ultimos pagos del departamento 0101 de la Torre A', ['pago']);
  await q('Pagos-Unit', 'E2', 'Historial de pagos del apartamento 0102 de la Torre B', ['historial']);
  await q('Pagos-Unit', 'E3', 'Transferencias de la unidad 0103 de la Torre A', ['transferencia']);
  await q('Pagos-Unit', 'E4', 'Recibos del depto 0104 de la Torre B', ['recibo']);
  await q('Pagos-Unit', 'E5', 'Movimientos del departamento 0105 de la Torre A', ['movimiento']);
  // NUEVAS VARIACIONES
  await q('Pagos-Unit', 'E6', 'Transacciones del apto 0106 de la Torre B', ['transaccion']);
  await q('Pagos-Unit', 'E7', 'Cobros de la unidad 0107 de la Torre A', ['cobro']);
  await q('Pagos-Unit', 'E8', 'Abonos del departamento 0108 de la Torre B', ['abono']);

  // ============================================================
  // F. DEUDA BUILDING
  // ============================================================
  console.log('\n📋 F. Deuda Total (Building-Level) (7 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Deuda-Building', 'F1', 'Cuanto debe la Torre A', ['deuda', 'Torre A']);
  await q('Deuda-Building', 'F2', 'Deuda de la Torre B', ['deuda']);
  await q('Deuda-Building', 'F3', 'Que saldo tiene el edificio A', ['saldo']);
  await q('Deuda-Building', 'F4', 'Monto adeudado del complejo', ['monto']);
  await q('Deuda-Building', 'F5', 'Importe pendiente de la torre', ['importe']);
  await q('Deuda-Building', 'F6', 'Expensas del edificio A', ['deuda']);
  await q('Deuda-Building', 'F7', 'Total adeudado de la Torre B', ['deuda']);

  // ============================================================
  // G. TICKETS BUILDING
  // ============================================================
  console.log('\n📋 G. Tickets (Building-Level) (6 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Tickets-Building', 'G1', 'Tickets de la Torre A', ['ticket']);
  await q('Tickets-Building', 'G2', 'Reclamos de la Torre B', ['reclamo']);
  await q('Tickets-Building', 'G3', 'Problemas del edificio A', ['problema']);
  await q('Tickets-Building', 'G4', 'Fallas de la Torre A', ['falla']);
  await q('Tickets-Building', 'G5', 'Solicitudes del complejo', ['solicitud']);
  await q('Tickets-Building', 'G6', 'Incidentes del edificio B', ['incidente']);

  // ============================================================
  // H. MOROSOS
  // ============================================================
  console.log('\n📋 H. Morosos (Building-Level) (10 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Morosos', 'H1', 'Quienes son los morosos de la Torre A', ['moroso', 'deuda']);
  await q('Morosos', 'H2', 'Top deudores de la Torre B', ['top', 'deudores']);
  await q('Morosos', 'H3', 'Ranking de deuda del edificio A', ['ranking']);
  await q('Morosos', 'H4', 'Atrasados de la Torre A', ['atrasados']);
  await q('Morosos', 'H5', 'Impagos de la Torre B', ['impagos']);
  await q('Morosos', 'H6', 'Deudores del complejo', ['deudores']);
  // NUEVAS VARIACIONES
  await q('Morosos', 'H7', 'Unidades que no pagan de la Torre A', ['deudores']);
  await q('Morosos', 'H8', 'Listado de morosos del edificio B', ['moroso']);
  await q('Morosos', 'H9', 'Quien debe mas de la Torre A', ['deudores']);
  await q('Morosos', 'H10', 'Mayores deudores del complejo', ['deudores']);

  // ============================================================
  // I. ESTADISTICAS
  // ============================================================
  console.log('\n📋 I. Estadísticas (Building-Level) (10 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Estadisticas', 'I1', 'Estadisticas de la Torre A', ['estadisticas']);
  await q('Estadisticas', 'I2', 'Cuantas unidades tiene la Torre B', ['unidades']);
  await q('Estadisticas', 'I3', 'Resumen del edificio A', ['resumen']);
  await q('Estadisticas', 'I4', 'Como viene la Torre A', ['estadisticas']);
  await q('Estadisticas', 'I5', 'Cuentas del edificio B', ['cuentas']);
  // NUEVAS VARIACIONES
  await q('Estadisticas', 'I6', 'Informacion general de la Torre A', ['estadisticas']);
  await q('Estadisticas', 'I7', 'Datos del edificio B', ['estadisticas']);
  await q('Estadisticas', 'I8', 'Situacion del complejo', ['estadisticas']);
  await q('Estadisticas', 'I9', 'Cuanto se debe en total en la Torre A', ['deuda']);
  await q('Estadisticas', 'I10', 'Balance de la Torre B', ['estadisticas']);

  // ============================================================
  // J. DOCUMENTOS BUILDING
  // ============================================================
  console.log('\n📋 J. Documentos (Building-Level) (5 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Documentos-Building', 'J1', 'Documentos de la Torre A', ['documentos']);
  await q('Documentos-Building', 'J2', 'Archivos de la Torre B', ['archivos']);
  await q('Documentos-Building', 'J3', 'Actas del edificio A', ['actas']);
  await q('Documentos-Building', 'J4', 'Reglamentos del complejo', ['reglamento']);
  await q('Documentos-Building', 'J5', 'Planos de la Torre A', ['planos']);

  // ============================================================
  // K. PAGOS BUILDING
  // ============================================================
  console.log('\n📋 K. Pagos (Building-Level) (6 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Pagos-Building', 'K1', 'Pagos de la Torre A', ['pagos']);
  await q('Pagos-Building', 'K2', 'Transferencias de la Torre B', ['transferencias']);
  await q('Pagos-Building', 'K3', 'Recibos del edificio A', ['recibos']);
  await q('Pagos-Building', 'K4', 'Cobranzas de la Torre A', ['cobranzas']);
  await q('Pagos-Building', 'K5', 'Ingresos del complejo', ['ingresos']);
  await q('Pagos-Building', 'K6', 'Recaudacion de la Torre B', ['recaudacion']);

  // ============================================================
  // L. FRONTERA Y SEGURIDAD
  // ============================================================
  console.log('\n📋 L. Frontera y Seguridad (8 preguntas)');
  console.log('─────────────────────────────────────────────────────────────');
  await q('Frontera', 'L1', 'Deuda del departamento 0101', ['necesito', 'edificio']);
  await q('Frontera', 'L2', 'Deuda de la Torre Z', ['no encontré']);
  await q('Frontera', 'L3', 'Tickets del departamento 9999 de la Torre A', ['no encontré']);
  await q('Frontera', 'L4', 'Residente del apartamento', ['necesito', 'unidad']);
  await q('Frontera', 'L5', 'Hola, como estas', ['consulta']);
  // NUEVAS VARIACIONES
  await q('Frontera', 'L6', 'Gracias', ['gracias']);
  await q('Frontera', 'L7', 'Que hora es', ['hora']);
  await q('Frontera', 'L8', 'Cual es el clima hoy', ['clima']);

  // ============================================================
  // REPORTE
  // ============================================================
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     REPORTE: ASISTENTE SAN CRISTÓBAL E2E (MEJORADO)          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warning = results.filter((r) => r.status === 'WARNING').length;
  const total = results.length;
  const avgLatency = Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / total);

  console.log(`📊 Resumen:`);
  console.log(`   Total preguntas: ${total}`);
  console.log(`   ✅ PASS:        ${pass} (${Math.round((pass/total)*100)}%)`);
  console.log(`   ❌ FAIL:        ${fail} (${Math.round((fail/total)*100)}%)`);
  console.log(`   ⚠️  WARNING:     ${warning} (${Math.round((warning/total)*100)}%)`);
  console.log(`   ⏱️  Latencia promedio: ${avgLatency}ms`);
  console.log('');

  if (fail > 0) {
    console.log('❌ PREGUNTAS QUE FALLARON:');
    console.log('─────────────────────────────────────────────────────────────────');
    results.filter((r) => r.status === 'FAIL').forEach((r) => {
      console.log(`\n   [${r.id}] ${r.question}`);
      console.log(`       Error: ${r.error}`);
      console.log(`       Respuesta: ${r.response.substring(0, 150)}...`);
    });
    console.log('');
  }

  if (warning > 0) {
    console.log('⚠️  PREGUNTAS CON WARNING:');
    console.log('─────────────────────────────────────────────────────────────────');
    results.filter((r) => r.status === 'WARNING').forEach((r) => {
      console.log(`\n   [${r.id}] ${r.question}`);
      console.log(`       Warning: ${r.error}`);
    });
    console.log('');
  }

  const reportPath = '/tmp/assistant-e2e-report-final.json';
  fs.writeFileSync(reportPath, JSON.stringify({
    fecha: new Date().toISOString(),
    tenant: 'Residencia San Cristóbal',
    resumen: { total, pass, fail, warning, avgLatency },
    detalle: results,
  }, null, 2));
  console.log(`💾 Reporte guardado en: ${reportPath}`);

  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('💥 Error fatal:', err.message);
  process.exit(1);
});
