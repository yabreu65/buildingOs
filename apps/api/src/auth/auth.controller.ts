import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  Headers,
  UnauthorizedException,
  Res,
} from '@nestjs/common';
import type { Response, Request as ExpressRequest } from 'express';
import { AuthService, AuthResponse } from './auth.service';
import { PlanFeaturesService } from '../billing/plan-features.service';
import { SentryService } from '../observability/sentry.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  clearAuthCookies,
  getCookie,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from './auth.cookies';

interface ScopedRole {
  id: string;
  role: string;
  scopeType: string;
  scopeBuildingId: string | null;
  scopeUnitId: string | null;
}

interface RequestWithUser extends ExpressRequest {
  user: {
    id: string;
    email: string;
    name: string;
    memberships: Array<{
      tenantId: string;
      roles: string[];
      scopedRoles?: ScopedRole[];
    }>;
    sessionId?: string;
  };
}

interface PublicAuthResponse {
  user: AuthResponse['user'];
  memberships: AuthResponse['memberships'];
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly planFeatures: PlanFeaturesService,
    private readonly sentryService: SentryService,
  ) {}

  private buildResponse(response: AuthResponse): PublicAuthResponse {
    return {
      user: response.user,
      memberships: response.memberships,
    };
  }

  @Post('signup')
  async signup(
    @Body() signupDto: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicAuthResponse> {
    const response = await this.authService.signup(signupDto);
    setAuthCookies(res, response.accessToken, response.refreshToken);

    // Set user context in Sentry for error tracking
    this.sentryService.setUser(response.user.id, response.user.email, response.user.name);

    return this.buildResponse(response);
  }

  @Post('login')
  async login(
    @Body() loginDto: LoginDto,
    @Headers('x-tenant-id') selectedTenantId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicAuthResponse> {
    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
    );
    if (!user) {
      // Audit: AUTH_FAILED_LOGIN
      await this.authService.logFailedLogin(loginDto.email);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const response = await this.authService.login(user, selectedTenantId ?? null);
    setAuthCookies(res, response.accessToken, response.refreshToken);

    // Set user context in Sentry for error tracking
    this.sentryService.setUser(user.id, user.email, user.name);

    return this.buildResponse(response);
  }

  @Post('refresh')
  async refresh(
    @Request() req: ExpressRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicAuthResponse> {
    const refreshToken = getCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException('Sesión expirada. Vuelve a iniciar sesión.');
    }

    const response = await this.authService.refreshSession(refreshToken);
    setAuthCookies(res, response.accessToken, response.refreshToken);
    return this.buildResponse(response);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Request() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    if (req.user.sessionId) {
      await this.authService.logoutSession(req.user.sessionId);
    }

    clearAuthCookies(res);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(
    @Request() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.authService.logoutAllSessions(req.user.id);
    clearAuthCookies(res);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(
    @Request() req: RequestWithUser,
  ): Promise<PublicAuthResponse> {
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
