import { Component, OnInit, AfterViewChecked, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import { AppPackage, AppType, APP_TYPES, APP_TYPE_LABELS, InstalledApp, FeedConfig } from '../models/plugin-manager.models';
import { PluginManagerService } from '../services/plugin-manager.service';
import { TelemetryService } from '../services/telemetry.service';
import { isNewerVersion } from '../utils/semver';

@Component({
  selector: 'app-catalog',
  standalone: false,
  templateUrl: './catalog.component.html',
  styleUrl: './catalog.component.scss',
})
export class CatalogComponent implements OnInit, AfterViewChecked {
  packages: AppPackage[] = [];
  filteredPackages: AppPackage[] = [];
  /** Installed apps in the current workspace, keyed by packageName. */
  installedApps: Record<string, InstalledApp> = {};
  feedConfigs: FeedConfig[] = [];
  feedId: string | null = null;

  searchTerm = '';
  selectedCategory = '';
  selectedType: AppType | '' = '';
  appTypes = APP_TYPES;
  appTypeLabels = APP_TYPE_LABELS;
  categories: string[] = [];

  hasPermission = true;
  loading = true;
  error = '';
  installingPackage: string | null = null;
  private searchTelemetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastTrackedSearchTerm = '';
  private cardStyleSheet: CSSStyleSheet | null = null;
  private styledCards = new WeakSet<Element>();

  constructor(
    private appStoreService: PluginManagerService,
    private router: Router,
    private telemetry: TelemetryService,
    private elementRef: ElementRef,
  ) {}

  ngAfterViewChecked(): void {
    this.injectCardLayoutStyles();
  }

  async ngOnInit(): Promise<void> {
    try {
      // 1. Permission check
      try {
        await this.appStoreService.listWebapps();
      } catch {
        this.hasPermission = false;
      }

      // 2. Load feed configs and installed apps for the current workspace
      const [feedConfigs, currentWorkspace, allInstallations] = await Promise.all([
        this.appStoreService.loadFeedConfigs(),
        this.appStoreService.getWorkspace(),
        this.appStoreService.listInstalledWebapps().catch(() => [] as any[]),
      ]);
      this.feedConfigs = feedConfigs;
      this.feedId = feedConfigs[0]?.feedId ?? null;

      // Build the per-workspace installed map from the current workspace only
      this.installedApps = {};
      for (const inst of allInstallations) {
        if (inst.workspaceId === currentWorkspace) {
          this.installedApps[inst.packageName] = inst;
        }
      }

      // 3. Force onboarding when no feed is registered so the saved config and
      // Plugin Manager metadata are created, even if a replicated feed exists.
      if (feedConfigs.length === 0) {
        this.router.navigate(['/onboarding']);
        return;
      }

      // 4. Load packages from ALL configured feeds in parallel
      this.packages = await this.appStoreService.listPackagesFromFeeds(feedConfigs);
      this.categories = [...new Set(this.packages.map(p => p.category).filter(Boolean))].sort();
      this.applyFilters();
    } catch (e: any) {
      this.error = e.message ?? 'Failed to load catalog';
    } finally {
      this.loading = false;
    }
  }

  applyFilters(): void {
    let result = this.packages;
    if (this.selectedType) {
      result = result.filter(p => (p.type || 'webapp').toLowerCase() === this.selectedType);
    }
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      result = result.filter(
        p =>
          p.displayName.toLowerCase().includes(term) ||
          p.description.toLowerCase().includes(term) ||
          p.tags.toLowerCase().includes(term),
      );
    }
    if (this.selectedCategory) {
      result = result.filter(p => p.category === this.selectedCategory);
    }
    this.filteredPackages = result;
  }

  onTypeChange(value: AppType | ''): void {
    this.selectedType = value;
    this.applyFilters();
    this.telemetry.track('plugin_manager_catalog_filter_changed', {
      filterName: 'type',
      filterValue: value || 'all',
      resultCount: this.filteredPackages.length,
    });
  }

  onCategoryChange(value: string): void {
    this.selectedCategory = value;
    this.applyFilters();
    this.telemetry.track('plugin_manager_catalog_filter_changed', {
      filterName: 'category',
      filterValue: value || 'all',
      resultCount: this.filteredPackages.length,
    });
  }

  onSearchTermChange(value: string): void {
    this.searchTerm = value;
    this.applyFilters();

    if (this.searchTelemetryTimeout) {
      clearTimeout(this.searchTelemetryTimeout);
    }

    this.searchTelemetryTimeout = setTimeout(() => {
      const normalized = this.searchTerm.trim().toLowerCase();
      if (normalized === this.lastTrackedSearchTerm) {
        return;
      }

      this.lastTrackedSearchTerm = normalized;
      this.telemetry.track('plugin_manager_catalog_search_changed', {
        searchTerm: normalized,
        searchLength: normalized.length,
        resultCount: this.filteredPackages.length,
      });
    }, 400);
  }

  isInstalled(pkg: AppPackage): boolean {
    return pkg.packageName in this.installedApps;
  }

  hasUpgrade(pkg: AppPackage): boolean {
    const installed = this.installedApps[pkg.packageName];
    return !!installed && isNewerVersion(pkg.version, installed.version);
  }

  openDetail(pkg: AppPackage): void {
    this.router.navigate(['/catalog', pkg.packageName]);
  }

  getCardSubtitle(pkg: AppPackage): string {
    const type = (pkg.type || 'webapp').toLowerCase();
    switch (type) {
      case 'webapp':
        return 'Web App';
      case 'notebook':
        return 'Notebook';
      case 'dashboard':
        return 'Dashboard';
      default:
        return type.charAt(0).toUpperCase() + type.slice(1);
    }
  }

  async install(pkg: AppPackage, event: Event): Promise<void> {
    event.stopPropagation();
    if (this.installingPackage) return;

    this.installingPackage = pkg.packageName;
    const feedId = pkg.sourceFeedId ?? this.feedId;
    if (!feedId) { this.installingPackage = null; return; }
    const feedConfig = this.feedConfigs.find(f => f.feedId === feedId) ?? null;
    const telemetryPackage = this.telemetry.packageFromAppPackage(pkg);
    this.telemetry.trackPackageAction('install', 'started', telemetryPackage, {
      source: 'catalog_card',
      workspaceCount: 1,
    });
    try {
      await this.appStoreService.installApp(feedId, pkg, feedConfig);
      this.telemetry.trackPackageAction('install', 'succeeded', telemetryPackage, {
        source: 'catalog_card',
        workspaceCount: 1,
      });
      // Reload installed status after install
      const currentWorkspace = await this.appStoreService.getWorkspace();
      const allInstallations = await this.appStoreService.listInstalledWebapps();
      this.installedApps = {};
      for (const inst of allInstallations) {
        if (inst.workspaceId === currentWorkspace) {
          this.installedApps[inst.packageName] = inst;
        }
      }
    } catch (e: any) {
      this.telemetry.trackPackageAction('install', 'failed', telemetryPackage, {
        source: 'catalog_card',
        workspaceCount: 1,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Install failed: ${e.message}`;
    } finally {
      this.installingPackage = null;
    }
  }

  /**
   * Inject CSS into ok-fv-card shadow roots to fix the height propagation
   * chain that the browser's default button centering breaks.
   * card-button-content has no `part` attribute, so ::part() cannot reach it.
   */
  private injectCardLayoutStyles(): void {
    if (!this.cardStyleSheet) {
      this.cardStyleSheet = new CSSStyleSheet();
      this.cardStyleSheet.replaceSync(
        '.card-button-content { height: 100%; display: flex; flex-direction: column; } '
        + '.card-layout { flex: 1; }'
      );
    }
    const cards = this.elementRef.nativeElement.querySelectorAll('ok-fv-card');
    for (const card of cards) {
      if (card.shadowRoot && !this.styledCards.has(card)) {
        card.shadowRoot.adoptedStyleSheets = [...card.shadowRoot.adoptedStyleSheets, this.cardStyleSheet];
        this.styledCards.add(card);
      }
    }
  }

}

