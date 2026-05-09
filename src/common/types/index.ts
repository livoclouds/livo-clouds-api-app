export enum UserRole {
  ROOT = 'ROOT',
  TENANT_ADMIN = 'TENANT_ADMIN',
  READ_ONLY = 'READ_ONLY',
  GUARD = 'GUARD',
  NEIGHBOR = 'NEIGHBOR',
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  condominiumId: string | null;
  condominiumSlug: string | null;
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
  };
}
