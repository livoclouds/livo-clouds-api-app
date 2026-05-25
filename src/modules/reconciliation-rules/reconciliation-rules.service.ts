import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

const REORDER_CHANGE_LOG_NAME = '(reorder)';

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
    // Priority is no longer user-editable. New rules are appended at the end
    // of the list (MAX(priority) + 1, starting from 1). Reordering happens
    // through the dedicated reorder() endpoint.
    const aggregate = await this.prisma.reconciliationRule.aggregate({
      where: { condominiumId },
      _max: { priority: true },
    });
    const nextPriority = (aggregate._max.priority ?? 0) + 1;

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
        priority: nextPriority,
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

  /**
   * Reorder all reconciliation rules of a condominium.
   *
   * `ruleIds` must contain every rule of the condominium exactly once. The
   * priorities are rewritten as 1..N inside a single transaction, so a
   * partial failure leaves the previous order intact. A REORDERED entry is
   * appended to the change log so the "rules modified since last reapply"
   * banner prompts the user to reapply rules to pending transactions —
   * because changing rule order can change which rule wins the first-match
   * loop during classification.
   */
  async reorder(
    condominiumId: string,
    ruleIds: string[],
    actorUserId?: string,
  ) {
    const existing = await this.prisma.reconciliationRule.findMany({
      where: { condominiumId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((r) => r.id));

    if (ruleIds.length !== existingIds.size) {
      throw new ConflictException(
        `Reorder payload must contain every rule of the condominium exactly once (expected ${existingIds.size}, received ${ruleIds.length}).`,
      );
    }
    for (const id of ruleIds) {
      if (!existingIds.has(id)) {
        throw new ConflictException(
          `Rule ${id} does not belong to this condominium.`,
        );
      }
    }

    const updated = await this.prisma.$transaction(
      ruleIds.map((id, index) =>
        this.prisma.reconciliationRule.update({
          where: { id },
          data: { priority: index + 1 },
        }),
      ),
    );

    await this.recordChange(
      condominiumId,
      null,
      REORDER_CHANGE_LOG_NAME,
      RuleChangeAction.REORDERED,
      actorUserId,
    );

    return updated.sort((a, b) => a.priority - b.priority);
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

    // Delete + resequence the remaining rules to 1..N atomically so the
    // displayed priority always matches its position in the list.
    await this.prisma.$transaction(async (tx) => {
      await tx.reconciliationRule.delete({ where: { id } });
      const remaining = await tx.reconciliationRule.findMany({
        where: { condominiumId },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      await Promise.all(
        remaining.map((r, index) =>
          tx.reconciliationRule.update({
            where: { id: r.id },
            data: { priority: index + 1 },
          }),
        ),
      );
    });

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

    const userIds = [
      ...new Set(
        changes
          .map((c) => c.changedByUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
    const userNameMap = new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]),
    );

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
        changedByUserName: c.changedByUserId
          ? (userNameMap.get(c.changedByUserId) ?? null)
          : null,
      })),
    };
  }

  /**
   * Accept a single change log entry — marks it as applied without triggering
   * re-classification. Returns the updated pending-changes snapshot so the
   * caller can refresh the UI in one round-trip.
   */
  async acceptChange(
    condominiumId: string,
    changeId: string,
    actorUserId?: string,
  ) {
    const entry = await this.prisma.reconciliationRuleChangeLog.findFirst({
      where: { id: changeId, condominiumId, appliedAt: null },
    });
    if (!entry) throw new NotFoundException('Change log entry not found');

    await this.prisma.reconciliationRuleChangeLog.update({
      where: { id: changeId },
      data: { appliedAt: new Date(), appliedByUserId: actorUserId ?? null },
    });

    return this.getPendingChanges(condominiumId);
  }

  /**
   * Discard the pending TOGGLED change(s) for a single rule, identified by
   * any one of its unapplied TOGGLED change log entries. Applies the same
   * parity logic as discardPendingToggles but scoped to one rule. Returns
   * the updated pending-changes snapshot plus the (potentially) reverted rule.
   */
  async discardSingleToggle(
    condominiumId: string,
    changeId: string,
    actorUserId?: string,
  ) {
    const entry = await this.prisma.reconciliationRuleChangeLog.findFirst({
      where: { id: changeId, condominiumId, appliedAt: null },
    });
    if (!entry) throw new NotFoundException('Change log entry not found');
    if (entry.action !== 'TOGGLED') {
      throw new BadRequestException(
        'Only TOGGLED changes can be individually discarded',
      );
    }
    if (!entry.ruleId) throw new BadRequestException('Change has no associated rule');

    // Collect all unapplied TOGGLED entries for this rule.
    const pendingToggles = await this.prisma.reconciliationRuleChangeLog.findMany({
      where: {
        condominiumId,
        ruleId: entry.ruleId,
        action: 'TOGGLED',
        appliedAt: null,
      },
      select: { id: true },
    });

    await this.prisma.reconciliationRuleChangeLog.deleteMany({
      where: { id: { in: pendingToggles.map((t) => t.id) } },
    });

    let updatedRule = null;
    if (pendingToggles.length % 2 === 1) {
      const rule = await this.prisma.reconciliationRule.findFirst({
        where: { id: entry.ruleId, condominiumId },
      });
      if (rule) {
        updatedRule = await this.prisma.reconciliationRule.update({
          where: { id: entry.ruleId },
          data: { isActive: !rule.isActive },
        });
        this.emitRuleModified(
          condominiumId,
          updatedRule.id,
          updatedRule.name,
          updatedRule.isActive ? 'updated' : 'deactivated',
          actorUserId,
        );
      }
    }

    const pending = await this.getPendingChanges(condominiumId);
    return { updatedRule, ...pending };
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
