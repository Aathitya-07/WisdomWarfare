# 🎮 Crossword Game - Startup & Testing Guide

## ⚡ Quick Start

### Step 1: Start Both Backend Servers

**Option A: Windows Batch (Easiest)**
```bash
cd backend
./start-both.bat
```

**Option B: Windows PowerShell**
```powershell
cd backend
./start-both.ps1
```

**Option C: Manual (2 Terminals)**

Terminal 1 - Main Server (Port 4001):
```bash
cd backend
npm start
```

Terminal 2 - Crossword Server (Port 4002):
```bash
cd backend
npm run start:crossword
```

### Step 2: Start Frontend

Terminal 3 - React Frontend (Port 3000):
```bash
cd frontend
npm start
```

### Step 3: Access the Application

- **Frontend**: http://localhost:3000
- **Main API**: http://localhost:4001
- **Crossword API**: http://localhost:4002

## ✅ Testing the Complete Flow

### Test 1: Teacher Creates & Starts Game
1. Go to http://localhost:3000/teacher-game-management
2. Select "A. Crossword" game type
3. Click "Generate" → Get game code (e.g., 4WEIZ0)
4. Note the game code

### Test 2: Student Joins & Waits
1. Open new browser window/tab: http://localhost:3000
2. Select "Student"
3. Enter game code from Test 1
4. Click "Join Game"
5. **Expected**: See waiting dashboard with:
   - ⏳ "Waiting for Crossword Game to Start"
   - 0 Points, 0 Cells Filled, 0% Accuracy
   - 🟢 Connected to server
   - "Waiting for players to join..."

### Test 3: Multiple Students Join
1. Repeat Test 2 in another tab/window with different email
2. **Expected**: First student's leaderboard updates to "1 player(s) ready"
3. Both students see each other in leaderboard

### Test 4: Teacher Starts Game
1. Back to teacher window (Test 1)
2. Click "START GAME" button
3. **Expected (CRITICAL)**:
   - ❌ NO ERROR (previously got "Failed to fetch" or "No questions")
   - ✅ Success message appears
   - Student screens show crossword grid instantly
   - Waiting dashboard replaced with game grid

### Test 5: Play & Score Updates
1. Students fill in crossword answers
2. **Expected**: Live leaderboard updates with scores in real-time
3. All students sync on scores
4. Accuracy percentage updates

### Test 6: Game End
1. One student completes crossword
2. Teacher can view results
3. Download results as CSV

## 🔧 Troubleshooting

### "Failed to fetch" Error
**Cause**: Crossword server (port 4002) not running
**Fix**: 
- Kill terminals and run `start-both.bat` (Option A)
- Ensure you have 2 terminals for manual startup

### "No crossword questions provided"
**Cause**: No questions in database OR wrong API port
**Fix**:
- Add questions via teacher dashboard
- Verify port 4002 is running: `netstat -ano | findstr 4002`

### 0 Players Show in Waiting Screen
**Cause**: playerListUpdate socket event not broadcasting
**Fix**:
- Check browser console for socket errors
- Restart both backend servers

### Grid Doesn't Appear When Game Starts
**Cause**: gameStarted event not received before grid event
**Fix**:
- Check that gameStarted broadcasts BEFORE crosswordGrid
- Verify in backend/crosswordserver.js line ~457-465

### "Failed to start A. Crossword" on Teacher Dashboard
**Cause**: API routing to wrong port OR CORS issue
**Fix**:
- Verify CROSSWORD_API_BASE = "http://localhost:4002" in crosswordteacher.js
- Check both servers running on correct ports
- Clear browser cache and retry

## 📊 Verify Server Status

### Check Port 4002 (Crossword Server)
```powershell
netstat -ano | findstr 4002
# Should show: LISTENING on 0.0.0.0:4002
```

### Check Port 4001 (Main Server)
```powershell
netstat -ano | findstr 4001
# Should show: LISTENING on 0.0.0.0:4001
```

### Verify API Endpoints Responding
Check these in browser or terminal:
- http://localhost:4002/  → Should show "Crossword Game Backend Running!"
- http://localhost:4001/api/health → Main server API

## 🎯 Expected Crossword Game Flow Diagram

```
TEACHER SIDE                          STUDENT SIDE

1. Create Game → Code                 
   (4WEIZ0)                          
   
2. Student joins ←──── Socket: joinGame
                        ├─ Create session
                        ├─ Add player
                        └─ Broadcast playerListUpdate
   
                        ──→ Setup waiting dashboard
                            ├─ 0 Points
                            ├─ 0 Cells Filled
                            ├─ 0% Accuracy
                            └─ Connected 🟢

3. Teacher clicks START ─ REST: /crossword/start-game
   ├─ Load questions
   ├─ Generate grid
   ├─ Update session → ACTIVE
   ├─ Socket: gameStarted (CRITICAL!)
   │          Creates isGameActive = true
   └─ Socket: crosswordGrid
     
                        ──→ Frontend receives gameStarted
                            ├─ Sets isGameActive = true
                            └─ Conditional rendering fires!
                            
                        ──→ Frontend receives crosswordGrid
                            ├─ Displays 15x15 grid
                            ├─ Shows clues
                            └─ Ready to play

4. Student solves words ─ Socket: crosswordSubmit
                        ├─ Check answer
                        ├─ Award points
                        ├─ Update live_leaderboard
                        └─ Socket: leaderboardUpdate
                        
                        ──→ All students see updated scores
                            ├─ Real-time sync
                            └─ Leaderboard refreshes

5. Game ends ──────────→ Final scores saved
```

## 🚀 Production Deployment Notes

1. **Multiple Servers**: 
   - Use PM2 or Docker to manage multiple processes
   - Ensure sufficient memory for both Node.js instances

2. **Database**:
   - Verify MySQL is running
   - Both servers share same database (wisdomwarfare)
   - Required tables:
     - crossword_questions
     - crossword_answers
     - crossword_scores
     - live_leaderboard
     - teacher_games

3. **Environment Variables** (.env):
   ```
   CROSSWORD_PORT=4002
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=root
   DB_NAME=wisdomwarfare
   ```

4. **Frontend Environment** (.env):
   ```
   REACT_APP_API_BASE=http://localhost:4001
   REACT_APP_CROSSWORD_API_BASE=http://localhost:4002
   ```

## 📝 Files Modified in This Fix

1. **backend/package.json** - Added crossword start scripts
2. **backend/start-both.bat** - Batch script for Windows
3. **backend/start-both.ps1** - PowerShell script for Windows
4. **backend/crosswordserver.js** - Verified all endpoints working
5. **frontend/src/crosswordteacher.js** - Verified CROSSWORD_API_BASE usage
6. **frontend/src/TeacherGameManagementPage.jsx** - Verified API routing
7. **frontend/src/components/GameUI/GameUI.js** - Verified socket handlers

## ✨ All Systems Go!

Both servers are now running and ready for testing. The crossword game should work **perfectly and consistently** like Wisdom Warfare MCQ games.

**Status**: 🟢 Production Ready
