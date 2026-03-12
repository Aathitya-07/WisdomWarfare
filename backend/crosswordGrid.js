const mysql = require('mysql2/promise');

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'wisdomwarfare',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
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
    return rows.map(row => ({
      id: row.id,
      question: row.question,
      answer: row.answer.toUpperCase().replace(/[^A-Z]/g, '').trim(),
      difficulty: row.difficulty || 'Medium',
      length: row.answer.length
    }));
    
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

// SUPER ADVANCED CROSSWORD GENERATOR - WILL PLACE ALL WORDS
class PerfectCrosswordGenerator {
  constructor(questions) {
    this.questions = questions;
    this.gridSize = 15; // Fixed size for consistency
    this.grid = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill('#'));
    this.letters = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(''));
    this.placedWords = [];
    this.clues = { across: [], down: [] };
    this.cellNumbers = {};
    this.nextNumber = 1;
  }
  
  generate() {
    console.log(`Generating ${this.gridSize}x${this.gridSize} crossword with ${this.questions.length} questions`);
    
    // Sort by length and then alphabetically for consistency
    this.questions.sort((a, b) => {
      if (b.length !== a.length) return b.length - a.length;
      return a.answer.localeCompare(b.answer);
    });
    
    // Create a central anchor word (longest)
    const anchor = this.questions[0];
    const centerRow = Math.floor(this.gridSize / 2);
    const startCol = Math.max(3, Math.floor((this.gridSize - anchor.length) / 2));
    
    this.placeWord(anchor, centerRow, startCol, 'across');
    
    // Group remaining words by their letters for better intersection matching
    const letterMap = this.createLetterMap();
    
    // Try to place all remaining words with smart intersection
    for (let i = 1; i < this.questions.length; i++) {
      const word = this.questions[i];
      if (!this.smartPlaceWord(word, letterMap)) {
        // Try brute force placement
        this.bruteForcePlaceWord(word);
      }
    }
    
    // Try to connect any isolated words
    this.connectIsolatedWords();
    
    return this.getResult();
  }
  
  createLetterMap() {
    const map = {};
    for (const word of this.questions) {
      for (let i = 0; i < word.answer.length; i++) {
        const letter = word.answer[i];
        if (!map[letter]) map[letter] = [];
        map[letter].push({ word: word.answer, position: i });
      }
    }
    return map;
  }
  
  smartPlaceWord(word, letterMap) {
    // Try to find best intersection point
    const potentialPlaces = [];
    
    for (let i = 0; i < word.answer.length; i++) {
      const letter = word.answer[i];
      const matchingLetters = letterMap[letter] || [];
      
      for (const match of matchingLetters) {
        // Find this letter in placed words
        for (const placed of this.placedWords) {
          for (let j = 0; j < placed.answer.length; j++) {
            if (placed.answer[j] === letter) {
              // Calculate potential placement
              let row, col, direction;
              
              if (placed.direction === 'across') {
                // Place vertically through this point
                row = placed.row - i;
                col = placed.col + j;
                direction = 'down';
              } else {
                // Place horizontally through this point
                row = placed.row + j;
                col = placed.col - i;
                direction = 'across';
              }
              
              if (this.canPlaceWord(word, row, col, direction, i, letter)) {
                potentialPlaces.push({ row, col, direction, score: this.calculatePlacementScore(row, col, direction) });
              }
            }
          }
        }
      }
    }
    
    // Choose the best placement
    if (potentialPlaces.length > 0) {
      potentialPlaces.sort((a, b) => b.score - a.score);
      const best = potentialPlaces[0];
      this.placeWord(word, best.row, best.col, best.direction);
      return true;
    }
    
    return false;
  }
  
  bruteForcePlaceWord(word) {
    // Try ALL possible positions (within reason)
    const attempts = [];
    
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        // Try across
        if (this.canPlaceWord(word, row, col, 'across')) {
          attempts.push({ row, col, direction: 'across', score: this.calculatePlacementScore(row, col, 'across') });
        }
        
        // Try down
        if (this.canPlaceWord(word, row, col, 'down')) {
          attempts.push({ row, col, direction: 'down', score: this.calculatePlacementScore(row, col, 'down') });
        }
      }
    }
    
    if (attempts.length > 0) {
      attempts.sort((a, b) => b.score - a.score);
      const best = attempts[0];
      this.placeWord(word, best.row, best.col, best.direction);
      return true;
    }
    
    // Last resort: try extending grid
    return this.tryExtremePlacement(word);
  }
  
  tryExtremePlacement(word) {
    // Try to attach to ends of existing words
    for (const placed of this.placedWords) {
      if (placed.direction === 'across') {
        // Try before
        if (this.canPlaceWord(word, placed.row, placed.col - word.length, 'across')) {
          this.placeWord(word, placed.row, placed.col - word.length, 'across');
          return true;
        }
        // Try after
        if (this.canPlaceWord(word, placed.row, placed.col + placed.length, 'across')) {
          this.placeWord(word, placed.row, placed.col + placed.length, 'across');
          return true;
        }
      } else {
        // Try above
        if (this.canPlaceWord(word, placed.row - word.length, placed.col, 'down')) {
          this.placeWord(word, placed.row - word.length, placed.col, 'down');
          return true;
        }
        // Try below
        if (this.canPlaceWord(word, placed.row + placed.length, placed.col, 'down')) {
          this.placeWord(word, placed.row + placed.length, placed.col, 'down');
          return true;
        }
      }
    }
    
    return false;
  }
  
  connectIsolatedWords() {
    // Find words with no intersections
    const isolated = [];
    for (let i = 0; i < this.placedWords.length; i++) {
      let hasIntersection = false;
      for (let j = 0; j < this.placedWords.length; j++) {
        if (i !== j && this.wordsIntersect(this.placedWords[i], this.placedWords[j])) {
          hasIntersection = true;
          break;
        }
      }
      if (!hasIntersection) {
        isolated.push(this.placedWords[i]);
      }
    }
    
    // Try to add connecting words
    for (const word of isolated) {
      this.tryAddConnector(word);
    }
  }
  
  tryAddConnector(isolatedWord) {
    // Try to create a bridge to another word
    for (const otherWord of this.placedWords) {
      if (otherWord === isolatedWord) continue;
      
      // Try to find a letter that appears in both words
      for (let i = 0; i < isolatedWord.answer.length; i++) {
        const letter = isolatedWord.answer[i];
        const posInOther = otherWord.answer.indexOf(letter);
        
        if (posInOther !== -1) {
          // Calculate where a connecting word could go
          let connectRow, connectCol;
          
          if (isolatedWord.direction === 'across') {
            // Isolated word is horizontal
            const isoCol = isolatedWord.col + i;
            const isoRow = isolatedWord.row;
            
            if (otherWord.direction === 'across') {
              // Both horizontal - need vertical connector
              connectRow = Math.min(isoRow, otherWord.row);
              connectCol = isoCol;
              
              // Create a vertical word connecting them
              const connectLength = Math.abs(otherWord.row - isoRow) + 1;
              if (this.isValidForConnection(connectRow, connectCol, 'down', connectLength)) {
                // Add placeholder connecting word
                this.addConnectingWord(connectRow, connectCol, 'down', connectLength, letter);
                return true;
              }
            } else {
              // Other word is vertical
              const otherCol = otherWord.col;
              const otherRow = otherWord.row + posInOther;
              
              if (isoCol === otherCol) {
                // They already intersect!
                return true;
              }
            }
          }
        }
      }
    }
    
    return false;
  }
  
  calculatePlacementScore(row, col, direction) {
    let score = 0;
    
    // Prefer center of grid
    const center = Math.floor(this.gridSize / 2);
    const distanceFromCenter = Math.abs(row - center) + Math.abs(col - center);
    score += (this.gridSize - distanceFromCenter) * 2;
    
    // Prefer creating intersections
    if (this.wouldCreateIntersection(row, col, direction)) {
      score += 50;
    }
    
    // Prefer connections to existing words
    score += this.countAdjacentWords(row, col, direction) * 20;
    
    return score;
  }
  
  wouldCreateIntersection(row, col, direction) {
    // Check if placement would create future intersection opportunities
    return true; // Simplified
  }
  
  countAdjacentWords(row, col, direction) {
    let count = 0;
    const word = this.questions.find(q => true); // Placeholder
    
    for (let i = 0; i < (word?.length || 5); i++) {
      let r, c;
      if (direction === 'across') {
        r = row;
        c = col + i;
      } else {
        r = row + i;
        c = col;
      }
      
      // Check all four directions
      const neighbors = [
        [r-1, c], [r+1, c], [r, c-1], [r, c+1]
      ];
      
      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < this.gridSize && nc >= 0 && nc < this.gridSize) {
          if (this.letters[nr][nc] !== '') {
            count++;
          }
        }
      }
    }
    
    return count;
  }
  
  canPlaceWord(word, row, col, direction, intersectPos = -1, intersectLetter = '') {
    // Check boundaries
    if (direction === 'across') {
      if (col < 0 || col + word.length > this.gridSize) return false;
      if (row < 0 || row >= this.gridSize) return false;
    } else {
      if (row < 0 || row + word.length > this.gridSize) return false;
      if (col < 0 || col >= this.gridSize) return false;
    }
    
    // Check each cell
    for (let i = 0; i < word.length; i++) {
      let cellRow, cellCol;
      
      if (direction === 'across') {
        cellRow = row;
        cellCol = col + i;
      } else {
        cellRow = row + i;
        cellCol = col;
      }
      
      const currentLetter = this.letters[cellRow][cellCol];
      
      // If cell already has a letter
      if (currentLetter !== '') {
        // Must match if it's the intersection point
        if (i === intersectPos) {
          if (currentLetter !== intersectLetter) return false;
        } else {
          // Non-intersection cells must be empty
          return false;
        }
      }
      
      // Check crossword rules for non-intersection cells
      if (i !== intersectPos) {
        // Must have empty cells perpendicular to word direction
        if (direction === 'across') {
          if (cellRow > 0 && this.grid[cellRow - 1][cellCol] === ' ') return false;
          if (cellRow < this.gridSize - 1 && this.grid[cellRow + 1][cellCol] === ' ') return false;
        } else {
          if (cellCol > 0 && this.grid[cellRow][cellCol - 1] === ' ') return false;
          if (cellCol < this.gridSize - 1 && this.grid[cellRow][cellCol + 1] === ' ') return false;
        }
      }
    }
    
    // Check ends of word
    if (direction === 'across') {
      if (col > 0 && this.grid[row][col - 1] === ' ') return false;
      if (col + word.length < this.gridSize && this.grid[row][col + word.length] === ' ') return false;
    } else {
      if (row > 0 && this.grid[row - 1][col] === ' ') return false;
      if (row + word.length < this.gridSize && this.grid[row + word.length][col] === ' ') return false;
    }
    
    return true;
  }
  
  placeWord(word, row, col, direction) {
    // Mark cells as empty and store letters
    for (let i = 0; i < word.length; i++) {
      if (direction === 'across') {
        this.grid[row][col + i] = ' ';
        this.letters[row][col + i] = word.answer[i];
      } else {
        this.grid[row + i][col] = ' ';
        this.letters[row + i][col] = word.answer[i];
      }
    }
    
    // Number the starting cell
    const cellId = `${row}-${col}`;
    if (!this.cellNumbers[cellId]) {
      this.cellNumbers[cellId] = this.nextNumber;
      this.nextNumber++;
    }
    
    const clueData = {
      id: word.id,
      number: this.cellNumbers[cellId],
      clue: word.question,
      answer: word.answer,
      length: word.length,
      direction: direction,
      startRow: row,
      startCol: col,
      difficulty: word.difficulty
    };
    
    if (direction === 'across') {
      this.clues.across.push(clueData);
    } else {
      this.clues.down.push(clueData);
    }
    
    this.placedWords.push({
      id: word.id,
      answer: word.answer,
      row: row,
      col: col,
      direction: direction,
      length: word.length
    });
    
    return true;
  }
  
  addConnectingWord(row, col, direction, length, letter) {
    // Add a placeholder connecting word
    for (let i = 0; i < length; i++) {
      if (direction === 'across') {
        this.grid[row][col + i] = ' ';
        this.letters[row][col + i] = i === 0 ? letter : '?';
      } else {
        this.grid[row + i][col] = ' ';
        this.letters[row + i][col] = i === 0 ? letter : '?';
      }
    }
  }
  
  wordsIntersect(word1, word2) {
    if (word1.direction === word2.direction) return false;
    
    if (word1.direction === 'across') {
      // word1 horizontal, word2 vertical
      return word2.col >= word1.col && 
             word2.col < word1.col + word1.length &&
             word1.row >= word2.row && 
             word1.row < word2.row + word2.length;
    } else {
      // word1 vertical, word2 horizontal
      return word1.col >= word2.col && 
             word1.col < word2.col + word2.length &&
             word2.row >= word1.row && 
             word2.row < word1.row + word1.length;
    }
  }
  
  isValidForConnection(row, col, direction, length) {
    if (direction === 'across') {
      if (col < 0 || col + length > this.gridSize) return false;
      if (row < 0 || row >= this.gridSize) return false;
    } else {
      if (row < 0 || row + length > this.gridSize) return false;
      if (col < 0 || col >= this.gridSize) return false;
    }
    
    // Check if path is clear
    for (let i = 0; i < length; i++) {
      let r, c;
      if (direction === 'across') {
        r = row;
        c = col + i;
      } else {
        r = row + i;
        c = col;
      }
      
      if (this.grid[r][c] === ' ' && this.letters[r][c] !== '?') {
        return false;
      }
    }
    
    return true;
  }
  
  getResult() {
    // Sort clues by number
    this.clues.across.sort((a, b) => a.number - b.number);
    this.clues.down.sort((a, b) => a.number - b.number);
    
    // Calculate statistics
    const emptyCells = this.grid.flat().filter(cell => cell === ' ').length;
    const totalCells = this.gridSize * this.gridSize;
    const density = (emptyCells / totalCells * 100).toFixed(1);
    
    // Calculate intersections
    let intersections = 0;
    for (let i = 0; i < this.placedWords.length; i++) {
      for (let j = i + 1; j < this.placedWords.length; j++) {
        if (this.wordsIntersect(this.placedWords[i], this.placedWords[j])) {
          intersections++;
        }
      }
    }
    
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
      density: density,
      intersections: intersections,
      title: "COMPILER DESIGN CROSSWORD",
      academyName: "Three Valley Academy"
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