import { BadRequestException, Body, Controller, Headers, Param, Post } from '@nestjs/common';
import { AssistantToolsService } from './tools.service';
import {
  ASSISTANT_TOOLS_ALLOWLIST,
  AssistantToolName,
  AssistantToolRequest,
  AssistantToolResponse,
} from './tools.types';

@Controller('assistant/tools')
export class AssistantToolsController {
  constructor(private readonly toolsService: AssistantToolsService) {}

  @Post(':toolName')
  async executeTool(
    @Param('toolName') toolName: string,
    @Body() request: AssistantToolRequest,
    @Headers('x-api-key') apiKey?: string,
    @Headers('x-tenant-id') tenantId?: string,
    @Headers('x-user-id') userId?: string,
    @Headers('x-user-role') role?: string,
  ): Promise<AssistantToolResponse> {
    if (!ASSISTANT_TOOLS_ALLOWLIST.includes(toolName as AssistantToolName)) {
      throw new BadRequestException(`Unsupported tool: ${toolName}`);
    }

    return this.toolsService.executeTool(toolName as AssistantToolName, request, {
      apiKey,
      tenantId,
      userId,
      role,
    });
  }
}
