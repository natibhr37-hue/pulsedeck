'use strict';
/* PulseDeck — סרטון הדרכה אינטראקטיבי
   זרקור על הפקדים האמיתיים + קריינות קולית (speechSynthesis) + כתוביות,
   ב-5 שפות: עברית, אנגלית, ספרדית, צרפתית, רוסית. */

const TUT_STEPS = [
  { sel: '.logo', key: 'intro' },
  { sel: '#addTracks', key: 'add' },
  { sel: '#library', key: 'library' },
  { sel: '#recPanel', key: 'recs' },
  { sel: '#deckA .display', key: 'display' },
  { sel: '#zoomA', key: 'wave' },
  { sel: '#platterA', key: 'platter' },
  { sel: '.mixer', key: 'mixer' },
  { sel: '#syncA', key: 'sync' },
  { sel: '#automix', key: 'automix' },
  { sel: '.deck-a .fx-row', key: 'fx' },
  { sel: '#midiBtn', key: 'midi' },
  { sel: '#tipsBtn', key: 'tips' }
];

const TUT_LANGS = {
  he: {
    name: 'עברית', dir: 'rtl', tts: 'he-IL',
    steps: {
      intro: { t: 'ברוכים הבאים ל-PulseDeck', d: 'תוכנת DJ עם שני דקים, מיקסר, אפקטים ובינה מלאכותית שבוחרת איתכם את השיר הבא. בואו נעבור על הכל צעד אחר צעד.' },
      add: { t: 'הוספת שירים', d: 'לחצו כאן או גררו קבצים לחלון — אפשר גם להעלות תיקיות שלמות או כונן נשלף. כל שיר מנותח אוטומטית: קצב, סולם ואנרגיה, והתוכנה זוכרת מאיזו תיקייה הוא הגיע.' },
      library: { t: 'הספרייה', d: 'כאן כל השירים עם הקצב והסולם שלהם. עמודת ההתאמה מראה כמה כל שיר מתאים למה שמתנגן עכשיו, וכפתור "רק מתאימים" מסנן את כל השאר.' },
      recs: { t: 'הדי-ג\'יי החכם', d: 'הפאנל הזה ממליץ על שלושת השירים הטובים ביותר להמשך, לפי קצב וסולם. לחיצה אחת טוענת אותם ישר לדק הפנוי.' },
      display: { t: 'התצוגה הדיגיטלית', d: 'שם השיר, הקצב הנוכחי, הסולם, כמה זמן עבר וכמה נשאר — הכל גדול וקריא, גם בחושך של מועדון.' },
      wave: { t: 'גל הקול', d: 'הצבע הכהה הוא הבס והבהיר הם הגבוהים. הקווים האנכיים הם הביטים, עם קו בולט כל ארבעה. הקו הלבן במרכז הוא נקודת ההשמעה.' },
      platter: { t: 'הפלטה', d: 'מסתובבת עם השיר כמו תקליט אמיתי. תפסו אותה כדי לעצור, גררו כדי לעשות סקראץ׳, ושחררו כדי להמשיך לנגן.' },
      mixer: { t: 'המיקסר', d: 'לכל דק יש ווליום, אקולייזר תלת-ערוצי ופילטר, ולמטה הקרוספיידר שעובר בין הדקים. טיפ: במעבר, הורידו את הבס של השיר היוצא.' },
      sync: { t: 'סנכרון', d: 'לחיצה על סינק משווה את הקצב לדק השני ומיישרת את הביטים — והמיקס נשמע חלק מיד.' },
      automix: { t: 'מעבר אוטומטי', d: 'הכפתור הזה עושה הכל לבד: מסנכרן, מתחיל את השיר הבא בדיוק על הביט, ומבצע מעבר חלק של שמונה שניות.' },
      fx: { t: 'אפקטים', d: 'אקו שמסונכרן לקצב, ריוורב, פלנג׳ר ודיסטורשן. כפתור הסיבוב קובע את העוצמה, ואפשר לשלב כמה אפקטים יחד.' },
      midi: { t: 'חיבור קונטרולר', d: 'מחברים קונטרולר די-ג׳יי ל-USB — פיוניר, טרקטור ואחרים — פותחים את חלון המידי ומשתמשים במצב לימוד: לוחצים על פקד במסך ומזיזים את הפקד בקונטרולר.' },
      tips: { t: 'טיפים', d: 'כאן תמצאו ניתוח לכל שיר: לאיזה אירוע הוא מתאים ולאיזה שלב בערב, וגם טיפים כלליים למיקס. זהו — עכשיו תורכם. מיקס מהנה!' }
    }
  },
  en: {
    name: 'English', dir: 'ltr', tts: 'en-US',
    steps: {
      intro: { t: 'Welcome to PulseDeck', d: 'A DJ app with two decks, a mixer, effects, and an AI that helps pick your next track. Let\'s walk through everything step by step.' },
      add: { t: 'Adding tracks', d: 'Click here or drag files into the window — you can also upload whole folders or a USB drive. Every track is analyzed automatically: tempo, key and energy.' },
      library: { t: 'The library', d: 'All your tracks with their BPM and key. The match column shows how well each track fits what\'s playing, and the "matches only" button filters out the rest.' },
      recs: { t: 'The smart DJ', d: 'This panel recommends the three best tracks to play next, based on tempo and key. One click loads them straight onto the free deck.' },
      display: { t: 'The digital display', d: 'Track name, current BPM, key, time elapsed and time remaining — everything big and readable, even in club darkness.' },
      wave: { t: 'The waveform', d: 'Dark colors are the bass, bright ones the highs. Vertical lines are the beats, with a bold line every four. The white line in the center is the playhead.' },
      platter: { t: 'The platter', d: 'It spins with the track like real vinyl. Grab it to stop, drag to scratch, and release to keep playing.' },
      mixer: { t: 'The mixer', d: 'Each deck has volume, a three-band EQ and a filter, with the crossfader below. Tip: during a transition, cut the bass of the outgoing track.' },
      sync: { t: 'Sync', d: 'Pressing sync matches the tempo to the other deck and aligns the beats — the mix instantly sounds tight.' },
      automix: { t: 'Auto mix', d: 'This button does it all: syncs, starts the next track right on the beat, and performs a smooth eight-second transition.' },
      fx: { t: 'Effects', d: 'Beat-synced echo, reverb, flanger and distortion. The knob sets the intensity, and you can stack several effects together.' },
      midi: { t: 'Connecting a controller', d: 'Plug a DJ controller into USB — Pioneer, Traktor and others — open the MIDI window and use learn mode: click a control on screen, then move it on your controller.' },
      tips: { t: 'Tips', d: 'Here you\'ll find an analysis of every track: which event it fits and which part of the night, plus general mixing tips. That\'s it — now it\'s your turn. Happy mixing!' }
    }
  },
  es: {
    name: 'Español', dir: 'ltr', tts: 'es-ES',
    steps: {
      intro: { t: 'Bienvenido a PulseDeck', d: 'Una app de DJ con dos platos, mezclador, efectos y una IA que te ayuda a elegir la siguiente canción. Repasemos todo paso a paso.' },
      add: { t: 'Añadir canciones', d: 'Haz clic aquí o arrastra archivos a la ventana — también puedes subir carpetas enteras o una unidad USB. Cada canción se analiza automáticamente: tempo, tonalidad y energía.' },
      library: { t: 'La biblioteca', d: 'Todas tus canciones con su BPM y tonalidad. La columna de compatibilidad muestra qué tan bien encaja cada una con lo que suena, y el botón de filtro oculta el resto.' },
      recs: { t: 'El DJ inteligente', d: 'Este panel recomienda las tres mejores canciones para continuar, según tempo y tonalidad. Un clic las carga directamente en el plato libre.' },
      display: { t: 'La pantalla digital', d: 'Nombre de la canción, BPM actual, tonalidad, tiempo transcurrido y restante — todo grande y legible, incluso en la oscuridad del club.' },
      wave: { t: 'La forma de onda', d: 'Los colores oscuros son los graves y los claros los agudos. Las líneas verticales son los beats, con una línea marcada cada cuatro. La línea blanca central es el punto de reproducción.' },
      platter: { t: 'El plato', d: 'Gira con la canción como un vinilo real. Agárralo para detenerlo, arrastra para hacer scratch y suéltalo para seguir.' },
      mixer: { t: 'El mezclador', d: 'Cada plato tiene volumen, ecualizador de tres bandas y filtro, con el crossfader debajo. Consejo: en la transición, corta los graves de la canción saliente.' },
      sync: { t: 'Sincronización', d: 'Al pulsar sync, el tempo se iguala al otro plato y los beats se alinean — la mezcla suena perfecta al instante.' },
      automix: { t: 'Mezcla automática', d: 'Este botón lo hace todo: sincroniza, arranca la siguiente canción justo en el beat y realiza una transición suave de ocho segundos.' },
      fx: { t: 'Efectos', d: 'Eco sincronizado al ritmo, reverb, flanger y distorsión. La perilla ajusta la intensidad y puedes combinar varios efectos.' },
      midi: { t: 'Conectar un controlador', d: 'Conecta un controlador de DJ por USB — Pioneer, Traktor y otros — abre la ventana MIDI y usa el modo aprendizaje: haz clic en un control en pantalla y muévelo en tu controlador.' },
      tips: { t: 'Consejos', d: 'Aquí encontrarás un análisis de cada canción: para qué evento sirve y en qué momento de la noche, además de consejos generales de mezcla. Eso es todo — ¡a mezclar!' }
    }
  },
  fr: {
    name: 'Français', dir: 'ltr', tts: 'fr-FR',
    steps: {
      intro: { t: 'Bienvenue sur PulseDeck', d: 'Une application DJ avec deux platines, une table de mixage, des effets et une IA qui vous aide à choisir le prochain morceau. Découvrons tout, étape par étape.' },
      add: { t: 'Ajouter des morceaux', d: 'Cliquez ici ou glissez des fichiers dans la fenêtre — vous pouvez aussi importer des dossiers entiers ou une clé USB. Chaque morceau est analysé automatiquement : tempo, tonalité et énergie.' },
      library: { t: 'La bibliothèque', d: 'Tous vos morceaux avec leur BPM et leur tonalité. La colonne de compatibilité montre à quel point chaque morceau s\'accorde avec ce qui joue, et le bouton de filtre masque le reste.' },
      recs: { t: 'Le DJ intelligent', d: 'Ce panneau recommande les trois meilleurs morceaux à enchaîner, selon le tempo et la tonalité. Un clic les charge directement sur la platine libre.' },
      display: { t: 'L\'écran numérique', d: 'Titre, BPM actuel, tonalité, temps écoulé et restant — tout est grand et lisible, même dans l\'obscurité d\'un club.' },
      wave: { t: 'La forme d\'onde', d: 'Les couleurs sombres sont les basses, les claires les aigus. Les lignes verticales sont les temps, avec une ligne marquée tous les quatre. La ligne blanche au centre est la tête de lecture.' },
      platter: { t: 'La platine', d: 'Elle tourne avec le morceau comme un vrai vinyle. Attrapez-la pour l\'arrêter, glissez pour scratcher, relâchez pour reprendre.' },
      mixer: { t: 'La table de mixage', d: 'Chaque platine a un volume, un égaliseur trois bandes et un filtre, avec le crossfader en dessous. Astuce : pendant la transition, coupez les basses du morceau sortant.' },
      sync: { t: 'La synchronisation', d: 'Appuyer sur sync aligne le tempo sur l\'autre platine et cale les temps — le mix sonne juste immédiatement.' },
      automix: { t: 'Le mix automatique', d: 'Ce bouton fait tout : il synchronise, lance le morceau suivant pile sur le temps et réalise une transition fluide de huit secondes.' },
      fx: { t: 'Les effets', d: 'Écho calé sur le tempo, réverbération, flanger et distorsion. Le bouton règle l\'intensité et vous pouvez cumuler plusieurs effets.' },
      midi: { t: 'Brancher un contrôleur', d: 'Branchez un contrôleur DJ en USB — Pioneer, Traktor et autres — ouvrez la fenêtre MIDI et utilisez le mode apprentissage : cliquez sur une commande à l\'écran puis bougez-la sur votre contrôleur.' },
      tips: { t: 'Les conseils', d: 'Vous trouverez ici une analyse de chaque morceau : pour quel événement et quel moment de la soirée, plus des conseils généraux de mix. Voilà — à vous de jouer. Bon mix !' }
    }
  },
  ru: {
    name: 'Русский', dir: 'ltr', tts: 'ru-RU',
    steps: {
      intro: { t: 'Добро пожаловать в PulseDeck', d: 'Диджейская программа с двумя деками, микшером, эффектами и искусственным интеллектом, который помогает выбрать следующий трек. Пройдёмся по всему шаг за шагом.' },
      add: { t: 'Добавление треков', d: 'Нажмите сюда или перетащите файлы в окно — можно загружать и целые папки или USB-накопитель. Каждый трек анализируется автоматически: темп, тональность и энергия.' },
      library: { t: 'Библиотека', d: 'Все ваши треки с BPM и тональностью. Колонка совместимости показывает, насколько трек подходит к тому, что играет, а кнопка фильтра скрывает остальные.' },
      recs: { t: 'Умный диджей', d: 'Эта панель рекомендует три лучших трека для продолжения — по темпу и тональности. Один клик загружает их прямо на свободную деку.' },
      display: { t: 'Цифровой дисплей', d: 'Название трека, текущий BPM, тональность, прошедшее и оставшееся время — всё крупно и читаемо даже в темноте клуба.' },
      wave: { t: 'Волновая форма', d: 'Тёмные цвета — бас, светлые — высокие частоты. Вертикальные линии — биты, каждая четвёртая выделена. Белая линия в центре — точка воспроизведения.' },
      platter: { t: 'Вертушка', d: 'Крутится вместе с треком, как настоящий винил. Схватите её, чтобы остановить, тяните для скретча и отпустите, чтобы продолжить.' },
      mixer: { t: 'Микшер', d: 'У каждой деки есть громкость, трёхполосный эквалайзер и фильтр, внизу — кроссфейдер. Совет: при переходе убирайте бас уходящего трека.' },
      sync: { t: 'Синхронизация', d: 'Нажатие sync выравнивает темп со второй декой и совмещает биты — микс сразу звучит ровно.' },
      automix: { t: 'Автомикс', d: 'Эта кнопка делает всё сама: синхронизирует, запускает следующий трек точно в бит и выполняет плавный восьмисекундный переход.' },
      fx: { t: 'Эффекты', d: 'Эхо, синхронизированное с темпом, реверберация, флэнжер и дисторшн. Ручка задаёт интенсивность, эффекты можно совмещать.' },
      midi: { t: 'Подключение контроллера', d: 'Подключите DJ-контроллер по USB — Pioneer, Traktor и другие — откройте окно MIDI и используйте режим обучения: нажмите элемент на экране и подвиньте его на контроллере.' },
      tips: { t: 'Советы', d: 'Здесь вы найдёте разбор каждого трека: для какого мероприятия и какой части вечера он подходит, плюс общие советы по сведению. Вот и всё — теперь ваша очередь. Удачных миксов!' }
    }
  }
};

const TUT = { lang: 'he', i: 0, playing: true, muted: false, timer: null, open: false };

function tutOpenChooser() {
  $('#tutLangModal').classList.remove('hidden');
}

function tutStart(lang) {
  TUT.lang = lang; TUT.i = 0; TUT.playing = true; TUT.open = true;
  $('#tutLangModal').classList.add('hidden');
  $('#tutUi').classList.remove('hidden');
  tutShow();
  tutTrack(); // הזרקור עוקב אחרי הפקד בכל פריים — נשאר מוצמד גם בזמן גלילה
}

// עדכון מיקום הזרקור בכל פריים לפי המיקום האמיתי של הפקד על המסך
function tutTrack() {
  if (!TUT.open) return;
  const el = TUT.el;
  if (el) {
    const r = el.getBoundingClientRect(), pad = 10;
    const sp = $('#tutSpot');
    sp.style.left = (r.left - pad) + 'px';
    sp.style.top = (r.top - pad) + 'px';
    sp.style.width = (r.width + pad * 2) + 'px';
    sp.style.height = (r.height + pad * 2) + 'px';
  }
  requestAnimationFrame(tutTrack);
}

function tutShow() {
  const step = TUT_STEPS[TUT.i];
  const L = TUT_LANGS[TUT.lang];
  const tx = L.steps[step.key];
  const el = document.querySelector(step.sel);
  TUT.el = el;
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  clearTimeout(TUT.timer);
  TUT.timer = setTimeout(() => {
    if (!TUT.open) return;
    tutSpeak(tx.t + '. ' + tx.d);
  }, 420);
  const panel = $('#tutPanel');
  panel.dir = L.dir;
  $('#tutTitle').textContent = tx.t;
  $('#tutText').textContent = tx.d;
  $('#tutStepNum').textContent = (TUT.i + 1) + ' / ' + TUT_STEPS.length;
  $('#tutBar').style.width = ((TUT.i + 1) / TUT_STEPS.length * 100) + '%';
  $('#tutPlay').textContent = TUT.playing ? '⏸' : '▶';
  $('#tutMute').textContent = TUT.muted ? '🔇' : '🔊';
}

// טעינת רשימת הקולות (אסינכרוני בחלק מהדפדפנים) — שומרים במטמון
let _voices = [];
function loadVoices() { if (window.speechSynthesis) _voices = speechSynthesis.getVoices() || []; }
if (window.speechSynthesis) {
  loadVoices();
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

// בחירת הקול הכי איכותי ואנושי שקיים במחשב עבור השפה
function bestVoiceFor(langTag) {
  if (!_voices.length) loadVoices();
  const base = langTag.split('-')[0].toLowerCase();
  const matches = _voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(base));
  if (!matches.length) return null;
  const score = v => {
    const n = (v.name || '').toLowerCase();
    let s = 0;
    if (/natural|neural/.test(n)) s += 100;   // קולות נוירליים — הכי אנושיים
    if (v.localService === false) s += 40;     // קולות רשת/מקוונים — בד"כ איכותיים
    if (/google/.test(n)) s += 30;
    if (/online/.test(n)) s += 20;
    if (/microsoft/.test(n)) s += 8;
    if (v.lang.toLowerCase() === langTag.toLowerCase()) s += 5;
    if (v.default) s += 2;
    return s;
  };
  return matches.slice().sort((a, b) => score(b) - score(a))[0];
}

function stopTutAudio() {
  clearTimeout(TUT._audioSafety);
  if (TUT._audio) {
    try { TUT._audio.pause(); } catch (e) {}
    TUT._audio.onended = TUT._audio.onerror = TUT._audio.onloadedmetadata = null;
    TUT._audio = null;
  }
}

// גיבוי: קול המערכת (speechSynthesis) — משמש כשאין קובץ מוקלט לשפה/שלב
function speakTTS(text, scheduleNext, fallbackMs) {
  if (TUT.muted || !window.speechSynthesis) { scheduleNext(fallbackMs); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = TUT_LANGS[TUT.lang].tts;
  const v = bestVoiceFor(u.lang);
  if (v) u.voice = v;
  u.rate = 0.94;
  u.pitch = 1.02;
  u.onend = () => scheduleNext(900);
  u.onerror = () => scheduleNext(fallbackMs);
  speechSynthesis.speak(u);
}

function tutSpeak(text) {
  if (window.speechSynthesis) speechSynthesis.cancel();
  stopTutAudio();
  const fallbackMs = Math.max(5000, text.length * 75);
  const scheduleNext = ms => {
    clearTimeout(TUT.timer);
    if (TUT.playing && TUT.open) TUT.timer = setTimeout(tutNext, ms);
  };
  if (TUT.muted) { scheduleNext(fallbackMs); return; }

  // קריינות מוקלטת מראש בקול AI אנושי (audio/<שפה>-<שלב>.mp3).
  // אם הקובץ לא קיים לשפה/שלב — נופלים חזרה לקול המערכת.
  const key = TUT_STEPS[TUT.i] && TUT_STEPS[TUT.i].key;
  let handled = false;
  const useTTS = () => { if (handled) return; handled = true; speakTTS(text, scheduleNext, fallbackMs); };
  const audio = new Audio(`audio/${TUT.lang}-${key}.mp3`);
  TUT._audio = audio;
  audio.onended = () => { if (!handled) { handled = true; scheduleNext(900); } };
  audio.onerror = useTTS;
  // רשת ביטחון: אם הקליפ לא הסתיים תוך אורכו + שנייתיים, ממשיכים בכל זאת
  audio.onloadedmetadata = () => {
    clearTimeout(TUT._audioSafety);
    TUT._audioSafety = setTimeout(() => { if (!handled) { handled = true; scheduleNext(0); } },
      (audio.duration || 20) * 1000 + 2000);
  };
  audio.play().catch(useTTS);
}

function tutNext() {
  if (TUT.i >= TUT_STEPS.length - 1) { tutClose(); return; }
  TUT.i++;
  tutShow();
}
function tutPrev() {
  if (TUT.i > 0) { TUT.i--; tutShow(); }
}
function tutTogglePlay() {
  TUT.playing = !TUT.playing;
  $('#tutPlay').textContent = TUT.playing ? '⏸' : '▶';
  if (TUT.playing) tutShow();
  else { clearTimeout(TUT.timer); stopTutAudio(); if (window.speechSynthesis) speechSynthesis.cancel(); }
}
function tutToggleMute() {
  TUT.muted = !TUT.muted;
  $('#tutMute').textContent = TUT.muted ? '🔇' : '🔊';
  stopTutAudio();
  if (window.speechSynthesis) speechSynthesis.cancel();
  if (TUT.playing) tutShow();
}
function tutClose() {
  TUT.open = false;
  clearTimeout(TUT.timer);
  stopTutAudio();
  if (window.speechSynthesis) speechSynthesis.cancel();
  $('#tutUi').classList.add('hidden');
}

$('#tutBtn').addEventListener('click', tutOpenChooser);
$('#tutLangClose').addEventListener('click', () => $('#tutLangModal').classList.add('hidden'));
$('#tutLangModal').addEventListener('click', e => { if (e.target === e.currentTarget) $('#tutLangModal').classList.add('hidden'); });
document.querySelectorAll('.lang-btn').forEach(b =>
  b.addEventListener('click', () => tutStart(b.dataset.lang)));
$('#tutClose').addEventListener('click', tutClose);
$('#tutPrev').addEventListener('click', tutPrev);
$('#tutNext').addEventListener('click', () => { clearTimeout(TUT.timer); stopTutAudio(); if (window.speechSynthesis) speechSynthesis.cancel(); tutNext(); });
$('#tutPlay').addEventListener('click', tutTogglePlay);
$('#tutMute').addEventListener('click', tutToggleMute);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { tutClose(); $('#tutLangModal').classList.add('hidden'); }
});
