import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, AuthResponse } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenancyService } from '../tenancy/tenancy.service';
import { AuditService } from '../audit/audit.service';
import { SignupDto, TenantTypeEnum } from './dto/signup.dto';
import { AuditAction } from '@prisma/client';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;
  let tenancyService: TenancyService;
  let auditService: AuditService;

  // ========== SETUP ==========
  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
            tenant: {
              create: jest.fn(),
            },
            membership: {
              create: jest.fn(),
            },
            membershipRole: {
              create: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: TenancyService,
          useValue: {
            getMembershipsForUser: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: {
            createLog: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
    tenancyService = module.get<TenancyService>(TenancyService);
    auditService = module.get<AuditService>(AuditService);
  });

  // ========== CLEANUP ==========
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========== TESTS: SIGNUP ==========
  describe('signup', () => {
    it('should create a new user with tenant and memberships', async () => {
      // ARRANGE
      const dto: SignupDto = {
        email: 'newuser@example.com',
        name: 'New User',
        password: 'SecurePass123',
        tenantName: 'My Building',
        tenantType: TenantTypeEnum.EDIFICIO_AUTOGESTION,
      };

      const hashedPassword = 'hashed_password_123';
      const createdUser = {
        id: 'user-123',
        email: 'newuser@example.com',
        name: 'New User',
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const createdTenant = {
        id: 'tenant-123',
        name: 'My Building',
        type: TenantTypeEnum.EDIFICIO_AUTOGESTION,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const createdMembership = {
        id: 'membership-123',
        userId: 'user-123',
        tenantId: 'tenant-123',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const memberships = [
        {
          tenantId: 'tenant-123',
          roles: ['TENANT_OWNER'],
        },
      ];

      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      jest.spyOn(prismaService, '$transaction').mockImplementation(async (callback) => {
        return callback({
          user: {
            create: jest.fn().mockResolvedValue(createdUser),
            findUnique: jest.fn(),
          },
          tenant: {
            create: jest.fn().mockResolvedValue(createdTenant),
          },
          membership: {
            create: jest.fn().mockResolvedValue(createdMembership),
          },
          membershipRole: {
            create: jest.fn().mockResolvedValue({}),
          },
        });
      });
      jest.spyOn(tenancyService, 'getMembershipsForUser').mockResolvedValue(memberships as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('jwt_token_123');
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.signup(dto);

      // ASSERT
      expect(result).toEqual({
        accessToken: 'jwt_token_123',
        user: {
          id: 'user-123',
          email: 'newuser@example.com',
          name: 'New User',
        },
        memberships,
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
      expect(jwtService.sign).toHaveBeenCalledWith({
        email: 'newuser@example.com',
        sub: 'user-123',
        isSuperAdmin: false,
        roles: ['TENANT_OWNER'],
      });
    });

    it('should use default tenant name and type', async () => {
      // ARRANGE
      const dto: SignupDto = {
        email: 'user@example.com',
        name: 'User',
        password: 'SecurePass123',
      };

      const hashedPassword = 'hashed_password';
      const createdUser = {
        id: 'user-456',
        email: 'user@example.com',
        name: 'User',
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const createdTenant = {
        id: 'tenant-456',
        name: 'Mi Condominio',
        type: TenantTypeEnum.EDIFICIO_AUTOGESTION,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const createdMembership = {
        id: 'membership-456',
        userId: 'user-456',
        tenantId: 'tenant-456',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (bcrypt.hash as jest.Mock).mockResolvedValue(hashedPassword);
      jest.spyOn(prismaService, '$transaction').mockImplementation(async (callback) => {
        return callback({
          user: { create: jest.fn().mockResolvedValue(createdUser) },
          tenant: { create: jest.fn().mockResolvedValue(createdTenant) },
          membership: { create: jest.fn().mockResolvedValue(createdMembership) },
          membershipRole: { create: jest.fn().mockResolvedValue({}) },
        });
      });
      jest.spyOn(tenancyService, 'getMembershipsForUser').mockResolvedValue([
        { tenantId: 'tenant-456', roles: ['TENANT_OWNER'] },
      ] as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('jwt_token');
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.signup(dto);

      // ASSERT
      expect(result.user.email).toBe('user@example.com');
      expect(tenancyService.getMembershipsForUser).toHaveBeenCalledWith('user-456');
    });

    it('should throw ConflictException if email already exists', async () => {
      // ARRANGE
      const dto: SignupDto = {
        email: 'existing@example.com',
        name: 'User',
        password: 'SecurePass123',
      };

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue({
        id: 'existing-user',
        email: 'existing@example.com',
        name: 'Existing',
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      // ACT & ASSERT
      await expect(service.signup(dto)).rejects.toThrow(ConflictException);
      await expect(service.signup(dto)).rejects.toThrow('El email ya está registrado');
    });

    it('should throw BadRequestException if password too short', async () => {
      // ARRANGE
      const dto: SignupDto = {
        email: 'user@example.com',
        name: 'User',
        password: 'short',
      };

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.signup(dto)).rejects.toThrow(BadRequestException);
      await expect(service.signup(dto)).rejects.toThrow(
        'La contraseña debe tener al menos 8 caracteres',
      );
    });

    it('should throw BadRequestException if password is empty', async () => {
      // ARRANGE
      const dto: SignupDto = {
        email: 'user@example.com',
        name: 'User',
        password: '',
      };

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      // ACT & ASSERT
      await expect(service.signup(dto)).rejects.toThrow(BadRequestException);
    });
  });

  // ========== TESTS: VALIDATE USER ==========
  describe('validateUser', () => {
    it('should return user with memberships on valid credentials', async () => {
      // ARRANGE
      const email = 'user@example.com';
      const password = 'SecurePass123';
      const hashedPassword = 'hashed_password_123';

      const user = {
        id: 'user-123',
        email,
        name: 'User Name',
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
        memberships: [
          {
            id: 'membership-123',
            userId: 'user-123',
            tenantId: 'tenant-123',
            createdAt: new Date(),
            updatedAt: new Date(),
            roles: [{ role: 'TENANT_OWNER', membershipId: 'membership-123' }],
          },
        ],
      };

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      // ACT
      const result = await service.validateUser(email, password);

      // ASSERT
      expect(result).toEqual({
        id: 'user-123',
        email,
        name: 'User Name',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        memberships: [
          {
            id: 'membership-123',
            userId: 'user-123',
            tenantId: 'tenant-123',
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
            roles: [{ role: 'TENANT_OWNER', membershipId: 'membership-123' }],
          },
        ],
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(password, hashedPassword);
    });

    it('should return null on invalid password', async () => {
      // ARRANGE
      const email = 'user@example.com';
      const password = 'WrongPassword';
      const hashedPassword = 'hashed_password_123';

      const user = {
        id: 'user-123',
        email,
        name: 'User Name',
        passwordHash: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
        memberships: [],
      };

      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(user as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // ACT
      const result = await service.validateUser(email, password);

      // ASSERT
      expect(result).toBeNull();
    });

    it('should return null if user not found', async () => {
      // ARRANGE
      jest.spyOn(prismaService.user, 'findUnique').mockResolvedValue(null);

      // ACT
      const result = await service.validateUser('nonexistent@example.com', 'password');

      // ASSERT
      expect(result).toBeNull();
    });
  });

  // ========== TESTS: LOGIN ==========
  describe('login', () => {
    it('should return auth response for non-superadmin user', async () => {
      // ARRANGE
      const user = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'User Name',
        memberships: [
          {
            tenantId: 'tenant-123',
            roles: [{ role: 'TENANT_OWNER' }],
          },
        ],
      };

      const memberships = [
        {
          tenantId: 'tenant-123',
          roles: ['TENANT_OWNER'],
        },
      ];

      jest.spyOn(tenancyService, 'getMembershipsForUser').mockResolvedValue(memberships as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('jwt_token_123');
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.login(user as any);

      // ASSERT
      expect(result).toEqual({
        accessToken: 'jwt_token_123',
        user: {
          id: 'user-123',
          email: 'user@example.com',
          name: 'User Name',
        },
        memberships,
      });
      expect(jwtService.sign).toHaveBeenCalledWith({
        email: 'user@example.com',
        sub: 'user-123',
        isSuperAdmin: false,
        roles: ['TENANT_OWNER'],
      });
    });

    it('should set isSuperAdmin=true when user has SUPER_ADMIN role', async () => {
      // ARRANGE
      const user = {
        id: 'super-user-123',
        email: 'admin@example.com',
        name: 'Admin User',
        memberships: [
          {
            tenantId: 'tenant-123',
            roles: [
              { role: 'SUPER_ADMIN' },
              { role: 'TENANT_OWNER' },
            ],
          },
        ],
      };

      const memberships = [
        {
          tenantId: 'tenant-123',
          roles: ['SUPER_ADMIN', 'TENANT_OWNER'],
        },
      ];

      jest.spyOn(tenancyService, 'getMembershipsForUser').mockResolvedValue(memberships as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('jwt_token_admin');
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      const result = await service.login(user as any);

      // ASSERT
      expect(jwtService.sign).toHaveBeenCalledWith({
        email: 'admin@example.com',
        sub: 'super-user-123',
        isSuperAdmin: true,
        roles: ['SUPER_ADMIN', 'TENANT_OWNER'],
      });
    });

    it('should log login audit event', async () => {
      // ARRANGE
      const user = {
        id: 'user-123',
        email: 'user@example.com',
        name: 'User Name',
        memberships: [
          {
            tenantId: 'tenant-123',
            roles: [{ role: 'TENANT_OWNER' }],
          },
        ],
      };

      jest.spyOn(tenancyService, 'getMembershipsForUser').mockResolvedValue([
        { tenantId: 'tenant-123', roles: ['TENANT_OWNER'] },
      ] as any);
      jest.spyOn(jwtService, 'sign').mockReturnValue('jwt_token');
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      await service.login(user as any);

      // ASSERT
      expect(auditService.createLog).toHaveBeenCalledWith({
        actorUserId: 'user-123',
        action: AuditAction.AUTH_LOGIN,
        entityType: 'User',
        entityId: 'user-123',
        metadata: {
          email: 'user@example.com',
          isSuperAdmin: false,
        },
      });
    });
  });

  // ========== TESTS: LOG FAILED LOGIN ==========
  describe('logFailedLogin', () => {
    it('should log failed login attempt', async () => {
      // ARRANGE
      const email = 'user@example.com';
      jest.spyOn(auditService, 'createLog').mockResolvedValue(undefined);

      // ACT
      await service.logFailedLogin(email);

      // ASSERT
      expect(auditService.createLog).toHaveBeenCalledWith({
        action: AuditAction.AUTH_FAILED_LOGIN,
        entityType: 'User',
        entityId: email,
        metadata: {
          email,
        },
      });
    });
  });
});
