import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { PLUGIN_MANAGER_VERSION, FeedConfig, DEFAULT_FEED_URL, NI_FEED_CONFIG_NAME } from '../models/plugin-manager.models';
import { PluginManagerService } from '../services/plugin-manager.service';

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
  ) {}

  async ngOnInit(): Promise<void> {
    try {
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

  get canAddNiFeed(): boolean {
    const configuredNiFeed = this.getConfiguredNiFeed();
    if (!configuredNiFeed) return true;
    if (!this.availableNiFeed) return true;
    return configuredNiFeed.feedId !== this.availableNiFeed.id;
  }

  get niFeedActionLabel(): string {
    return this.getConfiguredNiFeed() && !this.availableNiFeed ? 'Re-add NI Feed' : 'Add NI Feed';
  }

  async refreshFeed(feed: FeedConfig): Promise<void> {
    if (this.refreshingFeedId) return;
    this.refreshingFeedId = feed.feedId;
    this.refreshResult = '';
    this.error = '';
    try {
      const resourceIds = await this.appStoreService.checkForUpdates(feed.feedId);
      await this.appStoreService.applyUpdates(feed.feedId, resourceIds);
      this.refreshResult = resourceIds.length > 0
        ? `Feed "${feed.name}" refreshed successfully.`
        : `Feed "${feed.name}" is already up to date.`;
    } catch (e: any) {
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
    } catch (e: any) {
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
    } catch (e: any) {
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
    try {
      const { created, feedConfig } = await this.appStoreService.ensureOfficialFeedRegistered();
      this.feeds = await this.appStoreService.upsertFeedConfig(feedConfig);
      await this.refreshNiFeedAvailability();
      this.refreshResult = created
        ? `Added "${feedConfig.name}".`
        : `Registered "${feedConfig.name}" using the existing replicated feed.`;
    } catch (e: any) {
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
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  private normalizeFeedUrl(url: string): string {
    return url.trim().replace(/\/+$/, '').toLowerCase();
  }
}

