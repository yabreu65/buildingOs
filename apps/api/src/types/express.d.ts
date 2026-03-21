import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        isSuperAdmin: boolean;
        memberships: Array<{
          tenantId: string;
          roles: string[];
        }>;
      };
      tenantId?: string;
      buildingId?: string;
      unitId?: string;
      requestId?: string;
    }
  }
}

export {};
