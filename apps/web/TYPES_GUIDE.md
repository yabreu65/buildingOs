# Type System & Validation Guide

Esta guía documenta el sistema completo de tipos, validación y props reutilizables para buildingos frontend.

## Estructura

```
lib/
  ├── storage-schemas.ts    # Zod schemas para localStorage
  ├── type-guards.ts        # Type guards y predicados
  └── index.ts              # Barrel export

types/
  ├── enums.ts              # Enums del dominio (ChargeStatus, TicketStatus, etc)
  ├── communication.ts       # Tipos específicos de comunicaciones
  ├── props.ts              # Props interfaces reutilizables
  ├── api.ts                # Tipos de respuesta API
  └── index.ts              # Barrel export
```

## 1. Validación de localStorage con Zod

Todos los datos persistidos deben validarse contra schemas de Zod para prevenir fallos silenciosos.

### Schemas disponibles

```typescript
import {
  StoredAuthSessionSchema,
  StoredUnitSchema,
  StoredBuildingSchema,
  InvitationDataSchema,
  StoredTenantSchema,
  parseStorageValue,
  parseStorageArray,
} from '@/lib/storage-schemas';
```

### Uso: Parsear datos del localStorage

```typescript
// Antes (sin validación)
const session = JSON.parse(localStorage.getItem('auth_session'));

// Después (con validación)
const session = parseStorageValue(
  localStorage.getItem('auth_session'),
  StoredAuthSessionSchema
);

if (!session) {
  console.error('Invalid session data');
  // Manejar error
}
```

### Uso: Validar al guardar

```typescript
import { StoredAuthSessionSchema } from '@/lib/storage-schemas';

const newSession = {
  token: 'abc123',
  user: { id: '1', email: 'test@example.com' },
  memberships: [{ tenantId: 'tenant-1', roles: ['ADMIN'] }],
};

// Validar antes de guardar
try {
  const validated = StoredAuthSessionSchema.parse(newSession);
  localStorage.setItem('auth_session', JSON.stringify(validated));
} catch (err) {
  console.error('Invalid session:', err);
}
```

## 2. Type Guards para Runtime Narrowing

Los type guards usan predicados para permitir TypeScript que infiera tipos correctamente.

### Type Guards de Storage

```typescript
import {
  isStoredAuthSession,
  isStoredUnit,
  isStoredBuilding,
} from '@/lib/type-guards';

const value = localStorage.getItem('auth_session');

if (isStoredAuthSession(value)) {
  // TypeScript infiere: value es StoredAuthSession
  console.log(value.token);
}
```

### Type Guards de Enums

```typescript
import {
  isChargeStatus,
  isTicketStatus,
  isTicketPriority,
  isCommunicationChannel,
} from '@/lib/type-guards';

const status: unknown = 'PENDING';

if (isChargeStatus(status)) {
  // TypeScript infiere: status es ChargeStatus ('PENDING' | 'PARTIAL' | 'PAID' | 'CANCELED')
}
```

### Type Guards de Utilidad

```typescript
import {
  isDefined,
  isNotNull,
  isNotNullOrUndefined,
  isString,
  isNumber,
  isArrayOf,
  isRecord,
} from '@/lib/type-guards';

// Filtrar undefined
const values = [1, undefined, 2, undefined, 3].filter(isDefined);

// Filtrar null
const items = data.filter(isNotNull);

// Validar tipo de primitivo
if (isString(value)) {
  console.log(value.toUpperCase());
}

// Validar array
const numbers = [1, 2, 3];
if (isArrayOf(numbers, isNumber)) {
  // TypeScript infiere: numbers es number[]
}
```

### Manejo seguro de errores

```typescript
import { getErrorMessage, getErrorStatus } from '@/lib/type-guards';

try {
  await fetchData();
} catch (err) {
  // Funciona con Error, ApiErrorResponse, o cualquier tipo
  const message = getErrorMessage(err); // Siempre un string
  const status = getErrorStatus(err);   // Número, default 500

  console.error(`Error ${status}: ${message}`);
}
```

## 3. Props Interfaces Reutilizables

Reducen boilerplate y aseguran consistencia en la interfaz de componentes.

### Props Base

```typescript
import { BaseComponentProps } from '@/types/props';

interface Props extends BaseComponentProps {
  title: string;
  // Tu lógica aquí
}

// Incluye automáticamente:
// - className?: string
// - id?: string
// - data-testid?: string
```

### Props de Formulario

```typescript
import { FormComponentProps, InputProps, SelectProps } from '@/types/props';

interface MyFormProps extends FormComponentProps {
  // Incluye:
  // - label, placeholder, required, disabled, error, helperText, size
  // - Plus tu lógica
}

interface MySelectProps extends SelectProps<'OPTION_A' | 'OPTION_B'> {
  // Incluye:
  // - options (readonly), value, onChange, isMulti, isClearable, isSearchable
}
```

### Props de Modal/Dialog

```typescript
import { ModalProps, DialogProps } from '@/types/props';

interface ConfirmModalProps extends DialogProps {
  // Incluye:
  // - open, onClose, title, children, actions, size
  // - onConfirm, onCancel, confirmText, cancelText, isDangerous
}
```

### Props de Lista/Tabla

```typescript
import { ListProps, TableProps, TableColumnDef } from '@/types/props';

interface MyTableProps extends TableProps<MyItem> {
  // Incluye:
  // - columns (readonly), data (readonly), onRowClick, isPaginated, onSort
}

// Define columnas
const columns: readonly TableColumnDef<MyItem>[] = [
  {
    key: 'id',
    label: 'ID',
    sortable: true,
    render: (value) => `#${value}`,
  },
  {
    key: 'name',
    label: 'Name',
  },
];
```

### Estado Asincrónico

```typescript
import { AsyncState } from '@/types/props';

interface Props {
  users: AsyncState<User[]>;
  onRetry: () => void;
}

// Usar para loading + error + data
if (users.loading) {
  return <Spinner />;
}

if (users.error) {
  return <ErrorMessage message={users.error} onRetry={onRetry} />;
}

return <UserList items={users.data ?? []} />;
```

## 4. API Response Types

Documentan contratos esperados de endpoints API para type safety.

### Login

```typescript
import { AuthLoginRequest, AuthLoginResponse } from '@/types/api';

const response = await api.post<AuthLoginResponse>(
  '/auth/login',
  {
    email: 'user@example.com',
    password: 'secret',
  } as AuthLoginRequest
);

console.log(response.data.token); // Type-safe
console.log(response.data.user.id);
```

### Buildings

```typescript
import { BuildingResponse, BuildingsListResponse } from '@/types/api';

const building = await api.get<BuildingResponse>(`/buildings/${id}`);
const list = await api.get<BuildingsListResponse>('/buildings?page=1');

// Type-safe access
building.data.name;
list.data.items[0].address;
```

### Charges/Payments

```typescript
import {
  ChargeResponse,
  ChargesListResponse,
  PaymentResponse,
} from '@/types/api';

const charges = await api.get<ChargesListResponse>(
  `/tenants/${tenantId}/charges`
);

const payment = await api.post<PaymentResponse>(
  `/payments`,
  { chargeId: '123', amount: 100 }
);

// Type-safe filtering
charges.data.items
  .filter((c) => c.status === 'PENDING')
  .forEach((c) => console.log(c.dueDate));
```

### Helper Functions

```typescript
import { isApiError, isListResponse } from '@/types/api';

try {
  const response = await api.get('/data');

  if (isListResponse(response.data)) {
    console.log(`Total: ${response.data.total}`);
    response.data.items.forEach((item) => {
      // Type-safe iteration
    });
  }
} catch (err) {
  if (isApiError(err)) {
    console.error(`HTTP ${err.status}: ${err.message}`);
  }
}
```

## 5. Ejemplos Prácticos

### Storage Sync Hook

```typescript
import {
  StoredBuildingSchema,
  parseStorageArray,
} from '@/lib/storage-schemas';
import { isStoredBuilding } from '@/lib/type-guards';

function useBuildings(tenantId: string) {
  const [buildings, setBuildings] = useState<StoredBuilding[]>([]);

  useEffect(() => {
    // Cargar y validar
    const raw = localStorage.getItem(`bo_buildings_${tenantId}`);
    const list = parseStorageArray(raw, StoredBuildingSchema);

    setBuildings(list);
  }, [tenantId]);

  const save = (building: StoredBuilding) => {
    // Validar antes de guardar
    if (!isStoredBuilding(building)) {
      throw new Error('Invalid building data');
    }

    const key = `bo_buildings_${tenantId}`;
    const current = parseStorageArray(
      localStorage.getItem(key),
      StoredBuildingSchema
    );

    const updated = [...current, building];
    localStorage.setItem(key, JSON.stringify(updated));
    setBuildings(updated);
  };

  return { buildings, save };
}
```

### API Service Type-Safe

```typescript
import {
  ChargesListResponse,
  ChargeCreateRequest,
  ChargeResponse,
} from '@/types/api';

async function getCharges(
  tenantId: string,
  unitId?: string
): Promise<ChargesListResponse['data']> {
  const params = new URLSearchParams();
  params.set('page', '1');
  if (unitId) params.set('unitId', unitId);

  const res = await fetch(`/api/tenants/${tenantId}/charges?${params}`);
  const data = (await res.json()) as ChargesListResponse;

  return data.data; // Type-safe
}

async function createCharge(
  tenantId: string,
  input: ChargeCreateRequest
): Promise<ChargeResponse['data']> {
  const res = await fetch(`/api/tenants/${tenantId}/charges`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

  const data = (await res.json()) as ChargeResponse;
  return data.data;
}
```

### Component con Props Type-Safe

```typescript
import { TableProps, TableColumnDef } from '@/types/props';

interface Charge {
  id: string;
  amount: number;
  status: 'PENDING' | 'PAID';
  dueDate: string;
}

const columns: readonly TableColumnDef<Charge>[] = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'dueDate', label: 'Due Date' },
];

interface ChargesTableProps extends TableProps<Charge> {
  onPaymentClick?: (chargeId: string) => void;
}

export function ChargesTable({
  columns,
  data,
  onRowClick,
  ...props
}: ChargesTableProps) {
  return (
    <Table<Charge>
      columns={columns}
      data={data}
      onRowClick={onRowClick}
      {...props}
    />
  );
}
```

## 6. Best Practices

### ✅ DO

```typescript
// Siempre validar datos del storage
const session = parseStorageValue(raw, StoredAuthSessionSchema);

// Usar type guards para narrowing
if (isChargeStatus(status)) {
  // TypeScript conoce que status es ChargeStatus
}

// Documentar tipos API
async function getUnits(): Promise<UnitsListResponse> {
  // ...
}

// Extender props base para consistencia
interface MyComponentProps extends BaseComponentProps {
  // ...
}

// Marcar collections como readonly
interface Props {
  items: readonly Item[];
  options: readonly string[];
}
```

### ❌ DON'T

```typescript
// No usar any
const value: any = JSON.parse(raw); // MAL

// No confiar en JSON parse sin validación
const data = JSON.parse(localStorage.getItem('key')); // INSEGURO

// No ignorar error handling
try {
  parseData();
} catch {
  // Silenciar error? NO
}

// No redeclarar tipos existentes
interface Props extends BaseComponentProps {
  // Bueno, extender existentes
}

// Nunca mutar props readonly
const props = { items: readonly[] as const };
props.items.push(new); // ERROR - Correctamente tipado
```

## 7. Cheat Sheet

```typescript
// Imports comunes
import {
  StoredAuthSessionSchema,
  parseStorageValue,
  parseStorageArray,
} from '@/lib/storage-schemas';

import {
  isStoredAuthSession,
  isChargeStatus,
  getErrorMessage,
  isDefined,
  isArrayOf,
} from '@/lib/type-guards';

import type {
  BaseComponentProps,
  FormComponentProps,
  ModalProps,
  ListProps,
  TableProps,
  AsyncState,
} from '@/types/props';

import type {
  AuthLoginResponse,
  BuildingsListResponse,
  ChargeResponse,
} from '@/types/api';
```

---

**Last Updated**: Feb 22, 2026
**Related**: `lib/storage-schemas.ts`, `lib/type-guards.ts`, `types/props.ts`, `types/api.ts`
