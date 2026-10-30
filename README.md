# PlayGround

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

## Swapchess

A complete, mobile-first chess variant where **every capture rewires the board**. The surviving attacker inherits the fallen piece's movement power: a pawn can take a queen's diagonal reach, a knight can be reduced to a pawn's single step, and a king can lose its royal gait without losing its crown.

### Play

- **VS The Rift** — a fast built-in alpha-beta opponent.
- **Local Duel** — two players share one phone or tablet.
- Tap a piece, then tap a highlighted square. Captures show a power-swap toast, a movement trace, and a running power ledger.
- Flip the board, undo a move (or a full player/engine pair), and start a new match at any time.
- Optional **tilt** adds gentle board parallax. On iOS, the app calls `DeviceOrientationEvent.requestPermission()` from the tilt button, so the motion prompt is tied to a user gesture.

### Rules in one breath

1. Pieces move according to the **power shown on the piece**.
2. A capture transfers the defender's power to the attacker; the attacker's old power leaves with the fallen piece.
3. Kings remain royal even when their movement changes. Checkmate and stalemate still end the match.
4. Pawn-power pieces promote to queen power on the far rank. Castling and en passant are supported while the original powers and move flags allow them.

### Run locally

No build step or dependencies are required:

```sh
python3 -m http.server 3000
# open http://localhost:3000
```

Run the rules and engine tests with Node 20+:

```sh
node --test tests/*.test.js
```

### Implementation notes

- Vanilla ES modules: `src/engine.js` (variant rules, check/checkmate, castling, en passant, promotion), `src/ai.js` (alpha-beta search), `src/audio.js` (generated Web Audio), `src/app.js` (touch UI, animation, tilt, dialogs).
- Responsive CSS from 320 px phones through tablets and desktop, with safe-area insets and a landscape phone layout.
- Reduced-motion support, visible focus rings, semantic buttons for every board square, and generated haptics/sound feedback where the platform allows it.

### Asset credit

The chess piece silhouettes are from **Font Awesome Free 6.7.2** (`chess-pawn`, `chess-knight`, `chess-bishop`, `chess-rook`, `chess-queen`, `chess-king`), licensed under [CC BY 4.0](https://fontawesome.com/license/free). They are embedded as SVG symbols and recolored with gradients for the Ivory and Ember sides.
