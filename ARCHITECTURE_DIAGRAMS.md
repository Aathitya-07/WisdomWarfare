# Crossword Game Integration - Architecture Diagrams

## System Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          WISDOM WARFARE SYSTEM                               │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐            ┌──────────────────┐     ┌────────────────┐ │
│  │  TEACHER SIDE   │            │   BACKEND/API    │     │  STUDENT SIDE  │ │
│  │   (React)       │            │  (Node.js)       │     │   (React)      │ │
│  └────────┬────────┘            └────────┬─────────┘     └────────┬────────┘ │
│           │                             │                        │          │
│           │ TeacherGameManagement      │                        │          │
│           │ Page.jsx                   │                        │          │
│           │                            │                        │          │
│           ├─ Select "A. Crossword"    │                        │          │
│           ├─ Generate Code             │                        │          │
│           ├─ Start Game                │                        │          │
│           │  │                         │                        │          │
│           │  └─> startGameSession()    │                        │          │
│           │       │                    │                        │          │
│           │       └─> startCrossword   │                        │          │
│           │           GameAPI()        │                        │          │
│           │           │                │                        │          │
│           │           └─POST /crossword/start-game             │          │
│           │                  │         │                        │          │
│           │                  ├────────>│                        │          │
│           │                  │  Endpoint Handler               │          │
│           │                  │  ├─ Validate input             │          │
│           │                  │  ├─ Call generateCrossword     │          │
│           │                  │  │  Grid()                     │          │
│           │                  │  ├─ Store grid in memory      │          │
│           │                  │  └─ io.emit broadcast         │          │
│           │                  │         │                       │          │
│           │<─────────Response────────│                        │          │
│           │  { grid, words,         │                        │          │
│           │    totalWords }          │                        │          │
│           │                          │                        │          │
│           │                          │  io.emit("cross        │          │
│           │                          │  wordGameStarted")     │          │
│           │                          │         │              │          │
│           │                          │         │──────────────>│          │
│           │                          │                 socket │          │
│           │                          │                 broadcast          │
│           │                          │                  │     │          │
│           │                          │                  │ socket.on     │
│           │                          │                  │("crossword   │
│           │                          │                  │GameStarted")│
│           │                          │                  │     │          │
│           │                          │                  │     ├─ Receive│
│           │                          │                  │     │  grid   │
│           │                          │                  │     ├─ Receive│
│           │                          │                  │     │  words  │
│           │                          │                  │     ├─ Render │
│           │                          │                  │     │  UI     │
│           │                          │                  │     │          │
│           │                          │                  │     ├─ Student│
│           │                          │                  │     │  fills  │
│           │                          │                  │     │  answers│
│           │                          │                  │     │          │
│           │                          │                  │     └─ Submit │
│           │                          │                  │        │      │
│           │                          │   socket.emit("submit ─────>│   │
│           │                          │    CrosswordAnswer")   │      │   │
│           │                          │              │         │      │   │
│           │                          │         Handler:       │      │   │
│           │                          │    ├─ Get answers     │      │   │
│           │                          │    ├─ Score each     │      │   │
│           │                          │    ├─ Calculate      │      │   │
│           │                          │    │  accuracy       │      │   │
│           │                          │    └─ Broadcast     │      │   │
│           │                          │       leaderboard    │      │   │
│           │                          │           │          │      │   │
│           │                          │           │   socket.emit("  │   │
│           │                          │           │   crosswordResult")
│           │                          │           │          │      │   │
│           │                          │           │          └─────>│   │
│           │                          │           │                  │   │
│           │                          │           │  io.emit("cross  │   │
│           │                          │           │  wordLeaderboard")    │
│           │                          │           │          │      │   │
│           │                          │           └─────────────────>│   │
│           │                          │                      │      │   │
│           │                          │ socket.on("cross    │      │   │
│           │                          │ wordLeaderboard")   │      │   │
│           │<─────────────────────────┼──────────────────────┤      │   │
│           │ Broadcast to            │                      │      │   │
│           │ teacher also            │                      │      │   │
│           │ (live scores)            │                      │      │   │
│           │                          │                      │      │   │
│  ┌────────┴──────────────────────────┴──────────────────────┴──────┴────┐  │
│  │              DATABASE (MySQL)                                         │  │
│  │  ├─ crossword_questions                                              │  │
│  │  ├─ crossword_results (optional)                                    │  │
│  │  └─ teacher_games                                                    │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Interaction Flowchart

```
START: Teacher Clicks "Start Game" for Crossword
│
├─> TeacherGameManagementPage.jsx
│   │
│   ├─ Check game code exists
│   │
│   ├─ Fetch crossword questions
│   │   GET /crossword/questions
│   │   ↓ Response: [questions...]
│   │
│   └─ Call startCrosswordGame(questions)
│       [from crosswordteacher.js]
│       │
│       └─ POST /crossword/start-game
│           Request Body: { questions: [...] }
│           │
│           ├─────────────────────────────────>
│           │
│           │   SERVER: /crossword/start-game endpoint
│           │   │
│           │   ├─ Receive questions
│           │   │
│           │   ├─ Call generateCrosswordGrid(questions, 15)
│           │   │   [from crosswordgenerate.js]
│           │   │   │
│           │   │   ├─ Fetch questions from DB
│           │   │   ├─ Extract answers & clues
│           │   │   ├─ Place first word (center)
│           │   │   ├─ Find intersections
│           │   │   ├─ Place remaining words
│           │   │   ├─ Add black squares
│           │   │   └─ Create gameGrid
│           │   │
│           │   ├─ Store in global state:
│           │   │   - crosswordGrid
│           │   │   - crosswordPlacedWords
│           │   │   - crosswordGameSessionId
│           │   │   - crosswordGameActive = true
│           │   │
│           │   ├─ io.emit("crosswordGameStarted", {
│           │   │   sessionId,
│           │   │   grid,
│           │   │   words,
│           │   │   totalWords,
│           │   │   gridSize
│           │   │ })
│           │   │ │
│           │   │ └─ Broadcasts to ALL connected sockets
│           │   │
│           │   └─ Return response to teacher
│           │
│           └─ Teacher receives response
│               { success, grid, words, totalWords, gridSize }
│               │
│               └─ Show success message
│
├─ SIMULTANEOUSLY: Students receive grid
│  │
│  ├─> Socket.IO "crosswordGameStarted" event
│  │   │
│  │   ├─> GamePage.jsx (or student component)
│  │       │
│  │       ├─ socket.on("crosswordGameStarted", (data) => {})
│  │       │
│  │       ├─ Store grid data
│  │       │
│  │       ├─ Render crossword grid
│  │       │   GameUI component displays:
│  │       │   ├─ 15x15 grid
│  │       │   ├─ Clue numbers
│  │       │   ├─ Black squares
│  │       │   └─ Input areas
│  │       │
│  │       └─ Show clue list
│  │
│  └─ Students can now see & interact with crossword
│
├─ STUDENT FLOW: Solve & Submit
│  │
│  ├─ Student fills in answers
│  │
│  ├─ Student clicks "Submit"
│  │   │
│  │   └─ socket.emit("submitCrosswordAnswer", {
│  │       user_id,
│  │       email,
│  │       display_name,
│  │       answers: { 1: "ANSWER", 2: "WORD", ... }
│  │     })
│  │
│  ├─ SERVER: socket.on("submitCrosswordAnswer")
│  │   │
│  │   ├─ Get student answers
│  │   │
│  │   ├─ Loop through crosswordPlacedWords
│  │   │   For each word:
│  │   │   ├─ Get student answer for that clue number
│  │   │   ├─ Compare with correct word
│  │   │   └─ Count if correct
│  │   │
│  │   ├─ Calculate:
│  │   │   - correctCount
│  │   │   - totalAnswers
│  │   │   - accuracy = (correctCount / totalAnswers) * 100
│  │   │
│  │   ├─ Store in crosswordAnswers map
│  │   │
│  │   ├─ socket.emit("crosswordResult", {
│  │   │   success: true,
│  │   │   correctAnswers,
│  │   │   totalAnswers,
│  │   │   accuracy,
│  │   │   score: correctCount
│  │   │ })  [To that student only]
│  │   │
│  │   ├─ io.emit("crosswordLeaderboard", [
│  │   │   { user_id, score, total, accuracy },
│  │   │   ...
│  │   │ ])  [To ALL connected clients]
│  │   │
│  │   └─ [Optional] Record in database
│  │
│  ├─ Student receives:
│  │   socket.on("crosswordResult")
│  │   ├─ Display score
│  │   ├─ Display accuracy %
│  │   └─ Show correct vs incorrect
│  │
│  └─ All clients receive:
│      socket.on("crosswordLeaderboard")
│      ├─ Update leaderboard display (real-time)
│      └─ Show rankings and scores
│
└─ END: Game continues until teacher ends it

```

---

## Data Structure Diagram

### Grid Structure (15x15 Array)
```
crosswordGrid = [
  [
    { letter: "A", isBlack: false, hasLetter: true, number: 1, acrossWord: 5, downWord: 12 },
    { letter: "", isBlack: false, hasLetter: false, number: 0, acrossWord: 5, downWord: 0 },
    { letter: "", isBlack: true, hasLetter: false, number: 0, acrossWord: 0, downWord: 0 },
    ...
  ],
  [
    { letter: "B", isBlack: false, hasLetter: true, number: 0, acrossWord: 8, downWord: 0 },
    ...
  ],
  ...
]
```

### Placed Words Array
```
crosswordPlacedWords = [
  {
    id: 5,                    // Question ID from DB
    word: "JAVASCRIPT",       // The answer (uppercase)
    clue: "Programming lang",  // The question/clue
    startRow: 7,              // Grid position
    startCol: 3,
    direction: "across",      // "across" or "down"
    length: 10,               // Length of word
    number: 1                 // Clue number shown to students
  },
  {
    id: 8,
    word: "PYTHON",
    clue: "Snake-like language",
    startRow: 7,
    startCol: 10,
    direction: "down",
    length: 6,
    number: 2
  },
  ...
]
```

### Student Answers Format
```
{
  "1": "JAVASCRIPT",     // Clue number -> Student's answer
  "2": "PYTHON",
  "3": "CSS",
  "4": "HTML",
  ...
}
```

### Leaderboard Structure
```
[
  {
    user_id: "user123",
    email: "student@school.com",
    display_name: "John Doe",
    score: 10,              // Number of correct answers
    total: 12,              // Total words
    accuracy: "83.3"        // Percentage
  },
  {
    user_id: "user456",
    email: "student2@school.com",
    display_name: "Jane Smith",
    score: 8,
    total: 12,
    accuracy: "66.7"
  },
  ...
]
```

---

## Request/Response Examples

### 1. Teacher Starts Game

**Request:**
```
POST /crossword/start-game
Content-Type: application/json

{
  "game_code": "ABC123",
  "questions": [
    {
      "id": 1,
      "question": "Programming language created by Guido van Rossum",
      "answer": "PYTHON",
      "difficulty": "Easy"
    },
    {
      "id": 2,
      "question": "Front-end programming language",
      "answer": "JAVASCRIPT",
      "difficulty": "Medium"
    },
    ...
  ]
}
```

**Response:**
```
{
  "success": true,
  "message": "Crossword game started successfully",
  "sessionId": "crossword_1234567890_abc123",
  "gridSize": 15,
  "totalWords": 12,
  "grid": [
    [
      { "letter": "P", "isBlack": false, "hasLetter": true, "number": 1, ... },
      ...
    ],
    ...
  ],
  "words": [
    {
      "id": 1,
      "word": "PYTHON",
      "clue": "Programming language created by Guido van Rossum",
      "startRow": 7,
      "startCol": 3,
      "direction": "across",
      "length": 6,
      "number": 1
    },
    ...
  ]
}
```

### 2. Student Submits Answers

**Socket Emit:**
```javascript
socket.emit("submitCrosswordAnswer", {
  user_id: "user123",
  email: "student@school.com",
  display_name: "John Doe",
  answers: {
    1: "PYTHON",
    2: "JAVASCRIPT",
    3: "CSS",
    4: "HTML",
    5: "DATABASE",
    6: "SERVER",
    7: "CLIENT",
    8: "REQUEST",
    9: "RESPONSE",
    10: "BROWSER",
    11: "SOCKET",
    12: "CODING"
  }
})
```

**Socket Response (to student):**
```javascript
socket.on("crosswordResult", {
  success: true,
  correctAnswers: 10,
  totalAnswers: 12,
  accuracy: "83.3",
  score: 10
})
```

**Socket Broadcast (to all):**
```javascript
io.on("crosswordLeaderboard", [
  {
    user_id: "user123",
    score: 10,
    total: 12,
    accuracy: "83.3"
  },
  {
    user_id: "user456",
    score: 8,
    total: 12,
    accuracy: "66.7"
  }
])
```

---

## File Dependencies

```
backend/
├─ server.js
│  ├─ Imports: crosswordgenerate.js
│  ├─ Uses: generateCrosswordGrid()
│  ├─ Uses: fetchCrosswordQuestions()
│  ├─ Creates: REST endpoints
│  ├─ Creates: Socket.IO handlers
│  └─ Emits: Broadcasting events
│
├─ crosswordgenerate.js
│  ├─ Exports: generateCrosswordGrid()
│  ├─ Exports: fetchCrosswordQuestions()
│  ├─ Logic: Grid generation algorithm
│  └─ DB: Query crossword_questions table
│
└─ package.json
   ├─ Dependencies: express, socket.io, mysql2, etc.

frontend/
├─ src/TeacherGameManagementPage.jsx
│  ├─ Imports: crosswordteacher.js functions
│  ├─ Uses: startCrosswordGame()
│  ├─ Calls: startGameSession()
│  └─ Displays: Game management UI
│
├─ src/crosswordteacher.js
│  ├─ Exports: startCrosswordGame()
│  ├─ Exports: fetchCrosswordQuestions()
│  ├─ Exports: Other helpers
│  └─ Calls: Server API endpoints
│
├─ src/GamePage.jsx (or student component)
│  ├─ Listens: socket.on("crosswordGameStarted")
│  ├─ Listens: socket.on("crosswordResult")
│  ├─ Listens: socket.on("crosswordLeaderboard")
│  ├─ Emits: socket.emit("submitCrosswordAnswer")
│  └─ Displays: Grid and leaderboard
│
└─ src/components/GameUI/
   └─ Renders: Crossword grid
```

---

## State Management

### Server Global State
```javascript
let crosswordGameActive = false;        // Is game running?
let crosswordGameSessionId = null;      // Unique session ID
let crosswordGrid = null;               // 15x15 grid for display
let crosswordPlacedWords = null;        // Word placements
let currentCrosswordQuestions = [];      // Questions used
let crosswordAnswers = new Map();       // user_id -> {answers, score}
```

### Socket Connection Flow
```
Client connects
  ├─ socket.on("connection")
  │
  ├─ Server checks if game active
  │
  ├─ If active:
  │  └─ io.emit("crosswordGameStarted", grid)
  │
  └─ Client ready to receive events
```

---

## Timeline: Complete Game Lifecycle

```
T0: SETUP PHASE
   ├─ Teacher adds crossword questions to DB
   └─ Teacher uploads questions via CSV

T1: GAME START
   ├─ Teacher selects "A. Crossword"
   ├─ Teacher generates game code
   ├─ Teacher clicks "Start Game"
   ├─ Server calls generateCrosswordGrid()
   ├─ Grid generated (5-10 seconds typically)
   ├─ Grid stored in memory
   └─ io.emit("crosswordGameStarted") to ALL students

T2: STUDENT RECEIVES
   ├─ All connected students get grid
   ├─ Students see 15x15 crossword with clues
   ├─ Some letters pre-revealed (hints)
   └─ Students can start solving

T3: STUDENT PLAYS
   ├─ Students fill in answers
   ├─ UI validates entry (optional)
   └─ Students can change answers

T4: STUDENT SUBMITS
   ├─ Student clicks "Submit"
   ├─ socket.emit("submitCrosswordAnswer")
   ├─ Server scores immediately
   ├─ Server broadcasts leaderboard
   ├─ Student receives score
   └─ Student sees ranking

T5: GAME ENDS (Teacher decision)
   ├─ Teacher clicks "End Game"
   ├─ socket.emit("endCrosswordGame")
   ├─ io.emit("crosswordGameEnded")
   ├─ Final leaderboard broadcast
   ├─ crosswordGameActive = false
   └─ Game over

T6: CLEANUP
   ├─ Clear grid from memory
   ├─ Clear crosswordAnswers map
   └─ Ready for next game
```

---

