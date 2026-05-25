import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, RuleChangeAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReconciliationRuleDto } from './dto/create-reconciliation-rule.dto';
import { UpdateReconciliationRuleDto } from './dto/update-reconciliation-rule.dto';
import { ListReconciliationRulesDto } from './dto/list-reconciliation-rules.dto';
import {
  RECONCILIATION_RULE_MODIFIED_EVENT,
  type ReconciliationRuleAction,
  type ReconciliationRuleModifiedEventPayload,
} from './events/reconciliation-notification-events';

@Injectable()
export class ReconciliationRulesService {
  private readonly logger = new Logger(ReconciliationRulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Best-effort notification emit — never breaks the rule write. */
  private emitRuleModified(
    condominiumId: string,
    ruleId: string,
    ruleName: string,
    action: ReconciliationRuleAction,
    actorUserId?: string,
  ): void {
    try {
      this.events.emit(RECONCILIATION_RULE_MODIFIED_EVENT, {
        condominiumId,
        ruleId,
        ruleName,
        action,
        actorUserId,
      } satisfies ReconciliationRuleModifiedEventPayload);
    } catch (err) {
      this.logger.warn(
        `emitRuleModified failed for rule ${ruleId}: ${String(err)}`,
      );
    }
  }

  /**
   * Append a row to the rule-change log. The log drives the "rules modified
   * since last reapply" banner in the web app and the apply-pending endpoint.
   */
  private async recordChange(
    condominiumId: string,
    ruleId: string | null,
    ruleName: string,
    action: RuleChangeAction,
    actorUserId?: string,
  ): Promise<void> {
    try {
      await this.prisma.reconciliationRuleChangeLog.create({
        data: {
          condominiumId,
          ruleId,
          ruleName,
          action,
          changedByUserId: actorUserId ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `recordChange failed for rule ${ruleId ?? '(deleted)'}: ${String(err)}`,
      );
    }
  }

  async findAll(condominiumId: string, dto: ListReconciliationRulesDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const skip = (page - 1) * limit;

    const where: Prisma.ReconciliationRuleWhereInput = { condominiumId };
    if (dto.isActive !== undefined) where.isActive = dto.isActive;

    const [data, total] = await Promise.all([
      this.prisma.reconciliationRule.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.reconciliationRule.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findActive(condominiumId: string) {
    return this.prisma.reconciliationRule.findMany({
      where: { condominiumId, isActive: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    condominiumId: string,
    dto: CreateReconciliationRuleDto,
    actorUserId?: string,
  ) {
    const rule = await this.prisma.reconciliationRule.create({
      data: {
        condominiumId,
        name: dto.name,
        keywords: dto.keywords,
        unitPatterns: dto.unitPatterns ?? [],
        conceptType: dto.conceptType ?? null,
        confidenceThreshold: dto.confidenceThreshold !== undefined
          ? new Prisma.Decimal(dto.confidenceThreshold.toFixed(2))
          : new Prisma.Decimal('0.80'),
        priority: dto.priority ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.recordChange(
      condominiumId,
      rule.id,
      rule.name,
      RuleChangeAction.CREATED,
      actorUserId,
    );
    this.emitRuleModified(
      condominiumId,
      rule.id,
      rule.name,
      'created',
      actorUserId,
    );
    return rule;
  }

  async update(
    condominiumId: string,
    id: string,
    dto: UpdateReconciliationRuleDto,
    actorUserId?: string,
  ) {
    await this.findOneOrFail(condominiumId, id);

    const data: Prisma.ReconciliationRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.keywords !== undefined) data.keywords = dto.keywords;
    if (dto.unitPatterns !== undefined) data.unitPatterns = dto.unitPatterns;
    if (dto.conceptType !== undefined) data.conceptType = dto.conceptType;
    if (dto.confidenceThreshold !== undefined)
      data.confidenceThreshold = new Prisma.Decimal(dto.confidenceThreshold.toFixed(2));
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const rule = await this.prisma.reconciliationRule.update({
      where: { id },
      data,
    });
    // Skip the log + notification for a no-op PATCH (empty DTO) — only a real
    // change is worth surfacing.
    if (Object.keys(data).length > 0) {
      await this.recordChange(
        condominiumId,
        rule.id,
        rule.name,
        RuleChangeAction.UPDATED,
        actorUserId,
      );
      this.emitRuleModified(
        condominiumId,
        rule.id,
        rule.name,
        'updated',
        actorUserId,
      );
    }
    return rule;
  }

  async toggleActive(condominiumId: string, id: string, actorUserId?: string) {
    const rule = await this.findOneOrFail(condominiumId, id);
    const updated = await this.prisma.reconciliationRule.update({
      where: { id },
      data: { isActive: !rule.isActive },
    });

    // Delete ALL unapplied TOGGLED entries for this rule atomically.
    // Parity determines the net direction: even deletedCount → this toggle IS
    // a new net change (record it); odd → it cancels a previous net change (skip).
    // Using deleteMany instead of findFirst+delete prevents race-condition stacking
    // when the user clicks the toggle rapidly before the first request resolves.
    const { count: deletedCount } =
      await this.prisma.reconciliationRuleChangeLog.deleteMany({
        where: {
          condominiumId,
          ruleId: id,
          action: RuleChangeAction.TOGGLED,
          appliedAt: null,
        },
      });
    if (deletedCount % 2 === 0) {
      await this.recordChange(
        condominiumId,
        updated.id,
        updated.name,
        RuleChangeAction.TOGGLED,
        actorUserId,
      );
    }

    this.emitRuleModified(
      condominiumId,
      updated.id,
      updated.name,
      updated.isActive ? 'updated' : 'deactivated',
      actorUserId,
    );
    return updated;
  }

  /**
   * Revert all pending changes for the tenant:
   * — TOGGLED entries are batch-deleted; rules with an odd accumulated count are
   *   restored to their pre-toggle DB state (odd = net change from original).
   * — All remaining unapplied entries (CREATED, UPDATED, DELETED) are stamped
   *   with appliedAt so the pending-changes banner is fully cleared on reload.
   */
  async discardPendingToggles(condominiumId: string, actorUserId?: string) {
    const pendingToggles = await this.prisma.reconciliationRuleChangeLog.findMany({
      where: {
        condominiumId,
        action: RuleChangeAction.TOGGLED,
        appliedAt: null,
        ruleId: { not: null },
      },
      select: { id: true, ruleId: true },
    });

    // Group entry IDs by ruleId to determine net state per rule.
    const byRuleId = new Map<string, string[]>();
    for (const t of pendingToggles) {
      const ruleId = t.ruleId as string;
      if (!byRuleId.has(ruleId)) byRuleId.set(ruleId, []);
      byRuleId.get(ruleId)!.push(t.id);
    }

    // Batch-delete ALL accumulated TOGGLED entries (handles race-condition duplicates).
    if (pendingToggles.length > 0) {
      await this.prisma.reconciliationRuleChangeLog.deleteMany({
        where: { id: { in: pendingToggles.map((t) => t.id) } },
      });
    }

    // Restore DB state for rules where the accumulated toggle count is odd
    // (odd = net change from original; even = already back to original).
    const updatedRules = [];
    for (const [ruleId, entryIds] of byRuleId) {
      if (entryIds.length % 2 === 1) {
        try {
          const rule = await this.prisma.reconciliationRule.findFirst({
            where: { id: ruleId, condominiumId },
          });
          if (rule) {
            const restored = await this.prisma.reconciliationRule.update({
              where: { id: ruleId },
              data: { isActive: !rule.isActive },
            });
            updatedRules.push(restored);
            this.emitRuleModified(
              condominiumId,
              restored.id,
              restored.name,
              restored.isActive ? 'updated' : 'deactivated',
              actorUserId,
            );
          }
        } catch (err) {
          this.logger.warn(
            `discardPendingToggles: failed to restore rule ${ruleId}: ${String(err)}`,
          );
        }
      }
    }

    // Mark every remaining unapplied entry (CREATED / UPDATED / DELETED) as
    // applied so getPendingChanges() returns hasPending: false after a reload.
    await this.markAllChangesApplied(condominiumId, actorUserId ?? null);

    return { discardedCount: byRuleId.size, updatedRules };
  }

  async remove(condominiumId: string, id: string, actorUserId?: string) {
    const rule = await this.findOneOrFail(condominiumId, id);
    await this.prisma.reconciliationRule.delete({ where: { id } });
    // ruleId is intentionally null — the row is gone — but we keep the name
    // as a snapshot so the UI can still render "Cuota mensual" in the change
    // list after a delete.
    await this.recordChange(
      condominiumId,
      null,
      rule.name,
      RuleChangeAction.DELETED,
      actorUserId,
    );
  }

  /**
   * Returns the unapplied rule changes for the tenant plus how many pending
   * transactions exist that would be affected by a reapply.
   */
  async getPendingChanges(condominiumId: string) {
    const [changes, pendingTransactionsCount] = await Promise.all([
      this.prisma.reconciliationRuleChangeLog.findMany({
        where: { condominiumId, appliedAt: null },
        orderBy: { changedAt: 'desc' },
      }),
      this.prisma.transaction.count({
        where: {
          condominiumId,
          classificationStatus: 'NEEDS_REVIEW',
          reconciliationStatus: 'PENDING',
        },
      }),
    ]);

    return {
      hasPending: changes.length > 0,
      pendingCount: changes.length,
      pendingTransactionsCount,
      changes: changes.map((c) => ({
        id: c.id,
        ruleId: c.ruleId,
        ruleName: c.ruleName,
        action: c.action,
        changedAt: c.changedAt.toISOString(),
        changedByUserId: c.changedByUserId,
      })),
    };
  }

  /** Mark every unapplied change for the tenant as applied by `userId` now. */
  async markAllChangesApplied(condominiumId: string, userId: string | null) {
    const result = await this.prisma.reconciliationRuleChangeLog.updateMany({
      where: { condominiumId, appliedAt: null },
      data: {
        appliedAt: new Date(),
        appliedByUserId: userId,
      },
    });
    return result.count;
  }

  private async findOneOrFail(condominiumId: string, id: string) {
    const rule = await this.prisma.reconciliationRule.findFirst({
      where: { id, condominiumId },
    });
    if (!rule) throw new NotFoundException('Reconciliation rule not found');
    return rule;
  }
}
