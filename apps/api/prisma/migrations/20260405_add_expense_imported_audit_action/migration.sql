-- Add EXPENSE_IMPORTED to AuditAction enum for tracking Excel/CSV imports
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_IMPORTED' AFTER 'EXPENSE_UPDATE';
