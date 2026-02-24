import { PrismaClient, TenantType, Role, SubscriptionStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

interface DemoTenantData {
  tenantName: string;
  ownerEmail: string;
  password: string;
}

const DEMO_TENANTS: DemoTenantData[] = [
  {
    tenantName: 'Condominio Alfa',
    ownerEmail: 'owner.alfa@demo.buildingos.com',
    password: 'Demo12345!',
  },
  {
    tenantName: 'Condominio Beta',
    ownerEmail: 'owner.beta@demo.buildingos.com',
    password: 'Demo12345!',
  },
  {
    tenantName: 'Condominio Gamma',
    ownerEmail: 'owner.gamma@demo.buildingos.com',
    password: 'Demo12345!',
  },
  {
    tenantName: 'Condominio Delta',
    ownerEmail: 'owner.delta@demo.buildingos.com',
    password: 'Demo12345!',
  },
  {
    tenantName: 'Condominio Epsilon',
    ownerEmail: 'owner.epsilon@demo.buildingos.com',
    password: 'Demo12345!',
  },
];

async function main() {
  console.log('🚀 Creating demo tenants...\n');

  const results: Array<{
    tenantName: string;
    tenantId: string;
    ownerEmail: string;
    password: string;
    plan: string;
    status: string;
  }> = [];

  try {
    // Find or create BASIC plan
    let basicPlan = await prisma.billingPlan.findUnique({
      where: { planId: 'BASIC' },
    });

    if (!basicPlan) {
      console.log('⚠️  BASIC plan not found, using FREE as fallback...');
      basicPlan = await prisma.billingPlan.findUnique({
        where: { planId: 'FREE' },
      });
    }

    if (!basicPlan) {
      throw new Error(
        'No billing plan found (neither BASIC nor FREE). Please seed billing plans first.',
      );
    }

    const planName = basicPlan.planId;
    console.log(`✓ Using plan: ${planName}\n`);

    // Create each demo tenant
    for (const demoData of DEMO_TENANTS) {
      try {
        console.log(`→ Processing: ${demoData.tenantName}...`);

        // 1. Upsert Tenant
        const tenant = await prisma.tenant.upsert({
          where: { name: demoData.tenantName },
          update: {}, // No update if exists
          create: {
            name: demoData.tenantName,
            type: TenantType.EDIFICIO_AUTOGESTION,
          },
        });

        console.log(`  ├─ Tenant: ${tenant.id}`);

        // 2. Hash password
        const hashedPassword = await bcrypt.hash(demoData.password, 10);

        // 3. Upsert User
        const user = await prisma.user.upsert({
          where: { email: demoData.ownerEmail },
          update: {}, // No update if exists
          create: {
            email: demoData.ownerEmail,
            name: demoData.tenantName.replace('Condominio ', 'Owner '),
            passwordHash: hashedPassword,
          },
        });

        console.log(`  ├─ User: ${user.email}`);

        // 4. Upsert Membership
        const membership = await prisma.membership.upsert({
          where: {
            userId_tenantId: {
              userId: user.id,
              tenantId: tenant.id,
            },
          },
          update: {}, // No update if exists
          create: {
            userId: user.id,
            tenantId: tenant.id,
          },
        });

        console.log(`  ├─ Membership: ${membership.id}`);

        // 5. Ensure TENANT_OWNER role exists
        const roleExists = await prisma.membershipRole.findFirst({
          where: {
            membershipId: membership.id,
            role: Role.TENANT_OWNER,
          },
        });

        if (!roleExists) {
          await prisma.membershipRole.create({
            data: {
              membershipId: membership.id,
              role: Role.TENANT_OWNER,
            },
          });
          console.log(`  ├─ Role: TENANT_OWNER assigned`);
        } else {
          console.log(`  ├─ Role: TENANT_OWNER already exists`);
        }

        // 6. Upsert Subscription (with trial)
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 14);

        const subscription = await prisma.subscription.upsert({
          where: { tenantId: tenant.id },
          update: {}, // No update if exists
          create: {
            tenantId: tenant.id,
            planId: basicPlan.id,
            status: SubscriptionStatus.TRIAL,
            currentPeriodStart: new Date(),
            trialEndDate,
          },
        });

        console.log(`  ├─ Subscription: TRIAL (expires ${trialEndDate.toLocaleDateString('es-AR')})`);
        console.log(`  └─ Plan: ${planName}\n`);

        results.push({
          tenantName: tenant.name,
          tenantId: tenant.id,
          ownerEmail: user.email,
          password: demoData.password,
          plan: planName,
          status: subscription.status,
        });
      } catch (error: any) {
        console.error(`  ❌ Error creating ${demoData.tenantName}:`, error.message);
        throw error;
      }
    }

    // Print summary table
    console.log('\n' + '='.repeat(120));
    console.log('📊 DEMO TENANTS CREATED\n');

    console.log(
      [
        'Tenant Name'.padEnd(25),
        'Tenant ID'.padEnd(12),
        'Owner Email'.padEnd(35),
        'Password'.padEnd(15),
        'Plan'.padEnd(10),
        'Status'.padEnd(10),
      ].join(' | '),
    );

    console.log('-'.repeat(120));

    results.forEach((result) => {
      console.log(
        [
          result.tenantName.padEnd(25),
          result.tenantId.substring(0, 10).padEnd(12),
          result.ownerEmail.padEnd(35),
          result.password.padEnd(15),
          result.plan.padEnd(10),
          result.status.padEnd(10),
        ].join(' | '),
      );
    });

    console.log('='.repeat(120) + '\n');
    console.log('✅ All demo tenants created successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Log in to each tenant with the owner email and temporary password');
    console.log('2. Create buildings and units manually via the UI');
    console.log('3. View all tenants at /super-admin/tenants\n');
  } catch (error) {
    console.error('❌ Error creating demo tenants:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
