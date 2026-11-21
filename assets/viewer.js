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

    const frame = document.getElementById('viewer-frame');
    const loadingEl = document.getElementById('loading-state');
    const errorEl = document.getElementById('error-state');
    const errorTitleEl = document.getElementById('error-title');
    const errorDescEl = document.getElementById('error-desc');
    const titleEl = document.getElementById('page-title');
    const badgeEl = document.getElementById('page-badge');
    const dateEl = document.getElementById('page-date');

    // iframe 内の「TOP一覧へ戻る」リンク(index.html 等)を親ページ遷移へ橋渡し
    window.addEventListener('message', (event) => {
        if (event.source === frame.contentWindow && event.data && event.data.type === 'kaya-math-back') {
            window.location.href = './';
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

    // sandbox iframe 内の CSP 注入と、index.html 戻りリンクの橋渡しスクリプト注入
    function prepareHtmlForViewer(rawHtml) {
        const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${SRCDOC_CSP}">`;
        const bridgeScript = `<script>
document.addEventListener('click', function(e) {
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a) return;
  var href = (a.getAttribute('href') || '').trim();
  if (href === 'index.html' || href === './index.html' || href === './' || href === '/') {
    e.preventDefault();
    window.parent.postMessage({ type: 'kaya-math-back' }, '*');
  }
}, true);
<\/script>`;

        let html = rawHtml;
        if (/<head[^>]*>/i.test(html)) {
            html = html.replace(/<head[^>]*>/i, (match) => match + cspMeta);
        } else {
            html = cspMeta + html;
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
