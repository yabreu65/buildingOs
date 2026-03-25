import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: {
      email: "yoryiabreu65@gmail.com",
    },
  });
  
  if (user) {
    console.log("✅ Usuario encontrado:");
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Roles: ${JSON.stringify(user.roles)}`);
  } else {
    console.log("❌ Usuario NO encontrado en la BD");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
