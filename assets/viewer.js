(function () {
    'use strict';

    const SUPA_URL = 'https://uzpmpjkkwapaohleejtt.supabase.co';
    const SUPA_KEY = 'sb_publishable_YCsV4Wpn8tb8gwLrgsPf2g_xAX0Q4gt';
    const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);

    // サンドボックス内 srcdoc に適用する CSP（許可CDN以外への通信・フォーム送信・プラグインを遮断）（F-03）
    const SRCDOC_CSP = [
        "default-src 'none'",
        "script-src 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
        "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
        "font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:",
        "img-src data: blob:",
        "connect-src 'none'",
        "form-action 'none'",
        "object-src 'none'",
        "base-uri 'none'",
    ].join('; ');

    const viewerMain = document.querySelector('.viewer-main');
    const frame = document.getElementById('viewer-frame');
    const loadingEl = document.getElementById('loading-state');
    const errorEl = document.getElementById('error-state');
    const errorTitleEl = document.getElementById('error-title');
    const errorDescEl = document.getElementById('error-desc');
    const titleEl = document.getElementById('page-title');
    const badgeEl = document.getElementById('page-badge');
    const dateEl = document.getElementById('page-date');

    function syncFrameHeight(msg) {
        if (!viewerMain || !frame) return;
        if (msg.fixed) {
            frame.style.height = '100%';
            return;
        }
        const minHeight = viewerMain.clientHeight;
        const target = Number(msg.height) || 0;
        frame.style.height = target > minHeight + 2 ? `${Math.ceil(target)}px` : '100%';
    }

    // iframe 内の「TOP一覧へ戻る」リンクおよびコンテンツ高さ通知を親へ橋渡し
    window.addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow || event.origin !== 'null' || !event.data) return;
        if (event.data.type === 'kaya-math-back') {
            window.location.href = './';
        } else if (event.data.type === 'kaya-math-height') {
            syncFrameHeight(event.data);
        }
    });

    function showError(title, desc) {
        loadingEl.classList.add('hidden');
        errorTitleEl.textContent = title;
        errorDescEl.textContent = desc;
        errorEl.classList.remove('hidden');
    }

    function formatDate(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    // 先生配布の作図テンプレート特有の再生・描画不具合をランタイム表示時に自動補正する
    function patchSakuzuTemplateRuntime(html) {
        if (!html.includes('function togglePlay()') || !html.includes('function loop(')) {
            return html;
        }

        let out = html;

        // 1. ステップ0(はじめに)や最終ステップからの再生開始時にステップ1へ進めて即再生するよう補正
        out = out.replace(
            /function nextStep\(\)\s*\{[\s\S]*?updateUI\(\);\s*\}/,
            `function nextStep() {
            if (currentStepIndex < stepsData.length - 1) {
                currentStepIndex++;
            } else {
                currentStepIndex = stepsData.length > 1 ? 1 : 0;
            }
            stepProgress = 0;
            isPlaying = true;
            lastTime = performance.now();
            updateUI();
        }`
        );

        out = out.replace(
            /function prevStep\(\)\s*\{[\s\S]*?updateUI\(\);\s*\}/,
            `function prevStep() {
            if (currentStepIndex > 0) {
                if (stepProgress > 0) {
                    stepProgress = 0;
                    isPlaying = true;
                } else {
                    currentStepIndex--;
                    stepProgress = 0;
                    isPlaying = currentStepIndex > 0;
                }
                lastTime = performance.now();
            }
            updateUI();
        }`
        );

        out = out.replace(
            /function togglePlay\(\)\s*\{[\s\S]*?updateUI\(\);\s*\}/,
            `function togglePlay() {
            if (stepProgress >= 1) {
                if (currentStepIndex < stepsData.length - 1) {
                    nextStep();
                    return;
                } else {
                    currentStepIndex = stepsData.length > 1 ? 1 : 0;
                    stepProgress = 0;
                    isPlaying = true;
                    lastTime = performance.now();
                }
            } else if (currentStepIndex === 0) {
                nextStep();
                return;
            } else {
                isPlaying = !isPlaying;
                if (isPlaying) lastTime = performance.now();
            }
            updateUI();
        }`
        );

        // 2. loop内のdtクランプと毎フレームupdateUI()連打によるiOSタップ取りこぼしを防止
        out = out.replace(
            'let dt = timestamp - lastTime;',
            'let dt = Math.min(Math.max(timestamp - lastTime, 0), 100);'
        );

        out = out.replace(
            /if\s*\(currentStepIndex > 0\)\s*\{\s*stepProgress \+= dt \/ duration;\s*if\s*\(stepProgress >= 1\.0\)\s*\{\s*stepProgress = 1\.0;\s*isPlaying = false;[^\n]*\n\s*\}\s*\}\s*updateUI\(\);/,
            `if (currentStepIndex > 0) {
                    stepProgress += dt / duration;
                    if (stepProgress >= 1.0) {
                        stepProgress = 1.0;
                        isPlaying = false;
                        updateUI();
                    }
                }`
        );

        // 3. 外部フォント等の読込待ちをせずDOM準備完了で即初期化
        out = out.replace(
            /window\.onload\s*=\s*\(\)\s*=>\s*\{\s*updateUI\(\);\s*requestAnimationFrame\(loop\);\s*\};/,
            `function __kayaInitApp() { updateUI(); requestAnimationFrame(loop); }
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', __kayaInitApp); } else { __kayaInitApp(); }`
        );

        return out;
    }

    // sandbox iframe 内の CSP 注入、iOS スクロール・高さ同期、および index.html 戻りリンク橋渡しを注入
    function prepareHtmlForViewer(rawHtml) {
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">`;
        const mobileSafeStyle = `<style>
@media (pointer: coarse) {
  button, [role="button"] { min-height: 44px; touch-action: manipulation; }
}
button {
  touch-action: manipulation;
}
body.min-h-screen {
  min-height: 100% !important;
  min-height: 100dvh !important;
  justify-content: safe center !important;
  padding-top: 0.75rem !important;
  padding-bottom: max(1.25rem, env(safe-area-inset-bottom, 0px)) !important;
}
@media (max-width: 639px) {
  body.min-h-screen canvas#simCanvas {
    max-height: 38dvh !important;
    object-fit: contain !important;
  }
}
</style>`;
        const bridgeScript = `<script>
(function() {
  document.addEventListener('click', function(e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = (a.getAttribute('href') || '').trim();
    if (href === 'index.html' || href === './index.html' || href === './' || href === '/') {
      e.preventDefault();
      window.parent.postMessage({ type: 'kaya-math-back' }, '*');
    }
  }, true);

  function measureAndPost() {
    if (!document.body) return;
    var cs = getComputedStyle(document.body);
    if (cs.overflowY === 'hidden' || document.body.classList.contains('h-screen')) {
      window.parent.postMessage({ type: 'kaya-math-height', fixed: true }, '*');
      return;
    }
    var bodyRect = document.body.getBoundingClientRect();
    var padBottom = parseFloat(cs.paddingBottom) || 0;
    var maxBottom = 0;
    for (var i = 0; i < document.body.children.length; i++) {
      var child = document.body.children[i];
      var style = getComputedStyle(child);
      if (style.position === 'fixed' || style.display === 'none') continue;
      var rect = child.getBoundingClientRect();
      var b = rect.bottom - bodyRect.top + (parseFloat(style.marginBottom) || 0);
      if (b > maxBottom) maxBottom = b;
    }
    var contentHeight = Math.max(maxBottom + padBottom, 0);
    window.parent.postMessage({ type: 'kaya-math-height', fixed: false, height: contentHeight }, '*');
  }

  window.addEventListener('DOMContentLoaded', measureAndPost);
  window.addEventListener('load', measureAndPost);
  window.addEventListener('resize', measureAndPost);
  if (typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(measureAndPost);
    ro.observe(document.documentElement);
  }
  setTimeout(measureAndPost, 300);
})();
<\/script>`;

        let html = patchSakuzuTemplateRuntime(rawHtml);
        if (/<head[^>]*>/i.test(html)) {
            html = html.replace(/<head[^>]*>/i, (match) => match + cspMeta + mobileSafeStyle);
        } else {
            html = cspMeta + mobileSafeStyle + html;
        }

        const matches = [...html.matchAll(/<\/body>/gi)];
        if (matches.length > 0) {
            const lastIdx = matches[matches.length - 1].index;
            return html.slice(0, lastIdx) + bridgeScript + html.slice(lastIdx);
        }
        return html + bridgeScript;
    }

    async function init() {
        const params = new URLSearchParams(window.location.search);
        const id = params.get('id');
        const slug = params.get('slug');

        if (!id && !slug) {
            showError('URLパラメータが不足しています', '一覧ページから教材を選択して開いてください。');
            return;
        }

        let query = sb
            .from('math_pages')
            .select('id, slug, title, badge, published_at, html_content');

        if (id) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
                showError('指定された教材が見つかりません', 'URLのID形式が正しくありません。');
                return;
            }
            query = query.eq('id', id);
        } else {
            query = query.eq('slug', slug);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
            console.error('Failed to load math page:', error);
            showError('読み込みエラーが発生しました', '時間をおいて再度お試しください。');
            return;
        }
        if (!data) {
            showError('指定された教材が見つかりません', '削除されたか、URLが変更された可能性があります。');
            return;
        }

        document.title = `${data.title} | Kaya's Math Studio`;
        titleEl.textContent = data.title;
        if (data.badge) {
            badgeEl.textContent = data.badge;
            badgeEl.classList.remove('hidden');
        }
        if (data.published_at) {
            dateEl.textContent = formatDate(data.published_at);
        }

        frame.addEventListener('load', () => {
            loadingEl.classList.add('hidden');
        }, { once: true });

        frame.srcdoc = prepareHtmlForViewer(data.html_content);
    }

    init();
})();
