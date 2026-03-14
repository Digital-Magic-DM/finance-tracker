import { Component, inject } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { MarketService } from '../../services/market.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-market-dashboard',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './market-dashboard.component.html',
  styleUrl: './market-dashboard.component.scss'
})
export class MarketDashboardComponent {
  private marketService = inject(MarketService);

  // Live data signals
  indices = this.marketService.indices;
  topGainers = this.marketService.getTopGainers();
  topLosers = this.marketService.getTopLosers();
  highVolume = this.marketService.getHighVolume();
  isMarketClosed = this.marketService.isMarketClosed;
  isFetching = this.marketService.isFetching;
  timeUntilOpen = this.marketService.timeUntilOpen;
}
