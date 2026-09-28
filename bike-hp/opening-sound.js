/* =========================================================
   Opening Sound - opening-sound.js
   オープニング演出のエンジン音を担当するファイルです。

   音の流れ：
     IGNITION クリック … キーを回す「カチッ」＋ 燃料ポンプの「ウィーン」
     ライトへズーム   … セルモーターの「キュルキュル」
     ライト点灯       … エンジンがかかって「ブォン！」→ アイドリング
     本編へ           … 回転を上げながら遠ざかって消える

   しくみ：
   音声ファイルがなくても鳴るように、Web Audio API という機能で
   「波（音のもと）」を組み合わせてエンジン音を合成しています。
   本物の音声ファイルを用意した場合は、下の SOUND_FILE に
   ファイルの場所を書くと、合成音の代わりにそのファイルが流れます。

   ※ ブラウザは「クリックする前に音を鳴らすこと」を禁止しているため、
     IGNITION のクリックに合わせて音の準備（unlock）をしています。
   ※ iPhone はマナーモードだと音が鳴らない場合があります。
   ========================================================= */
(() => {
  'use strict';

  // ---------- 設定 ----------

  // 本物の音声ファイルを使う場合はここに書く（例：'sound/hayabusa-start.mp3'）
  // null のままなら合成したエンジン音が流れます
  const SOUND_FILE = null;

  const VOLUME = 0.7; // 全体の音量（0〜1）

  // SOUND ON / OFF の選択をブラウザに覚えておくときの名前
  const STORAGE_KEY = 'hayabusa-sound';

  // ---------- 状態 ----------
  let ctx = null;        // AudioContext（音を作る・鳴らすための土台）
  let master = null;     // 全体の音量つまみ
  let engine = null;     // エンジン音の部品一式
  let fileAudio = null;  // 音声ファイルを使う場合の <audio>
  let enabled = loadSetting();

  // 前回の SOUND ON / OFF を読み込む（読み込めない環境では ON）
  function loadSetting() {
    try { return localStorage.getItem(STORAGE_KEY) !== 'off'; } catch (e) { return true; }
  }
  function saveSetting() {
    try { localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off'); } catch (e) { /* 保存できなくても動作に影響なし */ }
  }

  // ---------- 音の準備（必ずクリックの中で呼ぶ） ----------
  const unlock = () => {
    if (SOUND_FILE) {
      // 音声ファイルの場合：クリックの中で一度再生して止めておくと、後で再生できるようになる
      // （準備の間は muted で消音にして、音が漏れないようにしています）
      const audio = new Audio(SOUND_FILE);
      audio.volume = enabled ? VOLUME : 0;
      audio.muted = true;
      audio.play()
        .then(() => { audio.pause(); audio.currentTime = 0; audio.muted = false; })
        .catch(() => { audio.muted = false; });
      fileAudio = audio;
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return; // 対応していないブラウザでは音なし

    ctx = new AudioContext();
    ctx.resume();

    // 全体の音量 → コンプレッサー（音割れ防止）→ スピーカー
    master = ctx.createGain();
    master.gain.value = enabled ? VOLUME : 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
  };

  // ---------- 合成に使う小さな部品 ----------

  // ホワイトノイズ（「サー」という音。排気音や機械音のざらつきに使う）
  const createNoise = () => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    return src;
  };

  // 音を少し歪ませて、エンジンらしい荒々しさを出す
  const createDrive = (amount) => {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount);
    }
    shaper.curve = curve;
    return shaper;
  };

  // 回転数（rpm）→ 爆発の回数（Hz）に変換
  // 4気筒エンジンは 1回転で2回爆発するので「rpm ÷ 60 × 2」
  const rpmToHz = (rpm) => rpm / 30;

  // ---------- ① キーを回す音 ＋ 燃料ポンプ ----------
  const keyOn = () => {
    if (!ctx) return;
    const t = ctx.currentTime;

    // 「カチッ」：ごく短いノイズ
    const click = createNoise();
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 2500;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.5, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    click.connect(clickFilter).connect(clickGain).connect(master);
    click.start(t);
    click.stop(t + 0.05);

    // 「ウィーン」：燃料ポンプが動く小さなうなり（約1.2秒）
    const pump = ctx.createOscillator();
    pump.type = 'sawtooth';
    pump.frequency.setValueAtTime(90, t + 0.1);
    pump.frequency.linearRampToValueAtTime(110, t + 1.3);
    const pumpFilter = ctx.createBiquadFilter();
    pumpFilter.type = 'bandpass';
    pumpFilter.frequency.value = 420;
    pumpFilter.Q.value = 4;
    const pumpGain = ctx.createGain();
    pumpGain.gain.setValueAtTime(0, t + 0.1);
    pumpGain.gain.linearRampToValueAtTime(0.12, t + 0.25);
    pumpGain.gain.setValueAtTime(0.12, t + 1.1);
    pumpGain.gain.linearRampToValueAtTime(0, t + 1.4);
    pump.connect(pumpFilter).connect(pumpGain).connect(master);
    pump.start(t + 0.1);
    pump.stop(t + 1.5);
  };

  // ---------- ② セルモーター「キュルキュル」 ----------
  // start 秒後から duration 秒間鳴らす
  const crank = (start, duration) => {
    const t = start;
    const end = t + duration;

    // 低いうなり + ノイズ を「ルルルル」と区切って鳴らす
    const body = ctx.createOscillator();
    body.type = 'sawtooth';
    body.frequency.setValueAtTime(55, t);
    body.frequency.linearRampToValueAtTime(70, end);
    const noise = createNoise();
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;

    // 区切り（ピストンが圧縮するたびに音が重くなる感じ）：1秒に 8〜11 回
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const chopLfo = ctx.createOscillator();
    chopLfo.type = 'square';
    chopLfo.frequency.setValueAtTime(8, t);
    chopLfo.frequency.linearRampToValueAtTime(11, end);
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.45;
    chopLfo.connect(chopDepth).connect(chop.gain);

    // セルモーターの高い「キーン」という音
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    whine.frequency.setValueAtTime(1100, t);
    whine.frequency.linearRampToValueAtTime(1350, end);
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.02;

    // 全体の音量（最初と最後をなめらかに）
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.55, t + 0.06);
    out.gain.setValueAtTime(0.55, end - 0.05);
    out.gain.linearRampToValueAtTime(0, end + 0.08);

    body.connect(filter);
    noise.connect(noiseGain).connect(filter);
    filter.connect(chop).connect(out);
    whine.connect(whineGain).connect(out);
    out.connect(master);

    [body, noise, chopLfo, whine].forEach((node) => { node.start(t); node.stop(end + 0.1); });
  };

  // ---------- ③ エンジン本体（かかる → 吹け上がる → アイドリング） ----------
  // 1つの「回転数」の値を、複数の波の高さにまとめて伝えるしくみを作る
  const buildEngine = (start) => {
    // 回転数（Hz）の元になる値
    const rpm = ctx.createConstantSource();
    rpm.offset.value = 0;

    // アイドリング中の回転のゆらぎ（少し不安定な感じ）
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 4.5;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0;

    const bus = ctx.createGain(); // 回転数 + ゆらぎ を合わせたもの
    rpm.connect(bus);
    wobble.connect(wobbleDepth).connect(bus);

    // 音のもと（波）を4つ重ねる。倍率を変えて、厚みのある音にする
    const mix = ctx.createGain();
    const voices = [
      { type: 'sawtooth', ratio: 1, gain: 0.5 },    // 基本の音
      { type: 'square', ratio: 0.5, gain: 0.35 },   // 低い「ドドド」感
      { type: 'sawtooth', ratio: 2, gain: 0.18 },   // 高めの音
      { type: 'triangle', ratio: 0.25, gain: 0.4 }, // 重低音
    ];
    const oscillators = voices.map((v) => {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = 0;
      const ratio = ctx.createGain();
      ratio.gain.value = v.ratio;
      bus.connect(ratio).connect(osc.frequency); // 回転数 × 倍率 = この波の高さ
      const g = ctx.createGain();
      g.gain.value = v.gain;
      osc.connect(g).connect(mix);
      return osc;
    });

    // 爆発ごとの「ボッ、ボッ」という脈打ち（音量を回転数に合わせて揺らす）
    const pulse = ctx.createGain();
    pulse.gain.value = 0.7;
    const pulseOsc = ctx.createOscillator();
    pulseOsc.frequency.value = 0;
    bus.connect(pulseOsc.frequency);
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.3;
    pulseOsc.connect(pulseDepth).connect(pulse.gain);

    // 排気の「シャー」という音
    const exhaust = createNoise();
    const exhaustFilter = ctx.createBiquadFilter();
    exhaustFilter.type = 'bandpass';
    exhaustFilter.frequency.value = 900;
    exhaustFilter.Q.value = 0.8;
    const exhaustGain = ctx.createGain();
    exhaustGain.gain.value = 0;

    // こもり具合（回転が上がるほど明るい音になる）
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 1.2;
    tone.frequency.value = 400;

    // エンジン全体の音量
    const volume = ctx.createGain();
    volume.gain.value = 0;

    // つなぐ：波 → 脈打ち → 歪み → こもり → 音量 → 全体
    mix.connect(pulse).connect(createDrive(2.4)).connect(tone);
    exhaust.connect(exhaustFilter).connect(exhaustGain).connect(tone);
    tone.connect(volume).connect(master);

    const sources = [rpm, wobble, pulseOsc, exhaust, ...oscillators];
    sources.forEach((node) => node.start(start));

    return { rpm: rpm.offset, wobble: wobbleDepth.gain, tone: tone.frequency, exhaust: exhaustGain.gain, volume: volume.gain, sources };
  };

  // エンジンをかける（delay 秒間セルを回してから、エンジンがかかる）
  const start = (delay = 1) => {
    if (SOUND_FILE) {
      if (fileAudio) { fileAudio.currentTime = 0; fileAudio.play().catch(() => {}); }
      return;
    }
    if (!ctx || engine) return;

    const now = ctx.currentTime;
    const c = now + delay; // エンジンがかかる瞬間（ライトが点く瞬間と同じ）

    crank(now, delay);
    engine = buildEngine(c);
    const e = engine;

    // 回転数の変化：かかる → 「ブォン！」と 5200rpm まで吹け上がる → 1150rpm のアイドリングへ
    e.rpm.setValueAtTime(rpmToHz(600), c);
    e.rpm.linearRampToValueAtTime(rpmToHz(2500), c + 0.12);
    e.rpm.exponentialRampToValueAtTime(rpmToHz(5200), c + 0.45);
    e.rpm.exponentialRampToValueAtTime(rpmToHz(1600), c + 1.1);
    e.rpm.setTargetAtTime(rpmToHz(1150), c + 1.1, 0.35);

    // 音量
    e.volume.setValueAtTime(0, c);
    e.volume.linearRampToValueAtTime(0.75, c + 0.05);
    e.volume.linearRampToValueAtTime(0.95, c + 0.45);
    e.volume.setTargetAtTime(0.5, c + 0.6, 0.4);

    // こもり具合（吹け上がると明るく、アイドリングで落ち着く）
    e.tone.setValueAtTime(500, c);
    e.tone.linearRampToValueAtTime(1100, c + 0.12);
    e.tone.exponentialRampToValueAtTime(2600, c + 0.45);
    e.tone.exponentialRampToValueAtTime(1000, c + 1.1);
    e.tone.setTargetAtTime(700, c + 1.1, 0.35);

    // 排気音
    e.exhaust.setValueAtTime(0, c);
    e.exhaust.linearRampToValueAtTime(0.12, c + 0.45);
    e.exhaust.setTargetAtTime(0.04, c + 0.6, 0.4);

    // アイドリングのゆらぎを少しずつ入れる
    e.wobble.setValueAtTime(0, c);
    e.wobble.linearRampToValueAtTime(rpmToHz(40), c + 1.5);
  };

  // ---------- ④ 本編へ：回転を上げながら遠ざかる ----------
  const revOut = (duration = 1) => {
    if (!ctx || !engine) return;
    const t = ctx.currentTime;
    const e = engine;
    const peak = t + duration;

    // 回転数を 7500rpm まで上げる
    // （cancelScheduledValues で予定していた変化を取り消し、今の値から新しく変化させる）
    e.rpm.cancelScheduledValues(t);
    e.rpm.setValueAtTime(Math.max(e.rpm.value, rpmToHz(1000)), t);
    e.rpm.exponentialRampToValueAtTime(rpmToHz(7500), peak);
    e.wobble.cancelScheduledValues(t);
    e.wobble.setValueAtTime(0, t);

    e.tone.cancelScheduledValues(t);
    e.tone.setValueAtTime(e.tone.value, t);
    e.tone.exponentialRampToValueAtTime(3200, peak);

    e.volume.cancelScheduledValues(t);
    e.volume.setValueAtTime(e.volume.value, t);
    e.volume.linearRampToValueAtTime(0.9, peak);

    e.exhaust.cancelScheduledValues(t);
    e.exhaust.setValueAtTime(e.exhaust.value, t);
    e.exhaust.linearRampToValueAtTime(0.16, peak);
  };

  // ---------- ⑤ 音を消す ----------
  // fade 秒かけて小さくしてから止める
  const fadeOut = (fade = 1.4) => {
    if (fileAudio) {
      // 音声ファイル：音量を少しずつ下げる（※ iPhone は音量を変えられないため、最後に止めるだけ）
      const audio = fileAudio;
      const step = audio.volume / (fade * 20);
      const timer = setInterval(() => {
        audio.volume = Math.max(0, audio.volume - step);
        if (audio.volume <= 0) { clearInterval(timer); audio.pause(); }
      }, 50);
      setTimeout(() => { clearInterval(timer); audio.pause(); }, fade * 1000 + 100);
      return;
    }
    if (!ctx) return;

    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + fade);

    if (engine) {
      // 遠ざかる感じを出すため、こもらせながら小さくする
      engine.tone.cancelScheduledValues(t);
      engine.tone.setValueAtTime(engine.tone.value, t);
      engine.tone.exponentialRampToValueAtTime(300, t + fade);
      engine.sources.forEach((node) => { try { node.stop(t + fade + 0.1); } catch (err) { /* 停止済み */ } });
    }

    // 音を作る土台ごと片付ける
    const done = ctx;
    setTimeout(() => done.close(), (fade + 0.3) * 1000);
    ctx = null;
    engine = null;
  };

  // ---------- SOUND ON / OFF ----------
  const setEnabled = (value) => {
    enabled = value;
    saveSetting();
    if (fileAudio) fileAudio.volume = enabled ? VOLUME : 0;
    if (ctx && master) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(enabled ? VOLUME : 0, t + 0.3);
    }
  };

  // 音でエラーが起きても、オープニング演出は止まらずに最後まで進むようにする
  const safe = (fn) => (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.warn('OpeningSound:', err); // 開発者ツールのコンソールに表示
      return undefined;
    }
  };

  // opening.js から使えるように公開する
  window.OpeningSound = {
    unlock: safe(unlock),
    keyOn: safe(keyOn),
    start: safe(start),
    revOut: safe(revOut),
    fadeOut: safe(fadeOut),
    setEnabled: safe(setEnabled),
    isEnabled: () => enabled,
  };
})();
