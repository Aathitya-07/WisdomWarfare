require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const mysql = require("mysql2/promise");
const { Server } = require("socket.io");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const nodemailer = require("nodemailer");
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordGrid");

const app = express();

// ----- CORS -----
const corsOptions = {
  origin: (origin, callback) => {
    callback(null, true);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

// ----- SERVER PORT -----
const DEFAULT_PORT = parseInt(process.env.CROSSWORD_PORT || "4002", 10);
let SERVER_PORT = DEFAULT_PORT;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ----- DB -----
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "root",
  database: process.env.DB_NAME || "wisdomwarfare",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ==========================================
// ----- GLOBAL CROSSWORD STATE -----
// ==========================================

const crosswordSessions = new Map(); // sessionId -> { grid, clues, solvedWords, solvedUsers, gameCode, startTime, gameEndTime, totalWords, winners }
const crosswordGameStatus = new Map(); // game_code -> { started: false, sessionId: null, gameSessionId: null }
const crosswordLocks = new Map(); // sessionId -> Map(user_id -> crossword_question_id)
const leaderboardTimers = new Map(); // game_code -> timeout ID for debounced broadcasts
const gameSessions = new Map(); // game_code -> { gameSessionId, startTime, gameEndTime, players, gameState, totalWords, winners }
const gameTimers = new Map(); // game_code -> { timeRemaining, timerInterval }

// ==========================================
// ----- HELPERS -----
// ==========================================

function generateCrosswordSessionId() {
  return `crossword_${Date.now()}_${Math.random()
    .toString(36)
    .substring(2, 8)}`;
}

function generateShortGameCode(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++)
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// ----- Multer -----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ✅ Live Leaderboard Helper Functions (from Wisdom Warfare pattern)

function scheduleCrosswordLeaderboardBroadcast(game_code, gameSessionId) {
  if (!game_code || !gameSessionId) return;
  
  // If timer already running for this game, don't schedule another
  if (leaderboardTimers.has(game_code)) return;
  
  // Schedule broadcast after 500ms debounce window
  leaderboardTimers.set(game_code, setTimeout(async () => {
    leaderboardTimers.delete(game_code);
    
    try {
      const [leaderboard] = await pool.query(
        `SELECT 
          ll.user_id,
          ll.current_score as score,
          ll.accuracy,
          ll.correct_answers,
          ll.questions_answered as attempts,
          COALESCE(u.display_name, u.name, u.email, CONCAT('Player_', ll.user_id)) as display_name,
          u.email,
          u.name
        FROM live_leaderboard ll
        LEFT JOIN users u ON ll.user_id = u.user_id
        WHERE ll.game_session_id = ?
        ORDER BY ll.current_score DESC, ll.accuracy DESC
        LIMIT 10`,
        [gameSessionId]
      );
      
      // ✅ Emit to crosswordLeaderboardUpdate event for proper frontend handling
      const roomName = `game_${game_code}`;
      io.to(roomName).emit("crosswordLeaderboardUpdate", leaderboard);
      console.log(`📊 Broadcast crossword leaderboard to ${roomName}: ${leaderboard.length} players`);
      
      // Also emit to general leaderboardUpdate for backward compatibility
      io.to(roomName).emit("leaderboardUpdate", leaderboard);
    } catch (err) {
      console.error("⚠️ Error fetching leaderboard:", err.message);
    }
  }, 500));
}

// ==========================================
// ----- CROSSWORD API ROUTES -----
// ==========================================

app.get("/", (req, res) => {
  res.json({
    message: "Crossword Game Backend Running! 🧩",
    status: "healthy",
    activeSessions: crosswordSessions.size,
  });
});

app.get("/crossword/questions", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, question, answer, difficulty
      FROM crossword_questions
      ORDER BY 
        CASE difficulty
          WHEN 'Easy' THEN 1
          WHEN 'Medium' THEN 2
          WHEN 'Hard' THEN 3
        END,
        id
    `);

    res.json({
      success: true,
      questions: rows,
    });
  } catch (err) {
    console.error("GET /crossword/questions error:", err);
    res.status(500).json({
      success: false,
      questions: [],
    });
  }
});

// Seed crossword questions if table is empty
app.post("/crossword/seed-questions", async (req, res) => {
  try {
    // Check if questions already exist
    const [existing] = await pool.query(`SELECT COUNT(*) as count FROM crossword_questions`);
    if (existing[0].count > 0) {
      return res.json({
        success: true,
        message: "Crossword questions already seeded",
        count: existing[0].count
      });
    }

    // Sample crossword questions for seeding
    const sampleQuestions = [
      { question: "A sequence of characters with a collective meaning", answer: "TOKEN", difficulty: "Easy" },
      { question: "Data structure used to store information about identifiers", answer: "SYMBOLTABLE", difficulty: "Medium" },
      { question: "Phase that checks for grammatical errors", answer: "SYNTAX", difficulty: "Easy" },
      { question: "Tree representation of the abstract syntactic structure", answer: "AST", difficulty: "Medium" },
      { question: "A grammar that produces more than one parse tree for a string", answer: "AMBIGUOUS", difficulty: "Medium" },
      { question: "Process of improving code efficiency without changing output", answer: "OPTIMIZATION", difficulty: "Medium" },
      { question: "Bottom-up parsing is also called ____-reduce parsing", answer: "SHIFT", difficulty: "Hard" },
      { question: "Tool used to generate lexical analyzers", answer: "LEX", difficulty: "Medium" },
      { question: "Tool used to generate parsers", answer: "YACC", difficulty: "Medium" },
      { question: "Type checking occurs during this analysis phase", answer: "SEMANTIC", difficulty: "Easy" },
      { question: "Intermediate code often uses _____ address code", answer: "THREE", difficulty: "Hard" },
      { question: "Converts assembly language to machine code", answer: "ASSEMBLER", difficulty: "Easy" },
      { question: "Removing code that is never executed", answer: "DEADCODE", difficulty: "Medium" },
      { question: "Top-down parser that backtracks when a production fails", answer: "TOPDOWN", difficulty: "Hard" },
      { question: "Parser that processes input from bottom to top", answer: "BOTTOMUP", difficulty: "Hard" },
      { question: "LR parser that uses lookahead", answer: "LRPARSING", difficulty: "Hard" },
      { question: "Analyzing source code to find issues before runtime", answer: "LEXICAL", difficulty: "Medium" },
      { question: "When two signals interact constructively or destructively", answer: "INTERFERENCE", difficulty: "Medium" },
      { question: "Grammar type without recursion restrictions", answer: "CONTEXTFREE", difficulty: "Hard" },
      { question: "When parse is possible from right to left", answer: "REDUCERDUCE", difficulty: "Hard" },
      { question: "Study of how symbols relate to objects", answer: "SEMANTIC", difficulty: "Medium" },
      { question: "Expression that doesn't change like integer or string", answer: "INVARIANT", difficulty: "Hard" },
      { question: "Intermediate representation with 3 operands", answer: "THREEADDRESS", difficulty: "Hard" }
    ];

    // Insert all questions
    let inserCount = 0;
    for (const q of sampleQuestions) {
      try {
        await pool.query(
          `INSERT INTO crossword_questions (question, answer, difficulty) VALUES (?, ?, ?)`,
          [q.question, q.answer, q.difficulty]
        );
        inserCount++;
      } catch (e) {
        console.warn(`Failed to insert "${q.answer}":`, e.message);
      }
    }

    res.json({
      success: true,
      message: `Seeded ${inserCount} crossword questions`,
      count: inserCount
    });
  } catch (err) {
    console.error("POST /crossword/seed-questions error:", err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post("/crossword/questions", async (req, res) => {
  const { question, answer, difficulty = "Medium" } = req.body;

  if (!question || !answer) {
    return res.status(400).json({
      success: false,
      error: "Question and answer are required",
    });
  }

  try {
    const [result] = await pool.query(
      `
      INSERT INTO crossword_questions (question, answer, difficulty)
      VALUES (?, ?, ?)
      `,
      [question.trim(), answer.trim(), difficulty]
    );

    res.json({
      success: true,
      id: result.insertId,
    });
  } catch (err) {
    console.error("POST /crossword/questions error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Update crossword question
app.put("/crossword/questions/:id", async (req, res) => {
  const { id } = req.params;
  const { question, answer, difficulty = "Medium" } = req.body;

  if (!question || !answer) {
    return res.status(400).json({ error: "Question and answer are required" });
  }

  try {
    const [result] = await pool.query(
      `
      UPDATE crossword_questions
      SET question = ?, answer = ?, difficulty = ?
      WHERE id = ?
      `,
      [question.trim(), answer.trim(), difficulty, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Crossword question not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Update crossword error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete crossword question
app.delete("/crossword/questions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      "DELETE FROM crossword_questions WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Crossword question not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete crossword error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Upload crossword questions CSV
app.post("/crossword/questions/upload", upload.single("file"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const rows = [];
    let inserted = 0;
    const errors = [];

    await connection.beginTransaction();

    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csv())
        .on("data", (data) => rows.push(data))
        .on("end", resolve)
        .on("error", reject);
    });

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const question = r.question || r.Question;
      const answer = r.answer || r.Answer;
      const difficulty = r.difficulty || "Medium";

      if (!question || !answer) {
        errors.push(`Row ${i + 1}: Missing question or answer`);
        continue;
      }

      await connection.query(
        `
        INSERT INTO crossword_questions (question, answer, difficulty)
        VALUES (?, ?, ?)
        `,
        [question.trim(), answer.trim(), difficulty]
      );

      inserted++;
    }

    await connection.commit();
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      inserted,
      total: rows.length,
      errors,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Upload crossword CSV error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// Create new crossword game
app.post("/crossword/create-game", async (req, res) => {
  const { teacher_id } = req.body;

  if (!teacher_id) {
    return res.status(400).json({ error: "teacher_id required" });
  }

  try {
    // Generate unique game code
    let game_code = generateShortGameCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      const [[existing]] = await pool.query(
        "SELECT id FROM teacher_games WHERE game_code = ?",
        [game_code]
      );
      if (!existing) {
        isUnique = true;
      } else {
        game_code = generateShortGameCode();
        attempts++;
      }
    }

    if (!isUnique) {
      return res.status(500).json({ error: "Failed to generate unique game code" });
    }

    // Create new game
    const [result] = await pool.query(
      "INSERT INTO teacher_games (teacher_id, game_name, game_code) VALUES (?, ?, ?)",
      [teacher_id, `Crossword Game - ${new Date().toLocaleString()}`, game_code]
    );

    res.json({
      success: true,
      game_code,
      game_id: result.insertId,
      message: `Game code: ${game_code}`
    });
  } catch (err) {
    console.error("Create game error:", err);
    res.status(500).json({ error: "Failed to create game" });
  }
});

// Start crossword game
app.post("/crossword/start-game", async (req, res) => {
  const { game_code } = req.body;
  
  if (!game_code) {
    return res.status(400).json({ error: "game_code required" });
  }

  try {
    console.log(`🚀 START-GAME ENDPOINT: Teacher starting crossword game: ${game_code}`);

    // Verify game exists
    const [[game]] = await pool.query(
      "SELECT * FROM teacher_games WHERE game_code = ?",
      [game_code]
    );

    if (!game) {
      return res.status(404).json({ error: "Invalid crossword code" });
    }

    const roomName = `game_${game_code}`;
    let session = gameSessions.get(game_code);
    
    // If no session exists (no players joined yet), create one
    if (!session) {
      const gameSessionId = generateCrosswordSessionId();
      session = {
        gameSessionId,
        game_type: "Crossword",
        game_name: game.game_name || "Crossword Game",
        state: "WAITING_FOR_TEACHER",
        started: false,
        players: new Map(),
        startTime: null,
        grid: null,
        clues: null
      };
      gameSessions.set(game_code, session);
      console.log(`✅ Created new session for game: ${game_code}, ID: ${gameSessionId}`);
    }

    // ✅ Fetch ALL questions dynamically with random selection
    const questions = await fetchCrosswordQuestions(20);

    if (!questions || questions.length === 0) {
      return res.status(400).json({ error: "No crossword questions available" });
    }

    // ✅ Generate crossword grid (creates DIFFERENT grid each time)
    const crossword = generateCrosswordGrid(questions);

    // DEBUG: Verify grid quality
    if (crossword.grid && crossword.grid.length > 0) {
      console.log(`🎯 GRID QUALITY:`);
      console.log(`   Density: ${crossword.density}%`);
      console.log(`   White Cells: ${crossword.whiteCells}, Black Cells: ${crossword.blackCells}`);
      console.log(`   First row: [${crossword.grid[0].slice(0, 5).map(c => `"${c}"`).join(', ')}]`);
    }

    // ✅ Update session
    session.state = "ACTIVE";
    session.started = true;
    session.startTime = Date.now();
    session.gameEndTime = session.startTime + (5 * 60 * 1000); // 5 minute game limit
    session.grid = crossword.grid;
    session.clues = crossword.clues;
    session.totalWords = crossword.placedWords ? crossword.placedWords.length : 0;
    session.winners = []; // Track winners in order

    // Store for reference
    const sessionData = {
      grid: crossword.grid,
      clues: crossword.clues,
      letters: crossword.letters,
      solvedWords: new Set(),
      solvedUsers: new Map(),
      gameCode: game_code,
      gameSessionId: session.gameSessionId,
      startTime: session.startTime,
      gameEndTime: session.gameEndTime,
      placedWords: crossword.placedWords,
      totalWords: session.totalWords,
      winners: [], // Track first completions: [{ user_id, time, score }]
      playerCompletionTime: new Map() // Track when each player completed all words
    };
    crosswordSessions.set(session.gameSessionId, sessionData);

    console.log(`✅ Crossword grid generated with ${questions.length} questions`);
    console.log(`⏱️ Game duration: 5 minutes (until ${new Date(session.gameEndTime).toISOString()})`);
    console.log(`📋 Total words to complete: ${session.totalWords}`);

    // ✅ Broadcast gameStarted event to all players in the room
    io.to(roomName).emit("gameStarted", {
      game_code,
      gameSessionId: session.gameSessionId,
      message: "Crossword game is starting now!",
      gameStartTime: session.startTime,
      gameEndTime: session.gameEndTime,
      gameDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
      totalWords: session.totalWords,
      totalClues: session.clues ? (session.clues.across ? session.clues.across.length : 0) + (session.clues.down ? session.clues.down.length : 0) : 0
    });
    console.log(`📢 Broadcasted gameStarted to room: ${roomName}`);

    // ✅ Broadcast crosswordGrid to all players
    io.to(roomName).emit("crosswordGrid", {
      game_code,
      grid: crossword.grid,
      clues: crossword.clues,
      cellNumbers: crossword.cellNumbers || {},
      placedWords: crossword.placedWords || []
    });
    console.log(`📢 Broadcasted crosswordGrid to room: ${roomName}`);

    // ✅ Initialize live_leaderboard for all players
    const connection = await pool.getConnection();
    try {
      if (session.players.size > 0) {
        for (const [user_id, playerData] of session.players) {
          await connection.query(
            `
            INSERT INTO live_leaderboard 
              (user_id, game_session_id, game_type, game_name, current_score, questions_answered, correct_answers, accuracy)
            VALUES (?, ?, ?, ?, 0, 0, 0, 0)
            ON DUPLICATE KEY UPDATE 
              current_score = 0, 
              questions_answered = 0, 
              correct_answers = 0, 
              accuracy = 0
            `,
            [user_id, session.gameSessionId, "Crossword", session.game_name]
          );
        }
        console.log(`✅ Initialized live_leaderboard for ${session.players.size} players`);
        
        // ✅ Broadcast initial leaderboard with all 0 scores
        try {
          const [initialLeaderboard] = await connection.query(
            `SELECT 
               ll.user_id,
               ll.current_score as score,
               ll.accuracy,
               ll.correct_answers,
               ll.questions_answered as attempts,
               COALESCE(u.display_name, u.name, u.email, CONCAT('Player_', ll.user_id)) as display_name,
               u.email,
               u.name
             FROM live_leaderboard ll
             LEFT JOIN users u ON ll.user_id = u.user_id
             WHERE ll.game_session_id = ?
             ORDER BY ll.current_score DESC, ll.accuracy DESC`,
            [session.gameSessionId]
          );
          io.to(roomName).emit("crosswordLeaderboardUpdate", initialLeaderboard);
          console.log(`📊 Broadcasted initial leaderboard with ${initialLeaderboard.length} players`);
        } catch (leaderboardBroadcastErr) {
          console.warn("⚠️ Error broadcasting initial leaderboard:", leaderboardBroadcastErr.message);
        }
      }
    } catch (leaderboardErr) {
      console.warn("⚠️ Leaderboard init warning:", leaderboardErr.message);
    } finally {
      connection.release();
    }

    res.json({ 
      success: true, 
      message: `Crossword game ${game_code} started for ${session.players.size} players`,
      gameSessionId: session.gameSessionId,
      gridSize: crossword.gridSize,
      totalWords: crossword.placedWords ? crossword.placedWords.length : 0,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Crossword start error:", err);
    res.status(500).json({ error: "Failed to start crossword game", details: err.message });
  }
});

// ✅ DEBUG ENDPOINT: Check game status
app.get("/crossword/game-status/:gameCode", async (req, res) => {
  const { gameCode } = req.params;
  
  try {
    const session = gameSessions.get(gameCode);
    
    res.json({
      game_code: gameCode,
      session_exists: !!session,
      session_state: session?.state || "NONE",
      players_joined: session?.players?.size || 0,
      game_active: session?.state === "ACTIVE",
      room_name: `game_${gameCode}`,
      rooms: Array.from(io.of("/").sockets.adapter.rooms.keys()).filter(r => r.includes(gameCode))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crossword submit answer
app.post("/crossword/submit-answer", async (req, res) => {
  const {
    user_id,
    crossword_question_id,
    user_answer,
    game_session_id,
  } = req.body;

  if (!user_id || !crossword_question_id || !game_session_id) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check for duplicate answer
    const [exists] = await connection.query(
      `
      SELECT 1 FROM crossword_answers
      WHERE user_id = ?
        AND crossword_question_id = ?
        AND game_session_id = ?
      `,
      [user_id, crossword_question_id, game_session_id]
    );

    if (exists.length > 0) {
      await connection.rollback();
      return res.json({
        success: false,
        error: "Already answered",
      });
    }

    // Get correct answer
    const [[q]] = await connection.query(
      `SELECT answer FROM crossword_questions WHERE id = ?`,
      [crossword_question_id]
    );

    const isCorrect =
      q &&
      user_answer &&
      q.answer.trim().toLowerCase() === user_answer.trim().toLowerCase();

    // Check session for bonus points
    const session = crosswordSessions.get(game_session_id);
    let points = isCorrect ? 10 : 0;
    
    if (isCorrect && session) {
      const isFirst = !session.solvedWords.has(crossword_question_id);
      
      // Time-based bonus calculation
      const elapsed = Date.now() - session.startTime;
      let timeBonus = 0;
      if (elapsed < 30000) timeBonus = 5;
      else if (elapsed < 60000) timeBonus = 3;
      
      if (isFirst) {
        points = 15 + timeBonus;
        session.solvedWords.add(crossword_question_id);
      } else {
        points = 10 + timeBonus;
      }
    }

    // Insert answer history
    await connection.query(
      `
      INSERT INTO crossword_answers
        (user_id, crossword_question_id, user_answer, is_correct, points_earned, game_session_id)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        user_id,
        crossword_question_id,
        user_answer,
        isCorrect,
        points,
        game_session_id,
      ]
    );

    // Update score table
    await connection.query(
      `
      INSERT INTO crossword_scores
        (user_id, game_name, score, attempts, correct_answers, accuracy, game_session_id)
      VALUES (?, 'A. Crossword', ?, 1, ?, 100, ?)
      ON DUPLICATE KEY UPDATE
        score = score + VALUES(score),
        attempts = attempts + 1,
        correct_answers = correct_answers + VALUES(correct_answers),
        accuracy = ROUND(
          ((correct_answers + VALUES(correct_answers)) / (attempts + 1)) * 100,
          1
        ),
        last_updated = CURRENT_TIMESTAMP
      `,
      [
        user_id,
        points,
        isCorrect ? 1 : 0,
        game_session_id,
      ]
    );

    await connection.commit();

    // Broadcast to socket room if in teacher game mode
    if (session) {
      io.to(session.gameCode).emit("wordSolved", {
        wordId: crossword_question_id,
        user: { user_id },
        points
      });
    }

    res.json({
      success: true,
      correct: isCorrect,
      points,
    });
  } catch (err) {
    await connection.rollback();
    console.error("POST /crossword/submit-answer error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    connection.release();
  }
});

app.get("/crossword/leaderboard", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.user_id,
        u.email,
        u.display_name,
        s.score AS total_score,
        s.attempts AS questions_answered,
        s.correct_answers,
        s.accuracy
      FROM crossword_scores s
      JOIN users u ON u.user_id = s.user_id
      WHERE u.role = 'student'
      ORDER BY s.score DESC, s.accuracy DESC
      LIMIT 50
    `);

    res.json(rows);
  } catch (err) {
    console.error("GET /crossword/leaderboard error:", err);
    res.status(500).json([]);
  }
});

app.get("/crossword/download-results", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        u.display_name,
        u.email,
        s.score,
        s.attempts,
        s.correct_answers,
        s.accuracy,
        s.game_session_id
      FROM crossword_scores s
      JOIN users u ON u.user_id = s.user_id
      ORDER BY s.score DESC
    `);

    const header =
      "Rank,Name,Email,Score,Attempts,Correct,Accuracy,Session\n";

    const body = rows
      .map(
        (r, i) =>
          `${i + 1},"${r.display_name || "Anonymous"}","${r.email}",${
            r.score
          },${r.attempts},${r.correct_answers},${r.accuracy},"${
            r.game_session_id
          }"`
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=crossword-results.csv"
    );

    res.send(header + body);
  } catch (err) {
    console.error("GET /crossword/download-results error:", err);
    res.status(500).send("CSV generation failed");
  }
});

// Check crossword winner
app.get("/crossword/check-winner/:sessionId", async (req, res) => {
  const session = crosswordSessions.get(req.params.sessionId);
  if (!session) return res.json(null);

  const [rows] = await pool.query(
    `
    SELECT user_id, COUNT(DISTINCT crossword_question_id) as solved
    FROM crossword_answers
    WHERE game_session_id=?
    GROUP BY user_id
    ORDER BY solved DESC, MIN(answered_at)
    LIMIT 1
    `,
    [req.params.sessionId]
  );

  res.json(rows[0] || null);
});

// Generate crossword grid
app.get("/crossword/generate", async (req, res) => {
  const count = parseInt(req.query.count) || 15;
  const size = parseInt(req.query.size) || 15;

  try {
    const [questions] = await pool.query(
      "SELECT id, question, answer FROM crossword_questions LIMIT ?",
      [count]
    );
    
    if (questions.length === 0) {
      return res.status(400).json({ error: "No crossword questions available" });
    }

    const result = generateCrosswordGrid(questions, size);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error("Generate crossword error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// ----- CROSSWORD LIVE LEADERBOARD ENDPOINTS -----
// ==========================================

// ✅ NEW: Record crossword answer with live_leaderboard update (Wisdom Warfare pattern)
app.post("/crossword/record-answer", async (req, res) => {
  const {
    user_id,
    game_session_id,
    crossword_question_id,
    user_answer,
    game_code,
  } = req.body;

  if (!user_id || !game_session_id || !crossword_question_id || !user_answer) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields",
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // ✅ Check for duplicate answer
    const [exists] = await connection.query(
      `SELECT 1 FROM crossword_answers
       WHERE user_id = ? AND crossword_question_id = ? AND game_session_id = ?`,
      [user_id, crossword_question_id, game_session_id]
    );

    if (exists.length > 0) {
      await connection.rollback();
      connection.release();
      return res.json({
        ok: false,
        error: "You have already answered this question",
        points_earned: 0,
      });
    }

    // ✅ Get correct answer and check if user is correct
    const [[question]] = await connection.query(
      `SELECT answer FROM crossword_questions WHERE id = ?`,
      [crossword_question_id]
    );

    if (!question) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: "Question not found" });
    }

    const isCorrect =
      question.answer.trim().toLowerCase() === user_answer.trim().toLowerCase();
    const pointsEarned = isCorrect ? 10 : 0;

    // ✅ Record crossword answer
    await connection.query(
      `INSERT INTO crossword_answers
        (user_id, crossword_question_id, user_answer, is_correct, points_earned, game_session_id, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [user_id, crossword_question_id, user_answer, isCorrect, pointsEarned, game_session_id]
    );
    console.log("✅ Crossword answer recorded:", { user_id, isCorrect, pointsEarned });

    // ✅ Update live_leaderboard (session-specific scores) with proper calculation
    try {
      const [existingEntry] = await connection.query(
        `SELECT current_score, questions_answered, correct_answers FROM live_leaderboard 
         WHERE user_id = ? AND game_session_id = ?`,
        [user_id, game_session_id]
      );

      let newScore = pointsEarned;
      let questioned_answered = 1;
      let correct_ans = isCorrect ? 1 : 0;
      let accuracy = isCorrect ? 100 : 0;

      if (existingEntry.length > 0) {
        const existing = existingEntry[0];
        newScore = existing.current_score + pointsEarned;
        questioned_answered = existing.questions_answered + 1;
        correct_ans = existing.correct_answers + (isCorrect ? 1 : 0);
        accuracy = (correct_ans * 100.0) / questioned_answered;
      }

      await connection.query(
        `INSERT INTO live_leaderboard 
          (user_id, game_session_id, game_type, game_name, current_score, questions_answered, correct_answers, accuracy)
         VALUES (?, ?, 'Crossword', 'A. Crossword', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           current_score = ?,
           questions_answered = ?,
           correct_answers = ?,
           accuracy = ?`,
        [user_id, game_session_id, newScore, questioned_answered, correct_ans, accuracy, newScore, questioned_answered, correct_ans, accuracy]
      );
      console.log("✅ Live leaderboard updated:", { user_id, newScore, accuracy });
    } catch (lbError) {
      console.error("⚠️ Live leaderboard update error:", lbError.message);
    }

    // ✅ Update crossword_scores table (permanent record) with proper accuracy calculation
    try {
      const [existingScore] = await connection.query(
        `SELECT score, attempts, correct_answers FROM crossword_scores 
         WHERE user_id = ? AND game_session_id = ?`,
        [user_id, game_session_id]
      );

      let newTotalScore = pointsEarned;
      let newAttempts = 1;
      let newCorrectAnswers = isCorrect ? 1 : 0;
      let newAccuracy = isCorrect ? 100 : 0;

      if (existingScore.length > 0) {
        const existing = existingScore[0];
        newTotalScore = existing.score + pointsEarned;
        newAttempts = existing.attempts + 1;
        newCorrectAnswers = existing.correct_answers + (isCorrect ? 1 : 0);
        newAccuracy = (newCorrectAnswers * 100.0) / newAttempts;
      }

      await connection.query(
        `INSERT INTO crossword_scores
          (user_id, game_name, score, attempts, correct_answers, accuracy, game_session_id, last_updated)
         VALUES (?, 'A. Crossword', ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           score = ?,
           attempts = ?,
           correct_answers = ?,
           accuracy = ?,
           last_updated = NOW()`,
        [user_id, newTotalScore, newAttempts, newCorrectAnswers, newAccuracy, game_session_id, newTotalScore, newAttempts, newCorrectAnswers, newAccuracy]
      );
      console.log("✅ Crossword scores table updated:", { user_id, newTotalScore, newAccuracy });
    } catch (scoreError) {
      console.error("⚠️ Crossword scores update error:", scoreError.message);
    }

    await connection.commit();

    // ✅ NEW: Check for game completion - has this player answered all words correctly?
    let playerCompletionInfo = null;
    let gameCompletion = null;

    if (isCorrect) {
      try {
        // Count total correct answers by this player
        const [[playerStats]] = await connection.query(
          `SELECT COUNT(*) as correct_count FROM crossword_answers 
           WHERE user_id = ? AND game_session_id = ? AND is_correct = 1`,
          [user_id, game_session_id]
        );

        const session = crosswordSessions.get(game_session_id);
        const totalWords = session ? session.totalWords : 0;
        const correctCount = playerStats?.correct_count || 0;

        console.log(`🎯 Player ${user_id}: ${correctCount}/${totalWords} words correct`);

        // Check if player completed all words
        if (totalWords > 0 && correctCount >= totalWords && !session?.playerCompletionTime?.has(user_id)) {
          const completionTime = Date.now();
          session.playerCompletionTime.set(user_id, completionTime);

          // Fetch player info for winner announcement
          const [[playerInfo]] = await connection.query(
            `SELECT u.display_name, u.email FROM users u WHERE u.user_id = ?`,
            [user_id]
          );

          const playerName = playerInfo?.display_name || playerInfo?.email?.split('@')[0] || `Player ${user_id}`;

          playerCompletionInfo = {
            user_id,
            playerName,
            completionTime,
            correctAnswers: correctCount,
            totalWords,
            isWinner: session.winners.length === 0 // First to complete is the winner
          };

          // Track winners in order
          if (session.winners.length === 0) {
            session.winners.push(playerCompletionInfo);
            console.log(`🏆 WINNER FOUND: ${playerName} completed all ${totalWords} words!`);
            gameCompletion = {
              winner: playerCompletionInfo,
              allWinners: session.winners,
              message: `${playerName} completed the crossword first! 🎉`
            };
          }
        }
      } catch (completionCheckErr) {
        console.error("⚠️ Error checking game completion:", completionCheckErr.message);
      }
    }

    // ✅ Fetch live leaderboard for response with proper display_name
    let leaderboard = [];
    try {
      const [lbData] = await connection.query(
        `SELECT 
           ll.user_id,
           ll.current_score as score,
           ll.accuracy,
           ll.correct_answers,
           ll.questions_answered as attempts,
           COALESCE(u.display_name, u.email, CONCAT('Player_', ll.user_id)) as display_name,
           u.email,
           u.name
         FROM live_leaderboard ll
         LEFT JOIN users u ON ll.user_id = u.user_id
         WHERE ll.game_session_id = ?
         ORDER BY ll.current_score DESC, ll.accuracy DESC
         LIMIT 10`,
        [game_session_id]
      );
      leaderboard = lbData || [];
      console.log(`✅ Leaderboard fetched: ${leaderboard.length} players`);
    } catch (lbFetchError) {
      console.error("⚠️ Error fetching leaderboard:", lbFetchError.message);
    }

    connection.release();

    res.json({
      ok: true,
      points_earned: pointsEarned,
      leaderboard: leaderboard,
      playerCompletion: playerCompletionInfo,
      gameCompletion: gameCompletion
    });

    // ✅ Schedule debounced leaderboard broadcast to game room
    if (game_code) {
      scheduleCrosswordLeaderboardBroadcast(game_code, game_session_id);
      
      // If there's a winner, broadcast it immediately
      if (gameCompletion) {
        const roomName = `game_${game_code}`;
        io.to(roomName).emit("gameWinner", gameCompletion);
        console.log(`📢 Broadcasted game winner to room: ${roomName}`);
      }
    }
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error("record-answer error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ NEW: Get game timer status
app.get("/crossword/game-timer/:gameCode", async (req, res) => {
  try {
    const { gameCode } = req.params;
    const session = gameSessions.get(gameCode);

    if (!session) {
      return res.json({
        success: false,
        error: "Game session not found",
        gameActive: false
      });
    }

    const currentTime = Date.now();
    const timeRemaining = Math.max(0, session.gameEndTime - currentTime);
    const isGameActive = timeRemaining > 0;
    const isGameExpired = timeRemaining === 0;

    res.json({
      success: true,
      gameCode,
      gameActive: isGameActive,
      gameExpired: isGameExpired,
      startTime: session.startTime,
      endTime: session.gameEndTime,
      timeRemaining: timeRemaining,
      timeRemainingSeconds: Math.ceil(timeRemaining / 1000),
      winners: session.winners || [],
      totalWords: session.totalWords || 0
    });
  } catch (err) {
    console.error("GET /crossword/game-timer error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ NEW: Get game winner
app.get("/crossword/game-winner/:gameCode", async (req, res) => {
  try {
    const { gameCode } = req.params;
    const session = gameSessions.get(gameCode);

    if (!session) {
      return res.json({
        success: false,
        error: "Game session not found"
      });
    }

    const winner = session.winners && session.winners.length > 0 ? session.winners[0] : null;

    res.json({
      success: true,
      gameCode,
      winner: winner,
      hasWinner: !!winner,
      allWinners: session.winners || [],
      totalWords: session.totalWords || 0,
      message: winner ? `${winner.playerName} won the game!` : "No winner yet"
    });
  } catch (err) {
    console.error("GET /crossword/game-winner error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ Fetch live leaderboard for crossword game session with proper display_name
app.get("/crossword/live-leaderboard/:gameSessionId", async (req, res) => {
  try {
    const { gameSessionId } = req.params;

    const [leaderboard] = await pool.query(
      `SELECT 
         ll.user_id, 
         u.email, 
         COALESCE(u.display_name, u.email, CONCAT('Player_', ll.user_id)) as display_name,
         u.name,
         ll.current_score as score,
         ll.accuracy,
         ll.correct_answers,
         ll.questions_answered as attempts
       FROM live_leaderboard ll
       LEFT JOIN users u ON ll.user_id = u.user_id
       WHERE ll.game_session_id = ? AND ll.game_type = 'Crossword'
       ORDER BY ll.current_score DESC, ll.accuracy DESC`,
      [gameSessionId]
    );

    res.json({
      success: true,
      gameSessionId: gameSessionId,
      leaderboard: leaderboard,
      totalPlayers: leaderboard.length,
    });
  } catch (err) {
    console.error("GET /crossword/live-leaderboard error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ End crossword game session and transfer scores
app.post("/crossword/game/end-session/:gameSessionId", async (req, res) => {
  try {
    const { gameSessionId } = req.params;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // ✅ Get all live leaderboard entries for this crossword session
      const [liveEntries] = await connection.query(
        `SELECT * FROM live_leaderboard WHERE game_session_id = ? AND game_type = 'Crossword'`,
        [gameSessionId]
      );

      if (liveEntries.length === 0) {
        await connection.rollback();
        connection.release();
        return res.json({
          success: true,
          message: "No active players in this crossword session",
          transferred: 0,
        });
      }

      // ✅ Transfer each player's session scores to crossword_scores (permanent record already done per-answer)
      // This ensures session data is preserved in the event of game end
      for (const entry of liveEntries) {
        // Scores are already being recorded in crossword_scores per answer
        // This just ensures consistency
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Crossword game session ended. Scores finalized.",
        gameSessionId: gameSessionId,
        playersProcessed: liveEntries.length,
        transferred: liveEntries.length,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("POST /crossword/game/end-session error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ✅ End crossword game session and transfer scores
app.post("/crossword/game/end-session/:gameSessionId", async (req, res) => {
  try {
    const { gameSessionId } = req.params;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // ✅ Get all live leaderboard entries for this crossword session
      const [liveEntries] = await connection.query(
        `SELECT * FROM live_leaderboard WHERE game_session_id = ? AND game_type = 'Crossword'`,
        [gameSessionId]
      );

      if (liveEntries.length === 0) {
        await connection.rollback();
        connection.release();
        return res.json({
          success: true,
          message: "No active players in this crossword session",
          transferred: 0,
        });
      }

      // ✅ Transfer each player's session scores to crossword_scores (permanent record already done per-answer)
      // This ensures session data is preserved in the event of game end
      for (const entry of liveEntries) {
        // Scores are already being recorded in crossword_scores per answer
        // This just ensures consistency
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Crossword game session ended. Scores finalized.",
        gameSessionId: gameSessionId,
        playersProcessed: liveEntries.length,
        transferred: liveEntries.length,
      });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("POST /crossword/game/end-session error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ----- CROSSWORD SOCKET EVENTS -----
// ==========================================

io.on("connection", (socket) => {
  console.log("✅ Crossword socket connected:", socket.id);

  // ✅ FIX 1: Join game WITHOUT auto-start
  socket.on("joinGame", async ({ game_code, user_id, email, game_type }) => {
    if (!game_code) return;

    // Use proper room naming convention
    const roomName = `game_${game_code}`;
    socket.join(roomName);
    console.log(`📊 Socket ${socket.id} (User: ${user_id}) joined crossword room: ${roomName}`);

    // Initialize session if needed
    if (!gameSessions.has(game_code)) {
      const gameSessionId = generateCrosswordSessionId();
      gameSessions.set(game_code, {
        gameSessionId,
        game_type: "Crossword",
        game_name: game_type,
        state: "WAITING_FOR_TEACHER",
        started: false,
        players: new Map(),
        startTime: null,
        grid: null,
        clues: null
      });
      console.log(`✅ Initialized new crossword session for game: ${game_code}, ID: ${gameSessionId}`);
    }

    const session = gameSessions.get(game_code);
    
    // Add player to session if not already there
    if (!session.players.has(user_id)) {
      session.players.set(user_id, {
        user_id,
        email,
        joinedAt: Date.now(),
        answered: false,
        score: 0
      });
      console.log(`✅ Added player ${user_id} to session. Total players: ${session.players.size}`);
    }

    // ✅ Broadcast updated player list to all players in the room
    const playerList = Array.from(session.players.values()).map(p => ({
      user_id: p.user_id,
      email: p.email,
      display_name: p.email ? p.email.split('@')[0] : `Player_${p.user_id}`,
      joinedAt: p.joinedAt
    }));
    
    console.log(`🔊 Broadcasting playerListUpdate to room ${roomName}:`, {
      game_code,
      playerCount: session.players.size,
      players: playerList.map(p => p.display_name)
    });
    
    io.to(roomName).emit("playerListUpdate", {
      game_code,
      players: playerList,
      playerCount: session.players.size
    });
    console.log(`📢 Broadcasted player list update: ${playerList.length} players to room ${roomName}`);

    // ✅ CRITICAL: Emit gameStatus with isGameActive: false (WAITING state)
    socket.emit("gameStatus", {
      game_code,
      isGameActive: false,
      state: "WAITING_FOR_TEACHER",
      gameSessionId: session.gameSessionId,
      playerCount: session.players.size,
      message: "Waiting for teacher to start the crossword game..."
    });

    console.log(`📢 Sent gameStatus (NOT ACTIVE) to player ${user_id}`);
  });

  // ✅ FIX 2: Get current game status
  socket.on("getGameStatus", ({ game_code }) => {
    if (!game_code) return;

    const session = gameSessions.get(game_code);
    if (!session) {
      socket.emit("gameStatus", {
        game_code,
        isGameActive: false,
        state: "WAITING_FOR_TEACHER",
        message: "Game session not found"
      });
      return;
    }

    socket.emit("gameStatus", {
      game_code,
      isGameActive: session.state === "ACTIVE",
      state: session.state,
      gameSessionId: session.gameSessionId,
      message: session.state === "WAITING_FOR_TEACHER" 
        ? "Waiting for teacher to start..." 
        : "Game is now active"
    });
  });

  // ✅ FIX 3: NEW - Teacher-triggered game start
  socket.on("startCrosswordGame", async ({ game_code }) => {
    if (!game_code) {
      console.warn("⚠️ startCrosswordGame: No game_code provided");
      return;
    }

    try {
      const roomName = `game_${game_code}`;
      let session = gameSessions.get(game_code);
      
      if (!session) {
        console.warn(`⚠️ Session not found for game: ${game_code}`);
        return;
      }

      console.log(`🚀 Teacher starting crossword game: ${game_code}`);

      // ✅ Fetch ALL questions dynamically with random selection
      const questions = await fetchCrosswordQuestions(20);

      if (!questions || questions.length === 0) {
        io.to(roomName).emit("crosswordError", {
          error: "No crossword questions available"
        });
        return;
      }

      // ✅ Generate crossword grid (creates DIFFERENT grid each time)
      const crossword = generateCrosswordGrid(questions);

      // Update session
      session.state = "ACTIVE";
      session.started = true;
      session.startTime = Date.now();
      session.grid = crossword.grid;
      session.clues = crossword.clues;

      // Store session data for reference
      crosswordSessions.set(session.gameSessionId, {
        grid: crossword.grid,
        clues: crossword.clues,
        letters: crossword.letters,
        solvedWords: new Set(),
        solvedUsers: new Map(),
        gameCode,
        gameSessionId: session.gameSessionId,
        startTime: session.startTime,
        placedWords: crossword.placedWords
      });

      console.log(`✅ Crossword grid generated with ${questions.length} questions for game: ${game_code}`);

      // ✅ Broadcast gameStarted event to ALL players first
      io.to(roomName).emit("gameStarted", {
        game_code,
        gameSessionId: session.gameSessionId,
        message: "Crossword game is starting now!"
      });
      console.log(`📢 Broadcasted gameStarted to room: ${roomName}`);

      // ✅ Then broadcast the grid
      io.to(roomName).emit("crosswordGrid", {
        game_code,
        grid: crossword.grid,
        clues: crossword.clues,
        cellNumbers: crossword.cellNumbers || {},
        placedWords: crossword.placedWords || []
      });
      console.log(`📢 Broadcasted crosswordGrid to room: ${roomName}`);

      // Initialize live_leaderboard for all players in this session
      const connection = await pool.getConnection();
      try {
        if (session.players.size > 0) {
          for (const [user_id, playerData] of session.players) {
            await connection.query(
              `
              INSERT INTO live_leaderboard 
                (user_id, game_session_id, game_type, game_name, current_score, questions_answered, correct_answers, accuracy)
              VALUES (?, ?, ?, ?, 0, 0, 0, 0)
              ON DUPLICATE KEY UPDATE 
                current_score = 0, 
                questions_answered = 0, 
                correct_answers = 0, 
                accuracy = 0
              `,
              [user_id, session.gameSessionId, "Crossword", session.game_name]
            );
          }
          console.log(`✅ Initialized live_leaderboard for ${session.players.size} players`);
          
          // ✅ Broadcast initial leaderboard with all 0 scores
          try {
            const [initialLeaderboard] = await connection.query(
              `SELECT 
                 ll.user_id,
                 ll.current_score as score,
                 ll.accuracy,
                 ll.correct_answers,
                 ll.questions_answered as attempts,
                 COALESCE(u.display_name, CONCAT('Player_', ll.user_id)) as display_name,
                 u.email
               FROM live_leaderboard ll
               LEFT JOIN users u ON ll.user_id = u.user_id
               WHERE ll.game_session_id = ?
               ORDER BY ll.current_score DESC, ll.accuracy DESC`,
              [session.gameSessionId]
            );
            io.to(roomName).emit("crosswordLeaderboardUpdate", initialLeaderboard);
            console.log(`📊 Broadcasted initial leaderboard with ${initialLeaderboard.length} players`);
          } catch (leaderboardBroadcastErr) {
            console.warn("⚠️ Error broadcasting initial leaderboard:", leaderboardBroadcastErr.message);
          }
        }
      } catch (leaderboardErr) {
        console.warn("⚠️ Leaderboard init warning:", leaderboardErr.message);
      } finally {
        connection.release();
      }

    } catch (err) {
      console.error("startCrosswordGame error:", err);
      io.to(`game_${game_code}`).emit("crosswordError", {
        error: "Failed to start crossword game"
      });
    }
  });

  // Word locking for anti-cheat
  socket.on("crosswordLockWord", ({ sessionId, user_id, crossword_question_id }) => {
    const sessionLocks = crosswordLocks.get(sessionId) || new Map();
    
    // Check if user already has a lock
    if (sessionLocks.has(user_id)) {
      socket.emit("crosswordError", { 
        error: "You can only work on one word at a time" 
      });
      return;
    }
    
    // Check if word is already locked by someone else
    for (const [uid, cid] of sessionLocks) {
      if (cid === crossword_question_id) {
        socket.emit("crosswordError", { 
          error: "This word is currently being solved by another player" 
        });
        return;
      }
    }
    
    // Lock the word for this user
    sessionLocks.set(user_id, crossword_question_id);
    crosswordLocks.set(sessionId, sessionLocks);
    
    io.to(sessionId).emit("wordLocked", {
      crossword_question_id,
      user_id
    });

    console.log(`🔒 Word locked: user ${user_id} locked question ${crossword_question_id}`);
  });

  // Word unlock
  socket.on("crosswordUnlockWord", ({ sessionId, user_id }) => {
    const sessionLocks = crosswordLocks.get(sessionId);
    if (sessionLocks) {
      sessionLocks.delete(user_id);
      io.to(sessionId).emit("wordUnlocked", { user_id });
      console.log(`🔓 Word unlocked: user ${user_id}`);
    }
  });

  // ✅ FIX 4: Crossword answer submission with leaderboard update
  socket.on("crosswordSubmit", async ({ sessionId, game_code, user_id, word, crossword_question_id }) => {
    try {
      const session = crosswordSessions.get(sessionId);
      if (!session) {
        socket.emit("crosswordError", { error: "Invalid session" });
        return;
      }

      // Check if word is locked to this user
      const sessionLocks = crosswordLocks.get(sessionId);
      if (sessionLocks) {
        const lockedBy = sessionLocks.get(user_id);
        if (lockedBy !== crossword_question_id) {
          socket.emit("crosswordError", { 
            error: "You must lock this word before submitting" 
          });
          return;
        }
        sessionLocks.delete(user_id);
      }

      const [[question]] = await pool.query(
        "SELECT answer FROM crossword_questions WHERE id = ?",
        [crossword_question_id]
      );

      if (!question) {
        socket.emit("crosswordError", { error: "Invalid question" });
        return;
      }

      const isCorrect = word.trim().toLowerCase() === question.answer.trim().toLowerCase();
      const elapsed = Date.now() - session.startTime;
      
      let points = 10;
      let timeBonus = 0;
      
      if (elapsed < 30000) timeBonus = 5;
      else if (elapsed < 60000) timeBonus = 3;
      
      const isFirst = !session.solvedWords.has(crossword_question_id);
      if (isFirst) {
        points = 15 + timeBonus;
        session.solvedWords.add(crossword_question_id);
      } else {
        points = 10 + timeBonus;
      }

      // Record answer in database
      const connection = await pool.getConnection();
      try {
        await connection.query(
          `
          INSERT INTO crossword_answers 
            (user_id, crossword_question_id, user_answer, is_correct, points_earned, game_session_id)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [user_id, crossword_question_id, word, isCorrect, points, sessionId]
        );

        // Update player stats
        if (isCorrect) {
          await connection.query(
            `
            UPDATE live_leaderboard 
            SET current_score = current_score + ?, 
                questions_answered = questions_answered + 1,
                correct_answers = correct_answers + 1,
                accuracy = (correct_answers + 1) / (questions_answered + 1) * 100
            WHERE game_session_id = ? AND user_id = ?
            `,
            [points, sessionId, user_id]
          );
        } else {
          await connection.query(
            `
            UPDATE live_leaderboard 
            SET questions_answered = questions_answered + 1,
                accuracy = correct_answers / (questions_answered + 1) * 100
            WHERE game_session_id = ? AND user_id = ?
            `,
            [sessionId, user_id]
          );
        }
      } finally {
        connection.release();
      }

      // ✅ Trigger debounced leaderboard broadcast
      scheduleCrosswordLeaderboardBroadcast(game_code, sessionId);

      io.to(session.gameCode || `game_${game_code}`).emit("wordSolved", {
        wordId: crossword_question_id,
        user: { user_id },
        points: isCorrect ? points : 0,
        isCorrect,
        timeBonus: timeBonus > 0 ? `+${timeBonus} time bonus` : null
      });

      console.log(`✅ Word submitted - Correct: ${isCorrect}, Points: ${points}, User: ${user_id}`);

      socket.emit("crosswordSubmitResult", {
        success: true,
        correct: isCorrect,
        points: isCorrect ? points : 0
      });
    } catch (err) {
      console.error("crosswordSubmit error:", err);
      socket.emit("crosswordError", { error: "Server error" });
    }
  });

  socket.on("crosswordSolved", data => {
    io.to(data.sessionId).emit("crosswordUpdate", data);
  });

  // ✅ NEW: End crossword game
  socket.on("endCrosswordGame", async ({ game_code, gameSessionId }) => {
    try {
      const session = gameSessions.get(game_code);
      if (session) {
        session.state = "ENDED";
        console.log(`⏹️ Crossword game ended: ${game_code}`);

        // Fetch final leaderboard
        const [leaderboard] = await pool.query(
          "SELECT * FROM live_leaderboard WHERE game_session_id = ? ORDER BY current_score DESC",
          [gameSessionId]
        );

        io.to(`game_${game_code}`).emit("gameEnded", {
          game_code,
          leaderboard,
          message: "Crossword game has ended"
        });
      }
    } catch (err) {
      console.error("endCrosswordGame error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Crossword socket disconnected:", socket.id);
    
    // Clean up locks when user disconnects
    for (const [sessionId, locks] of crosswordLocks) {
      for (const [user_id, crossword_question_id] of locks) {
        io.to(sessionId).emit("wordUnlocked", { user_id });
      }
    }
  });
});

// ==========================================
// ----- START SERVER -----
// ==========================================

function startServer(port) {
  server
    .listen(port, () => {
      SERVER_PORT = server.address().port;
      console.log(`🧩 Crossword Server running on port ${SERVER_PORT}`);
      console.log(`🔍 Health check: http://localhost:${SERVER_PORT}/`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`❌ Port ${port} is busy, trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error("Crossword server error:", err);
      }
    });
}

startServer(DEFAULT_PORT);