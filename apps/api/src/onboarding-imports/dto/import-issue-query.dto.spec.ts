import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ImportIssueQueryDto } from './import-issue-query.dto';

describe('ImportIssueQueryDto', () => {
  it('accepts numeric query strings after transforming them to pagination numbers', () => {
    const dto = plainToInstance(ImportIssueQueryDto, {
      page: '1',
      pageSize: '25',
    });

    expect(validateSync(dto)).toEqual([]);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(25);
  });

  it('rejects non-numeric pagination query values', () => {
    const dto = plainToInstance(ImportIssueQueryDto, {
      page: 'invalid',
      pageSize: 'invalid',
    });

    expect(validateSync(dto)).not.toEqual([]);
  });
});
