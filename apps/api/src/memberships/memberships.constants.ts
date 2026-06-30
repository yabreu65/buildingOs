import { Role } from '@prisma/client';

export const ASSIGNABLE_TICKET_ROLES = [
  Role.TENANT_ADMIN,
  Role.TENANT_OWNER,
  Role.OPERATOR,
] as const;
