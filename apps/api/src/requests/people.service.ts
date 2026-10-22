import { Injectable, Logger } from '@nestjs/common';
import { ServiceUnavailableError } from '../common/errors.js';
import { DatabaseService } from '../database/database.service.js';

/**
 * Display names for user ids stored on tenant rows. Users live in the control database and
 * requests in a shard, so there is no SQL join: the app runs ONE batched lookup per page
 * (never one query per row), limited to members of the caller's own organization.
 */
@Injectable()
export class PeopleService {
  private readonly logger = new Logger(PeopleService.name);

  constructor(private readonly database: DatabaseService) {}

  async displayNames(organizationId: string, userIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    try {
      const users = await this.database.control.user.findMany({
        where: { id: { in: ids }, membership: { organizationId } },
        select: { id: true, displayName: true },
      });
      return new Map(users.map((u) => [u.id, u.displayName]));
    } catch (error) {
      this.logger.error(`Display name lookup failed (${error instanceof Error ? error.name : 'unknown'})`);
      throw new ServiceUnavailableError();
    }
  }
}
