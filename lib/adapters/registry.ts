/**
 * Adapter Registry
 *
 * Central registry for discovering and managing agent adapters.
 * The orchestrator uses this to find which CLI tools are available
 * and to retrieve the correct adapter by name.
 *
 * @module lib/adapters/registry
 */

import type { AgentAdapter } from './types';

/**
 * Registry for discovering and managing agent adapters.
 *
 * Usage:
 * ```ts
 * const registry = new AdapterRegistry();
 * registry.register(new ClaudeCodeAdapter());
 * registry.register(new MockAdapter());
 *
 * const claude = registry.get('claude-code');
 * const available = await registry.discoverAvailable();
 * ```
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, AgentAdapter>();

  /**
   * Register an adapter.
   * If an adapter with the same name already exists it is replaced.
   *
   * @throws {Error} if the adapter name is empty.
   */
  register(adapter: AgentAdapter): void {
    if (!adapter.name || adapter.name.trim().length === 0) {
      throw new Error('Adapter name must not be empty');
    }
    this.adapters.set(adapter.name, adapter);
  }

  /**
   * Retrieve an adapter by its unique name.
   * Returns `undefined` when no adapter with that name is registered.
   */
  get(name: string): AgentAdapter | undefined {
    return this.adapters.get(name);
  }

  /**
   * List all registered adapters (in insertion order).
   */
  list(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Probe every registered adapter and return only those whose
   * underlying CLI tool is installed and reachable.
   *
   * Each adapter's `isAvailable()` is called concurrently.
   * Adapters that throw during the check are treated as unavailable.
   */
  async discoverAvailable(): Promise<AgentAdapter[]> {
    const entries = this.list();
    const results = await Promise.allSettled(
      entries.map(async (adapter) => {
        const available = await adapter.isAvailable();
        return { adapter, available };
      }),
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<{ adapter: AgentAdapter; available: boolean }> =>
          r.status === 'fulfilled' && r.value.available,
      )
      .map((r) => r.value.adapter);
  }
}
