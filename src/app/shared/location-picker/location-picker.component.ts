import { Component, EventEmitter, Input, Output, signal, inject, OnDestroy } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap, catchError, of } from 'rxjs';
import { AssetLocation } from '../../models/finance.models';

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
}

@Component({
  selector: 'app-location-picker',
  standalone: true,
  imports: [CommonModule, DecimalPipe],
  templateUrl: './location-picker.component.html',
  styleUrl: './location-picker.component.scss'
})
export class LocationPickerComponent implements OnDestroy {
  private http = inject(HttpClient);

  @Input() set initialLocation(loc: AssetLocation | undefined) {
    if (loc) {
      this.location.set(loc);
    }
  }

  @Output() locationChange = new EventEmitter<AssetLocation>();

  location = signal<AssetLocation>({
    type: 'manual', // Although requested as free approach, we keep manual as default for fallback
    name: ''
  });

  suggestions = signal<NominatimResult[]>([]);
  searching = signal(false);
  showDropdown = signal(false);

  private searchSubject = new Subject<string>();

  constructor() {
    this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(query => {
        if (query.length < 3) return of([]);
        this.searching.set(true);
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
        return this.http.get<NominatimResult[]>(url).pipe(
          catchError(() => of([]))
        );
      })
    ).subscribe(results => {
      this.suggestions.set(results);
      this.searching.set(false);
      this.showDropdown.set(results.length > 0);
    });
  }

  onSearchInput(event: any) {
    const query = event.target.value;
    // If user is typing, we update the local generic value but don't emit yet if we want search-only
    this.location.update(l => ({ ...l, name: query }));
    this.searchSubject.next(query);
  }

  selectSuggestion(res: NominatimResult) {
    const newLoc: AssetLocation = {
      type: 'map', // Mapping OSM results to 'map' type as per stored format
      name: res.display_name,
      lat: parseFloat(res.lat),
      lng: parseFloat(res.lon)
    };
    this.location.set(newLoc);
    this.suggestions.set([]);
    this.showDropdown.set(false);
    this.locationChange.emit(newLoc);
  }

  clearSelection() {
    this.location.set({ type: 'manual', name: '' });
    this.locationChange.emit(this.location());
  }

  ngOnDestroy() {
    this.searchSubject.complete();
  }
}
