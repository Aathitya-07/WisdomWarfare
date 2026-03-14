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
const { generateCrosswordGrid, fetchCrosswordQuestions } = require("./crosswordgenerate");

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

// simple logger
app.use((req, res, next) => {
  if (req.path.startsWith("/auth") || req.path.startsWith("/teacher")) {
    console.log("➡️", req.method, req.path, "Origin:", req.headers.origin);
  }
  next();
});

// ----- SERVER_BASE / PORT handling -----
const DEFAULT_PORT = parseInt(process.env.PORT || "4001", 10);
let SERVER_PORT = DEFAULT_PORT;
function getServerBase() {
  return process.env.SERVER_BASE || `http://localhost:${SERVER_PORT}`;
}

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
  connectionLimit: 50,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// ==========================================
// ----- GLOBAL GAME STATE MAPS -----
// ==========================================

// ----- Game state -----
let questions = [];
let currentIndex = -1;
let acceptingAnswers = false;
let firstAnswered = false;
let answeredUsers = new Map();
let gameTimer = null;
let currentQuestionStartTime = null;
let gameSessionId = null;
let isGameActive = false;

// ----- Per-Game-Code State (for proper isolation between different game codes) -----
const gameStates = new Map(); // game_code -> { questions, currentIndex, acceptingAnswers, gameSessionId, etc. }

// ----- Debounced Leaderboard Broadcasts (batches rapid updates within 500ms) -----
const leaderboardTimers = new Map();
function scheduleLeaderboardBroadcast(game_code, sessionId) {
  if (leaderboardTimers.has(game_code)) return; // Already scheduled within window
  leaderboardTimers.set(game_code, setTimeout(async () => {
    leaderboardTimers.delete(game_code);
    try {
      const [leaderboard] = await pool.query(
        `SELECT ll.user_id, ll.current_score as score, ll.accuracy, ll.correct_answers,
                ll.questions_answered as attempts,
                COALESCE(u.display_name, CONCAT('Player_', ll.user_id)) as display_name,
                u.email
         FROM live_leaderboard ll
         LEFT JOIN users u ON ll.user_id = u.user_id
         WHERE ll.game_session_id = ?
         ORDER BY ll.current_score DESC, ll.accuracy DESC
         LIMIT 10`,
        [sessionId]
      );
      io.to(`game_${game_code}`).emit("leaderboardUpdate", leaderboard);
      console.log(`📊 [Debounced] Leaderboard broadcast to game_${game_code}: ${leaderboard.length} players`);
    } catch (err) {
      console.error(`⚠️ Debounced leaderboard broadcast error for ${game_code}:`, err.message);
    }
  }, 500));
}

function initGameState(gameCode) {
  if (!gameStates.has(gameCode)) {
    gameStates.set(gameCode, {
      questions: [],
      currentIndex: -1,
      acceptingAnswers: false,
      firstAnswered: false,
      answeredUsers: new Map(),
      gameTimer: null,
      currentQuestionStartTime: null,
      gameSessionId: null,
      isGameActive: false,
      questionEnded: false // ✅ Guard flag to prevent double-ending
    });
  }
  return gameStates.get(gameCode);
}

// ----- Crossword Game State -----
let crosswordGameActive = false;
let crosswordGameSessionId = null;
let crosswordGrid = null;
let crosswordClues = null;
let crosswordPlacedWords = null;
let currentCrosswordQuestions = [];
let crosswordAnswers = new Map(); // user_id -> { answers: {}, score: 0 }

// ==========================================
// ----- HELPERS -----
// ==========================================

async function loadQuestions() {
  try {
    console.log("🔄 Loading questions from database...");

    const [rows] = await pool.query(`
      SELECT * FROM questions 
      WHERE text IS NOT NULL 
      AND option_a IS NOT NULL 
      AND option_b IS NOT NULL 
      AND option_c IS NOT NULL 
      AND option_d IS NOT NULL 
      AND correct IS NOT NULL
      ORDER BY 
        CASE difficulty 
          WHEN 'Easy' THEN 1 
          WHEN 'Medium' THEN 2 
          WHEN 'Hard' THEN 3 
          ELSE 4 
        END, id
      LIMIT 30
    `);

    questions = rows || [];
    console.log(`✅ ${questions.length} questions loaded successfully`);

    return questions.length;
  } catch (err) {
    console.error("❌ Error loading questions:", err.message);
    questions = [];
    return 0;
  }
}

function generateGameSessionId() {
  return `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getCorrectAnswerText(question) {
  if (!question) {
    console.log("❌ No question provided");
    return "Unknown";
  }

  console.log("🔍 DEBUG - getCorrectAnswerText called:", {
    questionId: question.id,
    correct: question.correct,
    option_a: question.option_a,
    option_b: question.option_b,
    option_c: question.option_c,
    option_d: question.option_d
  });

  const correct = String(question.correct).toLowerCase().trim();

  if (correct === "option_a" || correct === "a") {
    console.log("✅ Mapped to option_a:", question.option_a);
    return question.option_a;
  }
  if (correct === "option_b" || correct === "b") {
    console.log("✅ Mapped to option_b:", question.option_b);
    return question.option_b;
  }
  if (correct === "option_c" || correct === "c") {
    console.log("✅ Mapped to option_c:", question.option_c);
    return question.option_c;
  }
  if (correct === "option_d" || correct === "d") {
    console.log("✅ Mapped to option_d:", question.option_d);
    return question.option_d;
  }

  console.log("❌ Could not map correct answer:", correct);
  return "Unknown";
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

// ==========================================
// ----- API ROUTES -----
// ==========================================

app.get("/", (req, res) => {
  res.json({
    message: "Wisdom Warfare Backend Running! 🚀",
    status: "healthy",
    questionsLoaded: questions.length,
    gameActive: isGameActive,
  });
});

app.get("/user/:user_id/can-play", async (req, res) => {
  try {
     res.json({
      can_play: true,
      message: "User can play the game",
    });
  } catch (err) {
    console.error("Error checking play status:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/questions", async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT * FROM questions 
      ORDER BY 
        CASE difficulty 
          WHEN 'Easy' THEN 1 
          WHEN 'Medium' THEN 2 
          WHEN 'Hard' THEN 3 
          ELSE 4 
        END, id
      LIMIT 30
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/game/status", (req, res) => {
  res.json({
    questionsLoaded: questions.length,
    currentIndex: currentIndex,
    acceptingAnswers: acceptingAnswers,
    gameSessionId: gameSessionId,
    isGameActive: isGameActive,
    currentQuestion:
      currentIndex >= 0 && currentIndex < questions.length
        ? questions[currentIndex]
        : null,
  });
});

// 5) START GAME (GLOBAL SESSION – MODE A)
app.post("/admin/start-game", async (req, res) => {
  try {
    console.log("🎮 Admin starting game...");

    const { game_code = null, teacher_game_id = null } = req.body || {};
    if (game_code || teacher_game_id) {
      console.log("👉 start-game called with:", {
        game_code,
        teacher_game_id,
      });
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.log("🔄 No questions in memory, reloading from DB...");
      await loadQuestions();
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      console.log("❌ Still no questions after reload.");
      return res.status(400).json({
        success: false,
        error: "No questions available. Please upload questions first.",
      });
    }

    console.log(`🎬 [/admin/start-game] Calling startNewGameSession with game_code: ${game_code}`);
    startNewGameSession(game_code);
    
    console.log(`✓ [/admin/start-game] startNewGameSession completed`);

    // Determine which state to read from - use per-game state if game_code provided
    const state = game_code ? gameStates.get(game_code) : { gameSessionId, isGameActive, currentIndex, acceptingAnswers, questions };
    
    console.log(`🔍 [/admin/start-game] Retrieved state:`, {
      game_code,
      state_exists: state !== undefined,
      gameSessionId: state?.gameSessionId,
      currentIndex: state?.currentIndex,
      isGameActive: state?.isGameActive
    });

    // ✅ DO NOT emit gameStatus here - it overrides the gameStarted event!
    // The gameStarted event is already emitted by startNewGameSession
    // and the first question will be sent automatically after 3 seconds

    console.log(
      `✅ Game started. Session: ${state.gameSessionId}, total questions: ${questions.length}, code: ${game_code}`
    );

    return res.json({
      success: true,
      message: "Game started successfully",
      questions: questions.length,
      sessionId: state.gameSessionId,
      game_code: game_code
    });
  } catch (err) {
    console.error("Start game error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.post("/admin/reset-game", (req, res) => {
  currentIndex = -1;
  acceptingAnswers = false;
  firstAnswered = false;
  answeredUsers.clear();
  isGameActive = false;

  if (gameTimer) {
    clearTimeout(gameTimer);
    gameTimer = null;
  }

  res.json({
    success: true,
    message: "Game reset successfully",
  });
});

app.post("/admin/reload-questions", async (req, res) => {
  try {
    const count = await loadQuestions();
    res.json({
      success: true,
      message: "Questions reloaded successfully",
      questionsLoaded: count,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.get("/test-db", async (req, res) => {
  try {
    const [dbTest] = await pool.query("SELECT 1 as db_status");
    const [questionCount] = await pool.query(
      "SELECT COUNT(*) as count FROM questions"
    );
    const [sampleQuestions] = await pool.query(
      "SELECT id, text, correct, difficulty FROM questions LIMIT 3"
    );

    res.json({
      database: "Connected ✅",
      totalQuestions: questionCount[0].count,
      sampleQuestions: sampleQuestions,
      gameState: {
        questionsInMemory: questions.length,
        currentIndex: currentIndex,
        gameSessionId: gameSessionId,
        isGameActive: isGameActive,
      },
    });
  } catch (err) {
    res.status(500).json({
      database: "Error ❌",
      error: err.message,
    });
  }
});

app.delete("/questions/reset-all", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    console.log("Starting question reset...");

    await connection.execute("DELETE FROM answers");
    await connection.execute("DELETE FROM scores");
    await connection.execute("DELETE FROM performance");
    await connection.execute("DELETE FROM questions");
    await connection.execute("ALTER TABLE questions AUTO_INCREMENT = 1");

    await connection.commit();

    await loadQuestions();

    console.log("Question reset completed successfully");
    res.json({
      message: "All questions and game data reset successfully",
    });
  } catch (err) {
    await connection.rollback();
    console.error("Error resetting questions:", err);
    res.status(500).json({ error: "Database error: " + err.message });
  } finally {
    connection.release();
  }
});

app.post("/admin/reset-duplicate-plays", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [duplicateUsers] = await connection.query(`
      SELECT user_id, COUNT(DISTINCT game_session_id) as session_count 
      FROM answers 
      GROUP BY user_id 
      HAVING session_count > 1
    `);

    for (const user of duplicateUsers) {
      const [firstSession] = await connection.query(
        `
        SELECT game_session_id 
        FROM answers 
        WHERE user_id = ? 
        ORDER BY answered_at ASC 
        LIMIT 1
      `,
        [user.user_id]
      );

      if (firstSession.length > 0) {
        const firstSessionId = firstSession[0].game_session_id;

        await connection.query(
          "DELETE FROM answers WHERE user_id = ? AND game_session_id != ?",
          [user.user_id, firstSessionId]
        );
      }
    }

    await connection.query(`
      UPDATE performance p
      JOIN (
        SELECT 
          user_id,
          SUM(points_earned) as total_score,
          COUNT(*) as total_attempts,
          SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as total_correct
        FROM answers 
        GROUP BY user_id
      ) a ON p.user_id = a.user_id
      SET 
        p.score = a.total_score,
        p.attempts = a.total_attempts,
        p.correct_answers = a.total_correct,
        p.accuracy = CASE 
          WHEN a.total_attempts > 0 THEN (a.total_correct * 100.0 / a.total_attempts)
          ELSE 0 
        END
    `);

    await connection.commit();

    res.json({
      success: true,
      message: `Reset duplicate plays for ${duplicateUsers.length} users`,
      affected_users: duplicateUsers.length,
    });
  } catch (err) {
    await connection.rollback();
    console.error("Reset duplicate plays error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ----- Add single question -----
app.post("/questions", async (req, res) => {
  try {
    const { text, option_a, option_b, option_c, option_d, correct, difficulty, topic } =
      req.body;

    if (!text || !option_a || !option_b || !option_c || !option_d || !correct) {
      return res.status(400).json({ error: "All fields are required" });
    }

    let normalizedCorrect = correct.toString().trim().toUpperCase();

    if (["A", "OPTION_A", "OPTION A", "1"].includes(normalizedCorrect))
      normalizedCorrect = "option_a";
    else if (["B", "OPTION_B", "OPTION B", "2"].includes(normalizedCorrect))
      normalizedCorrect = "option_b";
    else if (["C", "OPTION_C", "OPTION C", "3"].includes(normalizedCorrect))
      normalizedCorrect = "option_c";
    else if (["D", "OPTION_D", "OPTION D", "4"].includes(normalizedCorrect))
      normalizedCorrect = "option_d";

    if (
      !["option_a", "option_b", "option_c", "option_d"].includes(
        normalizedCorrect
      )
    ) {
      return res
        .status(400)
        .json({ error: "Correct answer must be A, B, C, or D" });
    }

    const [result] = await pool.query(
      `
      INSERT INTO questions (text, option_a, option_b, option_c, option_d, correct, difficulty, topic)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        text,
        option_a,
        option_b,
        option_c,
        option_d,
        normalizedCorrect,
        difficulty || "Medium",
        topic || null,
      ]
    );

    await loadQuestions();
    res.json({
      success: true,
      message: "Question added successfully",
      question_id: result.insertId,
    });
  } catch (err) {
    console.error("POST /questions error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// UPDATE MCQ QUESTION
app.put("/questions/:id", async (req, res) => {
  const { id } = req.params;
  const {
    text,
    option_a,
    option_b,
    option_c,
    option_d,
    correct,
    difficulty,
    topic,
  } = req.body;

  try {
    const [result] = await pool.query(
      `
      UPDATE questions
      SET text=?, option_a=?, option_b=?, option_c=?, option_d=?, correct=?, difficulty=?, topic=?
      WHERE id=?
      `,
      [
        text,
        option_a,
        option_b,
        option_c,
        option_d,
        correct,
        difficulty,
        topic,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /questions/:id error:", err);
    res.status(500).json({ error: "Update failed" });
  }
});

// DELETE MCQ QUESTION
app.delete("/questions/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      "DELETE FROM questions WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Question not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /questions/:id error:", err);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ----- CSV Upload -----
app.post("/questions/upload", upload.single("file"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Processing file:", req.file.path);
    const results = [];
    let inserted = 0;
    let errors = [];

    await connection.beginTransaction();

    const processCSV = () => {
      return new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                try {
                  const question = {
                    text: row.question || row.text || row.Question || row.Q,
                    option_a:
                      row.option_a ||
                      row.a ||
                      row.optionA ||
                      row.A ||
                      row["option A"],
                    option_b:
                      row.option_b ||
                      row.b ||
                      row.optionB ||
                      row.B ||
                      row["option B"],
                    option_c:
                      row.option_c ||
                      row.c ||
                      row.optionC ||
                      row.C ||
                      row["option C"],
                    option_d:
                      row.option_d ||
                      row.d ||
                      row.optionD ||
                      row.D ||
                      row["option D"],
                    correct:
                      row.correct ||
                      row.answer ||
                      row.correct_answer ||
                      row.key,
                    difficulty: row.difficulty || row.level || "Medium",
                    topic: row.topic || row.Topic || null,
                  };

                  if (
                    !question.text ||
                    !question.option_a ||
                    !question.option_b ||
                    !question.option_c ||
                    !question.option_d ||
                    !question.correct
                  ) {
                    errors.push(`Row ${i + 1}: Missing required fields`);
                    continue;
                  }

                  let normalizedCorrect = question.correct
                    .toString()
                    .toUpperCase()
                    .trim();

                  if (
                    ["A", "OPTION_A", "OPTION A", "1"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_a";
                  else if (
                    ["B", "OPTION_B", "OPTION B", "2"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_b";
                  else if (
                    ["C", "OPTION_C", "OPTION C", "3"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_c";
                  else if (
                    ["D", "OPTION_D", "OPTION D", "4"].includes(
                      normalizedCorrect
                    )
                  )
                    normalizedCorrect = "option_d";
                  else {
                    errors.push(
                      `Row ${i + 1}: Invalid correct answer format: ${
                        question.correct
                      }`
                    );
                    continue;
                  }

                  await connection.query(
                    `
                    INSERT INTO questions (text, option_a, option_b, option_c, option_d, correct, difficulty, topic)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `,
                    [
                      question.text.trim(),
                      question.option_a.trim(),
                      question.option_b.trim(),
                      question.option_c.trim(),
                      question.option_d.trim(),
                      normalizedCorrect,
                      question.difficulty.trim(),
                      question.topic,
                    ]
                  );
                  inserted++;
                } catch (rowError) {
                  errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
              }
              resolve();
            } catch (processError) {
              reject(processError);
            }
          })
          .on("error", (error) => {
            reject(error);
          });
      });
    };

    await processCSV();
    await connection.commit();

    try {
      fs.unlinkSync(req.file.path);
    } catch (unlinkError) {
      console.error("Error deleting file:", unlinkError);
    }

    await loadQuestions();
    res.json({
      success: true,
      message: `CSV processing completed`,
      inserted: inserted,
      total: results.length,
      errors: errors,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Upload error:", error);
    res.status(500).json({
      success: false,
      error: "Upload failed: " + error.message,
    });
  } finally {
    connection.release();
  }
});

// ----- Leaderboard / Results -----
app.get("/leaderboard", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "20", 10);

    const sql = `
      SELECT 
        u.user_id, 
        u.email, 
        u.display_name, 
        u.role,
        COALESCE(p.score, 0) as score,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = u.user_id), 0) as attempts,
        COALESCE(p.correct_answers, 0) as correct_answers,
        CASE 
          WHEN p.attempts > 0 THEN ROUND((p.correct_answers * 100.0 / p.attempts), 2)
          ELSE 0 
        END as accuracy
      FROM users u
      LEFT JOIN performance p ON u.user_id = p.user_id
      WHERE u.email IS NOT NULL 
        AND u.role = 'student'
        AND u.email != ''
      ORDER BY p.score DESC, accuracy DESC, p.correct_answers DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [limit]);
    res.json(rows);
  } catch (err) {
    console.error("GET /leaderboard error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET: Wisdom Warfare (MCQ) Leaderboard
app.get("/leaderboard/wisdom-warfare", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "20", 10);

    const sql = `
      SELECT 
        u.user_id, 
        u.email, 
        u.display_name, 
        u.role,
        COALESCE(p.score, 0) as score,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = u.user_id), 0) as attempts,
        COALESCE(p.correct_answers, 0) as correct_answers,
        CASE 
          WHEN p.attempts > 0 THEN ROUND((p.correct_answers * 100.0 / p.attempts), 2)
          ELSE 0 
        END as accuracy
      FROM users u
      LEFT JOIN performance p ON u.user_id = p.user_id
      WHERE u.email IS NOT NULL 
        AND u.role = 'student'
        AND u.email != ''
      ORDER BY p.score DESC, accuracy DESC, p.correct_answers DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [limit]);
    res.json(rows);
  } catch (err) {
    console.error("GET /leaderboard/wisdom-warfare error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET: Crossword Leaderboard
// GET: Student's game performance (both game types)
app.get("/student/:student_id/game-performance", async (req, res) => {
  try {
    const { student_id } = req.params;

    // Get Wisdom Warfare performance
    const [wisdomWarfareStats] = await pool.query(`
      SELECT 
        COALESCE(p.score, 0) as score,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = ?), 0) as attempts,
        COALESCE(p.correct_answers, 0) as correct_answers,
        CASE 
          WHEN p.attempts > 0 THEN ROUND((p.correct_answers * 100.0 / p.attempts), 2)
          ELSE 0 
        END as accuracy
      FROM performance p
      WHERE p.user_id = ?
    `, [student_id, student_id]);

    // Get Crossword performance  
    const [crosswordStats] = await pool.query(`
      SELECT 
        COALESCE(SUM(cs.score), 0) as score,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM crossword_answers WHERE user_id = ?), 0) as attempts,
        COALESCE(SUM(cs.correct_answers), 0) as correct_answers,
        CASE 
          WHEN SUM(cs.attempts) > 0 THEN ROUND((SUM(cs.correct_answers) * 100.0 / SUM(cs.attempts)), 2)
          ELSE 0 
        END as accuracy
      FROM crossword_scores cs
      WHERE cs.user_id = ?
    `, [student_id, student_id]);

    res.json({
      wisdomWarfare: wisdomWarfareStats[0] || {
        score: 0,
        attempts: 0,
        correct_answers: 0,
        accuracy: 0
      },
      crossword: crosswordStats[0] || {
        score: 0,
        attempts: 0,
        correct_answers: 0,
        accuracy: 0
      }
    });
  } catch (err) {
    console.error("GET /student/:student_id/game-performance error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET: Global Leaderboard (Combined scores from both games)
app.get("/leaderboard/global", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "20", 10);

    const sql = `
      SELECT 
        u.user_id, 
        u.email, 
        u.display_name, 
        u.role,
        COALESCE(p.score, 0) as wisdom_score,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = u.user_id), 0) as wisdom_attempts,
        COALESCE(SUM(cs.score), 0) as crossword_score,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM crossword_answers WHERE user_id = u.user_id), 0) as crossword_attempts,
        (COALESCE(p.score, 0) + COALESCE(SUM(cs.score), 0)) as total_score,
        ROUND(
          (COALESCE(p.correct_answers, 0) + COALESCE(SUM(cs.correct_answers), 0)) * 100.0 / 
          NULLIF((COALESCE(p.attempts, 0) + COALESCE(SUM(cs.attempts), 0)), 0), 
          2
        ) as combined_accuracy
      FROM users u
      LEFT JOIN performance p ON u.user_id = p.user_id
      LEFT JOIN crossword_scores cs ON u.user_id = cs.user_id
      WHERE u.email IS NOT NULL 
        AND u.role = 'student'
        AND u.email != ''
      GROUP BY u.user_id, u.email, u.display_name, u.role, p.score, p.attempts, p.correct_answers, p.accuracy
      ORDER BY total_score DESC, combined_accuracy DESC
      LIMIT ?
    `;

    const [rows] = await pool.query(sql, [limit]);
    res.json(rows);
  } catch (err) {
    console.error("GET /leaderboard/global error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/game-results/wisdom-warfare", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);

    const [results] = await pool.query(
      `
      SELECT 
        u.user_id,
        u.email,
        u.display_name,
        COALESCE(SUM(a.points_earned), 0) as total_score,
        COUNT(a.answer_id) as questions_answered,
        COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
        CASE 
          WHEN COUNT(a.answer_id) > 0 THEN 
            ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
          ELSE 0 
        END as accuracy,
        MAX(a.answered_at) as last_played
      FROM users u
      LEFT JOIN answers a ON u.user_id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.email, u.display_name
      HAVING questions_answered > 0
      ORDER BY total_score DESC, accuracy DESC, last_played DESC
      LIMIT ?
    `,
      [limit]
    );

    res.json({
      game_name: "Wisdom Warfare",
      results: results,
      total_players: results.length,
    });
  } catch (err) {
    console.error("Get game results error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/download-results/wisdom-warfare", async (req, res) => {
  try {
    const [results] = await pool.query(`
      SELECT 
        u.user_id,
        u.email,
        u.display_name,
        COALESCE(SUM(a.points_earned), 0) as total_score,
        COUNT(a.answer_id) as questions_answered,
        COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
        CASE 
          WHEN COUNT(a.answer_id) > 0 THEN 
            ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
          ELSE 0 
        END as accuracy,
        MAX(a.answered_at) as last_played
      FROM users u
      LEFT JOIN answers a ON u.user_id = a.user_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.email, u.display_name
      HAVING questions_answered > 0
      ORDER BY total_score DESC, accuracy DESC, last_played DESC
    `);

  const csvHeader =
    "Rank,Student Name,Email,Total Score,Questions Answered,Correct Answers,Accuracy%,Last Played\n";
  const csvRows = results
    .map(
      (player, index) =>
        `${index + 1},"${player.display_name || "Anonymous"}","${
          player.email
        }",${player.total_score || 0},${player.questions_answered || 0},${
          player.correct_answers || 0
        },${player.accuracy || 0},"${player.last_played || "Never"}"`
    )
    .join("\n");

  const csvContent = csvHeader + csvRows;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    "attachment; filename=wisdom-warfare-results.csv"
  );
  res.send(csvContent);
} catch (err) {
  console.error("Download results error:", err);
  res.status(500).json({ error: err.message });
}
});

// ----- Auth -----
app.post("/auth/upsert-user", async (req, res) => {
  const { uid, email, display_name, role = "student" } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const connection = await pool.getConnection();
  
  try {
    // ✅ OPTIMIZED: Single query with no transaction for fastest response
    const [existingUsers] = await connection.query(
      "SELECT user_id, uid, email, display_name, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1",
      [normalizedEmail]
    );

    let user;

    if (existingUsers.length > 0) {
      user = existingUsers[0];
      
      // ✅ RESTRICTION: Prevent role mismatch
      if (user.role === "student" && role === "teacher") {
        return res.status(403).json({
          error: "You are registered as a Student. Cannot login as Teacher!",
          unauthorized: true,
        });
      }
      
      if (user.role === "teacher" && role === "student") {
        return res.status(403).json({
          error: "You are registered as a Teacher. Cannot login as Student!",
          unauthorized: true,
        });
      }
      
      // ✅ OPTIMIZED: Update asynchronously without waiting (fire and forget)
      connection.query(
        "UPDATE users SET uid = ?, display_name = ? WHERE user_id = ?",
        [uid, display_name || user.display_name, user.user_id]
      ).catch(err => console.error("Update user error:", err));
    } else {
      // ✅ RESTRICTION: Students MUST be added by teacher via CSV
      if (role === "student") {
        return res.status(403).json({
          error: "Student not Found!!",
          unauthorized: true,
        });
      }

      // ✅ Teachers can self-register
      try {
        const [result] = await connection.query(
          `INSERT INTO users (uid, email, display_name, role) VALUES (?, ?, ?, ?)`,
          [uid, normalizedEmail, display_name || normalizedEmail, role]
        );
        
        user = {
          user_id: result.insertId,
          uid: uid,
          email: normalizedEmail,
          display_name: display_name || normalizedEmail,
          role: role
        };
      } catch (insertErr) {
        console.error("Insert user error:", insertErr);
        return res.status(500).json({ error: "Failed to create user account" });
      }
    }

    // ✅ OPTIMIZED: Create performance record asynchronously for students
    if (user.role === "student") {
      connection.query(
        `INSERT IGNORE INTO performance (user_id, score, attempts, correct_answers, accuracy)
         VALUES (?, 0, 0, 0, 0)`,
        [user.user_id]
      ).catch(err => console.error("Create performance record error:", err));
    }

    // ✅ FAST RESPONSE: Return immediately without waiting for async operations
    res.json({
      ok: true,
      user_id: user.user_id,
      user: user,
    });
  } catch (err) {
    console.error("auth/upsert-user error:", err);
    res.status(500).json({ error: err.message || "Authentication failed" });
  } finally {
    connection.release();
  }
});

// ----- Verify User Session -----
app.post("/auth/verify-session", async (req, res) => {
  const { user_id, email, role } = req.body;

  if (!user_id || !email || !role) {
    return res.status(400).json({
      verified: false,
      error: "Missing required fields"
    });
  }

  try {
    const [users] = await pool.query(
      "SELECT user_id, email, display_name, role FROM users WHERE user_id = ? AND LOWER(email) = LOWER(?)",
      [user_id, email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        verified: false,
        error: "User not found"
      });
    }

    const user = users[0];

    // Verify role matches
    if (user.role !== role) {
      return res.status(401).json({
        verified: false,
        error: "Role mismatch"
      });
    }

    res.json({
      verified: true,
      user_id: user.user_id,
      email: user.email,
      display_name: user.display_name,
      role: user.role
    });
  } catch (err) {
    console.error("auth/verify-session error:", err);
    res.status(500).json({
      verified: false,
      error: err.message
    });
  }
});

// ----- Record answer -----
app.post("/record-answer", async (req, res) => {
  const {
    user_id,
    question_id,
    selected_answer,
    is_correct,
    points,
    game_name = "Wisdom Warfare",
    game_session_id,
  } = req.body;

  if (!user_id || !question_id || !selected_answer || !game_session_id) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const connection = await pool.getConnection();
  try {
    const [existingAnswers] = await connection.query(
      "SELECT * FROM answers WHERE user_id = ? AND question_id = ? AND game_session_id = ?",
      [user_id, question_id, game_session_id]
    );

    if (existingAnswers.length > 0) {
      return res.json({
        ok: false,
        error: "You have already answered this question in this game session",
        points_earned: 0,
      });
    }

    const pointsEarned = is_correct ? points || 10 : 0;

    // ✅ Record answer
    await connection.query(
      `INSERT INTO answers (user_id, question_id, selected_answer, is_correct, points_earned, game_session_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, question_id, selected_answer, is_correct, pointsEarned, game_session_id]
    );
    console.log("✅ Answer recorded successfully");

    // ✅ Update live_leaderboard (session-specific scores)
    try {
      await connection.query(
        `INSERT INTO live_leaderboard (user_id, game_session_id, game_type, game_name, current_score, questions_answered, correct_answers, accuracy)
         VALUES (?, ?, ?, ?, ?, 1, ?, 0)
         ON DUPLICATE KEY UPDATE
           current_score = current_score + VALUES(current_score),
           questions_answered = questions_answered + 1,
           correct_answers = correct_answers + VALUES(correct_answers),
           accuracy = CASE 
             WHEN (questions_answered + 1) > 0 THEN ((correct_answers + VALUES(correct_answers)) * 100.0 / (questions_answered + 1))
             ELSE 0 
           END`,
        [user_id, game_session_id, "MCQ", game_name, pointsEarned, is_correct ? 1 : 0]
      );
      console.log("✅ Live leaderboard updated");
    } catch (lbError) {
      console.error("⚠️ Live leaderboard update error (non-critical):", lbError.message);
    }

    // ✅ Update performance table (lifetime scores - will be transferred after game ends)
    try {
      await connection.query(
        `INSERT INTO performance (user_id, score, attempts, correct_answers, accuracy)
         VALUES (?, ?, 1, ?, 100)
         ON DUPLICATE KEY UPDATE
           score = score + VALUES(score),
           attempts = attempts + 1,
           correct_answers = correct_answers + VALUES(correct_answers),
           accuracy = CASE 
             WHEN (attempts + 1) > 0 THEN ((correct_answers + VALUES(correct_answers)) * 100.0 / (attempts + 1))
             ELSE 0 
           END`,
        [user_id, is_correct ? pointsEarned : 0, is_correct ? 1 : 0]
      );
      console.log("✅ Performance table updated");
    } catch (perfError) {
      console.error("⚠️ Performance update error (non-critical):", perfError.message);
    }

    // ✅ Fetch live leaderboard (session-specific scores only)
    // ✅ Fetch updated leaderboard for the game session WITH player names
    let leaderboard = [];
    try {
      const [lbData] = await connection.query(
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
         ORDER BY ll.current_score DESC, ll.accuracy DESC
         LIMIT 10`,
        [game_session_id]
      );
      leaderboard = lbData || [];
      console.log(`✅ Leaderboard fetched: ${leaderboard.length} users in session ${game_session_id}`);
    } catch (lbFetchError) {
      console.error("⚠️ Error fetching leaderboard:", lbFetchError.message);
      leaderboard = [];
    }

    res.json({
      ok: true,
      points_earned: pointsEarned,
      leaderboard: leaderboard,
    });
  } catch (err) {
    console.error("record-answer error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

// ===== LIVE LEADERBOARD ENDPOINTS =====

// GET: Live Leaderboard for a specific game session
app.get("/live-leaderboard/:gameSessionId", async (req, res) => {
  try {
    const { gameSessionId } = req.params;

    const [leaderboard] = await pool.query(
      `SELECT 
         u.user_id, u.email, u.display_name,
         ll.current_score as score,
         ll.accuracy,
         ll.correct_answers,
         ll.questions_answered as attempts
       FROM live_leaderboard ll
       JOIN users u ON ll.user_id = u.user_id
       WHERE ll.game_session_id = ? AND u.role = 'student'
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
    console.error("GET /live-leaderboard error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST: End game session and transfer scores from live_leaderboard to performance
app.post("/game/end-session/:gameSessionId", async (req, res) => {
  try {
    const { gameSessionId } = req.params;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // ✅ Get all live leaderboard entries for this session
      const [liveEntries] = await connection.query(
        `SELECT * FROM live_leaderboard WHERE game_session_id = ?`,
        [gameSessionId]
      );

      if (liveEntries.length === 0) {
        await connection.rollback();
        connection.release();
        return res.json({
          success: true,
          message: "No active players in this game session",
          transferred: 0,
        });
      }

      // ✅ Transfer each player's session scores to performance table (accumulate lifetime scores)
      for (const entry of liveEntries) {
        await connection.query(
          `INSERT INTO performance (user_id, score, attempts, correct_answers, accuracy)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             score = score + VALUES(score),
             attempts = attempts + VALUES(attempts),
             correct_answers = correct_answers + VALUES(correct_answers),
             accuracy = CASE 
               WHEN (attempts + VALUES(attempts)) > 0 THEN 
                 ((correct_answers + VALUES(correct_answers)) * 100.0 / (attempts + VALUES(attempts)))
               ELSE 0 
             END`,
          [
            entry.user_id,
            entry.current_score,
            entry.questions_answered,
            entry.correct_answers,
            entry.accuracy,
          ]
        );
      }

      await connection.commit();

      res.json({
        success: true,
        message: "Game session ended. Scores transferred to lifetime records.",
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
    console.error("POST /game/end-session error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----- User stats -----
app.get("/user/:user_id/stats", async (req, res) => {
  try {
    const userId = req.params.user_id;

    const [performanceRows] = await pool.query(
      "SELECT * FROM performance WHERE user_id = ?",
      [userId]
    );

    const [userRows] = await pool.query(
      "SELECT user_id, email, display_name, role, created_at FROM users WHERE user_id = ?",
      [userId]
    );

    const [difficultyStats] = await pool.query(
      `
      SELECT 
        q.difficulty,
        COUNT(a.answer_id) as total_answered,
        SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) as correct,
        SUM(a.points_earned) as score
      FROM answers a
      JOIN questions q ON a.question_id = q.id
      WHERE a.user_id = ?
      GROUP BY q.difficulty
    `,
      [userId]
    );

    const totalPossibleScore = 450;
    const currentScore = performanceRows[0]?.score || 0;
    const percentage =
      totalPossibleScore > 0 ? (currentScore / totalPossibleScore) * 100 : 0;

    const byDifficulty = {};
    difficultyStats.forEach((stat) => {
      byDifficulty[stat.difficulty.toLowerCase()] = {
        total: stat.total_answered,
        correct: stat.correct,
        score: stat.score,
      };
    });

    const [gameSessions] = await pool.query(
      `
      SELECT 
        game_session_id,
        COUNT(*) as questions_answered,
        SUM(points_earned) as session_score,
        SUM(CASE WHEN is_correct THEN 1 ELSE 0 END) as correct_answers,
        MAX(answered_at) as last_answered
      FROM answers 
      WHERE user_id = ?
      GROUP BY game_session_id
      ORDER BY last_answered DESC
      LIMIT 10
    `,
      [userId]
    );

    res.json({
      user: userRows[0] || null,
      performance:
        performanceRows[0] || {
          score: 0,
          attempts: 0,
          correct_answers: 0,
          accuracy: 0,
        },
      game_stats: {
        total_possible_score: totalPossibleScore,
        current_percentage: percentage.toFixed(1),
        questions_answered: performanceRows[0]?.attempts || 0,
        total_questions: 30,
        by_difficulty: byDifficulty,
      },
      game_sessions: gameSessions,
    });
  } catch (err) {
    console.error("Get user stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/teacher/games", async (req, res) => {
  const { teacher_id, game_name } = req.body;

  // ✅ FIX 1: Remove game_type validation
  if (!teacher_id || !game_name) {
    return res.status(400).json({
      error: "teacher_id and game_name are required"
    });
  }

  const connection = await pool.getConnection();
  try {
    const MAX_ATTEMPTS = 10;
    let code = null;

    // ✅ FIX 2: Generate unique 6-character game code
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateShortGameCode(6);
      const [rows] = await connection.query(
        "SELECT id FROM teacher_games WHERE game_code = ?",
        [candidate]
      );
      if (rows.length === 0) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new Error("Failed to generate a unique game code");
    }

    // ✅ FIX 3: Insert WITHOUT game_type
    const [result] = await connection.query(
      `
      INSERT INTO teacher_games (teacher_id, game_name, game_code)
      VALUES (?, ?, ?)
      `,
      [teacher_id, game_name, code]
    );

    // ✅ FIX 4: Return clean game object
    const [newRow] = await connection.query(
      `
      SELECT id, teacher_id, game_name, game_code, created_at
      FROM teacher_games
      WHERE id = ?
      `,
      [result.insertId]
    );

    res.json({
      ok: true,
      game: newRow[0]
    });
  } catch (err) {
    console.error("Error creating teacher game:", err);
    res.status(500).json({
      error: err.message || "Failed to create teacher game"
    });
  } finally {
    connection.release();
  }
});


app.get("/teacher/games", async (req, res) => {
  const teacherId = req.query.teacher_id || req.query.teacherId;

  if (!teacherId) {
    return res.status(400).json({ error: "teacher_id query param required" });
  }

  try {
    const [rows] = await pool.query(
      "SELECT * FROM teacher_games WHERE teacher_id = ? ORDER BY created_at DESC",
      [teacherId]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching teacher games:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/teacher/games/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, game: rows[0] });
  } catch (err) {
    console.error("Error fetching teacher game:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/teacher/games/:id/generate-code", async (req, res) => {
  const id = req.params.id;
  const connection = await pool.getConnection();
  try {
    const [existing] = await connection.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ error: "Teacher game not found" });
    }

    const MAX_ATTEMPTS = 10;
    let code = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateShortGameCode(6);
      const [rows] = await connection.query(
        "SELECT id FROM teacher_games WHERE game_code = ? AND id != ?",
        [candidate, id]
      );
      if (rows.length === 0) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      throw new Error(
        "Failed to generate a unique game code after multiple attempts"
      );
    }

    await connection.query(
      "UPDATE teacher_games SET game_code = ? WHERE id = ?",
      [code, id]
    );
    const [updated] = await connection.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );

    res.json({ ok: true, game: updated[0] });
  } catch (err) {
    console.error("Error regenerating code:", err);
    res.status(500).json({ error: err.message || "Failed to regenerate game code" });
  } finally {
    connection.release();
  }
});

// send-link with Nodemailer
app.post("/teacher/games/:id/send-link", async (req, res) => {
  const id = req.params.id;
  const { recipients = null, subject = null, message = null } = req.body || {};

  try {
    const [rows] = await pool.query(
      "SELECT * FROM teacher_games WHERE id = ?",
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    const game = rows[0];

    // 👉 this is where we build the link that students will use
    const clientBase =
      process.env.CLIENT_BASE_URL ||
      process.env.FRONTEND_BASE ||
      "http://localhost:3000";

    // Email should point to the Welcome page (root) instead of /play
    const playLink = `${clientBase.replace(/\/$/, "")}/`;

    // -----------------------------
    //  Resolve recipients
    // -----------------------------
    let toList = [];

    if (Array.isArray(recipients) && recipients.length > 0) {
      toList = recipients
        .map((r) => String(r).trim())
        .filter(Boolean);
    } else {
      const [students] = await pool.query(
        "SELECT email FROM users WHERE role = 'student' AND email IS NOT NULL AND TRIM(email) != ''"
      );
      toList = students.map((s) => s.email).filter(Boolean);
    }

    // If no one to mail, just return the link
    if (!toList || toList.length === 0) {
      console.log(
        `No recipients found for teacher_game id=${id}. Returning link only.`
      );
      return res.json({
        ok: true,
        link: playLink,
        game,
        sent: 0,
        message: "No recipients found; link returned.",
      });
    }

    // -----------------------------
    //  SMTP config
    // -----------------------------
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = parseInt(process.env.SMTP_PORT || "465", 10);
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpSecure =
      process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === true;

    // If SMTP is not configured, don't crash – just return the link
    if (!smtpHost || !smtpUser || !smtpPass) {
      console.warn(
        "SMTP not configured properly. Please set SMTP_HOST/SMTP_USER/SMTP_PASS in .env"
      );
      return res.json({
        ok: false,
        link: playLink,
        game,
        sent: 0,
        message:
          "SMTP not configured on server. Email not sent, but link is provided.",
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const mailSubject =
      subject || `Join the game: ${game.game_name || "Wisdom Warfare"}`;

    const mailText =
      (message ||
        `Join the game using this link: ${playLink}\n\nOr open the app and enter game code: ${game.game_code}`) +
      `\n\n--\nSent by Wisdom Warfare`;

    const mailHtml =
      (message
        ? `<p>${message}</p>`
        : `<p>Join the game using this link: <a href="${playLink}">${playLink}</a></p>
           <p>Or open the app and enter game code: <strong>${game.game_code}</strong></p>`) +
      `<hr/><p style="font-size:12px;color:#666">Sent by Wisdom Warfare</p>`;

    const first = toList[0];
    const bcc = toList.slice(1);

    const mailOptions = {
      from: process.env.EMAIL_FROM || smtpUser,
      to: first,
      bcc: bcc.length ? bcc : undefined,
      subject: mailSubject,
      text: mailText,
      html: mailHtml,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(
      "Emails sent:",
      info?.messageId || info,
      "recipients:",
      toList.length
    );

    res.json({
      ok: true,
      link: playLink,
      game,
      sent: toList.length,
      message: `Link sent to ${toList.length} recipients`,
    });
  } catch (err) {
    console.error("Error in /teacher/games/:id/send-link (send):", err);
    res.status(500).json({
      error: err.message || "Failed to send link",
    });
  }
});

// ========== SINGLE GAME CODE VALIDATION ROUTE ==========
// ✅ FIXED: Game code validation route (works for both Quiz and Crossword)
app.get("/game/code/:code", async (req, res) => {
  const { code } = req.params;

  try {
    const [rows] = await pool.query(
      `
      SELECT id, teacher_id, game_name, game_code, created_at
      FROM teacher_games
      WHERE UPPER(game_code) = UPPER(?)
      `,
      [code]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Invalid game code"
      });
    }

    res.json({
      ok: true,
      game: rows[0]
    });
  } catch (err) {
    console.error("Game code validation error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----- Upload students CSV -----
app.post("/students/upload", upload.single("file"), async (req, res) => {
  const connection = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("Processing students file:", req.file.path);

    const results = [];
    let created = 0;
    let updated = 0;
    const errors = [];

    await connection.beginTransaction();

    const processCSV = () => {
      return new Promise((resolve, reject) => {
        fs.createReadStream(req.file.path)
          .pipe(csv())
          .on("data", (data) => results.push(data))
          .on("end", async () => {
            try {
              for (let i = 0; i < results.length; i++) {
                const row = results[i];
                try {
                  const rawEmail =
                    row.email ||
                    row.Email ||
                    row.EMAIL ||
                    row.mail ||
                    row["e-mail"];
                  const displayName =
                    row.display_name ||
                    row.name ||
                    row.Name ||
                    row.fullname ||
                    row["full name"] ||
                    null;
                  let role =
                    row.role ||
                    row.Role ||
                    row.ROLE ||
                    "student";

                  if (!rawEmail) {
                    errors.push(`Row ${i + 1}: Missing email`);
                    continue;
                  }

                  const email = String(rawEmail).trim().toLowerCase();
                  role = String(role).trim().toLowerCase() || "student";

                  if (!email.includes("@")) {
                    errors.push(
                      `Row ${i + 1}: Invalid email format: ${email}`
                    );
                    continue;
                  }

                  // Check if user already exists
                  const [existing] = await connection.query(
                    "SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)",
                    [email]
                  );

                  if (existing.length > 0) {
                    const userId = existing[0].user_id;
                    await connection.query(
                      `
                        UPDATE users
                        SET display_name = COALESCE(?, display_name),
                            role = ?
                        WHERE user_id = ?
                      `,
                      [displayName, role, userId]
                    );
                    updated++;
                  } else {
                    const [insertRes] = await connection.query(
                      `
                        INSERT INTO users (uid, email, display_name, role)
                        VALUES (?, ?, ?, ?)
                      `,
                      [null, email, displayName || email, role]
                    );
                    const newUserId = insertRes.insertId;

                    if (role === "student") {
                      await connection.query(
                        `
                          INSERT IGNORE INTO performance (user_id, score, attempts, correct_answers, accuracy)
                          VALUES (?, 0, 0, 0, 0)
                        `,
                        [newUserId]
                      );
                    }
                    created++;
                  }
                } catch (rowError) {
                  errors.push(`Row ${i + 1}: ${rowError.message}`);
                }
              }
              resolve();
            } catch (processError) {
              reject(processError);
            }
          })
          .on("error", (err) => reject(err));
      });
    };

    await processCSV();
    await connection.commit();

    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      console.warn("Could not delete uploaded student file:", e.message);
    }

    res.json({
      success: true,
      message: "Student upload completed",
      created,
      updated,
      total: results.length,
      errors,
    });
  } catch (err) {
    await connection.rollback();
    console.error("students/upload error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to upload students: " + err.message,
    });
  } finally {
    connection.release();
  }
});

// ----- Simple /me endpoint -----
app.get("/me", async (req, res) => {
  try {
    // Try to find any teacher user
    const [teachers] = await pool.query(
      "SELECT user_id, email, display_name, role FROM users WHERE role = 'teacher' ORDER BY user_id ASC LIMIT 1"
    );

    let user;

    if (teachers.length > 0) {
      user = teachers[0];
    } else {
      // If no teacher exists, create a default one
      const defaultEmail = "teacher@example.com";
      const [insertRes] = await pool.query(
        `
          INSERT INTO users (uid, email, display_name, role)
          VALUES (?, ?, ?, 'teacher')
        `,
        [null, defaultEmail, "Default Teacher"]
      );
      const [rows] = await pool.query(
        "SELECT user_id, email, display_name, role FROM users WHERE user_id = ?",
        [insertRes.insertId]
      );
      user = rows[0];
    }

    res.json({ user });
  } catch (err) {
    console.error("/me error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----- Cleanup users endpoint -----
app.post("/admin/cleanup-users", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Example logic: keep the lowest user_id per email, mark others as duplicates.
    const [dups] = await connection.query(`
      SELECT email, COUNT(*) as cnt
      FROM users
      WHERE email IS NOT NULL AND TRIM(email) != ''
      GROUP BY email
      HAVING cnt > 1
    `);

    let affected = 0;

    for (const row of dups) {
      const email = row.email;
      const [users] = await connection.query(
        "SELECT user_id FROM users WHERE email = ? ORDER BY user_id ASC",
        [email]
      );
      if (users.length <= 1) continue;

      const keepId = users[0].user_id;
      const toRemove = users.slice(1).map((u) => u.user_id);

      if (toRemove.length === 0) continue;

      // Reassign performance / answers / scores to the kept user_id if needed.
      await connection.query(
        "UPDATE answers SET user_id = ? WHERE user_id IN (?)",
        [keepId, toRemove]
      );
      await connection.query(
        "UPDATE scores SET user_id = ? WHERE user_id IN (?)",
        [keepId, toRemove]
      );
      await connection.query(
        "UPDATE performance SET user_id = ? WHERE user_id IN (?)",
        [keepId, toRemove]
      );

      // Delete duplicate rows
      await connection.query("DELETE FROM users WHERE user_id IN (?)", [
        toRemove,
      ]);

      affected += toRemove.length;
    }

    await connection.commit();

    res.json({
      success: true,
      message: `Cleanup completed. Removed ${affected} duplicate user records.`,
      affected,
    });
  } catch (err) {
    await connection.rollback();
    console.error("/admin/cleanup-users error:", err);
    res.status(500).json({
      success: false,
      message: "Cleanup failed: " + err.message,
    });
  } finally {
    connection.release();
  }
});

// ==========================================
// ==========================================
// ----- TEACHER ANALYTICS ENDPOINTS -----
// ==========================================

// GET: Teacher overall analytics
app.get("/teacher/:teacher_id/analytics", async (req, res) => {
  const { teacher_id } = req.params;
  const { timeRange = 'week' } = req.query; // Get timeRange from query params, default to 'week'
  console.log('📊 Analytics request for teacher:', teacher_id, 'timeRange:', timeRange);

  try {
    // Calculate date ranges based on timeRange parameter
    const now = new Date();
    let dateFilter = null;
    
    if (timeRange === 'week') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'month') {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timeRange === 'all') {
      dateFilter = new Date('1970-01-01'); // Far past to get all records
    }

    // Get total students count (not filtered by date)
    const [students] = await pool.query(
      "SELECT COUNT(*) as total FROM users WHERE role = 'student'"
    );
    
    // Get total questions answered from answers table (filtered by timeRange)
    const [answers] = await pool.query(
      "SELECT COUNT(*) as total FROM answers WHERE answered_at >= ?",
      [dateFilter]
    );
    
    // Get total crossword answers (filtered by timeRange)
    const [crosswordAnswers] = await pool.query(
      "SELECT COUNT(*) as total FROM crossword_answers WHERE answered_at >= ?",
      [dateFilter]
    );
    const totalQuestionsAnswered = (answers[0]?.total || 0) + (crosswordAnswers[0]?.total || 0);
    
    // Get average accuracy from performance table (filtered by timeRange)
    const [accuracy] = await pool.query(
      "SELECT AVG(accuracy) as avg FROM performance WHERE accuracy > 0 AND last_updated >= ?",
      [dateFilter]
    );
    
    // Get total games played (filtered by timeRange)
    const [games] = await pool.query(
      "SELECT COUNT(DISTINCT game_session_id) as total FROM answers WHERE answered_at >= ?",
      [dateFilter]
    );
    const [crosswordGames] = await pool.query(
      "SELECT COUNT(DISTINCT game_session_id) as total FROM crossword_answers WHERE answered_at >= ?",
      [dateFilter]
    );
    const totalGamesPlayed = (games[0]?.total || 0) + (crosswordGames[0]?.total || 0);

    // Calculate trends (last 30 days vs previous 30 days)
    const now2 = new Date();
    const thirtyDaysAgo = new Date(now2.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now2.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Current period students
    const [currentStudents] = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'student' AND created_at >= ?",
      [thirtyDaysAgo]
    );
    
    // Previous period students
    const [prevStudents] = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'student' AND created_at BETWEEN ? AND ?",
      [sixtyDaysAgo, thirtyDaysAgo]
    );

    // Current period answers
    const [currentAnswers] = await pool.query(
      "SELECT COUNT(*) as count FROM answers WHERE answered_at >= ?",
      [thirtyDaysAgo]
    );
    const [prevAnswers] = await pool.query(
      "SELECT COUNT(*) as count FROM answers WHERE answered_at BETWEEN ? AND ?",
      [sixtyDaysAgo, thirtyDaysAgo]
    );

    // Current period accuracy
    const [currentAcc] = await pool.query(
      "SELECT AVG(accuracy) as avg FROM performance WHERE last_updated >= ? AND accuracy > 0",
      [thirtyDaysAgo]
    );
    const [prevAcc] = await pool.query(
      "SELECT AVG(accuracy) as avg FROM performance WHERE last_updated BETWEEN ? AND ? AND accuracy > 0",
      [sixtyDaysAgo, thirtyDaysAgo]
    );

    // Current period games
    const [currentGames] = await pool.query(
      "SELECT COUNT(DISTINCT game_session_id) as count FROM answers WHERE answered_at >= ?",
      [thirtyDaysAgo]
    );
    const [prevGames] = await pool.query(
      "SELECT COUNT(DISTINCT game_session_id) as count FROM answers WHERE answered_at BETWEEN ? AND ?",
      [sixtyDaysAgo, thirtyDaysAgo]
    );

    const calculateChange = (current, previous) => {
      if (previous === 0) return 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    // Get daily activity based on timeRange
    const [dailyActivity] = await pool.query(`
      SELECT 
        DATE_FORMAT(DATE(answered_at), '%b %d') as date,
        COUNT(*) as answers,
        SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct,
        ROUND(AVG(CASE WHEN is_correct = 1 THEN 100 ELSE 0 END), 1) as accuracy
      FROM answers
      WHERE answered_at >= ?
      GROUP BY DATE_FORMAT(DATE(answered_at), '%b %d')
      ORDER BY DATE_FORMAT(DATE(answered_at), '%b %d') ASC
    `, [dateFilter]);

    // Get difficulty breakdown (filtered by timeRange)
    const [difficultyBreakdown] = await pool.query(`
      SELECT 
        q.difficulty,
        COUNT(a.answer_id) as total,
        SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as correct,
        SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) as wrong
      FROM questions q
      LEFT JOIN answers a ON q.id = a.question_id AND a.answered_at >= ?
      GROUP BY q.difficulty
    `, [dateFilter]);

    console.log('✅ Sending analytics response with real data');
    res.json({
      overview: {
        totalStudents: students[0]?.total || 0,
        totalQuestionsAnswered: totalQuestionsAnswered,
        avgAccuracy: parseFloat(accuracy[0]?.avg || 0),
        totalGamesPlayed: totalGamesPlayed,
        prevPeriodComparison: {
          students: parseFloat(calculateChange(currentStudents[0]?.count || 0, prevStudents[0]?.count || 0)),
          questions: parseFloat(calculateChange(currentAnswers[0]?.count || 0, prevAnswers[0]?.count || 0)),
          accuracy: parseFloat(calculateChange(currentAcc[0]?.avg || 0, prevAcc[0]?.avg || 0)),
          games: parseFloat(calculateChange(currentGames[0]?.count || 0, prevGames[0]?.count || 0))
        }
      },
      dailyActivity: dailyActivity || [],
      difficultyBreakdown: difficultyBreakdown || []
    });

  } catch (error) {
    console.error("❌ Analytics error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Student performance data
app.get("/teacher/:teacher_id/analytics/students", async (req, res) => {
  try {
    const [students] = await pool.query(`
      SELECT 
        u.user_id as id,
        COALESCE(u.display_name, u.email, 'Unknown') as name,
        u.email,
        COALESCE(p.score, 0) as totalScore,
        COALESCE(p.attempts, 0) as attempted,
        COALESCE(p.correct_answers, 0) as correct,
        COALESCE(p.attempts - p.correct_answers, 0) as wrong,
        COALESCE(p.accuracy, 0) as accuracy,
        COALESCE(
          (SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = u.user_id), 0
        ) as gamesPlayed,
        COALESCE(
          (SELECT AVG(TIMESTAMPDIFF(SECOND, answered_at, answered_at + INTERVAL 5 SECOND)) 
           FROM answers WHERE user_id = u.user_id), 0
        ) as avgTime
      FROM users u
      LEFT JOIN performance p ON u.user_id = p.user_id
      WHERE u.role = 'student'
      ORDER BY p.score DESC
    `);
    
    res.json(students);
  } catch (error) {
    console.error("❌ Student analytics error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Game-specific student data breakdown
app.get("/teacher/:teacher_id/analytics/students-game-breakdown", async (req, res) => {
  try {
    const [students] = await pool.query(`
      SELECT 
        u.user_id as id,
        COALESCE(u.display_name, u.email, 'Unknown') as name,
        u.email,
        -- Wisdom Warfare stats (one row per user in performance table)
        COALESCE(p.score, 0) as wisdomScore,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = u.user_id), 0) as wisdomGames,
        COALESCE(p.correct_answers, 0) as wisdomCorrect,
        COALESCE(p.accuracy, 0) as wisdomAccuracy,
        -- Crossword stats (aggregated from multiple rows per user)
        COALESCE(SUM(cs.score), 0) as crosswordScore,
        COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM crossword_answers WHERE user_id = u.user_id), 0) as crosswordGames,
        COALESCE(SUM(cs.correct_answers), 0) as crosswordCorrect,
        COALESCE(
          CASE
            WHEN SUM(cs.attempts) > 0
            THEN ROUND(SUM(cs.correct_answers) * 100 / SUM(cs.attempts), 2)
            ELSE 0
          END,
          0
        ) as crosswordAccuracy,
        -- Combined totals
        (COALESCE(p.score, 0) + COALESCE(SUM(cs.score), 0)) as totalScore,
        (COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM answers WHERE user_id = u.user_id), 0) + 
         COALESCE((SELECT COUNT(DISTINCT game_session_id) FROM crossword_answers WHERE user_id = u.user_id), 0)) as totalGames,
        COALESCE(
          CASE
            WHEN (COALESCE(p.attempts, 0) + COALESCE(SUM(cs.attempts), 0)) > 0
            THEN ROUND(((COALESCE(p.correct_answers, 0) + COALESCE(SUM(cs.correct_answers), 0)) * 100 / 
                   (COALESCE(p.attempts, 0) + COALESCE(SUM(cs.attempts), 0))), 2)
            ELSE 0
          END, 
          0
        ) as combinedAccuracy
      FROM users u
      LEFT JOIN performance p ON u.user_id = p.user_id
      LEFT JOIN crossword_scores cs ON u.user_id = cs.user_id
      WHERE u.role = 'student'
      GROUP BY u.user_id, u.display_name, u.email, p.score, p.attempts, p.correct_answers, p.accuracy
      ORDER BY (COALESCE(p.score, 0) + COALESCE(SUM(cs.score), 0)) DESC
    `);
    
    res.json(students);
  } catch (error) {
    console.error("❌ Student game breakdown error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Question analytics
app.get("/teacher/:teacher_id/analytics/questions", async (req, res) => {
  try {
    const [questions] = await pool.query(`
      SELECT 
        q.id,
        q.text,
        q.difficulty,
        COUNT(a.answer_id) as totalAttempts,
        SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as correctCount,
        SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) as wrongCount,
        ROUND(
          COALESCE(
            SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(a.answer_id), 0), 
            0
          ), 1
        ) as successRate,
        ROUND(
          COALESCE(
            AVG(TIMESTAMPDIFF(SECOND, a.answered_at, a.answered_at + INTERVAL 5 SECOND)), 
            0
          ), 2
        ) as avgTime
      FROM questions q
      LEFT JOIN answers a ON q.id = a.question_id
      GROUP BY q.id, q.text, q.difficulty
      ORDER BY q.id
    `);
    
    res.json(questions);
  } catch (error) {
    console.error("❌ Question analytics error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Improvement trends
app.get("/teacher/:teacher_id/analytics/improvements", async (req, res) => {
  try {
    const [improvements] = await pool.query(`
      SELECT 
        COALESCE(u.display_name, u.email, 'Unknown') as name,
        COALESCE(p.score, 0) as improvement
      FROM users u
      JOIN performance p ON u.user_id = p.user_id
      WHERE u.role = 'student' AND p.score > 0
      ORDER BY p.score DESC
      LIMIT 10
    `);
    
    res.json(improvements);
  } catch (error) {
    console.error("❌ Improvement trends error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Topics performance analytics
app.get("/teacher/:teacher_id/analytics/topics", async (req, res) => {
  try {
    // Get all unique topics with their performance metrics
    const [topicsData] = await pool.query(`
      SELECT 
        q.topic,
        COUNT(a.answer_id) as total_attempts,
        SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) as correct_answers
      FROM questions q
      LEFT JOIN answers a ON q.id = a.question_id
      WHERE q.topic IS NOT NULL AND q.topic != ''
      GROUP BY q.topic
      ORDER BY q.topic ASC
    `);

    // Calculate percentages
    const totalAttempts = topicsData.reduce((sum, t) => sum + t.total_attempts, 0);
    
    const topicsWithPercentages = topicsData.map(topic => {
      const attemptPercentage = totalAttempts > 0 
        ? Math.round((topic.total_attempts / totalAttempts) * 100) 
        : 0;
      const accuracyPercentage = topic.total_attempts > 0
        ? Math.round((topic.correct_answers / topic.total_attempts) * 100)
        : 0;
      
      return {
        topic: topic.topic,
        attempts: topic.total_attempts,
        correctAnswers: topic.correct_answers,
        attemptPercentage: attemptPercentage,
        accuracyPercentage: accuracyPercentage
      };
    });

    res.json(topicsWithPercentages);
  } catch (error) {
    console.error("❌ Topics analytics error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET: Last game session analytics (per-player last session)
// GET: Answers count
app.get("/answers/count", async (req, res) => {
  try {
    const [result] = await pool.query("SELECT COUNT(*) as count FROM answers");
    res.json({ count: result[0]?.count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: All answers
app.get("/answers", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, q.text as question_text, q.correct as correct_answer
      FROM answers a
      JOIN questions q ON a.question_id = q.id
      ORDER BY a.answered_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Performance average
app.get("/performance/average", async (req, res) => {
  try {
    const [result] = await pool.query("SELECT AVG(accuracy) as avgAccuracy FROM performance WHERE accuracy > 0");
    res.json({ avgAccuracy: result[0]?.avgAccuracy || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Games played count
app.get("/games/played/count", async (req, res) => {
  try {
    const [result] = await pool.query("SELECT COUNT(DISTINCT game_session_id) as count FROM answers");
    res.json({ count: result[0]?.count || 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: All games
app.get("/games", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT DISTINCT game_name FROM teacher_games");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: All scores
app.get("/scores", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM scores ORDER BY last_updated DESC");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: All performance stats
app.get("/performance", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM performance");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Users by role
app.get("/users", async (req, res) => {
  const { role } = req.query;
  try {
    let query = "SELECT * FROM users";
    const params = [];
    
    if (role) {
      query += " WHERE role = ?";
      params.push(role);
    }
    
    query += " ORDER BY created_at DESC";
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Period data for comparison
app.get("/analytics/period", async (req, res) => {
  const { start, end } = req.query;
  try {
    // Students count
    const [students] = await pool.query(
      "SELECT COUNT(*) as students FROM users WHERE role = 'student' AND created_at BETWEEN ? AND ?",
      [start, end]
    );
    
    // Questions answered
    const [questions] = await pool.query(
      "SELECT COUNT(*) as questions FROM answers WHERE answered_at BETWEEN ? AND ?",
      [start, end]
    );
    
    // Average accuracy
    const [accuracy] = await pool.query(
      "SELECT AVG(accuracy) as accuracy FROM performance WHERE last_updated BETWEEN ? AND ? AND accuracy > 0",
      [start, end]
    );
    
    // Games played
    const [games] = await pool.query(
      "SELECT COUNT(DISTINCT game_session_id) as games FROM answers WHERE answered_at BETWEEN ? AND ?",
      [start, end]
    );
    
    res.json({
      students: students[0]?.students || 0,
      questions: questions[0]?.questions || 0,
      accuracy: accuracy[0]?.accuracy || 0,
      games: games[0]?.games || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Detailed answers for a specific question
app.get("/teacher/analytics/question/:questionId/answers", async (req, res) => {
  const { questionId } = req.params;
  try {
    const [answers] = await pool.query(`
      SELECT 
        a.user_id,
        COALESCE(u.display_name, u.email, 'Unknown') as name,
        a.selected_answer,
        a.is_correct,
        a.points_earned,
        q.correct as correct_answer
      FROM answers a
      JOIN users u ON a.user_id = u.user_id
      JOIN questions q ON a.question_id = q.id
      WHERE a.question_id = ?
      ORDER BY a.answered_at DESC
    `, [questionId]);
    
    res.json(answers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Student's answers by type
app.get("/user/:userId/answers", async (req, res) => {
  const { userId } = req.params;
  const { type } = req.query;
  
  try {
    let query = `
      SELECT 
        a.question_id,
        q.text as question_text,
        q.difficulty,
        a.selected_answer,
        q.correct as correct_answer,
        a.is_correct,
        a.points_earned
      FROM answers a
      JOIN questions q ON a.question_id = q.id
      WHERE a.user_id = ?
    `;
    
    const params = [userId];
    
    if (type === 'correct') {
      query += " AND a.is_correct = 1";
    } else if (type === 'wrong') {
      query += " AND a.is_correct = 0";
    }
    
    query += " ORDER BY a.answered_at DESC";
    
    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ----- SOCKET.IO -----
// ==========================================

io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.emit("gameStatus", {
    questionsLoaded: questions.length,
    currentIndex: currentIndex,
    acceptingAnswers: acceptingAnswers,
    gameSessionId: gameSessionId,
    isGameActive: isGameActive,
    currentQuestion:
      currentIndex >= 0 && currentIndex < questions.length
        ? questions[currentIndex]
        : null,
  });

  // Send crossword game if active
  if (crosswordGameActive && crosswordGrid && crosswordPlacedWords) {
    console.log(`📤 Sending active crossword game to ${socket.id}`);
    
    // Transform data for frontend compatibility
    const gridArray = crosswordGrid.map(row => 
      row.map(cell => {
        if (cell.isBlack) return '#';
        return cell.letter || ' '; // Use space for empty white cells instead of '.'
      })
    );
    
    const cellNumbers = {};
    crosswordGrid.forEach((row, rIdx) => {
      row.forEach((cell, cIdx) => {
        if (cell.number && cell.number > 0) {
          cellNumbers[`${rIdx}-${cIdx}`] = cell.number;
        }
      });
    });
    
    const acrossClues = crosswordPlacedWords
      .filter(w => w.direction === 'across')
      .map(w => ({
        number: w.number,
        clue: w.clue,
        answer: w.word,
        startRow: w.startRow,
        startCol: w.startCol,
        length: w.length,
        direction: 'across'
      }));
    
    const downClues = crosswordPlacedWords
      .filter(w => w.direction === 'down')
      .map(w => ({
        number: w.number,
        clue: w.clue,
        answer: w.word,
        startRow: w.startRow,
        startCol: w.startCol,
        length: w.length,
        direction: 'down'
      }));
    
    // Emit in new format
    socket.emit("crosswordGameStarted", {
      sessionId: crosswordGameSessionId,
      grid: gridArray,
      words: crosswordPlacedWords,
      totalWords: crosswordPlacedWords.length,
      gridSize: crosswordGrid.length,
    });
    
    // Also emit in old format for existing frontend compatibility
    socket.emit("crosswordGrid", {
      grid: gridArray,
      acrossClues,
      downClues,
      cellNumbers,
      clues: [...acrossClues, ...downClues]
    });
  }

  if (
    isGameActive &&
    currentIndex >= 0 &&
    currentIndex < questions.length &&
    questions[currentIndex] &&
    acceptingAnswers
  ) {
    const q = questions[currentIndex];
    const correctAnswerText = getCorrectAnswerText(q);

    console.log(
      "📤 Sending current question to new connection - CORRECT ANSWER:",
      correctAnswerText
    );

    socket.emit("newQuestion", {
      id: q.id,
      text: q.text,
      options: {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      },
      correct: q.correct,
      correctAnswer: correctAnswerText,
      difficulty: q.difficulty || "Medium",
      time: 10, // ✅ 10 seconds to match frontend timer
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
      gameSessionId: gameSessionId,
    });
  }

  // ✅ Handle player joining the game - create live_leaderboard entry
  socket.on("joinGame", async ({ game_code, user_id, email, display_name, game_type, previously_exited }) => {
    try {
      if (!user_id || !game_code) {
        console.warn("⚠️ joinGame: Missing user_id or game_code");
        return;
      }

      console.log(`📥 Player joining: user_id=${user_id}, email=${email}, game_code=${game_code}, game_type=${game_type}, previously_exited=${previously_exited}`);

      // ✅ CRITICAL: Join the game room IMMEDIATELY regardless of game state
      socket.join(`game_${game_code}`);
      console.log(`✅ Socket ${socket.id} joined room: game_${game_code}`);

      // ✅ Get per-game state (may not exist yet if teacher hasn't started)
      const gameState = game_code ? gameStates.get(game_code) : null;
      const sessionId = gameState ? gameState.gameSessionId : gameSessionId;

      if (!sessionId) {
        console.warn("⚠️ joinGame: No session yet for code:", game_code, "- waiting for teacher to start game");
        return;
      }

      // Only register for Wisdom Warfare (MCQ) games
      if (game_type === "Wisdom Warfare" && sessionId) {

        // ✅ If player previously exited, do NOT re-insert them into leaderboard
        // They must wait for a fresh game start - no leaderboard entry until then
        if (!previously_exited) {
          // ✅ IMPORTANT: Delete any old entry from this user for this session to ensure fresh start
          try {
            await pool.query(
              `DELETE FROM live_leaderboard WHERE user_id = ? AND game_session_id = ?`,
              [user_id, sessionId]
            );
            console.log(`🧹 Cleared old leaderboard entry for user ${user_id} in session ${sessionId}`);
          } catch (deleteError) {
            console.warn("⚠️ Error deleting old leaderboard entry:", deleteError.message);
          }

          // Create or update live_leaderboard entry with initial score of 0
          try {
            await pool.query(
              `INSERT INTO live_leaderboard (user_id, game_session_id, game_type, game_name, current_score, questions_answered, correct_answers, accuracy)
               VALUES (?, ?, ?, ?, 0, 0, 0, 0)`,
              [user_id, sessionId, "MCQ", "Wisdom Warfare"]
            );
            console.log(`✅ Created NEW leaderboard entry for user ${user_id}, session=${sessionId}`);
          } catch (lbInsertError) {
            console.error("⚠️ Error creating leaderboard entry:", lbInsertError.message);
            return;
          }

          // Fetch and broadcast updated leaderboard to all players WITH names
          try {
            const [leaderboard] = await pool.query(
              `SELECT ll.user_id, ll.current_score as score, ll.accuracy, ll.correct_answers, ll.questions_answered as attempts,
                      COALESCE(u.display_name, CONCAT('Player_', ll.user_id)) as display_name,
                      u.email
               FROM live_leaderboard ll
               LEFT JOIN users u ON ll.user_id = u.user_id
               WHERE ll.game_session_id = ?
               ORDER BY ll.current_score DESC, ll.accuracy DESC`,
              [sessionId]
            );

            // ✅ Broadcast updated leaderboard only to this game room
            io.to(`game_${game_code}`).emit("leaderboardUpdate", leaderboard);
            console.log(`📊 Broadcast to game_${game_code}: ${leaderboard.length} players in leaderboard with names`);
          } catch (fetchError) {
            console.error("⚠️ Error fetching leaderboard:", fetchError.message);
          }
        } else {
          console.log(`🚫 Player ${user_id} previously exited - skipping leaderboard registration`);
        }

        // ✅ CRITICAL: Only send current question if player did NOT intentionally exit
        // If they exited, they must wait for teacher to start a NEW game
        if (previously_exited) {
          console.log(`🚫 Player ${user_id} previously exited - NOT sending current question. Must wait for fresh game start.`);
        } else if (gameState && questions.length > 0 && gameState.currentIndex >= 0 && gameState.currentIndex < questions.length) {
          const q = questions[gameState.currentIndex];
          const correctAnswerText = getCorrectAnswerText(q);
          console.log(`📤 Sending current question ${gameState.currentIndex + 1}/${questions.length} to rejoining player`);
          socket.emit("newQuestion", {
            game_code: game_code,
            id: q.id,
            text: q.text,
            options: {
              A: q.option_a,
              B: q.option_b,
              C: q.option_c,
              D: q.option_d,
            },
            correct: q.correct,
            correctAnswer: correctAnswerText,
            difficulty: q.difficulty || "Medium",
            time: 10,
            questionNumber: gameState.currentIndex + 1,
            totalQuestions: questions.length,
            gameSessionId: gameState.gameSessionId,
            showNextButton: false,
          });
          console.log(`✅ Rejoining player added to game_${game_code} with current question`);
        } else {
          console.log(`⏳ Game state not ready yet - player waiting for first question (Q0, currentIndex: ${gameState?.currentIndex ?? 'none'})`);
        }
      }
    } catch (err) {
      console.error("❌ joinGame error:", err);
    }
  });

  socket.on("getGameStatus", ({ game_code } = {}) => {
    // ✅ Get per-game state if game_code provided
    let state;
    if (game_code && gameStates.has(game_code)) {
      state = gameStates.get(game_code);
    } else {
      // Fallback to global state
      state = {
        gameSessionId,
        currentIndex,
        acceptingAnswers,
        isGameActive
      };
    }

    socket.emit("gameStatus", {
      game_code: game_code || null,
      questionsLoaded: questions.length,
      currentIndex: state.currentIndex,
      acceptingAnswers: state.acceptingAnswers,
      gameSessionId: state.gameSessionId,
      isGameActive: state.isGameActive,
      currentQuestion:
        state.currentIndex >= 0 && state.currentIndex < questions.length
          ? questions[state.currentIndex]
          : null,
    });
  });

  // Updated submitAnswer with game type check
  socket.on("submitAnswer", async ({ user_id, answer, email, display_name, game_code, game_name = "Wisdom Warfare" }) => {
    try {
      console.log("✅ User hasn't played, allowing answer");
      
      // Use per-game state if game_code provided
      const isUsingPerGameState = game_code && gameStates.has(game_code);
      const gameState = isUsingPerGameState ? gameStates.get(game_code) : null;
      const acceptingAnswersCheck = isUsingPerGameState ? gameState.acceptingAnswers : acceptingAnswers;
      const currentIndexCheck = isUsingPerGameState ? gameState.currentIndex : currentIndex;
      const gameSessionIdCheck = isUsingPerGameState ? gameState.gameSessionId : gameSessionId;
      const answeredUsersCheck = isUsingPerGameState ? gameState.answeredUsers : answeredUsers;
      const firstAnsweredCheck = isUsingPerGameState ? gameState.firstAnswered : firstAnswered;
      const currentQuestionStartTimeCheck = isUsingPerGameState ? gameState.currentQuestionStartTime : currentQuestionStartTime;
      
      if (
        !acceptingAnswersCheck ||
        currentIndexCheck >= questions.length ||
        !questions[currentIndexCheck]
      ) {
        socket.emit("answerResult", {
          game_code: game_code || null,
          user_id: user_id,
          email: email,
          error: "No active question",
          showNextButton: true,
        });
        return;
      }

      const questionKey = `${user_id}-${questions[currentIndexCheck].id}-${gameSessionIdCheck}`;
      if (answeredUsersCheck.has(questionKey)) {
        socket.emit("answerResult", {
          game_code: game_code || null,
          user_id: user_id,
          email: email,
          error: "You have already answered this question!",
          showNextButton: true,
        });
        return;
      }

      answeredUsersCheck.set(questionKey, true);

      const currentQuestion = questions[currentIndexCheck];
      const userAnswer = answer.toUpperCase().trim();
      const correctAnswerKey = currentQuestion.correct
        .toString()
        .toUpperCase()
        .trim();

      let isCorrect = false;

      if (
        (correctAnswerKey === "OPTION_A" || correctAnswerKey === "A") &&
        userAnswer === "A"
      )
        isCorrect = true;
      else if (
        (correctAnswerKey === "OPTION_B" || correctAnswerKey === "B") &&
        userAnswer === "B"
      )
        isCorrect = true;
      else if (
        (correctAnswerKey === "OPTION_C" || correctAnswerKey === "C") &&
        userAnswer === "C"
      )
        isCorrect = true;
      else if (
        (correctAnswerKey === "OPTION_D" || correctAnswerKey === "D") &&
        userAnswer === "D"
      )
        isCorrect = true;

      console.log("🎯 Answer submitted:", {
        user_id,
        userAnswer,
        correctAnswer: correctAnswerKey,
        isCorrect,
        questionId: currentQuestion.id,
        gameSessionId: gameSessionIdCheck,
        game_code: game_code
      });

      let points = 10;
      const answerTime = Date.now() - currentQuestionStartTimeCheck;
      if (isCorrect && answerTime < 5000 && !firstAnsweredCheck) {
        points += 5;
        if (gameState) {
          gameState.firstAnswered = true;
        } else {
          firstAnswered = true;
        }
      }

      try {
        const response = await fetch(`${getServerBase()}/record-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: parseInt(user_id),
            question_id: currentQuestion.id,
            selected_answer: answer,
            is_correct: isCorrect,
            points: points,
            game_name: "Wisdom Warfare",
            game_session_id: gameSessionIdCheck,
          }),
        });

        const result = await response.json();

        if (result.ok) {
          const correctAnswerText = getCorrectAnswerText(currentQuestion);

          console.log(
            "✅ Sending answer result - CORRECT ANSWER TEXT:",
            correctAnswerText
          );

          if (isCorrect) {
            socket.emit("answerResult", {
              game_code: game_code || null,
              user_id: user_id,
              email: email,
              message: `✅ Correct! +${points} points`,
              correct: true,
              points: points,
              correctAnswer: correctAnswerText,
              showNextButton: true,
            });
          } else {
            socket.emit("answerResult", {
              game_code: game_code || null,
              user_id: user_id,
              email: email,
              message: `❌ Wrong answer! Correct was: ${correctAnswerText}`,
              correct: false,
              points: 0,
              correctAnswer: correctAnswerText,
              showNextButton: true,
            });
          }

          if (result.leaderboard) {
            // ✅ DEBOUNCED: Batch leaderboard broadcasts within 500ms window
            // Instead of broadcasting on every single answer, batches rapid updates
            if (game_code) {
              const gameState = gameStates.get(game_code);
              const sessionId = gameState ? gameState.gameSessionId : null;
              if (sessionId) {
                scheduleLeaderboardBroadcast(game_code, sessionId);
              } else {
                // Fallback: broadcast immediately if no session found
                io.to(`game_${game_code}`).emit("leaderboardUpdate", result.leaderboard);
              }
              console.log(`📊 Leaderboard update scheduled for game_${game_code}`);
            } else {
              io.emit("leaderboardUpdate", result.leaderboard); // Fallback
            }
          }
        } else {
          socket.emit("answerResult", {
            game_code: game_code || null,
            user_id: user_id,
            email: email,
            error: result.error,
            showNextButton: true,
          });
        }
      } catch (dbError) {
        console.error("Database record error:", dbError);
        socket.emit("answerResult", {
          game_code: game_code || null,
          user_id: user_id,
          email: email,
          error: "Error recording answer",
          showNextButton: true,
        });
      }
    } catch (err) {
      console.error("submitAnswer error:", err);
      socket.emit("answerResult", {
        game_code: game_code || null,
        user_id: user_id,
        email: email,
        error: "Server error processing answer",
        showNextButton: true,
      });
    }
  });

  socket.on("nextQuestion", ({ game_code } = {}) => {
    console.log("Next question requested by:", socket.id, "for game:", game_code);
    
    // ⚠️ CRITICAL: Do NOT auto-advance based on client request!
    // The backend timer controls advancement to ensure all players get the full time window.
    // This prevents early advancement when one player's timer fires first.
    
    console.log(`⏰ nextQuestion request ignored - backend timer controls advancement (game: ${game_code})`);
    // No-op - let the backend timer handle advancement via endCurrentQuestion()
  });

  socket.on("adminStartGame", () => {
    console.log("Admin starting game via socket");
    if (questions.length > 0) {
      startNewGameSession();
    } else {
      socket.emit("gameError", { error: "No questions available" });
    }
  });

  // ==========================================
  // ----- CROSSWORD SOCKET EVENTS -----
  // ==========================================

  socket.on("getCrosswordGame", () => {
    if (crosswordGameActive && crosswordGrid && crosswordPlacedWords) {
      console.log(`📤 Sending crossword game to client: ${socket.id}`);
      socket.emit("crosswordGameStarted", {
        sessionId: crosswordGameSessionId,
        grid: crosswordGrid,
        words: crosswordPlacedWords,
        totalWords: crosswordPlacedWords.length,
        gridSize: crosswordGrid.length,
      });
    } else {
      socket.emit("noCrosswordGame", { message: "No active crossword game" });
    }
  });

  socket.on("submitCrosswordAnswer", async ({ user_id, email, display_name, answers }) => {
    try {
      console.log(`✅ Crossword answers submitted by ${email}`);

      if (!crosswordGameActive) {
        socket.emit("crosswordError", { error: "No active crossword game" });
        return;
      }

      // Store user's answers
      const userAnswers = crosswordAnswers.get(user_id) || { answers: {}, score: 0 };
      userAnswers.answers = answers;

      // Calculate score based on correct answers
      let correctCount = 0;
      for (const word of crosswordPlacedWords) {
        const wordAnswer = (answers[word.number] || "").toUpperCase().trim();
        const correctAnswer = word.word.toUpperCase().trim();
        
        if (wordAnswer === correctAnswer) {
          correctCount++;
        }
      }

      userAnswers.score = correctCount;
      crosswordAnswers.set(user_id, userAnswers);

      const accuracy = crosswordPlacedWords.length > 0 
        ? ((correctCount / crosswordPlacedWords.length) * 100).toFixed(1)
        : 0;

      console.log(`📊 ${email}: ${correctCount}/${crosswordPlacedWords.length} correct (${accuracy}%)`);

      // Send result to user
      socket.emit("crosswordResult", {
        success: true,
        correctAnswers: correctCount,
        totalAnswers: crosswordPlacedWords.length,
        accuracy: accuracy,
        score: userAnswers.score,
      });

      // Broadcast updated leaderboard
      const leaderboard = Array.from(crosswordAnswers.entries())
        .map(([uid, data]) => ({
          user_id: uid,
          score: data.score,
          total: crosswordPlacedWords.length,
          accuracy: crosswordPlacedWords.length > 0 
            ? ((data.score / crosswordPlacedWords.length) * 100).toFixed(1)
            : 0,
        }))
        .sort((a, b) => b.score - a.score);

      io.emit("crosswordLeaderboard", leaderboard);

      // Optionally record in database
      if (email && display_name) {
        const connection = await pool.getConnection();
        try {
          // Record crossword game result
          const [userRes] = await connection.query(
            "SELECT user_id FROM users WHERE LOWER(email) = LOWER(?)",
            [email]
          );

          if (userRes.length > 0) {
            const userId = userRes[0].user_id;
            await connection.query(
              `INSERT INTO crossword_results (user_id, session_id, correct_answers, total_answers, accuracy)
               VALUES (?, ?, ?, ?, ?)`,
              [userId, crosswordGameSessionId, correctCount, crosswordPlacedWords.length, accuracy]
            );
          }
        } catch (dbErr) {
          console.warn("Could not record crossword result to DB:", dbErr.message);
        } finally {
          connection.release();
        }
      }

    } catch (err) {
      console.error("Crossword answer submission error:", err);
      socket.emit("crosswordError", { error: "Error processing crossword answers" });
    }
  });

  socket.on("endCrosswordGame", () => {
    console.log(`🏁 Crossword game ended`);
    
    crosswordGameActive = false;
    crosswordGrid = null;
    crosswordPlacedWords = null;
    currentCrosswordQuestions = [];
    
    io.emit("crosswordGameEnded", {
      finalLeaderboard: Array.from(crosswordAnswers.entries())
        .map(([uid, data]) => ({
          user_id: uid,
          score: data.score,
          total: crosswordPlacedWords ? crosswordPlacedWords.length : 0,
        }))
        .sort((a, b) => b.score - a.score),
    });
    
    crosswordAnswers.clear();
  });

  socket.on("leaveGame", async (data) => {
    try {
      const { game_code, user_id, email } = data;
      console.log("👋 Player leaving game:", { game_code, user_id, email, socketId: socket.id });
      
      if (!game_code) return;
      
      // ✅ Remove player from live_leaderboard for this game session
      try {
        const connection = await db.getConnection();
        try {
          // Get the game session ID
          const [gameSessions] = await connection.query(
            `SELECT game_session_id FROM games WHERE code = ? LIMIT 1`,
            [game_code]
          );
          
          if (gameSessions.length > 0) {
            const gameSessionId = gameSessions[0].game_session_id;
            
            // Remove from live leaderboard
            await connection.query(
              `DELETE FROM live_leaderboard WHERE game_session_id = ? AND user_id = ?`,
              [gameSessionId, user_id]
            );
            
            console.log("✅ Player removed from leaderboard:", { game_code, user_id });
            
            // ✅ Check how many players are still in the game
            const [remainingPlayers] = await connection.query(
              `SELECT COUNT(*) as player_count FROM live_leaderboard WHERE game_session_id = ?`,
              [gameSessionId]
            );
            
            const playerCount = remainingPlayers[0]?.player_count || 0;
            console.log(`👥 Remaining players in game ${game_code}: ${playerCount}`);
            
            if (playerCount === 0) {
              // ✅ ALL PLAYERS LEFT - STOP THE GAME
              console.log(`🛑 ALL PLAYERS LEFT game ${game_code} - Stopping game`);
              
              // Stop the game in memory
              const gameState = gameStates.get(game_code);
              if (gameState) {
                gameState.isGameActive = false;
                gameState.acceptingAnswers = false;
                gameState.currentIndex = -1; // Reset for next game
                gameState.gameSessionId = null; // ✅ Clear session ID so new players start fresh
                gameState.firstAnswered = false;
                gameState.answeredUsers.clear();
                
                // Clear all timers if running
                if (gameState.gameTimer) {
                  clearTimeout(gameState.gameTimer);
                  gameState.gameTimer = null;
                }
                
                console.log(`✅ Game state reset for ${game_code}`, {
                  isGameActive: false,
                  gameSessionId: null,
                  currentIndex: -1
                });
              }
              
              // ✅ Broadcast to room that game has ended
              io.to(`game_${game_code}`).emit('gameEnded', {
                game_code: game_code,
                message: '🛑 Game ended - all players have left',
                reason: 'all_players_left'
              });
              
              console.log(`✅ Game ${game_code} has been completely stopped and reset`);
            } else {
              // ✅ Still players in game - broadcast updated leaderboard
              const [updatedLeaderboard] = await connection.query(
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
                [gameSessionId]
              );
              
              // Emit updated leaderboard to all players in this game
              socket.to(`game_${game_code}`).emit('leaderboardUpdate', updatedLeaderboard);
            }
          }
        } finally {
          connection.release();
        }
      } catch (err) {
        console.warn("Error removing player from leaderboard:", err.message);
      }
      
      // ✅ Explicitly leave the game room
      socket.leave(`game_${game_code}`);
      console.log(`✅ Socket ${socket.id} left game room: game_${game_code}`);
      
    } catch (err) {
      console.error("Error in leaveGame handler:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// ==========================================
// ----- GAME LOOP HELPERS -----
// ==========================================

function endCurrentQuestion(game_code = null) {
  if (game_code) {
    const gameState = gameStates.get(game_code);
    if (!gameState) return;
    
    // ✅ STOP CHECK: If game is no longer active (all players left), stop the loop
    if (!gameState.isGameActive) {
      console.log(`🛑 [endCurrentQuestion] Game ${game_code} is no longer active - stopping game loop`);
      return;
    }
    
    // ✅ Guard: Prevent ending the same question multiple times
    if (gameState.questionEnded) {
      console.log(`⚠️ Question already ended for ${game_code}, skipping duplicate end`);
      return;
    }
    gameState.questionEnded = true;
    
    gameState.acceptingAnswers = false;

    if (gameState.currentIndex >= 0 && gameState.currentIndex < questions.length) {
      const q = questions[gameState.currentIndex];
      const correctAnswerText = getCorrectAnswerText(q);

      console.log(
        `📢 Ending question ${gameState.currentIndex + 1} for ${game_code} - CORRECT ANSWER: ${correctAnswerText}`
      );

      // ⚡ OPTIMIZATION: Pre-compute next question data
      let nextQuestionData = null;
      if (gameState.currentIndex + 1 < questions.length) {
        const nextQ = questions[gameState.currentIndex + 1];
        const nextCorrectAnswerText = getCorrectAnswerText(nextQ);
        nextQuestionData = {
          id: nextQ.id,
          text: nextQ.text,
          options: {
            A: nextQ.option_a,
            B: nextQ.option_b,
            C: nextQ.option_c,
            D: nextQ.option_d,
          },
          correct: nextQ.correct,
          correctAnswer: nextCorrectAnswerText,
          difficulty: nextQ.difficulty || "Medium",
          time: 10,
          questionNumber: gameState.currentIndex + 2,
          totalQuestions: questions.length,
          gameSessionId: gameState.gameSessionId,
          showNextButton: false,
        };
        console.log(`✅ Next question pre-computed: Q${gameState.currentIndex + 2} [${nextQ.text.substring(0, 40)}...]`);
      } else {
        console.log(`🏁 No more questions available after Q${gameState.currentIndex + 1}`);
      }

      // 🚀 Send both current question closing AND next question data in ONE event
      const questionClosedData = {
        game_code: game_code,
        correct: q.correct,
        correctAnswer: correctAnswerText,
        explanation: `Question completed! Correct answer was: ${correctAnswerText}`,
        questionNumber: gameState.currentIndex + 1,
        totalQuestions: questions.length,
        showNextButton: false,
        nextQuestion: nextQuestionData, // ✅ Include next question data for instant display
      };
      console.log(`📤 Emitting questionClosed with nextQuestion: ${nextQuestionData ? 'YES ✅' : 'NO'}`);
      io.to(`game_${game_code}`).emit("questionClosed", questionClosedData);
    }

    // ⚡ INSTANT advancement - use setImmediate
    console.log(`⏩ Advancing for ${game_code} IMMEDIATELY...`);
    setImmediate(() => {
      nextQuestion(game_code).catch((e) => console.error("Next question error:", e));
    });
  } else {
    // Legacy global behavior
    acceptingAnswers = false;

    if (currentIndex >= 0 && currentIndex < questions.length) {
      const q = questions[currentIndex];
      const correctAnswerText = getCorrectAnswerText(q);

      console.log(
        `📢 Ending question ${currentIndex + 1} - CORRECT ANSWER: ${correctAnswerText}`
      );

      // ⚡ OPTIMIZATION: Pre-compute next question data
      let nextQuestionData = null;
      if (currentIndex + 1 < questions.length) {
        const nextQ = questions[currentIndex + 1];
        const nextCorrectAnswerText = getCorrectAnswerText(nextQ);
        nextQuestionData = {
          id: nextQ.id,
          text: nextQ.text,
          options: {
            A: nextQ.option_a,
            B: nextQ.option_b,
            C: nextQ.option_c,
            D: nextQ.option_d,
          },
          correct: nextQ.correct,
          correctAnswer: nextCorrectAnswerText,
          difficulty: nextQ.difficulty || "Medium",
          time: 10,
          questionNumber: currentIndex + 2,
          totalQuestions: questions.length,
          gameSessionId: gameSessionId,
          showNextButton: false,
        };
      }

      io.emit("questionClosed", {
        correct: q.correct,
        correctAnswer: correctAnswerText,
        explanation: `Question completed! Correct answer was: ${correctAnswerText}`,
        questionNumber: currentIndex + 1,
        totalQuestions: questions.length,
        showNextButton: false,
        nextQuestion: nextQuestionData, // ✅ Include next question data for instant display
      });
    }

    // ⚡ INSTANT advancement - use setImmediate
    console.log(`Moving to next question IMMEDIATELY...`);
    setImmediate(() => {
      nextQuestion().catch((e) => console.error("Next question error:", e));
    });
  }
}

async function nextQuestion(game_code = null) {
  // Use per-game state if game_code provided
  if (game_code) {
    const gameState = initGameState(game_code);
    
    // ✅ STOP CHECK: If game is no longer active (all players left), stop the loop
    if (!gameState.isGameActive) {
      console.log(`🛑 [nextQuestion] Game ${game_code} is no longer active - stopping game loop`);
      // Clear any remaining timer
      if (gameState.gameTimer) {
        clearTimeout(gameState.gameTimer);
        gameState.gameTimer = null;
      }
      return;
    }
    
    gameState.currentIndex++;
    gameState.answeredUsers.clear();
    gameState.firstAnswered = false;
    gameState.currentQuestionStartTime = Date.now();

    if (gameState.currentIndex >= questions.length) {
      console.log(`🎉 Game completed for ${game_code} - all questions answered`);
      gameState.isGameActive = false;

      try {
        const [finalResults] = await pool.query(
          `
          SELECT 
            u.user_id, u.email, u.display_name,
            COALESCE(SUM(a.points_earned), 0) as session_score,
            COUNT(a.answer_id) as questions_answered,
            COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
            CASE 
              WHEN COUNT(a.answer_id) > 0 THEN 
                ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
              ELSE 0 
            END as accuracy
          FROM users u
          LEFT JOIN answers a ON u.user_id = a.user_id AND a.game_session_id = ?
          WHERE u.role = 'student'
          GROUP BY u.user_id, u.email, u.display_name
          HAVING questions_answered > 0
          ORDER BY session_score DESC, accuracy DESC
          LIMIT 20
        `,
          [gameState.gameSessionId]
        );

        io.to(`game_${game_code}`).emit("gameCompleted", {
          game_code: game_code,
          message: "🎉 Game Completed! All questions answered.",
          totalQuestions: questions.length,
          gameSessionId: gameState.gameSessionId,
          finalResults: { results: finalResults },
        });
      } catch (error) {
        console.error("Error getting final results:", error);
        io.to(`game_${game_code}`).emit("gameCompleted", {
          game_code: game_code,
          message: "🎉 Game Completed! All questions answered.",
          totalQuestions: questions.length,
          gameSessionId: gameState.gameSessionId,
          finalResults: { results: [] },
        });
      }

      return;
    }

    const q = questions[gameState.currentIndex];
    gameState.acceptingAnswers = true;
    gameState.isGameActive = true;
    gameState.questionEnded = false; // ✅ Reset guard for new question

    const correctAnswerText = getCorrectAnswerText(q);

    console.log(
      `📝 Question ${gameState.currentIndex + 1}/${questions.length} [${q.difficulty}] for ${game_code}: ${q.text.substring(
        0,
        50
      )}...`
    );
    console.log(`✅ Correct answer: ${q.correct} -> ${correctAnswerText}`);

    console.log(`📢 Broadcasting newQuestion to room: game_${game_code}`);
    io.to(`game_${game_code}`).emit("newQuestion", {
      game_code: game_code,
      id: q.id,
      text: q.text,
      options: {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      },
      correct: q.correct,
      correctAnswer: correctAnswerText,
      difficulty: q.difficulty || "Medium",
      time: 10, // ✅ 10 seconds to match frontend timer
      questionNumber: gameState.currentIndex + 1,
      totalQuestions: questions.length,
      gameSessionId: gameState.gameSessionId,
      showNextButton: false,
    });

    if (gameState.gameTimer) clearTimeout(gameState.gameTimer);
    gameState.gameTimer = setTimeout(() => {
      // ✅ Only end question if still accepting answers AND not already ended
      if (gameState.acceptingAnswers && !gameState.questionEnded) {
        console.log(`⏰ Time's up for question ${gameState.currentIndex + 1} (${game_code})`);
        endCurrentQuestion(game_code);
      } else if (gameState.questionEnded) {
        console.log(`⏱️ Timer fired but question already ended (${game_code})`);
      }
    }, 10000); // ✅ 10 seconds to match frontend timer
  } else {
    // Legacy global behavior for backward compatibility
    currentIndex++;

    answeredUsers.clear();
    firstAnswered = false;
    currentQuestionStartTime = Date.now();

    if (currentIndex >= questions.length) {
      console.log("🎉 Game completed - all questions answered");
      isGameActive = false;

      try {
        const [finalResults] = await pool.query(
          `
          SELECT 
            u.user_id, u.email, u.display_name,
            COALESCE(SUM(a.points_earned), 0) as session_score,
            COUNT(a.answer_id) as questions_answered,
            COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0) as correct_answers,
            CASE 
              WHEN COUNT(a.answer_id) > 0 THEN 
                ROUND((SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) * 100.0 / COUNT(a.answer_id)), 2)
              ELSE 0 
            END as accuracy
          FROM users u
          LEFT JOIN answers a ON u.user_id = a.user_id AND a.game_session_id = ?
          WHERE u.role = 'student'
          GROUP BY u.user_id, u.email, u.display_name
          HAVING questions_answered > 0
          ORDER BY session_score DESC, accuracy DESC
          LIMIT 20
        `,
          [gameSessionId]
        );

        io.emit("gameCompleted", {
          message: "🎉 Game Completed! All questions answered.",
          totalQuestions: questions.length,
          gameSessionId: gameSessionId,
          finalResults: { results: finalResults },
        });
      } catch (error) {
        console.error("Error getting final results:", error);
        io.emit("gameCompleted", {
          message: "🎉 Game Completed! All questions answered.",
          totalQuestions: questions.length,
          gameSessionId: gameSessionId,
          finalResults: { results: [] },
        });
      }

      return;
    }

    const q = questions[currentIndex];
    acceptingAnswers = true;
    isGameActive = true;

    const correctAnswerText = getCorrectAnswerText(q);

    console.log(
      `📝 Question ${currentIndex + 1}/${questions.length} [${q.difficulty}]: ${q.text.substring(
        0,
        50
      )}...`
    );
    console.log(`✅ Correct answer: ${q.correct} -> ${correctAnswerText}`);

    io.emit("newQuestion", {
      id: q.id,
      text: q.text,
      options: {
        A: q.option_a,
        B: q.option_b,
        C: q.option_c,
        D: q.option_d,
      },
      correct: q.correct,
      correctAnswer: correctAnswerText,
      difficulty: q.difficulty || "Medium",
      time: 10, // ✅ 10 seconds to match frontend timer
      questionNumber: currentIndex + 1,
      totalQuestions: questions.length,
      gameSessionId: gameSessionId,
      showNextButton: false,
    });

    if (gameTimer) clearTimeout(gameTimer);
    gameTimer = setTimeout(() => {
      if (acceptingAnswers) {
        console.log(`⏰ Time's up for question ${currentIndex + 1}`);
        endCurrentQuestion();
      }
    }, 10000); // ✅ 10 seconds to match frontend timer
  }
}

function startNewGameSession(game_code = null) {
  // If game_code provided, use per-game state; otherwise use global (backward compatibility)
  if (game_code) {
    const gameState = initGameState(game_code);
    gameState.gameSessionId = generateGameSessionId();
    gameState.currentIndex = -1;
    gameState.answeredUsers.clear();
    gameState.isGameActive = true;
    gameState.acceptingAnswers = true;
    gameState.firstAnswered = false;

    console.log(`🎮 Starting new game session for code ${game_code}: ${gameState.gameSessionId}`);
    console.log(`📢 Broadcasting gameStarted to room: game_${game_code}`);
    console.log(`📊 Total questions available: ${questions.length}`);
    
    // Broadcast ONLY to the specific game room
    const eventData = {
      game_code: game_code,
      sessionId: gameState.gameSessionId,
      totalQuestions: questions.length,
    };
    console.log(`📤 Event payload:`, eventData);
    
    io.to(`game_${game_code}`).emit("gameStarted", eventData);
    
    console.log(`✅ Emitted gameStarted to game_${game_code}`);

    // ✅ Send first question immediately - no delay!
    // This ensures smooth game start without laggy waiting
    setImmediate(() => {
      console.log(`📝 Immediately sending first question for ${game_code}...`);
      nextQuestion(game_code).catch((e) => console.error("Game start error:", e));
    });
  } else {
    // Legacy global behavior for backward compatibility
    gameSessionId = generateGameSessionId();
    currentIndex = -1;
    answeredUsers.clear();
    isGameActive = true;

    console.log(`🎮 Starting new game session (GLOBAL): ${gameSessionId}`);
    io.emit("gameStarted", {
      sessionId: gameSessionId,
      totalQuestions: questions.length,
    });

    // ✅ Send first question immediately - no delay!
    setImmediate(() => {
      nextQuestion().catch((e) => console.error("Game start error:", e));
    });
  }
}

// ==========================================
// ----- START SERVER -----
// ==========================================

function startServer(port) {
  server
    .listen(port, async () => {
      SERVER_PORT = server.address().port; // update actual port used

      console.log(`🚀 Server running on port ${SERVER_PORT}`);
      console.log(`📊 Admin panel: http://localhost:${SERVER_PORT}/admin`);
      console.log(`🔍 Health check: http://localhost:${SERVER_PORT}/`);

      setTimeout(async () => {
        const count = await loadQuestions();

        if (count === 0) {
          console.log(
            "❌ No questions found. Please use the admin panel to upload questions."
          );
        } else {
          console.log(`✅ ${count} questions loaded successfully`);
          console.log("⏳ Game is ready! Use the admin panel to start the game.");
        }
      }, 2000);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`❌ Port ${port} is busy, trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error("Server error:", err);
      }
    });
}

startServer(DEFAULT_PORT);