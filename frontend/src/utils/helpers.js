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
  generateId
};

// Option 2: Create aliases for backward compatibility
export const formatAccuracyCompat = formatAccuracy; // Alias for old code
export const formatScoreCompat = formatScore; // Alias for old code