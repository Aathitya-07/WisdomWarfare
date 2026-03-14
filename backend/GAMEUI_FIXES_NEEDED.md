// ==========================================
// COMPREHENSIVE FIXES FOR GameUI.js
// KEY CROSSWORD GAME LIFECYCLE FIXES
// ==========================================

// CHANGES NEEDED IN GameUI.js:

// ============================================
// 1. ENHANCE SOCKET HANDLER FOR CROSSWORD
// ============================================

// IN the onConnect function, change the crosswordJoin emit to:

const onConnect = () => {
  console.log('✅ Connected to game server with ID:', newSocket.id);
  if (!mountedRef.current) return;
  setConnected(true);
  setLoading(true);
  
  // ✅ Reset game state on connect
  setCurrentQuestion(null);
  setIsAnswerSubmitted(false);
  setHasAnswered(false);
  setSubmissionClosed(false);
  setGameStats({
    score: 0,
    correct: 0,
    total: 0,
    questionsAnswered: 0
  });
  setResult({
    message: '',
    correct: false,
    points: 0,
    correctAnswer: '',
    correctAnswerKey: null,
    showNextButton: false
  });
  console.log('🔄 Reset all game stats to 0 on reconnect');

  // Check if player previously exited
  let hasExitedBefore = false;
  try {
    hasExitedBefore = localStorage.getItem(`EXITED_${gameCode}`) === 'true';
    if (hasExitedBefore) {
      console.log('⚠️ Player previously exited this game code');
      playerExitedRef.current = true;
      waitingForFreshStartRef.current = true;
      setGameStatus(prev => ({ ...prev, waitingForFreshStart: true }));
      console.log('🚫 Blocking questions via REF - waiting for fresh game start');
    }
  } catch (err) {
    console.error('Error checking exit flag:', err);
  }

  // JOIN GAME - works for both MCQ and Crossword
  newSocket.emit('joinGame', {
    game_code: gameCode || null,
    user_id: user?.user_id || user?.uid || null,
    email: user?.email || null,
    game_type: gameType,
    previously_exited: hasExitedBefore
  });

  // REQUEST GAME STATUS
  newSocket.emit('getGameStatus', { game_code: gameCode || null });

  // ✅ FETCH INITIAL LEADERBOARD
  if (gameType === "A. Crossword") {
    setTimeout(() => {
      fetchCrosswordLeaderboard();
    }, 300);
  } else {
    fetchLeaderboard();
  }
};


// ============================================
// 2. ADD SOCKET HANDLER FOR GAME STARTED
// ============================================

const onGameStarted = (data) => {
  console.log('🎮 Game started:', data);
  if (!mountedRef.current || !data) return;
  
  // ISOLATION: Verify game code matches
  if (data.game_code && data.game_code !== gameCode) {
    console.log('⚠️ Ignoring game started from different game code:', data.game_code);
    return;
  }
  
  // Clear waitingForFreshStart flag
  waitingForFreshStartRef.current = false;
  playerExitedRef.current = false;
  
  // Clear localStorage flags
  try {
    localStorage.removeItem(`EXITED_${gameCode}`);
    localStorage.removeItem(`GAME_COMPLETED_${gameCode}`);
  } catch (err) {
    console.error('Error clearing localStorage flags:', err);
  }
  
  setGameCompleted(false);
  setFinalResults(null);
  
  setGameStatus((prev) => ({
    ...prev,
    isGameActive: true,
    waitingForFreshStart: false,
    gameSessionId: data.gameSessionId  // ⭐ STORE SESSION ID
  }));
  
  console.log('✅ Fresh game started - unblocked questions');
};


// ============================================
// 3. HANDLE CROSSWORD GRID PROPERLY
// ============================================

const onCrosswordGrid = (data) => {
  console.log('🧩 Crossword grid received:', data);
  if (!mountedRef.current || gameType !== "A. Crossword") return;

  // Store the grid data
  if (data.grid) {
    const acrossClues = (data.clues || []).filter(clue => clue.direction === 'across' || clue.direction === 'horizontal');
    const downClues = (data.clues || []).filter(clue => clue.direction === 'down' || clue.direction === 'vertical');
    
    setCrosswordData({
      grid: data.grid,
      acrossClues: data.acrossClues || acrossClues,
      downClues: data.downClues || downClues,
      cellNumbers: data.cellNumbers || {}
    });
    
    // Initialize empty inputs
    const inputs = {};
    data.grid.forEach((row, rowIndex) => {
      row.forEach((cell, colIndex) => {
        if (cell === '.' || cell === ' ') {
          inputs[`${rowIndex}-${colIndex}`] = '';
        }
      });
    });
    setCellInputs(inputs);
    
    // Set clues
    setCrosswordClues(data.clues || []);
  }
};


// ============================================
// 4. FIX LEADERBOARD UPDATE HANDLER
// ============================================

const onCrosswordLeaderboardUpdate = (data) => {
  console.log('📊 Crossword leaderboard updated:', data);
  if (!mountedRef.current || gameType !== "A. Crossword") return;
  
  // ISOLATION: Verify game code matches
  if (data.game_code && data.game_code !== gameCode) {
    console.log('⚠️ Ignoring leaderboard from different game code:', data.game_code);
    return;
  }
  
  // Don't update if player exited
  if (waitingForFreshStartRef.current) {
    console.log('⏸️ Ignoring leaderboard - player exited, waiting for fresh game start');
    return;
  }
  
  if (Array.isArray(data)) {
    setLeaderboard(data);
  } else if (data.leaderboard && Array.isArray(data.leaderboard)) {
    setLeaderboard(data.leaderboard);
  }
};


// ============================================
// 5. ENHANCED SUBMIT CROSSWORD ANSWER
// ============================================

const submitCrosswordAnswer = async (questionId, userAnswer) => {
  if (!user || !gameCode) {
    console.error('Cannot submit crossword answer - missing user or game code');
    return;
  }

  try {
    const sessionId = gameStatus.gameSessionId;  // ⭐ USE SESSION ID
    if (!sessionId) {
      console.warn('⚠️ No game session ID for crossword answer');
      return;
    }

    // ✅ SUBMIT TO BACKEND
    const payload = {
      user_id: user.user_id || user.uid,
      game_session_id: sessionId,
      game_code: gameCode,
      crossword_question_id: questionId,
      user_answer: userAnswer
    };

    console.log('📝 Submitting crossword answer:', payload);
    
    const res = await fetch(`${API_BASE}/crossword/record-answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (result.ok) {
      console.log('✅ Crossword answer recorded:', result);
      
      // Update leaderboard from response
      if (result.leaderboard && Array.isArray(result.leaderboard)) {
        setLeaderboard(result.leaderboard);
      }
      
      // Update game stats
      if (result.points_earned && result.points_earned > 0) {
        setResult({
          message: `✅ Correct! +${result.points_earned} points`,
          correct: true,
          points: result.points_earned,
          correctAnswer: userAnswer,
          correctAnswerKey: null,
          showNextButton: false
        });

        setGameStats((prev) => ({
          ...prev,
          score: prev.score + result.points_earned,
          correct: prev.correct + 1,
          questionsAnswered: prev.questionsAnswered + 1
        }));
      } else {
        setResult({
          message: '❌ Incorrect answer',
          correct: false,
          points: 0,
          correctAnswer: result.correctAnswer || '',
          correctAnswerKey: null,
          showNextButton: false
        });
      }
    } else {
      console.warn('❌ Answer rejected:', result.error);
      setResult({
        message: result.error || 'Answer rejected',
        correct: false,
        points: 0,
        correctAnswer: '',
        correctAnswerKey: null,
        showNextButton: false
      });
    }
  } catch (err) {
    console.error('Error submitting crossword answer:', err);
    setResult({
      message: 'Error submitting answer',
      correct: false,
      points: 0,
      correctAnswer: '',
      correctAnswerKey: null,
      showNextButton: false
    });
  }
};


// ============================================
// 6. UPDATED SOCKET EVENT REGISTRATION
// ============================================

// In the socket setup, register all handlers:

newSocket.on('connect', onConnect);
newSocket.on('connect_error', onConnectError);
newSocket.on('disconnect', onDisconnect);
newSocket.on('reconnect', onReconnect);

// Game lifecycle events
newSocket.on('gameStatus', onGameStatus);
newSocket.on('gameStarted', onGameStarted);  // ⭐ MUST LISTEN FOR THIS
newSocket.on('newQuestion', onNewQuestion);
newSocket.on('answerResult', onAnswerResult);
newSocket.on('questionClosed', onQuestionClosed);
newSocket.on('gameCompleted', onGameCompleted);
newSocket.on('gameEnded', onGameEnded);
newSocket.on('leaderboardUpdate', onLeaderboardUpdate);

// Crossword specific events
newSocket.on('crosswordGrid', onCrosswordGrid);  // ⭐ MUST LISTEN FOR THIS
newSocket.on('crosswordLeaderboardUpdate', onCrosswordLeaderboardUpdate);  // ⭐ ADDED
newSocket.on('wordLocked', onWordLocked);
newSocket.on('wordSolved', onWordSolved);
newSocket.on('crosswordWinner', onCrosswordWinner);
newSocket.on('spectatorsUpdate', onSpectatorsUpdate);


// ============================================
// 7. RENDER CONDITIONAL FOR CROSSWORD
// ============================================

// In the main render, for crossword game type, show waiting state if game not active:

if (gameType === "A. Crossword") {
  if (!gameStatus.isGameActive && !gameCompleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="text-6xl mb-6 animate-pulse">⏳</div>
          <h2 className="text-3xl font-bold text-cyan-400 mb-4">
            Waiting for Crossword Game to Start
          </h2>
          <p className="text-cyan-200 mb-2">
            Teacher hasn't started the game yet. Please wait...
          </p>
          {gameCode && (
            <p className="text-cyan-300 mt-4">Game Code: <span className="font-mono font-bold">{gameCode}</span></p>
          )}
          <p className="text-cyan-300 text-sm mt-4">
            Players Ready: {socket?.connected ? "🟢 Connected" : "🔴 Disconnected"}
          </p>
        </div>
      </div>
    );
  }
  
  // Game is active - render crossword
  if (gameStatus.isGameActive && !gameCompleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
        <div className="max-w-6xl mx-auto">
          {/* Crossword grid and leaderboard */}
          <div className="flex flex-col lg:flex-row justify-between items-start gap-6">
            <div className="flex-1">
              {renderCrosswordGrid()}
            </div>
            {renderCrosswordLeaderboard()}
          </div>
        </div>
      </div>
    );
  }
}


// ============================================
// 8. KEY POINTS FOR SUCCESS
// ============================================

/*
CRITICAL FIXES MADE:

1. ✅ Game now waits for teacher to start (not auto-starts)
   - onGameStatus emits with isGameActive: false initially
   - Player sees "⏳ Waiting for teacher to start"
   - Waits for gameStarted event from server

2. ✅ Proper game lifecycle sequence:
   - joinGame (player joins room)
   - getGameStatus (check game state)
   - gameStatus returned (shows waiting or active)
   - Teacher starts game (calls startCrosswordGame on backend)
   - gameStarted broadcast (all players receive)
   - crosswordGrid broadcast (game starts)

3. ✅ Live leaderboard properly integrated:
   - Fetched on game start
   - Updated via leaderboardUpdate events
   - Shows scores in real-time
   - Updates via /crossword/record-answer API response

4. ✅ Session ID tracking:
   - gameStatus.gameSessionId stores session ID
   - Used in answer submission
   - Used in leaderboard queries

5. ✅ Waiting state properly rendered:
   - Shows UI while waiting for teacher
   - Blocks question display
   - Doesn't auto-start

6. ✅ Socket room isolation:
   - All crossword communications use game_${game_code} room
   - No cross-game contamination
   - Per-game state management

*/
