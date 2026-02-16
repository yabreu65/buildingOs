import { BadRequestException } from '@nestjs/common';
import { TicketStatus } from '@prisma/client';

/**
 * TicketStateMachine: Validate ticket status transitions
 *
 * Valid transitions:
 * - OPEN → IN_PROGRESS | CLOSED (cancel)
 * - IN_PROGRESS → RESOLVED | OPEN (revert)
 * - RESOLVED → CLOSED | IN_PROGRESS (revert)
 * - CLOSED → OPEN (reopen with reason)
 */
export class TicketStateMachine {
  static readonly VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
    [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS, TicketStatus.CLOSED],
    [TicketStatus.IN_PROGRESS]: [TicketStatus.RESOLVED, TicketStatus.OPEN],
    [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.IN_PROGRESS],
    [TicketStatus.CLOSED]: [TicketStatus.OPEN],
  };

  /**
   * Validate that a status transition is allowed
   * @throws BadRequestException if transition is invalid
   */
  static validateTransition(
    currentStatus: TicketStatus,
    newStatus: TicketStatus,
  ): void {
    const allowedTransitions = this.VALID_TRANSITIONS[currentStatus];

    if (!allowedTransitions) {
      throw new BadRequestException(
        `Unknown current status: ${currentStatus}`,
      );
    }

    if (!allowedTransitions.includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition: ${currentStatus} → ${newStatus}. Allowed: ${allowedTransitions.join(', ')}`,
      );
    }
  }

  /**
   * Get allowed transitions for a status
   */
  static getAllowedTransitions(status: TicketStatus): TicketStatus[] {
    return this.VALID_TRANSITIONS[status] || [];
  }

  /**
   * Check if reopening a ticket (transitioning to OPEN from CLOSED)
   */
  static isReopening(currentStatus: TicketStatus, newStatus: TicketStatus): boolean {
    return currentStatus === TicketStatus.CLOSED && newStatus === TicketStatus.OPEN;
  }
}
