import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UserRole } from '../../common/types';
import { AuthController } from './auth.controller';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

interface AuthServiceMock {
  login: jest.Mock;
  refresh: jest.Mock;
  logout: jest.Mock;
  getMe: jest.Mock;
}

function makeServiceMock(): AuthServiceMock {
  return {
    login: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt', user: {} }),
    refresh: jest.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }),
    logout: jest.fn().mockResolvedValue(undefined),
    getMe: jest.fn().mockResolvedValue({ id: 'user-1', email: 'u@test.local' }),
  };
}

function makeController(svc: AuthServiceMock): AuthController {
  return new AuthController(svc as never);
}

// DTO validation helpers
async function validateLoginDto(data: Record<string, unknown>) {
  const dto = plainToInstance(LoginDto, data);
  return validate(dto);
}

async function validateRefreshDto(data: Record<string, unknown>) {
  const dto = plainToInstance(RefreshTokenDto, data);
  return validate(dto);
}

describe('AuthController', () => {
  let svc: AuthServiceMock;
  let controller: AuthController;

  beforeEach(() => {
    svc = makeServiceMock();
    controller = makeController(svc);
  });

  // ---------------------------------------------------------------------------
  describe('LoginDto validation', () => {
    it('passes with a valid email and password', async () => {
      const errors = await validateLoginDto({
        email: 'user@test.local',
        password: 'TestPass1!',
      });
      expect(errors).toHaveLength(0);
    });

    it('fails when email is missing', async () => {
      const errors = await validateLoginDto({ password: 'TestPass1!' });
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('email');
    });

    it('fails when email is not a valid email address', async () => {
      const errors = await validateLoginDto({
        email: 'not-an-email',
        password: 'TestPass1!',
      });
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('email');
    });

    it('fails when password is shorter than 8 characters (LOG-009)', async () => {
      const errors = await validateLoginDto({
        email: 'user@test.local',
        password: 'short',
      });
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('password');
    });

    it('fails when password is exactly 7 characters (boundary check)', async () => {
      const errors = await validateLoginDto({
        email: 'user@test.local',
        password: 'Abc1234',
      });
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('password');
    });

    it('passes when password is exactly 8 characters (minimum boundary)', async () => {
      const errors = await validateLoginDto({
        email: 'user@test.local',
        password: 'Abc12345',
      });
      expect(errors).toHaveLength(0);
    });

    it('fails when password is empty', async () => {
      const errors = await validateLoginDto({
        email: 'user@test.local',
        password: '',
      });
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('password');
    });

    it('fails when both email and password are missing', async () => {
      const errors = await validateLoginDto({});
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('email');
      expect(fields).toContain('password');
    });
  });

  // ---------------------------------------------------------------------------
  describe('RefreshTokenDto validation', () => {
    it('passes with a non-empty refreshToken string', async () => {
      const errors = await validateRefreshDto({ refreshToken: 'some-token-value' });
      expect(errors).toHaveLength(0);
    });

    it('fails when refreshToken is missing', async () => {
      const errors = await validateRefreshDto({});
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('refreshToken');
    });

    it('fails when refreshToken is empty', async () => {
      const errors = await validateRefreshDto({ refreshToken: '' });
      const fields = errors.map((e) => e.property);
      expect(fields).toContain('refreshToken');
    });
  });

  // ---------------------------------------------------------------------------
  describe('handler delegation', () => {
    const ctx = {
      ipAddress: '127.0.0.1',
      userAgent: 'jest-test-agent',
      requestId: 'req-test',
    };

    it('login() delegates to authService.login with dto and context', () => {
      const dto = Object.assign(new LoginDto(), {
        email: 'user@test.local',
        password: 'TestPass1!',
      });
      controller.login(dto, ctx.ipAddress, ctx.userAgent, ctx.requestId);

      expect(svc.login).toHaveBeenCalledWith(dto, {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
    });

    it('refresh() delegates to authService.refresh with token and context', () => {
      const dto = Object.assign(new RefreshTokenDto(), { refreshToken: 'rt-value' });
      controller.refresh(dto, ctx.ipAddress, ctx.userAgent, ctx.requestId);

      expect(svc.refresh).toHaveBeenCalledWith('rt-value', {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
    });

    it('logout() delegates to authService.logout with token and context', () => {
      const dto = Object.assign(new RefreshTokenDto(), { refreshToken: 'rt-value' });
      controller.logout(dto, ctx.ipAddress, ctx.userAgent, ctx.requestId);

      expect(svc.logout).toHaveBeenCalledWith('rt-value', {
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
      });
    });

    it('getMe() delegates to authService.getMe with the JWT sub claim', () => {
      const jwtPayload = {
        sub: 'user-uuid-1',
        email: 'user@test.local',
        role: UserRole.TENANT_ADMIN,
        condominiumId: 'cond-1',
        condominiumSlug: 'test-condo',
      };
      controller.getMe(jwtPayload);

      expect(svc.getMe).toHaveBeenCalledWith('user-uuid-1');
    });
  });
});
