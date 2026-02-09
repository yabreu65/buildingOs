export type Permission =
  | 'properties.read'
  | 'properties.write'
  | 'units.read'
  | 'units.write'
  | 'payments.submit'
  | 'payments.review';

export const PERMISSIONS: Record<string, Permission[]> = {
  SUPER_ADMIN: [
    'properties.read',
    'properties.write',
    'units.read',
    'units.write',
    'payments.submit',
    'payments.review',
  ],
  TENANT_OWNER: [
    'properties.read',
    'properties.write',
    'units.read',
    'units.write',
    'payments.submit',
    'payments.review',
  ],
  TENANT_ADMIN: [
    'properties.read',
    'properties.write',
    'units.read',
    'units.write',
    'payments.review',
  ],
  OPERATOR: ['properties.read', 'units.read', 'payments.review'],
  RESIDENT: ['payments.submit'], // read limitado se implementará luego
};
