/* =========================================================
   Opening - opening.js
   オープニング演出の「順番」と「タイミング」を管理するファイルです。

   流れ：暗闇 → IGNITION → 消灯した車体 → ヘッドライト点灯 → 本編

   しくみ：
   JavaScript は「いつ・どのクラスを付けるか」だけを担当し、
   実際の見た目の変化（フェード・ズームなど）は opening.css に書いています。
   例）.opening に "is-light-on" クラスを付ける → CSS 側でライトが点灯する

   ※ <head> 内で読み込みます（本編が一瞬見えてしまうのを防ぐため）
   ========================================================= */

// (() => { ... })(); は「即時関数」。
// 中で作った変数が、他のファイルの変数とぶつからないように囲っています。
(() => {
  'use strict'; // 書き間違いなどをエラーとして教えてくれるモード

  // ---------- 設定 ----------

  // 演出で使う画像
  const IMAGES = {
    front: 'img/opening/front.jpg',         // ライトが消えた車体
    headlight: 'img/opening/headlight.jpg', // ライトが点いたアップ
  };

  // 各シーンの長さ（ミリ秒：1000 = 1秒）
  // ここの数字を変えると、演出のテンポを調整できます
  const TIMING = {
    minBlack: 800,    // IGNITION が浮かぶ前の暗闇
    ignite: 900,      // IGNITION の文字が消えるまで
    lightOff: 3200,   // ライトが消えた車体が浮かび上がる（front.jpg）
    lightOn: 3800,    // ライトが点灯した画像へ切り替え（headlight.jpg）
    exit: 1050,       // ライトに吸い込まれて本編へ
  };

  // ---------- 準備 ----------

  const root = document.documentElement; // <html> 要素

  // 端末の設定で「視差効果を減らす（動きを減らす）」がオンになっているか
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // <html> に is-opening クラスを付けて、本編を隠す（CSS 側で非表示にしています）
  root.classList.add('is-opening');

  // 再読み込みしたときに、ブラウザが前回のスクロール位置へ戻らないようにする
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  let opening = null;    // オープニングの要素を入れておく変数
  let finished = false;  // 演出が終わったか（SKIP した場合も true）

  // エンジン音（opening-sound.js）。読み込まれていない場合は「何もしない」ダミーを使う
  const noop = () => {};
  const sound = window.OpeningSound || {
    unlock: noop, keyOn: noop, start: noop, revOut: noop, fadeOut: noop,
    setEnabled: noop, isEnabled: () => false,
  };
  const hasSound = Boolean(window.OpeningSound);

  // 指定した時間だけ待つ関数（await sleep(1000) で1秒待つ）
  const sleep = (ms) => new Promise((resolve) => {
    // 動きを減らす設定の人には、待ち時間を短くする
    setTimeout(resolve, reduceMotion ? Math.min(ms, 600) : ms);
  });

  // 画像を先に読み込んでおく関数（演出の途中で画像が欠けないように）
  const preload = (src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = resolve;  // 読み込めたら次へ
    img.onerror = resolve; // 読み込めなくても止まらないように次へ
    img.src = src;
  });

  // ---------- オープニングの HTML ----------
  // 演出用の HTML は JavaScript で作って追加します。
  // こうすると index.html を汚さず、JavaScript が動かない環境では
  // 演出なしで本編がそのまま表示されます。
  //
  // style="--lx:..; --ly:..; --size:.." は CSS に渡す値です。
  //   --lx / --ly：光の位置（画像の左上からの割合）
  //   --size    ：光の大きさ（画像の幅に対する割合）
  const template = `
    <div class="op-camera">
      <!-- シーン1：ライトが消えた車体 -->
      <div class="op-scene op-scene--front">
        <div class="op-stage op-stage--front">
          <img src="${IMAGES.front}" alt="">
        </div>
      </div>

      <!-- シーン2：ライトが点いたアップ -->
      <div class="op-scene op-scene--headlight">
        <div class="op-stage op-stage--headlight">
          <img src="${IMAGES.headlight}" alt="">
          <span class="op-lamp-off" style="--lx:50%;--ly:64%;--size:40%"></span>          <!-- 点灯前にライトを暗く隠す影 -->
          <span class="op-light op-light--spill" style="--lx:50%;--ly:62%;--size:130%"></span> <!-- 周りを照らす広い光 -->
          <span class="op-light op-light--core" style="--lx:49.7%;--ly:59%;--size:46%"></span> <!-- 上のライトの光 -->
          <span class="op-light op-light--core" style="--lx:50%;--ly:77%;--size:24%"></span>   <!-- 下のライトの光 -->
          <span class="op-flare" style="--lx:50%;--ly:62%"></span>                         <!-- 横に伸びる光の筋 -->
        </div>
      </div>
    </div>

    <div class="op-vignette"></div> <!-- 画面の四隅を暗くする -->
    <div class="op-flash"></div>    <!-- 本編へ切り替わるときの白い光 -->

    <!-- 最初に表示する IGNITION ボタン -->
    <div class="op-intro">
      <button class="op-ignition" type="button" aria-label="IGNITION：エンジンを始動してサイトに入る">
        <span class="op-ignition__text"></span>
      </button>
      <p class="op-hint" aria-hidden="true">PRESS TO START ENGINE</p>
    </div>

    <!-- 左下：音のオン・オフ（aria-pressed = 押されている状態か） -->
    <button class="op-sound" type="button" aria-pressed="true">
      <span class="op-sound__bars" aria-hidden="true"><i></i><i></i><i></i></span>
      SOUND <span class="op-sound__state">ON</span>
    </button>

    <button class="op-skip" type="button">SKIP</button>
  `;

  // ---------- ① 準備：暗闇に IGNITION を浮かび上がらせる ----------
  const init = async () => {
    // オープニング用の <div class="opening"> を作って、<body> の先頭に追加
    opening = document.createElement('div');
    opening.className = 'opening';
    opening.setAttribute('role', 'dialog');
    opening.setAttribute('aria-label', 'オープニング');
    opening.innerHTML = template;
    document.body.prepend(opening);

    // ページの一番上から始める（URL に #design などが付いているときは除く）
    if (!location.hash) window.scrollTo(0, 0);

    // 「IGNITION」を1文字ずつ <span> で囲む（1文字ずつ順番に浮かび上がらせるため）
    // --i には 0, 1, 2... の番号が入り、CSS で表示を少しずつ遅らせるのに使います
    opening.querySelector('.op-ignition__text').innerHTML = [...'IGNITION']
      .map((char, i) => `<span class="op-letter" style="--i:${i}" aria-hidden="true">${char}</span>`)
      .join('');

    // ボタンが押されたときの処理を登録
    // { once: true } で、2回押しても演出が重ならないようにしています
    opening.querySelector('.op-ignition').addEventListener('click', ignite, { once: true });
    opening.querySelector('.op-skip').addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKeydown);

    // SOUND ON / OFF ボタン
    const soundBtn = opening.querySelector('.op-sound');
    if (hasSound) {
      updateSoundButton(soundBtn);
      soundBtn.addEventListener('click', () => {
        sound.setEnabled(!sound.isEnabled()); // 今の状態を反転
        updateSoundButton(soundBtn);
      });
    } else {
      soundBtn.remove(); // opening-sound.js を読み込んでいないときはボタンを出さない
    }

    // 画像の読み込みを待つ（ただし最大5秒まで）＋ 最低限の暗闇の時間を待つ
    const loaded = Promise.all(Object.values(IMAGES).map(preload));
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.all([Promise.race([loaded, timeout]), sleep(TIMING.minBlack)]);

    // is-ready を付けると、CSS で IGNITION が浮かび上がる
    if (!finished) opening.classList.add('is-ready');
  };

  // SOUND ボタンの表示（ON / OFF）を今の状態に合わせる
  const updateSoundButton = (btn) => {
    const on = sound.isEnabled();
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-off', !on);
    btn.querySelector('.op-sound__state').textContent = on ? 'ON' : 'OFF';
  };

  // Esc キーで演出をスキップ
  const onKeydown = (e) => {
    if (e.key === 'Escape') finish(true);
  };

  // ---------- ② IGNITION クリック後の演出 ----------
  // クラスを順番に付けていくと、CSS 側でそれぞれの演出が始まります。
  // 「await sleep(〇〇)」で次のシーンまで待ちます。
  const ignite = async () => {
    // 音の準備（ブラウザのルールで、クリックした瞬間に行う必要があります）
    sound.unlock();
    sound.keyOn(); // キーを回す「カチッ」＋ 燃料ポンプの音

    // IGNITION の文字が明滅して消える
    opening.classList.add('is-ignited');

    // スマホ（対応機種のみ）を小さく振動させて、エンジン始動の感触を出す
    if (navigator.vibrate && !reduceMotion) navigator.vibrate([30, 40, 70]);

    await sleep(TIMING.ignite);
    if (finished) return; // 途中で SKIP されていたらここで終了
    opening.classList.add('is-light-off'); // ライトが消えた車体が浮かび上がる

    await sleep(TIMING.lightOff);
    if (finished) return;
    opening.classList.add('is-light-on');  // ライトが点いた画像に切り替わり、点灯する
    // セルを1秒回してからエンジンがかかる（CSS でライトが点き始めるのも1秒後）
    sound.start(1);

    await sleep(TIMING.lightOn);
    if (finished) return;
    opening.classList.add('is-exit');      // ライトに吸い込まれるようにズーム
    sound.revOut(TIMING.exit / 1000);      // エンジンの回転を上げる

    await sleep(TIMING.exit);
    finish(false);                         // 本編へ
  };

  // ---------- ③ 本編へ切り替え ----------
  // skipped が true のときは SKIP ボタン（または Esc キー）で飛ばした場合
  const finish = (skipped) => {
    if (finished || !opening) return; // 2回実行されないようにする
    finished = true;

    document.removeEventListener('keydown', onKeydown);

    // エンジン音を小さくして消す（SKIP のときは速く）
    sound.fadeOut(skipped ? 0.4 : 1.4);

    // 本編を表示し（is-opening を外す）、本編の登場アニメーションを始める（is-revealed）
    root.classList.remove('is-opening');
    root.classList.add('is-revealed');
    if ('scrollRestoration' in history) history.scrollRestoration = 'auto';

    // オープニングをフェードアウト（SKIP のときは少し速く）
    const el = opening;
    if (skipped) el.style.transitionDuration = '.8s';
    el.classList.add('is-done');

    // フェードアウトが終わったら、オープニングの要素をページから削除
    const remove = () => el.remove();
    el.addEventListener('transitionend', (e) => { if (e.target === el) remove(); });
    setTimeout(remove, 2000); // 念のため、2秒後には必ず削除
  };

  // HTML の読み込みが終わってから init() を実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
