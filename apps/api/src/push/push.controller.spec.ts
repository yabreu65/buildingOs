import {
  BadRequestException,
  RequestMethod,
  ValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/types/request.types';
import { PrismaService } from '../prisma/prisma.service';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';
import { PushController } from './push.controller';

interface PushSubscriptionDelegateMock {
  readonly upsert: jest.Mock<
    Promise<{ id: string }>,
    [PushSubscriptionUpsertInput]
  >;
  readonly updateMany: jest.Mock<
    Promise<{ count: number }>,
    [PushSubscriptionUpdateManyInput]
  >;
}

interface PrismaServiceMock {
  readonly pushSubscription: PushSubscriptionDelegateMock;
}

interface PushSubscriptionUpsertInput {
  readonly where: {
    readonly tenantId_userId_endpoint: {
      readonly tenantId: string;
      readonly userId: string;
      readonly endpoint: string;
    };
  };
  readonly create: {
    readonly tenantId: string;
    readonly userId: string;
    readonly endpoint: string;
    readonly p256dh: string;
    readonly auth: string;
  };
  readonly update: {
    readonly p256dh: string;
    readonly auth: string;
    readonly revokedAt: null;
  };
}

interface PushSubscriptionUpdateManyInput {
  readonly where: {
    readonly tenantId: string;
    readonly userId: string;
    readonly endpoint: string;
    readonly revokedAt: null;
  };
  readonly data: {
    readonly revokedAt: Date;
  };
}

describe('PushController', () => {
  let controller: PushController;
  let prisma: PrismaServiceMock;

  beforeEach(() => {
    prisma = {
      pushSubscription: {
        upsert: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    controller = new PushController(prisma as unknown as PrismaService);
  });

  describe('route metadata', () => {
    it('uses the push controller path and JWT auth guard', () => {
      expect(Reflect.getMetadata(PATH_METADATA, PushController)).toBe('push');
      expect(Reflect.getMetadata('__guards__', PushController)).toContain(
        JwtAuthGuard,
      );
    });

    it.each([
      ['subscribe', 'subscribe'],
      ['unsubscribe', 'unsubscribe'],
    ] as const)('binds POST /push/%s', (methodName, path) => {
      const method = getControllerMethod(methodName);

      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(
        RequestMethod.POST,
      );
    });
  });

  describe('subscribe', () => {
    it('upserts a subscription for the authenticated user tenant boundary', async () => {
      const dto = {
        endpoint: 'https://push.example/subscription-1',
        p256dh: 'client-public-key',
        auth: 'client-auth-secret',
      };

      await expect(controller.subscribe(dto, buildRequest())).resolves.toEqual({
        success: true,
      });

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_userId_endpoint: {
            tenantId: 'tenant-1',
            userId: 'user-1',
            endpoint: dto.endpoint,
          },
        },
        create: {
          tenantId: 'tenant-1',
          userId: 'user-1',
          endpoint: dto.endpoint,
          p256dh: dto.p256dh,
          auth: dto.auth,
        },
        update: {
          p256dh: dto.p256dh,
          auth: dto.auth,
          revokedAt: null,
        },
      });
    });

    it('rejects users without tenant memberships', async () => {
      await expect(
        controller.subscribe(
          {
            endpoint: 'https://push.example/subscription-1',
            p256dh: 'client-public-key',
            auth: 'client-auth-secret',
          },
          buildRequest([]),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('revokes only the authenticated user subscription in the tenant boundary', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: 'https://push.example/subscription-1' },
          buildRequest(),
        ),
      ).resolves.toEqual({ success: true });

      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
      const [updateInput] = prisma.pushSubscription.updateMany.mock.calls[0]!;

      expect(updateInput.where).toEqual({
        tenantId: 'tenant-1',
        userId: 'user-1',
        endpoint: 'https://push.example/subscription-1',
        revokedAt: null,
      });
      expect(updateInput.data.revokedAt).toBeInstanceOf(Date);
    });

    it('rejects users without tenant memberships', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: 'https://push.example/subscription-1' },
          buildRequest([]),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
    });

    it.each([{}, { endpoint: undefined }])(
      'rejects a missing endpoint before revoking subscriptions',
      async (body) => {
        await expect(
          unsubscribeThroughValidationPipe(body),
        ).rejects.toMatchObject({
          status: 400,
        });

        expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each([{ endpoint: '' }, { endpoint: '   ' }])(
      'rejects an empty endpoint before revoking subscriptions',
      async (body) => {
        await expect(
          unsubscribeThroughValidationPipe(body),
        ).rejects.toMatchObject({
          status: 400,
        });

        expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  async function unsubscribeThroughValidationPipe(
    body: unknown,
  ): Promise<{ success: true }> {
    const dto = await validateUnsubscribeBody(body);

    return controller.unsubscribe(dto, buildRequest());
  }

  async function validateUnsubscribeBody(
    body: unknown,
  ): Promise<UnsubscribePushDto> {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: UnsubscribePushDto,
      data: undefined,
    };

    return pipe.transform(body, metadata) as Promise<UnsubscribePushDto>;
  }

  function getControllerMethod(
    methodName: 'subscribe' | 'unsubscribe',
  ): (...args: readonly unknown[]) => unknown {
    const method = Reflect.get(PushController.prototype, methodName);
    if (typeof method !== 'function') {
      throw new Error(`${methodName} is not a controller method`);
    }

    return method as (...args: readonly unknown[]) => unknown;
  }

  function buildRequest(
    memberships: AuthenticatedRequest['user']['memberships'] = [
      { tenantId: 'tenant-1', roles: ['RESIDENT'] },
    ],
  ): AuthenticatedRequest {
    return {
      user: {
        id: 'user-1',
        email: 'user@example.com',
        memberships,
      },
    } as AuthenticatedRequest;
  }
});
