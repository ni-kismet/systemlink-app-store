import { Injectable } from '@angular/core';
import { AppPackage } from '../models/plugin-manager.models';

type TelemetryValue = string | number | boolean | null;
type TelemetryProperties = Record<string, TelemetryValue>;

type GainsightApi = ((...args: unknown[]) => void) & {
  init?: (...args: unknown[]) => void;
  validateEngagementSecurity?: (...args: unknown[]) => void;
};

type GainsightWindow = Window & {
  aptrinsic?: GainsightApi;
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

@Injectable({ providedIn: 'root' })
export class TelemetryService {
  track(eventName: string, properties: Record<string, unknown> = {}): boolean {
    const aptrinsic = this.resolveAptrinsic();
    if (!aptrinsic) {
      return false;
    }

    try {
      aptrinsic('track', eventName, this.toTelemetryProperties({
        app: 'systemlink-plugin-manager',
        route: this.currentRoute(),
        hostedInIframe: this.isHostedInIframe(),
        ...properties,
      }));
      return true;
    } catch {
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

  private resolveAptrinsic(): GainsightApi | null {
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
}