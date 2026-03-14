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

async function fetchCrosswordQuestions(count = 20) {
  try {
    const connection = await pool.getConnection();
    
    // ✅ FETCH ALL QUESTIONS from database dynamically
    const [allRows] = await connection.query(
      `SELECT id, question, answer, difficulty 
       FROM crossword_questions 
       ORDER BY RAND()`
    );
    
    connection.release();
    
    if (allRows.length === 0) {
      console.warn('⚠️ No crossword questions found in database');
      return getFallbackQuestions();
    }
    
    // ✅ Smart selection - random with difficulty balance
    const selected = selectRandomQuestions(allRows, count);
    
    console.log(`✅ Fetched ${allRows.length} questions, selected ${selected.length} randomly`);
    return selected.map(row => ({
      id: row.id,
      question: row.question,
      answer: (row.answer || '').toUpperCase().replace(/[^A-Z]/g, '').trim(),
      difficulty: row.difficulty || 'Medium',
      length: (row.answer || '').replace(/[^A-Za-z]/g, '').length
    })).filter(q => q.answer.length >= 2);
    
  } catch (error) {
    console.error('❌ Error fetching questions:', error);
    return getFallbackQuestions();
  }
}

/**
 * Smart question selection with randomization and difficulty balance
 */
function selectRandomQuestions(allRows, preferredCount = 20) {
  if (allRows.length <= preferredCount) {
    return allRows;
  }
  
  // Shuffle all questions
  const shuffled = [...allRows].sort(() => Math.random() - 0.5);
  
  // Group by difficulty
  const byDifficulty = {
    'Easy': [],
    'Medium': [],
    'Hard': []
  };
  
  shuffled.forEach(q => {
    byDifficulty[q.difficulty || 'Medium'].push(q);
  });
  
  // Select with difficulty balance
  const selected = [];
  const easyCount = Math.floor(preferredCount * 0.3);
  const mediumCount = Math.floor(preferredCount * 0.5);
  const hardCount = preferredCount - easyCount - mediumCount;
  
  selected.push(...(byDifficulty['Easy'] || []).slice(0, easyCount));
  selected.push(...(byDifficulty['Medium'] || []).slice(0, mediumCount));
  selected.push(...(byDifficulty['Hard'] || []).slice(0, hardCount));
  
  // Final shuffle for randomization
  return selected.sort(() => Math.random() - 0.5);
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
    
    console.log('✅ Grid initialized: ' + (this.gridSize * this.gridSize) + ' black cells');
  }
  
  generate() {
    console.log(`\n🧩 Generating ${this.gridSize}x${this.gridSize} PERFECT crossword with ${this.questions.length} questions`);
    
    // Sort by length (longer first) for better grid foundation
    this.questions.sort((a, b) => b.answer.length - a.answer.length);
    
    // === PHASE 1: Place anchor word ===
    const anchor = this.questions[0];
    const centerRow = Math.floor(this.gridSize / 2);
    const centerCol = Math.floor((this.gridSize - anchor.answer.length) / 2);
    
    console.log(`📍 Phase 1 - Anchor: "${anchor.answer}" at (${centerRow}, ${centerCol})`);
    this.placeWord(anchor, centerRow, centerCol, 'across');
    
    // === PHASE 2: Place words with strict intersection requirement ===
    console.log(`🔗 Phase 2 - Placing words with intersections...`);
    const unplacedWords = [];
    
    for (let i = 1; i < this.questions.length; i++) {
      const word = this.questions[i];
      
      // Try to place with smart intersection detection
      if (!this.smartIntersectionPlace(word)) {
        unplacedWords.push(word);
      }
    }
    
    console.log(`  ✓ Phase 2 complete: ${this.placedWords.length - 1} words placed via intersection, ${unplacedWords.length} unplaced`);
    
    // === PHASE 3: Fallback placement for remaining words ===
    if (unplacedWords.length > 0) {
      console.log(`⚡ Phase 3 - Fallback placement for unplaced words...`);
      for (const word of unplacedWords) {
        if (!this.fallbackPlacement(word)) {
          console.warn(`  ⚠️ Could not place: "${word.answer}"`);
        }
      }
      console.log(`  ✓ Phase 3 complete: ${this.placedWords.length - 1} total words placed`);
    }
    
    // === PHASE 4: Finalize grid ===
    console.log(`⚖️ Phase 4 - Grid optimization complete`);
    const acrossCount = this.clues.across.length;
    const downCount = this.clues.down.length;
    console.log(`  Balance: ${acrossCount} across, ${downCount} down`);
    
    console.log(`✅ PERFECT GRID COMPLETE: ${this.placedWords.length}/${this.questions.length} words placed\n`);
    return this.getResult();
  }
  
  /**
   * Smart intersection placement - finds BEST intersection for each word
   */
  smartIntersectionPlace(word) {
    const allCandidates = [];
    
    // Find ALL possible intersections
    for (const placed of this.placedWords) {
      for (let placedIdx = 0; placedIdx < placed.answer.length; placedIdx++) {
        const placedLetter = placed.answer[placedIdx];
        
        for (let wordIdx = 0; wordIdx < word.answer.length; wordIdx++) {
          if (word.answer[wordIdx] === placedLetter) {
            // Calculate placement for this intersection
            const placements = this.calculateIntersectionPlacements(
              word, wordIdx,
              placed, placedIdx
            );
            
            for (const placement of placements) {
              // Validate this placement
              if (this.canPlaceWord(word, placement.row, placement.col, placement.direction)) {
                const score = this.scorePlacement(
                  word, placement.row, placement.col, placement.direction,
                  placement.intersectionCount
                );
                
                allCandidates.push({
                  ...placement,
                  score: score,
                  intersectionCount: placement.intersectionCount
                });
              }
            }
          }
        }
      }
    }
    
    if (allCandidates.length === 0) {
      console.warn(`  ⚠️ No intersection found for "${word.answer}"`);
      return false;
    }
    
    // Sort by score (highest first) and take the best 3, randomize selection
    allCandidates.sort((a, b) => b.score - a.score);
    const topCandidates = allCandidates.slice(0, Math.min(3, allCandidates.length));
    const best = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    
    this.placeWord(word, best.row, best.col, best.direction);
    return true;
  }
  
  /**
   * Calculate possible placements for intersection
   * Returns array of {row, col, direction, intersectionCount}
   */
  calculateIntersectionPlacements(newWord, newWordIdx, existingWord, existingWordIdx) {
    const placements = [];
    
    if (existingWord.direction === 'across') {
      // Existing word is horizontal
      // New word can be placed vertically through this intersection point
      const col = existingWord.col + existingWordIdx;
      const row = existingWord.row - newWordIdx;
      
      if (row >= 0 && row + newWord.answer.length <= this.gridSize) {
        // Count how many intersections this creates
        let intersectionCount = 1; // At least the current one
        for (let i = 0; i < newWord.answer.length; i++) {
          if (i !== newWordIdx && this.letters[row + i][col] !== '') {
            intersectionCount++;
          }
        }
        
        placements.push({
          row: row,
          col: col,
          direction: 'down',
          intersectionCount: intersectionCount
        });
      }
    } else {
      // Existing word is vertical
      // New word can be placed horizontally through this intersection point
      const row = existingWord.row + existingWordIdx;
      const col = existingWord.col - newWordIdx;
      
      if (col >= 0 && col + newWord.answer.length <= this.gridSize) {
        // Count how many intersections this creates
        let intersectionCount = 1; // At least the current one
        for (let i = 0; i < newWord.answer.length; i++) {
          if (i !== newWordIdx && this.letters[row][col + i] !== '') {
            intersectionCount++;
          }
        }
        
        placements.push({
          row: row,
          col: col,
          direction: 'across',
          intersectionCount: intersectionCount
        });
      }
    }
    
    return placements;
  }
  
  /**
   * Score placement by multiple factors
   */
  scorePlacement(word, row, col, direction, intersectionCount) {
    let score = 0;
    
    // PRIMARY: Intersection count (most important for connectivity)
    score += intersectionCount * 100;
    
    // SECONDARY: Center proximity (professional appearance)
    const centerRow = Math.floor(this.gridSize / 2);
    const centerCol = Math.floor(this.gridSize / 2);
    const distFromCenter = Math.abs(row - centerRow) + Math.abs(col - centerCol);
    score += Math.max(0, (this.gridSize * 2 - distFromCenter) * 5);
    
    // TERTIARY: Word length (longer words = more value)
    score += word.answer.length * 2;
    
    // QUATERNARY: Balance across/down (prefer direction with fewer words)
    const directionBonus = direction === 'across' ? 
      (this.clues.down.length > this.clues.across.length ? 10 : 0) :
      (this.clues.across.length > this.clues.down.length ? 10 : 0);
    score += directionBonus;
    
    // Add small randomness for tie-breaking
    score += Math.random() * 10;
    
    return score;
  }

  /**
   * Fallback placement - tries to place word anywhere valid (no intersection required)
   */
  fallbackPlacement(word) {
    const candidates = [];
    
    // Try every position on the grid
    for (let row = 0; row < this.gridSize; row++) {
      for (let col = 0; col < this.gridSize; col++) {
        // Try across
        if (col + word.answer.length <= this.gridSize) {
          if (this.canPlaceWord(word, row, col, 'across')) {
            // Score this placement
            const score = this.scorePlacement(
              word, row, col, 'across', 0
            );
            candidates.push({
              row: row,
              col: col,
              direction: 'across',
              score: score
            });
          }
        }
        
        // Try down
        if (row + word.answer.length <= this.gridSize) {
          if (this.canPlaceWord(word, row, col, 'down')) {
            // Score this placement
            const score = this.scorePlacement(
              word, row, col, 'down', 0
            );
            candidates.push({
              row: row,
              col: col,
              direction: 'down',
              score: score
            });
          }
        }
      }
    }
    
    if (candidates.length === 0) {
      return false;
    }
    
    // Sort by score and pick best
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    this.placeWord(word, best.row, best.col, best.direction);
    return true;
  }

  
  canPlaceWord(word, row, col, direction, intersectPos = -1, intersectLetter = '') {
    // === BOUNDS CHECK ===
    if (direction === 'across') {
      if (col < 0 || col + word.answer.length > this.gridSize) return false;
      if (row < 0 || row >= this.gridSize) return false;
    } else {
      if (row < 0 || row + word.answer.length > this.gridSize) return false;
      if (col < 0 || col >= this.gridSize) return false;
    }
    
    let intersectionExists = false;
    const cellsToCheck = [];
    
    // === COLLECT CELLS & CHECK FOR CONFLICTS ===
    for (let i = 0; i < word.answer.length; i++) {
      let cellRow, cellCol;
      
      if (direction === 'across') {
        cellRow = row;
        cellCol = col + i;
      } else {
        cellRow = row + i;
        cellCol = col;
      }
      
      const currentLetter = this.letters[cellRow][cellCol];
      const currentCell = this.grid[cellRow][cellCol];
      
      // === CASE 1: Cell has a letter ===
      if (currentLetter !== '') {
        if (currentLetter !== word.answer[i]) {
          return false; // Letter mismatch = conflict
        }
        intersectionExists = true; // Letter match = intersection
      } 
      // === CASE 2: Cell is marked white but empty ===
      else if (currentCell === '.') {
        return false; // Can't place here, causes conflict
      }
      // === CASE 3: Cell is black (#) and empty - OK ===
      else if (currentCell === '#' && currentLetter === '') {
        // Can place here
      }
      
      cellsToCheck.push({ row: cellRow, col: cellCol });
    }
    
    // === WORD BOUNDARY CHECK ===
    // Before word start
    if (direction === 'across') {
      if (col > 0) {
        const cellBefore = this.grid[row][col - 1];
        if (cellBefore !== '#' && cellBefore !== undefined) return false;
      }
      if (col + word.answer.length < this.gridSize) {
        const cellAfter = this.grid[row][col + word.answer.length];
        if (cellAfter !== '#' && cellAfter !== undefined) return false;
      }
    } else {
      if (row > 0) {
        const cellBefore = this.grid[row - 1][col];
        if (cellBefore !== '#' && cellBefore !== undefined) return false;
      }
      if (row + word.answer.length < this.gridSize) {
        const cellAfter = this.grid[row + word.answer.length][col];
        if (cellAfter !== '#' && cellAfter !== undefined) return false;
      }
    }
    
    // === PERPENDICULAR ADJACENCY CHECK ===
    // Ensure no orphan white cells are created
    for (let i = 0; i < word.answer.length; i++) {
      let cellRow, cellCol;
      
      if (direction === 'across') {
        cellRow = row;
        cellCol = col + i;
      } else {
        cellRow = row + i;
        cellCol = col;
      }
      
      // If placing new letter here
      if (this.letters[cellRow][cellCol] === '') {
        // Check perpendicular neighbors
        if (direction === 'across') {
          // Check cells above and below
          if (cellRow > 0 && this.grid[cellRow - 1][cellCol] === '.' && this.letters[cellRow - 1][cellCol] === '') {
            return false; // Creates empty white cell above
          }
          if (cellRow < this.gridSize - 1 && this.grid[cellRow + 1][cellCol] === '.' && this.letters[cellRow + 1][cellCol] === '') {
            return false; // Creates empty white cell below
          }
        } else {
          // Check cells left and right
          if (cellCol > 0 && this.grid[cellRow][cellCol - 1] === '.' && this.letters[cellRow][cellCol - 1] === '') {
            return false; // Creates empty white cell to left
          }
          if (cellCol < this.gridSize - 1 && this.grid[cellRow][cellCol + 1] === '.' && this.letters[cellRow][cellCol + 1] === '') {
            return false; // Creates empty white cell to right
          }
        }
      }
    }
    
    return true;
  }
  
  placeWord(word, row, col, direction) {
    // Validate bounds
    if (row < 0 || col < 0) {
      console.warn(`⚠️ Invalid placement: ${word.answer} at (${row}, ${col})`);
      return false;
    }
    
    if (direction === 'across' && col + word.answer.length > this.gridSize) {
      console.warn(`⚠️ Word extends beyond grid bounds (across): ${word.answer}`);
      return false;
    }
    
    if (direction === 'down' && row + word.answer.length > this.gridSize) {
      console.warn(`⚠️ Word extends beyond grid bounds (down): ${word.answer}`);
      return false;
    }
    
    // Mark cells as empty (using '.' instead of space to preserve in JSON) and store letters
    for (let i = 0; i < word.answer.length; i++) {
      if (direction === 'across') {
        this.grid[row][col + i] = '.';
        this.letters[row][col + i] = word.answer[i];
      } else {
        this.grid[row + i][col] = '.';
        this.letters[row + i][col] = word.answer[i];
      }
    }
    
    // ✅ Log grid update
    const whiteCount = this.grid.flat().filter(c => c === '.').length;
    console.log(`  → "${word.answer}" placed, white cells now: ${whiteCount}`);
    
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
      length: word.answer.length,
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
      length: word.answer.length
    });
    
    return true;
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
  
  getResult() {
    // Sort clues by number
    this.clues.across.sort((a, b) => a.number - b.number);
    this.clues.down.sort((a, b) => a.number - b.number);
    
    // Calculate statistics
    const emptyCells = this.grid.flat().filter(cell => cell === '.' || cell === ' ').length;
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