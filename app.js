'use strict';
/* PulseDeck — תוכנת DJ בדפדפן
   עקרונות (מהמחקר על טרקטור/סראטו/רקורדבוקס):
   - תצוגה דיגיטלית גדולה, כפתורים גדולים
   - גלים בצבעי תדרים: כהה = בס, בינוני = צבע הדק, בהיר = גבוהים
   - התאמת שירים חכמה לפי BPM + סולם (גלגל קאמלוט) */

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// שחרור המסך בין מנות עיבוד — MessageChannel לא מואט גם כשהחלון ברקע
const tick = (() => {
  const ch = new MessageChannel();
  let queue = [];
  ch.port1.onmessage = () => { const q = queue; queue = []; for (const r of q) r(); };
  return () => new Promise(r => { queue.push(r); ch.port2.postMessage(0); });
})();

const AC = new (window.AudioContext || window.webkitAudioContext)();
const master = AC.createGain();
master.gain.value = 0.9;
master.connect(AC.destination);
document.addEventListener('pointerdown', () => { if (AC.state !== 'running') AC.resume(); });

function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), ss = Math.floor(s % 60);
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

/* ==================== עזרי אפקטים ==================== */
// אימפולס לריוורב — רעש לבן עם דעיכה אקספוננציאלית
function makeImpulse(sec, decay) {
  const len = Math.floor(AC.sampleRate * sec);
  const buf = AC.createBuffer(2, len, AC.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
const REVERB_IR = makeImpulse(2.4, 3);

function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/* ==================== FFT ==================== */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j |= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + half] * cr - im[i + k + half] * ci;
        const vi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + half] = ur - vr; im[i + k + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/* ==================== ניתוח שיר: BPM, סולם, גלים ==================== */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CAMELOT_MAJOR = { 'C': '8B', 'C#': '3B', 'D': '10B', 'D#': '5B', 'E': '12B', 'F': '7B', 'F#': '2B', 'G': '9B', 'G#': '4B', 'A': '11B', 'A#': '6B', 'B': '1B' };
const CAMELOT_MINOR = { 'C': '5A', 'C#': '12A', 'D': '7A', 'D#': '2A', 'E': '9A', 'F': '4A', 'F#': '11A', 'G': '6A', 'G#': '1A', 'A': '8A', 'A#': '3A', 'B': '10A' };
const PROF_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROF_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(x, y) {
  const n = x.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2;
  }
  return num / (Math.sqrt(dx * dy) || 1);
}

async function analyzeTrack(buffer) {
  const sr = buffer.sampleRate, n = buffer.length;
  // מיקס למונו
  const mono = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  await tick();

  // --- גלים בשלושה תדרים (100 דליים לשנייה) ---
  const bps = 100, bs = Math.round(sr / bps), nb = Math.ceil(n / bs);
  const low = new Float32Array(nb), mid = new Float32Array(nb), high = new Float32Array(nb);
  const aL = 1 - Math.exp(-2 * Math.PI * 180 / sr);
  const aM = 1 - Math.exp(-2 * Math.PI * 2200 / sr);
  let sL = 0, sM = 0;
  const CH = bs * 400; // עיבוד במנות כדי לא להקפיא את הממשק
  for (let st = 0; st < n; st += CH) {
    const en = Math.min(n, st + CH);
    for (let i = st; i < en; i++) {
      const x = mono[i];
      sL += aL * (x - sL);
      sM += aM * (x - sM);
      const b = (i / bs) | 0;
      const l = Math.abs(sL), m = Math.abs(sM - sL), h = Math.abs(x - sM);
      if (l > low[b]) low[b] = l;
      if (m > mid[b]) mid[b] = m;
      if (h > high[b]) high[b] = h;
    }
    await tick();
  }
  // נרמול לפי אחוזון 97
  const all = [];
  for (let i = 0; i < nb; i++) all.push(low[i] + mid[i] + high[i]);
  all.sort((a, b2) => a - b2);
  const norm = (all[Math.floor(all.length * 0.97)] || 1) || 1;
  for (let i = 0; i < nb; i++) {
    low[i] = Math.min(1, low[i] / norm);
    mid[i] = Math.min(1, mid[i] / norm);
    high[i] = Math.min(1, high[i] / norm);
  }

  // --- מעטפת אונסטים לזיהוי קצב ---
  const hop = 512, nf = Math.floor(n / hop);
  const env = new Float32Array(nf);
  let prevE = 0;
  for (let f = 0; f < nf; f++) {
    let e = 0;
    const st = f * hop;
    for (let i = st; i < st + hop; i++) e += mono[i] * mono[i];
    e = Math.sqrt(e / hop);
    env[f] = Math.max(0, e - prevE);
    prevE = e;
    if ((f & 2047) === 2047) await tick();
  }

  // --- חיפוש BPM (מסננת מסרק 60–180) ---
  const fr = sr / hop;
  let bestBpm = 120, bestScore = -1;
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const P = fr * 60 / bpm;
    let best = 0;
    for (let ph = 0; ph < 8; ph++) {
      let s = 0, cnt = 0;
      for (let t = ph * P / 8; t < nf; t += P) { s += env[t | 0]; cnt++; }
      if (cnt) { const v = s / cnt; if (v > best) best = v; }
    }
    const pref = (bpm >= 85 && bpm <= 142) ? 1 : 0.9;
    if (best * pref > bestScore) { bestScore = best * pref; bestBpm = bpm; }
    if (bpm % 20 === 0) await tick();
  }

  // --- פאזת הביט הראשון ---
  const P = fr * 60 / bestBpm;
  let bestPh = 0, bestPS = -1;
  for (let d = 0; d < 64; d++) {
    const ph = d * P / 64;
    let s = 0, cnt = 0;
    for (let t = ph; t < nf; t += P) { s += env[t | 0]; cnt++; }
    const v = cnt ? s / cnt : 0;
    if (v > bestPS) { bestPS = v; bestPh = ph; }
  }
  const beatOffset = bestPh * hop / sr;

  // --- זיהוי סולם (כרומגרמה + פרופילי קרומהנסל) ---
  const chroma = new Float32Array(12);
  const W = 8192, wins = 40;
  const re = new Float32Array(W), im = new Float32Array(W);
  const hann = new Float32Array(W);
  for (let i = 0; i < W; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (W - 1));
  for (let w = 0; w < wins; w++) {
    const start = Math.floor((w + 0.5) * n / wins - W / 2);
    if (start < 0 || start + W > n) continue;
    for (let i = 0; i < W; i++) { re[i] = mono[start + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 2; k < W / 2; k++) {
      const f = k * sr / W;
      if (f < 55 || f > 4000) continue;
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag;
    }
    if ((w & 7) === 7) await tick();
  }
  let keyName = '--', camelot = '', mode = 'major', bestCorr = -2;
  const rotated = new Float32Array(12);
  for (let root = 0; root < 12; root++) {
    for (let i = 0; i < 12; i++) rotated[i] = chroma[(i + root) % 12];
    const cMaj = pearson(rotated, PROF_MAJ);
    const cMin = pearson(rotated, PROF_MIN);
    if (cMaj > bestCorr) { bestCorr = cMaj; keyName = NOTE_NAMES[root]; mode = 'major'; }
    if (cMin > bestCorr) { bestCorr = cMin; keyName = NOTE_NAMES[root]; mode = 'minor'; }
  }
  if (keyName !== '--') {
    camelot = mode === 'major' ? CAMELOT_MAJOR[keyName] : CAMELOT_MINOR[keyName];
    keyName = keyName + (mode === 'minor' ? 'm' : '');
  }

  // אנרגיה כללית (0..1) — משמשת לטיפים: פתיחת סט / שיא / סגירה
  let esum = 0;
  for (let i = 0; i < nb; i++) esum += low[i] + mid[i] + high[i];
  const energy = Math.min(1, (esum / nb) / 1.4);

  return {
    bps, low, mid, high, energy,
    bpm: Math.round(bestBpm * 10) / 10,
    beatOffset, keyName, camelot,
    duration: buffer.duration
  };
}

/* ==================== גלגל קאמלוט: ציון התאמה ==================== */
function keyCompat(c1, c2) {
  if (!c1 || !c2) return 0.55; // לא ידוע — ניטרלי
  if (c1 === c2) return 1;
  const n1 = parseInt(c1), n2 = parseInt(c2);
  const l1 = c1.slice(-1), l2 = c2.slice(-1);
  const d = Math.min(Math.abs(n1 - n2), 12 - Math.abs(n1 - n2));
  if (d === 0) return 0.9;            // אותו מספר, מז'ור/מינור
  if (d === 1 && l1 === l2) return 0.9; // שכן בגלגל
  if (d === 1) return 0.6;
  if (d === 2 && l1 === l2) return 0.5;
  return 0.2;
}

function matchScore(refBpm, refCam, t) {
  // התאמת BPM כולל כפול/חצי קצב
  let bestD = Infinity;
  for (const m of [0.5, 1, 2]) {
    const d = Math.abs(Math.log2((t.bpm * m) / refBpm));
    if (d < bestD) bestD = d;
  }
  const bpmScore = Math.max(0, 1 - bestD / 0.115); // עד ~8% הפרש = טוב
  const keyScore = keyCompat(refCam, t.camelot);
  return Math.round((0.62 * bpmScore + 0.38 * keyScore) * 100);
}

function camelotColor(cam) {
  if (!cam) return '#334';
  const num = parseInt(cam) || 1;
  const hue = ((num - 1) / 12) * 360;
  return `hsl(${hue} 65% ${cam.endsWith('A') ? 30 : 40}%)`;
}

/* ==================== דק ==================== */
class Deck {
  constructor(id) {
    this.id = id; // 'A' / 'B'
    this.track = null;
    this.playing = false;
    this.rate = 1;
    this.cue = 0;
    this.loopOn = false; this.loopStart = 0; this.loopEnd = 0;
    this.startOffset = 0; this.startCtx = 0;
    this.source = null;
    this.overCanvas = null; // מצויר מראש

    this.eqLow = AC.createBiquadFilter(); this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 120;
    this.eqMid = AC.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 0.8;
    this.eqHigh = AC.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 8000;
    this.fLP = AC.createBiquadFilter(); this.fLP.type = 'lowpass'; this.fLP.frequency.value = 20000; this.fLP.Q.value = 0.8;
    this.fHP = AC.createBiquadFilter(); this.fHP.type = 'highpass'; this.fHP.frequency.value = 10; this.fHP.Q.value = 0.8;
    this.chGain = AC.createGain();
    this.xfGain = AC.createGain();

    // --- יחידת אפקטים ---
    this.fx = { echo: false, verb: false, flng: false, dist: false, amt: 0.5 };
    this.shaper = AC.createWaveShaper(); // דיסטורשן (curve=null = מעקף)
    this.fxSum = AC.createGain();
    this.flDelay = AC.createDelay(0.05); this.flDelay.delayTime.value = 0.004;
    this.flGain = AC.createGain(); this.flGain.gain.value = 0;
    this.lfo = AC.createOscillator(); this.lfo.frequency.value = 0.3;
    this.lfoAmt = AC.createGain(); this.lfoAmt.gain.value = 0.0018;
    this.lfo.connect(this.lfoAmt); this.lfoAmt.connect(this.flDelay.delayTime);
    this.lfo.start();
    this.echoDelay = AC.createDelay(2);
    this.echoFb = AC.createGain(); this.echoFb.gain.value = 0;
    this.echoGain = AC.createGain(); this.echoGain.gain.value = 0;
    this.conv = AC.createConvolver(); this.conv.buffer = REVERB_IR;
    this.revGain = AC.createGain(); this.revGain.gain.value = 0;

    this.eqLow.connect(this.eqMid); this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.fLP); this.fLP.connect(this.fHP);
    this.fHP.connect(this.shaper);
    this.shaper.connect(this.fxSum);
    this.shaper.connect(this.flDelay); this.flDelay.connect(this.flGain); this.flGain.connect(this.fxSum);
    this.fxSum.connect(this.chGain);
    this.fxSum.connect(this.echoDelay);
    this.echoDelay.connect(this.echoFb); this.echoFb.connect(this.echoDelay);
    this.echoDelay.connect(this.echoGain); this.echoGain.connect(this.chGain);
    this.fxSum.connect(this.conv); this.conv.connect(this.revGain); this.revGain.connect(this.chGain);

    this.chGain.connect(this.xfGain);
    this.xfGain.connect(master);
  }
  applyFx() {
    const f = this.fx, amt = f.amt;
    const beat = this.track ? 60 / this.effBpm : 0.5;
    this.echoDelay.delayTime.value = Math.min(1.8, beat * 0.75); // אקו מסונכרן לקצב (שמינית מנוקדת)
    this.echoGain.gain.value = f.echo ? 0.35 + 0.45 * amt : 0;
    this.echoFb.gain.value = f.echo ? 0.28 + 0.38 * amt : 0;
    this.revGain.gain.value = f.verb ? 0.25 + 0.9 * amt : 0;
    this.flGain.gain.value = f.flng ? 0.4 + 0.5 * amt : 0;
    this.lfoAmt.gain.value = 0.0008 + 0.0022 * amt;
    this.shaper.curve = f.dist ? distCurve(2 + amt * 18) : null;
  }
  get duration() { return this.track ? this.track.buffer.duration : 0; }
  get position() {
    if (!this.track) return 0;
    if (!this.playing) return this.startOffset;
    return Math.min(this.duration, this.startOffset + (AC.currentTime - this.startCtx) * this.rate);
  }
  get effBpm() { return this.track ? this.track.analysis.bpm * this.rate : 0; }

  load(track) {
    this._stopSource();
    this.playing = false;
    this.track = track;
    this.startOffset = 0;
    this.cue = track.analysis.beatOffset || 0;
    this.loopOn = false;
    this.renderOverview();
    this.applyFx(); // סנכרון זמן האקו לקצב השיר החדש
    updateDeckStatic(this);
    updateRecs();
    suggestForAdjacent(this); // 💡 המלצה מיידית מה לטעון לדק הסמוך
  }
  _makeSource() {
    const s = AC.createBufferSource();
    s.buffer = this.track.buffer;
    s.playbackRate.value = this.rate;
    s.connect(this.eqLow);
    s.onended = () => {
      if (this.playing && this.position >= this.duration - 0.08) {
        this.playing = false; this.startOffset = 0; this.source = null;
        updateDeckStatic(this);
      }
    };
    this.source = s;
  }
  _stopSource() {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch (e) {}
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
  }
  play() {
    if (!this.track || this.playing) return;
    if (AC.state !== 'running') AC.resume();
    if (this.startOffset >= this.duration - 0.05) this.startOffset = 0;
    this._makeSource();
    this.startCtx = AC.currentTime;
    this.source.start(0, this.startOffset);
    this.playing = true;
    updateDeckStatic(this);
    updateRecs();
  }
  pause() {
    if (!this.playing) return;
    this.startOffset = this.position;
    this.playing = false;
    this._stopSource();
    updateDeckStatic(this);
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) {
    if (!this.track) return;
    t = clamp(t, 0, this.duration);
    if (this.playing) {
      this._stopSource();
      this.startOffset = t;
      this._makeSource();
      this.startCtx = AC.currentTime;
      this.source.start(0, t);
    } else {
      this.startOffset = t;
    }
  }
  setRate(r) {
    r = clamp(r, 0.5, 2);
    if (this.playing) {
      this.startOffset = this.position;
      this.startCtx = AC.currentTime;
    }
    this.rate = r;
    if (this.source) this.source.playbackRate.value = r;
    this.applyFx(); // עדכון סנכרון האקו לקצב החדש
    updateDeckStatic(this);
  }
  pressCue() {
    if (!this.track) return;
    if (this.playing) {
      this.pause();
      this.seek(this.cue);
    } else {
      this.cue = this.position;
    }
    updateDeckStatic(this);
  }
  toggleLoop() {
    if (!this.track) return;
    if (this.loopOn) { this.loopOn = false; }
    else {
      const bl = 60 / this.track.analysis.bpm;
      const off = this.track.analysis.beatOffset;
      const start = off + Math.floor((this.position - off) / bl) * bl;
      this.loopStart = Math.max(0, start);
      this.loopEnd = Math.min(this.duration, start + 4 * bl);
      this.loopOn = true;
    }
    updateDeckStatic(this);
  }
  renderOverview() {
    const a = this.track.analysis;
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 84;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const col = DECK_COLORS[this.id];
    const nb = a.low.length, H = cv.height, cy = H / 2;
    for (let x = 0; x < cv.width; x++) {
      const b0 = Math.floor(x / cv.width * nb);
      const b1 = Math.max(b0 + 1, Math.floor((x + 1) / cv.width * nb));
      let l = 0, m = 0, h = 0;
      for (let b = b0; b < b1; b++) {
        if (a.low[b] > l) l = a.low[b];
        if (a.mid[b] > m) m = a.mid[b];
        if (a.high[b] > h) h = a.high[b];
      }
      ctx.fillStyle = col.low;
      ctx.fillRect(x, cy - l * cy, 1, l * H);
      ctx.fillStyle = col.mid;
      ctx.fillRect(x, cy - m * cy * 0.8, 1, m * H * 0.8);
      ctx.fillStyle = col.high;
      ctx.fillRect(x, cy - h * cy * 0.5, 1, h * H * 0.5);
    }
    this.overCanvas = cv;
  }
}

const DECK_COLORS = {
  A: { low: '#0b5a75', mid: '#2dd4ff', high: '#dff8ff' },
  B: { low: '#7a4310', mid: '#ffa137', high: '#fff1dd' }
};

const deckA = new Deck('A');
const deckB = new Deck('B');
const decks = { A: deckA, B: deckB };
const otherDeck = d => d.id === 'A' ? deckB : deckA;

/* ==================== סנכרון קצב ==================== */
function syncDeck(deck) {
  const other = otherDeck(deck);
  if (!deck.track || !other.track) { flashRec('⚠️ סנכרון דורש שיר בשני הדקים'); return; }
  const target = other.effBpm;
  const base = deck.track.analysis.bpm;
  let bestRate = 1, bestD = Infinity;
  for (const m of [0.5, 1, 2]) {
    const r = (target * m) / base;
    const d = Math.abs(Math.log2(r));
    if (r >= 0.7 && r <= 1.45 && d < bestD) { bestD = d; bestRate = r; }
  }
  deck.setRate(bestRate);
  const el = $('#pitch' + deck.id);
  el.value = clamp((bestRate - 1) * 100, -8, 8);
  if (deck.playing && other.playing) phaseAlign(deck, other);
  const btn = $('#sync' + deck.id);
  btn.classList.add('on');
  setTimeout(() => btn.classList.remove('on'), 1200);
}

function phaseAlign(deck, ref) {
  const rA = ref.track.analysis, dA = deck.track.analysis;
  const refBl = 60 / rA.bpm, deckBl = 60 / dA.bpm;
  const refFrac = (((ref.position - rA.beatOffset) % refBl) + refBl) % refBl / refBl;
  const deckFrac = (((deck.position - dA.beatOffset) % deckBl) + deckBl) % deckBl / deckBl;
  let delta = refFrac - deckFrac;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  deck.seek(deck.position + delta * deckBl);
}

/* ==================== AUTO MIX ==================== */
let autoMixBusy = false;
function autoMix() {
  if (autoMixBusy) return;
  const from = deckA.playing ? deckA : (deckB.playing ? deckB : null);
  if (!from) { flashRec('⚠️ AUTO MIX: קודם נגן שיר באחד הדקים'); return; }
  const to = otherDeck(from);
  if (!to.track) { flashRec('⚠️ AUTO MIX: טען שיר לדק השני קודם'); return; }
  autoMixBusy = true;
  $('#automix').classList.add('busy');
  syncDeck(to);
  if (!to.playing) {
    to.seek(to.track.analysis.beatOffset || 0);
    to.play();
    phaseAlign(to, from);
  }
  const xf = $('#xf');
  const startVal = +xf.value;
  const endVal = to.id === 'B' ? 100 : -100;
  const dur = 8000, t0 = performance.now();
  const timer = setInterval(() => {
    const p = clamp((performance.now() - t0) / dur, 0, 1);
    xf.value = startVal + (endVal - startVal) * p;
    applyXfade();
    if (p >= 1) {
      clearInterval(timer);
      from.pause();
      autoMixBusy = false;
      $('#automix').classList.remove('busy');
      flashRec('✅ המעבר הושלם — הדק ' + to.id + ' מנגן');
      // אוטו-DJ: הדק שהשתחרר מקבל את השיר הבא בתור
      if (PLAYLIST.active) {
        PLAYLIST.mixArmed = false;
        if (PLAYLIST.queue.length) from.load(PLAYLIST.queue.shift());
        updatePlaylistBar();
      }
      updateRecs();
    }
  }, 30);
}

/* ==================== מיקסר ==================== */
function applyXfade() {
  const x = (+$('#xf').value + 100) / 200; // 0=A, 1=B
  deckA.xfGain.gain.value = Math.cos(x * Math.PI / 2);
  deckB.xfGain.gain.value = Math.sin(x * Math.PI / 2);
}
function applyVol(deck, v) { deck.chGain.gain.value = (v / 100) ** 1.5; }
function applyFilter(deck, v) {
  // v: -1..1  שלילי = לואו-פאס, חיובי = היי-פאס
  if (v < -0.03) {
    deck.fLP.frequency.value = 20000 * Math.pow(180 / 20000, -v);
    deck.fHP.frequency.value = 10;
  } else if (v > 0.03) {
    deck.fHP.frequency.value = 20 * Math.pow(8000 / 20, v);
    deck.fLP.frequency.value = 20000;
  } else {
    deck.fLP.frequency.value = 20000;
    deck.fHP.frequency.value = 10;
  }
}

/* ==================== כפתורי סיבוב (knobs) ==================== */
function makeKnob(el, { min, max, def, onChange }) {
  let val = def;
  const dial = el.querySelector('.knob-dial');
  const render = () => {
    // ‎+180 כדי שהמחוג יצביע למעלה במרכז הטווח, כמו בכפתור מיקסר אמיתי
    const ang = -135 + 270 * (val - min) / (max - min) + 180;
    dial.style.transform = `rotate(${ang}deg)`;
  };
  const set = v => { val = clamp(v, min, max); render(); onChange(val); };
  const setNorm = v => set(min + clamp(v, 0, 1) * (max - min)); // ‎0..1 — עבור MIDI
  let dragging = false, startY = 0, startVal = 0;
  el.addEventListener('pointerdown', e => {
    dragging = true; startY = e.clientY; startVal = val;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    set(startVal + (startY - e.clientY) * (max - min) / 150);
  });
  el.addEventListener('pointerup', () => dragging = false);
  el.addEventListener('dblclick', () => set(def));
  set(def);
  return { set, setNorm };
}

/* ==================== ציור גלים ==================== */
// מדידת מידות הקנבס יקרה (מאלצת חישוב פריסה) — מודדים רק בהתחלה ובשינוי גודל,
// לא בכל פריים. זה מונע את ה"תקיעות" בסיבוב הפלטה.
let _canvasDirty = true;
window.addEventListener('resize', () => { _canvasDirty = true; });
function setupCanvas(cv) {
  if (!cv._ctx) cv._ctx = cv.getContext('2d');
  if (_canvasDirty || !cv._measured) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w) cv.width = w;
    if (cv.height !== h) cv.height = h;
    cv._measured = true;
  }
  return cv._ctx;
}

function drawZoom(deck, cv) {
  const ctx = setupCanvas(cv);
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#04060b';
  ctx.fillRect(0, 0, W, H);
  if (!deck.track) {
    ctx.fillStyle = '#2a3245';
    ctx.fillRect(0, H / 2 - 1, W, 2);
    return;
  }
  const a = deck.track.analysis;
  const span = 6; // שניות על המסך
  const pos = deck.position;
  const t0 = pos - span / 2;
  const col = DECK_COLORS[deck.id];
  const cy = H / 2;

  // קווי ביטים
  const bl = 60 / a.bpm;
  const firstK = Math.ceil((t0 - a.beatOffset) / bl);
  for (let k = firstK; ; k++) {
    const t = a.beatOffset + k * bl;
    if (t > t0 + span) break;
    if (t < 0) continue;
    const x = (t - t0) / span * W;
    ctx.fillStyle = (k % 4 === 0) ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, 0, k % 4 === 0 ? 2 : 1, H);
  }

  // גל בצבעי תדרים
  const nb = a.low.length;
  for (let x = 0; x < W; x++) {
    const t = t0 + (x / W) * span;
    const b = Math.floor(t * a.bps);
    if (b < 0 || b >= nb) continue;
    const l = a.low[b], m = a.mid[b], h = a.high[b];
    ctx.fillStyle = col.low;
    ctx.fillRect(x, cy - l * cy * 0.96, 1, l * H * 0.96);
    ctx.fillStyle = col.mid;
    ctx.fillRect(x, cy - m * cy * 0.75, 1, m * H * 0.75);
    ctx.fillStyle = col.high;
    ctx.fillRect(x, cy - h * cy * 0.45, 1, h * H * 0.45);
  }

  // אזור לולאה
  if (deck.loopOn) {
    const x1 = (deck.loopStart - t0) / span * W;
    const x2 = (deck.loopEnd - t0) / span * W;
    ctx.fillStyle = 'rgba(167,139,250,0.16)';
    ctx.fillRect(x1, 0, x2 - x1, H);
  }

  // סמן CUE
  const cx = (deck.cue - t0) / span * W;
  if (cx >= 0 && cx <= W) {
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(cx, 0, 2, H);
    ctx.beginPath();
    ctx.moveTo(cx - 6, 0); ctx.lineTo(cx + 8, 0); ctx.lineTo(cx + 1, 10);
    ctx.fill();
  }

  // ראש השמעה במרכז
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(W / 2 - 1.5, 0, 3, H);
  ctx.shadowColor = '#fff'; ctx.shadowBlur = 0;
}

function drawOverview(deck, cv) {
  const ctx = setupCanvas(cv);
  const W = cv.width, H = cv.height;
  ctx.fillStyle = '#04060b';
  ctx.fillRect(0, 0, W, H);
  if (!deck.track) return;
  ctx.drawImage(deck.overCanvas, 0, 0, W, H);
  const dur = deck.duration;
  // התקדמות
  const px = deck.position / dur * W;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, px, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(px - 1, 0, 3, H);
  // CUE
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(deck.cue / dur * W - 1, 0, 2, H);
  if (deck.loopOn) {
    ctx.fillStyle = 'rgba(167,139,250,0.35)';
    ctx.fillRect(deck.loopStart / dur * W, 0, (deck.loopEnd - deck.loopStart) / dur * W, H);
  }
}

/* ==================== עדכוני תצוגה ==================== */
function updateDeckStatic(deck) {
  const id = deck.id;
  const t = deck.track;
  $('#play' + id).textContent = deck.playing ? '❚❚' : '▶';
  $('#play' + id).classList.toggle('on', deck.playing);
  $('#loop' + id).classList.toggle('on', deck.loopOn);
  $('#deck' + id).classList.toggle('playing', deck.playing);
  if (!t) return;
  $('#title' + id).textContent = t.title;
  $('#artist' + id).textContent = t.artist || ' ';
  const kb = $('#key' + id);
  kb.textContent = t.analysis.camelot ? `${t.analysis.camelot} · ${t.analysis.keyName}` : '--';
  kb.style.background = camelotColor(t.analysis.camelot);
  $('#bpm' + id).textContent = deck.effBpm.toFixed(1);
  const pct = (deck.rate - 1) * 100;
  $('#pitchVal' + id).textContent = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

// מטמון אלמנטים — כדי לא לחפש ב-DOM בכל פריים (מקור נוסף לתקיעות)
const RAF_ELS = {};
for (const id of ['A', 'B']) {
  RAF_ELS[id] = {
    disc: $('#disc' + id), ring: $('#ring' + id),
    zoom: $('#zoom' + id), over: $('#over' + id),
    timeEl: $('#timeEl' + id), timeRem: $('#timeRem' + id), bpm: $('#bpm' + id),
    lastRingPct: -1, lastTimeEl: '', lastTimeRem: ''
  };
}

function rafLoop() {
  // אוטו-DJ: במצב אוטומטי בלבד — כשהשיר החי מתקרב לסופו מפעילים מעבר לדק השני
  if (PLAYLIST.active && PLAYLIST.mode === 'auto' && !autoMixBusy && !PLAYLIST.mixArmed) {
    const live = deckA.playing ? deckA : (deckB.playing ? deckB : null);
    if (live && live.track) {
      const next = otherDeck(live);
      if (live.duration - live.position < 15 && next.track && !next.playing) {
        PLAYLIST.mixArmed = true;
        autoMix();
        updatePlaylistBar();
      }
    }
  }
  for (const deck of [deckA, deckB]) {
    const els = RAF_ELS[deck.id];
    // לולאה
    if (deck.loopOn && deck.playing && deck.position >= deck.loopEnd - 0.01) {
      deck.seek(deck.loopStart);
    }
    drawZoom(deck, els.zoom);
    drawOverview(deck, els.over);
    if (deck.track) {
      // פלטה מסתובבת: 33⅓ סל"ד = סיבוב מלא כל 1.8 שניות של שיר (transform בלבד — חלק ב-GPU)
      els.disc.style.transform = `rotate(${(deck.position / 1.8 * 360) % 360}deg)`;
      // טבעת ההתקדמות: קוניק-גרדיאנט יקר לצייר — מעדכנים רק כשאחוז ההתקדמות משתנה
      const pct = Math.round(deck.position / deck.duration * 500) / 5;
      if (pct !== els.lastRingPct) {
        els.lastRingPct = pct;
        els.ring.style.background =
          `conic-gradient(from -90deg, ${DECK_COLORS[deck.id].mid} ${pct}%, rgba(255,255,255,0.07) ${pct}%)`;
      }
      // זמנים — מעדכנים רק כשהטקסט השתנה בפועל (פעם בשנייה)
      const te = fmtTime(deck.position);
      if (te !== els.lastTimeEl) { els.lastTimeEl = te; els.timeEl.textContent = te; }
      const tr = '-' + fmtTime(deck.duration - deck.position);
      if (tr !== els.lastTimeRem) { els.lastTimeRem = tr; els.timeRem.textContent = tr; }
      if (deck.playing) els.bpm.textContent = deck.effBpm.toFixed(1);
    }
  }
  _canvasDirty = false; // המדידה (אם הייתה) בוצעה לכל הקנבסים בפריים הזה
  requestAnimationFrame(rafLoop);
}

/* ==================== ספרייה + המלצות AI ==================== */
const library = [];
let trackSeq = 0;
let onlyMatches = false; // מצב "רק מתאימים" — מסנן ומסדר לפי התאמה
let vibeQuery = '';      // 🔍 חיפוש לפי אווירה
const MATCH_THRESHOLD = 55;

/* ---------- 🔍 חיפוש לפי אווירה — שפת DJ בעברית ובאנגלית ---------- */
const VIBE_KEYWORDS = [
  { re: /צ'?יל|רגוע|לאונג|רקע|שקט|נעימ|chill|lounge|קבלת פנים/i, energy: [0, 0.55] },
  { re: /היפ ?הופ|hip ?hop|r&b|טראפ|trap/i, bpm: [60, 104] },
  { re: /רגאטון|לטיני|אפרו|מזרחית|reggaeton|latin|afro/i, bpm: [94, 114] },
  { re: /פופ|דיסקו|בת מצווה|בר מצווה|pop|disco/i, bpm: [106, 125] },
  { re: /חתונה|wedding/i, bpm: [106, 132] },
  { re: /האוס|מועדון|בריכה|house|club|pool/i, bpm: [119, 132] },
  { re: /טבע|פסיי|גואה|psy|goa/i, bpm: [120, 150] },
  { re: /טכנו|טראנס|פסטיבל|edm|techno|trance/i, bpm: [127, 145] },
  { re: /דראם|הארדסטייל|רייב|dnb|drum|hardstyle|rave/i, bpm: [140, 200] },
  { re: /שיא|פיק|אנרגטי|חזק|peak|energy/i, energy: [0.5, 1] },
  { re: /פתיחה|התחלה|חימום|warm|opening/i, energy: [0, 0.45] },
  { re: /מהיר|fast/i, bpm: [124, 200] },
  { re: /איטי|slow/i, bpm: [60, 106] }
];
const VIBE_STOPWORDS = ['אני', 'רוצה', 'צריך', 'תבנה', 'בנה', 'לי', 'של', 'עם', 'בשביל', 'פלייליסט', 'פליליסט', 'סט', 'שירים', 'שיר', 'דקות', 'שעה', 'שעתיים', 'מסיבת', 'מסיבה', 'ערב', 'אירוע', 'the', 'for', 'playlist'];

// פירוק בקשה בשפה חופשית לקריטריונים — משמש גם את החיפוש וגם את סוכן הפלייליסטים
function parseVibe(q) {
  let rest = q;
  // כמות/משך — מוסרים לפני זיהוי BPM כדי ש"60 דקות" לא יתפרש כקצב
  let count = null, minutes = null;
  const cm = rest.match(/(\d+)\s*שירים/);
  if (cm) { count = +cm[1]; rest = rest.replace(cm[0], ' '); }
  if (/חצי שעה/.test(rest)) { minutes = 30; rest = rest.replace(/חצי שעה/, ' '); }
  else if (/שעתיים/.test(rest)) { minutes = 120; rest = rest.replace(/שעתיים/, ' '); }
  else {
    const mm = rest.match(/(\d+)\s*דקות/);
    if (mm) { minutes = +mm[1]; rest = rest.replace(mm[0], ' '); }
    else if (/שעה/.test(rest)) { minutes = 60; rest = rest.replace(/שעה/, ' '); }
  }
  const crits = [];
  for (const k of VIBE_KEYWORDS) {
    if (k.re.test(rest)) { crits.push(k); rest = rest.replace(k.re, ' '); }
  }
  let bpmRange = null;
  const num = rest.match(/(\d{2,3})/);
  if (num && +num[1] >= 60 && +num[1] <= 200) {
    bpmRange = [+num[1] * 0.94, +num[1] * 1.06];
    rest = rest.replace(num[1], ' ');
  }
  const words = rest.toLowerCase().split(/[\s,.!?"'\-–]+/)
    .filter(w => w.length >= 2 && !VIBE_STOPWORDS.includes(w));
  return { crits, bpmRange, words, count, minutes };
}

function vibeScore(t, parsed) {
  if (!t.analysis) return 0;
  const a = t.analysis;
  let score = 0;
  for (const c of parsed.crits) {
    let ok = true;
    if (c.bpm && !(a.bpm >= c.bpm[0] && a.bpm <= c.bpm[1])) ok = false;
    if (c.energy && !(a.energy >= c.energy[0] && a.energy <= c.energy[1])) ok = false;
    if (ok) score += 2;
  }
  if (parsed.bpmRange && a.bpm >= parsed.bpmRange[0] && a.bpm <= parsed.bpmRange[1]) score += 2;
  const hay = (t.title + ' ' + t.artist + ' ' + (t.folder || '')).toLowerCase();
  for (const w of parsed.words) if (hay.includes(w)) score += 3;
  return score;
}

function vibeFilter(rows, q) {
  const parsed = parseVibe(q);
  return rows.map(r => {
    const s = vibeScore(r.t, parsed);
    return s > 0 ? Object.assign({}, r, { vibe: s }) : null;
  }).filter(Boolean).sort((x, y) => y.vibe - x.vibe || (y.match ?? -1) - (x.match ?? -1));
}

function parseName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const parts = base.split(' - ');
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: base.trim() };
}

function refDeck() {
  // הדק שביחס אליו מחשבים התאמות: קודם דק שמנגן, אחרת דק טעון
  if (deckA.playing && deckB.playing) return (+$('#xf').value <= 0) ? deckA : deckB;
  if (deckA.playing) return deckA;
  if (deckB.playing) return deckB;
  if (deckA.track) return deckA;
  if (deckB.track) return deckB;
  return null;
}

function renderLibrary() {
  const tbody = $('#libBody');
  tbody.innerHTML = '';
  $('#libCount').textContent = library.length ? library.length + ' שירים' : '';
  if (!library.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">הספרייה ריקה — לחץ על "+ הוסף שירים" או גרור קבצי אודיו (MP3 / WAV / M4A) לכאן</td></tr>';
    return;
  }
  const ref = refDeck();
  let rows = library.map(t => {
    let match = null;
    if (ref && ref.track && t.analysis && t.id !== ref.track.id) {
      match = matchScore(ref.effBpm, ref.track.analysis.camelot, t.analysis);
    }
    return { t, match };
  });
  const status = $('#searchStatus');
  status.textContent = '';
  if (vibeQuery.trim()) {
    rows = vibeFilter(rows, vibeQuery.trim());
    status.textContent = rows.length
      ? `🔍 נמצאו ${rows.length} שירים שמתאימים לאווירה שחיפשת`
      : '🔍 לא נמצא שיר שמתאים לאווירה הזו — נסה מילים אחרות (למשל: חתונה, שיא, רגוע, מועדון, 128)';
    if (!rows.length) { tbody.innerHTML = ''; return; }
  } else if (onlyMatches) {
    if (!ref || !ref.track) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">🎯 טען שיר לדק כדי שאדע למה להתאים</td></tr>';
      return;
    }
    rows = rows.filter(r => r.match !== null && r.match >= MATCH_THRESHOLD)
               .sort((a, b) => b.match - a.match);
    if (!rows.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">🎯 אין בספרייה שירים שמתאימים מספיק לשיר הנוכחי — הוסף עוד שירים</td></tr>';
      return;
    }
  }
  for (const { t, match } of rows) {
    const tr = document.createElement('tr');
    if (!t.analysis) {
      tr.innerHTML = `<td class="row-title">${escapeHtml(t.title)}</td><td colspan="5" class="analyzing">⏳ מנתח BPM וסולם…</td>`;
    } else {
      const a = t.analysis;
      const matchHtml = match === null ? '<span class="match-chip" style="color:#556">—</span>'
        : `<span class="match-chip" style="color:${match >= 80 ? '#4ade80' : match >= 55 ? '#facc15' : '#f87171'}">${match}%</span>`;
      const subParts = [];
      if (t.folderName) subParts.push(`<span class="folder-chip" title="${escapeHtml(t.folder)}">📁 ${escapeHtml(t.folderName)}</span>`);
      if (t.artist) subParts.push(escapeHtml(t.artist));
      tr.innerHTML =
        `<td><div class="row-title">${escapeHtml(t.title)}</div>${subParts.length ? `<div class="row-sub" style="direction:ltr;text-align:right">${subParts.join(' · ')}</div>` : ''}</td>` +
        `<td class="mono">${a.bpm.toFixed(1)}</td>` +
        `<td><span class="key-chip" style="background:${camelotColor(a.camelot)}">${a.camelot || '--'}</span></td>` +
        `<td class="mono">${fmtTime(a.duration)}</td>` +
        `<td>${matchHtml}</td>` +
        `<td><button class="load-btn a" data-id="${t.id}" data-deck="A">A</button><button class="load-btn b" data-id="${t.id}" data-deck="B">B</button></td>`;
    }
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let recFlashTimer = null;
function flashRec(msg) {
  const el = $('#aiRec');
  el.innerHTML = msg;
  clearTimeout(recFlashTimer);
  recFlashTimer = setTimeout(updateRecs, 4000);
}

function candidatesFor(deck, excludeDeck) {
  // מועמדים למיקס אחרי השיר שעל הדק הנתון, מסודרים לפי התאמה
  return library
    .filter(t => t.analysis && t.id !== deck.track.id &&
      !(excludeDeck && excludeDeck.track && excludeDeck.track.id === t.id))
    .map(t => ({ t, s: matchScore(deck.effBpm, deck.track.analysis.camelot, t.analysis) }))
    .sort((a, b) => b.s - a.s);
}

function pctColor(s) { return s >= 80 ? '#4ade80' : s >= MATCH_THRESHOLD ? '#facc15' : '#f87171'; }

// עדכון קל: רק כרטיסי ההמלצה והטקסט — בלי בנייה מחדש של טבלת הספרייה
function renderRecCards() {
  const el = $('#aiRec');
  const cardsEl = $('#recCards');
  const ref = refDeck();
  if (!ref || !ref.track) {
    el.innerHTML = 'טען שירים והתחל לנגן — אמליץ לך מה מתאים למיקס הבא';
    cardsEl.innerHTML = '';
    return;
  }
  const adj = otherDeck(ref);
  const cands = candidatesFor(ref, null);
  if (!cands.length) {
    el.innerHTML = `${ref.playing ? 'מנגן' : 'טעון'} על דק ${ref.id}: <b>${escapeHtml(ref.track.title)}</b> — הוסף עוד שירים לספרייה ואמליץ מה מתאים אחריו`;
    cardsEl.innerHTML = '';
  } else {
    el.innerHTML = `המתאימים ביותר אחרי <b>${escapeHtml(ref.track.title)}</b> (דק ${ref.id}) — לחיצה טוענת לדק ${adj.id}:`;
    cardsEl.innerHTML = cands.slice(0, 3).map(({ t, s }, i) => {
      const a = t.analysis;
      return `<div class="rec-card${i === 0 ? ' rank1' : ''}">
        <div class="rec-pct" style="color:${pctColor(s)}">${s}%<small>התאמה</small></div>
        <div class="rec-info">
          <div class="rec-name">${escapeHtml(t.title)}</div>
          <div class="rec-meta">${a.bpm.toFixed(1)} BPM · ${a.camelot || '--'} ${a.keyName || ''} · ${fmtTime(a.duration)}${t.folderName ? ' · 📁 ' + escapeHtml(t.folderName) : ''}</div>
        </div>
        <button class="rec-load to-${adj.id.toLowerCase()}" data-id="${t.id}" data-deck="${adj.id}">טען ל-${adj.id}</button>
      </div>`;
    }).join('');
  }
}

// עדכון מלא: המלצות + טבלת הספרייה. נקרא רק בשינוי אמיתי (טעינה, הוספה, סינון)
function updateRecs() {
  renderRecCards();
  renderLibrary();
}

/* ---------- טוסט: המלצת טעינה לדק הסמוך ---------- */
let toastTimer = null;
function suggestForAdjacent(deck) {
  if (!deck.track) return;
  if (PLAYLIST.active) return; // באוטו-DJ הסוכן כבר קבע את התור — בלי טוסטים
  const adj = otherDeck(deck);
  const cands = candidatesFor(deck, adj);
  if (!cands.length || cands[0].s < 45) return;
  const best = cands[0];
  const a = best.t.analysis;
  $('#toastText').innerHTML =
    `💡 מומלץ לטעון לדק <b>${adj.id}</b>: <b>${escapeHtml(best.t.title)}</b>` +
    (best.t.folderName ? ` (מתיקיית <b>${escapeHtml(best.t.folderName)}</b>)` : '') +
    ` — התאמה <b>${best.s}%</b>` +
    `<span style="color:#93a3c0;direction:ltr;display:inline-block;margin-inline-start:6px">(${a.bpm.toFixed(0)} BPM, ${a.camelot || '?'})</span>`;
  const loadBtn = $('#toastLoad');
  loadBtn.textContent = 'טען לדק ' + adj.id;
  loadBtn.dataset.id = best.t.id;
  loadBtn.dataset.deck = adj.id;
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 10000);
}
function hideToast() {
  $('#toast').classList.add('hidden');
  clearTimeout(toastTimer);
}

/* ---------- טיפים: סגנון אירוע, שלב בסט, סולמות משתלבים ---------- */
function eventStylesFor(bpm) {
  if (bpm < 95) return { styles: 'היפ-הופ / R&B / צ\'יל', events: 'קבלת פנים, לאונג\', ערב צעיר רגוע' };
  if (bpm < 110) return { styles: 'רגאטון / אפרוביט / מזרחית קצבית', events: 'חתונות, בר/בת מצווה, מסיבות לטיניות' };
  if (bpm < 122) return { styles: 'פופ / דיסקו / פאנק', events: 'חתונות, אירועי חברה, קהל מגוון בכל גיל' };
  if (bpm < 130) return { styles: 'האוס / דאנס', events: 'מועדונים, שיא הריקודים בחתונה, מסיבות בריכה' };
  if (bpm < 142) return { styles: 'EDM / טכנו / טראנס', events: 'מועדונים, פסטיבלים, קהל צעיר' };
  return { styles: 'דראם אנד בייס / הארדסטייל', events: 'רייבים, פיקים אנרגטיים, קהל מנוסה' };
}
function setPositionFor(energy) {
  if (energy < 0.35) return { tag: 'פתיחת סט / רקע', tip: 'אנרגיה נמוכה — מצוין לחימום הרחבה או לזמן האוכל, לא לשעת השיא' };
  if (energy < 0.6) return { tag: 'אמצע הסט', tip: 'אנרגיה בינונית — טוב לבנות איתו עלייה הדרגתית לקראת השיא' };
  return { tag: 'שיא הערב 🔥', tip: 'אנרגיה גבוהה — שמור אותו לרחבה מלאה, ורד ממנו בהדרגה ולא בבת אחת' };
}
function compatibleKeys(cam) {
  if (!cam) return null;
  const n = parseInt(cam), L = cam.slice(-1);
  const other = L === 'A' ? 'B' : 'A';
  const up = (n % 12) + 1, down = ((n + 10) % 12) + 1;
  return `${cam} (זהה) · ${up}${L} ו-${down}${L} (שכנים) · ${n}${other} (מז'ור/מינור מקביל)`;
}
/* ---------- 📊 ניתוח האזור: כל המוזיקה שהועלתה (תיקייה / כונן) ---------- */
function buildAreaAnalysis(tracks) {
  if (tracks.length < 2) return '';
  const folders = {};
  for (const t of tracks) {
    const f = t.folderName || 'ללא תיקייה';
    (folders[f] = folders[f] || []).push(t);
  }
  const events = {};
  for (const t of tracks) {
    const ev = eventStylesFor(t.analysis.bpm).events;
    (events[ev] = events[ev] || []).push(t);
  }
  let html = `<div class="tip-track area-analysis">
    <div class="tip-track-head">
      <span class="tip-track-name" style="direction:rtl">📊 ניתוח האזור שלך</span>
      <span class="tip-tags"><span class="tag">${tracks.length} שירים</span><span class="tag">${Object.keys(folders).length} תיקיות</span></span>
    </div>
    <div class="tip-lines"><b>כיסוי אירועים:</b><br>`;
  for (const [ev, list] of Object.entries(events).sort((a, b) => b[1].length - a[1].length)) {
    const top = list.slice().sort((x, y) => y.analysis.energy - x.analysis.energy).slice(0, 3);
    html += `🎉 <b>${ev}</b> — ${list.length} שירים. מומלצים: ${top.map(t => escapeHtml(t.title)).join(' · ')}<br>`;
  }
  const folderNames = Object.keys(folders).filter(f => f !== 'ללא תיקייה');
  if (folderNames.length) {
    html += `<br><b>אופי התיקיות:</b><br>`;
    for (const f of folderNames) {
      const list = folders[f];
      const avgBpm = list.reduce((s, t) => s + t.analysis.bpm, 0) / list.length;
      const styleCount = {};
      for (const t of list) {
        const st = eventStylesFor(t.analysis.bpm).styles;
        styleCount[st] = (styleCount[st] || 0) + 1;
      }
      const domStyle = Object.entries(styleCount).sort((a, b) => b[1] - a[1])[0][0];
      html += `📁 <b>${escapeHtml(f)}</b> — ${list.length} שירים, ממוצע ${avgBpm.toFixed(0)} BPM, בעיקר ${domStyle}<br>`;
    }
  }
  return html + '</div></div>';
}

function buildTips() {
  const body = $('#tipsBody');
  const tracks = library.filter(t => t.analysis);
  let html = '';
  if (!tracks.length) {
    html = '<div class="tips-empty">טען שירים לספרייה ואנתח לך כל אחד: לאיזה אירוע הוא מתאים, לאיזה שלב בסט, ועם מה למקסס אותו</div>';
  } else {
    html += buildAreaAnalysis(tracks);
    html += tracks.map(t => {
      const a = t.analysis;
      const ev = eventStylesFor(a.bpm);
      const pos = setPositionFor(a.energy);
      const keys = compatibleKeys(a.camelot);
      const partners = candidatesFor({ track: t, effBpm: a.bpm, id: '' }, null)
        .filter(c => c.s >= MATCH_THRESHOLD).slice(0, 2);
      return `<div class="tip-track">
        <div class="tip-track-head">
          <span class="tip-track-name">${escapeHtml(t.title)}</span>
          <span class="tip-tags">
            <span class="tag">${a.bpm.toFixed(0)} BPM · ${a.camelot || '--'}</span>
            <span class="tag event">🎉 ${ev.events}</span>
            <span class="tag pos">${pos.tag}</span>
          </span>
        </div>
        <div class="tip-lines">
          <b>סגנון:</b> ${ev.styles}<br>
          <b>מתי לנגן:</b> ${pos.tip}<br>
          ${keys ? `<b>סולמות שמשתלבים:</b> <span style="direction:ltr;display:inline-block">${keys}</span><br>` : ''}
          ${partners.length ? `<b>מהספרייה שלך, מתחבר מעולה עם:</b> ${partners.map(p => `${escapeHtml(p.t.title)} (${p.s}%)`).join(' · ')}` : ''}
        </div>
      </div>`;
    }).join('');
  }
  html += `<div class="tips-general">
    <h3>📚 טיפים כלליים למיקס</h3>
    <ul>
      <li><b>מיקס הרמוני:</b> עבור לשיר עם אותו מספר קאמלוט, שכן (±1), או האות השנייה — המעבר יישמע "נכון" גם בלי לדעת למה.</li>
      <li><b>החלפת בסים:</b> במעבר, הורד את ה-LOW של השיר היוצא לפני שאתה מרים את ה-LOW של הנכנס — שני בסים יחד יוצרים בוץ.</li>
      <li><b>קפיצות BPM:</b> אל תקפוץ יותר מ-±8% בקצב. רוצה לעבור מ-100 ל-128? עבור דרך שיר ביניים או השתמש בברייק.</li>
      <li><b>בנה גל אנרגיה:</b> פתח נמוך, טפס לשיא, תן לרחבה לנשום עם ירידה קטנה, וטפס שוב — אף אחד לא רוקד 3 שעות ברצף.</li>
      <li><b>מעברים על פריזים:</b> התחל מעבר בתחילת משפט מוזיקלי (כל 16 או 32 ביטים) — שם השיר "מתחלף" באופן טבעי.</li>
      <li><b>קרא את הרחבה, לא את המסך:</b> אם ההמלצה שלי 95% אבל הרחבה מתה — תחליף כיוון. ה-AI עוזר, הקהל מחליט.</li>
    </ul>
  </div>`;
  body.innerHTML = html;
}
function openTips() { buildTips(); $('#tipsModal').classList.remove('hidden'); }
function closeTips() { $('#tipsModal').classList.add('hidden'); }

async function addFiles(files) {
  const audio = [...files].filter(f => /audio|\.mp3$|\.wav$|\.m4a$|\.ogg$|\.flac$|\.aac$/i.test(f.type + f.name));
  if (!audio.length) return;
  const pending = [];
  for (const f of audio) {
    const { artist, title } = parseName(f.name);
    // מסלול התיקייה — מהעלאת תיקייה (webkitRelativePath) או מגרירת תיקייה (_relPath)
    const rel = f._relPath || f.webkitRelativePath || '';
    const folder = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '';
    const folderName = folder ? folder.split('/').pop() : '';
    const t = { id: ++trackSeq, title, artist, folder, folderName, file: f, buffer: null, analysis: null };
    library.push(t);
    pending.push(t);
  }
  renderLibrary();
  for (const t of pending) {
    try {
      const ab = await t.file.arrayBuffer();
      t.buffer = await AC.decodeAudioData(ab);
      t.analysis = await analyzeTrack(t.buffer);
    } catch (e) {
      console.error('שגיאה בניתוח', t.title, e);
      const i = library.indexOf(t);
      if (i >= 0) library.splice(i, 1);
      flashRec(`⚠️ לא הצלחתי לקרוא את "${escapeHtml(t.title)}" — ייתכן שהפורמט לא נתמך בדפדפן`);
    }
    updateRecs();
  }
}

/* ==================== רעש סקראץ' — חיכוך ויניל שמגיב למהירות ==================== */
const NOISE_BUF = (() => {
  const len = Math.floor(AC.sampleRate * 0.5);
  const buf = AC.createBuffer(1, len, AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
})();

function startScratchNoise(deck) {
  const src = AC.createBufferSource();
  src.buffer = NOISE_BUF; src.loop = true;
  const bp = AC.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.9;
  const g = AC.createGain(); g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start();
  deck._scratch = { src, bp, g };
}
function scratchNoiseMove(deck, speed) {
  // speed = שניות שיר לשנייה אמיתית — 1.0 בערך כמו נגינה רגילה
  const s = deck._scratch;
  if (!s) return;
  const now = AC.currentTime;
  const level = clamp(speed * 0.55, 0, 0.5);
  s.g.gain.cancelScheduledValues(now);
  s.g.gain.setValueAtTime(Math.max(s.g.gain.value, level), now);
  s.g.gain.setTargetAtTime(0, now, 0.09); // דועך מהר כשמפסיקים לסובב
  s.bp.frequency.value = 700 + Math.min(3800, speed * 2200);
}
function stopScratchNoise(deck) {
  const s = deck._scratch;
  if (!s) return;
  deck._scratch = null;
  s.g.gain.setTargetAtTime(0, AC.currentTime, 0.03);
  setTimeout(() => { try { s.src.stop(); } catch (e) {} try { s.src.disconnect(); } catch (e) {} }, 250);
}

/* ==================== פלטה: סקראץ' וגרירה ==================== */
function wirePlatter(deck) {
  const el = $('#platter' + deck.id);
  let dragging = false, lastAng = 0, wasPlaying = false, lastT = 0;
  const angOf = e => {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  el.addEventListener('pointerdown', e => {
    if (!deck.track) return;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    lastAng = angOf(e);
    lastT = e.timeStamp;
    wasPlaying = deck.playing;
    if (wasPlaying) deck.pause(); // "עצירת התקליט" בזמן מגע — כמו ויניל אמיתי
    if (AC.state !== 'running') AC.resume();
    startScratchNoise(deck);
    el.classList.add('grabbing');
    e.preventDefault();
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const a = angOf(e);
    let d = a - lastAng;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    lastAng = a;
    // סיבוב מלא = 1.8 שניות של שיר (33⅓ סל"ד)
    const posDelta = d / (2 * Math.PI) * 1.8;
    deck.seek(deck.position + posDelta);
    const dt = Math.max(1, e.timeStamp - lastT) / 1000;
    lastT = e.timeStamp;
    scratchNoiseMove(deck, Math.abs(posDelta) / dt);
  });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('grabbing');
    stopScratchNoise(deck);
    if (wasPlaying) deck.play();
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
}

/* ==================== 🪄 סוכן הפלייליסטים + אוטו-DJ ==================== */
const PLAYLIST = { queue: [], active: false, mixArmed: false, lastBuilt: null, mode: 'auto' };

function buildPlaylist(prompt) {
  const parsed = parseVibe(prompt);
  const cands = library.filter(t => t.analysis)
    .map(t => ({ t, s: vibeScore(t, parsed) }));
  if (!cands.length) return { order: [], note: '', parsed };
  let pool = cands.filter(c => c.s > 0);
  let note = '';
  if (pool.length < 3) {
    pool = cands.slice();
    note = 'לא מצאתי מספיק שירים שתואמים בדיוק את הבקשה, אז השלמתי מהקרובים ביותר בספרייה. ';
  }
  pool.sort((a, b) => b.s - a.s);
  // כמות: לפי בקשה מפורשת, לפי משך מבוקש, או ברירת מחדל
  let picked;
  if (parsed.minutes) {
    picked = [];
    let total = 0;
    for (const c of pool) {
      if (total >= parsed.minutes * 60) break;
      picked.push(c.t);
      total += c.t.analysis.duration;
    }
  } else {
    picked = pool.slice(0, parsed.count || Math.min(12, pool.length)).map(c => c.t);
  }
  // סידור מקצועי: מתחילים מהאנרגיה הנמוכה, וכל שיר הבא נבחר לפי
  // התאמה הרמונית + קצב, עם עדיפות לעלייה הדרגתית באנרגיה
  if (picked.length > 2) {
    const start = picked.slice().sort((a, b) => a.analysis.energy - b.analysis.energy)[0];
    const remaining = new Set(picked);
    remaining.delete(start);
    const order = [start];
    while (remaining.size) {
      const cur = order[order.length - 1];
      let best = null, bs = -Infinity;
      for (const t of remaining) {
        let s = matchScore(cur.analysis.bpm, cur.analysis.camelot, t.analysis);
        if (t.analysis.energy >= cur.analysis.energy - 0.05) s += 6;
        if (s > bs) { bs = s; best = t; }
      }
      order.push(best);
      remaining.delete(best);
    }
    picked = order;
  }
  return { order: picked, note, parsed };
}

function renderPlaylistResult(res, prompt) {
  const el = $('#plResult');
  PLAYLIST.lastBuilt = res.order;
  if (!res.order.length) {
    el.innerHTML = '<div class="pl-note">אין שירים מנותחים בספרייה — הוסף שירים או תיקייה ונסה שוב</div>';
    return;
  }
  const total = res.order.reduce((s, t) => s + t.analysis.duration, 0);
  const avg = res.order.reduce((s, t) => s + t.analysis.bpm, 0) / res.order.length;
  const items = res.order.map((t, i) => {
    const a = t.analysis;
    const pos = setPositionFor(a.energy);
    return `<li>
      <span class="pl-idx">${i + 1}</span>
      <span class="pl-title">${escapeHtml(t.title)}</span>
      <span class="pl-meta">${a.bpm.toFixed(0)} BPM · ${a.camelot || '--'}${t.folderName ? ' · 📁 ' + escapeHtml(t.folderName) : ''} · ${pos.tag}</span>
    </li>`;
  }).join('');
  el.innerHTML = `
    <div class="pl-note">🤖 ${res.note}בניתי לך פלייליסט של <b>${res.order.length} שירים</b>
      (${fmtTime(total)}, ממוצע ${avg.toFixed(0)} BPM) לפי "<b>${escapeHtml(prompt)}</b>",
      מסודר מהרגוע לשיא עם מעברים הרמוניים:</div>
    <ol class="pl-list">${items}</ol>
    <div class="pl-actions">
      <button class="btn pl-start" id="plStart">▶ טען והתחל אוטו-DJ</button>
      <button class="btn" id="plRebuild">🔀 בנה שוב</button>
    </div>`;
  $('#plStart').addEventListener('click', () => {
    startPlaylist(PLAYLIST.lastBuilt);
    $('#plModal').classList.add('hidden');
  });
  $('#plRebuild').addEventListener('click', () => $('#plBuild').click());
}

function startPlaylist(tracks) {
  if (!tracks || !tracks.length) return;
  PLAYLIST.queue = tracks.slice();
  PLAYLIST.active = true;
  PLAYLIST.mixArmed = false;
  deckA.load(PLAYLIST.queue.shift());
  if (PLAYLIST.queue.length) deckB.load(PLAYLIST.queue.shift());
  $('#xf').value = -100;
  applyXfade();
  deckA.play();
  updatePlaylistBar();
  flashRec(PLAYLIST.mode === 'auto'
    ? '🎶 אוטו-DJ התחיל — המעברים בין השירים יקרו לבד'
    : '🎶 אוטו-DJ (ידני) — לחץ "הבא עכשיו" כשתרצה להכניס את השיר הבא');
}

function stopPlaylist() {
  PLAYLIST.active = false;
  PLAYLIST.queue = [];
  PLAYLIST.mixArmed = false;
  updatePlaylistBar();
}

// מעבר יזום ע"י ה-DJ (מצב ידני, או הקדמה במצב אוטומטי)
function playlistMixNow() {
  if (!PLAYLIST.active || autoMixBusy || PLAYLIST.mixArmed) return;
  const live = deckA.playing ? deckA : (deckB.playing ? deckB : null);
  if (!live) return;
  const next = otherDeck(live);
  if (!next.track || next.playing) { flashRec('ℹ️ אין שיר מוכן בדק הסמוך'); return; }
  PLAYLIST.mixArmed = true;
  autoMix();
  updatePlaylistBar();
}

function setPlaylistMode(mode) {
  PLAYLIST.mode = mode;
  updatePlaylistBar();
}

function updatePlaylistBar() {
  const bar = $('#plBar');
  bar.classList.toggle('hidden', !PLAYLIST.active);
  if (!PLAYLIST.active) return;
  const nextDeck = deckA.playing ? deckB : deckA;
  const upcoming = [];
  if (nextDeck.track && !nextDeck.playing) upcoming.push(nextDeck.track.title);
  for (const t of PLAYLIST.queue.slice(0, 2)) upcoming.push(t.title);
  $('#plNext').textContent = upcoming.length
    ? 'הבא: ' + upcoming.join(' ← ') + (PLAYLIST.queue.length > 2 ? ` (+${PLAYLIST.queue.length - 2} בתור)` : '')
    : 'זה השיר האחרון בפלייליסט';
  // מצב + כפתור "הבא עכשיו"
  const modeBtn = $('#plModeBtn');
  if (modeBtn) {
    modeBtn.textContent = PLAYLIST.mode === 'auto' ? '🔄 מעבר: אוטומטי' : '✋ מעבר: ידני';
    modeBtn.classList.toggle('manual', PLAYLIST.mode === 'manual');
  }
  const nowBtn = $('#plNowBtn');
  if (nowBtn) {
    const canMix = !autoMixBusy && !PLAYLIST.mixArmed && (nextDeck.track && !nextDeck.playing);
    nowBtn.disabled = !canMix;
  }
}

/* ==================== גרירת תיקיות: סריקה רקורסיבית ==================== */
async function filesFromDataTransfer(dt) {
  // חובה לאסוף את ה-entries באופן סינכרוני לפני await — אחרת ה-DataTransfer מתרוקן
  const entries = [...dt.items].map(it => it.webkitGetAsEntry ? it.webkitGetAsEntry() : null);
  const plainFiles = [...dt.files];
  const out = [];
  const walk = async entry => {
    if (!entry) return;
    if (entry.isFile) {
      const f = await new Promise(res => entry.file(res, () => res(null)));
      if (f) { f._relPath = entry.fullPath.replace(/^\//, ''); out.push(f); }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise(res => reader.readEntries(res, () => res([])));
        for (const e of batch) await walk(e);
      } while (batch.length);
    }
  };
  let anyEntry = false;
  for (const e of entries) { if (e) { anyEntry = true; await walk(e); } }
  return anyEntry ? out : plainFiles;
}

/* ==================== חיווט הממשק ==================== */
function wireDeck(deck) {
  const id = deck.id;
  $('#play' + id).addEventListener('click', () => deck.toggle());
  $('#cue' + id).addEventListener('click', () => deck.pressCue());
  $('#sync' + id).addEventListener('click', () => syncDeck(deck));
  $('#loop' + id).addEventListener('click', () => deck.toggleLoop());
  $('#pitch' + id).addEventListener('input', e => deck.setRate(1 + (+e.target.value) / 100));
  $('#pitchReset' + id).addEventListener('click', () => {
    $('#pitch' + id).value = 0;
    deck.setRate(1);
  });
  // nudge — החזקה
  const nudge = (btn, factor) => {
    let saved = null;
    const down = e => { e.preventDefault(); saved = deck.rate; deck.setRate(deck.rate * factor); };
    const up = () => { if (saved !== null) { deck.setRate(saved); saved = null; } };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
  };
  nudge($('#nudgeL' + id), 0.96);
  nudge($('#nudgeR' + id), 1.04);
  // סקירה — דילוג בלחיצה/גרירה
  const over = $('#over' + id);
  const seekFromEvent = e => {
    if (!deck.track) return;
    const r = over.getBoundingClientRect();
    deck.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * deck.duration);
  };
  let overDrag = false;
  over.addEventListener('pointerdown', e => { overDrag = true; over.setPointerCapture(e.pointerId); seekFromEvent(e); });
  over.addEventListener('pointermove', e => { if (overDrag) seekFromEvent(e); });
  over.addEventListener('pointerup', () => overDrag = false);
  // גרירת קובץ ישירות לדק
  const sec = $('#deck' + id);
  sec.addEventListener('dragover', e => e.preventDefault());
  sec.addEventListener('drop', async e => {
    e.preventDefault();
    const before = library.length;
    await addFiles(await filesFromDataTransfer(e.dataTransfer));
    const added = library.slice(before);
    const ready = added.find(t => t.analysis);
    if (ready) deck.load(ready);
  });
}

wireDeck(deckA);
wireDeck(deckB);

// מיקסר — EQ: מרכז = 0dB, שמאלה חיתוך עד ‎-30dB, ימינה הגברה עד ‎+9dB
// הרפרנסים נשמרים ב-KNOBS כדי שגם קונטרולר MIDI יוכל לסובב אותם (midi.js)
const KNOBS = {};
const eqGain = v => v <= 0 ? v * 30 : v * 9;
KNOBS.hiA = makeKnob($('#hiA'), { min: -1, max: 1, def: 0, onChange: v => deckA.eqHigh.gain.value = eqGain(v) });
KNOBS.midA = makeKnob($('#midA'), { min: -1, max: 1, def: 0, onChange: v => deckA.eqMid.gain.value = eqGain(v) });
KNOBS.lowA = makeKnob($('#lowA'), { min: -1, max: 1, def: 0, onChange: v => deckA.eqLow.gain.value = eqGain(v) });
KNOBS.filtA = makeKnob($('#filtA'), { min: -1, max: 1, def: 0, onChange: v => applyFilter(deckA, v) });
KNOBS.hiB = makeKnob($('#hiB'), { min: -1, max: 1, def: 0, onChange: v => deckB.eqHigh.gain.value = eqGain(v) });
KNOBS.midB = makeKnob($('#midB'), { min: -1, max: 1, def: 0, onChange: v => deckB.eqMid.gain.value = eqGain(v) });
KNOBS.lowB = makeKnob($('#lowB'), { min: -1, max: 1, def: 0, onChange: v => deckB.eqLow.gain.value = eqGain(v) });
KNOBS.filtB = makeKnob($('#filtB'), { min: -1, max: 1, def: 0, onChange: v => applyFilter(deckB, v) });

// פלטות + אפקטים לכל דק
for (const deck of [deckA, deckB]) {
  const id = deck.id;
  wirePlatter(deck);
  for (const [key, name] of [['echo', 'Echo'], ['verb', 'Verb'], ['flng', 'Flng'], ['dist', 'Dist']]) {
    $('#fx' + name + id).addEventListener('click', e => {
      deck.fx[key] = !deck.fx[key];
      e.currentTarget.classList.toggle('on', deck.fx[key]);
      deck.applyFx();
    });
  }
  KNOBS['fxAmt' + id] = makeKnob($('#fxAmt' + id), { min: 0, max: 1, def: 0.5, onChange: v => { deck.fx.amt = v; deck.applyFx(); } });
}

$('#volA').addEventListener('input', e => applyVol(deckA, +e.target.value));
$('#volB').addEventListener('input', e => applyVol(deckB, +e.target.value));
$('#xf').addEventListener('input', applyXfade);
$('#xf').addEventListener('dblclick', e => { e.target.value = 0; applyXfade(); });
$('#masterVol').addEventListener('input', e => master.gain.value = (+e.target.value / 100) ** 1.5);
$('#automix').addEventListener('click', autoMix);

// ספרייה
$('#addTracks').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('#onlyMatches').addEventListener('click', e => {
  onlyMatches = !onlyMatches;
  e.currentTarget.classList.toggle('on', onlyMatches);
  renderLibrary();
});

// 🔍 חיפוש לפי אווירה
$('#vibeInput').addEventListener('input', e => {
  vibeQuery = e.target.value;
  renderLibrary();
});
$('#vibeClear').addEventListener('click', () => {
  vibeQuery = '';
  $('#vibeInput').value = '';
  renderLibrary();
});
$('#vibeInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); $('#vibeClear').click(); e.target.blur(); }
});
$('#libBody').addEventListener('click', e => {
  const btn = e.target.closest('.load-btn');
  if (!btn) return;
  const t = library.find(x => x.id === +btn.dataset.id);
  if (t && t.analysis) decks[btn.dataset.deck].load(t);
});

// פאנל המלצות — טעינה בלחיצה
$('#recCards').addEventListener('click', e => {
  const btn = e.target.closest('.rec-load');
  if (!btn) return;
  const t = library.find(x => x.id === +btn.dataset.id);
  if (t && t.analysis) decks[btn.dataset.deck].load(t);
});

// טוסט המלצת טעינה
$('#toastLoad').addEventListener('click', e => {
  const t = library.find(x => x.id === +e.currentTarget.dataset.id);
  hideToast();
  if (t && t.analysis) decks[e.currentTarget.dataset.deck].load(t);
});
$('#toastClose').addEventListener('click', hideToast);

// 🪄 סוכן הפלייליסטים
$('#plOpenBtn').addEventListener('click', () => {
  $('#plModal').classList.remove('hidden');
  $('#plPrompt').focus();
});
$('#plClose').addEventListener('click', () => $('#plModal').classList.add('hidden'));
$('#plModal').addEventListener('click', e => { if (e.target === e.currentTarget) $('#plModal').classList.add('hidden'); });
$('#plBuild').addEventListener('click', () => {
  const prompt = $('#plPrompt').value.trim();
  if (!prompt) { $('#plPrompt').focus(); return; }
  renderPlaylistResult(buildPlaylist(prompt), prompt);
});
$('#plPrompt').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('#plBuild').click();
  if (e.key === 'Escape') e.stopPropagation();
});
$('#plStop').addEventListener('click', () => {
  stopPlaylist();
  flashRec('⏹ אוטו-DJ נעצר — השליטה חזרה אליך');
});
$('#plModeBtn').addEventListener('click', () => setPlaylistMode(PLAYLIST.mode === 'auto' ? 'manual' : 'auto'));
$('#plNowBtn').addEventListener('click', playlistMixNow);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') $('#plModal').classList.add('hidden');
});

// חלון טיפים
$('#tipsBtn').addEventListener('click', openTips);
$('#tipsClose').addEventListener('click', closeTips);
$('#tipsModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeTips(); });
const libSec = $('#library');
libSec.addEventListener('dragover', e => { e.preventDefault(); libSec.classList.add('dragover'); });
libSec.addEventListener('dragleave', () => libSec.classList.remove('dragover'));
libSec.addEventListener('drop', async e => {
  e.preventDefault();
  libSec.classList.remove('dragover');
  addFiles(await filesFromDataTransfer(e.dataTransfer));
});
$('#addFolder').addEventListener('click', () => $('#folderInput').click());
$('#folderInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

// קיצורי מקלדת
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeTips(); hideToast(); return; }
  if (e.repeat || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'q') deckA.toggle();
  if (k === 'p') deckB.toggle();
});

// המלצות מתעדכנות כשה-BPM האפקטיבי משתנה (פיץ' וכו') — עדכון קל בלבד, בלי בניית הטבלה
setInterval(() => { if (refDeck()) renderRecCards(); }, 3000);

applyXfade();
renderLibrary();
rafLoop();
