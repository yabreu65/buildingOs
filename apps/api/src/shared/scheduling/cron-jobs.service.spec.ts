import { CronJobsService } from './cron-jobs.service';
import { ReleaseAWriteBarrierService } from '../../tenancy/release-a-write-barrier.service';

describe('CronJobsService Release A write barrier', () => {
  const communications = { dispatchScheduledCommunications: jest.fn() };
  const finanzas = {
    autoCreateMonthlyExpensePeriods: jest.fn(),
    sendPaymentReminders: jest.fn(),
  };
  const tickets = { escalateUrgentTickets: jest.fn() };
  const recurringExpenses = { processRecurringExpenses: jest.fn() };
  const financeSummaries = { sendMonthlyFinanceSummaries: jest.fn() };
  const barrier = { isOpen: jest.fn() };
  let service: CronJobsService;

  const scheduledMutators = [
    ['scheduled communications dispatch', () => service.dispatchScheduledCommunications(), communications.dispatchScheduledCommunications],
    ['monthly expense-period creation', () => service.autoCreateMonthlyExpensePeriods(), finanzas.autoCreateMonthlyExpensePeriods],
    ['payment reminders', () => service.sendPaymentReminders(), finanzas.sendPaymentReminders],
    ['urgent-ticket escalation', () => service.escalateUrgentTickets(), tickets.escalateUrgentTickets],
    ['recurring-expense processing', () => service.processRecurringExpenses(), recurringExpenses.processRecurringExpenses],
    ['monthly finance summaries', () => service.sendMonthlyFinanceSummaries(), financeSummaries.sendMonthlyFinanceSummaries],
  ] as const;

  beforeEach(() => {
    jest.clearAllMocks();
    barrier.isOpen.mockReturnValue(false);
    service = new CronJobsService(
      communications as never,
      finanzas as never,
      tickets as never,
      recurringExpenses as never,
      financeSummaries as never,
      barrier as unknown as ReleaseAWriteBarrierService,
    );
  });

  it.each(scheduledMutators)('does not call dependencies for %s while writes are blocked', async (_label, run) => {
    await run();

    for (const [, , dependency] of scheduledMutators) {
      expect(dependency).not.toHaveBeenCalled();
    }
  });

  it('runs scheduled dependencies normally after the barrier opens', async () => {
    barrier.isOpen.mockReturnValue(true);
    communications.dispatchScheduledCommunications.mockResolvedValue(2);

    await service.dispatchScheduledCommunications();

    expect(communications.dispatchScheduledCommunications).toHaveBeenCalledTimes(1);
  });
});
