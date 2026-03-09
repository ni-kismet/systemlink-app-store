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

// Nimble modules — import exactly from these subpaths
import { NimbleThemeProviderModule } from '@ni/nimble-angular';
import { NimbleTableModule } from '@ni/nimble-angular/table';
import { NimbleTableColumnTextModule } from '@ni/nimble-angular/table-column/text';
import { NimbleButtonModule } from '@ni/nimble-angular/button';
import { NimbleTextFieldModule } from '@ni/nimble-angular/text-field';
import { NimbleSelectModule } from '@ni/nimble-angular/select';
import { NimbleListOptionModule } from '@ni/nimble-angular/list-option';
import { NimbleDrawerModule } from '@ni/nimble-angular/drawer';
import { NimbleSpinnerModule } from '@ni/nimble-angular/spinner';
import { NimbleBannerModule } from '@ni/nimble-angular/banner';

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

## Step 7: Call SystemLink APIs

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

## Step 8: App template pattern

```typescript
// src/app/app.component.ts
import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  template: `
    <nimble-theme-provider theme="light">
      <router-outlet></router-outlet>
    </nimble-theme-provider>
  `,
})
export class AppComponent {}
```

---

## Step 9: Build

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

## Step 10: Deploy with slcli

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
| CORS / status 0 | `basePath` points to different origin | Set `basePath = window.location.origin + '/service-prefix'` |
| 404 on API calls | Missing service prefix in base URL | e.g., `/nitag` not just `window.location.origin` |
| Table rows empty despite correct response | `projection` flattens nested objects | Remove `projection` from query body |
| `TableRecord` type error | Row type missing index signature | Add `[key: string]: FieldValue \| undefined` |
| Button appearance invalid | Wrong value for `appearance` attr | Use `appearance="block" appearance-variant="accent"` |
| `ng build` exits 130 / truncated | Terminal heredoc issue in VS Code | Run build as background process: `nohup ng build ... > /tmp/build.log 2>&1 &` |

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

| Component | Import path |
|-----------|-------------|
| `NimbleThemeProviderModule` | `@ni/nimble-angular` |
| `NimbleTableModule` | `@ni/nimble-angular/table` |
| `NimbleTableColumnTextModule` | `@ni/nimble-angular/table-column/text` |
| `NimbleTableColumnNumberTextModule` | `@ni/nimble-angular/table-column/number-text` |
| `NimbleTableColumnDateTextModule` | `@ni/nimble-angular/table-column/date-text` |
| `NimbleButtonModule` | `@ni/nimble-angular/button` |
| `NimbleTextFieldModule` | `@ni/nimble-angular/text-field` |
| `NimbleSelectModule` + `NimbleListOptionModule` | `@ni/nimble-angular/select`, `@ni/nimble-angular/list-option` |
| `NimbleDrawerModule` | `@ni/nimble-angular/drawer` |
| `NimbleSpinnerModule` | `@ni/nimble-angular/spinner` |
| `NimbleBannerModule` | `@ni/nimble-angular/banner` |
| `NimbleCardButtonModule` | `@ni/nimble-angular/card-button` |

See `references/nimble-angular.md` for template usage of each component.
