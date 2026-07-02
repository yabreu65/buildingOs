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
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { UnsubscribePushDto } from './dto/unsubscribe-push.dto';
import { PushController } from './push.controller';

const validPushEndpoint = 'https://fcm.googleapis.com/fcm/send/subscription-1';

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
    it('upserts a subscription for the requested tenant boundary', async () => {
      const dto = {
        endpoint: validPushEndpoint,
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

    it('uses the tenant header instead of the first membership for subscription writes', async () => {
      const dto = {
        endpoint: validPushEndpoint,
        p256dh: 'client-public-key',
        auth: 'client-auth-secret',
      };

      await expect(
        controller.subscribe(
          dto,
          buildRequest(
            [
              { tenantId: 'tenant-1', roles: ['RESIDENT'] },
              { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
            ],
            'tenant-2',
          ),
        ),
      ).resolves.toEqual({ success: true });

      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_userId_endpoint: {
              tenantId: 'tenant-2',
              userId: 'user-1',
              endpoint: dto.endpoint,
            },
          },
          create: expect.objectContaining({ tenantId: 'tenant-2' }),
        }),
      );
    });

    it('rejects users without tenant memberships', async () => {
      await expect(
        controller.subscribe(
          {
            endpoint: validPushEndpoint,
            p256dh: 'client-public-key',
            auth: 'client-auth-secret',
          },
          buildRequest([]),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('rejects an unauthorized tenant header before upserting a subscription', async () => {
      await expect(
        controller.subscribe(
          {
            endpoint: validPushEndpoint,
            p256dh: 'client-public-key',
            auth: 'client-auth-secret',
          },
          buildRequest(undefined, 'tenant-2'),
        ),
      ).rejects.toThrow('No tiene acceso al tenant tenant-2');

      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('rejects a missing tenant header before upserting a subscription', async () => {
      await expect(
        controller.subscribe(
          {
            endpoint: validPushEndpoint,
            p256dh: 'client-public-key',
            auth: 'client-auth-secret',
          },
          buildRequest(undefined, null),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('rejects an invalid endpoint before upserting a subscription', async () => {
      await expect(
        controller.subscribe(
          {
            endpoint: 'http://fcm.googleapis.com/fcm/send/subscription-1',
            p256dh: 'client-public-key',
            auth: 'client-auth-secret',
          },
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it('rejects non-push HTTPS endpoints before upserting a subscription', async () => {
      await expect(
        controller.subscribe(
          {
            endpoint: 'https://example.com/push',
            p256dh: 'client-public-key',
            auth: 'client-auth-secret',
          },
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
    });

    it.each([{}, { endpoint: undefined }, { endpoint: '' }, { endpoint: '   ' }])(
      'rejects a missing or empty endpoint before upserting a subscription',
      async (body) => {
        await expect(subscribeThroughValidationPipe(body)).rejects.toMatchObject({
          status: 400,
        });

        expect(prisma.pushSubscription.upsert).not.toHaveBeenCalled();
      },
    );
  });

  describe('unsubscribe', () => {
    it('revokes only the authenticated user subscription in the requested tenant boundary', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: validPushEndpoint },
          buildRequest(),
        ),
      ).resolves.toEqual({ success: true });

      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
      const [updateInput] = prisma.pushSubscription.updateMany.mock.calls[0]!;

      expect(updateInput.where).toEqual({
        tenantId: 'tenant-1',
        userId: 'user-1',
        endpoint: validPushEndpoint,
        revokedAt: null,
      });
      expect(updateInput.data.revokedAt).toBeInstanceOf(Date);
    });

    it('uses the tenant header instead of the first membership for subscription revokes', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: validPushEndpoint },
          buildRequest(
            [
              { tenantId: 'tenant-1', roles: ['RESIDENT'] },
              { tenantId: 'tenant-2', roles: ['TENANT_ADMIN'] },
            ],
            'tenant-2',
          ),
        ),
      ).resolves.toEqual({ success: true });

      expect(prisma.pushSubscription.updateMany).toHaveBeenCalledTimes(1);
      const [updateInput] = prisma.pushSubscription.updateMany.mock.calls[0]!;

      expect(updateInput.where).toEqual({
        tenantId: 'tenant-2',
        userId: 'user-1',
        endpoint: validPushEndpoint,
        revokedAt: null,
      });
    });

    it('rejects users without tenant memberships', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: validPushEndpoint },
          buildRequest([]),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an unauthorized tenant header before revoking subscriptions', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: validPushEndpoint },
          buildRequest(undefined, 'tenant-2'),
        ),
      ).rejects.toThrow('No tiene acceso al tenant tenant-2');

      expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a missing tenant header before revoking subscriptions', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: validPushEndpoint },
          buildRequest(undefined, null),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('rejects an invalid endpoint before revoking subscriptions', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: 'https://127.0.0.1/subscription-1' },
          buildRequest(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.pushSubscription.updateMany).not.toHaveBeenCalled();
    });

    it('rejects non-push HTTPS endpoints before revoking subscriptions', async () => {
      await expect(
        controller.unsubscribe(
          { endpoint: 'https://example.com/push' },
          buildRequest(),
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

  async function subscribeThroughValidationPipe(
    body: unknown,
  ): Promise<{ success: true }> {
    const dto = await validateSubscribeBody(body);

    return controller.subscribe(dto, buildRequest());
  }

  async function validateSubscribeBody(body: unknown): Promise<SubscribePushDto> {
    const pipe = buildValidationPipe();

    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: SubscribePushDto,
      data: undefined,
    };

    return pipe.transform(body, metadata) as Promise<SubscribePushDto>;
  }

  async function unsubscribeThroughValidationPipe(
    body: unknown,
  ): Promise<{ success: true }> {
    const dto = await validateUnsubscribeBody(body);

    return controller.unsubscribe(dto, buildRequest());
  }

  async function validateUnsubscribeBody(
    body: unknown,
  ): Promise<UnsubscribePushDto> {
    const pipe = buildValidationPipe();

    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: UnsubscribePushDto,
      data: undefined,
    };

    return pipe.transform(body, metadata) as Promise<UnsubscribePushDto>;
  }

  function buildValidationPipe(): ValidationPipe {
    return new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });
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
    tenantId: string | null = 'tenant-1',
  ): AuthenticatedRequest {
    return {
      headers: tenantId ? { 'x-tenant-id': tenantId } : {},
      user: {
        id: 'user-1',
        email: 'user@example.com',
        memberships,
      },
    } as AuthenticatedRequest;
  }
});
