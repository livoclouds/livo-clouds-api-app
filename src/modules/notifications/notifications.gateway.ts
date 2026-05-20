import { Injectable, Logger } from '@nestjs/common';
import { Notification } from '@prisma/client';
import { Subject } from 'rxjs';

/**
 * A single frame pushed down an SSE connection. The controller serializes
 * `data` as JSON and writes the `event` / `id` fields verbatim.
 */
export interface NotificationStreamEvent {
  /** SSE `event:` field — currently `sync` or `notification`. */
  event: string;
  /** SSE `data:` payload, serialized to JSON by the controller. */
  data: unknown;
  /** SSE `id:` field. Set to the notification id so reconnecting clients have a Last-Event-ID anchor. */
  id?: string;
}

/**
 * In-memory, user-scoped fan-out for notification SSE streams.
 *
 * Each connected browser tab registers one RxJS Subject; a user with multiple
 * tabs has multiple subjects in the same Set. Events are pushed only to the
 * target user's subjects — never broadcast globally. Empty Sets are dropped so
 * memory stays bounded by the count of currently connected users.
 *
 * This class is the single seam for a future horizontal-scale migration: a
 * Redis pub/sub backend would replace the `streams` map and the bodies of
 * `register` / `unregister` / `emitToUser` while keeping these public method
 * signatures, so no domain module needs to change.
 */
@Injectable()
export class NotificationsSseGateway {
  private readonly logger = new Logger(NotificationsSseGateway.name);

  private readonly streams = new Map<
    string,
    Set<Subject<NotificationStreamEvent>>
  >();

  /**
   * Registers a new stream for `userId` and returns the Subject the controller
   * subscribes to. Call `unregister` with the same Subject when the connection
   * closes.
   */
  register(userId: string): Subject<NotificationStreamEvent> {
    const subject = new Subject<NotificationStreamEvent>();
    let set = this.streams.get(userId);
    if (!set) {
      set = new Set();
      this.streams.set(userId, set);
    }
    set.add(subject);
    return subject;
  }

  /**
   * Removes a stream and completes its Subject. When the user has no remaining
   * streams the map entry is deleted to keep memory bounded.
   */
  unregister(userId: string, subject: Subject<NotificationStreamEvent>): void {
    const set = this.streams.get(userId);
    if (!set) {
      return;
    }
    set.delete(subject);
    if (!subject.closed) {
      subject.complete();
    }
    if (set.size === 0) {
      this.streams.delete(userId);
    }
  }

  /**
   * Pushes a freshly created or aggregated notification to its owner's
   * connected streams. Best-effort: a notification with no `userId` (defensive)
   * or an owner with no open streams is a silent no-op.
   */
  emitAfterWrite(notification: Notification, isAggregateUpdate: boolean): void {
    if (!notification.userId) {
      return;
    }
    this.emitToUser(notification.userId, {
      event: 'notification',
      id: notification.id,
      data: { notification, isAggregateUpdate },
    });
  }

  /** Number of users with at least one open stream. */
  getConnectionCount(): number {
    return this.streams.size;
  }

  /** Number of open streams (tabs) for a single user. */
  getUserStreamCount(userId: string): number {
    return this.streams.get(userId)?.size ?? 0;
  }

  private emitToUser(userId: string, event: NotificationStreamEvent): void {
    const set = this.streams.get(userId);
    if (!set || set.size === 0) {
      return;
    }
    // A single faulty stream must not block delivery to the user's other tabs.
    for (const subject of set) {
      try {
        subject.next(event);
      } catch (err) {
        this.logger.warn(
          `Failed to push SSE event to a stream for user ${userId}: ${String(err)}`,
        );
      }
    }
  }
}
