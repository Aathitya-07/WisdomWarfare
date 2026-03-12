module.exports = (app, pool) => {
  app.post("/users", async (req, res) => {
    const { username, password_hash } = req.body;
    if (!username) return res.status(400).json({ error: "username required" });
    try {
      const [result] = await pool.query(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        [username, password_hash || null]
      );
      res.json({ user_id: result.insertId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/users", async (req, res) => {
    try {
      const [rows] = await pool.query("SELECT * FROM users");
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
