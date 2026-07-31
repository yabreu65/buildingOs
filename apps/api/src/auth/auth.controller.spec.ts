import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PlanFeaturesService } from '../billing/plan-features.service';
import { SentryService } from '../observability/sentry.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    logoutCurrentSession: jest.Mock;
    logoutAllSessions: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      logoutCurrentSession: jest.fn(),
      logoutAllSessions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: PlanFeaturesService,
          useValue: {
            getTenantFeatures: jest.fn(),
          },
        },
        {
          provide: SentryService,
          useValue: {
            setUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
  });

  it('does not require JwtAuthGuard metadata on POST /auth/logout', () => {
    const logoutGuards = Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.logout) as unknown[] | undefined;
    const logoutAllGuards = Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype.logoutAll) as unknown[] | undefined;

    expect(logoutGuards ?? []).not.toContain(JwtAuthGuard);
    expect(logoutAllGuards ?? []).toContain(JwtAuthGuard);
  });

  it('revokes the current session using refresh and access credentials when present', async () => {
    const res = createResponseMock();
    authService.logoutCurrentSession.mockResolvedValue(undefined);

    await expect(
      controller.logout(
        {
          headers: {
            cookie: 'bo_refresh_token=refresh-123; bo_access_token=access-cookie-123',
          },
        } as never,
        'Bearer access-header-123',
        res as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(authService.logoutCurrentSession).toHaveBeenCalledWith({
      refreshToken: 'refresh-123',
      accessToken: 'access-header-123',
    });
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });

  it('returns ok and clears cookies even when no credentials are present', async () => {
    const res = createResponseMock();
    authService.logoutCurrentSession.mockResolvedValue(undefined);

    await expect(
      controller.logout(
        {
          headers: {},
        } as never,
        undefined,
        res as never,
      ),
    ).resolves.toEqual({ ok: true });

    expect(authService.logoutCurrentSession).toHaveBeenCalledWith({
      refreshToken: null,
      accessToken: null,
    });
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });

  it('clears cookies and propagates infrastructure errors', async () => {
    const res = createResponseMock();
    authService.logoutCurrentSession.mockRejectedValue(new Error('database unavailable'));

    await expect(
      controller.logout(
        {
          headers: {
            cookie: 'bo_refresh_token=refresh-123',
          },
        } as never,
        undefined,
        res as never,
      ),
    ).rejects.toThrow('database unavailable');

    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });

  function createResponseMock() {
    return {
      clearCookie: jest.fn(),
    };
  }
});
