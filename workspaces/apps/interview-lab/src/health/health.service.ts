import { Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  getStatus(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
