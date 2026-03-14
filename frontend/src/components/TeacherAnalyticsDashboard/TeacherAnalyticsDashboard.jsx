import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, ComposedChart, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis
} from 'recharts';
import { mergeStudentGameBreakdowns } from '../../utils/helpers';

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4001";
const CROSSWORD_API_BASE = process.env.REACT_APP_CROSSWORD_API_BASE || "http://localhost:4002";

// ⚡ DEBOUNCE UTILITY FOR OPTIMIZED BUTTON CLICKS
const createDebouncedFunction = (fn, delay = 300) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

const TeacherAnalyticsDashboard = ({ teacherId, onLogout }) => {
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRange, setTimeRange] = useState('week');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentDetailModal, setStudentDetailModal] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState([]);
  const [loadingAnswers, setLoadingAnswers] = useState(false);
  const [selectedQuestion, setSelectedQuestion] = useState(null);
  const [questionDetailModal, setQuestionDetailModal] = useState(false);
  const [questionAnswers, setQuestionAnswers] = useState([]);
  const [loadingQuestionAnswers, setLoadingQuestionAnswers] = useState(false);
  const [selectedPerformanceBracket, setSelectedPerformanceBracket] = useState(null);
  const [performanceBracketModal, setPerformanceBracketModal] = useState(false);
  const [bracketStudents, setBracketStudents] = useState([]);
const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Analytics state
  const [overview, setOverview] = useState({
    totalStudents: 0,
    totalQuestionsAnswered: 0,
    avgAccuracy: 0,
    totalGamesPlayed: 0,
    prevPeriodComparison: {
      students: 0,
      questions: 0,
      accuracy: 0,
      games: 0
    }
  });

  const [performanceData, setPerformanceData] = useState({
    dailyActivity: [],
    difficultyDistribution: [],
    studentPerformance: [],
    topStudents: [],
    radarData: [],
    students: [],
    selectedRadarStudent: null,
    questions: [],
    answers: []
  });

  const [quickStats, setQuickStats] = useState({
    hardestQuestion: { text: 'No data', successRate: 0 },
    easiestQuestion: { text: 'No data', successRate: 0 },
    mostActiveStudent: { name: 'No data', gamesPlayed: 0 },
    mostImproved: { name: 'N/A', pointsGained: 0 }
  });

  const [detailedRecords, setDetailedRecords] = useState({
    students: [],
    questions: []
  });

  const [hasData, setHasData] = useState({
    dailyActivity: false,
    difficultyDistribution: false,
    studentPerformance: false,
    radarData: false,
    questions: false,
    students: false
  });

  const COLORS = ['#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4'];

  // Bracket-specific colors for pie chart
  const BRACKET_COLORS = {
    '80+%': '#10B981',      // Emerald Green
    '50-75%': '#F59E0B',    // Amber Gold
    '30-50%': '#EF4444',    // Red
    '<30%': '#8B5CF6'       // Purple
  };

  // ✅ AUTO-REFRESH EVERY 30 SECONDS
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      console.log('🔄 Auto-refreshing analytics...');
      fetchAllAnalytics();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [timeRange, autoRefresh]);

  useEffect(() => {
    fetchAllAnalytics();
  }, [timeRange]);

  // ⚡ Recalculate radar data when selected student changes with instant display
  useEffect(() => {
    const calculateRadarData = (answersData, questionsData) => {
      if (!answersData || !questionsData || questionsData.length === 0) return [];
      
      const topicsSet = new Set(questionsData.map(q => q.topic).filter(Boolean));
      const topics = Array.from(topicsSet);
      const radarDataArray = [];
      let totalAttemptsOverall = 0;

      topics.forEach(topic => {
        const topicQuestionIds = questionsData
          .filter(q => q.topic === topic)
          .map(q => q.id);
        const topicAttempts = answersData.filter(a =>
          topicQuestionIds.includes(a.question_id)
        ).length;
        totalAttemptsOverall += topicAttempts;
      });

      topics.forEach(topic => {
        const topicQuestionIds = questionsData
          .filter(q => q.topic === topic)
          .map(q => q.id);
        const topicAnswers = answersData.filter(a =>
          topicQuestionIds.includes(a.question_id)
        );
        const attempts = topicAnswers.length;
        const correct = topicAnswers.filter(a => a.is_correct).length;
        const accuracy = attempts > 0 ? (correct / attempts) * 100 : 0;
        const attemptsPercentage = totalAttemptsOverall > 0
          ? (attempts / totalAttemptsOverall) * 100
          : 0;

        radarDataArray.push({
          topic,
          accuracy,
          attemptsPercentage
        });
      });

      return radarDataArray;
    };

    // Instantly update radar data for selected student or all students
    if (!performanceData.selectedRadarStudent) {
      // "All Students" selected - show aggregate data
      const allRadarData = calculateRadarData(performanceData.answers, performanceData.questions);
      setPerformanceData(prev => ({ ...prev, radarData: allRadarData }));
    } else {
      // Specific student selected
      const selectedStudentId = parseInt(performanceData.selectedRadarStudent);
      const studentAnswers = performanceData.answers.filter(a => a.user_id === selectedStudentId);
      const studentRadarData = calculateRadarData(studentAnswers, performanceData.questions);
      setPerformanceData(prev => ({ ...prev, radarData: studentRadarData }));
    }
  }, [performanceData.selectedRadarStudent, performanceData.answers, performanceData.questions]);

// ⚡ Ref to prevent rapid successive calls
  const fetchInProgressRef = React.useRef(false);

  const fetchAllAnalytics = useCallback(async () => {
    // Prevent multiple simultaneous fetches
    if (fetchInProgressRef.current) return;
    
    fetchInProgressRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const tId = teacherId || localStorage.getItem('user_id') || 1;

      const [
        overviewData,
        questionsData,
        studentsData,
        answersData,
        performanceStats
      ] = await Promise.all([
        fetchOverview(tId, timeRange),
        fetchQuestions(),
        fetchStudents(tId),
        fetchAnswers(),
        fetchPerformanceStats()
      ]);

      processAllData(
        overviewData,
        questionsData,
        studentsData,
        answersData,
        performanceStats
      );

    } catch (err) {
      console.error('Error fetching analytics:', err);
      setError('Failed to load analytics data. Please try again.');
    } finally {
      setLoading(false);
      fetchInProgressRef.current = false;
    }
  }, [teacherId, timeRange]);

  const fetchOverview = async (teacherId, timeRange = 'week') => {
    try {
      const [wisdomRes, crosswordRes] = await Promise.all([
        fetch(`${API_BASE}/teacher/${teacherId}/analytics?timeRange=${timeRange}`),
        fetch(`${CROSSWORD_API_BASE}/crossword/analytics/overview?timeRange=${timeRange}`),
      ]);
      if (!wisdomRes.ok) throw new Error('Failed to fetch overview');

      const wisdomData = await wisdomRes.json();
      const crosswordData = crosswordRes.ok ? await crosswordRes.json() : { overview: {} };

      const wisdomOverview = wisdomData?.overview || wisdomData || {};
      const crosswordOverview = crosswordData?.overview || {};
      const wisdomPrev = wisdomOverview.prevPeriodComparison || {};
      const crosswordPrev = crosswordOverview.prevPeriodComparison || {};

      return {
        ...wisdomData,
        overview: {
          ...wisdomOverview,
          totalQuestionsAnswered: (wisdomOverview.totalQuestionsAnswered || 0) + (crosswordOverview.totalQuestionsAnswered || 0),
          totalGamesPlayed: (wisdomOverview.totalGamesPlayed || 0) + (crosswordOverview.totalGamesPlayed || 0),
          avgAccuracy: ((wisdomOverview.avgAccuracy || 0) + (crosswordOverview.avgAccuracy || 0)) / ((crosswordRes.ok ? 2 : 1)),
          prevPeriodComparison: {
            ...wisdomPrev,
            questions: (wisdomPrev.questions || 0) + (crosswordPrev.questions || 0),
            games: (wisdomPrev.games || 0) + (crosswordPrev.games || 0),
            accuracy: (wisdomPrev.accuracy || 0) + (crosswordPrev.accuracy || 0),
          }
        }
      };
    } catch (error) {
      console.error('Error fetching overview:', error);
      return {
        overview: {
          totalStudents: 0,
          totalQuestionsAnswered: 0,
          avgAccuracy: 0,
          totalGamesPlayed: 0,
          prevPeriodComparison: { students: 0, questions: 0, accuracy: 0, games: 0 }
        },
        dailyActivity: [],
        difficultyBreakdown: []
      };
    }
  };

  const fetchQuestions = async () => {
    try {
      const res = await fetch(`${API_BASE}/questions`);
      const data = await res.json();
      return Array.isArray(data) ? data : (data.questions || []);
    } catch (error) {
      console.error('Error fetching questions:', error);
      return [];
    }
  };

  const fetchStudents = async (teacherId) => {
    try {
      const [wisdomRes, crosswordRes] = await Promise.all([
        fetch(`${API_BASE}/teacher/${teacherId}/analytics/students-game-breakdown`),
        fetch(`${CROSSWORD_API_BASE}/crossword/analytics/students-breakdown`),
      ]);

      const wisdomData = wisdomRes.ok ? await wisdomRes.json() : [];
      const crosswordData = crosswordRes.ok ? await crosswordRes.json() : [];

      if (wisdomRes.ok) {
        return mergeStudentGameBreakdowns(
          Array.isArray(wisdomData) ? wisdomData : [],
          Array.isArray(crosswordData) ? crosswordData : []
        );
      }

      const fallbackRes = await fetch(`${API_BASE}/teacher/${teacherId}/analytics/students`);
      const fallbackData = await fallbackRes.json();
      return mergeStudentGameBreakdowns(
        Array.isArray(fallbackData) ? fallbackData : [],
        Array.isArray(crosswordData) ? crosswordData : []
      );
    } catch (error) {
      console.error('Error fetching students:', error);
      try {
        // Fallback to regular students endpoint
        const fallbackRes = await fetch(`${API_BASE}/teacher/${teacherId}/analytics/students`);
        const fallbackData = await fallbackRes.json();
        return Array.isArray(fallbackData) ? fallbackData : [];
      } catch (fallbackError) {
        console.error('Error fetching fallback students:', fallbackError);
        return [];
      }
    }
  };

  const fetchAnswers = async () => {
    try {
      const res = await fetch(`${API_BASE}/answers`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching answers:', error);
      return [];
    }
  };

  const fetchPerformanceStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/performance`);
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('Error fetching performance stats:', error);
      return [];
    }
  };

  const fetchStudentAnswers = async (userId) => {
    setLoadingAnswers(true);
    try {
      const res = await fetch(`${API_BASE}/user/${userId}/answers?type=all`);
      const data = await res.json();
      setStudentAnswers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error fetching student answers:', error);
      setStudentAnswers([]);
    } finally {
      setLoadingAnswers(false);
    }
  };

  const processAllData = (
    overviewData,
    questions,
    students,
    answers,
    performanceStats
  ) => {
    // Set overview data - handle both nested and flat structures
    const overviewInfo = overviewData?.overview || overviewData || {};
    
    // Calculate stats from data
    const totalStudents = overviewInfo.totalStudents || students.length || 0;
    const totalQuestionsAnswered = overviewInfo.totalQuestionsAnswered || answers.length || 0;
    const totalGamesPlayed = overviewInfo.totalGamesPlayed || (answers.length > 0 ? [...new Set(answers.map(a => a.game_session_id))].length : 0);
    
    // Calculate average accuracy from answers
    let avgAccuracy = overviewInfo.avgAccuracy || 0;
    if (avgAccuracy === 0 && answers.length > 0) {
      const correctAnswers = answers.filter(a => a.is_correct).length;
      avgAccuracy = (correctAnswers / answers.length * 100).toFixed(2);
    }
    
    setOverview({
      totalStudents: totalStudents,
      totalQuestionsAnswered: totalQuestionsAnswered,
      avgAccuracy: parseFloat(avgAccuracy) || 0,
      totalGamesPlayed: totalGamesPlayed,
      prevPeriodComparison: overviewInfo.prevPeriodComparison || { students: 0, questions: 0, accuracy: 0, games: 0 }
    });

    // Process daily activity - Calculate accuracy correctly
    const dailyActivity = [];
    if (answers.length > 0) {
      // Group by date
      const answersByDate = {};
      answers.forEach(answer => {
        if (answer.answered_at) {
          const date = new Date(answer.answered_at);
          const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          
          if (!answersByDate[dateStr]) {
            answersByDate[dateStr] = { 
              answers: 0, 
              correct: 0,
              games: new Set()
            };
          }
          answersByDate[dateStr].answers++;
          if (answer.is_correct) answersByDate[dateStr].correct++;
          answersByDate[dateStr].games.add(answer.game_session_id);
        }
      });

      // Convert to array with correct accuracy calculation
      Object.keys(answersByDate).sort((a, b) => {
        const dateA = new Date(a);
        const dateB = new Date(b);
        return dateA - dateB;
      }).forEach(date => {
        const dayData = answersByDate[date];
        const accuracy = dayData.answers > 0 
          ? Math.round((dayData.correct / dayData.answers) * 100) 
          : 0;
        
        dailyActivity.push({
          date: date,
          answers: dayData.answers,
          games: dayData.games.size,
          correct: dayData.correct,
          accuracy: accuracy
        });
      });
    }

    setHasData(prev => ({ ...prev, dailyActivity: dailyActivity.length > 0 }));
    setPerformanceData(prev => ({ ...prev, dailyActivity }));

    // Process difficulty distribution - Show accuracy by difficulty
    const difficultyDistribution = [];
    const difficulties = ['Easy', 'Medium', 'Hard'];
    
    difficulties.forEach(difficulty => {
      // Get all questions for this difficulty
      const questionsAtDifficulty = questions.filter(q => q.difficulty === difficulty);
      
      // Get all answers for questions at this difficulty
      const answersAtDifficulty = answers.filter(a => 
        questionsAtDifficulty.some(q => q.id === a.question_id)
      );
      const totalAnswers = answersAtDifficulty.length;
      
      // Count correct answers for questions at this difficulty
      const correctCount = answersAtDifficulty.filter(a => a.is_correct).length;
      
      // Calculate accuracy percentage based on attempts, not total questions
      const accuracy = totalAnswers > 0 ? (correctCount / totalAnswers) * 100 : 0;
      
      difficultyDistribution.push({
        difficulty,
        'Accuracy': accuracy
      });
    });
    
    setHasData(prev => ({ ...prev, difficultyDistribution: difficultyDistribution.some(d => d['Accuracy'] > 0) }));
    setPerformanceData(prev => ({ ...prev, difficultyDistribution }));

    // Process student performance
    const studentPerformance = students.map(s => {
      const perf = performanceStats.find(p => p.user_id === s.id) || {};
      const studentAnswers = answers.filter(a => a.user_id === s.id);
      const gamesPlayed = studentAnswers.length > 0 
        ? [...new Set(studentAnswers.map(a => a.game_session_id))].length 
        : 0;
      
      return {
        id: s.id,
        name: s.name || 'Unknown',
        email: s.email || '',
        // Old format fields (for backward compatibility)
        totalScore: s.totalScore || perf.score || 0,
        accuracy: parseFloat(s.accuracy || s.combinedAccuracy || perf.accuracy || 0),
        gamesPlayed: gamesPlayed,
        attempted: studentAnswers.length || s.totalGames || s.attempted || perf.attempts || 0,
        correct: studentAnswers.filter(a => a.is_correct).length || s.correct || perf.correct_answers || 0,
        wrong: studentAnswers.filter(a => !a.is_correct).length || 0,
        // New game-specific fields (from game-breakdown endpoint)
        wisdomScore: parseInt(s.wisdomScore) || 0,
        wisdomGames: parseInt(s.wisdomGames) || 0,
        wisdomCorrect: parseInt(s.wisdomCorrect) || 0,
        wisdomAccuracy: parseFloat(s.wisdomAccuracy) || 0,
        crosswordScore: parseInt(s.crosswordScore) || 0,
        crosswordGames: parseInt(s.crosswordGames) || 0,
        crosswordCorrect: parseInt(s.crosswordCorrect) || 0,
        crosswordAccuracy: parseFloat(s.crosswordAccuracy) || 0,
        combinedAccuracy: parseFloat(s.combinedAccuracy) || 0
      };
    }).sort((a, b) => b.totalScore - a.totalScore);

    setHasData(prev => ({ ...prev, studentPerformance: studentPerformance.length > 0 }));
    setPerformanceData(prev => ({ ...prev, studentPerformance, students: studentPerformance }));

    // ✅ PROCESS RADAR DATA - DYNAMICALLY FROM DATABASE
    const calculateRadarData = (answersData, questionsData) => {
      const topicsSet = new Set(questionsData.map(q => q.topic).filter(Boolean));
      const topics = Array.from(topicsSet);
      const radarDataArray = [];
      let totalAttemptsOverall = 0;

      topics.forEach(topic => {
        const topicQuestionIds = questionsData
          .filter(q => q.topic === topic)
          .map(q => q.id);
        const topicAttempts = answersData.filter(a =>
          topicQuestionIds.includes(a.question_id)
        ).length;
        totalAttemptsOverall += topicAttempts;
      });

      topics.forEach(topic => {
        const topicQuestionIds = questionsData
          .filter(q => q.topic === topic)
          .map(q => q.id);
        const topicAnswers = answersData.filter(a =>
          topicQuestionIds.includes(a.question_id)
        );
        const attempts = topicAnswers.length;
        const correct = topicAnswers.filter(a => a.is_correct).length;
        const accuracy = attempts > 0 ? (correct / attempts) * 100 : 0;
        const attemptsPercentage = totalAttemptsOverall > 0
          ? (attempts / totalAttemptsOverall) * 100
          : 0;

        radarDataArray.push({
          topic,
          accuracy,
          attemptsPercentage
        });
      });

      return radarDataArray;
    };

    // Calculate all students radar data - filtering is handled by useEffect
    let radarData = calculateRadarData(answers, questions);

    setHasData(prev => ({ ...prev, radarData: radarData.length > 0 }));
    setPerformanceData(prev => ({ ...prev, radarData, questions, answers }));
    // Process quick stats
    const quickStatsData = processQuickStats(questions, answers, studentPerformance);
    setQuickStats(quickStatsData);

    // Process detailed records
    const detailed = processDetailedRecords(studentPerformance, questions, answers);
    setHasData(prev => ({ ...prev, questions: detailed.questions.length > 0, students: detailed.students.length > 0 }));
    setDetailedRecords(detailed);
  };

  const processQuickStats = (questions, answers, studentPerformance) => {
    let hardest = { text: 'No data', successRate: 100 };
    let easiest = { text: 'No data', successRate: 0 };
    let hasQuestionData = false;
    
    questions.forEach(q => {
      const questionAnswers = answers.filter(a => a.question_id === q.id);
      if (questionAnswers.length > 0) {
        hasQuestionData = true;
        const correctCount = questionAnswers.filter(a => a.is_correct).length;
        const successRate = (correctCount / questionAnswers.length) * 100;
        
        if (successRate < hardest.successRate) {
          hardest = { text: q.text, successRate: Math.round(successRate) };
        }
        if (successRate > easiest.successRate) {
          easiest = { text: q.text, successRate: Math.round(successRate) };
        }
      }
    });

    if (!hasQuestionData) {
      hardest = { text: 'No question data', successRate: 0 };
      easiest = { text: 'No question data', successRate: 0 };
    }

    let mostActive = { name: 'No data', gamesPlayed: 0 };
    studentPerformance.forEach(student => {
      if (student.gamesPlayed > mostActive.gamesPlayed) {
        mostActive = {
          name: student.name,
          gamesPlayed: student.gamesPlayed
        };
      }
    });

    let mostImproved = { name: 'N/A', pointsGained: 0 };
    if (studentPerformance.length > 0) {
      const sorted = [...studentPerformance].sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
      if (sorted[0]) {
        mostImproved = {
          name: sorted[0].name,
          pointsGained: sorted[0].totalScore || 0
        };
      }
    }

    return { 
      hardestQuestion: hardest, 
      easiestQuestion: easiest, 
      mostActiveStudent: mostActive, 
      mostImproved: mostImproved 
    };
  };

  const processDetailedRecords = (studentPerformance, questions, answers) => {
    const studentRecords = studentPerformance.map((student) => {
      // Get all answers for this student
      const studentAnswers = answers.filter(a => a.user_id === student.id);
      
      // Analyze performance by topic
      const topicAnalysis = {};
      questions.forEach(q => {
        if (!q.topic) return;
        
        if (!topicAnalysis[q.topic]) {
          topicAnalysis[q.topic] = {
            topic: q.topic,
            attempted: 0,
            correct: 0
          };
        }
      });

      // Count answers by topic
      studentAnswers.forEach(ans => {
        const question = questions.find(q => q.id === ans.question_id);
        if (question && question.topic && topicAnalysis[question.topic]) {
          topicAnalysis[question.topic].attempted++;
          if (ans.is_correct) {
            topicAnalysis[question.topic].correct++;
          }
        }
      });

      // Calculate accuracy per topic
      const topicStats = Object.values(topicAnalysis)
        .filter(t => t.attempted > 0)
        .map(t => ({
          ...t,
          accuracy: (t.correct / t.attempted) * 100
        }))
        .sort((a, b) => b.accuracy - a.accuracy);

      // Get best and worst topics
      const bestTopic = topicStats.length > 0 ? topicStats[0].topic : 'N/A';
      const worstTopic = topicStats.length > 0 ? topicStats[topicStats.length - 1].topic : 'N/A';
      const needsImprovement = topicStats
        .filter(t => t.accuracy < 70)
        .map(t => t.topic)
        .slice(0, 2)
        .join(', ') || 'N/A';

      // Determine if this student has game-specific data
      const hasGameBreakdown = student.wisdomScore !== undefined && student.crosswordScore !== undefined;

      return {
        id: student.id,
        name: student.name || 'Unknown',
        email: student.email || 'No email',
        // For old model (aggregated)
        gamesPlayed: student.gamesPlayed || 0,
        totalScore: student.totalScore || 0,
        accuracy: student.accuracy ? student.accuracy.toFixed(2) : '0.00',
        // For new model (game-specific)
        hasGameBreakdown,
        wisdomScore: student.wisdomScore || 0,
        wisdomGames: student.wisdomGames || 0,
        wisdomAccuracy: student.wisdomAccuracy ? student.wisdomAccuracy.toFixed(2) : '0.00',
        crosswordScore: student.crosswordScore || 0,
        crosswordGames: student.crosswordGames || 0,
        crosswordAccuracy: student.crosswordAccuracy ? student.crosswordAccuracy.toFixed(2) : '0.00',
        combinedAccuracy: student.combinedAccuracy ? student.combinedAccuracy.toFixed(2) : '0.00',
        attempted: student.attempted || 0,
        correct: student.correct || 0,
        wrong: student.wrong || 0,
        bestTopic,
        worstTopic,
        needsImprovement
      };
    });

    const questionRecords = questions.map(q => {
      const questionAnswers = answers.filter(a => a.question_id === q.id);
      const correctCount = questionAnswers.filter(a => a.is_correct).length;
      
      return {
        id: q.id,
        text: q.text || 'Unknown',
        difficulty: q.difficulty || 'Medium',
        timesAnswered: questionAnswers.length,
        correctCount,
        successRate: questionAnswers.length > 0 
          ? Math.round((correctCount / questionAnswers.length) * 100)
          : 0
      };
    });

    return { students: studentRecords, questions: questionRecords };
  };

  const handleStudentClick = useCallback(async (student) => {
    setSelectedStudent(student);
    await fetchStudentAnswers(student.id);
    setStudentDetailModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setStudentDetailModal(false);
    setSelectedStudent(null);
    setStudentAnswers([]);
  }, []);

const openQuestionModal = useCallback(async (question) => {
    setSelectedQuestion(question);
    setLoadingQuestionAnswers(true);

    try {
      const response = await fetch(
        `${API_BASE}/teacher/analytics/question/${question.id}/answers`
      );
      const answers = await response.json();
      setQuestionAnswers(answers);
    } catch (err) {
      console.error('Error fetching question answers:', err);
      setQuestionAnswers([]);
    } finally {
      setLoadingQuestionAnswers(false);
    }

    setQuestionDetailModal(true);
  }, []);

  const closeQuestionModal = useCallback(() => {
    setQuestionDetailModal(false);
    setSelectedQuestion(null);
    setQuestionAnswers([]);
  }, []);

  const openPerformanceBracketModal = useCallback((bracket) => {
    setSelectedPerformanceBracket(bracket);
    
    // Filter students based on their accuracy in the selected bracket
    const students = performanceData.studentPerformance.filter(student => {
      const accuracy = parseFloat(student.accuracy) || 0;
      
      if (bracket.name === '80+%') {
        return accuracy >= 80;
      } else if (bracket.name === '50-75%') {
        return accuracy >= 50 && accuracy < 80;
      } else if (bracket.name === '30-50%') {
        return accuracy >= 30 && accuracy < 50;
      } else if (bracket.name === '<30%') {
        return accuracy < 30;
      }
      return false;
    });
    
    setBracketStudents(students);
    setPerformanceBracketModal(true);
  }, [performanceData.studentPerformance]);

  const closePerformanceBracketModal = useCallback(() => {
    setPerformanceBracketModal(false);
    setSelectedPerformanceBracket(null);
    setBracketStudents([]);
  }, []);

  const formatNumber = (num) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const getPieChartData = () => {
    const students = performanceData.studentPerformance;
    
    if (students.length === 0) {
      return [];
    }

    const ranges = [
      { name: '80+%', min: 80, max: 100, value: 0 },
      { name: '50-75%', min: 50, max: 75, value: 0 },
      { name: '30-50%', min: 30, max: 50, value: 0 },
      { name: '<30%', min: 0, max: 30, value: 0 }
    ];

    students.forEach(student => {
      const accuracy = parseFloat(student.accuracy) || 0;
      if (accuracy >= 80) {
        ranges[0].value++;
      } else if (accuracy >= 50 && accuracy < 80) {
        ranges[1].value++;
      } else if (accuracy >= 30 && accuracy < 50) {
        ranges[2].value++;
      } else if (accuracy < 30) {
        ranges[3].value++;
      }
    });

    return ranges.filter(range => range.value > 0);
  };

  const hasRadarData = () => {
    return performanceData.radarData.length > 0;
  };

  // ✅ HANDLE BACK BUTTON
  const handleBackClick = useCallback(() => {
    navigate('/teacher-game-management');
  }, [navigate]);

  // ⚡ Optimized event handlers for dropdowns
  const handleTimeRangeChange = useCallback((e) => {
    setTimeRange(e.target.value);
  }, []);

  const handleAutoRefreshToggle = useCallback((e) => {
    setAutoRefresh(e.target.checked);
  }, []);

  // ⚡ Refresh button - Show all time results
  const handleRefreshAllTime = useCallback(() => {
    setTimeRange('all');
    // fetchAllAnalytics will be called by useEffect when timeRange changes
  }, []);

  // ⚡ Optimized radar student selector handler
  const handleRadarStudentChange = useCallback((e) => {
    const studentId = e.target.value;
    setPerformanceData(prev => ({
      ...prev,
      selectedRadarStudent: studentId === 'all' ? null : studentId
    }));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400 mx-auto mb-4"></div>
          <p className="text-cyan-300 text-xl">Loading analytics from database...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-red-900/50 border-2 border-red-600 rounded-xl p-8 max-w-md text-center">
          <div className="text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-red-300 mb-4">Error Loading Data</h2>
          <p className="text-red-200 mb-6">{error}</p>
          <button
            onClick={fetchAllAnalytics}
            className="px-6 py-3 bg-red-600 hover:bg-red-500 rounded-lg text-white font-bold transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          {/* ✅ BACK BUTTON */}
          <button
            onClick={handleBackClick}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300 rounded-lg text-white font-bold transition-colors flex items-center gap-2 shadow-lg shadow-blue-500/50"
          >
            ← Back to TeacherPage
          </button>
          
          <div>
            <h1 className="text-5xl font-black bg-gradient-to-r from-lime-400 via-cyan-400 to-pink-400 bg-clip-text text-transparent mb-2 drop-shadow-lg">📊 Teacher Analytics</h1>
            <p className="text-lime-300 font-semibold">Comprehensive insights into student performance</p>
          </div>
        </div>

        <div className="flex gap-4 flex-wrap items-center">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="px-4 py-2 bg-slate-900 border-2 border-cyan-400 rounded-lg text-lime-300 font-bold focus:outline-none focus:border-pink-400 focus:ring-2 focus:ring-cyan-400/50"
          >
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>

          <button
            onClick={handleRefreshAllTime}
            className="px-4 py-2 bg-gradient-to-r from-lime-500 to-lime-400 hover:from-lime-600 hover:to-lime-500 rounded-lg text-slate-900 font-bold transition-colors shadow-lg shadow-lime-500/50"
            title="Refresh analytics data - Shows all time results"
          >
            🔄 Refresh
          </button>

          <button
            onClick={onLogout}
            className="px-6 py-2 bg-gradient-to-r from-pink-600 to-pink-400 hover:from-pink-500 hover:to-pink-300 rounded-lg text-white font-bold transition-colors shadow-lg shadow-pink-500/50"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border-3 border-cyan-500 rounded-xl p-6 shadow-lg shadow-cyan-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-cyan-300 text-lg font-black">TOTAL STUDENTS</div>
            <div className="text-3xl text-cyan-400">👥</div>
          </div>
          <div className="text-5xl font-black text-lime-400 mb-2">{formatNumber(overview.totalStudents)}</div>
          <div className={`text-sm font-bold ${overview.prevPeriodComparison.students >= 0 ? 'text-lime-400' : 'text-pink-400'}`}>
            {overview.prevPeriodComparison.students >= 0 ? '↑' : '↓'} {Math.abs(overview.prevPeriodComparison.students)}% vs last period
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border-3 border-pink-500 rounded-xl p-6 shadow-lg shadow-pink-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-pink-300 text-lg font-black">AVG ACCURACY</div>
            <div className="text-3xl text-pink-400">🎯</div>
          </div>
          <div className="text-5xl font-black text-yellow-400 mb-2">{overview.avgAccuracy.toFixed(2)}%</div>
          <div className={`text-sm font-bold ${overview.prevPeriodComparison.accuracy >= 0 ? 'text-lime-400' : 'text-pink-400'}`}>
            {overview.prevPeriodComparison.accuracy >= 0 ? '↑' : '↓'} {Math.abs(overview.prevPeriodComparison.accuracy)}% vs last period
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border-3 border-lime-500 rounded-xl p-6 shadow-lg shadow-lime-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-lime-300 text-lg font-black">QUESTIONS ANSWERED</div>
            <div className="text-3xl text-lime-400">📝</div>
          </div>
          <div className="text-5xl font-black text-cyan-400 mb-2">{formatNumber(overview.totalQuestionsAnswered)}</div>
          <div className={`text-sm font-bold ${overview.prevPeriodComparison.questions >= 0 ? 'text-lime-400' : 'text-pink-400'}`}>
            {overview.prevPeriodComparison.questions >= 0 ? '↑' : '↓'} {Math.abs(overview.prevPeriodComparison.questions)}% vs last period
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border-3 border-yellow-500 rounded-xl p-6 shadow-lg shadow-yellow-500/30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-yellow-300 text-lg font-black">GAMES PLAYED</div>
            <div className="text-3xl text-yellow-400">🎮</div>
          </div>
          <div className="text-5xl font-black text-pink-400 mb-2">{formatNumber(overview.totalGamesPlayed)}</div>
          <div className={`text-sm font-bold ${overview.prevPeriodComparison.games >= 0 ? 'text-lime-400' : 'text-pink-400'}`}>
            {overview.prevPeriodComparison.games >= 0 ? '↑' : '↓'} {Math.abs(overview.prevPeriodComparison.games)}% vs last period
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-1 gap-6 mb-8">

        {/* Questions Performance by Difficulty */}
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border-3 border-cyan-500 rounded-xl p-6 shadow-lg shadow-cyan-500/20">
          <h2 className="text-2xl font-black bg-gradient-to-r from-cyan-400 to-lime-400 bg-clip-text text-transparent mb-4">📊 Questions Performance by Difficulty</h2>
          {hasData.difficultyDistribution ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={performanceData.difficultyDistribution}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="difficulty" stroke="#FFFFFF" tick={{ fill: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }} />
                  <YAxis stroke="#FFFFFF" tick={{ fill: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #0891B2', borderRadius: '8px', color: '#FFFFFF' }}
                    labelStyle={{ color: '#FFFFFF', fontWeight: 'bold' }}
                    formatter={(value) => `${value.toFixed(2)}%`}
                  />
                  <Legend wrapperStyle={{ color: '#FFFFFF', fontWeight: 'bold' }} />
                  <Bar dataKey="Accuracy" fill="#82ca9d" name="Accuracy (%)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-400">
              No question data available
            </div>
          )}
        </div>
      </div>

      {/* Student Performance Distribution and Radar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">👥 Student Performance Distribution</h2>
          {hasData.studentPerformance && getPieChartData().length > 0 ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={getPieChartData()}
                    cx="50%"
                    cy="50%"
                    labelLine={true}
                    label={({ name, value, percent }) => `${name} ${value} (${(percent * 100).toFixed(1)}%)`}
                    outerRadius={80}
                    fill="#0088FE"
                    dataKey="value"
                    onClick={(data) => openPerformanceBracketModal(data.payload)}
                    labelFormatter={(value) => value}
                  >
                    {getPieChartData().map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={BRACKET_COLORS[entry.name] || COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #0891B2', borderRadius: '8px' }}
                    formatter={(value) => [`${value} students`, 'Count']}
                    labelFormatter={(label) => `Score Range: ${label}`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-400">
              No student performance data available
            </div>
          )}
        </div>

        {/* Skills Performance Radar */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 border-3 border-purple-500 rounded-xl p-6 shadow-lg shadow-purple-500/20">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-black bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">🎯 Skills Performance Radar</h2>
            {performanceData.students && performanceData.students.length > 0 && (
              <select
                value={performanceData.selectedRadarStudent || 'all'}
                onChange={(e) => {
                  const studentId = e.target.value;
                  setPerformanceData(prev => ({
                    ...prev,
                    selectedRadarStudent: studentId === 'all' ? null : studentId
                  }));
                }}
                className="px-4 py-2 bg-slate-800 text-lime-300 border-2 border-purple-400 rounded-lg text-sm font-bold focus:outline-none focus:border-pink-400"
              >
                <option value="all">All Students</option>
                {performanceData.students.map(student => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {hasRadarData() ? (
            <div className="h-80 bg-slate-950 rounded-lg p-4">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={performanceData.radarData}>
                  <PolarGrid stroke="#4B5563" strokeDasharray="3 3" />
                  <PolarAngleAxis dataKey="topic" tick={{ fill: '#FFFFFF', fontSize: 12, fontWeight: 'bold' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#FFFFFF', fontWeight: 'bold' }} />
                  {/* Blue filled area for accuracy */}
                  <Radar
                    name="Accuracy"
                    dataKey="accuracy"
                    stroke="#00D9FF"
                    fill="#00D9FF"
                    fillOpacity={0.6}
                  />
                  {/* Boundary line around the blue area showing attempts percentage */}
                  <Radar
                    name="Attempt %"
                    dataKey="attemptsPercentage"
                    stroke="#A78BFA"
                    strokeWidth={3}
                    fill="none"
                    fillOpacity={0}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0F172A',
                      border: '2px solid #A78BFA',
                      borderRadius: '8px',
                      color: '#FFFFFF',
                      fontWeight: 'bold'
                    }}
                    labelStyle={{ color: '#FFFFFF', fontWeight: 'bold' }}
                    formatter={(value, name) => [`${value.toFixed(1)}%`, name]}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 flex items-center justify-center text-gray-400 bg-slate-950 rounded-lg">
              <div className="text-center">
                <p className="mb-2 text-lime-300 font-bold">No radar data available</p>
                <p className="text-xs text-cyan-300">Make sure questions have topics assigned</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <div className="text-cyan-300 text-lg mb-2">🔥 HARDEST QUESTION</div>
          <div className="text-white font-bold mb-2 truncate" title={quickStats.hardestQuestion.text}>
            {quickStats.hardestQuestion.text.length > 40 
              ? quickStats.hardestQuestion.text.substring(0, 40) + '...' 
              : quickStats.hardestQuestion.text}
          </div>
          <div className="text-2xl font-bold text-red-400">{quickStats.hardestQuestion.successRate}% success</div>
        </div>

        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <div className="text-cyan-300 text-lg mb-2">✨ EASIEST QUESTION</div>
          <div className="text-white font-bold mb-2 truncate" title={quickStats.easiestQuestion.text}>
            {quickStats.easiestQuestion.text.length > 40 
              ? quickStats.easiestQuestion.text.substring(0, 40) + '...' 
              : quickStats.easiestQuestion.text}
          </div>
          <div className="text-2xl font-bold text-green-400">{quickStats.easiestQuestion.successRate}% success</div>
        </div>

        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <div className="text-cyan-300 text-lg mb-2">⭐ MOST ACTIVE STUDENT</div>
          <div className="text-white font-bold mb-2">{quickStats.mostActiveStudent.name}</div>
          <div className="text-2xl font-bold text-cyan-400">
            {quickStats.mostActiveStudent.gamesPlayed} games played
          </div>
        </div>

        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <div className="text-cyan-300 text-lg mb-2">📈 MOST IMPROVED</div>
          <div className="text-white font-bold mb-2">{quickStats.mostImproved.name}</div>
          <div className="text-2xl font-bold text-green-400">
            +{quickStats.mostImproved.pointsGained} points
          </div>
        </div>
      </div>

      {/* Student Records */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">📋 Student Records</h2>
          {hasData.students ? (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-white text-sm">
                <thead className="bg-cyan-700 sticky top-0">
                  <tr>
                    <th className="p-3 text-left text-white">Name</th>
                    <th className="p-3 text-center text-white">WW Score</th>
                    <th className="p-3 text-center text-white">WW Games</th>
                    <th className="p-3 text-center text-white">CW Score</th>
                    <th className="p-3 text-center text-white">CW Games</th>
                    <th className="p-3 text-right text-white">Total</th>
                    <th className="p-3 text-center text-white">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedRecords.students.map((student, index) => {
                    const hasGameData = student.hasGameBreakdown;
                    return (
                      <tr key={index} className="border-b border-gray-700 hover:bg-gray-700">
                        <td className="p-3 font-medium text-white">{student.name}</td>
                        {hasGameData ? (
                          <>
                            <td className="p-3 text-center text-cyan-300 font-bold">{student.wisdomScore}</td>
                            <td className="p-3 text-center text-gray-300">{student.wisdomGames}</td>
                            <td className="p-3 text-center text-cyan-300 font-bold">{student.crosswordScore}</td>
                            <td className="p-3 text-center text-gray-300">{student.crosswordGames}</td>
                            <td className="p-3 text-right text-yellow-300 font-bold">{student.totalScore}</td>
                          </>
                        ) : (
                          <>
                            <td className="p-3 text-center text-gray-400">-</td>
                            <td className="p-3 text-center text-gray-400">-</td>
                            <td className="p-3 text-center text-gray-400">-</td>
                            <td className="p-3 text-center text-gray-400">-</td>
                            <td className="p-3 text-right text-gray-400">-</td>
                          </>
                        )}
                        <td className="p-3 text-center">
                          <button
                            onClick={() => handleStudentClick(student)}
                            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-white text-sm font-medium transition-colors"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">
              <div className="text-4xl mb-2">👤</div>
              <p>No student records found</p>
            </div>
          )}
        </div>

        {/* Question Records */}
        <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">❓ Question Records</h2>
          {hasData.questions ? (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-white">
                <thead className="bg-cyan-700 sticky top-0">
                  <tr>
                    <th className="p-3 text-left text-white">Question</th>
                    <th className="p-3 text-left text-white">Difficulty</th>
                    <th className="p-3 text-right text-white">Attempts</th>
                    <th className="p-3 text-right text-white">Success</th>
                    <th className="p-3 text-center text-white">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {detailedRecords.questions.map((q, index) => (
                    <tr key={q.id} className="border-b border-gray-700 hover:bg-gray-700">
                      <td className="p-3 max-w-xs truncate text-white" title={q.text}>{q.text}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs font-bold text-white
                          ${q.difficulty === 'Easy' ? 'bg-green-600' : 
                            q.difficulty === 'Medium' ? 'bg-yellow-600' : 'bg-red-600'}`}>
                          {q.difficulty}
                        </span>
                      </td>
                      <td className="p-3 text-right text-white">{q.timesAnswered}</td>
                      <td className="p-3 text-right">
                        <span className={
                          q.successRate >= 70 ? 'text-green-400' : 
                          q.successRate >= 40 ? 'text-yellow-400' : 'text-red-400'
                        }>
                          {q.successRate}%
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => openQuestionModal(q)}
                          className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded font-semibold text-sm transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-8">
              <div className="text-4xl mb-2">❓</div>
              <p>No question records found</p>
            </div>
          )}
        </div>
      </div>

      {/* Student Detail Modal */}
      {studentDetailModal && selectedStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 max-w-4xl w-full relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={closeModal}
              className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold"
            >
              &times;
            </button>
            
            <h2 className="text-2xl font-bold text-cyan-300 mb-2">{selectedStudent.name}</h2>
            <p className="text-gray-300 mb-4">{selectedStudent.email}</p>
            
            {loadingAnswers ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
                <p className="text-cyan-300">Loading answers...</p>
              </div>
            ) : (
              <>
                {/* Student Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                    <div className="text-cyan-300 text-sm">Total Score</div>
                    <div className="text-2xl font-bold text-white">{selectedStudent.totalScore}</div>
                  </div>
                  <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                    <div className="text-cyan-300 text-sm">Accuracy</div>
                    <div className="text-2xl font-bold text-green-400">{selectedStudent.accuracy}%</div>
                  </div>
                  <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                    <div className="text-cyan-300 text-sm">Questions</div>
                    <div className="text-2xl font-bold text-white">{selectedStudent.attempted}</div>
                  </div>
                  <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                    <div className="text-cyan-300 text-sm">Games Played</div>
                    <div className="text-2xl font-bold text-white">{selectedStudent.gamesPlayed}</div>
                  </div>
                </div>

                {/* Correct/Wrong Breakdown */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div className="bg-gray-900 p-4 rounded-lg border border-green-600">
                    <div className="text-green-400 text-sm mb-2">✅ Correct Answers</div>
                    <div className="text-3xl font-bold text-green-400">{selectedStudent.correct || 0}</div>
                    <div className="text-gray-400 text-sm mt-1">
                      {selectedStudent.attempted > 0 
                        ? `${((selectedStudent.correct / selectedStudent.attempted) * 100).toFixed(1)}% success rate`
                        : 'No answers'}
                    </div>
                  </div>
                  <div className="bg-gray-900 p-4 rounded-lg border border-red-600">
                    <div className="text-red-400 text-sm mb-2">❌ Wrong Answers</div>
                    <div className="text-3xl font-bold text-red-400">{selectedStudent.wrong || 0}</div>
                    <div className="text-gray-400 text-sm mt-1">
                      {selectedStudent.attempted > 0 
                        ? `${((selectedStudent.wrong / selectedStudent.attempted) * 100).toFixed(1)}% error rate`
                        : 'No answers'}
                    </div>
                  </div>
                </div>

                {/* Topic Suggestions */}
                <h3 className="text-lg font-bold text-cyan-300 mb-3">🎯 Topic Analysis & Recommendations</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-gray-900 p-4 rounded-lg border-2 border-green-600">
                    <div className="text-green-400 text-sm font-bold mb-2">💪 Best Topic</div>
                    <div className="text-xl font-bold text-green-300">{selectedStudent.bestTopic}</div>
                    <p className="text-gray-400 text-xs mt-2">Student excels in this area</p>
                  </div>
                  <div className="bg-gray-900 p-4 rounded-lg border-2 border-red-600">
                    <div className="text-red-400 text-sm font-bold mb-2">⚠️ Weakest Topic</div>
                    <div className="text-xl font-bold text-red-300">{selectedStudent.worstTopic}</div>
                    <p className="text-gray-400 text-xs mt-2">Needs focused attention</p>
                  </div>
                  <div className="bg-gray-900 p-4 rounded-lg border-2 border-yellow-600">
                    <div className="text-yellow-400 text-sm font-bold mb-2">📈 Needs Improvement</div>
                    <div className="text-xl font-bold text-yellow-300">{selectedStudent.needsImprovement}</div>
                    <p className="text-gray-400 text-xs mt-2">Topics with &lt;70% accuracy</p>
                  </div>
                </div>

                {/* Difficulty Breakdown */}
                <h3 className="text-lg font-bold text-cyan-300 mb-3">Performance by Difficulty</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  {['easy', 'medium', 'hard'].map(diff => {
                    const diffAnswers = studentAnswers.filter(a => a.difficulty?.toLowerCase() === diff);
                    const correctCount = diffAnswers.filter(a => a.is_correct).length;
                    const totalCount = diffAnswers.length;
                    const successRate = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
                    
                    return (
                      <div key={diff} className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                        <div className={`text-sm font-bold mb-2 ${
                          diff === 'easy' ? 'text-green-400' : 
                          diff === 'medium' ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {diff.toUpperCase()}
                        </div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Correct:</span>
                          <span className="text-green-400 font-bold">{correctCount}</span>
                        </div>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-400">Wrong:</span>
                          <span className="text-red-400 font-bold">{totalCount - correctCount}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-400">Success:</span>
                          <span className={`font-bold ${
                            successRate >= 70 ? 'text-green-400' : 
                            successRate >= 40 ? 'text-yellow-400' : 'text-red-400'
                          }`}>{successRate}%</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Detailed Answers Table */}
                <h3 className="text-lg font-bold text-cyan-300 mb-3">📝 Detailed Answers</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-white">
                    <thead className="bg-cyan-700">
                      <tr>
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">Question</th>
                        <th className="p-2 text-left">Difficulty</th>
                        <th className="p-2 text-left">Selected</th>
                        <th className="p-2 text-left">Correct</th>
                        <th className="p-2 text-center">Result</th>
                        <th className="p-2 text-right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentAnswers.map((answer, idx) => (
                        <tr key={idx} className="border-b border-gray-700 hover:bg-gray-700">
                          <td className="p-2">{idx + 1}</td>
                          <td className="p-2 max-w-xs truncate" title={answer.question_text}>
                            {answer.question_text || 'Unknown'}
                          </td>
                          <td className="p-2">
                            <span className={`px-2 py-1 rounded text-xs font-bold
                              ${answer.difficulty === 'Easy' ? 'bg-green-600' : 
                                answer.difficulty === 'Medium' ? 'bg-yellow-600' : 'bg-red-600'}`}>
                              {answer.difficulty || 'Medium'}
                            </span>
                          </td>
                          <td className="p-2">{answer.selected_answer || 'N/A'}</td>
                          <td className="p-2">{answer.correct_answer || 'N/A'}</td>
                          <td className="p-2 text-center">
                            {answer.is_correct ? (
                              <span className="text-green-400 font-bold">✅</span>
                            ) : (
                              <span className="text-red-400 font-bold">❌</span>
                            )}
                          </td>
                          <td className="p-2 text-right font-bold">
                            <span className={answer.is_correct ? 'text-green-400' : 'text-red-400'}>
                              {answer.points_earned || 0}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {studentAnswers.length === 0 && (
                        <tr>
                          <td colSpan="7" className="p-4 text-center text-gray-400">
                            No answers found for this student
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            
            <div className="mt-6 text-center">
              <button
                onClick={closeModal}
                className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question Detail Modal */}
      {questionDetailModal && selectedQuestion && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 max-w-2xl w-full relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={closeQuestionModal}
              className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold"
            >
              &times;
            </button>
            
            <h2 className="text-2xl font-bold text-cyan-300 mb-4">📋 Question Details</h2>
            
            <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600 mb-6">
              <p className="text-white mb-4 text-lg">{selectedQuestion.text}</p>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 p-3 rounded border border-gray-700">
                  <div className="text-gray-400 text-sm">Difficulty</div>
                  <span className={`inline-block px-2 py-1 rounded text-xs font-bold text-white mt-1
                    ${selectedQuestion.difficulty === 'Easy' ? 'bg-green-600' : 
                      selectedQuestion.difficulty === 'Medium' ? 'bg-yellow-600' : 'bg-red-600'}`}>
                    {selectedQuestion.difficulty}
                  </span>
                </div>
                
                <div className="bg-gray-800 p-3 rounded border border-gray-700">
                  <div className="text-gray-400 text-sm">Success Rate</div>
                  <div className={`text-2xl font-bold mt-1 ${
                    selectedQuestion.successRate >= 70 ? 'text-green-400' : 
                    selectedQuestion.successRate >= 40 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {selectedQuestion.successRate}%
                  </div>
                </div>
                
                <div className="bg-gray-800 p-3 rounded border border-gray-700">
                  <div className="text-gray-400 text-sm">Total Attempts</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-1">{selectedQuestion.timesAnswered}</div>
                </div>
                
                <div className="bg-gray-800 p-3 rounded border border-gray-700">
                  <div className="text-gray-400 text-sm">Correct Answers</div>
                  <div className="text-2xl font-bold text-green-400 mt-1">
                    {Math.round((selectedQuestion.successRate / 100) * selectedQuestion.timesAnswered)}
                  </div>
                </div>
              </div>
            </div>

            {loadingQuestionAnswers ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
                <p className="text-cyan-300">Loading student data...</p>
              </div>
            ) : (
              <>
                {/* Separate tabs for correct and incorrect answers */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Correct Answers */}
                  <div>
                    <h3 className="text-lg font-bold text-green-400 mb-3">✅ Students Who Answered Correctly</h3>
                    
                    <div className="bg-gray-900 rounded-lg border border-green-600 overflow-hidden">
                      <table className="w-full text-white text-sm">
                        <thead className="bg-green-700">
                          <tr>
                            <th className="p-3 text-left">Student Name</th>
                            <th className="p-3 text-center">Answer</th>
                            <th className="p-3 text-right">Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {questionAnswers.filter(ans => ans.is_correct).length > 0 ? (
                            questionAnswers
                              .filter(ans => ans.is_correct)
                              .map((ans, index) => (
                                <tr key={index} className="border-b border-gray-700 hover:bg-gray-800">
                                  <td className="p-3">{ans.name}</td>
                                  <td className="p-3 text-center text-green-400 font-bold">{ans.selected_answer}</td>
                                  <td className="p-3 text-right text-green-400 font-bold">{ans.points_earned || 0}</td>
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td colSpan="3" className="p-4 text-center text-gray-400">
                                No students answered correctly
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Incorrect Answers */}
                  <div>
                    <h3 className="text-lg font-bold text-red-400 mb-3">❌ Students Who Answered Incorrectly</h3>
                    
                    <div className="bg-gray-900 rounded-lg border border-red-600 overflow-hidden">
                      <table className="w-full text-white text-sm">
                        <thead className="bg-red-700">
                          <tr>
                            <th className="p-3 text-left">Student Name</th>
                            <th className="p-3 text-center">Their Answer</th>
                            <th className="p-3 text-center">Correct Answer</th>
                          </tr>
                        </thead>
                        <tbody>
                          {questionAnswers.filter(ans => !ans.is_correct).length > 0 ? (
                            questionAnswers
                              .filter(ans => !ans.is_correct)
                              .map((ans, index) => (
                                <tr key={index} className="border-b border-gray-700 hover:bg-gray-800">
                                  <td className="p-3">{ans.name}</td>
                                  <td className="p-3 text-center text-red-400 font-bold">{ans.selected_answer}</td>
                                  <td className="p-3 text-center text-green-400 font-bold">{ans.correct_answer}</td>
                                </tr>
                              ))
                          ) : (
                            <tr>
                              <td colSpan="3" className="p-4 text-center text-gray-400">
                                No students answered incorrectly
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            )}
            
            <div className="mt-6 text-center">
              <button
                onClick={closeQuestionModal}
                className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Performance Bracket Modal */}
      {performanceBracketModal && selectedPerformanceBracket && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 max-w-2xl w-full relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={closePerformanceBracketModal}
              className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold"
            >
              &times;
            </button>
            
            <h2 className="text-2xl font-bold text-cyan-300 mb-6">
              📊 Students with {selectedPerformanceBracket.name} Accuracy
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                <div className="text-cyan-300 text-sm">Total Students</div>
                <div className="text-3xl font-bold text-white mt-2">{bracketStudents.length}</div>
              </div>
              
              <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                <div className="text-cyan-300 text-sm">Accuracy Range</div>
                <div className="text-xl font-bold text-cyan-400 mt-2">{selectedPerformanceBracket.name}</div>
              </div>
              
              <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                <div className="text-cyan-300 text-sm">Highest Score</div>
                <div className="text-2xl font-bold text-green-400 mt-2">
                  {bracketStudents.length > 0 
                    ? Math.max(...bracketStudents.map(s => parseFloat(s.accuracy) || 0)).toFixed(1) 
                    : 'N/A'}%
                </div>
              </div>
              
              <div className="bg-gray-900 p-4 rounded-lg border border-cyan-600">
                <div className="text-cyan-300 text-sm">Lowest Score</div>
                <div className="text-2xl font-bold text-red-400 mt-2">
                  {bracketStudents.length > 0 
                    ? Math.min(...bracketStudents.map(s => parseFloat(s.accuracy) || 0)).toFixed(1) 
                    : 'N/A'}%
                </div>
              </div>
            </div>

            <h3 className="text-lg font-bold text-cyan-300 mb-3">Student List</h3>
            
            <div className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
              <table className="w-full text-white text-sm">
                <thead className="bg-cyan-700">
                  <tr>
                    <th className="p-3 text-left">Student Name</th>
                    <th className="p-3 text-center">Email</th>
                    <th className="p-3 text-right">Accuracy</th>
                    <th className="p-3 text-right">Games Played</th>
                    <th className="p-3 text-right">Correct Answers</th>
                  </tr>
                </thead>
                <tbody>
                  {bracketStudents.length > 0 ? (
                    bracketStudents
                      .sort((a, b) => parseFloat(b.accuracy) - parseFloat(a.accuracy))
                      .map((student, index) => (
                        <tr key={index} className="border-b border-gray-700 hover:bg-gray-700">
                          <td className="p-3 font-bold">{student.name}</td>
                          <td className="p-3 text-center text-gray-400 text-xs">{student.email}</td>
                          <td className="p-3 text-right">
                            <span className={`font-bold ${
                              parseFloat(student.accuracy) >= 80 ? 'text-green-400' :
                              parseFloat(student.accuracy) >= 50 ? 'text-yellow-400' :
                              'text-red-400'
                            }`}>
                              {parseFloat(student.accuracy).toFixed(1)}%
                            </span>
                          </td>
                          <td className="p-3 text-right text-cyan-400">{student.gamesPlayed || 0}</td>
                          <td className="p-3 text-right text-green-400">{student.correct || 0}</td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="p-4 text-center text-gray-400">
                        No students in this performance bracket
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="mt-6 text-center">
              <button
                onClick={closePerformanceBracketModal}
                className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherAnalyticsDashboard;


