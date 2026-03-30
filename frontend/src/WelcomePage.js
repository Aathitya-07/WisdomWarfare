import React, { useState, useMemo } from "react";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "./firebaseConfig";

const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  (process.env.NODE_ENV === "production"
    ? "https://wisdomwarfare.onrender.com"
    : "http://localhost:4001")
).replace(/\/$/, "");
const API_TIMEOUT = 10000; // 10 seconds

// Reusable providers to avoid recreating on every render
const createGoogleProvider = () => {
  const provider = new GoogleAuthProvider();
  provider.addScope("profile");
  provider.addScope("email");
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
};

export default function WelcomePage({ onLogin }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const googleProvider = useMemo(() => createGoogleProvider(), []);

  // Optimized fetch with timeout
  const fetchWithTimeout = async (url, options) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

  const handleGoogleSignIn = async (role = "student") => {
    setErr("");
    setLoading(true);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const fbUser = result.user;
      if (!fbUser) throw new Error("Firebase did not return a user");

      const payload = {
        uid: fbUser.uid,
        email: fbUser.email || "",
        display_name: fbUser.displayName || fbUser.email || "User",
        role: role,
      };

      // Send to backend with timeout
      const res = await fetchWithTimeout(`${API_BASE}/auth/upsert-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        // ✅ Show detailed error message for unauthorized students
        if (data.unauthorized) {
          throw new Error(data.error);
        }
        throw new Error(data.error || "Failed to authenticate");
      }

      const userObj = {
        user_id: data.user_id,
        uid: fbUser.uid,
        email: fbUser.email,
        display_name: fbUser.displayName || fbUser.email,
      };

      if (typeof onLogin === "function") {
        onLogin(userObj, role);
      }

    } catch (error) {
      console.error("Google sign-in error:", error);
      
      // Provide user-friendly error messages
      let errorMsg = error.message || "Google login failed.";
      
      if (error.code === "auth/popup-blocked") {
        errorMsg = "Pop-up was blocked. Please allow pop-ups and try again.";
      } else if (error.code === "auth/cancelled-popup-request" || error.code === "auth/popup-closed-by-user") {
        errorMsg = "Login cancelled. Please try again.";
      } else if (error.name === "AbortError") {
        errorMsg = "Login took too long. Please check your internet and try again.";
      } else if (error.message.includes("Firebase")) {
        errorMsg = "Firebase connection error. Please check your internet and try again.";
      }
      
      setErr(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-md w-full p-8 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-cyan-400 mb-2">Wisdom Warfare</h1>
          <p className="text-gray-300">Interactive Gamified Learning Platform</p>
        </div>

        {err && (
          <div className="mb-6 p-4 bg-red-900 border border-red-700 rounded-lg text-red-100 text-sm max-h-40 overflow-y-auto">
            <p className="font-semibold mb-2">⚠️ Login Error</p>
            <p>{err}</p>
          </div>
        )}

        <div className="space-y-4">
          <button
            onClick={() => handleGoogleSignIn("student")}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-800 text-white py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-200"
          >
            {loading ? (
              "Signing in..."
            ) : (
              <>
                <img
                  src="https://developers.google.com/identity/images/g-logo.png"
                  alt="Google"
                  className="w-6 h-6"
                />
                Sign in as Student
              </>
            )}
          </button>

          <button
            onClick={() => handleGoogleSignIn("teacher")}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-800 text-white py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-200"
          >
            {loading ? (
              "Signing in..."
            ) : (
              <>
                <img
                  src="https://developers.google.com/identity/images/g-logo.png"
                  alt="Google"
                  className="w-6 h-6"
                />
                Sign in as Teacher
              </>
            )}
          </button>
        </div>

        <div className="mt-8 text-center text-gray-400 text-sm">
          <p>Choose your role to continue</p>
          <p className="mt-2">Students play games, Teachers manage content</p>
        </div>
      </div>
    </div>
  );
}