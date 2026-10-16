import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  resolveUserId,
  getNetWorthOverview,
  listAssets,
  addAsset,
  updateAssetPrice,
  listTransactions,
  addTransaction,
  getCashFlowSummary,
  getEmergencyRunway,
} from './tools.js';

export function createFinTrackerMcpServer(sessionUid?: string): McpServer {
  const server = new McpServer({
    name: 'fintracker-mcp',
    version: '1.0.0',
  });

  // ---------------------------------------------------------------------------
  // 1. Tool: get_net_worth_overview
  // ---------------------------------------------------------------------------
  server.tool(
    'get_net_worth_overview',
    'Calculates user total net worth, total invested capital, current valuation, liquid vs illiquid funds, overall profit/loss, and portfolio allocation breakdown across all asset classes.',
    {
      uid: z
        .string()
        .optional()
        .describe('Firebase user ID (defaults to DEFAULT_USER_UID environment variable)'),
    },
    async ({ uid }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const data = await getNetWorthOverview(resolvedUid);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to calculate net worth overview: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 2. Tool: list_assets
  // ---------------------------------------------------------------------------
  server.tool(
    'list_assets',
    'Lists investment assets and holdings in the portfolio, with optional filtering by asset type (Stock, MutualFund, FixedDeposit, Gold, RealEstate, Cash, etc.) or liquidity status.',
    {
      uid: z.string().optional().describe('Firebase user ID'),
      type: z
        .enum([
          'Stock',
          'USStock',
          'MutualFund',
          'FixedDeposit',
          'Bond',
          'ETF',
          'Gold',
          'Cash',
          'RealEstate',
          'Crypto',
          'Other',
        ])
        .optional()
        .describe('Filter by specific asset type'),
      isLiquid: z.boolean().optional().describe('Filter by liquid assets (cash/FD) vs illiquid'),
    },
    async ({ uid, type, isLiquid }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const assets = await listAssets(resolvedUid, { type, isLiquid });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: assets.length,
                  assets,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list assets: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 3. Tool: add_asset
  // ---------------------------------------------------------------------------
  server.tool(
    'add_asset',
    'Adds a new investment or holding to the user portfolio (e.g. buying shares, mutual fund units, gold, or bank deposits).',
    {
      uid: z.string().optional().describe('Firebase user ID'),
      name: z.string().describe('Name of the asset (e.g. "TCS", "Parag Parikh Flexi Cap", "HDFC FD")'),
      type: z
        .enum([
          'Stock',
          'USStock',
          'MutualFund',
          'FixedDeposit',
          'Bond',
          'ETF',
          'Gold',
          'Cash',
          'RealEstate',
          'Crypto',
          'Other',
        ])
        .describe('Asset classification type'),
      quantity: z.number().positive().describe('Quantity of units/shares held'),
      buyPrice: z.number().nonnegative().describe('Average purchase price per unit'),
      currentPrice: z.number().nonnegative().optional().describe('Current market price (defaults to buyPrice)'),
      currency: z.string().default('INR').describe('Currency code (e.g. INR, USD)'),
      isLiquid: z.boolean().optional().describe('Whether this asset can be liquidated within 48h'),
      notes: z.string().optional().describe('Notes, broker name, or tags'),
    },
    async ({ uid, name, type, quantity, buyPrice, currentPrice, currency, isLiquid, notes }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const result = await addAsset(resolvedUid, {
          name,
          type,
          quantity,
          buyPrice,
          currentPrice: currentPrice !== undefined ? currentPrice : buyPrice,
          currency: currency || 'INR',
          isLiquid: isLiquid !== undefined ? isLiquid : type === 'Cash' || type === 'FixedDeposit',
          notes,
          purchaseDate: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Asset "${name}" added successfully.`,
                  assetId: result.id,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to add asset: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 4. Tool: update_asset_price
  // ---------------------------------------------------------------------------
  server.tool(
    'update_asset_price',
    'Updates current market price for an existing asset by its ID.',
    {
      uid: z.string().optional().describe('Firebase user ID'),
      assetId: z.string().describe('Firestore ID of the asset'),
      currentPrice: z.number().positive().describe('New current price per unit'),
      notes: z.string().optional().describe('Optional updated notes'),
    },
    async ({ uid, assetId, currentPrice, notes }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        await updateAssetPrice(resolvedUid, assetId, currentPrice, notes);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ message: `Asset ${assetId} price updated to ${currentPrice}.` }),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to update asset price: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 5. Tool: list_transactions
  // ---------------------------------------------------------------------------
  server.tool(
    'list_transactions',
    'Queries transaction records with filters for type (Income/Expense/Buy/Sell), category (Food, Bills, Shopping, Salary, etc.), bank account, date range, or limit.',
    {
      uid: z.string().optional().describe('Firebase user ID'),
      type: z.enum(['Income', 'Expense', 'Buy', 'Sell']).optional().describe('Transaction type'),
      category: z.string().optional().describe('Category name (e.g. "Food", "Travel", "Investment")'),
      bank: z.string().optional().describe('Bank or payment method (e.g. "HDFC", "SBI", "GPay")'),
      startDate: z.string().optional().describe('Start date filter (YYYY-MM-DD)'),
      endDate: z.string().optional().describe('End date filter (YYYY-MM-DD)'),
      limit: z.number().positive().max(200).default(50).describe('Maximum items to return'),
    },
    async ({ uid, type, category, bank, startDate, endDate, limit }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const transactions = await listTransactions(resolvedUid, {
          type,
          category,
          bank,
          startDate,
          endDate,
          limit,
        });

        const totalAmount = transactions.reduce((acc, t) => acc + t.amount, 0);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: transactions.length,
                  totalAmount: Math.round(totalAmount * 100) / 100,
                  transactions,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to list transactions: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 6. Tool: add_transaction
  // ---------------------------------------------------------------------------
  server.tool(
    'add_transaction',
    'Records a new income, expense, or investment transaction in FinTracker.',
    {
      uid: z.string().optional().describe('Firebase user ID'),
      type: z.enum(['Income', 'Expense', 'Buy', 'Sell']).describe('Type of transaction'),
      amount: z.number().positive().describe('Transaction amount in INR'),
      description: z.string().describe('Short description (e.g. "Grocery at Zepto", "Salary", "Coffee")'),
      category: z.string().default('General').describe('Category (e.g. Food, Shopping, Utilities, Salary)'),
      bank: z.string().optional().default('Primary').describe('Bank name or payment mode (e.g. HDFC, ICICI, Cash)'),
      date: z.string().optional().describe('ISO date or YYYY-MM-DD (defaults to today)'),
      notes: z.string().optional().describe('Additional notes'),
    },
    async ({ uid, type, amount, description, category, bank, date, notes }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const result = await addTransaction(resolvedUid, {
          type,
          amount,
          description,
          category: category || 'General',
          bank: bank || 'Primary',
          date: date || new Date().toISOString(),
          notes,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `${type} transaction of ₹${amount} recorded successfully.`,
                  transactionId: result.id,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to add transaction: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 7. Tool: get_cashflow_summary
  // ---------------------------------------------------------------------------
  server.tool(
    'get_cashflow_summary',
    'Summarizes monthly or yearly cashflow: total income, total expenses, net savings, savings rate (%), and top 5 expense categories.',
    {
      uid: z.string().optional().describe('Firebase user ID'),
      year: z.number().optional().describe('Year (e.g. 2026). Defaults to current year.'),
      month: z.number().min(1).max(12).optional().describe('Month (1 to 12). If omitted, summarizes full year.'),
    },
    async ({ uid, year, month }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const summary = await getCashFlowSummary(resolvedUid, { year, month });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to compute cashflow summary: ${err.message}` }],
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // 8. Tool: get_emergency_runway
  // ---------------------------------------------------------------------------
  server.tool(
    'get_emergency_runway',
    'Calculates emergency financial runway in months by comparing liquid net worth (Cash + FDs) against recent average monthly expenses/burn rate.',
    {
      uid: z.string().optional().describe('Firebase user ID'),
    },
    async ({ uid }) => {
      try {
        const resolvedUid = resolveUserId(uid, sessionUid);
        const data = await getEmergencyRunway(resolvedUid);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to compute emergency runway: ${err.message}` }],
        };
      }
    }
  );

  return server;
}
