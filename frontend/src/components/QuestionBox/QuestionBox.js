import React, { useState, useEffect, useRef } from "react";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:4000";

function AnswerButton({ text, disabled, onClick, state }) {
  const baseClass = "w-full text-center py-6 rounded-md border-2 mb-4";
  const stateClass =
    state === "correct"
      ? "border-green-400 bg-green-900/10 text-green-100"
      : state === "wrong"
      ? "border-rose-500 bg-rose-900/5 text-rose-200"
      : "border-cyan-500 bg-transparent text-white";

  return (
    <button
      className={`${baseClass} ${stateClass}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span className="font-semibold text-xl">{text}</span>
    </button>
  );
}

export default function QuestionBox({
  question,
  answers = [],
  questionId,
  onNextQuestion,
  onStatsUpdated,
  difficulty,
  user, // optional user object (preferred)
  gameName,
}) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [disabled, setDisabled] = useState(false);
  const [answerState, setAnswerState] = useState(null);
  const [message, setMessage] = useState("");
  const autoAdvanceTimerRef = useRef(null);

  useEffect(() => {
    // reset when question changes
    setSelectedIdx(null);
    setDisabled(false);
    setAnswerState(null);
    setMessage("");

    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }

    // cleanup on unmount
    return () => {
      if (autoAdvanceTimerRef.current) {
        clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  const getUserId = () => {
    if (user && (user.user_id || user.userId)) {
      const id = Number(user.user_id || user.userId);
      return Number.isFinite(id) ? id : null;
    }
    const idFromStorage = localStorage.getItem("user_id");
    if (idFromStorage) {
      const id = Number(idFromStorage);
      return Number.isFinite(id) ? id : null;
    }
    return null;
  };

  const handleClick = async (answer, idx) => {
    if (disabled) return;

    const userId = getUserId();
    if (!userId) {
      alert("Please sign in with Google to answer (user_id missing).");
      return;
    }

    if (!questionId) {
      alert("Question ID missing. Cannot submit answer.");
      return;
    }

    // optimistic UI
    setDisabled(true);
    setSelectedIdx(idx);
    setMessage("Checking...");
    setAnswerState(null);

    try {
      const res = await fetch(`${API_BASE}/submit-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: Number(userId),
          question_id: questionId,
          selected: answer,
          game_name: gameName || undefined,
        }),
      });

      // try parse JSON, but handle non-JSON gracefully
      let data;
      const text = await res.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        // server returned non-JSON (could be HTML error page); put raw text into data.raw
        data = { raw: text };
      }

      if (!res.ok) {
        // show server-provided error if available
        const errMsg =
          (data && (data.error || data.message)) ||
          (data && data.raw) ||
          `Server returned ${res.status}`;
        setMessage(`Server error: ${errMsg}`);
        console.error("submit-answer error response:", res.status, text, data);
        setDisabled(false);
        return;
      }

      // At this point server responded OK with JSON (or empty object)
      if (data.is_correct) {
        setAnswerState("correct");
        setMessage(`✅ Correct! +${data.points_awarded ?? "?"} points`);
      } else {
        setAnswerState("wrong");
        setMessage("❌ Wrong!");
      }

      // propagate stats to parent if provided
      if (
        onStatsUpdated &&
        (data.total_score !== undefined || data.accuracy !== undefined)
      ) {
        onStatsUpdated({
          total_score:
            typeof data.total_score === "number" ? data.total_score : undefined,
          accuracy: typeof data.accuracy === "number" ? data.accuracy : undefined,
        });
      }

      // automatically move to next question after short delay (1.5s)
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        setDisabled(false);
        setSelectedIdx(null);
        setAnswerState(null);
        setMessage("");
        if (typeof onNextQuestion === "function") onNextQuestion();
        autoAdvanceTimerRef.current = null;
      }, 1500);
    } catch (err) {
      console.error("Network or client error submitting answer:", err);
      setMessage("Network error. Try again.");
      setDisabled(false);
    }
  };

  const handleNext = () => {
    // manual Next button
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    setSelectedIdx(null);
    setDisabled(false);
    setAnswerState(null);
    setMessage("");
    if (typeof onNextQuestion === "function") onNextQuestion();
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-6">
        {difficulty && (
          <div className="text-sm text-cyan-300 mb-2">{difficulty}</div>
        )}
        <h2 className="text-3xl md:text-4xl font-semibold text-white">
          {question}
        </h2>
      </div>

      <div className="space-y-2">
        {answers.map((ans, idx) => (
          <AnswerButton
            key={idx}
            text={ans}
            disabled={disabled}
            onClick={() => handleClick(ans, idx)}
            state={selectedIdx === idx ? answerState : null}
          />
        ))}
      </div>

      <div className="mt-6 text-center">
        {message && <div className="text-white mb-3">{message}</div>}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={handleNext}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 px-6 rounded-md"
            type="button"
            disabled={disabled}
          >
            Next Question
          </button>
        </div>
      </div>
    </div>
  );
}
