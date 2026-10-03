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

  it('passes the live write-barrier callback to every scheduled dependency', async () => {
    barrier.isOpen.mockReturnValue(true);

    for (const [, run, dependency] of scheduledMutators) {
      dependency.mockResolvedValue({});
      await run();
      const writeAllowed = dependency.mock.calls[dependency.mock.calls.length - 1]?.[0];
      expect(writeAllowed).toEqual(expect.any(Function));
      expect(writeAllowed()).toBe(true);
      barrier.isOpen.mockReturnValue(false);
      expect(writeAllowed()).toBe(false);
      barrier.isOpen.mockReturnValue(true);
    }
  });

  it('treats an exception from the initial barrier check as closed', async () => {
    barrier.isOpen.mockImplementation(() => { throw new Error('indeterminate'); });

    await expect(service.dispatchScheduledCommunications()).resolves.toMatchObject({ success: true });
    expect(communications.dispatchScheduledCommunications).not.toHaveBeenCalled();
  });
});
