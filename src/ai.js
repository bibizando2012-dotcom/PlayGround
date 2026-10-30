import {
  BLACK,
  WHITE,
  allLegalMoves,
  applyMove,
  colOf,
  isInCheck,
  rowOf,
} from './engine.js';

const VALUE = { pawn: 105, knight: 320, bishop: 335, rook: 510, queen: 950, king: 0 };
const MATE = 100000;

// Positional hints are intentionally light: the power on a square matters more
// than the square itself in Swapchess.
const CENTER = [
  0, 1, 2, 3, 3, 2, 1, 0,
  1, 2, 4, 5, 5, 4, 2, 1,
  2, 4, 6, 8, 8, 6, 4, 2,
  3, 5, 8, 10, 10, 8, 5, 3,
  3, 5, 8, 10, 10, 8, 5, 3,
  2, 4, 6, 8, 8, 6, 4, 2,
  1, 2, 4, 5, 5, 4, 2, 1,
  0, 1, 2, 3, 3, 2, 1, 0,
];

function perspectiveRow(index, color) {
  return color === WHITE ? 7 - rowOf(index) : rowOf(index);
}

function pieceValue(piece) {
  if (piece.royal) return 10000;
  return VALUE[piece.power] || 0;
}

function positional(piece, index) {
  const row = rowOf(index);
  const col = colOf(index);
  const rank = perspectiveRow(index, piece.color);
  let score = CENTER[index] || 0;

  if (piece.power === 'pawn') score += rank * 8;
  if (piece.power === 'knight') score += CENTER[index] * 1.4;
  if (piece.power === 'bishop') score += CENTER[index] * 0.9;
  if (piece.power === 'rook') score += rank === 6 ? 18 : 0;
  if (piece.power === 'queen') score += CENTER[index] * 0.35;
  if (piece.power === 'king' && piece.royal) {
    // Keep the crown away from the open middle while the board is crowded.
    const distance = Math.abs(3.5 - row) + Math.abs(3.5 - col);
    score += Math.max(0, 7 - distance) * 5;
  }
  return score;
}

export function evaluatePosition(state, color) {
  let score = 0;

  for (let index = 0; index < 64; index += 1) {
    const piece = state.board[index];
    if (!piece) continue;
    const sign = piece.color === color ? 1 : -1;
    score += sign * (pieceValue(piece) + positional(piece, index));
  }

  if (isInCheck(state, color)) score -= 45;
  if (isInCheck(state, state.turn === WHITE ? BLACK : WHITE)) score += 20;

  // A royal with a pawn's power is a liability, but it is still the game.
  const royalIndex = state.board.findIndex(piece => piece && piece.royal && piece.color === color);
  if (royalIndex >= 0) {
    const royal = state.board[royalIndex];
    if (royal && royal.power === 'pawn') score -= 40;
  }

  return score;
}

function movePriority(state, move) {
  let score = 0;
  const target = state.board[move.enPassant ? move.capturedIndex : move.to];
  if (target) score += VALUE[target.power] * 3 + 200;
  if (move.castling) score += 80;
  if (move.doubleStep) score += 20;
  return score;
}

function orderedMoves(state) {
  return allLegalMoves(state)
    .map(move => ({ move, priority: movePriority(state, move) + Math.random() * 4 }))
    .sort((a, b) => b.priority - a.priority)
    .map(entry => entry.move);
}

function negamax(state, depth, alpha, beta, ply) {
  if (state.status === 'checkmate') return -MATE + ply;
  if (state.status === 'stalemate') return 0;
  if (depth <= 0) return evaluatePosition(state, state.turn);

  const moves = orderedMoves(state);
  if (moves.length === 0) return state.inCheck ? -MATE + ply : 0;

  let best = -Infinity;
  for (const move of moves) {
    const child = applyMove(state, move);
    const score = -negamax(child, depth - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseAiMove(state, options = {}) {
  if (state.status === 'checkmate' || state.status === 'stalemate') return null;

  const depth = Math.max(1, Math.min(3, options.depth || 2));
  const rootMoves = orderedMoves(state);
  if (rootMoves.length === 0) return null;

  let bestMove = rootMoves[0];
  let bestScore = -Infinity;

  for (const move of rootMoves) {
    const child = applyMove(state, move);
    const score = -negamax(child, depth - 1, -Infinity, Infinity, 1) + Math.random() * 1.5;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}
