// System role keys (mirror the seeded Role.key values). No longer a Prisma enum
// — roles live in the `roles` table — but kept as a string enum so role-key
// comparisons (e.g. ROOT bypass) stay typed across the codebase. A user's role
// key is read from roleRef.key; custom roles (key = null) fall back to READ_ONLY
// when a single key value is required (e.g. the JWT payload).
export enum UserRole {
  ROOT = 'ROOT',
  SUPERVISOR = 'SUPERVISOR',
  TENANT_ADMIN = 'TENANT_ADMIN',
  READ_ONLY = 'READ_ONLY',
  GUARD = 'GUARD',
  RESIDENT = 'RESIDENT',
}

export enum OnboardingStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  condominiumId: string | null;
  condominiumSlug: string | null;
  // Session id — the RefreshToken row this access token was minted from. Lets a
  // request be tied to its session for the inactivity screen lock. Present on
  // access tokens; absent on refresh tokens (which are looked up by value).
  sid?: string;
  iat?: number;
  exp?: number;
}

export interface RequestWithUser extends Request {
  user: JwtPayload;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    // Optional condominium-scoped fee/currency context. Populated by endpoints
    // (e.g. residents list) whose consumers need these values inline, so the
    // client avoids a second authenticated call to /settings. Decimal amounts
    // are serialized as strings; absent on endpoints that don't provide it.
    condominium?: {
      ordinaryFeeAmount: string;
      lateFeeAmount: string;
      currency: string;
    };
  };
}
