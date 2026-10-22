import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';
import { APP_CONFIG, type AppConfig } from '../config/env.js';

export type RedisClient = ReturnType<typeof createClient>;

/**
 * The single Redis client of this process, shared by sessions, rate limits and (M7) the cache.
 * Redis holds the shared state that lets any API replica serve any request.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: RedisClient;
  /** Prefix for every key this app writes (e.g. "trp:"). */
  readonly prefix: string;
  private readonly firstConnect: Promise<unknown>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.prefix = config.REDIS_KEY_PREFIX;
    this.client = createClient({
      url: config.REDIS_URL,
      // Fail commands immediately while disconnected instead of queueing them: callers then
      // fail closed (503) rather than hanging.
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
      },
    });
    let reported = false;
    this.client.on('error', () => {
      // node-redis emits on every failed reconnect attempt; log once, never the URL.
      if (!reported) this.logger.warn('Redis connection error; requests needing Redis will get 503');
      reported = true;
    });
    this.client.on('ready', () => {
      reported = false;
    });
    // Connect in the background so the process stays alive (but unready) while Redis is down.
    this.firstConnect = this.client.connect();
    this.firstConnect.catch(() => undefined);
  }

  /** Resolves once the first connection succeeded; never resolves while Redis stays down. */
  connected(): Promise<unknown> {
    return this.firstConnect;
  }

  async onApplicationShutdown(): Promise<void> {
    // close() lets pending commands finish; destroy() stops a client still retrying its connection.
    if (this.client.isReady) await this.client.close();
    else if (this.client.isOpen) this.client.destroy();
  }
}
