import { execSync } from 'child_process';

let cachedRegistry: string | null = null;

export function getRegistry(cliRegistry?: string): string {
  if (cliRegistry) return cliRegistry;
  if (process.env.NPM_REGISTRY) return process.env.NPM_REGISTRY;
  if (cachedRegistry) return cachedRegistry;
  try {
    const registry = execSync('npm config get registry', { encoding: 'utf-8' }).trim();
    if (registry && /^https?:\/\//.test(registry)) {
      cachedRegistry = registry.replace(/\/$/, '');
      return cachedRegistry;
    }
  } catch {}
  return 'https://registry.npmmirror.com';
}