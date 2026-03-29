# Frontend Feature Skill

**Trigger**: Creating new frontend features, pages, or components in BuildingOS

## Purpose
Generate frontend code following BuildingOS conventions and patterns.

## File Structure

```
apps/web/features/{module}/
├── components/
│   ├── {Module}List.tsx
│   ├── {Module}Form.tsx
│   ├── {Module}Card.tsx
│   └── {Module}Filters.tsx
├── hooks/
│   ├── use{Module}.ts
│   ├── use{Module}List.ts
│   └── use{Module}Mutations.ts
├── services/
│   └── {module}.ts
├── types/
│   └── {module}.types.ts
└── index.ts
```

### Pages (tenant-scoped)
```
apps/web/app/(tenant)/[tenantId]/{module}/
├── page.tsx
├── loading.tsx
└── error.tsx
```

## Conventions

### Components
- Use functional components only
- Use named exports
- TypeScript for all props
- Tailwind CSS v4 for styling

```typescript
import { useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

interface {Module}ListProps {
  items: {Module}[];
  onEdit?: (id: string) => void;
}

export function {Module}List({ items, onEdit }: {Module}ListProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div key={item.id}>{item.name}</div>
      ))}
    </div>
  );
}
```

### Hooks (TanStack Query)
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function use{Module}List(tenantId: string) {
  return useQuery({
    queryKey: ['{module}', tenantId],
    queryFn: () => api.get('/xxx', { tenantId }),
  });
}

export function useCreate{Module}(tenantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post('/xxx', data, { tenantId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['{module}'] });
    },
  });
}
```

### Services
```typescript
import { api } from '@/lib/api';

export const {module}Service = {
  list: (tenantId: string) => 
    api.get<{Module}[]>('/xxx', { tenantId }),
  
  get: (tenantId: string, id: string) => 
    api.get<{Module}>(`/xxx/${id}`, { tenantId }),
  
  create: (tenantId: string, data: Create{Module}Dto) => 
    api.post<{Module}>('/xxx', data, { tenantId }),
  
  update: (tenantId: string, id: string, data: Update{Module}Dto) => 
    api.patch<{Module}>(`/xxx/${id}`, data, { tenantId }),
  
  delete: (tenantId: string, id: string) => 
    api.delete(`/xxx/${id}`, { tenantId }),
};
```

### Forms (React Hook Form + Zod)
```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const {Module}Schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

type {Module}FormData = z.infer<typeof {Module}Schema>;

export function {Module}Form({ onSubmit }: {Module}FormProps) {
  const form = useForm<{Module}FormData>({
    resolver: zodResolver({Module}Schema),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* form fields */}
      </form>
    </Form>
  );
}
```

## State Management

### Server State
- **TanStack Query** - All API data
- React Query hooks for each entity

### Client State
- Zustand for global UI state (modals, sidebars)
- React useState for component-local state

## API Layer

Use the centralized API client:
```typescript
import { api } from '@/lib/api';

// Auto-attaches tenantId from context
const data = await api.get('/resource');
```

## Routing

### Tenant-scoped Routes
```
app/(tenant)/[tenantId]/{module}/
```

### Auth Routes
```
app/(auth)/login/
app/(auth)/register/
```

## Validation Checklist

Before completing:
- [ ] Components use functional components + named exports
- [ ] Hooks use TanStack Query for server state
- [ ] Forms use React Hook Form + Zod
- [ ] Tailwind CSS for styling (no CSS modules)
- [ ] Types defined and exported
- [ ] Loading/error states handled
- [ ] Tenant ID passed to API calls

## Dependencies
- `@tanstack/react-query` - Server state
- `react-hook-form` - Form handling
- `zod` - Schema validation
- `@hookform/resolvers` - Zod integration
- `lucide-react` - Icons
