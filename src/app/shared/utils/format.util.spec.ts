import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCompactNumber } from './format.util.ts';

describe('formatCompactNumber', () => {
  it('should format numbers >= 1 Crore correctly', () => {
    assert.equal(formatCompactNumber(10000000), '1 Cr');
    assert.equal(formatCompactNumber(13500000), '1.35 Cr');
    assert.equal(formatCompactNumber(50000000), '5 Cr');
  });

  it('should format numbers >= 1 Lakh correctly in short and long forms', () => {
    assert.equal(formatCompactNumber(100000, 'short'), '1 L');
    assert.equal(formatCompactNumber(100000, 'long'), '1 Lakh');
    assert.equal(formatCompactNumber(550000, 'short'), '5.5 L');
    assert.equal(formatCompactNumber(82000, 'short'), '82K');
  });

  it('should format thousands (K) correctly without redundant trailing zeros', () => {
    assert.equal(formatCompactNumber(1000), '1K');
    assert.equal(formatCompactNumber(50000), '50K');
    assert.equal(formatCompactNumber(99999), '100K');
  });

  it('should format numbers below 1,000 as plain values', () => {
    assert.equal(formatCompactNumber(500), '500');
    assert.equal(formatCompactNumber(0), '0');
  });

  it('should format currency prefix correctly', () => {
    assert.equal(formatCompactNumber(10000000, 'currency'), '₹1 Cr');
    assert.equal(formatCompactNumber(250000, 'currency'), '₹2.5 L');
    assert.equal(formatCompactNumber(5000, 'currency'), '₹5K');
  });

  it('should handle negative numbers correctly with sign preserved', () => {
    assert.equal(formatCompactNumber(-10000000), '-1 Cr');
    assert.equal(formatCompactNumber(-250000, 'currency'), '-₹2.5 L');
    assert.equal(formatCompactNumber(-500), '-500');
  });

  it('should handle falsy/empty/invalid inputs gracefully', () => {
    assert.equal(formatCompactNumber(null), '');
    assert.equal(formatCompactNumber(undefined), '');
    assert.equal(formatCompactNumber(''), '');
    assert.equal(formatCompactNumber('invalid_str'), 'invalid_str');
  });
});
