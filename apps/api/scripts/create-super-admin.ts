import { PrismaClient, Role, ScopeType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';
import * as fs from 'fs';

const EMAIL = 'yoryiabreu@gmail.com';
const USER_NAME = 'Yoryi Abreu';
const TENANT_NAME = 'BuildingOS Platform';
const TENANT_TYPE = 'ADMINISTRADORA' as const;

function abort(message: string): never {
  console.error(`\n❌ ${message}`);
  process.exit(1);
}

function promptPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    process.stdout.write('🔑 Ingresá el password para el SUPER_ADMIN (mín. 8 caracteres): ');

    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    let password = '';

    stdin.on('data', (chunk: Buffer) => {
      const char = chunk.toString();

      if (char === '\n' || char === '\r') {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        rl.close();
        process.stdout.write('\n');
        resolve(password);
        return;
      }

      if (char === '\x03') {
        if (stdin.isTTY) {
          stdin.setRawMode(wasRaw ?? false);
        }
        rl.close();
        reject(new Error('Cancelled by user'));
        return;
      }

      if (char === '\x7f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      password += char;
      process.stdout.write('*');
    });
  });
}

async function main() {
  // ── 1. Validate DATABASE_URL ────────────────────────────────────────
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    abort(
      'DATABASE_URL no está definida.\n' +
      '  Ejecutá: DATABASE_URL="postgresql://user:pass@host:port/db" npx ts-node scripts/create-super-admin.ts',
    );
  }

  if (!databaseUrl.startsWith('postgresql://')) {
    abort('DATABASE_URL debe empezar con postgresql://');
  }

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && (databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1'))) {
    abort('En producción DATABASE_URL no puede usar localhost/127.0.0.1');
  }

  // ── 2. Connect to Prisma ────────────────────────────────────────────
  console.log('Conectando a la base de datos...');
  const prisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await prisma.$connect();
  } catch (e) {
    abort(`No se pudo conectar a la base de datos: ${(e as Error).message}`);
  }

  // ── 3. Prompt password ──────────────────────────────────────────────
  let password: string;
  try {
    password = await promptPassword();
  } catch {
    console.log('\nOperación cancelada.');
    await prisma.$disconnect();
    process.exit(0);
  }

  if (password.length < 8) {
    abort('El password debe tener al menos 8 caracteres.');
  }

  // ── 4. Hash password ────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash(password, 10);

  // ── 5. Upsert Tenant ───────────────────────────────────────────────
  console.log('Creando/actualizando tenant "BuildingOS Platform"...');
  const tenant = await prisma.tenant.upsert({
    where: { name: TENANT_NAME },
    update: {},
    create: {
      name: TENANT_NAME,
      type: TENANT_TYPE,
      isDemo: false,
      currency: 'ARS',
      locale: 'es-AR',
    },
  });

  // ── 6. Upsert User ─────────────────────────────────────────────────
  console.log(`Creando/actualizando usuario ${EMAIL}...`);
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, name: USER_NAME },
    create: {
      email: EMAIL,
      name: USER_NAME,
      passwordHash,
    },
  });

  // ── 7. Upsert Membership ───────────────────────────────────────────
  const membership = await prisma.membership.upsert({
    where: {
      userId_tenantId: { userId: user.id, tenantId: tenant.id },
    },
    update: {},
    create: { userId: user.id, tenantId: tenant.id },
  });

  // ── 8. Upsert MembershipRole ───────────────────────────────────────
  console.log('Asignando rol SUPER_ADMIN...');
  const existingRole = await prisma.membershipRole.findFirst({
    where: {
      membershipId: membership.id,
      role: Role.SUPER_ADMIN,
    },
  });

  if (!existingRole) {
    await prisma.membershipRole.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        role: Role.SUPER_ADMIN,
        scopeType: ScopeType.TENANT,
      },
    });
  }

  // ── 9. Output ──────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('✅ SUPER_ADMIN creado/actualizado exitosamente');
  console.log('══════════════════════════════════════════════');
  console.log(`   Email:     ${EMAIL}`);
  console.log(`   Tenant:    ${TENANT_NAME} (${TENANT_TYPE})`);
  console.log(`   Rol:       SUPER_ADMIN`);
  console.log(`   User ID:   ${user.id}`);
  console.log(`   Tenant ID: ${tenant.id}`);
  console.log('══════════════════════════════════════════════');

  // ── 10. Generate report ─────────────────────────────────────────────
  const reportPath = '/tmp/buildingos-super-admin-create-report.md';
  const report = [
    '# BuildingOS — Super Admin Creation Report',
    '',
    `- **Date:** ${new Date().toISOString().split('T')[0]}`,
    `- **Email:** ${EMAIL}`,
    `- **Tenant:** ${TENANT_NAME} (${TENANT_TYPE})`,
    `- **Role:** SUPER_ADMIN`,
    `- **User ID:** ${user.id}`,
    `- **Tenant ID:** ${tenant.id}`,
    `- **Status:** Success`,
    '',
    '## Notes',
    '- Password was set via interactive prompt (not stored in any file)',
    '- Script: apps/api/scripts/create-super-admin.ts',
    '- Idempotent: re-running updates password if user already exists',
  ].join('\n');

  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`\n📄 Reporte guardado en: ${reportPath}`);
}

main()
  .catch((e) => {
    console.error(`\n❌ Error inesperado: ${(e as Error).message}`);
    process.exit(1);
  })
  .finally(async () => {
    const prisma = new PrismaClient();
    await prisma.$disconnect();
  });
