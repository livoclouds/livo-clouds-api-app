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
import { CreateVisitorLogDto } from './dto/create-visitor-log.dto';
import { UpdateVisitorLogDto } from './dto/update-visitor-log.dto';
import { ListVisitorLogsDto } from './dto/list-visitor-logs.dto';
import { SecurityService } from './security.service';

// `condominiumId` comes from CondominiumAccessGuard (session-bound slug); `user`
// is the JWT payload. Mutations forward `user.sub` so each audit row records the
// acting security user.
type AuthedRequest = { condominiumId: string; user: JwtPayload };

@ApiTags('Security')
@UseGuards(CondominiumAccessGuard)
@Controller()
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Get('condominiums/:condominiumSlug/security/visitors')
  @RequirePermission('security.visitors.read', 'security.visitors.manage')
  @ApiOperation({ summary: 'List visitor logs (paginated)' })
  findAllVisitors(
    @Request() req: { condominiumId: string },
    @Query() query: ListVisitorLogsDto,
  ) {
    return this.securityService.findAllVisitors(req.condominiumId, query);
  }

  @Post('condominiums/:condominiumSlug/security/visitors')
  @RequirePermission('security.visitors.manage')
  @ApiOperation({ summary: 'Register a visitor check-in' })
  createVisitor(
    @Request() req: AuthedRequest,
    @Body() dto: CreateVisitorLogDto,
  ) {
    return this.securityService.createVisitor(
      req.condominiumId,
      req.user.sub,
      dto,
    );
  }

  @Patch('condominiums/:condominiumSlug/security/visitors/:id')
  @RequirePermission('security.visitors.manage')
  @ApiOperation({ summary: 'Update a visitor log / mark check-out' })
  updateVisitor(
    @Request() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateVisitorLogDto,
  ) {
    return this.securityService.updateVisitor(
      req.condominiumId,
      req.user.sub,
      id,
      dto,
    );
  }

  @Delete('condominiums/:condominiumSlug/security/visitors/:id')
  @RequirePermission('security.visitors.manage')
  @ApiOperation({ summary: 'Soft-delete a visitor log' })
  removeVisitor(@Request() req: AuthedRequest, @Param('id') id: string) {
    return this.securityService.removeVisitor(
      req.condominiumId,
      req.user.sub,
      id,
    );
  }
}
