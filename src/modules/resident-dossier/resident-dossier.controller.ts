import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CondominiumAccessGuard } from '../../common/guards/condominium-access.guard';
import { JwtPayload } from '../../common/types';
import { CreateDossierEntryDto } from './dto/create-dossier-entry.dto';
import { ListDossierEntriesDto } from './dto/list-dossier-entries.dto';
import { UpdateDossierEntryDto } from './dto/update-dossier-entry.dto';
import { ResidentDossierService } from './resident-dossier.service';

// `condominiumId` is set by CondominiumAccessGuard from the session-bound slug;
// `user` is the authenticated JWT payload. `residentId` is a path param scoped
// by the same guard's tenant. Every method forwards `user.sub` so reads and
// writes are audited against the acting user.
type AuthedRequest = { condominiumId: string; user: JwtPayload };

// Holding ANY view tier reaches the read endpoints; the service then filters
// records to the confidentiality levels the caller actually unlocks.
const ANY_VIEW = [
  'residents.dossier.view',
  'residents.dossier.viewRestricted',
  'residents.dossier.viewLegal',
] as const;

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
  @ApiOperation({ summary: 'Create a dossier entry' })
  create(
    @Request() req: AuthedRequest,
    @Param('residentId') residentId: string,
    @Body() dto: CreateDossierEntryDto,
  ) {
    return this.service.create(req.condominiumId, residentId, req.user.sub, dto);
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
