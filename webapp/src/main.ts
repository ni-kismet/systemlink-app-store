import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import '@ni/ok-components/dist/esm/fv/card';
import { AppModule } from './app/app-module';

platformBrowserDynamic().bootstrapModule(AppModule)
  .catch(err => console.error(err));
