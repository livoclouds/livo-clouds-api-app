import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { AuthService, AvatarUploadFile } from './auth.service';
import { UserRole } from '../../common/types';

jest.mock('bcryptjs', () => ({
  hashSync: jest.fn(() => '$2b$12$test-dummy-hash-placeholder'),
  compare: jest.fn(),
}));

const USER_ID = 'user-uuid-1';
const CONDOMINIUM_ID = 'cond-uuid-1';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function pngBuffer(extraBytes = 64): Buffer {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(extraBytes, 0x00)]);
}

function pngFile(overrides: Partial<AvatarUploadFile> = {}): AvatarUploadFile {
  const buffer = pngBuffer();
  return {
    buffer,
    originalname: 'avatar.png',
    mimetype: 'image/png',
    size: buffer.length,
    ...overrides,
  };
}

function makeMocks() {
  const prisma = {
    user: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    },
  };
  const storage = {
    isConfigured: jest.fn().mockReturnValue(true),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    getPresignedUrl: jest.fn().mockResolvedValue('https://r2.example.test/signed'),
    deleteFile: jest.fn().mockResolvedValue(undefined),
  };
  const noopMock = { log: jest.fn().mockResolvedValue(undefined) } as never;
  const jwt = { sign: jest.fn().mockReturnValue('t') } as never;
  const config = { get: jest.fn() } as never;
  const email = { sendPasswordResetEmail: jest.fn() } as never;
  const service = new AuthService(
    prisma as never,
    jwt,
    config,
    noopMock,
    email,
    storage as never,
  );
  return { service, prisma, storage };
}

describe('AuthService — avatar upload', () => {
  beforeAll(() => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('rejects unsupported MIME types', async () => {
    const { service } = makeMocks();
    await expect(
      service.uploadAvatar(USER_ID, pngFile({ mimetype: 'image/gif' })),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejects files larger than 2 MB', async () => {
    const { service } = makeMocks();
    const big = pngBuffer(2 * 1024 * 1024 + 1);
    await expect(
      service.uploadAvatar(USER_ID, {
        buffer: big,
        originalname: 'a.png',
        mimetype: 'image/png',
        size: big.length,
      }),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects when magic bytes do not match the declared MIME (.exe disguised as PNG)', async () => {
    const { service } = makeMocks();
    const bogus = Buffer.from('not-a-png-at-all');
    await expect(
      service.uploadAvatar(USER_ID, {
        buffer: bogus,
        originalname: 'a.png',
        mimetype: 'image/png',
        size: bogus.length,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty payloads', async () => {
    const { service } = makeMocks();
    await expect(
      service.uploadAvatar(USER_ID, {
        buffer: Buffer.alloc(0),
        originalname: 'a.png',
        mimetype: 'image/png',
        size: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when user no longer exists', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.uploadAvatar(USER_ID, pngFile())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects when storage is unconfigured', async () => {
    const { service, prisma, storage } = makeMocks();
    storage.isConfigured.mockReturnValue(false);
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      avatarUrl: null,
    });
    await expect(service.uploadAvatar(USER_ID, pngFile())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('uploads to a condominium-scoped key and returns a presigned URL', async () => {
    const { service, prisma, storage } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      avatarUrl: null,
    });

    const result = await service.uploadAvatar(USER_ID, pngFile());

    expect(storage.uploadFile).toHaveBeenCalledWith(
      `condominiums/${CONDOMINIUM_ID}/users/${USER_ID}/avatar-1700000000000.png`,
      expect.any(Buffer),
      'image/png',
      expect.objectContaining({ userId: USER_ID, condominiumId: CONDOMINIUM_ID }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        avatarUrl: `condominiums/${CONDOMINIUM_ID}/users/${USER_ID}/avatar-1700000000000.png`,
      },
    });
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(result.avatarUrl).toBe('https://r2.example.test/signed');
  });

  it('writes platform-scoped key for users with no condominium (ROOT)', async () => {
    const { service, prisma, storage } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: null,
      avatarUrl: null,
    });

    await service.uploadAvatar(USER_ID, pngFile({ mimetype: 'image/jpeg', buffer: Buffer.concat([JPEG_SIGNATURE, Buffer.alloc(32, 0)]) }));

    expect(storage.uploadFile).toHaveBeenCalledWith(
      `platform/users/${USER_ID}/avatar-1700000000000.jpg`,
      expect.any(Buffer),
      'image/jpeg',
      expect.objectContaining({ userId: USER_ID, condominiumId: null }),
    );
  });

  it('best-effort deletes the previous R2 object when replacing an avatar', async () => {
    const { service, prisma, storage } = makeMocks();
    const previousKey = `condominiums/${CONDOMINIUM_ID}/users/${USER_ID}/avatar-1234.png`;
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      avatarUrl: previousKey,
    });

    await service.uploadAvatar(USER_ID, pngFile());

    // Wait a microtask for the fire-and-forget delete chain.
    await new Promise((resolve) => setImmediate(resolve));

    expect(storage.deleteFile).toHaveBeenCalledWith(
      previousKey,
      expect.objectContaining({ userId: USER_ID, condominiumId: CONDOMINIUM_ID }),
    );
  });

  it('does not delete a legacy absolute URL stored on avatarUrl', async () => {
    const { service, prisma, storage } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      avatarUrl: 'https://cdn.example.com/seed.png',
    });

    await service.uploadAvatar(USER_ID, pngFile());

    await new Promise((resolve) => setImmediate(resolve));
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });
});

describe('AuthService — getMe avatar resolution', () => {
  it('returns a presigned URL when the column stores an R2 key', async () => {
    const { service, prisma, storage } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      email: 'u@test',
      firstName: 'A',
      lastName: 'B',
      role: UserRole.TENANT_ADMIN,
      avatarUrl: `condominiums/${CONDOMINIUM_ID}/users/${USER_ID}/avatar-1.png`,
      phone: null,
      condominiumId: CONDOMINIUM_ID,
      condominium: { id: CONDOMINIUM_ID, slug: 's', name: 'n' },
    });

    const result = await service.getMe(USER_ID);
    expect(storage.getPresignedUrl).toHaveBeenCalled();
    expect(result.avatarUrl).toBe('https://r2.example.test/signed');
  });

  it('passes through legacy absolute URLs without presigning', async () => {
    const { service, prisma, storage } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      email: 'u@test',
      firstName: 'A',
      lastName: 'B',
      role: UserRole.TENANT_ADMIN,
      avatarUrl: 'https://cdn.example.com/legacy.png',
      phone: null,
      condominiumId: CONDOMINIUM_ID,
      condominium: { id: CONDOMINIUM_ID, slug: 's', name: 'n' },
    });

    const result = await service.getMe(USER_ID);
    expect(storage.getPresignedUrl).not.toHaveBeenCalled();
    expect(result.avatarUrl).toBe('https://cdn.example.com/legacy.png');
  });

  it('returns null when avatarUrl is unset', async () => {
    const { service, prisma } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      email: 'u@test',
      firstName: 'A',
      lastName: 'B',
      role: UserRole.TENANT_ADMIN,
      avatarUrl: null,
      phone: null,
      condominiumId: CONDOMINIUM_ID,
      condominium: { id: CONDOMINIUM_ID, slug: 's', name: 'n' },
    });

    const result = await service.getMe(USER_ID);
    expect(result.avatarUrl).toBeNull();
  });
});

describe('AuthService — deleteAvatar', () => {
  it('clears the column and removes the R2 object', async () => {
    const { service, prisma, storage } = makeMocks();
    const key = `condominiums/${CONDOMINIUM_ID}/users/${USER_ID}/avatar-1.png`;
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      avatarUrl: key,
    });

    const result = await service.deleteAvatar(USER_ID);
    expect(storage.deleteFile).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ userId: USER_ID, condominiumId: CONDOMINIUM_ID }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { avatarUrl: null },
    });
    expect(result.avatarUrl).toBeNull();
  });

  it('is a no-op when avatar is already null', async () => {
    const { service, prisma, storage } = makeMocks();
    prisma.user.findFirst.mockResolvedValueOnce({
      id: USER_ID,
      condominiumId: CONDOMINIUM_ID,
      avatarUrl: null,
    });

    const result = await service.deleteAvatar(USER_ID);
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.avatarUrl).toBeNull();
  });
});
