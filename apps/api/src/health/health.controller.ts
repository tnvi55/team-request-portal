import { Controller, Get, Header, HttpStatus, Res } from '@nestjs/common';
import type { LivenessResponse, ReadinessResponse } from '@trp/contracts';
import type { Response } from 'express';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is running. Deliberately checks no dependencies. */
  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): LivenessResponse {
    return { status: 'ok' };
  }

  /** Readiness: all required dependencies answer. 503 tells the proxy not to send traffic. */
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    res.status(result.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
