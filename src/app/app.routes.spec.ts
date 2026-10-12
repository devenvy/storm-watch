import { routes } from './app.routes';
import { Dashboard } from './features/dashboard';
import { Setup } from './features/setup';
import { Watch } from './features/watch';

describe('routes', () => {
  it('lazy-loads each page component', async () => {
    const byPath = new Map(routes.map((r) => [r.path, r]));
    const load = async (path: string) => byPath.get(path)?.loadComponent?.();
    await expect(load('')).resolves.toBe(Dashboard);
    await expect(load('d/:board')).resolves.toBe(Dashboard);
    await expect(load('watch')).resolves.toBe(Watch);
    await expect(load('watch/:key')).resolves.toBe(Watch);
    await expect(load('setup')).resolves.toBe(Setup);
    expect(byPath.get('**')?.redirectTo).toBe('');
  });
});
