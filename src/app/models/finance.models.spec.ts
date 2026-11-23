import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAssetAppSource, getAppBrandColor } from './finance.models.ts';

describe('Finance Models & App Helpers', () => {
  describe('getAssetAppSource', () => {
    it('should identify known broker apps from appSource', () => {
      assert.equal(getAssetAppSource({ appSource: 'indmoney' }), 'INDmoney');
      assert.equal(getAssetAppSource({ appSource: 'GROWW' }), 'Groww');
      assert.equal(getAssetAppSource({ appSource: 'zerodha' }), 'Zerodha');
      assert.equal(getAssetAppSource({ appSource: 'cdsl statement' }), 'CDSL / NSDL');
      assert.equal(getAssetAppSource({ appSource: 'csv import' }), 'CSV Import');
    });

    it('should extract broker name from notes if appSource is missing', () => {
      assert.equal(
        getAssetAppSource({ notes: 'Imported from Zerodha statement (ISIN: INE123A01025)' }),
        'Zerodha'
      );
      assert.equal(
        getAssetAppSource({ notes: 'Imported from Groww' }),
        'Groww'
      );
    });

    it('should return "Manual" when no source or non-import notes exist', () => {
      assert.equal(getAssetAppSource({}), 'Manual');
      assert.equal(getAssetAppSource({ notes: 'Regular manual entry' }), 'Manual');
      assert.equal(getAssetAppSource({ appSource: '', notes: '' }), 'Manual');
    });
  });

  describe('getAppBrandColor', () => {
    it('should return designated brand colors for known brokers', () => {
      assert.equal(getAppBrandColor('INDmoney'), '#6366F1');
      assert.equal(getAppBrandColor('Groww'), '#00D09C');
      assert.equal(getAppBrandColor('Zerodha'), '#387ED1');
      assert.equal(getAppBrandColor('CDSL / NSDL'), '#F59E0B');
      assert.equal(getAppBrandColor('CSV Import'), '#06B6D4');
      assert.equal(getAppBrandColor('Manual'), '#EC4899');
      assert.equal(getAppBrandColor('Imported'), '#8B5CF6');
    });

    it('should return fallback color for unknown source', () => {
      assert.equal(getAppBrandColor('CustomBroker'), '#A855F7');
    });
  });
});
