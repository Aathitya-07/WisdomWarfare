import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { formatAccuracy } from '../../utils/helpers';

const API_BASE = process.env.REACT_APP_CROSSWORD_API_BASE || 'http://localhost:4002';

const hasPlayableGridPayload = (data) => {
  if (!data || !Array.isArray(data.grid) || data.grid.length === 0) {
    return false;
  }

  const clues = Array.isArray(data.clues)
    ? data.clues
    : [
        ...(Array.isArray(data.acrossClues) ? data.acrossClues : []),
        ...(Array.isArray(data.downClues) ? data.downClues : []),
      ];

  const hasPlayableCell = data.grid.some(
    (row) => Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && cell !== '#')
  );

  return hasPlayableCell && clues.length > 0;
};

const CrosswordGame = ({ user, gameCode, gameName, onLogout }) => {
  const navigate = useNavigate();
  const currentUserId = String(user?.user_id ?? user?.uid ?? '').trim();
  const currentUserEmail = String(user?.email ?? '').trim().toLowerCase();

  const isSameUser = (candidate) => {
    if (!candidate) {
      return false;
    }

    const candidateId = String(candidate.user_id ?? candidate.uid ?? '').trim();
    const candidateEmail = String(candidate.email ?? '').trim().toLowerCase();
    const idMatch = Boolean(currentUserId && candidateId && candidateId === currentUserId);
    const emailMatch = Boolean(currentUserEmail && candidateEmail && candidateEmail === currentUserEmail);

    return idMatch || emailMatch;
  };

  // ─── State ────────────────────────────────────────────────────────────────
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [waitingForTeacher, setWaitingForTeacher] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Waiting for teacher to start the crossword');
  const [waitingForFreshStart, setWaitingForFreshStart] = useState(false);

  const [crosswordData, setCrosswordData] = useState({
    grid: [],
    acrossClues: [],
    downClues: [],
    cellNumbers: {}
  });
  const [crosswordClues, setCrosswordClues] = useState([]);
  const [cellInputs, setCellInputs] = useState({});
  const [completedWords, setCompletedWords] = useState([]);
  const [lockedWords, setLockedWords] = useState({});
  const [wordInput, setWordInput] = useState('');
  const [spectators, setSpectators] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [winner, setWinner] = useState(null);
  const [showWinnerAnimation, setShowWinnerAnimation] = useState(false);
  const [gameCompleted, setGameCompleted] = useState(false);
  const [result, setResult] = useState({ message: '', correct: false, points: 0 });
  const [gameStats, setGameStats] = useState({ score: 0, correct: 0, questionsAnswered: 0 });
  const [timeLeftMs, setTimeLeftMs] = useState(6 * 60 * 1000);
  const [gameEndsAt, setGameEndsAt] = useState(null);
  const [gameDurationMs, setGameDurationMs] = useState(6 * 60 * 1000);
  const [activeDirection, setActiveDirection] = useState('across');
  const [activeClueId, setActiveClueId] = useState(null);

  // ─── Refs ──────────────────────────────────────────────────────────────────
  const socketRef = useRef(null);
  const sessionIdRef = useRef(null);
  const mountedRef = useRef(true);
  const gridLoadedRef = useRef(false);
  const playerExitedRef = useRef(false);
  const waitingForFreshStartRef = useRef(false);
  const pendingSubmissionWordIdsRef = useRef(new Set());

  // ─── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const isActivelyPlaying = hasPlayableGridPayload({
      grid: crosswordData.grid,
      clues: crosswordClues,
      acrossClues: crosswordData.acrossClues,
      downClues: crosswordData.downClues,
      cellNumbers: crosswordData.cellNumbers,
    }) && !waitingForFreshStart && !gameCompleted;

    if (!isActivelyPlaying) {
      return undefined;
    }

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [crosswordData, crosswordClues, waitingForFreshStart, gameCompleted]);

  useEffect(() => {
    if (!gameEndsAt || gameCompleted || waitingForTeacher || waitingForFreshStart) {
      return undefined;
    }

    const timer = setInterval(() => {
      const remaining = Math.max(0, gameEndsAt - Date.now());
      setTimeLeftMs(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 500);

    return () => clearInterval(timer);
  }, [gameEndsAt, gameCompleted, waitingForTeacher, waitingForFreshStart]);

  useEffect(() => {
    const clues = crosswordClues.length > 0 ? crosswordClues : (crosswordData.clues || []);
    if (!clues.length || !completedWords.length) {
      return;
    }

    setCellInputs((prev) => {
      let nextInputs = { ...prev };
      completedWords.forEach((wordId) => {
        nextInputs = fillSolvedClueCells(wordId, clues, nextInputs);
      });
      return nextInputs;
    });
  }, [completedWords, crosswordClues, crosswordData]);

  // ─── Fetch leaderboard ─────────────────────────────────────────────────────
  const fetchLeaderboard = async () => {
    try {
      const query = gameCode ? `?game_code=${encodeURIComponent(gameCode)}` : '';
      const res = await fetch(`${API_BASE}/crossword/leaderboard${query}`);
      const data = await res.json();
      if (mountedRef.current) setLeaderboard(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching crossword leaderboard:', err);
    }
  };

  // ─── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !gameCode) return;

    const newSocket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
    setLoading(true);

    // ── Connect ──────────────────────────────────────────────────────────────
    newSocket.on('connect', () => {
      console.log('✅ [Crossword] Connected:', newSocket.id);
      if (!mountedRef.current) return;
      setConnected(true);
      setWaitingForTeacher(true);

      let hasExitedBefore = false;
      try {
        hasExitedBefore = localStorage.getItem(`EXITED_${gameCode}`) === 'true';
        if (hasExitedBefore) {
          playerExitedRef.current = true;
          waitingForFreshStartRef.current = true;
          setWaitingForFreshStart(true);
          setStatusMessage('You exited this crossword. Waiting for teacher to start a fresh game.');
        } else {
          playerExitedRef.current = false;
          waitingForFreshStartRef.current = false;
          setWaitingForFreshStart(false);
          setStatusMessage('Waiting for teacher to start the crossword');
        }
      } catch (error) {
        console.error('Error checking crossword exit flag:', error);
        setStatusMessage('Waiting for teacher to start the crossword');
      }

      newSocket.emit('joinGame', {
        game_code: gameCode,
        user_id: user.user_id || user.uid,
        email: user.email,
        display_name: user.display_name || user.displayName || user.email,
        previously_exited: hasExitedBefore,
        game_type: 'A. Crossword'
      });

      fetchLeaderboard();
    });

    newSocket.on('connect_error', (err) => {
      console.error('❌ [Crossword] Connection error:', err);
      if (!mountedRef.current) return;
      setConnected(false);
      setLoading(false);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ [Crossword] Disconnected');
      if (!mountedRef.current) return;
      setConnected(false);
      setWaitingForTeacher(true);
      setStatusMessage('Reconnecting to crossword server...');
    });

    newSocket.on('crosswordStatus', (data) => {
      if (!mountedRef.current) return;

      if (waitingForFreshStartRef.current) {
        setWaitingForTeacher(true);
        setStatusMessage('You exited this crossword. Waiting for teacher to start a fresh game.');
        setLoading(false);
        return;
      }

      if (data?.completed) {
        const wasActiveParticipant = gridLoadedRef.current || Boolean(sessionIdRef.current);

        if (!wasActiveParticipant) {
          setWaitingForTeacher(true);
          setStatusMessage('Previous crossword round ended. Waiting for teacher to start a fresh game.');
          setTimeLeftMs(gameDurationMs || 6 * 60 * 1000);
          setGameEndsAt(null);
          setGameCompleted(false);
          setLoading(false);
          return;
        }

        setWaitingForTeacher(false);
        setStatusMessage(data?.message || 'Crossword game completed');
        setTimeLeftMs(0);
        setGameEndsAt(null);
        if (Array.isArray(data?.leaderboard)) {
          setLeaderboard(data.leaderboard);
        }
        if (data?.winner) {
          setWinner(data.winner);
        }
        setGameCompleted(true);
        setLoading(false);
        return;
      }

      const started = Boolean(data?.started);
      const durationMs = Number(data?.durationMs || 6 * 60 * 1000);
      const remainingTimeMs = Math.max(0, Number(data?.remainingTimeMs || 0));

      if (!started) {
        gridLoadedRef.current = false;
        setWaitingForTeacher(true);
        setStatusMessage(data?.message || 'Waiting for teacher to start the crossword');
        setTimeLeftMs(durationMs);
        setGameEndsAt(null);
      } else if (gridLoadedRef.current) {
        setWaitingForTeacher(false);
        setStatusMessage('Crossword game active');
        setGameDurationMs(durationMs);
        setTimeLeftMs(remainingTimeMs || durationMs);
        setGameEndsAt(Date.now() + (remainingTimeMs || durationMs));
      } else {
        setWaitingForTeacher(true);
        setStatusMessage('Teacher started the crossword. Loading puzzle...');
        setGameDurationMs(durationMs);
        setTimeLeftMs(remainingTimeMs || durationMs);
        setGameEndsAt(Date.now() + (remainingTimeMs || durationMs));
      }

      if (started && data?.sessionId) {
        sessionIdRef.current = data.sessionId;
        newSocket.emit('crosswordJoin', {
          sessionId: data.sessionId,
          game_code: gameCode,
          user_id: user.user_id || user.uid,
          email: user.email,
          display_name: user.display_name || user.displayName || user.email
        });
      }

      setLoading(false);
    });

    // ── Crossword grid ───────────────────────────────────────────────────────
    newSocket.on('crosswordGrid', (data) => {
      console.log('🧩 Crossword grid received:', data);
      if (!mountedRef.current) return;

      if (waitingForFreshStartRef.current) {
        return;
      }

      if (data.sessionId) {
        sessionIdRef.current = data.sessionId;
        newSocket.emit('crosswordJoin', {
          sessionId: data.sessionId,
          game_code: gameCode,
          user_id: user.user_id || user.uid,
          email: user.email,
          display_name: user.display_name || user.displayName || user.email
        });
      }

      if (!hasPlayableGridPayload(data)) {
        gridLoadedRef.current = false;
        setWaitingForTeacher(true);
        setStatusMessage('Waiting for teacher to start the crossword');
        setLoading(false);
        return;
      }

      gridLoadedRef.current = true;
      setWaitingForTeacher(false);
      setStatusMessage('Crossword game active');
      setLoading(false);

      if (data.grid && data.acrossClues && data.downClues && data.cellNumbers) {
        setCrosswordData(data);
      } else if (data.grid && data.clues) {
        const acrossClues = data.clues.filter(c => c.direction === 'across' || c.direction === 'horizontal');
        const downClues = data.clues.filter(c => c.direction === 'down' || c.direction === 'vertical');
        setCrosswordData({
          grid: data.grid,
          acrossClues,
          downClues,
          cellNumbers: data.cellNumbers || {}
        });
      }

      // Initialise empty cell inputs
      const inputs = {};
      if (data.grid) {
        data.grid.forEach((row, rowIndex) => {
          row.forEach((cell, colIndex) => {
            if (cell !== null && cell !== undefined) {
              inputs[`${rowIndex}-${colIndex}`] = '';
            }
          });
        });
      }
      setCellInputs(inputs);

      if (data.clues) {
        setCrosswordClues(data.clues);
      } else if (data.acrossClues && data.downClues) {
        setCrosswordClues([...data.acrossClues, ...data.downClues]);
      }
    });

    // ── Word locked ──────────────────────────────────────────────────────────
    newSocket.on('wordLocked', (data) => {
      console.log('🔒 Word locked:', data);
      if (!mountedRef.current) return;
      setLockedWords(prev => ({ ...prev, [data.wordId]: data.user }));
    });

    newSocket.on('wordUnlocked', (data) => {
      console.log('🔓 Word unlocked:', data);
      if (!mountedRef.current) return;
      setLockedWords(prev => {
        const next = { ...prev };
        delete next[data.wordId];
        return next;
      });
    });

    newSocket.on('crosswordPersonalState', (data) => {
      if (!mountedRef.current) return;
      const solvedWordIds = Array.isArray(data?.solvedWordIds) ? data.solvedWordIds : [];
      solvedWordIds.forEach((wordId) => pendingSubmissionWordIdsRef.current.delete(String(wordId)));
      setCompletedWords(solvedWordIds);
    });

    // ── Word solved ──────────────────────────────────────────────────────────
    newSocket.on('wordSolved', (data) => {
      console.log('✅ Word solved:', data);
      if (!mountedRef.current) return;
      setLockedWords(prev => {
        const next = { ...prev };
        delete next[data.wordId];
        return next;
      });

      const isMe = isSameUser(data.user);

      if (isMe) {
        pendingSubmissionWordIdsRef.current.delete(String(data.wordId));
        setCompletedWords(prev => [...new Set([...prev, data.wordId])]);
        const pts = Number(data.points) || 0;
        setResult({
          message: `✅ Correct answer! +${pts} points`,
          correct: true,
          points: pts
        });
      }
    });

    // ── Leaderboard update ───────────────────────────────────────────────────
    const onLeaderboard = (data) => {
      if (!mountedRef.current) return;
      if (waitingForFreshStartRef.current) {
        return;
      }
      const rows = Array.isArray(data) ? data : data && Array.isArray(data.leaderboard) ? data.leaderboard : [];
      setLeaderboard(rows);

      const currentPlayer = rows.find((player) => isSameUser(player));

      if (currentPlayer) {
        setGameStats({
          score: Number(currentPlayer.score ?? currentPlayer.current_score ?? 0),
          correct: Number(currentPlayer.correct_answers ?? 0),
          questionsAnswered: Number(currentPlayer.attempts ?? currentPlayer.questions_answered ?? 0),
        });
      }
    };
    newSocket.on('leaderboardUpdate', onLeaderboard);
    newSocket.on('crosswordLeaderboardUpdate', onLeaderboard);

    // ── Crossword winner ─────────────────────────────────────────────────────
    newSocket.on('crosswordWinner', (data) => {
      console.log('🏆 Crossword winner:', data);
      if (!mountedRef.current) return;
      setWinner(data);
      setShowWinnerAnimation(true);
      setTimeLeftMs(0);
      setGameEndsAt(null);
      setTimeout(() => {
        if (mountedRef.current) {
          setShowWinnerAnimation(false);
          setGameCompleted(true);
        }
      }, 3000);
    });

    // ── Game completed (from general server) ─────────────────────────────────
    newSocket.on('gameCompleted', (data) => {
      console.log('🎮 Game completed:', data);
      if (!mountedRef.current) return;
      if (Array.isArray(data?.leaderboard)) {
        setLeaderboard(data.leaderboard);
      }
      setStatusMessage('Crossword game completed');
      setWaitingForTeacher(false);
      setTimeLeftMs(0);
      setGameEndsAt(null);
      setGameCompleted(true);
    });

    newSocket.on('crosswordError', (data) => {
      if (!mountedRef.current) return;
      pendingSubmissionWordIdsRef.current.clear();
      if (String(data?.error || '').toLowerCase().includes('invalid session')) {
        setWaitingForTeacher(true);
        setStatusMessage('Waiting for teacher to start the crossword');
      }
      setResult({
        message: data?.error || 'Unable to complete crossword action',
        correct: false,
        points: 0
      });
    });

    // ── Spectators ───────────────────────────────────────────────────────────
    newSocket.on('spectatorsUpdate', (data) => {
      if (!mountedRef.current) return;
      setSpectators(Array.isArray(data) ? data : []);
    });

    // ── Game started (re-init state for fresh game) ──────────────────────────
    newSocket.on('gameStarted', (data) => {
      console.log('🎮 [Crossword] Game started:', data);
      if (!mountedRef.current) return;

      waitingForFreshStartRef.current = false;
      playerExitedRef.current = false;
      setWaitingForFreshStart(false);

      try {
        localStorage.removeItem(`EXITED_${gameCode}`);
      } catch (error) {
        console.error('Error clearing crossword exit flag:', error);
      }

      const alreadyLoaded = gridLoadedRef.current || hasPlayableGridPayload(data);

      // Reset state for new game round
      setCompletedWords([]);
      setLockedWords({});
      setCellInputs({});
      setResult({ message: '', correct: false, points: 0 });
      setWinner(null);
      setShowWinnerAnimation(false);
      setGameCompleted(false);
      pendingSubmissionWordIdsRef.current.clear();
      setActiveDirection('across');
      setActiveClueId(null);
      gridLoadedRef.current = false;

      const durationMs = Number(data?.durationMs || 6 * 60 * 1000);
      const remainingTimeMs = Math.max(0, Number(data?.remainingTimeMs || durationMs));
      setGameDurationMs(durationMs);
      setTimeLeftMs(remainingTimeMs);
      setGameEndsAt(Date.now() + remainingTimeMs);

      if (alreadyLoaded) {
        setWaitingForTeacher(false);
        setStatusMessage('Crossword game active');
        setLoading(false);
      } else {
        setWaitingForTeacher(true);
        setStatusMessage('Teacher started the crossword. Loading puzzle...');
        setLoading(true);
      }

      if (data?.leaderboard && Array.isArray(data.leaderboard)) {
        setLeaderboard(data.leaderboard);
      }
    });

    return () => {
      if (newSocket && newSocket.connected) {
        newSocket.emit('leaveGame', {
          game_code: gameCode,
          user_id: user.user_id || user.uid,
          email: user.email
        });
      }
      if (newSocket) newSocket.disconnect();
      socketRef.current = null;
      sessionIdRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [gameCode, user]);

  // ─── Game functions ────────────────────────────────────────────────────────
  const lockWord = (wordId, direction) => {
    if (!socketRef.current || !user) return;
    if (lockedWords[wordId]) return;
    socketRef.current.emit('crosswordLockWord', {
      sessionId: sessionIdRef.current,
      game_code: gameCode,
      user_id: user.user_id || user.uid,
      crossword_question_id: wordId,
      direction
    });
  };

  const submitWord = (wordId, answer) => {
    if (!socketRef.current || !user) return;
    const locker = lockedWords[wordId];
    const isLockedByMe = isSameUser(locker);
    if (!isLockedByMe) { alert('You need to lock this word first'); return; }
    if (!answer || !answer.trim()) { alert('Please enter an answer'); return; }
    socketRef.current.emit('crosswordSubmit', {
      sessionId: sessionIdRef.current,
      game_code: gameCode,
      user_id: user.user_id || user.uid,
      word: answer.trim().toUpperCase(),
      crossword_question_id: wordId
    });
    setWordInput('');
  };

  const submitCrosswordAnswer = (wordId, answer) => {
    if (!socketRef.current || !user) return;
    const normalizedWordId = String(wordId);
    if (pendingSubmissionWordIdsRef.current.has(normalizedWordId) || completedWords.some((id) => String(id) === normalizedWordId)) {
      return;
    }
    pendingSubmissionWordIdsRef.current.add(normalizedWordId);
    socketRef.current.emit('crosswordSubmit', {
      sessionId: sessionIdRef.current,
      game_code: gameCode,
      user_id: user.user_id || user.uid,
      word: answer.trim().toUpperCase(),
      crossword_question_id: wordId
    });
  };

  const getClueCells = (clue) => {
    if (!clue) {
      return [];
    }

    const isDown = clue.direction === 'down' || clue.direction === 'vertical';
    return Array.from({ length: clue.length }, (_, index) => ({
      row: isDown ? clue.startRow + index : clue.startRow,
      col: isDown ? clue.startCol : clue.startCol + index,
      letter: clue.answer?.[index] || '',
    }));
  };

  const fillSolvedClueCells = (wordId, clues, targetInputs = cellInputs) => {
    const solvedClue = clues.find((clue) => String(clue.id || clue.clueId || clue.number) === String(wordId));
    if (!solvedClue?.answer) {
      return targetInputs;
    }

    const nextInputs = { ...targetInputs };
    for (const cell of getClueCells(solvedClue)) {
      if (cell.letter) {
        nextInputs[`${cell.row}-${cell.col}`] = cell.letter;
      }
    }

    return nextInputs;
  };

  const getResolvedCellValue = (rowIndex, colIndex, inputs, clues) => {
    const explicitValue = inputs[`${rowIndex}-${colIndex}`] || '';
    if (explicitValue) {
      return explicitValue;
    }

    for (const clue of clues) {
      const clueId = clue.id || clue.clueId || clue.number;
      if (!completedWords.includes(clueId)) {
        continue;
      }

      const matchingCell = getClueCells(clue).find((cell) => cell.row === rowIndex && cell.col === colIndex);
      if (matchingCell?.letter) {
        return matchingCell.letter;
      }
    }

    return '';
  };

  const validateWords = (updatedInputs) => {
    const clues = crosswordClues.length > 0 ? crosswordClues : (crosswordData.clues || []);
    const newCompleted = [];

    clues.forEach(clue => {
      const clueId = clue.id || clue.clueId || clue.number;
      if (completedWords.includes(clueId)) { newCompleted.push(clueId); return; }

      const { direction, startRow, startCol, length, answer } = clue;
      let wordValue = '';

      if (direction === 'across' || direction === 'horizontal') {
        for (let i = 0; i < length; i++) {
          wordValue += getResolvedCellValue(startRow, startCol + i, updatedInputs, clues);
        }
      } else if (direction === 'down' || direction === 'vertical') {
        for (let i = 0; i < length; i++) {
          wordValue += getResolvedCellValue(startRow + i, startCol, updatedInputs, clues);
        }
      }

      if (wordValue.length === length &&
          wordValue.toUpperCase() === (answer || '').toUpperCase()) {
        newCompleted.push(clueId);
        if (!completedWords.includes(clueId)) {
          submitCrosswordAnswer(clue.id || clueId, wordValue);
        }
      }
    });

    setCompletedWords(newCompleted);
  };

  const focusCell = (rowIndex, colIndex) => {
    const next = document.querySelector(`[data-row="${rowIndex}"][data-col="${colIndex}"]`);
    if (next && !next.disabled) {
      next.focus();
      return true;
    }

    return false;
  };

  const getLockedClueForCurrentUser = (clues) => {
    const myLockEntry = Object.entries(lockedWords).find(([, locker]) => isSameUser(locker));
    if (!myLockEntry) {
      return null;
    }

    const [lockedWordId] = myLockEntry;
    return clues.find((clue) => String(clue.id || clue.clueId || clue.number) === String(lockedWordId)) || null;
  };

  const getClueId = (clue) => String(clue?.id || clue?.clueId || clue?.number || '');

  const getExplicitActiveClue = (clues) => {
    if (!activeClueId) {
      return null;
    }

    return clues.find((clue) => getClueId(clue) === String(activeClueId)) || null;
  };

  const getCluesForCell = (clues, rowIndex, colIndex) => {
    return clues.filter((clue) => isCellInWord(getClueId(clue), rowIndex, colIndex, clues));
  };

  const normalizeDirection = (direction) => (
    direction === 'down' || direction === 'vertical' ? 'down' : 'across'
  );

  const getPreferredClueForCell = (clues, rowIndex, colIndex, preferredDirection = activeDirection) => {
    const cellClues = getCluesForCell(clues, rowIndex, colIndex);
    if (!cellClues.length) {
      return null;
    }

    const matchingDirection = cellClues.find((clue) => {
      const normalizedDirection = clue.direction === 'down' || clue.direction === 'vertical' ? 'down' : 'across';
      return normalizedDirection === preferredDirection;
    });

    return matchingDirection || cellClues[0];
  };

  const getCurrentActiveClue = (clues, rowIndex, colIndex) => {
    const explicitClue = getExplicitActiveClue(clues);
    if (explicitClue && isCellInWord(getClueId(explicitClue), rowIndex, colIndex, clues)) {
      return explicitClue;
    }

    const lockedClue = getLockedClueForCurrentUser(clues);
    if (lockedClue && isCellInWord(getClueId(lockedClue), rowIndex, colIndex, clues)) {
      return lockedClue;
    }

    return getPreferredClueForCell(clues, rowIndex, colIndex, activeDirection);
  };

  const getLockedDirectionForCurrentUser = (clues) => {
    const lockedClue = getLockedClueForCurrentUser(clues);
    if (!lockedClue) {
      return null;
    }

    return normalizeDirection(lockedClue.direction);
  };

  const getCellValueFromInputs = (rowIndex, colIndex) => {
    const key = `${rowIndex}-${colIndex}`;
    return (cellInputs[key] || '').toUpperCase();
  };

  const getCellOffsetInClue = (clue, rowIndex, colIndex) => {
    if (!clue) {
      return -1;
    }

    const isDown = normalizeDirection(clue.direction) === 'down';
    return isDown ? rowIndex - clue.startRow : colIndex - clue.startCol;
  };

  const getNextCellInClue = (clue, rowIndex, colIndex, step, options = {}) => {
    if (!clue) {
      return null;
    }

    const {
      preferEmpty = false,
      includeCurrent = false,
    } = options;

    const isDown = normalizeDirection(clue.direction) === 'down';
    const offset = isDown ? rowIndex - clue.startRow : colIndex - clue.startCol;
    const startOffset = includeCurrent ? offset : offset + step;
    const inRange = (candidateOffset) => candidateOffset >= 0 && candidateOffset < clue.length;

    for (let nextOffset = startOffset; inRange(nextOffset); nextOffset += step) {
      const nextRow = isDown ? clue.startRow + nextOffset : clue.startRow;
      const nextCol = isDown ? clue.startCol : clue.startCol + nextOffset;

      if (preferEmpty && getCellValueFromInputs(nextRow, nextCol)) {
        continue;
      }

      if (focusCell(nextRow, nextCol)) {
        return { row: nextRow, col: nextCol };
      }
    }

    return null;
  };

  const focusNextEditableCell = (clues, rowIndex, colIndex, step = 1) => {
    const activeClue = getCurrentActiveClue(clues, rowIndex, colIndex);
    if (activeClue) {
      const nextInClue = getNextCellInClue(activeClue, rowIndex, colIndex, step, { preferEmpty: step > 0 });
      if (nextInClue) {
        return;
      }

      // If every remaining cell already has a value, fall back to nearest editable cell in clue.
      const fallbackInClue = getNextCellInClue(activeClue, rowIndex, colIndex, step);
      if (fallbackInClue) {
        return;
      }
    }

    const direction = getLockedDirectionForCurrentUser(clues) || activeDirection;
    let nextRow = rowIndex;
    let nextCol = colIndex;

    for (let attempt = 0; attempt < 20; attempt++) {
      if (direction === 'down') {
        nextRow += step;
      } else {
        nextCol += step;
      }

      if (!focusCell(nextRow, nextCol)) {
        continue;
      }
      return;
    }
  };

  const handleCellInput = (rowIndex, colIndex, value, clues) => {
    const cellId = `${rowIndex}-${colIndex}`;
    const upperValue = value.toUpperCase();
    const updated = { ...cellInputs, [cellId]: upperValue };
    setCellInputs(updated);
    validateWords(updated);

    const activeClue = getCurrentActiveClue(clues, rowIndex, colIndex);
    if (activeClue) {
      setActiveClueId(getClueId(activeClue));
      setActiveDirection(normalizeDirection(activeClue.direction));
    }

    if (upperValue.length > 0) {
      setTimeout(() => {
        focusNextEditableCell(clues, rowIndex, colIndex, 1);
      }, 10);
    }
  };

  const handleKeyDown = (e, rowIndex, colIndex, clues) => {
    const currentClue = getCurrentActiveClue(clues, rowIndex, colIndex);
    if (currentClue) {
      setActiveClueId(getClueId(currentClue));
      setActiveDirection(normalizeDirection(currentClue.direction));
    }

    if (e.key === 'Backspace') {
      if (!cellInputs[`${rowIndex}-${colIndex}`]) {
        e.preventDefault();
        focusNextEditableCell(clues, rowIndex, colIndex, -1);
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveDirection('across');
      const preferred = getPreferredClueForCell(clues, rowIndex, colIndex, 'across');
      if (preferred) {
        setActiveClueId(getClueId(preferred));
        const moved = getNextCellInClue(preferred, rowIndex, colIndex, 1) || getNextCellInClue(preferred, rowIndex, colIndex, 1, { includeCurrent: true });
        if (moved) {
          return;
        }
      }
      focusCell(rowIndex, colIndex + 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveDirection('across');
      const preferred = getPreferredClueForCell(clues, rowIndex, colIndex, 'across');
      if (preferred) {
        setActiveClueId(getClueId(preferred));
        const moved = getNextCellInClue(preferred, rowIndex, colIndex, -1) || getNextCellInClue(preferred, rowIndex, colIndex, -1, { includeCurrent: true });
        if (moved) {
          return;
        }
      }
      focusCell(rowIndex, colIndex - 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveDirection('down');
      const preferred = getPreferredClueForCell(clues, rowIndex, colIndex, 'down');
      if (preferred) {
        setActiveClueId(getClueId(preferred));
        const moved = getNextCellInClue(preferred, rowIndex, colIndex, 1) || getNextCellInClue(preferred, rowIndex, colIndex, 1, { includeCurrent: true });
        if (moved) {
          return;
        }
      }
      focusCell(rowIndex + 1, colIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveDirection('down');
      const preferred = getPreferredClueForCell(clues, rowIndex, colIndex, 'down');
      if (preferred) {
        setActiveClueId(getClueId(preferred));
        const moved = getNextCellInClue(preferred, rowIndex, colIndex, -1) || getNextCellInClue(preferred, rowIndex, colIndex, -1, { includeCurrent: true });
        if (moved) {
          return;
        }
      }
      focusCell(rowIndex - 1, colIndex);
    }
  };

  const isCellInWord = (wordId, row, col, clues) => {
    const clue = clues.find(c => String(c.id || c.clueId || c.number) === String(wordId));
    if (!clue) return false;
    const { direction, startRow, startCol, length } = clue;
    if (direction === 'across' || direction === 'horizontal') {
      return row === startRow && col >= startCol && col < startCol + length;
    } else if (direction === 'down' || direction === 'vertical') {
      return col === startCol && row >= startRow && row < startRow + length;
    }
    return false;
  };

  const handleExit = () => {
    const isActivelyPlaying = hasPlayableGridPayload({
      grid: crosswordData.grid,
      clues: crosswordClues,
      acrossClues: crosswordData.acrossClues,
      downClues: crosswordData.downClues,
      cellNumbers: crosswordData.cellNumbers,
    }) && !gameCompleted;

    if (isActivelyPlaying && gameCode) {
      try {
        localStorage.setItem(`EXITED_${gameCode}`, 'true');
      } catch (error) {
        console.error('Error setting crossword exit flag:', error);
      }
    }

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('leaveGame', {
        game_code: gameCode,
        user_id: user?.user_id || user?.uid,
        email: user?.email,
        intentional_exit: true
      });
    }
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    onLogout();
  };

  const handleExitToDashboard = () => {
    const isActivelyPlaying = hasPlayableGridPayload({
      grid: crosswordData.grid,
      clues: crosswordClues,
      acrossClues: crosswordData.acrossClues,
      downClues: crosswordData.downClues,
      cellNumbers: crosswordData.cellNumbers,
    }) && !gameCompleted;

    if (isActivelyPlaying && gameCode) {
      try {
        localStorage.setItem(`EXITED_${gameCode}`, 'true');
      } catch (error) {
        console.error('Error setting crossword exit flag:', error);
      }
    }

    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('leaveGame', {
        game_code: gameCode,
        user_id: user?.user_id || user?.uid,
        email: user?.email,
        intentional_exit: true
      });
    }
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
    setTimeout(() => navigate('/dashboard'), 100);
  };

  const handlePlayAgain = () => {
    setCrosswordData({ grid: [], acrossClues: [], downClues: [], cellNumbers: {} });
    setCrosswordClues([]);
    setCellInputs({});
    setCompletedWords([]);
    setLockedWords({});
    setResult({ message: '', correct: false, points: 0 });
    setGameStats({ score: 0, correct: 0, questionsAnswered: 0 });
    setWinner(null);
    setShowWinnerAnimation(false);
    setGameCompleted(false);
    pendingSubmissionWordIdsRef.current.clear();
    setActiveDirection('across');
    setActiveClueId(null);
    setTimeLeftMs(gameDurationMs || 6 * 60 * 1000);
    setGameEndsAt(null);
    gridLoadedRef.current = false;
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('playAgain', {
        user_id: user?.user_id || user?.uid,
        game_code: gameCode
      });
      fetchLeaderboard();
    } else {
      window.location.reload();
    }
  };

  // ─── Render helpers ────────────────────────────────────────────────────────
  const renderWinnerAnimation = () => {
    if (!showWinnerAnimation || !winner) return null;
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-90 z-50">
        <div className="text-center animate-pulse">
          <div className="text-8xl mb-6 animate-bounce">🏆</div>
          <h1 className="text-5xl font-extrabold text-yellow-400 mb-4">
            {winner.display_name || winner.email?.split('@')[0]}
          </h1>
          <p className="text-2xl text-yellow-200 mb-2">Wins the Crossword!</p>
          <p className="text-xl text-yellow-100">
            Final Score: <span className="font-bold">{winner.score || 0}</span> points
          </p>
        </div>
      </div>
    );
  };

  const formatTime = (milliseconds) => {
    const safeMs = Math.max(0, Number(milliseconds) || 0);
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const renderPodium = () => {
    if (!Array.isArray(leaderboard) || leaderboard.length === 0) {
      return null;
    }

    const topThree = leaderboard.slice(0, 3);
    const positionStyles = {
      1: 'h-40 bg-gradient-to-t from-yellow-700 to-yellow-500 border-yellow-400',
      2: 'h-32 bg-gradient-to-t from-slate-600 to-slate-400 border-slate-300',
      3: 'h-24 bg-gradient-to-t from-amber-800 to-amber-600 border-amber-500',
    };

    const order = [2, 1, 3];

    return (
      <div className="mb-8">
        <h3 className="text-2xl font-bold text-center text-yellow-300 mb-6">Podium</h3>
        <div className="flex items-end justify-center gap-4">
          {order.map((position) => {
            const player = topThree[position - 1];
            if (!player) {
              return null;
            }

            const isMe = isSameUser(player);

            return (
              <div key={`podium-${position}`} className="w-28 text-center">
                <div className="mb-2 text-sm font-semibold text-cyan-200 truncate">
                  {player.display_name || player.name || player.email || `Player ${player.user_id}`}
                  {isMe ? ' (You)' : ''}
                </div>
                <div className="text-cyan-300 text-sm mb-2">
                  {player.score ?? player.current_score ?? 0} pts
                </div>
                <div className={`rounded-t-xl border-2 flex items-center justify-center text-2xl font-bold text-white ${positionStyles[position]}`}>
                  {position === 1 ? '🥇' : position === 2 ? '🥈' : '🥉'}
                </div>
                <div className="py-1 bg-gray-700 rounded-b-lg text-white font-bold">#{position}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const hasLoadedGrid = hasPlayableGridPayload({
    grid: crosswordData.grid,
    clues: crosswordClues,
    acrossClues: crosswordData.acrossClues,
    downClues: crosswordData.downClues,
    cellNumbers: crosswordData.cellNumbers,
  });
  const effectiveWaitingForTeacher = (waitingForTeacher || waitingForFreshStart) && !hasLoadedGrid;
  const displayedTime = formatTime(effectiveWaitingForTeacher && !gameEndsAt ? gameDurationMs : timeLeftMs);

  const renderCrosswordGrid = () => {
    if (effectiveWaitingForTeacher) {
      return (
        <div className="text-center py-16">
          <div className="text-6xl mb-4 animate-pulse">⏳</div>
          <h3 className="text-2xl font-bold text-white mb-2">Waiting For Teacher</h3>
          <p className="text-gray-300">{statusMessage}</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-gray-800 border border-cyan-500 rounded-lg px-4 py-2">
            <span className="text-cyan-300 font-semibold">Time:</span>
            <span className="text-cyan-200 font-mono text-xl">{displayedTime}</span>
          </div>
        </div>
      );
    }

    if (!crosswordData.grid || crosswordData.grid.length === 0) {
      return (
        <div className="text-center py-12">
          <div className="text-6xl mb-4 animate-pulse">🧩</div>
          <h3 className="text-2xl font-bold text-white mb-2">Loading Crossword...</h3>
          <p className="text-gray-300">Waiting for teacher to start the crossword</p>
          {socketRef.current && (
            <button
              onClick={() => {
                setLoading(true);
                socketRef.current.emit('joinGame', {
                  game_code: gameCode,
                  user_id: user?.user_id || user?.uid,
                  email: user?.email
                });
              }}
              className="mt-4 bg-cyan-600 hover:bg-cyan-500 px-4 py-2 rounded-lg text-white"
            >
              Check Status
            </button>
          )}
        </div>
      );
    }

    const { grid, cellNumbers } = crosswordData;
    const rows = grid.length;
    const cols = grid[0] ? grid[0].length : 0;
    const clues = crosswordClues.length > 0 ? crosswordClues : (crosswordData.clues || []);

    const isCellCompleted = (rowIndex, colIndex) => {
      return clues.some(clue => {
        const clueId = clue.id || clue.clueId || clue.number;
        return completedWords.includes(clueId) && isCellInWord(clueId, rowIndex, colIndex, clues);
      });
    };

    const isCellLocked = (rowIndex, colIndex) => {
      return Object.entries(lockedWords).some(([wordId, locker]) => {
        return isCellInWord(wordId, rowIndex, colIndex, clues);
      });
    };

    const isCellLockedByMe = (rowIndex, colIndex) => {
      return Object.entries(lockedWords).some(([wordId, locker]) => {
        return isSameUser(locker) &&
          isCellInWord(wordId, rowIndex, colIndex, clues);
      });
    };

    const acrossClues = crosswordData.acrossClues?.length > 0
      ? crosswordData.acrossClues
      : clues.filter(c => c.direction === 'across' || c.direction === 'horizontal');
    const downClues = crosswordData.downClues?.length > 0
      ? crosswordData.downClues
      : clues.filter(c => c.direction === 'down' || c.direction === 'vertical');

    return (
      <div className="space-y-6">
        {/* Grid */}
        <div className="overflow-x-auto">
          <div className="inline-block">
            {grid.map((row, rowIndex) => (
              <div key={rowIndex} className="flex">
                {row.map((cell, colIndex) => {
                  const isBlack = cell === null || cell === '#' || cell === '' || cell === false;
                  const cellCompleted = !isBlack && isCellCompleted(rowIndex, colIndex);
                  const cellLockedByMe = !isBlack && isCellLockedByMe(rowIndex, colIndex);
                  const cellLocked = !isBlack && isCellLocked(rowIndex, colIndex);
                  const cellNum = cellNumbers ? cellNumbers[`${rowIndex}-${colIndex}`] : null;

                  return (
                    <div
                      key={colIndex}
                      className={`relative w-8 h-8 sm:w-10 sm:h-10 border ${
                        isBlack
                          ? 'bg-gray-900 border-gray-900'
                          : cellCompleted
                          ? 'bg-green-700 border-green-900'
                          : cellLockedByMe
                          ? 'bg-cyan-700 border-cyan-500'
                          : cellLocked
                          ? 'bg-red-800 border-red-600'
                          : 'bg-white border-gray-400'
                      }`}
                    >
                      {cellNum && !isBlack && (
                        <span className="absolute top-0 left-0 text-xs text-gray-700 leading-none pl-0.5 pt-0.5 font-bold z-10">
                          {cellNum}
                        </span>
                      )}
                      {!isBlack && (
                        <input
                          type="text"
                          maxLength={1}
                          data-row={rowIndex}
                          data-col={colIndex}
                          value={cellInputs[`${rowIndex}-${colIndex}`] || ''}
                          onChange={e => handleCellInput(rowIndex, colIndex, e.target.value.slice(-1), clues)}
                          onKeyDown={e => handleKeyDown(e, rowIndex, colIndex, clues)}
                          onFocus={() => {
                            const focusedClue = getCurrentActiveClue(clues, rowIndex, colIndex)
                              || getPreferredClueForCell(clues, rowIndex, colIndex, activeDirection);
                            if (focusedClue) {
                              setActiveClueId(getClueId(focusedClue));
                              setActiveDirection(
                                focusedClue.direction === 'down' || focusedClue.direction === 'vertical'
                                  ? 'down'
                                  : 'across'
                              );
                            }
                          }}
                          disabled={cellCompleted}
                          className={`w-full h-full text-center font-bold text-sm uppercase bg-transparent outline-none cursor-text ${
                            cellCompleted
                              ? 'text-white cursor-not-allowed'
                              : cellLockedByMe
                              ? 'text-cyan-100'
                              : 'text-gray-900'
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Clues panel */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {/* ACROSS */}
          {acrossClues.length > 0 && (
            <div>
              <h4 className="text-lg font-bold text-white mb-2">ACROSS</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {acrossClues.map(clue => {
                  const clueId = clue.id || clue.clueId || clue.number;
                  const isCompleted = completedWords.includes(clueId);
                  const isLockedByMe = isSameUser(lockedWords[clueId]);
                  const isLocked = !!lockedWords[clueId];
                  return (
                    <div
                      key={clueId}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isCompleted ? 'bg-green-800' :
                        isLockedByMe ? 'bg-cyan-800' :
                        isLocked ? 'bg-red-800' :
                        'bg-gray-700 hover:bg-gray-600'
                      }`}
                      onClick={() => {
                        if (!isCompleted) {
                          setActiveDirection('across');
                          setActiveClueId(getClueId(clue));
                          lockWord(clueId, 'across');
                          focusCell(clue.startRow, clue.startCol);
                        }
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-bold text-white text-sm">
                            {clue.number}. {clue.clue || clue.question}
                          </div>
                          <div className="text-xs text-gray-300 mt-1">
                            Length: {clue.length || clue.answer?.length || '?'} letters
                          </div>
                          {isCompleted && <div className="text-xs text-green-300 mt-1">✓ Solved</div>}
                        </div>
                        {isLockedByMe && !isCompleted && (
                          <div className="ml-2">
                            <input
                              type="text"
                              value={wordInput}
                              onChange={e => setWordInput(e.target.value.toUpperCase())}
                              placeholder="Type answer..."
                              className="px-2 py-1 text-sm bg-gray-900 text-white rounded border border-cyan-500 w-28"
                              onClick={e => e.stopPropagation()}
                            />
                            <button
                              onClick={e => { e.stopPropagation(); submitWord(clueId, wordInput); }}
                              className="ml-1 px-2 py-1 bg-cyan-600 text-white text-xs rounded hover:bg-cyan-500"
                            >
                              Submit
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* DOWN */}
          {downClues.length > 0 && (
            <div>
              <h4 className="text-lg font-bold text-white mb-2">DOWN</h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {downClues.map(clue => {
                  const clueId = clue.id || clue.clueId || clue.number;
                  const isCompleted = completedWords.includes(clueId);
                  const isLockedByMe = isSameUser(lockedWords[clueId]);
                  const isLocked = !!lockedWords[clueId];
                  return (
                    <div
                      key={clueId}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        isCompleted ? 'bg-green-800' :
                        isLockedByMe ? 'bg-cyan-800' :
                        isLocked ? 'bg-red-800' :
                        'bg-gray-700 hover:bg-gray-600'
                      }`}
                      onClick={() => {
                        if (!isCompleted) {
                          setActiveDirection('down');
                          setActiveClueId(getClueId(clue));
                          lockWord(clueId, 'down');
                          focusCell(clue.startRow, clue.startCol);
                        }
                      }}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="font-bold text-white text-sm">
                            {clue.number}. {clue.clue || clue.question}
                          </div>
                          <div className="text-xs text-gray-300 mt-1">
                            Length: {clue.length || clue.answer?.length || '?'} letters
                          </div>
                          {isCompleted && <div className="text-xs text-green-300 mt-1">✓ Solved</div>}
                        </div>
                        {isLockedByMe && !isCompleted && (
                          <div className="ml-2">
                            <input
                              type="text"
                              value={wordInput}
                              onChange={e => setWordInput(e.target.value.toUpperCase())}
                              placeholder="Type answer..."
                              className="px-2 py-1 text-sm bg-gray-900 text-white rounded border border-cyan-500 w-28"
                              onClick={e => e.stopPropagation()}
                            />
                            <button
                              onClick={e => { e.stopPropagation(); submitWord(clueId, wordInput); }}
                              className="ml-1 px-2 py-1 bg-cyan-600 text-white text-xs rounded hover:bg-cyan-500"
                            >
                              Submit
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Game Completed Screen ─────────────────────────────────────────────────
  if (gameCompleted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
        <div className="max-w-4xl mx-auto">
          {renderWinnerAnimation()}
          <div className="flex justify-between items-center mb-8 p-6 bg-gray-800 rounded-2xl border-2 border-cyan-600">
            <div>
              <h1 className="text-4xl font-bold text-cyan-400 mb-2">🎉 Crossword Completed! 🎉</h1>
              <p className="text-cyan-200">{gameName} - Final Results</p>
            </div>
            {user && (
              <div className="text-right">
                <p className="text-cyan-100 font-semibold">{user.display_name || user.displayName}</p>
                <p className="text-cyan-200 text-sm">{user.email}</p>
              </div>
            )}
          </div>

          <div className="bg-gray-800 rounded-2xl p-8 border-2 border-cyan-600">
            {winner && !showWinnerAnimation && (
              <div className="text-center mb-8">
                <h2 className="text-4xl font-bold text-yellow-400 mb-4">🏆 Winner!</h2>
                <div className="bg-gradient-to-r from-yellow-600 to-yellow-800 p-6 rounded-xl mb-6">
                  <p className="text-3xl font-bold text-white">
                    {winner.display_name || winner.email}
                  </p>
                  <p className="text-xl text-yellow-200 mt-2">Score: {winner.score || 0} points</p>
                </div>
              </div>
            )}

            {renderPodium()}

            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-cyan-300 mb-4">Your Final Score</h2>
              <div className="text-6xl font-bold text-cyan-400 mb-2">{gameStats.score}</div>
              <div className="text-xl text-cyan-200">
                {gameStats.correct} words solved • {gameStats.questionsAnswered} attempts
              </div>
            </div>

            {leaderboard.length > 0 && (
              <div className="mb-8">
                <h3 className="text-2xl font-bold text-cyan-300 mb-4 text-center">🏆 Final Rankings</h3>
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {leaderboard.map((player, index) => {
                    const isMe = user && player.email === user.email;
                    return (
                      <div
                        key={player.user_id || index}
                        className={`flex justify-between items-center p-4 rounded-lg ${
                          isMe ? 'bg-cyan-700 border-2 border-cyan-400 scale-105' :
                          index === 0 ? 'bg-yellow-600' :
                          index === 1 ? 'bg-gray-600' :
                          index === 2 ? 'bg-amber-800' : 'bg-gray-700'
                        }`}
                      >
                        <div className="flex items-center">
                          <span className="text-xl font-bold mr-4 text-white">
                            {index + 1}
                            {index === 0 && ' 🥇'}
                            {index === 1 && ' 🥈'}
                            {index === 2 && ' 🥉'}
                          </span>
                          <div>
                            <div className={`font-semibold ${isMe ? 'text-cyan-100' : 'text-white'}`}>
                              {player.display_name || player.name || player.email}
                            </div>
                            {isMe && <div className="text-cyan-200 text-sm">You</div>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-cyan-300">
                            {player.score ?? player.current_score ?? 0} pts
                          </div>
                          <div className="text-sm text-gray-300">
                            {player.correct_answers ?? 0} words
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
                onClick={handlePlayAgain}
                className="px-8 py-4 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                🔄 Play Again
              </button>
              <button
                onClick={handleExit}
                className="px-8 py-4 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold text-lg transition-colors"
              >
                🚪 Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main Game Screen (also covers loading) ────────────────────────────────
  const totalWords = (crosswordData.acrossClues?.length || 0) + (crosswordData.downClues?.length || 0);
  const playerCount = leaderboard.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 p-4">
      {renderWinnerAnimation()}

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col lg:flex-row justify-between items-center mb-8 p-6 bg-gray-800 rounded-2xl border-2 border-cyan-600">
          <div className="text-center lg:text-left mb-4 lg:mb-0">
            <h1 className="text-4xl font-bold text-cyan-400 mb-2">🧩 {gameName || 'Crossword Puzzle'}</h1>
            <p className="text-cyan-200">Collaborative Crossword Puzzle</p>
            <div className="mt-2 text-sm text-cyan-300">
              Words: {totalWords} | Solved: {completedWords.length} | Locked: {Object.keys(lockedWords).length}
              {' '}| Connection: {connected ? '🟢 Connected' : '🔴 Disconnected'}
            </div>
            <div className="mt-2 inline-flex items-center gap-2 bg-gray-900 border border-cyan-500 rounded-lg px-3 py-1.5">
              <span className="text-cyan-300 font-semibold">Timer</span>
              <span className={`font-mono text-xl ${timeLeftMs <= 60000 && !effectiveWaitingForTeacher ? 'text-red-400' : 'text-cyan-200'}`}>
                {displayedTime}
              </span>
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
                <p className="text-cyan-100 font-semibold">{user.display_name || user.displayName}</p>
                <p className="text-cyan-200 text-sm">{user.email}</p>
              </div>
            )}
            <div className="flex gap-2 items-center">
              <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm text-gray-300">{connected ? 'Connected' : 'Disconnected'}</span>
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
          {/* Main game area */}
          <div className="lg:col-span-2">
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600">
              {loading ? (
                <div className="text-center py-16">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-cyan-400">Connecting...</h3>
                  <p className="text-cyan-200">Please wait while we connect to the crossword game</p>
                </div>
              ) : (
                <>
                  <div className="mb-6 text-center">
                    <h2 className="text-3xl font-bold text-white mb-2">{gameName || 'CROSSWORD PUZZLE'}</h2>
                    <p className="text-gray-300 text-sm">
                      Solve the crossword by clicking a clue to lock it and entering the answer.
                      Each correct answer gives +5 points.
                    </p>
                  </div>

                  {renderCrosswordGrid()}

                  {result.message && (
                    <div className={`mt-4 p-4 rounded-lg text-center font-bold text-lg ${
                      result.correct
                        ? 'bg-green-600 text-white'
                        : 'bg-red-600 text-white'
                    }`}>
                      {result.message}
                    </div>
                  )}

                  {totalWords > 0 && completedWords.length === totalWords && (
                    <div className="mt-4 p-4 bg-gradient-to-r from-green-700 to-emerald-800 rounded-lg text-center">
                      <div className="text-2xl font-bold text-white mb-2">🎉 Crossword Completed!</div>
                      <p className="text-green-200">All words have been solved. Waiting for final results...</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Sidebar: leaderboard + stats */}
          <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-6 border-2 border-cyan-500 h-fit shadow-lg">
            <div className="flex items-center justify-center mb-6">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-400 bg-clip-text text-transparent">
                🏆 Live Leaderboard
              </h2>
            </div>

            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {leaderboard.length > 0 ? (
                leaderboard.map((player, index) => {
                  const isMe = user && player.email === user.email;
                  const rankColors = [
                    'from-yellow-500 to-yellow-600 border-yellow-400',
                    'from-slate-400 to-slate-500 border-slate-300',
                    'from-orange-600 to-orange-700 border-orange-500'
                  ];
                  const rankColor = isMe
                    ? 'from-cyan-600 to-cyan-700 border-cyan-400'
                    : rankColors[index] || 'from-gray-700 to-gray-800 border-gray-600';
                  const medals = ['🥇', '🥈', '🥉'];

                  return (
                    <div
                      key={player.user_id || player.email || index}
                      className={`bg-gradient-to-r ${rankColor} border-2 rounded-xl p-4 transition-all duration-300 ${
                        isMe ? 'scale-105 shadow-cyan-500/50 shadow-lg' : ''
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`flex items-center justify-center w-10 h-10 rounded-full font-bold text-lg ${
                            index < 3 ? 'bg-black bg-opacity-40 text-yellow-200' : 'bg-black bg-opacity-30 text-cyan-200'
                          }`}>
                            {index + 1}
                          </div>
                          {medals[index] && <span className="text-xl">{medals[index]}</span>}
                          <div className="min-w-0 flex-1">
                            <div className={`truncate font-bold text-sm ${
                              isMe ? 'text-white' : index < 3 ? 'text-gray-900' : 'text-gray-100'
                            }`}>
                              {player.display_name || player.name || player.email?.split('@')[0] || `Player ${player.user_id}`}
                            </div>
                            {isMe && (
                              <div className={`text-xs font-semibold ${index < 3 ? 'text-gray-100' : 'text-cyan-300'}`}>
                                ★ You
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="text-right ml-4">
                          <div className={`text-2xl font-bold ${
                            isMe ? 'text-white' : index < 3 ? 'text-gray-900' : 'text-cyan-300'
                          }`}>
                            {player.score ?? player.current_score ?? 0}
                          </div>
                          <div className={`text-xs mt-1 ${
                            isMe ? 'text-gray-300' : index < 3 ? 'text-gray-800' : 'text-gray-400'
                          }`}>
                            {player.correct_answers ?? 0} words
                          </div>
                        </div>
                      </div>
                      <div className="mt-2.5 w-full bg-black bg-opacity-30 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            isMe ? 'bg-cyan-300' : index < 3 ? 'bg-gray-300' : 'bg-cyan-400'
                          }`}
                          style={{
                            width: `${Math.min(
                              ((player.score ?? player.current_score ?? 0) / (leaderboard[0]?.score ?? leaderboard[0]?.current_score ?? 1000)) * 100,
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

            {/* Your stats */}
            <div className="mt-6 p-4 bg-gray-700 rounded-lg">
              <h3 className="text-lg font-bold text-cyan-300 mb-3">Your Stats</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-2xl font-bold text-cyan-400">{gameStats.score}</div>
                  <div className="text-xs text-gray-300">Score</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-green-400">{gameStats.correct}</div>
                  <div className="text-xs text-gray-300">Words Solved</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-cyan-300">{gameStats.questionsAnswered}</div>
                  <div className="text-xs text-gray-300">Attempts</div>
                </div>
              </div>
            </div>

            {/* Game status */}
            <div className="mt-4 p-3 bg-gray-700 rounded-lg">
              <h3 className="text-lg font-bold text-cyan-300 mb-2">Game Status</h3>
              <div className="text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span>Time Left:</span>
                  <span className={timeLeftMs <= 60000 && !effectiveWaitingForTeacher ? 'text-red-400 font-bold' : 'text-cyan-300'}>{displayedTime}</span>
                </div>
                <div className="flex justify-between">
                  <span>Words:</span>
                  <span className="text-cyan-300">{totalWords}</span>
                </div>
                <div className="flex justify-between">
                  <span>Players:</span>
                  <span className="text-cyan-300">{playerCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className={gameCompleted ? 'text-cyan-300' : effectiveWaitingForTeacher ? 'text-yellow-400' : 'text-green-400'}>
                    {gameCompleted ? 'Completed 🔵' : effectiveWaitingForTeacher ? 'Waiting 🟡' : 'Active 🟢'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Solved:</span>
                  <span className="text-green-400">{completedWords.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Locked:</span>
                  <span className="text-yellow-400">{Object.keys(lockedWords).length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Connection:</span>
                  <span className={connected ? 'text-green-400' : 'text-red-400'}>
                    {connected ? 'Connected 🟢' : 'Disconnected 🔴'}
                  </span>
                </div>
              </div>
            </div>

            {spectators.length > 0 && (
              <div className="mt-4 p-3 bg-gray-700 rounded-lg">
                <h3 className="text-lg font-bold text-cyan-300 mb-2">👥 Spectators</h3>
                <div className="text-sm text-gray-300">
                  {spectators.map((spec, idx) => (
                    <div key={idx} className="truncate">{spec.display_name || spec.email}</div>
                  ))}
                </div>
              </div>
            )}

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

export default CrosswordGame;
