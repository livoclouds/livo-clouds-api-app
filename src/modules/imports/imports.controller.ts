import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { ImportsService } from './imports.service';
import { CheckHashesDto } from './dto/check-hashes.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { ListImportBatchesDto } from './dto/list-import-batches.dto';

interface MultipartFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// Phase 2 IMP-012 — controller-scoped ValidationPipe so DTO failures on
// POST /imports/confirm surface as code:'VALIDATION_FAILED' instead of the
// generic 'BAD_REQUEST'. Global pipe behavior is preserved for every other
// endpoint.
function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): { field: string; messages: string[] }[] {
  const flat: { field: string; messages: string[] }[] = [];
  for (const err of errors) {
    const field = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints) {
      flat.push({ field, messages: Object.values(err.constraints) });
    }
    if (err.children && err.children.length > 0) {
      flat.push(...flattenValidationErrors(err.children, field));
    }
  }
  return flat;
}

const confirmValidationPipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  exceptionFactory: (errors) => {
    const fields = flattenValidationErrors(errors);
    const summary = fields
      .slice(0, 3)
      .map((f) => `${f.field}: ${f.messages[0]}`)
      .join('; ');
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      reason:
        summary.length > 0
          ? `Invalid confirm payload — ${summary}`
          : 'Invalid confirm payload',
      fields,
    });
  },
});

@ApiTags('Imports')
@Controller('condominiums/:condominiumSlug/imports')
@UseGuards(CondominiumAccessGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  @ApiOperation({ summary: 'List import batches' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: ListImportBatchesDto,
  ) {
    return this.importsService.findAll(req.condominiumId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import batch with transactions' })
  findOne(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.importsService.findOne(req.condominiumId, id);
  }

  @Post('upload')
  @RequirePermission('imports.create')
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload bank statement files (PDF or XLSX, max 5)' })
  async upload(
    @Request() req: FastifyRequest & { condominiumId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const files: MultipartFile[] = [];

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          const buffer = Buffer.concat(chunks);
          files.push({
            buffer,
            originalname: part.filename,
            mimetype: part.mimetype,
            size: buffer.length,
          });
        }
      }
    }

    return this.importsService.upload(req.condominiumId, files, user);
  }

  @Post('check-hashes')
  @RequirePermission('imports.create')
  @Throttle({ burst: { limit: 10, ttl: 10_000 }, sustained: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Return which SHA-256 hashes already correspond to a COMPLETED import batch with transactions in this condominium',
  })
  checkHashes(
    @Request() req: { condominiumId: string },
    @Body() dto: CheckHashesDto,
  ) {
    return this.importsService.checkHashesForCondominium(
      req.condominiumId,
      dto.hashes,
    );
  }

  @Post('preview')
  @RequirePermission('imports.create')
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Parse bank statement files for preview (no storage)' })
  async preview(
    @Request() req: FastifyRequest & { condominiumId: string },
  ) {
    const files: MultipartFile[] = [];
    let storedHashes: string[] = [];
    let clientIds: string[] = [];
    let bankProfileId: string | undefined;

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          const buffer = Buffer.concat(chunks);
          files.push({
            buffer,
            originalname: part.filename,
            mimetype: part.mimetype,
            size: buffer.length,
          });
        } else if (part.fieldname === 'storedHashes') {
          try {
            storedHashes = JSON.parse(part.value as string);
          } catch {
            // ignore malformed field — treat as empty
          }
        } else if (part.fieldname === 'clientIds') {
          try {
            clientIds = JSON.parse(part.value as string);
          } catch {
            // ignore malformed field — treat as empty
          }
        } else if (part.fieldname === 'bankProfileId') {
          const raw = String(part.value ?? '').trim();
          if (raw.length > 0) bankProfileId = raw;
        }
      }
    }

    return this.importsService.preview(
      req.condominiumId,
      files,
      storedHashes,
      clientIds,
      bankProfileId,
    );
  }

  @Post('confirm')
  @RequirePermission('imports.create')
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })
  @UsePipes(confirmValidationPipe)
  @ApiOperation({ summary: 'Persist parsed bank statement transactions' })
  confirm(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.importsService.confirm(req.condominiumId, dto, user);
  }

  @Delete(':id')
  @RequirePermission('imports.create')
  @ApiOperation({ summary: 'Cancel/delete import batch' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.importsService.remove(req.condominiumId, id, user);
  }
}
