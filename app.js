'use strict';

import {
  FILES, TYPE_NAME, TYPE_VALUE, OTHER,
  at, squareName, createInitialBoard, positionKey, getLegalMoves,
  getLegalMovesFrom, updateGameStatus, applyMoveToBoard, chooseAIMove,
  chooseHintMove, notationForMove, findRoyal,
} from './engine.js';

/* ── DOM ───────────────────────────────────────────────────── */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const boardEl = $('#board');
const piecesEl = $('#pieces');
const boardFrame = $('#boardFrame');
const captureFlash = $('#captureFlash');
const matchPillText = $('#matchPillText');
const turnTitle = $('#turnTitle');
const turnDesc = $('#turnDesc');
const thinkingDots = $('#thinkingDots');
const swapVisual = $('#swapVisual');
const swapText = $('#swapText');
const moveLogEl = $('#moveLog');
const coachEl = $('#coach');
const toastEl = $('#toast');
const fxCanvas = $('#fxCanvas');
const landingEl = $('#landing');
const barWhite = $('#barWhite');
const barBlack = $('#barBlack');
const blackName = $('#blackName');
const whiteName = $('#whiteName');
const blackStatus = $('#blackStatus');
const whiteStatus = $('#whiteStatus');
const blackMaterial = $('#blackMaterial');
const whiteMaterial = $('#whiteMaterial');
const capturedBlack = $('#capturedBlack');
const capturedWhite = $('#capturedWhite');
const mobileSwapVisual = $('#mobileSwapVisual');
const mobileSwapText = $('#mobileSwapText');
const mobileMoveCount = $('#mobileMoveCount');

const soundBtn = $('#soundBtn');
const settingsBtn = $('#settingsBtn');
const undoBtn = $('#undoBtn');
const hintBtn = $('#hintBtn');
const newBtn = $('#newBtn');
const tiltQuickBtn = $('#tiltQuickBtn');
const undoDesktopBtn = $('#undoDesktopBtn');
const hintDesktopBtn = $('#hintDesktopBtn');
const newDesktopBtn = $('#newDesktopBtn');
const playBtn = $('#playBtn');
const rulesBtn = $('#rulesBtn');
const modeSeg = $('#modeSeg');
const difficultySeg = $('#difficultySeg');
const difficultyLabel = $('#difficultyLabel');

const soundToggle = $('#soundToggle');
const tiltToggle = $('#tiltToggle');
const autoFlipToggle = $('#autoFlipToggle');
const coordsToggle = $('#coordsToggle');
const motionToggle = $('#motionToggle');
const calibrateBtn = $('#calibrateBtn');
const flipBtn = $('#flipBtn');
const tiltStatus = $('#tiltStatus');
const promoGrid = $('#promoGrid');
const promoCopy = $('#promoCopy');
const confirmNewBtn = $('#confirmNewBtn');
const rematchBtn = $('#rematchBtn');
const reviewBtn = $('#reviewBtn');
const gameOverTitle = $('#gameOverTitle');
const gameOverKicker = $('#gameOverKicker');
const gameOverCopy = $('#gameOverCopy');
const statMoves = $('#statMoves');
const statSwaps = $('#statSwaps');
const statTime = $('#statTime');
const resultCrown = $('#resultCrown');

/* ── Settings ──────────────────────────────────────────────── */

const SETTINGS_KEY = 'swapchess.settings.v1';
const DEFAULT_SETTINGS = {
  sound: true,
  tilt: false,
  autoFlip: false,
  coords: true,
  reduceMotion: false,
};

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: keep the session running */
  }
}

/* ── Sound ─────────────────────────────────────────────────── */

const Sound = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  },
  tone(frequency, duration, type = 'sine', volume = 0.035, delay = 0, slideTo = null) {
    if (!settings.sound) return;
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime + delay;
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (slideTo) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  },
  noise(duration = 0.12, volume = 0.04, delay = 0) {
    if (!settings.sound) return;
    this.init();
    if (!this.ctx) return;
    const length = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 900;
    filter.Q.value = 0.8;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.ctx.destination);
    source.start(this.ctx.currentTime + delay);
  },
  select() {
    this.tone(620, 0.035, 'sine', 0.022);
  },
  move() {
    this.tone(165, 0.075, 'sine', 0.05, 0, 118);
    this.tone(92, 0.09, 'triangle', 0.03, 0.01, 74);
  },
  capture() {
    this.noise(0.16, 0.055);
    this.tone(210, 0.09, 'triangle', 0.055, 0, 130);
    this.tone(760, 0.09, 'sine', 0.025, 0.02, 480);
  },
  check() {
    this.tone(740, 0.12, 'sine', 0.03);
    this.tone(980, 0.16, 'sine', 0.025, 0.08);
  },
  win() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      this.tone(frequency, 0.32, 'sine', 0.035, index * 0.1);
    });
  },
  lose() {
    [330, 277, 220, 165].forEach((frequency, index) => {
      this.tone(frequency, 0.28, 'triangle', 0.03, index * 0.11);
    });
  },
  error() {
    this.tone(145, 0.1, 'square', 0.018, 0, 110);
  },
};

function haptic(pattern) {
  if (settings.reduceMotion) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ── State ─────────────────────────────────────────────────── */

let state = null;
let pendingMode = 'ai';
let pendingDifficulty = 'medium';
let gameToken = 0;
let gameStartTime = Date.now();
let squareEls = new Map();
let pieceEls = new Map();
let builtOrientation = null;
let pendingPromo = null;
let toastTimer = 0;
let confettiFrame = 0;

function newGame({ mode = pendingMode, difficulty = pendingDifficulty, silent = false } = {}) {
  gameToken += 1;
  pendingPromo = null;
  piecesEl.innerHTML = '';
  pieceEls.clear();
  squareEls.clear();
  builtOrientation = null;

  state = {
    board: createInitialBoard(),
    turn: 'w',
    selected: null,
    legal: [],
    lastMove: null,
    enPassant: null,
    halfmove: 0,
    fullmove: 1,
    captured: { w: [], b: [] },
    moveLog: [],
    snapshots: [],
    status: 'playing',
    result: null,
    check: false,
    thinking: false,
    mode,
    difficulty,
    orientation: 'w',
    hint: null,
    lastSwap: null,
    lastMoveAt: 0,
    positionCounts: {},
    animateSpawn: true,
    started: true,
  };
  state.positionCounts[positionKey(state)] = 1;
  gameStartTime = Date.now();
  closeModal('gameOverModal', { quiet: true });
  closeModal('promoModal', { quiet: true });
  closeModal('confirmModal', { quiet: true });
  renderAll();
  if (!silent) {
    showToast('You are White. Every capture rewrites the board.', 2600);
  }
}

function snapshotState() {
  return {
    board: state.board.map((piece) => (piece ? { ...piece } : null)),
    turn: state.turn,
    enPassant: state.enPassant ? { ...state.enPassant } : null,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
    captured: { w: [...state.captured.w], b: [...state.captured.b] },
    moveLog: state.moveLog.map((move) => ({ ...move })),
    positionCounts: { ...state.positionCounts },
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastSwap: state.lastSwap ? { ...state.lastSwap } : null,
    status: state.status,
    result: state.result ? { ...state.result } : null,
    check: state.check,
    orientation: state.orientation,
    lastMoveAt: state.lastMoveAt,
  };
}

function restoreSnapshot(snapshot) {
  Object.assign(state, snapshot);
  state.snapshots = state.snapshots || [];
  state.thinking = false;
  state.selected = null;
  state.legal = [];
  state.hint = null;
  state.animateSpawn = false;
}

/* ── Match flow ────────────────────────────────────────────── */

function commitMove(move) {
  if (!state || state.status !== 'playing') return;
  const token = gameToken;
  const mover = at(state.board, move.from.r, move.from.c);
  if (!mover) return;

  state.snapshots.push(snapshotState());
  const applied = applyMoveToBoard(state.board, move);
  if (!applied) return;

  state.board = applied.board;
  const movedColor = mover.color;

  if (applied.captured) {
    state.captured[movedColor].push(applied.captured.type);
    state.lastSwap = {
      color: movedColor,
      fromType: move.pieceType,
      toType: applied.movedPiece.type,
      victimType: applied.captured.type,
      from: { ...move.from },
      to: { ...move.to },
      royal: mover.royal,
    };
  }

  if (move.pieceType === 'p' || applied.captured) state.halfmove = 0;
  else state.halfmove += 1;

  if (move.pieceType === 'p' && Math.abs(move.to.r - move.from.r) === 2) {
    state.enPassant = {
      r: (move.to.r + move.from.r) / 2,
      c: move.to.c,
      pawnR: move.to.r,
      pawnC: move.to.c,
      color: movedColor,
    };
  } else {
    state.enPassant = null;
  }

  state.turn = OTHER(state.turn);
  if (state.turn === 'w') state.fullmove += 1;

  state.lastMove = {
    ...move,
    color: movedColor,
    transformTo: applied.movedPiece.type,
    capturedType: applied.captured ? applied.captured.type : null,
    capturedSquare: applied.captured ? { ...move.to } : null,
  };

  state.selected = null;
  state.legal = [];
  state.hint = null;
  state.lastMoveAt = Date.now();

  const key = positionKey(state);
  state.positionCounts[key] = (state.positionCounts[key] || 0) + 1;
  updateGameStatus(state);
  const notation = notationForMove(move, applied, state);
  state.lastMove.notation = notation;
  state.moveLog.push({
    ply: state.moveLog.length + 1,
    san: notation,
    color: movedColor,
    capturedType: state.lastMove.capturedType,
    transformTo: state.lastMove.transformTo,
    from: { ...move.from },
    to: { ...move.to },
  });

  renderAll();

  if (applied.captured) {
    Sound.capture();
    haptic([16, 26, 34]);
    captureFx();
    showSwapToast(state.lastSwap);
  } else {
    Sound.move();
    haptic(8);
  }

  if (state.check && state.status === 'playing') {
    Sound.check();
    showToast('Check — the royal piece is exposed.', 1800);
  }

  if (state.status !== 'playing') {
    setTimeout(() => {
      if (token === gameToken) showGameOver();
    }, 520);
    return;
  }

  if (state.mode === 'ai' && state.turn === 'b') {
    scheduleAI();
  } else if (state.mode === 'local' && settings.autoFlip) {
    setTimeout(() => {
      if (token !== gameToken || state.status !== 'playing') return;
      if (state.orientation !== state.turn) {
        state.orientation = state.turn;
        builtOrientation = null;
        renderAll();
      }
    }, 420);
  }
}

function scheduleAI() {
  if (!state || state.mode !== 'ai' || state.status !== 'playing' || state.turn !== 'b' || state.thinking) return;
  const token = gameToken;
  state.thinking = true;
  renderHUD();

  setTimeout(() => {
    if (token !== gameToken || !state || state.status !== 'playing' || state.turn !== 'b') return;
    let move = null;
    try {
      move = chooseAIMove(state, state.difficulty);
    } catch (error) {
      console.error('Aura search failed', error);
    }
    if (token !== gameToken) return;
    state.thinking = false;
    if (move) {
      commitMove(move);
    } else {
      updateGameStatus(state);
      renderAll();
      if (state.status !== 'playing') showGameOver();
    }
  }, 460);
}

function undoMove() {
  if (!state || state.snapshots.length === 0) {
    showToast('Nothing to undo yet.', 1500);
    return;
  }
  gameToken += 1;
  state.thinking = false;
  pendingPromo = null;
  closeModal('promoModal', { quiet: true });

  let snapshot = state.snapshots.pop();
  restoreSnapshot(snapshot);
  if (state.mode === 'ai' && state.turn === 'b' && state.snapshots.length) {
    snapshot = state.snapshots.pop();
    restoreSnapshot(snapshot);
  }

  renderAll();
  Sound.select();
  haptic(6);
  showToast('Move undone.', 1400);
}

function requestHint() {
  if (!state || state.status !== 'playing') {
    showToast('The match is over. Start a rematch to keep playing.', 1800);
    return;
  }
  if (state.mode === 'ai' && state.turn === 'b') {
    showToast('Aura is still thinking.', 1400);
    return;
  }
  const move = chooseHintMove(state);
  if (!move) {
    showToast('No legal move available.', 1600);
    return;
  }
  state.hint = { from: { ...move.from }, to: { ...move.to } };
  renderAll();
  Sound.select();
  haptic(5);
  if (move.promo) {
    showToast(move.capturedType
      ? 'Hint: capture on the far rank — then choose its new power.'
      : 'Hint: promote on the far rank.', 2200);
  } else if (move.capturedType) {
    showToast(`Hint: capture and become a ${TYPE_NAME[move.capturedType].toLowerCase()}.`, 2200);
  } else {
    showToast('Hint: try the glowing move.', 1800);
  }
}

function handleSquareTap(r, c) {
  if (!state || pendingPromo) return;
  if (state.status !== 'playing') {
    showToast('The match is over. Rematch when you are ready.', 1700);
    return;
  }
  if (state.thinking || (state.mode === 'ai' && state.turn === 'b')) {
    showToast('Aura is thinking…', 1300);
    return;
  }

  const piece = at(state.board, r, c);

  if (state.selected) {
    const moves = state.legal.filter((move) => move.to.r === r && move.to.c === c);
    if (moves.length > 0) {
      if (moves[0].promo && moves.length > 1) {
        openPromotion(moves);
      } else {
        commitMove(moves[0]);
      }
      return;
    }

    if (piece && piece.color === state.turn) {
      selectPiece(r, c);
      return;
    }

    state.selected = null;
    state.legal = [];
    renderAll();
    Sound.error();
    showToast('That piece cannot move there.', 1300);
    return;
  }

  if (piece && piece.color === state.turn) {
    selectPiece(r, c);
  } else if (piece) {
    showToast(state.mode === 'ai' ? 'That is Aura’s piece.' : 'That piece belongs to the other player.', 1300);
  }
}

function selectPiece(r, c) {
  const piece = at(state.board, r, c);
  if (!piece || piece.color !== state.turn) return;
  if (state.selected && state.selected.r === r && state.selected.c === c) {
    state.selected = null;
    state.legal = [];
    renderAll();
    return;
  }
  state.selected = { r, c };
  state.legal = getLegalMovesFrom(state, r, c);
  state.hint = null;
  renderAll();
  Sound.select();
  haptic(5);
  if (state.legal.length === 0) {
    showToast('That piece has no legal moves right now.', 1500);
  }
}

function openPromotion(moves) {
  pendingPromo = moves;
  const royal = moves.some((move) => {
    const piece = at(state.board, move.from.r, move.from.c);
    return piece && piece.royal;
  });
  const sample = moves[0];
  const pawnMove = sample.pieceType === 'p';
  if (royal) {
    promoCopy.textContent = pawnMove
      ? 'Your royal pawn reached the far rank. It keeps its crown — choose its new movement.'
      : 'Your royal piece took a pawn on the far rank. A pawn cannot stay there — choose its new movement. The crown stays.';
  } else if (!pawnMove) {
    promoCopy.textContent = `Your ${TYPE_NAME[sample.pieceType].toLowerCase()} took a pawn on the far rank. A pawn cannot stay there — choose its new power.`;
  } else {
    promoCopy.textContent = 'Your pawn reached the far rank. What does it become?';
  }
  promoGrid.innerHTML = '';
  const seen = new Set();
  for (const move of moves) {
    if (seen.has(move.promo)) continue;
    seen.add(move.promo);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'promo-btn';
    button.dataset.type = move.promo;
    button.innerHTML = `<span class="icon-${state.turn}">${iconSvg(move.promo)}</span><span>${TYPE_NAME[move.promo]}</span>`;
    button.addEventListener('click', () => {
      const chosen = pendingPromo.find((candidate) => candidate.promo === move.promo);
      pendingPromo = null;
      closeModal('promoModal', { quiet: true });
      if (chosen) commitMove(chosen);
    });
    promoGrid.appendChild(button);
  }
  openModal('promoModal');
  const first = promoGrid.querySelector('button');
  if (first) first.focus({ preventScroll: true });
}

/* ── Rendering ─────────────────────────────────────────────── */

function iconSvg(type, className = 'piece-svg') {
  return `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true"><use href="#sym-${type}"></use></svg>`;
}

const CROWN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8Z" fill="#1b150c"/></svg>';

function renderAll() {
  if (!state) return;
  buildBoardIfNeeded();
  renderSquares();
  renderPieces(state.animateSpawn);
  renderHUD();
  state.animateSpawn = false;
}

function buildBoardIfNeeded() {
  if (builtOrientation === state.orientation && squareEls.size === 64) return;
  boardEl.innerHTML = '';
  squareEls.clear();

  for (let displayRow = 0; displayRow < 8; displayRow += 1) {
    for (let displayCol = 0; displayCol < 8; displayCol += 1) {
      const r = state.orientation === 'w' ? displayRow : 7 - displayRow;
      const c = state.orientation === 'w' ? displayCol : 7 - displayCol;
      const square = document.createElement('button');
      square.type = 'button';
      square.className = `square ${(r + c) % 2 === 1 ? 'dark' : 'light'}`;
      square.dataset.r = String(r);
      square.dataset.c = String(c);
      square.setAttribute('role', 'gridcell');
      square.setAttribute('aria-rowindex', String(displayRow + 1));
      square.setAttribute('aria-colindex', String(displayCol + 1));
      square.addEventListener('click', () => handleSquareTap(r, c));
      square.addEventListener('keydown', (event) => handleBoardKey(event, displayRow, displayCol));
      boardEl.appendChild(square);
      squareEls.set(`${r},${c}`, square);
    }
  }

  updateCoords();
  builtOrientation = state.orientation;
}

function updateCoords() {
  const files = state.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
  const ranks = state.orientation === 'w'
    ? [8, 7, 6, 5, 4, 3, 2, 1]
    : [1, 2, 3, 4, 5, 6, 7, 8];
  $$('.coords-top span, .coords-bottom span').forEach((span, index) => {
    span.textContent = files[index] || '';
  });
  $$('.coords-left span, .coords-right span').forEach((span, index) => {
    span.textContent = String(ranks[index] || '');
  });
}

function handleBoardKey(event, displayRow, displayCol) {
  const moves = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
  };
  const delta = moves[event.key];
  if (!delta) return;
  event.preventDefault();
  const nextRow = clamp(displayRow + delta[0], 0, 7);
  const nextCol = clamp(displayCol + delta[1], 0, 7);
  const r = state.orientation === 'w' ? nextRow : 7 - nextRow;
  const c = state.orientation === 'w' ? nextCol : 7 - nextCol;
  const square = squareEls.get(`${r},${c}`);
  if (square) square.focus();
}

function renderSquares() {
  const checkRoyal = state.check ? findRoyal(state.board, state.turn) : null;
  const lastMove = state.lastMove;
  const hint = state.hint;

  const targets = new Map();
  for (const move of state.legal) {
    const key = `${move.to.r},${move.to.c}`;
    if (!targets.has(key)) targets.set(key, move);
  }

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const square = squareEls.get(`${r},${c}`);
      if (!square) continue;
      const piece = at(state.board, r, c);
      const classes = ['square', (r + c) % 2 === 1 ? 'dark' : 'light'];

      if (lastMove && lastMove.from.r === r && lastMove.from.c === c) classes.push('last-from');
      if (lastMove && lastMove.to.r === r && lastMove.to.c === c) classes.push('last-to');
      if (state.selected && state.selected.r === r && state.selected.c === c) classes.push('selected');
      if (checkRoyal && checkRoyal.r === r && checkRoyal.c === c) classes.push('in-check');
      if (hint && hint.from.r === r && hint.from.c === c) classes.push('hint-from');
      if (hint && hint.to.r === r && hint.to.c === c) classes.push('hint-to');

      square.className = classes.join(' ');
      square.querySelectorAll('.move-hint, .swap-preview').forEach((node) => node.remove());

      const move = targets.get(`${r},${c}`);
      if (move) {
        const capture = Boolean(move.capturedType);
        const marker = document.createElement('span');
        marker.className = `move-hint ${capture ? 'capture' : 'quiet'}`;
        square.appendChild(marker);

        if (capture) {
          const victimColor = move.enPassant
            ? OTHER(state.turn)
            : (at(state.board, move.to.r, move.to.c)?.color || OTHER(state.turn));
          const badge = document.createElement('span');
          badge.className = 'swap-preview';
          badge.innerHTML = `<span class="icon-${victimColor}">${iconSvg(move.capturedType, 'mini-svg')}</span>`;
          square.appendChild(badge);
        } else if (move.promo) {
          const badge = document.createElement('span');
          badge.className = 'swap-preview promo-preview';
          badge.innerHTML = `<span class="icon-${state.turn}">${iconSvg(move.promo, 'mini-svg')}</span>`;
          square.appendChild(badge);
        }
      }

      const pieceLabel = piece ? `, ${piece.color === 'w' ? 'white' : 'black'} ${TYPE_NAME[piece.type].toLowerCase()}` : '';
      const legalLabel = move ? (move.capturedType ? ', capture and swap power' : ', legal move') : '';
      square.setAttribute('aria-label', `${squareName(r, c)}${pieceLabel}${legalLabel}`);
      square.setAttribute('aria-selected', state.selected && state.selected.r === r && state.selected.c === c ? 'true' : 'false');
    }
  }
}

function renderPieces(spawn = false) {
  const seen = new Set();

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const piece = at(state.board, r, c);
      if (!piece) continue;
      seen.add(piece.id);

      const displayRow = state.orientation === 'w' ? r : 7 - r;
      const displayCol = state.orientation === 'w' ? c : 7 - c;
      let element = pieceEls.get(piece.id);

      if (!element) {
        element = document.createElement('div');
        element.dataset.id = piece.id;
        element.className = 'piece';
        element.innerHTML = `<div class="piece-inner">${iconSvg(piece.type)}<span class="royal-badge" hidden>${CROWN_SVG}</span></div>`;
        element.style.setProperty('--r', String(displayRow));
        element.style.setProperty('--c', String(displayCol));
        piecesEl.appendChild(element);
        pieceEls.set(piece.id, element);
        if (spawn) {
          element.classList.add('spawning');
          setTimeout(() => element.classList.remove('spawning'), 520);
        }
      }

      const previousType = element.dataset.type;
      element.className = `piece ${piece.color === 'w' ? 'white' : 'black'} type-${piece.type}${piece.royal ? ' royal' : ''}`;
      element.dataset.type = piece.type;
      element.dataset.color = piece.color;
      element.style.setProperty('--r', String(displayRow));
      element.style.setProperty('--c', String(displayCol));
      element.style.zIndex = String(10 + displayRow + (piece.royal ? 1 : 0));

      const use = element.querySelector('use');
      if (use && previousType !== piece.type) use.setAttribute('href', `#sym-${piece.type}`);
      const badge = element.querySelector('.royal-badge');
      if (badge) badge.hidden = !piece.royal;

      if (previousType && previousType !== piece.type) {
        element.classList.add('swapping');
        setTimeout(() => element.classList.remove('swapping'), 520);
      }

      if (state.selected && state.selected.r === r && state.selected.c === c) element.classList.add('selected');
      if (piece.royal && state.check && piece.color === state.turn) element.classList.add('in-check');
    }
  }

  for (const [id, element] of Array.from(pieceEls.entries())) {
    if (seen.has(id)) continue;
    pieceEls.delete(id);
    element.classList.add('captured');
    setTimeout(() => element.remove(), 300);
  }
}

function renderHUD() {
  if (!state) return;

  const isPlaying = state.status === 'playing';
  barWhite.classList.toggle('active', isPlaying && state.turn === 'w');
  barBlack.classList.toggle('active', isPlaying && state.turn === 'b');

  blackName.textContent = state.mode === 'ai' ? 'AURA' : 'BLACK';
  whiteName.textContent = state.mode === 'ai' ? 'YOU' : 'WHITE';
  blackStatus.textContent = state.mode === 'ai' && state.thinking ? 'Thinking' : 'Black';
  whiteStatus.textContent = 'White';

  const difference = materialScore('w') - materialScore('b');
  whiteMaterial.textContent = difference > 0 ? `+${Math.round(difference / 100)}` : '';
  blackMaterial.textContent = difference < 0 ? `+${Math.round(-difference / 100)}` : '';

  renderCaptured(capturedWhite, state.captured.w, 'b');
  renderCaptured(capturedBlack, state.captured.b, 'w');
  renderTurnCard();
  renderSwapCard();
  renderMoveLog();
  updateTiltUI();

  document.body.dataset.turn = state.turn;
  document.body.dataset.check = String(state.check);
  soundBtn.classList.toggle('is-muted', !settings.sound);
  soundBtn.setAttribute('aria-pressed', String(!settings.sound));
  soundBtn.setAttribute('aria-label', settings.sound ? 'Mute sound' : 'Unmute sound');
}

function renderTurnCard() {
  const winner = state.result?.winner;
  let title = 'Your move';
  let desc = 'Tap a piece, then tap a highlighted square.';
  let pill = 'Your move';
  let coach = 'Tap a piece. Captures swap powers.';

  if (state.status === 'checkmate') {
    if (state.mode === 'ai') {
      title = winner === 'w' ? 'You win.' : 'Aura wins.';
      desc = winner === 'w'
        ? 'The enemy crown has nowhere left to go.'
        : 'Aura found the finish. The crown is trapped.';
    } else {
      title = winner === 'w' ? 'White wins.' : 'Black wins.';
      desc = 'The losing crown has no legal escape.';
    }
    pill = 'Checkmate';
    coach = 'Checkmate. The match is complete.';
  } else if (state.status === 'stalemate') {
    title = 'Stalemate.';
    desc = 'No legal moves, but no check. The crown is safe and trapped.';
    pill = 'Draw';
    coach = 'Stalemate — the match is a draw.';
  } else if (state.status === 'draw') {
    title = 'Draw.';
    if (state.result?.reason === 'fifty-move') desc = 'Fifty moves without a capture or pawn move.';
    else if (state.result?.reason === 'threefold') desc = 'The same position appeared three times.';
    else desc = 'Neither side can force a finish.';
    pill = 'Draw';
    coach = 'The match is a draw.';
  } else if (state.thinking) {
    title = 'Aura is thinking';
    desc = 'Reading the board for the best swap.';
    pill = 'Aura is thinking';
    coach = 'Aura is reading the board…';
  } else if (state.check) {
    title = 'Check.';
    desc = 'Your royal piece is under attack. Find a safe square or block the line.';
    pill = 'Check';
    coach = 'Check — your royal piece is under attack.';
  } else if (state.mode === 'ai' && state.turn === 'b') {
    title = 'Aura’s move';
    desc = 'The board is hers for a moment. Watch the power lines.';
    pill = 'Aura’s move';
    coach = 'Aura is choosing a move…';
  } else if (state.selected) {
    const count = new Set(state.legal.map((move) => `${move.to.r},${move.to.c}`)).size;
    const captures = state.legal.some((move) => move.capturedType);
    title = state.mode === 'ai' && state.turn === 'w' ? 'Your move' : `${state.turn === 'w' ? 'White' : 'Black'} to move`;
    desc = `${count} legal destination${count === 1 ? '' : 's'}.${captures ? ' Captures will swap powers.' : ''}`;
    pill = `${count} move${count === 1 ? '' : 's'}`;
    coach = `${count} destination${count === 1 ? '' : 's'}. Tap one to move.`;
  } else if (state.mode === 'local') {
    title = `${state.turn === 'w' ? 'White' : 'Black'} to move`;
    desc = 'Pass the device when your move is finished.';
    pill = `${state.turn === 'w' ? 'White' : 'Black'} to move`;
    coach = `${state.turn === 'w' ? 'White' : 'Black'} to move. Captures swap powers.`;
  }

  if (state.mode === 'ai' && state.turn === 'w' && state.status === 'playing' && !state.thinking && !state.check) {
    pill = 'Your move';
  }
  if (state.mode === 'ai' && state.turn === 'b' && state.status === 'playing' && !state.thinking) {
    pill = 'Aura’s move';
  }

  turnTitle.textContent = title;
  turnDesc.textContent = desc;
  matchPillText.textContent = pill;
  coachEl.innerHTML = coach;
  thinkingDots.classList.toggle('show', state.thinking);
}

function renderCaptured(container, list, capturedColor) {
  container.innerHTML = '';
  const shown = list.slice(0, 7);
  for (const type of shown) {
    const item = document.createElement('span');
    item.className = `captured-mini icon-${capturedColor}`;
    item.innerHTML = iconSvg(type, 'mini-svg');
    container.appendChild(item);
  }
  if (list.length > shown.length) {
    const more = document.createElement('span');
    more.className = 'captured-more';
    more.textContent = `+${list.length - shown.length}`;
    container.appendChild(more);
  }
}

function renderSwapCard() {
  let visual;
  let text;

  if (!state.lastSwap) {
    visual = `
      <span class="swap-icon icon-white">${iconSvg('p')}</span>
      <span class="swap-arrow" aria-hidden="true">→</span>
      <span class="swap-icon icon-white">${iconSvg('q')}</span>`;
    text = 'Every capture transfers the fallen piece’s power to the survivor.';
  } else {
    const swap = state.lastSwap;
    const iconClass = `icon-${swap.color}`;
    visual = `
      <span class="swap-icon ${iconClass}">${iconSvg(swap.fromType)}</span>
      <span class="swap-arrow" aria-hidden="true">→</span>
      <span class="swap-icon ${iconClass}">${iconSvg(swap.toType)}</span>`;

    const mover = swap.color === 'w' ? 'White' : 'Black';
    const fromName = TYPE_NAME[swap.fromType].toLowerCase();
    const victimName = TYPE_NAME[swap.victimType].toLowerCase();
    const toName = TYPE_NAME[swap.toType].toLowerCase();
    const prefix = swap.royal ? 'The royal piece' : `${mover} ${fromName}`;
    text = fromName === toName
      ? `${prefix} took a ${victimName}. Its power stayed the same.`
      : `${prefix} took a ${victimName}. It is now a <span class="accent">${toName}</span>.`;
  }

  swapVisual.innerHTML = visual;
  swapText.innerHTML = text;
  if (mobileSwapVisual) {
    mobileSwapVisual.innerHTML = visual;
    mobileSwapText.innerHTML = text;
    const moves = Math.ceil(state.moveLog.length / 2);
    mobileMoveCount.textContent = `${moves} move${moves === 1 ? '' : 's'}`;
  }
}

function renderMoveLog() {
  if (!state.moveLog.length) {
    moveLogEl.innerHTML = '<div class="empty-log">The board is waiting.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (let index = 0; index < state.moveLog.length; index += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const whiteMove = state.moveLog[index];
    const blackMove = state.moveLog[index + 1];
    row.innerHTML = `
      <span class="move-num">${index / 2 + 1}.</span>
      <span class="move-san ${index === state.moveLog.length - 1 ? 'is-last' : ''}">${escapeHTML(whiteMove.san)}</span>
      <span class="move-san ${index + 1 === state.moveLog.length - 1 ? 'is-last' : ''}">${blackMove ? escapeHTML(blackMove.san) : ''}</span>`;
    fragment.appendChild(row);
  }
  moveLogEl.innerHTML = '';
  moveLogEl.appendChild(fragment);
  moveLogEl.scrollTop = moveLogEl.scrollHeight;
}

function materialScore(color) {
  let total = 0;
  for (const piece of state.board) {
    if (!piece || piece.color !== color || piece.royal) continue;
    total += TYPE_VALUE[piece.type] || 0;
  }
  return total;
}

function showToast(html, duration = 2200) {
  toastEl.innerHTML = html;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), duration);
}

function showSwapToast(swap) {
  if (!swap) return;
  const fromName = TYPE_NAME[swap.fromType].toLowerCase();
  const victimName = TYPE_NAME[swap.victimType].toLowerCase();
  const toName = TYPE_NAME[swap.toType].toLowerCase();
  const mover = swap.color === 'w' ? 'White' : 'Black';
  if (fromName === toName) {
    showToast(`${mover} ${fromName} took ${victimName}. Power unchanged.`, 2200);
  } else {
    showToast(`${mover} ${fromName} took ${victimName} — now a <span class="toast-gold">${toName}</span>.`, 2500);
  }
}

function captureFx() {
  captureFlash.classList.remove('active');
  void captureFlash.offsetWidth;
  captureFlash.classList.add('active');
  window.setTimeout(() => captureFlash.classList.remove('active'), 460);

  if (!settings.reduceMotion) {
    boardFrame.classList.remove('shake');
    void boardFrame.offsetWidth;
    boardFrame.classList.add('shake');
    window.setTimeout(() => boardFrame.classList.remove('shake'), 360);
  }
}

/* ── Modals and results ───────────────────────────────────── */

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  window.requestAnimationFrame(() => {
    const focusable = modal.querySelector('.close-btn, .promo-btn, .primary-btn, .secondary-btn');
    if (focusable) focusable.focus({ preventScroll: true });
  });
}

function closeModal(id, { quiet = false } = {}) {
  const modal = document.getElementById(id);
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  if (id === 'promoModal' && !quiet) pendingPromo = null;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('modal-open');
}

function showGameOver() {
  if (!state || state.status === 'playing') return;
  const winner = state.result?.winner;
  let title = 'Draw';
  let kicker = 'Match complete';
  let copy = 'Neither side can force a finish.';

  if (state.status === 'checkmate') {
    kicker = 'Checkmate';
    if (state.mode === 'ai') {
      title = winner === 'w' ? 'You win.' : 'Aura wins.';
      copy = winner === 'w'
        ? 'A perfect finish. The enemy crown has nowhere left to go.'
        : 'Aura found the finish. The crown has nowhere left to go.';
    } else {
      title = winner === 'w' ? 'White wins.' : 'Black wins.';
      copy = 'The losing crown has no legal escape. A clean checkmate.';
    }
  } else if (state.status === 'stalemate') {
    kicker = 'Stalemate';
    title = 'Draw.';
    copy = 'No legal moves, but no check. The crown is safe and trapped.';
  } else if (state.status === 'draw') {
    kicker = 'Draw';
    title = 'Draw.';
    if (state.result?.reason === 'fifty-move') copy = 'Fifty moves without a capture or pawn move.';
    else if (state.result?.reason === 'threefold') copy = 'The same position appeared three times.';
  }

  gameOverKicker.textContent = kicker;
  gameOverTitle.textContent = title;
  gameOverCopy.textContent = copy;
  statMoves.textContent = String(Math.ceil(state.moveLog.length / 2));
  statSwaps.textContent = String(state.moveLog.filter((move) => move.capturedType).length);
  statTime.textContent = formatTime(Date.now() - gameStartTime);
  resultCrown.classList.toggle('is-win', winner === 'w' || state.mode === 'local');

  openModal('gameOverModal');

  const humanWon = state.mode === 'ai' ? winner === 'w' : Boolean(winner);
  if (humanWon) {
    Sound.win();
    launchConfetti();
  } else if (state.status === 'checkmate') {
    Sound.lose();
  }
}

function formatTime(milliseconds) {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function launchConfetti() {
  if (settings.reduceMotion) return;
  const canvas = fxCanvas;
  const context = canvas.getContext('2d');
  if (!context) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#d8b36a', '#f0d69a', '#f4edde', '#31565c', '#e47767'];
  const particles = Array.from({ length: 110 }, () => ({
    x: window.innerWidth / 2 + (Math.random() - 0.5) * 150,
    y: window.innerHeight * 0.28 + (Math.random() - 0.5) * 30,
    vx: (Math.random() - 0.5) * 10,
    vy: -Math.random() * 10 - 3,
    size: 2 + Math.random() * 5,
    color: colors[Math.floor(Math.random() * colors.length)],
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.25,
  }));

  const started = performance.now();
  const duration = 3000;
  if (confettiFrame) window.cancelAnimationFrame(confettiFrame);

  function frame(now) {
    const elapsed = now - started;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (elapsed > duration) {
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      confettiFrame = 0;
      return;
    }
    const alpha = 1 - elapsed / duration;
    for (const particle of particles) {
      particle.vy += 0.22;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.rotation += particle.spin;
      context.save();
      context.globalAlpha = alpha;
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 1.6);
      context.restore();
    }
    confettiFrame = window.requestAnimationFrame(frame);
  }
  confettiFrame = window.requestAnimationFrame(frame);
}

/* ── Settings, tilt and controls ──────────────────────────── */

const tilt = {
  handler: null,
  baseline: null,
  last: null,
  timer: 0,
  denied: false,
};

function applyBodySettings() {
  document.body.classList.toggle('hide-coords', !settings.coords);
  document.body.classList.toggle('no-motion', settings.reduceMotion);
  document.body.classList.toggle('tilt-enabled', settings.tilt);
}

function updateTiltUI() {
  if (!tiltQuickBtn) return;
  tiltQuickBtn.classList.toggle('is-active', settings.tilt);
  tiltQuickBtn.setAttribute('aria-pressed', String(settings.tilt));
  tiltToggle.checked = settings.tilt;
  if (settings.tilt) {
    tiltStatus.textContent = tilt.last
      ? 'Tilt is on. Move your device to look around. Touch always works.'
      : 'Tilt is on. Waiting for motion data…';
  } else if (tilt.denied) {
    tiltStatus.textContent = 'Motion access was not granted. Touch controls always work.';
  } else {
    tiltStatus.textContent = 'Tilt is optional. Touch controls always work.';
  }
}

function syncSettingsUI() {
  soundToggle.checked = settings.sound;
  tiltToggle.checked = settings.tilt;
  autoFlipToggle.checked = settings.autoFlip;
  coordsToggle.checked = settings.coords;
  motionToggle.checked = settings.reduceMotion;
  soundBtn.classList.toggle('is-muted', !settings.sound);
  applyBodySettings();
  updateTiltUI();
}

async function enableTilt({ silent = false } = {}) {
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    tilt.denied = true;
    settings.tilt = false;
    saveSettings();
    syncSettingsUI();
    if (!silent) showToast('Tilt is not available on this device. Touch controls still work.', 2400);
    return false;
  }

  try {
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await window.DeviceOrientationEvent.requestPermission();
      if (permission !== 'granted') {
        tilt.denied = true;
        settings.tilt = false;
        saveSettings();
        syncSettingsUI();
        if (!silent) showToast('Motion access was not granted. Touch controls still work.', 2600);
        return false;
      }
    }

    if (!tilt.handler) {
      tilt.handler = handleOrientation;
      window.addEventListener('deviceorientation', tilt.handler, true);
    }
    tilt.denied = false;
    settings.tilt = true;
    saveSettings();
    syncSettingsUI();
    if (!silent) showToast('Tilt view on. Move your device to look around.', 2400);

    window.clearTimeout(tilt.timer);
    tilt.timer = window.setTimeout(() => {
      if (settings.tilt && !tilt.last && !silent) {
        showToast('No motion data yet. Touch controls still work.', 2200);
      }
    }, 1800);
    return true;
  } catch (error) {
    console.error('Motion permission failed', error);
    tilt.denied = true;
    settings.tilt = false;
    saveSettings();
    syncSettingsUI();
    if (!silent) showToast('Motion access could not be enabled. Touch controls still work.', 2600);
    return false;
  }
}

function disableTilt({ silent = false } = {}) {
  if (tilt.handler) {
    window.removeEventListener('deviceorientation', tilt.handler, true);
    tilt.handler = null;
  }
  window.clearTimeout(tilt.timer);
  tilt.baseline = null;
  tilt.last = null;
  settings.tilt = false;
  saveSettings();
  boardFrame.style.setProperty('--tilt-x', '0');
  boardFrame.style.setProperty('--tilt-y', '0');
  document.body.classList.remove('tilt-active');
  syncSettingsUI();
  if (!silent) showToast('Tilt view off.', 1400);
}

function handleOrientation(event) {
  if (!settings.tilt) return;
  if (event.beta == null && event.gamma == null) return;
  tilt.last = {
    beta: Number(event.beta) || 0,
    gamma: Number(event.gamma) || 0,
  };

  if (!tilt.baseline) {
    tilt.baseline = { ...tilt.last };
    tiltStatus.textContent = 'Tilt ready. Move your device to look around.';
    return;
  }

  if (settings.reduceMotion) return;
  const dx = clamp((tilt.last.gamma - tilt.baseline.gamma) / 26, -1, 1);
  const dy = clamp((tilt.last.beta - tilt.baseline.beta) / 30, -1, 1);
  boardFrame.style.setProperty('--tilt-y', (dx * 5).toFixed(2));
  boardFrame.style.setProperty('--tilt-x', (-dy * 3.5).toFixed(2));
  document.body.classList.add('tilt-active');
}

function calibrateTilt() {
  if (!settings.tilt) {
    showToast('Turn on tilt view first.', 1600);
    return;
  }
  if (!tilt.last) {
    showToast('Waiting for motion data from this device…', 1900);
    return;
  }
  tilt.baseline = { ...tilt.last };
  boardFrame.style.setProperty('--tilt-x', '0');
  boardFrame.style.setProperty('--tilt-y', '0');
  showToast('Tilt calibrated to your current position.', 1700);
}

function toggleSound() {
  settings.sound = !settings.sound;
  saveSettings();
  syncSettingsUI();
  if (state) renderHUD();
  if (settings.sound) Sound.select();
  showToast(settings.sound ? 'Sound on.' : 'Sound off.', 1300);
}

function startNewGame() {
  closeModal('confirmModal', { quiet: true });
  closeModal('gameOverModal', { quiet: true });
  const mode = state?.mode || pendingMode;
  const difficulty = state?.difficulty || pendingDifficulty;
  newGame({ mode, difficulty });
}

function requestNewGame() {
  if (state && state.status === 'playing' && state.moveLog.length > 0) {
    openModal('confirmModal');
  } else {
    startNewGame();
  }
}

function flipBoard() {
  if (!state) return;
  state.orientation = OTHER(state.orientation);
  builtOrientation = null;
  renderAll();
  closeModal('settingsModal');
  showToast('Board flipped.', 1200);
}

function setMode(mode) {
  pendingMode = mode;
  $$('.seg-btn[data-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });
  const isAI = mode === 'ai';
  difficultyLabel.hidden = !isAI;
  difficultySeg.hidden = !isAI;
}

function setDifficulty(difficulty) {
  pendingDifficulty = difficulty;
  $$('.seg-btn[data-difficulty]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.difficulty === difficulty);
  });
}

function setupEvents() {
  playBtn.addEventListener('click', () => {
    Sound.init();
    Sound.select();
    landingEl.hidden = true;
    document.body.classList.remove('at-landing');
    newGame({ mode: pendingMode, difficulty: pendingDifficulty });
  });

  rulesBtn.addEventListener('click', () => openModal('rulesModal'));
  settingsBtn.addEventListener('click', () => {
    syncSettingsUI();
    openModal('settingsModal');
  });

  $$('.seg-btn[data-mode]').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  $$('.seg-btn[data-difficulty]').forEach((button) => {
    button.addEventListener('click', () => setDifficulty(button.dataset.difficulty));
  });

  soundBtn.addEventListener('click', toggleSound);
  undoBtn.addEventListener('click', undoMove);
  hintBtn.addEventListener('click', requestHint);
  newBtn.addEventListener('click', requestNewGame);
  undoDesktopBtn.addEventListener('click', undoMove);
  hintDesktopBtn.addEventListener('click', requestHint);
  newDesktopBtn.addEventListener('click', requestNewGame);

  soundToggle.addEventListener('change', () => {
    settings.sound = soundToggle.checked;
    saveSettings();
    syncSettingsUI();
    if (state) renderHUD();
    if (settings.sound) Sound.select();
  });

  tiltToggle.addEventListener('change', async () => {
    if (tiltToggle.checked) {
      const enabled = await enableTilt();
      if (!enabled) tiltToggle.checked = false;
    } else {
      disableTilt();
    }
  });

  tiltQuickBtn.addEventListener('click', async () => {
    if (settings.tilt) {
      disableTilt();
    } else {
      const enabled = await enableTilt();
      if (!enabled) tiltQuickBtn.classList.remove('is-active');
    }
  });

  autoFlipToggle.addEventListener('change', () => {
    settings.autoFlip = autoFlipToggle.checked;
    saveSettings();
    syncSettingsUI();
  });
  coordsToggle.addEventListener('change', () => {
    settings.coords = coordsToggle.checked;
    saveSettings();
    syncSettingsUI();
    if (state) renderAll();
  });
  motionToggle.addEventListener('change', () => {
    settings.reduceMotion = motionToggle.checked;
    saveSettings();
    syncSettingsUI();
    if (settings.reduceMotion) {
      boardFrame.style.setProperty('--tilt-x', '0');
      boardFrame.style.setProperty('--tilt-y', '0');
    }
  });

  calibrateBtn.addEventListener('click', calibrateTilt);
  flipBtn.addEventListener('click', flipBoard);
  confirmNewBtn.addEventListener('click', startNewGame);
  rematchBtn.addEventListener('click', startNewGame);
  reviewBtn.addEventListener('click', () => closeModal('gameOverModal'));

  document.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close]');
    if (!close) return;
    const id = close.dataset.close;
    if (id === 'promoModal') pendingPromo = null;
    closeModal(id);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = $$('.modal:not([hidden])').pop();
    if (open) {
      if (open.id === 'promoModal') pendingPromo = null;
      closeModal(open.id);
      return;
    }
    if (state && state.selected) {
      state.selected = null;
      state.legal = [];
      renderAll();
    }
  });

  window.addEventListener('resize', () => {
    if (confettiFrame) {
      window.cancelAnimationFrame(confettiFrame);
      confettiFrame = 0;
      const context = fxCanvas.getContext('2d');
      if (context) context.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    }
  });
}

function init() {
  applyBodySettings();
  syncSettingsUI();
  setupEvents();
  newGame({ silent: true });
  landingEl.hidden = false;
  document.body.classList.add('at-landing');

  if (settings.tilt) {
    const needsPermission = typeof window.DeviceOrientationEvent !== 'undefined'
      && typeof window.DeviceOrientationEvent.requestPermission === 'function';
    if (!needsPermission && typeof window.DeviceOrientationEvent !== 'undefined') {
      enableTilt({ silent: true });
    } else {
      settings.tilt = false;
      saveSettings();
      syncSettingsUI();
    }
  }
}

if (new URLSearchParams(window.location.search).has('debug')) {
  window.__swapChess = {
    get state() { return state; },
    getLegalMoves,
    getLegalMovesFrom,
    updateGameStatus,
    renderAll,
    showGameOver,
  };
}

init();
