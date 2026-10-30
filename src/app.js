import {
  BLACK,
  WHITE,
  POWER_DESCRIPTIONS,
  POWER_GLYPHS,
  POWER_NAMES,
  applyMove,
  colOf,
  createInitialState,
  findRoyal,
  getLegalMoves,
  rowOf,
  squareName,
} from './engine.js';
import { chooseAiMove } from './ai.js';
import { Soundscape } from './audio.js';

const $ = id => document.getElementById(id);
const appShell = document.querySelector('.app-shell');

const boardGrid = $('boardGrid');
const piecesLayer = $('piecesLayer');
const effectsLayer = $('effectsLayer');
const boardStage = $('boardStage');
const moveTrace = $('moveTrace');
const traceLine = $('traceLine');

const sfx = new Soundscape();
let game = createInitialState();
let mode = readPreference('swapchess-mode', 'ai');
let pendingMode = mode;
let orientation = 'w';
let selected = null;
let legalMoves = [];
let undoStack = [];
let busy = false;
let aiTimer = null;
let gameOverShown = false;
let pieceElements = new Map();
let renderedPowers = new Map();
let lastPointerFrame = 0;
let motionEnabled = false;
let motionBaseline = null;
let motionHandler = null;
let motionProbe = null;
let lastFocusedElement = null;

function readPreference(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences are nice to have, not required.
  }
}

function haptic(duration = 8) {
  if (typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(duration);
    } catch {
      // Haptics are optional.
    }
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildDust() {
  const dust = $('dust');
  for (let index = 0; index < 22; index += 1) {
    const mote = document.createElement('i');
    mote.style.left = `${4 + Math.random() * 91}%`;
    mote.style.top = `${24 + Math.random() * 68}%`;
    mote.style.setProperty('--float-time', `${12 + Math.random() * 15}s`);
    mote.style.setProperty('--float-delay', `${-Math.random() * 20}s`);
    mote.style.opacity = `${0.15 + Math.random() * 0.5}`;
    dust.append(mote);
  }
}

function buildBoard() {
  boardGrid.innerHTML = '';
  for (let displayRow = 0; displayRow < 8; displayRow += 1) {
    for (let displayCol = 0; displayCol < 8; displayCol += 1) {
      const displayIndex = displayRow * 8 + displayCol;
      const index = orientation === 'w' ? displayIndex : 63 - displayIndex;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `cell ${(rowOf(index) + colOf(index)) % 2 === 0 ? 'light' : 'dark'}`;
      cell.dataset.index = String(index);
      cell.setAttribute('aria-label', `${squareName(index)}, empty`);
      cell.addEventListener('click', () => chooseSquare(index));

      if (displayCol === 0) {
        const rank = document.createElement('span');
        rank.className = 'coord rank';
        rank.textContent = String(8 - rowOf(index));
        cell.append(rank);
      }
      if (displayRow === 7) {
        const file = document.createElement('span');
        file.className = 'coord';
        file.textContent = 'abcdefgh'[colOf(index)];
        cell.append(file);
      }

      boardGrid.append(cell);
    }
  }
}

function visualIndex(index) {
  return orientation === 'w' ? index : 63 - index;
}

function pieceLabel(piece) {
  const side = piece.color === WHITE ? 'ivory' : 'ember';
  return `${side} ${POWER_NAMES[piece.power].toLowerCase()}${piece.royal ? ', royal' : ''}`;
}

function renderBoard() {
  const checkIndex = game.inCheck ? findRoyal(game, game.turn) : -1;
  const lastFrom = game.lastMove?.from;
  const lastTo = game.lastMove?.to;
  const legalByTarget = new Map(legalMoves.map(move => [move.to, move]));

  for (const cell of boardGrid.children) {
    const index = Number(cell.dataset.index);
    const piece = game.board[index];
    const move = legalByTarget.get(index);
    cell.classList.toggle('is-selected', selected === index);
    cell.classList.toggle('is-last', index === lastFrom || index === lastTo);
    cell.classList.toggle('is-legal', Boolean(move));
    cell.classList.toggle('is-capture', Boolean(move?.capture));
    cell.classList.toggle('is-check', index === checkIndex);
    cell.setAttribute('aria-pressed', selected === index ? 'true' : 'false');

    const stateBits = [];
    if (piece) stateBits.push(pieceLabel(piece));
    else stateBits.push('empty');
    if (move) stateBits.push(move.capture ? 'legal capture' : 'legal move');
    if (index === checkIndex) stateBits.push('in check');
    cell.setAttribute('aria-label', `${squareName(index)}, ${stateBits.join(', ')}`);
  }
}

function createPieceElement(piece, index) {
  const element = document.createElement('div');
  element.className = `piece ${piece.color === WHITE ? 'ivory' : 'ember'}`;
  element.dataset.pieceId = piece.id;
  element.innerHTML = `<svg class="piece-svg" viewBox="0 0 512 512" aria-hidden="true"><use href="#power-${piece.power}"></use></svg>`;
  const visual = visualIndex(index);
  element.style.setProperty('--col', String(colOf(visual)));
  element.style.setProperty('--row', String(rowOf(visual)));
  piecesLayer.append(element);
  return element;
}

function renderPieces() {
  const activeIds = new Set();
  const initialRender = pieceElements.size === 0;

  for (let index = 0; index < 64; index += 1) {
    const piece = game.board[index];
    if (!piece) continue;
    activeIds.add(piece.id);

    let element = pieceElements.get(piece.id);
    if (!element) {
      element = createPieceElement(piece, index);
      pieceElements.set(piece.id, element);
      if (initialRender) {
        element.classList.add('is-spawning');
        element.style.animationDelay = `${Math.abs(rowOf(index) - 6) * 22 + colOf(index) * 10}ms`;
        setTimeout(() => element.classList.remove('is-spawning'), 900);
      }
    }

    const visual = visualIndex(index);
    element.style.setProperty('--col', String(colOf(visual)));
    element.style.setProperty('--row', String(rowOf(visual)));
    element.classList.toggle('ivory', piece.color === WHITE);
    element.classList.toggle('ember', piece.color === BLACK);
    element.classList.toggle('is-selected', selected === index);
    element.dataset.power = piece.power;
    element.dataset.royal = piece.royal ? 'true' : 'false';

    const previousPower = renderedPowers.get(piece.id);
    if (previousPower && previousPower !== piece.power) {
      element.classList.remove('is-swapping');
      void element.offsetWidth;
      element.classList.add('is-swapping');
      setTimeout(() => element.classList.remove('is-swapping'), 760);
    }

    const use = element.querySelector('use');
    const href = `#power-${piece.power}`;
    if (use.getAttribute('href') !== href) use.setAttribute('href', href);
    renderedPowers.set(piece.id, piece.power);
  }

  for (const [id, element] of pieceElements) {
    if (activeIds.has(id)) continue;
    element.classList.add('is-captured');
    pieceElements.delete(id);
    renderedPowers.delete(id);
    setTimeout(() => element.remove(), 520);
  }
}

function logEntryToLedger(entry) {
  const colorClass = entry.color === WHITE ? 'ivory' : 'ember';
  const capturedName = POWER_NAMES[entry.capturedPower];
  const moverName = POWER_NAMES[entry.powerBefore];
  const swapped = entry.powerBefore !== entry.powerAfter;
  const swapText = swapped
    ? `${POWER_NAMES[entry.powerBefore]} <i>→</i> ${POWER_NAMES[entry.powerAfter]}`
    : `${POWER_NAMES[entry.powerAfter]} <i>held</i>`;
  return `
    <li class="ledger-item">
      <span class="ledger-sigil ${colorClass}"><svg viewBox="0 0 512 512" aria-hidden="true"><use href="#power-${entry.capturedPower}"></use></svg></span>
      <span class="ledger-copy">
        <strong>${moverName} takes ${capturedName}</strong>
        <small>${entry.square} · MOVE ${String(entry.number).padStart(2, '0')}</small>
      </span>
      <span class="ledger-swap ${entry.color === BLACK ? 'is-ember' : ''}">${swapText}</span>
    </li>
  `;
}

function renderLedger() {
  const captures = game.log.filter(entry => entry.capture);
  $('swapCount').textContent = `${captures.length} SWAP${captures.length === 1 ? '' : 'S'}`;
  const list = $('ledgerList');

  if (captures.length === 0) {
    list.innerHTML = `
      <li class="ledger-empty">
        <span class="ledger-empty-mark" aria-hidden="true">⇄</span>
        <span>The first capture rewires the game.</span>
      </li>
    `;
    return;
  }

  list.innerHTML = captures.slice(-8).reverse().map(logEntryToLedger).join('');
}

function renderCaptured() {
  const ivory = [];
  const ember = [];
  for (const entry of game.log) {
    if (!entry.capture) continue;
    if (entry.color === WHITE) ivory.push(entry.capturedPower);
    if (entry.color === BLACK) ember.push(entry.capturedPower);
  }

  renderTray($('ivoryCaptured'), ivory, 'ivory', 'No captures yet');
  renderTray($('emberCaptured'), ember, 'ember', 'No captures yet');
}

function renderTray(container, powers, colorClass, emptyText) {
  if (powers.length === 0) {
    container.innerHTML = `<span class="captured-empty">${emptyText}</span>`;
    return;
  }
  container.innerHTML = powers.slice(-10).map(power => `
    <span class="captured-mini ${colorClass}" title="${POWER_NAMES[power]}">
      <svg viewBox="0 0 512 512" aria-hidden="true"><use href="#power-${power}"></use></svg>
    </span>
  `).join('');
}

function renderHud() {
  const isAiTurn = mode === 'ai' && game.turn === BLACK;
  const isOver = game.status === 'checkmate' || game.status === 'stalemate';
  const selectedPiece = selected == null ? null : game.board[selected];

  $('moveCount').textContent = `MOVE ${String(game.moveNumber).padStart(2, '0')}`;
  $('turnOrb').classList.toggle('is-ember', game.turn === BLACK);
  $('turnOrbLetter').textContent = game.turn === WHITE ? '♔' : '♚';

  if (isOver) {
    if (game.status === 'checkmate') {
      const winner = game.winner === WHITE ? 'Ivory' : 'Ember';
      $('turnTitle').textContent = 'Checkmate';
      $('turnHint').textContent = `${winner} takes the crown.`;
    } else {
      $('turnTitle').textContent = 'Stalemate';
      $('turnHint').textContent = 'No legal move. The board rests.';
    }
  } else if (isAiTurn) {
    $('turnTitle').textContent = busy ? 'The Rift is thinking' : 'The Rift moves';
    $('turnHint').textContent = busy ? 'Reading every power on the board…' : 'The engine is considering its reply.';
  } else if (game.inCheck) {
    $('turnTitle').textContent = 'Check.';
    $('turnHint').textContent = selectedPiece
      ? `${POWER_NAMES[selectedPiece.power]} power selected · break the line.`
      : 'Break the line, block, or move the crown.';
  } else if (selectedPiece) {
    $('turnTitle').textContent = `${POWER_NAMES[selectedPiece.power]} power`;
    $('turnHint').textContent = legalMoves.length
      ? `${POWER_DESCRIPTIONS[selectedPiece.power]} Tap a glow.`
      : `${POWER_DESCRIPTIONS[selectedPiece.power]} No legal move.`;
  } else if (mode === 'local') {
    $('turnTitle').textContent = game.turn === WHITE ? 'Ivory to move' : 'Ember to move';
    $('turnHint').textContent = 'Tap a piece to reveal its power path.';
  } else {
    $('turnTitle').textContent = 'Your move';
    $('turnHint').textContent = 'Tap a piece to reveal its path.';
  }

  $('selfName').textContent = mode === 'ai' ? 'YOU' : 'IVORY';
  $('opponentName').textContent = mode === 'ai' ? 'THE RIFT' : 'EMBER';
  $('playerSub').textContent = mode === 'ai'
    ? 'Ivory · protect the crown'
    : 'Ivory · local player';
  $('aiStatus').textContent = mode === 'ai'
    ? (busy ? 'Rift engine · calculating' : 'Rift engine · watching')
    : 'Ember · local player';

  $('ivoryBeacon').classList.toggle('is-active', game.turn === WHITE && !isOver);
  $('emberBeacon').classList.toggle('is-active', game.turn === BLACK && !isOver);
  $('thinkingDots').classList.toggle('is-visible', busy && mode === 'ai');

  const topAvatar = $('opponentStrip').querySelector('.avatar span');
  const selfAvatar = $('selfStrip').querySelector('.avatar span');
  if (topAvatar) topAvatar.textContent = mode === 'ai' ? 'R' : 'E';
  if (selfAvatar) selfAvatar.textContent = mode === 'ai' ? 'Y' : 'I';

  renderPowerCard(selectedPiece);
  updateControlState();
}

function renderPowerCard(piece) {
  const sigil = $('powerSigil');
  const use = $('powerSigilUse');
  const gem = $('powerGem');

  if (!piece) {
    $('powerKicker').textContent = 'MOVEMENT POWER';
    $('powerName').textContent = 'Select a piece';
    $('powerDesc').textContent = 'Capture to inherit its movement.';
    use.setAttribute('href', '#power-pawn');
    sigil.classList.remove('is-ember');
    gem.classList.remove('is-ember');
    return;
  }

  const colorClass = piece.color === WHITE ? 'ivory' : 'ember';
  $('powerKicker').textContent = `${POWER_NAMES[piece.power].toUpperCase()} · ${colorClass.toUpperCase()}`;
  $('powerName').textContent = `${POWER_NAMES[piece.power]} power`;
  $('powerDesc').textContent = POWER_DESCRIPTIONS[piece.power];
  use.setAttribute('href', `#power-${piece.power}`);
  sigil.classList.toggle('is-ember', piece.color === BLACK);
  gem.classList.toggle('is-ember', piece.color === BLACK);
}

function updateControlState() {
  $('undoBtn').disabled = busy || undoStack.length === 0;
  $('flipBtn').disabled = busy;
  $('modeChip').setAttribute('aria-label', `Game mode: ${mode === 'ai' ? 'versus The Rift' : 'local duel'}. Change mode`);
}

function renderAll() {
  renderBoard();
  renderPieces();
  renderHud();
  renderLedger();
  renderCaptured();
}

function chooseSquare(index) {
  sfx.unlock();
  if (busy) return;
  if (game.status === 'checkmate' || game.status === 'stalemate') return;
  if (mode === 'ai' && game.turn === BLACK) return;

  const piece = game.board[index];

  if (selected != null) {
    const move = legalMoves.find(candidate => candidate.to === index);
    if (move) {
      commitMove(move);
      return;
    }
  }

  if (piece && piece.color === game.turn) {
    if (selected === index) {
      clearSelection();
      return;
    }
    selectSquare(index);
    return;
  }

  if (selected != null) {
    clearSelection();
    if (piece || index != null) {
      const cell = boardGrid.querySelector(`.cell[data-index="${index}"]`);
      cell?.classList.add('is-denied');
      setTimeout(() => cell?.classList.remove('is-denied'), 280);
    }
  }
}

function selectSquare(index) {
  selected = index;
  legalMoves = getLegalMoves(game, index);
  sfx.select();
  haptic(8);
  renderBoard();
  renderPieces();
  renderHud();
}

function clearSelection() {
  selected = null;
  legalMoves = [];
  renderBoard();
  renderPieces();
  renderHud();
}

function scheduleAi() {
  if (mode !== 'ai' || game.turn !== BLACK) return;
  busy = true;
  renderHud();
  renderBoard();
  clearTimeout(aiTimer);
  const thinkTime = 380 + Math.floor(Math.random() * 330);
  aiTimer = setTimeout(() => {
    if (mode !== 'ai' || game.turn !== BLACK) {
      busy = false;
      renderHud();
      return;
    }
    const move = chooseAiMove(game, { depth: 2 });
    busy = false;
    if (!move) {
      renderAll();
      maybeShowResult();
      return;
    }
    commitMove(move, { fromAi: true });
  }, thinkTime);
}

function commitMove(move, options = {}) {
  const target = game.board[move.enPassant ? move.capturedIndex : move.to];
  const movingPiece = game.board[move.from];
  if (!movingPiece) return;

  const snapshot = structuredClone(game);
  undoStack.push(snapshot);
  selected = null;
  legalMoves = [];

  game = applyMove(game, move);
  const entry = game.log[game.log.length - 1];

  renderAll();
  drawTrace(move.from, move.to);

  if (target) {
    sparkBurst(move.to, movingPiece.color === WHITE ? 'ivory' : 'ember');
    sfx.capture();
    haptic(24);
    showSwapToast(entry);
  } else {
    sfx.move();
    haptic(8);
  }

  if (game.inCheck && game.status !== 'checkmate') {
    sfx.check();
  }

  if (game.status === 'checkmate' || game.status === 'stalemate') {
    setTimeout(maybeShowResult, 720);
    return;
  }

  if (mode === 'ai' && game.turn === BLACK && !options.fromAi) {
    scheduleAi();
  } else {
    renderHud();
  }
}

function drawTrace(from, to) {
  const fromVisual = visualIndex(from);
  const toVisual = visualIndex(to);
  traceLine.setAttribute('x1', String((colOf(fromVisual) + 0.5) * 100));
  traceLine.setAttribute('y1', String((rowOf(fromVisual) + 0.5) * 100));
  traceLine.setAttribute('x2', String((colOf(toVisual) + 0.5) * 100));
  traceLine.setAttribute('y2', String((rowOf(toVisual) + 0.5) * 100));
  moveTrace.classList.remove('is-visible');
  void moveTrace.getBoundingClientRect();
  moveTrace.classList.add('is-visible');
  setTimeout(() => moveTrace.classList.remove('is-visible'), 680);
}

function sparkBurst(index, color) {
  const visual = visualIndex(index);
  const left = (colOf(visual) + 0.5) * 12.5;
  const top = (rowOf(visual) + 0.5) * 12.5;
  const sparkColor = color === 'ivory' ? '#ffd98e' : '#ff8f8e';
  const ring = document.createElement('span');
  ring.className = 'ring-burst';
  ring.style.left = `${(colOf(visual) + 0.5) * 12.5 - 6.25}%`;
  ring.style.top = `${(rowOf(visual) + 0.5) * 12.5 - 6.25}%`;
  ring.style.borderColor = color === 'ivory' ? 'rgba(255,224,154,.8)' : 'rgba(255,137,137,.8)';
  effectsLayer.append(ring);
  setTimeout(() => ring.remove(), 680);

  for (let sparkIndex = 0; sparkIndex < 10; sparkIndex += 1) {
    const spark = document.createElement('span');
    spark.className = 'spark';
    const angle = (Math.PI * 2 * sparkIndex) / 10 + Math.random() * 0.3;
    const distance = 18 + Math.random() * 30;
    spark.style.left = `${left}%`;
    spark.style.top = `${top}%`;
    spark.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    spark.style.setProperty('--spark-color', sparkColor);
    spark.style.animationDelay = `${Math.random() * 50}ms`;
    effectsLayer.append(spark);
    setTimeout(() => spark.remove(), 800);
  }
}

function showSwapToast(entry) {
  const toast = $('swapToast');
  const swapped = entry.powerBefore !== entry.powerAfter;
  $('swapToastIcon').textContent = POWER_GLYPHS[entry.powerAfter];
  $('swapToastText').textContent = swapped
    ? `${POWER_NAMES[entry.powerBefore]} → ${POWER_NAMES[entry.powerAfter]}`
    : `${POWER_NAMES[entry.powerAfter]} power held`;
  toast.classList.remove('is-visible');
  void toast.offsetWidth;
  toast.classList.add('is-visible');
  clearTimeout(showSwapToast.timer);
  showSwapToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 1900);
}

function showToast(message, duration = 2600) {
  const toast = $('systemToast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), duration);
}

function maybeShowResult() {
  if (gameOverShown) return;
  if (game.status !== 'checkmate' && game.status !== 'stalemate') return;
  gameOverShown = true;

  const modal = $('resultModal');
  const isLoss = mode === 'ai' && game.winner === BLACK;
  const isDraw = game.status === 'stalemate';
  const emberWins = game.winner === BLACK;
  modal.querySelector('.result-modal').classList.toggle('is-loss', emberWins);
  $('resultKicker').textContent = isDraw ? 'STALEMATE' : 'MATCH COMPLETE';

  if (isDraw) {
    $('resultTitle').innerHTML = 'Neither crown<br><em>will fall.</em>';
    $('resultLede').textContent = 'No legal move remains. The powers settle into a perfect deadlock.';
  } else if (mode === 'ai' && game.winner === WHITE) {
    $('resultTitle').innerHTML = 'You take<br><em>the crown.</em>';
    $('resultLede').textContent = 'The Rift bows. Every stolen power led to this square.';
  } else if (isLoss) {
    $('resultTitle').innerHTML = 'The Rift<br><em>claims the crown.</em>';
    $('resultLede').textContent = 'A hard-fought board. The powers have chosen their side.';
  } else {
    const winnerName = game.winner === WHITE ? 'Ivory' : 'Ember';
    $('resultTitle').innerHTML = `${winnerName} takes<br><em>the crown.</em>`;
    $('resultLede').textContent = 'A local duel settled on the board. The powers remember every move.';
  }

  $('resultMoves').textContent = String(Math.ceil(game.log.length / 2));
  $('resultSwaps').textContent = String(game.log.filter(entry => entry.capture).length);
  $('resultCaptures').textContent = String(game.log.filter(entry => entry.capture).length);

  if (isLoss) sfx.defeat();
  else if (!isDraw) sfx.victory();

  openModal('resultModal');
}

function resetGame() {
  clearTimeout(aiTimer);
  game = createInitialState();
  undoStack = [];
  selected = null;
  legalMoves = [];
  busy = false;
  gameOverShown = false;
  orientation = 'w';
  pieceElements = new Map();
  renderedPowers = new Map();
  piecesLayer.innerHTML = '';
  effectsLayer.innerHTML = '';
  closeModal('resultModal');
  closeModal('modeModal');
  buildBoard();
  renderAll();
  showToast(mode === 'ai' ? 'New match. You have the ivory.' : 'New match. Ivory moves first.');
}

function undoMove() {
  if (busy || undoStack.length === 0) return;
  clearTimeout(aiTimer);
  let snapshot = undoStack.pop();
  if (mode === 'ai' && snapshot?.turn === BLACK) {
    snapshot = undoStack.pop() || snapshot;
  }
  if (!snapshot) return;
  game = snapshot;
  selected = null;
  legalMoves = [];
  gameOverShown = false;
  closeModal('resultModal');
  renderAll();
  sfx.move();
  showToast('Move unwound. The board remembers.');
}

function flipBoard() {
  if (busy) return;
  orientation = orientation === 'w' ? 'b' : 'w';
  selected = null;
  legalMoves = [];
  buildBoard();
  renderBoard();
  renderPieces();
  renderPowerCard(null);
  sfx.select();
  showToast(orientation === 'w' ? 'Ivory view' : 'Ember view');
}

function renderModeOptions(selectedMode) {
  document.querySelectorAll('.mode-option').forEach(button => {
    const isSelected = button.dataset.mode === selectedMode;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });
}

function applyMode(nextMode) {
  mode = nextMode === 'local' ? 'local' : 'ai';
  pendingMode = mode;
  writePreference('swapchess-mode', mode);
  renderModeOptions(mode);
  $('modeChipText').textContent = mode === 'ai' ? 'VS RIFT' : 'LOCAL DUEL';
}

function openModePicker() {
  pendingMode = mode;
  renderModeOptions(pendingMode);
  openModal('modeModal');
}

function openModal(id) {
  const layer = $(id);
  if (!layer) return;
  if (!document.querySelector('.modal-layer.is-open')) {
    lastFocusedElement = document.activeElement;
    appShell.inert = true;
  }
  layer.classList.add('is-open');
  layer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => {
    const focusTarget = layer.querySelector('[data-autofocus], .modal-primary, button');
    focusTarget?.focus({ preventScroll: true });
  }, 120);
}

function closeModal(id) {
  const layer = $(id);
  if (!layer) return;
  layer.classList.remove('is-open');
  layer.setAttribute('aria-hidden', 'true');
  if (!document.querySelector('.modal-layer.is-open')) {
    document.body.classList.remove('modal-open');
    appShell.inert = false;
    if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus({ preventScroll: true });
    }
    lastFocusedElement = null;
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-layer.is-open').forEach(layer => closeModal(layer.id));
}

function toggleSound() {
  const next = !sfx.enabled;
  sfx.setEnabled(next);
  writePreference('swapchess-sound', next ? 'on' : 'off');
  updateSoundButton();
  if (next) {
    sfx.select();
    showToast('Sound on');
  }
}

function updateSoundButton() {
  const button = $('soundBtn');
  button.setAttribute('aria-pressed', sfx.enabled ? 'true' : 'false');
  button.setAttribute('aria-label', sfx.enabled ? 'Mute sound' : 'Enable sound');
}

function applyTilt(rx, ry) {
  boardStage.style.setProperty('--board-rx', `${clamp(rx, -6, 6).toFixed(2)}deg`);
  boardStage.style.setProperty('--board-ry', `${clamp(ry, -10, 10).toFixed(2)}deg`);
}

function handleMotion(event) {
  if (!motionEnabled) return;
  if (event.beta == null && event.gamma == null) return;
  const beta = Number.isFinite(event.beta) ? event.beta : 0;
  const gamma = Number.isFinite(event.gamma) ? event.gamma : 0;
  if (!motionBaseline) {
    motionBaseline = { beta, gamma };
    clearTimeout(motionProbe);
  }
  const deltaBeta = clamp(beta - motionBaseline.beta, -26, 26);
  const deltaGamma = clamp(gamma - motionBaseline.gamma, -32, 32);
  applyTilt(-deltaBeta * 0.2, deltaGamma * 0.25);
}

async function toggleTilt() {
  if (motionEnabled) {
    disableTilt();
    showToast('Tilt off');
    return;
  }

  if (!('DeviceOrientationEvent' in window)) {
    showToast('Tilt is not available on this device.');
    return;
  }

  let granted = true;
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      granted = (await DeviceOrientationEvent.requestPermission()) === 'granted';
    } catch {
      granted = false;
    }
  }

  if (!granted) {
    showToast('Motion access was declined. Touch controls are ready.');
    return;
  }

  motionEnabled = true;
  motionBaseline = null;
  motionHandler = handleMotion;
  window.addEventListener('deviceorientation', motionHandler, true);
  clearTimeout(motionProbe);
  motionProbe = setTimeout(() => {
    if (motionEnabled && !motionBaseline) {
      disableTilt();
      showToast('No motion sensor detected. Touch controls remain.');
    }
  }, 1400);
  $('tiltBtn').setAttribute('aria-pressed', 'true');
  $('tiltBtn').setAttribute('aria-label', 'Disable tilt');
  $('tiltReadout').textContent = 'TILT ACTIVE';
  showToast('Tilt enabled. Move the device to look around.');
  sfx.select();
}

function disableTilt() {
  motionEnabled = false;
  motionBaseline = null;
  clearTimeout(motionProbe);
  motionProbe = null;
  if (motionHandler) window.removeEventListener('deviceorientation', motionHandler, true);
  motionHandler = null;
  applyTilt(0, 0);
  $('tiltBtn').setAttribute('aria-pressed', 'false');
  $('tiltBtn').setAttribute('aria-label', 'Enable tilt');
  $('tiltReadout').textContent = 'TOUCH / MOUSE';
}

function bindPointerParallax() {
  if (!window.matchMedia('(pointer: fine)').matches) return;
  const shell = $('boardShell');
  shell.addEventListener('pointermove', event => {
    if (motionEnabled) return;
    const now = performance.now();
    if (now - lastPointerFrame < 32) return;
    lastPointerFrame = now;
    const rect = shell.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    applyTilt(-y * 2.6, x * 3.4);
  });
  shell.addEventListener('pointerleave', () => {
    if (!motionEnabled) applyTilt(0, 0);
  });
}

function bindEvents() {
  $('tiltBtn').addEventListener('click', toggleTilt);
  $('soundBtn').addEventListener('click', toggleSound);
  $('rulesBtn').addEventListener('click', () => openModal('rulesModal'));
  $('modeChip').addEventListener('click', openModePicker);
  $('newBtn').addEventListener('click', openModePicker);
  $('undoBtn').addEventListener('click', undoMove);
  $('flipBtn').addEventListener('click', flipBoard);
  $('rematchBtn').addEventListener('click', () => {
    closeModal('resultModal');
    resetGame();
  });

  document.querySelectorAll('[data-close-modal]').forEach(button => {
    button.addEventListener('click', () => closeModal(button.dataset.closeModal));
  });

  document.querySelectorAll('.mode-option').forEach(button => {
    button.addEventListener('click', () => {
      pendingMode = button.dataset.mode === 'local' ? 'local' : 'ai';
      renderModeOptions(pendingMode);
      sfx.select();
    });
  });
  $('startMatchBtn').addEventListener('click', () => {
    applyMode(pendingMode);
    resetGame();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeAllModals();
    if (event.key === 'Tab') {
      const openLayers = [...document.querySelectorAll('.modal-layer.is-open')];
      const layer = openLayers[openLayers.length - 1];
      if (layer) {
        const focusables = [...layer.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
          .filter(element => !element.disabled && element.offsetParent !== null);
        if (focusables.length > 0) {
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    }
    if ((event.key === 'z' || event.key === 'Z') && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      undoMove();
    }
  });

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', () => {
      const layer = backdrop.closest('.modal-layer');
      if (layer) closeModal(layer.id);
    });
  });

  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true, capture: true });
  document.addEventListener('keydown', () => sfx.unlock(), { once: true, capture: true });
}

function init() {
  buildDust();
  buildBoard();
  bindEvents();
  bindPointerParallax();
  applyMode(mode);
  const savedSound = readPreference('swapchess-sound', 'on');
  sfx.enabled = savedSound !== 'off';
  updateSoundButton();
  renderAll();
  requestAnimationFrame(() => document.body.classList.add('is-ready'));
}

init();
