import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantAccessGuard } from '../tenancy/tenant-access.guard';
import { RequireFeatureGuard, RequireFeature } from '../billing/require-feature.guard';
import { AssistantService, ChatResponse } from './assistant.service';

/**
 * AI Units Controller
 *
 * Specialized endpoints for unit management with AI assistance:
 * - Unit configuration suggestions
 * - Resident risk assessment
 * - Rent price optimization
 * - Maintenance predictions
 *
 * All endpoints use the AssistantService with specialized prompts for unit domain.
 * Rate limiting (100 calls/day) and budget enforcement apply automatically.
 */
@ApiTags('AI - Units')
@Controller('tenants/:tenantId/ai/units')
@UseGuards(JwtAuthGuard, TenantAccessGuard)
export class AiUnitsController {
  constructor(private readonly assistantService: AssistantService) {}

  /**
   * POST /tenants/:tenantId/ai/units/suggestions/:buildingId
   *
   * Get AI suggestions for unit configuration based on building context.
   *
   * Suggests:
   * - Optimal unit type for the building location/market
   * - Competitive rental price
   * - Recommended amenities
   *
   * Returns JSON with: suggestedType, suggestedPrice, amenities[], reasoning
   */
  @Post('suggestions/:buildingId')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canUseAI')
  @ApiOperation({
    summary: 'Get AI suggestions for unit configuration',
    description: 'Analyzes building context to suggest optimal unit type, price, and amenities',
  })
  @ApiResponse({
    status: 200,
    description: 'AI suggestions for unit configuration',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid building or building not found',
  })
  @ApiResponse({
    status: 403,
    description: 'Feature not available (canUseAI flag)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (100 calls per day)',
  })
  async getUnitSuggestions(
    @Param('tenantId') tenantId: string,
    @Param('buildingId') buildingId: string,
    @Body() dto: { unitType?: string; location?: string; market?: string },
    @Request() req?: any,
  ): Promise<ChatResponse> {
    // Validate building ID
    if (!buildingId || buildingId.trim().length === 0) {
      throw new BadRequestException('buildingId is required');
    }

    // Extract user info from JWT
    const userId = req.user?.id;
    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId,
    );

    if (!userId || !membership) {
      throw new BadRequestException('User not found in tenant');
    }

    const message = `
I'm creating a new unit in a building. Help me configure it optimally.

Building location: ${dto.location || 'urban residential'}
Market type: ${dto.market || 'standard'}
Unit type being considered: ${dto.unitType || 'flexible'}

Please suggest:
1. Most suitable unit type for this market
2. Competitive rental/sale price range
3. Recommended amenities for this type
4. Key considerations for success

Format your response as JSON with fields: suggestedType, suggestedPrice, amenities (array), marketAnalysis, reasoning
    `.trim();

    return this.assistantService.chat(
      tenantId,
      userId,
      membership.id,
      {
        message,
        page: 'units.create',
        buildingId,
      },
      membership.roles || [],
    );
  }

  /**
   * POST /tenants/:tenantId/ai/units/resident-risk/:unitId
   *
   * Assess potential risk factors for assigning a resident to a unit.
   *
   * Analyzes:
   * - Payment default risk
   * - Behavioral/compliance risk
   * - Recommended deposit amount
   * - Red flags or positive indicators
   *
   * Returns JSON with: riskScore (0-100), paymentRisk, behaviorRisk, recommendations[], suggestedDeposit
   */
  @Post('resident-risk/:unitId')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canUseAI')
  @ApiOperation({
    summary: 'Assess resident risk for a unit assignment',
    description: 'Analyzes resident profile against unit requirements to assess risk',
  })
  @ApiResponse({
    status: 200,
    description: 'Risk assessment for resident assignment',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid unit, resident, or missing required fields',
  })
  @ApiResponse({
    status: 403,
    description: 'Feature not available (canUseAI flag)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async assessResidentRisk(
    @Param('tenantId') tenantId: string,
    @Param('unitId') unitId: string,
    @Body()
    dto: {
      residentId: string;
      residentName?: string;
      annualIncome?: number;
      employmentType?: string;
      creditScore?: number;
      previousDefaults?: number;
    },
    @Request() req?: any,
  ): Promise<ChatResponse> {
    // Validate inputs
    if (!unitId || unitId.trim().length === 0) {
      throw new BadRequestException('unitId is required');
    }

    if (!dto.residentId || dto.residentId.trim().length === 0) {
      throw new BadRequestException('residentId is required');
    }

    // Extract user info from JWT
    const userId = req.user?.id;
    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId,
    );

    if (!userId || !membership) {
      throw new BadRequestException('User not found in tenant');
    }

    const message = `
I'm assessing risk for assigning a resident to a unit. Provide a risk analysis.

Resident Profile:
- Name: ${dto.residentName || 'Unknown'}
- Employment type: ${dto.employmentType || 'Not provided'}
- Annual income: ${dto.annualIncome ? `$${dto.annualIncome}` : 'Not provided'}
- Credit score: ${dto.creditScore || 'Not provided'}
- Previous payment defaults: ${dto.previousDefaults || 0}

Unit context:
- Unit ID: ${unitId}
- Tenant ID: ${tenantId}

Please analyze:
1. Payment default risk (LOW/MEDIUM/HIGH) and reasoning
2. Behavioral/compliance risk factors
3. Recommended security deposit as % of monthly rent
4. Key red flags or positive indicators
5. Overall risk score (0-100, where 0 is lowest risk)

Format your response as JSON with fields: riskScore, paymentRisk, behaviorRisk, securityDepositPercentage, redFlags (array), positiveIndicators (array), recommendations (array), overallAssessment
    `.trim();

    return this.assistantService.chat(
      tenantId,
      userId,
      membership.id,
      {
        message,
        page: 'units.residents',
        unitId,
      },
      membership.roles || [],
    );
  }

  /**
   * POST /tenants/:tenantId/ai/units/price-optimization/:unitId
   *
   * Get optimal rent price for a unit based on market analysis.
   *
   * Analyzes:
   * - Current price competitiveness
   * - Market conditions and demand
   * - Price optimization opportunities
   * - Suggested adjustments
   *
   * Returns JSON with: currentPriceAssessment, suggestedPrice, priceIncrease%, marketComparison, reasoning
   */
  @Post('price-optimization/:unitId')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canUseAI')
  @ApiOperation({
    summary: 'Get optimal rent price for a unit',
    description:
      'Analyzes market conditions to suggest competitive rental pricing',
  })
  @ApiResponse({
    status: 200,
    description: 'Price optimization analysis',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid unit or missing required fields',
  })
  @ApiResponse({
    status: 403,
    description: 'Feature not available (canUseAI flag)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async optimizePrice(
    @Param('tenantId') tenantId: string,
    @Param('unitId') unitId: string,
    @Body()
    dto: {
      currentPrice?: number;
      unitType?: string;
      bedrooms?: number;
      bathrooms?: number;
      squareFeet?: number;
      amenities?: string[];
      occupancyRate?: number;
      lastPriceChangeDate?: string;
    },
    @Request() req?: any,
  ): Promise<ChatResponse> {
    // Validate input
    if (!unitId || unitId.trim().length === 0) {
      throw new BadRequestException('unitId is required');
    }

    // Extract user info from JWT
    const userId = req.user?.id;
    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId,
    );

    if (!userId || !membership) {
      throw new BadRequestException('User not found in tenant');
    }

    const message = `
I need a pricing analysis for a residential unit to ensure competitiveness.

Current Unit Configuration:
- Type: ${dto.unitType || 'Standard'}
- Current rent: ${dto.currentPrice ? `$${dto.currentPrice}` : 'Not set'}
- Bedrooms: ${dto.bedrooms || 'Not specified'}
- Bathrooms: ${dto.bathrooms || 'Not specified'}
- Square feet: ${dto.squareFeet || 'Not specified'}
- Key amenities: ${dto.amenities?.join(', ') || 'Not specified'}
- Current occupancy rate: ${dto.occupancyRate ? `${dto.occupancyRate}%` : 'Not tracked'}
- Last price adjustment: ${dto.lastPriceChangeDate || 'Never'}

Please analyze:
1. Is the current price competitive? (YES/NO with reasoning)
2. Market conditions and demand outlook
3. Suggested optimal rental price
4. Recommended price increase/decrease (if any) and timeline
5. Comparable units in the market
6. Risks of pricing too high or too low

Format your response as JSON with fields: currentPriceAssessment, suggestedPrice, priceChangePercentage, marketConditions, comparables (array), risks (object with tooHighRisks and tooLowRisks), recommendations (array), actionItems (array)
    `.trim();

    return this.assistantService.chat(
      tenantId,
      userId,
      membership.id,
      {
        message,
        page: 'units.pricing',
        unitId,
      },
      membership.roles || [],
    );
  }

  /**
   * POST /tenants/:tenantId/ai/units/maintenance-prediction/:unitId
   *
   * Predict potential maintenance issues for a unit.
   *
   * Analyzes:
   * - Age and condition factors
   * - Common issues for unit type
   * - Maintenance priorities
   * - Cost estimates
   * - Prevention recommendations
   *
   * Returns JSON with: predictedIssues[], priority (LOW/MEDIUM/HIGH), estimatedCost, recommendedActions[]
   */
  @Post('maintenance-prediction/:unitId')
  @UseGuards(RequireFeatureGuard)
  @RequireFeature('canUseAI')
  @ApiOperation({
    summary: 'Predict maintenance issues for a unit',
    description: 'Analyzes unit characteristics to predict potential maintenance needs',
  })
  @ApiResponse({
    status: 200,
    description: 'Maintenance prediction analysis',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid unit or missing required fields',
  })
  @ApiResponse({
    status: 403,
    description: 'Feature not available (canUseAI flag)',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async predictMaintenance(
    @Param('tenantId') tenantId: string,
    @Param('unitId') unitId: string,
    @Body()
    dto: {
      constructionYear?: number;
      unitType?: string;
      bedrooms?: number;
      hasAC?: boolean;
      hasHeating?: boolean;
      roofAge?: number;
      plumbingType?: string;
      electricalType?: string;
      recentRepairs?: string[];
      maintenanceHistory?: string;
    },
    @Request() req?: any,
  ): Promise<ChatResponse> {
    // Validate input
    if (!unitId || unitId.trim().length === 0) {
      throw new BadRequestException('unitId is required');
    }

    // Extract user info from JWT
    const userId = req.user?.id;
    const membership = req.user?.memberships?.find(
      (m: any) => m.tenantId === tenantId,
    );

    if (!userId || !membership) {
      throw new BadRequestException('User not found in tenant');
    }

    const currentYear = new Date().getFullYear();
    const unitAge = dto.constructionYear ? currentYear - dto.constructionYear : null;

    const message = `
I need a maintenance risk assessment and prediction for a residential unit.

Unit Details:
- Type: ${dto.unitType || 'Standard residential'}
- Construction year: ${dto.constructionYear || 'Unknown'} (Age: ${unitAge ? `${unitAge} years` : 'Unknown'})
- Bedrooms: ${dto.bedrooms || 'Not specified'}
- AC system: ${dto.hasAC ? 'Yes' : 'No/Unknown'}
- Heating system: ${dto.hasHeating ? 'Yes' : 'No/Unknown'}
- Roof age: ${dto.roofAge || 'Unknown'} years
- Plumbing type: ${dto.plumbingType || 'Not specified'}
- Electrical type: ${dto.electricalType || 'Not specified'}
- Recent repairs: ${dto.recentRepairs?.join(', ') || 'None documented'}
- Maintenance history: ${dto.maintenanceHistory || 'No history available'}

Please analyze and predict:
1. Most likely maintenance issues in next 12 months
2. Critical vs routine items
3. Priority ranking (CRITICAL/HIGH/MEDIUM/LOW)
4. Estimated cost range for each predicted issue
5. Recommended preventive maintenance schedule
6. Cost savings potential through early prevention

Format your response as JSON with fields: predictedIssues (array with: issue, timeframe, probability, estimatedCost, priority, preventionSteps), overallRiskLevel, estimatedTotalAnnualMaintenance, preventiveMaintenanceSchedule (array), costsAvoidableWithPrevention, recommendations (array)
    `.trim();

    return this.assistantService.chat(
      tenantId,
      userId,
      membership.id,
      {
        message,
        page: 'units.maintenance',
        unitId,
      },
      membership.roles || [],
    );
  }
}
