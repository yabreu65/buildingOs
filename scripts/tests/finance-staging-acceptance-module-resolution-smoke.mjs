import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
await prisma.$disconnect();
console.log("PASS: @prisma/client resolves from the mounted API package path");
