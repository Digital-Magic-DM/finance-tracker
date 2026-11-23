import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundCurrency,
  calculateGain,
  calculateGainPercentage,
  calculateEmi,
  calculateCagr,
  calculateEmergencyRunway,
  calculateRetirementCorpus,
} from './financial-math.util.ts';

describe('Financial Math Utilities', () => {
  describe('roundCurrency', () => {
    it('should round numbers to 2 decimal places eliminating floating point drift', () => {
      assert.equal(roundCurrency(100.005), 100.01);
      assert.equal(roundCurrency(0.1 + 0.2), 0.3);
      assert.equal(roundCurrency(1250.554), 1250.55);
    });

    it('should handle edge cases like NaN, Infinity, and zero', () => {
      assert.equal(roundCurrency(NaN), 0);
      assert.equal(roundCurrency(Infinity), 0);
      assert.equal(roundCurrency(0), 0);
    });
  });

  describe('calculateGain', () => {
    it('should calculate positive gain accurately', () => {
      const gain = calculateGain(150000, 100000);
      assert.equal(gain, 50000);
    });

    it('should calculate negative loss accurately', () => {
      const loss = calculateGain(80000, 100000);
      assert.equal(loss, -20000);
    });
  });

  describe('calculateGainPercentage', () => {
    it('should calculate return percentage correctly', () => {
      const pct = calculateGainPercentage(150000, 100000);
      assert.equal(pct, 50);
    });

    it('should calculate loss percentage correctly', () => {
      const pct = calculateGainPercentage(75000, 100000);
      assert.equal(pct, -25);
    });

    it('should return 0 when invested amount is zero or negative to prevent divide-by-zero', () => {
      assert.equal(calculateGainPercentage(50000, 0), 0);
      assert.equal(calculateGainPercentage(50000, -100), 0);
      assert.equal(calculateGainPercentage(NaN, 1000), 0);
    });
  });

  describe('calculateEmi', () => {
    it('should compute standard reducing balance EMI correctly', () => {
      // 10 Lakhs loan, 8.5% p.a., 5 years (60 months)
      const emi = calculateEmi(1000000, 8.5, 60);
      // Standard mathematical EMI for 10L @ 8.5% for 5 years is approx 20516.53
      assert.ok(emi >= 20510 && emi <= 20520, `Expected ~20516.53, got ${emi}`);
    });

    it('should handle 0% interest rate loan as straight division', () => {
      const emi = calculateEmi(60000, 0, 12);
      assert.equal(emi, 5000);
    });

    it('should return 0 for non-positive principal or tenure', () => {
      assert.equal(calculateEmi(0, 10, 12), 0);
      assert.equal(calculateEmi(100000, 10, 0), 0);
      assert.equal(calculateEmi(-50000, 10, 12), 0);
    });
  });

  describe('calculateCagr', () => {
    it('should calculate compound annual growth rate correctly', () => {
      // 100k grows to 200k in 5 years -> CAGR is ~14.87%
      const cagr = calculateCagr(100000, 200000, 5);
      assert.equal(cagr, 14.87);
    });

    it('should return 0 for invalid inputs', () => {
      assert.equal(calculateCagr(0, 200000, 5), 0);
      assert.equal(calculateCagr(100000, 0, 5), 0);
      assert.equal(calculateCagr(100000, 200000, 0), 0);
    });
  });

  describe('calculateEmergencyRunway', () => {
    it('should calculate runway in months correctly', () => {
      const runway = calculateEmergencyRunway(300000, 50000);
      assert.equal(runway, 6);
    });

    it('should return 0 when monthly expense is zero or negative', () => {
      assert.equal(calculateEmergencyRunway(300000, 0), 0);
      assert.equal(calculateEmergencyRunway(0, 50000), 0);
    });
  });

  describe('calculateRetirementCorpus', () => {
    it('should calculate target retirement corpus using 25x multiplier', () => {
      const annualExpense = 1200000; // 1 Lakh/month
      const corpus = calculateRetirementCorpus(annualExpense, 25);
      assert.equal(corpus, 30000000); // 3 Crores
    });
  });
});
