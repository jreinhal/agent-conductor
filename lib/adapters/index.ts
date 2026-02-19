/**
 * Adapter Module — Barrel Export
 *
 * Re-exports all adapter types, the registry, and built-in adapters.
 * Also provides a convenience factory for a pre-populated registry.
 *
 * @module lib/adapters
 */

export * from './types';
export { AdapterRegistry } from './registry';
export { ClaudeCodeAdapter } from './claude-code-adapter';
export { MockAdapter } from './mock-adapter';
export type { MockAdapterConfig, MockResponse } from './mock-adapter';

// ─── Default Registry Factory ────────────────────────────────────────

import { AdapterRegistry } from './registry';
import { ClaudeCodeAdapter } from './claude-code-adapter';

/**
 * Create a default registry pre-loaded with all built-in adapters.
 *
 * The mock adapter is intentionally excluded from the default registry
 * since it requires explicit configuration and is meant for testing only.
 */
export function createDefaultRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new ClaudeCodeAdapter());
  return registry;
}
