import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { AssistantReadOnlyQueryService } from './read-only-query.service';
import {
  AssistantReadOnlyQueryRequest,
  AssistantReadOnlyQueryResponse,
} from './read-only-query.types';

@Controller('assistant')
export class AssistantReadOnlyQueryController {
  constructor(
    private readonly readOnlyQueryService: AssistantReadOnlyQueryService,
  ) {}

  private requireHeader(name: string, value?: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
      throw new BadRequestException(`${name} header is required`);
    }
    return normalized;
  }

  /**
   * Internal endpoint for deterministic read-only assistant queries.
   * Supports both body context and header-based context (fallback).
   */
  @Post('read-only-query')
  async query(
    @Body() request: AssistantReadOnlyQueryRequest,
    @Headers('x-api-key') apiKeyHeader?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Headers('x-user-role') roleHeader?: string,
  ): Promise<AssistantReadOnlyQueryResponse> {
    const apiKey = this.requireHeader('x-api-key', apiKeyHeader);

    // Build context from body OR from headers (fallback)
    const tenantId = request.context?.tenantId || this.requireHeader('x-tenant-id', tenantIdHeader);
    const userId = request.context?.userId || this.requireHeader('x-user-id', userIdHeader);
    const role = request.context?.role || this.requireHeader('x-user-role', roleHeader);

    // Ensure we have a valid context object
    const context = request.context || {
      tenantId,
      userId,
      role,
      appId: 'buildingos',
    };

    return this.readOnlyQueryService.execute(request, {
      apiKey,
      tenantId,
      userId,
      role,
      context,
    });
  }
}
