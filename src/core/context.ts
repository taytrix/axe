import { type Config, loadConfig } from './config.ts';
import type { Layout } from './layout.ts';
import { probe } from './probe.ts';

export type Context = {
  config: Config;
  layout: Layout;
};

/**
 * Load `axe.toml` and probe its `[server].root`, returning both as a typed
 * Context. Used by every command that operates on an existing install.
 *
 * Not a class. Not a god object. Two operations called together because
 * they're always called together. Throws `AxeError({kind:'config'})` on
 * config failure, `AxeError({kind:'discovery'})` on probe failure.
 */
export async function loadContext(configPath: string): Promise<Context> {
  const config = await loadConfig(configPath);
  const layout = await probe(config.server.root);
  return { config, layout };
}
