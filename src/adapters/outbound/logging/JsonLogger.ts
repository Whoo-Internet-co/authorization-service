import type { Logger } from '../../../application/ports/Logger';

export type LogLevel = 'info' | 'warn' | 'error';

export interface JsonLoggerOptions {
  serviceName?: string;
  /** Nível mínimo emitido (padrão: info). */
  minLevel?: LogLevel;
  /** Sink de saída (padrão: stdout). Testes podem capturar. */
  write?: (line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { info: 10, warn: 20, error: 30 };

/**
 * Logger estruturado em JSON (uma linha por evento) — observabilidade
 * 12-factor. Nenhum framework: apenas `process.stdout`. Mantém o domínio e
 * a aplicação livres de dependência de logging (ADR-001).
 */
export class JsonLogger implements Logger {
  private readonly serviceName: string;
  private readonly minLevel: LogLevel;
  private readonly write: (line: string) => void;

  constructor(options: JsonLoggerOptions = {}) {
    this.serviceName = options.serviceName ?? 'authorization-service';
    this.minLevel = options.minLevel ?? 'info';
    this.write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.emit('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.emit('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.emit('error', message, context);
  }

  private emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...(context ?? {}),
    };
    this.write(JSON.stringify(entry));
  }
}
