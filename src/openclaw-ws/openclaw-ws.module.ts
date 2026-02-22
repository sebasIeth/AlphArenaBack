import { Module, Global } from '@nestjs/common';
import { OpenClawWsService } from './openclaw-ws.service';
import { OpenClawHttpService } from './openclaw-http.service';

@Global()
@Module({
  providers: [OpenClawWsService, OpenClawHttpService],
  exports: [OpenClawWsService, OpenClawHttpService],
})
export class OpenClawWsModule {}
