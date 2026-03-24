import { Injectable, signal, inject, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { timer, firstValueFrom } from 'rxjs';
import { switchMap, shareReplay, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';

export interface MarketIndex {
    name: string;
    price: number;
    change: number;
    changePercent: number;
}

export interface MarketMover {
    symbol: string;
    name: string;
    currentPrice: number;
    change: number;
    changePercent: number;
    volume: number;
}

const STOCK_UNIVERSE = [
    "RELIANCE", "TCS", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "SBIN", "LICI", "ITC", "HINDUNILVR",
    "LT", "BAJFINANCE", "ADANIENT", "HCLTECH", "MARUTI", "SUNPHARMA", "ADANIPORTS", "TITAN", "KOTAKBANK", "ONGC",
    "TATAMOTORS", "NTPC", "AXISBANK", "ULTRACEMCO", "ASIANPAINT", "COALINDIA", "BAJAJFINSV", "M&M", "ADANIPOWER", "JSWSTEEL"
];

@Injectable({ providedIn: 'root' })
export class MarketService {
    private http = inject(HttpClient);
    private readonly PROXIES = [
        'https://corsproxy.io/?url=',
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://api.allorigins.win/raw?url=',
    ];
    private lastData: any = null;
    isFetching = signal(false);

    private isMarketOpen(): boolean {
        const now = new Date();
        // Indian Standard Time is UTC+5:30
        const istOffset = 5.5 * 60 * 60 * 1000;
        const istTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);

        const day = istTime.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
        const hours = istTime.getHours();
        const minutes = istTime.getMinutes();
        const currentTimeInMinutes = hours * 60 + minutes;

        const marketOpen = 9 * 60 + 15; // 9:15 AM
        const marketClose = 15 * 60 + 30; // 3:30 PM

        // Mon-Fri and between 9:15 AM and 3:30 PM
        const isWeekday = day >= 1 && day <= 5;
        const isTimeRange = currentTimeInMinutes >= marketOpen && currentTimeInMinutes <= marketClose;

        return isWeekday && isTimeRange;
    }

    private async fetchFromYahoo(symbol: string): Promise<any> {
        // Yahoo Chart endpoint is much more lenient than Quote for keyless/proxy access
        const yahooHosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
        for (const host of yahooHosts) {
            const url = `https://${host}/v8/finance/chart/${symbol}?interval=1d&range=1d`;

            for (const proxy of this.PROXIES) {
                try {
                    const proxyUrl = `${proxy}${encodeURIComponent(url)}`;
                    const response: any = await firstValueFrom(this.http.get(proxyUrl));
                    const meta = response?.chart?.result?.[0]?.meta;
                    if (meta) {
                        return {
                            symbol: meta.symbol,
                            price: meta.regularMarketPrice,
                            prevClose: meta.previousClose,
                            change: meta.regularMarketPrice - meta.previousClose,
                            changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
                            volume: 0 // Deep volume not available in meta
                        };
                    }
                } catch (err) {
                    console.warn(`Proxy ${proxy} failed for ${symbol} on ${host}, trying next...`);
                }
            }
        }
        return null;
    }

    private async fetchFromNSE(): Promise<any> {
        // NSE API endpoint provided by user
        const url = 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050';

        for (const proxy of this.PROXIES) {
            try {
                const proxyUrl = `${proxy}${encodeURIComponent(url)}`;
                const response: any = await firstValueFrom(this.http.get(proxyUrl));

                if (response && response.data) {
                    const niftyData = response.data.find((d: any) => d.symbol === 'NIFTY 50');
                    const stocks = response.data.filter((d: any) => d.symbol !== 'NIFTY 50');
                    console.log(stocks, response, 'nse');
                    return {
                        nifty: niftyData ? {
                            price: niftyData.lastPrice,
                            change: niftyData.change,
                            changePerc: niftyData.pChange
                        } : null,
                        stocks: stocks.map((s: any) => ({
                            symbol: s.symbol,
                            name: s.symbol,
                            currentPrice: s.lastPrice,
                            change: s.change,
                            changePercent: s.pChange,
                            volume: s.totalTradedVolume
                        }))
                    };
                }
            } catch (err) {
                console.warn(`Proxy ${proxy} failed for NSE API, trying next...`);
            }
        }
        return null;
    }

    // Poll every 60s when market is open, every 5 min when closed
    marketSummary$ = timer(0, 15000).pipe(
        switchMap(async (tick) => {
            const isOpen = this.isMarketOpen();
            // When market is closed, only refetch every 5 min (every 20th tick at 15s)
            if (!isOpen && this.lastData && tick % 20 !== 0) {
                return { ...this.lastData, isClosed: true };
            }

            this.isFetching.set(true);
            let nifty, sensex, processed;

            try {
                // Tier 1: Yahoo Finance
                const [yNifty, ySensex] = await Promise.all([
                    this.fetchFromYahoo('^NSEI'),
                    this.fetchFromYahoo('^BSESN')
                ]);

                const stockResults = await Promise.all(
                    STOCK_UNIVERSE.map(s => this.fetchFromYahoo(`${s}.NS`))
                );

                nifty = yNifty;
                sensex = ySensex;
                processed = stockResults.filter(q => q !== null).map(q => ({
                    symbol: q.symbol.replace('.NS', ''),
                    name: q.symbol.replace('.NS', ''),
                    currentPrice: q.price,
                    change: q.change,
                    changePercent: q.changePercent,
                    volume: q.volume
                }));
            } catch (e) {
                console.warn("Yahoo Finance Tier failed, falling back to NSE India API...");
            }

            // Tier 2 Fallback: NSE India API (If Yahoo failed or returned no data)
            if (!nifty || !processed || processed.length === 0) {
                const nseData = await this.fetchFromNSE();
                if (nseData) {
                    console.info("Successfully fetched fallback data from NSE India API");
                    if (!nifty) {
                        nifty = {
                            price: nseData.nifty?.price || 0,
                            change: nseData.nifty?.change || 0,
                            changePercent: nseData.nifty?.changePerc || 0
                        };
                    }
                    if (!processed || processed.length === 0) {
                        processed = nseData.stocks;
                    }
                }
            }

            const result = {
                indexes: {
                    nifty50: {
                        lastPrice: nifty?.price || 0,
                        dayChange: nifty?.change || 0,
                        dayChangePerc: nifty?.changePercent || 0
                    },
                    sensex: {
                        lastPrice: sensex?.price || 0,
                        dayChange: sensex?.change || 0,
                        dayChangePerc: sensex?.changePercent || 0
                    }
                },
                topGainers: [...(processed || [])].sort((a, b) => b.changePercent - a.changePercent).slice(0, 10),
                topLosers: [...(processed || [])].sort((a, b) => a.changePercent - b.changePercent).slice(0, 10),
                highVolume: [...(processed || [])].sort((a, b) => b.volume - a.volume).slice(0, 10),
                timestamp: Date.now(),
                isClosed: !isOpen
            };

            this.lastData = result;
            this.isFetching.set(false);
            return result;
        }),
        shareReplay(1)
    );

    // Individual signals derived from summary
    summary = toSignal(this.marketSummary$, { initialValue: null as any });

    indices = computed(() => {
        const sum = this.summary();
        if (!sum) return [];
        return [
            {
                name: 'Nifty 50',
                price: sum.indexes.nifty50.lastPrice,
                change: sum.indexes.nifty50.dayChange,
                changePercent: sum.indexes.nifty50.dayChangePerc
            },
            {
                name: 'Sensex',
                price: sum.indexes.sensex.lastPrice,
                change: sum.indexes.sensex.dayChange,
                changePercent: sum.indexes.sensex.dayChangePerc
            }
        ];
    });


    private getISTTime(): Date {
        const now = new Date();
        const istOffset = 5.5 * 60 * 60 * 1000;
        return new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + istOffset);
    }

    private getNextOpeningTime(): Date {
        const istTime = this.getISTTime();
        let nextOpen = new Date(istTime);
        nextOpen.setHours(9, 15, 0, 0);

        const currentTimeInMinutes = istTime.getHours() * 60 + istTime.getMinutes();
        const marketOpenMinutes = 9 * 60 + 15;

        // If it's already past 9:15 AM today, or it's weekend, find the next weekday
        if (currentTimeInMinutes >= marketOpenMinutes || istTime.getDay() === 0 || istTime.getDay() === 6) {
            // Move to next day
            nextOpen.setDate(nextOpen.getDate() + 1);
            
            // Skip weekends
            while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6) {
                nextOpen.setDate(nextOpen.getDate() + 1);
            }
        } else if (istTime.getDay() >= 1 && istTime.getDay() <= 5) {
            // It's a weekday and before 9:15 AM, today at 9:15 AM is the next open
            // (Already set by initial nextOpen value)
        }

        return nextOpen;
    }

    // Countdown signal
    private countdownInterval$ = timer(0, 1000).pipe(
        map(() => {
            if (this.isMarketOpen()) return null;
            
            const istTime = this.getISTTime();
            const nextOpen = this.getNextOpeningTime();
            const diff = nextOpen.getTime() - istTime.getTime();
            
            if (diff <= 0) return null;

            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            return {
                hours: hours.toString().padStart(2, '0'),
                minutes: minutes.toString().padStart(2, '0'),
                seconds: seconds.toString().padStart(2, '0'),
                formatted: `${hours}h ${minutes}m ${seconds}s`
            };
        }),
        shareReplay(1)
    );

    timeUntilOpen = toSignal(this.countdownInterval$, { initialValue: null });

    getTopGainers() { return computed(() => this.summary()?.topGainers || []); }
    getTopLosers() { return computed(() => this.summary()?.topLosers || []); }
    getHighVolume() { return computed(() => this.summary()?.highVolume || []); }
    isMarketClosed = computed(() => this.summary()?.isClosed ?? false);
}
