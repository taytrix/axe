import { describe, expect, test } from 'bun:test';
import {
  defaultInstallPath,
  defaultUnitName,
  renderSystemdUserUnit,
} from '../../src/core/service.ts';

const BASE_INPUT = {
  name: 'axe-conan',
  axePath: '/home/tay/.local/bin/axe',
  configPath: '/home/tay/conan/axe.toml',
  workingDirectory: '/home/tay/conan',
} as const;

describe('renderSystemdUserUnit', () => {
  test('foreground mode: ExecStart runs `start --foreground`', () => {
    const text = renderSystemdUserUnit({ ...BASE_INPUT, mode: 'foreground' });
    expect(text).toContain(
      'ExecStart=/home/tay/.local/bin/axe --config /home/tay/conan/axe.toml start --foreground',
    );
    expect(text).toContain('Description=Conan Exiles dedicated server (via axe)');
  });

  test('daemon mode: ExecStart runs `daemon run`', () => {
    const text = renderSystemdUserUnit({ ...BASE_INPUT, mode: 'daemon' });
    expect(text).toContain(
      'ExecStart=/home/tay/.local/bin/axe --config /home/tay/conan/axe.toml daemon run',
    );
    expect(text).toContain('Description=axe drift sensor for Conan Exiles dedicated server');
  });

  test('always emits WantedBy=default.target (user unit, not system)', () => {
    const fg = renderSystemdUserUnit({ ...BASE_INPUT, mode: 'foreground' });
    const dm = renderSystemdUserUnit({ ...BASE_INPUT, mode: 'daemon' });
    expect(fg).toContain('WantedBy=default.target');
    expect(dm).toContain('WantedBy=default.target');
    // Also: no system-unit hint that would put this in /etc/systemd/system.
    expect(fg).not.toContain('multi-user.target');
    expect(dm).not.toContain('multi-user.target');
  });

  test('never emits User= directive (user unit runs as the invoker)', () => {
    const fg = renderSystemdUserUnit({ ...BASE_INPUT, mode: 'foreground' });
    const dm = renderSystemdUserUnit({ ...BASE_INPUT, mode: 'daemon' });
    expect(fg).not.toMatch(/^User=/m);
    expect(dm).not.toMatch(/^User=/m);
  });
});

describe('defaultUnitName', () => {
  test('foreground -> axe-<id>; daemon -> axe-<id>-daemon', () => {
    expect(defaultUnitName('myserver', 'foreground')).toBe('axe-myserver');
    expect(defaultUnitName('myserver', 'daemon')).toBe('axe-myserver-daemon');
  });
});

describe('defaultInstallPath', () => {
  test('lands under XDG_CONFIG_HOME-shaped systemd user dir', () => {
    const p = defaultInstallPath('axe-conan');
    expect(p).toMatch(/\/\.config\/systemd\/user\/axe-conan\.service$/);
  });
});
