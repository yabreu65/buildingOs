import { Body, Controller, Headers, Post } from '@nestjs/common';
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

  /**
   * Internal endpoint for deterministic read-only assistant queries.
   */
  @Post('read-only-query')
  async query(
    @Body() request: AssistantReadOnlyQueryRequest,
    @Headers('x-api-key') apiKey?: string,
    @Headers('x-tenant-id') tenantIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Headers('x-user-role') roleHeader?: string,
  ): Promise<AssistantReadOnlyQueryResponse> {
    return this.readOnlyQueryService.execute(request, {
      apiKey,
      tenantId: tenantIdHeader,
      userId: userIdHeader,
      role: roleHeader,
    });
  }
}
