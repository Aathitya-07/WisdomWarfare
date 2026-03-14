// ==========================================
// FILE: REPLACEMENT SOCKET.IO HANDLERS FOR crosswordserver.js
// PURPOSE: Fix game lifecycle to match Wisdom Warfare pattern
// INSTRUCTIONS: Replace the entire "CROSSWORD SOCKET EVENTS" section
// ==========================================

// ==========================================
// ----- CROSSWORD SOCKET EVENTS (FIXED) -----
// ==========================================

io.on("connection", (socket) => {
  console.log("✅ Crossword socket connected:", socket.id);

  // ✅ GAME JOIN - Just join the room, don't start game
  socket.on("joinGame", async ({ game_code, user_id, email, game_type, previously_exited }) => {
    if (!game_code) {
      console.warn("⚠️ No game_code provided to joinGame");
      return;
    }

    console.log(`📍 User ${user_id} joining crossword game: ${game_code}`);

    // ✅ Join Socket.io room for this game
    socket.join(`game_${game_code}`);
    console.log(`✅ Socket joined room: game_${game_code}`);

    // ✅ Initialize game session if doesn't exist
    if (!gameSessions.has(game_code)) {
      console.log(`🎮 Creating new game session for game_code: ${game_code}`);
      
      const gameSessionId = generateCrosswordSessionId();
      gameSessions.set(game_code, {
        gameSessionId: gameSessionId,
        game_code: game_code,
        game_type: "Crossword",
        game_name: "A. Crossword",
        started: false,
        players: new Map(),
        startTime: null,
        endTime: null,
        state: "WAITING_FOR_TEACHER" // WAITING_FOR_TEACHER -> ACTIVE -> ENDED
      });

      // ✅ Initialize live_leaderboard for this session
      try {
        const conn = await pool.getConnection();
        // Clear any old entries for this game_code (cleanup)
        await conn.query(
          `DELETE FROM live_leaderboard WHERE game_session_id LIKE ?`,
          [`${gameSessionId}%`]
        );
        conn.release();
        console.log(`🧹 Cleaned up old leaderboard entries for session: ${gameSessionId}`);
      } catch (err) {
        console.error("⚠️ Error cleaning old leaderboard:", err.message);
      }
    }

    const session = gameSessions.get(game_code);
    
    // ✅ Add player to session
    session.players.set(user_id, {
      user_id,
      email,
      socket_id: socket.id,
      joined_at: Date.now()
    });

    // ✅ Emit GAME STATUS to this player (waiting for teacher)
    socket.emit("gameStatus", {
      game_code: game_code,
      questionsLoaded: 1, // Dummy value for UI
      isGameActive: false, // ⭐ KEY: Game is not active yet
      currentIndex: -1,
      gameSessionId: session.gameSessionId,
      state: "WAITING_FOR_TEACHER",
      message: "⏳ Waiting for teacher to start the crossword game...",
      players: session.players.size,
      startTime: null
    });

    console.log(`✅ Emitted gameStatus to ${user_id} - waiting for teacher to start`);

    // ✅ Broadcast player joined to other players in room
    socket.to(`game_${game_code}`).emit("playerJoined", {
      user_id: user_id,
      email: email,
      totalPlayers: session.players.size
    });

    console.log(`👥 Players in game ${game_code}: ${session.players.size}`);
  });

  // ✅ GET GAME STATUS - Request current game state
  socket.on("getGameStatus", ({ game_code }) => {
    if (!game_code) return;

    const session = gameSessions.get(game_code);
    if (!session) {
      //console.warn(`⚠️ Game session not found for game_code: ${game_code}`);
      socket.emit("gameStatus", {
        game_code: game_code,
        questionsLoaded: 0,
        isGameActive: false,
        currentIndex: -1,
        gameSessionId: null,
        state: "NOT_FOUND",
        message: "Game session not yet initialized"
      });
      return;
    }

    // ✅ Send current status to player
    socket.emit("gameStatus", {
      game_code: game_code,
      questionsLoaded: 1,
      isGameActive: session.started === true,
      currentIndex: -1,
      gameSessionId: session.gameSessionId,
      state: session.state,
      message: session.started 
        ? "🎮 Game is active - let's play!"
        : "⏳ Waiting for teacher to start...",
      players: session.players.size,
      startTime: session.startTime
    });

    console.log(`📊 Sent gameStatus to player - State: ${session.state}`);
  });

  // ✅ START GAME (called by teacher or game manager)
  socket.on("startCrosswordGame", async ({ game_code }) => {
    if (!game_code) return;

    console.log(`🚀 START CROSSWORD GAME requested for: ${game_code}`);

    const session = gameSessions.get(game_code);
    if (!session) {
      console.error(`❌ Game session not found: ${game_code}`);
      socket.emit("error", { message: "Game session not found" });
      return;
    }

    if (session.started) {
      console.warn(`⚠️ Game already started: ${game_code}`);
      return;
    }

    try {
      // ✅ Load crossword questions
      const [questions] = await pool.query(
        `SELECT id, question, answer, difficulty 
         FROM crossword_questions 
         ORDER BY difficulty, RAND() 
         LIMIT 15`
      );

      if (questions.length === 0) {
        io.to(`game_${game_code}`).emit("error", { 
          error: "No crossword questions available" 
        });
        return;
      }

      // ✅ Generate crossword grid
      const crossword = generateCrosswordGrid(questions);

      // ✅ Store crossword in session
      crosswordSessions.set(session.gameSessionId, {
        grid: crossword.grid,
        clues: crossword.clues || [],
        acrossClues: crossword.acrossClues || [],
        downClues: crossword.downClues || [],
        cellNumbers: crossword.cellNumbers || {},
        solvedWords: new Set(),
        startTime: Date.now(),
        questions: questions,
        gameCode: game_code
      });

      // ✅ Update session state
      session.started = true;
      session.state = "ACTIVE";
      session.startTime = Date.now();

      // ✅ Emit GAME STARTED to all players
      io.to(`game_${game_code}`).emit("gameStarted", {
        game_code: game_code,
        gameSessionId: session.gameSessionId,
        message: "🎮 Crossword game started!",
        timestamp: Date.now()
      });

      console.log(`✅ Emitted gameStarted to game_${game_code}`);

      // ✅ Send crossword grid to all players
      io.to(`game_${game_code}`).emit("crosswordGrid", {
        game_code: game_code,
        grid: crossword.grid,
        clues: crossword.clues,
        acrossClues: crossword.acrossClues,
        downClues: crossword.downClues,
        cellNumbers: crossword.cellNumbers,
        questions: questions.length
      });

      console.log(`✅ Sent crosswordGrid to all players in game_${game_code}`);

      // ✅ Initialize live leaderboard for all players
      for (const [user_id, player] of session.players) {
        try {
          await pool.query(
            `INSERT INTO live_leaderboard 
            (user_id, game_session_id, game_type, game_name, current_score, questions_answered, correct_answers, accuracy)
            VALUES (?, ?, ?, ?, 0, 0, 0, 0)
            ON DUPLICATE KEY UPDATE updated_at = NOW()`,
            [user_id, session.gameSessionId, "Crossword", "A. Crossword"]
          );
        } catch (err) {
          console.error(`⚠️ Error initializing leaderboard for user ${user_id}:`, err.message);
        }
      }

      console.log(`🎯 Initialized leaderboard for ${session.players.size} players`);

    } catch (err) {
      console.error("❌ Error starting crossword game:", err);
      io.to(`game_${game_code}`).emit("error", { error: err.message });
    }
  });

  // ✅ SUBMIT ANSWER for crossword (from /crossword/record-answer API)
  // This handler just triggers leaderboard broadcast
  socket.on("submitCrosswordAnswer", ({ game_code, user_id, points_earned }) => {
    if (game_code && points_earned > 0) {
      // Trigger debounced leaderboard broadcast
      const session = gameSessions.get(game_code);
      if (session) {
        scheduleCrosswordLeaderboardBroadcast(game_code, session.gameSessionId);
      }
    }
  });

  // ✅ WORD LOCKED (anti-cheat)
  socket.on("crosswordLockWord", ({ game_code, user_id, crossword_question_id, direction }) => {
    const session = gameSessions.get(game_code);
    if (!session) return;

    const wordId = `${crossword_question_id}_${direction}`;
    
    // Broadcast word locked to all players
    io.to(`game_${game_code}`).emit("wordLocked", {
      game_code: game_code,
      wordId: wordId,
      user_id: user_id,
      crossword_question_id: crossword_question_id,
      direction: direction
    });

    console.log(`🔒 Word locked by user ${user_id}: ${wordId}`);
  });

  // ✅ WORD SOLVED
  socket.on("crosswordWordSolved", ({ game_code, user_id, crossword_question_id, points, display_name }) => {
    const session = gameSessions.get(game_code);
    if (!session) return;

    // Broadcast word solved to all players
    io.to(`game_${game_code}`).emit("wordSolved", {
      game_code: game_code,
      user_id: user_id,
      display_name: display_name,
      crossword_question_id: crossword_question_id,
      points: points,
      timestamp: Date.now()
    });

    console.log(`✅ Word solved by ${display_name}: +${points} points`);

    // Update leaderboard
    if (session) {
      scheduleCrosswordLeaderboardBroadcast(game_code, session.gameSessionId);
    }
  });

  // ✅ GAME END (when all words solved or time expires)
  socket.on("endCrosswordGame", ({ game_code }) => {
    const session = gameSessions.get(game_code);
    if (!session) return;

    session.state = "ENDED";
    session.endTime = Date.now();

    io.to(`game_${game_code}`).emit("gameEnded", {
      game_code: game_code,
      gameSessionId: session.gameSessionId,
      endTime: session.endTime,
      message: "🎉 Crossword game completed!"
    });

    console.log(`🛑 Crossword game ended: ${game_code}`);
  });

  // ✅ DISCONNECT
  socket.on("disconnect", () => {
    console.log(`❌ Crossword socket disconnected: ${socket.id}`);

    // Find and remove player from all sessions
    for (const [game_code, session] of gameSessions) {
      for (const [user_id, player] of session.players) {
        if (player.socket_id === socket.id) {
          session.players.delete(user_id);
          console.log(`👤 Removed user ${user_id} from game ${game_code}`);

          // Broadcast player left
          io.to(`game_${game_code}`).emit("playerLeft", {
            user_id: user_id,
            totalPlayers: session.players.size
          });

          break;
        }
      }
    }
  });

  // ✅ ERROR HANDLER
  socket.on("error", (err) => {
    console.error("Socket error:", err);
  });
});

// ==========================================
// END OF SOCKET.IO HANDLERS
// ==========================================
