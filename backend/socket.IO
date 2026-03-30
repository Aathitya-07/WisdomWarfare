const { io } = require("socket.io-client");

const socket = io(process.env.SOCKET_SERVER_URL || "http://localhost:4001");

socket.on("connect", () => {
  console.log("Connected to server:", socket.id);
});

socket.on("new_user", (data) => {
  console.log("🔥 New user joined:", data);
});

socket.on("score_updated", (data) => {
  console.log("📊 Score updated:", data);
});
