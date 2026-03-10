import { Component, OnDestroy, OnInit } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.scss'
})
export class App implements OnInit, OnDestroy {
  currentTheme: 'light' | 'dark' = 'light';
  private themeObserver: MutationObserver | null = null;

  ngOnInit(): void {
    this.currentTheme = this.detectInitialTheme();
    this.watchParentTheme();
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
  }

  private detectInitialTheme(): 'light' | 'dark' {
    // Priority 1: URL query parameter (?theme=dark)
    try {
      const params = new URLSearchParams(window.location.search);
      const p = params.get('theme');
      if (p === 'light' || p === 'dark') return p;
    } catch { /* ignore */ }

    // Priority 2: Parent frame's nimble-theme-provider (same-origin iframe)
    try {
      if (window.parent !== window) {
        const parentProvider = window.parent.document.querySelector('nimble-theme-provider');
        const t = parentProvider?.getAttribute('theme');
        if (t === 'light' || t === 'dark') return t;
      }
    } catch { /* cross-origin or no parent */ }

    // Priority 3: localStorage
    try {
      const saved = localStorage.getItem('sl_app_theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }

    // Priority 4: System preference
    try {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch { /* ignore */ }

    return 'light';
  }

  private watchParentTheme(): void {
    try {
      if (window.parent === window) return;
      const parentProvider = window.parent.document.querySelector('nimble-theme-provider');
      if (!parentProvider) return;
      this.themeObserver = new MutationObserver(() => {
        const t = parentProvider.getAttribute('theme');
        if (t === 'light' || t === 'dark') {
          this.currentTheme = t;
        }
      });
      this.themeObserver.observe(parentProvider, { attributes: true, attributeFilter: ['theme'] });
    } catch { /* cross-origin — ignore */ }
  }
}
