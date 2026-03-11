#!/bin/bash
# Test script for agent polling endpoints
# Usage: ./test-polling.sh <AGENT_ID> <POLLING_API_KEY>
#
# You can find these values by:
# 1. Login and get a JWT
# 2. GET /agents to list your agents
# 3. The pollingApiKey is returned when creating an openclaw agent
#    or via POST /agents/:id/regenerate-api-key

BASE_URL="http://localhost:3001"
AGENT_ID="${1:-YOUR_AGENT_ID}"
API_KEY="${2:-YOUR_POLLING_API_KEY}"

echo "=== Testing Agent Polling ==="
echo "Agent ID: $AGENT_ID"
echo "API Key:  ${API_KEY:0:20}..."
echo ""

# Step 1: Poll - should return current status (idle/queued)
echo "--- Step 1: Initial Poll ---"
curl -s -X GET "$BASE_URL/agent-poll/$AGENT_ID/poll" \
  -H "X-Agent-Api-Key: $API_KEY" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"
echo ""

# Step 2: Start the test round-trip (this sets a fake chess turn and waits 30s)
echo "--- Step 2: Starting test round-trip (runs in background, waits 30s for move) ---"
curl -s -X POST "$BASE_URL/agent-poll/$AGENT_ID/test" \
  -H "X-Agent-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" &
TEST_PID=$!
sleep 2

# Step 3: Poll - should now show waiting_for_move with chess game state
echo "--- Step 3: Poll (should show waiting_for_move) ---"
POLL_RESULT=$(curl -s -X GET "$BASE_URL/agent-poll/$AGENT_ID/poll" \
  -H "X-Agent-Api-Key: $API_KEY")
echo "$POLL_RESULT" | python3 -m json.tool 2>/dev/null || echo "$POLL_RESULT"
echo ""

# Extract matchId from poll result
MATCH_ID=$(echo "$POLL_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('matchId',''))" 2>/dev/null)

if [ -z "$MATCH_ID" ]; then
  echo "ERROR: Could not get matchId from poll. Waiting for test to timeout..."
  wait $TEST_PID
  exit 1
fi

echo "Got matchId: $MATCH_ID"
echo ""

# Step 4: Submit a chess move
echo "--- Step 4: Submit move (e2e4) ---"
curl -s -X POST "$BASE_URL/agent-poll/$AGENT_ID/move" \
  -H "X-Agent-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"matchId\": \"$MATCH_ID\", \"move\": {\"move\": \"e2e4\"}}" | python3 -m json.tool 2>/dev/null || echo "(raw output above)"
echo ""

# Step 5: Wait for the test endpoint to return
echo "--- Step 5: Test round-trip result ---"
wait $TEST_PID
echo ""

echo "=== Done! ==="
