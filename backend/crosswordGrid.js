const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuration
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

const dbConfig = databaseUrl
  ? {
      uri: databaseUrl,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      ssl: { rejectUnauthorized: false },
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'wisdomwarfare',
      port: parseInt(process.env.DB_PORT || '3306', 10),
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };

// Create connection pool
const pool = mysql.createPool(dbConfig);

async function fetchCrosswordQuestions(count = 15) {
  try {
    const connection = await pool.getConnection();
    
    // ✅ FIXED: Using parameterized query
    const [rows] = await connection.query(
      `SELECT id, question, answer, difficulty 
       FROM crossword_questions 
       ORDER BY RAND() 
       LIMIT ?`,
      [parseInt(count)]
    );
    
    connection.release();
    
    if (rows.length === 0) {
      console.warn('No crossword questions found in database');
      return getFallbackQuestions();
    }
    
    console.log(`Fetched ${rows.length} crossword questions from database`);
    return rows.map(row => {
      const normalizedAnswer = row.answer.toUpperCase().replace(/[^A-Z]/g, '').trim();
      return {
        id: row.id,
        question: row.question,
        answer: normalizedAnswer,
        difficulty: row.difficulty || 'Medium',
        length: normalizedAnswer.length
      };
    });
    
  } catch (error) {
    console.error('Error fetching crossword questions:', error);
    return getFallbackQuestions();
  }
}

function getFallbackQuestions() {
  return [
    { id: 1, question: "A program that translates source code into machine code", answer: "COMPILER", difficulty: "Easy", length: 8 },
    { id: 2, question: "The first phase of compilation", answer: "LEXICAL", difficulty: "Easy", length: 7 },
    { id: 3, question: "A sequence of characters with a collective meaning", answer: "TOKEN", difficulty: "Easy", length: 5 },
    { id: 4, question: "Data structure used to store information about identifiers", answer: "SYMBOLTABLE", difficulty: "Medium", length: 10 },
    { id: 5, question: "Phase that checks for grammatical errors", answer: "SYNTAX", difficulty: "Easy", length: 6 },
    { id: 6, question: "Tree representation of the abstract syntactic structure", answer: "AST", difficulty: "Medium", length: 3 },
    { id: 7, question: "A grammar that produces more than one parse tree for a string", answer: "AMBIGUOUS", difficulty: "Medium", length: 9 },
    { id: 8, question: "Process of improving code efficiency without changing output", answer: "OPTIMIZATION", difficulty: "Medium", length: 12 },
    { id: 9, question: "Bottom-up parsing is also called ____-reduce parsing", answer: "SHIFT", difficulty: "Hard", length: 5 },
    { id: 10, question: "Tool used to generate lexical analyzers", answer: "LEX", difficulty: "Medium", length: 3 },
    { id: 11, question: "Tool used to generate parsers", answer: "YACC", difficulty: "Medium", length: 4 },
    { id: 12, question: "Type checking occurs during this analysis phase", answer: "SEMANTIC", difficulty: "Easy", length: 8 },
    { id: 13, question: "Intermediate code often uses _____ address code", answer: "THREE", difficulty: "Hard", length: 5 },
    { id: 14, question: "Converts assembly language to machine code", answer: "ASSEMBLER", difficulty: "Easy", length: 9 },
    { id: 15, question: "Removing code that is never executed", answer: "DEADCODE", difficulty: "Medium", length: 8 }
  ];
}

class PerfectCrosswordGenerator {
  constructor(questions, gridSize = 15) {
    this.questions = this.prepareQuestions(questions);
    this.gridSize = gridSize;
    this.resetBoard();
  }

  prepareQuestions(questions) {
    const uniqueAnswers = new Set();

    return (Array.isArray(questions) ? questions : [])
      .map((question) => {
        const answer = String(question?.answer || '').toUpperCase().replace(/[^A-Z]/g, '');
        return {
          id: question?.id,
          question: question?.question,
          answer,
          difficulty: question?.difficulty || 'Medium',
          length: answer.length,
        };
      })
      .filter((question) => {
        if (!question.id || !question.question || !question.answer || question.length < 2) {
          return false;
        }

        if (uniqueAnswers.has(question.answer)) {
          return false;
        }

        uniqueAnswers.add(question.answer);
        return true;
      });
  }

  resetBoard() {
    this.grid = Array.from({ length: this.gridSize }, () => Array(this.gridSize).fill('#'));
    this.letters = Array.from({ length: this.gridSize }, () => Array(this.gridSize).fill(''));
    this.placedWords = [];
    this.clues = { across: [], down: [] };
    this.cellNumbers = {};
    this.nextNumber = 1;
  }

  shuffleQuestions() {
    const shuffled = [...this.questions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    shuffled.sort((left, right) => right.length - left.length);
    return shuffled;
  }

  generate() {
    console.log(`Generating ${this.gridSize}x${this.gridSize} crossword with ${this.questions.length} questions`);

    if (!this.questions.length) {
      return this.getResult();
    }

    let bestSnapshot = null;

    for (let attempt = 0; attempt < 30; attempt++) {
      this.resetBoard();
      const orderedQuestions = this.shuffleQuestions();
      this.buildBoard(orderedQuestions, attempt);
      const snapshot = this.createSnapshot();

      if (!bestSnapshot || snapshot.score > bestSnapshot.score) {
        bestSnapshot = snapshot;
      }

      if (snapshot.placedCount === orderedQuestions.length && snapshot.intersections > 0) {
        break;
      }
    }

    if (bestSnapshot) {
      this.restoreSnapshot(bestSnapshot);
    }

    return this.getResult();
  }

  buildBoard(orderedQuestions, attemptSeed) {
    const firstWordPool = orderedQuestions.slice(0, Math.min(4, orderedQuestions.length));
    const anchorWord = firstWordPool[attemptSeed % firstWordPool.length] || orderedQuestions[0];
    const anchorDirection = attemptSeed % 2 === 0 ? 'across' : 'down';

    const centerRow = Math.floor(this.gridSize / 2);
    const centerCol = Math.floor(this.gridSize / 2);
    const anchorRow = anchorDirection === 'across'
      ? centerRow
      : Math.max(0, centerRow - Math.floor(anchorWord.length / 2));
    const anchorCol = anchorDirection === 'across'
      ? Math.max(0, centerCol - Math.floor(anchorWord.length / 2))
      : centerCol;

    this.placeWord(anchorWord, anchorRow, anchorCol, anchorDirection);

    for (const word of orderedQuestions) {
      if (word.id === anchorWord.id) {
        continue;
      }

      const placements = this.findPlacements(word);
      if (!placements.length) {
        continue;
      }

      const topPlacements = placements.slice(0, Math.min(5, placements.length));
      const selectedPlacement = topPlacements[Math.floor(Math.random() * topPlacements.length)];
      this.placeWord(word, selectedPlacement.row, selectedPlacement.col, selectedPlacement.direction);
    }
  }

  hasLetter(row, col) {
    return row >= 0 && row < this.gridSize && col >= 0 && col < this.gridSize && this.letters[row][col] !== '';
  }

  canPlaceWord(word, row, col, direction, requireIntersection) {
    const isAcross = direction === 'across';
    let intersections = 0;

    if (isAcross) {
      if (row < 0 || row >= this.gridSize || col < 0 || col + word.length > this.gridSize) {
        return null;
      }
    } else if (row < 0 || row + word.length > this.gridSize || col < 0 || col >= this.gridSize) {
      return null;
    }

    for (let index = 0; index < word.length; index++) {
      const cellRow = isAcross ? row : row + index;
      const cellCol = isAcross ? col + index : col;
      const existingLetter = this.letters[cellRow][cellCol];
      const targetLetter = word.answer[index];

      if (existingLetter) {
        if (existingLetter !== targetLetter) {
          return null;
        }
        intersections += 1;
        continue;
      }

      if (isAcross) {
        if (this.hasLetter(cellRow - 1, cellCol) || this.hasLetter(cellRow + 1, cellCol)) {
          return null;
        }
      } else if (this.hasLetter(cellRow, cellCol - 1) || this.hasLetter(cellRow, cellCol + 1)) {
        return null;
      }
    }

    const beforeRow = isAcross ? row : row - 1;
    const beforeCol = isAcross ? col - 1 : col;
    const afterRow = isAcross ? row : row + word.length;
    const afterCol = isAcross ? col + word.length : col;

    if (this.hasLetter(beforeRow, beforeCol) || this.hasLetter(afterRow, afterCol)) {
      return null;
    }

    if (requireIntersection && intersections === 0) {
      return null;
    }

    if (intersections === word.length) {
      return null;
    }

    return { intersections };
  }

  findPlacements(word) {
    const requireIntersection = this.placedWords.length > 0;
    const placements = [];
    const center = Math.floor(this.gridSize / 2);

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        for (const direction of ['across', 'down']) {
          const validation = this.canPlaceWord(word, row, col, direction, requireIntersection);
          if (!validation) {
            continue;
          }

          const distanceFromCenter = Math.abs(row - center) + Math.abs(col - center);
          const score = validation.intersections * 100 - distanceFromCenter;
          placements.push({ row, col, direction, score, intersections: validation.intersections });
        }
      }
    }

    placements.sort((left, right) => right.score - left.score);
    return placements;
  }

  placeWord(word, row, col, direction) {
    const isAcross = direction === 'across';

    for (let index = 0; index < word.length; index++) {
      const cellRow = isAcross ? row : row + index;
      const cellCol = isAcross ? col + index : col;
      this.grid[cellRow][cellCol] = ' ';
      this.letters[cellRow][cellCol] = word.answer[index];
    }

    this.placedWords.push({
      id: word.id,
      question: word.question,
      answer: word.answer,
      difficulty: word.difficulty,
      row,
      col,
      direction,
      length: word.length,
    });

    return true;
  }

  createSnapshot() {
    const numbered = this.buildNumberedClues();
    const intersections = this.countIntersections();
    const score = this.placedWords.length * 1000 + intersections * 100;

    return {
      grid: this.grid.map((row) => [...row]),
      letters: this.letters.map((row) => [...row]),
      placedWords: this.placedWords.map((word) => ({ ...word })),
      clues: {
        across: numbered.across.map((clue) => ({ ...clue })),
        down: numbered.down.map((clue) => ({ ...clue })),
      },
      cellNumbers: { ...this.cellNumbers },
      nextNumber: this.nextNumber,
      intersections,
      placedCount: this.placedWords.length,
      score,
    };
  }

  restoreSnapshot(snapshot) {
    this.grid = snapshot.grid.map((row) => [...row]);
    this.letters = snapshot.letters.map((row) => [...row]);
    this.placedWords = snapshot.placedWords.map((word) => ({ ...word }));
    this.clues = {
      across: snapshot.clues.across.map((clue) => ({ ...clue })),
      down: snapshot.clues.down.map((clue) => ({ ...clue })),
    };
    this.cellNumbers = { ...snapshot.cellNumbers };
    this.nextNumber = snapshot.nextNumber;
  }

  countIntersections() {
    let intersections = 0;

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        if (!this.letters[row][col]) {
          continue;
        }

        const horizontal = this.hasLetter(row, col - 1) || this.hasLetter(row, col + 1);
        const vertical = this.hasLetter(row - 1, col) || this.hasLetter(row + 1, col);
        if (horizontal && vertical) {
          intersections += 1;
        }
      }
    }

    return intersections;
  }

  buildNumberedClues() {
    this.cellNumbers = {};
    this.nextNumber = 1;

    const byPosition = new Map();
    for (const placedWord of this.placedWords) {
      byPosition.set(`${placedWord.row}-${placedWord.col}-${placedWord.direction}`, placedWord);
    }

    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        if (!this.letters[row][col]) {
          continue;
        }

        const startsAcross = this.hasLetter(row, col) && !this.hasLetter(row, col - 1) && this.hasLetter(row, col + 1);
        const startsDown = this.hasLetter(row, col) && !this.hasLetter(row - 1, col) && this.hasLetter(row + 1, col);
        if (startsAcross || startsDown) {
          this.cellNumbers[`${row}-${col}`] = this.nextNumber;
          this.nextNumber += 1;
        }
      }
    }

    const across = [];
    const down = [];

    for (const placedWord of this.placedWords) {
      const clue = {
        id: placedWord.id,
        number: this.cellNumbers[`${placedWord.row}-${placedWord.col}`],
        clue: placedWord.question,
        answer: placedWord.answer,
        length: placedWord.length,
        direction: placedWord.direction,
        startRow: placedWord.row,
        startCol: placedWord.col,
        difficulty: placedWord.difficulty,
      };

      if (placedWord.direction === 'across') {
        across.push(clue);
      } else {
        down.push(clue);
      }
    }

    across.sort((left, right) => left.number - right.number);
    down.sort((left, right) => left.number - right.number);
    this.clues = { across, down };

    return this.clues;
  }

  getResult() {
    this.buildNumberedClues();

    const emptyCells = this.grid.flat().filter((cell) => cell === ' ').length;
    const totalCells = this.gridSize * this.gridSize;
    const density = (emptyCells / totalCells * 100).toFixed(1);
    const intersections = this.countIntersections();

    console.log(`✅ Placed ${this.placedWords.length}/${this.questions.length} words`);
    console.log(`🔗 ${intersections} intersections created`);
    console.log(`📊 Grid density: ${density}%`);
    console.log(`➡️ Across: ${this.clues.across.length}, ⬇️ Down: ${this.clues.down.length}`);

    return {
      success: this.placedWords.length > 0,
      grid: this.grid,
      letters: this.letters,
      clues: this.clues,
      placedWords: this.placedWords,
      cellNumbers: this.cellNumbers,
      gridSize: this.gridSize,
      placedCount: this.placedWords.length,
      density,
      intersections,
      title: 'COMPILER DESIGN CROSSWORD',
      academyName: 'Three Valley Academy'
    };
  }
}

function generateCrosswordGrid(questions) {
  const generator = new PerfectCrosswordGenerator(questions);
  return generator.generate();
}

// FIXED: Proper grid printing function
function printFormattedGrid(result) {
  console.log("\n" + "═".repeat(result.gridSize * 3 + 2));
  console.log("PERFECT CROSSWORD GRID - READY FOR PLAYERS");
  console.log("═".repeat(result.gridSize * 3 + 2) + "\n");
  
  // Print top border with column numbers
  process.stdout.write("   ");
  for (let col = 0; col < result.gridSize; col++) {
    process.stdout.write(col.toString().padStart(2, ' ') + " ");
  }
  console.log();
  process.stdout.write("  ┌");
  for (let col = 0; col < result.gridSize; col++) {
    process.stdout.write("───");
  }
  process.stdout.write("┐\n");
  
  // Print grid rows
  for (let row = 0; row < result.gridSize; row++) {
    process.stdout.write(row.toString().padStart(2, ' ') + "│");
    
    for (let col = 0; col < result.gridSize; col++) {
      const cellId = `${row}-${col}`;
      const number = result.cellNumbers[cellId];
      
      if (result.grid[row][col] === '#') {
        process.stdout.write("███");
      } else if (number) {
        // Show cell number
        process.stdout.write(number.toString().padStart(2, ' ') + "·");
      } else {
        // Empty cell
        process.stdout.write(" · ");
      }
    }
    process.stdout.write("│" + row.toString().padStart(2, ' ') + "\n");
  }
  
  // Print bottom border
  process.stdout.write("  └");
  for (let col = 0; col < result.gridSize; col++) {
    process.stdout.write("───");
  }
  process.stdout.write("┘\n");
  
  // Print bottom column numbers
  process.stdout.write("   ");
  for (let col = 0; col < result.gridSize; col++) {
    process.stdout.write(col.toString().padStart(2, ' ') + " ");
  }
  console.log();
}

// Print solution grid
function printSolutionGrid(result) {
  console.log("\n" + "═".repeat(result.gridSize * 3 + 2));
  console.log("SOLUTION (For Debugging Only)");
  console.log("═".repeat(result.gridSize * 3 + 2) + "\n");
  
  for (let row = 0; row < result.gridSize; row++) {
    let rowStr = "";
    for (let col = 0; col < result.gridSize; col++) {
      if (result.grid[row][col] === '#') {
        rowStr += "███";
      } else {
        const letter = result.letters[row][col];
        const number = result.cellNumbers[`${row}-${col}`];
        if (number) {
          rowStr += number.toString().padStart(2, '0') + letter;
        } else {
          rowStr += " " + letter + " ";
        }
      }
    }
    console.log(rowStr);
  }
}

// Print word connections
function printWordConnections(result) {
  if (!result.placedWords || result.placedWords.length === 0) {
    console.log("No words placed to show connections.");
    return;
  }
  
  console.log("\n" + "─".repeat(60));
  console.log("WORD INTERSECTIONS & CONNECTIONS");
  console.log("─".repeat(60));
  
  const wordsByDirection = {
    across: result.placedWords.filter(w => w.direction === 'across'),
    down: result.placedWords.filter(w => w.direction === 'down')
  };
  
  console.log("\nACROSS WORDS:");
  wordsByDirection.across.forEach((word, idx) => {
    const intersections = result.placedWords.filter(other => {
      if (other === word) return false;
      if (other.direction === 'across') return false;
      return word.col <= other.col && 
             other.col < word.col + word.length &&
             other.row <= word.row && 
             word.row < other.row + other.length;
    }).map(other => other.answer);
    
    console.log(`${idx + 1}. ${word.answer.padEnd(12)} at (${word.row},${word.col}) → Intersects with: ${intersections.join(', ') || 'None'}`);
  });
  
  console.log("\nDOWN WORDS:");
  wordsByDirection.down.forEach((word, idx) => {
    const intersections = result.placedWords.filter(other => {
      if (other === word) return false;
      if (other.direction === 'down') return false;
      return other.col <= word.col && 
             word.col < other.col + other.length &&
             word.row <= other.row && 
             other.row < word.row + word.length;
    }).map(other => other.answer);
    
    console.log(`${idx + 1}. ${word.answer.padEnd(12)} at (${word.row},${word.col}) → Intersects with: ${intersections.join(', ') || 'None'}`);
  });
  
  console.log(`\n📈 Total intersections: ${result.intersections}`);
  console.log(`🔗 Average connections per word: ${(result.intersections * 2 / result.placedCount).toFixed(1)}`);
}

async function addMoreQuestions() {
  try {
    const connection = await pool.getConnection();
    
    const moreQuestions = [
      { question: "Pattern matching notation for tokens", answer: "REGEX", difficulty: "Hard" },
      { question: "Deterministic Finite Automaton abbreviation", answer: "DFA", difficulty: "Hard" },
      { question: "Record for function calls", answer: "ACTIVATION", difficulty: "Hard" },
      { question: "Loop optimization technique", answer: "UNROLLING", difficulty: "Hard" },
      { question: "Output of syntax analyzer", answer: "PARSETREE", difficulty: "Medium" },
      { question: "Look Ahead Left Right parsing", answer: "LALR", difficulty: "Hard" },
      { question: "Left factoring eliminates", answer: "AMBIGUITY", difficulty: "Medium" },
      { question: "Common subexpression elimination", answer: "CSE", difficulty: "Hard" },
      { question: "Instruction selection part of", answer: "CODEGEN", difficulty: "Hard" },
      { question: "Global data flow analysis", answer: "LIVEVARIABLES", difficulty: "Hard" }
    ];
    
    for (const q of moreQuestions) {
      // ✅ FIXED: Using parameterized query
      await connection.query(
        'INSERT IGNORE INTO crossword_questions (question, answer, difficulty) VALUES (?, ?, ?)',
        [q.question, q.answer, q.difficulty]
      );
    }
    
    connection.release();
    console.log('Added more compiler questions to database');
    
  } catch (error) {
    console.error('Error adding questions:', error);
  }
}

async function checkCrosswordQuestions() {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT COUNT(*) as count FROM crossword_questions');
    connection.release();
    return rows[0].count;
  } catch (error) {
    console.error('Error checking questions:', error);
    return 0;
  }
}

// Main function
async function generateCrosswordFromDB(count = 15) {
  try {
    const questions = await fetchCrosswordQuestions(count);
    
    if (!questions || questions.length === 0) {
      console.error('No questions available');
      return { success: false };
    }
    
    console.log(`\n🎯 GENERATING PERFECT CROSSWORD...`);
    console.log(`📚 Using ${questions.length} questions`);
    
    const result = generateCrosswordGrid(questions);
    
    if (!result.success) {
      console.error('Failed to generate crossword');
      return result;
    }
    
    // Display results
    printFormattedGrid(result);
    printSolutionGrid(result);
    printWordConnections(result);
    
    // Show clues
    console.log("\n" + "═".repeat(60));
    console.log("ACROSS CLUES:");
    console.log("═".repeat(60));
    result.clues.across.forEach(clue => {
      console.log(`${clue.number}. ${clue.clue} (${clue.length} letters)`);
    });
    
    console.log("\n" + "═".repeat(60));
    console.log("DOWN CLUES:");
    console.log("═".repeat(60));
    result.clues.down.forEach(clue => {
      console.log(`${clue.number}. ${clue.clue} (${clue.length} letters)`);
    });
    
    console.log("\n" + "🎯".repeat(30));
    console.log(`✅ SUCCESS! Placed ${result.placedCount} words`);
    console.log(`🔗 ${result.intersections} intersections`);
    console.log(`📊 ${result.density}% grid density`);
    console.log(`🏆 ${result.academyName} - ${result.title}`);
    console.log("🎯".repeat(30));
    
    return result;
    
  } catch (error) {
    console.error('Error generating crossword:', error);
    return { success: false, error: error.message };
  }
}

// Function for frontend
async function getCrosswordForFrontend(count = 15) {
  try {
    const result = await generateCrosswordFromDB(count);
    
    if (!result.success) {
      return {
        success: false,
        error: "Failed to generate crossword"
      };
    }
    
    // Format for frontend
    const frontendGrid = result.grid.map((row, rowIndex) => 
      row.map((cell, colIndex) => {
        const cellId = `${rowIndex}-${colIndex}`;
        return {
          value: '',
          blocked: cell === '#',
          number: result.cellNumbers[cellId] || null,
          row: rowIndex,
          col: colIndex
        };
      })
    );
    
    return {
      success: true,
      grid: frontendGrid,
      clues: {
        across: result.clues.across.map(clue => ({
          number: clue.number,
          clue: clue.clue,
          length: clue.length,
          answer: clue.answer,
          difficulty: clue.difficulty
        })),
        down: result.clues.down.map(clue => ({
          number: clue.number,
          clue: clue.clue,
          length: clue.length,
          answer: clue.answer,
          difficulty: clue.difficulty
        }))
      },
      metadata: {
        title: result.title,
        academyName: result.academyName,
        gridSize: result.gridSize,
        placedCount: result.placedCount,
        density: result.density,
        intersections: result.intersections,
        generatedAt: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('Error getting crossword for frontend:', error);
    return {
      success: false,
      error: "Internal server error"
    };
  }
}

// Run test
if (require.main === module) {
  console.log("🚀 ULTIMATE PERFECT CROSSWORD GENERATOR");
  console.log("=".repeat(50) + "\n");
  
  (async () => {
    try {
      const count = await checkCrosswordQuestions();
      console.log(`📊 Database has ${count} questions`);
      
      if (count < 20) {
        console.log('➕ Adding more questions for better generation...');
        await addMoreQuestions();
      }
      
      console.log('\n🔧 Generating the PERFECT crossword...\n');
      const result = await generateCrosswordFromDB(15);
      
      if (result.success) {
        console.log("\n" + "⭐".repeat(50));
        console.log("FRONTEND DATA READY!");
        console.log("⭐".repeat(50));
        
        const frontendData = await getCrosswordForFrontend(15);
        console.log(`✅ Success: ${frontendData.success}`);
        console.log(`📐 Grid: ${frontendData.grid?.length || 0}x${frontendData.grid?.[0]?.length || 0}`);
        console.log(`📝 Across clues: ${frontendData.clues?.across?.length || 0}`);
        console.log(`📝 Down clues: ${frontendData.clues?.down?.length || 0}`);
        console.log(`🎯 Intersections: ${frontendData.metadata?.intersections || 0}`);
      } else {
        console.error('❌ Failed to generate crossword');
      }
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    }
  })();
}

module.exports = {
  generateCrosswordGrid,
  generateCrosswordFromDB,
  getCrosswordForFrontend,
  addMoreQuestions,
  checkCrosswordQuestions,
  fetchCrosswordQuestions,
  printFormattedGrid,
  printSolutionGrid,
  printWordConnections,
  pool
};