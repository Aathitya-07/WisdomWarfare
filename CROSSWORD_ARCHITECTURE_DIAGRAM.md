# Crossword Game Architecture & Workflow Diagram

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CROSSWORD GAME SYSTEM                           │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │     FRONTEND (React / Port 3000)     │
                    └──────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
            ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
            │  TeacherUI   │  │  GameUI     │  │  StudentUI   │
            │  (Start Game)│  │ (Rendering) │  │  (Playing)   │
            └──────────────┘  └─────────────┘  └──────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                         Socket.IO Connection
                                    │
                    ┌──────────────────────────────────────┐
                    │   BACKEND (Node.js / Port 4001)      │
                    │      Express + Socket.IO             │
                    └──────────────────────────────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
        ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
        │  REST Endpoints  │  │ Socket Event │  │   In-Memory  │
        │  - /start-game   │  │  Handlers    │  │   Sessions   │
        │  - /get-game     │  │              │  │   & Grids    │
        │  - /submit-word  │  │              │  │              │
        └──────────────────┘  └──────────────┘  └──────────────┘
                │                   │                   │
                └───────────────────┼───────────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                ┌──────────────────┐  ┌──────────────────┐
                │  Grid Generator  │  │     Database     │
                │  (crossword      │  │      (MySQL)     │
                │   generate.js)   │  │                  │
                │                  │  │  - Questions     │
                │  - 15x15 Grid    │  │  - Answers       │
                │  - Word Placement│  │  - Game Results  │
                │  - Clue Numbers  │  │  - User Stats    │
                └──────────────────┘  └──────────────────┘
```

---

## 2. Data Flow Diagram - Game Initialization

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     GAME START WORKFLOW                                  │
└─────────────────────────────────────────────────────────────────────────┘

STEP 1: Teacher Starts Game
┌─────────────────────┐
│ TeacherGameMgmtPage │
│   startGameSession()│
└──────────┬──────────┘
           │
           │ POST /crossword/start-game
           ▼
┌──────────────────────────────────────┐
│         Backend Server.js            │
│  1. Fetch questions from DB          │
│  2. Call generateCrosswordGrid()     │
│  3. Transform grid format            │
│  4. Create game session              │
└──────────┬───────────────────────────┘
           │
           │ Data Transformation:
           │ - Cell objects → char array
           │ - Extract clue numbers
           │ - Generate across/down clues
           ▼
STEP 2: Emit Events to All Connected Clients
┌──────────────────────────────────────┐
│      Socket.IO Broadcast              │
│  Event: "crosswordGrid"              │
│  Payload: {                          │
│    grid: 15x15 array,                │
│    cellNumbers: {},                  │
│    acrossClues: [],                  │
│    downClues: []                     │
│  }                                   │
└──────────┬───────────────────────────┘
           │
           │ Broadcast to:
           │ 1. Teacher (confirmation)
           │ 2. All students (game start)
           │ 3. Late joiners (on connect)
           ▼
STEP 3: Frontend Receives & Displays Grid
┌──────────────────────────────────────┐
│       GameUI.js Component            │
│  onCrosswordGrid() listener          │
│                                      │
│  1. Store grid data in state         │
│  2. Initialize cell inputs           │
│  3. Parse clues                      │
│  4. Render 15x15 interactive grid    │
│  5. Display clues below grid         │
└──────────────────────────────────────┘
```

---

## 3. Cell Input & Validation Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  CELL INPUT & VALIDATION WORKFLOW                        │
└─────────────────────────────────────────────────────────────────────────┘

STEP 1: User Types in Cell
┌───────────────────────────────────────┐
│  Student Types Letter in Cell        │
│  (Input field in 15x15 grid)         │
└────────────┬────────────────────────┘
             │
             │ onChange event triggered
             ▼
┌───────────────────────────────────────┐
│  handleCellInput()                    │
│  1. Convert to uppercase              │
│  2. Update cellInputs state           │
│  3. Auto-focus next cell (if filled)  │
└────────────┬────────────────────────┘
             │
             │ Call validateWords()
             ▼
STEP 2: Real-Time Word Validation
┌───────────────────────────────────────┐
│  validateWords(updatedInputs)         │
│                                       │
│  For each clue:                       │
│  1. Extract word from grid            │
│  2. Get cells for that word           │
│  3. Build word from cellInputs        │
│  4. Compare with answer               │
│                                       │
│  IF word.length === clue.length       │
│  AND word === answer (case-insensitive)
│    → Mark as COMPLETED               │
└────────────┬────────────────────────┘
             │
             ▼
STEP 3: Update UI with Visual Feedback
┌────────────────────────────────────────┐
│  setCompletedWords()                   │
│                                        │
│  Update state with completed word IDs  │
└────────────┬─────────────────────────┘
             │
             │ Re-render grid cells
             ▼
STEP 4: Cell Styling Changes
┌────────────────────────────────────────┐
│  Completed Word Cells:                 │
│  ┌──────────────────────────────────┐  │
│  │ Background: bg-green-700          │  │
│  │ Text: text-white                  │  │
│  │ Border: border-green-900          │  │
│  │ Focus: focus:bg-green-600         │  │
│  └──────────────────────────────────┘  │
│                                        │
│  Incomplete Cells:                     │
│  ┌──────────────────────────────────┐  │
│  │ Background: bg-white              │  │
│  │ Text: text-black                  │  │
│  │ Border: border-gray-300           │  │
│  │ Focus: focus:bg-blue-50           │  │
│  └──────────────────────────────────┘  │
└────────────────────────────────────────┘
```

---

## 4. Grid Data Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        GRID DATA STRUCTURE                               │
└─────────────────────────────────────────────────────────────────────────┘

BACKEND GRID (Before Transmission)
─────────────────────────────────────
[
  [
    { letter: 'T', isBlack: false, number: 1, ... },
    { letter: 'R', isBlack: false, number: null, ... },
    { isBlack: true, ... },
    ...
  ],
  [
    { letter: null, isBlack: false, number: 2, ... },
    { letter: null, isBlack: false, ... },
    { isBlack: true, ... },
    ...
  ],
  ...
]

        ↓ TRANSFORMATION LAYER ↓

FRONTEND GRID (After Transmission)
──────────────────────────────────────
gridArray = [
  ['T', 'R', '#', 'A', 'C', ...],
  [' ', ' ', '#', ' ', ' ', ...],
  ['#', '#', '#', '#', '#', ...],
  ...
]

cellNumbers = {
  '0-0': 1,
  '0-3': 2,
  '1-0': 3,
  ...
}

acrossClues = [
  {
    number: 1,
    clue: "First word across",
    answer: "TRACE",
    startRow: 0,
    startCol: 0,
    length: 5,
    direction: "across"
  },
  ...
]

downClues = [
  {
    number: 1,
    clue: "First word down",
    answer: "TRACK",
    startRow: 0,
    startCol: 0,
    length: 5,
    direction: "down"
  },
  ...
]

cellInputs = {
  '0-0': 'T',
  '0-1': 'R',
  '0-3': 'A',
  ...
}

completedWords = [1, 2, 5, 7, ...]  // Array of clue IDs
```

---

## 5. Navigation Flow - User Perspective

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      USER NAVIGATION FLOW                                │
└─────────────────────────────────────────────────────────────────────────┘

TEACHER FLOW:
─────────────
Login
  │
  ▼
StudentLogin / TeacherLogin
  │
  ▼
TeacherGameManagementPage
  │
  ├─ Select Game: "A. Crossword"
  │
  ├─ Click "Start Game"
  │
  └─→ onStartCrosswordGame()
       │
       └─→ POST /crossword/start-game
            │
            └─→ Backend generates grid
                 │
                 └─→ Socket broadcast to all


STUDENT FLOW:
─────────────
Login
  │
  ▼
StudentLogin / WelcomePage
  │
  ├─ Enter Game Code
  │
  ▼
GamePage (GameUI Component)
  │
  ├─ Socket connects
  │
  ├─ Listen for "crosswordGrid" event
  │
  ▼
Grid Receives Data
  │
  ├─ Display 15x15 crossword grid
  ├─ Display clues (ACROSS & DOWN)
  │
  ▼
Student Fills Grid
  │
  ├─ Click cell → input field
  ├─ Type letter → validated in real-time
  ├─ See instant feedback:
  │  ├─ Correct complete word → GREEN ✓
  │  ├─ Incomplete word → WHITE
  │  └─ Black squares → BLACK
  │
  └─→ Continue until puzzle complete
```

---

## 6. Socket.IO Events Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SOCKET.IO EVENTS ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────┘

CLIENT → SERVER (Emit)
─────────────────────────
Event: "joinGame"
Payload: { game_code, user_id }
Purpose: Student joins game session

Event: "crosswordSubmit"
Payload: { game_code, user_id, word, crossword_question_id }
Purpose: Submit word for scoring (optional - for competitive mode)

Event: "crosswordLockWord"
Payload: { game_code, user_id, crossword_question_id, direction }
Purpose: Lock word for collaborative play (optional)


SERVER → CLIENT (Broadcast/Emit)
─────────────────────────────────
Event: "crosswordGrid"
Payload: { grid, cellNumbers, acrossClues, downClues }
Purpose: Send initial puzzle to all students
Triggers: When teacher starts game or student joins late

Event: "crosswordGameStarted"
Payload: { sessionId, grid, clues, cellNumbers }
Purpose: Confirm game started to teacher

Event: "wordSolved"
Payload: { wordId, user, points, timeBonus }
Purpose: Broadcast when word is correctly solved (for leaderboard)

Event: "crosswordWinner"
Payload: { user, score, timestamp }
Purpose: Announce winner when puzzle complete


INTERNAL STATE UPDATES (Frontend)
──────────────────────────────────
State Hook: setCrosswordData()
Updates: grid, cellNumbers, acrossClues, downClues

State Hook: setCellInputs()
Updates: Current user's typed letters in each cell

State Hook: setCompletedWords()
Updates: Array of completed word IDs for green highlighting

State Hook: setLockedWords() [Optional]
Updates: Words locked by users in collaborative mode
```

---

## 7. Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      REACT COMPONENT TREE                                │
└─────────────────────────────────────────────────────────────────────────┘

App (Root)
│
├─ WelcomePage
│
├─ StudentLogin / TeacherLogin
│
├─ TeacherGameManagementPage
│  │
│  └─ startCrosswordGame() 
│     (imports from crosswordteacher.js)
│
├─ GameUI (Main Game Component)
│  │
│  ├─ State Variables:
│  │  ├─ crosswordData { grid, cellNumbers, acrossClues, downClues }
│  │  ├─ cellInputs { '0-0': 'A', '0-1': 'B', ... }
│  │  ├─ completedWords [1, 2, 5, ...]
│  │  ├─ crosswordClues []
│  │  ├─ lockedWords {}
│  │  └─ gameStats { score, correct, total, ... }
│  │
│  ├─ Socket Event Listeners:
│  │  ├─ onCrosswordGrid()
│  │  ├─ onWordSolved()
│  │  ├─ onWordLocked()
│  │  ├─ onCrosswordWinner()
│  │  └─ onCrosswordError()
│  │
│  ├─ Main Functions:
│  │  ├─ handleCellInput() [REAL-TIME INPUT]
│  │  ├─ validateWords() [REAL-TIME VALIDATION]
│  │  ├─ handleKeyDown() [NAVIGATION]
│  │  ├─ getCellLetter()
│  │  └─ renderCrosswordGrid()
│  │
│  └─ Render Output:
│     ├─ Grid Container (15x15)
│     │  └─ Interactive Input Cells
│     │     ├─ Black cells (#000)
│     │     ├─ White cells (editable)
│     │     └─ Completed cells (green)
│     │
│     └─ Clues Section
│        ├─ ACROSS Clues
│        └─ DOWN Clues
```

---

## 8. Complete Game Flow Sequence

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMPLETE GAME FLOW SEQUENCE                           │
└─────────────────────────────────────────────────────────────────────────┘

TIME    ACTOR               ACTION                          STATE
────────────────────────────────────────────────────────────────────────────

T0      Teacher            Logs in                         authenticated
        
T1      Teacher            Navigates to Game Management    game_management
        
T2      Teacher            Selects "A. Crossword"          crossword_selected
        
T3      Teacher            Clicks "Start Game"             ┐
        Backend            - Fetch questions from DB       │
                          - Generate 15x15 grid           ├─ INITIALIZATION
                          - Create game session           │
                          - Transform grid data           │
                          - Emit crosswordGrid event      ┘

T4      Students           Socket receives grid            grid_loaded
                          - Store grid in state
                          - Initialize cellInputs
                          - Parse clues
                          - Display puzzle

T5      Student 1          Types 'T' in cell (0,0)        input_entered
        Frontend           - handleCellInput() called
                          - validateWords() called
                          - completedWords state updated
                          - Grid re-renders

T6      Student 1          Cell turns green (word solved)  word_completed ✓
        
T7      Student 1          Types 'R' in cell (0,1)        input_entered
        Frontend           - Real-time validation
                          - completedWords updated
        
T8      Multiple Students  Fill more cells                 progress_visible
                          - Green highlighting spreads
                          - Clues section shows progress
                          - Competitive scoring (optional)

T9      Last Word Solved   Puzzle complete                 puzzle_complete
        Backend            - Emit crosswordWinner event
        Frontend           - Show winner animation
                          - Display final score
                          - Show completion message

T10     Teacher/Student    Play Again or Exit              game_end
```

---

## 9. Key Files & Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    FILE STRUCTURE & RESPONSIBILITIES                     │
└─────────────────────────────────────────────────────────────────────────┘

BACKEND:
────────
server.js
├─ REST Endpoint: POST /crossword/start-game
├─ REST Endpoint: GET /crossword/game/:id
├─ Socket Event: "connection" + crosswordGrid broadcast
├─ Socket Event: "crosswordSubmit"
├─ Data Transformation Layer
└─ Session Management

crosswordgenerate.js
├─ generateCrosswordGrid(questions, gridSize)
├─ Word Placement Algorithm
├─ Intersection Detection
└─ Returns: cell objects with letters, positions, clue numbers

FRONTEND:
─────────
GameUI.js (MAIN COMPONENT - 1602 lines)
├─ State: crosswordData, cellInputs, completedWords, etc.
├─ validateWords() - Real-time word validation logic
├─ handleCellInput() - Cell input handler
├─ handleKeyDown() - Arrow key navigation
├─ renderCrosswordGrid() - Grid rendering with green highlighting
├─ Socket listeners: onCrosswordGrid, onWordSolved, etc.
└─ UI: Grid (15x15) + Clues (ACROSS/DOWN)

crosswordteacher.js (HELPER API)
├─ startCrosswordGame(gameCode, numQuestions)
├─ fetchCrosswordQuestions()
├─ createCrosswordQuestion()
├─ updateCrosswordQuestion()
└─ deleteCrosswordQuestion()

TeacherGameManagementPage.jsx
├─ Game type detection
├─ Call startGameSession()
├─ Route to appropriate game handler
└─ Display success/error messages
```

---

## 10. Data Validation & Transformation Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│               DATA VALIDATION & TRANSFORMATION PIPELINE                  │
└─────────────────────────────────────────────────────────────────────────┘

DATABASE LAYER
──────────────
Questions Table
│
├─ id, question_text, answer, difficulty, category
│
└─ Selected: numQuestions from category


GENERATION LAYER
────────────────
generateCrosswordGrid(questions)
│
├─ Create 15x15 empty grid
├─ Place words with intersections
├─ Assign clue numbers
├─ Reveal strategic letters (first, last, intersections)
│
└─ Return: {
     gridSize: 15,
     grid: [[cell objects]],
     placedWords: [...]
   }


TRANSFORMATION LAYER
──────────────────────
Transform cell objects to simple format:

Cell Object:
{
  letter: 'T',
  isBlack: false,
  number: 1,
  hasLetter: true,
  acrossWord: 1,
  downWord: 3,
  ...
}

    ↓ TRANSFORM ↓

Grid Array:
'T' = has letter
' ' = empty white cell
'#' = black square


FRONTEND VALIDATION
──────────────────
User Input: 'T' in cell (0,0)

1. Character Validation
   ├─ Uppercase conversion
   ├─ Max 1 character
   └─ Allow only A-Z

2. Word Validation
   ├─ Extract word from grid
   ├─ Compare with answer
   ├─ Case-insensitive comparison
   └─ Complete word check (no gaps)

3. State Update
   ├─ Update cellInputs
   ├─ Call validateWords()
   ├─ Update completedWords
   └─ Trigger re-render

4. UI Update
   ├─ Green highlighting for completed words
   ├─ Focus movement (arrow keys)
   └─ Clue progress updates
```

---

## 11. Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ERROR HANDLING ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────┘

SCENARIO 1: Grid Loading Failure
─────────────────────────────────
Server Error
    │
    └─→ Frontend receives null/empty grid
         │
         └─→ renderCrosswordGrid() shows loading state
              │
              ├─ Display: "Loading Crossword..."
              ├─ Show retry button
              │
              └─→ On Retry: Emit "joinGame" event


SCENARIO 2: Invalid Cell Input
───────────────────────────────
User Input: Invalid character (number, symbol)
    │
    └─→ handleCellInput() validation
         │
         └─→ Only accepts A-Z (automatically uppercase)
              │
              └─→ Invalid input ignored, no state change


SCENARIO 3: Database Connection Error
──────────────────────────────────────
Server tries to fetch questions
    │
    └─→ Database unavailable
         │
         └─→ Server catches error
              │
              └─→ Send error response to frontend
                   │
                   └─→ Display: "Failed to load questions"


SCENARIO 4: Socket Disconnection
─────────────────────────────────
Connection lost during game
    │
    └─→ Socket reconnect attempt
         │
         ├─→ On reconnect: Emit "joinGame" again
         │
         └─→ Server resends current grid state
              │
              └─→ Game continues without data loss
```

This architecture ensures:
✓ Real-time synchronization
✓ Scalability for multiple concurrent games
✓ Data integrity and validation
✓ Responsive user experience
✓ Graceful error handling
