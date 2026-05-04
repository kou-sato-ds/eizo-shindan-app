/* ============================================================
 * 映送特診断LIFFアプリ JavaScript（MVP最小構成）
 * ------------------------------------------------------------
 * MVP方針：
 *   - LIFF初期化 → 5問質問 → API呼び出し → 結果表示 の最短経路だけ
 *   - 開発時はモックレスポンスで動作、本番は実APIに切り替え
 *   - 後で肉付けする要素は明示的にコメントで残す
 * ============================================================ */

(function () {
  'use strict';

  // ============================================================
  // 設定値
  // ============================================================
  const CONFIG = {
    // LIFF ID（LINE Developers Console で発行された値を設定）
    LIFF_ID: '2009970212-i8uZntJ3',

    // バックエンドAPIのエンドポイント
    // SAMデプロイ後の API Gateway URL に差し替える
    // 末尾に diagnose を追加してください
    API_ENDPOINT: 'https://wyqa7v5io4.execute-api.ap-northeast-1.amazonaws.com/dev/diagnose',
    

    SCHEMA_VERSION: '1.0.0',
    API_TIMEOUT_MS: 15000,
  };

  // ============================================================
  // ULID生成（バックエンドと互換）
  // ============================================================
  const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

  function generateUlid() {
    let ts = Date.now();
    let tsPart = '';
    for (let i = 0; i < 10; i++) {
      tsPart = BASE32[ts & 0x1F] + tsPart;
      ts = Math.floor(ts / 32);
    }

    let randPart = '';
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      for (let i = 0; i < 16; i++) {
        randPart += BASE32[bytes[i] & 0x1F];
      }
    } else {
      for (let i = 0; i < 16; i++) {
        randPart += BASE32[Math.floor(Math.random() * 32)];
      }
    }

    return tsPart + randPart;
  }

  // ============================================================
  // 質問データ（最小5問）
  // ------------------------------------------------------------
  // バックエンドが受け付ける最小ペイロード形式に対応するよう
  // 各質問の回答を payload にどうマッピングするかを宣言的に定義
  // ============================================================
  const QUESTIONS = [
    {
      id: 'Q1',
      category: '事業所所在地',
      text: '事業所の所在地は東京都内ですか？',
      hint: '本診断は東京都の条例・規則に基づきます。',
      // 「いいえ」なら診断対象外として終了
      no_terminates: true,
    },
    {
      id: 'Q2',
      category: '用途地域',
      text: '事業所所在地の用途地域は「商業地域」ですか？',
      hint: '都市計画情報マップで確認できます。',
    },
    {
      id: 'Q3',
      category: '保護対象施設',
      text: '事業所から100m以内に学校はありますか？',
      hint: '小中学校、高校、専門学校等が対象です。',
    },
    {
      id: 'Q4',
      category: '営業形態',
      text: '映像送信型性風俗特殊営業として届出予定ですか？',
      hint: '本診断の主対象です。',
    },
    {
      id: 'Q5',
      category: '広告',
      text: 'Webサイトでオンライン広告を行う予定ですか？',
      hint: '商業地域以外でのオンライン広告は条例第11条の2第3項により制限されます。',
    },
  ];

  // ============================================================
  // アプリ状態
  // ============================================================
  const state = {
    user: { displayName: null, userId: null },
    currentIndex: 0,
    answers: {},
    diagnosisResult: null,
  };

  // ============================================================
  // 画面遷移ヘルパー
  // ============================================================
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(function (el) {
      el.classList.remove('active');
    });
    const target = document.getElementById(screenId);
    if (target) {
      target.classList.add('active');
      window.scrollTo(0, 0);
    }
  }

  // ============================================================
  // LIFF初期化
  // ============================================================
  async function initializeLiff() {
    try {
      if (typeof liff === 'undefined') {
        console.warn('[LIFF] SDK未読込。ゲストモードで継続');
        setGuestMode();
        return;
      }

      await liff.init({ liffId: CONFIG.LIFF_ID });
      console.log('[LIFF] 初期化成功');

      if (!liff.isLoggedIn()) {
        if (liff.isInClient()) {
          liff.login();
          return;
        }
        setGuestMode();
        return;
      }

      const profile = await liff.getProfile();
      state.user.displayName = profile.displayName;
      state.user.userId = profile.userId;
      renderGreeting();
    } catch (error) {
      console.error('[LIFF] 初期化エラー:', error);
      setGuestMode();
    }
  }

  function setGuestMode() {
    state.user.displayName = 'ゲスト';
    state.user.userId = 'guest-' + generateUlid();
    renderGreeting();
  }

  function renderGreeting() {
    const greetingEl = document.getElementById('greeting');
    const userNameEl = document.getElementById('user-name');
    if (greetingEl && userNameEl) {
      userNameEl.textContent = state.user.displayName;
      greetingEl.hidden = false;
    }
  }

  // ============================================================
  // 質問描画
  // ============================================================
  function renderQuestion() {
    if (state.currentIndex >= QUESTIONS.length) {
      submitDiagnosis();
      return;
    }

    const q = QUESTIONS[state.currentIndex];
    document.getElementById('question-category').textContent = q.category;
    document.getElementById('question-text').textContent = q.text;
    document.getElementById('question-hint').textContent = q.hint || '';

    // プログレスバー
    const total = QUESTIONS.length;
    const current = state.currentIndex + 1;
    const percent = Math.round((current / total) * 100);
    document.getElementById('progress-text').textContent = `質問 ${current} / ${total}`;
    const fill = document.getElementById('progress-fill');
    fill.style.width = percent + '%';
    fill.parentElement.setAttribute('aria-valuenow', percent);

    // 戻るボタン
    document.getElementById('btn-back').disabled = (state.currentIndex === 0);
  }

  function handleAnswer(answer) {
    const q = QUESTIONS[state.currentIndex];
    state.answers[q.id] = answer;

    // 「いいえ」で終了する質問
    if (q.no_terminates && answer === 'no') {
      showError('本診断は東京都の条例・規則に基づくため、都外の事業所は対象外です。');
      return;
    }

    state.currentIndex++;
    renderQuestion();
  }

  function handleBack() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      renderQuestion();
    }
  }

  // ============================================================
  // ペイロード組み立て（バックエンドが期待する最小形式）
  // ============================================================
  function buildPayload() {
    // Q2の回答から zoning_code を決定
    const q2Answer = state.answers['Q2'];
    let zoningCode = 'UNDESIGNATED';
    if (q2Answer === 'yes') zoningCode = 'COMMERCIAL';
    else if (q2Answer === 'no') zoningCode = 'RESIDENTIAL_1';

    // Q3の回答から学校距離を決定
    const q3Answer = state.answers['Q3'];
    const facilities = [];
    if (q3Answer === 'yes') {
      facilities.push({
        facility_type: 'SCHOOL_NON_UNIVERSITY',
        distance_m: 30.0,
      });
    }

    // Q5の回答からオンライン広告フラグ
    const advertisesOnline = state.answers['Q5'] === 'yes';

    return {
      schema_version: CONFIG.SCHEMA_VERSION,
      request_id: generateUlid(),
      requested_at: new Date().toISOString(),
      applicant: {
        applicant_hash: state.user.userId,
        line_user_id_masked: state.user.userId
          ? '****' + state.user.userId.slice(-4)
          : 'guest',
      },
      location: {
        zoning: { zoning_code: zoningCode },
        protected_facilities: facilities,
      },
      business_profile: {
        business_type: 'EIZO_SOSHIN',
        advertises_online: advertisesOnline,
      },
    };
  }

  // ============================================================
  // API呼び出し
  // ============================================================
  async function callApi(payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(function () { controller.abort(); }, CONFIG.API_TIMEOUT_MS);

    try {
      const response = await fetch(CONFIG.API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('TIMEOUT');
      throw error;
    }
  }

  // モックレスポンス（API未設定時の開発用）
  function mockResponse(payload) {
    const isCommercial = payload.location.zoning.zoning_code === 'COMMERCIAL';
    const hasNearSchool = payload.location.protected_facilities.some(function (f) {
      return f.facility_type.startsWith('SCHOOL') && f.distance_m < 50;
    });

    let overall = 'PERMITTED';
    if (!isCommercial || hasNearSchool) overall = 'PROHIBITED';

    return {
      schema_version: '1.0.0',
      request_id: payload.request_id,
      judged_at: new Date().toISOString(),
      verdict: {
        overall_status: overall,
        confidence_level: 'MEDIUM',
        summary_message: overall === 'PROHIBITED'
          ? '禁止地域に該当する可能性が高いです。行政書士への相談を推奨します。'
          : '現時点で禁止地域該当の事実は確認されませんでした。',
      },
      checks: [
        {
          check_id: 'CHK_ZONING_001',
          check_name: '商業地域要件',
          result: isCommercial ? 'PASS' : 'FAIL',
          legal_basis: { statute: 'JOREI', article: '第11条の2第3項' },
          message: isCommercial ? '商業地域内' : '商業地域外のため違反のおそれ',
        },
        {
          check_id: 'CHK_DISTANCE_001',
          check_name: '保護対象施設距離',
          result: hasNearSchool ? 'FAIL' : 'PASS',
          legal_basis: { statute: 'KISOKU', article: '第2条第1項第2号ア' },
          message: hasNearSchool ? '学校が至近距離にあります' : '保護対象施設の距離要件OK',
        },
      ],
    };
  }

  async function submitDiagnosis() {
    showScreen('screen-loading');
    try {
      const payload = buildPayload();
      console.log('[診断] payload:', payload);

      let result;
      if (CONFIG.API_ENDPOINT.includes('your-api-id')) {
        console.warn('[診断] API未設定。モック使用');
        result = mockResponse(payload);
        await new Promise(function (r) { setTimeout(r, 600); });
      } else {
        result = await callApi(payload);
      }

      state.diagnosisResult = result;
      renderResult(result);
      showScreen('screen-result');
      console.log('[診断] 完了:', result.request_id);
    } catch (error) {
      console.error('[診断] エラー:', error);
      const msg = error.message === 'TIMEOUT'
        ? 'タイムアウトしました。再度お試しください。'
        : '通信エラーが発生しました。';
      showError(msg);
    }
  }

  // ============================================================
  // 結果描画
  // ============================================================
  function renderResult(result) {
    const v = result.verdict;
    const badge = document.getElementById('verdict-badge');
    badge.className = 'verdict-badge';

    const verdictMap = {
      PERMITTED: { cls: 'permitted', icon: '✓', label: '適合' },
      PROHIBITED: { cls: 'prohibited', icon: '✕', label: '不適合' },
      CONDITIONALLY_PERMITTED: { cls: 'conditional', icon: '!', label: '条件付き適合' },
      REQUIRES_HUMAN_REVIEW: { cls: 'review', icon: '?', label: '要詳細確認' },
    };
    const config = verdictMap[v.overall_status] || verdictMap.REQUIRES_HUMAN_REVIEW;
    badge.classList.add(config.cls);
    document.getElementById('verdict-icon').textContent = config.icon;
    document.getElementById('verdict-label').textContent = config.label;
    document.getElementById('verdict-message').textContent = v.summary_message;

    const confMap = { HIGH: '高', MEDIUM: '中', LOW: '低' };
    document.getElementById('confidence-value').textContent = confMap[v.confidence_level] || '-';

    // 個別チェック結果
    const list = document.getElementById('checks-list');
    list.innerHTML = '';
    const statusMap = {
      PASS: { label: '適合', cls: 'pass' },
      FAIL: { label: '不適合', cls: 'fail' },
      WARN: { label: '要注意', cls: 'warn' },
      NOT_APPLICABLE: { label: '対象外', cls: 'not-applicable' },
    };
    const statuteMap = {
      FUEIHO: '風営法', JOREI: '東京都条例', KISOKU: '公安委員会規則', KOKUJI: '告示',
    };

    result.checks.forEach(function (check) {
      const sc = statusMap[check.result] || statusMap.NOT_APPLICABLE;
      const item = document.createElement('div');
      item.className = 'check-item ' + sc.cls;

      const header = document.createElement('div');
      header.className = 'check-header';
      const name = document.createElement('span');
      name.className = 'check-name';
      name.textContent = check.check_name;
      header.appendChild(name);

      const status = document.createElement('span');
      status.className = 'check-status ' + sc.cls;
      status.textContent = sc.label;
      header.appendChild(status);
      item.appendChild(header);

      if (check.message) {
        const msg = document.createElement('p');
        msg.className = 'check-message';
        msg.textContent = check.message;
        item.appendChild(msg);
      }

      if (check.legal_basis) {
        const legal = document.createElement('div');
        legal.className = 'check-legal';
        const strong = document.createElement('strong');
        strong.textContent = statuteMap[check.legal_basis.statute] || check.legal_basis.statute;
        legal.appendChild(strong);
        legal.appendChild(document.createTextNode(' ' + check.legal_basis.article));
        item.appendChild(legal);
      }

      list.appendChild(item);
    });

    document.getElementById('request-id').textContent = result.request_id;
  }

  function showError(message) {
    document.getElementById('error-message').textContent = message;
    showScreen('screen-error');
  }

  function resetState() {
    state.currentIndex = 0;
    state.answers = {};
    state.diagnosisResult = null;
  }

  // ============================================================
  // 行政書士相談導線（liff.sendMessages）
  // ============================================================
  async function handleContact() {
    const result = state.diagnosisResult;
    if (!result) {
      alert('診断結果がありません。');
      return;
    }

    const verdictLabelMap = {
      PERMITTED: '適合', PROHIBITED: '不適合（禁止地域）',
      CONDITIONALLY_PERMITTED: '条件付き適合', REQUIRES_HUMAN_REVIEW: '要詳細確認',
    };
    const verdictLabel = verdictLabelMap[result.verdict.overall_status] || result.verdict.overall_status;

    const failedItems = result.checks
      .filter(function (c) { return c.result === 'FAIL'; })
      .map(function (c) { return '・' + c.check_name; })
      .join('\n');

    let message = '【映送特診断 相談依頼】\n';
    message += '\n■ 診断ID: ' + result.request_id + '\n';
    message += '■ 総合判定: ' + verdictLabel + '\n';
    if (failedItems) {
      message += '\n■ 不適合項目:\n' + failedItems + '\n';
    }
    message += '\n上記について個別相談を希望いたします。';

    if (typeof liff !== 'undefined' && liff.isInClient && liff.isInClient()) {
      try {
        await liff.sendMessages([{ type: 'text', text: message }]);
        if (typeof liff.closeWindow === 'function') {
          liff.closeWindow();
        }
      } catch (err) {
        console.error('[相談] sendMessages失敗:', err);
        alert('メッセージ送信に失敗しました。\n診断ID: ' + result.request_id);
      }
    } else {
      // PCブラウザ等：クリップボードへコピー
      console.log('[相談] メッセージ:\n', message);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(message);
          alert('メッセージをクリップボードにコピーしました。');
        } catch (e) {
          alert('診断ID: ' + result.request_id);
        }
      } else {
        alert('診断ID: ' + result.request_id);
      }
    }
  }

  // ============================================================
  // イベントリスナー
  // ============================================================
  function setupEventListeners() {
    document.addEventListener('click', function (event) {
      const target = event.target.closest('[data-action], [data-answer]');
      if (!target) return;

      if (target.dataset.action) {
        switch (target.dataset.action) {
          case 'start':
            resetState();
            renderQuestion();
            showScreen('screen-question');
            break;
          case 'back':
            handleBack();
            break;
          case 'restart':
            resetState();
            showScreen('screen-welcome');
            break;
          case 'contact':
            handleContact();
            break;
        }
      }

      if (target.dataset.answer) {
        handleAnswer(target.dataset.answer);
      }
    });
  }

  // ============================================================
  // エントリポイント
  // ============================================================
  document.addEventListener('DOMContentLoaded', function () {
    console.log('[アプリ] 起動 v0.1.0-mvp');
    setupEventListeners();
    initializeLiff();
  });

})();
