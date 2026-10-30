# Swap Chess

A phone- and tablet-first chess variant where **every capture transfers the fallen piece's movement power to the survivor**. Take a queen with a pawn and your pawn becomes a queen. Take a pawn with a queen and your queen becomes a pawn.

- **Touch-first board** with tap-to-select, legal-move dots, capture-swap previews, undo, and hints.
- **Play Aura**, an alpha-beta AI with Calm, Sharp, and Ruthless settings, or pass and play locally.
- **Optional tilt view** that gently parallaxes the board using device motion. iOS motion permission is requested from the in-game control.
- **Full chess rules**: castling, en passant, promotion, check, checkmate, stalemate, threefold repetition, and the fifty-move rule — all layered under the power-swap capture rule.
- **Royal pieces keep their crown** when their movement changes, so a king can become a royal knight, rook, bishop, or pawn.
- **No build step, no dependencies.** Plain HTML, CSS, and ES modules.

## Run locally

Any static server works:

```bash
npx serve .
# or
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

Add `?debug=1` to expose `window.__swapChess` for inspection and automated tests.

## Rules in one breath

Move like standard chess. When you capture, your piece inherits the captured piece's movement type. The king remains royal no matter what it becomes. If a capture would leave a pawn stranded on the far rank, it promotes and you choose its new power.

## Files

- `index.html` — page structure, SVG piece symbols, sheets and modals
- `styles.css` — responsive visual system, board, landing, mobile dock, tilt transforms
- `engine.js` — pure rules engine, move generation, status detection, AI search
- `app.js` — UI state, rendering, input, sound, haptics, tilt, and modals
- `favicon.svg` — site icon

---

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://omgithub.com).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://omgithub.com/bibizando2012-dotcom/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/bibizando2012-dotcom/PlayGround)

- 🎮 [Open the project](https://omgithub.com/bibizando2012-dotcom/PlayGround).
- ✨ [Remix this project](https://omgithub.com/?remix=bibizando2012-dotcom%2FPlayGround).
- 💻 [Explore the source](https://github.com/bibizando2012-dotcom/PlayGround).
- 🛠️ [Check build runs](https://github.com/bibizando2012-dotcom/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/bibizando2012-dotcom/PlayGround/issues).
- 👤 [Explore the creator's projects](https://omgithub.com/bibizando2012-dotcom).
- 🌍 [Create with OMGithub](https://omgithub.com).
<!-- omgithub:readme:end -->
