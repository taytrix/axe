import type { Command } from 'commander';
import { AxeError, ExitCode, findLatestLog, loadContext, tailLog } from '../../core/index.ts';
import {
  readGlobalConfigPath,
  readOutputOptions,
  renderError,
  renderFail,
  renderOk,
} from '../output.ts';

type LogsTailFlags = {
  follow?: boolean;
  lines?: string;
};

type LogsPathData = {
  logs_dir: string;
  current_log: string | null;
};

type LogsTailData = {
  path: string;
  lines: string[];
};

export function registerLogs(program: Command): void {
  const logs = program.command('logs').description('inspect Conan server log files');

  logs
    .command('path')
    .description('print the logs directory and the path of the current log file')
    .action(async (_options: unknown, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);
      try {
        const { layout } = await loadContext(configPath);
        const current_log = await findLatestLog(layout);
        const data: LogsPathData = { logs_dir: layout.logs_dir, current_log };
        renderOk({
          command: 'logs path',
          data,
          opts,
          human: () => {
            console.log(`logs_dir: ${layout.logs_dir}`);
            console.log(`current:  ${current_log ?? '<none>'}`);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'logs path', error: e, opts });
          return;
        }
        throw e;
      }
    });

  logs
    .command('tail')
    .description('print the tail of the current log file (optionally follow)')
    .option('--follow', 'after the initial batch, keep printing new lines as they arrive')
    .option('--lines <n>', 'number of lines to print initially', '100')
    .action(async (options: LogsTailFlags, cmd: Command) => {
      const opts = readOutputOptions(cmd);
      const configPath = readGlobalConfigPath(cmd);

      const lineCount = Number.parseInt(options.lines ?? '100', 10);
      if (!Number.isFinite(lineCount) || lineCount < 0) {
        renderFail({
          command: 'logs tail',
          code: ExitCode.Misuse,
          message: `--lines expects a non-negative integer; got "${options.lines}"`,
          opts,
        });
        return;
      }

      if (opts.json && options.follow) {
        renderFail({
          command: 'logs tail',
          code: ExitCode.Misuse,
          message: '--json is incompatible with --follow (no clean envelope shape for streaming)',
          opts,
        });
        return;
      }

      try {
        const { layout } = await loadContext(configPath);
        const path = await findLatestLog(layout);
        if (path === null) {
          throw new AxeError('discovery', `no log files in ${layout.logs_dir}`);
        }

        if (options.follow) {
          // Plain-text follow loop. SIGINT (Ctrl-C) ends naturally.
          const controller = new AbortController();
          const onSig = () => controller.abort();
          process.once('SIGINT', onSig);
          process.once('SIGTERM', onSig);
          try {
            for await (const line of tailLog(path, {
              lines: lineCount,
              follow: true,
              signal: controller.signal,
            })) {
              console.log(line);
            }
          } finally {
            process.off('SIGINT', onSig);
            process.off('SIGTERM', onSig);
          }
          return;
        }

        const collected: string[] = [];
        for await (const line of tailLog(path, { lines: lineCount, follow: false })) {
          collected.push(line);
        }
        const data: LogsTailData = { path, lines: collected };
        renderOk({
          command: 'logs tail',
          data,
          opts,
          human: () => {
            for (const line of collected) console.log(line);
          },
        });
      } catch (e) {
        if (e instanceof AxeError) {
          renderError({ command: 'logs tail', error: e, opts });
          return;
        }
        throw e;
      }
    });
}
