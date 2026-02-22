import { Module, Global } from '@nestjs/common';
import { OpenClawWsService } from './openclaw-ws.service';

@Global()
@Module({
  providers: [OpenClawWsService],
  exports: [OpenClawWsService],
})
export class OpenClawWsModule {}
