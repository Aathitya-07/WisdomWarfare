# Teacher Analytics Dashboard - Integration Guide

## Overview
The TeacherAnalyticsDashboard component has been successfully integrated with the backend to provide real-time analytics and performance metrics for teachers to monitor student progress.

## Integration Components

### 1. Backend API Endpoints

New analytics endpoints have been added to `backend/server.js`:

#### GET `/teacher/:teacher_id/analytics`
- **Purpose**: Fetch overall analytics overview
- **Returns**:
  - `overview`: Contains totalStudents, totalAnswers, avgAccuracy, totalGames, trends
  - `dailyActivity`: Last 7 days of student answers and correct responses
  - `difficultyBreakdown`: Breakdown of correct/wrong answers by difficulty level

#### GET `/teacher/:teacher_id/analytics/students`
- **Purpose**: Get detailed student performance metrics
- **Returns**: Array of student objects with:
  - `id`, `name`, `email`
  - `totalScore`: Student's total score
  - `attempted`, `correct`, `wrong`: Question attempt metrics
  - `accuracy`: Accuracy percentage
  - `avgTime`: Average answer time in seconds
  - `gamesPlayed`: Number of games participated in

#### GET `/teacher/:teacher_id/analytics/questions`
- **Purpose**: Get question-level analytics
- **Returns**: Array of question objects with:
  - `id`, `text`, `difficulty`
  - `totalAttempts`: How many times attempted
  - `correctCount`, `wrongCount`: Correct/wrong answer counts
  - `successRate`: Success percentage
  - `avgTime`: Average time to answer

#### GET `/teacher/:teacher_id/analytics/improvements`
- **Purpose**: Get student improvement trends
- **Returns**: Array of students ranked by improvement metrics
  - `name`, `email`, `improvement`: Improvement score
  - `sessions`: Number of game sessions

### 2. Frontend Components

#### TeacherAnalyticsDashboard.jsx
**Location**: `frontend/src/components/TeacherAnalyticsDashboard/TeacherAnalyticsDashboard.jsx`

**Key Changes**:
- Replaced mock data with API calls
- Updated `useEffect` hook to fetch real analytics data
- Supports `teacherId` prop to fetch specific teacher's analytics
- Graceful fallback to empty data if API fails

**Data Structure**:
```javascript
{
  overview: { /* overview metrics */ },
  studentPerformance: [ /* student data */ ],
  questionAnalytics: [ /* question data */ ],
  dailyActivity: [ /* daily trends */ ],
  difficultyBreakdown: [ /* difficulty stats */ ],
  improvementTrends: [ /* improvement data */ ]
}
```

### 3. Routing

A new route has been added to `frontend/src/App.js`:

```javascript
<Route
  path="/teacher-analytics"
  element={<TeacherAnalyticsDashboard teacherId={user?.user_id} onLogout={handleLogout} />}
/>
```

**Access**: Teachers can navigate to `/teacher-analytics` to view their analytics dashboard.

## Data Flow

```
TeacherAnalyticsDashboard Component
    ↓
useEffect Hook (on mount/update)
    ↓
API Calls to Backend
    ├─ /teacher/:teacher_id/analytics
    ├─ /teacher/:teacher_id/analytics/students
    ├─ /teacher/:teacher_id/analytics/questions
    └─ /teacher/:teacher_id/analytics/improvements
    ↓
State Update (analyticsData)
    ↓
Render Charts & UI with Real Data
```

## Key Features

### Overview Cards
- Total Students count
- Total Questions Answered
- Average Accuracy percentage
- Total Games Played
- Trend indicators (up/down)

### Performance Charts
1. **Student Performance Chart** - Composed chart showing scores, games played, and accuracy
2. **Question Success Rates** - Pie chart showing success percentage by question
3. **Difficulty Performance** - Horizontal bar chart of correct/wrong by difficulty
4. **Daily Activity** - Area chart showing daily answer patterns
5. **Performance Radar** - Multi-dimensional performance comparison
6. **Student Leaderboard** - Rankings with detailed metrics

### Analytics Tables
- **Student Performance Table**: Searchable, sortable table of all students
- **Question Analytics Table**: Detailed question-level statistics
- **Quick Stats**: Hardest, easiest, most active, and most improved students

### Export Functionality
- Download analytics as Excel file
- CSV export support for leaderboards

## Testing

### 1. Verify Backend Endpoints
```bash
# Test overview analytics
curl http://localhost:4001/teacher/1/analytics

# Test student analytics
curl http://localhost:4001/teacher/1/analytics/students

# Test question analytics
curl http://localhost:4001/teacher/1/analytics/questions

# Test improvement trends
curl http://localhost:4001/teacher/1/analytics/improvements
```

### 2. Check Frontend Integration
1. Navigate to `/teacher-analytics` route
2. Verify data loads without errors
3. Check browser console for API call logs
4. Validate charts render with data
5. Test export functionality

### 3. Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Cannot find module TeacherAnalyticsDashboard | Run `npm install` in frontend directory |
| API returns 404 | Ensure teacher_id is valid in database |
| Charts not displaying | Check browser console for data format issues |
| CORS errors | Verify CORS settings in backend/server.js |

## Database Requirements

Ensure these tables exist with proper relationships:
- `users` (role='student')
- `performance` (user_id, score, attempts, correct_answers, accuracy)
- `answers` (user_id, question_id, is_correct, points_earned, game_session_id)
- `questions` (id, text, difficulty)

## Performance Considerations

- API calls are fetched on component mount and when filters change
- Consider adding pagination for large datasets (100+ students)
- Consider caching API responses to reduce database load
- Add rate limiting if accessed by multiple teachers simultaneously

## Future Enhancements

1. Real-time updates using WebSockets
2. Customizable date range filters
3. Class/group-based analytics
4. Predictive analytics using ML
5. PDF report generation
6. Email digest reports
7. Performance alerts/notifications
8. Student-specific detailed reports

## Environment Variables

Ensure the following are configured:
- `REACT_APP_API_BASE`: Backend API URL (defaults to `http://localhost:4001`)
- `PORT`: Frontend port (defaults to 3000)

## Support

For issues or questions:
1. Check browser console for errors
2. Verify API response in Network tab
3. Check backend logs for database errors
4. Ensure database has test data
