import { Component, ElementRef, OnInit, ViewChild, isDevMode } from '@angular/core';
import { Router } from '@angular/router';
import { PLUGIN_MANAGER_VERSION, FeedConfig, DEFAULT_FEED_URL, NI_FEED_CONFIG_NAME } from '../models/plugin-manager.models';
import { PluginManagerService } from '../services/plugin-manager.service';
import { TelemetryService } from '../services/telemetry.service';

type MockPhaseOption = {
  value: string;
  label: string;
  description: string;
};

type SettingsSectionId = 'feeds' | 'preview' | 'about';

interface SettingsSectionGroup {
  title: string;
  items: { id: SettingsSectionId; label: string }[];
}

@Component({
  selector: 'app-settings',
  standalone: false,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  @ViewChild('addFeedDialog') private addFeedDialogEl?: ElementRef;
  @ViewChild('removeFeedDialog') private removeFeedDialogEl?: ElementRef;

  feeds: FeedConfig[] = [];
  installedCount = 0;
  readonly version = PLUGIN_MANAGER_VERSION;
  readonly niFeedConfigName = NI_FEED_CONFIG_NAME;
  readonly isDevelopmentMode = isDevMode();
  readonly hostedAuthMode = 'Same-origin cookies';
  readonly currentOrigin = window.location.origin;
  readonly sectionGroups: readonly SettingsSectionGroup[] = this.isDevelopmentMode
    ? [
      {
        title: 'Configuration',
        items: [
          { id: 'feeds', label: 'Feeds' },
          { id: 'preview', label: 'Lifecycle Preview' },
        ],
      },
      {
        title: 'Application',
        items: [{ id: 'about', label: 'About' }],
      },
    ]
    : [
      {
        title: 'Configuration',
        items: [{ id: 'feeds', label: 'Feeds' }],
      },
      {
        title: 'Application',
        items: [{ id: 'about', label: 'About' }],
      },
    ];
  readonly mockPhaseOptions: MockPhaseOption[] = [
    {
      value: '',
      label: 'Live Data',
      description: 'Use the current SystemLink environment without lifecycle mocking.',
    },
    {
      value: 'not-onboarded',
      label: 'Not Onboarded',
      description: 'Show the onboarding flow before any feed is configured.',
    },
    {
      value: 'catalog',
      label: 'Catalog Available',
      description: 'Show a configured feed with catalog data but no installed packages.',
    },
    {
      value: 'installed',
      label: 'Apps Installed',
      description: 'Show installed packages across readable workspaces.',
    },
    {
      value: 'upgrade',
      label: 'Upgrade Available',
      description: 'Show installed packages with an upgrade available for Plugin Manager.',
    },
  ];
  activeSection: SettingsSectionId = 'feeds';
  selectedMockPhase = '';

  loading = true;
  refreshingFeedId: string | null = null;
  refreshResult = '';
  error = '';

  // Add-feed form
  addFeedUrl = '';
  addFeedName = '';
  addFeedShouldReplicate = true;
  private addFeedReplicationDefault = true;
  addingFeed = false;
  addingNiFeed = false;
  feedPendingRemoval: FeedConfig | null = null;
  deleteReplicatedFeedOnRemove = true;
  removingFeed = false;
  availableNiFeed: { id: string; name: string } | null = null;

  constructor(
    private appStoreService: PluginManagerService,
    public router: Router,
    private telemetry: TelemetryService,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      this.selectedMockPhase = this.appStoreService.getMockPhase() ?? '';
      const [feedConfigs, installations, availableNiFeed] = await Promise.all([
        this.appStoreService.loadFeedConfigs(),
        this.appStoreService.listInstalledWebapps().catch(() => [] as any[]),
        this.appStoreService.discoverFeed().catch(() => null),
      ]);
      this.feeds = feedConfigs;
      this.installedCount = installations.length;
      this.availableNiFeed = availableNiFeed;
    } catch (e: any) {
      this.error = e.message ?? 'Failed to load settings';
    } finally {
      this.loading = false;
    }
  }

  get hasFeedConfig(): boolean {
    return this.feeds.length > 0;
  }

  get configuredFeedCount(): number {
    return this.feeds.length;
  }

  get canAddNiFeed(): boolean {
    const configuredNiFeed = this.getConfiguredNiFeed();
    if (!configuredNiFeed) return true;
    if (!this.availableNiFeed) return true;
    return configuredNiFeed.feedId !== this.availableNiFeed.id;
  }

  get niFeedActionLabel(): string {
    return this.getConfiguredNiFeed() && !this.availableNiFeed ? 'Re-add NI Feed' : 'Add NI Feed';
  }

  get selectedMockPhaseDescription(): string {
    return this.mockPhaseOptions.find(option => option.value === this.selectedMockPhase)?.description
      ?? this.mockPhaseOptions[0].description;
  }

  selectSection(sectionId: SettingsSectionId): void {
    this.activeSection = sectionId;
  }

  applyMockPhase(value: string): void {
    if (!this.isDevelopmentMode) {
      return;
    }

    const url = new URL(window.location.href);
    const currentPhase = url.searchParams.get('mockPhase') ?? '';
    if (value === currentPhase) {
      return;
    }

    this.telemetry.track('plugin_manager_mock_phase_changed', {
      mockPhase: value || 'live-data',
      source: 'settings',
    });

    if (value) {
      url.searchParams.set('mockPhase', value);
    } else {
      url.searchParams.delete('mockPhase');
    }

    window.location.assign(url.toString());
  }

  async refreshFeed(feed: FeedConfig): Promise<void> {
    if (this.refreshingFeedId) return;
    this.refreshingFeedId = feed.feedId;
    this.refreshResult = '';
    this.error = '';
    this.telemetry.track('plugin_manager_feed_refresh_started', {
      feedId: feed.feedId,
      feedName: feed.name,
      feedUrl: feed.url,
    });
    try {
      const resourceIds = await this.appStoreService.checkForUpdates(feed.feedId);
      await this.appStoreService.applyUpdates(feed.feedId, resourceIds);
      await this.appStoreService.ensureOwnWebappTagged(feed);
      this.refreshResult = resourceIds.length > 0
        ? `Feed "${feed.name}" refreshed successfully.`
        : `Feed "${feed.name}" is already up to date.`;
      this.telemetry.track('plugin_manager_feed_refresh_succeeded', {
        feedId: feed.feedId,
        feedName: feed.name,
        feedUrl: feed.url,
        updateCount: resourceIds.length,
      });
    } catch (e: any) {
      this.telemetry.track('plugin_manager_feed_refresh_failed', {
        feedId: feed.feedId,
        feedName: feed.name,
        feedUrl: feed.url,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Feed refresh failed: ${e.message}`;
    } finally {
      this.refreshingFeedId = null;
    }
  }

  async addFeed(): Promise<void> {
    if (this.addingFeed || !this.addFeedUrl.trim() || !this.addFeedName.trim()) return;
    this.addingFeed = true;
    this.error = '';
    this.refreshResult = '';
    try {
      const name = this.addFeedName.trim();
      const sourceUrl = this.addFeedUrl.trim();
      const shouldReplicate = this.addFeedShouldReplicate;
      let feedId = '';
      this.telemetry.track('plugin_manager_feed_add_started', {
        feedName: name,
        feedUrl: sourceUrl,
        replicate: shouldReplicate,
      });

      if (shouldReplicate) {
        const result = await this.appStoreService.replicateFeed(sourceUrl, name);
        feedId = result.id ?? result.feedId ?? '';
      } else {
        const existingFeed = await this.appStoreService.findFeedBySourceUrl(sourceUrl).catch(() => null);
        if (!existingFeed?.id) {
          throw new Error('No existing SystemLink feed matches this URL. Enable replication to create one.');
        }
        feedId = existingFeed.id;
      }

      const feedConfig: FeedConfig = {
        name,
        url: sourceUrl,
        feedId,
      };
      this.feeds = await this.appStoreService.upsertFeedConfig(feedConfig);
      await this.refreshNiFeedAvailability();
      this.addFeedUrl = '';
      this.addFeedName = '';
      this.closeAddFeedDialog();
      this.telemetry.track('plugin_manager_feed_add_succeeded', {
        feedId,
        feedName: name,
        feedUrl: sourceUrl,
        replicate: shouldReplicate,
      });
    } catch (e: any) {
      this.telemetry.track('plugin_manager_feed_add_failed', {
        feedName: this.addFeedName.trim(),
        feedUrl: this.addFeedUrl.trim(),
        replicate: this.addFeedShouldReplicate,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Failed to add feed: ${e.message}`;
    } finally {
      this.addingFeed = false;
    }
  }

  openAddFeedDialog(): void {
    this.addFeedUrl = '';
    this.addFeedName = '';
    this.addFeedShouldReplicate = true;
    this.addFeedReplicationDefault = true;
    this.error = '';
    this.telemetry.track('plugin_manager_feed_add_dialog_opened');
    (this.addFeedDialogEl?.nativeElement as any)?.show();
  }

  closeAddFeedDialog(): void {
    (this.addFeedDialogEl?.nativeElement as any)?.close();
  }

  onAddFeedUrlChange(): void {
    const nextDefault = !this.isSystemLinkHostedFeedUrl(this.addFeedUrl);
    if (this.addFeedShouldReplicate === this.addFeedReplicationDefault) {
      this.addFeedShouldReplicate = nextDefault;
    }
    this.addFeedReplicationDefault = nextDefault;
  }

  get addFeedSubmitLabel(): string {
    return this.addFeedShouldReplicate ? 'Replicate & Add Feed' : 'Register Feed';
  }

  get addFeedReplicationHint(): string {
    return this.isSystemLinkHostedFeedUrl(this.addFeedUrl)
      ? 'SystemLink-hosted feeds usually do not need replication. They can be registered directly.'
      : 'Replication creates a local SystemLink feed from the source URL before registering it.';
  }

  openRemoveFeedDialog(feed: FeedConfig): void {
    this.feedPendingRemoval = feed;
    this.deleteReplicatedFeedOnRemove = true;
    this.telemetry.track('plugin_manager_feed_remove_dialog_opened', {
      feedId: feed.feedId,
      feedName: feed.name,
      feedUrl: feed.url,
    });
    (this.removeFeedDialogEl?.nativeElement as any)?.show();
  }

  closeRemoveFeedDialog(force = false): void {
    if (this.removingFeed && !force) return;
    (this.removeFeedDialogEl?.nativeElement as any)?.close();
    this.feedPendingRemoval = null;
    this.deleteReplicatedFeedOnRemove = true;
  }

  async removeFeed(): Promise<void> {
    if (!this.feedPendingRemoval || this.removingFeed) return;

    this.error = '';
    this.removingFeed = true;
    const feedToRemove = this.feedPendingRemoval;
    this.telemetry.track('plugin_manager_feed_remove_started', {
      feedId: feedToRemove.feedId,
      feedName: feedToRemove.name,
      feedUrl: feedToRemove.url,
      deleteReplicatedFeed: this.deleteReplicatedFeedOnRemove,
    });

    try {
      if (this.deleteReplicatedFeedOnRemove && feedToRemove.feedId) {
        await this.appStoreService.deleteReplicatedFeedIfExists(feedToRemove.feedId);
      }

      const updated = this.feeds.filter(feed =>
        feed.feedId !== feedToRemove.feedId &&
        this.normalizeFeedUrl(feed.url) !== this.normalizeFeedUrl(feedToRemove.url)
      );
      await this.appStoreService.saveFeedConfigs(updated);
      this.feeds = updated;
      await this.refreshNiFeedAvailability();
      this.closeRemoveFeedDialog(true);
      this.telemetry.track('plugin_manager_feed_remove_succeeded', {
        feedId: feedToRemove.feedId,
        feedName: feedToRemove.name,
        feedUrl: feedToRemove.url,
        deleteReplicatedFeed: this.deleteReplicatedFeedOnRemove,
      });
    } catch (e: any) {
      this.telemetry.track('plugin_manager_feed_remove_failed', {
        feedId: feedToRemove.feedId,
        feedName: feedToRemove.name,
        feedUrl: feedToRemove.url,
        deleteReplicatedFeed: this.deleteReplicatedFeedOnRemove,
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Failed to remove feed: ${e.message}`;
    } finally {
      this.removingFeed = false;
    }
  }

  isRefreshing(feed: FeedConfig): boolean {
    return this.refreshingFeedId === feed.feedId;
  }

  async addNiFeed(): Promise<void> {
    if (this.addingNiFeed) return;

    this.addingNiFeed = true;
    this.error = '';
    this.refreshResult = '';
    this.telemetry.track('plugin_manager_ni_feed_add_started');
    try {
      const { created, feedConfig } = await this.appStoreService.ensureOfficialFeedRegistered();
      this.feeds = await this.appStoreService.upsertFeedConfig(feedConfig);
      await this.refreshNiFeedAvailability();
      this.refreshResult = created
        ? `Added "${feedConfig.name}".`
        : `Registered "${feedConfig.name}" using the existing replicated feed.`;
      this.telemetry.track('plugin_manager_ni_feed_add_succeeded', {
        feedId: feedConfig.feedId,
        feedName: feedConfig.name,
        feedUrl: feedConfig.url,
        created,
      });
    } catch (e: any) {
      this.telemetry.track('plugin_manager_ni_feed_add_failed', {
        errorMessage: e?.message ?? String(e),
      });
      this.error = `Failed to add NI feed: ${e.message}`;
    } finally {
      this.addingNiFeed = false;
    }
  }

  isNiFeed(feed: FeedConfig): boolean {
    return this.normalizeFeedUrl(feed.url) === this.normalizeFeedUrl(DEFAULT_FEED_URL);
  }

  private getConfiguredNiFeed(): FeedConfig | undefined {
    return this.feeds.find(feed => this.isNiFeed(feed));
  }

  private async refreshNiFeedAvailability(): Promise<void> {
    this.availableNiFeed = await this.appStoreService.discoverFeed().catch(() => null);
  }

  private isSystemLinkHostedFeedUrl(url: string): boolean {
    const value = url.trim();
    if (!value) return false;

    try {
      const parsed = new URL(value, window.location.origin);
      const current = new URL(window.location.origin);
      return this.getSystemLinkHostKey(parsed.hostname) === this.getSystemLinkHostKey(current.hostname);
    } catch {
      return false;
    }
  }

  private getSystemLinkHostKey(hostname: string): string {
    const parts = hostname.toLowerCase().split('.');
    if (parts.length === 0) return hostname.toLowerCase();

    parts[0] = parts[0].replace(/-api$/, '');
    return parts.join('.');
  }

  private normalizeFeedUrl(url: string): string {
    return url
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/(packages(?:\.gz)?)$/i, '')
      .toLowerCase();
  }
}

