import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import {
  type ApiRole,
  type LicenseStatus,
  type PlanType,
  type PrismaClient,
  type RefreshToken,
  type User,
  type UserRole,
} from '@prisma/client';
import type { LicenseService } from './licenseService.js';
import { appLogger } from '../utils/logger.js';

const ACCESS_TOKEN_EXPIRY = '15m' as const;
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export type SafeUser = Omit<User, 'passwordHash'>;

export type CreateUserInput = {
  tenantId?: string;
  email: string;
  password: string;
  displayName: string;
  role: UserRole;
};

export type UpdateUserInput = {
  displayName?: string | undefined;
  role?: UserRole | undefined;
  isActive?: boolean | undefined;
};

export type AccessTokenPayload = {
  sub: string;
  role: UserRole;
  email: string;
  tenantId: string;
  type: 'access';
};

type RefreshTokenRecord = RefreshToken & {
  user: User;
};

type AuthServiceOptions = {
  licenseService?: LicenseService | null;
  jwtSecret?: string;
};

const PLAN_TYPE_BY_LICENSE_PLAN: Record<string, PlanType> = {
  starter: 'STARTER',
  pro: 'PRO',
  enterprise: 'ENTERPRISE',
};

const LICENSE_STATUS_BY_RUNTIME: Record<string, LicenseStatus> = {
  valid: 'ACTIVE',
  grace_period: 'ACTIVE',
  expired: 'EXPIRED',
  suspended: 'SUSPENDED',
  cancelled: 'CANCELLED',
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string): string {
  return displayName.trim();
}

function mapUserRoleToApiRole(role: UserRole): ApiRole {
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'ANALYST') return 'OPERATOR';
  return 'READER';
}

function extractRefreshTokenTenantId(refreshToken: string): string | null {
  const separatorIndex = refreshToken.indexOf('.');
  if (separatorIndex <= 0) {
    return null;
  }
  return refreshToken.slice(0, separatorIndex);
}

export class AuthServiceError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, details?: Record<string, unknown>) {
    super(code);
    this.name = 'AuthServiceError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class AuthService {
  private readonly prisma: PrismaClient;
  private readonly licenseService: LicenseService | null;
  private readonly jwtSecret: string;
  private resolvedTenantId: string | null = null;

  constructor(prismaClient: PrismaClient, options: AuthServiceOptions = {}) {
    this.prisma = prismaClient;
    this.licenseService = options.licenseService ?? null;
    this.jwtSecret = this.resolveJwtSecret(options.jwtSecret);
  }

  async createUser(data: CreateUserInput): Promise<SafeUser> {
    const tenantId = await this.resolveInstallationTenantId(data.tenantId);
    const email = normalizeEmail(data.email);
    const displayName = normalizeDisplayName(data.displayName);

    const [existingUser, currentUserCount] = await Promise.all([
      this.prisma.user.findFirst({
        where: { tenantId, email },
      }),
      this.prisma.user.count({
        where: { tenantId, isActive: true },
      }),
    ]);

    if (existingUser) {
      throw new AuthServiceError('USER_ALREADY_EXISTS');
    }

    const maxUsers = this.licenseService?.getMaxUsers() ?? -1;
    if (maxUsers !== -1 && currentUserCount >= maxUsers) {
      throw new AuthServiceError('USER_LIMIT_REACHED', {
        maxUsers,
        currentCount: currentUserCount,
      });
    }

    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const createdUser = await this.prisma.user.create({
      data: {
        tenantId,
        email,
        passwordHash,
        displayName,
        role: data.role,
      },
    });

    return this.sanitizeUser(createdUser);
  }

  async createFirstAdmin(data: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<SafeUser> {
    const tenantId = await this.resolveInstallationTenantId();
    const userCount = await this.prisma.user.count({
      where: { tenantId },
    });

    if (userCount > 0) {
      throw new AuthServiceError('ADMIN_ALREADY_EXISTS');
    }

    return this.createUser({
      tenantId,
      email: data.email,
      password: data.password,
      displayName: data.displayName,
      role: 'ADMIN',
    });
  }

  async needsSetup(): Promise<boolean> {
    const tenantId = await this.resolveInstallationTenantId();
    const userCount = await this.prisma.user.count({
      where: { tenantId },
    });
    return userCount === 0;
  }

  async login(
    email: string,
    password: string,
    tenantId?: string
  ): Promise<{ accessToken: string; refreshToken: string; user: SafeUser }> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const normalizedEmail = normalizeEmail(email);
    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: resolvedTenantId,
        email: normalizedEmail,
      },
    });

    if (!user || !user.isActive) {
      throw new AuthServiceError('INVALID_CREDENTIALS');
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new AuthServiceError('INVALID_CREDENTIALS');
    }

    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(resolvedTenantId);
    const expiresAt = this.buildRefreshTokenExpiryDate();

    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          tenantId: resolvedTenantId,
          token: refreshToken,
          userId: user.id,
          expiresAt,
        },
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      user: this.sanitizeUser({
        ...user,
        lastLoginAt: new Date(),
      }),
    };
  }

  async refreshTokens(
    refreshToken: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const existingToken = await this.findValidRefreshToken(refreshToken);
    const newAccessToken = this.generateAccessToken(existingToken.user);
    const newRefreshToken = this.generateRefreshToken(existingToken.tenantId);
    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { revokedAt: now },
      }),
      this.prisma.refreshToken.create({
        data: {
          tenantId: existingToken.tenantId,
          token: newRefreshToken,
          userId: existingToken.userId,
          expiresAt: this.buildRefreshTokenExpiryDate(),
        },
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    const tenantId = extractRefreshTokenTenantId(refreshToken);
    if (!tenantId) {
      return;
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        tenantId,
        token: refreshToken,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string, tenantId?: string): Promise<void> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    await this.prisma.refreshToken.updateMany({
      where: {
        tenantId: resolvedTenantId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const payload = jwt.verify(token, this.jwtSecret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload;

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      !this.isUserRole(payload.role)
    ) {
      throw new AuthServiceError('INVALID_ACCESS_TOKEN');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      type: 'access',
    };
  }

  async getUsers(tenantId?: string): Promise<SafeUser[]> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const users = await this.prisma.user.findMany({
      where: { tenantId: resolvedTenantId },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((user) => this.sanitizeUser(user));
  }

  async getUserById(userId: string, tenantId?: string): Promise<SafeUser> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: resolvedTenantId,
        id: userId,
      },
    });

    if (!user) {
      throw new AuthServiceError('USER_NOT_FOUND');
    }

    return this.sanitizeUser(user);
  }

  async updateUser(
    userId: string,
    data: UpdateUserInput,
    tenantId?: string
  ): Promise<SafeUser> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const existingUser = await this.prisma.user.findFirst({
      where: {
        tenantId: resolvedTenantId,
        id: userId,
      },
    });

    if (!existingUser) {
      throw new AuthServiceError('USER_NOT_FOUND');
    }

    const nextRole = data.role ?? existingUser.role;
    const nextIsActive = data.isActive ?? existingUser.isActive;
    await this.assertAdminGuardrails({
      tenantId: resolvedTenantId,
      userId: existingUser.id,
      previousRole: existingUser.role,
      previousIsActive: existingUser.isActive,
      nextRole,
      nextIsActive,
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: existingUser.id },
      data: {
        ...(data.displayName !== undefined
          ? { displayName: normalizeDisplayName(data.displayName) }
          : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
    });

    if (!updatedUser.isActive) {
      await this.logoutAll(updatedUser.id, resolvedTenantId);
    }

    return this.sanitizeUser(updatedUser);
  }

  async deleteUser(userId: string, tenantId?: string): Promise<void> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const existingUser = await this.prisma.user.findFirst({
      where: {
        tenantId: resolvedTenantId,
        id: userId,
      },
    });

    if (!existingUser) {
      throw new AuthServiceError('USER_NOT_FOUND');
    }

    await this.assertAdminGuardrails({
      tenantId: resolvedTenantId,
      userId: existingUser.id,
      previousRole: existingUser.role,
      previousIsActive: existingUser.isActive,
      deleting: true,
    });

    await this.prisma.user.delete({
      where: { id: existingUser.id },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    tenantId?: string
  ): Promise<void> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: resolvedTenantId,
        id: userId,
      },
    });

    if (!user) {
      throw new AuthServiceError('USER_NOT_FOUND');
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw new AuthServiceError('INVALID_CURRENT_PASSWORD');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.logoutAll(user.id, resolvedTenantId);
  }

  async resetPassword(userId: string, newPassword: string, tenantId?: string): Promise<void> {
    const resolvedTenantId = await this.resolveInstallationTenantId(tenantId);
    const user = await this.prisma.user.findFirst({
      where: {
        tenantId: resolvedTenantId,
        id: userId,
      },
    });

    if (!user) {
      throw new AuthServiceError('USER_NOT_FOUND');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.logoutAll(user.id, resolvedTenantId);
  }

  async cleanupExpiredTokens(): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    let deletedCount = 0;
    for (const tenant of tenants) {
      const result = await this.prisma.refreshToken.deleteMany({
        where: {
          tenantId: tenant.id,
          OR: [
            { expiresAt: { lt: new Date() } },
            { revokedAt: { not: null } },
          ],
        },
      });
      deletedCount += result.count;
    }

    return deletedCount;
  }

  getLegacyApiRoleForUser(role: UserRole): ApiRole {
    return mapUserRoleToApiRole(role);
  }

  private resolveJwtSecret(inputSecret?: string): string {
    const secret = inputSecret ?? process.env.JWT_SECRET;
    if (secret && secret.trim().length >= 32) {
      return secret.trim();
    }

    const generatedSecret = crypto.randomBytes(64).toString('hex');
    process.env.JWT_SECRET = generatedSecret;
    appLogger.warn('[AUTH] JWT_SECRET absent ou trop court. Secret ephemere genere au demarrage.');
    return generatedSecret;
  }

  private async resolveInstallationTenantId(explicitTenantId?: string): Promise<string> {
    if (explicitTenantId) {
      return explicitTenantId;
    }

    if (this.resolvedTenantId) {
      return this.resolvedTenantId;
    }

    const tenants = await this.prisma.tenant.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        license: {
          select: {
            plan: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    if (tenants.length === 0) {
      const tenant = await this.createDefaultTenant();
      this.resolvedTenantId = tenant.id;
      return tenant.id;
    }

    const preferredTenants = tenants.filter((tenant) => tenant.license?.plan !== 'OWNER');
    const preferredTenant = preferredTenants[0];
    if (preferredTenants.length === 1 && preferredTenant) {
      this.resolvedTenantId = preferredTenant.id;
      return preferredTenant.id;
    }

    const onlyTenant = tenants[0];
    if (tenants.length === 1 && onlyTenant) {
      this.resolvedTenantId = onlyTenant.id;
      return onlyTenant.id;
    }

    throw new AuthServiceError('TENANT_RESOLUTION_ERROR', {
      tenantCount: tenants.length,
    });
  }

  private async createDefaultTenant(): Promise<{ id: string }> {
    const tenantName = this.licenseService?.getLicense()?.company?.trim() || 'Stronghold';
    const rawApiKey = crypto.randomBytes(32).toString('hex');
    const tenant = await this.prisma.tenant.create({
      data: {
        name: tenantName,
        apiKey: rawApiKey,
      },
      select: { id: true },
    });

    await this.ensureTenantLicense(tenant.id);
    return tenant;
  }

  private async ensureTenantLicense(tenantId: string): Promise<void> {
    const runtimeLicense = this.licenseService?.getLicense();
    if (!runtimeLicense) {
      return;
    }

    const plan = PLAN_TYPE_BY_LICENSE_PLAN[runtimeLicense.plan] ?? 'PRO';
    const status = LICENSE_STATUS_BY_RUNTIME[this.licenseService?.getStatus() ?? 'valid'] ?? 'ACTIVE';
    const startsAt = new Date(runtimeLicense.iat * 1000);
    const expiresAt = new Date(runtimeLicense.exp * 1000);

    await this.prisma.license.upsert({
      where: { tenantId },
      create: {
        tenantId,
        plan,
        status,
        issuedAt: startsAt,
        startsAt,
        expiresAt,
        maxUsers: runtimeLicense.maxUsers,
        features: runtimeLicense.features,
        usage: {
          create: {},
        },
      },
      update: {
        plan,
        status,
        issuedAt: startsAt,
        startsAt,
        expiresAt,
        maxUsers: runtimeLicense.maxUsers,
        features: runtimeLicense.features,
      },
    });
  }

  private async findValidRefreshToken(refreshToken: string): Promise<RefreshTokenRecord> {
    const tenantId = extractRefreshTokenTenantId(refreshToken);
    if (!tenantId) {
      throw new AuthServiceError('INVALID_REFRESH_TOKEN');
    }

    const existingToken = await this.prisma.refreshToken.findFirst({
      where: {
        tenantId,
        token: refreshToken,
      },
      include: {
        user: true,
      },
    });

    if (
      !existingToken ||
      existingToken.revokedAt !== null ||
      existingToken.expiresAt <= new Date() ||
      !existingToken.user.isActive
    ) {
      throw new AuthServiceError('INVALID_REFRESH_TOKEN');
    }

    return existingToken;
  }

  private async assertAdminGuardrails(params: {
    tenantId: string;
    userId: string;
    previousRole: UserRole;
    previousIsActive: boolean;
    nextRole?: UserRole;
    nextIsActive?: boolean;
    deleting?: boolean;
  }): Promise<void> {
    const {
      tenantId,
      previousRole,
      previousIsActive,
      nextRole = previousRole,
      nextIsActive = previousIsActive,
      deleting = false,
    } = params;

    const wouldRemoveActiveAdmin =
      previousRole === 'ADMIN' &&
      previousIsActive &&
      (deleting || nextRole !== 'ADMIN' || nextIsActive === false);

    if (!wouldRemoveActiveAdmin) {
      return;
    }

    const adminCount = await this.prisma.user.count({
      where: {
        tenantId,
        role: 'ADMIN',
        isActive: true,
      },
    });

    if (adminCount <= 1) {
      throw new AuthServiceError('LAST_ADMIN_REQUIRED');
    }
  }

  private generateAccessToken(user: User): string {
    const payload: AccessTokenPayload = {
      sub: user.id,
      role: user.role,
      email: user.email,
      tenantId: user.tenantId,
      type: 'access',
    };

    const signOptions: jwt.SignOptions = {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_EXPIRY,
    };

    return jwt.sign(payload, this.jwtSecret as jwt.Secret, signOptions);
  }

  private generateRefreshToken(tenantId: string): string {
    return `${tenantId}.${crypto.randomBytes(64).toString('hex')}`;
  }

  private buildRefreshTokenExpiryDate(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  }

  private isUserRole(value: unknown): value is UserRole {
    return value === 'ADMIN' || value === 'ANALYST' || value === 'VIEWER';
  }

  private sanitizeUser(user: User): SafeUser {
    const { passwordHash: _passwordHash, ...sanitized } = user;
    return sanitized;
  }
}
