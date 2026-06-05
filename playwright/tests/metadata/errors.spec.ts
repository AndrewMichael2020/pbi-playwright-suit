import { expect, test } from '@playwright/test';
import {
  classifyHttpError,
  httpErrorFromResponse,
  PowerBiError,
} from '../../helper-functions/errors';

test('ER-001 status codes map to named domain kinds', async () => {
  expect(classifyHttpError(401)).toBe('auth');
  expect(classifyHttpError(403)).toBe('auth');
  expect(classifyHttpError(404)).toBe('notFound');
  expect(classifyHttpError(429)).toBe('throttled');
  expect(classifyHttpError(500)).toBe('service');
  expect(classifyHttpError(502)).toBe('service');
});

test('ER-002 httpErrorFromResponse builds a discriminated PowerBiError with structured context', async () => {
  const err = httpErrorFromResponse({
    status: 403,
    statusText: 'Forbidden',
    url: 'https://api.powerbi.com/v1.0/myorg/groups',
    body: '{"error":{"code":"PowerBINotAuthorizedException"}}',
  });

  expect(err).toBeInstanceOf(PowerBiError);
  expect(err).toBeInstanceOf(Error);
  expect(err.kind).toBe('auth');
  expect(err.status).toBe(403);
  expect(err.url).toBe('https://api.powerbi.com/v1.0/myorg/groups');
  expect(err.body).toContain('PowerBINotAuthorizedException');
  expect(err.name).toBe('PowerBiError');
  expect(err.message).toContain('403');
  expect(err.stack).toBeTruthy();
});

test('ER-003 the discriminant narrows the union for callers', async () => {
  const err = httpErrorFromResponse({
    status: 429,
    statusText: 'Too Many Requests',
    url: 'https://api.powerbi.com/v1.0/myorg/GenerateToken',
    body: 'rate limited',
  });

  // Exhaustive switch on the discriminant must compile and reach the right arm.
  let label: string;
  switch (err.kind) {
    case 'auth':
      label = 'auth';
      break;
    case 'notFound':
      label = 'notFound';
      break;
    case 'throttled':
      label = 'throttled';
      break;
    case 'service':
      label = 'service';
      break;
  }

  expect(label!).toBe('throttled');
});

test('ER-004 original cause is preserved without losing the domain error', async () => {
  const cause = new Error('socket hang up');
  const err = httpErrorFromResponse({
    status: 500,
    statusText: 'Internal Server Error',
    url: 'https://api.powerbi.com/v1.0/myorg/groups',
    body: '',
    cause,
  });

  expect(err.kind).toBe('service');
  expect(err.cause).toBe(cause);
});
