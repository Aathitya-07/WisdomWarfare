// TeacherGameManagementPage.js
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { formatAccuracy, formatScore, mergeGameLeaderboards } from "./utils/helpers";
import {
  AddOrEditCrosswordModal,
  UploadCrosswordQsModal,
  ViewCrosswordQuestionsModal,
  fetchCrosswordQuestions as fetchCrosswordQuestionsAPI,
  deleteCrosswordQuestion as deleteCrosswordQuestionAPI,
  fetchCrosswordRanks as fetchCrosswordRanksAPI,
  downloadCrosswordResults as downloadCrosswordResultsAPI,
  startCrosswordGame as startCrosswordGameAPI
} from "./crosswordteacher";


const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4001";
const CROSSWORD_API_BASE = process.env.REACT_APP_CROSSWORD_API_BASE || "http://localhost:4002";

/* ----------------------------------------------------
   SHARED MODALS & UI COMPONENTS
   ---------------------------------------------------- */

function TopPlayersModal({ players, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border-2 border-red-600 rounded-xl p-6 max-w-4xl w-full relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-rose-300 hover:text-rose-100 text-3xl font-bold"
        >
          &times;
        </button>
        <h2 className="text-3xl font-extrabold text-rose-300 mb-4 text-center">
          🏆 Global Leaderboard
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-white min-w-full">
            <thead>
              <tr className="bg-rose-700">
                <th className="p-3 text-left">Rank</th>
                <th className="p-3 text-left">Student</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-right">Score</th>
                <th className="p-3 text-right">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player, index) => (
                <tr
                  key={player.user_id || player.email || index}
                  className="border-b border-gray-700 hover:bg-gray-700"
                >
                  <td className="p-3 font-bold text-rose-300">
                    {index + 1}
                    {index === 0 && " 🥇"}
                    {index === 1 && " 🥈"}
                    {index === 2 && " 🥉"}
                  </td>
                  <td className="p-3 font-medium">
                    {player.display_name || "Anonymous"}
                  </td>
                  <td className="p-3 text-gray-300">{player.email}</td>
                  <td className="p-3 text-right font-bold text-rose-300">
                    {formatScore(player.total_score ?? player.score ?? 0)}
                  </td>
                  <td className="p-3 text-right text-green-400 font-bold">
                    {formatAccuracy(player.accuracy || 0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {players.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              <div className="text-6xl mb-4">📊</div>
              <p className="text-xl">No players yet</p>
              <p className="text-sm mt-2">
                Students need to play games to appear on leaderboard
              </p>
            </div>
          )}
        </div>
        <div className="mt-6 text-center">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-rose-600 hover:bg-rose-500 rounded-lg text-white font-bold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadStudentsSection() {
  const [studentFile, setStudentFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleUploadStudents = async () => {
    if (!studentFile) {
      alert("Please choose a CSV file first!");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", studentFile);

    try {
      const res = await axios.post(`${API_BASE}/students/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const inserted = res.data.inserted ?? res.data.created ?? 0;
      const errorsCount = res.data.errors?.length || 0;
      const msg = res.data.message || "Student upload completed";

      alert(`✅ ${msg}\nInserted: ${inserted}, Errors: ${errorsCount}`);
      setStudentFile(null);
    } catch (err) {
      console.error("Upload error:", err);
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err.message;
      alert("❌ Failed to upload student details: " + msg);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg text-white w-full max-w-2xl mx-auto border-2 border-cyan-600">
      <h3 className="text-xl font-semibold mb-4 text-center text-cyan-300">
        👩‍🎓 Upload Students via CSV
      </h3>
      <div className="flex flex-col items-center space-y-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setStudentFile(e.target.files[0])}
          className="text-gray-300 bg-gray-900 border border-cyan-600 rounded px-3 py-2 w-full"
        />
        <button
          onClick={handleUploadStudents}
          disabled={uploading || !studentFile}
          className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-cyan-800 text-white font-semibold px-5 py-2 rounded-lg shadow-md transition-all duration-200"
        >
          {uploading ? "📤 Uploading..." : "📂 Upload Students"}
        </button>
        <p className="text-sm text-gray-400 text-center">
          CSV should have columns: email, display_name, role
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------
   WISDOM WARFARE (MCQ) MODALS
   ---------------------------------------------------- */

function EditQuestionModal({ question, onSave, onCancel }) {
  const [form, setForm] = useState({
    text: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct: "",
    difficulty: "Medium",
    topic: "",
  });

  const DIFFICULTY_OPTIONS = ["Easy", "Medium", "Hard"];

  useEffect(() => {
    if (question) {
      setForm({
        text: question.text || "",
        option_a: question.option_a || "",
        option_b: question.option_b || "",
        option_c: question.option_c || "",
        option_d: question.option_d || "",
        correct: question.correct || "",
        difficulty: question.difficulty || "Medium",
        topic: question.topic || "",
      });
    }
  }, [question]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (
      !form.text ||
      !form.option_a ||
      !form.option_b ||
      !form.option_c ||
      !form.option_d ||
      !form.correct
    ) {
      alert("Please fill all fields");
      return;
    }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
      <div className="bg-gray-900 text-white p-6 rounded-2xl w-[90%] md:w-[60%] max-h-[90vh] overflow-y-auto border-2 border-cyan-600">
        <h2 className="text-2xl font-bold text-cyan-300 mb-4">
          {question?.id ? "✏ Edit Question" : "➕ Add New Question"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-cyan-300 mb-2">Question Text</label>
            <textarea
              name="text"
              value={form.text}
              onChange={handleChange}
              rows={3}
              placeholder="Enter your question here..."
              className="w-full p-3 rounded bg-gray-800 border border-cyan-600 focus:border-cyan-400 focus:outline-none text-white"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {["option_a", "option_b", "option_c", "option_d"].map((option) => (
              <div key={option}>
                <label className="block text-cyan-300 mb-2">
                  {option.toUpperCase().replace("_", " ")}
                </label>
                <input
                  type="text"
                  name={option}
                  value={form[option]}
                  onChange={handleChange}
                  placeholder={`Option ${option.slice(-1).toUpperCase()}`}
                  className={`w-full p-3 rounded bg-gray-800 border ${
                    form.correct === option
                      ? "border-green-500"
                      : "border-cyan-600"
                  } focus:outline-none text-white`}
                  required
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-cyan-300 mb-2">
                Correct Answer
              </label>
              <select
                name="correct"
                value={form.correct}
                onChange={handleChange}
                className="w-full p-3 rounded bg-gray-800 border border-cyan-600 focus:border-cyan-400 focus:outline-none text-white"
                required
              >
                <option value="">Select correct option</option>
                <option value="option_a">A: {form.option_a}</option>
                <option value="option_b">B: {form.option_b}</option>
                <option value="option_c">C: {form.option_c}</option>
                <option value="option_d">D: {form.option_d}</option>
              </select>
            </div>

            <div>
              <label className="block text-cyan-300 mb-2">Difficulty</label>
              <select
                name="difficulty"
                value={form.difficulty}
                onChange={handleChange}
                className="w-full p-3 rounded bg-gray-800 border border-cyan-600 focus:border-cyan-400 focus:outline-none text-white"
              >
                {DIFFICULTY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-cyan-300 mb-2">Topic</label>
              <input
                type="text"
                name="topic"
                value={form.topic}
                onChange={handleChange}
                placeholder="e.g., Lexical Analysis"
                className="w-full p-3 rounded bg-gray-800 border border-cyan-600 focus:border-cyan-400 focus:outline-none text-white"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="px-6 py-2 bg-gray-600 rounded-lg hover:bg-gray-500 transition-colors text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-green-600 rounded-lg hover:bg-green-500 transition-colors text-white"
            >
              {question?.id ? "Update Question" : "Add Question"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewQuestionsModal({
  questions,
  onClose,
  onEdit,
  onDelete,
  onResetAll,
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this question?"))
      return;

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/questions/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete question");

      alert("✅ Question deleted successfully!");
      onDelete();
    } catch (error) {
      console.error("Error deleting question:", error);
      alert("❌ Failed to delete question");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
      <div className="bg-gray-900 text-white p-6 rounded-2xl max-h-[85vh] overflow-y-auto w-[95%] md:w-[80%] border-2 border-cyan-600 shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-cyan-300">
            📋 All Questions ({questions.length})
          </h2>
          <div className="flex gap-2">
            <button
              onClick={async () => {
                if (
                  window.confirm(
                    "This will delete ALL questions and reset IDs to 1. Continue?"
                  )
                ) {
                  try {
                    setLoading(true);
                    const res = await fetch(
                      `${API_BASE}/questions/reset-all`,
                      {
                        method: "DELETE",
                      }
                    );
                    let parsed;
                    try {
                      parsed = await res.json();
                    } catch (_) {
                      parsed = { message: `Reset completed (HTTP ${res.status})` };
                    }
                    alert(parsed.message || "Reset completed");
                    onResetAll();
                  } catch (error) {
                    alert("Error resetting questions");
                  } finally {
                    setLoading(false);
                  }
                }
              }}
              disabled={loading}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white font-bold transition-colors disabled:bg-red-800"
            >
              {loading ? "🔄 Resetting..." : "🗑 Reset All Questions"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-semibold transition-colors text-white"
            >
              Close
            </button>
          </div>
        </div>

        {questions.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <div className="text-6xl mb-4">❓</div>
            <p className="text-xl">No questions found.</p>
            <p className="text-sm mt-2">Add questions using the buttons above</p>
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map((q, index) => (
              <div
                key={q.id}
                className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-cyan-500 transition"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <p className="font-semibold text-lg mb-2 text-white">
                      {index + 1}. {q.text}
                    </p>
                    <div className="flex gap-4 text-sm text-gray-400 flex-wrap">
                      <span>
                        Difficulty:{" "}
                        <span className="text-cyan-300 font-bold">
                          {q.difficulty}
                        </span>
                      </span>
                      <span>ID: {q.id}</span>
                      <span>
                        Correct:{" "}
                        <span className="text-green-400 font-bold">
                          {q.correct?.toUpperCase()}
                        </span>
                      </span>
                      {q.topic && (
                        <span>
                          Topic:{" "}
                          <span className="text-amber-300 font-bold">
                            {q.topic}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex space-x-2 ml-4">
                    <button
                      onClick={() => onEdit(q)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium transition-colors text-white"
                    >
                      ✏ Edit
                    </button>
                    <button
                      onClick={() => handleDelete(q.id)}
                      disabled={loading}
                      className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm font-medium transition-colors text-white disabled:bg-red-800"
                    >
                      🗑 Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {["option_a", "option_b", "option_c", "option_d"].map(
                    (opt) => (
                      <div
                        key={opt}
                        className={`p-2 rounded border ${
                          q.correct === opt
                            ? "bg-green-600 border-green-400 text-white font-bold"
                            : "bg-gray-700 border-gray-600 text-gray-200"
                        }`}
                      >
                        <span className="font-bold">
                          {opt.slice(-1).toUpperCase()}:
                        </span>{" "}
                        {q[opt]}
                      </div>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ManualQuestionModal({ onClose, onAdded }) {
  const [form, setForm] = useState({
    text: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct: "",
    difficulty: "Medium",
    topic: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError("");
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (
      !form.text ||
      !form.option_a ||
      !form.option_b ||
      !form.option_c ||
      !form.option_d ||
      !form.correct
    ) {
      setError("Please fill all fields");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        data = { error: `Unexpected server response (HTTP ${res.status})` };
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to add question");
      }

      alert("✅ Question added successfully!");
      if (onAdded) onAdded(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 w-full max-w-2xl relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold"
        >
          &times;
        </button>

        <h2 className="text-2xl font-extrabold text-cyan-300 mb-4 text-center">
          ➕ Add New Question
        </h2>

        {error && (
          <div className="text-red-400 mb-4 p-3 bg-red-900 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-cyan-300 mb-2">Question Text</label>
            <textarea
              name="text"
              value={form.text}
              onChange={handleChange}
              rows={3}
              placeholder="Enter your question here..."
              className="w-full p-3 bg-gray-700 border-2 border-cyan-600 rounded-lg text-white focus:outline-none focus:border-cyan-400"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {["option_a", "option_b", "option_c", "option_d"].map((option) => (
              <div key={option}>
                <label className="block text-cyan-300 mb-2">
                  {option.replace("_", " ").toUpperCase()}
                </label>
                <input
                  type="text"
                  name={option}
                  value={form[option]}
                  onChange={handleChange}
                  placeholder={`Option ${option.slice(-1).toUpperCase()}`}
                  className="w-full p-3 bg-gray-700 border-2 border-cyan-600 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                  required
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-cyan-300 mb-2">Correct Answer</label>
              <select
                name="correct"
                value={form.correct}
                onChange={handleChange}
                className="w-full p-3 bg-gray-700 border-2 border-cyan-600 rounded-lg text-white focus:outline-none focus:border-cyan-400"
                required
              >
                <option value="">Select correct option</option>
                <option value="option_a">Option A</option>
                <option value="option_b">Option B</option>
                <option value="option_c">Option C</option>
                <option value="option_d">Option D</option>
              </select>
            </div>

            <div>
              <label className="block text-cyan-300 mb-2">Difficulty</label>
              <select
                name="difficulty"
                value={form.difficulty}
                onChange={handleChange}
                className="w-full p-3 bg-gray-700 border-2 border-cyan-600 rounded-lg text-white focus:outline-none focus:border-cyan-400"
              >
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </div>

            <div>
              <label className="block text-cyan-300 mb-2">Topic</label>
              <input
                type="text"
                name="topic"
                value={form.topic}
                onChange={handleChange}
                placeholder="e.g., Lexical Analysis"
                className="w-full p-3 bg-gray-700 border-2 border-cyan-600 rounded-lg text-white focus:outline-none focus:border-cyan-400"
              />
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-colors"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Question"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function UploadQsModal({ onClose, onInserted }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (
        selectedFile.type !== "text/csv" &&
        !selectedFile.name.endsWith(".csv")
      ) {
        setError("Please select a CSV file");
        return;
      }
      setFile(selectedFile);
      setError("");
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Please select a file first");
      return;
    }

    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/questions/upload`, {
        method: "POST",
        body: formData,
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        const text = await res.text();
        throw new Error(`Unexpected server response: ${text.slice(0, 200)}`);
      }

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      alert(
        `✅ Upload successful!\nInserted: ${data.inserted}\nTotal: ${
          data.total
        }\nErrors: ${data.errors?.length || 0}`
      );

      if (onInserted) {
        onInserted(data);
      }

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 max-w-md w-full relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold"
        >
          &times;
        </button>

        <h2 className="text-2xl font-extrabold text-cyan-300 mb-4 text-center">
          📤 Upload Questions CSV
        </h2>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-cyan-600 rounded-lg p-6 text-center">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className="cursor-pointer block text-cyan-300 hover:text-cyan-200"
            >
              {file ? `📄 ${file.name}` : "📁 Click to select CSV file"}
            </label>
            {file && (
              <p className="text-sm text-gray-400 mt-2">
                Size: {(file.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900 p-2 rounded">
              {error}
            </div>
          )}

          <div className="text-sm text-gray-400 bg-gray-900 p-3 rounded">
            <p className="font-bold text-cyan-300 mb-1">CSV Format:</p>
            <p>
              <code>
                question, option_a, option_b, option_c, option_d, correct,
                difficulty, topic
              </code>
            </p>
            <p className="mt-2 text-xs">
              Example: "What is compiler?", "Option A", "Option B", "Option C",
              "Option D", "A", "Easy", "Compiler Phases"
            </p>
          </div>

          <div className="flex justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              disabled={uploading}
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !file}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-colors disabled:bg-cyan-800"
            >
              {uploading ? "📤 Uploading..." : "📤 Upload"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------
   SHARED RANK MODAL (HANDLES BOTH MCQ & CROSSWORD)
   ---------------------------------------------------- */

function ViewRankModal({ gameTitle, ranks, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border-2 border-cyan-600 rounded-xl p-6 max-w-6xl w-full relative max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-cyan-300 hover:text-cyan-100 text-3xl font-bold"
        >
          &times;
        </button>
        <h2 className="text-3xl font-extrabold text-cyan-300 mb-4 text-center">
          🏆 Leaderboard - {gameTitle}
        </h2>

        {ranks.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-white min-w-full">
              <thead>
                <tr className="bg-cyan-700">
                  <th className="p-3 text-left">Rank</th>
                  <th className="p-3 text-left">Student</th>
                  <th className="p-3 text-left">Email</th>
                  <th className="p-3 text-right">Total Score</th>
                  {gameTitle !== "A. Crossword" && (
                    <>
                      <th className="p-3 text-right">
                        Questions answered(out of 30)
                      </th>
                      <th className="p-3 text-right">Correct</th>
                      <th className="p-3 text-right">Accuracy</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {ranks.map((player, index) => (
                  <tr
                    key={player.user_id || player.email || index}
                    className="border-b border-gray-700 hover:bg-gray-700"
                  >
                    <td className="p-3 font-bold text-cyan-300">
                      {index + 1}
                      {index === 0 && " 🥇"}
                      {index === 1 && " 🥈"}
                      {index === 2 && " 🥉"}
                    </td>
                    <td className="p-3 font-medium text-white">
                      {player.display_name || "Anonymous"}
                    </td>
                    <td className="p-3 text-cyan-200 text-sm">
                      {player.email}
                    </td>
                    <td className="p-3 text-right font-bold text-cyan-300">
                      {formatScore(player.total_score ?? 0)}
                    </td>
                    {gameTitle !== "A. Crossword" && (
                      <>
                        <td className="p-3 text-right text-gray-300">
                          {player.questions_answered || 0}
                        </td>
                        <td className="p-3 text-right text-green-400">
                          {player.correct_answers || 0}
                        </td>
                        <td className="p-3 text-right font-bold text-green-400">
                          {formatAccuracy(player.accuracy || 0)}%
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-gray-400 py-8">
            <div className="text-6xl mb-4">📊</div>
            <p className="text-xl">No game data available yet</p>
            <p className="text-sm mt-2">
              Students need to play the game to see rankings
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-white font-bold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------
   TeacherGameCard (KEEP IN SAME FILE)
   ---------------------------------------------------- */

function TeacherGameCard({
  title,
  icon,
  onUploadQs,
  onManualAdd,
  onViewRank,
  onViewQuestions,
  onDownloadResult,
  teacherGame,
  onGenerateCode,
  onSendLink,
  onStartGame,
  generating,
  sendingLink,
  starting,
}) {
  const navigate = useNavigate();
  const hasGameCode = !!teacherGame?.game_code;
  const startDisabled = starting || !hasGameCode;

  return (
    <div className="bg-gray-900 rounded-3xl p-6 border-2 border-cyan-600 hover:border-cyan-400 hover-lift transition-all duration-300">
      <h3 className="text-3xl font-extrabold text-cyan-300 mb-4 text-center">
        {icon} {title}
      </h3>

      <div className="space-y-3">
        <button
          onClick={onManualAdd}
          className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold transition-colors shadow-lg"
        >
          ✍ Add Question
        </button>

        <button
          onClick={onUploadQs}
          className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-colors shadow-lg"
        >
          {title === "A. Crossword" ? "📤 Upload CSV (CW)" : "📤 Upload CSV"}
        </button>

        <button
          onClick={onViewQuestions}
          className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors shadow-lg"
        >
          👁 View Questions
        </button>

        {(title === "Wisdom Warfare" || title === "A. Crossword") && (
          <>
            <button
              onClick={onViewRank}
              className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-bold transition-colors shadow-lg"
            >
              📊 View Rank
            </button>

            <button
              onClick={onDownloadResult}
              className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-colors shadow-lg"
            >
              📥 Download Results
            </button>

            <button
              onClick={() => navigate("/teacher-analytics")}
              className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold transition-colors shadow-lg"
            >
              📊 View Analytics
            </button>
          </>
        )}

        {(title === "Wisdom Warfare" || title === "A. Crossword") && (
          <div className="mt-4 p-4 rounded-lg bg-gray-800 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm text-gray-300">{icon} {title}</div>
                <div className="text-lg font-bold text-white mt-1">
                  {teacherGame?.game_name || "No game"}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">GAME CODE</div>
                <div className="text-xl font-extrabold text-amber-400">
                  {teacherGame?.game_code || "—"}
                </div>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={onGenerateCode}
                disabled={generating}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-400 rounded-md text-black font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {generating ? "Generating..." : "Generate"}
              </button>

              <button
                onClick={() =>
                  onSendLink && onSendLink(teacherGame?.game_code)
                }
                disabled={!hasGameCode || sendingLink}
                className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-md text-white font-semibold disabled:bg-cyan-800 disabled:cursor-not-allowed"
              >
                {sendingLink ? "Sending..." : "Send Link"}
              </button>

              <button
                onClick={onStartGame}
                disabled={startDisabled}
                className={`px-3 py-2 rounded-md font-semibold text-white ${
                  startDisabled
                    ? "bg-gray-600 cursor-not-allowed opacity-60"
                    : "bg-green-600 hover:bg-green-500"
                }`}
              >
                {starting
                  ? "Starting..."
                  : !hasGameCode
                  ? "Generate Code First"
                  : "Start Game"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------
   Main Page - TeacherGameManagementPage
   ---------------------------------------------------- */

function TeacherGameManagementPage() {
  const navigate = useNavigate();
  const [showTopPlayersModal, setShowTopPlayersModal] = useState(false);
  const [showUploadQsModal, setShowUploadQsModal] = useState(false);
  const [showManualQsModal, setShowManualQsModal] = useState(false);
  const [showViewRankModal, setShowViewRankModal] = useState(false);
  const [showQuestionsModal, setShowQuestionsModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const [topPlayers, setTopPlayers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [wisdomWarfareRanks, setWisdomWarfareRanks] = useState([]);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [loading, setLoading] = useState(false);

  const [teacherGames, setTeacherGames] = useState([]);
  const [currentTeacher, setCurrentTeacher] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [starting, setStarting] = useState(false);
  const [generatedGame, setGeneratedGame] = useState(null);
  const [topPlayersLoading, setTopPlayersLoading] = useState(false);

  // CROSSWORD STATES
  const [crosswordQuestions, setCrosswordQuestions] = useState([]);
  const [crosswordRanks, setCrosswordRanks] = useState([]);
  const [showCrosswordAddModal, setShowCrosswordAddModal] = useState(false);
  const [showCrosswordViewModal, setShowCrosswordViewModal] = useState(false);
  const [showCrosswordRankModal, setShowCrosswordRankModal] = useState(false);
  const [showUploadCrosswordQsModal, setShowUploadCrosswordQsModal] = useState(false);
  const [editingCrosswordQ, setEditingCrosswordQ] = useState(null);

  const games = [
    { name: "Wisdom Warfare", icon: "🧠", type: "QUIZ" },
    { name: "A. Crossword", icon: "📝", type: "CROSSWORD" },
  ];

  // Crossword API handlers
  const fetchCrosswordQuestions = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${CROSSWORD_API_BASE}/crossword/questions`);
      const data = await res.json();
      
      if (Array.isArray(data)) {
        setCrosswordQuestions(data);
      } else if (data.questions && Array.isArray(data.questions)) {
        setCrosswordQuestions(data.questions);
      } else {
        setCrosswordQuestions([]);
      }
    } catch (error) {
      console.error("Error fetching crossword questions:", error);
      setCrosswordQuestions([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteCrosswordQuestion = async (id) => {
    if (!id) {
        console.error("Attempted to delete with undefined ID");
        alert("Error: Cannot delete question because ID is missing.");
        return;
    }
    if (!window.confirm("Are you sure you want to delete this crossword question?")) return;

    setCrosswordQuestions(prev =>
      Array.isArray(prev) ? prev.filter(q => (q.id || q._id || q.question_id) !== id) : []
    );

    try {
      const res = await fetch(`${CROSSWORD_API_BASE}/crossword/questions/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || "Delete failed");
      }
    } catch (e) {
      console.error("Delete crossword error", e);
      alert(`Delete failed: ${e.message}`);
      fetchCrosswordQuestions();
    }
  };

  const fetchCrosswordRanks = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${CROSSWORD_API_BASE}/crossword/leaderboard`);
      const data = await res.json();
      setCrosswordRanks(data || []);
    } catch (error) {
      console.error("Error fetching crossword ranks:", error);
    } finally {
      setLoading(false);
    }
  };

  const downloadCrosswordResults = async () => {
    try {
      const res = await fetch(`${CROSSWORD_API_BASE}/crossword/download-results`);
      if (!res.ok) {
        alert("Failed to download crossword results");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "crossword-results.csv";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download error:", error);
      alert("Error downloading results");
    }
  };

  // ... (KEEP ALL YOUR EXISTING FUNCTIONS HERE - resetDuplicatePlays, fetchQuestions, fetchLeaderboard, etc.)
  // I'm keeping the structure but you need to copy all your existing functions

  const resetDuplicatePlays = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/admin/reset-duplicate-plays`, {
        method: "POST",
      });
      let data;
      try {
        data = await res.json();
      } catch (_) {
        data = {
          success: res.ok,
          message: `Reset completed (HTTP ${res.status})`,
        };
      }
      if (data.success) {
        alert(`✅ ${data.message}\nAffected users: ${data.affected_users}`);
        fetchLeaderboard();
        fetchWisdomWarfareRanks();
      } else {
        alert("❌ Failed to reset duplicate plays");
      }
    } catch (error) {
      console.error("Error resetting duplicate plays:", error);
      alert("Error resetting duplicate plays");
    } finally {
      setLoading(false);
    }
  };

  const fetchQuestions = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/questions`);
      if (!res.ok) throw new Error("Failed to fetch questions");
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error(
          `Unexpected server response while fetching questions (HTTP ${res.status})`
        );
      }
      setQuestions(data.questions || data);
    } catch (error) {
      console.error("Error fetching questions:", error);
      alert("Error loading questions");
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      setTopPlayersLoading(true);
      const [wisdomRes, crosswordRes] = await Promise.all([
        fetch(`${API_BASE}/leaderboard/wisdom-warfare?limit=50`),
        fetch(`${CROSSWORD_API_BASE}/leaderboard/crossword?limit=50`),
      ]);
      if (!wisdomRes.ok || !crosswordRes.ok) throw new Error("Failed to fetch leaderboard");
      const [wisdomData, crosswordData] = await Promise.all([
        wisdomRes.json(),
        crosswordRes.json(),
      ]);
      setTopPlayers(mergeGameLeaderboards(wisdomData || [], crosswordData || []));
    } catch (error) {
      console.error("Error fetching leaderboard:", error);
    } finally {
      setTopPlayersLoading(false);
    }
  };

  const fetchWisdomWarfareRanks = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/game-results/wisdom-warfare`);
      if (!res.ok) throw new Error("Failed to fetch game results");
      let data;
      try {
        data = await res.json();
      } catch (e) {
        throw new Error(
          `Unexpected server response while fetching game results (HTTP ${res.status})`
        );
      }
      setWisdomWarfareRanks(data.results || []);
    } catch (error) {
      console.error("Error fetching Wisdom Warfare ranks:", error);
      setWisdomWarfareRanks([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadResults = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_BASE}/download-results/wisdom-warfare`
      );
      if (!response.ok) throw new Error("Download failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `wisdom-warfare-results-${
        new Date().toISOString().split("T")[0]
      }.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      alert("✅ Results downloaded successfully!");
    } catch (error) {
      console.error("Download error:", error);
      alert("❌ Failed to download results");
    } finally {
      setLoading(false);
    }
  };

  const cleanupDuplicateUsers = async () => {
    if (
      !window.confirm(
        "⚠️ WARNING: Are you sure you want to delete EVERY student AND all their score records? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/admin/cleanup-users`, {
        method: "POST",
      });
      let data;
      try {
        data = await res.json();
      } catch (_) {
        data = { message: `Cleanup completed (HTTP ${res.status})` };
      }
      alert(
        data.message || "All student records and scores have been cleared."
      );
      await Promise.all([fetchLeaderboard(), fetchWisdomWarfareRanks()]);
    } catch (error) {
      alert("Error cleaning up students and records");
    } finally {
      setLoading(false);
    }
  };

  const reloadQuestions = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/admin/reload-questions`, {
        method: "POST",
      });
      let data;
      try {
        data = await res.json();
      } catch (_) {
        data = { message: `Reload completed (HTTP ${res.status})` };
      }
      alert(data.message || "Reload completed");
      fetchQuestions();
    } catch (error) {
      alert("Error reloading questions");
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentTeacher = async () => {
    try {
      const res = await fetch(`${API_BASE}/me`);
      if (!res.ok) return null;
      let data;
      try {
        data = await res.json();
      } catch (_) {
        return null;
      }
      const user = data.user || data;
      setCurrentTeacher(user);
      return user;
    } catch (e) {
      return null;
    }
  };

  const fetchTeacherGames = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/teacher/games`);
      let data;
      if (!res.ok) {
        const teacher = currentTeacher || (await fetchCurrentTeacher());
        if (teacher?.user_id) {
          const res2 = await fetch(
            `${API_BASE}/teacher/games?teacherId=${teacher.user_id}`
          );
          if (!res2.ok) throw new Error("Failed to fetch teacher games");
          try {
            data = await res2.json();
          } catch (_) {
            data = [];
          }
          const games = data.games || data || [];
          setTeacherGames(games);
          return;
        }
        throw new Error(`Failed to fetch teacher games (HTTP ${res.status})`);
      }
      try {
        data = await res.json();
      } catch (_) {
        data = [];
      }
      const games = data.games || data || [];
      setTeacherGames(games);
    } catch (error) {
      console.error("Error fetching teacher games:", error);
      setTeacherGames([]);
    } finally {
      setLoading(false);
    }
  };

  const sendLinkToStudents = async (gameCode) => {
    if (!gameCode) {
      alert("No game code available to send.");
      return;
    }

    try {
      setSendingLink(true);

      let lookupRes = await fetch(
        `${API_BASE}/game/code/${encodeURIComponent(gameCode)}`
      );
      if (!lookupRes.ok && lookupRes.status === 404) {
        lookupRes = await fetch(
          `${CROSSWORD_API_BASE}/game/code/${encodeURIComponent(gameCode)}`
        );
      }
      if (!lookupRes.ok) {
        const txt = await lookupRes.text().catch(() => "");
        throw new Error(`Game lookup failed: ${lookupRes.status} ${txt}`);
      }
      const lookupData = await lookupRes.json();
      const game = lookupData.game || lookupData;

      const gameId =
        game.id || game.game_id || game.gameId || game.teacher_game_id || null;

      if (!gameId) {
        throw new Error("Failed to resolve game ID from code");
      }

      const sendRes = await fetch(
        `${API_BASE}/teacher/games/${encodeURIComponent(
          gameId
        )}/send-link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      let sendData;
      try {
        sendData = await sendRes.json();
      } catch (e) {
        const t = await sendRes.text();
        throw new Error(`Unexpected server response: ${t}`);
      }

      if (!sendRes.ok) {
        throw new Error(
          sendData.error || sendData.message || "Failed to send link"
        );
      }

      const link = sendData.link || `${window.location.origin}/`;

      try {
        await navigator.clipboard.writeText(link);
        alert(`✅ Link ready and copied: ${link}`);
      } catch (e) {
        window.prompt("Copy the play link:", link);
      }
    } catch (error) {
      console.error("Error sending link:", error);
      alert("❌ Failed to send link: " + (error.message || error));
    } finally {
      setSendingLink(false);
    }
  };

  const handleGenerateCode = async (selectedGameName) => {
    try {
      setGenerating(true);

      const teacher = currentTeacher || await fetchCurrentTeacher();
      const teacher_id = teacher?.teacher_id ?? teacher?.user_id ?? teacher?.id ?? 1;

      let game_type = "QUIZ";
      if (selectedGameName === "A. Crossword") {
        game_type = "CROSSWORD";
      } else if (selectedGameName === "Wisdom Warfare") {
        game_type = "QUIZ";
      } else if (selectedGameName === "Mystery Spinner") {
        game_type = "SPINNER";
      } else if (selectedGameName === "Escape Room") {
        game_type = "ESCAPE";
      }

      const payload = {
        teacher_id,
        game_name: selectedGameName,
        game_type: game_type
      };

      const endpoint =
        selectedGameName === "A. Crossword"
          ? `${CROSSWORD_API_BASE}/crossword/create-game`
          : `${API_BASE}/teacher/games`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const raw = await res.text();
      let data;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }

      if (!res.ok) {
        throw new Error(
          data.error || data.message || `HTTP ${res.status}`
        );
      }

      const game = data.game || data;

      setGeneratedGame(game);

      setTeacherGames((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const filtered = list.filter(
          (g) => g.id !== game.id && g.game_code !== game.game_code
        );
        return [...filtered, game];
      });

      alert(`✅ ${selectedGameName} game code generated: ${game.game_code}`);
    } catch (error) {
      console.error("Generate code error:", error);
      alert("❌ Failed to generate game code: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const startGameSession = async (gameName, gameCode) => {
    if (!gameCode) {
      alert("Generate game code first");
      return;
    }

    try {
      setStarting(true);

      if (gameName === "A. Crossword") {
        console.log("🎮 Starting Crossword game...");
        
        const questionsRes = await fetch(`${CROSSWORD_API_BASE}/crossword/questions`);
        const questionsData = await questionsRes.json();
        const crosswordQuestions = Array.isArray(questionsData) 
          ? questionsData 
          : questionsData.questions || [];

        if (crosswordQuestions.length === 0) {
          alert("❌ Add crossword questions before starting the game");
          setStarting(false);
          return;
        }

        // Use the new startCrosswordGame function
        const gameResult = await startCrosswordGameAPI(gameCode);
        
        alert(`✅ Crossword game started successfully!\n📊 Grid: ${gameResult.gridSize}x${gameResult.gridSize}\n📝 Words: ${gameResult.totalWords}`);
      } else if (gameName === "Wisdom Warfare") {
        console.log("🎮 Starting Wisdom Warfare Quiz game...");
        
        const res = await fetch(`${API_BASE}/admin/start-game`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            game_code: gameCode,
            game_type: "QUIZ"
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Start failed");
        alert(`✅ ${gameName} started successfully`);
      } else {
        console.log(`🎮 Starting ${gameName} game...`);
        
        const res = await fetch(`${API_BASE}/admin/start-game`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            game_code: gameCode,
            game_type: "GENERIC"
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Start failed");
        alert(`✅ ${gameName} started successfully`);
      }
    } catch (e) {
      console.error(`Failed to start ${gameName}:`, e);
      alert(`❌ Failed to start ${gameName}: ${e.message}`);
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
    fetchLeaderboard();
    fetchWisdomWarfareRanks();
    (async () => {
      await fetchCurrentTeacher();
      fetchTeacherGames();
    })();
    fetchCrosswordQuestions();
  }, []);

  useEffect(() => {
    if (showTopPlayersModal) {
      fetchLeaderboard();
    }
  }, [showTopPlayersModal]);

  const handleEditQuestion = (question) => {
    setEditingQuestion(question);
    setShowEditModal(true);
  };

  const handleSaveEdit = async (updatedQuestion) => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/questions/${editingQuestion.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedQuestion),
      });

      if (!res.ok) throw new Error("Failed to update question");

      alert("✅ Question updated successfully!");
      fetchQuestions();
      setShowEditModal(false);
      setEditingQuestion(null);
    } catch (error) {
      console.error("Error updating question:", error);
      alert("❌ Failed to update question");
    } finally {
      setLoading(false);
    }
  };

  const handleViewRank = async (gameName) => {
    if (gameName === "Wisdom Warfare") {
      await fetchWisdomWarfareRanks();
      setShowViewRankModal(true);
    } else if (gameName === "A. Crossword") {
      await fetchCrosswordRanks();
      setShowCrosswordRankModal(true);
    } else {
      alert(`🏆 Rankings for ${gameName} will be available soon!`);
    }
  };

  const handleDownloadResult = (gameName) => {
    if (gameName === "Wisdom Warfare") {
      handleDownloadResults();
    } else if (gameName === "A. Crossword") {
      downloadCrosswordResults();
    } else {
      alert(`📥 Download for ${gameName} will be available soon!`);
    }
  };

  const handleUploadInserted = (data) => {
    console.log("Upload completed:", data);
    fetchQuestions();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-cyan-900 to-gray-900 flex flex-col items-center p-6">
      <div className="text-center mb-8">
        <h1 className="text-5xl font-black text-cyan-400 mb-4 glow-text">
          ⚔ TEACHER DASHBOARD
        </h1>
        <p className="text-xl text-cyan-200">Manage Games & Content</p>
      </div>

      <div className="flex flex-wrap gap-4 mb-8 justify-center">
        <button
          onClick={() => setShowTopPlayersModal(true)}
          disabled={loading || topPlayersLoading}
          className="px-6 py-3 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 font-bold transition-colors disabled:bg-cyan-800"
        >
          🏆 View Global Leaderboard
        </button>
        <button
          onClick={reloadQuestions}
          disabled={loading}
          className="px-6 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-500 font-bold transition-colors disabled:bg-blue-800"
        >
          🔄 Reload Questions
        </button>
        <button
          onClick={resetDuplicatePlays}
          disabled={loading}
          className="px-6 py-3 rounded-lg bg-purple-600 text-white hover:bg-purple-500 font-bold transition-colors disabled:bg-purple-800"
        >
          🔄 Reset Duplicate Plays
        </button>
        <button
          onClick={cleanupDuplicateUsers}
          disabled={loading}
          className="px-6 py-3 rounded-lg bg-orange-600 text-white hover:bg-orange-500 font-bold transition-colors disabled:bg-orange-800"
        >
          🔧 Cleanup Users
        </button>
      </div>

      <div className="mb-8 w-full max-w-4xl">
        <UploadStudentsSection />
      </div>

      {/* THIS IS WHERE THE GAME CARDS ARE RENDERED */}
      <div className="grid grid-cols-2 gap-8 w-full mb-12 mx-auto">
        {games.map((game) => {
          const specificGame = 
             (generatedGame && generatedGame.game_name === game.name ? generatedGame : null) ||
             teacherGames.find(g => g.game_name === game.name);

          return (
            <TeacherGameCard
              key={game.name}
              title={game.name}
              icon={game.icon}
              onManualAdd={() => {
                if(game.name === "A. Crossword") {
                   setEditingCrosswordQ(null);
                   setShowCrosswordAddModal(true);
                } else {
                   setShowManualQsModal(true);
                }
              }}
              onUploadQs={() =>
                game.name === "A. Crossword"
                  ? setShowUploadCrosswordQsModal(true)
                  : setShowUploadQsModal(true)
              }
              onViewQuestions={() => {
                if (game.name === "A. Crossword") {
                  fetchCrosswordQuestions();
                  setShowCrosswordViewModal(true);
                } else {
                  fetchQuestions();
                  setShowQuestionsModal(true);
                }
              }}
              onViewRank={() => handleViewRank(game.name)}
              onDownloadResult={() => handleDownloadResult(game.name)}
              teacherGame={specificGame}
              onGenerateCode={() => handleGenerateCode(game.name)}
              onSendLink={sendLinkToStudents}
              onStartGame={() => startGameSession(game.name, specificGame?.game_code)}
              generating={generating}
              sendingLink={sendingLink}
              starting={starting}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl mb-8">
        <div className="bg-gray-800 p-6 rounded-lg border-2 border-cyan-600 text-center">
          <div className="text-3xl font-bold text-cyan-400 mb-2">
            {questions.length}
          </div>
          <div className="text-cyan-200">Total MCQ Questions</div>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg border-2 border-green-600 text-center">
          <div className="text-3xl font-bold text-green-400 mb-2">
            {crosswordQuestions.length}
          </div>
          <div className="text-green-200">Crossword Questions</div>
        </div>
        <div className="bg-gray-800 p-6 rounded-lg border-2 border-purple-600 text-center">
          <div className="text-3xl font-bold text-purple-400 mb-2">
            {teacherGames.length}
          </div>
          <div className="text-purple-200">Active Games</div>
        </div>
      </div>

      <div className="w-full flex justify-center">
        <button
          onClick={() => (window.location.href = "/")}
          className="px-10 py-4 rounded-xl bg-red-600 text-white hover:bg-red-500 font-bold text-xl transition-colors shadow-lg"
        >
          🚪 Logout
        </button>
      </div>

      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-lg border-2 border-cyan-600 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto mb-4"></div>
            <p className="text-cyan-300">Processing...</p>
          </div>
        </div>
      )}

      {/* MODALS */}
      {showTopPlayersModal && (
        <TopPlayersModal
          players={topPlayers}
          onClose={() => setShowTopPlayersModal(false)}
        />
      )}

      {showUploadQsModal && (
        <UploadQsModal
          onClose={() => setShowUploadQsModal(false)}
          onInserted={handleUploadInserted}
        />
      )}

      {showManualQsModal && (
        <ManualQuestionModal
          onClose={() => setShowManualQsModal(false)}
          onAdded={fetchQuestions}
        />
      )}

      {showViewRankModal && (
        <ViewRankModal
          gameTitle="Wisdom Warfare"
          ranks={wisdomWarfareRanks}
          onClose={() => setShowViewRankModal(false)}
        />
      )}

      {showQuestionsModal && (
        <ViewQuestionsModal
          questions={questions}
          onClose={() => setShowQuestionsModal(false)}
          onEdit={handleEditQuestion}
          onDelete={fetchQuestions}
          onResetAll={fetchQuestions}
        />
      )}

      {showEditModal && (
        <EditQuestionModal
          question={editingQuestion}
          onSave={handleSaveEdit}
          onCancel={() => {
            setShowEditModal(false);
            setEditingQuestion(null);
          }}
        />
      )}

      {/* CROSSWORD SPECIFIC MODALS */}
      {showCrosswordAddModal && (
        <AddOrEditCrosswordModal
          initialData={editingCrosswordQ}
          onClose={() => {
              setShowCrosswordAddModal(false);
              setEditingCrosswordQ(null);
          }}
          onSaved={fetchCrosswordQuestions}
        />
      )}

      {showCrosswordViewModal && (
        <ViewCrosswordQuestionsModal
          questions={crosswordQuestions}
          onClose={() => setShowCrosswordViewModal(false)}
          onDelete={deleteCrosswordQuestion}
          onEdit={(question) => {
              setEditingCrosswordQ({ ...question });
              setShowCrosswordAddModal(true);
              setShowCrosswordViewModal(false);
          }}
        />
      )}

      {showCrosswordRankModal && (
        <ViewRankModal
          gameTitle="A. Crossword"
          ranks={crosswordRanks}
          onClose={() => setShowCrosswordRankModal(false)}
        />
      )}

      {showUploadCrosswordQsModal && (
        <UploadCrosswordQsModal
          onClose={() => setShowUploadCrosswordQsModal(false)}
          onInserted={fetchCrosswordQuestions}
        />
      )}
    </div>
  );
}

export default TeacherGameManagementPage;