# Primary technical references

Checked while preparing this pack: 2026-10-19. These are development references, not runtime dependencies.

The product scope, proposed schema, endpoint map, limits, and milestone choices are our project design. Recheck version-specific APIs before coding; do not combine examples from incompatible framework majors.

| Source | Use in this project |
| --- | --- |
| [Claude Code: project instructions and memory](https://code.claude.com/docs/en/memory) | CLAUDE.md, explicit document reading, imports, and supplementary automatic memory |
| [Claude Code: best practices](https://code.claude.com/docs/en/best-practices) | Small tasks, planning where useful, and verifiable checks |
| [Node.js releases](https://nodejs.org/en/about/previous-releases) | Select a supported LTS runtime; Node 24 is the initial target |
| [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) | Reverse proxy, identical builds, private caching, and replica considerations |
| [NestJS authentication](https://docs.nestjs.com/security/authentication) | Nest authentication concepts; our MVP chooses externalized cookie sessions |
| [NestJS sessions](https://docs.nestjs.com/techniques/session) | Session middleware; replace default process-memory storage with shared Redis |
| [Prisma ORM 7: multiple databases](https://www.prisma.io/docs/guides/v7/database/multiple-databases) | Client/config separation for independent databases |
| [Prisma ORM 7: transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions) | Single-database atomic operations and concurrency behavior |
| [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html) | RLS policies, FORCE RLS, and privileged-role bypass |
| [Microsoft architecture: sharding](https://learn.microsoft.com/en-us/azure/architecture/patterns/sharding) | Directory-based tenant partitioning concept; Azure services are not used |
| [Redis key eviction](https://redis.io/docs/latest/develop/reference/eviction/) | Memory limits and noeviction tradeoffs |
| [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | Maintained Argon2id implementation and password-hash baseline |
| [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) | Session-bound CSRF tokens and origin validation |

## Company sample adaptation

The uploaded company README describes an AI-assisted project-management toolchain with discovery, scope, architecture, backlog, estimates, and session-state documents.

This project adopts:
- define scope before coding,
- one owning document per type of fact,
- explicit assumptions,
- milestone acceptance gates,
- short session handoffs.

It does not install that repository's skill files, Odoo MCP server, ticket integrations, or its full client-delivery workflow. The original sample remains unchanged.

