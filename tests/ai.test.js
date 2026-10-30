import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLACK,
  WHITE,
  applyMove,
  createEmptyState,
  createInitialState,
  getLegalMoves,
  indexOf,
  placePiece,
  refreshStatus,
} from '../src/engine.js';
import { chooseAiMove, evaluatePosition } from '../src/ai.js';

test('the engine returns a legal move for the side to move', () => {
  const state = createInitialState();
  const move = chooseAiMove(state, { depth: 2 });
  assert.ok(move);
  const legal = getLegalMoves(state, move.from);
  assert.ok(legal.some(candidate => candidate.to === move.to));
});

test('the engine can complete a legal reply after a White opening move', () => {
  let state = createInitialState();
  const opening = getLegalMoves(state, indexOf(6, 4)).find(move => move.to === indexOf(4, 4));
  state = applyMove(state, opening);
  const reply = chooseAiMove(state, { depth: 1 });
  assert.ok(reply);
  assert.ok(getLegalMoves(state, reply.from).some(move => move.to === reply.to));
});

test('the engine returns null when the game is already over', () => {
  const state = createEmptyState(BLACK);
  placePiece(state, indexOf(0, 7), BLACK, 'king', { royal: true });
  placePiece(state, indexOf(1, 5), WHITE, 'king', { royal: true });
  placePiece(state, indexOf(2, 7), WHITE, 'queen', { moved: true });
  refreshStatus(state);
  assert.equal(state.status, 'checkmate');
  assert.equal(chooseAiMove(state, { depth: 2 }), null);
});

test('evaluation rewards keeping more valuable movement powers', () => {
  const rich = createEmptyState(WHITE);
  placePiece(rich, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(rich, indexOf(0, 4), BLACK, 'king', { royal: true });
  placePiece(rich, indexOf(4, 4), WHITE, 'queen');

  const poor = createEmptyState(WHITE);
  placePiece(poor, indexOf(7, 4), WHITE, 'king', { royal: true });
  placePiece(poor, indexOf(0, 4), BLACK, 'king', { royal: true });
  placePiece(poor, indexOf(4, 4), WHITE, 'pawn');

  assert.ok(evaluatePosition(rich, WHITE) > evaluatePosition(poor, WHITE));
});
