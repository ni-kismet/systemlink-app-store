---
name: systemlink-webapp
description: >
  Build, configure, and deploy custom web applications hosted inside NI SystemLink. Use this skill
  whenever a user wants to create a frontend app that runs inside SystemLink (as a webapp), uses the
  Nimble Angular design system (@ni/nimble-angular), calls any SystemLink REST API (tags, test
  results, assets, systems, work items, etc.), or deploys a built web app to SystemLink with slcli.
  Also use it when the user asks about using the nisystemlink-clients-ts TypeScript SDK, generating a
  TypeScript API client from a SystemLink OpenAPI spec, troubleshooting CORS or CSP errors on a
  SystemLink-hosted app, or configuring Angular routing for SystemLink's sub-path hosting.
compatibility:
  models: [claude-sonnet-4-5, claude-opus-4, claude-3-7-sonnet]
  tools: [run_in_terminal, create_file, replace_string_in_file, read_file]
---

# Building Custom WebApps for SystemLink

SystemLink webapps are Angular Single-Page Applications built with the Nimble design system,
connected to SystemLink REST APIs, and deployed via `slcli webapp publish`. This skill captures
every gotcha learned from building and deploying real apps.

---

## Step 1: Understand what the user needs

Ask before generating any code:

1. **Goal** — What should the app show or let the user do? (e.g., "browse live tag values", "review test results", "approve work orders")
2. **Services** — Which SystemLink services will it call? (tags, test monitor, asset management, systems, work items, feeds, notebooks…)
3. **Starting point** — Fresh Angular project, or do they have existing code?
4. **Auth context** — Will the app run on the same SystemLink instance it calls (same-origin cookie auth), or does it need an API key for a remote server?

You do NOT need to ask about Angular version or Nimble versions — always use the latest (Angular 19, @ni/nimble-angular latest).

---

## Step 2: Scaffold the Angular project

```bash
npx -y @angular/cli@latest new <app-name> --routing --style=scss --skip-git --no-standalone
cd <app-name>
npm install @ni/nimble-angular @ni/nimble-components
```

> Use `--no-standalone` to generate an NgModule-based app. SystemLink webapps work best with NgModule because it makes it easy to register all Nimble modules in one place.

---

## Step 3: Add the SystemLink TypeScript SDK

**Always use [nisystemlink-clients-ts](https://github.com/ni-kismet/nisystemlink-clients-ts) as the first choice** for any SystemLink API call. It ships pre-built, typed SDKs for every major SystemLink service (tags, test monitor, file ingestion, asset management, work items, etc.) so you don't need to generate anything.

### Install

If the package is available locally (the repo has already been cloned):

```bash
npm install --legacy-peer-deps /path/to/nisystemlink-clients-ts
```

Or if published to a registry:

```bash
npm install nisystemlink-clients-ts
```

> **Note:** The package has `"type": "module"` and ships ESM + CJS builds with `.d.ts` declarations. If installing from a local clone, run `npm run build` inside the package repo first to generate the `dist/` folder.

### Available services (import paths)

| Service | Import path |
|---------|-------------|
| File Ingestion | `nisystemlink-clients-ts/file-ingestion` |
| Tags | `nisystemlink-clients-ts/tags` |
| Test Monitor | `nisystemlink-clients-ts/test-monitor` |
| Asset Management | `nisystemlink-clients-ts/asset-management` |
| Work Items | `nisystemlink-clients-ts/work-item` |
| Systems Management | `nisystemlink-clients-ts/systems-management` |
| Notebooks | `nisystemlink-clients-ts/notebook` |

The client factory for each service lives at `nisystemlink-clients-ts/<service>/client`.

### Fallback: generate a custom SDK

Only generate a new SDK if the required service is **not** in `nisystemlink-clients-ts`. Use [hey-api/openapi-ts](https://github.com/hey-api/openapi-ts):

```bash
npm install -D @hey-api/openapi-ts
```

```typescript
// openapi-ts.config.ts
import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: 'https://<server>/swagger/v2/<service>.yaml',
  output: { path: 'src/app/api', format: 'prettier' },
  plugins: ['@hey-api/typescript', { name: '@hey-api/sdk' }],
});
```

```bash
npx openapi-ts
```

---

## Step 4: Wire up AppModule

```typescript
// src/app/app.module.ts
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { APP_BASE_HREF } from '@angular/common';

// Nimble modules — import component modules from @ni/nimble-angular
import {
  NimbleThemeProviderModule,
  NimbleTableModule,
  NimbleTableColumnTextModule,
  NimbleButtonModule,
  NimbleTextFieldModule,
  NimbleSelectModule,
  NimbleListOptionModule,
  NimbleDrawerModule,
  NimbleSpinnerModule,
  NimbleBannerModule,
} from '@ni/nimble-angular';
// Label providers are imported from dedicated subpaths
import { NimbleLabelProviderCoreModule } from '@ni/nimble-angular/label-provider/core';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { MyFeatureComponent } from './my-feature/my-feature.component';

@NgModule({
  declarations: [AppComponent, MyFeatureComponent],
  imports: [
    BrowserModule,
    FormsModule,
    AppRoutingModule,
    NimbleThemeProviderModule,
    NimbleLabelProviderCoreModule,
    NimbleTableModule,
    NimbleTableColumnTextModule,
    NimbleButtonModule,
    NimbleTextFieldModule,
    NimbleSelectModule,
    NimbleListOptionModule,
    NimbleDrawerModule,
    NimbleSpinnerModule,
    NimbleBannerModule,
  ],
  providers: [
    { provide: APP_BASE_HREF, useValue: '/' },   // ← REQUIRED — do not use a <base> tag
  ],
  // Note: do NOT add provideHttpClient() — nisystemlink-clients-ts uses the native fetch API,
  // not Angular's HttpClient. No HTTP DI wiring is needed.
  bootstrap: [AppComponent],
})
export class AppModule {}
```

For Nimble form controls (`nimble-text-field`, `nimble-select`, etc.), bind with Angular forms APIs (`[(ngModel)]`, `[formControl]`, or `formControlName`) and use `(ngModelChange)` for value-change reactions. Avoid native control bindings like `[value]`, `(input)`, or `(change)` on Nimble elements.

**Critical:** Provide `APP_BASE_HREF` via DI and **remove the `<base href="/">` tag from `index.html`**. SystemLink enforces a `base-uri 'self'` CSP directive; the `<base>` element violates it.

---

## Step 5: Configure routing for SystemLink sub-path hosting

```typescript
// src/app/app-routing.module.ts
import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MyFeatureComponent } from './my-feature/my-feature.component';

const routes: Routes = [{ path: '', component: MyFeatureComponent }];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: true })],  // ← REQUIRED
  exports: [RouterModule],
})
export class AppRoutingModule {}
```

**Why `useHash: true`?** SystemLink serves your app at a sub-path like `/ni/webapps/<id>/`. Angular's default `PathLocationStrategy` tries to match the path against the route table and fails with NG04002. Hash routing (`/#/`) sidesteps this entirely.

---

## Step 6: Fix the CSP inline-script issue

In `angular.json`, disable critical CSS inlining (the Beasties optimizer injects `onload` handlers that violate CSP `script-src 'unsafe-inline'`):

```json
"configurations": {
  "production": {
    "optimization": {
      "scripts": true,
      "styles": {
        "minify": true,
        "inlineCritical": false
      },
      "fonts": true
    }
  }
}
```

---

## Step 7: Configure fonts and styling with Nimble tokens

Nimble fonts (Source Sans Pro, Noto Serif) must be explicitly imported in your global styles. Split your styling tokens into two groups:

1. Theme-independent aliases such as fonts and spacing belong in `src/styles.scss` on `:root`
2. Theme-aware aliases such as colors and shadows must be defined on `nimble-theme-provider`, because Nimble resolves its theme tokens there rather than on `:root`

### Import Nimble fonts (required)

```scss
/* src/styles.scss */

/* Import Nimble fonts (Source Sans Pro, Noto Serif) */
@use '@ni/nimble-angular/styles/fonts' as *;

/* Theme-independent aliases only. */
:root {
  /* Typography - map to Nimble's named font tokens */
  --sl-app-font-body: var(--ni-nimble-body-font);
  --sl-app-font-body-emphasized: var(--ni-nimble-body-emphasized-font);
  --sl-app-font-title: var(--ni-nimble-title-font);
  --sl-app-font-title-plus-1: var(--ni-nimble-title-plus-1-font);
  --sl-app-font-control-label: var(--ni-nimble-control-label-font);
  --sl-app-font-group-header: var(--ni-nimble-group-header-font);

  --sl-app-space-1: var(--ni-nimble-small-padding, 4px);
  --sl-app-space-2: var(--ni-nimble-medium-padding, 8px);
  --sl-app-space-3: calc(var(--ni-nimble-small-padding, 4px) * 3);
  --sl-app-space-4: var(--ni-nimble-standard-padding, 16px);
  --sl-app-space-6: var(--ni-nimble-large-padding, 24px);
}

/* Apply body defaults */
html,
body {
  margin: 0;
  min-height: 100%;
  font: var(--sl-app-font-body);
}

h1 { font: var(--sl-app-font-title-plus-1); }
h2 { font: var(--sl-app-font-title); }
h3, h4, h5, h6 { font: var(--sl-app-font-body-emphasized); }
```

Define theme-aware aliases on the root `nimble-theme-provider` instead of `:root`:

```scss
/* src/app/app.component.scss */

:host {
  display: block;
  height: 100vh;
}

nimble-theme-provider {
  display: block;
  height: 100%;
  background: var(--ni-nimble-application-background-color);
  color: var(--ni-nimble-body-font-color);

  --sl-app-color-bg: var(--ni-nimble-application-background-color);
  --sl-app-color-surface: var(--ni-nimble-section-background-color);
  --sl-app-color-surface-alt: var(--ni-nimble-header-background-color);
  --sl-app-color-border: var(--ni-nimble-border-color);
  --sl-app-color-border-strong: var(--ni-nimble-popup-border-color);
  --sl-app-color-text: var(--ni-nimble-body-font-color);
  --sl-app-color-text-muted: var(--ni-nimble-placeholder-font-color);
  --sl-app-color-accent: var(--ni-nimble-button-fill-primary-color);
  --sl-app-color-accent-contrast: var(--ni-nimble-button-primary-font-color);
  --sl-app-color-success: var(--ni-nimble-pass-color);
  --sl-app-shadow-1: var(--ni-nimble-elevation-1-box-shadow);
  --sl-app-shadow-2: var(--ni-nimble-elevation-2-box-shadow);
}
```

Do not add literal color fallbacks to theme-aware aliases. If you write `var(--ni-nimble-application-background-color, #fff)` into your app token layer, you make it too easy to miss a broken theme hookup and accidentally freeze the palette to a light-only fallback.

### Use semantic tokens in component SCSS

Instead of hard-coded colors/sizes, reference the semantic `--sl-app-*` variables:

```scss
// src/app/my-feature/my-feature.component.scss

.card {
  padding: var(--sl-app-space-4);
  border: 1px solid var(--sl-app-color-border);
  background: var(--sl-app-color-surface);
  border-radius: var(--sl-app-space-1);
  transition: box-shadow var(--ni-nimble-medium-delay, 0.15s) ease;

  &:hover {
    box-shadow: var(--sl-app-shadow-2);
  }
}

.card-title {
  font: var(--sl-app-font-body-emphasized);
  color: var(--sl-app-color-text);
}

.card-meta {
  font: var(--sl-app-font-control-label);
  color: var(--sl-app-color-text-muted);
}
```

If you want compile-time token values in SCSS, you can also import Nimble's token variables:

```scss
@use '@ni/nimble-angular/styles/tokens' as *;

.my-element {
  color: $ni-nimble-body-font-color;
}
```

### Why this pattern?

1. **Themability** — All colors flow through Nimble's theme-aware tokens. If Nimble changes color ramps or adds dark mode, your app automatically inherits it.
2. **Consistency** — Using Nimble's canonical fonts (Source Sans Pro for UI, Noto Serif for headings) ensures your app feels native to SystemLink.
3. **Typography scales** — Nimble defines font sizes, weights, and line heights per role (body, titles, labels, headings). Reuse them rather than inventing your own.
4. **Correct token resolution** — Color and shadow aliases must live on `nimble-theme-provider`; defining them on `:root` can leave a hosted app stuck on the wrong palette even when the provider's `theme` attribute changes.
5. **Responsive spacing** — Nimble's padding tokens scale predictably; build layouts that adapt to different screen sizes by composing space variables.

### Available Nimble tokens

See [Nimble's theme-aware tokens documentation](https://nimble.ni.dev/storybook/index.html?path=/docs/tokens-theme-aware-tokens--docs) for a complete token reference (colors, dimensions, shadows, delays, etc.).

---

## Step 8: Call SystemLink APIs

### Configure the client at runtime

Every `nisystemlink-clients-ts` service exposes `createClient` and `createConfig` from its `/client` subpath. Always create a configured client at call-site (or lazily inside a helper) using values from `window.location.origin` and optionally `localStorage` — never rely on the package's default `baseUrl`.

```typescript
import { createClient, createConfig } from 'nisystemlink-clients-ts/file-ingestion/client';
import { queryFilesLinq } from 'nisystemlink-clients-ts/file-ingestion';

function buildClient() {
  const baseUrl = localStorage.getItem('sl_api_url') ?? `${window.location.origin}/nifile`;
  const apiKey  = localStorage.getItem('sl_api_key');
  return createClient(createConfig({
    baseUrl,
    headers:     apiKey ? { 'x-ni-api-key': apiKey } : {},
    credentials: apiKey ? 'omit' : 'include',   // cookie auth when no API key
  }));
}

// Use in a component method:
const { data, error } = await queryFilesLinq({ client: buildClient(), body: { take: 100 } });
```

For **ad-hoc POST calls** to endpoints not yet covered by an SDK function, use the client directly:

```typescript
const { data, error } = await buildClient().post<MyResponse, unknown>({
  url: '/v1/service-groups/Default/search-files',
  body: { filter: 'name:("*report*")', take: 100 },
  headers: { 'Content-Type': 'application/json' },
});
```

### Base URL reference

Always compute the base URL from `window.location.origin` — never hardcode a hostname:

```typescript
const BASE_URL = `${window.location.origin}/nitag`;    // Tags
const BASE_URL = `${window.location.origin}/nitest`;   // Test Monitor
const BASE_URL = `${window.location.origin}/niapm`;    // Asset Management
const BASE_URL = `${window.location.origin}/nifile`;   // File Ingestion
```

### Authentication

- **Same-origin** (app and API on the same server): use `credentials: 'include'` — session cookies are sent automatically, no API key needed.
- **Remote / dev**: read an API key from `localStorage` and pass it as `x-ni-api-key` header. Set `credentials: 'omit'` when using an API key.
- Never hardcode credentials in source code.

### Querying

- Build queries as typed objects matching the SDK models — don't construct raw URL strings
- For LINQ filter strings (tags, files), keep filters simple: `path = "..."`, `type = "..."`, `name:("*pattern*")`
- Avoid `projection` parameters unless you fully understand how they reshape the response — they often flatten nested objects and break your mapping logic

---

## Step 9: App template pattern

```typescript
// src/app/app.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <nimble-theme-provider [theme]="currentTheme">
      <nimble-label-provider-core withDefaults></nimble-label-provider-core>
      <router-outlet></router-outlet>
    </nimble-theme-provider>
  `,
})
export class AppComponent implements OnInit, OnDestroy {
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
    try {
      const params = new URLSearchParams(window.location.search);
      const queryTheme = params.get('theme');
      if (queryTheme === 'light' || queryTheme === 'dark') return queryTheme;
    } catch {}

    try {
      if (window.parent !== window) {
        const parentProvider = window.parent.document.querySelector('nimble-theme-provider');
        const parentTheme = parentProvider?.getAttribute('theme');
        if (parentTheme === 'light' || parentTheme === 'dark') return parentTheme;
      }
    } catch {}

    try {
      const savedTheme = localStorage.getItem('sl_app_theme');
      if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    } catch {}

    try {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch {}

    return 'light';
  }

  private watchParentTheme(): void {
    try {
      if (window.parent === window) return;
      const parentProvider = window.parent.document.querySelector('nimble-theme-provider');
      if (!parentProvider) return;

      this.themeObserver = new MutationObserver(() => {
        const parentTheme = parentProvider.getAttribute('theme');
        if (parentTheme === 'light' || parentTheme === 'dark') {
          this.currentTheme = parentTheme;
        }
      });

      this.themeObserver.observe(parentProvider, {
        attributes: true,
        attributeFilter: ['theme'],
      });
    } catch {}
  }
}
```

If the app is hosted by SystemLink inside a same-origin iframe, this parent-provider sync keeps the embedded app aligned with the shell when the user switches between light and dark mode.

For breadcrumb navigation in routed Angular apps, use `nimbleRouterLink` on `nimble-breadcrumb-item` (not click handlers):

```html
<nimble-breadcrumb-item nimbleRouterLink="/catalog">Catalog</nimble-breadcrumb-item>
```

---

## Step 10: Build

```bash
node_modules/.bin/ng build --configuration production --output-path dist/<app-name>
```

- Do **not** pass `--base-href` — that would re-introduce the `<base>` element
- Output goes to `dist/<app-name>/browser/` (Angular 19)

If you hit budget errors, increase limits in `angular.json`:

```json
"budgets": [
  { "type": "initial", "maximumWarning": "1MB", "maximumError": "2MB" },
  { "type": "anyComponentStyle", "maximumWarning": "2KB", "maximumError": "4KB" }
]
```

---

## Step 11: Deploy with slcli

```bash
# First deploy — no existing webapp ID
slcli webapp publish dist/<app-name>/browser/ -w <workspace-name>

# Update existing webapp
slcli webapp publish dist/<app-name>/browser/ -w <workspace-name> -i <webapp-id>

# Open in browser
slcli webapp open -i <webapp-id>
```

Save the returned webapp ID — you'll need it for every subsequent redeploy.

---

## Troubleshooting quick-reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| CSP `base-uri` error | `<base href="/">` in index.html | Remove `<base>` tag; provide `APP_BASE_HREF` via DI |
| NG04002 / white screen | PathLocationStrategy can't resolve sub-path | `useHash: true` in RouterModule |
| CSP `unsafe-inline` error | Beasties injects `onload` in style tags | `inlineCritical: false` in angular.json optimization |
| App stays light inside dark SystemLink shell | Theme-aware aliases defined on `:root` or embedded app not watching host provider | Define color/shadow aliases on `nimble-theme-provider`; sync `currentTheme` from parent provider |
| `theme="dark"` is set but colors still look light | Checked the attribute only, not the resolved tokens | Inspect `getComputedStyle(themeProvider).getPropertyValue('--ni-nimble-application-background-color')` in the hosted iframe |
| CORS / status 0 | `basePath` points to different origin | Set `basePath = window.location.origin + '/service-prefix'` |
| 404 on API calls | Missing service prefix in base URL | e.g., `/nitag` not just `window.location.origin` |
| Table rows empty despite correct response | `projection` flattens nested objects | Remove `projection` from query body |
| `TableRecord` type error | Row type missing index signature | Add `[key: string]: FieldValue \| undefined` |
| Button appearance invalid | Wrong value for `appearance` attr | Use `appearance="block" appearance-variant="accent"` |
| `ng build` exits 130 / truncated | Terminal heredoc issue in VS Code | Run build as background process: `nohup ng build ... > /tmp/build.log 2>&1 &` |

### Hosted theme validation recipe

When validating a deployed SystemLink webapp, prefer checking the hosted instance rather than only local dev:

1. Open the webapp inside SystemLink so you can inspect the shell and embedded iframe together
2. Verify both parent and iframe expose a `nimble-theme-provider`
3. Compare resolved token values, not just attributes, for example `--ni-nimble-application-background-color`, `--ni-nimble-header-background-color`, and `--ni-nimble-body-font-color`
4. Scan component SCSS for hard-coded color literals and replace them with Nimble tokens or local semantic aliases

If the host and iframe are same-origin, Playwright or DevTools can inspect `iframe.contentDocument` directly.

---

## Known SystemLink service prefixes

| Service | URL prefix |
|---------|-----------|
| Tag Historian | `/nitag/v2` |
| Test Monitor | `/nitest` |
| Asset Management | `/niapm` |
| Systems Management | `/nisysmgmt` |
| Work Orders | `/niworkorder` |
| Feeds (Package Manager) | `/nifeeds` |
| Files | `/nifile` |
| Notebooks | `/ninotebook` |

See `references/systemlink-services.md` for full API details.

---

## Key imports reference

| Item | Import path |
|------|-------------|
| Component modules (theme provider, buttons, inputs, select, list-option, drawer, spinner, banner, table) | `@ni/nimble-angular` |
| Label provider core module | `@ni/nimble-angular/label-provider/core` |
| Label provider rich text module | `@ni/nimble-angular/label-provider/rich-text` |
| Label provider table module | `@ni/nimble-angular/label-provider/table` |
| Fonts styles entrypoint (`@use`) | `@ni/nimble-angular/styles/fonts` |
| Tokens styles entrypoint (`@use`) | `@ni/nimble-angular/styles/tokens` |
| Card module (if used) | `@ni/nimble-angular/card` |

See `references/nimble-angular.md` for template usage of each component.
