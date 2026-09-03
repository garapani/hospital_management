import { ArgumentsHost, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { GlobalExceptionFilter } from './global-exception.filter.js';

function mockHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function pgError(code: string): QueryFailedError {
  const driverError = Object.assign(new Error('pg error'), { code });
  const error = new QueryFailedError('SELECT 1', [], driverError);
  // TypeORM flattens driverError's own properties (code, constraint, etc.) onto the
  // QueryFailedError instance itself — real service code elsewhere in this codebase
  // (role-management.service.ts, appointments.service.ts, ...) already relies on this for
  // `.constraint`, so mirror it here rather than only setting driverError.
  return Object.assign(error, { code });
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('passes an HttpException with an object response through unchanged', () => {
    const { host, status, json } = mockHost();
    const exception = new NotFoundException('Patient not found');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(exception.getResponse());
  });

  it('wraps an HttpException with a plain-string response into a consistent JSON body', () => {
    const { host, status, json } = mockHost();
    const exception = new HttpException('Something went wrong', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({ statusCode: HttpStatus.BAD_REQUEST, message: 'Something went wrong' });
  });

  it('maps a statement-timeout QueryFailedError (57014) to 504', () => {
    const { host, status, json } = mockHost();

    filter.catch(pgError('57014'), host);

    expect(status).toHaveBeenCalledWith(504);
    expect(json).toHaveBeenCalledWith({
      statusCode: 504,
      message: 'The request took too long to process and was cancelled.',
    });
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('maps a unique-violation QueryFailedError (23505) to 409', () => {
    const { host, status, json } = mockHost();

    filter.catch(pgError('23505'), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      statusCode: 409,
      message: 'A record with this value already exists.',
    });
  });

  it('falls back to a generic 500 for an unmapped QueryFailedError code, and logs it', () => {
    const { host, status, json } = mockHost();

    filter.catch(pgError('42P01'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it('falls back to a generic 500 for a non-HttpException, non-QueryFailedError exception, and logs it', () => {
    const { host, status, json } = mockHost();

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('handles a thrown non-Error value without crashing', () => {
    const { host, status, json } = mockHost();

    filter.catch('a raw string was thrown', host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('a raw string was thrown'));
  });
});
