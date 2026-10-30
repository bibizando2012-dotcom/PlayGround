import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLACK,
  WHITE,
  allLegalMoves,
  applyMove,
  createEmptyState,
  createInitialState,
  getLegalMoves,
  indexOf,
  isInCheck,
  placePiece,
  refreshStatus,
  squareName,
} from '../src/engine.js';

function findMove(state, from, to) {
  return getLegalMoves(state, from).find(move => move.to === to);
}

function boardWithRoyal(color = WHITE) {
  const state = createEmptyState(color);
  placePiece(state, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(0, 4), BLACK, 'king', { royal: true });
  return state;
}

test('the opening position has 20 legal moves for White', () => {
  const state = createInitialState();
  assert.equal(allLegalMoves(state, WHITE).length, 20);
  assert.equal(allLegalMoves(state, BLACK).length, 20);
  assert.equal(state.board.filter(Boolean).length, 32);
});

test('a capture replaces the attacker power with the defender power', () => {
  const state = boardWithRoyal();
  const pawn = placePiece(state, indexOf(4, 3), WHITE, 'pawn', { moved: true });
  placePiece(state, indexOf(3, 4), BLACK, 'queen');

  state.turn = WHITE;
  const move = findMove(state, indexOf(4, 3), indexOf(3, 4));
  assert.ok(move?.capture);

  const next = applyMove(state, move);
  const survivor = next.board[indexOf(3, 4)];
  assert.equal(survivor.id, pawn.id);
  assert.equal(survivor.power, 'queen');
  assert.equal(next.board[indexOf(4, 3)], null);
  assert.equal(next.log.at(-1).powerBefore, 'pawn');
  assert.equal(next.log.at(-1).capturedPower, 'queen');
  assert.equal(next.log.at(-1).powerAfter, 'queen');
});

test('a knight that takes a pawn moves like a pawn afterward', () => {
  const state = boardWithRoyal();
  const knight = placePiece(state, indexOf(4, 4), WHITE, 'knight');
  placePiece(state, indexOf(2, 5), BLACK, 'pawn', { moved: true });
  state.turn = WHITE;

  const move = findMove(state, indexOf(4, 4), indexOf(2, 5));
  assert.ok(move?.capture);
  const next = applyMove(state, move);
  const survivor = next.board[indexOf(2, 5)];
  assert.equal(survivor.id, knight.id);
  assert.equal(survivor.power, 'pawn');

  const forward = indexOf(1, 5);
  assert.ok(getLegalMoves(next, indexOf(2, 5)).some(nextMove => nextMove.to === forward));
  assert.ok(!getLegalMoves(next, indexOf(2, 5)).some(nextMove => Math.abs(nextMove.to - indexOf(2, 5)) === 16));
});

test('a royal piece keeps its crown when its movement power swaps', () => {
  const state = createEmptyState(WHITE);
  placePiece(state, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(0, 0), BLACK, 'king', { royal: true });
  placePiece(state, indexOf(6, 4), BLACK, 'rook', { moved: true });
  state.turn = WHITE;

  const move = findMove(state, indexOf(7, 4), indexOf(6, 4));
  assert.ok(move?.capture);
  const next = applyMove(state, move);
  const royal = next.board[indexOf(6, 4)];
  assert.equal(royal.royal, true);
  assert.equal(royal.power, 'rook');
  assert.equal(next.board[indexOf(7, 4)], null);
});

test('check is detected from the attacker current power', () => {
  const state = createEmptyState(BLACK);
  placePiece(state, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(0, 0), BLACK, 'king', { royal: true });
  // A pawn-power piece on the same diagonal as the royal is not checking.
  placePiece(state, indexOf(4, 1), BLACK, 'pawn', { moved: true });
  assert.equal(isInCheck(state, WHITE), false);

  // Once that piece has bishop power, it attacks the king down the diagonal.
  state.board[indexOf(4, 1)].power = 'bishop';
  assert.equal(isInCheck(state, WHITE), true);
});

test('a move exposing the royal is illegal', () => {
  const state = createEmptyState(WHITE);
  placePiece(state, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(0, 0), BLACK, 'king', { royal: true });
  placePiece(state, indexOf(5, 4), WHITE, 'rook', { moved: true });
  placePiece(state, indexOf(3, 4), BLACK, 'rook', { moved: true });

  const rook = state.board[indexOf(5, 4)];
  const legal = getLegalMoves(state, indexOf(5, 4));
  assert.ok(legal.length > 0);
  for (const move of legal) {
    const next = applyMove(state, move);
    assert.equal(isInCheck(next, WHITE), false, `left king in check after ${squareName(move.to)}`);
  }
  assert.equal(rook.power, 'rook');
});

test('pawn promotion creates a queen power on the far rank', () => {
  const state = boardWithRoyal();
  const pawn = placePiece(state, indexOf(1, 0), WHITE, 'pawn', { moved: true });
  state.turn = WHITE;

  const move = findMove(state, indexOf(1, 0), indexOf(0, 0));
  assert.ok(move);
  const next = applyMove(state, move);
  assert.equal(next.board[indexOf(0, 0)].id, pawn.id);
  assert.equal(next.board[indexOf(0, 0)].power, 'queen');
  assert.equal(next.log.at(-1).promoted, true);
});

test('checkmate status is reported after a mating position', () => {
  const state = createEmptyState(BLACK);
  placePiece(state, indexOf(0, 7), BLACK, 'king', { royal: true });
  placePiece(state, indexOf(1, 5), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(2, 7), WHITE, 'queen', { moved: true });
  const next = refreshStatus(state);
  assert.equal(next.inCheck, true);
  assert.equal(next.status, 'checkmate');
  assert.equal(next.winner, WHITE);
});

test('castling is available while the king and rook retain their original powers', () => {
  const state = createEmptyState(WHITE);
  placePiece(state, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(0, 4), BLACK, 'king', { royal: true });
  placePiece(state, indexOf(7, 7), WHITE, 'rook');
  state.turn = WHITE;

  const castle = getLegalMoves(state, indexOf(7, 4)).find(move => move.castling === 'king');
  assert.ok(castle);
  const next = applyMove(state, castle);
  assert.equal(next.board[indexOf(7, 6)].royal, true);
  assert.equal(next.board[indexOf(7, 5)].power, 'rook');
  assert.equal(next.board[indexOf(7, 7)], null);
});

test('en passant captures the passed pawn and keeps a coherent board', () => {
  const state = createEmptyState(WHITE);
  placePiece(state, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(0, 4), BLACK, 'king', { royal: true });
  const whitePawn = placePiece(state, indexOf(3, 4), WHITE, 'pawn', { moved: true });
  const blackPawn = placePiece(state, indexOf(3, 5), BLACK, 'pawn', { moved: true });
  state.turn = WHITE;
  state.enPassant = indexOf(2, 5);

  const move = getLegalMoves(state, indexOf(3, 4)).find(candidate => candidate.enPassant);
  assert.ok(move);
  const next = applyMove(state, move);
  assert.equal(next.board[indexOf(3, 5)], null);
  assert.equal(next.board[indexOf(2, 5)].id, whitePawn.id);
  assert.equal(next.board[indexOf(2, 5)].power, blackPawn.power);
});
