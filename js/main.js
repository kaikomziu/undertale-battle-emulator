// ===== アプリ全体の配線 =====
const Main = (() => {
  const el = {};
  function qs(id) { return document.getElementById(id); }

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  function goToEditor() {
    Player.onLeave();
    setMode('editor');
  }

  function setMode(mode) {
    el.tabEditor.classList.toggle('active', mode === 'editor');
    el.tabPlay.classList.toggle('active', mode === 'play');
    el.editorView.classList.toggle('active', mode === 'editor');
    el.playView.classList.toggle('active', mode === 'play');
    if (mode === 'play') {
      Editor.stopPreview();
      Editor.stopBgmPreview();
      Player.setPattern(Data.clone(Editor.getPattern()));
      Player.fitPlayCanvas();
    } else {
      Player.onLeave();
      Editor.renderAll();
      Editor.fitStageCanvas();
    }
  }

  let communityCache = null;

  function openLibrary() {
    renderTemplateList();
    renderSaveList();
    el.libraryModal.classList.remove('hidden');
  }
  function closeLibrary() { el.libraryModal.classList.add('hidden'); }

  function switchLibTab(name) {
    const tabs = { templates: [el.libTabTemplates, el.libTemplates], saves: [el.libTabSaves, el.libSaves], community: [el.libTabCommunity, el.libCommunity] };
    Object.keys(tabs).forEach(k => {
      const [tabBtn, panel] = tabs[k];
      tabBtn.classList.toggle('active', k === name);
      panel.classList.toggle('hidden', k !== name);
    });
    if (name === 'community' && !communityCache) loadCommunityList();
  }

  async function loadCommunityList(force) {
    el.communityStatus.textContent = '読み込み中...';
    el.communityStatus.classList.remove('hidden');
    el.communityList.innerHTML = '';
    try {
      const rows = await Community.fetchLatest(60);
      communityCache = rows;
      renderCommunityList(rows);
    } catch (err) {
      el.communityStatus.textContent = '読み込みに失敗しました(通信環境をご確認ください)';
    }
  }

  function renderCommunityList(rows) {
    if (!rows || rows.length === 0) {
      el.communityStatus.textContent = 'まだ誰も公開していません。最初の投稿者になろう!';
      el.communityStatus.classList.remove('hidden');
      el.communityList.innerHTML = '';
      return;
    }
    el.communityStatus.classList.add('hidden');
    el.communityList.innerHTML = '';
    rows.forEach(row => {
      const div = document.createElement('div');
      div.className = 'libRow communityRow';
      const date = new Date(row.created_at).toLocaleString('ja-JP');
      const authorHtml = row.author ? `<span class="libAuthor">by ${escapeHtml(row.author)}</span>` : '';
      div.innerHTML = `<div class="libInfo"><b>${escapeHtml(row.name)}</b>${authorHtml}<span>公開: ${date}</span></div>
        <button class="tbtn primary" data-act="load">開く</button>`;
      div.querySelector('[data-act=load]').addEventListener('click', () => {
        if (!confirm('現在編集中の内容は失われます。読み込みますか?')) return;
        const p = Data.clone(row.pattern);
        p.id = Data.uid('pat');
        Editor.setPattern(p);
        closeLibrary();
        toast('読み込みました');
      });
      el.communityList.appendChild(div);
    });
  }

  function openPublishModal() {
    const p = Editor.getPattern();
    el.publishPatternName.textContent = p.name;
    el.publishAuthor.value = Community.getAuthorName();
    el.publishModal.classList.remove('hidden');
  }
  function closePublishModal() { el.publishModal.classList.add('hidden'); }

  function renderTemplateList() {
    el.libTemplates.innerHTML = '';
    Data.TEMPLATES.forEach(t => {
      const row = document.createElement('div');
      row.className = 'libRow';
      row.innerHTML = `<div class="libInfo"><b>${t.label}</b><span>${t.desc}</span></div><button class="tbtn primary">開く</button>`;
      row.querySelector('button').addEventListener('click', () => {
        if (!confirm('現在編集中の内容は失われます。テンプレートを読み込みますか?')) return;
        Editor.setPattern(t.build());
        closeLibrary();
        toast('テンプレートを読み込みました');
      });
      el.libTemplates.appendChild(row);
    });
  }

  function renderSaveList() {
    const saves = Data.listSaves();
    if (saves.length === 0) {
      el.libSaves.innerHTML = '<p class="libEmpty">保存済みのパターンはまだありません。</p>';
      return;
    }
    el.libSaves.innerHTML = '';
    saves.forEach(p => {
      const row = document.createElement('div');
      row.className = 'libRow';
      const date = new Date(p.updatedAt).toLocaleString('ja-JP');
      row.innerHTML = `<div class="libInfo"><b>${escapeHtml(p.name)}</b><span>更新: ${date}</span></div>
        <button class="tbtn primary" data-act="load">開く</button>
        <button class="tbtn" data-act="dup">複製</button>
        <button class="tbtn danger" data-act="del">削除</button>`;
      row.querySelector('[data-act=load]').addEventListener('click', () => {
        if (!confirm('現在編集中の内容は失われます。読み込みますか?')) return;
        Editor.setPattern(Data.clone(p));
        closeLibrary();
        toast('読み込みました');
      });
      row.querySelector('[data-act=dup]').addEventListener('click', () => {
        const copy = Data.clone(p);
        copy.id = Data.uid('pat');
        copy.name = Data.dupName(p.name, 'コピー');
        Data.savePattern(copy);
        renderSaveList();
        toast('複製しました');
      });
      row.querySelector('[data-act=del]').addEventListener('click', () => {
        if (!confirm(`「${p.name}」を削除しますか?`)) return;
        Data.deleteSave(p.id);
        renderSaveList();
      });
      el.libSaves.appendChild(row);
    });
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function bindTop() {
    el.tabEditor.addEventListener('click', () => setMode('editor'));
    el.tabPlay.addEventListener('click', () => setMode('play'));

    el.btnNew.addEventListener('click', () => {
      if (!confirm('新規作成します。現在の編集内容は失われます(保存済みのものは残ります)。よろしいですか?')) return;
      Editor.setPattern(Data.newPattern());
      toast('新規パターンを作成しました');
    });

    el.btnDupPattern.addEventListener('click', () => {
      const original = Editor.getPattern();
      Data.savePattern(original);
      const copy = Data.clone(original);
      copy.id = Data.uid('pat');
      copy.name = Data.dupName(copy.name, 'コピー');
      Editor.setPattern(copy);
      toast(`「${original.name}」を保存し、「${copy.name}」の編集を開始しました`);
    });

    el.btnLibrary.addEventListener('click', openLibrary);
    el.btnLibraryClose.addEventListener('click', closeLibrary);
    el.libraryModal.addEventListener('click', (e) => { if (e.target === el.libraryModal) closeLibrary(); });

    el.libTabTemplates.addEventListener('click', () => switchLibTab('templates'));
    el.libTabSaves.addEventListener('click', () => switchLibTab('saves'));
    el.libTabCommunity.addEventListener('click', () => switchLibTab('community'));

    el.btnPublish.addEventListener('click', openPublishModal);
    el.btnPublishClose.addEventListener('click', closePublishModal);
    el.publishModal.addEventListener('click', (e) => { if (e.target === el.publishModal) closePublishModal(); });
    el.btnPublishConfirm.addEventListener('click', async () => {
      const p = Editor.getPattern();
      const author = el.publishAuthor.value.trim();
      Community.setAuthorName(author);
      el.btnPublishConfirm.disabled = true;
      el.btnPublishConfirm.textContent = '公開中...';
      try {
        await Community.publish(p, author);
        closePublishModal();
        communityCache = null;
        toast(`「${p.name}」を公開しました`);
      } catch (err) {
        toast(err && err.message === 'too_large' ? 'データが大きすぎて公開できません' : '公開に失敗しました(通信環境をご確認ください)');
      }
      el.btnPublishConfirm.disabled = false;
      el.btnPublishConfirm.textContent = 'この内容で公開する';
    });

    el.btnSave.addEventListener('click', () => {
      const p = Editor.getPattern();
      const ok = Data.savePattern(p);
      toast(ok ? `「${p.name}」を保存しました` : '保存に失敗しました');
    });

    el.btnExport.addEventListener('click', () => {
      Data.exportPattern(Editor.getPattern());
      toast('JSONを書き出しました');
    });

    el.btnImport.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const p = await Data.importPatternFile(file);
        Editor.setPattern(p);
        toast('読み込みました');
      } catch (err) {
        toast('読み込みに失敗しました(形式が正しくありません)');
      }
      el.importFile.value = '';
    });

    el.btnHelp.addEventListener('click', () => el.helpModal.classList.remove('hidden'));
    el.btnHelpClose.addEventListener('click', () => el.helpModal.classList.add('hidden'));
    el.helpModal.addEventListener('click', (e) => { if (e.target === el.helpModal) el.helpModal.classList.add('hidden'); });

    el.btnSound.textContent = Sfx.isEnabled() ? '🔊' : '🔇';
    el.btnSound.addEventListener('click', () => {
      const next = !Sfx.isEnabled();
      Sfx.setEnabled(next);
      Bgm.setEnabled(next);
      el.btnSound.textContent = next ? '🔊' : '🔇';
      if (next) Sfx.blip();
    });
  }

  function init() {
    ['tabEditor', 'tabPlay', 'editorView', 'playView', 'toast',
     'libraryModal', 'libTemplates', 'libSaves', 'libTabTemplates', 'libTabSaves', 'btnLibrary', 'btnLibraryClose',
     'libTabCommunity', 'libCommunity', 'communityStatus', 'communityList',
     'publishModal', 'publishPatternName', 'publishAuthor', 'btnPublish', 'btnPublishClose', 'btnPublishConfirm',
     'btnNew', 'btnDupPattern', 'btnSave', 'btnExport', 'btnImport', 'importFile',
     'helpModal', 'btnHelp', 'btnHelpClose', 'btnSound'].forEach(id => el[id] = qs(id));

    Editor.init(Data.TEMPLATES[0].build());
    Player.init();
    bindTop();
  }

  window.addEventListener('DOMContentLoaded', init);

  return { goToEditor, toast };
})();
