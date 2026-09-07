import { expect, test } from 'vitest';
import { GateError } from '../src/errors.js';
test('gate failures carry stable codes', () => {
  expect(new GateError('stale', 'Source too old').code).toBe('stale');
});

