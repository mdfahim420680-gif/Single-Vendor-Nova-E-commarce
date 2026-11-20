import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidBangladeshMobile, normalizeBangladeshMobile } from './bdPhoneValidation';

test('Bangladesh mobile validation accepts every supported prefix and canonicalizes it', () => {
  for (const prefix of ['013', '014', '015', '016', '017', '018', '019']) {
    const national = `${prefix}12345678`;
    assert.equal(normalizeBangladeshMobile(national), `+880${national.slice(1)}`);
  }

  assert.equal(normalizeBangladeshMobile('+8801712345678'), '+8801712345678');
  assert.equal(normalizeBangladeshMobile('8801712345678'), '+8801712345678');
  assert.equal(normalizeBangladeshMobile('01712-345-678'), '+8801712345678');
  assert.equal(normalizeBangladeshMobile('+880 (17) 1234-5678'), '+8801712345678');
});

test('Bangladesh mobile validation rejects invalid prefixes and malformed values', () => {
  const invalid = [
    '',
    '00000000000',
    '00088888888',
    '01112345678',
    '01212345678',
    '01012345678',
    '12345678901',
    '0171234567',
    '017123456789',
    '+14155552671',
    '+919876543210',
    '01712.345678',
    '01712abc678',
  ];

  for (const value of invalid) {
    assert.equal(isValidBangladeshMobile(value), false, value);
  }
  assert.equal(isValidBangladeshMobile(null), false);
  assert.equal(isValidBangladeshMobile(1712345678), false);
});
