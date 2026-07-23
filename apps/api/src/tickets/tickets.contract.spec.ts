import { validate } from 'class-validator';
import { TicketCategory } from '@prisma/client';
import { CreateTicketDto } from './dto/create-ticket.dto';

const canonicalCategories = [
  'MAINTENANCE',
  'REPAIR',
  'CLEANING',
  'COMPLAINT',
  'SAFETY',
  'BILLING',
  'OTHER',
] as const;

describe('resident ticket category contract', () => {
  it.each(canonicalCategories)('accepts frontend category %s', async (category) => {
    const dto = Object.assign(new CreateTicketDto(), {
      title: 'Valid ticket',
      description: 'A valid ticket description',
      category,
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(Object.values(TicketCategory)).toContain(category);
  });

  it.each(['GENERAL', 'RUIDO', 'MANTENIMIENTO', 'OTROS'])('rejects legacy category %s', async (category) => {
    const dto = Object.assign(new CreateTicketDto(), {
      title: 'Invalid category',
      description: 'A valid ticket description',
      category,
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'category')).toBe(true);
  });
});
