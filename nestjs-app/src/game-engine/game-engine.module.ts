import { Module, Global } from '@nestjs/common';
import { GameEngineService } from './game-engine.service';

@Global()
@Module({
  providers: [GameEngineService],
  exports: [GameEngineService],
})
export class GameEngineModule {}
