import { Injectable } from '@angular/core';
import { AppPackage } from '../models/plugin-manager.models';

type TelemetryValue = string | number | boolean | null;
type TelemetryProperties = Record<string, TelemetryValue>;
type PendingEvent = { eventName: string; properties: TelemetryProperties };

type GainsightApi = ((...args: unknown[]) => void) & {
  init?: (...args: unknown[]) => void;
  validateEngagementSecurity?: (...args: unknown[]) => void;
};

type GainsightWindow = Window & {
  aptrinsic?: GainsightApi;
  __slPluginManagerTelemetry?: TelemetryDebugState;
};

type TelemetryPackage = {
  packageName: string;
  displayName?: string | null;
  version?: string | null;
  type?: string | null;
  sourceFeedId?: string | null;
};

type TelemetryPhase = 'started' | 'succeeded' | 'failed';
type TelemetryAction = 'install' | 'uninstall' | 'upgrade';

type TelemetryStatus = 'initializing' | 'ready' | 'disabled' | 'unavailable';

type TelemetryConfigSummary = {
  loaded: boolean;
  requestSucceeded: boolean;
  enabled: boolean;
  statusCode: number | null;
  configKeys: string[];
};

type TelemetryDebugState = {
  status: TelemetryStatus;
  usingParentAptrinsic: boolean;
  queueLength: number;
  lastError: string | null;
  config: TelemetryConfigSummary;
};

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private readonly pendingEvents: PendingEvent[] = [];
  private readonly debugState: TelemetryDebugState = {
    status: 'initializing',
    usingParentAptrinsic: false,
    queueLength: 0,
    lastError: null,
    config: {
      loaded: false,
      requestSucceeded: false,
      enabled: false,
      statusCode: null,
      configKeys: [],
    },
  };
  private initPromise: Promise<void>;
  private telemetryEnabled = false;

  constructor() {
    this.registerDebugState();
    this.initPromise = this.initialize();
  }

  track(eventName: string, properties: Record<string, unknown> = {}): boolean {
    const normalizedProperties = this.toTelemetryProperties({
      app: 'systemlink-plugin-manager',
      route: this.currentRoute(),
      hostedInIframe: this.isHostedInIframe(),
      ...properties,
    });

    const aptrinsic = this.resolveAptrinsic();
    if (!aptrinsic) {
      if (this.debugState.status === 'disabled' || this.debugState.status === 'unavailable') {
        return false;
      }

      this.pendingEvents.push({ eventName, properties: normalizedProperties });
      this.updateDebugState({ queueLength: this.pendingEvents.length });
      return false;
    }

    try {
      aptrinsic('track', eventName, normalizedProperties);
      return true;
    } catch (error) {
      this.recordError(error);
      return false;
    }
  }

  trackRouteView(url: string): boolean {
    const route = this.normalizeRoute(url);
    return this.track('plugin_manager_screen_view', {
      screen: this.screenNameFromRoute(route),
      route,
    });
  }

  trackPackageDetailView(pkg: TelemetryPackage, properties: Record<string, unknown> = {}): boolean {
    return this.track('plugin_manager_view_details', {
      ...this.packageProperties(pkg),
      ...properties,
    });
  }

  trackPackageAction(
    action: TelemetryAction,
    phase: TelemetryPhase,
    pkg: TelemetryPackage,
    properties: Record<string, unknown> = {},
  ): boolean {
    return this.track(`plugin_manager_${action}_${phase}`, {
      ...this.packageProperties(pkg),
      ...properties,
    });
  }

  packageFromAppPackage(pkg: AppPackage): TelemetryPackage {
    return {
      packageName: pkg.packageName,
      displayName: pkg.displayName,
      version: pkg.version,
      type: pkg.type,
      sourceFeedId: pkg.sourceFeedId ?? null,
    };
  }

  getDebugState(): TelemetryDebugState {
    return {
      ...this.debugState,
      config: { ...this.debugState.config },
    };
  }

  private async initialize(): Promise<void> {
    const config = await this.fetchTelemetryConfig();
    this.telemetryEnabled = config.enabled;
    this.updateDebugState({
      config,
      status: config.enabled ? 'initializing' : 'disabled',
    });

    if (!config.enabled) {
      this.pendingEvents.length = 0;
      this.updateDebugState({ queueLength: 0 });
      return;
    }

    const aptrinsic = await this.waitForAptrinsic();
    if (!aptrinsic) {
      this.pendingEvents.length = 0;
      this.updateDebugState({
        status: 'unavailable',
        queueLength: 0,
      });
      return;
    }

    this.updateDebugState({
      status: 'ready',
      usingParentAptrinsic: this.parentWindowHasAptrinsic(),
    });
    this.flushPendingEvents(aptrinsic);
  }

  private resolveAptrinsic(): GainsightApi | null {
    if (!this.telemetryEnabled && this.debugState.config.loaded) {
      return null;
    }

    const parentAptrinsic = this.windowAptrinsic(this.parentWindow());
    if (parentAptrinsic) {
      return parentAptrinsic;
    }

    return this.windowAptrinsic(window);
  }

  private windowAptrinsic(target: Window | null): GainsightApi | null {
    if (!target) {
      return null;
    }

    const candidate = (target as GainsightWindow).aptrinsic;
    return typeof candidate === 'function' ? candidate : null;
  }

  private parentWindowHasAptrinsic(): boolean {
    return this.windowAptrinsic(this.parentWindow()) !== null;
  }

  private parentWindow(): Window | null {
    try {
      return window.parent !== window ? window.parent : null;
    } catch {
      return null;
    }
  }

  private isHostedInIframe(): boolean {
    return this.parentWindow() !== null;
  }

  private currentRoute(): string {
    return window.location.hash || window.location.pathname || '/';
  }

  private normalizeRoute(url: string): string {
    if (!url) {
      return '/';
    }

    return url.startsWith('#') ? url.slice(1) || '/' : url;
  }

  private screenNameFromRoute(route: string): string {
    if (route.startsWith('/catalog/')) {
      return 'detail';
    }
    if (route.startsWith('/installed')) {
      return 'installed';
    }
    if (route.startsWith('/settings')) {
      return 'settings';
    }
    if (route.startsWith('/onboarding')) {
      return 'onboarding';
    }
    return 'catalog';
  }

  private packageProperties(pkg: TelemetryPackage): TelemetryProperties {
    return {
      packageName: pkg.packageName,
      packageDisplayName: pkg.displayName ?? pkg.packageName,
      packageVersion: pkg.version ?? null,
      packageType: pkg.type ?? null,
      sourceFeedId: pkg.sourceFeedId ?? null,
    };
  }

  private toTelemetryProperties(properties: Record<string, unknown>): TelemetryProperties {
    return Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, this.toTelemetryValue(value)]),
    );
  }

  private toTelemetryValue(value: unknown): TelemetryValue {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return value.slice(0, 500);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return JSON.stringify(value).slice(0, 500);
    }

    return JSON.stringify(value).slice(0, 500);
  }

  private async fetchTelemetryConfig(): Promise<TelemetryConfigSummary> {
    try {
      const response = await fetch('/user-telemetry/config', {
        credentials: 'include',
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      const configKeys = payload && typeof payload === 'object'
        ? Object.keys(payload as Record<string, unknown>).sort()
        : [];

      return {
        loaded: true,
        requestSucceeded: response.ok,
        enabled: response.ok && this.isTelemetryEnabled(payload),
        statusCode: response.status,
        configKeys,
      };
    } catch (error) {
      this.recordError(error);
      return {
        loaded: true,
        requestSucceeded: false,
        enabled: false,
        statusCode: null,
        configKeys: [],
      };
    }
  }

  private isTelemetryEnabled(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const config = payload as Record<string, unknown>;
    if (config['enabled'] === false) {
      return false;
    }

    return Object.entries(config).some(([key, value]) => {
      if (typeof value === 'string' && value.includes('AP-')) {
        return true;
      }
      return /gainsight|aptrinsic|telemetry/i.test(key);
    });
  }

  private async waitForAptrinsic(timeoutMs = 10_000, intervalMs = 250): Promise<GainsightApi | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const aptrinsic = this.windowAptrinsic(this.parentWindow()) ?? this.windowAptrinsic(window);
      if (aptrinsic) {
        return aptrinsic;
      }

      await new Promise(resolve => window.setTimeout(resolve, intervalMs));
    }

    this.recordError('Telemetry configuration loaded, but aptrinsic never became available');
    return null;
  }

  private flushPendingEvents(aptrinsic: GainsightApi): void {
    const queued = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    this.updateDebugState({ queueLength: 0 });

    for (const entry of queued) {
      try {
        aptrinsic('track', entry.eventName, entry.properties);
      } catch (error) {
        this.recordError(error);
      }
    }
  }

  private recordError(error: unknown): void {
    this.updateDebugState({
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  private registerDebugState(): void {
    (window as GainsightWindow).__slPluginManagerTelemetry = this.debugState;
  }

  private updateDebugState(partial: Partial<TelemetryDebugState>): void {
    Object.assign(this.debugState, partial);
    this.registerDebugState();
  }
}