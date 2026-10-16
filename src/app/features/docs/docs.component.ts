import { Component, inject, signal, computed, OnInit, OnDestroy, Renderer2, HostListener } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Title, Meta } from '@angular/platform-browser';
import { ThemeService } from '../../services/theme.service';
import { PwaService } from '../../services/pwa.service';

export interface McpToolDoc {
  id: string;
  name: string;
  type: 'read' | 'write';
  description: string;
  aiPromptExample: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description: string;
  }>;
  requestExample: any;
  responseExample: any;
}

@Component({
  selector: 'app-docs',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './docs.component.html',
  styleUrl: './docs.component.scss',
})
export class DocsComponent implements OnInit, OnDestroy {
  public themeService = inject(ThemeService);
  public pwaService = inject(PwaService);
  private titleService = inject(Title);
  private meta = inject(Meta);
  private renderer = inject(Renderer2);
  private doc = inject(DOCUMENT);

  searchQuery = signal<string>('');
  toolCategoryFilter = signal<'all' | 'read' | 'write' | 'portfolio' | 'transactions'>('all');
  activeSection = signal<string>('client-setup');
  clientTab = signal<'antigravity' | 'claude' | 'cursor' | 'curl'>('antigravity');
  copiedSnippetId = signal<string | null>(null);
  showBackToTop = signal<boolean>(false);

  private jsonLdScriptEl?: HTMLScriptElement;

  readonly tools: McpToolDoc[] = [
    {
      id: 'get_net_worth_overview',
      name: 'get_net_worth_overview',
      type: 'read',
      description:
        'Calculates user total net worth, total invested capital, current portfolio valuation, liquid funds vs illiquid funds, overall gain/loss, and percentage breakdown across asset classes.',
      aiPromptExample: '"What is my total net worth and how much is currently in liquid funds?"',
      parameters: [
        {
          name: 'uid',
          type: 'string',
          required: false,
          description: 'Firebase user ID. Defaults to DEFAULT_USER_UID from environment variables.',
        },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_net_worth_overview',
          arguments: {},
        },
        id: 1,
      },
      responseExample: {
        totalNetWorth: 1845200,
        totalInvested: 1420000,
        totalCurrentValue: 1845200,
        totalProfit: 425200,
        profitPercentage: 29.9,
        liquidAssets: 480000,
        illiquidAssets: 1365200,
        assetsCount: 14,
        breakdown: {
          MutualFund: { value: 720000, percentage: 39, count: 5 },
          Stock: { value: 645200, percentage: 35, count: 6 },
          FixedDeposit: { value: 350000, percentage: 19, count: 2 },
          Cash: { value: 130000, percentage: 7, count: 1 },
        },
      },
    },
    {
      id: 'list_assets',
      name: 'list_assets',
      type: 'read',
      description:
        'Lists investment assets and holdings in the portfolio, with optional filtering by asset type (Stock, MutualFund, FixedDeposit, Gold, Cash, etc.) or liquidity status.',
      aiPromptExample: '"List all my mutual fund investments and their current values."',
      parameters: [
        {
          name: 'uid',
          type: 'string',
          required: false,
          description: 'Firebase user ID.',
        },
        {
          name: 'type',
          type: 'string',
          required: false,
          description: 'Filter: Stock | USStock | MutualFund | FixedDeposit | Bond | ETF | Gold | Cash | RealEstate | Crypto | Other',
        },
        {
          name: 'isLiquid',
          type: 'boolean',
          required: false,
          description: 'Filter by liquid assets (cash/FD) vs illiquid investments.',
        },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list_assets',
          arguments: {
            type: 'MutualFund',
          },
        },
        id: 2,
      },
      responseExample: {
        count: 2,
        assets: [
          {
            id: 'mf_01',
            name: 'Parag Parikh Flexi Cap Fund',
            type: 'MutualFund',
            quantity: 685.42,
            buyPrice: 62.15,
            currentPrice: 84.32,
            currency: 'INR',
            isLiquid: false,
            appSource: 'Groww',
          },
          {
            id: 'mf_02',
            name: 'UTI Nifty 50 Index Fund',
            type: 'MutualFund',
            quantity: 1250.0,
            buyPrice: 110.2,
            currentPrice: 142.8,
            currency: 'INR',
            isLiquid: false,
            appSource: 'Zerodha Coin',
          },
        ],
      },
    },
    {
      id: 'add_asset',
      name: 'add_asset',
      type: 'write',
      description:
        'Adds a new investment or holding to the user portfolio (e.g. buying shares, mutual fund units, gold, or bank deposits).',
      aiPromptExample: '"Add 15 shares of Infosys bought at ₹1,480 each via Zerodha."',
      parameters: [
        { name: 'name', type: 'string', required: true, description: 'Asset display name (e.g. "Infosys", "SBI FD")' },
        { name: 'type', type: 'AssetType', required: true, description: 'Asset classification enum' },
        { name: 'quantity', type: 'number', required: true, description: 'Units or shares held' },
        { name: 'buyPrice', type: 'number', required: true, description: 'Average purchase price per unit' },
        { name: 'currentPrice', type: 'number', required: false, description: 'Current price (defaults to buyPrice)' },
        { name: 'currency', type: 'string', required: false, description: 'Currency code (default: INR)' },
        { name: 'notes', type: 'string', required: false, description: 'Broker name, folio number, or notes' },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'add_asset',
          arguments: {
            name: 'Infosys Ltd',
            type: 'Stock',
            quantity: 15,
            buyPrice: 1480,
            currentPrice: 1495,
            currency: 'INR',
            notes: 'Bought on Zerodha Kite',
          },
        },
        id: 3,
      },
      responseExample: {
        message: 'Asset "Infosys Ltd" added successfully.',
        assetId: 'x7K9L2pQ8',
      },
    },
    {
      id: 'update_asset_price',
      name: 'update_asset_price',
      type: 'write',
      description: 'Updates current market price and notes for an existing asset by ID.',
      aiPromptExample: '"Update asset x7K9L2pQ8 current price to ₹1,520."',
      parameters: [
        { name: 'assetId', type: 'string', required: true, description: 'Firestore ID of the asset document' },
        { name: 'currentPrice', type: 'number', required: true, description: 'New market price per unit' },
        { name: 'notes', type: 'string', required: false, description: 'Updated notes or rationale' },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'update_asset_price',
          arguments: {
            assetId: 'x7K9L2pQ8',
            currentPrice: 1520,
          },
        },
        id: 4,
      },
      responseExample: {
        message: 'Asset x7K9L2pQ8 price updated to 1520.',
      },
    },
    {
      id: 'list_transactions',
      name: 'list_transactions',
      type: 'read',
      description:
        'Queries transaction records with filters for type (Income/Expense/Buy/Sell), category, bank account, date range, or limit.',
      aiPromptExample: '"Show my top expenses in the Food category for October 2026."',
      parameters: [
        { name: 'type', type: 'string', required: false, description: 'Income | Expense | Buy | Sell' },
        { name: 'category', type: 'string', required: false, description: 'e.g. Food, Utilities, Shopping, Salary' },
        { name: 'bank', type: 'string', required: false, description: 'Bank or payment mode filter' },
        { name: 'startDate', type: 'string', required: false, description: 'Start date filter (YYYY-MM-DD)' },
        { name: 'endDate', type: 'string', required: false, description: 'End date filter (YYYY-MM-DD)' },
        { name: 'limit', type: 'number', required: false, description: 'Maximum records (default 50)' },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'list_transactions',
          arguments: {
            type: 'Expense',
            category: 'Food',
            limit: 5,
          },
        },
        id: 5,
      },
      responseExample: {
        count: 2,
        totalAmount: 1850,
        transactions: [
          {
            id: 'tx_01',
            type: 'Expense',
            amount: 1200,
            description: 'Grocery at Zepto',
            category: 'Food',
            bank: 'HDFC',
            date: '2026-10-14T10:15:00.000Z',
          },
          {
            id: 'tx_02',
            type: 'Expense',
            amount: 650,
            description: 'Dinner at Swiggy',
            category: 'Food',
            bank: 'UPI / HDFC',
            date: '2026-10-12T20:30:00.000Z',
          },
        ],
      },
    },
    {
      id: 'add_transaction',
      name: 'add_transaction',
      type: 'write',
      description: 'Records a new income, expense, or investment transaction in FinTracker.',
      aiPromptExample: '"Record an expense of ₹450 for coffee via HDFC."',
      parameters: [
        { name: 'type', type: 'string', required: true, description: 'Income | Expense | Buy | Sell' },
        { name: 'amount', type: 'number', required: true, description: 'Transaction amount in INR' },
        { name: 'description', type: 'string', required: true, description: 'Short note or merchant description' },
        { name: 'category', type: 'string', required: false, description: 'Category (default: General)' },
        { name: 'bank', type: 'string', required: false, description: 'Bank account or card used' },
        { name: 'date', type: 'string', required: false, description: 'ISO date string or YYYY-MM-DD' },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'add_transaction',
          arguments: {
            type: 'Expense',
            amount: 450,
            description: 'Specialty Coffee Roasters',
            category: 'Dining',
            bank: 'HDFC Bank',
          },
        },
        id: 6,
      },
      responseExample: {
        message: 'Expense transaction of ₹450 recorded successfully.',
        transactionId: 'tx_9981a',
      },
    },
    {
      id: 'get_cashflow_summary',
      name: 'get_cashflow_summary',
      type: 'read',
      description:
        'Summarizes monthly or yearly cashflow: total income, total expenses, net savings, savings rate (%), and top 5 expense categories.',
      aiPromptExample: '"What is my savings rate and burn rate for this month?"',
      parameters: [
        { name: 'year', type: 'number', required: false, description: 'Target year (e.g. 2026)' },
        { name: 'month', type: 'number', required: false, description: 'Target month (1 to 12)' },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_cashflow_summary',
          arguments: {
            year: 2026,
            month: 10,
          },
        },
        id: 7,
      },
      responseExample: {
        period: '2026-10',
        totalIncome: 125000,
        totalExpense: 48200,
        netSavings: 76800,
        savingsRate: 61.4,
        transactionsCount: 38,
        topExpenseCategories: [
          { category: 'Rent', amount: 22000, percentage: 45.6 },
          { category: 'Food & Groceries', amount: 11400, percentage: 23.7 },
          { category: 'Utilities', amount: 4800, percentage: 10.0 },
          { category: 'Transit', amount: 3500, percentage: 7.3 },
          { category: 'Entertainment', amount: 2500, percentage: 5.2 },
        ],
      },
    },
    {
      id: 'get_emergency_runway',
      name: 'get_emergency_runway',
      type: 'read',
      description:
        'Calculates emergency financial runway in months by comparing liquid net worth (Cash + FDs) against recent average monthly burn rate.',
      aiPromptExample: '"How many months of emergency runway do I currently have?"',
      parameters: [
        { name: 'uid', type: 'string', required: false, description: 'Firebase user ID' },
      ],
      requestExample: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'get_emergency_runway',
          arguments: {},
        },
        id: 8,
      },
      responseExample: {
        runwayMonths: 9.9,
        liquidNetWorth: 480000,
        averageMonthlyExpense: 48500,
        targetRunwayMonths: 6,
        status: 'safe',
      },
    },
  ];

  readonly antigravityConfigCode = `{
  "mcpServers": {
    "fintracker": {
      "url": "https://your-fintracker-mcp.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_AUTH_TOKEN"
      }
    }
  }
}`;

  readonly claudeConfigCode = `{
  "mcpServers": {
    "fintracker": {
      "url": "https://your-fintracker-mcp.onrender.com/sse",
      "headers": {
        "Authorization": "Bearer YOUR_SECRET_AUTH_TOKEN"
      }
    }
  }
}`;

  readonly curlTestCode = `# 1. Test public health check
curl https://your-fintracker-mcp.onrender.com/

# 2. Test authenticated SSE transport
curl -N -H "Authorization: Bearer YOUR_SECRET_AUTH_TOKEN" \\
     https://your-fintracker-mcp.onrender.com/sse`;

  filteredTools = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.toolCategoryFilter();

    return this.tools.filter((t) => {
      // Category filter check
      if (filter === 'read' && t.type !== 'read') return false;
      if (filter === 'write' && t.type !== 'write') return false;
      if (
        filter === 'portfolio' &&
        !['get_net_worth_overview', 'list_assets', 'add_asset', 'update_asset_price', 'get_emergency_runway'].includes(
          t.id
        )
      ) {
        return false;
      }
      if (
        filter === 'transactions' &&
        !['list_transactions', 'add_transaction', 'get_cashflow_summary'].includes(t.id)
      ) {
        return false;
      }

      // Search query check (name, description, type, prompt, parameter names)
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.type.toLowerCase().includes(q) ||
        t.aiPromptExample.toLowerCase().includes(q) ||
        t.parameters.some((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      );
    });
  });

  clearSearch(): void {
    this.searchQuery.set('');
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    this.showBackToTop.set(y > 320);
    this.updateActiveSectionOnScroll();
  }

  scrollToTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private updateActiveSectionOnScroll(): void {
    const sectionIds = [
      'get_emergency_runway',
      'update_asset_price',
      'add_transaction',
      'add_asset',
      'get_cashflow_summary',
      'list_transactions',
      'list_assets',
      'get_net_worth_overview',
      'tools-catalog',
      'authentication',
      'client-setup',
    ];
    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top <= 160) {
          this.activeSection.set(id);
          break;
        }
      }
    }
  }

  ngOnInit(): void {
    window.scrollTo(0, 0);

    // Dynamic SEO Metadata
    this.titleService.setTitle(
      'FinTracker Developer Documentation & MCP API Reference | Model Context Protocol'
    );
    this.meta.updateTag({
      name: 'description',
      content:
        'Official FinTracker Developer Documentation. Connect AI agents (Claude, Antigravity, Cursor) via Model Context Protocol (MCP) to query personal finance, net worth, portfolio assets, and transactions.',
    });
    this.meta.updateTag({
      name: 'keywords',
      content:
        'FinTracker API, Model Context Protocol, MCP server, finance mcp, claude mcp, antigravity ide mcp, personal finance api, portfolio api, firestore finance tracker',
    });
    this.meta.updateTag({ property: 'og:title', content: 'FinTracker Developer Hub & MCP Protocol Reference' });
    this.meta.updateTag({
      property: 'og:description',
      content:
        'Full documentation for FinTracker MCP remote server, tool specifications, schemas, and $0 cloud deployment guide.',
    });
    this.meta.updateTag({ property: 'og:url', content: 'https://dmfintracker.web.app/docs' });
    this.meta.updateTag({ name: 'twitter:title', content: 'FinTracker Developer Documentation & MCP Reference' });
    this.meta.updateTag({
      name: 'twitter:description',
      content: 'Connect your AI directly to your personal wealth intelligence with open-source MCP tools.',
    });

    // Inject JSON-LD Structured Data for Search Engines
    this.injectStructuredData();
  }

  ngOnDestroy(): void {
    if (this.jsonLdScriptEl) {
      this.renderer.removeChild(this.doc.head, this.jsonLdScriptEl);
    }
  }

  private injectStructuredData(): void {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: 'FinTracker Model Context Protocol (MCP) Developer Specification',
      description:
        'Technical documentation for deploying and connecting the FinTracker MCP server to AI assistants with SSE streaming and tool calling.',
      author: {
        '@type': 'Person',
        name: 'Dinesh Murugan',
      },
      publisher: {
        '@type': 'Organization',
        name: 'FinTracker',
        url: 'https://dmfintracker.web.app/',
      },
      url: 'https://dmfintracker.web.app/docs',
      keywords: ['MCP', 'Model Context Protocol', 'Finance Tracker', 'AI Agent Tools', 'Firestore API'],
    };

    this.jsonLdScriptEl = this.renderer.createElement('script');
    this.jsonLdScriptEl!.type = 'application/ld+json';
    this.jsonLdScriptEl!.text = JSON.stringify(jsonLd);
    this.renderer.appendChild(this.doc.head, this.jsonLdScriptEl);
  }

  copySnippet(code: string, id: string): void {
    navigator.clipboard.writeText(code).then(() => {
      this.copiedSnippetId.set(id);
      setTimeout(() => {
        if (this.copiedSnippetId() === id) {
          this.copiedSnippetId.set(null);
        }
      }, 2500);
    });
  }

  copyObjectSnippet(obj: any, id: string): void {
    this.copySnippet(JSON.stringify(obj, null, 2), id);
  }

  copyPrompt(prompt: string, id: string): void {
    const cleanPrompt = prompt.replace(/^["']|["']$/g, '');
    this.copySnippet(cleanPrompt, id);
  }

  scrollToSection(sectionId: string): void {
    this.activeSection.set(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      const yOffset = -76;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  }
}
