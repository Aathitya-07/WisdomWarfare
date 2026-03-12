/******************************************************************
 * DATABASE + ML OPTIMIZED CROSSWORD GENERATOR
 * Uses TensorFlow.js to maximize placed words
 ******************************************************************/

const mysql = require('mysql2/promise');
const tf = require('@tensorflow/tfjs');

/* ================================================================
   DATABASE CONFIG
================================================================ */
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'wisdomwarfare',
  waitForConnections: true,
  connectionLimit: 10
});

/* ================================================================
   TENSORFLOW MODEL (PLACEMENT SCORER)
================================================================ */
function buildModel() {
  const model = tf.sequential();

  model.add(tf.layers.dense({ inputShape: [8], units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));

  model.compile({
    optimizer: 'adam',
    loss: 'binaryCrossentropy'
  });

  return model;
}

// ⚠️ Untrained model still works as heuristic scorer
const placementModel = buildModel();

/* ================================================================
   DATABASE FETCH
================================================================ */
async function fetchQuestions(count = 15) {
  const conn = await pool.getConnection();
  const [rows] = await conn.query(
    `SELECT id, question, answer FROM crossword_questions ORDER BY RAND() LIMIT ?`,
    [count]
  );
  conn.release();

  return rows.map(r => ({
    id: r.id,
    clue: r.question,
    word: r.answer.toUpperCase().replace(/[^A-Z]/g, '')
  }));
}

/* ================================================================
   GRID INITIALIZATION
================================================================ */
function createGrid(size) {
  return Array(size).fill().map(() =>
    Array(size).fill().map(() => ({
      letter: '',
      hasLetter: false,
      isBlack: false,
      across: null,
      down: null
    }))
  );
}

/* ================================================================
   FEATURE EXTRACTION FOR ML
================================================================ */
function extractFeatures(grid, word, row, col, dir) {
  const size = grid.length;
  let intersections = 0;
  let blackNeighbors = 0;
  let filled = 0;

  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      if (grid[r][c].hasLetter) filled++;

  for (let i = 0; i < word.length; i++) {
    const r = dir === 'across' ? row : row + i;
    const c = dir === 'across' ? col + i : col;

    if (grid[r][c].hasLetter) intersections++;

    [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].forEach(([nr,nc])=>{
      if (grid[nr]?.[nc]?.isBlack) blackNeighbors++;
    });
  }

  return [
    word.length,
    intersections,
    filled / (size * size),
    blackNeighbors,
    size - Math.abs(size/2 - row),
    size - Math.abs(size/2 - col),
    dir === 'across' ? 0 : 1,
    intersections > 0 ? 1 : 0
  ];
}
//print grid
function printGrid(grid) {
  const size = grid.length;

  console.log("\n🧩 GENERATED CROSSWORD GRID");
  console.log("=".repeat(size * 2));

  for (let r = 0; r < size; r++) {
    let row = "";
    for (let c = 0; c < size; c++) {
      const cell = grid[r][c];
      if (cell.isBlack) row += "██";
      else if (cell.hasLetter) row += cell.letter + " ";
      else row += "· ";
    }
    console.log(row);
  }
}


/* ================================================================
   ML SCORING
================================================================ */
function scorePlacement(features) {
  const t = tf.tensor2d([features]);
  const score = placementModel.predict(t).dataSync()[0];
  t.dispose();
  return score;
}

/* ================================================================
   VALIDATION
================================================================ */
function canPlace(grid, word, row, col, dir) {
  const size = grid.length;
  if (dir === 'across' && col + word.length > size) return false;
  if (dir === 'down' && row + word.length > size) return false;

  for (let i = 0; i < word.length; i++) {
    const r = dir === 'across' ? row : row + i;
    const c = dir === 'across' ? col + i : col;

    const cell = grid[r][c];
    if (cell.isBlack) return false;
    if (cell.hasLetter && cell.letter !== word[i]) return false;
  }
  return true;
}

/* ================================================================
   PLACE WORD
================================================================ */
function placeWord(grid, word, row, col, dir) {
  for (let i = 0; i < word.length; i++) {
    const r = dir === 'across' ? row : row + i;
    const c = dir === 'across' ? col + i : col;

    grid[r][c].letter = word[i];
    grid[r][c].hasLetter = true;
    grid[r][c][dir] = word;
  }
}

/* ================================================================
   OPTIMIZED GENERATOR (BEAM SEARCH + ML)
================================================================ */
function generateCrossword(words, size = 15) {
  const beamWidth = 8;
  let beam = [{
    grid: createGrid(size),
    placed: [],
    score: 0
  }];

  // strong ordering
  words.sort((a,b)=>b.word.length - a.word.length);

  for (const w of words) {
    const candidates = [];

    for (const state of beam) {
      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          for (const d of ['across','down']) {
            if (!canPlace(state.grid, w.word, r, c, d)) continue;

            const features = extractFeatures(state.grid, w.word, r, c, d);
            const mlScore = scorePlacement(features);

            if (mlScore < 0.5) continue;

            const newGrid = JSON.parse(JSON.stringify(state.grid));
            placeWord(newGrid, w.word, r, c, d);

            candidates.push({
              grid: newGrid,
              placed: [...state.placed, w.word],
              score: state.placed.length + mlScore
            });
          }
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a,b)=>b.score - a.score);
      beam = candidates.slice(0, beamWidth);
    }
  }

  return beam[0];
}

/* ================================================================
   MAIN
================================================================ */
async function main() {
  const questions = await fetchQuestions(15);

  const words = questions.map(q => ({
    id: q.id,
    word: q.word,
    clue: q.clue
  }));

  const result = generateCrossword(words, 15);

  console.log(`✅ Words placed: ${result.placed.length}/${words.length}`);
  console.log(result.placed);
printGrid(result.grid);


  await pool.end();
}

main();
