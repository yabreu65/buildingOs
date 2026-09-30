import { PrismaClient } from "@prisma/client";
import { Client as MinioClient } from "minio";
import { createAcceptanceCleanup } from "./finance-staging-acceptance-cleanup.mjs";

const prisma = new PrismaClient();
if (typeof createAcceptanceCleanup !== "function" || typeof MinioClient !== "function") {
  throw new Error("acceptance cleanup runtime dependencies did not resolve from the API package path");
}
await prisma.$disconnect();
console.log("PASS: Prisma and exact-cleanup modules resolve from the API package path");
