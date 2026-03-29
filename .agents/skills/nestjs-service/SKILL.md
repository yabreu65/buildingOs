# NestJS Service Skill

**Trigger**: Creating new NestJS services, controllers, or modules in BuildingOS

## Purpose
Generate complete NestJS module following BuildingOS conventions and patterns.

## Conventions

### File Structure
```
apps/api/src/{module}/
├── {module}.controller.ts
├── {module}.service.ts
├── {module}.module.ts
├── dto/
│   ├── create-{module}.dto.ts
│   └── update-{module}.dto.ts
├── entities/
│   └── {module}.entity.ts
└── interfaces/
    └── {module}.interfaces.ts
```

### Service Patterns

**Constructor**:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly auditService: AuditService,
  // Optional: other services
) {}
```

**CRUD Methods**:
```typescript
async create(tenantId: string, dto: CreateXxxDto, userId?: string): Promise<Xxx> {
  // 1. Check plan entitlements (if applicable)
  // await this.planEntitlements.assertLimit(tenantId, 'xxx');

  // 2. Create with Prisma
  const result = await this.prisma.xxx.create({
    data: { tenantId, ...dto },
  });

  // 3. Audit log (if userId)
  if (userId) {
    void this.auditService.createLog({
      tenantId,
      actorUserId: userId,
      action: AuditAction.XXX_CREATE,
      target: { type: 'Xxx', id: result.id },
    });
  }

  return result;
}
```

### Controller Patterns

```typescript
@Controller('xxx')
@UseGuards(JwtAuthGuard, BuildingAccessGuard, RolesGuard)
@Roles('TENANT_ADMIN', 'OPERATOR')
export class XxxController {
  constructor(private readonly xxxService: XxxService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateXxxDto,
    @Tenant() tenantId: string,
    @User() user: UserPayload,
  ) {
    return this.xxxService.create(tenantId, dto, user.sub);
  }
}
```

### Guards & Decorators
- `JwtAuthGuard` - JWT authentication
- `BuildingAccessGuard` - Sets tenantId from token
- `RolesGuard` - RBAC authorization
- `@Tenant()` - Extract tenantId
- `@User()` - Extract user payload

### Multi-tenancy Rules
- ALL queries MUST include `tenantId` filter
- Cross-tenant access = throw NotFoundException (never expose 403)
- Use Prisma service injection, not raw queries

### ID Format
- Use `@IsString()` for all IDs (NOT `@IsUUID()`)
- All IDs are CUIDs (format `cl...`)

### Error Handling
- Use typed exceptions: `BadRequestException`, `NotFoundException`, `ForbiddenException`
- Return 404 (not 403) for missing resources (security)

### Validation
- Use `class-validator` + DTOs at controller boundary
- Validate at API boundary only

## Usage

When creating a new module:

1. **Generate files** following structure above
2. **Register in module** - import PrismaModule, add to providers
3. **Add routes** - define endpoints with proper guards
4. **Add to global module** if needed (check `app.module.ts`)
5. **Add RBAC permissions** if new roles needed

## Dependencies
- `@prisma/client` for database models
- `class-validator` for DTO validation
- `@nestjs/common` for decorators/exceptions
- Local audit service for logging

## Validation Checklist

Before completing:
- [ ] All Prisma queries include tenantId
- [ ] Audit logs for CRUD operations
- [ ] Proper error handling (404 not 403)
- [ ] DTOs with class-validator
- [ ] Guards applied at controller level
