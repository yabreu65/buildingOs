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
    const tenantId = this.requireHeader('x-tenant-id', tenantIdHeader);
    const userId = this.requireHeader('x-user-id', userIdHeader);
    const role = this.requireHeader('x-user-role', roleHeader);

    return this.readOnlyQueryService.execute(request, {
      apiKey,
      tenantId,
      userId,
      role,
    });
  }
}
