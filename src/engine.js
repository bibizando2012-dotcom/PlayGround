/*
 * Swapchess engine — a chess variant where every capture transfers the
 * defender's movement power to the surviving attacker.
 *
 * Board indices are 0..63 in reading order from White's back rank:
 *   0  1  2  3  4  5  6  7   (rank 8)
 *   8  9 ...
 *  56 57 58 59 60 61 62 63   (rank 1)
 */

export const WHITE = 'w';
export const BLACK = 'b';
export const POWERS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

export const POWER_NAMES = {
  pawn: 'Pawn',
  knight: 'Knight',
  bishop: 'Bishop',
  rook: 'Rook',
  queen: 'Queen',
  king: 'King',
};

export const POWER_GLYPHS = {
  pawn: '♟',
  knight: '♞',
  bishop: '♝',
  rook: '♜',
  queen: '♛',
  king: '♚',
};

export const POWER_DESCRIPTIONS = {
  pawn: 'Steps forward; captures diagonally.',
  knight: 'Leaps in an L, over any piece.',
  bishop: 'Slides diagonally.',
  rook: 'Slides in straight lines.',
  queen: 'Slides in every direction.',
  king: 'Moves one square in any direction.',
};

export function other(color) {
  return color === WHITE ? BLACK : WHITE;
}

export function rowOf(index) {
  return index >> 3;
}

export function colOf(index) {
  return index & 7;
}

export function indexOf(row, col) {
  return row * 8 + col;
}

export function squareName(index) {
  if (index == null || index < 0 || index > 63) return '—';
  return `${'abcdefgh'[colOf(index)]}${8 - rowOf(index)}`;
}

export function positionName(index) {
  return squareName(index);
}

let nextPieceId = 1;

export function makePiece(color, power, options = {}) {
  return {
    id: options.id || `p${nextPieceId++}`,
    color,
    power,
    royal: Boolean(options.royal),
    moved: Boolean(options.moved),
  };
}

export function createEmptyState(turn = WHITE) {
  return {
    board: Array(64).fill(null),
    turn,
    enPassant: null,
    lastMove: null,
    log: [],
    status: 'playing',
    winner: null,
    inCheck: false,
    moveNumber: 1,
  };
}

export function placePiece(state, index, color, power, options = {}) {
  const piece = makePiece(color, power, options);
  state.board[index] = piece;
  return piece;
}

export function createInitialState() {
  const state = createEmptyState(WHITE);
  const backRank = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

  for (let col = 0; col < 8; col += 1) {
    const blackPower = backRank[col];
    placePiece(state, indexOf(0, col), BLACK, blackPower, { royal: blackPower === 'king' });
    placePiece(state, indexOf(1, col), BLACK, 'pawn');
    placePiece(state, indexOf(6, col), WHITE, 'pawn');
    const whitePower = backRank[col];
    placePiece(state, indexOf(7, col), WHITE, whitePower, { royal: whitePower === 'king' });
  }

  return state;
}

export function cloneState(state) {
  return {
    ...state,
    board: state.board.map(piece => (piece ? { ...piece } : null)),
    log: state.log.slice(),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };
}

export function findRoyal(state, color) {
  return state.board.findIndex(piece => piece && piece.color === color && piece.royal);
}

export function isPromotionSquare(index, color) {
  return color === WHITE ? rowOf(index) === 0 : rowOf(index) === 7;
}

const KNIGHT_STEPS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_STEPS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

function inside(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function pushStepMoves(state, from, rows, moves) {
  const piece = state.board[from];
  const row = rowOf(from);
  const col = colOf(from);
  for (const [dr, dc] of rows) {
    const r = row + dr;
    const c = col + dc;
    if (!inside(r, c)) continue;
    const to = indexOf(r, c);
    const target = state.board[to];
    if (!target) {
      moves.push({ from, to, capture: false });
    } else if (target.color !== piece.color && !target.royal) {
      moves.push({ from, to, capture: true, capturedIndex: to, capturedPower: target.power });
    }
  }
}

function pushSlidingMoves(state, from, dirs, moves) {
  const piece = state.board[from];
  const row = rowOf(from);
  const col = colOf(from);
  for (const [dr, dc] of dirs) {
    let r = row + dr;
    let c = col + dc;
    while (inside(r, c)) {
      const to = indexOf(r, c);
      const target = state.board[to];
      if (!target) {
        moves.push({ from, to, capture: false });
      } else {
        if (target.color !== piece.color && !target.royal) {
          moves.push({ from, to, capture: true, capturedIndex: to, capturedPower: target.power });
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }
}

function pawnAttackSquares(color, index) {
  const direction = color === WHITE ? -1 : 1;
  const row = rowOf(index) + direction;
  const col = colOf(index);
  const squares = [];
  if (col > 0 && row >= 0 && row < 8) squares.push(indexOf(row, col - 1));
  if (col < 7 && row >= 0 && row < 8) squares.push(indexOf(row, col + 1));
  return squares;
}

function pushPawnMoves(state, from, moves) {
  const piece = state.board[from];
  const direction = piece.color === WHITE ? -1 : 1;
  const startRow = piece.color === WHITE ? 6 : 1;
  const row = rowOf(from);
  const col = colOf(from);
  const oneRow = row + direction;

  if (inside(oneRow, col)) {
    const one = indexOf(oneRow, col);
    if (!state.board[one]) {
      moves.push({ from, to: one, capture: false });
      const twoRow = row + direction * 2;
      if (!piece.moved && row === startRow) {
        const two = indexOf(twoRow, col);
        if (!state.board[two]) moves.push({ from, to: two, capture: false, doubleStep: true });
      }
    }
  }

  for (const dc of [-1, 1]) {
    const r = row + direction;
    const c = col + dc;
    if (!inside(r, c)) continue;
    const to = indexOf(r, c);
    const target = state.board[to];
    if (target && target.color !== piece.color && !target.royal) {
      moves.push({ from, to, capture: true, capturedIndex: to, capturedPower: target.power });
    } else if (!target && state.enPassant === to) {
      const capturedIndex = indexOf(row, c);
      const captured = state.board[capturedIndex];
      if (captured && captured.color !== piece.color && !captured.royal) {
        moves.push({
          from,
          to,
          capture: true,
          capturedIndex,
          capturedPower: captured.power,
          enPassant: true,
        });
      }
    }
  }
}

function canCastle(state, kingIndex, side) {
  const king = state.board[kingIndex];
  if (!king || !king.royal || king.power !== 'king' || king.moved) return null;
  const row = rowOf(kingIndex);
  const homeRow = king.color === WHITE ? 7 : 0;
  if (row !== homeRow) return null;

  const rookCol = side === 'king' ? 7 : 0;
  const rookIndex = indexOf(row, rookCol);
  const rook = state.board[rookIndex];
  if (!rook || rook.color !== king.color || rook.power !== 'rook' || rook.moved) return null;

  const step = side === 'king' ? 1 : -1;
  const kingToCol = colOf(kingIndex) + step * 2;
  if (kingToCol < 0 || kingToCol > 7) return null;
  const between = side === 'king' ? [5, 6] : [1, 2, 3];
  for (const c of between) {
    if (state.board[indexOf(row, c)]) return null;
  }

  if (isSquareAttacked(state, kingIndex, other(king.color))) return null;
  for (let c = colOf(kingIndex) + step; c !== kingToCol; c += step) {
    if (isSquareAttacked(state, indexOf(row, c), other(king.color))) return null;
  }

  return {
    from: kingIndex,
    to: indexOf(row, kingToCol),
    capture: false,
    castling: side,
    rookFrom: rookIndex,
    rookTo: indexOf(row, side === 'king' ? 5 : 3),
  };
}

export function getPseudoMoves(state, from) {
  const piece = state.board[from];
  if (!piece) return [];
  const moves = [];

  switch (piece.power) {
    case 'pawn':
      pushPawnMoves(state, from, moves);
      break;
    case 'knight':
      pushStepMoves(state, from, KNIGHT_STEPS, moves);
      break;
    case 'bishop':
      pushSlidingMoves(state, from, BISHOP_DIRS, moves);
      break;
    case 'rook':
      pushSlidingMoves(state, from, ROOK_DIRS, moves);
      break;
    case 'queen':
      pushSlidingMoves(state, from, QUEEN_DIRS, moves);
      break;
    case 'king':
      pushStepMoves(state, from, KING_STEPS, moves);
      break;
    default:
      break;
  }

  if (piece.power === 'king') {
    for (const side of ['king', 'queen']) {
      const castle = canCastle(state, from, side);
      if (castle) moves.push(castle);
    }
  }

  return moves;
}

function makeMoveUnchecked(state, move) {
  const next = cloneState(state);
  const piece = next.board[move.from];
  if (!piece) return next;

  const capturedIndex = move.enPassant ? move.capturedIndex : move.to;
  const target = next.board[capturedIndex] || null;
  if (target && target.royal) return next;

  let powerAfter = piece.power;
  if (target) powerAfter = target.power;

  let promoted = false;
  if (piece.power === 'pawn' && !piece.royal && isPromotionSquare(move.to, piece.color)) {
    powerAfter = 'queen';
    promoted = true;
  }

  const movedPiece = { ...piece, power: powerAfter, moved: true };
  next.board[move.from] = null;
  if (target) next.board[capturedIndex] = null;
  next.board[move.to] = movedPiece;

  if (move.castling && move.rookFrom != null) {
    const rook = next.board[move.rookFrom];
    if (rook) {
      next.board[move.rookFrom] = null;
      next.board[move.rookTo] = { ...rook, moved: true };
    }
  }

  next.enPassant = null;
  if (piece.power === 'pawn' && Math.abs(rowOf(move.to) - rowOf(move.from)) === 2) {
    next.enPassant = (move.to + move.from) / 2;
  }
  next.turn = other(state.turn);
  next.moveNumber = state.moveNumber + (state.turn === BLACK ? 1 : 0);
  next.lastMove = {
    ...move,
    pieceId: piece.id,
    color: piece.color,
    capturedId: target ? target.id : null,
    capturedPower: target ? target.power : null,
    powerBefore: piece.power,
    powerAfter,
    promoted,
  };

  return next;
}

export function isSquareAttacked(state, square, byColor) {
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (!piece || piece.color !== byColor) continue;
    const row = rowOf(from);
    const col = colOf(from);
    const targetRow = rowOf(square);
    const targetCol = colOf(square);

    if (piece.power === 'pawn') {
      if (pawnAttackSquares(piece.color, from).includes(square)) return true;
      continue;
    }

    if (piece.power === 'knight') {
      if (KNIGHT_STEPS.some(([dr, dc]) => row + dr === targetRow && col + dc === targetCol)) return true;
      continue;
    }

    if (piece.power === 'king') {
      if (KING_STEPS.some(([dr, dc]) => row + dr === targetRow && col + dc === targetCol)) return true;
      continue;
    }

    let dirs = null;
    if (piece.power === 'bishop') dirs = BISHOP_DIRS;
    if (piece.power === 'rook') dirs = ROOK_DIRS;
    if (piece.power === 'queen') dirs = QUEEN_DIRS;
    if (!dirs) continue;

    for (const [dr, dc] of dirs) {
      let r = row + dr;
      let c = col + dc;
      while (inside(r, c)) {
        if (r === targetRow && c === targetCol) return true;
        if (state.board[indexOf(r, c)]) break;
        r += dr;
        c += dc;
      }
    }
  }

  return false;
}

export function isInCheck(state, color) {
  const royal = findRoyal(state, color);
  if (royal < 0) return false;
  return isSquareAttacked(state, royal, other(color));
}

export function getLegalMoves(state, from) {
  const piece = state.board[from];
  if (!piece) return [];
  const moved = getPseudoMoves(state, from);
  return moved.filter(move => {
    const next = makeMoveUnchecked(state, move);
    return !isInCheck(next, piece.color);
  });
}

export function allLegalMoves(state, color = state.turn) {
  const moves = [];
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (!piece || piece.color !== color) continue;
    moves.push(...getLegalMoves(state, from));
  }
  return moves;
}

export function hasAnyLegalMove(state, color = state.turn) {
  for (let from = 0; from < 64; from += 1) {
    const piece = state.board[from];
    if (!piece || piece.color !== color) continue;
    if (getLegalMoves(state, from).length > 0) return true;
  }
  return false;
}

export function refreshStatus(state) {
  const check = isInCheck(state, state.turn);
  const canMove = hasAnyLegalMove(state, state.turn);
  state.inCheck = check;

  if (!canMove) {
    state.status = check ? 'checkmate' : 'stalemate';
    state.winner = check ? other(state.turn) : null;
  } else {
    state.status = check ? 'check' : 'playing';
    state.winner = null;
  }
  return state;
}

export function applyMove(state, move) {
  const piece = state.board[move.from];
  if (!piece) throw new Error('Cannot move from an empty square.');
  if (piece.color !== state.turn) throw new Error('It is not that piece’s turn.');
  if (state.board[move.to]?.royal) throw new Error('The royal piece cannot be captured.');

  const sourceBefore = {
    pieceId: piece.id,
    color: piece.color,
    powerBefore: piece.power,
  };
  const capturedIndex = move.enPassant ? move.capturedIndex : move.to;
  const captured = state.board[capturedIndex] || null;

  const next = makeMoveUnchecked(state, move);
  const entry = {
    number: next.log.length + 1,
    pieceId: piece.id,
    color: piece.color,
    from: move.from,
    to: move.to,
    square: squareName(move.to),
    capture: Boolean(captured),
    capturedId: captured ? captured.id : null,
    capturedColor: captured ? captured.color : null,
    capturedPower: captured ? captured.power : null,
    powerBefore: sourceBefore.powerBefore,
    powerAfter: next.board[move.to].power,
    promoted: Boolean(next.lastMove?.promoted),
    castling: move.castling || null,
    enPassant: Boolean(move.enPassant),
    check: false,
  };
  next.log = [...state.log, entry];
  next.lastMove = { ...next.lastMove, ...entry, pieceId: piece.id };

  refreshStatus(next);
  if (next.inCheck) entry.check = true;
  next.log[next.log.length - 1] = entry;

  return next;
}

export function materialScore(state, color) {
  const values = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 0 };
  let total = 0;
  for (const piece of state.board) {
    if (!piece || piece.color !== color || piece.royal) continue;
    total += values[piece.power] || 0;
  }
  return total;
}

export function moveNotation(state, move) {
  const piece = state.board[move.from];
  if (!piece) return '—';
  const target = state.board[move.enPassant ? move.capturedIndex : move.to];
  const capture = target ? '×' : '–';
  const promotion = piece.power === 'pawn' && !piece.royal && isPromotionSquare(move.to, piece.color) ? '=Q' : '';
  return `${POWER_NAMES[piece.power][0]}${squareName(move.from)}${capture}${squareName(move.to)}${promotion}`;
}
