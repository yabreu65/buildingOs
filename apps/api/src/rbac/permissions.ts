export type Permission =
  | 'buildings.read'
  | 'buildings.write'
  | 'units.read'
  | 'units.write'
  | 'payments.submit'
  | 'payments.review'
  | 'tickets.read'
  | 'tickets.write'
  | 'tickets.manage'
  | 'members.manage';

export const PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    'buildings.read',
    'buildings.write',
    'units.read',
    'units.write',
    'payments.submit',
    'payments.review',
    'tickets.read',
    'tickets.write',
    'tickets.manage',
    'members.manage',
  ],
  TENANT_OWNER: [
    'buildings.read',
    'buildings.write',
    'units.read',
    'units.write',
    'payments.submit',
    'payments.review',
    'tickets.read',
    'tickets.write',
    'tickets.manage',
    'members.manage',
  ],
  TENANT_ADMIN: [
    'buildings.read',
    'buildings.write',
    'units.read',
    'units.write',
    'payments.review',
    'tickets.read',
    'tickets.write',
    'tickets.manage',
    'members.manage',
  ],
  OPERATOR: [
    'buildings.read',
    'units.read',
    'payments.review',
    'tickets.read',
    'tickets.write',
  ],
  RESIDENT: ['tickets.read', 'tickets.write', 'payments.submit'],
};
