# Code Review Standards for BuildingOS

## TypeScript/Node.js

- Use `const`/`let`, never `var`
- Prefer `interface` over `type` for object definitions
- Avoid `any` types - use proper typing
- Use readonly for immutable properties
- Always include JSDoc comments for public methods

## NestJS

- Use `@Injectable()` decorator for services
- Implement proper error handling with typed exceptions
- Use dependency injection via constructor
- Use `@Global()` for shared modules
- Use guards and interceptors for cross-cutting concerns

## React/Next.js

- Use functional components only
- Prefer named exports
- Use TypeScript for all components
- Use proper prop typing with interfaces/types
- Use `const` for component definitions

## API/REST

- Follow REST conventions: GET, POST, PATCH, DELETE
- Return proper HTTP status codes
- Use DTOs (Data Transfer Objects) for request/response
- Validate all inputs with Zod/validators
- Document endpoints with JSDoc

## Testing

- Write tests for critical business logic
- Use `describe` and `it` blocks
- Test error scenarios, not just happy paths
- Use meaningful test descriptions

## Security

- Never hardcode secrets - use environment variables
- Validate all user input
- Implement multi-tenant isolation checks
- Use RBAC for authorization
- Hash sensitive data (passwords, tokens)

## Database

- Use Prisma migrations for schema changes
- Always include `tenantId` for multi-tenant isolation
- Use soft deletes where appropriate (`deletedAt` field)
- Create indexes for frequently queried columns

## Commits

- Use conventional commits: feat, fix, refactor, test, docs, etc.
- Write clear, actionable commit messages
- Keep commits atomic (one feature per commit)
- Include context about WHY not just WHAT
