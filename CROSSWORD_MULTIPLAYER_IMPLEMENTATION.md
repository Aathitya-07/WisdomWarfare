# Crossword Game Multiplayer Integration with Live Leaderboard

## Overview

This document details the integration of live multiplayer leaderboard functionality into the Crossword game, following the exact patterns from Wisdom Warfare.

## Changes Made

### 1. ✅ Backend (crosswordserver.js)

#### A. New Global State Variables
```javascript
const leaderboardTimers = new Map(); // game_code -> timeout ID for debounced broadcasts
const gameSessions = new Map(); // game_code -> { gameSessionId, startTime, players, gameState }
```

#### B. Live Leaderboard Helper Function
Added `scheduleCrosswordLeaderboardBroadcast(game_code, gameSessionId)` function that:
- Debounces leaderboard updates to 500ms window (prevents database spam)
- Fetches fresh leaderboard data from `live_leaderboard` table
- Broadcasts to game room using Socket.io pattern: `io.to(`game_${game_code}`)

#### C. New API Endpoints

**1. POST /crossword/record-answer** (Replaces old logic)
- Records crossword answers with **live leaderboard integration**
- Updates both `crossword_answers` and `live_leaderboard` tables
- Returns updated leaderboard with player display names
- **Triggers debounced broadcast to all players in game**

Example Request:
```javascript
POST /crossword/record-answer
{
  "user_id": 1,
  "game_session_id": "CW_1234567_ABC123",
  "game_code": "GAME01",
  "crossword_question_id": 5,
  "user_answer": "ANSWER"
}
```

Example Response:
```javascript
{
  "ok": true,
  "points_earned": 10,
  "leaderboard": [
    {
      "user_id": 1,
      "display_name": "Player Name",
      "score": 50,
      "accuracy": 100,
      "correct_answers": 5,
      "attempts": 5
    }
  ]
}
```

**2. GET /crossword/live-leaderboard/:gameSessionId**
- Fetches real-time leaderboard for a specific game session
- Returns top 10 players sorted by score and accuracy
- Used for initial load and polling fallback

**3. POST /crossword/game/end-session/:gameSessionId**
- Ends a game session and finalizes all scores
- Transfers scores from `live_leaderboard` to permanent records
- Broadcasts game completion to all players

### 2. Frontend (GameUI.js Changes Needed)

The GameUI component needs to:

#### A. Detect Game Type (Already Partially Implemented)
```javascript
const gameType = locationState.gameType || localStorage.getItem("GAME_TYPE") || "Wisdom Warfare";
```
- Recognize "A. Crossword" as crossword game type
- Use conditional rendering for game-specific UI

#### B. Add Crossword-Specific Socket.io Listeners
```javascript
// In the socket event handlers section, add:
socket.on('leaderboardUpdate', (leaderboard) => {
  if (gameType === 'A. Crossword') {
    setLeaderboard(leaderboard);
  }
});
```

#### C. Display Live Leaderboard During Gameplay
- Similar to Wisdom Warfare leaderboard display
- Shows real-time player scores as they answer questions
- Updates automatically on `leaderboardUpdate` events

#### D. Handle Crossword-Specific Events
- `crosswordGameStarted`: Initialize crossword display
- `wordSolved`: Show when other players solve words
- `leaderboardUpdate`: Update scores in real-time
- `crosswordGameEnded`: Show final results with leaderboard

#### E. Submit Crossword Answers with Leaderboard
```javascript
// Instead of /crossword/submit-answer, use /crossword/record-answer
const recordCrosswordAnswer = async (questionId, answer) => {
  fetch('/crossword/record-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: user.user_id,
      game_session_id: gameSessionId,
      game_code: gameCode,
      crossword_question_id: questionId,
      user_answer: answer
    })
  })
  .then(async (response) => {
    const result = await response.json();
    if (result.ok) {
      // Leaderboard returned with live updates
      setLeaderboard(result.leaderboard);
    }
  });
};
```

### 3. Database (No Changes Required)

The `live_leaderboard` table already exists with the correct schema:
```sql
CREATE TABLE live_leaderboard (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  game_session_id VARCHAR(255) NOT NULL,
  game_type VARCHAR(50),  -- "MCQ" for Wisdom Warfare, "Crossword" for Crossword
  game_name VARCHAR(100),  -- "Wisdom Warfare" or "A. Crossword"
  current_score INT DEFAULT 0,
  questions_answered INT DEFAULT 0,
  correct_answers INT DEFAULT 0,
  accuracy DECIMAL(5,2) DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_session_user (game_session_id, user_id),
  INDEX idx_session (game_session_id),
  INDEX idx_user_session (user_id, game_session_id)
);
```

## How It Works

### Game Session Flow

1. **Player Joins Game** (via game code)
   - Frontend calls `/joinGame` socket event
   - Backend creates game session or joins existing
   - Player added to `live_leaderboard` with initial score of 0
   - Join broadcasts updated leaderboard to all players in game room

2. **Player Answers Question**
   - Frontend submits answer via POST `/crossword/record-answer`
   - Backend updates:
     - `crossword_answers` table (record of answer)
     - `live_leaderboard` table (real-time score via ON DUPLICATE KEY UPDATE)
   - Leaderboard is fetched immediately
   - **500ms debounced broadcast** sends updated leaderboard to game room
   - All players receive `leaderboardUpdate` event with new rankings

3. **Game Continues**
   - Multiple players answer questions simultaneously
   - Each answer triggers live leaderboard update
   - Scores accumulate in real-time
   - Players see live rankings update

4. **Game Ends**
   - Teacher or system calls `/crossword/game/end-session/:gameSessionId`
   - Scores are finalized
   - Final leaderboard with all players' results displayed
   - Scores transferred to permanent `crossword_scores` table

### Key Features

✅ **Real-time Score Updates**: Leaderboard updates immediately when player answers
✅ **Debounced Broadcasting**: 500ms window prevents database spam
✅ **Player Names**: Displays user display_name from users table
✅ **Accuracy Tracking**: Calculates accuracy percentage in real-time
✅ **Multi-player Support**: Multiple players in same game see shared leaderboard
✅ **Game Room Isolation**: Each game code gets its own Socket.io room (`game_${gameCode}`)
✅ **Session Tracking**: Uses `game_session_id` to track all players in specific session
✅ **Duplicate Question Prevention**: Prevents same user answering same question twice
✅ **Fallback Support**: If Socket.io broadcast fails, scores still recorded in database

## API Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/crossword/record-answer` | **PRIMARY**: Record answer & update live leaderboard |
| GET | `/crossword/live-leaderboard/:gameSessionId` | Get current leaderboard for session |
| POST | `/crossword/game/end-session/:gameSessionId` | End game session and finalize scores |
| POST | `/crossword/submit-answer` | OLD: Use record-answer instead |
| GET | `/crossword/leaderboard` | Permanent leaderboard (all-time) |

## Socket.io Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `leaderboardUpdate` | Server → Client | Array of leaderboard entries |
| `joinGame` | Client → Server | { game_code, user_id, game_type } |
| `wordSolved` | Server → Clients | { wordId, user, points } |
| `crosswordGameEnded` | Server → Clients | { finalLeaderboard } |

## Testing Checklist

- [ ] Single player can answer questions and see score update
- [ ] Multiple players answering same question don't conflict
- [ ] Leaderboard updates in real-time for all connected players
- [ ] Duplicate answer prevention works correctly
- [ ] Accuracy percentage calculated correctly
- [ ] Player display names show instead of user IDs
- [ ] Scores persist in database after session ends
- [ ] Game room isolation (different game codes don't interfere)
- [ ] Debounced broadcasts don't cause duplicate updates
- [ ] Browser page refresh restores game state from localStorage
- [ ] Player exit and rejoin works correctly
- [ ] Final leaderboard shows all players' final scores

## Migrating from Old Endpoint

If frontend still uses `/crossword/submit-answer`:
1. Replace endpoint URL with `/crossword/record-answer`
2. Ensure request includes `game_code` and `game_session_id`
3. Handle leaderboard response in addition to answer result
4. Update leaderboard display when response arrives

## Common Issues & Solutions

### Issue: Leaderboard not updating
- **Solution**: Verify game room join: `socket.join(game_code)` on joinGame
- **Solution**: Check `/crossword/record-answer` returns leaderboard array
- **Solution**: Ensure Socket.io listener for `leaderboardUpdate` is registered

### Issue: Points not accumulating
- **Solution**: Verify ON DUPLICATE KEY UPDATE clause in INSERT query
- **Solution**: Check `user_id` and `game_session_id` are unique key
- **Solution**: Ensure `current_score = current_score + VALUES(current_score)`

### Issue: Multiple players see different leaderboards
- **Solution**:All players must join same `game_${gameCode}` room
- **Solution**: Verify leaderboard broadcasts to correct room name
- **Solution**: Check that all players have same `game_session_id`

### Issue: stale data after browser refresh
- **Solution**: GameUI saves game state to localStorage
- **Solution**: On reconnect, restore from localStorage first
- **Solution**: Fetch fresh leaderboard via GET `/crossword/live-leaderboard/:sessionId`

## Verification Steps

1. **Backend Ready**:
   - Check crosswordserver.js has `scheduleCrosswordLeaderboardBroadcast` function
   - Check POST `/crossword/record-answer` endpoint exists
   - Check `live_leaderboard` table has data after game session

2. **Database Ready**:
   - Run: `SELECT* FROM live_leaderboard WHERE game_type = 'Crossword' LIMIT 5;`
   - Should show player scores updating in real-time

3. **Frontend Ready**:
   - GameUI.js imports Socket.io correctly
   - GameUI listens for `leaderboardUpdate` events
   - GameUI displays leaderboard during gameplay

4. **Integration Ready**:
   - Play crossword game with 2+ players
   - Watch leaderboard update in real-time
   - Verify accuracy and scores accumulate correctly
   - Verify final results show all players

## Next Steps

1. Update GameUI.js with crossword leaderboard display
2. Test with 2+ simultaneous players
3. Verify Socket.io broadcast performance (check browser console for events)
4. Monitor database for live_leaderboard growth (cleanup old sessions as needed)
5. Add leaderboard animation/polish for better UX

---

**Status**: ✅ Backend Implementation Complete | ⏳ Frontend Integration Pending  
**Files Modified**: `backend/crosswordserver.js` (new endpoints & socket handlers)  
**Files To Modify**: `frontend/src/components/GameUI/GameUI.jsx` (leaderboard display + event handlers)
