import { paginate } from './paginate.js';

function makeQueryBuilder(rows: { id: number }[]) {
  let skipped = 0;
  let taken = rows.length;
  return {
    skip(n: number) {
      skipped = n;
      return this;
    },
    take(n: number) {
      taken = n;
      return this;
    },
    async getManyAndCount() {
      const page = rows.slice(skipped, skipped + taken);
      return [page, rows.length] as const;
    },
  } as any;
}

describe('paginate', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));

  it('defaults to page 1, limit 20 when neither is supplied', async () => {
    const result = await paginate(makeQueryBuilder(rows), {});
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
    expect(result.meta.total).toBe(5);
    expect(result.meta.totalPages).toBe(1);
    expect(result.data).toHaveLength(5);
  });

  it('clamps page below 1 up to 1', async () => {
    const result = await paginate(makeQueryBuilder(rows), { page: 0 });
    expect(result.meta.page).toBe(1);
  });

  it('clamps negative page up to 1', async () => {
    const result = await paginate(makeQueryBuilder(rows), { page: -5 });
    expect(result.meta.page).toBe(1);
  });

  it('clamps limit above 100 down to 100', async () => {
    const result = await paginate(makeQueryBuilder(rows), { limit: 500 });
    expect(result.meta.limit).toBe(100);
  });

  it('clamps limit below 1 up to 1', async () => {
    const result = await paginate(makeQueryBuilder(rows), { limit: 0 });
    expect(result.meta.limit).toBe(1);
  });

  it('falls back to defaults for non-numeric input', async () => {
    const result = await paginate(makeQueryBuilder(rows), {
      page: Number('not-a-number'),
      limit: Number('not-a-number'),
    });
    expect(result.meta.page).toBe(1);
    expect(result.meta.limit).toBe(20);
  });
});
