import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../phone-model.mjs';

test('bare ten-digit numbers gain 91; existing country codes and explicit international numbers are preserved', () => {
  for (const [input, expected] of [
    ['9876543210', '919876543210'], [' 9876543210 ', '919876543210'],
    ['919876543210', '919876543210'], ['+919876543210', '+919876543210'],
    ['+14155552671', '+14155552671'], ['+4412345678', '+4412345678'],
    ['12345678', '12345678'], ['123456789012345', '123456789012345']
  ]) assert.equal(normalizePhone(input), expected);
});

test('phone normalization keeps strict validation without stripping separators or invalid prefixes', () => {
  for (const input of [null, undefined, 9876543210, '', '0123456789', '+0123456789',
    '1234567', '1234567890123456', '+1234567890123456', '98 76543210',
    '98765-43210', '(987)6543210', '++919876543210', '9876543210abc', '９８７６５４３２１０',
    '98765\n43210', '98765\u200b43210']) assert.equal(normalizePhone(input), null);
});