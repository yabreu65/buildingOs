import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface AssistantV2ReportItem {
  readonly category: string;
  readonly id: string;
  readonly question: string;
  readonly intent: string;
  readonly status: 'PASS' | 'FAIL' | 'WARNING';
  readonly summary?: string;
  readonly latencyMs: number;
  readonly error?: string;
}

interface AssistantV2Case {
  readonly category: string;
  readonly id: string;
  readonly question: string;
  readonly expectedIntent: string;
  readonly validateData: (data: unknown) => string | null;
}

const V2_CASES: readonly AssistantV2Case[] = [
  {
    category: 'Residentes',
    id: 'V2-1',
    question: 'Quien vive en el departamento A-0101',
    expectedIntent: 'unit_residents',
    validateData: (data) => validateArrayData(data, 'residentes'),
  },
  {
    category: 'Deuda-Unit',
    id: 'V2-2',
    question: 'Cuanto debe el departamento A-0101',
    expectedIntent: 'unit_debt',
    validateData: (data) => validateNumericField(data, 'totalDebt'),
  },
  {
    category: 'Documentos-Unit',
    id: 'V2-3',
    question: 'Documentos del departamento A-0101',
    expectedIntent: 'unit_documents',
    validateData: (data) => validateArrayData(data, 'documentos'),
  },
  {
    category: 'Tickets-Unit',
    id: 'V2-4',
    question: 'Tickets del departamento A-0101',
    expectedIntent: 'unit_tickets',
    validateData: (data) => validateArrayData(data, 'tickets'),
  },
  {
    category: 'Pagos-Unit',
    id: 'V2-5',
    question: 'Ultimos pagos del departamento A-0101',
    expectedIntent: 'unit_payments',
    validateData: (data) => validateArrayData(data, 'pagos'),
  },
  {
    category: 'Deuda-Building',
    id: 'V2-6',
    question: 'Cuanto debe la Torre A',
    expectedIntent: 'building_debt',
    validateData: (data) => validateNumericField(data, 'totalDebt'),
  },
  {
    category: 'Morosos',
    id: 'V2-7',
    question: 'Quienes son los morosos de la Torre A',
    expectedIntent: 'building_delinquents',
    validateData: (data) => validateNestedArrayData(data, 'delinquents', 'morosos'),
  },
  {
    category: 'Documentos-Building',
    id: 'V2-8',
    question: 'Documentos de la Torre A',
    expectedIntent: 'building_documents',
    validateData: (data) => validateArrayData(data, 'documentos del edificio'),
  },
  {
    category: 'Tickets-Building',
    id: 'V2-9',
    question: 'Tickets de la Torre A',
    expectedIntent: 'building_tickets',
    validateData: (data) => validateNestedArrayData(data, 'tickets', 'tickets del edificio'),
  },
  {
    category: 'Pagos-Building',
    id: 'V2-10',
    question: 'Pagos de la Torre A',
    expectedIntent: 'building_payments',
    validateData: (data) => validateNestedArrayData(data, 'payments', 'pagos del edificio'),
  },
  {
    category: 'Estadisticas',
    id: 'V2-11',
    question: 'Estadisticas de la Torre A',
    expectedIntent: 'building_stats',
    validateData: (data) => {
      const totalUnitsError = validateNumericField(data, 'totalUnits');
      if (totalUnitsError) {
        return totalUnitsError;
      }
      return validateNumericField(data, 'totalDebt');
    },
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateArrayData(data: unknown, label: string): string | null {
  if (!Array.isArray(data)) {
    return `Se esperaba un arreglo de ${label}`;
  }
  return null;
}

function validateNestedArrayData(data: unknown, key: string, label: string): string | null {
  if (!isRecord(data)) {
    return `Se esperaba un objeto con ${label}`;
  }
  const list = data[key];
  if (!Array.isArray(list)) {
    return `Falta el arreglo ${key} para ${label}`;
  }
  return null;
}

function validateNumericField(data: unknown, key: string): string | null {
  if (!isRecord(data)) {
    return `Se esperaba un objeto con ${key}`;
  }
  const value = data[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return `Falta el campo numérico ${key}`;
  }
  return null;
}

describe('Assistant E2E - Residencia San Cristobal /chat/v2', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let adminToken: string;
  let tenantId: string;
  const report: AssistantV2ReportItem[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    jwtService = moduleFixture.get<JwtService>(JwtService);

    const tenant = await prisma.tenant.findFirst({
      where: { name: 'Residencia San Cristóbal' },
    });
    if (!tenant) throw new Error('Tenant Residencia San Cristóbal no encontrado');
    tenantId = tenant.id;

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
  }, 30000);

  async function resetAiUsage(): Promise<void> {
    await prisma.tenantDailyAiUsage.deleteMany({ where: { tenantId } });
    await prisma.subscription.updateMany({
      where: { tenantId },
      data: {
        aiConsultationsUsed: 0,
        aiConsultationsResetAt: new Date(),
      },
    });
  }

  async function ask(caseDefinition: AssistantV2Case): Promise<void> {
    await resetAiUsage();

    const start = Date.now();
    const res = await request(app.getHttpServer())
      .post(`/tenants/${tenantId}/assistant/chat/v2`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-Id', tenantId)
      .send({
        message: caseDefinition.question,
        page: 'dashboard',
        debug: true,
      })
      .timeout(10000);

    const latencyMs = Date.now() - start;
    let status: 'PASS' | 'FAIL' | 'WARNING' = 'PASS';
    let error: string | undefined;

    if (res.status !== 201) {
      status = 'FAIL';
      error = `HTTP ${res.status}: ${res.body?.message || 'Unknown error'}`;
    } else if (res.body?.type === 'clarification') {
      status = 'FAIL';
      error = 'La ruta oficial devolvió clarificación en vez de datos reales';
    } else if (res.body?.meta?.intent !== caseDefinition.expectedIntent) {
      status = 'FAIL';
      error = `Intent inesperado: ${res.body?.meta?.intent || 'sin intent'}`;
    } else if (res.body?.debug?.zodValidationPassed !== true || res.body?.debug?.rbacChecked !== true) {
      status = 'FAIL';
      error = 'La respuesta no pasó por el pipeline esperado de /chat/v2';
    } else if (res.body?.meta?.tenantScoped !== true) {
      status = 'FAIL';
      error = 'La respuesta no quedó tenant-scoped';
    } else if (typeof res.body?.summary !== 'string' || res.body.summary.trim().length === 0) {
      status = 'FAIL';
      error = 'La respuesta estructurada vino sin summary';
    } else {
      const validationError = caseDefinition.validateData(res.body?.data);
      if (validationError) {
        status = 'FAIL';
        error = validationError;
      }
    }

    report.push({
      category: caseDefinition.category,
      id: caseDefinition.id,
      question: caseDefinition.question,
      intent: caseDefinition.expectedIntent,
      status,
      summary: res.body?.summary,
      latencyMs,
      error,
    });

    expect(status).toBe('PASS');
    expect(res.status).toBe(201);
  }

  describe('Cobertura real de intents implementados', () => {
    for (const caseDefinition of V2_CASES) {
      it(`${caseDefinition.id}: ${caseDefinition.question}`, async () => {
        await ask(caseDefinition);
      });
    }
  });

  afterAll(async () => {
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║           REPORTE: ASISTENTE SAN CRISTOBAL /CHAT/V2          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    const pass = report.filter((item) => item.status === 'PASS').length;
    const fail = report.filter((item) => item.status === 'FAIL').length;
    const warning = report.filter((item) => item.status === 'WARNING').length;
    const total = report.length;
    const avgLatency = Math.round(report.reduce((acc, item) => acc + item.latencyMs, 0) / total);

    console.log(`📊 Resumen:`);
    console.log(`   Total intents reales testeados: ${total}`);
    console.log(`   ✅ PASS:        ${pass} (${Math.round((pass / total) * 100)}%)`);
    console.log(`   ❌ FAIL:        ${fail} (${Math.round((fail / total) * 100)}%)`);
    console.log(`   ⚠️  WARNING:     ${warning} (${Math.round((warning / total) * 100)}%)`);
    console.log(`   ⏱️  Latencia promedio: ${avgLatency}ms`);
    console.log('');

    if (fail > 0) {
      console.log('❌ INTENTS QUE FALLARON:');
      console.log('─────────────────────────────────────────────────────────────────');
      report.filter((item) => item.status === 'FAIL').forEach((item) => {
        console.log(`   [${item.id}] ${item.intent} -> ${item.question}`);
        console.log(`       Error: ${item.error}`);
        console.log(`       Summary: ${item.summary || 'sin summary'}`);
        console.log('');
      });
    }

    await app.close();
  });
});
