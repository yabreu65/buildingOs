/**
 * PILOT SEED SCRIPT
 *
 * Creates a complete pilot tenant in 30 seconds:
 * - 1 Tenant (customer)
 * - 1 Owner/Admin User
 * - 1 Building
 * - 10 Units (apartments)
 * - 1 Resident (assigned to Unit 1)
 *
 * Usage:
 *   npm run seed:pilot
 *   npm run seed:pilot -- --name "My Customer"
 *   NODE_ENV=staging npm run seed:pilot
 *
 * Output: Credentials printed to console (safe for staging/local only)
 */

import { PrismaClient, Role, TenantType, BillingPlanId, UnitOccupantRole, SubscriptionStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as readline from "readline";

const prisma = new PrismaClient();

// ============================================================================
// Configuration
// ============================================================================

const ENVIRONMENT = process.env.NODE_ENV || "development";
const ALLOWED_ENVS = ["development", "staging"];

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

// ============================================================================
// Helper: Print colored output
// ============================================================================

function log(msg: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function header(title: string) {
  console.log("\n" + "=".repeat(70));
  log(title, "bright");
  console.log("=".repeat(70) + "\n");
}

function success(msg: string) {
  log(`✅ ${msg}`, "green");
}

function info(msg: string) {
  log(`ℹ️  ${msg}`, "blue");
}

function section(title: string) {
  log(`\n📌 ${title}`, "cyan");
}

// ============================================================================
// Helper: Parse command line arguments
// ============================================================================

function parseArgs(): { name?: string; type?: TenantType } {
  const args = process.argv.slice(2);
  const result: { name?: string; type?: TenantType } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1]) {
      result.name = args[i + 1];
      i++;
    }
    if (args[i] === "--type" && args[i + 1]) {
      const typeArg = args[i + 1].toUpperCase();
      if (typeArg === "ADMINISTRADORA" || typeArg === "EDIFICIO_AUTOGESTION") {
        result.type = typeArg as TenantType;
      }
      i++;
    }
  }

  return result;
}

// ============================================================================
// Helper: Generate credentials
// ============================================================================

async function generatePassword(): Promise<{ plain: string; hash: string }> {
  const plain = `Pilot${Math.random().toString(36).substring(2, 8).toUpperCase()}123!`;
  const hash = await bcrypt.hash(plain, 10);
  return { plain, hash };
}

// ============================================================================
// Main Seed Function
// ============================================================================

async function seedPilot() {
  header("🚀 BUILDINGOS PILOT ACTIVATION");

  // =========================================================================
  // 1. Safety checks
  // =========================================================================

  log(`Environment: ${ENVIRONMENT}`, "yellow");

  if (!ALLOWED_ENVS.includes(ENVIRONMENT)) {
    log(
      `❌ SEED PILOT only allowed in: ${ALLOWED_ENVS.join(", ")}`,
      "yellow"
    );
    log(`Current: ${ENVIRONMENT}`, "yellow");
    process.exit(1);
  }

  if (ENVIRONMENT === "production") {
    log("❌ DANGEROUS: Cannot run pilot seed in PRODUCTION", "yellow");
    process.exit(1);
  }

  info(
    "This script creates a complete pilot tenant in ~30 seconds"
  );
  info("All credentials will be printed to console");

  // =========================================================================
  // 2. Parse arguments & defaults
  // =========================================================================

  const args = parseArgs();

  // Tenant name from args or default
  const tenantName = args.name || `Pilot ${new Date().toISOString().split("T")[0]}`;
  const tenantType = args.type || TenantType.EDIFICIO_AUTOGESTION;

  info(`Creating tenant: "${tenantName}" (${tenantType})`);

  // =========================================================================
  // 3. Create tenant
  // =========================================================================

  section("1️⃣  Creating Tenant");

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName,
      type: tenantType,
    },
  });

  // Create subscription for tenant (FREE plan)
  const freePlan = await prisma.billingPlan.findUnique({
    where: { planId: BillingPlanId.FREE },
  });

  if (!freePlan) {
    log("❌ FREE plan not found. Run npm run seed first.", "yellow");
    process.exit(1);
  }

  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      planId: freePlan.id,
      status: SubscriptionStatus.ACTIVE,
    },
  });

  success(`Tenant created: ${tenant.id}`);
  log(`Name: ${tenant.name}`, "cyan");

  // =========================================================================
  // 4. Create owner/admin user
  // =========================================================================

  section("2️⃣  Creating Owner Account");

  const ownerEmail = `owner-${tenant.id.substring(0, 8)}@pilot.buildingos.local`;
  const ownerPassword = await generatePassword();

  const ownerUser = await prisma.user.create({
    data: {
      email: ownerEmail,
      name: `${tenantName} Owner`,
      passwordHash: ownerPassword.hash,
    },
  });

  success(`Owner user created: ${ownerUser.id}`);
  log(`Email: ${ownerEmail}`, "cyan");
  log(`Password: ${ownerPassword.plain}`, "yellow");

  // Create membership with TENANT_OWNER + TENANT_ADMIN roles
  const ownerMembership = await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: ownerUser.id,
    },
  });

  await Promise.all([
    prisma.membershipRole.create({
      data: {
        membershipId: ownerMembership.id,
        role: Role.TENANT_OWNER,
      },
    }),
    prisma.membershipRole.create({
      data: {
        membershipId: ownerMembership.id,
        role: Role.TENANT_ADMIN,
      },
    }),
  ]);

  success(`Roles assigned: TENANT_OWNER + TENANT_ADMIN`);

  // =========================================================================
  // 5. Create building
  // =========================================================================

  section("3️⃣  Creating Building");

  const building = await prisma.building.create({
    data: {
      tenantId: tenant.id,
      name: `${tenantName} - Main Building`,
      address: "123 Main Street, Sample City, Country",
    },
  });

  success(`Building created: ${building.id}`);
  log(`Name: ${building.name}`, "cyan");

  // =========================================================================
  // 6. Create 10 units
  // =========================================================================

  section("4️⃣  Creating 10 Units");

  const units = await Promise.all(
    Array.from({ length: 10 }).map((_, i) => {
      const unitNumber = 101 + i;
      return prisma.unit.create({
        data: {
          buildingId: building.id,
          label: `Apartment ${unitNumber}`,
          code: `${unitNumber}`,
          unitType: "APARTMENT",
        },
      });
    })
  );

  success(`${units.length} units created`);
  units.forEach((unit) => {
    log(`  • Unit ${unit.code}: ${unit.label}`, "cyan");
  });

  // =========================================================================
  // 7. Create 1 resident (assigned to Unit 1)
  // =========================================================================

  section("5️⃣  Creating Resident");

  const residentEmail = `resident-${tenant.id.substring(0, 8)}@pilot.buildingos.local`;
  const residentPassword = await generatePassword();

  const residentUser = await prisma.user.create({
    data: {
      email: residentEmail,
      name: `Resident (Unit ${units[0].code})`,
      passwordHash: residentPassword.hash,
    },
  });

  success(`Resident user created: ${residentUser.id}`);
  log(`Email: ${residentEmail}`, "cyan");
  log(`Password: ${residentPassword.plain}`, "yellow");

  // Create membership for resident
  const residentMembership = await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userId: residentUser.id,
    },
  });

  await prisma.membershipRole.create({
    data: {
      membershipId: residentMembership.id,
      role: Role.RESIDENT,
    },
  });

  // Assign resident to Unit 1
  await prisma.unitOccupant.create({
    data: {
      tenantId: tenant.id,
      unitId: units[0].id,
      memberId: residentMembership.id,
      role: UnitOccupantRole.RESIDENT,
    },
  });

  success(`Resident assigned to Unit ${units[0].code}`);

  // =========================================================================
  // 8. Print credentials summary
  // =========================================================================

  header("✅ PILOT ACTIVATION COMPLETE");

  section("🎯 Quick Access URLs");
  log(`\nWeb App:        http://localhost:3000`, "cyan");
  log(`API Docs:       http://localhost:4000/api/docs`, "cyan");
  log(`Prisma Studio: http://localhost:5555\n`, "cyan");

  section("👤 OWNER LOGIN CREDENTIALS");
  log(`\nEmail:    ${ownerEmail}`, "bright");
  log(`Password: ${ownerPassword.plain}\n`, "bright");

  section("🏢 TENANT INFORMATION");
  log(`\nTenant ID:  ${tenant.id}`, "cyan");
  log(`Name:       ${tenantName}`, "cyan");
  log(`Type:       ${tenantType}`, "cyan");
  log(`Plan:       ${BillingPlanId.FREE} (limits: 1 building, 10 units)\n`, "cyan");

  section("🏗️  BUILDING INFORMATION");
  log(`\nBuilding ID: ${building.id}`, "cyan");
  log(`Name:        ${building.name}`, "cyan");
  log(`Address:     ${building.address}\n`, "cyan");

  section("🏠 UNITS (Ready for Residents)");
  log(`\nTotal Units: ${units.length}`, "cyan");
  units.forEach((unit) => {
    const indicator = unit.id === units[0].id ? "👤 (has resident)" : "   ";
    log(`${indicator} Unit ${unit.code}: ${unit.label}`, "cyan");
  });
  log("", "cyan");

  section("👥 RESIDENT LOGIN CREDENTIALS");
  log(`\nEmail:    ${residentEmail}`, "bright");
  log(`Password: ${residentPassword.plain}`, "bright");
  log(`Unit:     ${units[0].code} (${units[0].label})\n`, "bright");

  // =========================================================================
  // 9. Export data
  // =========================================================================

  section("📋 SYSTEM CONFIGURATION");
  log(`\nTenant ID (X-Tenant-Id):  ${tenant.id}`, "cyan");
  log(`Building ID:              ${building.id}`, "cyan");
  log(`Unit 1 ID:                ${units[0].id}`, "cyan");
  log(`Resident User ID:         ${residentUser.id}\n`, "cyan");

  // =========================================================================
  // 10. Next steps
  // =========================================================================

  section("🚀 NEXT STEPS");
  log("\n1. Login with OWNER account:", "bright");
  log(`   Email: ${ownerEmail}`, "cyan");
  log(`   Password: ${ownerPassword.plain}\n`, "cyan");

  log("2. Share with RESIDENT:", "bright");
  log(`   Email: ${residentEmail}`, "cyan");
  log(`   Password: ${residentPassword.plain}\n`, "cyan");

  log("3. (Optional) Invite more residents to other units:", "bright");
  log("   Use the POST /invitations endpoint in Swagger UI\n", "cyan");

  log("4. Create content in Swagger (POST endpoints):", "bright");
  log("   • Add more buildings (POST /buildings)", "cyan");
  log("   • Create tickets (POST /buildings/:id/tickets)", "cyan");
  log("   • Post communications (POST /communications)", "cyan");
  log("   • Add charges (POST /charges)\n", "cyan");

  section("✅ READY TO TEST");
  log(
    "\nPilot activation complete! All systems ready.",
    "green"
  );
  log("No manual database modifications needed.", "green");

  if (ENVIRONMENT !== "production") {
    log(
      "\n💡 Tip: Share credentials above with your pilot customer",
      "yellow"
    );
  }
}

// ============================================================================
// Run seed
// ============================================================================

seedPilot()
  .catch((error) => {
    log(`\n❌ ERROR: ${error.message}`, "yellow");
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
