// src/utils/helpers.js

// ============================================
// OLD FUNCTIONS (for compatibility)
// ============================================

// Format accuracy to 1 decimal place (OLD)
export const formatAccuracyOld = (accuracy) => {
  if (accuracy === null || accuracy === undefined) return '0.0';
  const numAccuracy = typeof accuracy === 'number' ? accuracy : parseFloat(accuracy || 0);
  return isNaN(numAccuracy) ? '0.0' : numAccuracy.toFixed(1);
};

// Format score with commas (OLD)
export const formatScoreOld = (score) => {
  if (score === null || score === undefined) return '0';
  const numScore = typeof score === 'number' ? score : parseInt(score || 0);
  return isNaN(numScore) ? '0' : numScore.toLocaleString();
};

// Format percentage (OLD)
export const formatPercentageOld = (value, total) => {
  if (!total || total === 0) return '0.0%';
  const percentage = (value / total) * 100;
  return formatAccuracyOld(percentage) + '%';
};

// ============================================
// NEW/UPDATED FUNCTIONS (current version)
// ============================================

// Format accuracy to 2 decimal places (NEW)
export const formatAccuracy = (accuracy) => {
  if (accuracy === null || accuracy === undefined) return "0.00";
  const num = parseFloat(accuracy);
  return isNaN(num) ? "0.00" : num.toFixed(2);
};

// Format score with commas (NEW)
export const formatScore = (score) => {
  if (score === null || score === undefined) return "0";
  const num = parseInt(score);
  return isNaN(num) ? "0" : num.toLocaleString();
};

// Format percentage (NEW - single parameter version)
export const formatPercentage = (value) => {
  if (value === null || value === undefined) return "0%";
  const num = parseFloat(value);
  return isNaN(num) ? "0%" : `${num.toFixed(1)}%`;
};

// Format percentage with two parameters (NEW - alternative version)
export const formatPercentageFromValues = (value, total) => {
  if (value === null || value === undefined || total === null || total === undefined || total === 0) return "0%";
  const percentage = (parseFloat(value) / parseFloat(total)) * 100;
  return isNaN(percentage) ? "0%" : `${percentage.toFixed(1)}%`;
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Capitalize first letter
export const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
};

// Format time in seconds to MM:SS
export const formatTime = (seconds) => {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '0:00';
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.max(0, seconds) % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// Validate email
export const validateEmail = (email) => {
  if (!email) return false;
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Debounce function
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Get difficulty color
export const getDifficultyColor = (difficulty) => {
  if (!difficulty) return 'gray';
  switch (difficulty.toLowerCase()) {
    case 'easy': return 'green';
    case 'medium': return 'orange';
    case 'hard': return 'red';
    default: return 'gray';
  }
};

// Calculate rank suffix
export const getRankSuffix = (rank) => {
  if (rank === null || rank === undefined) return 'th';
  const lastDigit = rank % 10;
  const lastTwoDigits = rank % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return 'th';
  if (lastDigit === 1) return 'st';
  if (lastDigit === 2) return 'nd';
  if (lastDigit === 3) return 'rd';
  return 'th';
};

// Truncate text with ellipsis
export const truncateText = (text, maxLength) => {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

// Parse CSV string to array
export const parseCSV = (csvString) => {
  if (!csvString) return [];
  return csvString.split(',').map(item => item.trim());
};

// Safe JSON parse
export const safeJSONParse = (str, defaultValue = null) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return defaultValue;
  }
};

// Format date
export const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Generate random ID
export const generateId = (length = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};
const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
};
const getPlayerKey = (player) => {
  if (!player) return null;
  return player.user_id ?? player.id ?? player.email ?? player.display_name ?? player.name ?? null;
};
export const mergeGameLeaderboards = (wisdomPlayers = [], crosswordPlayers = []) => {
  const merged = new Map();
  const ensurePlayer = (player) => {
    const key = getPlayerKey(player);
    if (key === null || key === undefined) return null;
    if (!merged.has(key)) {
      merged.set(key, {
        user_id: player.user_id ?? player.id ?? null,
        id: player.id ?? player.user_id ?? null,
        email: player.email || '',
        display_name: player.display_name || player.name || '',
        name: player.name || player.display_name || '',
        role: player.role || 'student',
        wisdom_score: 0,
        wisdom_attempts: 0,
        wisdom_correct_answers: 0,
        wisdom_accuracy: 0,
        crossword_score: 0,
        crossword_attempts: 0,
        crossword_correct_answers: 0,
        crossword_accuracy: 0,
      });
    }
    const existing = merged.get(key);
    existing.user_id = existing.user_id ?? player.user_id ?? player.id ?? null;
    existing.id = existing.id ?? player.id ?? player.user_id ?? null;
    existing.email = existing.email || player.email || '';
    existing.display_name = existing.display_name || player.display_name || player.name || '';
    existing.name = existing.name || player.name || player.display_name || '';
    existing.role = existing.role || player.role || 'student';
    return existing;
  };
  wisdomPlayers.forEach((player) => {
    const entry = ensurePlayer(player);
    if (!entry) return;
    entry.wisdom_score = toNumber(player.score ?? player.wisdom_score ?? player.totalScore);
    entry.wisdom_attempts = toNumber(player.attempts ?? player.questions_answered ?? player.wisdom_attempts ?? player.gamesPlayed);
    entry.wisdom_correct_answers = toNumber(player.correct_answers ?? player.wisdomCorrect ?? player.correct);
    entry.wisdom_accuracy = toNumber(player.accuracy ?? player.wisdomAccuracy);
  });
  crosswordPlayers.forEach((player) => {
    const entry = ensurePlayer(player);
    if (!entry) return;
    entry.crossword_score = toNumber(player.score ?? player.crossword_score ?? player.crosswordScore ?? player.totalScore);
    entry.crossword_attempts = toNumber(player.attempts ?? player.questions_answered ?? player.crossword_attempts ?? player.crosswordGames ?? player.gamesPlayed);
    entry.crossword_correct_answers = toNumber(player.correct_answers ?? player.crosswordCorrect ?? player.correct);
    entry.crossword_accuracy = toNumber(player.accuracy ?? player.crosswordAccuracy);
  });
  return Array.from(merged.values())
    .map((player) => {
      const totalAttempts = player.wisdom_attempts + player.crossword_attempts;
      const totalCorrect = player.wisdom_correct_answers + player.crossword_correct_answers;
      const totalScore = player.wisdom_score + player.crossword_score;
      const combinedAccuracy = totalAttempts > 0 ? (totalCorrect * 100) / totalAttempts : 0;
      return {
        ...player,
        total_score: totalScore,
        totalScore,
        combined_accuracy: combinedAccuracy,
        combinedAccuracy,
        score: totalScore,
        accuracy: combinedAccuracy,
      };
    })
    .sort((a, b) => (b.total_score - a.total_score) || (b.combined_accuracy - a.combined_accuracy));
};
export const mergeStudentGameBreakdowns = (wisdomStudents = [], crosswordStudents = []) => {
  const merged = new Map();
  wisdomStudents.forEach((student) => {
    const key = getPlayerKey(student);
    if (key === null || key === undefined) return;
    merged.set(key, {
      ...student,
      id: student.id ?? student.user_id ?? null,
      user_id: student.user_id ?? student.id ?? null,
      name: student.name || student.display_name || '',
      display_name: student.display_name || student.name || '',
      wisdomScore: toNumber(student.wisdomScore ?? student.totalScore ?? student.score),
      wisdomGames: toNumber(student.wisdomGames ?? student.gamesPlayed ?? student.attempted),
      wisdomCorrect: toNumber(student.wisdomCorrect ?? student.correct_answers ?? student.correct),
      wisdomAccuracy: toNumber(student.wisdomAccuracy ?? student.accuracy),
      crosswordScore: 0,
      crosswordGames: 0,
      crosswordCorrect: 0,
      crosswordAccuracy: 0,
    });
  });
  crosswordStudents.forEach((student) => {
    const key = getPlayerKey(student);
    if (key === null || key === undefined) return;
    const existing = merged.get(key) || {
      id: student.id ?? student.user_id ?? null,
      user_id: student.user_id ?? student.id ?? null,
      name: student.name || student.display_name || '',
      display_name: student.display_name || student.name || '',
      email: student.email || '',
      attempted: 0,
      correct: 0,
      wrong: 0,
      gamesPlayed: 0,
      avgTime: 0,
      wisdomScore: 0,
      wisdomGames: 0,
      wisdomCorrect: 0,
      wisdomAccuracy: 0,
    };
    existing.email = existing.email || student.email || '';
    existing.crosswordScore = toNumber(student.crosswordScore ?? student.score ?? student.totalScore);
    existing.crosswordGames = toNumber(student.crosswordGames ?? student.gamesPlayed ?? student.attempts);
    existing.crosswordCorrect = toNumber(student.crosswordCorrect ?? student.correct_answers ?? student.correct);
    existing.crosswordAccuracy = toNumber(student.crosswordAccuracy ?? student.accuracy);
    merged.set(key, existing);
  });
  return Array.from(merged.values())
    .map((student) => {
      const totalGames = student.wisdomGames + student.crosswordGames;
      const totalCorrect = student.wisdomCorrect + student.crosswordCorrect;
      const totalAttempts = toNumber(student.attempted) + student.crosswordGames;
      const totalScore = student.wisdomScore + student.crosswordScore;
      const combinedAccuracy = totalGames > 0
        ? ((student.wisdomAccuracy * student.wisdomGames) + (student.crosswordAccuracy * student.crosswordGames)) / totalGames
        : 0;
      return {
        ...student,
        totalGames,
        totalScore,
        combinedAccuracy,
        accuracy: combinedAccuracy,
      };
    })
    .sort((a, b) => (b.totalScore - a.totalScore) || (b.combinedAccuracy - a.combinedAccuracy));
};

// ============================================
// BACKWARD COMPATIBILITY ALIASES
// ============================================

// For backward compatibility, you can keep the old names pointing to new functions
// OR use new names and update your imports in components

// Option 1: Export everything with clear names
export default {
  // Old functions (deprecated but kept for compatibility)
  formatAccuracyOld,
  formatScoreOld,
  formatPercentageOld,
  
  // New functions
  formatAccuracy,
  formatScore,
  formatPercentage,
  formatPercentageFromValues,
  
  // Utility functions
  capitalize,
  formatTime,
  validateEmail,
  debounce,
  getDifficultyColor,
  getRankSuffix,
  truncateText,
  parseCSV,
  safeJSONParse,
  formatDate,
  generateId,
  mergeGameLeaderboards,
  mergeStudentGameBreakdowns
};

// Option 2: Create aliases for backward compatibility
export const formatAccuracyCompat = formatAccuracy; // Alias for old code
export const formatScoreCompat = formatScore; // Alias for old code