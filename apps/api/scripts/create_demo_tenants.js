"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcrypt"));
const prisma = new client_1.PrismaClient();
const DEMO_TENANTS = [
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
    const results = [];
    try {
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
            throw new Error('No billing plan found (neither BASIC nor FREE). Please seed billing plans first.');
        }
        const planName = basicPlan.planId;
        console.log(`✓ Using plan: ${planName}\n`);
        for (const demoData of DEMO_TENANTS) {
            try {
                console.log(`→ Processing: ${demoData.tenantName}...`);
                const tenant = await prisma.tenant.upsert({
                    where: { name: demoData.tenantName },
                    update: {},
                    create: {
                        name: demoData.tenantName,
                        type: client_1.TenantType.EDIFICIO_AUTOGESTION,
                    },
                });
                console.log(`  ├─ Tenant: ${tenant.id}`);
                const hashedPassword = await bcrypt.hash(demoData.password, 10);
                const user = await prisma.user.upsert({
                    where: { email: demoData.ownerEmail },
                    update: {},
                    create: {
                        email: demoData.ownerEmail,
                        name: demoData.tenantName.replace('Condominio ', 'Owner '),
                        passwordHash: hashedPassword,
                    },
                });
                console.log(`  ├─ User: ${user.email}`);
                const membership = await prisma.membership.upsert({
                    where: {
                        userId_tenantId: {
                            userId: user.id,
                            tenantId: tenant.id,
                        },
                    },
                    update: {},
                    create: {
                        userId: user.id,
                        tenantId: tenant.id,
                    },
                });
                console.log(`  ├─ Membership: ${membership.id}`);
                const roleExists = await prisma.membershipRole.findFirst({
                    where: {
                        membershipId: membership.id,
                        role: client_1.Role.TENANT_OWNER,
                    },
                });
                if (!roleExists) {
                    await prisma.membershipRole.create({
                        data: {
                            membershipId: membership.id,
                            role: client_1.Role.TENANT_OWNER,
                        },
                    });
                    console.log(`  ├─ Role: TENANT_OWNER assigned`);
                }
                else {
                    console.log(`  ├─ Role: TENANT_OWNER already exists`);
                }
                const trialEndDate = new Date();
                trialEndDate.setDate(trialEndDate.getDate() + 14);
                const subscription = await prisma.subscription.upsert({
                    where: { tenantId: tenant.id },
                    update: {},
                    create: {
                        tenantId: tenant.id,
                        planId: basicPlan.id,
                        status: client_1.SubscriptionStatus.TRIAL,
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
            }
            catch (error) {
                console.error(`  ❌ Error creating ${demoData.tenantName}:`, error.message);
                throw error;
            }
        }
        console.log('\n' + '='.repeat(120));
        console.log('📊 DEMO TENANTS CREATED\n');
        console.log([
            'Tenant Name'.padEnd(25),
            'Tenant ID'.padEnd(12),
            'Owner Email'.padEnd(35),
            'Password'.padEnd(15),
            'Plan'.padEnd(10),
            'Status'.padEnd(10),
        ].join(' | '));
        console.log('-'.repeat(120));
        results.forEach((result) => {
            console.log([
                result.tenantName.padEnd(25),
                result.tenantId.substring(0, 10).padEnd(12),
                result.ownerEmail.padEnd(35),
                result.password.padEnd(15),
                result.plan.padEnd(10),
                result.status.padEnd(10),
            ].join(' | '));
        });
        console.log('='.repeat(120) + '\n');
        console.log('✅ All demo tenants created successfully!');
        console.log('\n📝 Next steps:');
        console.log('1. Log in to each tenant with the owner email and temporary password');
        console.log('2. Create buildings and units manually via the UI');
        console.log('3. View all tenants at /super-admin/tenants\n');
    }
    catch (error) {
        console.error('❌ Error creating demo tenants:', error);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=create_demo_tenants.js.map