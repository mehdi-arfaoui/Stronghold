export function isInternalDemoContext(): boolean {
  if (!__DEMO_ENABLED__) {
    return false;
  }

  if (import.meta.env.DEV) {
    return true;
  }

  const viteEnv = String(import.meta.env.VITE_ENV ?? '').toLowerCase();
  return viteEnv === 'development' || viteEnv === 'test' || viteEnv.includes('demo');
}

