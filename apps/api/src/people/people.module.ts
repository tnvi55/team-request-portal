import { Module } from '@nestjs/common';
import { PeopleService } from './people.service.js';

/** Names and profiles from the control database, shared by auth, admin, and requests. */
@Module({
  providers: [PeopleService],
  exports: [PeopleService],
})
export class PeopleModule {}
