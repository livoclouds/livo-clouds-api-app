import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { JwtPayload } from '../../common/types';
import {
  fileExtension,
  parseR2Key,
  ParsedR2Key,
} from './key-parser';
import {
  AggregateSortField,
  ListAggregateQuery,
  ListObjectsQuery,
  ListUserAggregateQuery,
  ObjectSortField,
} from './dto/list-objects.dto';

const LIST_CACHE_TTL_MS = 60_000;

interface RawObject {
  key: string;
  size: number;
  lastModified: Date | null;
  etag: string | null;
}

export interface EnrichedObject {
  key: string;
  fileName: string;
  extension: string;
  size: number;
  lastModified: string | null;
  createdAt: string | null;
  etag: string | null;
  scope: ParsedR2Key['scope'];
  condominium: { id: string; slug: string; name: string } | null;
  uploader: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  batch: { id: string; status: string; fileName: string } | null;
  recordCount: number;
  isOrphan: boolean;
  lastAccessedAt: string | null;
  lastAccessType: string | null;
  recentAccessCount: number;
}

interface ListCacheEntry {
  fetchedAt: number;
  objects: RawObject[];
}

@Injectable()
export class StorageAdminService {
  private readonly logger = new Logger(StorageAdminService.name);
  private listCache: ListCacheEntry | null = null;
  private accessLogTrackingStart: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  isReady(): boolean {
    return this.storage.isConfigured();
  }

  // ─── Public actions ──────────────────────────────────────────────────────

  async getSummary() {
    const enriched = await this.loadEnrichedObjects();

    let totalSize = 0;
    let oldestModified: string | null = null;
    let newestModified: string | null = null;
    let orphans = 0;
    const condominiumSizes = new Map<string, number>();

    for (const obj of enriched) {
      totalSize += obj.size;
      if (obj.isOrphan) orphans += 1;
      if (obj.lastModified) {
        if (!oldestModified || obj.lastModified < oldestModified) {
          oldestModified = obj.lastModified;
        }
        if (!newestModified || obj.lastModified > newestModified) {
          newestModified = obj.lastModified;
        }
      }
      if (obj.condominium) {
        condominiumSizes.set(
          obj.condominium.name,
          (condominiumSizes.get(obj.condominium.name) ?? 0) + obj.size,
        );
      }
    }

    let largest: { name: string; size: number } | null = null;
    for (const [name, size] of condominiumSizes) {
      if (!largest || size > largest.size) largest = { name, size };
    }

    const trackingSince = await this.getAccessLogTrackingStart();

    return {
      bucket: this.storage.getBucketName(),
      totalObjects: enriched.length,
      totalSize,
      condominiumCount: condominiumSizes.size,
      largestCondominium: largest,
      oldestModifiedAt: oldestModified,
      newestModifiedAt: newestModified,
      orphanCount: orphans,
      trackingSince: trackingSince ? trackingSince.toISOString() : null,
    };
  }

  async listObjects(query: ListObjectsQuery) {
    const all = await this.loadEnrichedObjects();
    const filtered = this.applyFilters(all, query);
    const sorted = this.applyObjectSort(
      filtered,
      query.sortBy ?? 'lastModified',
      query.sortDirection ?? 'desc',
    );

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 50), 200);
    const total = sorted.length;
    const start = (page - 1) * limit;
    const pageRows = sorted.slice(start, start + limit);

    return {
      data: pageRows,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async listByCondominium(query: ListAggregateQuery) {
    const enriched = await this.loadEnrichedObjects();
    const buckets = new Map<
      string,
      {
        id: string;
        slug: string;
        name: string;
        fileCount: number;
        totalSize: number;
        lastUploadAt: string | null;
      }
    >();

    for (const obj of enriched) {
      const key = obj.condominium?.id ?? '__orphan__';
      const name = obj.condominium?.name ?? '(Orphan / unknown)';
      const slug = obj.condominium?.slug ?? '';
      const id = obj.condominium?.id ?? '';
      const current = buckets.get(key) ?? {
        id,
        slug,
        name,
        fileCount: 0,
        totalSize: 0,
        lastUploadAt: null as string | null,
      };
      current.fileCount += 1;
      current.totalSize += obj.size;
      if (obj.lastModified) {
        if (!current.lastUploadAt || obj.lastModified > current.lastUploadAt) {
          current.lastUploadAt = obj.lastModified;
        }
      }
      buckets.set(key, current);
    }

    let rows = [...buckets.values()];
    if (query.q) {
      const needle = query.q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.slug.toLowerCase().includes(needle),
      );
    }
    rows = this.applyAggregateFilters(rows, query);
    rows = this.applyAggregateSort(
      rows,
      query.sortBy ?? 'totalSize',
      query.sortDirection ?? 'desc',
    );

    return this.paginate(rows, query.page, query.limit);
  }

  /**
   * Range filters shared by the aggregate views: total size (bytes), file
   * count, and last-upload date (YYYY-MM-DD, inclusive). Rows without an upload
   * date are excluded once any date bound is set.
   */
  private applyAggregateFilters<
    T extends { fileCount: number; totalSize: number; lastUploadAt: string | null },
  >(rows: T[], query: ListAggregateQuery): T[] {
    const { sizeMin, sizeMax, fileCountMin, fileCountMax, uploadFrom, uploadTo } =
      query;
    // Compare on date only; treat `uploadTo` as the end of its day.
    const fromTs =
      uploadFrom != null ? new Date(`${uploadFrom}T00:00:00.000Z`).getTime() : null;
    const toTs =
      uploadTo != null ? new Date(`${uploadTo}T23:59:59.999Z`).getTime() : null;

    return rows.filter((r) => {
      if (sizeMin != null && r.totalSize < sizeMin) return false;
      if (sizeMax != null && r.totalSize > sizeMax) return false;
      if (fileCountMin != null && r.fileCount < fileCountMin) return false;
      if (fileCountMax != null && r.fileCount > fileCountMax) return false;
      if (fromTs != null || toTs != null) {
        if (!r.lastUploadAt) return false;
        const ts = new Date(r.lastUploadAt).getTime();
        if (fromTs != null && ts < fromTs) return false;
        if (toTs != null && ts > toTs) return false;
      }
      return true;
    });
  }

  async listByUser(query: ListUserAggregateQuery) {
    const enriched = await this.loadEnrichedObjects();
    const buckets = new Map<
      string,
      {
        id: string;
        name: string;
        email: string;
        fileCount: number;
        totalSize: number;
        lastUploadAt: string | null;
      }
    >();

    for (const obj of enriched) {
      const key = obj.uploader?.id ?? '__unknown__';
      const id = obj.uploader?.id ?? '';
      const name = obj.uploader
        ? `${obj.uploader.firstName} ${obj.uploader.lastName}`.trim()
        : '(Unknown uploader)';
      const email = obj.uploader?.email ?? '';
      const current = buckets.get(key) ?? {
        id,
        name,
        email,
        fileCount: 0,
        totalSize: 0,
        lastUploadAt: null as string | null,
      };
      current.fileCount += 1;
      current.totalSize += obj.size;
      if (obj.lastModified) {
        if (!current.lastUploadAt || obj.lastModified > current.lastUploadAt) {
          current.lastUploadAt = obj.lastModified;
        }
      }
      buckets.set(key, current);
    }

    const realIds = [...buckets.keys()].filter((k) => k !== '__unknown__');
    const userDetails =
      realIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: realIds } },
            select: {
              id: true,
              roleRef: { select: { key: true } },
              condominiumId: true,
              condominium: { select: { name: true, slug: true } },
            },
          })
        : [];
    const userDetailMap = new Map(userDetails.map((u) => [u.id, u]));

    let rows = [...buckets.values()].map((b) => {
      const details = userDetailMap.get(b.id);
      return {
        ...b,
        role: details?.roleRef?.key ?? null,
        condominiumId: details?.condominiumId ?? null,
        condominiumName: details?.condominium?.name ?? null,
        condominiumSlug: details?.condominium?.slug ?? null,
      };
    });

    if (query.q) {
      const needle = query.q.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(needle) ||
          r.email.toLowerCase().includes(needle) ||
          (r.condominiumName?.toLowerCase().includes(needle) ?? false),
      );
    }
    if (query.condominiumId) {
      rows = rows.filter((r) => r.condominiumId === query.condominiumId);
    }
    if (query.role) {
      rows = rows.filter((r) => r.role === query.role);
    }
    if (typeof query.fileCountMin === 'number') {
      rows = rows.filter((r) => r.fileCount >= query.fileCountMin!);
    }
    if (typeof query.fileCountMax === 'number') {
      rows = rows.filter((r) => r.fileCount <= query.fileCountMax!);
    }
    if (typeof query.sizeMin === 'number') {
      rows = rows.filter((r) => r.totalSize >= query.sizeMin!);
    }
    if (typeof query.sizeMax === 'number') {
      rows = rows.filter((r) => r.totalSize <= query.sizeMax!);
    }
    rows = this.applyAggregateSort(
      rows,
      query.sortBy ?? 'totalSize',
      query.sortDirection ?? 'desc',
    );

    return this.paginate(rows, query.page, query.limit);
  }

  async getObjectDetail(key: string) {
    const enriched = await this.loadEnrichedObjects();
    const match = enriched.find((o) => o.key === key);
    if (!match) {
      throw new NotFoundException(`Object not found: ${key}`);
    }
    const accessLog = await this.prisma.r2AccessLog.findMany({
      where: { objectKey: key },
      orderBy: { accessedAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    return { ...match, accessLog };
  }

  async createPresignedUrl(key: string, user: JwtPayload) {
    const enriched = await this.loadEnrichedObjects();
    const match = enriched.find((o) => o.key === key);
    if (!match) {
      throw new NotFoundException(`Object not found: ${key}`);
    }
    const url = await this.storage.getPresignedUrl(key, 3600, {
      userId: user.sub,
      condominiumId: match.condominium?.id ?? null,
      byteSize: match.size,
    });
    return { url, expiresIn: 3600, key };
  }

  async deleteObject(key: string, user: JwtPayload) {
    const enriched = await this.loadEnrichedObjects();
    const match = enriched.find((o) => o.key === key);
    if (!match) {
      throw new NotFoundException(`Object not found: ${key}`);
    }
    await this.storage.deleteFile(key, {
      userId: user.sub,
      condominiumId: match.condominium?.id ?? null,
      byteSize: match.size,
    });
    this.invalidateCache();
    return { ok: true, key };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private invalidateCache() {
    this.listCache = null;
  }

  private async loadRawObjects(): Promise<RawObject[]> {
    if (
      this.listCache &&
      Date.now() - this.listCache.fetchedAt < LIST_CACHE_TTL_MS
    ) {
      return this.listCache.objects;
    }
    if (!this.storage.isConfigured()) {
      this.listCache = { fetchedAt: Date.now(), objects: [] };
      return [];
    }
    const client = this.storage.getClient();
    const bucket = this.storage.getBucketName();
    const objects: RawObject[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (!obj.Key) continue;
        objects.push({
          key: obj.Key,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ? new Date(obj.LastModified) : null,
          etag: obj.ETag ?? null,
        });
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);
    this.listCache = { fetchedAt: Date.now(), objects };
    this.logger.log(
      `Refreshed R2 listing: ${objects.length} object(s) in bucket=${bucket}`,
    );
    return objects;
  }

  private async loadEnrichedObjects(): Promise<EnrichedObject[]> {
    const raw = await this.loadRawObjects();
    if (raw.length === 0) return [];
    const parsed = raw.map((o) => ({ raw: o, parsed: parseR2Key(o.key) }));

    const condominiumIds = new Set<string>();
    const batchIds = new Set<string>();
    const userIds = new Set<string>();
    for (const { parsed: p } of parsed) {
      if (p.condominiumId) condominiumIds.add(p.condominiumId);
      if (p.batchId) batchIds.add(p.batchId);
      if (p.userId) userIds.add(p.userId);
    }

    const [condominiums, batches, users, accessAggregates, accessLatest] =
      await Promise.all([
        condominiumIds.size > 0
          ? this.prisma.condominium.findMany({
              where: { id: { in: [...condominiumIds] } },
              select: { id: true, slug: true, name: true },
            })
          : Promise.resolve([]),
        batchIds.size > 0
          ? this.prisma.importBatch.findMany({
              where: { id: { in: [...batchIds] } },
              select: {
                id: true,
                status: true,
                fileName: true,
                createdAt: true,
                transactionCount: true,
                importedById: true,
                importedBy: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            })
          : Promise.resolve([]),
        userIds.size > 0
          ? this.prisma.user.findMany({
              where: { id: { in: [...userIds] } },
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            })
          : Promise.resolve([]),
        this.prisma.r2AccessLog.groupBy({
          by: ['objectKey'],
          _count: { _all: true },
          where: { accessType: { in: ['PRESIGNED_GET', 'STREAM'] } },
        }),
        this.prisma.r2AccessLog.findMany({
          orderBy: { accessedAt: 'desc' },
          distinct: ['objectKey'],
          select: { objectKey: true, accessType: true, accessedAt: true },
          take: 5000,
        }),
      ]);

    const condoMap = new Map(condominiums.map((c) => [c.id, c]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const userMap = new Map(users.map((u) => [u.id, u]));
    const accessCountMap = new Map(
      accessAggregates.map((row) => [row.objectKey, row._count._all]),
    );
    const accessLatestMap = new Map(
      accessLatest.map((row) => [
        row.objectKey,
        { accessType: row.accessType, accessedAt: row.accessedAt },
      ]),
    );

    return parsed.map(({ raw, parsed: p }) => {
      const condo = p.condominiumId ? condoMap.get(p.condominiumId) ?? null : null;
      const batch = p.batchId ? batchMap.get(p.batchId) ?? null : null;
      const keyUser = p.userId ? userMap.get(p.userId) ?? null : null;
      const uploader = batch?.importedBy ?? keyUser;
      const isOrphan =
        Boolean(p.batchId && !batch) || Boolean(p.userId && !keyUser);
      const latest = accessLatestMap.get(raw.key);
      return {
        key: raw.key,
        fileName: p.fileName,
        extension: fileExtension(p.fileName),
        size: raw.size,
        lastModified: raw.lastModified ? raw.lastModified.toISOString() : null,
        createdAt: batch?.createdAt.toISOString() ?? raw.lastModified?.toISOString() ?? null,
        etag: raw.etag,
        scope: p.scope,
        condominium: condo
          ? { id: condo.id, slug: condo.slug, name: condo.name }
          : null,
        uploader,
        batch: batch
          ? { id: batch.id, status: batch.status, fileName: batch.fileName }
          : null,
        recordCount: batch?.transactionCount ?? 0,
        isOrphan,
        lastAccessedAt: latest ? latest.accessedAt.toISOString() : null,
        lastAccessType: latest ? latest.accessType : null,
        recentAccessCount: accessCountMap.get(raw.key) ?? 0,
      };
    });
  }

  private applyFilters(rows: EnrichedObject[], q: ListObjectsQuery): EnrichedObject[] {
    let out = rows;
    if (q.condominiumId) {
      out = out.filter((r) => r.condominium?.id === q.condominiumId);
    }
    if (q.userId) {
      out = out.filter((r) => r.uploader?.id === q.userId);
    }
    if (q.prefix) {
      out = out.filter((r) => r.key.startsWith(q.prefix!));
    }
    if (q.extension) {
      const ext = q.extension.toLowerCase();
      out = out.filter((r) => r.extension === ext);
    }
    if (q.q) {
      const needle = q.q.toLowerCase();
      out = out.filter(
        (r) =>
          r.fileName.toLowerCase().includes(needle) ||
          r.key.toLowerCase().includes(needle),
      );
    }
    if (typeof q.sizeMin === 'number') {
      out = out.filter((r) => r.size >= q.sizeMin!);
    }
    if (typeof q.sizeMax === 'number') {
      out = out.filter((r) => r.size <= q.sizeMax!);
    }
    if (q.modifiedFrom) {
      out = out.filter((r) => r.lastModified && r.lastModified >= q.modifiedFrom!);
    }
    if (q.modifiedTo) {
      out = out.filter((r) => r.lastModified && r.lastModified <= q.modifiedTo!);
    }
    if (q.orphan === 'true') {
      out = out.filter((r) => r.isOrphan);
    } else if (q.orphan === 'false') {
      out = out.filter((r) => !r.isOrphan);
    }
    return out;
  }

  private applyObjectSort(
    rows: EnrichedObject[],
    field: ObjectSortField,
    dir: 'asc' | 'desc',
  ): EnrichedObject[] {
    const sign = dir === 'asc' ? 1 : -1;
    const accessor = (o: EnrichedObject): string | number | null => {
      switch (field) {
        case 'fileName':
          return o.fileName.toLowerCase();
        case 'size':
          return o.size;
        case 'lastModified':
          return o.lastModified ?? '';
        case 'condominiumName':
          return o.condominium?.name.toLowerCase() ?? '';
        case 'uploaderName':
          return o.uploader
            ? `${o.uploader.firstName} ${o.uploader.lastName}`.toLowerCase()
            : '';
        case 'lastAccessedAt':
          return o.lastAccessedAt ?? '';
        case 'createdAt':
          return o.createdAt ?? '';
      }
    };
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av === bv) return 0;
      if (av === null || av === '') return 1;
      if (bv === null || bv === '') return -1;
      return av > bv ? sign : -sign;
    });
  }

  private applyAggregateSort<
    T extends { name: string; fileCount: number; totalSize: number; lastUploadAt: string | null },
  >(rows: T[], field: AggregateSortField, dir: 'asc' | 'desc'): T[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[field] ?? '';
      const bv = b[field] ?? '';
      if (av === bv) return 0;
      if (av === '' || av === null) return 1;
      if (bv === '' || bv === null) return -1;
      return av > bv ? sign : -sign;
    });
  }

  private paginate<T>(rows: T[], page?: number, limit?: number) {
    const p = Math.max(1, page ?? 1);
    const l = Math.min(Math.max(1, limit ?? 50), 200);
    const total = rows.length;
    const start = (p - 1) * l;
    return {
      data: rows.slice(start, start + l),
      meta: {
        total,
        page: p,
        limit: l,
        totalPages: Math.max(1, Math.ceil(total / l)),
      },
    };
  }

  private async getAccessLogTrackingStart(): Promise<Date | null> {
    if (this.accessLogTrackingStart) return this.accessLogTrackingStart;
    const first = await this.prisma.r2AccessLog.findFirst({
      orderBy: { accessedAt: 'asc' },
      select: { accessedAt: true },
    });
    this.accessLogTrackingStart = first?.accessedAt ?? null;
    return this.accessLogTrackingStart;
  }
}
