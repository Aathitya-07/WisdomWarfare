# Crossword Game Live Leaderboard - Implementation Summary

## ✅ COMPLETED: Backend Implementation

### 1. crosswordserver.js - NEW Functions Added

#### scheduleCrosswordLeaderboardBroadcast()
- **Location**: Added after multer configuration
- **Purpose**: Debounces leaderboard broadcasts to 500ms window
- **Prevents**: Database spam from rapid answer submissions
- **Broadcasts**: `io.to('game_${game_code}').emit('leaderboardUpdate', leaderboard)`

#### POST /crossword/record-answer
- **Location**: New endpoint before Socket.io section
- **Primary Function**: Record answer + update live_leaderboard with real-time scoring
- **Returns**: 
  - `ok: true/false`
  - `points_earned: number`
  - `leaderboard: array` (top 10 players)
- **Database Updates**:
  - Inserts into `crossword_answers` (history)
  - Updates `live_leaderboard` (real-time scores via ON DUPLICATE KEY UPDATE)
  - Updates `crossword_scores` (permanent record)

#### GET /crossword/live-leaderboard/:gameSessionId
- Fetches current leaderboard for specific game session
- Returns top 10 players with scores and accuracy
- Used for initial load and polling

#### POST /crossword/game/end-session/:gameSessionId
- Ends game session
- Finalizes all scores
- Can trigger cleanup of temporary session data

### 2. Global State Additions
```javascript
const leaderboardTimers = new Map(); // Tracks debounce timers per game code
const gameSessions = new Map(); // Per-game session tracking (for future use)
```

### 3. Socket.io Integration
- `joinGame` handler already creates room: `socket.join(game_code)`
- `wordSolved` broadcasts to game room
- Leaderboard broadcasts use room pattern: `io.to('game_${game_code}')`

---

## ⏳ PENDING: Frontend Implementation

### GameUI.js - What Needs to Be Added

#### 1. Crossword Game Type Detection
```javascript
// Already partially in place, ensure this works:
const gameType = locationState.gameType || localStorage.getItem("GAME_TYPE");
// Should be "A. Crossword" for crossword games
```

#### 2. Socket.io Listener for Leaderboard Updates
```javascript
useEffect(() => {
  if (!socketRef.current) return;
  
  const onLeaderboardUpdate = (leaderboard) => {
    if (gameType === "A. Crossword") {
      setLeaderboard(leaderboard);
      console.log('📊 Crossword leaderboard updated:', leaderboard);
    }
  };
  
  socketRef.current.on('leaderboardUpdate', onLeaderboardUpdate);
  
  return () => {
    if (socketRef.current) {
      socketRef.current.off('leaderboardUpdate', onLeaderboardUpdate);
    }
  };
}, [socketRef, gameType]);
```

#### 3. Submit Crossword Answer with Leaderboard Recording
```javascript
const submitCrosswordAnswer = async (questionId, answer) => {
  try {
    // Get game session ID from somewhere (passed route or state)
    const gameSessionId = localStorage.getItem('CROSSWORD_SESSION_ID') || 'CW_123';
    
    const response = await fetch(`${API_BASE}/crossword/record-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: user?.user_id || user?.uid,
        game_session_id: gameSessionId,
        game_code: gameCode,
        crossword_question_id: questionId,
        user_answer: answer
      })
    });

    const result = await response.json();

    if (result.ok) {
      // Update leaderboard from response
      setLeaderboard(result.leaderboard);
      
      // Update player stats
      setGameStats(prev => ({
        ...prev,
        score: prev.score + result.points_earned,
        correct: prev.correct + (result.points_earned > 0 ? 1 : 0),
        questionsAnswered: prev.questionsAnswered + 1
      }));
    } else {
      console.warn('Answer rejected:', result.error);
    }
  } catch (err) {
    console.error('Error submitting crossword answer:', err);
  }
};
```

#### 4. Render Leaderboard During Crossword
```javascript
// Render leaderboard alongside crossword grid
if (gameType === "A. Crossword") {
  return (
    <div className="crossword-game-container">
      <div className="crossword-grid">
        {/* Crossword grid component */}
      </div>
      <div className="live-leaderboard">
        <h3>Live Leaderboard</h3>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Score</th>
              <th>Correct</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((player, idx) => (
              <tr key={player.user_id}>
                <td>{idx + 1}</td>
                <td>{player.display_name || `Player ${player.user_id}`}</td>
                <td>{player.score}</td>
                <td>{player.correct_answers}</td>
                <td>{player.accuracy.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

#### 5. Initialize Crossword Session
```javascript
useEffect(() => {
  if (gameType === "A. Crossword" && gameCode) {
    // Generate or fetch game session ID
    const sessionId = `XWORD_${gameCode}_${Date.now()}`;
    try {
      localStorage.setItem('CROSSWORD_SESSION_ID', sessionId);
      
      // Join socket room for this game
      socketRef.current?.emit('joinGame', {
        game_code: gameCode,
        user_id: user?.user_id,
        game_type: gameType
      });

      // Fetch initial leaderboard
      fetch(`${API_BASE}/crossword/live-leaderboard/${sessionId}`)
        .then(r => r.json())
        .then(data => setLeaderboard(data.leaderboard))
        .catch(err => console.error('Error fetching initial leaderboard:', err));
    } catch (err) {
      console.error('Error initializing crossword session:', err);
    }
  }
}, [gameType, gameCode, user, socketRef]);
```

---

## Database Schema (Already Exists)

```sql
-- live_leaderboard table structure (verify with your DB)
CREATE TABLE live_leaderboard (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  game_session_id VARCHAR(255) NOT NULL,
  game_type VARCHAR(50), -- "Crossword" or "MCQ"
  game_name VARCHAR(100), -- "A. Crossword" or "Wisdom Warfare"
  current_score INT DEFAULT 0,
  questions_answered INT DEFAULT 0,
  correct_answers INT DEFAULT 0,
  accuracy DECIMAL(5,2) DEFAULT 0.00,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_session_user (game_session_id, user_id),
  INDEX idx_session (game_session_id),
  INDEX idx_user_session (user_id, game_session_id)
);
```

---

## Testing the Implementation

### Step 1: Test Backend Endpoints
```bash
# Test recording an answer
curl -X POST http://localhost:4002/crossword/record-answer \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "game_session_id": "CW_1234567_ABC123",
    "game_code": "GAME01",
    "crossword_question_id": 5,
    "user_answer": "SAMPLE"
  }'

# Response should include:
# {
#   "ok": true,
#   "points_earned": 10,
#   "leaderboard": [...]
# }
```

### Step 2: Test Leaderboard Fetch
```bash
curl http://localhost:4002/crossword/live-leaderboard/CW_1234567_ABC123
```

### Step 3: Frontend Testing
1. Open crossword game with game code
2. Answer a question
3. Check console for `leaderboardUpdate` event
4. Verify leaderboard displays and updates
5. Have 2nd player join same game
6. Both players should see each other's scores update in real-time

### Step 4: Database Verification
```sql
-- Check live leaderboard entries
SELECT * FROM live_leaderboard WHERE game_type = 'Crossword' ORDER BY last_updated DESC LIMIT 10;

-- Check permanent scores
SELECT * FROM crossword_scores ORDER BY last_updated DESC LIMIT 10;
```

---

## Files Modified Summary

### ✅ Backend (Done)
- **File**: `backend/crosswordserver.js`
- **Changes**:
  - Added global state: `leaderboardTimers`, `gameSessions`
  - Added function: `scheduleCrosswordLeaderboardBroadcast()`
  - Added endpoints: 
    - `POST /crossword/record-answer` (NEW - main entry point)
    - `GET /crossword/live-leaderboard/:gameSessionId` (NEW)
    - `POST /crossword/game/end-session/:gameSessionId` (NEW)
  - Socket.io handlers integrated (already existed)

### ⏳ Frontend (Todo)
- **File**: `frontend/src/components/GameUI/GameUI.jsx`
- **Changes Needed**:
  - Add/enhance crossword game type detection
  - Add `leaderboardUpdate` socket.io listener
  - Replace `/crossword/submit-answer` with `/crossword/record-answer`
  - Add leaderboard display component
  - Update game statistics display
  - Handle crossword-specific socket events

### ✅ Database (No Changes)
- `live_leaderboard` table already exists
- Schema supports both "MCQ" and "Crossword" game types
- No migrations needed

---

## Key Differences from Wisdom Warfare

| Feature | Wisdom Warfare | Crossword |
|---------|---|---|
| Game Type Value | "MCQ" | "Crossword" |
| Game Name | "Wisdom Warfare" | "A. Crossword" |
| Answer Recording | `/record-answer` | `/crossword/record-answer` |
| Answer Format | Option letter (A/B/C/D) | Text answer |
| Scoring | Fixed points per question | Fixed 10 pts + bonuses |
| Leaderboard Table | `live_leaderboard` | Same: `live_leaderboard` |
| Permanent Record | `performance` table | `crossword_scores` table |

---

## Performance Considerations

1. **Debounced Broadcasts**: 500ms window prevents 100+ broadcasts/sec
2. **ON DUPLICATE KEY UPDATE**: Single SQL query for score updates
3. **Connection Pooling**: 10 connections default (adjust as needed for concurrent players)
4. **Leaderboard Limit**: Top 10 players fetched (prevents bandwidth waste)
5. **Socket.io Rooms**: Per-game-code isolation (scales to multiple games)

---

## Troubleshooting

### Leaderboard not showing
- [ ] Check Socket.io connection in browser console
- [ ] Verify game room join: `socket.emit('joinGame', {...})`
- [ ] Check `/crossword/record-answer` returns leaderboard array
- [ ] Check `live_leaderboard` table has entries after answer submitted

### Scores not accumulating
- [ ] Verify `ON DUPLICATE KEY UPDATE` clause in SQL
- [ ] Check `game_session_id` is unique identifier
- [ ] Check `user_id` + `game_session_id` matches across all queries
- [ ] Check database transaction commits successfully

### Multiple players don't see updates
- [ ] Verify all players join same `game_${gameCode}` room
- [ ] Check broadcast: `io.to('game_${gameCode}').emit(...)`
- [ ] Verify Socket.io listener registered: `socket.on('leaderboardUpdate')`
- [ ] Check browser console for event: `leaderboardUpdate received`

---

## Next Steps

1. ✅ Backend modifications to crosswordserver.js - **COMPLETE**
2. ⏳ Add leaderboard socket listener to GameUI.js
3. ⏳ Update answer submission to use `/crossword/record-answer`
4. ⏳ Render leaderboard display component
5. ⏳ Test with 2+ simultaneous players
6. ⏳ Performance testing and optimization
7. ⏳ Production deployment

---

**Last Updated**: 2025  
**Status**: Backend ✅ | Frontend ⏳ | Testing ⏳
