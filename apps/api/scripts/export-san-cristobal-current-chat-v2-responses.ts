import { promises as fs } from 'fs';
import path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface QuestionCase {
  readonly category: string;
  readonly id: string;
  readonly question: string;
  readonly expectedIntent: string;
}

interface QuestionResult extends QuestionCase {
  readonly httpStatus: number;
  readonly resolved: boolean;
  readonly responseType: string;
  readonly actualIntent: string;
  readonly summary: string;
  readonly data: unknown;
  readonly actions: unknown;
  readonly error?: string;
}

function quoteBlock(value: string): string {
  return value
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function jsonBlock(value: unknown): string {
  return ['```json', JSON.stringify(value ?? null, null, 2), '```'].join('\n');
}

async function extractQuestions(specPath: string): Promise<QuestionCase[]> {
  const source = await fs.readFile(specPath, 'utf8');
  const blockRegex = /\{\s*category:\s*'([^']+)',\s*id:\s*'([^']+)',\s*question:\s*'([^']+)',\s*expectedIntent:\s*'([^']+)'/g;
  const results: QuestionCase[] = [];

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(source)) !== null) {
    const category = match[1];
    const id = match[2];
    const question = match[3];
    const expectedIntent = match[4];

    if (!category || !id || !question || !expectedIntent) {
      continue;
    }

    results.push({ category, id, question, expectedIntent });
  }

  return results;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const specPath = path.resolve(__dirname, '../test/assistant-san-cristobal-v2.e2e-spec.ts');
  const outputPath = path.resolve(repoRoot, 'docs/ASSISTANT_SAN_CRISTOBAL_CURRENT_CHAT_V2_RESPONSES.md');
  const questions = await extractQuestions(specPath);

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe());
  await app.init();

  const prisma = moduleFixture.get<PrismaService>(PrismaService);
  const jwtService = moduleFixture.get<JwtService>(JwtService);

  const tenant = await prisma.tenant.findFirst({
    where: { name: 'Residencia San Cristóbal' },
  });
  if (!tenant) {
    throw new Error('Tenant Residencia San Cristóbal no encontrado');
  }

  const admin = await prisma.user.findUnique({
    where: { email: 'admin@sancristobal.test' },
    include: { memberships: { include: { roles: true } } },
  });
  if (!admin) {
    throw new Error('Admin no encontrado');
  }

  const adminToken = jwtService.sign({
    email: admin.email,
    sub: admin.id,
    isSuperAdmin: false,
  });

  const results: QuestionResult[] = [];

  for (const item of questions) {
    await prisma.tenantDailyAiUsage.deleteMany({ where: { tenantId: tenant.id } });
    await prisma.subscription.updateMany({
      where: { tenantId: tenant.id },
      data: {
        aiConsultationsUsed: 0,
        aiConsultationsResetAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/tenants/${tenant.id}/assistant/chat/v2`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-Id', tenant.id)
      .send({
        message: item.question,
        page: 'dashboard',
        debug: true,
      })
      .timeout(10000);

    const summary = typeof res.body?.summary === 'string'
      ? res.body.summary.trim()
      : String(res.body?.message || 'Sin summary');

    const actualIntent = typeof res.body?.meta?.intent === 'string'
      ? res.body.meta.intent
      : 'sin-intent';

    const responseType = typeof res.body?.type === 'string'
      ? res.body.type
      : 'sin-type';

    const resolved = res.status === 201 && responseType !== 'clarification';

    results.push({
      ...item,
      httpStatus: res.status,
      resolved,
      responseType,
      actualIntent,
      summary,
      data: res.body?.data,
      actions: res.body?.actions,
      error: res.status === 201 ? undefined : String(res.body?.message || 'Unknown error'),
    });
  }

  const resolvedItems = results.filter((item) => item.resolved);
  const unresolvedItems = results.filter((item) => !item.resolved);
  const categories = Array.from(new Set(results.map((item) => item.category)));

  const lines: string[] = [
    '# Respuestas Actuales del Chat V2 - San Cristobal',
    '',
    'Documento generado automaticamente desde la ruta oficial `/assistant/chat/v2` usando el seed actual de Residencia San Cristobal.',
    'La idea es que puedas evaluar manualmente la respuesta estructurada real que hoy devuelve BuildingOS.',
    '',
    `- Generado: ${new Date().toISOString()}`,
    '- Ruta evaluada: `/assistant/chat/v2`',
    `- Total de preguntas ejecutadas: ${results.length}`,
    `- Resueltas actualmente: ${resolvedItems.length}`,
    `- No resueltas actualmente: ${unresolvedItems.length}`,
    '',
    '## Resumen por categoria',
    '',
    '| Categoria | Total | Resueltas | No resueltas |',
    '|---|---:|---:|---:|',
  ];

  for (const category of categories) {
    const categoryItems = results.filter((item) => item.category === category);
    const categoryResolved = categoryItems.filter((item) => item.resolved).length;
    lines.push(`| ${category} | ${categoryItems.length} | ${categoryResolved} | ${categoryItems.length - categoryResolved} |`);
  }

  lines.push('', '## Preguntas resueltas actualmente', '');

  for (const item of resolvedItems) {
    lines.push(`### ${item.id}. ${item.question}`);
    lines.push('');
    lines.push(`- Categoria: \`${item.category}\``);
    lines.push(`- Estado tecnico: \`RESUELTA\``);
    lines.push(`- HTTP: \`${item.httpStatus}\``);
    lines.push(`- Type actual: \`${item.responseType}\``);
    lines.push(`- Intent esperado: \`${item.expectedIntent}\``);
    lines.push(`- Intent actual: \`${item.actualIntent}\``);
    lines.push('- Summary actual de BuildingOS:');
    lines.push('');
    lines.push(quoteBlock(item.summary));
    lines.push('');
    lines.push('- Data actual de BuildingOS:');
    lines.push('');
    lines.push(jsonBlock(item.data));
    lines.push('');
    lines.push('- Actions actuales:');
    lines.push('');
    lines.push(jsonBlock(item.actions));
    lines.push('');
  }

  lines.push('## Preguntas que hoy no se resuelven', '');

  if (unresolvedItems.length === 0) {
    lines.push('No se detectaron preguntas sin resolver en esta corrida.', '');
  } else {
    for (const item of unresolvedItems) {
      lines.push(`### ${item.id}. ${item.question}`);
      lines.push('');
      lines.push(`- Categoria: \`${item.category}\``);
      lines.push(`- Estado tecnico: \`NO_RESUELTA\``);
      lines.push(`- HTTP: \`${item.httpStatus}\``);
      lines.push(`- Type actual: \`${item.responseType}\``);
      lines.push(`- Intent esperado: \`${item.expectedIntent}\``);
      lines.push(`- Intent actual: \`${item.actualIntent}\``);
      lines.push(`- Error: ${item.error || 'Sin detalle adicional'}`);
      lines.push('- Summary actual de BuildingOS:');
      lines.push('');
      lines.push(quoteBlock(item.summary));
      lines.push('');
      lines.push('- Data actual de BuildingOS:');
      lines.push('');
      lines.push(jsonBlock(item.data));
      lines.push('');
    }
  }

  lines.push(
    '## Referencias',
    '',
    '- `apps/api/test/assistant-san-cristobal-v2.e2e-spec.ts`',
    '- `docs/ASSISTANT_SAN_CRISTOBAL_QUESTIONS_AND_EXPECTED_RESPONSES.md`',
  );

  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Markdown generado en: ${outputPath}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
