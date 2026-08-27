import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AppPackage, WorkspaceInstallation } from '../models/plugin-manager.models';
import { PluginManagerService } from '../services/plugin-manager.service';
import { TelemetryService } from '../services/telemetry.service';
import { compareSemver, isNewerVersion } from '../utils/semver';

interface InstalledEntry {
  packageName: string;
  installations: WorkspaceInstallation[];
  catalogPkg: AppPackage | null;
  upgradeAvailable: boolean;
}

interface InstalledTableRow extends Record<string, string> {
  packageName: string;
  displayName: string;
  detailHref: string;
  installedVersion: string;
  availableVersion: string;
  type: string;
  workspaces: string;
  lastActivity: string;
}

@Component({
  selector: 'app-installed',
  standalone: false,
  templateUrl: './installed.component.html',
  styleUrl: './installed.component.scss',
})
export class InstalledComponent implements OnInit {
  entries: InstalledEntry[] = [];
  private readonly tableRowsSubject = new BehaviorSubject<InstalledTableRow[]>([]);
  readonly tableRows$ = this.tableRowsSubject.asObservable();
  feedId: string | null = null;

  hasPermission = true;
  loading = true;
  error = '';
  actionLoading: string | null = null;
  upgradingAll = false;
  selectedPackageNames: string[] = [];

  constructor(
    private appStoreService: PluginManagerService,
    public router: Router,
    private telemetry: TelemetryService,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadInstalledApps();
  }

  get upgradesAvailable(): number {
    return this.entries.filter(entry => entry.upgradeAvailable).length;
  }

  get selectedEntries(): InstalledEntry[] {
    return this.selectedPackageNames
      .map(packageName => this.entries.find(entry => entry.packageName === packageName) ?? null)
      .filter((entry): entry is InstalledEntry => !!entry);
  }

  get hasSelectedRows(): boolean {
    return this.selectedPackageNames.length > 0;
  }

  get canUpgradeAll(): boolean {
    if (!this.hasPermission || this.upgradingAll || !!this.actionLoading) {
      return false;
    }

    return this.upgradesAvailable > 0;
  }

  get canUpgradeSelected(): boolean {
    if (!this.hasPermission || this.upgradingAll || !!this.actionLoading) {
      return false;
    }

    return this.selectedEntries.some(entry => entry.upgradeAvailable);
  }

  get canUninstallSelected(): boolean {
    if (!this.hasPermission || this.upgradingAll || !!this.actionLoading) {
      return false;
    }

    return this.selectedEntries.some(entry => this.uninstallableInstallations(entry).length > 0);
  }

  openDetail(entry: InstalledEntry): void {
    this.router.navigate(['/catalog', entry.packageName]);
  }

  onTableSelectionChange(event: Event): void {
    const selectionEvent = event as CustomEvent<{ selectedRecordIds: string[] }>;
    this.selectedPackageNames = selectionEvent.detail?.selectedRecordIds ?? [];
  }

  onAnchorColumnClick(event: Event): void {
    const anchor = (event.target as HTMLElement)?.closest('a');
    if (!anchor) return;
    event.preventDefault();
    const packageName = anchor.getAttribute('href')?.replace('#/catalog/', '');
    if (packageName) {
      this.router.navigate(['/catalog', packageName]);
    }
  }

  async upgradeSelected(): Promise<void> {
    if (!this.hasPermission || this.upgradingAll || this.actionLoading) return;
    const upgradableEntries = this.selectedEntries.filter(entry => entry.upgradeAvailable && entry.catalogPkg);
    if (upgradableEntries.length === 0) return;

    this.actionLoading = 'bulk-upgrade';
    this.error = '';

    try {
      for (const entry of upgradableEntries) {
        const feedId = entry.catalogPkg!.sourceFeedId ?? this.feedId;
        if (!feedId) continue;
        await this.appStoreService.upgradeAppAcrossWorkspaces(
          feedId,
          entry.catalogPkg!,
          this.upgradeableInstallations(entry),
        );
      }

      await this.loadInstalledApps(false);
    } catch (e: any) {
      this.error = `Upgrade selected failed: ${e.message ?? e}`;
    } finally {
      this.actionLoading = null;
    }
  }

  async uninstallSelected(): Promise<void> {
    if (!this.hasPermission || this.upgradingAll || this.actionLoading) return;

    const selectedInstallations = this.selectedEntries
      .map(entry => this.uninstallableInstallations(entry))
      .filter(installations => installations.length > 0);
    if (selectedInstallations.length === 0) return;

    this.actionLoading = 'bulk-uninstall';
    this.error = '';

    try {
      for (const installations of selectedInstallations) {
        await this.appStoreService.uninstallAppAcrossWorkspaces(installations);
      }

      await this.loadInstalledApps(false);
    } catch (e: any) {
      this.error = `Uninstall selected failed: ${e.message ?? e}`;
    } finally {
      this.actionLoading = null;
    }
  }

  getInstalledVersionLabel(entry: InstalledEntry): string {
    const versions = [...new Set(entry.installations.map(installation => installation.version))]
      .sort((left, right) => compareSemver(right, left));

    if (versions.length === 1) {
      return `v${versions[0]}`;
    }

    return versions.map(version => `v${version}`).join(', ');
  }

  getWorkspaceSummary(entry: InstalledEntry): string {
    const names = entry.installations.map(installation => installation.workspaceName);
    return `${names.length} workspace${names.length === 1 ? '' : 's'}`;
  }

  getLastActivity(entry: InstalledEntry): string {
    return entry.installations
      .map(installation => installation.updatedAt ?? installation.installedAt)
      .sort((left, right) => right.localeCompare(left))[0] ?? '';
  }

  async upgrade(entry: InstalledEntry): Promise<void> {
    const installations = this.upgradeableInstallations(entry);
    if (!entry.catalogPkg || installations.length === 0 || this.actionLoading) return;
    const feedId = entry.catalogPkg.sourceFeedId ?? this.feedId;
    if (!feedId) return;
    const telemetryPackage = this.telemetry.packageFromAppPackage(entry.catalogPkg);
    this.actionLoading = entry.packageName;
    this.error = '';
    this.telemetry.trackPackageAction('upgrade', 'started', telemetryPackage, {
      source: 'installed_page',
      workspaceCount: installations.length,
    });
    try {
      await this.appStoreService.upgradeAppAcrossWorkspaces(
        feedId,
        entry.catalogPkg,
        installations,
      );
      this.telemetry.trackPackageAction('upgrade', 'succeeded', telemetryPackage, {
        source: 'installed_page',
        workspaceCount: installations.length,
      });
      await this.loadInstalledApps(false);
    } catch (e: any) {
      this.telemetry.trackPackageAction('upgrade', 'failed', telemetryPackage, {
        source: 'installed_page',
        workspaceCount: installations.length,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Upgrade of ${entry.packageName} failed: ${e.message}`;
    } finally {
      this.actionLoading = null;
    }
  }

  async upgradeAll(): Promise<void> {
    if (!this.hasPermission || this.upgradingAll || this.actionLoading) return;
    this.upgradingAll = true;
    this.error = '';

    const upgradableEntries = this.entries.filter(entry => entry.upgradeAvailable && entry.catalogPkg);
    this.telemetry.track('plugin_manager_upgrade_all_started', {
      source: 'installed_page',
      packageCount: upgradableEntries.length,
    });

    try {
      for (const entry of upgradableEntries) {
        const feedId = entry.catalogPkg!.sourceFeedId ?? this.feedId;
        if (!feedId) continue;
        await this.appStoreService.upgradeAppAcrossWorkspaces(
          feedId,
          entry.catalogPkg!,
          this.upgradeableInstallations(entry),
        );
      }

      this.telemetry.track('plugin_manager_upgrade_all_succeeded', {
        source: 'installed_page',
        packageCount: upgradableEntries.length,
      });
      await this.loadInstalledApps(false);
    } catch (e: any) {
      this.telemetry.track('plugin_manager_upgrade_all_failed', {
        source: 'installed_page',
        packageCount: upgradableEntries.length,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Upgrade all failed: ${e.message ?? e}`;
    } finally {
      this.upgradingAll = false;
    }
  }

  async uninstall(entry: InstalledEntry): Promise<void> {
    const installations = this.uninstallableInstallations(entry);
    if (installations.length === 0 || this.actionLoading) return;
    const telemetryPackage = entry.catalogPkg
      ? this.telemetry.packageFromAppPackage(entry.catalogPkg)
      : {
        packageName: entry.packageName,
        displayName: entry.packageName,
        version: entry.installations[0]?.version ?? null,
        type: entry.installations[0]?.type ?? null,
        sourceFeedId: entry.installations[0]?.feedId ?? null,
      };
    this.actionLoading = entry.packageName;
    this.error = '';
    this.telemetry.trackPackageAction('uninstall', 'started', telemetryPackage, {
      source: 'installed_page',
      workspaceCount: installations.length,
    });
    try {
      await this.appStoreService.uninstallAppAcrossWorkspaces(installations);
      this.telemetry.trackPackageAction('uninstall', 'succeeded', telemetryPackage, {
        source: 'installed_page',
        workspaceCount: installations.length,
      });
      await this.loadInstalledApps(false);
    } catch (e: any) {
      this.telemetry.trackPackageAction('uninstall', 'failed', telemetryPackage, {
        source: 'installed_page',
        workspaceCount: installations.length,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Uninstall of ${entry.packageName} failed: ${e.message}`;
    } finally {
      this.actionLoading = null;
    }
  }

  private async loadInstalledApps(showSpinner = true): Promise<void> {
    if (showSpinner) {
      this.loading = true;
    }

    try {
      try {
        await this.appStoreService.listWebapps();
        this.hasPermission = true;
      } catch {
        this.hasPermission = false;
      }

      // Load feed configs and installed webapps in parallel
      const [feedConfigs, installations] = await Promise.all([
        this.appStoreService.loadFeedConfigs(),
        this.appStoreService.listInstalledWebapps(),
      ]);
      const accessibleInstallations = installations.filter(installation => installation.hasWorkspaceAccess);

      this.feedId = feedConfigs[0]?.feedId ?? null;

      // If no feed config, infer from installed webapps
      if (!this.feedId && accessibleInstallations.length > 0) {
        this.feedId = accessibleInstallations[0].feedId || null;
      }

      let catalogMap = new Map<string, AppPackage>();
      if (feedConfigs.length > 0) {
        const packages = await this.appStoreService.listPackagesFromFeeds(feedConfigs);
        for (const pkg of packages) {
          catalogMap.set(pkg.packageName, pkg);
        }
      } else if (this.feedId) {
        const packages = await this.appStoreService.listPackages(this.feedId);
        for (const pkg of packages) {
          catalogMap.set(pkg.packageName, pkg);
        }
      }

      // Group installations by packageName
      const groupedInstallations = new Map<string, WorkspaceInstallation[]>();
      for (const installation of accessibleInstallations) {
        const list = groupedInstallations.get(installation.packageName) ?? [];
        list.push(installation);
        groupedInstallations.set(installation.packageName, list);
      }

      this.entries = [...groupedInstallations.entries()]
        .map(([packageName, pkgInstallations]) => {
          const catalogPkg = catalogMap.get(packageName) ?? null;
          return {
            packageName,
            installations: pkgInstallations.sort((left, right) => left.workspaceName.localeCompare(right.workspaceName)),
            catalogPkg,
            upgradeAvailable: !!catalogPkg && pkgInstallations.some(i =>
              this.canUpgradeInstallation(i) && isNewerVersion(catalogPkg.version, i.version)
            ),
          };
        })
        .sort((left, right) => {
          const leftName = left.catalogPkg?.displayName ?? left.packageName;
          const rightName = right.catalogPkg?.displayName ?? right.packageName;
          return leftName.localeCompare(rightName) || left.packageName.localeCompare(right.packageName);
        });

      this.tableRowsSubject.next(this.entries.map(entry => this.toTableRow(entry)));
      this.selectedPackageNames = this.selectedPackageNames.filter(packageName =>
        this.entries.some(entry => entry.packageName === packageName),
      );
    } catch (e: any) {
      this.error = e.message ?? 'Failed to load installed apps';
      this.tableRowsSubject.next([]);
      this.selectedPackageNames = [];
    } finally {
      this.loading = false;
    }
  }

  private toTableRow(entry: InstalledEntry): InstalledTableRow {
    const primaryType = entry.installations[0]?.type ?? 'webapp';
    const workspaceList = entry.installations
      .map(installation => installation.isCurrentWorkspace
        ? `${installation.workspaceName} (current)`
        : installation.workspaceName)
      .join(', ');
    const availableVersion = entry.upgradeAvailable && entry.catalogPkg
      ? `v${entry.catalogPkg.version}`
      : 'Up to date';
    const lastActivity = this.getLastActivity(entry);

    return {
      packageName: entry.packageName,
      displayName: entry.catalogPkg?.displayName ?? entry.packageName,
      detailHref: `#/catalog/${entry.packageName}`,
      installedVersion: this.getInstalledVersionLabel(entry),
      availableVersion,
      type: primaryType,
      workspaces: workspaceList,
      lastActivity: lastActivity ? new Date(lastActivity).toLocaleDateString() : 'Unknown',
    };
  }

  private canUpgradeInstallation(installation: WorkspaceInstallation): boolean {
    return installation.hasWorkspaceAccess
      && this.appStoreService.canUpgradeApp(installation.webappCapabilities, installation.type);
  }

  private upgradeableInstallations(entry: InstalledEntry): WorkspaceInstallation[] {
    return entry.installations.filter(installation => this.canUpgradeInstallation(installation));
  }

  private canUninstallInstallation(installation: WorkspaceInstallation): boolean {
    return installation.hasWorkspaceAccess
      && this.appStoreService.canUninstallApp(installation.webappCapabilities, installation.type);
  }

  private uninstallableInstallations(entry: InstalledEntry): WorkspaceInstallation[] {
    return entry.installations.filter(installation => this.canUninstallInstallation(installation));
  }
}
