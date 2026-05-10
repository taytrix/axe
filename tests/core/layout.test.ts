import { describe, expect, test } from 'bun:test';
import { layoutAt } from '../../src/core/layout.ts';

describe('layoutAt', () => {
  test('linux paths resolve correctly', () => {
    const layout = layoutAt('/srv/conan', 'linux');
    expect(layout.platform).toBe('linux');
    expect(layout.binary).toBe(
      '/srv/conan/ConanSandbox/Binaries/Linux/ConanSandboxServer-Linux-Shipping',
    );
    expect(layout.modlist_txt).toBe('/srv/conan/ConanSandbox/Mods/modlist.txt');
    expect(layout.workshop_acf).toBe('/srv/conan/steamapps/workshop/appworkshop_440900.acf');
    expect(layout.game_db).toBe('/srv/conan/ConanSandbox/Saved/game.db');
    expect(layout.config_dir).toBe('/srv/conan/ConanSandbox/Saved/Config/LinuxServer');
    expect(layout.launcher_script).toBe('/srv/conan/ConanSandboxServer.sh');
  });

  test('windows uses Win64 + WindowsServer; no launcher_script', () => {
    const layout = layoutAt('C:/srv/conan', 'windows');
    expect(layout.platform).toBe('windows');
    expect(layout.binary).toBe('C:/srv/conan/ConanSandbox/Binaries/Win64/ConanSandboxServer.exe');
    expect(layout.config_dir).toBe('C:/srv/conan/ConanSandbox/Saved/Config/WindowsServer');
    expect(layout.launcher_script).toBeUndefined();
  });
});
