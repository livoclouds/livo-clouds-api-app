import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { AddDossierNoteDto } from './dto/add-dossier-note.dto';
import { CreateDossierEntryDto } from './dto/create-dossier-entry.dto';
import { ListDossierEntriesDto } from './dto/list-dossier-entries.dto';
import { UpdateDossierEntryDto } from './dto/update-dossier-entry.dto';
import {
  ResidentDossierService,
  type UploadedDossierFile,
} from './resident-dossier.service';

type AuthedRequest = FastifyRequest & {
  condominiumId: string;
  user: JwtPayload;
};

const ANY_VIEW = [
  'residents.dossier.view',
  'residents.dossier.viewRestricted',
  'residents.dossier.viewLegal',
] as const;

// Reads a multipart request into plain fields + buffered files (mirrors the
// support-ticket controller). Non-multipart bodies fall back to req.body (JSON)
// so the same handler accepts both. Per-file mime/size limits are enforced in
// the service; the 20 MB Fastify cap is the global backstop.
async function parseMultipart(
  req: FastifyRequest,
): Promise<{ fields: Record<string, unknown>; files: UploadedDossierFile[] }> {
  const fields: Record<string, unknown> = {};
  const files: UploadedDossierFile[] = [];
  if (req.isMultipart()) {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) chunks.push(chunk as Buffer);
        const buffer = Buffer.concat(chunks);
        files.push({
          buffer,
          originalName: part.filename,
          mimeType: part.mimetype,
          size: buffer.length,
        });
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  } else {
    Object.assign(fields, (req.body as Record<string, unknown>) ?? {});
  }
  return { fields, files };
}

async function validateOrThrow<T extends object>(
  cls: new () => T,
  fields: Record<string, unknown>,
): Promise<T> {
  const dto = plainToInstance(cls, fields, { enableImplicitConversion: true });
  const errors = await validate(dto, {
    whitelist: true,
    forbidUnknownValues: false,
  });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new BadRequestException(messages.length ? messages : 'Invalid payload');
  }
  return dto;
}

@ApiTags('Resident Dossier')
@Controller('condominiums/:condominiumSlug/residents/:residentId/dossier')
@UseGuards(CondominiumAccessGuard)
export class ResidentDossierController {
  constructor(private readonly service: ResidentDossierService) {}

  @Get()
  @RequirePermission(...ANY_VIEW)
  @ApiOperation({ summary: 'List a resident dossier (confidentiality-filtered)' })
  findAll(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Query() query: ListDossierEntriesDto,
  ) {
    return this.service.findAll(req.condominiumId, residentId, req.user.sub, query);
  }

  // ARCO export — must be declared before `:id` so the static segment wins.
  @Get('export.zip')
  @RequirePermission('residents.dossier.export')
  @Throttle({ burst: { limit: 2, ttl: 30_000 }, sustained: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Export a resident dossier as a ZIP (JSON + evidence)' })
  async exportZip(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const { buffer, fileName } = await this.service.exportDossier(
      req.condominiumId,
      residentId,
      req.user.sub,
    );
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Cache-Control', 'no-store');
    return reply.send(buffer);
  }

  // ARCO subject packet — curated personal-data export for the resident.
  // Declared before `:id` so the static segment wins.
  @Get('arco-packet.zip')
  @RequirePermission('residents.dossier.exportArco')
  @Throttle({ burst: { limit: 2, ttl: 30_000 }, sustained: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: "Generate the resident's ARCO subject packet (ZIP)" })
  async arcoPacket(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const { buffer, fileName } = await this.service.exportArcoPacket(
      req.condominiumId,
      residentId,
      req.user.sub,
    );
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Cache-Control', 'no-store');
    return reply.send(buffer);
  }

  @Get(':id')
  @RequirePermission(...ANY_VIEW)
  @ApiOperation({ summary: 'Get one dossier entry' })
  findOne(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(req.condominiumId, residentId, id, req.user.sub);
  }

  @Post()
  @RequirePermission('residents.dossier.manage')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Create a dossier entry (optional evidence files)' })
  async create(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
  ) {
    const { fields, files } = await parseMultipart(req);
    const dto = await validateOrThrow(CreateDossierEntryDto, fields);
    return this.service.create(req.condominiumId, residentId, req.user.sub, dto, files);
  }

  @Patch(':id')
  @RequirePermission('residents.dossier.manage')
  @ApiOperation({ summary: 'Update a dossier entry (incl. status change)' })
  update(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDossierEntryDto,
  ) {
    return this.service.update(req.condominiumId, residentId, id, req.user.sub, dto);
  }

  @Post(':id/notes')
  @RequirePermission('residents.dossier.manage')
  @ApiOperation({ summary: 'Add a note to a dossier entry' })
  addNote(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Body() dto: AddDossierNoteDto,
  ) {
    return this.service.addNote(req.condominiumId, residentId, id, req.user.sub, dto.note);
  }

  @Post(':id/attachments')
  @RequirePermission('residents.dossier.manage')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add evidence file(s) to a dossier entry' })
  async addAttachments(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    const { files } = await parseMultipart(req);
    return this.service.addAttachments(req.condominiumId, residentId, id, req.user.sub, files);
  }

  @Get(':id/attachments/:attachmentId/url')
  @RequirePermission(...ANY_VIEW)
  @ApiOperation({ summary: 'Presigned URL to view/download an attachment' })
  attachmentUrl(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.service.getAttachmentUrl(
      req.condominiumId,
      residentId,
      id,
      attachmentId,
      req.user.sub,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermission('residents.dossier.manage')
  @ApiOperation({ summary: 'Remove an evidence attachment' })
  removeAttachment(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.service.removeAttachment(
      req.condominiumId,
      residentId,
      id,
      attachmentId,
      req.user.sub,
    );
  }

  @Delete(':id/purge')
  @RequirePermission('residents.dossier.manage')
  @ApiOperation({ summary: 'Hard-delete (purge) a soft-deleted dossier entry + its evidence' })
  purge(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    return this.service.purge(req.condominiumId, residentId, id, req.user.sub);
  }

  @Delete(':id')
  @RequirePermission('residents.dossier.manage')
  @ApiOperation({ summary: 'Soft-delete a dossier entry' })
  remove(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(req.condominiumId, residentId, id, req.user.sub);
  }
}
