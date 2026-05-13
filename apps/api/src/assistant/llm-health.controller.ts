import { Controller, Get } from '@nestjs/common';
import { AssistantLlmHealthService, LlmHealthResponse } from './llm-health.service';

@Controller('assistant/llm')
export class AssistantLlmHealthController {
  constructor(private readonly llmHealth: AssistantLlmHealthService) {}

  @Get('health')
  async health(): Promise<LlmHealthResponse> {
    return this.llmHealth.getHealth();
  }
}
