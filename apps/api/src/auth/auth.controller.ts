import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService, AuthResponse } from './auth.service';
import { PlanFeaturesService } from '../billing/plan-features.service';
import { SentryService } from '../observability/sentry.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface ScopedRole {
  id: string;
  role: string;
  scopeType: string;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
}

interface RequestWithUser extends Request {
  user: {
    id: string;
    email: string;
    name: string;
    memberships: Array<{
      tenantId: string;
      roles: string[];
      scopedRoles?: ScopedRole[];
    }>;
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly planFeatures: PlanFeaturesService,
    private readonly sentryService: SentryService,
  ) {}

  @Post('signup')
  async signup(@Body() signupDto: SignupDto): Promise<AuthResponse> {
    const response = await this.authService.signup(signupDto);

    // Set user context in Sentry for error tracking
    this.sentryService.setUser(response.user.id, response.user.email, response.user.name);

    return response;
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      // Audit: AUTH_FAILED_LOGIN
      await this.authService.logFailedLogin(loginDto.email);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const response = await this.authService.login(user);

    // Set user context in Sentry for error tracking
    this.sentryService.setUser(user.id, user.email, user.name);

    return response;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: RequestWithUser): Promise<Omit<AuthResponse, 'accessToken'>> {
    // req.user contiene { id, email, name, memberships }
    // Retornar en formato esperado por el frontend
    return {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
      },
      memberships: req.user.memberships,
    };
  }

  /**
   * GET /auth/me/subscription
   * Get current user's subscription features for active tenant
   * Frontend uses this to gate UI features
   */
  @UseGuards(JwtAuthGuard)
  @Get('me/subscription')
  async getSubscription(@Request() req: RequestWithUser) {
    // Get first membership's tenant (active tenant)
    const activeMembership = req.user.memberships?.[0];

    if (!activeMembership) {
      return {
        subscription: null,
        features: null,
      };
    }

    const features = await this.planFeatures.getTenantFeatures(
      activeMembership.tenantId,
    );

    return {
      subscription: {
        tenantId: activeMembership.tenantId,
      },
      features,
    };
  }
}
