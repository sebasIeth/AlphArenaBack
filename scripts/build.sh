#!/bin/bash
set -e

echo "==> Building @alpharena/shared"
pnpm --filter @alpharena/shared build

echo "==> Building db, game-engine, settlement, realtime"
pnpm --filter @alpharena/db build
pnpm --filter @alpharena/game-engine build
pnpm --filter @alpharena/settlement build
pnpm --filter @alpharena/realtime build

echo "==> Building @alpharena/matchmaking"
pnpm --filter @alpharena/matchmaking build

echo "==> Building @alpharena/orchestrator"
pnpm --filter @alpharena/orchestrator build

echo "==> Building @alpharena/api"
pnpm --filter @alpharena/api build

echo "==> Build complete"
