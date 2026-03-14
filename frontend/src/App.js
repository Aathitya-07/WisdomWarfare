import React, { useState, useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom";
import WelcomePage from "./WelcomePage";
import GamePage from "./GamePage";
import TeacherGameManagementPage from "./TeacherGameManagementPage";
import TeacherAnalyticsDashboard from "./components/TeacherAnalyticsDashboard/TeacherAnalyticsDashboard";
import GameUI from "./components/GameUI/GameUI";
import CrosswordGame from "./components/GameUI/CrosswordGame";
import StudentDashboard from "./components/StudentDashboard/StudentDashboard";
import "./App.css";

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("App Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
          <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-cyan-600 rounded"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function HomeLanding({ user, role, onLogout }) {
  const navigate = useNavigate();

  const getDisplayName = (u) => {
    if (!u) return "User";
    return u.display_name || u.displayName || u.username || u.email || "User";
  };

  if (!user || !role) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
      <h1 className="text-3xl mb-2">Welcome, {getDisplayName(user)}!</h1>
      <p className="mb-6">{user?.email || ""}</p>
      <div className="flex gap-4">
        <button
          onClick={() => {
            if (role === "teacher") navigate("/teacher-game-management");
            else navigate("/gamepage");
          }}
          className={`px-6 py-3 rounded-lg ${
            role === "teacher"
              ? "bg-rose-600 hover:bg-rose-500"
              : "bg-cyan-600 hover:bg-cyan-500"
          }`}
        >
          Continue
        </button>
        <button
          onClick={() => {
            onLogout();
            navigate("/", { replace: true });
          }}
          className="px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600"
        >
          Logout
        </button>
      </div>
    </div>
  );
}

function GameUIRoute({ user, onLogout, onFinish }) {
  const { gameCode: codeParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [gameCode, setGameCode] = useState("");
  const [gameType, setGameType] = useState("");
  const [gameName, setGameName] = useState("");
  const [isValidating, setIsValidating] = useState(true);

  useEffect(() => {
    const validateAndSetGame = async () => {
      try {
        const code =
          codeParam ||
          location.state?.gameCode ||
          localStorage.getItem("GAME_CODE") ||
          "";

        const type =
          location.state?.gameType ||
          localStorage.getItem("GAME_TYPE") ||
          "QUIZ";

        const name =
          location.state?.gameName ||
          localStorage.getItem("GAME_NAME") ||
          "";

        if (!code || !type) {
          console.warn("Missing game code or type");
          navigate("/gamepage", { replace: true });
          return;
        }

        setGameCode(code);
        setGameType(type);
        setGameName(name);

        if (codeParam) {
          localStorage.setItem("GAME_CODE", code);
          localStorage.setItem("GAME_TYPE", type);
          if (name) localStorage.setItem("GAME_NAME", name);
        }
      } catch (error) {
        console.error("Error setting up game:", error);
        navigate("/gamepage", { replace: true });
      } finally {
        setIsValidating(false);
      }
    };

    validateAndSetGame();
  }, [codeParam, location.state, navigate]);

  if (isValidating) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-xl">Loading game...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!gameCode || !gameType) {
    return <Navigate to="/gamepage" replace />;
  }

  if (gameType === "A. Crossword") {
    return (
      <CrosswordGame
        user={user}
        onLogout={onLogout}
        gameCode={gameCode}
        gameName={gameName}
      />
    );
  }

  return (
    <GameUI
      user={user}
      onLogout={onLogout}
      onFinish={onFinish}
      gameCode={gameCode}
      gameType={gameType}
      gameName={gameName}
    />
  );
}

function AppRouterContainer() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restoreAuth = async () => {
      const userId = localStorage.getItem("user_id");
      const userEmail = localStorage.getItem("user_email");
      const userRole = localStorage.getItem("user_role");

      // If no stored credentials, proceed to login page
      if (!userId || !userEmail || !userRole) {
        setIsLoading(false);
        return;
      }

      try {
        // Verify session with backend
        const apiBase = process.env.REACT_APP_API_BASE || "http://localhost:4001";
        const verifyResponse = await fetch(
          `${apiBase}/auth/verify-session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user_id: userId,
              email: userEmail,
              role: userRole,
            }),
          }
        );

        const result = await verifyResponse.json();

        if (result.verified) {
          // Session is valid, restore it
          setUser({
            user_id: result.user_id,
            email: result.email,
            display_name: result.display_name,
          });
          setRole(result.role);
        } else {
          // Session is invalid, clear localStorage
          console.warn("Session verification failed:", result.error);
          localStorage.removeItem("user_id");
          localStorage.removeItem("user_email");
          localStorage.removeItem("user_role");
          localStorage.removeItem("GAME_CODE");
          localStorage.removeItem("GAME_TYPE");
          localStorage.removeItem("GAME_NAME");
        }
      } catch (error) {
        console.error("Error verifying session:", error);
        // Clear localStorage on error to ensure user sees login page
        localStorage.removeItem("user_id");
        localStorage.removeItem("user_email");
        localStorage.removeItem("user_role");
        localStorage.removeItem("GAME_CODE");
        localStorage.removeItem("GAME_TYPE");
        localStorage.removeItem("GAME_NAME");
      } finally {
        setIsLoading(false);
      }
    };

    restoreAuth();
  }, []);

  const handleLogout = () => {
    setUser(null);
    setRole(null);
    localStorage.removeItem("user_id");
    localStorage.removeItem("user_email");
    localStorage.removeItem("user_role");
    localStorage.removeItem("GAME_CODE");
    localStorage.removeItem("GAME_TYPE");
    localStorage.removeItem("GAME_NAME");
    navigate("/", { replace: true });
  };

  const handleLogin = (userObj, roleStr) => {
    setUser(userObj);
    setRole(roleStr);
    if (userObj.user_id) {
      localStorage.setItem("user_id", userObj.user_id);
      localStorage.setItem("user_email", userObj.email);
      localStorage.setItem("user_role", roleStr);
    }
    navigate("/home", { replace: true });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          !user || !role ? (
            <WelcomePage onLogin={handleLogin} />
          ) : (
            <Navigate to="/home" replace />
          )
        }
      />

      <Route
        path="/home"
        element={
          <HomeLanding user={user} role={role} onLogout={handleLogout} />
        }
      />

      <Route
        path="/gamepage"
        element={<GamePage user={user} onLogout={handleLogout} />}
      />

      <Route
        path="/play"
        element={
          <GameUIRoute
            user={user}
            onLogout={handleLogout}
            onFinish={() => navigate("/gamepage", { replace: true })}
          />
        }
      />

      <Route
        path="/play/:gameCode"
        element={
          <GameUIRoute
            user={user}
            onLogout={handleLogout}
            onFinish={() => navigate("/gamepage", { replace: true })}
          />
        }
      />

      <Route path="/dashboard" element={<StudentDashboard />} />

      <Route
        path="/teacher-game-management"
        element={<TeacherGameManagementPage />}
      />

      <Route
        path="/teacher-analytics"
        element={<TeacherAnalyticsDashboard teacherId={user?.user_id} onLogout={handleLogout} />}
      />

      <Route
        path="*"
        element={
          <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
            <h1 className="text-4xl font-bold mb-4">404 - Page Not Found</h1>
            <a href="/" className="text-cyan-400 underline">
              Go back to Welcome
            </a>
          </div>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AppRouterContainer />
      </Router>
    </ErrorBoundary>
  );
}

export default App;