import { stat } from 'node:fs/promises';
import { AxeError } from './errors.ts';
import { type Layout, layoutAt } from './layout.ts';

/**
 * Walk `root` and return a `Layout` for whichever platform it appears to be.
 * Throws `AxeError({kind:'discovery'})` if `root` is not a directory or
 * neither a Linux nor a Windows server binary is present under it.
 */
export async function probe(root: string): Promise<Layout> {
  if (!(await isDirectory(root))) {
    throw new AxeError('discovery', `${root} is not a directory`);
  }

  const linux = layoutAt(root, 'linux');
  const windows = layoutAt(root, 'windows');

  if (await isFile(linux.binary)) return linux;
  if (await isFile(windows.binary)) return windows;

  throw new AxeError(
    'discovery',
    `no Conan Exiles server binary under ${root}; expected ${linux.binary} or ${windows.binary}`,
  );
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
