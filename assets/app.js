(function () {
    'use strict';

    const SUPA_URL = 'https://uzpmpjkkwapaohleejtt.supabase.co';
    const SUPA_KEY = 'sb_publishable_YCsV4Wpn8tb8gwLrgsPf2g_xAX0Q4gt';
    const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
    const VIEW_MODE_KEY = 'kaya_math_view_mode';

    const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);

    const state = {
        pages: [],
        user: null,
        isAllowedUploader: false,
        search: '',
        sort: 'newest',
        selectedTag: 'ALL',
        viewMode: localStorage.getItem(VIEW_MODE_KEY) === 'card' ? 'card' : 'list',
        editingItem: null,
        pendingHtmlContent: null,
    };

    // DOM Elements
    const btnGoogleLogin = document.getElementById('btn-google-login');
    const authUserArea = document.getElementById('auth-user-area');
    const btnOpenUpload = document.getElementById('btn-open-upload');
    const readonlyBadge = document.getElementById('readonly-badge');
    const userNameEl = document.getElementById('user-name');
    const btnLogout = document.getElementById('btn-logout');
    const alertBanner = document.getElementById('alert-banner');

    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');
    const viewListBtn = document.getElementById('view-list-btn');
    const viewCardBtn = document.getElementById('view-card-btn');
    const tagFiltersEl = document.getElementById('tag-filters');
    const countBadgeEl = document.getElementById('count-badge');

    const loadingSkeleton = document.getElementById('loading-skeleton');
    const emptyStateEl = document.getElementById('empty-state');
    const listContainer = document.getElementById('list-container');
    const cardContainer = document.getElementById('card-container');

    // Modal Elements
    const editorModal = document.getElementById('editor-modal');
    const modalHeading = document.getElementById('modal-heading');
    const editorForm = document.getElementById('editor-form');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileStatusText = document.getElementById('file-status-text');
    const duplicateNotice = document.getElementById('duplicate-notice');
    const duplicateSlugLabel = document.getElementById('duplicate-slug-label');
    const fieldSlug = document.getElementById('field-slug');
    const fieldDate = document.getElementById('field-date');
    const fieldTitle = document.getElementById('field-title');
    const fieldBadge = document.getElementById('field-badge');
    const fieldTags = document.getElementById('field-tags');
    const fieldDesc = document.getElementById('field-desc');
    const modalError = document.getElementById('modal-error');
    const btnSubmitModal = document.getElementById('btn-submit-modal');
    const toastEl = document.getElementById('toast');

    function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.remove('hidden');
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => toastEl.classList.add('hidden'), 3200);
    }

    function showAlert(msg, type = 'error') {
        alertBanner.textContent = msg;
        alertBanner.className = type === 'error' ? 'alert-banner' : 'alert-banner alert-warn';
        alertBanner.classList.remove('hidden');
    }

    function formatDateDisplay(isoStr) {
        if (!isoStr) return '-';
        const d = new Date(isoStr);
        if (Number.isNaN(d.getTime())) return '-';
        return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    }

    function toDateInputValue(isoStr) {
        const d = isoStr ? new Date(isoStr) : new Date();
        if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function toIsoFromDateInput(dateStr) {
        const today = toDateInputValue(new Date().toISOString());
        if (dateStr === today) {
            return new Date().toISOString();
        }
        return new Date(`${dateStr}T12:00:00+09:00`).toISOString();
    }

    // ===== Auth =====
    async function checkUploaderPermission(user) {
        if (!user || !user.email) return false;
        const { data, error } = await sb
            .from('math_allowed_uploaders')
            .select('email')
            .limit(1);
        if (error) {
            console.warn('Permission check error:', error.message);
            return false;
        }
        return Array.isArray(data) && data.length > 0;
    }

    function renderAuthUI() {
        if (!state.user) {
            btnGoogleLogin.classList.remove('hidden');
            authUserArea.classList.add('hidden');
            btnOpenUpload.classList.add('hidden');
            readonlyBadge.classList.add('hidden');
        } else {
            btnGoogleLogin.classList.add('hidden');
            authUserArea.classList.remove('hidden');
            const displayName = state.user.user_metadata?.full_name
                || state.user.user_metadata?.name
                || state.user.email;
            userNameEl.textContent = displayName;
            if (state.isAllowedUploader) {
                btnOpenUpload.classList.remove('hidden');
                readonlyBadge.classList.add('hidden');
            } else {
                btnOpenUpload.classList.add('hidden');
                readonlyBadge.classList.remove('hidden');
            }
        }
        renderPages();
    }

    btnGoogleLogin.addEventListener('click', async () => {
        await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin + window.location.pathname },
        });
    });

    btnLogout.addEventListener('click', async () => {
        await sb.auth.signOut();
    });

    let authCheckSeq = 0;
    sb.auth.onAuthStateChange((_event, session) => {
        const seq = ++authCheckSeq;
        state.user = session?.user || null;
        state.isAllowedUploader = false;
        renderAuthUI();
        if (state.user) {
            const targetUser = state.user;
            setTimeout(async () => {
                const allowed = await checkUploaderPermission(targetUser);
                if (seq !== authCheckSeq) return;
                state.isAllowedUploader = allowed;
                renderAuthUI();
            }, 0);
        }
    });

    // ===== Data Fetching =====
    async function loadPages() {
        loadingSkeleton.classList.remove('hidden');
        listContainer.classList.add('hidden');
        cardContainer.classList.add('hidden');
        emptyStateEl.classList.add('hidden');

        const { data, error } = await sb
            .from('math_pages')
            .select('id, slug, title, badge, description, tags, file_size, published_at, updated_at')
            .order('published_at', { ascending: false });

        loadingSkeleton.classList.add('hidden');

        if (error) {
            showAlert(`教材データの取得に失敗しました（Supabase のマイグレーション 007 が未実行の可能性があります）: ${error.message}`);
            state.pages = [];
            renderTagFilters();
            renderPages();
            return;
        }

        alertBanner.classList.add('hidden');
        state.pages = data || [];
        renderTagFilters();
        renderPages();
    }

    // ===== Filtering & Sorting =====
    function getFilteredPages() {
        const q = state.search.trim().toLowerCase();
        let items = state.pages.filter((p) => {
            if (state.selectedTag !== 'ALL') {
                const tags = Array.isArray(p.tags) ? p.tags : [];
                if (!tags.includes(state.selectedTag)) return false;
            }
            if (!q) return true;
            const haystack = [
                p.title || '',
                p.slug || '',
                p.badge || '',
                p.description || '',
                ...(Array.isArray(p.tags) ? p.tags : []),
            ].join(' ').toLowerCase();
            return haystack.includes(q);
        });

        items = items.slice();
        if (state.sort === 'newest') {
            items.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
        } else if (state.sort === 'oldest') {
            items.sort((a, b) => new Date(a.published_at) - new Date(b.published_at));
        } else if (state.sort === 'title') {
            items.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ja'));
        }
        return items;
    }

    function renderTagFilters() {
        const tagCounts = new Map();
        for (const p of state.pages) {
            for (const t of (p.tags || [])) {
                tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
        }
        const sortedTags = Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
            .map(([tag]) => tag);

        if (state.selectedTag !== 'ALL' && !tagCounts.has(state.selectedTag)) {
            state.selectedTag = 'ALL';
        }

        tagFiltersEl.replaceChildren();
        const createPill = (label, value) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = state.selectedTag === value ? 'tag-pill active' : 'tag-pill';
            btn.textContent = label;
            btn.addEventListener('click', () => {
                state.selectedTag = value;
                renderTagFilters();
                renderPages();
            });
            return btn;
        };

        tagFiltersEl.appendChild(createPill('すべて', 'ALL'));
        for (const tag of sortedTags) {
            tagFiltersEl.appendChild(createPill(tag, tag));
        }
    }

    function updateViewButtons() {
        viewListBtn.classList.toggle('active', state.viewMode === 'list');
        viewCardBtn.classList.toggle('active', state.viewMode === 'card');
    }

    function createActionButtons(item) {
        const wrap = document.createElement('div');
        wrap.className = 'item-actions';

        if (state.isAllowedUploader) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'btn btn-ghost';
            editBtn.textContent = '編集';
            editBtn.addEventListener('click', () => openEditModal(item));
            wrap.appendChild(editBtn);

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-danger-soft';
            delBtn.textContent = '削除';
            delBtn.addEventListener('click', () => deletePage(item));
            wrap.appendChild(delBtn);
        }

        const openLink = document.createElement('a');
        openLink.href = `view.html?id=${encodeURIComponent(item.id)}`;
        openLink.className = 'btn btn-primary';
        openLink.textContent = '開く';
        wrap.appendChild(openLink);

        return wrap;
    }

    function renderPages() {
        updateViewButtons();
        const items = getFilteredPages();
        const total = state.pages.length;

        countBadgeEl.textContent = items.length === total
            ? `全 ${total} 件`
            : `${items.length} / ${total} 件を表示`;

        listContainer.replaceChildren();
        cardContainer.replaceChildren();

        if (items.length === 0) {
            listContainer.classList.add('hidden');
            cardContainer.classList.add('hidden');
            if (!loadingSkeleton.classList.contains('hidden')) return;
            emptyStateEl.classList.remove('hidden');
            return;
        }

        emptyStateEl.classList.add('hidden');

        if (state.viewMode === 'list') {
            cardContainer.classList.add('hidden');
            listContainer.classList.remove('hidden');

            for (const item of items) {
                const row = document.createElement('div');
                row.className = 'list-row';

                const left = document.createElement('div');
                left.className = 'list-main';

                const topLine = document.createElement('div');
                topLine.className = 'list-top';

                const dateSpan = document.createElement('span');
                dateSpan.className = 'item-date';
                dateSpan.textContent = formatDateDisplay(item.published_at);
                topLine.appendChild(dateSpan);

                if (item.badge) {
                    const badgeSpan = document.createElement('span');
                    badgeSpan.className = 'item-badge';
                    badgeSpan.textContent = item.badge;
                    topLine.appendChild(badgeSpan);
                }

                const titleLink = document.createElement('a');
                titleLink.href = `view.html?id=${encodeURIComponent(item.id)}`;
                titleLink.className = 'item-title-link';
                titleLink.textContent = item.title;
                topLine.appendChild(titleLink);

                left.appendChild(topLine);

                const subLine = document.createElement('div');
                subLine.className = 'list-sub';

                const slugSpan = document.createElement('span');
                slugSpan.className = 'item-slug';
                slugSpan.textContent = item.slug;
                subLine.appendChild(slugSpan);

                for (const tag of (item.tags || [])) {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'item-tag';
                    tagSpan.textContent = tag;
                    subLine.appendChild(tagSpan);
                }
                left.appendChild(subLine);

                row.appendChild(left);
                row.appendChild(createActionButtons(item));
                listContainer.appendChild(row);
            }
        } else {
            listContainer.classList.add('hidden');
            cardContainer.classList.remove('hidden');

            for (const item of items) {
                const card = document.createElement('div');
                card.className = 'item-card';

                const body = document.createElement('div');
                body.className = 'card-body';

                const metaTop = document.createElement('div');
                metaTop.className = 'card-meta';

                const badgeSpan = document.createElement('span');
                badgeSpan.className = 'item-badge';
                badgeSpan.textContent = item.badge || '教材';
                metaTop.appendChild(badgeSpan);

                const dateSpan = document.createElement('span');
                dateSpan.className = 'item-date';
                dateSpan.textContent = formatDateDisplay(item.published_at);
                metaTop.appendChild(dateSpan);

                body.appendChild(metaTop);

                const titleEl = document.createElement('h3');
                titleEl.className = 'card-title';
                titleEl.textContent = item.title;
                body.appendChild(titleEl);

                if (item.description) {
                    const descEl = document.createElement('p');
                    descEl.className = 'card-desc';
                    descEl.textContent = item.description;
                    body.appendChild(descEl);
                }

                const tagsWrap = document.createElement('div');
                tagsWrap.className = 'card-tags';
                for (const tag of (item.tags || [])) {
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'item-tag';
                    tagSpan.textContent = tag;
                    tagsWrap.appendChild(tagSpan);
                }
                body.appendChild(tagsWrap);

                const footer = document.createElement('div');
                footer.className = 'card-footer';
                const slugSpan = document.createElement('span');
                slugSpan.className = 'item-slug';
                slugSpan.textContent = item.slug;
                footer.appendChild(slugSpan);
                footer.appendChild(createActionButtons(item));

                card.appendChild(body);
                card.appendChild(footer);
                cardContainer.appendChild(card);
            }
        }
    }

    // Toolbar Events
    searchInput.addEventListener('input', (e) => {
        state.search = e.target.value;
        renderPages();
    });
    sortSelect.addEventListener('change', (e) => {
        state.sort = e.target.value;
        renderPages();
    });
    viewListBtn.addEventListener('click', () => {
        state.viewMode = 'list';
        localStorage.setItem(VIEW_MODE_KEY, 'list');
        renderPages();
    });
    viewCardBtn.addEventListener('click', () => {
        state.viewMode = 'card';
        localStorage.setItem(VIEW_MODE_KEY, 'card');
        renderPages();
    });

    // ===== Upload / Edit / Delete =====
    function extractMetadataFromHtmlText(filename, htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const h1 = doc.querySelector('h1')?.textContent?.trim() || '';
        const rawTitle = doc.querySelector('title')?.textContent?.trim() || '';
        const title = (h1 || rawTitle || filename.replace(/\.html?$/i, ''))
            .replace(/^[📐✏️📏🔺●○◆◇\s]+/, '')
            .replace(/\s*解説アニメーション.*$/, '')
            .trim();

        let description = doc.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
        if (!description) {
            const paragraphs = Array.from(doc.querySelectorAll('p'));
            for (const p of paragraphs) {
                const clean = (p.textContent || '').trim();
                if (clean.length >= 12 && !clean.includes('アニメーション解説')) {
                    description = clean;
                    break;
                }
            }
        }

        const tags = [];
        if (filename.includes('作図') || title.includes('作図')) tags.push('作図');
        if (htmlText.includes('OrbitControls') || /\bthree(?:\.min)?\.js\b|\bTHREE\./i.test(htmlText)) tags.push('空間図形', '3D');
        if (tags.length === 0) tags.push('数学');

        let badge = '';
        const sakuzuMatch = filename.match(/プリント作図問題([0-9０-９]+)(.*)\.html?$/);
        if (sakuzuMatch) {
            const num = sakuzuMatch[1].replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            badge = `作図プリント No.${num}${sakuzuMatch[2] || ''}`;
        } else if (filename.includes('作図')) {
            badge = '基本作図';
        }

        return { title, badge, description, tags };
    }

    function normalizeSlug(raw) {
        let slug = raw.trim().normalize('NFC');
        if (slug && !/\.html?$/i.test(slug)) slug += '.html';
        return slug;
    }

    function checkDuplicateSlug() {
        if (state.editingItem) {
            duplicateNotice.classList.add('hidden');
            return;
        }
        const slugVal = normalizeSlug(fieldSlug.value);
        const exists = state.pages.some((p) => p.slug === slugVal);
        if (slugVal && exists) {
            duplicateSlugLabel.textContent = slugVal;
            duplicateNotice.classList.remove('hidden');
        } else {
            duplicateNotice.classList.add('hidden');
        }
    }

    function makeUniqueSlug(baseSlug) {
        const existing = new Set(state.pages.map((p) => p.slug));
        if (!existing.has(baseSlug)) return baseSlug;
        const extMatch = baseSlug.match(/(\.html?)$/i);
        const ext = extMatch ? extMatch[1] : '.html';
        const stem = extMatch ? baseSlug.slice(0, -ext.length) : baseSlug;
        let idx = 2;
        while (existing.has(`${stem}-${idx}${ext}`)) idx++;
        return `${stem}-${idx}${ext}`;
    }

    async function handleSelectedFile(file) {
        modalError.classList.add('hidden');
        if (!file) return;
        if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
            modalError.textContent = 'HTMLファイル（.html / .htm）を選択してください。';
            modalError.classList.remove('hidden');
            return;
        }
        if (file.size > MAX_FILE_BYTES) {
            modalError.textContent = 'ファイルサイズが大きすぎます（上限 5MB）。';
            modalError.classList.remove('hidden');
            return;
        }

        const text = await file.text();
        state.pendingHtmlContent = text;
        const cleanName = file.name.normalize('NFC');
        fileStatusText.textContent = `選択済み: ${cleanName} (${Math.round(file.size / 1024)} KB)`;

        if (!state.editingItem) {
            fieldSlug.value = cleanName;
            const meta = extractMetadataFromHtmlText(cleanName, text);
            fieldTitle.value = meta.title;
            fieldBadge.value = meta.badge;
            fieldTags.value = meta.tags.join(', ');
            fieldDesc.value = meta.description;
            fieldDate.value = toDateInputValue(new Date().toISOString());
            checkDuplicateSlug();
        }
    }

    function openUploadModal() {
        state.editingItem = null;
        state.pendingHtmlContent = null;
        modalHeading.textContent = '新しいHTMLをアップロード';
        btnSubmitModal.textContent = 'アップロードして公開';
        editorForm.reset();
        fieldSlug.disabled = false;
        fieldDate.value = toDateInputValue(new Date().toISOString());
        fileStatusText.textContent = '最大 5MB まで（タイトルや説明を自動抽出します）';
        duplicateNotice.classList.add('hidden');
        modalError.classList.add('hidden');
        editorModal.classList.remove('hidden');
    }

    function openEditModal(item) {
        state.editingItem = item;
        state.pendingHtmlContent = null;
        modalHeading.textContent = '教材情報を編集';
        btnSubmitModal.textContent = '変更を保存';
        editorForm.reset();
        fieldSlug.value = item.slug;
        fieldSlug.disabled = true;
        fieldTitle.value = item.title || '';
        fieldBadge.value = item.badge || '';
        fieldTags.value = (item.tags || []).join(', ');
        fieldDesc.value = item.description || '';
        fieldDate.value = toDateInputValue(item.published_at);
        fileStatusText.textContent = 'HTMLファイルを差し替える場合のみ新しいファイルを選択してください（任意）';
        duplicateNotice.classList.add('hidden');
        modalError.classList.add('hidden');
        editorModal.classList.remove('hidden');
    }

    function closeModal() {
        editorModal.classList.add('hidden');
    }

    btnOpenUpload.addEventListener('click', openUploadModal);
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    fieldSlug.addEventListener('input', checkDuplicateSlug);

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleSelectedFile(e.target.files[0]));
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-zone-active');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-zone-active'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-zone-active');
        if (e.dataTransfer.files.length > 0) {
            handleSelectedFile(e.dataTransfer.files[0]);
        }
    });

    editorForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        modalError.classList.add('hidden');

        if (!state.isAllowedUploader) {
            modalError.textContent = 'アップロード権限がありません。許可されたGoogleアカウントでログインしてください。';
            modalError.classList.remove('hidden');
            return;
        }

        const title = fieldTitle.value.trim();
        if (!title) {
            modalError.textContent = 'タイトルを入力してください。';
            modalError.classList.remove('hidden');
            return;
        }
        const badge = fieldBadge.value.trim();
        const description = fieldDesc.value.trim();
        const tags = Array.from(new Set(
            fieldTags.value
                .split(/[,、]/)
                .map((t) => t.trim())
                .filter(Boolean)
        ));
        const publishedAt = (
            state.editingItem && fieldDate.value === toDateInputValue(state.editingItem.published_at)
        )
            ? state.editingItem.published_at
            : toIsoFromDateInput(fieldDate.value);

        btnSubmitModal.disabled = true;

        try {
            if (state.editingItem) {
                const payload = {
                    title,
                    badge,
                    description,
                    tags,
                    published_at: publishedAt,
                };
                if (state.pendingHtmlContent) {
                    payload.html_content = state.pendingHtmlContent;
                    payload.file_size = new Blob([state.pendingHtmlContent]).size;
                }
                const { error } = await sb
                    .from('math_pages')
                    .update(payload)
                    .eq('id', state.editingItem.id);
                if (error) throw error;
                showToast('教材を更新しました');
            } else {
                if (!state.pendingHtmlContent) {
                    throw new Error('HTMLファイルを選択してください。');
                }
                let slug = normalizeSlug(fieldSlug.value);
                if (!slug) throw new Error('ファイル名を入力してください。');

                const exists = state.pages.some((p) => p.slug === slug);
                const dupMode = document.querySelector('input[name="dup-mode"]:checked')?.value || 'overwrite';
                const isOverwrite = exists && dupMode === 'overwrite';

                if (exists && dupMode === 'rename') {
                    slug = makeUniqueSlug(slug);
                }

                // uploaded_by は DB トリガー（auth.uid()）で自動強制されるため送信しない（F-04）
                const payload = {
                    slug,
                    title,
                    badge,
                    description,
                    tags,
                    html_content: state.pendingHtmlContent,
                    file_size: new Blob([state.pendingHtmlContent]).size,
                    published_at: publishedAt,
                };

                const { error } = isOverwrite
                    ? await sb.from('math_pages').upsert(payload, { onConflict: 'slug' })
                    : await sb.from('math_pages').insert(payload);
                if (error) throw error;
                showToast(isOverwrite ? '既存教材を上書き更新しました' : '新しい教材をアップロードしました');
            }

            closeModal();
            await loadPages();
        } catch (err) {
            modalError.textContent = err.message || '保存中にエラーが発生しました。';
            modalError.classList.remove('hidden');
        } finally {
            btnSubmitModal.disabled = false;
        }
    });

    async function deletePage(item) {
        if (!state.isAllowedUploader) return;
        if (!window.confirm(`「${item.title}」（${item.slug}）を削除しますか？この操作は取り消せません。`)) {
            return;
        }
        const { error } = await sb.from('math_pages').delete().eq('id', item.id);
        if (error) {
            showToast(`削除に失敗しました: ${error.message}`);
            return;
        }
        showToast('教材を削除しました');
        await loadPages();
    }

    // Initialize
    loadPages();
})();
