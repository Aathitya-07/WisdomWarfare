
import React, { useState } from 'react';

function StudentLogin({ onLogin }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name && email && password) {
      onLogin(name, email, password);
    } else {
      alert('Please enter your name, email, and password to log in.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 flex flex-col items-center justify-center p-4 font-inter">
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
          body { font-family: 'Inter', sans-serif; }
          .drop-shadow-neon {
            filter: drop-shadow(0 0 10px rgba(52, 211, 153, 0.7));
          }
        `}
      </style>
      <div className="bg-gray-900 bg-opacity-80 backdrop-blur-md rounded-3xl p-8 max-w-md w-full shadow-3xl border-2 border-emerald-600">
        <h2 className="text-4xl font-extrabold text-teal-400 mb-8 text-center drop-shadow-neon">
          Student Login
        </h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label htmlFor="name" className="block text-emerald-200 text-lg font-semibold mb-2">
              Name
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-3 bg-gray-800 border-2 border-emerald-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-400 focus:outline-none transition-colors duration-200"
              placeholder="Enter your name"
              required
              autocomplete="off" 
            />
          </div>
          <div className="mb-6">
            <label htmlFor="email" className="block text-emerald-200 text-lg font-semibold mb-2">
              Email ID
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 bg-gray-800 border-2 border-emerald-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-400 focus:outline-none transition-colors duration-200"
              placeholder="Enter your email"
              required
              autocomplete="off" 
            />
          </div>
          <div className="mb-8">
            <label htmlFor="password" className="block text-emerald-200 text-lg font-semibold mb-2">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 bg-gray-800 border-2 border-emerald-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-teal-400 focus:outline-none transition-colors duration-200"
              placeholder="Enter your password"
              required
              autocomplete="new-password" 
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 rounded-xl font-extrabold text-lg transition-all duration-300 flex items-center justify-center
                       bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-500/40 hover:shadow-emerald-400/60"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}

export default StudentLogin;