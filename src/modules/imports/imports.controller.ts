import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload, UserRole } from '../../common/types';
import { ImportsService } from './imports.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { ListImportBatchesDto } from './dto/list-import-batches.dto';

interface MultipartFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@ApiTags('Imports')
@Controller('condominiums/:condominiumSlug/imports')
@UseGuards(CondominiumAccessGuard, RolesGuard)
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
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
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

  @Post('confirm')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @Throttle({ burst: { limit: 5, ttl: 10_000 }, sustained: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Persist parsed bank statement transactions' })
  confirm(
    @Request() req: { condominiumId: string },
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmImportDto,
  ) {
    return this.importsService.confirm(req.condominiumId, dto, user);
  }

  @Delete(':id')
  @Roles(UserRole.ROOT, UserRole.TENANT_ADMIN)
  @ApiOperation({ summary: 'Cancel/delete import batch' })
  remove(
    @Request() req: { condominiumId: string },
    @Param('id') id: string,
  ) {
    return this.importsService.remove(req.condominiumId, id);
  }
}
