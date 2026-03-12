# CrosswordGenerate.js - Usage & Call Locations

## Overview
`crosswordgenerate.js` contains the core grid generation algorithm for creating crossword puzzles. It's imported and used in several backend files to generate 15x15 crossword grids from database questions.

---

## 📍 Call Locations

### 1. **PRIMARY LOCATION: server.js (Port 4001)**

#### Import Statement (Line 13)
```javascript
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordgenerate");
```

#### Function Call Location: POST /crossword/start-game Endpoint
**File:** `backend/server.js`  
**Line:** 1933  
**Endpoint:** `POST /crossword/start-game`

```javascript
// Line 1925-1945
app.post("/crossword/start-game", async (req, res) => {
  try {
    const { numQuestions, userId } = req.body;

    // 1. Fetch questions from database
    const providedQuestions = await fetchCrosswordQuestions(numQuestions || 20);

    if (!providedQuestions || providedQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No crossword questions provided",
      });
    }

    // 2. GENERATE CROSSWORD GRID ✅
    console.log(`📝 Generating crossword grid with ${providedQuestions.length} questions...`);
    const gridResult = generateCrosswordGrid(providedQuestions, 15);  // ← CALLED HERE

    if (!gridResult.success) {
      return res.status(500).json({
        success: false,
        error: gridResult.error || "Failed to generate crossword grid",
      });
    }

    // 3. Store crossword game state
    crosswordGameActive = true;
    crosswordGameSessionId = `crossword_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    crosswordGrid = gridResult.gameGrid;
    
    // 4. Transform and emit to frontend
    const gridArray = crosswordGrid.map(row => 
      row.map(cell => {
        if (cell.isBlack) return '#';
        return cell.letter || ' ';
      })
    );

    // ... broadcast to clients
  } catch (err) {
    console.error("Error starting crossword game:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
```

**Context:** When a teacher clicks "Start Game" for a crossword:
1. Backend receives request with number of questions
2. Fetches questions from MySQL database
3. **Calls `generateCrosswordGrid()`** to create 15x15 puzzle
4. Transforms grid format for frontend
5. Broadcasts grid via Socket.IO to all students

---

### 2. **SECONDARY LOCATION: server.js Socket Connection**

**File:** `backend/server.js`  
**Line:** 2073  
**Event:** Socket connection for late-joining students

```javascript
// Lines 2070-2090 (Socket.IO connection handler)
socket.on('connection', () => {
  console.log("✅ Socket connected:", socket.id);

  // If active crossword game, send grid to new client
  if (crosswordGameActive && crosswordGrid) {
    console.log(`📤 Sending active crossword game to ${socket.id}`);
    
    // Transform data for frontend compatibility
    const gridArray = crosswordGrid.map(row => 
      row.map(cell => {
        if (cell.isBlack) return '#';
        return cell.letter || ' ';
      })
    );

    // gridResult was already created by generateCrosswordGrid() earlier
    // This just uses the cached result
  }
});
```

**Note:** This doesn't *call* `generateCrosswordGrid()`, but uses its output that was stored when the game started.

---

### 3. **TERTIARY LOCATION: crosswordserver.js (Alternative Implementation)**

**File:** `backend/crosswordserver.js`  
**Lines:** 316, 589, 632

These are alternative/older implementations. Current implementation uses `server.js` above.

```javascript
// Line 316
const crossword = generateCrosswordGrid(questions);

// Line 589
const result = generateCrosswordGrid(questions, size);

// Line 632
const crossword = generateCrosswordGrid(questions);
```

**Note:** These may be deprecated or for testing purposes.

---

## 🔄 Function Signature

```javascript
// File: backend/crosswordgenerate.js
// Line: 61

function generateCrosswordGrid(questions, gridSize = 15) {
  // Parameters:
  // - questions: Array of question objects from database
  // - gridSize: Grid dimension (default 15 for 15x15)
  
  // Returns:
  // {
  //   success: boolean,
  //   gameGrid: [[cell objects]],
  //   placedWords: [...],
  //   gridSize: 15,
  //   error?: string
  // }
}
```

---

## 📊 Exported Functions

```javascript
// crosswordgenerate.js exports:

module.exports = {
  generateCrosswordGrid,      // Creates 15x15 crossword grid
  fetchCrosswordQuestions     // Fetches questions from database
};
```

---

## 🎯 Complete Call Flow

```
TEACHER STARTS GAME
       ↓
TeacherGameManagementPage.jsx
  → startCrosswordGame()
       ↓
POST /crossword/start-game (server.js:1900+)
       ↓
fetchCrosswordQuestions()          ← from crosswordgenerate.js
(Gets questions from MySQL)
       ↓
generateCrosswordGrid()  ✅        ← MAIN CALL - Line 1933
(Creates 15x15 puzzle)
       ↓
Transform Grid Data
(Cell objects → char array)
       ↓
Store in Memory
  crosswordGameActive = true
  crosswordGrid = gridResult.gameGrid
       ↓
Socket.IO Broadcast
  io.emit("crosswordGrid", {...})
       ↓
STUDENTS RECEIVE GRID
       ↓
GameUI.js Component
  onCrosswordGrid() listener
       ↓
Display 15x15 Crossword
```

---

## 📝 Input Example

**Questions Fetched from Database:**
```javascript
[
  {
    id: 1,
    question: "First word clue",
    answer: "TRACE",
    difficulty: "easy"
  },
  {
    id: 2,
    question: "Second word clue",
    answer: "TRACK",
    difficulty: "medium"
  },
  // ... more questions
]
```

---

## 📤 Output Example

**Grid Result from generateCrosswordGrid():**
```javascript
{
  success: true,
  gameGrid: [
    [
      { letter: 'T', isBlack: false, number: 1, hasLetter: true, ... },
      { letter: 'R', isBlack: false, number: null, hasLetter: true, ... },
      { isBlack: true, ... },
      { letter: 'A', isBlack: false, number: 2, hasLetter: true, ... },
      // ... 11 more cells
    ],
    // ... 14 more rows
  ],
  placedWords: [
    {
      word: "TRACE",
      direction: "across",
      startRow: 0,
      startCol: 0,
      number: 1,
      clue: "First word clue",
      length: 5
    },
    // ... more words
  ],
  gridSize: 15
}
```

---

## 🔍 Data Transformation After Generation

After `generateCrosswordGrid()` returns, the grid is transformed:

```javascript
// From: Cell Objects
[
  { letter: 'T', isBlack: false, ... },
  { letter: null, isBlack: false, ... },
  { isBlack: true, ... }
]

// To: Simple Characters for Frontend
['T', ' ', '#']
```

---

## 🚀 Summary

| Aspect | Details |
|--------|---------|
| **Main Call Location** | `backend/server.js` - Line 1933 |
| **Endpoint** | `POST /crossword/start-game` |
| **Trigger** | Teacher clicks "Start Game" |
| **Input** | Array of questions from database |
| **Output** | 15x15 grid with placed words & clues |
| **Usage** | Broadcast to all connected students |
| **File** | `backend/crosswordgenerate.js` |
| **Exported Function** | `generateCrosswordGrid(questions, gridSize)` |

---

## 🎓 How It Works

1. **Question Fetching** → `fetchCrosswordQuestions()` gets random questions
2. **Grid Generation** → `generateCrosswordGrid()` places words with intersections
3. **Number Assignment** → Clue numbers assigned to word start positions
4. **Clue Extraction** → Across/Down clues extracted from placed words
5. **Letter Revelation** → Strategic letters shown (first, last, intersections)
6. **Grid Transformation** → Complex objects converted to simple char array
7. **Socket Broadcast** → Grid sent to all students via WebSocket
8. **Frontend Display** → GameUI.js renders 15x15 interactive grid

The entire process happens in ~1-2 seconds when a teacher starts a game!
