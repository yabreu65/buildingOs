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
}

interface QuestionResult extends QuestionCase {
  readonly response: string;
  readonly resolved: boolean;
  readonly httpStatus: number;
}

const FALLBACK_TEXT = 'Entendí tu consulta';

function quoteBlock(value: string): string {
  return value
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

async function extractQuestions(specPath: string): Promise<QuestionCase[]> {
  const source = await fs.readFile(specPath, 'utf8');
  const regex = /await ask\('([^']+)',\s*'([^']+)',\s*'([^']+)'/g;
  const results: QuestionCase[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const category = match[1];
    const id = match[2];
    const question = match[3];

    if (!category || !id || !question) {
      continue;
    }

    results.push({ category, id, question });
  }

  return results;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const specPath = path.resolve(__dirname, '../test/assistant-san-cristobal.e2e-spec.ts');
  const outputPath = path.resolve(repoRoot, 'docs/ASSISTANT_SAN_CRISTOBAL_CURRENT_CHAT_RESPONSES.md');
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
      .post(`/tenants/${tenant.id}/assistant/chat`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-Id', tenant.id)
      .send({ message: item.question, page: 'dashboard' })
      .timeout(10000);

    const answer = typeof res.body?.answer === 'string'
      ? res.body.answer.trim()
      : String(res.body?.message || 'Sin respuesta');

    const resolved = res.status === 201 && answer.length > 0 && !answer.includes(FALLBACK_TEXT);

    results.push({
      ...item,
      response: answer,
      resolved,
      httpStatus: res.status,
    });
  }

  const resolvedItems = results.filter((item) => item.resolved);
  const unresolvedItems = results.filter((item) => !item.resolved);
  const categories = Array.from(new Set(results.map((item) => item.category)));

  const lines: string[] = [
    '# Respuestas Actuales del Chat - San Cristobal',
    '',
    'Documento generado automaticamente desde la ruta legacy `/assistant/chat` usando el seed actual de Residencia San Cristobal.',
    'La idea es que puedas evaluar manualmente qué ya responde BuildingOS hoy, con la respuesta textual real del sistema.',
    '',
    `- Generado: ${new Date().toISOString()}`,
    '- Ruta evaluada: `/assistant/chat`',
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

  for (const category of categories) {
    const categoryItems = resolvedItems.filter((item) => item.category === category);
    if (categoryItems.length === 0) {
      continue;
    }

    lines.push(`### ${category}`, '');
    for (const item of categoryItems) {
      lines.push(`#### ${item.id}. ${item.question}`);
      lines.push('');
      lines.push(`- Categoria: \`${item.category}\``);
      lines.push('- Estado tecnico: `RESUELTA`');
      lines.push(`- HTTP: \`${item.httpStatus}\``);
      lines.push('- Respuesta actual de BuildingOS:');
      lines.push('');
      lines.push(quoteBlock(item.response));
      lines.push('');
    }
  }

  lines.push('## Preguntas que hoy no se resuelven', '');

  if (unresolvedItems.length === 0) {
    lines.push('No se detectaron preguntas sin resolver en esta corrida.', '');
  } else {
    for (const item of unresolvedItems) {
      lines.push(`### ${item.id}. ${item.question}`);
      lines.push('');
      lines.push(`- Categoria: \`${item.category}\``);
      lines.push('- Estado tecnico: `NO_RESUELTA`');
      lines.push(`- HTTP: \`${item.httpStatus}\``);
      lines.push('- Respuesta actual de BuildingOS:');
      lines.push('');
      lines.push(quoteBlock(item.response));
      lines.push('');
    }
  }

  lines.push('## Referencias', '', '- `apps/api/test/assistant-san-cristobal.e2e-spec.ts`', '- `docs/ASSISTANT_SAN_CRISTOBAL_QUESTIONS_AND_EXPECTED_RESPONSES.md`');

  await fs.writeFile(outputPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Markdown generado en: ${outputPath}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
