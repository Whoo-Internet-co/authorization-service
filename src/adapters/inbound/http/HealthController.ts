import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  status: 'ok';
  service: string;
  timestamp: string;
  uptime_seconds: number;
}

/**
 * Health check (ALB/container). `GET /health` — 200 quando o processo está
 * servindo. Não verifica dependências (DynamoDB) para evitar flapping do
 * target group em blips transitórios; liveness do processo.
 */
@Controller()
export class HealthController {
  @Get('/health')
  check(): HealthResponse {
    return {
      status: 'ok',
      service: process.env.SERVICE_NAME ?? 'authorization-service',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
    };
  }
}
