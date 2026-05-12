/**
 * YAML configuration file writer.
 *
 * Serializes a Config object to YAML and writes it atomically to disk.
 * Comment loss on write-back is ACCEPTED — the dashboard IS the config editor.
 */

import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import type { Config } from './schema.js';

/**
 * Serialize config to YAML and write to the given path.
 *
 * The `_configPath` runtime-only field is stripped before serialization.
 *
 * @param path  Absolute or relative filesystem path for the output YAML file
 * @param config  Config object (typically `configManager.config`)
 */
export async function writeConfig(path: string, config: Config): Promise<void> {
  // Destructure to strip _configPath — it is a runtime artifact, not user config
  const { _configPath: _ignored, ...serializable } = config;

  const yaml = stringify(serializable, {
    indent: 2,
    lineWidth: 120,
    defaultStringType: 'PLAIN',
  });

  await writeFile(path, yaml, 'utf-8');
}
