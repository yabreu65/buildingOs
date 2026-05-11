import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

/**
 * E2E Test Suite: Asistente AI en Residencia San Cristóbal
 *
 * Este test ejecuta 55+ preguntas reales contra la API
 * utilizando datos del seed de San Cristóbal.
 *
 * Objetivo: Verificar cobertura real del asistente y
 * detectar preguntas que no matchean correctamente.
 */

describe('🤖 Assistant E2E - Residencia San Cristóbal', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let adminToken: string;
  let tenantId: string;
  let buildingAId: string;
  let buildingBId: string;

  // Reporte acumulado
  const report: Array<{
    category: string;
    id: string;
    question: string;
    status: 'PASS' | 'FAIL' | 'WARNING';
    response?: string;
    latencyMs: number;
    error?: string;
  }> = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Obtener tenant
    const tenant = await prisma.tenant.findFirst({
      where: { name: 'Residencia San Cristóbal' },
    });
    if (!tenant) throw new Error('Tenant Residencia San Cristóbal no encontrado');
    tenantId = tenant.id;

    // Obtener edificios
    const buildings = await prisma.building.findMany({
      where: { tenantId },
    });
    const torreA = buildings.find(b => b.name === 'Torre A');
    const torreB = buildings.find(b => b.name === 'Torre B');
    if (!torreA || !torreB) throw new Error('Edificios no encontrados');
    buildingAId = torreA.id;
    buildingBId = torreB.id;

    // Obtener admin y generar token
    const admin = await prisma.user.findUnique({
      where: { email: 'admin@sancristobal.test' },
      include: { memberships: { include: { roles: true } } },
    });
    if (!admin) throw new Error('Admin no encontrado');

    adminToken = jwtService.sign({
      email: admin.email,
      sub: admin.id,
      isSuperAdmin: false,
    });

    console.log(`\n🏢 Tenant: ${tenantId}`);
    console.log(`🏠 Torre A: ${buildingAId}`);
    console.log(`🏠 Torre B: ${buildingBId}`);
    console.log(`👤 Admin: ${admin.email}`);
    console.log('');
  }, 30000);

  /**
   * Helper: ejecuta una pregunta y registra el resultado
   */
  async function ask(
    category: string,
    id: string,
    question: string,
    expectedKeywords: string[] = [],
  ): Promise<void> {
    const start = Date.now();
    const res = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/assistant/chat`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-Id', tenantId)
      .send({ message: question, page: 'dashboard' })
      .timeout(10000);

    const latencyMs = Date.now() - start;

    let status: 'PASS' | 'FAIL' | 'WARNING' = 'PASS';
    let error: string | undefined;

    if (res.status !== 200) {
      status = 'FAIL';
      error = `HTTP ${res.status}: ${res.body?.message || 'Unknown error'}`;
    } else if (res.body.answer?.includes('Entendí tu consulta')) {
      // Fallback del MockAiProvider = no matcheó ningún strict resolver
      status = 'FAIL';
      error = 'Fallback: no matcheó ningún strict resolver';
    } else if (expectedKeywords.length > 0) {
      const missing = expectedKeywords.filter(k =>
        !res.body.answer?.toLowerCase().includes(k.toLowerCase())
      );
      if (missing.length > 0) {
        status = 'WARNING';
        error = `Faltan keywords esperados: ${missing.join(', ')}`;
      }
    }

    report.push({
      category,
      id,
      question,
      status,
      response: res.body?.answer?.substring(0, 200),
      latencyMs,
      error,
    });

    // Expect básico para que Jest cuente el test
    expect(res.status).toBe(200);
  }

  // ============================================================
  // A. RESIDENTES / OCUPANTES (Unit-Level)
  // ============================================================
  describe('A. Residentes/Ocupantes (Unit-Level)', () => {
    it('A1: Quien vive en el departamento 0101 de la Torre A', async () => {
      await ask('Residentes', 'A1', 'Quien vive en el departamento 0101 de la Torre A', ['residente', 'principal']);
    });

    it('A2: Residente del apartamento 0102 de la Torre A', async () => {
      await ask('Residentes', 'A2', 'Residente del apartamento 0102 de la Torre A', ['residente']);
    });

    it('A3: Inquilino del depto 0103 de la Torre B', async () => {
      await ask('Residentes', 'A3', 'Inquilino del depto 0103 de la Torre B', ['residente', 'principal']);
    });

    it('A4: Propietario del departamento 0104 de la Torre A', async () => {
      await ask('Residentes', 'A4', 'Propietario del departamento 0104 de la Torre A', ['propietario']);
    });

    it('A5: Quien habita en la unidad 0105 de la Torre B', async () => {
      await ask('Residentes', 'A5', 'Quien habita en la unidad 0105 de la Torre B', ['residente']);
    });

    it('A6: Ocupante del apartamento 0106 (sin torre)', async () => {
      await ask('Residentes', 'A6', 'Ocupante del apartamento 0106', ['necesito', 'edificio']);
    });

    it('A7: Residente del departamento 9999 de la Torre A (inexistente)', async () => {
      await ask('Residentes', 'A7', 'Residente del departamento 9999 de la Torre A', ['no encontré', 'unidad']);
    });
  });

  // ============================================================
  // B. DEUDA (Unit-Level)
  // ============================================================
  describe('B. Deuda (Unit-Level)', () => {
    it('B1: Cuanto debe el departamento 0101 de la Torre A', async () => {
      await ask('Deuda-Unit', 'B1', 'Cuanto debe el departamento 0101 de la Torre A', ['deuda', 'USD']);
    });

    it('B2: Deuda del apartamento 0102 de la Torre B', async () => {
      await ask('Deuda-Unit', 'B2', 'Deuda del apartamento 0102 de la Torre B', ['deuda']);
    });

    it('B3: Que saldo tiene el depto 0103 de la Torre A', async () => {
      await ask('Deuda-Unit', 'B3', 'Que saldo tiene el depto 0103 de la Torre A', ['saldo']);
    });

    it('B4: Cuanto adeuda la unidad 0104 de la Torre B', async () => {
      await ask('Deuda-Unit', 'B4', 'Cuanto adeuda la unidad 0104 de la Torre B', ['adeuda']);
    });

    it('B5: Monto de deuda del departamento 0105 de la Torre A', async () => {
      await ask('Deuda-Unit', 'B5', 'Monto de deuda del departamento 0105 de la Torre A', ['monto']);
    });

    it('B6: Importe pendiente del apartamento 0106 de la Torre A', async () => {
      await ask('Deuda-Unit', 'B6', 'Importe pendiente del apartamento 0106 de la Torre A', ['importe']);
    });

    it('B7: La unidad 0107 de la Torre B esta al dia', async () => {
      await ask('Deuda-Unit', 'B7', 'La unidad 0107 de la Torre B esta al dia', ['deuda', 'saldo']);
    });

    it('B8: Deuda del departamento 0201 de la Torre A', async () => {
      await ask('Deuda-Unit', 'B8', 'Deuda del departamento 0201 de la Torre A', ['deuda']);
    });
  });

  // ============================================================
  // C. DOCUMENTOS (Unit-Level)
  // ============================================================
  describe('C. Documentos (Unit-Level)', () => {
    it('C1: Documentos del departamento 0101 de la Torre A', async () => {
      await ask('Documentos-Unit', 'C1', 'Documentos del departamento 0101 de la Torre A');
    });

    it('C2: Archivos del apartamento 0102 de la Torre B', async () => {
      await ask('Documentos-Unit', 'C2', 'Archivos del apartamento 0102 de la Torre B');
    });

    it('C3: PDFs de la unidad 0103 de la Torre A', async () => {
      await ask('Documentos-Unit', 'C3', 'PDFs de la unidad 0103 de la Torre A');
    });

    it('C4: Comprobantes del depto 0104 de la Torre B', async () => {
      await ask('Documentos-Unit', 'C4', 'Comprobantes del depto 0104 de la Torre B');
    });
  });

  // ============================================================
  // D. TICKETS (Unit-Level)
  // ============================================================
  describe('D. Tickets (Unit-Level)', () => {
    it('D1: Tickets del departamento 0101 de la Torre A', async () => {
      await ask('Tickets-Unit', 'D1', 'Tickets del departamento 0101 de la Torre A', ['ticket']);
    });

    it('D2: Reclamos del apartamento 0102 de la Torre B', async () => {
      await ask('Tickets-Unit', 'D2', 'Reclamos del apartamento 0102 de la Torre B', ['reclamo']);
    });

    it('D3: Problemas de la unidad 0103 de la Torre A', async () => {
      await ask('Tickets-Unit', 'D3', 'Problemas de la unidad 0103 de la Torre A', ['problema']);
    });

    it('D4: Averias del depto 0104 de la Torre B', async () => {
      await ask('Tickets-Unit', 'D4', 'Averias del depto 0104 de la Torre B', ['averia']);
    });
  });

  // ============================================================
  // E. PAGOS (Unit-Level)
  // ============================================================
  describe('E. Pagos (Unit-Level)', () => {
    it('E1: Ultimos pagos del departamento 0101 de la Torre A', async () => {
      await ask('Pagos-Unit', 'E1', 'Ultimos pagos del departamento 0101 de la Torre A', ['pago']);
    });

    it('E2: Historial de pagos del apartamento 0102 de la Torre B', async () => {
      await ask('Pagos-Unit', 'E2', 'Historial de pagos del apartamento 0102 de la Torre B', ['historial']);
    });

    it('E3: Transferencias de la unidad 0103 de la Torre A', async () => {
      await ask('Pagos-Unit', 'E3', 'Transferencias de la unidad 0103 de la Torre A', ['transferencia']);
    });

    it('E4: Recibos del depto 0104 de la Torre B', async () => {
      await ask('Pagos-Unit', 'E4', 'Recibos del depto 0104 de la Torre B', ['recibo']);
    });

    it('E5: Movimientos del departamento 0105 de la Torre A', async () => {
      await ask('Pagos-Unit', 'E5', 'Movimientos del departamento 0105 de la Torre A', ['movimiento']);
    });
  });

  // ============================================================
  // F. DEUDA TOTAL (Building-Level)
  // ============================================================
  describe('F. Deuda Total (Building-Level)', () => {
    it('F1: Cuanto debe la Torre A', async () => {
      await ask('Deuda-Building', 'F1', 'Cuanto debe la Torre A', ['deuda', 'Torre A']);
    });

    it('F2: Deuda de la Torre B', async () => {
      await ask('Deuda-Building', 'F2', 'Deuda de la Torre B', ['deuda', 'Torre B']);
    });

    it('F3: Que saldo tiene el edificio A', async () => {
      await ask('Deuda-Building', 'F3', 'Que saldo tiene el edificio A', ['saldo']);
    });

    it('F4: Monto adeudado del complejo', async () => {
      await ask('Deuda-Building', 'F4', 'Monto adeudado del complejo', ['monto']);
    });

    it('F5: Importe pendiente de la torre', async () => {
      await ask('Deuda-Building', 'F5', 'Importe pendiente de la torre', ['importe']);
    });
  });

  // ============================================================
  // G. TICKETS (Building-Level)
  // ============================================================
  describe('G. Tickets (Building-Level)', () => {
    it('G1: Tickets de la Torre A', async () => {
      await ask('Tickets-Building', 'G1', 'Tickets de la Torre A', ['ticket', 'Torre A']);
    });

    it('G2: Reclamos de la Torre B', async () => {
      await ask('Tickets-Building', 'G2', 'Reclamos de la Torre B', ['reclamo']);
    });

    it('G3: Problemas del edificio A', async () => {
      await ask('Tickets-Building', 'G3', 'Problemas del edificio A', ['problema']);
    });

    it('G4: Fallas de la Torre A', async () => {
      await ask('Tickets-Building', 'G4', 'Fallas de la Torre A', ['falla']);
    });
  });

  // ============================================================
  // H. MOROSOS (Building-Level)
  // ============================================================
  describe('H. Morosos (Building-Level)', () => {
    it('H1: Quienes son los morosos de la Torre A', async () => {
      await ask('Morosos', 'H1', 'Quienes son los morosos de la Torre A', ['moroso', 'deuda']);
    });

    it('H2: Top deudores de la Torre B', async () => {
      await ask('Morosos', 'H2', 'Top deudores de la Torre B', ['top', 'deudores']);
    });

    it('H3: Ranking de deuda del edificio A', async () => {
      await ask('Morosos', 'H3', 'Ranking de deuda del edificio A', ['ranking']);
    });

    it('H4: Atrasados de la Torre A', async () => {
      await ask('Morosos', 'H4', 'Atrasados de la Torre A', ['atrasados']);
    });

    it('H5: Impagos de la Torre B', async () => {
      await ask('Morosos', 'H5', 'Impagos de la Torre B', ['impagos']);
    });

    it('H6: Deudores del complejo', async () => {
      await ask('Morosos', 'H6', 'Deudores del complejo', ['deudores']);
    });
  });

  // ============================================================
  // I. ESTADISTICAS (Building-Level)
  // ============================================================
  describe('I. Estadísticas (Building-Level)', () => {
    it('I1: Estadisticas de la Torre A', async () => {
      await ask('Estadisticas', 'I1', 'Estadisticas de la Torre A', ['estadisticas', 'unidades']);
    });

    it('I2: Cuantas unidades tiene la Torre B', async () => {
      await ask('Estadisticas', 'I2', 'Cuantas unidades tiene la Torre B', ['unidades']);
    });

    it('I3: Resumen del edificio A', async () => {
      await ask('Estadisticas', 'I3', 'Resumen del edificio A', ['resumen']);
    });

    it('I4: Como viene la Torre A', async () => {
      await ask('Estadisticas', 'I4', 'Como viene la Torre A', ['estadisticas']);
    });

    it('I5: Cuentas del edificio B', async () => {
      await ask('Estadisticas', 'I5', 'Cuentas del edificio B', ['cuentas']);
    });
  });

  // ============================================================
  // J. DOCUMENTOS (Building-Level)
  // ============================================================
  describe('J. Documentos (Building-Level)', () => {
    it('J1: Documentos de la Torre A', async () => {
      await ask('Documentos-Building', 'J1', 'Documentos de la Torre A', ['documentos']);
    });

    it('J2: Archivos de la Torre B', async () => {
      await ask('Documentos-Building', 'J2', 'Archivos de la Torre B', ['archivos']);
    });

    it('J3: Actas del edificio A', async () => {
      await ask('Documentos-Building', 'J3', 'Actas del edificio A', ['actas']);
    });
  });

  // ============================================================
  // K. PAGOS (Building-Level)
  // ============================================================
  describe('K. Pagos (Building-Level)', () => {
    it('K1: Pagos de la Torre A', async () => {
      await ask('Pagos-Building', 'K1', 'Pagos de la Torre A', ['pagos']);
    });

    it('K2: Transferencias de la Torre B', async () => {
      await ask('Pagos-Building', 'K2', 'Transferencias de la Torre B', ['transferencias']);
    });

    it('K3: Recibos del edificio A', async () => {
      await ask('Pagos-Building', 'K3', 'Recibos del edificio A', ['recibos']);
    });

    it('K4: Cobranzas de la Torre A', async () => {
      await ask('Pagos-Building', 'K4', 'Cobranzas de la Torre A', ['cobranzas']);
    });
  });

  // ============================================================
  // L. FRONTERA Y SEGURIDAD
  // ============================================================
  describe('L. Frontera y Seguridad', () => {
    it('L1: Deuda del departamento 0101 sin torre', async () => {
      await ask('Frontera', 'L1', 'Deuda del departamento 0101', ['necesito', 'edificio']);
    });

    it('L2: Deuda de la Torre Z inexistente', async () => {
      await ask('Frontera', 'L2', 'Deuda de la Torre Z', ['no encontré']);
    });

    it('L3: Tickets del departamento 9999 de la Torre A', async () => {
      await ask('Frontera', 'L3', 'Tickets del departamento 9999 de la Torre A', ['no encontré']);
    });

    it('L5: Hola como estas (fallback)', async () => {
      await ask('Frontera', 'L5', 'Hola, como estas?', ['consulta']);
    });
  });

  // ============================================================
  // REPORTE FINAL
  // ============================================================
  afterAll(async () => {
    // Generar reporte
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           REPORTE: ASISTENTE SAN CRISTÓBAL E2E               ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    const pass = report.filter(r => r.status === 'PASS').length;
    const fail = report.filter(r => r.status === 'FAIL').length;
    const warning = report.filter(r => r.status === 'WARNING').length;
    const total = report.length;
    const avgLatency = Math.round(report.reduce((a, r) => a + r.latencyMs, 0) / total);

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
      report.filter(r => r.status === 'FAIL').forEach(r => {
        console.log(`   [${r.id}] ${r.question}`);
        console.log(`       Error: ${r.error}`);
        console.log(`       Respuesta: ${r.response?.substring(0, 120)}...`);
        console.log('');
      });
    }

    if (warning > 0) {
      console.log('⚠️  PREGUNTAS CON WARNING:');
      console.log('─────────────────────────────────────────────────────────────────');
      report.filter(r => r.status === 'WARNING').forEach(r => {
        console.log(`   [${r.id}] ${r.question}`);
        console.log(`       Warning: ${r.error}`);
        console.log('');
      });
    }

    console.log('✅ PREGUNTAS QUE PASARON:');
    console.log('─────────────────────────────────────────────────────────────────');
    report.filter(r => r.status === 'PASS').forEach(r => {
      console.log(`   [${r.id}] ${r.question} (${r.latencyMs}ms)`);
    });

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════');

    await app.close();
  });
});
