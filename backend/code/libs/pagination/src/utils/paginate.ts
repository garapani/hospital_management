import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { PaginatedResponseDto } from '../dto/paginated-response.dto.js';

interface PaginationOptions {
  page?: number;
  limit?: number;
}

function resolvePageAndLimit(options: PaginationOptions): { page: number; limit: number } {
  const pageNum = Number(options.page);
  const limitNum = Number(options.limit);

  const page = isNaN(pageNum) ? 1 : Math.max(1, pageNum);
  const limit = isNaN(limitNum) ? 20 : Math.min(100, Math.max(1, limitNum));
  return { page, limit };
}

export async function paginate<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  options: PaginationOptions,
): Promise<PaginatedResponseDto<T>> {
  const { page, limit } = resolvePageAndLimit(options);
  const skip = (page - 1) * limit;

  qb.skip(skip).take(limit);
  const [data, total] = await qb.getManyAndCount();

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function paginateRaw<T>(
  qb: SelectQueryBuilder<any>,
  options: PaginationOptions,
): Promise<PaginatedResponseDto<T>> {
  const { page, limit } = resolvePageAndLimit(options);
  const skip = (page - 1) * limit;

  qb.skip(skip).take(limit);
  const [data, total] = await Promise.all([qb.getRawMany<T>(), qb.getCount()]);

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}
