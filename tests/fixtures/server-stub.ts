#!/usr/bin/env bun
// Long-running stub used as a fake server binary in PR4 lifecycle tests.
// Bun shebang because bash's signal handling around `wait` was racy.
//
// AXE_STUB_IGNORE_TERM=1: ignore SIGTERM (drives the SIGKILL escalation test).
// AXE_STUB_DURATION=<sec>: max lifetime before self-exit (default 30).

const ignore = process.env.AXE_STUB_IGNORE_TERM === '1';
const duration = Number(process.env.AXE_STUB_DURATION ?? '30') * 1000;

process.on('SIGTERM', () => {
  if (ignore) {
    process.stderr.write('stub: ignoring SIGTERM\n');
    return;
  }
  process.stderr.write('stub: caught SIGTERM, exiting\n');
  process.exit(0);
});

const stopAt = Date.now() + duration;
const timer = setInterval(() => {
  if (Date.now() >= stopAt) {
    clearInterval(timer);
    process.exit(0);
  }
}, 100);
