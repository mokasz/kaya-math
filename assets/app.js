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
        bulkItems: [],
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
    const singleFields = document.getElementById('single-fields');
    const bulkSection = document.getElementById('bulk-section');
    const bulkSummary = document.getElementById('bulk-summary');
    const bulkDupNotice = document.getElementById('bulk-dup-notice');
    const bulkList = document.getElementById('bulk-list');
    const fieldSlug = document.getElementById('field-slug');
    const fieldDate = document.getElementById('field-date');
    const fieldTitle = document.getElementById('field-title');
    const fieldBadge = document.getElementById('field-badge');
    const fieldTag = document.getElementById('field-tag');
    const tagPresetsEl = document.getElementById('tag-presets');
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
    const naturalJaCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

    function stripNoSuffix(label) {
        return (label || '').replace(/\s*No\.?[0-9０-９]+.*$/i, '').trim();
    }

    function getItemCategory(item) {
        const firstTag = Array.isArray(item.tags) && item.tags[0] ? String(item.tags[0]).trim() : '';
        return firstTag || stripNoSuffix(item.badge);
    }

    function getFilteredPages() {
        const q = state.search.trim().toLowerCase();
        let items = state.pages.filter((p) => {
            if (state.selectedTag !== 'ALL') {
                if (getItemCategory(p) !== state.selectedTag) return false;
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
            items.sort((a, b) => {
                const labelA = (a.badge || getItemCategory(a) || '').normalize('NFKC');
                const labelB = (b.badge || getItemCategory(b) || '').normalize('NFKC');
                const labelCmp = naturalJaCollator.compare(labelA, labelB);
                if (labelCmp !== 0) return labelCmp;
                return naturalJaCollator.compare(
                    (a.title || '').normalize('NFKC'),
                    (b.title || '').normalize('NFKC')
                );
            });
        }
        return items;
    }

    function renderTagFilters() {
        const tagCounts = new Map();
        for (const p of state.pages) {
            const cat = getItemCategory(p);
            if (cat) {
                tagCounts.set(cat, (tagCounts.get(cat) || 0) + 1);
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

                const badgeLabel = item.badge || getItemCategory(item);
                if (badgeLabel) {
                    const badgeSpan = document.createElement('span');
                    badgeSpan.className = 'item-badge';
                    badgeSpan.textContent = badgeLabel;
                    topLine.appendChild(badgeSpan);
                }

                const titleLink = document.createElement('a');
                titleLink.href = `view.html?id=${encodeURIComponent(item.id)}`;
                titleLink.className = 'item-title-link';
                titleLink.textContent = item.title;
                topLine.appendChild(titleLink);

                left.appendChild(topLine);

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
                badgeSpan.textContent = item.badge || getItemCategory(item) || '教材';
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

                const footer = document.createElement('div');
                footer.className = 'card-footer';
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

        let badge = '';
        let tag = '';
        const stem = filename.replace(/\.html?$/i, '').trim();
        const sakuzuMatch = filename.match(/プリント作図問題([0-9０-９]+)(.*)\.html?$/);
        const natsuakeMatch = filename.match(/^(?:natsuake|夏明け)([0-9０-９]+)(.*)\.html?$/i);
        const genericNumMatch = stem.match(/^([^\d０-９]+?)([0-9０-９]+)(.*)$/);

        if (sakuzuMatch) {
            const num = sakuzuMatch[1].replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            badge = `プリント作図 No.${num}${sakuzuMatch[2] || ''}`;
            tag = 'プリント作図';
        } else if (natsuakeMatch) {
            const num = natsuakeMatch[1].replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            badge = `夏明け No.${num}${natsuakeMatch[2] || ''}`;
            tag = '夏明け';
        } else if (filename.includes('作図') || title.includes('作図')) {
            badge = '基本作図';
            tag = '基本作図';
        } else if (genericNumMatch) {
            const prefix = genericNumMatch[1].trim();
            const num = genericNumMatch[2].replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
            badge = `${prefix} No.${num}${genericNumMatch[3] || ''}`;
            tag = prefix;
        } else {
            tag = 'その他';
        }

        const tags = tag ? [tag] : [];
        return { title, badge, description, tags };
    }

    function renderTagPresets() {
        const presetSet = new Set(['プリント作図', '基本作図', '夏明け', '２学期中間']);
        for (const p of state.pages) {
            const cat = getItemCategory(p);
            if (cat) presetSet.add(cat);
        }
        const current = fieldTag.value.trim();
        tagPresetsEl.replaceChildren();
        for (const label of presetSet) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = current === label ? 'badge-preset-btn active' : 'badge-preset-btn';
            btn.textContent = label;
            btn.addEventListener('click', () => {
                fieldTag.value = label;
                if (!fieldBadge.value.trim()) {
                    fieldBadge.value = label;
                }
                renderTagPresets();
            });
            tagPresetsEl.appendChild(btn);
        }
    }

    function normalizeSlug(raw) {
        let slug = raw.trim().normalize('NFC');
        if (slug && !/\.html?$/i.test(slug)) slug += '.html';
        return slug;
    }

    function setEditFieldsMode(isEdit) {
        singleFields.classList.toggle('hidden', !isEdit);
        bulkSection.classList.toggle('hidden', isEdit || state.bulkItems.length === 0);
        fieldSlug.required = isEdit;
        fieldDate.required = isEdit;
        fieldTitle.required = isEdit;
    }

    function renderBulkList() {
        const existingSlugs = new Set(state.pages.map((p) => p.slug));
        const seenBatch = new Set();
        let validCount = 0;
        let dupCount = 0;
        let errCount = 0;

        bulkList.replaceChildren();

        state.bulkItems.forEach((entry, idx) => {
            if (entry.error) {
                errCount++;
            } else {
                const isDup = existingSlugs.has(entry.slug) || seenBatch.has(entry.slug);
                entry.isDuplicate = isDup;
                seenBatch.add(entry.slug);
                validCount++;
                if (isDup) dupCount++;
            }

            const row = document.createElement('div');
            row.className = 'bulk-row';

            const info = document.createElement('div');
            info.className = 'bulk-row-info';

            const titleEl = document.createElement('div');
            titleEl.className = 'bulk-row-title';
            titleEl.textContent = entry.error ? entry.rawName : entry.title;
            info.appendChild(titleEl);

            const metaEl = document.createElement('div');
            metaEl.className = 'bulk-row-meta';
            if (entry.error) {
                const errSpan = document.createElement('span');
                errSpan.textContent = entry.error;
                metaEl.appendChild(errSpan);
            } else {
                const slugSpan = document.createElement('span');
                slugSpan.textContent = `${entry.slug} (${Math.round(entry.fileSize / 1024)} KB)`;
                metaEl.appendChild(slugSpan);
                const labelText = entry.badge || (entry.tags && entry.tags[0]);
                if (labelText) {
                    const badgeSpan = document.createElement('span');
                    badgeSpan.className = 'item-badge';
                    badgeSpan.textContent = labelText;
                    metaEl.appendChild(badgeSpan);
                }
            }
            info.appendChild(metaEl);

            const statusBadge = document.createElement('span');
            if (entry.error) {
                statusBadge.className = 'bulk-status bulk-status-err';
                statusBadge.textContent = '対象外';
            } else if (entry.isDuplicate) {
                statusBadge.className = 'bulk-status bulk-status-dup';
                statusBadge.textContent = '重複あり';
            } else {
                statusBadge.className = 'bulk-status bulk-status-new';
                statusBadge.textContent = '新規';
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'bulk-remove-btn';
            removeBtn.textContent = '除外';
            removeBtn.addEventListener('click', () => {
                state.bulkItems.splice(idx, 1);
                if (state.bulkItems.length === 0) {
                    bulkSection.classList.add('hidden');
                    fileStatusText.textContent = '1ファイルあたり最大 5MB まで（タイトルやタグは自動抽出されます）';
                    btnSubmitModal.textContent = 'アップロードして公開';
                } else {
                    renderBulkList();
                }
            });

            row.appendChild(info);
            row.appendChild(statusBadge);
            row.appendChild(removeBtn);
            bulkList.appendChild(row);
        });

        bulkSection.classList.remove('hidden');
        bulkDupNotice.classList.toggle('hidden', dupCount === 0);
        bulkSummary.textContent = `選択: ${state.bulkItems.length} 件（登録対象 ${validCount} 件${dupCount ? `・重複 ${dupCount} 件` : ''}${errCount ? `・エラー ${errCount} 件` : ''}）`;
        fileStatusText.textContent = `${state.bulkItems.length} 件のファイルを選択中`;
        btnSubmitModal.textContent = validCount === 1
            ? 'アップロードして公開'
            : `${validCount} 件をまとめてアップロード`;
    }

    async function parseHtmlFile(file) {
        const rawName = file.name.normalize('NFC');
        if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
            return { rawName, error: 'HTMLファイル（.html / .htm）ではありません' };
        }
        if (file.size > MAX_FILE_BYTES) {
            return { rawName, error: '5MBの上限を超えています' };
        }
        const htmlContent = await file.text();
        const slug = normalizeSlug(rawName);
        const meta = extractMetadataFromHtmlText(slug, htmlContent);
        return {
            rawName,
            slug,
            htmlContent,
            fileSize: new Blob([htmlContent]).size,
            title: meta.title,
            badge: meta.badge,
            tags: meta.tags,
            description: meta.description,
            error: null,
        };
    }

    async function handleSelectedFiles(fileList) {
        modalError.classList.add('hidden');
        const files = Array.from(fileList || []);
        if (files.length === 0) return;

        if (state.editingItem) {
            const entry = await parseHtmlFile(files[0]);
            if (entry.error) {
                modalError.textContent = `${entry.rawName}: ${entry.error}`;
                modalError.classList.remove('hidden');
                return;
            }
            state.pendingHtmlContent = entry.htmlContent;
            fileStatusText.textContent = `選択済み: ${entry.slug} (${Math.round(entry.fileSize / 1024)} KB)`;
            return;
        }

        const parsed = await Promise.all(files.map(parseHtmlFile));
        state.pendingHtmlContent = null;
        state.bulkItems = parsed;
        setEditFieldsMode(false);
        renderBulkList();
    }

    function openUploadModal() {
        state.editingItem = null;
        state.pendingHtmlContent = null;
        state.bulkItems = [];
        fileInput.multiple = true;
        fileInput.value = '';
        modalHeading.textContent = 'HTMLファイルをアップロード（複数選択可）';
        btnSubmitModal.textContent = 'アップロードして公開';
        editorForm.reset();
        setEditFieldsMode(false);
        fileStatusText.textContent = '1ファイルあたり最大 5MB まで（タイトルやタグは自動抽出されます）';
        modalError.classList.add('hidden');
        editorModal.classList.remove('hidden');
    }

    function openEditModal(item) {
        state.editingItem = item;
        state.pendingHtmlContent = null;
        state.bulkItems = [];
        fileInput.multiple = false;
        fileInput.value = '';
        modalHeading.textContent = '教材情報を編集';
        btnSubmitModal.textContent = '変更を保存';
        editorForm.reset();
        setEditFieldsMode(true);
        fieldSlug.value = item.slug;
        fieldSlug.disabled = true;
        fieldTitle.value = item.title || '';
        fieldBadge.value = item.badge || '';
        fieldTag.value = getItemCategory(item);
        fieldDesc.value = item.description || '';
        fieldDate.value = toDateInputValue(item.published_at);
        fileStatusText.textContent = 'HTMLファイルを差し替える場合のみ新しいファイルを選択してください（任意）';
        renderTagPresets();
        modalError.classList.add('hidden');
        editorModal.classList.remove('hidden');
    }

    function closeModal() {
        editorModal.classList.add('hidden');
    }

    btnOpenUpload.addEventListener('click', openUploadModal);
    document.getElementById('btn-close-modal').addEventListener('click', closeModal);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);
    fieldTag.addEventListener('input', renderTagPresets);

    dropZone.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });
    fileInput.addEventListener('change', (e) => handleSelectedFiles(e.target.files));
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-zone-active');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drop-zone-active'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-zone-active');
        if (e.dataTransfer.files.length > 0) {
            handleSelectedFiles(e.dataTransfer.files);
        }
    });

    async function submitUploadQueue() {
        const validItems = state.bulkItems.filter((item) => !item.error);
        if (validItems.length === 0) {
            throw new Error('アップロードするHTMLファイルを選択してください。');
        }

        const dupMode = document.querySelector('input[name="bulk-dup-mode"]:checked')?.value || 'skip';
        const baseMs = Date.now();
        const usedSlugs = new Set(state.pages.map((p) => p.slug));

        let uploaded = 0;
        let skipped = 0;

        for (let i = 0; i < validItems.length; i++) {
            const item = validItems[i];
            btnSubmitModal.textContent = validItems.length > 1
                ? `アップロード中 (${i + 1} / ${validItems.length})...`
                : 'アップロード中...';

            let targetSlug = item.slug;
            const exists = usedSlugs.has(targetSlug);

            if (exists) {
                if (dupMode === 'skip') {
                    skipped++;
                    continue;
                }
                if (dupMode === 'rename') {
                    const stem = targetSlug.replace(/\.html?$/i, '');
                    const extMatch = targetSlug.match(/(\.html?)$/i);
                    const ext = extMatch ? extMatch[1] : '.html';
                    let n = 2;
                    while (usedSlugs.has(`${stem}-${n}${ext}`)) n++;
                    targetSlug = `${stem}-${n}${ext}`;
                }
            }

            const publishedAt = new Date(baseMs + i).toISOString();
            const payload = {
                slug: targetSlug,
                title: item.title,
                badge: item.badge,
                description: item.description,
                tags: item.tags,
                html_content: item.htmlContent,
                file_size: item.fileSize,
                published_at: publishedAt,
            };

            const isOverwrite = exists && dupMode === 'overwrite';
            const { error } = isOverwrite
                ? await sb.from('math_pages').upsert(payload, { onConflict: 'slug' })
                : await sb.from('math_pages').insert(payload);
            if (error) {
                throw new Error(`${item.slug}: ${error.message}`);
            }

            usedSlugs.add(targetSlug);
            uploaded++;
        }

        closeModal();
        await loadPages();
        if (skipped > 0) {
            showToast(`${uploaded} 件アップロード完了（${skipped} 件スキップ）`);
        } else if (uploaded === 1) {
            showToast('教材をアップロードしました');
        } else {
            showToast(`${uploaded} 件をまとめてアップロードしました`);
        }
    }

    editorForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        modalError.classList.add('hidden');

        if (!state.isAllowedUploader) {
            modalError.textContent = 'アップロード権限がありません。許可されたGoogleアカウントでログインしてください。';
            modalError.classList.remove('hidden');
            return;
        }

        if (!state.editingItem) {
            btnSubmitModal.disabled = true;
            try {
                await submitUploadQueue();
            } catch (err) {
                modalError.textContent = err.message || 'アップロード中にエラーが発生しました。';
                modalError.classList.remove('hidden');
                if (state.bulkItems.length > 0) {
                    renderBulkList();
                }
            } finally {
                btnSubmitModal.disabled = false;
            }
            return;
        }

        const title = fieldTitle.value.trim();
        if (!title) {
            modalError.textContent = 'タイトルを入力してください。';
            modalError.classList.remove('hidden');
            return;
        }
        const tag = fieldTag.value.trim();
        const badge = fieldBadge.value.trim() || tag;
        const description = fieldDesc.value.trim();
        const tags = tag ? [tag] : (stripNoSuffix(badge) ? [stripNoSuffix(badge)] : []);
        const publishedAt = (
            state.editingItem && fieldDate.value === toDateInputValue(state.editingItem.published_at)
        )
            ? state.editingItem.published_at
            : toIsoFromDateInput(fieldDate.value);

        btnSubmitModal.disabled = true;

        try {
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
