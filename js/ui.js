const CARDINALS = [
  { el: 'tick-0', bearing: 0 },
  { el: 'tick-1', bearing: -Math.PI / 2 },
  { el: 'tick-2', bearing: Math.PI },
  { el: 'tick-3', bearing: Math.PI / 2 },
];

const wrapAngle = (a) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class UI {
  constructor() {
    this.el = {};
    const ids = [
      'loading', 'hud', 'title-screen', 'pause-screen', 'death-screen', 'win-screen', 'toast',
      'objective-title', 'objective-count', 'bell-pips', 'oil-fill', 'stamina-fill',
      'reticle', 'prompt', 'subtitle', 'compass-objective', 'fx-fear', 'fx-flash',
      'fx-glitch', 'threat-word', 'btn-lamp', 'btn-use', 'lantern-hint',
      'btn-tilt-title', 'btn-sound-title', 'btn-tilt-pause', 'btn-sound-pause',
      'tilt-desc', 'tilt-desc-pause', 'death-stats', 'win-stats', 'lock-hint',
    ];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.el.pips = [...document.querySelectorAll('.bell-pip')];
    this.subtitleTimer = null;
    this.toastTimer = null;
    this.lanternHintTimer = null;
    this.defaultTiltDesc = this.el['tilt-desc'].textContent;
    this.defaultTiltDescPause = this.el['tilt-desc-pause'].textContent;
    this.lastPrompt = '';
    this.lastSubtitle = '';
    this.tilt = false;
    this.sound = true;
    this._fear = 0;
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
  }

  setTouch(isTouch) {
    document.body.classList.toggle('is-touch', isTouch);
  }

  showHud() {
    this.el.hud.classList.remove('hidden');
  }

  hideHud() {
    this.el.hud.classList.add('hidden');
  }

  showTitle() {
    this.el['title-screen'].classList.remove('hidden');
    this.el['pause-screen'].classList.add('hidden');
    this.el['death-screen'].classList.add('hidden');
    this.el['win-screen'].classList.add('hidden');
    this.el['fx-glitch'].classList.remove('active');
    this.hideHud();
  }

  hideTitle() {
    this.el['title-screen'].classList.add('hidden');
  }

  showPause() {
    this.el['pause-screen'].classList.remove('hidden');
  }

  hidePause() {
    this.el['pause-screen'].classList.add('hidden');
  }

  showDeath(stats) {
    const distance = Number.isFinite(stats.distance) ? Math.round(stats.distance) + 'm' : '—';
    this.el['death-stats'].innerHTML = `
      <span><b>${formatTime(stats.time)}</b>TIME IN THE VALE</span>
      <span><b>${stats.bells} / 3</b>BELLS FOUND</span>
      <span><b>${distance}</b>IT WAS CLOSE</span>`;
    this.el['death-screen'].classList.remove('hidden');
    this.el['fx-glitch'].classList.add('active');
    this.hideHud();
  }

  showWin(stats) {
    const distance = Number.isFinite(stats.distance) ? Math.round(stats.distance) + 'm' : 'OUTLASTED';
    this.el['win-stats'].innerHTML = `
      <span><b>${formatTime(stats.time)}</b>TIME IN THE VALE</span>
      <span><b>3 / 3</b>BELLS RETURNED</span>
      <span><b>${distance}</b>THE WARDEN</span>`;
    this.el['win-screen'].classList.remove('hidden');
    this.hideHud();
  }

  hideDeath() {
    this.el['death-screen'].classList.add('hidden');
    this.el['fx-glitch'].classList.remove('active');
  }

  hideWin() {
    this.el['win-screen'].classList.add('hidden');
  }

  setObjectiveTitle(text) {
    this.el['objective-title'].textContent = text;
  }

  setBells(count) {
    this.el.pips.forEach((p, i) => p.classList.toggle('lit', i < count));
    this.el['objective-count'].textContent = `${count} / 3`;
  }

  setOil(pct, empty = false) {
    const v = Math.max(0, Math.min(1, pct));
    this.el['oil-fill'].style.transform = `scaleX(${v})`;
    this.el['oil-fill'].parentElement.parentElement.classList.toggle('empty', empty);
  }

  setStamina(pct) {
    const v = Math.max(0, Math.min(1, pct));
    this.el['stamina-fill'].style.transform = `scaleX(${v})`;
  }

  setLantern(on) {
    this.el['btn-lamp'].classList.toggle('lamp-off', !on);
    if (!on) {
      this.el['lantern-hint'].classList.add('show');
      if (this.lanternHintTimer) clearTimeout(this.lanternHintTimer);
      this.lanternHintTimer = setTimeout(() => {
        this.el['lantern-hint'].classList.remove('show');
      }, 2600);
    } else {
      this.el['lantern-hint'].classList.remove('show');
    }
  }

  setPrompt(text, { sealed = false, useReady = false } = {}) {
    const prompt = this.el.prompt;
    if (!text) {
      if (this.lastPrompt) {
        prompt.classList.remove('show');
        this.lastPrompt = '';
      }
      this.setUseReady(false);
      return;
    }
    if (text !== this.lastPrompt) {
      prompt.textContent = text;
      prompt.classList.toggle('sealed', sealed);
      prompt.classList.add('show');
      this.lastPrompt = text;
    }
    this.setUseReady(useReady);
  }

  setUseReady(ready) {
    this.el['btn-use'].classList.toggle('interactable', ready);
    this.el.reticle.classList.toggle('interactable', ready);
  }

  setSubtitle(text, duration = 4, { hint = false, force = false } = {}) {
    if (!force && text === this.lastSubtitle && this.el.subtitle.classList.contains('show')) return;
    const sub = this.el.subtitle;
    this.lastSubtitle = text;
    if (this.subtitleTimer) clearTimeout(this.subtitleTimer);
    sub.textContent = text;
    sub.classList.toggle('hint', hint);
    sub.classList.add('show');
    if (duration > 0) {
      this.subtitleTimer = setTimeout(() => {
        sub.classList.remove('show');
        this.lastSubtitle = '';
      }, duration * 1000);
    }
  }

  clearSubtitle() {
    if (this.subtitleTimer) clearTimeout(this.subtitleTimer);
    this.el.subtitle.classList.remove('show');
    this.lastSubtitle = '';
  }

  toast(text, duration = 2.8) {
    const toast = this.el.toast;
    toast.textContent = text;
    toast.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), duration * 1000);
  }

  updateCompass(yaw, target) {
    const width = 50;
    for (const c of CARDINALS) {
      const el = document.getElementById(c.el);
      const rel = wrapAngle(c.bearing - yaw);
      const left = 50 - (rel / Math.PI) * width;
      el.style.left = `${left}%`;
      el.style.opacity = Math.abs(rel) > 2.9 ? '0' : `${Math.max(0.18, 0.55 - Math.abs(rel) * 0.11)}`;
    }
    const marker = this.el['compass-objective'];
    if (!target) {
      marker.style.opacity = '0';
      return;
    }
    const rel = wrapAngle(Math.atan2(-(target.x), -(target.z)) - yaw);
    const left = 50 - (rel / Math.PI) * width;
    marker.style.left = `${left}%`;
    marker.style.opacity = Math.abs(rel) > 2.8 ? '0' : '1';
  }

  setFear(value) {
    this._fear = Math.max(0, Math.min(1, value));
    document.documentElement.style.setProperty('--fear', this._fear.toFixed(3));
    this.el['threat-word'].classList.toggle('show', this._fear > 0.78);
  }

  flash(soft = false) {
    const flash = this.el['fx-flash'];
    flash.classList.remove('flash', 'flash-soft');
    void flash.offsetWidth;
    flash.classList.add(soft ? 'flash-soft' : 'flash');
  }

  setLockHint(show) {
    this.el['lock-hint'].classList.toggle('show', show);
  }

  setTilt(enabled, status = '') {
    this.tilt = enabled;
    const on = enabled ? 'true' : 'false';
    this.el['btn-tilt-title'].setAttribute('aria-checked', on);
    this.el['btn-tilt-pause'].setAttribute('aria-checked', on);
    const desc = this.el['tilt-desc'];
    const descPause = this.el['tilt-desc-pause'];
    if (status === 'denied') {
      desc.textContent = 'Motion access denied — enable in browser settings';
      descPause.textContent = 'Motion access denied by the browser';
      this.el['btn-tilt-title'].dataset.denied = 'true';
      this.el['btn-tilt-pause'].dataset.denied = 'true';
    } else if (status === 'unsupported' || status === 'no-sensor') {
      desc.textContent = 'No motion sensor detected on this device';
      descPause.textContent = 'No motion sensor detected';
      this.el['btn-tilt-title'].dataset.denied = 'true';
      this.el['btn-tilt-pause'].dataset.denied = 'true';
    } else {
      desc.textContent = enabled ? 'Motion control active · tap to disable' : this.defaultTiltDesc;
      descPause.textContent = enabled ? 'Motion control active' : this.defaultTiltDescPause;
      delete this.el['btn-tilt-title'].dataset.denied;
      delete this.el['btn-tilt-pause'].dataset.denied;
    }
  }

  setSound(enabled) {
    this.sound = enabled;
    const on = enabled ? 'true' : 'false';
    this.el['btn-sound-title'].setAttribute('aria-checked', on);
    this.el['btn-sound-pause'].setAttribute('aria-checked', on);
  }
}
