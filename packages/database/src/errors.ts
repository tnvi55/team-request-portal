/** The organization has no directory entry: fail closed, never guess a shard. */
export class TenantNotRoutedError extends Error {
  constructor() {
    super('Organization has no tenant shard mapping');
    this.name = 'TenantNotRoutedError';
  }
}

/** A shard key exists in data but this process has no configured connection for it. */
export class ShardNotConfiguredError extends Error {
  constructor(shardKey: string) {
    super(`Shard ${shardKey} is not configured`);
    this.name = 'ShardNotConfiguredError';
  }
}

/** A tenant id that is not a UUID never reaches set_config. */
export class InvalidTenantIdError extends Error {
  constructor() {
    super('Tenant id must be a UUID');
    this.name = 'InvalidTenantIdError';
  }
}
