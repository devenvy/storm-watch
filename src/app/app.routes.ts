import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: async () => import('./features/dashboard').then(m => m.Dashboard), title: 'Storm Watch' },
  { path: 'd/:board', loadComponent: async () => import('./features/dashboard').then(m => m.Dashboard), title: 'Storm Watch' },
  { path: 'watch', loadComponent: async () => import('./features/watch').then(m => m.Watch), title: 'Watch · Storm Watch' },
  { path: 'watch/:key', loadComponent: async () => import('./features/watch').then(m => m.Watch), title: 'Watch · Storm Watch' },
  { path: 'setup', loadComponent: async () => import('./features/setup').then(m => m.Setup), title: 'Setup · Storm Watch' },
  { path: '**', redirectTo: '' },
];
