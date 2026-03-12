// crosswordteacher.js
import React, { useState, useEffect } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4001";

/* ----------------------------------------------------
   CROSSWORD MODALS & COMPONENTS
   ---------------------------------------------------- */

export function AddOrEditCrosswordModal({ onClose, onSaved, initialData = null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setQuestion(initialData.question || "");
      setAnswer(initialData.answer || "");
    } else {
      setQuestion("");
      setAnswer("");
    }
  }, [initialData]);

  const save = async () => {
    if (!question || !answer) {
      alert("Fill both fields");
      return;
    }
    setLoading(true);
    
    const id = initialData ? (initialData.id || initialData._id || initialData.question_id) : null;

    try {
      if (initialData) {
        // EDIT MODE
        if (!id) throw new Error("Missing Question ID for update");
        
        await fetch(`${API_BASE}/crossword/questions/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, answer }),
        });
        alert("✅ Crossword Question Updated!");
      } else {
        // ADD MODE
        await fetch(`${API_BASE}/crossword/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, answer }),
        });
        alert("✅ Crossword Question Added!");
      }
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      alert("Error saving crossword question: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
      <div className="bg-gray-800 p-6 rounded-xl w-full max-w-lg border-2 border-cyan-600">
        <h2 className="text-xl text-cyan-300 font-bold mb-4">
          {initialData ? "✏ Edit Crossword Question" : "➕ Add Crossword Question"}
        </h2>

        <textarea
          placeholder="Question / Clue"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="w-full p-3 mb-3 bg-gray-700 rounded text-white border border-gray-600 focus:border-cyan-400 outline-none"
        />

        <input
          placeholder="Answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          className="w-full p-3 mb-4 bg-gray-700 rounded text-white border border-gray-600 focus:border-cyan-400 outline-none"
        />

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded transition-colors"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={loading}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded font-bold transition-colors"
          >
            {loading ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function UploadCrosswordQsModal({ onClose, onInserted }) {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const upload = async () => {
    if (!file) return setError("Select a CSV file");

    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/crossword/questions/upload`, {
        method: "POST",
        body: fd,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      alert(`✅ Inserted ${data.inserted} crossword questions`);
      onInserted?.();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-xl border-2 border-cyan-600 w-full max-w-md">
        <h2 className="text-cyan-300 text-xl font-bold mb-3 text-center">
          📤 Upload Crossword CSV
        </h2>

        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files[0])}
          className="w-full mb-3 text-white bg-gray-900 border border-cyan-600 rounded p-2"
        />

        <p className="text-xs text-gray-400 mb-2">
          Format: <code>question,answer,difficulty</code>
        </p>

        {error && <p className="text-red-400 mb-2">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded text-white">
            Cancel
          </button>
          <button
            onClick={upload}
            disabled={uploading}
            className="bg-cyan-600 hover:bg-cyan-500 px-4 py-2 rounded font-bold text-white"
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ViewCrosswordQuestionsModal({ questions, onClose, onEdit, onDelete }) {
  const safeQuestions = Array.isArray(questions) ? questions : [];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center z-50">
      <div className="bg-gray-900 p-6 rounded-2xl w-[95%] md:w-[80%] border-2 border-cyan-600 max-h-[85vh] overflow-y-auto shadow-lg">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-cyan-300">
            📋 Crossword Questions ({safeQuestions.length})
          </h2>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg font-semibold transition-colors text-white"
          >
            Close
          </button>
        </div>

        {safeQuestions.length === 0 ? (
          <div className="text-gray-400 text-center py-8">
             <div className="text-6xl mb-4">❓</div>
             <p className="text-xl">No questions added yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {safeQuestions.map((q, index) => {
              const questionId = q.id || q._id || q.question_id;
              
              if (!questionId) {
                  console.warn("Question missing ID:", q);
              }

              return (
                <div
                  key={questionId || index}
                  className="bg-gray-800 p-4 rounded-lg border border-gray-700 hover:border-cyan-500 transition"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-semibold text-lg mb-2 text-white">
                        {index + 1}. {q.question}
                      </p>
                      <div className="text-sm mt-1">
                          <span className="text-gray-400">Answer: </span>
                          <span className="text-green-400 font-bold bg-gray-900 px-2 py-1 rounded border border-green-700">
                              {q.answer}
                          </span>
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
                        onClick={() => onDelete(questionId)}
                        className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm font-medium transition-colors text-white"
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------
   CROSSWORD UTILITY FUNCTIONS
   ---------------------------------------------------- */

export async function startCrosswordGame(questions) {
  try {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("No crossword questions available");
    }

    console.log(`🎮 Starting crossword game with ${questions.length} questions`);

    const res = await fetch(`${API_BASE}/crossword/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "Failed to start crossword game");
    }

    console.log("✅ Crossword game started successfully");
    return data;
  } catch (error) {
    console.error("Error starting crossword game:", error);
    throw error;
  }
}

export async function fetchCrosswordQuestions() {
  try {
    const res = await fetch(`${API_BASE}/crossword/questions`);
    const data = await res.json();
    
    if (Array.isArray(data)) {
      return data;
    } else if (data.questions && Array.isArray(data.questions)) {
      return data.questions;
    } else {
      return [];
    }
  } catch (error) {
    console.error("Error fetching crossword questions:", error);
    return [];
  }
}

export async function deleteCrosswordQuestion(id) {
  if (!id) {
    console.error("Attempted to delete with undefined ID");
    alert("Error: Cannot delete question because ID is missing.");
    return false;
  }

  try {
    const res = await fetch(`${API_BASE}/crossword/questions/${id}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || "Delete failed");
    }
    
    return true;
  } catch (e) {
    console.error("Delete crossword error", e);
    alert(`Delete failed: ${e.message}`);
    return false;
  }
}

export async function fetchCrosswordRanks() {
  try {
    const res = await fetch(`${API_BASE}/crossword/leaderboard`);
    const data = await res.json();
    return data || [];
  } catch (error) {
    console.error("Error fetching crossword ranks:", error);
    return [];
  }
}

export async function downloadCrosswordResults() {
  try {
    const res = await fetch(`${API_BASE}/crossword/download-results`);
    if (!res.ok) {
      alert("Failed to download crossword results");
      return false;
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
    return true;
  } catch (error) {
    console.error("Download error:", error);
    alert("Error downloading results");
    return false;
  }
}