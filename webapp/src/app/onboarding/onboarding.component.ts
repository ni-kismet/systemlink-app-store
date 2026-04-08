import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { DEFAULT_FEED_URL, FEED_NAME, NI_FEED_CONFIG_NAME } from '../models/plugin-manager.models';
import { PluginManagerService } from '../services/plugin-manager.service';

@Component({
  selector: 'app-onboarding',
  standalone: false,
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent implements OnInit {
  step = 1;
  feedUrl = DEFAULT_FEED_URL;
  feedId = '';
  error = '';
  loading = false;

  // Feed-already-exists conflict state
  existingFeedId = '';
  existingFeedName = '';
  showFeedConflict = false;

  constructor(
    private appStoreService: PluginManagerService,
    private router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.checkForExistingFeed(this.feedUrl);
  }

  onFeedUrlChange(): void {
    this.error = '';
    this.showFeedConflict = false;
    this.existingFeedId = '';
    this.existingFeedName = '';
  }

  async replicateFeed(): Promise<void> {
    if (this.loading || !this.feedUrl.trim()) return;
    this.loading = true;
    this.error = '';
    this.showFeedConflict = false;
    try {
      const sourceUrl = this.feedUrl.trim();
      const existingFeed = await this.appStoreService.findFeedBySourceUrl(sourceUrl).catch(() => null);
      if (existingFeed) {
        this.existingFeedId = existingFeed.id;
        this.existingFeedName = existingFeed.name;
        this.showFeedConflict = true;
        return;
      }

      const result = await this.appStoreService.replicateFeed(sourceUrl, this.getPreferredFeedName(sourceUrl));
      this.feedId = result.id ?? result.feedId ?? '';
      await this.saveMainFeedAndAdvance();
    } catch (e: any) {
      const msg = typeof e.message === 'string' ? e.message : '';
      // Detect "feed already exists" style errors and offer to use the existing feed.
      if (msg.toLowerCase().includes('already') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('conflict')) {
        const existing = await this.appStoreService.findFeedBySourceUrl(this.feedUrl.trim()).catch(() => null);
        if (existing) {
          this.existingFeedId = existing.id;
          this.existingFeedName = existing.name;
          this.showFeedConflict = true;
        } else {
          this.error = `Feed replication failed: ${msg}`;
        }
      } else {
        this.error = `Feed replication failed: ${msg}`;
      }
    } finally {
      this.loading = false;
    }
  }

  /** User chose to use the existing feed that was already replicated. */
  async useExistingFeed(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.showFeedConflict = false;
    try {
      this.feedId = this.existingFeedId;
      await this.saveMainFeedAndAdvance();
    } catch (e: any) {
      this.error = `Failed to save feed configuration: ${e.message}`;
    } finally {
      this.loading = false;
    }
  }

  /** User chose to replace the existing feed with a fresh replication. */
  async replaceExistingFeed(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.showFeedConflict = false;
    try {
      await this.appStoreService.deleteReplicatedFeedIfExists(this.existingFeedId);
      const sourceUrl = this.feedUrl.trim();
      const result = await this.appStoreService.replicateFeed(sourceUrl, this.getPreferredFeedName(sourceUrl));
      this.feedId = result.id ?? result.feedId ?? '';
      await this.saveMainFeedAndAdvance();
    } catch (e: any) {
      this.error = `Failed to replace feed: ${e.message}`;
    } finally {
      this.loading = false;
    }
  }

  private async saveMainFeedAndAdvance(): Promise<void> {
    const sourceUrl = this.feedUrl.trim();
    const mainFeedConfig = {
      name: this.getPreferredFeedName(sourceUrl),
      url: sourceUrl,
      feedId: this.feedId,
    };
    await this.appStoreService.upsertFeedConfig(mainFeedConfig);
    // Tag the Plugin Manager's own webapp so it appears as installed in the catalog.
    await this.appStoreService.tagOwnWebapp(this.feedId, sourceUrl);
    this.step = 2;
  }

  goToCatalog(): void {
    this.router.navigate(['/catalog']);
  }

  private async checkForExistingFeed(feedUrl: string): Promise<void> {
    try {
      const existingFeed = await this.appStoreService.findFeedBySourceUrl(feedUrl);
      this.existingFeedId = existingFeed?.id ?? '';
      this.existingFeedName = existingFeed?.name ?? '';
      this.showFeedConflict = !!existingFeed;
    } catch {
      this.showFeedConflict = false;
      this.existingFeedId = '';
      this.existingFeedName = '';
    }
  }

  private getPreferredFeedName(feedUrl: string): string {
    return this.isOfficialFeedUrl(feedUrl) ? NI_FEED_CONFIG_NAME : FEED_NAME;
  }

  private isOfficialFeedUrl(feedUrl: string): boolean {
    return this.normalizeFeedUrl(feedUrl) === this.normalizeFeedUrl(DEFAULT_FEED_URL);
  }

  private normalizeFeedUrl(feedUrl: string): string {
    return feedUrl
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/(packages(?:\.gz)?)$/i, '')
      .toLowerCase();
  }
}

