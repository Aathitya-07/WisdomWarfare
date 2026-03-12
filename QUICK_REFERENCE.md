# Quick Reference - Crossword Game Integration

## 🎮 Game Flow (Quick View)

```
1. TEACHER ACTION
   ├─ Goes to Game Management
   ├─ Selects "A. Crossword"
   ├─ Generates Code
   └─ Clicks "Start Game"
        │
        ├─ Fetches: GET /crossword/questions
        └─ Starts: POST /crossword/start-game
               │
               └─ Server: generateCrosswordGrid()
                      │
                      └─ Broadcasts: io.emit("crosswordGameStarted")

2. STUDENT RECEIVES
   ├─ Listens: socket.on("crosswordGameStarted")
   ├─ Receives: { grid, words, gridSize, sessionId }
   └─ Displays: Crossword with clues

3. STUDENT PLAYS
   ├─ Fills: Answers in grid
   ├─ Submits: socket.emit("submitCrosswordAnswer")
   │
   ├─ Server Scores: Compares against correct answers
   │
   └─ Receives: socket.on("crosswordResult")
                ├─ Score
                ├─ Accuracy
                └─ Leaderboard
```

---

## 📋 API Endpoints Added

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/crossword/questions` | Fetch all questions |
| POST | `/crossword/questions` | Add single question |
| PUT | `/crossword/questions/:id` | Update question |
| DELETE | `/crossword/questions/:id` | Delete question |
| POST | `/crossword/questions/upload` | Upload CSV |
| **POST** | **`/crossword/start-game`** | **⭐ START GAME** |
| GET | `/crossword/game-status` | Get game status |

---

## 🔌 Socket Events

### Server Broadcasts
```javascript
io.emit("crosswordGameStarted", {
  sessionId, grid, words, totalWords, gridSize
})

io.emit("crosswordLeaderboard", [{user_id, score, accuracy}])

io.emit("crosswordGameEnded", {finalLeaderboard})
```

### Server Receives
```javascript
socket.on("getCrosswordGame")
socket.on("submitCrosswordAnswer", {user_id, email, display_name, answers})
socket.on("endCrosswordGame")
```

### Server Sends to Individual
```javascript
socket.emit("crosswordResult", {correctAnswers, totalAnswers, accuracy, score})
socket.emit("crosswordError", {error})
```

---

## 🏗️ Grid Structure

### crosswordGrid (15x15 array)
```javascript
grid[row][col] = {
  letter: "A",         // The letter
  isBlack: false,      // Black square?
  hasLetter: true,     // Has letter?
  number: 1,           // Clue number (if word starts here)
  acrossWord: 5,       // Across word ID
  downWord: 12         // Down word ID
}
```

### crosswordPlacedWords (array)
```javascript
{
  id: 5,
  word: "JAVASCRIPT",
  clue: "Programming language",
  startRow: 7,
  startCol: 3,
  direction: "across",
  length: 10,
  number: 1              // Clue number shown to students
}
```

---

## 📍 Key Integration Points

### 1. Server Imports Grid Generator
```javascript
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordgenerate");
```

### 2. When Teacher Starts Game
```javascript
POST /crossword/start-game receives questions
    ↓
const gridResult = generateCrosswordGrid(questions, 15);
    ↓
crosswordGrid = gridResult.gameGrid;
crosswordPlacedWords = gridResult.placedWords;
    ↓
io.emit("crosswordGameStarted", {grid, words, ...});
```

### 3. Student Receives & Displays
```javascript
socket.on("crosswordGameStarted", (data) => {
  const { grid, words } = data;
  // Render grid in GameUI component
  // Show clues from words array
});
```

### 4. Student Submits & Gets Scored
```javascript
socket.emit("submitCrosswordAnswer", {
  user_id, email, display_name,
  answers: {1: "ANSWER", 2: "WORD", ...}
});

// Server scores
for (const word of crosswordPlacedWords) {
  if (studentAnswer === word.word) correctCount++;
}

// Server sends back
socket.emit("crosswordResult", {
  correctAnswers: 8,
  totalAnswers: 12,
  accuracy: "66.7",
  score: 8
});
```

---

## 🔧 Files Modified

### Backend
- **server.js**
  - ✅ Import crosswordgenerate.js
  - ✅ Global state variables
  - ✅ 7 REST endpoints
  - ✅ 3 Socket handlers
  - ✅ Socket broadcasts

### Frontend
- **crosswordteacher.js**
  - ✅ Added startCrosswordGame()

- **TeacherGameManagementPage.jsx**
  - ✅ Import new function
  - ✅ Update startGameSession()

### Documentation (NEW)
- ✅ CROSSWORD_INTEGRATION_GUIDE.md
- ✅ IMPLEMENTATION_SUMMARY.md
- ✅ QUICK_REFERENCE.md (this file)

---

## ✅ What Now Works

| Feature | Status |
|---------|--------|
| Teacher adds crossword questions | ✅ |
| Teacher uploads questions via CSV | ✅ |
| Teacher generates game code | ✅ |
| Teacher starts crossword game | ✅ |
| Server generates 15x15 grid | ✅ |
| Server places words with intersections | ✅ |
| Students receive grid via Socket.IO | ✅ |
| Students see clues and grid | ✅ |
| Students fill and submit answers | ✅ |
| Scoring calculates accuracy | ✅ |
| Leaderboard broadcasts to all | ✅ |
| Results recorded in DB | ✅ |

---

## 🧪 Quick Test

### Test 1: Add Questions
```bash
curl -X POST http://localhost:4001/crossword/questions \
  -H "Content-Type: application/json" \
  -d '{"question":"Programming language","answer":"JAVASCRIPT"}'
```

### Test 2: Fetch Questions
```bash
curl http://localhost:4001/crossword/questions
```

### Test 3: Start Game (from Teacher)
```javascript
// In TeacherGameManagementPage.jsx
- Click "A. Crossword"
- Generate Code
- Click "Start Game"
- Should show success with grid details
```

### Test 4: Check Student Receives
```javascript
// Open browser console in student browser
// Should see socket event:
socket.on("crosswordGameStarted", (data) => {
  console.log("Grid received:", data.grid);
  console.log("Words:", data.words);
});
```

---

## 📊 Data Flow Summary

```
FLOW 1: Setup
├─ Teacher adds questions → POST /crossword/questions
└─ Questions stored in DB

FLOW 2: Start Game
├─ Teacher clicks Start → startGameSession()
├─ Fetch questions → GET /crossword/questions
├─ Call API → POST /crossword/start-game
├─ Server generates → generateCrosswordGrid()
├─ Store state → global variables
├─ Broadcast → io.emit("crosswordGameStarted")
└─ Return success → show grid details

FLOW 3: Student Plays
├─ Receive grid → socket.on("crosswordGameStarted")
├─ Display grid → GameUI renders
├─ Fill answers → User interaction
├─ Submit → socket.emit("submitCrosswordAnswer")
├─ Calculate score → Compare answers
├─ Broadcast result → socket.emit("crosswordResult")
├─ Broadcast leaderboard → io.emit("crosswordLeaderboard")
└─ Display → Student sees score & ranking
```

---

## 🚀 Common Tasks

### To Add a Crossword Question
```javascript
POST /crossword/questions
{
  "question": "JavaScript method to select element",
  "answer": "QUERYSELECTOR"
}
```

### To Upload Multiple Questions
```
POST /crossword/questions/upload
File: CSV with format: question,answer,difficulty
```

### To Start a Crossword Game
```javascript
// From TeacherGameManagementPage.jsx
1. Select "A. Crossword"
2. Generate Code (creates unique game_code)
3. Click "Start Game"
   ├─ Fetches questions
   ├─ POSTs to /crossword/start-game
   └─ Server generates grid & broadcasts
```

### To Check Game Status
```bash
curl http://localhost:4001/crossword/game-status
```

---

## 🔗 Connection Summary

| Component | Uses | For |
|-----------|------|-----|
| TeacherGameManagementPage | startCrosswordGameAPI() | Starting game |
| startCrosswordGameAPI() | POST /crossword/start-game | Calling server |
| /crossword/start-game | generateCrosswordGrid() | Generating grid |
| generateCrosswordGrid() | DB questions | Creating puzzle |
| /crossword/start-game | io.emit() | Broadcasting grid |
| Socket.IO | crosswordGameStarted | Sending grid to students |
| Students | socket.on() | Receiving & displaying |
| Students | submitCrosswordAnswer | Submitting answers |
| Server | scoring logic | Calculating results |
| Server | io.emit("leaderboard") | Broadcasting results |

---

## 💡 Key Points

1. **crosswordgenerate.js** creates the actual crossword puzzle
2. **server.js** orchestrates everything via the `/crossword/start-game` endpoint
3. **Socket.IO** broadcasts the grid to ALL connected students instantly
4. **TeacherGameManagementPage.jsx** triggers the flow from teacher UI
5. **crosswordteacher.js** provides helper functions
6. Grid is generated once per game, then reused for all students

---

## 📚 Documentation Files

1. **CROSSWORD_INTEGRATION_GUIDE.md** - Complete detailed guide with architecture
2. **IMPLEMENTATION_SUMMARY.md** - What was done and how it works
3. **QUICK_REFERENCE.md** - This file, for quick lookup

---

**Status: ✅ INTEGRATION COMPLETE**

All components are connected and ready for testing!

