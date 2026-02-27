import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Match, MatchSchema, Agent, AgentSchema, MoveDoc, MoveSchema } from '../database/schemas';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { SettlementModule } from '../settlement/settlement.module';
import { OrchestratorService } from './orchestrator.service';
import { MatchManagerService } from './match-manager.service';
import { TurnControllerService } from './turn-controller.service';
import { MarrakechTurnControllerService } from './marrakech-turn-controller.service';
import { ChessTurnControllerService } from './chess-turn-controller.service';
import { ResultHandlerService } from './result-handler.service';
import { AgentClientService } from './agent-client.service';
import { OpenClawClientService } from './openclaw-client.service';
import { EventBusService } from './event-bus.service';
import { ActiveMatchesService } from './active-matches.service';
import { HumanMoveService } from './human-move.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Match.name, schema: MatchSchema },
      { name: Agent.name, schema: AgentSchema },
      { name: MoveDoc.name, schema: MoveSchema },
    ]),
    GameEngineModule,
    forwardRef(() => SettlementModule),
  ],
  providers: [
    EventBusService,
    ActiveMatchesService,
    HumanMoveService,
    OpenClawClientService,
    AgentClientService,
    TurnControllerService,
    MarrakechTurnControllerService,
    ChessTurnControllerService,
    ResultHandlerService,
    MatchManagerService,
    OrchestratorService,
  ],
  exports: [OrchestratorService, EventBusService, ActiveMatchesService, HumanMoveService],
})
export class OrchestratorModule {}
