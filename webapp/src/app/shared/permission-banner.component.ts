import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-permission-banner',
  standalone: false,
  template: `
    <nimble-banner *ngIf="!hasPermission" class="page-banner" severity="warning" [open]="true">
      You do not have permission to install or manage web applications.
      Contact your SystemLink administrator to request
      "Create, modify, and delete web applications" permissions.
      {{ readOnlyMessage }}
    </nimble-banner>
  `,
})
export class PermissionBannerComponent {
  @Input() hasPermission = true;
  @Input() readOnlyMessage = 'You can still use Plugin Manager in read-only mode.';
}
