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
import { AddArcoNoteDto } from './dto/add-arco-note.dto';
import { CreateArcoRequestDto } from './dto/create-arco-request.dto';
import { ListArcoRequestsDto } from './dto/list-arco-requests.dto';
import { UpdateArcoRequestDto } from './dto/update-arco-request.dto';
import {
  ResidentArcoService,
  type UploadedArcoFile,
} from './resident-arco.service';

type AuthedRequest = FastifyRequest & {
  condominiumId: string;
  user: JwtPayload;
};

const VIEW = 'residents.arco.view';
const MANAGE = 'residents.arco.manage';

async function parseMultipart(
  req: FastifyRequest,
): Promise<{ fields: Record<string, unknown>; files: UploadedArcoFile[] }> {
  const fields: Record<string, unknown> = {};
  const files: UploadedArcoFile[] = [];
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
  const errors = await validate(dto, { whitelist: true, forbidUnknownValues: false });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    throw new BadRequestException(messages.length ? messages : 'Invalid payload');
  }
  return dto;
}

@ApiTags('Resident ARCO Requests')
@Controller('condominiums/:condominiumSlug/residents/:residentId/arco')
@UseGuards(CondominiumAccessGuard)
export class ResidentArcoController {
  constructor(private readonly service: ResidentArcoService) {}

  @Get()
  @RequirePermission(VIEW)
  @ApiOperation({ summary: 'List a resident ARCO requests' })
  findAll(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Query() query: ListArcoRequestsDto,
  ) {
    return this.service.findAll(req.condominiumId, residentId, req.user.sub, query);
  }

  // Access packet — must be declared before `:id` so the static segment wins.
  @Get(':id/access-packet.zip')
  @RequirePermission(MANAGE)
  @Throttle({ burst: { limit: 2, ttl: 30_000 }, sustained: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Generate the ARCO access packet for an ACCESS request' })
  async accessPacket(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    const { buffer, fileName } = await this.service.generateAccessPacket(
      req.condominiumId,
      residentId,
      id,
      req.user.sub,
    );
    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .header('Cache-Control', 'no-store');
    return reply.send(buffer);
  }

  @Get(':id')
  @RequirePermission(VIEW)
  @ApiOperation({ summary: 'Get one ARCO request' })
  findOne(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(req.condominiumId, residentId, id, req.user.sub);
  }

  @Post()
  @RequirePermission(MANAGE)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Log an ARCO request (optional evidence files)' })
  async create(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
  ) {
    const { fields, files } = await parseMultipart(req);
    const dto = await validateOrThrow(CreateArcoRequestDto, fields);
    return this.service.create(req.condominiumId, residentId, req.user.sub, dto, files);
  }

  @Patch(':id')
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Update an ARCO request (status / resolution)' })
  update(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Body() dto: UpdateArcoRequestDto,
  ) {
    return this.service.update(req.condominiumId, residentId, id, req.user.sub, dto);
  }

  @Post(':id/notes')
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Add a note to an ARCO request' })
  addNote(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
    @Body() dto: AddArcoNoteDto,
  ) {
    return this.service.addNote(req.condominiumId, residentId, id, req.user.sub, dto.note);
  }

  @Post(':id/attachments')
  @RequirePermission(MANAGE)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Add evidence file(s) to an ARCO request' })
  async addAttachments(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    const { files } = await parseMultipart(req);
    return this.service.addAttachments(req.condominiumId, residentId, id, req.user.sub, files);
  }

  @Get(':id/attachments/:attachmentId/url')
  @RequirePermission(VIEW)
  @ApiOperation({ summary: 'Presigned URL to view/download an evidence file' })
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
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Remove an evidence file' })
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

  @Delete(':id')
  @RequirePermission(MANAGE)
  @ApiOperation({ summary: 'Soft-delete an ARCO request' })
  remove(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(req.condominiumId, residentId, id, req.user.sub);
  }
}
