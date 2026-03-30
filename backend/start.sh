#!/bin/bash
# Start both main server and crossword server for Render deployment

echo "🚀 Starting main backend server on port 4001..."
node server.js &
MAIN_PID=$!

echo "🚀 Starting crossword server on port 4002..."
node crosswordserver.js &
CROSSWORD_PID=$!

echo "📍 Main server PID: $MAIN_PID"
echo "📍 Crossword server PID: $CROSSWORD_PID"

# Wait for both processes
wait $MAIN_PID $CROSSWORD_PID
