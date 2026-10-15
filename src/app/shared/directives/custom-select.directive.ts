import {
    Directive,
    ElementRef,
    Renderer2,
    NgZone,
    OnInit,
    OnDestroy,
    DoCheck,
    inject
} from '@angular/core';
import { DOCUMENT } from '@angular/common';

export interface CustomSelectOption {
    value: string;
    label: string;
    selected: boolean;
    disabled: boolean;
}

@Directive({
    selector: 'select[appCustomSelect], select[customSelect]',
    standalone: true
})
export class CustomSelectDirective implements OnInit, OnDestroy, DoCheck {
    private el = inject<ElementRef<HTMLSelectElement>>(ElementRef);
    private renderer = inject(Renderer2);
    private ngZone = inject(NgZone);
    private document = inject(DOCUMENT);

    private selectEl!: HTMLSelectElement;
    private wrapperEl: HTMLElement | null = null;
    private triggerEl: HTMLElement | null = null;
    private labelEl: HTMLElement | null = null;
    private arrowEl: HTMLElement | null = null;
    private menuEl: HTMLElement | null = null;

    private mutationObserver: MutationObserver | null = null;
    private documentClickUnlisten: (() => void) | null = null;
    private scrollUnlisten: (() => void) | null = null;
    private windowResizeUnlisten: (() => void) | null = null;

    private lastValue = '';
    private lastSelectedIndex = -1;
    private lastDisabled = false;

    public isOpen = false;
    private options: CustomSelectOption[] = [];

    // Static coordinator to ensure only one custom select is open at a time
    private static activeInstance: CustomSelectDirective | null = null;

    ngOnInit(): void {
        this.selectEl = this.el.nativeElement;
        this.initCustomSelect();
    }

    private initCustomSelect(): void {
        // Hide the native select accessibly
        this.renderer.addClass(this.selectEl, 'custom-select-native-hidden');

        // Create the wrapper element
        this.wrapperEl = this.renderer.createElement('div');
        this.renderer.addClass(this.wrapperEl, 'custom-select-wrapper');

        // Propagate layout modifier classes from native select to wrapper
        const classList = Array.from(this.selectEl.classList);
        if (classList.includes('form-control')) {
            this.renderer.addClass(this.wrapperEl, 'is-form-control');
        }
        if (classList.includes('app-filter-select')) {
            this.renderer.addClass(this.wrapperEl, 'is-app-filter');
        }
        if (classList.includes('form-select')) {
            this.renderer.addClass(this.wrapperEl, 'is-form-select');
        }

        // Create the trigger button
        this.triggerEl = this.renderer.createElement('button');
        this.renderer.setAttribute(this.triggerEl!, 'type', 'button');
        this.renderer.setAttribute(this.triggerEl!, 'aria-haspopup', 'listbox');
        this.renderer.setAttribute(this.triggerEl!, 'aria-expanded', 'false');
        this.renderer.addClass(this.triggerEl!, 'custom-select-trigger');

        // Add class modifiers to trigger
        if (classList.includes('form-control')) {
            this.renderer.addClass(this.triggerEl!, 'is-form-control');
        }
        if (classList.includes('app-filter-select')) {
            this.renderer.addClass(this.triggerEl!, 'is-app-filter');
        }
        if (classList.includes('form-select')) {
            this.renderer.addClass(this.triggerEl!, 'is-form-select');
        }

        // Create the label span
        this.labelEl = this.renderer.createElement('span');
        this.renderer.addClass(this.labelEl!, 'custom-select-label');
        this.renderer.appendChild(this.triggerEl!, this.labelEl!);

        // Create the chevron arrow icon
        this.arrowEl = this.renderer.createElement('span');
        this.renderer.addClass(this.arrowEl!, 'material-icons');
        this.renderer.addClass(this.arrowEl!, 'custom-select-arrow');
        this.arrowEl!.textContent = 'expand_more';
        this.renderer.appendChild(this.triggerEl!, this.arrowEl!);

        // Append trigger to wrapper
        this.renderer.appendChild(this.wrapperEl!, this.triggerEl!);

        // Insert wrapper into DOM right after native select
        const parent = this.selectEl.parentNode;
        if (parent) {
            parent.insertBefore(this.wrapperEl!, this.selectEl.nextSibling);
        }

        // Trigger click event listener
        this.triggerEl!.addEventListener('click', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            this.toggleMenu();
        });

        // Trigger keyboard navigation
        this.triggerEl!.addEventListener('keydown', (e: KeyboardEvent) => {
            this.handleKeyDown(e);
        });

        // Listen for native select change / input events
        this.selectEl.addEventListener('change', () => this.syncFromSelect());
        this.selectEl.addEventListener('input', () => this.syncFromSelect());

        // Observe DOM mutations on <option> children
        this.mutationObserver = new MutationObserver(() => {
            this.syncFromSelect();
        });
        this.mutationObserver.observe(this.selectEl, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true
        });

        // Initial synchronization
        this.syncFromSelect();
    }

    ngDoCheck(): void {
        if (!this.selectEl) return;
        const currentVal = this.selectEl.value;
        const currentIdx = this.selectEl.selectedIndex;
        const currentDisabled = this.selectEl.disabled;

        if (
            currentVal !== this.lastValue ||
            currentIdx !== this.lastSelectedIndex ||
            currentDisabled !== this.lastDisabled
        ) {
            this.lastValue = currentVal;
            this.lastSelectedIndex = currentIdx;
            this.lastDisabled = currentDisabled;
            this.syncFromSelect();
        }
    }

    /**
     * Reads all <option> children from native select, computes selected item,
     * updates the trigger label and state.
     */
    public syncFromSelect(): void {
        if (!this.selectEl || !this.labelEl || !this.triggerEl) return;

        const optionsCount = this.selectEl.options.length;
        const newOptions: CustomSelectOption[] = [];

        for (let i = 0; i < optionsCount; i++) {
            const opt = this.selectEl.options[i];
            const item: CustomSelectOption = {
                value: opt.value,
                label: (opt.text || opt.label || opt.value).trim(),
                selected: opt.selected,
                disabled: opt.disabled
            };
            newOptions.push(item);
        }

        this.options = newOptions;

        // Determine currently active option
        let selected = this.options.find(o => o.selected);
        if (!selected && this.selectEl.selectedIndex >= 0 && this.options[this.selectEl.selectedIndex]) {
            selected = this.options[this.selectEl.selectedIndex];
        }
        if (!selected && this.options.length > 0) {
            selected = this.options[0];
        }

        this.labelEl.textContent = selected ? selected.label : (this.selectEl.getAttribute('placeholder') || 'Select...');
        (this.triggerEl as HTMLButtonElement).disabled = this.selectEl.disabled;

        // If the menu is currently open, refresh the items
        if (this.isOpen && this.menuEl) {
            this.renderMenuOptions();
        }
    }

    public toggleMenu(): void {
        if (this.isOpen) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    public openMenu(): void {
        if (this.isOpen || this.selectEl.disabled) return;

        // Close any other open instance
        if (CustomSelectDirective.activeInstance && CustomSelectDirective.activeInstance !== this) {
            CustomSelectDirective.activeInstance.closeMenu();
        }
        CustomSelectDirective.activeInstance = this;

        this.isOpen = true;
        this.renderer.setAttribute(this.triggerEl!, 'aria-expanded', 'true');
        this.renderer.addClass(this.triggerEl!, 'is-open');
        this.renderer.addClass(this.arrowEl!, 'is-open');

        // Create dropdown menu element
        this.menuEl = this.renderer.createElement('div');
        this.renderer.addClass(this.menuEl!, 'custom-select-menu');
        this.renderer.setAttribute(this.menuEl!, 'role', 'listbox');

        this.renderMenuOptions();

        // Append to document body to prevent clipping in modals/tables
        this.document.body.appendChild(this.menuEl!);

        // Position menu
        this.updateMenuPosition();

        // Scroll selected item into view
        setTimeout(() => {
            if (this.menuEl) {
                const selectedEl = this.menuEl.querySelector('.is-selected') as HTMLElement;
                if (selectedEl) {
                    selectedEl.scrollIntoView({ block: 'nearest' });
                }
            }
        }, 10);

        // Bind global outside-click listener
        this.ngZone.runOutsideAngular(() => {
            this.documentClickUnlisten = this.renderer.listen(this.document, 'click', (e: MouseEvent) => {
                const target = e.target as Node;
                if (
                    this.triggerEl &&
                    !this.triggerEl.contains(target) &&
                    this.menuEl &&
                    !this.menuEl.contains(target)
                ) {
                    this.ngZone.run(() => this.closeMenu());
                }
            });

            // Bind window resize & scroll
            const onReposition = () => {
                if (this.isOpen) {
                    this.updateMenuPosition();
                }
            };
            this.windowResizeUnlisten = this.renderer.listen('window', 'resize', onReposition);
            this.scrollUnlisten = this.renderer.listen('window', 'scroll', onReposition, { capture: true });
        });
    }

    public closeMenu(): void {
        if (!this.isOpen) return;

        this.isOpen = false;
        if (CustomSelectDirective.activeInstance === this) {
            CustomSelectDirective.activeInstance = null;
        }

        if (this.triggerEl) {
            this.renderer.setAttribute(this.triggerEl, 'aria-expanded', 'false');
            this.renderer.removeClass(this.triggerEl, 'is-open');
        }
        if (this.arrowEl) {
            this.renderer.removeClass(this.arrowEl, 'is-open');
        }

        if (this.menuEl && this.menuEl.parentNode) {
            this.menuEl.parentNode.removeChild(this.menuEl);
            this.menuEl = null;
        }

        if (this.documentClickUnlisten) {
            this.documentClickUnlisten();
            this.documentClickUnlisten = null;
        }
        if (this.scrollUnlisten) {
            this.scrollUnlisten();
            this.scrollUnlisten = null;
        }
        if (this.windowResizeUnlisten) {
            this.windowResizeUnlisten();
            this.windowResizeUnlisten = null;
        }
    }

    private renderMenuOptions(): void {
        if (!this.menuEl) return;
        this.menuEl.innerHTML = '';

        if (this.options.length === 0) {
            const emptyEl = this.renderer.createElement('div');
            this.renderer.addClass(emptyEl, 'custom-select-option');
            this.renderer.addClass(emptyEl, 'disabled');
            emptyEl.textContent = 'No options';
            this.renderer.appendChild(this.menuEl, emptyEl);
            return;
        }

        for (const opt of this.options) {
            const optEl = this.renderer.createElement('div');
            this.renderer.addClass(optEl, 'custom-select-option');
            this.renderer.setAttribute(optEl, 'role', 'option');

            if (opt.selected) {
                this.renderer.addClass(optEl, 'is-selected');
                this.renderer.setAttribute(optEl, 'aria-selected', 'true');
            }
            if (opt.disabled) {
                this.renderer.addClass(optEl, 'disabled');
                this.renderer.setAttribute(optEl, 'aria-disabled', 'true');
            }

            const textEl = this.renderer.createElement('span');
            this.renderer.addClass(textEl, 'custom-select-option-text');
            textEl.textContent = opt.label;
            this.renderer.appendChild(optEl, textEl);

            if (opt.selected) {
                const checkEl = this.renderer.createElement('span');
                this.renderer.addClass(checkEl, 'material-icons');
                this.renderer.addClass(checkEl, 'custom-select-check');
                checkEl.textContent = 'check';
                this.renderer.appendChild(optEl, checkEl);
            }

            if (!opt.disabled) {
                optEl.addEventListener('click', (e: MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.selectOption(opt.value);
                });
            }

            this.renderer.appendChild(this.menuEl, optEl);
        }
    }

    private updateMenuPosition(): void {
        if (!this.menuEl || !this.triggerEl) return;

        const rect = this.triggerEl.getBoundingClientRect();

        // If the trigger is no longer visible (e.g. modal closed or unmounted), close menu
        if (rect.width === 0 && rect.height === 0) {
            this.closeMenu();
            return;
        }

        const isAppFilter = this.selectEl.classList.contains('app-filter-select');
        const minWidth = isAppFilter ? Math.max(rect.width, 140) : Math.max(rect.width, 180);
        const maxWidth = Math.min(window.innerWidth - 20, Math.max(rect.width, 360));

        let left = rect.left;
        if (left + minWidth > window.innerWidth - 10) {
            left = Math.max(10, window.innerWidth - minWidth - 10);
        }

        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const estimatedHeight = Math.min(this.options.length * 38 + 16, 280);

        let top = 0;
        if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
            // Open upward
            top = Math.max(10, rect.top - estimatedHeight - 6);
            this.menuEl.style.transformOrigin = 'bottom left';
        } else {
            // Open downward
            top = rect.bottom + 6;
            this.menuEl.style.transformOrigin = 'top left';
        }

        this.menuEl.style.position = 'fixed';
        this.menuEl.style.zIndex = '999999';
        this.menuEl.style.left = `${Math.round(left)}px`;
        this.menuEl.style.top = `${Math.round(top)}px`;
        this.menuEl.style.minWidth = `${Math.round(minWidth)}px`;
        this.menuEl.style.maxWidth = `${Math.round(maxWidth)}px`;
    }

    public selectOption(value: string): void {
        if (this.selectEl.value === value && this.options.some(o => o.value === value && o.selected)) {
            this.closeMenu();
            return;
        }

        // Set value on native select
        this.selectEl.value = value;

        // Update selected attribute across native options
        for (let i = 0; i < this.selectEl.options.length; i++) {
            this.selectEl.options[i].selected = this.selectEl.options[i].value === value;
        }

        // Dispatch native input & change events for Angular forms / ngModel
        const changeEvent = new Event('change', { bubbles: true });
        this.selectEl.dispatchEvent(changeEvent);

        const inputEvent = new Event('input', { bubbles: true });
        this.selectEl.dispatchEvent(inputEvent);

        this.syncFromSelect();
        this.closeMenu();

        if (this.triggerEl) {
            this.triggerEl.focus();
        }
    }

    private handleKeyDown(e: KeyboardEvent): void {
        if (this.selectEl.disabled) return;

        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            this.toggleMenu();
        } else if (e.key === 'Escape') {
            if (this.isOpen) {
                e.preventDefault();
                this.closeMenu();
            }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!this.isOpen) {
                this.openMenu();
                return;
            }

            const enabledOptions = this.options.filter(o => !o.disabled);
            if (enabledOptions.length === 0) return;

            const currentIndex = enabledOptions.findIndex(o => o.selected);
            let nextIndex = currentIndex;

            if (e.key === 'ArrowDown') {
                nextIndex = currentIndex < enabledOptions.length - 1 ? currentIndex + 1 : 0;
            } else {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : enabledOptions.length - 1;
            }

            this.selectOption(enabledOptions[nextIndex].value);
        } else if (e.key === 'Tab') {
            if (this.isOpen) {
                this.closeMenu();
            }
        }
    }

    ngOnDestroy(): void {
        this.closeMenu();

        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }

        if (this.wrapperEl && this.wrapperEl.parentNode) {
            this.wrapperEl.parentNode.removeChild(this.wrapperEl);
            this.wrapperEl = null;
        }
    }
}
