import { Module } from '@nestjs/common';
import { PeopleService } from './people.service.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({
  controllers: [RequestsController],
  providers: [RequestsService, PeopleService],
})
export class RequestsModule {}
