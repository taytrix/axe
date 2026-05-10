export const ExitCode = {
  Ok: 0,
  Generic: 1,
  Misuse: 2,
  Config: 10,
  Discovery: 11,
  Network: 20,
  Lifecycle: 30,
  Filesystem: 40,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export type AxeErrorKind = 'config' | 'discovery' | 'filesystem' | 'workshop_api' | 'acf_parse';

export class AxeError extends Error {
  readonly kind: AxeErrorKind;

  constructor(kind: AxeErrorKind, message: string) {
    super(message);
    this.name = 'AxeError';
    this.kind = kind;
  }

  exitCode(): ExitCode {
    switch (this.kind) {
      case 'config':
        return ExitCode.Config;
      case 'discovery':
      case 'acf_parse':
        return ExitCode.Discovery;
      case 'filesystem':
        return ExitCode.Filesystem;
      case 'workshop_api':
        return ExitCode.Network;
    }
  }
}
