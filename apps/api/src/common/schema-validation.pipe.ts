import { HttpStatus, StandardSchemaValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { ApiException } from './errors.js';

/**
 * Global validation: each parameter is validated by the zod schema attached with
 * `@Body({ schema })` (schemas live in @trp/contracts and reject unknown fields).
 * A body, query or path parameter without a schema is a programming error, so it fails loudly instead of
 * silently passing unvalidated input through.
 */
export class SchemaValidationPipe extends StandardSchemaValidationPipe {
  constructor() {
    super({
      exceptionFactory: (issues) =>
        new ApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'Request validation failed',
          issues.map((issue) => {
            const path = issue.path
              ?.map((p) => (typeof p === 'object' ? String(p.key) : String(p)))
              .join('.');
            return path ? `${path}: ${issue.message}` : issue.message;
          }),
        ),
    });
  }

  override async transform<T>(value: T, metadata: ArgumentMetadata): Promise<T> {
    if (
      (metadata.type === 'body' || metadata.type === 'query' || metadata.type === 'param') &&
      !metadata.schema
    ) {
      throw new Error(`Request ${metadata.type} parameter has no validation schema`);
    }
    return super.transform(value, metadata);
  }
}
