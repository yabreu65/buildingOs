async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    console.log('Adding enum values...');
    await prisma.$executeRaw`ALTER TYPE "AssistantHandoffStatus" ADD VALUE 'OPEN'`;
    await prisma.$executeRaw`ALTER TYPE "AssistantHandoffStatus" ADD VALUE 'IN_PROGRESS'`;
    await prisma.$executeRaw`ALTER TYPE "AssistantHandoffStatus" ADD VALUE 'DISMISSED'`;
    console.log('OK');
  } catch (e) {
    console.log('Enum may already exist or table missing');
  }

  await prisma.$dispose();
}

main();
