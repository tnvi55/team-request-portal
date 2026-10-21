import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, parseEnv } from './env.js';

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => parseEnv(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
