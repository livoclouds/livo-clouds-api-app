import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { ListArcoRequestsDto } from './dto/list-arco-requests.dto';
import { ResidentArcoService } from './resident-arco.service';

type AuthedRequest = FastifyRequest & {
  condominiumId: string;
  user: JwtPayload;
};

const VIEW = 'residents.arco.view';

// Condominium-level ARCO compliance list — every request across all residents,
// read-only. Management stays per-resident under ResidentArcoController; this is
// the "what's due this week?" overview. Reuses the `residents.arco.view`
// permission (admins, supervisor, auditor).
@ApiTags('ARCO Compliance')
@Controller('condominiums/:condominiumSlug/arco')
@UseGuards(CondominiumAccessGuard)
export class CondominiumArcoController {
  constructor(private readonly service: ResidentArcoService) {}

  @Get()
  @RequirePermission(VIEW)
  @ApiOperation({ summary: 'List all ARCO requests in the condominium (compliance view)' })
  findAll(@Request() req: AuthedRequest, @Query() query: ListArcoRequestsDto) {
    return this.service.findAllByCondominium(req.condominiumId, req.user.sub, query);
  }
}
