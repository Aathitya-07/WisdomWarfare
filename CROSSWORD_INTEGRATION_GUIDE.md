# Crossword Game Integration Guide

## Overview
This document describes the complete integration of the crossword game system where teachers can start games from TeacherGameManagementPage, the server generates crossword grids using crosswordgenerate.js, and students receive the grid through Socket.IO.

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ TEACHER SIDE (Frontend)                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TeacherGameManagementPage.jsx                                     │
│  ├─ Select "A. Crossword" game                                    │
│  ├─ Click "Generate Code" → Creates game_code                    │
│  ├─ Click "Start Game"                                           │
│  │  └─ Calls startGameSession("A. Crossword", gameCode)         │
│  │     └─ Fetches crossword questions from API                 │
│  │     └─ Calls startCrosswordGameAPI(questions)              │
│  │        └─ POST /crossword/start-game                       │
│  │           └─ Sends questions to server                     │
│  └─ Socket listener: crosswordGameStarted                      │
│     └─ Receives grid & displays it on teacher dashboard        │
│                                                                 │
└─────────────────────────────────────────────────────────────────────┘
                            ↓ API & Socket.IO
┌─────────────────────────────────────────────────────────────────────┐
│ BACKEND (Node.js/Express)                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  server.js - Crossword Endpoints:                                 │
│  ├─ GET /crossword/questions                                      │
│  │  └─ Fetches all crossword questions from DB                  │
│  │                                                                │
│  ├─ POST /crossword/questions                                    │
│  │  └─ Adds a single crossword question                         │
│  │                                                                │
│  ├─ PUT /crossword/questions/:id                                │
│  │  └─ Updates a crossword question                            │
│  │                                                                │
│  ├─ DELETE /crossword/questions/:id                             │
│  │  └─ Deletes a crossword question                           │
│  │                                                                │
│  ├─ POST /crossword/questions/upload                            │
│  │  └─ Uploads questions from CSV file                         │
│  │                                                                │
│  ├─ POST /crossword/start-game ⭐ MAIN ENDPOINT                  │
│  │  ├─ Receives crossword questions from teacher              │
│  │  ├─ Calls generateCrosswordGrid() from crosswordgenerate.js│
│  │  ├─ Stores grid in global state:                          │
│  │  │  ├─ crosswordGrid (game grid for students)            │
│  │  │  ├─ crosswordPlacedWords (clues & positions)         │
│  │  │  ├─ crosswordGameSessionId (session tracker)          │
│  │  │  └─ crosswordGameActive (flag)                        │
│  │  └─ Emits "crosswordGameStarted" via Socket.IO to ALL clients
│  │                                                                │
│  └─ GET /crossword/game-status                                  │
│     └─ Returns current crossword game state                     │
│                                                                  │
│  server.js - Socket.IO Events (from students):                  │
│  ├─ socket.on("getCrosswordGame")                              │
│  │  └─ Sends active crossword game to newly connected student │
│  │                                                                │
│  ├─ socket.on("submitCrosswordAnswer")                         │
│  │  ├─ Receives user's completed answers                      │
│  │  ├─ Scores against correct answers                         │
│  │  ├─ Stores in crosswordAnswers map                         │
│  │  ├─ Emits "crosswordResult" to that student               │
│  │  ├─ Broadcasts "crosswordLeaderboard" to all students     │
│  │  └─ Records result in DB (optional)                       │
│  │                                                                │
│  └─ socket.on("endCrosswordGame")                              │
│     └─ Ends the game and broadcasts final leaderboard         │
│                                                                  │
└─────────────────────────────────────────────────────────────────────┘
                            ↓ Socket.IO Events
┌─────────────────────────────────────────────────────────────────────┐
│ STUDENT SIDE (Frontend)                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  GamePage.jsx (or similar student component)                       │
│  ├─ Socket listener: "crosswordGameStarted"                       │
│  │  └─ Receives:                                                  │
│  │     ├─ grid (15x15 grid with letters, black squares)         │
│  │     ├─ words (array of placed words with clues & numbers)   │
│  │     ├─ totalWords (count of words)                          │
│  │     └─ gridSize (15)                                         │
│  │                                                                │
│  ├─ Displays crossword grid in GameUI component                 │
│  │  └─ Shows grid cells with:                                  │
│  │     ├─ Letters (initially empty/hidden)                    │
│  │     ├─ Clue numbers (e.g., 1, 2, 3...)                    │
│  │     ├─ Black squares (blocked cells)                       │
│  │     └─ Input areas for answers                             │
│  │                                                                │
│  ├─ Student solves crossword                                    │
│  │  └─ Fills in answers for each clue                         │
│  │                                                                │
│  ├─ Submits answers                                             │
│  │  └─ Emits: socket.emit("submitCrosswordAnswer", {         │
│  │     user_id, email, display_name, answers })              │
│  │                                                                │
│  ├─ Socket listener: "crosswordResult"                         │
│  │  └─ Receives score, accuracy, and performance              │
│  │                                                                │
│  └─ Socket listener: "crosswordLeaderboard"                    │
│     └─ Receives live leaderboard rankings                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Files Modified/Created

### Backend Changes

#### 1. **server.js** - Added Imports
```javascript
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordgenerate");
```

#### 2. **server.js** - Global State Variables
```javascript
// ----- Crossword Game State -----
let crosswordGameActive = false;
let crosswordGameSessionId = null;
let crosswordGrid = null;
let crosswordClues = null;
let crosswordPlacedWords = null;
let currentCrosswordQuestions = [];
let crosswordAnswers = new Map(); // user_id -> { answers: {}, score: 0 }
```

#### 3. **server.js** - REST API Endpoints Added
- `GET /crossword/questions` - Fetch all questions
- `POST /crossword/questions` - Add question
- `PUT /crossword/questions/:id` - Update question
- `DELETE /crossword/questions/:id` - Delete question
- `POST /crossword/questions/upload` - CSV upload
- `POST /crossword/start-game` - **Start crossword game** (calls generateCrosswordGrid)
- `GET /crossword/game-status` - Get current game state

#### 4. **server.js** - Socket.IO Events Added
- `socket.on("getCrosswordGame")` - Get active game for new connection
- `socket.on("submitCrosswordAnswer")` - Student submits answers
- `socket.on("endCrosswordGame")` - End the game

#### 5. **server.js** - Socket.IO Broadcasts
- `io.emit("crosswordGameStarted")` - Sent when teacher starts game
- `socket.emit("crosswordResult")` - Individual student's score
- `io.emit("crosswordLeaderboard")` - Live rankings
- `io.emit("crosswordGameEnded")` - Final results

### Frontend Changes

#### 1. **TeacherGameManagementPage.jsx**
```javascript
// Added import for new function
import { ..., startCrosswordGame as startCrosswordGameAPI } from "./crosswordteacher";

// Updated startGameSession function
if (gameName === "A. Crossword") {
  const gameResult = await startCrosswordGameAPI(crosswordQuestions);
  // Shows grid size and total words in success message
}
```

#### 2. **crosswordteacher.js** - New Export Function
```javascript
export async function startCrosswordGame(questions) {
  // Calls POST /crossword/start-game
  // Returns grid data to teacher
}
```

---

## Data Flow Sequence

### Step 1: Teacher Generates Game Code
```
Teacher clicks "Generate Code" for "A. Crossword"
  ↓
POST /teacher/games (with game_name: "A. Crossword")
  ↓
Creates game record in DB with unique game_code
  ↓
Returns game code to teacher UI
```

### Step 2: Teacher Starts Game
```
Teacher clicks "Start Game"
  ↓
TeacherGameManagementPage calls startGameSession("A. Crossword", gameCode)
  ↓
Fetches all crossword questions: GET /crossword/questions
  ↓
Calls startCrosswordGame(questions)
  ↓
POST /crossword/start-game with questions in body
  ↓
Server receives request
```

### Step 3: Server Generates Grid
```
Backend /crossword/start-game endpoint executes:
  ├─ Calls generateCrosswordGrid(questions, 15)
  ├─ Grid generation algorithm:
  │  ├─ Fetches questions from DB (via crosswordgenerate.js)
  │  ├─ Extracts answers and clues
  │  ├─ Places first word in center
  │  ├─ Places remaining words with intersections
  │  ├─ Adds black squares for pattern
  │  └─ Creates gameGrid (with some letters revealed)
  ├─ Stores in global state:
  │  ├─ crosswordGrid
  │  ├─ crosswordPlacedWords (with clue numbers)
  │  └─ crosswordGameSessionId
  └─ Returns success response to teacher
```

### Step 4: Emit Grid to Students
```
Server broadcasts via Socket.IO:
  ├─ io.emit("crosswordGameStarted", {
  │  ├─ sessionId: "crossword_XXXXX",
  │  ├─ grid: [[...], [...], ...],
  │  ├─ words: [{number, word, clue, direction, startRow, startCol}, ...],
  │  ├─ totalWords: 12,
  │  └─ gridSize: 15
  │ })
  └─ All connected students receive it
```

### Step 5: Students Solve & Submit
```
Student fills in answers
  ↓
Clicks "Submit"
  ↓
Emits: socket.emit("submitCrosswordAnswer", {
  user_id, email, display_name, answers: {1: "ANSWER", 2: "ANSWER", ...}
})
  ↓
Server scores answers:
  ├─ Compares each answer against correct word
  ├─ Calculates correctCount and accuracy
  ├─ Stores in crosswordAnswers map
  └─ Records in DB (optional)
  ↓
Broadcasts leaderboard to all students
```

---

## Grid Data Structure

### crosswordGrid (15x15)
```javascript
grid[row][col] = {
  letter: "A",           // The letter in this cell
  isBlack: false,        // Is this a black square?
  hasLetter: true,       // Does this cell have a letter?
  number: 1,             // Clue number if word starts here
  acrossWord: 5,         // ID of across word using this cell
  downWord: 12           // ID of down word using this cell
}
```

### crosswordPlacedWords Array
```javascript
[
  {
    id: 5,                           // Question ID
    word: "JAVASCRIPT",              // The answer
    clue: "Programming language",    // The clue
    startRow: 7,                     // Grid position
    startCol: 3,
    direction: "across",             // Direction placed
    length: 10,
    number: 1                        // Clue number displayed to students
  },
  ...
]
```

---

## Student Interface Interaction

### Receiving the Grid
```javascript
socket.on("crosswordGameStarted", (data) => {
  const { grid, words, gridSize } = data;
  // Display grid in GameUI component
  // Show clues from words array
});
```

### Submitting Answers
```javascript
const answers = {
  1: "JAVASCRIPT",    // Clue number -> Answer
  2: "PYTHON",
  3: "CSS",
  ...
};

socket.emit("submitCrosswordAnswer", {
  user_id: "user123",
  email: "student@school.com",
  display_name: "John Doe",
  answers: answers
});
```

### Receiving Score
```javascript
socket.on("crosswordResult", (data) => {
  console.log(`You got ${data.correctAnswers}/${data.totalAnswers} correct!`);
  console.log(`Accuracy: ${data.accuracy}%`);
  console.log(`Score: ${data.score}`);
});
```

---

## How to Use

### For Teachers:

1. **Add Crossword Questions**
   - Go to Teacher Dashboard → Crossword Management
   - Add questions individually OR upload CSV file
   - CSV Format: `question,answer,difficulty`

2. **Start a Crossword Game**
   - Select "A. Crossword" from games list
   - Click "Generate Code" (creates a unique game code)
   - Click "Start Game"
   - Server generates crossword grid automatically
   - Students receive grid via Socket.IO

3. **Monitor Game**
   - See live leaderboard as students submit answers
   - View student accuracy and scores

### For Students:

1. **Join Game**
   - Enter game code on Student Login page
   - Receive crossword grid automatically

2. **Solve Crossword**
   - View grid with numbered clues
   - Fill in answers based on clues
   - Some letters may be pre-revealed (intersections, first letters)

3. **Submit**
   - Click "Submit Answers"
   - See immediate score and accuracy
   - View ranking on leaderboard

---

## Key Integration Points

### 1. Server → crosswordgenerate.js Integration
```javascript
// In server.js
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordgenerate");

// When starting game
const gridResult = generateCrosswordGrid(questions, 15);
crosswordGrid = gridResult.gameGrid;
crosswordPlacedWords = gridResult.placedWords;
```

### 2. Teacher UI → Server Integration
```javascript
// In TeacherGameManagementPage.jsx
const gameResult = await startCrosswordGameAPI(crosswordQuestions);
// gameResult contains grid, words, gridSize
```

### 3. Server → Student UI Integration (Socket.IO)
```javascript
// Server broadcasts when game starts
io.emit("crosswordGameStarted", {
  grid: crosswordGrid,
  words: crosswordPlacedWords,
  ...
});

// Student receives and displays
socket.on("crosswordGameStarted", (data) => {
  // Render grid and clues
});
```

---

## Database Tables Required

```sql
-- Crossword questions
CREATE TABLE crossword_questions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  question TEXT NOT NULL,
  answer VARCHAR(255) NOT NULL,
  difficulty VARCHAR(50) DEFAULT 'Medium',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: Store crossword game results
CREATE TABLE crossword_results (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  session_id VARCHAR(100),
  correct_answers INT,
  total_answers INT,
  accuracy DECIMAL(5,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Testing Checklist

- [ ] Teacher can add crossword questions
- [ ] Teacher can upload crossword CSV
- [ ] Teacher can generate game code for Crossword
- [ ] Teacher can start crossword game
- [ ] Grid is generated (15x15 with proper placements)
- [ ] Grid is broadcasted to all connected students
- [ ] Student receives grid with clues
- [ ] Student can fill in answers
- [ ] Student can submit answers
- [ ] Scoring works correctly
- [ ] Leaderboard updates in real-time
- [ ] Multiple students can play simultaneously
- [ ] Results are recorded in database

---

## Troubleshooting

### Problem: Questions not fetching
**Solution:** Check `/crossword/questions` endpoint is accessible and DB has questions

### Problem: Grid not generating
**Solution:** Ensure questions have valid answers (letters only). Check server console for errors

### Problem: Students not receiving grid
**Solution:** Check Socket.IO connection is established and `crosswordGameStarted` event is being emitted

### Problem: Scoring incorrect
**Solution:** Verify answer comparison logic in `submitCrosswordAnswer` handler matches word structure

---

## Future Enhancements

1. **Timer-based gameplay** - Add countdown timer for crossword solving
2. **Hint system** - Allow students to request hints
3. **Save progress** - Auto-save student answers
4. **Replay mode** - Let teachers review student solutions
5. **Custom grid sizes** - Allow 10x10, 12x12, 15x15, 20x20
6. **Categories** - Organize crossword questions by category
7. **Difficulty weighting** - Adjust scoring based on difficulty

---

