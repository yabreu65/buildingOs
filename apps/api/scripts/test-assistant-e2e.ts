/**
 * Script de Test E2E Standalone para el Asistente AI
 * Residencia San Cristóbal - Datos Reales
 *
 * Este script bootstrapea la app NestJS y ejecuta preguntas reales
 * contra el endpoint del asistente, generando un reporte detallado.
 */

import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

interface TestResult {
  category: string;
  id: string;
  question: string;
  status: 'PASS' | 'FAIL' | 'WARNING';
  response: string;
  latencyMs: number;
  error?: string;
}

async function runTests() {
  console.log('🏗️  Iniciando test E2E del Asistente...\n');

  // Bootstrap app
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  await app.init();

  const prisma = moduleRef.get(PrismaService);
  const jwtService = moduleRef.get(JwtService);

  // Obtener datos de San Cristóbal
  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Residencia San Cristóbal' },
  });
  if (!tenant) {
    console.error('❌ Tenant no encontrado. Corré: npx ts-node prisma/seed-san-cristobal.ts');
    process.exit(1);
  }

  const admin = await prisma.user.findUnique({
    where: { email: process.env.SAN_CRISTOBAL_ADMIN_EMAIL || 'admin@sancristobal.test' },
    include: { memberships: { include: { roles: true } } },
  });
  if (!admin) {
    console.error('❌ Admin no encontrado');
    process.exit(1);
  }

  const adminToken = jwtService.sign({
    email: admin!.email,
    sub: admin!.id,
    isSuperAdmin: false,
  });

  console.log(`✅ App lista`);
  console.log(`👤 Tenant: ${tenant!.name} (${tenant!.id})`);
  console.log(`🔑 Admin: ${admin!.email}`);
  console.log('');

  const results: TestResult[] = [];

  async function ask(category: string, id: string, question: string, expectedKeywords: string[] = []): Promise<void> {
    const start = Date.now();
    const res = await request(app.getHttpServer())
      .post(`/tenants/${tenant!.id}/assistant/chat`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-Id', tenant!.id)
      .send({ message: question, page: 'dashboard' });

    const latencyMs = Date.now() - start;

    let status: 'PASS' | 'FAIL' | 'WARNING' = 'PASS';
    let error: string | undefined;

    if (res.status !== 200) {
      status = 'FAIL';
      error = `HTTP ${res.status}: ${res.body?.message || 'Unknown'}`;
    } else if (res.body.answer?.includes('Entendí tu consulta')) {
      status = 'FAIL';
      error = 'Fallback: no matcheó strict resolver';
    } else if (expectedKeywords.length > 0) {
      const missing = expectedKeywords.filter(k =>
        !res.body.answer?.toLowerCase().includes(k.toLowerCase())
      );
      if (missing.length > 0) {
        status = 'WARNING';
        error = `Faltan keywords: ${missing.join(', ')}`;
      }
    }

    results.push({
      category,
      id,
      question,
      status,
      response: res.body?.answer?.substring(0, 180) || '',
      latencyMs,
      error,
    });

    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    console.log(`${icon} [${id}] ${question.substring(0, 60)}... (${latencyMs}ms)`);
    if (error) console.log(`   └─ ${error}`);
  }

  // ============================================================
  // A. RESIDENTES
  // ============================================================
  console.log('\n📋 A. Residentes/Ocupantes (Unit-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Residentes', 'A1', 'Quien vive en el departamento 0101 de la Torre A', ['residente']);
  await ask('Residentes', 'A2', 'Residente del apartamento 0102 de la Torre A', ['residente']);
  await ask('Residentes', 'A3', 'Inquilino del depto 0103 de la Torre B', ['residente']);
  await ask('Residentes', 'A4', 'Propietario del departamento 0104 de la Torre A', ['propietario']);
  await ask('Residentes', 'A5', 'Quien habita en la unidad 0105 de la Torre B', ['residente']);
  await ask('Residentes', 'A6', 'Ocupante del apartamento 0106', ['necesito', 'edificio']);
  await ask('Residentes', 'A7', 'Residente del departamento 9999 de la Torre A', ['no encontré']);

  // ============================================================
  // B. DEUDA UNIT
  // ============================================================
  console.log('\n📋 B. Deuda (Unit-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Deuda-Unit', 'B1', 'Cuanto debe el departamento 0101 de la Torre A', ['deuda', 'USD']);
  await ask('Deuda-Unit', 'B2', 'Deuda del apartamento 0102 de la Torre B', ['deuda']);
  await ask('Deuda-Unit', 'B3', 'Que saldo tiene el depto 0103 de la Torre A', ['saldo']);
  await ask('Deuda-Unit', 'B4', 'Cuanto adeuda la unidad 0104 de la Torre B', ['adeuda']);
  await ask('Deuda-Unit', 'B5', 'Monto de deuda del departamento 0105 de la Torre A', ['monto']);
  await ask('Deuda-Unit', 'B6', 'Importe pendiente del apartamento 0106 de la Torre A', ['importe']);
  await ask('Deuda-Unit', 'B7', 'La unidad 0107 de la Torre B esta al dia', ['deuda', 'saldo']);
  await ask('Deuda-Unit', 'B8', 'Deuda del departamento 0201 de la Torre A', ['deuda']);

  // ============================================================
  // C. DOCUMENTOS UNIT
  // ============================================================
  console.log('\n📋 C. Documentos (Unit-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Documentos-Unit', 'C1', 'Documentos del departamento 0101 de la Torre A');
  await ask('Documentos-Unit', 'C2', 'Archivos del apartamento 0102 de la Torre B');
  await ask('Documentos-Unit', 'C3', 'PDFs de la unidad 0103 de la Torre A');
  await ask('Documentos-Unit', 'C4', 'Comprobantes del depto 0104 de la Torre B');

  // ============================================================
  // D. TICKETS UNIT
  // ============================================================
  console.log('\n📋 D. Tickets (Unit-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Tickets-Unit', 'D1', 'Tickets del departamento 0101 de la Torre A', ['ticket']);
  await ask('Tickets-Unit', 'D2', 'Reclamos del apartamento 0102 de la Torre B', ['reclamo']);
  await ask('Tickets-Unit', 'D3', 'Problemas de la unidad 0103 de la Torre A', ['problema']);
  await ask('Tickets-Unit', 'D4', 'Averias del depto 0104 de la Torre B', ['averia']);

  // ============================================================
  // E. PAGOS UNIT
  // ============================================================
  console.log('\n📋 E. Pagos (Unit-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Pagos-Unit', 'E1', 'Ultimos pagos del departamento 0101 de la Torre A', ['pago']);
  await ask('Pagos-Unit', 'E2', 'Historial de pagos del apartamento 0102 de la Torre B', ['historial']);
  await ask('Pagos-Unit', 'E3', 'Transferencias de la unidad 0103 de la Torre A', ['transferencia']);
  await ask('Pagos-Unit', 'E4', 'Recibos del depto 0104 de la Torre B', ['recibo']);
  await ask('Pagos-Unit', 'E5', 'Movimientos del departamento 0105 de la Torre A', ['movimiento']);

  // ============================================================
  // F. DEUDA BUILDING
  // ============================================================
  console.log('\n📋 F. Deuda Total (Building-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Deuda-Building', 'F1', 'Cuanto debe la Torre A', ['deuda', 'Torre A']);
  await ask('Deuda-Building', 'F2', 'Deuda de la Torre B', ['deuda']);
  await ask('Deuda-Building', 'F3', 'Que saldo tiene el edificio A', ['saldo']);
  await ask('Deuda-Building', 'F4', 'Monto adeudado del complejo', ['monto']);
  await ask('Deuda-Building', 'F5', 'Importe pendiente de la torre', ['importe']);

  // ============================================================
  // G. TICKETS BUILDING
  // ============================================================
  console.log('\n📋 G. Tickets (Building-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Tickets-Building', 'G1', 'Tickets de la Torre A', ['ticket']);
  await ask('Tickets-Building', 'G2', 'Reclamos de la Torre B', ['reclamo']);
  await ask('Tickets-Building', 'G3', 'Problemas del edificio A', ['problema']);
  await ask('Tickets-Building', 'G4', 'Fallas de la Torre A', ['falla']);

  // ============================================================
  // H. MOROSOS
  // ============================================================
  console.log('\n📋 H. Morosos (Building-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Morosos', 'H1', 'Quienes son los morosos de la Torre A', ['moroso', 'deuda']);
  await ask('Morosos', 'H2', 'Top deudores de la Torre B', ['top', 'deudores']);
  await ask('Morosos', 'H3', 'Ranking de deuda del edificio A', ['ranking']);
  await ask('Morosos', 'H4', 'Atrasados de la Torre A', ['atrasados']);
  await ask('Morosos', 'H5', 'Impagos de la Torre B', ['impagos']);
  await ask('Morosos', 'H6', 'Deudores del complejo', ['deudores']);

  // ============================================================
  // I. ESTADISTICAS
  // ============================================================
  console.log('\n📋 I. Estadísticas (Building-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Estadisticas', 'I1', 'Estadisticas de la Torre A', ['estadisticas']);
  await ask('Estadisticas', 'I2', 'Cuantas unidades tiene la Torre B', ['unidades']);
  await ask('Estadisticas', 'I3', 'Resumen del edificio A', ['resumen']);
  await ask('Estadisticas', 'I4', 'Como viene la Torre A', ['estadisticas']);
  await ask('Estadisticas', 'I5', 'Cuentas del edificio B', ['cuentas']);

  // ============================================================
  // J. DOCUMENTOS BUILDING
  // ============================================================
  console.log('\n📋 J. Documentos (Building-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Documentos-Building', 'J1', 'Documentos de la Torre A', ['documentos']);
  await ask('Documentos-Building', 'J2', 'Archivos de la Torre B', ['archivos']);
  await ask('Documentos-Building', 'J3', 'Actas del edificio A', ['actas']);

  // ============================================================
  // K. PAGOS BUILDING
  // ============================================================
  console.log('\n📋 K. Pagos (Building-Level)');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Pagos-Building', 'K1', 'Pagos de la Torre A', ['pagos']);
  await ask('Pagos-Building', 'K2', 'Transferencias de la Torre B', ['transferencias']);
  await ask('Pagos-Building', 'K3', 'Recibos del edificio A', ['recibos']);
  await ask('Pagos-Building', 'K4', 'Cobranzas de la Torre A', ['cobranzas']);

  // ============================================================
  // L. FRONTERA
  // ============================================================
  console.log('\n📋 L. Frontera y Seguridad');
  console.log('─────────────────────────────────────────────────────────────');
  await ask('Frontera', 'L1', 'Deuda del departamento 0101', ['necesito', 'edificio']);
  await ask('Frontera', 'L2', 'Deuda de la Torre Z', ['no encontré']);
  await ask('Frontera', 'L3', 'Tickets del departamento 9999 de la Torre A', ['no encontré']);
  await ask('Frontera', 'L5', 'Hola, como estas', ['consulta']);

  // ============================================================
  // REPORTE FINAL
  // ============================================================
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           REPORTE: ASISTENTE SAN CRISTÓBAL E2E               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const warning = results.filter(r => r.status === 'WARNING').length;
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
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`\n   [${r.id}] ${r.question}`);
      console.log(`       Error: ${r.error}`);
      console.log(`       Respuesta: ${r.response}...`);
    });
    console.log('');
  }

  if (warning > 0) {
    console.log('⚠️  PREGUNTAS CON WARNING:');
    console.log('─────────────────────────────────────────────────────────────────');
    results.filter(r => r.status === 'WARNING').forEach(r => {
      console.log(`\n   [${r.id}] ${r.question}`);
      console.log(`       Warning: ${r.error}`);
    });
    console.log('');
  }

  // Guardar reporte JSON
  const fs = require('fs');
  const reportPath = '/tmp/assistant-e2e-report.json';
  fs.writeFileSync(reportPath, JSON.stringify({
    fecha: new Date().toISOString(),
    tenant: 'Residencia San Cristóbal',
    resumen: { total, pass, fail, warning, avgLatency },
    detalle: results,
  }, null, 2));
  console.log(`💾 Reporte guardado en: ${reportPath}`);

  await app.close();
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
