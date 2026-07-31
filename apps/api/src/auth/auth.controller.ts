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
  ACCESS_TOKEN_COOKIE,
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

type LogoutRequest = ExpressRequest & {
  user?: RequestWithUser['user'];
};

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

  /**
   * POST /auth/signup
   * Create a new user, tenant, membership, and authenticated session.
   */
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

  /**
   * POST /auth/login
   * Validate credentials and issue fresh auth cookies for the selected tenant.
   */
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

  /**
   * POST /auth/refresh
   * Rotate the current refresh token and return new auth cookies.
   */
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

  /**
   * POST /auth/logout
   * Revoke the current session if possible, then always clear auth cookies.
   */
  @Post('logout')
  async logout(
    @Request() req: LogoutRequest,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const refreshToken = getCookie(req, REFRESH_TOKEN_COOKIE);
    const cookieAccessToken = getCookie(req, ACCESS_TOKEN_COOKIE);
    const accessToken = this.extractAccessToken(authorization, cookieAccessToken);

    try {
      await this.authService.logoutCurrentSession({
        refreshToken,
        accessToken,
      });
      return { ok: true };
    } finally {
      clearAuthCookies(res);
    }
  }

  /**
   * POST /auth/logout-all
   * Revoke every active session for the current authenticated user.
   */
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

  /**
   * GET /auth/me
   * Return the authenticated user's public profile and memberships.
   */
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

  private extractAccessToken(
    authorization: string | undefined,
    cookieAccessToken: string | null,
  ): string | null {
    if (!authorization) {
      return cookieAccessToken;
    }

    const bearerMatch = authorization.trim().match(/^Bearer\s+(\S+)$/i);
    return bearerMatch?.[1] ?? cookieAccessToken;
  }
}
