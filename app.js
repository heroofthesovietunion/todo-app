// ── 자동 분류 키워드 맵 ───────────────────────────────────
const KEYWORD_MAP = {
  work:     ['회의', '보고서', '프레젠테이션', '발표', '메일', '이메일', '미팅', '업무', '기획', '제안서',
             '계약', '고객', '출장', '면접', '채용', '마감', '프로젝트', '직장', '회사', '결재', '승인',
             '야근', '거래처', '팀장', '상사', '동료'],
  personal: ['운동', '헬스', '산책', '여행', '쇼핑', '청소', '빨래', '요리', '병원', '약속', '친구',
             '가족', '부모님', '취미', '영화', '드라마', '게임', '휴식', '장보기', '집안일', '약 먹기'],
  study:    ['공부', '학습', '강의', '수업', '시험', '과제', '레포트', '논문', '연구', '스터디',
             '코딩', '프로그래밍', '알고리즘', '영어', '어학', '자격증', '복습', '예습', '강좌', '튜토리얼'],
};

function detectCategory(text) {
  for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some(kw => text.includes(kw))) return category;
  }
  return null;
}

// ── Supabase ──────────────────────────────────────────────
const SUPABASE_URL = 'https://cbwozkdejrpjpjptswax.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNid296a2RlanJwanBqcHRzd2F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1MTUwNTgsImV4cCI6MjA5NTA5MTA1OH0.q9Uioy635AKVXFv3zoiofDDdmXsVzwcU_8bJvqFYgYU';
const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function rowToTodo(row) {
  return {
    id: row.id,
    text: row.text,
    category: row.category ?? 'work',
    priority: row.priority ?? 'medium',
    starred: row.starred ?? false,
    completed: row.completed ?? false,
    createdAt: row.created_at,
  };
}

// ── Settings (localStorage) ───────────────────────────────
const SETTINGS_KEY = 'todo-app-settings';

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : { categoryOrder: ['work', 'personal', 'study'] };
  } catch { return { categoryOrder: ['work', 'personal', 'study'] }; }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ── State ─────────────────────────────────────────────────
let todos = [];
let currentFilter = 'all';
let lastAddedId = null;
let wasAllCompleted = false;
let settings = loadSettings();
let searchQuery = '';
let reorderTimer = null;

// ── Toast ─────────────────────────────────────────────────
function showToast(message, options = {}) {
  const { actionLabel, onAction, duration = 2000 } = options;

  const existing = document.getElementById('app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-message';
  msgSpan.textContent = message;
  toast.appendChild(msgSpan);

  let hideTimer = null;
  let removed = false;

  const dismiss = () => {
    if (removed) return;
    removed = true;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  };

  if (actionLabel && typeof onAction === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.addEventListener('click', () => {
      try { onAction(); } finally { dismiss(); }
    });
    toast.appendChild(btn);
  }

  document.body.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add('toast-visible');

  hideTimer = setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => { if (toast.isConnected) toast.remove(); }, 300);
  }, duration);
}

// ── Validation ────────────────────────────────────────────
function validateText(text, excludeId = null) {
  const trimmed = text.trim();
  const hasNoAlphanumeric = !/[\w가-힣]/.test(trimmed);
  if (trimmed.length < 2 || hasNoAlphanumeric || /([^\w가-힣\s])\1{2,}/.test(trimmed)) {
    showToast('등록이 불가한 이름입니다.');
    return false;
  }
  if (trimmed.length > 200) {
    showToast('할 일은 200자 이내로 입력해주세요.');
    return false;
  }
  const isDuplicate = todos.some(t =>
    t.text.toLowerCase() === trimmed.toLowerCase() && t.id !== excludeId
  );
  if (isDuplicate) {
    showToast('이미 등록된 할 일입니다.');
    return false;
  }
  return true;
}

// ── CRUD ──────────────────────────────────────────────────
async function addTodo(text, category, priority = 'medium') {
  if (!validateText(text)) return false;
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  const todo = { id, text, category, priority, starred: false, completed: false, createdAt: now };

  // 낙관적 업데이트: UI 먼저 반영
  todos.push(todo);
  lastAddedId = id;
  renderAll();
  const newEl = document.querySelector(`li[data-id="${id}"]`);
  newEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const { error } = await db.from('todo').insert({
    id, text, category, priority,
    starred: false, completed: false,
    created_at: now,
  });
  if (error) {
    todos = todos.filter(t => t.id !== id);
    renderAll();
    showToast('저장에 실패했습니다.');
    return false;
  }
  return true;
}

async function toggleTodo(id) {
  const item = todos.find(t => t.id === id);
  if (!item) return;
  item.completed = !item.completed;

  const li = document.querySelector(`li[data-id="${id}"]`);
  if (li) {
    li.classList.toggle('completed', item.completed);

    li.querySelectorAll('.complete-feedback').forEach(el => el.remove());

    if (item.completed) {
      li.classList.add('complete-flash');
      const feedback = document.createElement('span');
      feedback.className = 'complete-feedback';
      feedback.setAttribute('role', 'status');
      feedback.dataset.forId = id;
      feedback.textContent = '✓ 완료';
      li.appendChild(feedback);
      setTimeout(() => {
        if (li.isConnected) {
          feedback.remove();
          li.classList.remove('complete-flash');
        }
      }, 1000);
    }

    if (item.completed) {
      if (reorderTimer) clearTimeout(reorderTimer);
      reorderTimer = setTimeout(() => {
        reorderTimer = null;
        renderTodoList();
      }, 1000);
    } else {
      if (reorderTimer) clearTimeout(reorderTimer);
      reorderTimer = null;
      updateClearButton();
      renderTodoList();
    }
  } else {
    renderTodoList();
  }
  renderProgress();
  updateClearButton();
  updateCompleteAllButton();

  const { error } = await db.from('todo').update({ completed: item.completed }).eq('id', id);
  if (error) {
    item.completed = !item.completed;
    renderAll();
    showToast('저장에 실패했습니다.');
  }
}

async function deleteTodo(id) {
  const index = todos.findIndex(t => t.id === id);
  if (index === -1) return;
  const removed = todos[index];

  todos = todos.filter(t => t.id !== id);
  renderAll();

  const { error } = await db.from('todo').delete().eq('id', id);
  if (error) {
    todos.splice(index, 0, removed);
    renderAll();
    showToast('삭제에 실패했습니다.');
    return;
  }

  showToast('삭제됨', {
    actionLabel: '실행 취소',
    duration: 4000,
    onAction: async () => {
      if (todos.some(t => t.id === removed.id)) return;
      const { error: insertError } = await db.from('todo').insert({
        id: removed.id,
        text: removed.text,
        category: removed.category,
        priority: removed.priority,
        starred: removed.starred,
        completed: removed.completed,
        created_at: removed.createdAt,
      });
      if (insertError) { showToast('복원에 실패했습니다.'); return; }
      const insertAt = Math.min(index, todos.length);
      todos.splice(insertAt, 0, removed);
      renderAll();
    },
  });
}

async function updateTodo(id, newText, newCategory, newPriority) {
  if (!validateText(newText, id)) return false;
  const item = todos.find(t => t.id === id);
  if (!item) return false;
  const prev = { text: item.text, category: item.category, priority: item.priority };
  item.text = newText;
  item.category = newCategory;
  if (newPriority !== undefined) item.priority = newPriority;
  showToast('수정되었습니다.');
  renderAll();

  const updateData = { text: newText, category: newCategory };
  if (newPriority !== undefined) updateData.priority = newPriority;
  const { error } = await db.from('todo').update(updateData).eq('id', id);
  if (error) {
    item.text = prev.text;
    item.category = prev.category;
    item.priority = prev.priority;
    renderAll();
    showToast('저장에 실패했습니다.');
    return false;
  }
  return true;
}

async function toggleStar(id) {
  const item = todos.find(t => t.id === id);
  if (!item) return;
  item.starred = !item.starred;
  renderAll();

  const { error } = await db.from('todo').update({ starred: item.starred }).eq('id', id);
  if (error) {
    item.starred = !item.starred;
    renderAll();
    showToast('저장에 실패했습니다.');
  }
}

async function clearCompleted() {
  const removed = [];
  todos.forEach((t, i) => { if (t.completed) removed.push({ item: t, index: i }); });
  if (removed.length === 0) return;

  const ids = removed.map(r => r.item.id);
  todos = todos.filter(t => !t.completed);
  renderAll();

  const { error } = await db.from('todo').delete().in('id', ids);
  if (error) {
    removed
      .slice()
      .sort((a, b) => a.index - b.index)
      .forEach(({ item, index }) => {
        const insertAt = Math.min(index, todos.length);
        todos.splice(insertAt, 0, item);
      });
    renderAll();
    showToast('삭제에 실패했습니다.');
    return;
  }

  showToast(`완료 항목 ${removed.length}건 삭제됨`, {
    actionLabel: '실행 취소',
    duration: 4000,
    onAction: async () => {
      const toRestore = removed.filter(r => !todos.some(t => t.id === r.item.id));
      if (toRestore.length === 0) return;
      const { error: insertError } = await db.from('todo').insert(
        toRestore.map(r => ({
          id: r.item.id,
          text: r.item.text,
          category: r.item.category,
          priority: r.item.priority,
          starred: r.item.starred,
          completed: r.item.completed,
          created_at: r.item.createdAt,
        }))
      );
      if (insertError) { showToast('복원에 실패했습니다.'); return; }
      toRestore
        .slice()
        .sort((a, b) => a.index - b.index)
        .forEach(({ item, index }) => {
          const insertAt = Math.min(index, todos.length);
          todos.splice(insertAt, 0, item);
        });
      renderAll();
    },
  });
}

// ── 벌크 헤더 (전체선택 체크박스) ─────────────────────────
function getBulkContext(visible) {
  const list       = visible ?? getSortedAndFilteredTodos();
  const completed  = list.filter(t => t.completed).length;
  const total      = list.length;
  const incomplete = total - completed;
  const state = total === 0 ? 'none' : completed === total ? 'all' : completed > 0 ? 'some' : 'none';
  return { visible: list, total, completed, incomplete, state };
}

function getBulkScopeLabel() {
  if (searchQuery)                   return `"${searchQuery}" 검색 결과`;
  if (currentFilter === 'completed') return '완료';
  if (currentFilter !== 'all')       return `${CATEGORY_LABEL[currentFilter]} 항목`;
  return '전체';
}

function updateBulkHeader(visible) {
  const header = document.getElementById('bulk-header');
  const box    = document.getElementById('bulk-box');
  const label  = document.getElementById('bulk-label');
  if (!header) return;

  if (currentFilter === 'completed') {
    const completedItems = searchQuery
      ? todos.filter(t => t.completed && t.text.toLowerCase().includes(searchQuery.toLowerCase()))
      : todos.filter(t => t.completed);

    if (completedItems.length === 0) { header.hidden = true; return; }

    header.hidden = false;
    header.className = 'state-all';

    const checkWrap = header.querySelector('.bulk-check-wrap');
    checkWrap.setAttribute('role', 'checkbox');
    checkWrap.setAttribute('aria-checked', 'true');
    checkWrap.setAttribute('tabindex', '0');

    box.textContent = '✓';
    label.innerHTML = `<strong>완료</strong> · 전체 완료 (${completedItems.length}건) — 클릭 시 전체 취소`;
    return;
  }

  const { total, completed, state } = getBulkContext(visible);

  if (total === 0) { header.hidden = true; return; }

  header.hidden = false;
  header.className = `state-${state}`;

  const checkWrap = header.querySelector('.bulk-check-wrap');
  checkWrap.setAttribute('role', 'checkbox');
  checkWrap.setAttribute('aria-checked',
    state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'
  );
  checkWrap.setAttribute('tabindex', '0');

  box.textContent = state === 'all' ? '✓' : state === 'some' ? '—' : '';

  const scope = getBulkScopeLabel();
  label.innerHTML = state === 'all'
    ? `<strong>${scope}</strong> · 전체 완료 (${completed}건) — 클릭 시 전체 취소`
    : state === 'some'
    ? `<strong>${scope}</strong> · ${completed} / ${total} 완료 — 클릭 시 나머지 완료`
    : `<strong>${scope}</strong> · 미완료 ${total}건 — 클릭 시 전체 완료`;
}

async function handleBulkCheckbox() {
  if (currentFilter === 'completed') {
    const targets = searchQuery
      ? todos.filter(t => t.completed && t.text.toLowerCase().includes(searchQuery.toLowerCase()))
      : todos.filter(t => t.completed);
    if (targets.length === 0) return;

    const ids = new Set(targets.map(t => t.id));
    const count = targets.length;
    todos = todos.map(t => ids.has(t.id) ? { ...t, completed: false } : t);
    currentFilter = 'all';
    document.querySelectorAll('#filter-tabs button').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'all');
      b.setAttribute('aria-pressed', b.dataset.filter === 'all' ? 'true' : 'false');
    });
    renderAll();

    const { error } = await db.from('todo').update({ completed: false }).in('id', [...ids]);
    if (error) {
      todos = todos.map(t => ids.has(t.id) ? { ...t, completed: true } : t);
      currentFilter = 'completed';
      renderAll();
      showToast('저장에 실패했습니다.');
      return;
    }

    showToast(`${count}건을 완료 취소했습니다`, {
      actionLabel: '실행 취소',
      duration: 4000,
      onAction: async () => {
        todos = todos.map(t => ids.has(t.id) ? { ...t, completed: true } : t);
        renderAll();
        const { error: undoError } = await db.from('todo').update({ completed: true }).in('id', [...ids]);
        if (undoError) {
          todos = todos.map(t => ids.has(t.id) ? { ...t, completed: false } : t);
          renderAll();
          showToast('저장에 실패했습니다.');
        }
      },
    });
    return;
  }

  const { state, visible } = getBulkContext();
  const ids = new Set(visible.map(t => t.id));

  if (state === 'all') {
    const count = visible.length;
    const scopeLabel = getBulkScopeLabel();
    todos = todos.map(t => ids.has(t.id) ? { ...t, completed: false } : t);
    renderAll();

    const { error } = await db.from('todo').update({ completed: false }).in('id', [...ids]);
    if (error) {
      todos = todos.map(t => ids.has(t.id) ? { ...t, completed: true } : t);
      renderAll();
      showToast('저장에 실패했습니다.');
      return;
    }

    showToast(`${scopeLabel} ${count}건 완료 취소`, {
      actionLabel: '실행 취소',
      duration: 4000,
      onAction: async () => {
        todos = todos.map(t => ids.has(t.id) ? { ...t, completed: true } : t);
        renderAll();
        const { error: undoError } = await db.from('todo').update({ completed: true }).in('id', [...ids]);
        if (undoError) {
          todos = todos.map(t => ids.has(t.id) ? { ...t, completed: false } : t);
          renderAll();
          showToast('저장에 실패했습니다.');
        }
      },
    });
  } else {
    const targets = visible.filter(t => !t.completed);
    const targetIds = new Set(targets.map(t => t.id));
    const count = targets.length;
    const scopeLabel = getBulkScopeLabel();
    todos = todos.map(t => targetIds.has(t.id) ? { ...t, completed: true } : t);
    renderAll();

    const { error } = await db.from('todo').update({ completed: true }).in('id', [...targetIds]);
    if (error) {
      todos = todos.map(t => targetIds.has(t.id) ? { ...t, completed: false } : t);
      renderAll();
      showToast('저장에 실패했습니다.');
      return;
    }

    showToast(`${scopeLabel} ${count}건 완료 처리`, {
      actionLabel: '실행 취소',
      duration: 4000,
      onAction: async () => {
        todos = todos.map(t => targetIds.has(t.id) ? { ...t, completed: false } : t);
        renderAll();
        const { error: undoError } = await db.from('todo').update({ completed: false }).in('id', [...targetIds]);
        if (undoError) {
          todos = todos.map(t => targetIds.has(t.id) ? { ...t, completed: true } : t);
          renderAll();
          showToast('저장에 실패했습니다.');
        }
      },
    });
  }
}

// updateCompleteAllButton → updateBulkHeader 로 통합 (renderAll에서 호출)
function updateCompleteAllButton(visible) { updateBulkHeader(visible); }

// ── Sort & Filter ─────────────────────────────────────────
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function getSortedAndFilteredTodos() {
  let result = [...todos];

  if (currentFilter === 'completed') {
    result = result.filter(t => t.completed);
    if (searchQuery) {
      result = result.filter(t => t.text.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return result;
  }

  if (currentFilter !== 'all') {
    result = result.filter(t => t.category === currentFilter);
  }

  result = result.filter(t => !t.completed);

  if (searchQuery) {
    result = result.filter(t => t.text.toLowerCase().includes(searchQuery.toLowerCase()));
  }

  result.sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    if (a.priority !== b.priority)
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    const order = settings.categoryOrder;
    return order.indexOf(a.category) - order.indexOf(b.category);
  });

  return result;
}

// ── Helpers ───────────────────────────────────────────────
const CATEGORY_LABEL = { work: '업무', personal: '개인', study: '공부' };
const PRIORITY_LABEL = { high: '중요', medium: '보통', low: '낮음' };

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Render ────────────────────────────────────────────────
function renderTodoList(visible) {
  const filtered = visible ?? getSortedAndFilteredTodos();
  const list = document.getElementById('todo-list');

  if (filtered.length === 0) {
    const msg = currentFilter === 'completed'
      ? '완료된 할 일이 없습니다.'
      : searchQuery ? '검색 결과가 없습니다.' : '등록된 할 일이 없습니다.';
    list.innerHTML = `<li id="empty-state">${msg}</li>`;
    return;
  }

  list.innerHTML = filtered.map(todo => {
    const classes = [];
    if (todo.completed)          classes.push('completed');
    if (todo.starred)            classes.push('starred');
    if (todo.id === lastAddedId) classes.push('new-item');
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';

    const priority = todo.priority ?? 'medium';
    return `
      <li data-id="${todo.id}" data-category="${todo.category}"${classAttr}>
        <input type="checkbox" class="todo-checkbox" id="chk-${todo.id}"${todo.completed ? ' checked' : ''}>
        <label class="todo-checkbox-label" for="chk-${todo.id}" aria-label="완료 토글"></label>
        <button class="btn-star" type="button"
          aria-label="${todo.starred ? '중요 표시 해제' : '중요 표시'}"
          aria-pressed="${todo.starred}">${todo.starred ? '⭐' : '☆'}</button>
        <span class="todo-text">${escapeHtml(todo.text)}</span>
        <input type="text" class="edit-input" value="${escapeHtml(todo.text)}" aria-label="할 일 수정">
        <span class="priority-badge priority-${priority}">${PRIORITY_LABEL[priority]}</span>
        <span class="category-badge category-${todo.category}" data-category="${todo.category}">${CATEGORY_LABEL[todo.category]}</span>
        <select class="edit-priority-select" aria-label="우선순위 수정">
          <option value="high"${priority === 'high' ? ' selected' : ''}>중요</option>
          <option value="medium"${priority === 'medium' ? ' selected' : ''}>보통</option>
          <option value="low"${priority === 'low' ? ' selected' : ''}>낮음</option>
        </select>
        <select class="edit-select" aria-label="카테고리 수정">
          <option value="work"${todo.category === 'work' ? ' selected' : ''}>업무</option>
          <option value="personal"${todo.category === 'personal' ? ' selected' : ''}>개인</option>
          <option value="study"${todo.category === 'study' ? ' selected' : ''}>공부</option>
        </select>
        <div class="todo-actions">
          <button class="edit-btn"    type="button" aria-label="할 일 수정">수정</button>
          <button class="delete-btn"  type="button" aria-label="할 일 삭제">삭제</button>
        </div>
      </li>
    `;
  }).join('');

  lastAddedId = null;
}

function renderProgress() {
  const total = todos.length;
  let completed = 0;
  const cats = {
    work:     { total: 0, done: 0 },
    personal: { total: 0, done: 0 },
    study:    { total: 0, done: 0 },
  };
  for (const t of todos) {
    if (t.completed) completed++;
    const c = cats[t.category];
    if (!c) continue;
    c.total++;
    if (t.completed) c.done++;
  }
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  const allDone = total > 0 && completed === total;

  const label = document.getElementById('progress-label');
  label.textContent = allDone
    ? '🎉 모든 할 일을 완료했습니다!'
    : `${completed} / ${total} 완료 (${percent}%)`;

  const overallBar = document.querySelector('#overall-progress [role="progressbar"]');
  overallBar.style.width = percent + '%';
  overallBar.setAttribute('aria-valuenow', percent);

  for (const cat of ['work', 'personal', 'study']) {
    const { total: catTotal, done: catDone } = cats[cat];
    const catPct = catTotal === 0 ? 0 : Math.round((catDone / catTotal) * 100);

    const track = document.querySelector(`.mini-progress[data-category="${cat}"] [role="progressbar"]`);
    track.setAttribute('aria-valuenow', catPct);

    let bar = track.querySelector('.bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'bar';
      track.appendChild(bar);
    }
    bar.style.width = catPct + '%';
  }

  if (allDone && !wasAllCompleted) {
    document.body.classList.remove('celebration-flash');
    void document.body.offsetWidth;
    document.body.classList.add('celebration-flash');
    setTimeout(() => document.body.classList.remove('celebration-flash'), 900);
  }
  wasAllCompleted = allDone;
}

function updateClearButton() {
  const completedCount = todos.filter(t => t.completed).length;

  const clearBtn = document.getElementById('clear-completed-btn');
  if (clearBtn) clearBtn.classList.toggle('visible', currentFilter === 'completed' && completedCount > 0);

  const countEl = document.getElementById('completed-count');
  if (countEl) countEl.textContent = completedCount > 0 ? completedCount : '';

  const tabCompleted = document.getElementById('tab-completed');
  if (tabCompleted) {
    tabCompleted.hidden = completedCount === 0;
    if (completedCount === 0 && currentFilter === 'completed') {
      currentFilter = 'all';
      document.querySelectorAll('#filter-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === 'all');
        b.setAttribute('aria-pressed', b.dataset.filter === 'all' ? 'true' : 'false');
      });
    }
  }
}

function renderAll() {
  const visible = getSortedAndFilteredTodos();
  renderTodoList(visible);
  renderProgress();
  updateClearButton();
  updateBulkHeader(visible);
}

// ── 인라인 편집 헬퍼 ──────────────────────────────────────
function cancelAnyEdit() {
  const editing = document.querySelector('#todo-list li.editing');
  if (!editing) return;
  const item = todos.find(t => t.id === editing.dataset.id);
  editing.classList.remove('editing');
  if (item) editing.querySelector('.edit-input').value = item.text;
  editing.querySelector('.todo-actions').innerHTML = `
    <button class="edit-btn"   type="button" aria-label="할 일 수정">수정</button>
    <button class="delete-btn" type="button" aria-label="할 일 삭제">삭제</button>
  `;
}

function enterEditMode(li) {
  cancelAnyEdit();
  li.classList.add('editing');
  const editInput = li.querySelector('.edit-input');
  editInput.focus();
  editInput.select();
  const todo = todos.find(t => t.id === li.dataset.id);
  li.querySelector('.edit-priority-select').value = todo?.priority ?? 'medium';
  li.querySelector('.todo-actions').innerHTML = `
    <button class="confirm-btn" type="button" aria-label="수정 확인">확인</button>
    <button class="cancel-btn"  type="button" aria-label="수정 취소">취소</button>
  `;
}

async function commitEdit(li) {
  const newText = li.querySelector('.edit-input').value.trim();
  if (!newText) {
    showToast('할 일 내용을 입력해주세요.');
    li.querySelector('.edit-input').focus();
    return;
  }
  const newCategory = li.querySelector('.edit-select').value;
  const newPriority = li.querySelector('.edit-priority-select')?.value ?? 'medium';
  await updateTodo(li.dataset.id, newText, newCategory, newPriority);
}

// ── 설정 ─────────────────────────────────────────────────
function applySettings(newOrder) {
  settings.categoryOrder = newOrder;
  saveSettings(settings);
  renderAll();
}

// ── 이벤트 연결 ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Supabase에서 초기 데이터 로드
  const { data, error: fetchError } = await db
    .from('todo')
    .select('*')
    .order('created_at', { ascending: true });
  if (fetchError) {
    showToast('데이터를 불러오는 데 실패했습니다.');
    todos = [];
  } else {
    todos = (data ?? []).map(rowToTodo);
  }

  // 헤더 날짜 삽입
  const dateEl = document.createElement('span');
  dateEl.id = 'header-date';
  dateEl.textContent = new Date().toLocaleDateString('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
  document.querySelector('header').appendChild(dateEl);

  // 설정 패널
  document.getElementById('btn-settings').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      settings.categoryOrder.forEach((cat, i) => {
        document.getElementById('order-' + (i + 1)).value = cat;
      });
    }
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-panel').hidden = true;
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const newOrder = [
      document.getElementById('order-1').value,
      document.getElementById('order-2').value,
      document.getElementById('order-3').value,
    ];
    if (new Set(newOrder).size !== 3) {
      showToast('카테고리 순서가 중복되었습니다.');
      return;
    }
    applySettings(newOrder);
    document.getElementById('settings-panel').hidden = true;
  });

  // 할 일 추가
  const input    = document.getElementById('todo-input');
  const select   = document.getElementById('category-select');
  const autoHint = document.getElementById('auto-hint');
  let manualOverride = false;

  input.addEventListener('input', () => {
    if (!input.value.trim()) {
      manualOverride = false;
      autoHint.textContent = '';
      return;
    }
    if (manualOverride) return;
    const detected = detectCategory(input.value);
    if (detected) {
      select.value = detected;
      autoHint.textContent = `자동 분류: ${CATEGORY_LABEL[detected]} — 직접 변경하려면 카테고리를 선택하세요`;
    } else {
      autoHint.textContent = '';
    }
  });

  select.addEventListener('change', () => {
    manualOverride = true;
    autoHint.textContent = '';
  });

  async function handleAdd() {
    const text = input.value.trim();
    if (!text) {
      showToast('등록이 불가한 이름입니다.');
      input.focus();
      return;
    }
    const priority = document.getElementById('input-priority')?.value ?? 'medium';
    if (!(await addTodo(text, select.value, priority))) return;
    input.value = '';
    manualOverride = false;
    autoHint.textContent = '';
    input.focus();
  }

  document.getElementById('add-btn').addEventListener('click', () => handleAdd());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });

  input.focus();

  let searchTimer = null;
  document.getElementById('input-search').addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      renderTodoList();
      updateCompleteAllButton();
    }, 120);
  });

  // 필터 탭
  document.querySelectorAll('#filter-tabs button').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.classList.contains('active') ? 'true' : 'false');
  });

  document.getElementById('filter-tabs').addEventListener('click', e => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn) return;
    cancelAnyEdit();
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('#filter-tabs button').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-pressed', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-pressed', 'true');
    renderAll();
  });

  // 할 일 목록 — 이벤트 위임
  const list = document.getElementById('todo-list');

  list.addEventListener('change', e => {
    if (e.target.classList.contains('todo-checkbox')) {
      toggleTodo(e.target.closest('li').dataset.id);
    }
  });

  list.addEventListener('click', async e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;

    if (e.target.closest('.btn-star')) { await toggleStar(e.target.closest('[data-id]').dataset.id); return; }
    if (e.target.classList.contains('delete-btn'))  { await deleteTodo(li.dataset.id);   return; }
    if (e.target.classList.contains('edit-btn'))    { enterEditMode(li);                  return; }
    if (e.target.classList.contains('confirm-btn')) { await commitEdit(li);               return; }
    if (e.target.classList.contains('cancel-btn'))  { cancelAnyEdit();                    return; }
  });

  list.addEventListener('keydown', async e => {
    const li = e.target.closest('li[data-id]');
    if (!li || !e.target.classList.contains('edit-input')) return;
    if (e.key === 'Enter')  await commitEdit(li);
    if (e.key === 'Escape') cancelAnyEdit();
  });

  // 완료 항목 전체 삭제
  document.getElementById('clear-completed-btn')?.addEventListener('click', () => clearCompleted());

  // 벌크 헤더 체크박스
  document.getElementById('bulk-header').addEventListener('click', async e => {
    if (e.target.closest('.bulk-check-wrap') || e.target.closest('#bulk-label')) {
      await handleBulkCheckbox();
    }
  });

  document.getElementById('bulk-header').addEventListener('keydown', async e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.bulk-check-wrap')) {
      e.preventDefault();
      await handleBulkCheckbox();
    }
  });

  renderAll();
});
