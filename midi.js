'use strict';
/* PulseDeck — תמיכת קונטרולרים (Web MIDI)
   עובד עם כל קונטרולר ששולח MIDI דרך USB: Pioneer DDJ, Traktor Kontrol (במצב MIDI),
   Numark, Hercules, Denon ועוד. המיפוי נעשה עם "מצב לימוד" ונשמר אוטומטית. */

const MIDI = { access: null, learn: false, armed: null, map: {} };

// כל הפקדים שאפשר למפות לקונטרולר
const MIDI_MAPPABLE = [
  'playA', 'cueA', 'syncA', 'loopA', 'nudgeLA', 'nudgeRA', 'pitchResetA',
  'fxEchoA', 'fxVerbA', 'fxFlngA', 'fxDistA',
  'playB', 'cueB', 'syncB', 'loopB', 'nudgeLB', 'nudgeRB', 'pitchResetB',
  'fxEchoB', 'fxVerbB', 'fxFlngB', 'fxDistB',
  'automix', 'onlyMatches',
  'volA', 'volB', 'xf', 'masterVol', 'pitchA', 'pitchB',
  'hiA', 'midA', 'lowA', 'filtA', 'fxAmtA',
  'hiB', 'midB', 'lowB', 'filtB', 'fxAmtB',
  'platterA', 'platterB'
];

function midiTargetDef(id) {
  if (/^platter[AB]$/.test(id)) {
    const deck = id.endsWith('A') ? deckA : deckB;
    // ג'וג — CC יחסי: ערכים מתחת ל-64 = קדימה, מעל = אחורה (two's complement)
    return { type: 'jog', act: d => { if (deck.track) deck.seek(deck.position + d * 0.015); } };
  }
  if (/^(vol[AB]|xf|masterVol|pitch[AB])$/.test(id)) {
    return {
      type: 'range',
      act: v => {
        const el = $('#' + id);
        el.value = +el.min + v * (+el.max - +el.min);
        el.dispatchEvent(new Event('input'));
      }
    };
  }
  if (/^(hi|mid|low|filt|fxAmt)[AB]$/.test(id)) {
    return { type: 'range', act: v => KNOBS[id] && KNOBS[id].setNorm(v) };
  }
  // כל השאר — כפתורים: לחיצת MIDI מדמה לחיצת עכבר
  return { type: 'button', act: () => { const el = $('#' + id); if (el) el.click(); } };
}

function midiKeyOf(status, d1) {
  return (status & 0xF0) + '-' + (status & 0x0F) + '-' + d1;
}
function midiLoadMap() {
  try { MIDI.map = JSON.parse(localStorage.getItem('pulsedeck-midi-map') || '{}'); }
  catch (e) { MIDI.map = {}; }
}
function midiSaveMap() {
  try { localStorage.setItem('pulsedeck-midi-map', JSON.stringify(MIDI.map)); } catch (e) {}
}
function midiDeviceNames() {
  const names = [];
  if (MIDI.access) MIDI.access.inputs.forEach(i => names.push(i.name));
  return names;
}

function onMidiMessage(e) {
  const [st, d1, d2] = e.data;
  const type = st & 0xF0;
  if (type !== 0x90 && type !== 0x80 && type !== 0xB0) return;
  const key = midiKeyOf(st, d1);

  if (MIDI.learn) {
    // במצב לימוד: ההודעה הבאה מהקונטרולר נקשרת לפקד החמוש
    if (MIDI.armed && (type === 0xB0 || (type === 0x90 && d2 > 0))) {
      MIDI.map[key] = MIDI.armed;
      midiSaveMap();
      const el = $('#' + MIDI.armed);
      if (el) {
        el.classList.remove('midi-armed');
        el.classList.add('midi-mapped');
        setTimeout(() => el.classList.remove('midi-mapped'), 900);
      }
      MIDI.armed = null;
      updateMidiUI();
    }
    return;
  }

  const targetId = MIDI.map[key];
  if (!targetId) return;
  const t = midiTargetDef(targetId);
  if (!t) return;
  if (t.type === 'button') {
    if ((type === 0x90 && d2 > 0) || (type === 0xB0 && d2 >= 64)) t.act();
  } else if (t.type === 'range') {
    if (type === 0xB0) t.act(d2 / 127);
  } else if (t.type === 'jog') {
    if (type === 0xB0 && d2 !== 64) t.act(d2 < 64 ? d2 : d2 - 128);
  }
}

function midiHookInputs() {
  if (!MIDI.access) return;
  MIDI.access.inputs.forEach(inp => { inp.onmidimessage = onMidiMessage; });
  updateMidiUI();
}

function updateMidiUI(err) {
  const st = $('#midiStatus');
  if (!st) return;
  if (err) {
    st.textContent = '🔴 ' + err;
  } else {
    const devs = midiDeviceNames();
    st.textContent = devs.length
      ? '🟢 מחובר: ' + devs.join(' · ')
      : '⚪ לא זוהה קונטרולר — חבר אותו ל-USB והוא יזוהה אוטומטית';
  }
  $('#midiCount').textContent = Object.keys(MIDI.map).length;
  const btn = $('#midiLearnBtn');
  btn.classList.toggle('on', MIDI.learn);
  btn.textContent = MIDI.learn ? '⏹ סיים מצב לימוד' : '🎓 מצב לימוד (MIDI Learn)';
  $('#midiHint').textContent = !MIDI.learn ? ''
    : MIDI.armed
      ? '⚡ עכשיו הזז או לחץ על הפקד המתאים בקונטרולר...'
      : 'לחץ על פקד בתוכנה (כפתור / פיידר / כפתור סיבוב / פלטה), ואז הזז את הפקד בקונטרולר';
  document.body.classList.toggle('midi-learn-mode', MIDI.learn);
  const dot = $('#midiBtn');
  if (dot) dot.classList.toggle('midi-live', midiDeviceNames().length > 0);
}

// חימוש פקד בלחיצה — במצב לימוד בלבד (capture כדי לעצור את הפעולה הרגילה)
document.addEventListener('pointerdown', e => {
  if (!MIDI.learn) return;
  const el = e.target.closest('[data-midi]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  document.querySelectorAll('.midi-armed').forEach(x => x.classList.remove('midi-armed'));
  MIDI.armed = el.dataset.midi;
  el.classList.add('midi-armed');
  updateMidiUI();
}, true);
document.addEventListener('click', e => {
  if (MIDI.learn && e.target.closest('[data-midi]')) { e.preventDefault(); e.stopPropagation(); }
}, true);

function initMidi() {
  midiLoadMap();
  for (const id of MIDI_MAPPABLE) {
    const el = $('#' + id);
    if (el) el.setAttribute('data-midi', id);
  }
  if (!navigator.requestMIDIAccess) {
    updateMidiUI('הדפדפן הזה לא תומך ב-Web MIDI — פתח את התוכנה ב-Chrome או Edge');
    return;
  }
  navigator.requestMIDIAccess({ sysex: false }).then(acc => {
    MIDI.access = acc;
    midiHookInputs();
    acc.onstatechange = midiHookInputs; // חיבור/ניתוק תוך כדי עבודה
  }).catch(() => updateMidiUI('הגישה ל-MIDI נדחתה — אשר את ההרשאה בדפדפן'));
}

// חיווט חלון ה-MIDI
$('#midiBtn').addEventListener('click', () => { $('#midiModal').classList.remove('hidden'); updateMidiUI(); });
$('#midiClose').addEventListener('click', () => {
  $('#midiModal').classList.add('hidden');
});
$('#midiModal').addEventListener('click', e => { if (e.target === e.currentTarget) $('#midiModal').classList.add('hidden'); });
$('#midiLearnBtn').addEventListener('click', () => {
  MIDI.learn = !MIDI.learn;
  MIDI.armed = null;
  document.querySelectorAll('.midi-armed').forEach(x => x.classList.remove('midi-armed'));
  if (MIDI.learn) $('#midiModal').classList.add('hidden'); // שיהיה אפשר ללחוץ על הפקדים
  updateMidiUI();
});
$('#midiClearBtn').addEventListener('click', () => {
  MIDI.map = {};
  midiSaveMap();
  updateMidiUI();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('#midiModal').classList.add('hidden');
    if (MIDI.learn) { MIDI.learn = false; MIDI.armed = null; updateMidiUI(); }
  }
});

initMidi();
