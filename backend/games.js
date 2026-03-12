let currentQuestion = null;
let answeredUsers = new Set();
let questionTimer = null;
const QUESTION_TIME = 15;

async function fetchLeaderboard(pool, limit = 10) {
  const sql = `
    SELECT u.user_id, u.username, COALESCE(p.score,0) AS score, p.last_update
    FROM users u
    LEFT JOIN performance p ON u.user_id = p.user_id
    ORDER BY score DESC, p.last_update ASC
    LIMIT ?
  `;
  const [rows] = await pool.query(sql, [limit]);
  return rows;
}

module.exports = (io, pool) => {
  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // Send initial leaderboard
    fetchLeaderboard(pool, 20).then(lb => socket.emit("leaderboardUpdate", lb));

    // Admin starts a question
    socket.on("adminStartQuestion", async () => {
      const [rows] = await pool.query("SELECT * FROM questions ORDER BY RAND() LIMIT 1");
      if (!rows.length) return;
      currentQuestion = rows[0];
      answeredUsers.clear();

      io.emit("newQuestion", { ...currentQuestion, time: QUESTION_TIME });

      if (questionTimer) clearTimeout(questionTimer);
      questionTimer = setTimeout(() => {
        io.emit("questionClosed", { correct: currentQuestion.correct });
        currentQuestion = null;
      }, QUESTION_TIME * 1000);
    });

    // Player submits answer
    socket.on("submitAnswer", async ({ user_id, answer }) => {
      if (!currentQuestion) return socket.emit("answerResult", "No active question!");
      if (answeredUsers.has(user_id)) return socket.emit("answerResult", "You already answered!");

      answeredUsers.add(user_id);

      let msg = "Wrong!";
      if (answer.toUpperCase() === currentQuestion.correct.toUpperCase()) {
        let points = 10;
        if (answeredUsers.size === 1) points += 5;
        await pool.query(
          `INSERT INTO performance (user_id, score) VALUES (?, ?)
           ON DUPLICATE KEY UPDATE score = score + VALUES(score), last_update = CURRENT_TIMESTAMP`,
          [user_id, points]
        );
        const lb = await fetchLeaderboard(pool, 20);
        io.emit("leaderboardUpdate", lb);
        msg = "Correct! +" + points + " points";
      }
      socket.emit("answerResult", msg);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });
};
