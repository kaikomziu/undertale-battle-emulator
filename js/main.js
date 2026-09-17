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
      Player.setPattern(Data.clone(Editor.getPattern()));
    } else {
      Player.onLeave();
      Editor.renderAll();
    }
  }

  function openLibrary() {
    renderTemplateList();
    renderSaveList();
    el.libraryModal.classList.remove('hidden');
  }
  function closeLibrary() { el.libraryModal.classList.add('hidden'); }

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
        copy.name = p.name + 'コピー';
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
      if (!confirm('新規作成します。現在の編集内容は失われます。よろしいですか?')) return;
      Editor.setPattern(Data.newPattern());
      toast('新規パターンを作成しました');
    });

    el.btnLibrary.addEventListener('click', openLibrary);
    el.btnLibraryClose.addEventListener('click', closeLibrary);
    el.libraryModal.addEventListener('click', (e) => { if (e.target === el.libraryModal) closeLibrary(); });

    el.libTabTemplates.addEventListener('click', () => {
      el.libTabTemplates.classList.add('active'); el.libTabSaves.classList.remove('active');
      el.libTemplates.classList.remove('hidden'); el.libSaves.classList.add('hidden');
    });
    el.libTabSaves.addEventListener('click', () => {
      el.libTabSaves.classList.add('active'); el.libTabTemplates.classList.remove('active');
      el.libSaves.classList.remove('hidden'); el.libTemplates.classList.add('hidden');
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
      Sfx.setEnabled(!Sfx.isEnabled());
      el.btnSound.textContent = Sfx.isEnabled() ? '🔊' : '🔇';
      if (Sfx.isEnabled()) Sfx.blip();
    });
  }

  function init() {
    ['tabEditor', 'tabPlay', 'editorView', 'playView', 'toast',
     'libraryModal', 'libTemplates', 'libSaves', 'libTabTemplates', 'libTabSaves', 'btnLibrary', 'btnLibraryClose',
     'btnNew', 'btnSave', 'btnExport', 'btnImport', 'importFile',
     'helpModal', 'btnHelp', 'btnHelpClose', 'btnSound'].forEach(id => el[id] = qs(id));

    Editor.init(Data.TEMPLATES[0].build());
    Player.init();
    bindTop();
  }

  window.addEventListener('DOMContentLoaded', init);

  return { goToEditor, toast };
})();
