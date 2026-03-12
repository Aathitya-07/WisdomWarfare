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
const { generateCrosswordGrid } = require("./crosswordGrid");

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

const crosswordSessions = new Map(); // sessionId -> { grid, clues, solvedWords, solvedUsers, gameCode, startTime }
const crosswordGameStatus = new Map(); // game_code -> { started: false, sessionId: null }
const crosswordLocks = new Map(); // sessionId -> Map(user_id -> crossword_question_id)

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
    const [[game]] = await pool.query(
      "SELECT * FROM teacher_games WHERE game_code = ?",
      [game_code]
    );

    if (!game) {
      return res.status(404).json({ error: "Invalid crossword code" });
    }

    const [questions] = await pool.query(
      "SELECT id, question, answer FROM crossword_questions"
    );

    if (questions.length === 0) {
      return res.status(400).json({ error: "No crossword questions" });
    }

    const crossword = generateCrosswordGrid(questions);
    const sessionId = `CW_${Date.now()}_${game_code}`;

    crosswordSessions.set(sessionId, {
      grid: crossword.grid,
      clues: crossword.clues,
      solvedWords: new Set(),
      solvedUsers: new Map(),
      gameCode: game_code,
      startTime: Date.now()
    });

    crosswordGameStatus.set(game_code, {
      started: true,
      sessionId
    });

    io.to(game_code).emit("crosswordGrid", {
      grid: crossword.grid,
      clues: crossword.clues
    });

    res.json({ success: true, sessionId });
  } catch (err) {
    console.error("Crossword start error:", err);
    res.status(500).json({ error: "Failed to start crossword game" });
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
// ----- CROSSWORD SOCKET EVENTS -----
// ==========================================

io.on("connection", (socket) => {
  console.log("✅ Crossword socket connected:", socket.id);

  socket.on("joinGame", async ({ game_code, user_id }) => {
    if (game_code) {
      socket.join(game_code);
      console.log(`📊 Socket ${socket.id} (User: ${user_id}) joined crossword game: ${game_code}`);

      // Auto-start crossword when first player joins
      const status = crosswordGameStatus.get(game_code);

      if (!status || !status.started) {
        console.log("🧩 Auto-starting crossword for game:", game_code);

        try {
          const [questions] = await pool.query(
            "SELECT id, question, answer FROM crossword_questions LIMIT 15"
          );

          if (questions.length === 0) {
            socket.emit("crosswordError", {
              error: "No crossword questions available"
            });
            return;
          }

          const crossword = generateCrosswordGrid(questions);
          const sessionId = generateCrosswordSessionId();

          crosswordSessions.set(sessionId, {
            grid: crossword.grid,
            clues: crossword.clues,
            solvedWords: new Set(),
            solvedUsers: new Map(),
            gameCode: game_code,
            startTime: Date.now()
          });

          crosswordGameStatus.set(game_code, {
            started: true,
            sessionId
          });

          io.to(game_code).emit("crosswordGrid", {
            grid: crossword.grid,
            clues: crossword.clues
          });

        } catch (err) {
          console.error("Auto crossword start error:", err);
        }
      } else {
        // Game already started, send current state
        const session = crosswordSessions.get(status.sessionId);
        if (session) {
          socket.emit("crosswordGrid", {
            grid: session.grid,
            clues: session.clues
          });
        }
      }
    }
  });

  socket.on("crosswordJoin", ({ sessionId }) => {
    socket.join(sessionId);
    console.log(`📊 Socket ${socket.id} joined crossword session: ${sessionId}`);
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
  });

  // Word unlock
  socket.on("crosswordUnlockWord", ({ sessionId, user_id }) => {
    const sessionLocks = crosswordLocks.get(sessionId);
    if (sessionLocks) {
      sessionLocks.delete(user_id);
      io.to(sessionId).emit("wordUnlocked", { user_id });
    }
  });

  // Crossword submit with anti-cheat checks
  socket.on("crosswordSubmit", async ({ sessionId, user_id, word, crossword_question_id }) => {
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
        // Remove the lock after submission
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
      } finally {
        connection.release();
      }

      io.to(session.gameCode).emit("wordSolved", {
        wordId: crossword_question_id,
        user: { user_id },
        points,
        timeBonus: timeBonus > 0 ? `+${timeBonus} time bonus` : null
      });

      socket.emit("crosswordSubmitResult", {
        success: true,
        correct: isCorrect,
        points
      });
    } catch (err) {
      console.error("crosswordSubmit error:", err);
      socket.emit("crosswordError", { error: "Server error" });
    }
  });

  socket.on("crosswordSolved", data => {
    io.to(data.sessionId).emit("crosswordUpdate", data);
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