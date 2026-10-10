import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/dashboard').then(m => m.Dashboard), title: 'Storm Watch' },
  { path: 'd/:board', loadComponent: () => import('./features/dashboard').then(m => m.Dashboard), title: 'Storm Watch' },
  { path: 'watch', loadComponent: () => import('./features/watch').then(m => m.Watch), title: 'Watch · Storm Watch' },
  { path: 'watch/:key', loadComponent: () => import('./features/watch').then(m => m.Watch), title: 'Watch · Storm Watch' },
  { path: 'setup', loadComponent: () => import('./features/setup').then(m => m.Setup), title: 'Setup · Storm Watch' },
  { path: '**', redirectTo: '' },
];
