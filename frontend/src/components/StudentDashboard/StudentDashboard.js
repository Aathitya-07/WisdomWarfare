import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4001";

// Helper function to format accuracy
const formatAccuracy = (accuracy) => {
  if (accuracy === null || accuracy === undefined) return '0.0';
  return typeof accuracy === 'number' ? accuracy.toFixed(1) : parseFloat(accuracy || 0).toFixed(1);
};

const StudentDashboard = () => {
  const navigate = useNavigate();
  const [userStats, setUserStats] = useState(null);
  const [gameSummary, setGameSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [leaderboard, setLeaderboard] = useState([]);
  const [gameSessions, setGameSessions] = useState([]);
  const [wisdomLeaderboard, setWisdomLeaderboard] = useState([]);
  const [crosswordLeaderboard, setCrosswordLeaderboard] = useState([]);
  const [gamePerformance, setGamePerformance] = useState({
    wisdomWarfare: { score: 0, attempts: 0, correct_answers: 0, accuracy: 0 },
    crossword: { score: 0, attempts: 0, correct_answers: 0, accuracy: 0 }
  });
  const [activeLeaderboardTab, setActiveLeaderboardTab] = useState('wisdom');

  const userId = localStorage.getItem('user_id');
  const userEmail = localStorage.getItem('user_email');

  useEffect(() => {
    if (userId) {
      fetchUserStats();
      fetchLeaderboard();
      fetchGameLeaderboards();
      fetchGamePerformance();
    } else {
      setLoading(false);
    }
  }, [userId]);

  const fetchGamePerformance = async () => {
    try {
      const response = await fetch(`${API_BASE}/student/${userId}/game-performance`);
      if (response.ok) {
        const data = await response.json();
        setGamePerformance(data);
      }
    } catch (error) {
      console.error('Error fetching game performance:', error);
    }
  };

  const fetchGameLeaderboards = async () => {
    try {
      const [wisdomRes, crosswordRes] = await Promise.all([
        fetch(`${API_BASE}/leaderboard/wisdom-warfare?limit=10`),
        fetch(`${API_BASE}/leaderboard/crossword?limit=10`)
      ]);

      if (wisdomRes.ok) {
        const data = await wisdomRes.json();
        setWisdomLeaderboard(data || []);
      }
      if (crosswordRes.ok) {
        const data = await crosswordRes.json();
        setCrosswordLeaderboard(data || []);
      }
    } catch (error) {
      console.error('Error fetching game leaderboards:', error);
    }
  };

  const fetchUserStats = async () => {
    if (!userId) return;
    
    try {
      const response = await fetch(`${API_BASE}/user/${userId}/stats`);
      if (response.ok) {
        const stats = await response.json();
        setUserStats(stats);
        setGameSessions(stats.game_sessions || []);
        
        // Extract game summary from stats
        if (stats.game_stats) {
          setGameSummary({
            summary: {
              total_score: stats.performance?.score || 0,
              questions_answered: stats.performance?.attempts || 0,
              correct_answers: stats.performance?.correct_answers || 0,
              accuracy: stats.performance?.accuracy || 0,
              total_possible: 450,
              by_difficulty: stats.game_stats.by_difficulty || {}
            }
          });
        }
      }
    } catch (error) {
      console.error('Error fetching user stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const response = await fetch(`${API_BASE}/leaderboard/global?limit=100`);
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data);
      }
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading dashboard...</div>
      </div>
    );
  }

  const performance = userStats?.performance || {};
  const gameStats = userStats?.game_stats || {};
  const userRank = leaderboard.findIndex(player => player.user_id == userId) + 1;

  const difficultyData = gameSummary?.summary?.by_difficulty || {};

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-purple-400 mb-4">Student Dashboard</h1>
          <p className="text-xl text-purple-200">Track your learning progress</p>
        </div>

        {userStats ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* User Info Card */}
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-purple-600">
              <h2 className="text-2xl font-bold text-purple-300 mb-4">👤 Student Profile</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-sm">Name</label>
                  <p className="text-white font-semibold">{userStats.user?.display_name || 'Anonymous'}</p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm">Email</label>
                  <p className="text-white font-semibold">{userStats.user?.email || userEmail}</p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm">Member Since</label>
                  <p className="text-white font-semibold">
                    {userStats.user?.created_at ? new Date(userStats.user.created_at).toLocaleDateString() : 'Recent'}
                  </p>
                </div>
                <div>
                  <label className="text-gray-400 text-sm">Global Rank</label>
                  <p className="text-white font-semibold">
                    {userRank > 0 ? `#${userRank}` : 'Not ranked yet'}
                  </p>
                </div>
              </div>
            </div>

            {/* Game Progress */}
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4">🎮 Game Progress</h2>
              <div className="text-center mb-4">
                <div className="text-cyan-200 mb-2">Total Score</div>
                <div className="text-4xl font-bold text-cyan-400 mb-3">
                  {performance.score || 0}
                </div>
                <div className="text-cyan-200 mb-1">Accuracy</div>
                <div className="text-lg text-green-400">
                  {gameStats.current_percentage || 0}%
                </div>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-4">
                <div 
                  className="bg-cyan-600 h-4 rounded-full transition-all duration-500"
                  style={{ width: `${gameStats.current_percentage || 0}%` }}
                ></div>
              </div>
            </div>

            {/* Rank Card */}
            <div className="bg-gray-800 rounded-2xl p-6 border-2 border-yellow-600">
              <h2 className="text-2xl font-bold text-yellow-300 mb-4">🏆 Your Rank</h2>
              <div className="text-center py-4">
                <div className="text-6xl font-bold text-yellow-400 mb-4">
                  #{userRank > 0 ? userRank : '--'}
                </div>
              </div>
            </div>

            {/* Game Sessions History */}
            {gameSessions.length > 0 && (
              <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-blue-600">
                <h2 className="text-2xl font-bold text-blue-300 mb-4">📈 Game Session History</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-white">
                    <thead>
                      <tr className="bg-blue-700">
                        <th className="p-3 text-left">Session ID</th>
                        <th className="p-3 text-right">Questions</th>
                        <th className="p-3 text-right">Correct</th>
                        <th className="p-3 text-right">Score</th>
                        <th className="p-3 text-right">Accuracy</th>
                        <th className="p-3 text-right">Last Played</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameSessions.map((session, index) => (
                        <tr key={session.game_session_id} className="border-b border-gray-700 hover:bg-gray-700">
                          <td className="p-3 text-blue-300 font-mono text-sm">
                            {session.game_session_id?.substring(0, 8)}...
                          </td>
                          <td className="p-3 text-right">{session.questions_answered || 0}</td>
                          <td className="p-3 text-right text-green-400">{session.correct_answers || 0}</td>
                          <td className="p-3 text-right font-bold text-cyan-300">{session.session_score || 0}</td>
                          <td className="p-3 text-right">
                            {session.questions_answered > 0 
                              ? `${formatAccuracy((session.correct_answers / session.questions_answered) * 100)}%`
                              : '0%'
                            }
                          </td>
                          <td className="p-3 text-right text-gray-400 text-sm">
                            {session.last_answered ? new Date(session.last_answered).toLocaleDateString() : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Score Breakdown */}
            <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-green-600">
              <h2 className="text-2xl font-bold text-green-300 mb-4">📊 Score Breakdown by Difficulty</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="text-center p-4 bg-blue-900 rounded-lg">
                  <div className="text-2xl font-bold text-blue-300">{difficultyData.easy?.score || 0}</div>
                  <div className="text-blue-200">Easy Questions</div>
                  <div className="text-sm text-blue-300 mt-2">
                    {difficultyData.easy?.correct || 0} correct of {difficultyData.easy?.total || 0} answered
                  </div>
                  <div className="text-xs text-blue-200 mt-1">
                    {difficultyData.easy?.total ? 
                      formatAccuracy((difficultyData.easy.correct / difficultyData.easy.total) * 100) : 0
                    }% accuracy
                  </div>
                </div>
                <div className="text-center p-4 bg-yellow-900 rounded-lg">
                  <div className="text-2xl font-bold text-yellow-300">{difficultyData.medium?.score || 0}</div>
                  <div className="text-yellow-200">Medium Questions</div>
                  <div className="text-sm text-yellow-300 mt-2">
                    {difficultyData.medium?.correct || 0} correct of {difficultyData.medium?.total || 0} answered
                  </div>
                  <div className="text-xs text-yellow-200 mt-1">
                    {difficultyData.medium?.total ? 
                      formatAccuracy((difficultyData.medium.correct / difficultyData.medium.total) * 100) : 0
                    }% accuracy
                  </div>
                </div>
                <div className="text-center p-4 bg-red-900 rounded-lg">
                  <div className="text-2xl font-bold text-red-300">{difficultyData.hard?.score || 0}</div>
                  <div className="text-red-200">Hard Questions</div>
                  <div className="text-sm text-red-300 mt-2">
                    {difficultyData.hard?.correct || 0} correct of {difficultyData.hard?.total || 0} answered
                  </div>
                  <div className="text-xs text-red-200 mt-1">
                    {difficultyData.hard?.total ? 
                      formatAccuracy((difficultyData.hard.correct / difficultyData.hard.total) * 100) : 0
                    }% accuracy
                  </div>
                </div>
              </div>
              <div className="mt-4 text-center">
                <div className="text-lg text-gray-300">
                  Total Score: <span className="font-bold text-green-400">{gameSummary?.summary?.total_score || 0}</span> / {gameSummary?.summary?.total_possible || 450}
                </div>
                <div className="text-sm text-gray-400">
                  {gameSummary?.summary?.correct_answers || 0} correct out of {gameSummary?.summary?.questions_answered || 0} answered
                </div>
              </div>
            </div>

            {/* Your Game Performance */}
            <div className="lg:col-span-3 bg-gradient-to-r from-cyan-900 to-gray-800 rounded-2xl p-6 border-2 border-cyan-500 mb-6">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4">🎮 Your Game Performance</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Wisdom Warfare Card */}
                <div className="bg-gray-700 rounded-lg p-4 border-l-4 border-blue-500">
                  <div className="text-blue-300 font-bold text-lg mb-2">🧠 Wisdom Warfare</div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Score:</span>
                      <span className="font-bold text-cyan-300 text-lg">{gamePerformance?.wisdomWarfare?.score || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Games Played:</span>
                      <span className="font-bold text-cyan-300">{gamePerformance?.wisdomWarfare?.attempts || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Accuracy:</span>
                      <span className="font-bold text-green-400">{formatAccuracy(gamePerformance?.wisdomWarfare?.accuracy)}%</span>
                    </div>
                  </div>
                </div>

                {/* Crossword Card */}
                <div className="bg-gray-700 rounded-lg p-4 border-l-4 border-purple-500">
                  <div className="text-purple-300 font-bold text-lg mb-2">📝 A. Crossword</div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Score:</span>
                      <span className="font-bold text-cyan-300 text-lg">{gamePerformance?.crossword?.score || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Games Played:</span>
                      <span className="font-bold text-cyan-300">{gamePerformance?.crossword?.attempts || 0}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Accuracy:</span>
                      <span className="font-bold text-green-400">{formatAccuracy(gamePerformance?.crossword?.accuracy)}%</span>
                    </div>
                  </div>
                </div>

                {/* Combined Total Card */}
                <div className="bg-gray-700 rounded-lg p-4 border-l-4 border-yellow-500">
                  <div className="text-yellow-300 font-bold text-lg mb-2">🌍 Combined Total</div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Total Score:</span>
                      <span className="font-bold text-yellow-300 text-lg">
                        {Number(gamePerformance?.wisdomWarfare?.score || 0) + Number(gamePerformance?.crossword?.score || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Total Games:</span>
                      <span className="font-bold text-cyan-300">
                        {(gamePerformance?.wisdomWarfare?.attempts || 0) + (gamePerformance?.crossword?.attempts || 0)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300">Avg Accuracy:</span>
                      <span className="font-bold text-green-400">
                        {(() => {
                          const wisdomAttempts = gamePerformance?.wisdomWarfare?.attempts || 0;
                          const crosswordAttempts = gamePerformance?.crossword?.attempts || 0;
                          const totalAttempts = wisdomAttempts + crosswordAttempts;
                          
                          if (totalAttempts === 0) {
                            return 0;
                          }
                          
                          const wisdomAccuracy = gamePerformance?.wisdomWarfare?.accuracy || 0;
                          const crosswordAccuracy = gamePerformance?.crossword?.accuracy || 0;
                          
                          // Weighted average accuracy
                          const combinedAccuracy = (wisdomAccuracy * wisdomAttempts + crosswordAccuracy * crosswordAttempts) / totalAttempts;
                          
                          return formatAccuracy(combinedAccuracy);
                        })()}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Game Leaderboards */}
            <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-cyan-600">
              <h2 className="text-2xl font-bold text-cyan-300 mb-4">🏆 Game Leaderboards</h2>
              
              {/* Tab Navigation */}
              <div className="flex gap-4 mb-6 border-b border-cyan-600 flex-wrap">
                <button
                  onClick={() => setActiveLeaderboardTab('wisdom')}
                  className={`px-6 py-2 font-bold transition-colors ${
                    activeLeaderboardTab === 'wisdom'
                      ? 'text-cyan-300 border-b-2 border-cyan-300'
                      : 'text-gray-400 hover:text-cyan-300'
                  }`}
                >
                  🧠 Wisdom Warfare
                </button>
                <button
                  onClick={() => setActiveLeaderboardTab('crossword')}
                  className={`px-6 py-2 font-bold transition-colors ${
                    activeLeaderboardTab === 'crossword'
                      ? 'text-cyan-300 border-b-2 border-cyan-300'
                      : 'text-gray-400 hover:text-cyan-300'
                  }`}
                >
                  📝 A. Crossword
                </button>
              </div>

              {/* Leaderboard Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-white text-sm">
                  <thead>
                    <tr className="bg-cyan-700">
                      <th className="p-3 text-left">Rank</th>
                      <th className="p-3 text-left">Student</th>
                      <th className="p-3 text-right">Score</th>
                      <th className="p-3 text-right">Games Played</th>
                      <th className="p-3 text-right">Correct</th>
                      <th className="p-3 text-right">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const leaderboardData = activeLeaderboardTab === 'wisdom' ? wisdomLeaderboard : 
                                             crosswordLeaderboard;
                      
                      return leaderboardData.map((player, index) => {
                        const isCurrentUser = player.user_id == userId;
                        return (
                          <tr 
                            key={player.user_id} 
                            className={`border-b border-gray-700 ${isCurrentUser ? 'bg-cyan-900 font-bold' : 'hover:bg-gray-700'}`}
                          >
                            <td className="p-3 text-cyan-300 font-bold">
                              {index + 1}
                              {index === 0 && ' 🥇'}
                              {index === 1 && ' 🥈'}
                              {index === 2 && ' 🥉'}
                            </td>
                            <td className="p-3">
                              {player.display_name || 'Anonymous'}
                              {isCurrentUser && ' (You)'}
                            </td>
                            <td className="p-3 text-right font-bold text-cyan-300">{player.score || 0}</td>
                            <td className="p-3 text-right">{player.attempts || 0}</td>
                            <td className="p-3 text-right text-green-400">{player.correct_answers || 0}</td>
                            <td className="p-3 text-right text-green-400 font-bold">
                              {formatAccuracy(player.accuracy)}%
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
                {!(() => {
                  const leaderboardData = activeLeaderboardTab === 'wisdom' ? wisdomLeaderboard : 
                                         crosswordLeaderboard;
                  return leaderboardData.length > 0;
                })() && (
                  <div className="text-center text-gray-400 py-8">
                    <div className="text-4xl mb-2">📊</div>
                    <p>No players yet on this leaderboard</p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="lg:col-span-3 bg-gray-800 rounded-2xl p-6 border-2 border-blue-600">
              <h2 className="text-2xl font-bold text-blue-300 mb-4">⚡ Quick Actions</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => navigate('/gamepage')}
                  className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold transition-colors"
                >
                  🔄 Back to Main Menu
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-bold transition-colors"
                >
                  📈 Refresh Stats
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-white bg-gray-800 rounded-2xl p-12">
            <div className="text-6xl mb-4">🎮</div>
            <h2 className="text-2xl font-bold mb-4">Ready to Start Learning?</h2>
            <p className="text-gray-300 mb-6">Play some games to see your statistics and progress!</p>
            <button
              onClick={() => window.location.href = '/gamepage'}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-3 rounded-lg font-bold text-lg"
            >
              Start Playing Now
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentDashboard;