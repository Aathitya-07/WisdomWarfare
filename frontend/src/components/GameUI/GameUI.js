import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { formatAccuracy } from '../../utils/helpers';

const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:4001';

const GameUI = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const { gameCode: urlGameCode } = useParams(); // ✅ Read game code from URL
  
  // ✅ PRIORITY: Use URL game code first, then fallback to location state or localStorage
  const locationState = window.history.state?.usr || {};
  const gameCode = urlGameCode || locationState.gameCode || localStorage.getItem("GAME_CODE");
  const gameType = locationState.gameType || localStorage.getItem("GAME_TYPE") || "Wisdom Warfare";
  const gameName = locationState.gameName || localStorage.getItem("GAME_NAME") || "Wisdom Warfare";
  
  const [socket, setSocket] = useState(null);
  
  // ✅ Initialize state with simple defaults (no localStorage read - will be done in effect)
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState('');
  const [result, setResult] = useState({
    message: '',
    correct: false,
    points: 0,
    correctAnswer: '',
    correctAnswerKey: null,
    showNextButton: false
  });
  const [gameStats, setGameStats] = useState({
    score: 0,
    correct: 0,
    total: 0,
    questionsAnswered: 0
  });
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [hasAnswered, setHasAnswered] = useState(false); // ✅ NEW: Track if player ACTUALLY answered (clicked an option)
  const [submissionClosed, setSubmissionClosed] = useState(false); // ✅ NEW: Track if submission window is closed (time expired)
  const [currentQuestionId, setCurrentQuestionId] = useState(null); // ✅ NEW: Track current question ID to prevent stale messages
  const [leaderboard, setLeaderboard] = useState([]);
  const [connected, setConnected] = useState(false);
  const [gameCompleted, setGameCompleted] = useState(false);
  const [finalResults, setFinalResults] = useState(null);
  const [has50_50Used, setHas50_50Used] = useState(false); // ✅ NEW: Track if 50:50 power-up has been used
  const [eliminated50_50Options, setEliminated50_50Options] = useState([]); // ✅ NEW: Track which options are eliminated by 50:50
  const [gameStatus, setGameStatus] = useState({
    questionsLoaded: 0,
    isGameActive: false,
    currentIndex: -1,
    gameSessionId: null,
    waitingForFreshStart: false // ✅ Track if player just rejoined after exit
  });

  const [loading, setLoading] = useState(true);
  const [previousGameCode, setPreviousGameCode] = useState(gameCode);

  // ✅ ADDED: Load game state from localStorage when gameCode changes
  useEffect(() => {
    if (!gameCode) return;
    
    // ✅ Check if game was completed - restore completion screen on refresh
    try {
      const savedCompletion = localStorage.getItem(`GAME_COMPLETED_${gameCode}`);
      if (savedCompletion) {
        const completionData = JSON.parse(savedCompletion);
        console.log('🎉 Restoring game completed state from localStorage');
        setGameCompleted(true);
        setFinalResults(completionData.finalResults || null);
        if (completionData.gameStats) {
          setGameStats(completionData.gameStats);
        }
        setLoading(false);
        return; // Don't reset — game is already done
      }
    } catch (err) {
      console.error('Error restoring game completion:', err);
    }
    
    console.log('📂 Resetting game state for game code:', gameCode);
    
    // ✅ CRITICAL: When user re-enters or joins, reset ALL game state to waiting state
    // Do NOT load from localStorage - let socket events provide current state
    setCurrentQuestion(null);
    setTimeLeft(0);
    setSelectedAnswer('');
    setResult({
      message: '',
      correct: false,
      points: 0,
      correctAnswer: '',
      correctAnswerKey: null,
      showNextButton: false
    });
    setGameStats({
      score: 0,
      correct: 0,
      total: 0,
      questionsAnswered: 0
    });
    setIsAnswerSubmitted(false);
    setHasAnswered(false);
    setSubmissionClosed(false);
    setHas50_50Used(false);
    setEliminated50_50Options([]);
    setLeaderboard([]);
    
    console.log('🔄 Reset all game states to waiting - ready to sync with server');
    
    // ✅ Clear localStorage for this game code to prevent stale data
    try {
      localStorage.removeItem(`CURRENT_Q_${gameCode}`);
      localStorage.removeItem(`TIME_LEFT_${gameCode}`);
      localStorage.removeItem(`SELECTED_ANSWER_${gameCode}`);
      localStorage.removeItem(`RESULT_${gameCode}`);
      localStorage.removeItem(`ANSWER_SUBMITTED_${gameCode}`);
      localStorage.removeItem(`GAME_STATS_${gameCode}`);
      console.log('🧹 Cleared all localStorage for game code:', gameCode);
    } catch (err) {
      console.error('Error clearing game localStorage:', err);
    }
  }, [gameCode]);
  
  // ✅ ADDED: Clean up old game when code changes (socket, localStorage for previous game)
  useEffect(() => {
    if (previousGameCode && previousGameCode !== gameCode && gameCode) {
      console.log('🔄 Game code changed from', previousGameCode, 'to', gameCode);
      console.log('🧹 Immediately cleaning up old game code:', previousGameCode);
      
      // ✅ CRITICAL: Force disconnect and cleanup old socket immediately
      if (socketRef.current) {
        try {
          // Emit leave game event
          if (socketRef.current.connected) {
            socketRef.current.emit('leaveGame', {
              game_code: previousGameCode,
              user_id: user?.user_id || user?.uid || null,
              email: user?.email || null
            });
            console.log('📤 Sent leaveGame event');
          }
          
          // Force immediate disconnect
          socketRef.current.disconnect();
          console.log('❌ Socket disconnected');
        } catch (err) {
          console.error('Error cleaning up old socket:', err);
        }
        
        // CRITICAL: Clear socket reference immediately
        socketRef.current = null;
      }
      
      // ✅ Clear localStorage for the OLD game code
      try {
        localStorage.removeItem(`CURRENT_Q_${previousGameCode}`);
        localStorage.removeItem(`TIME_LEFT_${previousGameCode}`);
        localStorage.removeItem(`SELECTED_ANSWER_${previousGameCode}`);
        localStorage.removeItem(`RESULT_${previousGameCode}`);
        localStorage.removeItem(`ANSWER_SUBMITTED_${previousGameCode}`);
        localStorage.removeItem(`GAME_STATS_${previousGameCode}`);
        console.log('✅ Cleared all localStorage for previous game code:', previousGameCode);
      } catch (err) {
        console.error('Error clearing old game localStorage:', err);
      }
      
      // Update previous game code
      setPreviousGameCode(gameCode);
      
      // ✅ Force a small delay to ensure cleanup completes before socket reconnects
      setTimeout(() => {
        console.log('✅ Cleanup complete, ready for new socket connection');
      }, 100);
    }
  }, [gameCode, previousGameCode, user]);
  
  const timerRef = useRef(null);
  const socketRef = useRef(null);
  const mountedRef = useRef(true);
  const autoAdvanceRef = useRef(null);
  const lastQuestionIdRef = useRef(null);  // ✅ Track last shown question to prevent duplicates
  const advancingRef = useRef(false);  // ✅ Prevent multiple simultaneous advances
  const playerExitedRef = useRef(false); // ✅ Track if player previously exited
  const waitingForFreshStartRef = useRef(false); // ✅ INSTANT blocking ref (state is async, ref is sync)

  // ✅ Block browser refresh (F5, Ctrl+R, refresh button) while actively playing
  // Allow refresh when waiting for teacher to start or no question is showing
  useEffect(() => {
    const isActivelyPlaying = currentQuestion && !gameStatus.waitingForFreshStart && !gameCompleted;
    if (!isActivelyPlaying) return;

    // Intercept the browser refresh button / tab close → shows "Leave site?" dialog
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };

    // Intercept F5, Ctrl+R, Ctrl+Shift+R keyboard shortcuts → blocks refresh entirely
    const handleKeyDown = (e) => {
      if (e.key === 'F5' || (e.ctrlKey && e.key === 'r') || (e.ctrlKey && e.key === 'R')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [currentQuestion, gameStatus.waitingForFreshStart, gameCompleted]);

  // ✅ Persist gameStats to localStorage whenever it changes
  useEffect(() => {
    if (!gameCode) return;
    try {
      const sessionKey = `GAME_STATS_${gameCode}`;
      localStorage.setItem(sessionKey, JSON.stringify(gameStats));
      console.log('💾 Saved gameStats to localStorage:', gameStats);
    } catch (err) {
      console.error('Error saving gameStats to localStorage:', err);
    }
  }, [gameStats, gameCode]);

  // ✅ Persist currentQuestion to localStorage
  useEffect(() => {
    if (!gameCode) return;
    try {k
      const sessionKey = `CURRENT_Q_${gameCode}`;
      if (currentQuestion) {
        localStorage.setItem(sessionKey, JSON.stringify(currentQuestion));
        console.log('💾 Saved currentQuestion to localStorage');
      } else {
        localStorage.removeItem(sessionKey);
      }
    } catch (err) {
      console.error('Error saving currentQuestion to localStorage:', err);
    }
  }, [currentQuestion, gameCode]);

  // ✅ Persist timeLeft to localStorage
  useEffect(() => {
    if (!gameCode) return;
    try {
      const sessionKey = `TIME_LEFT_${gameCode}`;
      if (timeLeft > 0) {
        localStorage.setItem(sessionKey, timeLeft.toString());
        console.log('💾 Saved timeLeft to localStorage:', timeLeft);
      }
    } catch (err) {
      console.error('Error saving timeLeft to localStorage:', err);
    }
  }, [timeLeft, gameCode]);

  // ✅ Persist selectedAnswer to localStorage
  useEffect(() => {
    if (!gameCode) return;
    try {
      const sessionKey = `SELECTED_ANSWER_${gameCode}`;
      if (selectedAnswer) {
        localStorage.setItem(sessionKey, selectedAnswer);
        console.log('💾 Saved selectedAnswer to localStorage:', selectedAnswer);
      } else {
        localStorage.removeItem(sessionKey);
      }
    } catch (err) {
      console.error('Error saving selectedAnswer to localStorage:', err);
    }
  }, [selectedAnswer, gameCode]);

  // ✅ Persist result to localStorage
  useEffect(() => {
    if (!gameCode) return;
    try {
      const sessionKey = `RESULT_${gameCode}`;
      if (result.message) {
        localStorage.setItem(sessionKey, JSON.stringify(result));
        console.log('💾 Saved result to localStorage');
      } else {
        localStorage.removeItem(sessionKey);
      }
    } catch (err) {
      console.error('Error saving result to localStorage:', err);
    }
  }, [result, gameCode]);

  // ✅ Persist isAnswerSubmitted to localStorage
  useEffect(() => {
    if (!gameCode) return;
    try {
      const sessionKey = `ANSWER_SUBMITTED_${gameCode}`;
      localStorage.setItem(sessionKey, JSON.stringify(isAnswerSubmitted));
      console.log('💾 Saved isAnswerSubmitted to localStorage:', isAnswerSubmitted);
    } catch (err) {
      console.error('Error saving isAnswerSubmitted to localStorage:', err);
    }
  }, [isAnswerSubmitted, gameCode]);

  // ✅ Restart timer when it's restored from localStorage after page refresh
  useEffect(() => {
    if (!currentQuestion || timeLeft <= 0 || !gameCode) return;
    
    // Only restart timer if it's not already running
    if (timerRef.current) return;
    
    console.log('⏱️ Resuming timer from localStorage with', timeLeft, 'seconds remaining');
    
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          console.log('⏳ TIME EXPIRED - Marked submission closed, waiting for backend questionClosed event');
          setIsAnswerSubmitted(true);
          setSubmissionClosed(true); // ✅ Close submission window
          // Do NOT set hasAnswered = true! Player didn't actually answer
          
          // ❌ DO NOT AUTO-ADVANCE HERE!
          // The backend timer will send questionClosed event which triggers proper advancement
          // This ensures all players advance together, not when one player's timer expires first
          console.log('⏳ Waiting for backend questionClosed event - other players may still answer');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      // Keep timer running - don't clear on unmount
    };
  }, [currentQuestion, gameCode]); // Only depend on currentQuestion and gameCode, not timeLeft

  // ✅ ADDED: Game type validation on mount
  useEffect(() => {
    if (!mountedRef.current) return;
    
    const validateGameType = () => {
      const actualGameName = gameName || "";

      if (
        actualGameName.includes("Crossword") ||
        actualGameName.includes("CROSSWORD")
      ) {
        alert("❌ Game type mismatch! This game code is not valid for Wisdom Warfare.\n\nPlease use a Wisdom Warfare game code.");
        navigate("/game");
        return false;
      }

      return true;
    };
    
    if (!validateGameType()) {
      return;
    }
    
    console.log('🎮 Initializing', gameType, 'game with code:', gameCode);
    console.log('Game Name:', gameName);
    
    // ✅ CRITICAL: Close any existing socket before creating new one
    if (socketRef.current && socketRef.current.connected) {
      console.log('🔌 Closing existing socket before creating new one');
      try {
        socketRef.current.disconnect();
      } catch (err) {
        console.error('Error closing existing socket:', err);
      }
      socketRef.current = null;
    }
    
    const newSocket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
    setLoading(true);

    // Socket event handlers
    const onConnect = () => {
      console.log('✅ Connected to game server with ID:', newSocket.id);
      if (!mountedRef.current) return;
      setConnected(true);
      setLoading(true);
      
      // ✅ IMPORTANT: Reset game state on connect to ensure clean slate for rejoin
      setCurrentQuestion(null);
      setIsAnswerSubmitted(false);
      setHasAnswered(false); // ✅ Reset
      setSubmissionClosed(false); // ✅ Reset
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

      // ✅ PRIORITY: Set waitingForFreshStart FIRST if player exited
      // Do this BEFORE emitting joinGame so server's immediate question response is blocked
      let hasExitedBefore = false;
      try {
        hasExitedBefore = localStorage.getItem(`EXITED_${gameCode}`) === 'true';
        if (hasExitedBefore) {
          console.log('⚠️ Player previously exited this game code');
          playerExitedRef.current = true; // ✅ Track for onGameStatus
          waitingForFreshStartRef.current = true; // ✅ INSTANT block via ref
          // ✅ Do NOT remove EXITED_ flag here - keep it for page refreshes
          // It will be cleared only when a fresh gameStarted event fires
          setGameStatus(prev => ({ ...prev, waitingForFreshStart: true }));
          console.log('🚫 Blocking questions via REF - waiting for fresh game start');
        }
      } catch (err) {
        console.error('Error checking exit flag:', err);
      }

      // Join game with appropriate game type and exit flag
      newSocket.emit('joinGame', {
        game_code: gameCode || null,
        user_id: user?.user_id || user?.uid || null,
        email: user?.email || null,
        game_type: gameType,
        previously_exited: hasExitedBefore  // ✅ Tell server player is rejoining after exit
      });

      // Fetch initial game state
      newSocket.emit('getGameStatus', { game_code: gameCode || null });
      fetchLeaderboard();
    };

    const onConnectError = (err) => {
      console.error('❌ Connection error:', err);
      if (!mountedRef.current) return;
      setConnected(false);
      setLoading(false);
    };

    const onDisconnect = (reason) => {
      console.log('❌ Disconnected from game server:', reason);
      if (!mountedRef.current) return;
      setConnected(false);
      
      // ✅ ADDED: Clear current game's localStorage on disconnect so next join starts fresh
      try {
        if (gameCode) {
          localStorage.removeItem(`CURRENT_Q_${gameCode}`);
          localStorage.removeItem(`TIME_LEFT_${gameCode}`);
          localStorage.removeItem(`SELECTED_ANSWER_${gameCode}`);
          localStorage.removeItem(`RESULT_${gameCode}`);
          localStorage.removeItem(`ANSWER_SUBMITTED_${gameCode}`);
          localStorage.removeItem(`GAME_STATS_${gameCode}`);
          console.log('🧹 Cleared localStorage for disconnected game code:', gameCode);
        }
      } catch (err) {
        console.warn('Error clearing localStorage on disconnect:', err);
      }
    };

    const onReconnect = (attemptNumber) => {
      console.log(`✅ Reconnected after ${attemptNumber} attempts`);
      if (!mountedRef.current) return;
      setConnected(true);
      
      // ✅ IMPORTANT: Reset game state on reconnect to ensure clean slate for rejoin
      setCurrentQuestion(null);
      setIsAnswerSubmitted(false);
      setHasAnswered(false); // ✅ Reset
      setSubmissionClosed(false); // ✅ Reset
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
      
      // ✅ Check if player previously exited this game code
      let hasExitedBefore = false;
      try {
        hasExitedBefore = localStorage.getItem(`EXITED_${gameCode}`) === 'true';
        if (hasExitedBefore) {
          console.log('⚠️ Player previously exited this game code');
          playerExitedRef.current = true; // ✅ Track for onGameStatus
          waitingForFreshStartRef.current = true; // ✅ INSTANT block via ref
          // ✅ Do NOT remove EXITED_ flag here - keep it for page refreshes
          // It will be cleared only when a fresh gameStarted event fires
          setGameStatus(prev => ({ ...prev, waitingForFreshStart: true }));
          console.log('🚫 Blocking questions via REF - waiting for fresh game start');
        }
      } catch (err) {
        console.error('Error checking exit flag:', err);
      }
      
      newSocket.emit('joinGame', {
        game_code: gameCode || null,
        user_id: user?.user_id || user?.uid || null,
        email: user?.email || null,
        game_type: gameType,
        previously_exited: hasExitedBefore  // ✅ Tell server player is rejoining after exit
      });
      
      // ✅ Also request game status on reconnect to sync state
      newSocket.emit('getGameStatus', { game_code: gameCode || null });
    };

    // Common events for all game types
    const onLeaderboardUpdate = (data) => {
      console.log('🏆 Leaderboard updated:', data);
      if (!mountedRef.current || !data) return;
      // ✅ ISOLATION: Only update if this is an array (not an object with game_code)
      // If it contains game_code, verify it matches current game
      if (typeof data === 'object' && !Array.isArray(data) && data.game_code && data.game_code !== gameCode) {
        console.log('⚠️ Ignoring leaderboard from different game code:', data.game_code);
        return;
      }
      // ✅ Don't update leaderboard if player has exited and is waiting for fresh start
      if (waitingForFreshStartRef.current) {
        console.log('⏸️ Ignoring leaderboard update - player exited, waiting for fresh game start');
        return;
      }
      setLeaderboard(Array.isArray(data) ? data : []);
    };

    // Wisdom Warfare specific events
    const onGameStatus = (status) => {
      console.log('📊 Game status received:', status);
      if (!mountedRef.current || !status) return;
      // ✅ ISOLATION: Verify game code matches
      if (status.game_code && status.game_code !== gameCode) {
        console.log('⚠️ Ignoring game status from different game code:', status.game_code);
        return;
      }
      
      // ✅ If player exited, keep waitingForFreshStart=true until fresh gameStarted event
      // If player didn't exit, sync with server game state normally
      if (!playerExitedRef.current) {
        // Normal join (not after exit) - sync with server state
        setGameStatus((prev) => ({
          questionsLoaded: status.questionsLoaded ?? prev.questionsLoaded,
          isGameActive: status.isGameActive ?? false,
          currentIndex:
            typeof status.currentIndex === 'number'
              ? status.currentIndex
              : prev.currentIndex,
          gameSessionId: status.gameSessionId ?? prev.gameSessionId,
          waitingForFreshStart: false // Don't block - normal join
        }));
        console.log('✅ Normal join - synced with server state');
      } else {
        // Player exited - keep flag set (only gameStarted event clears it)
        console.log('⏳ Player exited - keeping waitingForFreshStart=true until fresh game start');
        // Don't update waitingForFreshStart here - keep it true
        setGameStatus((prev) => ({
          questionsLoaded: status.questionsLoaded ?? prev.questionsLoaded,
          isGameActive: status.isGameActive ?? false,
          currentIndex:
            typeof status.currentIndex === 'number'
              ? status.currentIndex
              : prev.currentIndex,
          gameSessionId: status.gameSessionId ?? prev.gameSessionId
          // ✅ Keep waitingForFreshStart as is
        }));
      }
      setLoading(false);
    };

    const onGameStarted = (data) => {
      console.log('🎮 Game started:', data);
      if (!mountedRef.current || !data) return;
      // ✅ ISOLATION: Verify game code matches
      if (data.game_code && data.game_code !== gameCode) {
        console.log('⚠️ Ignoring game started from different game code:', data.game_code);
        return;
      }
      // ✅ Clear waitingForFreshStart flag - player can now see questions
      waitingForFreshStartRef.current = false; // ✅ INSTANT unblock via ref
      playerExitedRef.current = false; // ✅ Clear exit tracking
      // ✅ NOW clear the EXITED_ flag and completion data from localStorage - fresh game has started
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
        waitingForFreshStart: false
      }));
      console.log('✅ Fresh game started - unblocked questions via REF');
    };

    const onNewQuestion = (question) => {
      console.log('❓ New question received:', question);
      if (!mountedRef.current || !question) return;
      
      // ✅ ISOLATION: Verify game code matches
      if (question.game_code && question.game_code !== gameCode) {
        console.log('⚠️ Ignoring question from different game code:', question.game_code);
        return;
      }

      // ✅ CRITICAL GATE: Use REF (not state) because state closures are stale
      // Ref updates instantly, state updates async (next render)
      if (waitingForFreshStartRef.current) {
        console.log('⏳ Player rejoined after exit - blocking question via REF until fresh gameStarted');
        return;
      }

      // ✅ Skip if this is the same question ID (prevents duplicate rendering)
      const qId = question.id || question.question_id || `q_${question.number}`;
      if (lastQuestionIdRef.current === qId) {
        console.log('⚠️ Ignoring duplicate question:', qId);
        return;
      }
      lastQuestionIdRef.current = qId;
      advancingRef.current = false;  // ✅ Mark that we've received new question

      setCurrentQuestion(question);
      setCurrentQuestionId(qId); // ✅ Track current question ID
      setTimeLeft(10); // ✅ SET TO 10 SECONDS
      setSelectedAnswer('');
      setIsAnswerSubmitted(false);
      setHasAnswered(false); // ✅ Reset - player hasn't answered yet
      setSubmissionClosed(false); // ✅ Reset - submission window is open
      setEliminated50_50Options([]); // ✅ RESET: Clear eliminated options for new question
      
      // ✅ CRITICAL: Clear the result message IMMEDIATELY - prevents stale messages
      setResult({
        message: '', // ✅ MUST be empty string
        correct: false,
        points: 0,
        correctAnswer: '',
        correctAnswerKey: null,
        showNextButton: false
      });
      console.log('✅ New question:', qId, '- All states reset, message cleared');

      // ✅ CRITICAL: Clear all existing timeouts before starting new ones
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      // ✅ Start timer for this question
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            timerRef.current = null;
            console.log('⏳ TIME EXPIRED - Player did NOT answer in time');
            setIsAnswerSubmitted(true);
            setSubmissionClosed(true); // ✅ Close submission window
            // Do NOT set hasAnswered = true! Player didn't actually answer
            
            // ❌ DO NOT AUTO-ADVANCE HERE!
            // The backend will send questionClosed event which triggers the advance
            console.log('⏳ Waiting for backend questionClosed event to move to next question');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    const normalizeCorrectAnswer = (raw, question) => {
      if (!question || !question.options) return null;
      if (!raw) return null;
      if (typeof raw === 'string' && question.options.hasOwnProperty(raw)) {
        return raw;
      }
      for (const [k, v] of Object.entries(question.options)) {
        if (v === raw) return k;
      }
      return null;
    };

    const onAnswerResult = (data) => {
      console.log('📝 Answer result received from server:', data);
      if (!mountedRef.current || !data) return;

      // ✅ ISOLATION: Verify game code matches
      if (data.game_code && data.game_code !== gameCode) {
        console.log('⚠️ Ignoring answer result from different game code:', data.game_code);
        return;
      }

      // Check if this result is for current user
      const eventUserMatches =
        !user ||
        (!data.user_id && !data.email) ||
        (user &&
          ((data.user_id &&
            (data.user_id === user.user_id || data.user_id === user.uid)) ||
            (data.email && data.email === user.email)));

      console.log('🔍 User match check:', {
        hasCurrentUser: !!user,
        dataUserId: data.user_id,
        dataEmail: data.email,
        currentUserId: user?.user_id || user?.uid,
        currentUserEmail: user?.email,
        eventUserMatches: eventUserMatches
      });

      if (!eventUserMatches) {
        console.log('⏭️ Ignoring answer result - NOT for current user:', {
          dataUserId: data.user_id,
          dataEmail: data.email,
          currentUser: user?.user_id || user?.uid,
          currentEmail: user?.email
        });
        return;
      }

      console.log('✅ This answer result IS for current user - processing it');

      setIsAnswerSubmitted(true);

      const q = currentQuestion;
      const normalizedKey = normalizeCorrectAnswer(
        data.correctAnswer ?? data.correct_answer ?? data.correct ?? '',
        q
      );

      if (data.error) {
        setResult({
          message: data.error,
          correct: false,
          points: 0,
          correctAnswer: data.correctAnswer || data.correct_answer || '',
          correctAnswerKey: normalizedKey || null,
          showNextButton: data.showNextButton ?? true
        });
      } else {
        setResult({
          message: data.message || '',
          correct: Boolean(data.correct),
          points: Number(data.points) || 0,
          correctAnswer: data.correctAnswer || data.correct_answer || '',
          correctAnswerKey: normalizedKey || null,
          showNextButton: data.showNextButton ?? true
        });

        // ✅ Update game stats
        setGameStats((prev) => {
          console.log('📊 Updating gameStats:', {
            oldScore: prev.score,
            newPoints: Number(data.points) || 0,
            isCorrect: data.correct,
            oldCorrect: prev.correct
          });

          if (data.correct) {
            return {
              score: prev.score + (Number(data.points) || 0),
              correct: prev.correct + 1,
              total: prev.total + 1,
              questionsAnswered: prev.questionsAnswered + 1
            };
          }

          return {
            ...prev,
            total: prev.total + 1,
            questionsAnswered: prev.questionsAnswered + 1
          };
        });

        console.log('✅ Answer submitted and recorded - player can now wait for timer');
        // ❌ DO NOT AUTO-ADVANCE HERE!
        // Let other players answer independently while timer is running
        // Timer expiry will trigger advance via onQuestionClosed
      }
    };

    const onQuestionClosed = (data) => {
      console.log('⏹️ Question closed event received:', data);
      if (!data) return;
      
      // ✅ ISOLATION: Verify game code matches
      if (data.game_code && data.game_code !== gameCode) {
        console.log('⚠️ Ignoring question closed from different game code:', data.game_code);
        return;
      }

      // ✅ CRITICAL: Block ALL question events if player exited and is waiting for fresh start
      if (waitingForFreshStartRef.current) {
        console.log('🚫 Blocking questionClosed - player exited, waiting for fresh game start');
        return;
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (!mountedRef.current) return;
      
      // ✅ CRITICAL FILTERING: Only show "time's up" if BOTH conditions are true:
      // 1. Player hasn't answered yet (hasAnswered = false)
      // 2. Submission window was open (submissionClosed = false means it just closed)
      
      console.log('🔍 onQuestionClosed filter check:', {
        hasAnswered,
        submissionClosed,
        shouldShow: !hasAnswered && !submissionClosed,
        hasNextQuestion: !!data.nextQuestion
      });
      
      if (!hasAnswered && !submissionClosed) {
        console.log('⏰ Showing "Time\'s up" message to player who didn\'t answer');
        setIsAnswerSubmitted(true);
        setSubmissionClosed(true); // Mark window as closed

        setResult((prev) => {
          const q = currentQuestion;
          const normalizedKey = normalizeCorrectAnswer(
            data.correctAnswer ?? data.correct_answer ?? '',
            q
          );
          return {
            message: `⏰ Time's up! Correct answer was: ${data.correctAnswer ?? data.correct_answer ?? ''}`,
            correct: false,
            points: 0,
            correctAnswer: data.correctAnswer ?? data.correct_answer ?? '',
            correctAnswerKey: normalizedKey,
            showNextButton: false
          };
        });
      } else {
        console.log('✅ Player already answered - no "time\'s up" message');
        setSubmissionClosed(true); // Just mark window as closed
      }

      // 🚀 AUTO-ADVANCE: If nextQuestion data is included, display it INSTANTLY
      if (data.nextQuestion) {
        console.log('🚀 AUTO-ADVANCING - nextQuestion data received! Q' + data.nextQuestion.questionNumber);
        
        // Update ALL states IMMEDIATELY - NO DELAY
        setCurrentQuestion(data.nextQuestion);
        setCurrentQuestionId(data.nextQuestion.id);
        setTimeLeft(10);
        setSelectedAnswer('');
        setIsAnswerSubmitted(false);
        setHasAnswered(false);
        setSubmissionClosed(false);
        
        // ✅ Clear result message
        setResult({
          message: '',
          correct: false,
          points: 0,
          correctAnswer: '',
          correctAnswerKey: null,
          showNextButton: false
        });
        
        console.log('✅ Question auto-advanced instantly - Q' + data.nextQuestion.questionNumber);
      } else {
        console.log('⚠️ No nextQuestion data received - waiting for separate newQuestion event (slower path)');
        // Fallback: Set a short timeout to ensure we don't wait too long
        if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = setTimeout(() => {
          console.log('⏳ Timeout: newQuestion event not received yet, might need to wait longer');
        }, 2000);
      }
    };

    const onGameCompleted = (data) => {
      console.log('🎉 Game completed:', data);
      if (!data) return;
      
      // ✅ ISOLATION: Verify game code matches
      if (data.game_code && data.game_code !== gameCode) {
        console.log('⚠️ Ignoring game completed from different game code:', data.game_code);
        return;
      }

      // ✅ If player exited, don't show completion screen from a game they left
      if (waitingForFreshStartRef.current) {
        console.log('⏸️ Ignoring game completed - player exited, waiting for fresh game start');
        return;
      }
      
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
      if (!mountedRef.current) return;
      
      // ✅ ADDED: Clear localStorage for this game so next play starts fresh
      try {
        localStorage.removeItem(`CURRENT_Q_${gameCode}`);
        localStorage.removeItem(`TIME_LEFT_${gameCode}`);
        localStorage.removeItem(`SELECTED_ANSWER_${gameCode}`);
        localStorage.removeItem(`RESULT_${gameCode}`);
        localStorage.removeItem(`ANSWER_SUBMITTED_${gameCode}`);
        localStorage.removeItem(`GAME_STATS_${gameCode}`);
        console.log('🧹 Cleared localStorage for completed game code:', gameCode);
      } catch (err) {
        console.warn('Error clearing localStorage on game completion:', err);
      }
      
      setGameCompleted(true);
      setFinalResults(data);
      setIsAnswerSubmitted(true);
      setResult((prev) => ({ ...prev, showNextButton: false }));
      setGameStatus((prev) => ({ ...prev, isGameActive: false }));

      // ✅ Persist game completion to localStorage so it survives refresh
      try {
        localStorage.setItem(`GAME_COMPLETED_${gameCode}`, JSON.stringify({
          finalResults: data,
          gameStats: gameStats
        }));
        console.log('💾 Saved game completion to localStorage');
      } catch (err) {
        console.warn('Error saving game completion:', err);
      }
    };

    // ✅ ADDED: Handle game ended when all players leave
    const onGameEnded = (data) => {
      console.log('🛑 Game ended - All players left:', data);
      if (!data) return;
      
      // ✅ ISOLATION: Verify game code matches
      if (data.game_code && data.game_code !== gameCode) {
        console.log('⚠️ Ignoring game ended from different game code:', data.game_code);
        return;
      }

      // ✅ If player exited, don't show end screen from a game they left
      if (waitingForFreshStartRef.current) {
        console.log('⏸️ Ignoring game ended - player exited, waiting for fresh game start');
        return;
      }
      
      if (timerRef.current) clearInterval(timerRef.current);
      if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
      if (!mountedRef.current) return;
      
      // ✅ Clear localStorage for this game
      try {
        localStorage.removeItem(`CURRENT_Q_${gameCode}`);
        localStorage.removeItem(`TIME_LEFT_${gameCode}`);
        localStorage.removeItem(`SELECTED_ANSWER_${gameCode}`);
        localStorage.removeItem(`RESULT_${gameCode}`);
        localStorage.removeItem(`ANSWER_SUBMITTED_${gameCode}`);
        localStorage.removeItem(`GAME_STATS_${gameCode}`);
        console.log('🧹 Cleared localStorage for ended game code:', gameCode);
      } catch (err) {
        console.warn('Error clearing localStorage on game end:', err);
      }
      
      setGameCompleted(true);
      setFinalResults({
        message: data.message || '🛑 Game ended - all players have left',
        reason: data.reason
      });
      setIsAnswerSubmitted(true);
      setResult((prev) => ({ ...prev, showNextButton: false }));
      setGameStatus((prev) => ({ ...prev, isGameActive: false }));
    };

    // Register all event listeners
    newSocket.on('connect', onConnect);
    newSocket.on('connect_error', onConnectError);
    newSocket.on('disconnect', onDisconnect);
    newSocket.on('reconnect', onReconnect);
    
    // Register all game events (not conditional)
    newSocket.on('gameStatus', onGameStatus);
    newSocket.on('gameStarted', onGameStarted);
    newSocket.on('newQuestion', onNewQuestion);
    newSocket.on('answerResult', onAnswerResult);
    newSocket.on('questionClosed', onQuestionClosed);
    newSocket.on('gameCompleted', onGameCompleted);
    newSocket.on('gameEnded', onGameEnded); // ✅ ADD: Listen for game end when all players leave
    newSocket.on('leaderboardUpdate', onLeaderboardUpdate);
    
    return () => {
      // ✅ CLEANUP: Stop timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }

      advancingRef.current = false;  // ✅ Reset advancing flag
      lastQuestionIdRef.current = null;  // ✅ Reset question ID tracker
      playerExitedRef.current = false;  // ✅ Reset exit flag for new game
      waitingForFreshStartRef.current = false;  // ✅ Reset blocking ref

      // ✅ CLEANUP: Emit leave game event to inform server
      if (newSocket && newSocket.connected) {
        try {
          newSocket.emit('leaveGame', {
            game_code: gameCode || null,
            user_id: user?.user_id || user?.uid || null,
            email: user?.email || null
          });
          console.log('👋 Leaving game:', gameCode);
        } catch (err) {
          console.error('Error emitting leaveGame:', err);
        }
      }

      // ✅ CLEANUP: Emit leave game event to inform server
      if (newSocket && newSocket.connected) {
        try {
          newSocket.emit('leaveGame', {
            game_code: gameCode || null,
            user_id: user?.user_id || user?.uid || null,
            email: user?.email || null
          });
          console.log('👋 Leaving game:', gameCode);
        } catch (err) {
          console.error('Error emitting leaveGame:', err);
        }
      }

      // ✅ CLEANUP: Remove all listeners
      if (newSocket) {
        newSocket.off('connect', onConnect);
        newSocket.off('connect_error', onConnectError);
        newSocket.off('disconnect', onDisconnect);
        newSocket.off('reconnect', onReconnect);
        newSocket.off('gameStatus', onGameStatus);
        newSocket.off('gameStarted', onGameStarted);
        newSocket.off('newQuestion', onNewQuestion);
        newSocket.off('answerResult', onAnswerResult);
        newSocket.off('questionClosed', onQuestionClosed);
        newSocket.off('gameCompleted', onGameCompleted);
        newSocket.off('gameEnded', onGameEnded); // ✅ REMOVE: Remove gameEnded listener
        newSocket.off('leaderboardUpdate', onLeaderboardUpdate);

        newSocket.disconnect();
      }

      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [gameCode, user, gameType, gameName, navigate]);

  // ✅ ADDED: Enhanced exit handler (for game exit without logout)
  const handleGameExit = () => {
    console.log('🚪 Exiting game:', gameCode);
    
    // ✅ Clear leaderboard immediately so stale data doesn't show
    setLeaderboard([]);
    
    // ✅ Mark this player as having explicitly exited this game
    try {
      if (gameCode) {
        localStorage.setItem(`EXITED_${gameCode}`, 'true');
        console.log('📍 Marked player as explicitly exited for game:', gameCode);
      }
    } catch (err) {
      console.error('Error marking exit in localStorage:', err);
    }
    
    // ✅ Emit leave game to server with explicit exit flag
    if (socketRef.current && socketRef.current.connected) {
      try {
        socketRef.current.emit('leaveGame', {
          game_code: gameCode || null,
          user_id: user?.user_id || user?.uid || null,
          email: user?.email || null,
          intentional_exit: true // ✅ Signal intentional exit, not just disconnect
        });
      } catch (err) {
        console.error('Error leaving game:', err);
      }
    }
    
    // ✅ Clear localStorage for current game code so next play starts fresh
    try {
      localStorage.removeItem(`CURRENT_Q_${gameCode}`);
      localStorage.removeItem(`TIME_LEFT_${gameCode}`);
      localStorage.removeItem(`SELECTED_ANSWER_${gameCode}`);
      localStorage.removeItem(`RESULT_${gameCode}`);
      localStorage.removeItem(`ANSWER_SUBMITTED_${gameCode}`);
      localStorage.removeItem(`GAME_STATS_${gameCode}`);
      localStorage.removeItem(`GAME_COMPLETED_${gameCode}`);
      console.log('🧹 Cleared localStorage for exited game code:', gameCode);
    } catch (err) {
      console.error('Error clearing game localStorage on exit:', err);
    }
    
    // ✅ Disconnect socket after emitting leave event
    try {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        console.log('❌ Socket disconnected on exit');
      }
    } catch (err) {
      console.error('Error disconnecting socket on exit:', err);
    }
  };

  // ✅ ADDED: Full logout handler (game exit + logout)
  const handleExit = () => {
    console.log('🚪 Full logout and exit game');
    // First do game exit cleanup
    handleGameExit();
    // Then call original logout
    onLogout();
  };

  // ✅ ADDED: Exit game and navigate to dashboard (stay logged in)
  const handleExitToDashboard = () => {
    console.log('📊 Exiting game and going to dashboard');
    // Only do game exit (not full logout)
    handleGameExit();
    // Then navigate to dashboard
    setTimeout(() => {
      navigate("/dashboard");
    }, 100); // Small delay to ensure exit cleanups complete
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_BASE}/leaderboard`);
      const data = await res.json();
      if (mountedRef.current) setLeaderboard(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
    }
  };

  const handleAnswer = (answerKey) => {
    if (!socketRef.current || !user || !currentQuestion || isAnswerSubmitted) {
      console.log('Cannot submit answer - either no socket, no user, no question, or answer already submitted');
      return;
    }

    // ✅ Prevent rapid double submissions
    if (advancingRef.current) {
      console.log('Question is advancing - please wait for next question');
      return;
    }

    setSelectedAnswer(answerKey);
    setIsAnswerSubmitted(true);
    setHasAnswered(true); // ✅ Mark that player ACTUALLY answered
    setSubmissionClosed(true); // ✅ Mark that submission window is now closed

    const payload = {
      user_id: user.user_id || user.uid,
      answer: answerKey,
      email: user.email,
      display_name: user.display_name || user.displayName,
      game_code: gameCode || null,
      game_session_id: gameStatus.gameSessionId || null
    };

    console.log('✅ Player submitted answer:', payload);
    socketRef.current.emit('submitAnswer', payload);
  };

  const normalizeOptionText = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');

  const normalizeOptionKey = (raw) => {
    if (raw === undefined || raw === null) return null;
    const value = String(raw).trim().toUpperCase();

    if (/^[ABCD]$/.test(value)) return value;
    if (/^[1-4]$/.test(value)) return String.fromCharCode(64 + Number(value));

    const suffixMatch = value.match(/(?:^|_)([ABCD])$/);
    if (suffixMatch) return suffixMatch[1];

    return null;
  };

  const resolveProtectedOptionKeysForQuestion = (question) => {
    if (!question || !question.options) return null;

    const options = question.options || {};
    const allKeys = Object.keys(options);
    if (allKeys.length === 0) return [];

    const protectedKeys = new Set();
    const addProtectedKey = (key) => {
      if (allKeys.includes(key)) {
        protectedKeys.add(key);
      }
    };

    const textCandidates = [question.correctAnswer, question.correct_answer].filter(Boolean);
    const keyCandidates = [
      question.correctAnswerKey,
      question.correct,
      question.correctAnswer,
      question.correct_answer,
    ].filter(Boolean);

    // 1) Highest priority: exact option text match from correctAnswer payload.
    for (const source of textCandidates) {
      const normalizedSourceText = normalizeOptionText(source);
      if (!normalizedSourceText) continue;

      for (const [optionKey, optionValue] of Object.entries(options)) {
        if (normalizeOptionText(optionValue) === normalizedSourceText) {
          addProtectedKey(optionKey);
        }
      }
    }

    const optionKeyByRaw = new Map(
      allKeys.map((key) => [String(key).trim().toUpperCase(), key])
    );

    // 2) Fallback: direct raw key match.
    for (const source of keyCandidates) {
      const raw = String(source ?? '').trim().toUpperCase();
      if (raw && optionKeyByRaw.has(raw)) {
        addProtectedKey(optionKeyByRaw.get(raw));
      }
    }

    // 3) Fallback: normalized key forms (A/B/C/D, 1-4, option_c, etc.).
    for (const source of keyCandidates) {
      const normalizedSourceKey = normalizeOptionKey(source);
      if (!normalizedSourceKey) continue;

      for (const optionKey of allKeys) {
        const normalizedOptionKey = normalizeOptionKey(optionKey);
        if (normalizedOptionKey && normalizedOptionKey === normalizedSourceKey) {
          addProtectedKey(optionKey);
        }
      }
    }

    return Array.from(protectedKeys);
  };

  // Defensive invariant: if data changes unexpectedly, never keep a protected key eliminated.
  useEffect(() => {
    if (!currentQuestion || eliminated50_50Options.length === 0) return;

    const options = currentQuestion.options || {};
    const optionKeys = new Set(Object.keys(options));
    const protectedKeys = new Set(
      resolveProtectedOptionKeysForQuestion(currentQuestion) || []
    );

    const sanitized = eliminated50_50Options.filter(
      (key) => optionKeys.has(key) && !protectedKeys.has(key)
    );

    if (sanitized.length !== eliminated50_50Options.length) {
      console.warn('50:50 auto-sanitized eliminated options due to invariant check', {
        before: eliminated50_50Options,
        after: sanitized,
        protectedKeys: Array.from(protectedKeys),
      });
      setEliminated50_50Options(sanitized);
    }
  }, [currentQuestion, eliminated50_50Options]);

  // ✅ NEW: Handle 50:50 power-up - SAFE (never eliminates correct answer)
  const handle50_50 = () => {
    if (has50_50Used || !currentQuestion) {
      console.warn('50:50 already used or no current question');
      return;
    }

    const options = currentQuestion.options || {};
    const allKeys = Object.keys(options);

    if (allKeys.length < 2) {
      console.warn('Not enough options for 50:50 power-up');
      return;
    }

    const protectedKeys = resolveProtectedOptionKeysForQuestion(currentQuestion);

    if (!protectedKeys || protectedKeys.length === 0) {
      console.error('50:50 aborted: unable to resolve protected answer keys safely', {
        gameCode,
        questionId: currentQuestion.id,
        providedCorrect: currentQuestion.correct,
        providedCorrectAnswer: currentQuestion.correctAnswer,
        providedCorrectAnswerKey: currentQuestion.correctAnswerKey,
        optionKeys: allKeys,
      });
      return;
    }

    // Strict mode: proceed only when exactly one correct candidate is resolved.
    // Ambiguous payloads are safer to skip than risk hiding a potentially correct option.
    if (protectedKeys.length !== 1) {
      console.warn('50:50 aborted: ambiguous protected keys, strict guard prevented elimination', {
        gameCode,
        questionId: currentQuestion.id,
        protectedKeys,
      });
      return;
    }

    // Eliminate only from keys that are definitely not protected as correct.
    const wrongAnswers = allKeys.filter((key) => !protectedKeys.includes(key));

    if (wrongAnswers.length === 0) {
      console.warn('50:50 aborted: no wrong answers available to eliminate');
      return;
    }
    
    console.log(`🎯 Protected keys: ${protectedKeys.join(', ')}, Eliminable wrong answers: ${wrongAnswers.join(', ')}`);
    
    // Randomly select UP TO 2 wrong answers to eliminate
    const toEliminate = [];
    const wrongCopy = [...wrongAnswers];
    const eliminationCount = Math.min(2, wrongCopy.length);
    
    while (toEliminate.length < eliminationCount && wrongCopy.length > 0) {
      const randomIndex = Math.floor(Math.random() * wrongCopy.length);
      toEliminate.push(wrongCopy[randomIndex]);
      wrongCopy.splice(randomIndex, 1);
    }
    
    const sanitizedEliminated = toEliminate.filter((key) => !protectedKeys.includes(key));
    setEliminated50_50Options(sanitizedEliminated);
    setHas50_50Used(true);
    console.log(`✨ 50:50 Power-up used! Eliminated: ${sanitizedEliminated.join(', ')} | Protected keys ${protectedKeys.join(', ')} are SAFE ✓`);
  };

  const handlePlayAgain = () => {
    // ✅ Reset tracking refs
    lastQuestionIdRef.current = null;
    advancingRef.current = false;

    // ✅ Clear any pending timeouts
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (autoAdvanceRef.current) {
      clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }

    setGameCompleted(false);
    setFinalResults(null);
    setGameStats({
      score: 0,
      correct: 0,
      total: 0,
      questionsAnswered: 0
    });
    
    // ✅ Clear saved stats and completion data from localStorage
    try {
      localStorage.removeItem(`GAME_STATS_${gameCode}`);
      localStorage.removeItem(`GAME_COMPLETED_${gameCode}`);
      console.log('🗑️ Cleared gameStats and completion from localStorage');
    } catch (err) {
      console.error('Error clearing localStorage:', err);
    }
    
    setCurrentQuestion(null);
    setTimeLeft(0);
    setSelectedAnswer('');
    setResult({
      message: '',
      correct: false,
      points: 0,
      correctAnswer: '',
      correctAnswerKey: null,
      showNextButton: false
    });
    setIsAnswerSubmitted(false);
    
    // ✅ Clear all game state from localStorage for fresh game
    try {
      const keys = [
        `GAME_STATS_${gameCode}`,
        `CURRENT_Q_${gameCode}`,
        `TIME_LEFT_${gameCode}`,
        `SELECTED_ANSWER_${gameCode}`,
        `RESULT_${gameCode}`,
        `ANSWER_SUBMITTED_${gameCode}`
      ];
      keys.forEach(key => {
        localStorage.removeItem(key);
      });
      console.log('🗑️ Cleared all game state from localStorage');
    } catch (err) {
      console.error('Error clearing game state from localStorage:', err);
    }
    
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('playAgain', {
        user_id: user?.user_id || user?.uid,
        game_code: gameCode || null
      });

      fetchLeaderboard();
    } else {
      window.location.reload();
    }
  };

  const refreshGameStatus = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('getGameStatus', { game_code: gameCode || null });
    }
  };

  const computedAccuracy =
    gameStats.total > 0
      ? formatAccuracy((gameStats.correct / gameStats.total) * 100)
      : '0.00';

  const renderMCQQuestion = () => {
    if (!currentQuestion) {
      return (
        <div className="text-center py-16">
          <div className="text-6xl text-cyan-400 mb-6">⏳</div>
          <h3 className="text-3xl font-bold text-white mb-4">
            Waiting for Questions
          </h3>
          <p className="text-gray-300 text-lg">
            {gameStatus.questionsLoaded === 0 
              ? "No questions available. Please ask the administrator to upload questions."
              : "The next question will appear shortly. Get ready!"}
          </p>
        </div>
      );
    }

    return (
      <>
        {/* ✅ QUESTION CARD CONTAINER */}
        <div className="bg-gray-800 rounded-2xl p-6 mb-6 border-2 border-cyan-600">
          <div className="flex flex-col sm:flex-row justify-between items-center mb-6 p-4 bg-gray-700 rounded-lg">
            <div className="flex items-center gap-4 mb-2 sm:mb-0">
              {/* ✅ TIMER - Now shows 10 seconds with enhanced styling */}
              <div className={`text-2xl font-bold px-4 py-2 rounded-lg transition-all ${
                timeLeft <= 3 
                  ? 'bg-red-900 text-red-300 animate-pulse' 
                  : 'bg-gray-900 text-cyan-400'
              }`}>
                ⏱️ {timeLeft}s
              </div>
              <div className="text-lg text-gray-300">
                Difficulty:{' '}
                <span className="font-bold text-cyan-300">
                  {currentQuestion.difficulty}
                </span>
              </div>
              <div className="text-lg text-cyan-200">
                Question:{' '}
                <span className="font-bold text-cyan-300">
                  {(currentQuestion.questionNumber || 1)}/
                  {currentQuestion.totalQuestions || gameStatus.questionsLoaded || '?'}
                </span>
              </div>
            </div>

            <div className="text-lg text-cyan-200">
              Your Score:{' '}
              <span className="font-bold text-cyan-300">
                {gameStats.score}
              </span>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-white leading-relaxed">
            {currentQuestion.text}
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {(() => {
            const safeProtectedKeys = resolveProtectedOptionKeysForQuestion(currentQuestion) || [];
            return Object.entries(currentQuestion.options || {}).map(([key, value]) => {
              const isSelected = selectedAnswer === key;
              // UI fail-safe: never eliminate any key that could be the correct option.
              const isEliminated = eliminated50_50Options.includes(key) && !safeProtectedKeys.includes(key);
              const correctKeyFromResult = result.correctAnswerKey ?? null;
              const isCorrect = Boolean(result.correct) && isSelected;
              const isCorrectAnswer = correctKeyFromResult
                ? correctKeyFromResult === key
                : result.correctAnswer &&
                  (result.correctAnswer === value ||
                    result.correctAnswer === key);
              const isDisabled = isAnswerSubmitted || timeLeft === 0;

              return (
                <button
                  key={key}
                  onClick={() => handleAnswer(key)}
                  disabled={isDisabled || isEliminated}
                  className={`p-4 rounded-xl text-left font-semibold text-lg transition-all duration-200 ${
                    isEliminated
                      ? 'bg-red-900 text-red-300 border-2 border-red-600 opacity-50 cursor-not-allowed line-through'
                      : isSelected
                      ? isCorrect
                        ? 'bg-green-600 text-white border-2 border-green-400 scale-105'
                        : 'bg-red-600 text-white border-2 border-red-400 scale-105'
                      : isCorrectAnswer && result.message
                      ? 'bg-green-600 text-white border-2 border-green-400'
                      : isDisabled
                      ? 'bg-gray-800 text-gray-500 border-2 border-gray-700 cursor-not-allowed'
                      : 'bg-gray-700 text-white hover:bg-gray-600 border-2 border-gray-600 hover:border-cyan-500 cursor-pointer hover:scale-105'
                  }`}
                >
                  <span className="font-bold mr-3">{key}.</span>
                  {value}
                </button>
              );
            });
          })()}
        </div>

        {/* ✅ POWERUP BUTTON - Below options grid, centered */}
        <div className="flex justify-center mb-8">
          <button
            onClick={handle50_50}
            disabled={has50_50Used || !gameStatus.isGameActive || isAnswerSubmitted}
            className={`px-8 py-3 rounded-xl font-bold text-lg transition-all flex items-center gap-2 ${
              has50_50Used
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
                : !gameStatus.isGameActive
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
                : 'bg-yellow-500 hover:bg-yellow-400 text-gray-900 hover:scale-110 shadow-lg hover:shadow-yellow-500/50'
            }`}
            title={has50_50Used ? 'Already used powerup for this game' : 'Eliminate 2 wrong answers (50:50)'}
          >
            <span className="text-xl">✨</span>
            Powerup
            {has50_50Used && <span className="ml-2">✓ Used</span>}
          </button>
        </div>

        {result.message && (
          <div
            className={`p-4 rounded-lg mb-4 text-center font-bold text-lg animate-pulse ${
              result.correct
                ? 'bg-green-600 text-white'
                : result.message.includes("Time's up")
                ? 'bg-yellow-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {result.message}
            <p className="text-sm mt-2">Moving to next question...</p>
          </div>
        )}
      </>
    );
  };

  if (gameCompleted && !gameStatus.waitingForFreshStart) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8 p-6 bg-gray-800 rounded-2xl border-2 border-cyan-600">
            <div>
              <h1 className="text-4xl font-bold text-cyan-400 mb-2">
                🎉 Game Completed! 🎉
              </h1>
              <p className="text-cyan-200">
                {gameName} - Final Results
              </p>
            </div>
            {user && (
              <div className="text-right">
                <p className="text-cyan-100 font-semibold">
                  {user.display_name || user.displayName}
                </p>
                <p className="text-cyan-200 text-sm">{user.email}</p>
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-2xl p-8 border-2 border-cyan-600">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-cyan-300 mb-4">
                Your Final Score
              </h2>
              {(() => {
                // Derive score from server's final results (authoritative) with client fallback
                const serverPlayer = finalResults?.finalResults?.results?.find(
                  (p) => user && p.email === user.email
                );
                const displayScore = serverPlayer
                  ? (serverPlayer.session_score ?? serverPlayer.score ?? 0)
                  : gameStats.score;
                const displayCorrect = serverPlayer
                  ? (serverPlayer.correct_answers ?? gameStats.correct)
                  : gameStats.correct;
                const displayTotal = finalResults?.totalQuestions ?? gameStats.total ?? 0;
                const displayAccuracy = serverPlayer
                  ? formatAccuracy(serverPlayer.accuracy ?? 0)
                  : computedAccuracy;

                return (
                  <>
                    <div className="text-6xl font-bold text-cyan-400 mb-2">
                      {displayScore}
                    </div>
                    <div className="text-xl text-cyan-200">
                      {displayCorrect}/{displayTotal} Correct • {displayAccuracy}% Accuracy
                    </div>
                  </>
                );
              })()}
            </div>

            {finalResults?.finalResults?.results && (
              <div className="mb-8">
                <h3 className="text-2xl font-bold text-cyan-300 mb-4 text-center">
                  🏆 Final Rankings
                </h3>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {finalResults.finalResults.results.map((player, index) => {
                    const isCurrentUser =
                      user && player.email === user.email;
                    return (
                      <div
                        key={player.user_id}
                        className={`flex justify-between items-center p-4 rounded-lg transition-all ${
                          isCurrentUser
                            ? 'bg-cyan-700 border-2 border-cyan-400 scale-105'
                            : index === 0
                            ? 'bg-yellow-600'
                            : index === 1
                            ? 'bg-gray-600'
                            : index === 2
                            ? 'bg-amber-800'
                            : 'bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center">
                          <span
                            className={`text-xl font-bold mr-4 ${
                              index < 3 ? 'text-white' : 'text-cyan-300'
                            }`}
                          >
                            {index + 1}
                            {index === 0 && ' 🥇'}
                            {index === 1 && ' 🥈'}
                            {index === 2 && ' 🥉'}
                          </span>
                          <div>
                            <div
                              className={`font-semibold ${
                                isCurrentUser ? 'text-cyan-100' : 'text-white'
                              }`}
                            >
                              {player.display_name || player.email}
                            </div>
                            {isCurrentUser && (
                              <div className="text-cyan-200 text-sm">You</div>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-cyan-300">
                            {player.session_score ?? player.score ?? 0} pts
                          </div>
                          <div className="text-sm text-gray-300">
                            {formatAccuracy(player.accuracy ?? 0)}% accuracy
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <button
                onClick={handleExitToDashboard}
                className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                📊 View Dashboard
              </button>
              <button
                onClick={handleExit}
                className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                🚪 Logout
              </button>
              <button
                onClick={handlePlayAgain}
                className="px-8 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                🔄 Play Again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-cyan-400 mb-2">
            Connecting to {gameName}...
          </h2>
          <p className="text-cyan-200">
            Please wait while we connect to the game server
          </p>
          {gameCode && (
            <p className="text-cyan-300 mt-2">Game Code: {gameCode}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col lg:flex-row justify-between items-center mb-8 p-6 bg-gray-800 rounded-2xl border-2 border-cyan-600">
          <div className="text-center lg:text-left mb-4 lg:mb-0">
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">
              🧠 
              {gameName}
            </h1>
            <p className="text-cyan-200">
              Real-time Compiler Design Quiz
            </p>
            <div className="mt-2 text-sm text-cyan-300">
              <>Questions: {gameStatus.questionsLoaded} | Status: {gameStatus.isGameActive ? '🟢 ACTIVE' : '🟡 WAITING'}</> | Connection: {connected ? '🟢 Connected' : '🔴 Disconnected'}
            </div>
            {gameCode && (
              <div className="mt-1 text-xs text-cyan-400">
                Game Code: <span className="font-mono">{gameCode}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 items-center">
            {user && (
              <div className="text-center sm:text-right">
                <p className="text-cyan-100 font-semibold">
                  {user.display_name || user.displayName}
                </p>
                <p className="text-cyan-200 text-sm">{user.email}</p>
              </div>
            )}

            <div className="flex gap-2 items-center">
              <div
                className={`w-3 h-3 rounded-full ${
                  connected ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <span className="text-sm text-gray-300">
                {connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            <button
              onClick={handleExit}
              className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600">
              {renderMCQQuestion()}
            </div>
          </div>

          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-6 border-2 border-cyan-500 h-fit shadow-lg">
            <div className="flex items-center justify-center mb-6">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                🏆 Live Leaderboard
              </h2>
            </div>

            <div className="space-y-2.5 max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-cyan-600 scrollbar-track-gray-700">
              {leaderboard.length > 0 ? (
                leaderboard.map((player, index) => {
                  const isCurrentUser = user && player.email === user.email;
                  const getRankColor = () => {
                    if (isCurrentUser) return 'from-cyan-600 to-cyan-700 border-cyan-400';
                    if (index === 0) return 'from-yellow-500 to-yellow-600 border-yellow-400';
                    if (index === 1) return 'from-slate-400 to-slate-500 border-slate-300';
                    if (index === 2) return 'from-orange-600 to-orange-700 border-orange-500';
                    return 'from-gray-700 to-gray-800 border-gray-600';
                  };

                  const getMedalEmoji = () => {
                    if (index === 0) return '🥇';
                    if (index === 1) return '🥈';
                    if (index === 2) return '🥉';
                    return null;
                  };

                  return (
                    <div
                      key={player.user_id || player.email || index}
                      className={`bg-gradient-to-r ${getRankColor()} border-2 rounded-xl p-4 transition-all duration-300 hover:shadow-lg ${
                        isCurrentUser ? 'scale-105 shadow-cyan-500/50 shadow-lg' : 'hover:scale-102'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {/* Rank Badge */}
                          <div
                            className={`flex items-center justify-center w-10 h-10 rounded-full font-bold text-lg ${
                              index < 3
                                ? 'bg-black bg-opacity-40 text-yellow-200'
                                : 'bg-black bg-opacity-30 text-cyan-200'
                            }`}
                          >
                            {index + 1}
                          </div>

                          {/* Medal */}
                          {getMedalEmoji() && (
                            <span className="text-xl">{getMedalEmoji()}</span>
                          )}

                          {/* Player Info */}
                          <div className="min-w-0 flex-1">
                            <div
                              className={`truncate font-bold text-sm ${
                                isCurrentUser
                                  ? 'text-white'
                                  : index < 3
                                  ? 'text-gray-900'
                                  : 'text-gray-100'
                              }`}
                            >
                              {player.display_name || player.email}
                            </div>
                            {isCurrentUser && (
                              <div
                                className={`text-xs font-semibold ${
                                  index < 3
                                    ? 'text-gray-100'
                                    : 'text-cyan-300'
                                }`}
                              >
                                ★ You
                              </div>
                            )}

                          </div>
                        </div>

                        {/* Score Section */}
                        <div className="text-right ml-4">
                          <div
                            className={`text-2xl font-bold ${
                              isCurrentUser
                                ? 'text-white'
                                : index < 3
                                ? 'text-gray-900'
                                : 'text-cyan-300'
                            }`}
                          >
                            {player.score ?? player.session_score ?? 0}
                          </div>
                          <div
                            className={`text-xs font-semibold mt-1 ${
                              isCurrentUser
                                ? 'text-gray-300'
                                : index < 3
                                ? 'text-gray-800'
                                : 'text-gray-400'
                            }`}
                          >
                            {formatAccuracy(player.accuracy ?? 0)}%
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="mt-2.5 w-full bg-black bg-opacity-30 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            isCurrentUser
                              ? 'bg-cyan-300'
                              : index < 3
                              ? 'bg-gray-300'
                              : 'bg-cyan-400'
                          }`}
                          style={{
                            width: `${Math.min(
                              ((player.score ?? player.session_score ?? 0) /
                                (leaderboard[0]?.score ?? 1000)) *
                                100,
                              100
                            )}%`
                          }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-gray-400 py-12">
                  <div className="text-3xl mb-2">👥</div>
                  <div className="font-semibold">No scores yet</div>
                  <div className="text-xs text-gray-500 mt-1">Be the first to join!</div>
                </div>
              )}
            </div>

            <div className="mt-6 p-4 bg-gray-700 rounded-lg">
              <h3 className="text-lg font-bold text-cyan-300 mb-3">
                Your Stats
              </h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-2xl font-bold text-cyan-400">
                    {gameStats.score}
                  </div>
                  <div className="text-xs text-gray-300">Score</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-400">
                    {gameStats.correct}
                  </div>
                  <div className="text-xs text-gray-300">Correct</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-cyan-300">
                    {gameStats.questionsAnswered}
                  </div>
                  <div className="text-xs text-gray-300">Answered</div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-gray-700 rounded-lg">
              <h3 className="text-lg font-bold text-cyan-300 mb-2">
                Game Status
              </h3>
              <div className="text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span>Questions:</span>
                  <span className="text-cyan-300">
                    {gameStatus.questionsLoaded}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span
                    className={
                      gameStatus.isGameActive
                        ? 'text-green-400'
                        : 'text-yellow-400'
                    }
                  >
                    {gameStatus.isGameActive ? 'Active 🟢' : 'Waiting 🟡'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Connection:</span>
                  <span
                    className={
                      connected ? 'text-green-400' : 'text-red-400'
                    }
                  >
                    {connected ? 'Connected 🟢' : 'Disconnected 🔴'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleExitToDashboard}
              className="w-full mt-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold transition-colors"
            >
              Exit Game
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GameUI;