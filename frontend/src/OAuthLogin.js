// src/OAuthLogin.js
import React from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "./firebaseConfig";  // ✅ fix here

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

function OAuthLogin({ onLoginSuccess }) {
  const handleGoogleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Send user to backend
      const res = await fetch(`${API_BASE}/auth/upsert-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          display_name: user.displayName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert("❌ Failed to log in.");
        return;
      }

      // Save user_id
      localStorage.setItem("user_id", data.user_id);

      if (onLoginSuccess) onLoginSuccess(data);
    } catch (err) {
      console.error("Google login failed:", err);
      alert("❌ Google login failed.");
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-red-950 via-red-900 to-rose-950">
      <button
        onClick={handleGoogleLogin}
        className="bg-white text-gray-800 font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-gray-200 flex items-center space-x-2"
      >
        <img
          src="https://developers.google.com/identity/images/g-logo.png"
          alt="Google logo"
          className="w-6 h-6"
        />
        <span>Sign in with Google</span>
      </button>
    </div>
  );
}

export default OAuthLogin;
