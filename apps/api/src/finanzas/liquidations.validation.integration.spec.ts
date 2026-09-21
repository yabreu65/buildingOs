import { CanActivate, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request = require("supertest");
import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../common/types/request.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TenantAccessGuard } from "../tenancy/tenant-access.guard";
import { LiquidationsController } from "./liquidations.controller";
import { LiquidationsService } from "./liquidations.service";

const alwaysPass: CanActivate = { canActivate: () => true };
const modernId = "c123456789012345678901234";
const historicalId = "seed-legacy-backfill-conflict-liq-2025-12";
const baseUrl = "/tenants/t-1/finance/liquidations";

interface LiquidationServiceMock {
  listLiquidations: jest.Mock;
  getLiquidation: jest.Mock;
  reviewLiquidation: jest.Mock;
  publishLiquidation: jest.Mock;
  cancelLiquidation: jest.Mock;
}

describe("LiquidationsController ValidationPipe integration", () => {
  let app: INestApplication;
  let service: LiquidationServiceMock;

  beforeAll(async () => {
    service = {
      listLiquidations: jest.fn().mockResolvedValue([{ id: historicalId }]),
      getLiquidation: jest.fn().mockResolvedValue({ id: historicalId }),
      reviewLiquidation: jest.fn().mockResolvedValue({ id: modernId }),
      publishLiquidation: jest.fn().mockResolvedValue({ id: modernId }),
      cancelLiquidation: jest.fn().mockResolvedValue({ id: modernId }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [LiquidationsController],
      providers: [{ provide: LiquidationsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(alwaysPass)
      .overrideGuard(TenantAccessGuard)
      .useValue(alwaysPass)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const authenticatedRequest = req as Request &
        Partial<AuthenticatedRequest>;
      authenticatedRequest.tenantId = "t-1";
      authenticatedRequest.user = {
        id: "user-1",
        email: "admin@test.com",
        membershipId: "member-1",
        tenantId: "t-1",
        effectiveMembership: {
          id: "member-1",
          tenantId: "t-1",
          roles: ["TENANT_ADMIN"],
        },
        roles: ["TENANT_ADMIN"],
      };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes the exact historical ID from list into GET detail", async () => {
    const listResponse = await request(app.getHttpServer()).get(baseUrl);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body).toEqual([{ id: historicalId }]);

    const detailResponse = await request(app.getHttpServer()).get(
      `${baseUrl}/${listResponse.body[0].id}`,
    );

    expect(detailResponse.status).toBe(200);
    expect(service.getLiquidation).toHaveBeenCalledWith(
      "t-1",
      historicalId,
      "member-1",
    );
  });

  it("accepts both modern and historical IDs for GET detail", async () => {
    for (const liquidationId of [modernId, historicalId]) {
      const response = await request(app.getHttpServer()).get(
        `${baseUrl}/${liquidationId}`,
      );

      expect(response.status).toBe(200);
      expect(service.getLiquidation).toHaveBeenLastCalledWith(
        "t-1",
        liquidationId,
        "member-1",
      );
    }
  });

  it.each(["bad%25id", "bad%20id", "bad%3Fid", "bad%23id"])(
    "rejects unsafe GET ID %s",
    async (encodedId) => {
      const response = await request(app.getHttpServer()).get(
        `${baseUrl}/${encodedId}`,
      );

      expect(response.status).toBe(400);
      expect(service.getLiquidation).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "review",
      () =>
        request(app.getHttpServer()).post(`${baseUrl}/${historicalId}/review`),
    ],
    [
      "publish",
      () =>
        request(app.getHttpServer())
          .post(`${baseUrl}/${historicalId}/publish`)
          .send({ dueDate: "2026-06-10" }),
    ],
    [
      "cancel",
      () =>
        request(app.getHttpServer())
          .post(`${baseUrl}/${historicalId}/cancel`)
          .send({ reason: "test" }),
    ],
  ])("rejects historical ID before %s", async (_operation, sendRequest) => {
    const response = await sendRequest();

    expect(response.status).toBe(400);
    expect(service.reviewLiquidation).not.toHaveBeenCalled();
    expect(service.publishLiquidation).not.toHaveBeenCalled();
    expect(service.cancelLiquidation).not.toHaveBeenCalled();
  });

  it("keeps modern IDs accepted by every lifecycle endpoint", async () => {
    await expect(
      request(app.getHttpServer()).post(`${baseUrl}/${modernId}/review`),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      request(app.getHttpServer())
        .post(`${baseUrl}/${modernId}/publish`)
        .send({ dueDate: "2026-06-10" }),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      request(app.getHttpServer())
        .post(`${baseUrl}/${modernId}/cancel`)
        .send({ reason: "test" }),
    ).resolves.toMatchObject({ status: 200 });

    expect(service.reviewLiquidation).toHaveBeenCalledWith(
      "t-1",
      modernId,
      "member-1",
    );
    expect(service.publishLiquidation).toHaveBeenCalledWith(
      "t-1",
      modernId,
      "member-1",
      { dueDate: "2026-06-10" },
    );
    expect(service.cancelLiquidation).toHaveBeenCalledWith(
      "t-1",
      modernId,
      "member-1",
      { reason: "test" },
    );
  });
});
