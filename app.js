'use strict';

(function () {
  var STORE_KEY = 'ce_state_v1';
  var DB_NAME = 'content-engine';
  var DB_VERSION = 1;
  var STORE_AUDIO = 'audio';

  var CHANNELS = [
    { id: 'web', label: 'Web' },
    { id: 'bluesky', label: 'Bluesky' },
    { id: 'reddit', label: 'Reddit-človek' }
  ];

  var STATUSES = [
    { id: 'raw', label: 'Surovina' },
    { id: 'draft', label: 'Draft' },
    { id: 'review', label: 'Na korektúru' },
    { id: 'approved', label: 'Schválené' },
    { id: 'published', label: 'Publikované' }
  ];

  var state = { captures: [], drafts: [], archive: [] };
  var db = null;
  var currentDraftId = null;
  var mediaRecorder = null;
  var audioChunks = [];
  var recordingStream = null;
  var recording = false;
  var recordTimer = null;
  var recordStart = 0;
  var audioUrls = {};

  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function nowIso() { return new Date().toISOString(); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString('sk-SK'); } catch (e) { return iso; }
  }
  function shortText(t, n) {
    t = (t || '').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }
  function channelLabel(id) {
    var c = CHANNELS.filter(function (x) { return x.id === id; })[0];
    return c ? c.label : id;
  }
  function statusLabel(id) {
    var s = STATUSES.filter(function (x) { return x.id === id; })[0];
    return s ? s.label : id;
  }
  function statusIdx(id) { return STATUSES.findIndex(function (s) { return s.id === id; }); }
  function nextStatusId(id) { var i = statusIdx(id); return (i >= 0 && i < STATUSES.length - 1) ? STATUSES[i + 1].id : null; }
  function prevStatusId(id) { var i = statusIdx(id); return i > 0 ? STATUSES[i - 1].id : null; }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        state.captures = p.captures || [];
        state.drafts = p.drafts || [];
        state.archive = p.archive || [];
      }
    } catch (e) {}
  }
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Nepodarilo sa uložiť: ' + e.message, true); }
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB nie je k dispozícii')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE_AUDIO)) d.createObjectStore(STORE_AUDIO);
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbPut(id, blob) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_AUDIO, 'readwrite');
      tx.objectStore(STORE_AUDIO).put(blob, id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbGet(id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_AUDIO, 'readonly');
      var r = tx.objectStore(STORE_AUDIO).get(id);
      r.onsuccess = function () { resolve(r.result || null); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function idbDelete(id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_AUDIO, 'readwrite');
      tx.objectStore(STORE_AUDIO).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  }
  function dataUrlToBlob(dataUrl) {
    return fetch(dataUrl).then(function (r) { return r.blob(); });
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    if (isErr) el.classList.add('error'); else el.classList.remove('error');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  function switchView(view) {
    currentView = view;
    $all('.view').forEach(function (v) { v.classList.add('hidden'); });
    $('#view-' + view).classList.remove('hidden');
    $all('.nav-btn').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-view') === view);
    });
    renderAll();
  }
  $all('.nav-btn').forEach(function (b) {
    b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
  });

  $('#capture-save').addEventListener('click', function () {
    var text = $('#capture-text').value.trim();
    if (!text) { toast('Najprv napíš text.'); return; }
    state.captures.unshift({ id: uid(), kind: 'text', text: text, createdAt: nowIso() });
    $('#capture-text').value = '';
    saveState(); renderCaptures(); toast('Poznámka uložená.');
  });

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Toto zariadenie nepodporuje nahrávanie.', true); return; }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recordingStream = stream;
      var mime = '';
      if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].forEach(function (m) {
          if (!mime && MediaRecorder.isTypeSupported(m)) mime = m;
        });
      }
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = function (e) { if (e.data && e.data.size) audioChunks.push(e.data); };
      mediaRecorder.onstop = function () {
        var type = mediaRecorder.mimeType || 'audio/webm';
        var blob = new Blob(audioChunks, { type: type });
        var id = uid();
        idbPut(id, blob).then(function () {
          state.captures.unshift({ id: uid(), kind: 'audio', audioId: id, text: '', title: 'Zvuková nahrávka', createdAt: nowIso() });
          saveState(); renderCaptures(); toast('Nahrávka uložená.');
        }).catch(function (e) { toast('Uloženie nahrávky zlyhalo: ' + e.message, true); });
        if (recordingStream) { recordingStream.getTracks().forEach(function (t) { t.stop(); }); recordingStream = null; }
      };
      mediaRecorder.start();
      recording = true;
      recordStart = Date.now();
      updateRecordButton();
      recordTimer = setInterval(function () {
        var s = Math.floor((Date.now() - recordStart) / 1000);
        $('#record-timer').textContent = Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
      }, 500);
    }).catch(function (e) {
      toast('Prístup k mikrofónu zamietnutý: ' + e.message, true);
    });
  }

  function stopRecording() {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      recording = false;
      clearInterval(recordTimer);
      $('#record-timer').textContent = '0:00';
      updateRecordButton();
    }
  }

  function updateRecordButton() {
    var btn = $('#record-toggle');
    if (recording) { btn.textContent = 'Zastaviť nahrávanie'; btn.classList.add('recording'); }
    else { btn.textContent = 'Spustiť nahrávanie'; btn.classList.remove('recording'); }
  }

  $('#record-toggle').addEventListener('click', function () {
    if (recording) stopRecording(); else startRecording();
  });

  function revokeAudioUrls() {
    Object.keys(audioUrls).forEach(function (k) { try { URL.revokeObjectURL(audioUrls[k]); } catch (e) {} });
    audioUrls = {};
  }

  function renderCaptures() {
    var list = $('#capture-list');
    revokeAudioUrls();
    list.innerHTML = '';
    $('#capture-empty').style.display = state.captures.length ? 'none' : 'block';
    state.captures.forEach(function (c) {
      var li = document.createElement('li');
      li.className = 'item';
      li.setAttribute('data-id', c.id);
      var body = '';
      if (c.kind === 'audio') {
        body = '<div class="item-title">' + esc(c.title || 'Zvuková nahrávka') + '</div>' +
               '<div class="item-meta">' + esc(fmtDate(c.createdAt)) + '</div>' +
               '<div class="audio-slot" data-audio="' + esc(c.audioId) + '">Načítavam nahrávku…</div>';
      } else {
        body = '<div class="item-title">' + esc(shortText(c.text, 80)) + '</div>' +
               '<div class="item-meta">' + esc(fmtDate(c.createdAt)) + '</div>';
      }
      li.innerHTML = body +
        '<div class="item-actions">' +
          '<button class="btn btn-small btn-secondary" data-act="to-draft">→ Draft</button>' +
          '<button class="btn btn-small btn-danger" data-act="delete">Vymazať</button>' +
        '</div>';
      list.appendChild(li);
    });
    state.captures.forEach(function (c) {
      if (c.kind === 'audio' && c.audioId) {
        var slot = list.querySelector('.audio-slot[data-audio="' + c.audioId + '"]');
        if (!slot) return;
        idbGet(c.audioId).then(function (blob) {
          if (!blob) { slot.textContent = 'Nahrávka nenájdená'; return; }
          var url = URL.createObjectURL(blob);
          audioUrls[c.audioId] = url;
          var a = document.createElement('audio');
          a.controls = true; a.src = url; a.setAttribute('playsinline', '');
          slot.innerHTML = ''; slot.appendChild(a);
        }).catch(function () { slot.textContent = 'Chyba načítania'; });
      }
    });
  }

  function deleteCapture(id) {
    var c = state.captures.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var done = function () { state.captures = state.captures.filter(function (x) { return x.id !== id; }); saveState(); renderCaptures(); };
    if (c.kind === 'audio' && c.audioId) { idbDelete(c.audioId).then(done).catch(done); } else done();
  }

  function captureToDraft(id) {
    var c = state.captures.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var title = c.kind === 'text' ? shortText(c.text, 40) : (c.title || 'Zvuková nahrávka');
    var text = c.kind === 'text' ? c.text : '';
    state.drafts.unshift({ id: uid(), title: title, channel: 'web', text: text, status: 'raw', createdAt: nowIso(), updatedAt: nowIso() });
    deleteCapture(id);
    saveState(); renderDrafts(); toast('Presunuté do draftov.');
  }

  $('#capture-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var li = e.target.closest('li[data-id]');
    if (!li) return;
    var id = li.getAttribute('data-id');
    if (btn.getAttribute('data-act') === 'delete') deleteCapture(id);
    else if (btn.getAttribute('data-act') === 'to-draft') captureToDraft(id);
  });

  function renderDrafts() {
    var list = $('#draft-list');
    list.innerHTML = '';
    $('#draft-empty').style.display = state.drafts.length ? 'none' : 'block';
    state.drafts.forEach(function (d) {
      var li = document.createElement('li');
      li.className = 'item draft';
      li.setAttribute('data-id', d.id);
      var next = nextStatusId(d.status);
      var nextLabel = next === 'published' ? 'Publikovať' : ('→ ' + statusLabel(next));
      li.innerHTML =
        '<div class="item-title">' + esc(d.title || '(bez názvu)') + '</div>' +
        '<div class="item-meta">' + esc(channelLabel(d.channel)) + ' · ' + esc(statusLabel(d.status)) + ' · ' + esc(fmtDate(d.updatedAt || d.createdAt)) + '</div>' +
        '<div class="item-snippet">' + esc(shortText(d.text, 120)) + '</div>' +
        '<div class="item-actions">' +
          (next ? '<button class="btn btn-small btn-primary" data-act="advance">' + esc(nextLabel) + '</button>' : '') +
          (prevStatusId(d.status) ? '<button class="btn btn-small btn-secondary" data-act="back">←</button>' : '') +
          '<button class="btn btn-small btn-secondary" data-act="edit">Upraviť</button>' +
          '<button class="btn btn-small btn-danger" data-act="delete">Vymazať</button>' +
        '</div>';
      list.appendChild(li);
    });
  }

  function advanceDraft(id) {
    var d = state.drafts.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    var next = nextStatusId(d.status);
    if (!next) return;
    if (next === 'published') { publishDraft(id); return; }
    d.status = next; d.updatedAt = nowIso();
    saveState(); renderDrafts();
  }
  function backDraft(id) {
    var d = state.drafts.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    var prev = prevStatusId(d.status);
    if (!prev) return;
    d.status = prev; d.updatedAt = nowIso();
    saveState(); renderDrafts();
  }
  function publishDraft(id) {
    var d = state.drafts.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    state.archive.unshift({ id: uid(), title: d.title, channel: d.channel, text: d.text, publishedAt: nowIso() });
    state.drafts = state.drafts.filter(function (x) { return x.id !== id; });
    saveState(); renderDrafts(); renderArchive(); closeModal(); toast('Publikované a presunuté do archívu.');
  }
  function deleteDraft(id) {
    state.drafts = state.drafts.filter(function (x) { return x.id !== id; });
    saveState(); renderDrafts(); closeModal();
  }

  $('#draft-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var li = e.target.closest('li[data-id]');
    if (!li) return;
    var id = li.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    if (act === 'advance') advanceDraft(id);
    else if (act === 'back') backDraft(id);
    else if (act === 'edit') openDraftModal(id);
    else if (act === 'delete') deleteDraft(id);
  });

  function openDraftModal(id) {
    currentDraftId = id;
    var d = state.drafts.filter(function (x) { return x.id === id; })[0];
    if (!d) return;
    $('#modal-title').textContent = 'Upraviť draft';
    var html =
      '<div class="field"><label>Názov</label><input id="m-title" type="text" value="' + esc(d.title) + '"></div>' +
      '<div class="field"><label>Kanál</label><select id="m-channel">' +
        CHANNELS.map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (c.id === d.channel ? ' selected' : '') + '>' + esc(c.label) + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="field"><label>Text</label><textarea id="m-text" rows="6">' + esc(d.text) + '</textarea></div>' +
      '<div class="field"><label>Stav: <strong>' + esc(statusLabel(d.status)) + '</strong></label></div>' +
      '<div class="status-flow">' +
        STATUSES.map(function (s, i) {
          var active = s.id === d.status ? ' is-on' : '';
          var reachable = i >= statusIdx(d.status) ? '' : ' is-off';
          return '<span class="status-dot' + active + reachable + '">' + esc(s.label) + '</span>';
        }).join('') +
      '</div>' +
      '<div class="modal-actions">' +
        (prevStatusId(d.status) ? '<button class="btn btn-secondary" id="m-back">← Späť</button>' : '') +
        (nextStatusId(d.status) === 'published' ? '<button class="btn btn-primary" id="m-publish">Publikovať</button>' : (nextStatusId(d.status) ? '<button class="btn btn-primary" id="m-advance">→ ' + esc(statusLabel(nextStatusId(d.status))) + '</button>' : '')) +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-secondary" id="m-delete">Vymazať</button>' +
        '<button class="btn btn-primary" id="m-save">Uložiť</button>' +
      '</div>';
    $('#modal-body').innerHTML = html;
    openModal();
    $('#m-save').addEventListener('click', saveDraftFromModal);
    $('#m-delete').addEventListener('click', function () { deleteDraft(currentDraftId); });
    var adv = $('#m-advance'); if (adv) adv.addEventListener('click', function () { advanceDraft(currentDraftId); openDraftModal(currentDraftId); });
    var pub = $('#m-publish'); if (pub) pub.addEventListener('click', function () { publishDraft(currentDraftId); });
    var bck = $('#m-back'); if (bck) bck.addEventListener('click', function () { backDraft(currentDraftId); openDraftModal(currentDraftId); });
  }

  function saveDraftFromModal() {
    var d = state.drafts.filter(function (x) { return x.id === currentDraftId; })[0];
    if (!d) return;
    d.title = $('#m-title').value.trim();
    d.channel = $('#m-channel').value;
    d.text = $('#m-text').value;
    d.updatedAt = nowIso();
    saveState(); renderDrafts(); closeModal(); toast('Draft uložený.');
  }

  function renderArchive() {
    var list = $('#archive-list');
    list.innerHTML = '';
    $('#archive-empty').style.display = state.archive.length ? 'none' : 'block';
    state.archive.forEach(function (a) {
      var li = document.createElement('li');
      li.className = 'item';
      li.setAttribute('data-id', a.id);
      li.innerHTML =
        '<div class="item-title">' + esc(a.title || '(bez názvu)') + '</div>' +
        '<div class="item-meta">' + esc(channelLabel(a.channel)) + ' · ' + esc(fmtDate(a.publishedAt)) + '</div>' +
        '<div class="item-actions">' +
          '<button class="btn btn-small btn-secondary" data-act="view">Zobraziť</button>' +
          '<button class="btn btn-small btn-secondary" data-act="copy">Kopírovať</button>' +
          '<button class="btn btn-small btn-danger" data-act="delete">Vymazať</button>' +
        '</div>';
      list.appendChild(li);
    });
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { toast('Skopírované.'); }, function () { fallbackCopy(t); });
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Skopírované.'); } catch (e) { toast('Kopírovanie zlyhalo.', true); }
    document.body.removeChild(ta);
  }

  $('#archive-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var li = e.target.closest('li[data-id]');
    if (!li) return;
    var id = li.getAttribute('data-id');
    var a = state.archive.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    var act = btn.getAttribute('data-act');
    if (act === 'view') openArchiveModal(a);
    else if (act === 'copy') copyText(a.text);
    else if (act === 'delete') { state.archive = state.archive.filter(function (x) { return x.id !== id; }); saveState(); renderArchive(); }
  });

  function openArchiveModal(a) {
    currentDraftId = null;
    $('#modal-title').textContent = a.title || '(bez názvu)';
    $('#modal-body').innerHTML =
      '<div class="item-meta">' + esc(channelLabel(a.channel)) + ' · ' + esc(fmtDate(a.publishedAt)) + '</div>' +
      '<pre class="detail-text">' + esc(a.text) + '</pre>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-primary" id="m-copy">Kopírovať text</button>' +
      '</div>';
    openModal();
    $('#m-copy').addEventListener('click', function () { copyText(a.text); });
  }

  function openModal() { $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); }
  $all('[data-close]').forEach(function (el) { el.addEventListener('click', closeModal); });

  function buildExport() {
    var out = JSON.parse(JSON.stringify(state));
    out.app = 'content-engine';
    out.version = 1;
    out.exportedAt = nowIso();
    var tasks = state.captures.filter(function (c) { return c.kind === 'audio' && c.audioId; })
      .map(function (c) {
        return idbGet(c.audioId).then(function (blob) {
          if (blob) return blobToDataUrl(blob).then(function (du) {
            var e = out.captures.filter(function (x) { return x.id === c.id; })[0];
            if (e) { e.audioDataUrl = du; e.audioMime = blob.type; }
          });
        });
      });
    return Promise.all(tasks).then(function () { return JSON.stringify(out, null, 2); });
  }

  $('#export-btn').addEventListener('click', function () {
    buildExport().then(function (json) {
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'content-engine-export.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Export stiahnutý.');
    }).catch(function (e) { toast('Export zlyhal: ' + e.message, true); });
  });

  $('#export-copy').addEventListener('click', function () {
    buildExport().then(function (json) { copyText(json); })
      .catch(function (e) { toast('Export zlyhal: ' + e.message, true); });
  });

  $('#import-file').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var p = JSON.parse(reader.result);
        if (!p || !Array.isArray(p.captures) || !Array.isArray(p.drafts) || !Array.isArray(p.archive)) {
          toast('Neplatný súbor.', true); return;
        }
        var caps = p.captures;
        var tasks = caps.filter(function (c) { return c.kind === 'audio' && c.audioDataUrl; })
          .map(function (c) {
            return dataUrlToBlob(c.audioDataUrl).then(function (blob) {
              var id = c.audioId || uid();
              c.audioId = id;
              delete c.audioDataUrl; delete c.audioMime;
              return idbPut(id, blob);
            });
          });
        Promise.all(tasks).then(function () {
          state.captures = caps;
          state.drafts = p.drafts;
          state.archive = p.archive;
          saveState(); renderAll(); toast('Import dokončený.');
        }).catch(function (err) { toast('Import zlyhal: ' + err.message, true); });
      } catch (err) { toast('Neplatný JSON: ' + err.message, true); }
    };
    reader.onerror = function () { toast('Čítanie súboru zlyhalo.', true); };
    reader.readAsText(file);
    e.target.value = '';
  });

  function renderAll() {
    renderCaptures();
    renderDrafts();
    renderArchive();
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(function () {
        $('#storage-state').textContent = 'offline ✓';
      }).catch(function () {
        $('#storage-state').textContent = 'lokálne';
      });
    }
  }

  function init() {
    loadState();
    openDb().then(function () {
      renderAll();
    }).catch(function (e) {
      $('#storage-state').textContent = 'bez zvuku';
      renderAll();
    });
    registerSW();
    $('#capture-text').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { $('#capture-save').click(); }
    });
  }

  init();
})();
