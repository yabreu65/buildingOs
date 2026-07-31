import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import request from 'supertest';
import { InvitationsPublicController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

describe('InvitationsPublicController validation', () => {
  let app: INestApplication;
  let httpServer: Server;

  const invitationsService = {
    validateToken: jest.fn(),
  } satisfies Pick<InvitationsService, 'validateToken'>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InvitationsPublicController],
      providers: [
        {
          provide: InvitationsService,
          useValue: invitationsService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    invitationsService.validateToken.mockResolvedValue({
      tenantId: 'tenant-a',
      tenantName: 'Tenant A',
      email: 'resident@example.com',
      roles: ['RESIDENT'],
      expiresAt: new Date('2026-07-31T00:00:00.000Z'),
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('trims a valid token before calling the service', async () => {
    await request(httpServer)
      .get('/invitations/validate?token=%20abcdefghij%20')
      .expect(200);

    expect(invitationsService.validateToken).toHaveBeenCalledWith('abcdefghij');
  });

  it.each([
    ['blank token', '/invitations/validate?token=%20%20'],
    ['unknown query', '/invitations/validate?token=abcdefghij&extra=1'],
  ])('rejects %s with 400 and does not call the service', async (_label, path) => {
    await request(httpServer).get(path).expect(400);

    expect(invitationsService.validateToken).not.toHaveBeenCalled();
  });
});
