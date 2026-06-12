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
import { CreateQuotationRequestDto } from './dto/create-quotation-request.dto';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ListQuotationsDto } from './dto/list-quotations.dto';
import { UpdateQuotationRequestDto } from './dto/update-quotation-request.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationsService } from './quotations.service';

// `condominiumId` is set by CondominiumAccessGuard from the session-bound slug;
// `user` is the authenticated JWT payload. Mutations forward `user.sub` so every
// audit row records the acting user. Reads need only JWT + tenant access (same
// convention as the suppliers module).
type AuthedRequest = { condominiumId: string; user: JwtPayload };

@ApiTags('Quotations')
@UseGuards(CondominiumAccessGuard)
@Controller('condominiums/:condominiumSlug/quotations')
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  @ApiOperation({ summary: 'List quotation requests (paginated)' })
  findAll(
    @Request() req: { condominiumId: string },
    @Query() query: ListQuotationsDto,
  ) {
    return this.quotationsService.findAll(req.condominiumId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a quotation request with its quotations' })
  findOne(@Request() req: { condominiumId: string }, @Param('id') id: string) {
    return this.quotationsService.findOne(req.condominiumId, id);
  }

  @Post()
  @RequirePermission('quotations.manage')
  @ApiOperation({ summary: 'Create a quotation request' })
  create(@Request() req: AuthedRequest, @Body() dto: CreateQuotationRequestDto) {
    return this.quotationsService.create(req.condominiumId, req.user.sub, dto);
  }

  @Patch(':id')
  @RequirePermission('quotations.manage')
  @ApiOperation({ summary: 'Update a quotation request (status, selection, …)' })
  update(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationRequestDto,
  ) {
    return this.quotationsService.update(
      req.condominiumId,
      req.user.sub,
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermission('quotations.manage')
  @ApiOperation({ summary: 'Delete (soft) a quotation request' })
  remove(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.quotationsService.remove(req.condominiumId, req.user.sub, id);
  }

  @Post(':id/quotations')
  @RequirePermission('quotations.manage')
  @ApiOperation({ summary: 'Add a provider quotation to a request' })
  addQuotation(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CreateQuotationDto,
  ) {
    return this.quotationsService.addQuotation(
      req.condominiumId,
      req.user.sub,
      id,
      dto,
    );
  }

  @Patch(':id/quotations/:quotationId')
  @RequirePermission('quotations.manage')
  @ApiOperation({ summary: 'Update a provider quotation' })
  updateQuotation(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Param('quotationId') quotationId: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.updateQuotation(
      req.condominiumId,
      req.user.sub,
      id,
      quotationId,
      dto,
    );
  }

  @Delete(':id/quotations/:quotationId')
  @RequirePermission('quotations.manage')
  @ApiOperation({ summary: 'Remove a provider quotation from a request' })
  removeQuotation(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Param('quotationId') quotationId: string,
  ) {
    return this.quotationsService.removeQuotation(
      req.condominiumId,
      req.user.sub,
      id,
      quotationId,
    );
  }
}
