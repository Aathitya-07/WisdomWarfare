// test-crosswordgrid.js - PROPER CROSSWORD LAYOUT WITH INTERSECTIONS
console.log("🚀 Creating Proper Crossword with Intersections...");

// ==============================================
// IMPROVED CROSSWORD GENERATOR WITH REAL INTERSECTIONS
// ==============================================
function generateCrosswordGrid(questions, gridSize = 15) {
    try {
        console.log("🧠 Creating crossword with proper intersections...");
        
        // Prepare words
        const words = questions.map(q => ({
            id: q.id,
            word: q.answer.toUpperCase().trim(),
            clue: q.question,
            length: q.answer.length,
            placed: false,
            direction: null
        }));
        
        // Filter and sort by length (longest first)
        const validWords = words.filter(w => w.length <= gridSize && w.length > 1);
        if (validWords.length === 0) throw new Error("No valid words");
        
        const sortedWords = [...validWords].sort((a, b) => b.length - a.length);
        
        console.log("\n🔤 Words to place:");
        sortedWords.forEach((w, i) => console.log(`${i+1}. ${w.word} (${w.length})`));
        
        // Initialize grid
        const grid = Array(gridSize).fill().map(() => 
            Array(gridSize).fill().map(() => ({
                letter: '',
                isBlack: false,
                hasLetter: false,
                number: 0,
                acrossWord: null,
                downWord: null
            }))
        );
        
        const placedWords = [];
        let clueNumber = 1;
        
        // Helper functions
        function isValidPosition(row, col) {
            return row >= 0 && row < gridSize && col >= 0 && col < gridSize;
        }
        
        // Check if we can place a word with proper crossword rules
        function canPlaceWord(word, row, col, direction, mustIntersect = true) {
            const wordLength = word.word.length;
            let intersects = false;
            
            // Check bounds
            if (direction === 'across' && col + wordLength > gridSize) return false;
            if (direction === 'down' && row + wordLength > gridSize) return false;
            
            // Check each cell
            for (let i = 0; i < wordLength; i++) {
                const r = direction === 'across' ? row : row + i;
                const c = direction === 'across' ? col + i : col;
                
                if (!isValidPosition(r, c)) return false;
                
                const cell = grid[r][c];
                const letter = word.word[i];
                
                // Can't place on black squares
                if (cell.isBlack) return false;
                
                // If cell already has a letter
                if (cell.hasLetter) {
                    // Must match existing letter
                    if (cell.letter !== letter) return false;
                    // This is an intersection point
                    intersects = true;
                    
                    // Check if this creates a valid intersection
                    if (direction === 'across') {
                        // For across word, check if there's already a down word here
                        if (cell.downWord) {
                            // Good intersection
                        }
                    } else {
                        // For down word, check if there's already an across word here
                        if (cell.acrossWord) {
                            // Good intersection
                        }
                    }
                } else {
                    // Empty cell - check crossword rules
                    if (direction === 'across') {
                        // For across words, cells above and below should not form unintended words
                        // Check above
                        if (isValidPosition(r-1, c) && grid[r-1][c].hasLetter) {
                            // Would create a perpendicular connection - this is OK for intersections
                        }
                        // Check below
                        if (isValidPosition(r+1, c) && grid[r+1][c].hasLetter) {
                            // Would create a perpendicular connection
                        }
                    } else {
                        // For down words, check left and right
                        if (isValidPosition(r, c-1) && grid[r][c-1].hasLetter) {
                            // OK for intersections
                        }
                        if (isValidPosition(r, c+1) && grid[r][c+1].hasLetter) {
                            // OK for intersections
                        }
                    }
                }
            }
            
            // Check start and end boundaries
            if (direction === 'across') {
                // Cell before start should not have a letter (unless it's black)
                if (col > 0 && grid[row][col-1].hasLetter) return false;
                // Cell after end should not have a letter
                if (col + wordLength < gridSize && grid[row][col + wordLength].hasLetter) return false;
            } else {
                if (row > 0 && grid[row-1][col].hasLetter) return false;
                if (row + wordLength < gridSize && grid[row + wordLength][col].hasLetter) return false;
            }
            
            // If we require intersection but don't have one, check if it's the first word
            if (mustIntersect && placedWords.length > 0 && !intersects) {
                return false;
            }
            
            return true;
        }
        
        // Place word on grid
        function placeWord(word, row, col, direction) {
            const wordLength = word.word.length;
            
            console.log(`📍 Placing ${word.word} at [${row},${col}] ${direction}`);
            
            // Place each letter
            for (let i = 0; i < wordLength; i++) {
                const r = direction === 'across' ? row : row + i;
                const c = direction === 'across' ? col + i : col;
                
                const cell = grid[r][c];
                const letter = word.word[i];
                
                cell.letter = letter;
                cell.hasLetter = true;
                
                if (direction === 'across') {
                    cell.acrossWord = word.id;
                } else {
                    cell.downWord = word.id;
                }
            }
            
            // Assign clue number if not already assigned
            if (!grid[row][col].number) {
                grid[row][col].number = clueNumber++;
            }
            
            // Record placement
            placedWords.push({
                id: word.id,
                word: word.word,
                clue: word.clue,
                startRow: row,
                startCol: col,
                direction: direction,
                length: wordLength,
                number: grid[row][col].number
            });
            
            word.placed = true;
            word.direction = direction;
            word.startRow = row;
            word.startCol = col;
        }
        
        // Find all possible intersections between two words
        function findIntersections(word1, word2) {
            const intersections = [];
            
            for (let i = 0; i < word1.word.length; i++) {
                for (let j = 0; j < word2.word.length; j++) {
                    if (word1.word[i] === word2.word[j]) {
                        intersections.push({
                            pos1: i,  // Position in word1
                            pos2: j,  // Position in word2
                            letter: word1.word[i]
                        });
                    }
                }
            }
            
            return intersections;
        }
        
        // Try to place word intersecting with existing words
        function tryPlaceWithIntersection(word) {
            // Try each placed word as a potential intersection
            for (const placedWord of placedWords) {
                const intersections = findIntersections(word, placedWord);
                
                // Try each intersection point
                for (const inter of intersections) {
                    let row, col, newDirection;
                    
                    if (placedWord.direction === 'across') {
                        // Place new word DOWN at the intersection
                        newDirection = 'down';
                        row = placedWord.startRow - inter.pos2;
                        col = placedWord.startCol + inter.pos1;
                    } else {
                        // Place new word ACROSS at the intersection
                        newDirection = 'across';
                        row = placedWord.startRow + inter.pos1;
                        col = placedWord.startCol - inter.pos2;
                    }
                    
                    // Check if we can place here
                    if (canPlaceWord(word, row, col, newDirection, true)) {
                        placeWord(word, row, col, newDirection);
                        return true;
                    }
                }
            }
            
            return false;
        }
        
        // Place first word in center
        function placeFirstWord() {
            const firstWord = sortedWords[0];
            const centerRow = Math.floor(gridSize / 2);
            const startCol = Math.floor((gridSize - firstWord.length) / 2);
            
            placeWord(firstWord, centerRow, startCol, 'across');
            return firstWord;
        }
        
        // Create a proper crossword pattern
        function createCrosswordPattern() {
            console.log("\n🏗️ Creating crossword pattern...");
            
            // Place first word
            const firstWord = placeFirstWord();
            
            // Create black square pattern (every 3rd cell in a grid pattern)
            const blackPositions = [];
            for (let i = 2; i < gridSize; i += 3) {
                for (let j = 2; j < gridSize; j += 3) {
                    blackPositions.push([i, j]);
                }
            }
            
            // Apply black squares
            blackPositions.forEach(([row, col]) => {
                if (!grid[row][col].hasLetter) {
                    grid[row][col].isBlack = true;
                }
            });
            
            // Try to place remaining words with intersections
            const remainingWords = sortedWords.slice(1);
            const unplacedWords = [];
            
            for (const word of remainingWords) {
                console.log(`\n🔍 Trying to place: ${word.word}`);
                let placed = false;
                
                // Try to place with intersection first
                placed = tryPlaceWithIntersection(word);
                
                // If can't intersect, try to start a new word chain
                if (!placed) {
                    console.log(`  ⚠️ No intersection found for ${word.word}, trying new position...`);
                    
                    // Find empty area to start new word
                    for (let row = 1; row < gridSize - 1; row++) {
                        for (let col = 1; col < gridSize - 1; col++) {
                            if (!grid[row][col].isBlack && !grid[row][col].hasLetter) {
                                // Try placing across
                                if (col + word.length < gridSize - 1) {
                                    let valid = true;
                                    for (let k = 0; k < word.length; k++) {
                                        if (grid[row][col + k].isBlack || grid[row][col + k].hasLetter) {
                                            valid = false;
                                            break;
                                        }
                                    }
                                    
                                    if (valid && canPlaceWord(word, row, col, 'across', false)) {
                                        placeWord(word, row, col, 'across');
                                        placed = true;
                                        break;
                                    }
                                }
                                
                                // Try placing down
                                if (!placed && row + word.length < gridSize - 1) {
                                    let valid = true;
                                    for (let k = 0; k < word.length; k++) {
                                        if (grid[row + k][col].isBlack || grid[row + k][col].hasLetter) {
                                            valid = false;
                                            break;
                                        }
                                    }
                                    
                                    if (valid && canPlaceWord(word, row, col, 'down', false)) {
                                        placeWord(word, row, col, 'down');
                                        placed = true;
                                        break;
                                    }
                                }
                            }
                            if (placed) break;
                        }
                        if (placed) break;
                    }
                }
                
                if (!placed) {
                    console.log(`  ❌ Could not place ${word.word}`);
                    unplacedWords.push(word.word);
                }
            }
            
            // Clean up - fill isolated cells with black squares
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    if (!grid[i][j].hasLetter && !grid[i][j].isBlack) {
                        // Check if cell is isolated
                        const hasNeighbor = 
                            (i > 0 && grid[i-1][j].hasLetter) ||
                            (i < gridSize-1 && grid[i+1][j].hasLetter) ||
                            (j > 0 && grid[i][j-1].hasLetter) ||
                            (j < gridSize-1 && grid[i][j+1].hasLetter);
                        
                        if (!hasNeighbor) {
                            grid[i][j].isBlack = true;
                        }
                    }
                }
            }
            
            return unplacedWords;
        }
        
        // Create the crossword
        const unplacedWords = createCrosswordPattern();
        
        // Create game grid with revealed letters
        const gameGrid = JSON.parse(JSON.stringify(grid));
        
        // Reveal letters: first letter and every intersection
        placedWords.forEach(word => {
            const revealIndices = new Set();
            
            // Always reveal first letter
            revealIndices.add(0);
            
            // Reveal last letter for words longer than 3
            if (word.length > 3) {
                revealIndices.add(word.length - 1);
            }
            
            // Reveal all intersection points
            for (let i = 0; i < word.length; i++) {
                const row = word.direction === 'across' ? word.startRow : word.startRow + i;
                const col = word.direction === 'across' ? word.startCol + i : word.startCol;
                
                const cell = grid[row][col];
                if (cell.acrossWord && cell.downWord) {
                    revealIndices.add(i);
                }
            }
            
            // Hide non-revealed letters
            for (let i = 0; i < word.length; i++) {
                if (!revealIndices.has(i)) {
                    const row = word.direction === 'across' ? word.startRow : word.startRow + i;
                    const col = word.direction === 'across' ? word.startCol + i : word.startCol;
                    gameGrid[row][col].letter = '';
                }
            }
        });
        
        // Sort placed words by clue number
        placedWords.sort((a, b) => a.number - b.number);
        
        console.log(`\n✅ Successfully placed ${placedWords.length} out of ${validWords.length} words`);
        
        return {
            success: true,
            grid: grid,
            gameGrid: gameGrid,
            placedWords: placedWords,
            totalWords: placedWords.length,
            unplacedWords: unplacedWords,
            gridSize: gridSize
        };
        
    } catch (error) {
        console.error("❌ Error:", error);
        return {
            success: false,
            error: error.message,
            grid: [],
            gameGrid: [],
            placedWords: [],
            totalWords: 0,
            unplacedWords: questions.map(q => q.answer),
            gridSize: gridSize
        };
    }
}

// ==============================================
// IMPROVED DISPLAY FUNCTIONS
// ==============================================
function displayGrid(grid, title, isGameGrid = false) {
    if (!grid || grid.length === 0) {
        console.log(`❌ No grid to display for ${title}`);
        return;
    }
    
    const size = Math.min(grid.length, 15);
    
    console.log(`\n${title}`);
    console.log("=".repeat(size * 2 + 10));
    
    // Column headers (0, 5, 10...)
    let header = "   ";
    for (let col = 0; col < size; col++) {
        header += (col % 5 === 0 ? col.toString().padStart(2, ' ') : '  ');
    }
    console.log(header);
    
    // Top border
    console.log("   ┌" + "─".repeat(size * 2) + "┐");
    
    // Grid content
    for (let row = 0; row < size; row++) {
        let rowStr = row.toString().padStart(2, '0') + "│";
        
        for (let col = 0; col < size; col++) {
            const cell = grid[row][col];
            
            if (cell.isBlack) {
                rowStr += '██';
            } else if (cell.hasLetter) {
                if (cell.letter) {
                    // Show letter
                    if (cell.number && isGameGrid) {
                        // Show number in small superscript
                        rowStr += cell.letter + (cell.number < 10 ? cell.number.toString() : '⁺');
                    } else {
                        rowStr += cell.letter + ' ';
                    }
                } else if (cell.number && isGameGrid) {
                    // Empty cell with number
                    rowStr += '▢' + (cell.number < 10 ? cell.number.toString() : '⁺');
                } else {
                    rowStr += '░░';
                }
            } else if (cell.number && isGameGrid) {
                rowStr += '▢' + (cell.number < 10 ? cell.number.toString() : '⁺');
            } else {
                rowStr += '░░';
            }
        }
        
        rowStr += "│" + row.toString().padStart(2, '0');
        console.log(rowStr);
    }
    
    // Bottom border
    console.log("   └" + "─".repeat(size * 2) + "┘");
    console.log(header);
}

function displayClues(placedWords) {
    if (!placedWords || placedWords.length === 0) {
        console.log("❌ No clues to display");
        return;
    }
    
    const across = placedWords.filter(w => w.direction === 'across')
        .sort((a, b) => a.number - b.number);
    const down = placedWords.filter(w => w.direction === 'down')
        .sort((a, b) => a.number - b.number);
    
    console.log("\n📝 CROSSWORD CLUES");
    console.log("=".repeat(60));
    
    if (across.length > 0) {
        console.log("\nACROSS:");
        console.log("-".repeat(30));
        across.forEach(word => {
            // Show word pattern with revealed letters
            let pattern = "";
            for (let i = 0; i < word.length; i++) {
                pattern += "■";
            }
            console.log(`${word.number}. ${word.clue}`);
            console.log(`   ${pattern} (${word.length} letters)`);
        });
    }
    
    if (down.length > 0) {
        console.log("\nDOWN:");
        console.log("-".repeat(30));
        down.forEach(word => {
            let pattern = "";
            for (let i = 0; i < word.length; i++) {
                pattern += "■";
            }
            console.log(`${word.number}. ${word.clue}`);
            console.log(`   ${pattern} (${word.length} letters)`);
        });
    }
}

// ==============================================
// MAIN TEST
// ==============================================
console.log("🧪 =========================================");
console.log("🧪 PROPER CROSSWORD WITH INTERSECTIONS");
console.log("🧪 =========================================\n");

const testQuestions = [
  { id: 1, answer: "PYTHON", question: "Programming language named after a snake" },
  { id: 2, answer: "JAVA", question: "Coffee-inspired programming language" },
  { id: 3, answer: "HTML", question: "Markup language for web pages" },
  { id: 4, answer: "CSS", question: "Stylesheet language for web design" },
  { id: 5, answer: "SQL", question: "Database query language" },
  { id: 6, answer: "GIT", question: "Version control system" },
  { id: 7, answer: "NODE", question: "JavaScript runtime environment" },
  { id: 8, answer: "JSON", question: "Data interchange format" },
  { id: 9, answer: "API", question: "Application Programming Interface" },
  { id: 10, answer: "REACT", question: "Popular JavaScript library for UI" },
  { id: 11, answer: "SYNTAXANALYZER", question: "Second phase of compiler" },
   { id: 12, question: "Tool used to generate parsers", answer: "YACC", difficulty: "Medium", length: 4 },
    { id: 13, question: "Type checking occurs during this analysis phase", answer: "SEMANTIC", difficulty: "Easy", length: 8 },
    { id: 14, question: "Intermediate code often uses _____ address code", answer: "THREE", difficulty: "Hard", length: 5 },
    { id: 15, question: "Converts assembly language to machine code", answer: "ASSEMBLER", difficulty: "Easy", length: 9 },
    { id: 16, question: "Removing code that is never executed", answer: "DEADCODE", difficulty: "Medium", length: 8 }


];

console.log(`📊 Questions: ${testQuestions.length}`);

const result = generateCrosswordGrid(testQuestions, 15);

console.log(`\n✅ Success: ${result.success}`);
console.log(`📐 Grid Size: ${result.gridSize}x${result.gridSize}`);
console.log(`🔤 Words Placed: ${result.totalWords}/${testQuestions.length}`);

if (result.unplacedWords && result.unplacedWords.length > 0) {
    console.log(`❌ Unplaced words: ${result.unplacedWords.join(', ')}`);
}

// Display results
console.log("\n🎮 =========== GAME GRID ===========");
console.log("(▢ = empty cell with clue number, letters shown at intersections)");
displayGrid(result.gameGrid, "", true);

console.log("\n🔍 ========= REFERENCE GRID ==========");
console.log("(All letters shown)");
displayGrid(result.grid, "", false);

// Display clues
displayClues(result.placedWords);

// Show intersections
console.log("\n🔗 WORD INTERSECTIONS");
console.log("-".repeat(40));

let intersectionCount = 0;
const intersectionPoints = [];

for (let i = 0; i < result.gridSize; i++) {
    for (let j = 0; j < result.gridSize; j++) {
        const cell = result.grid[i][j];
        if (cell.acrossWord && cell.downWord) {
            intersectionCount++;
            
            // Find which words intersect here
            const acrossWord = result.placedWords.find(w => w.id === cell.acrossWord);
            const downWord = result.placedWords.find(w => w.id === cell.downWord);
            
            if (acrossWord && downWord) {
                intersectionPoints.push({
                    letter: cell.letter,
                    position: `[${i},${j}]`,
                    across: acrossWord.word,
                    down: downWord.word
                });
            }
        }
    }
}

console.log(`Total intersections: ${intersectionCount}`);
intersectionPoints.forEach(point => {
    console.log(`  ${point.letter} at ${point.position}: ${point.across} x ${point.down}`);
});

// Show word placements
console.log("\n📊 WORD PLACEMENTS");
console.log("-".repeat(40));
result.placedWords.forEach(word => {
    const intersections = [];
    for (let i = 0; i < word.length; i++) {
        const row = word.direction === 'across' ? word.startRow : word.startRow + i;
        const col = word.direction === 'across' ? word.startCol + i : word.startCol;
        if (result.grid[row][col].acrossWord && result.grid[row][col].downWord) {
            intersections.push(i + 1); // 1-indexed for display
        }
    }
    
    const intersectStr = intersections.length > 0 ? 
        `(intersects at positions: ${intersections.join(', ')})` : 
        "(no intersections)";
    
    console.log(`${word.number}. ${word.word.padEnd(8)} [${word.startRow},${word.startCol}] ${word.direction.padEnd(8)} ${intersectStr}`);
});

console.log("\n🧪 =========================================");
console.log("🧪 TEST COMPLETE");
console.log("🧪 =========================================");

// Export the function
module.exports = { generateCrosswordGrid };