'use strict';

/* ─────────────────────────────────────────────────────────────
   Swap Chess engine
   Every capture transfers the fallen piece's movement power to
   the survivor. Kings keep their royal status.
   ───────────────────────────────────────────────────────────── */

export const FILES = 'abcdefgh';
export const TYPES = ['p', 'n', 'b', 'r', 'q', 'k'];
export const TYPE_NAME = {
  p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King',
};
export const TYPE_LETTER = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
export const TYPE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
export const ROYAL_BONUS = { p: -90, n: 95, b: 80, r: 140, q: 260, k: 0 };
export const PROMO_TYPES = ['q', 'r', 'b', 'n'];
export const MATE = 100000;
export const OTHER = (color) => (color === 'w' ? 'b' : 'w');
export const TIMEOUT = Symbol('search-timeout');

export const idx = (r, c) => r * 8 + c;
export const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const at = (board, r, c) => (inBounds(r, c) ? board[idx(r, c)] : null);
export const squareName = (r, c) => `${FILES[c]}${8 - r}`;

let nextPieceId = 1;

export function makePiece(color, type, royal = false) {
  return { id: `p${nextPieceId++}`, color, type, royal, moved: false };
}

export function createInitialBoard() {
  const board = Array(64).fill(null);
  const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let c = 0; c < 8; c += 1) {
    board[idx(0, c)] = makePiece('b', back[c], back[c] === 'k');
    board[idx(1, c)] = makePiece('b', 'p');
    board[idx(6, c)] = makePiece('w', 'p');
    board[idx(7, c)] = makePiece('w', back[c], back[c] === 'k');
  }
  return board;
}

/* ── Attack detection ──────────────────────────────────────── */

const KNIGHT_STEPS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
];
const KING_STEPS = [
  [-1, -1], [-1, 0], [-1, 1], [0, -1],
  [0, 1], [1, -1], [1, 0], [1, 1],
];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const QUEEN_DIRS = [...BISHOP_DIRS, ...ROOK_DIRS];

export function isSquareAttacked(board, r, c, byColor) {
  // Pawns attack diagonally toward the enemy side.
  const pawnRow = r + (byColor === 'w' ? 1 : -1);
  for (const dc of [-1, 1]) {
    const pawn = at(board, pawnRow, c + dc);
    if (pawn && pawn.color === byColor && pawn.type === 'p') return true;
  }

  for (const [dr, dc] of KNIGHT_STEPS) {
    const piece = at(board, r + dr, c + dc);
    if (piece && piece.color === byColor && piece.type === 'n') return true;
  }

  for (const [dr, dc] of KING_STEPS) {
    const piece = at(board, r + dr, c + dc);
    if (piece && piece.color === byColor && piece.type === 'k') return true;
  }

  for (const [dr, dc] of BISHOP_DIRS) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const piece = at(board, nr, nc);
      if (piece) {
        if (piece.color === byColor && (piece.type === 'b' || piece.type === 'q')) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  for (const [dr, dc] of ROOK_DIRS) {
    let nr = r + dr;
    let nc = c + dc;
    while (inBounds(nr, nc)) {
      const piece = at(board, nr, nc);
      if (piece) {
        if (piece.color === byColor && (piece.type === 'r' || piece.type === 'q')) return true;
        break;
      }
      nr += dr;
      nc += dc;
    }
  }

  return false;
}

export function findRoyal(board, color) {
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = at(board, r, c);
      if (piece && piece.color === color && piece.royal) return { piece, r, c };
    }
  }
  return null;
}

export function inCheck(state, color) {
  const royal = findRoyal(state.board, color);
  if (!royal) return false;
  return isSquareAttacked(state.board, royal.r, royal.c, OTHER(color));
}

export function castlingRights(state) {
  let rights = '';
  for (const color of ['w', 'b']) {
    const home = color === 'w' ? 7 : 0;
    const king = at(state.board, home, 4);
    if (!king || king.color !== color || king.type !== 'k' || !king.royal || king.moved) continue;
    const kingRook = at(state.board, home, 7);
    const queenRook = at(state.board, home, 0);
    if (kingRook && kingRook.color === color && kingRook.type === 'r' && !kingRook.moved) {
      rights += color === 'w' ? 'K' : 'k';
    }
    if (queenRook && queenRook.color === color && queenRook.type === 'r' && !queenRook.moved) {
      rights += color === 'w' ? 'Q' : 'q';
    }
  }
  return rights || '-';
}

export function positionKey(state) {
  const board = state.board.map((piece) => (
    piece ? `${piece.color}${piece.type}${piece.royal ? '*' : ''}` : '.'
  )).join('');
  const ep = state.enPassant ? `${state.enPassant.r}${state.enPassant.c}` : '-';
  return `${board}|${state.turn}|${castlingRights(state)}|${ep}`;
}

/* ── Move generation ───────────────────────────────────────── */

function pushMove(moves, state, from, to, extra = {}) {
  const piece = at(state.board, from.r, from.c);
  if (!piece) return;
  const target = at(state.board, to.r, to.c);
  if (target && target.color === piece.color) return;
  if (target && target.royal) return;

  const base = {
    from,
    to,
    color: piece.color,
    pieceType: piece.type,
    capturedType: target ? target.type : (extra.capturedType || null),
    ...extra,
  };

  // A capture transfers the victim's power, so the resulting type matters:
  // a non-pawn that takes a pawn on the far rank would otherwise become a
  // pawn with no forward move. Such a piece must promote instead.
  const promotionRank = piece.color === 'w' ? 0 : 7;
  const resultingType = target ? target.type : piece.type;
  if (resultingType === 'p' && to.r === promotionRank) {
    for (const promo of PROMO_TYPES) moves.push({ ...base, promo });
  } else {
    moves.push(base);
  }
}

export function generatePseudoMoves(state, color = state.turn) {
  const moves = [];
  const board = state.board;
  const opponent = OTHER(color);

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = at(board, r, c);
      if (!piece || piece.color !== color) continue;
      const from = { r, c };

      if (piece.type === 'p') {
        const dir = color === 'w' ? -1 : 1;
        const startRank = color === 'w' ? 6 : 1;
        const oneRow = r + dir;

        if (inBounds(oneRow, c) && !at(board, oneRow, c)) {
          pushMove(moves, state, from, { r: oneRow, c });
          const twoRow = r + dir * 2;
          if (r === startRank && !piece.moved && !at(board, twoRow, c)) {
            pushMove(moves, state, from, { r: twoRow, c });
          }
        }

        for (const dc of [-1, 1]) {
          const nr = r + dir;
          const nc = c + dc;
          const target = at(board, nr, nc);
          if (target && target.color === opponent) {
            pushMove(moves, state, from, { r: nr, c: nc });
          }
        }

        if (state.enPassant) {
          const ep = state.enPassant;
          if (ep.r === r + dir && ep.c === c - 1) {
            const captured = at(board, ep.pawnR, ep.pawnC);
            if (captured && captured.color === opponent && captured.type === 'p' && !captured.royal) {
              pushMove(moves, state, from, { r: ep.r, c: ep.c }, {
                capturedType: 'p',
                enPassant: { capturedR: ep.pawnR, capturedC: ep.pawnC },
              });
            }
          }
          if (ep.r === r + dir && ep.c === c + 1) {
            const captured = at(board, ep.pawnR, ep.pawnC);
            if (captured && captured.color === opponent && captured.type === 'p' && !captured.royal) {
              pushMove(moves, state, from, { r: ep.r, c: ep.c }, {
                capturedType: 'p',
                enPassant: { capturedR: ep.pawnR, capturedC: ep.pawnC },
              });
            }
          }
        }
        continue;
      }

      if (piece.type === 'n') {
        for (const [dr, dc] of KNIGHT_STEPS) {
          const nr = r + dr;
          const nc = c + dc;
          if (inBounds(nr, nc)) pushMove(moves, state, from, { r: nr, c: nc });
        }
        continue;
      }

      if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
        const dirs = piece.type === 'b' ? BISHOP_DIRS : piece.type === 'r' ? ROOK_DIRS : QUEEN_DIRS;
        for (const [dr, dc] of dirs) {
          let nr = r + dr;
          let nc = c + dc;
          while (inBounds(nr, nc)) {
            const target = at(board, nr, nc);
            if (target) {
              if (target.color === opponent) pushMove(moves, state, from, { r: nr, c: nc });
              break;
            }
            pushMove(moves, state, from, { r: nr, c: nc });
            nr += dr;
            nc += dc;
          }
        }
        continue;
      }

      if (piece.type === 'k') {
        for (const [dr, dc] of KING_STEPS) {
          const nr = r + dr;
          const nc = c + dc;
          if (inBounds(nr, nc)) pushMove(moves, state, from, { r: nr, c: nc });
        }

        if (piece.royal && !piece.moved) {
          const home = color === 'w' ? 7 : 0;
          if (r === home && c === 4 && !isSquareAttacked(board, home, 4, opponent)) {
            const kingRook = at(board, home, 7);
            if (
              kingRook && kingRook.color === color && kingRook.type === 'r' && !kingRook.moved
              && !at(board, home, 5) && !at(board, home, 6)
              && !isSquareAttacked(board, home, 5, opponent)
              && !isSquareAttacked(board, home, 6, opponent)
            ) {
              moves.push({
                from: { r: home, c: 4 },
                to: { r: home, c: 6 },
                color,
                pieceType: 'k',
                capturedType: null,
                castle: 'k',
                rookFrom: { r: home, c: 7 },
                rookTo: { r: home, c: 5 },
              });
            }
            const queenRook = at(board, home, 0);
            if (
              queenRook && queenRook.color === color && queenRook.type === 'r' && !queenRook.moved
              && !at(board, home, 1) && !at(board, home, 2) && !at(board, home, 3)
              && !isSquareAttacked(board, home, 3, opponent)
              && !isSquareAttacked(board, home, 2, opponent)
            ) {
              moves.push({
                from: { r: home, c: 4 },
                to: { r: home, c: 2 },
                color,
                pieceType: 'k',
                capturedType: null,
                castle: 'q',
                rookFrom: { r: home, c: 0 },
                rookTo: { r: home, c: 3 },
              });
            }
          }
        }
      }
    }
  }

  return moves;
}

export function applyMoveToBoard(board, move) {
  const copy = board.slice();
  const fromIndex = idx(move.from.r, move.from.c);
  const toIndex = idx(move.to.r, move.to.c);
  const piece = copy[fromIndex];
  if (!piece) return null;

  const target = copy[toIndex];
  if (target && target.royal) return null;
  const movedPiece = { ...piece, moved: true };
  copy[fromIndex] = null;

  let captured = target;
  if (move.enPassant) {
    const captureIndex = idx(move.enPassant.capturedR, move.enPassant.capturedC);
    captured = copy[captureIndex] || captured;
    if (captured && captured.royal) return null;
    copy[captureIndex] = null;
  }

  if (move.castle) {
    const rookFrom = idx(move.rookFrom.r, move.rookFrom.c);
    const rookTo = idx(move.rookTo.r, move.rookTo.c);
    const rook = copy[rookFrom];
    if (rook) {
      copy[rookFrom] = null;
      copy[rookTo] = { ...rook, moved: true };
    }
  }

  if (captured) movedPiece.type = captured.type;
  if (move.promo) movedPiece.type = move.promo;
  copy[toIndex] = movedPiece;

  return { board: copy, movedPiece, captured };
}

export function isLegalMove(state, move) {
  const applied = applyMoveToBoard(state.board, move);
  if (!applied) return false;
  const royal = findRoyal(applied.board, state.turn);
  if (!royal) return false;
  return !isSquareAttacked(applied.board, royal.r, royal.c, OTHER(state.turn));
}

export function getLegalMoves(state) {
  return generatePseudoMoves(state, state.turn).filter((move) => isLegalMove(state, move));
}

export function getLegalMovesFrom(state, r, c) {
  return getLegalMoves(state).filter((move) => move.from.r === r && move.from.c === c);
}

export function updateGameStatus(state) {
  state.check = inCheck(state, state.turn);
  const legal = getLegalMoves(state);

  if (legal.length === 0) {
    if (state.check) {
      state.status = 'checkmate';
      state.result = { winner: OTHER(state.turn), reason: 'checkmate' };
    } else {
      state.status = 'stalemate';
      state.result = { winner: null, reason: 'stalemate' };
    }
    return legal;
  }

  if (state.halfmove >= 100) {
    state.status = 'draw';
    state.result = { winner: null, reason: 'fifty-move' };
    return legal;
  }

  if ((state.positionCounts[positionKey(state)] || 0) >= 3) {
    state.status = 'draw';
    state.result = { winner: null, reason: 'threefold' };
    return legal;
  }

  state.status = 'playing';
  state.result = null;
  return legal;
}

export function notationForMove(move, applied, state) {
  let san;
  if (move.castle) {
    san = move.castle === 'k' ? 'O-O' : 'O-O-O';
  } else {
    const letter = TYPE_LETTER[move.pieceType] || '';
    const destination = squareName(move.to.r, move.to.c);
    if (move.pieceType === 'p') {
      san = move.capturedType
        ? `${FILES[move.from.c]}x${destination}`
        : destination;
    } else {
      san = `${letter}${move.capturedType ? 'x' : ''}${destination}`;
    }
    if (move.promo && move.promo !== move.pieceType) {
      san += move.pieceType === 'p'
        ? `=${TYPE_LETTER[move.promo]}`
        : `→${TYPE_LETTER[move.promo]}`;
    }
  }

  if (move.capturedType && !move.promo && applied.movedPiece.type !== move.pieceType) {
    san += `→${TYPE_LETTER[applied.movedPiece.type] || 'P'}`;
  }
  if (state.status === 'checkmate') san += '#';
  else if (state.check) san += '+';
  return san;
}

/* ── Search helpers used by the AI ─────────────────────────── */

export function applySearchMove(state, move) {
  const applied = applyMoveToBoard(state.board, move);
  if (!applied) return null;
  const next = {
    board: applied.board,
    turn: OTHER(state.turn),
    enPassant: null,
    halfmove: (move.pieceType === 'p' || applied.captured) ? 0 : state.halfmove + 1,
    fullmove: state.fullmove + (state.turn === 'b' ? 1 : 0),
    positionCounts: state.positionCounts,
  };
  if (move.pieceType === 'p' && Math.abs(move.to.r - move.from.r) === 2) {
    next.enPassant = {
      r: (move.to.r + move.from.r) / 2,
      c: move.to.c,
      pawnR: move.to.r,
      pawnC: move.to.c,
      color: move.color,
    };
  }
  return { next, applied };
}

function centerValue(r, c) {
  return 3.5 - (Math.abs(r - 3.5) + Math.abs(c - 3.5));
}

function pieceScore(piece, r, c) {
  let value = TYPE_VALUE[piece.type];
  if (piece.royal) value += ROYAL_BONUS[piece.type];

  const center = centerValue(r, c);
  if (piece.type === 'p') {
    value += (piece.color === 'w' ? 6 - r : r - 1) * 7;
    value += center * 2;
  } else if (piece.type === 'n') {
    value += center * 6;
  } else if (piece.type === 'b') {
    value += center * 3;
  } else if (piece.type === 'r') {
    if ((piece.color === 'w' && r === 1) || (piece.color === 'b' && r === 6)) value += 18;
  } else if (piece.type === 'q') {
    value += center * 1.5;
  } else if (piece.type === 'k') {
    value += piece.royal ? -center * 1.5 : center * 2;
  }
  return value;
}

export function evaluate(state) {
  let white = 0;
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = at(state.board, r, c);
      if (!piece) continue;
      let value = pieceScore(piece, r, c);
      if (piece.royal && isSquareAttacked(state.board, r, c, OTHER(piece.color))) value -= 80;
      white += piece.color === 'w' ? value : -value;
    }
  }

  const opponent = OTHER(state.turn);
  if (inCheck(state, opponent)) white += state.turn === 'w' ? 26 : -26;
  if (inCheck(state, state.turn)) white += state.turn === 'w' ? -42 : 42;
  return state.turn === 'w' ? white : -white;
}

function orderMoves(moves, state) {
  return moves.map((move) => {
    let score = Math.random() * 2;
    if (move.capturedType) {
      score += 1000 + TYPE_VALUE[move.capturedType] * 3 - TYPE_VALUE[move.pieceType];
    }
    if (move.promo) score += 850;
    if (move.castle) score += 55;
    return { move, score };
  }).sort((a, b) => b.score - a.score).map((entry) => entry.move);
}

let searchDeadline = 0;

function checkTime() {
  if (Date.now() > searchDeadline) throw TIMEOUT;
}

function negamax(state, depth, alpha, beta, ply) {
  checkTime();
  const moves = getLegalMoves(state);

  if (moves.length === 0) {
    return inCheck(state, state.turn) ? -MATE + ply : 0;
  }
  if (depth <= 0) return evaluate(state);

  let best = -Infinity;
  for (const move of orderMoves(moves, state)) {
    const applied = applySearchMove(state, move);
    if (!applied) continue;
    const score = -negamax(applied.next, depth - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

function searchRoot(state, depth) {
  const moves = orderMoves(getLegalMoves(state), state);
  if (!moves.length) return { best: null, score: 0 };
  let best = moves[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;

  for (const move of moves) {
    checkTime();
    const applied = applySearchMove(state, move);
    if (!applied) continue;
    const score = -negamax(applied.next, depth - 1, -Infinity, -alpha, 1);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
    if (score > alpha) alpha = score;
  }
  return { best, score: bestScore };
}

function runSearch(state, maxDepth, budget) {
  searchDeadline = Date.now() + budget;
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  let ordered = orderMoves(legal, state);
  let best = ordered[0];

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    try {
      const result = searchRoot(state, depth);
      if (result.best) best = result.best;
    } catch (error) {
      if (error === TIMEOUT) break;
      throw error;
    }
  }
  return best;
}

export function chooseAIMove(state, difficulty = 'medium') {
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];

  if (difficulty === 'easy') {
    if (Math.random() < 0.35) return legal[Math.floor(Math.random() * legal.length)];
    return runSearch(state, 1, 300);
  }
  if (difficulty === 'hard') return runSearch(state, 3, 1200);
  return runSearch(state, 2, 700);
}

export function chooseHintMove(state) {
  const legal = getLegalMoves(state);
  if (!legal.length) return null;
  if (legal.length === 1) return legal[0];
  return runSearch(state, 2, 460) || legal[0];
}
