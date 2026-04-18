const STORAGE_KEY = "moneybook_todolist_v1";
const THEME_KEY = "moneybook_todolist_theme";

const $ = (sel) => document.querySelector(sel);

function nowIso() {
  return new Date().toISOString();
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJsonParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const data = safeJsonParse(raw, null);
  if (!data || !Array.isArray(data.items)) return { items: [] };

  // normalize
  const items = data.items
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      id: String(x.id ?? uid()),
      title: String(x.title ?? "").slice(0, 120),
      done: Boolean(x.done),
      createdAt: typeof x.createdAt === "string" ? x.createdAt : nowIso(),
      updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : nowIso(),
      order: Number.isFinite(x.order) ? x.order : 0,
      dueDate: isValidYmd(x.dueDate) ? x.dueDate : null,
    }))
    .filter((x) => x.title.trim().length > 0);

  items.sort((a, b) => (a.order - b.order) || (a.createdAt.localeCompare(b.createdAt)));
  items.forEach((it, idx) => (it.order = idx));
  return { items };
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }));
}

function applyTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
}

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file, "utf-8");
  });
}

function clampTitle(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

function isValidYmd(s) {
  if (!s || typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(`${s}T12:00:00`);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function formatDueYmd(ymd) {
  if (!isValidYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

function isOverdue(ymd) {
  if (!isValidYmd(ymd)) return false;
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const due = new Date(`${ymd}T12:00:00`);
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  return dueStart < start;
}

function formatItemMeta(item) {
  const base = `创建：${formatTime(item.createdAt)} · 更新：${formatTime(item.updatedAt)}`;
  if (!item.dueDate || !isValidYmd(item.dueDate)) return base;
  const duePart = formatDueYmd(item.dueDate);
  const overdue = !item.done && isOverdue(item.dueDate);
  return `${base} · 截止：${duePart}${overdue ? "（已逾期）" : ""}`;
}

function createApp() {
  const state = loadState();
  let filter = "all";
  let dragId = null;

  const listEl = $("#list");
  const tpl = $("#itemTpl");
  const inputEl = $("#todoInput");
  const dueDateEl = $("#dueDate");
  const formEl = $("#addForm");
  const summaryEl = $("#summary");
  const clearDoneBtn = $("#clearDoneBtn");
  const themeBtn = $("#themeBtn");
  const exportBtn = $("#exportBtn");
  const importInput = $("#importInput");

  function setFilter(next) {
    filter = next;
    document.querySelectorAll("[data-filter]").forEach((btn) => {
      const on = btn.dataset.filter === next;
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
  }

  function counts() {
    const total = state.items.length;
    const done = state.items.filter((x) => x.done).length;
    const active = total - done;
    return { total, done, active };
  }

  function setSummary() {
    const { total, done, active } = counts();
    summaryEl.textContent =
      total === 0 ? "共 0 项" : `未完成 ${active} · 已完成 ${done} · 共 ${total} 项`;
    clearDoneBtn.disabled = done === 0;
  }

  function filteredItems() {
    if (filter === "active") return state.items.filter((x) => !x.done);
    if (filter === "done") return state.items.filter((x) => x.done);
    return state.items;
  }

  function commit() {
    saveState(state);
    render();
  }

  function add(title, dueRaw) {
    const t = clampTitle(title);
    if (!t) return;
    const dueStr = typeof dueRaw === "string" ? dueRaw.trim() : "";
    const dueDate = dueStr && isValidYmd(dueStr) ? dueStr : null;
    const ts = nowIso();
    state.items.push({
      id: uid(),
      title: t,
      done: false,
      createdAt: ts,
      updatedAt: ts,
      order: state.items.length,
      dueDate,
    });
    commit();
  }

  function toggleDone(id) {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    it.done = !it.done;
    it.updatedAt = nowIso();
    commit();
  }

  function remove(id) {
    const idx = state.items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    state.items.splice(idx, 1);
    state.items.forEach((x, i) => (x.order = i));
    commit();
  }

  function clearDone() {
    state.items = state.items.filter((x) => !x.done);
    state.items.forEach((x, i) => (x.order = i));
    commit();
  }

  function beginEdit(item, titleEl) {
    const li = titleEl.closest(".item");
    if (!li) return;

    const input = document.createElement("input");
    input.className = "input";
    input.value = item.title;
    input.setAttribute("aria-label", "编辑任务");
    input.style.padding = "10px 12px";
    input.style.borderRadius = "12px";

    const original = item.title;
    const finish = (save) => {
      const v = clampTitle(input.value);
      titleEl.style.display = "";
      input.remove();
      if (!save) return;
      if (!v) {
        remove(item.id);
        return;
      }
      if (v !== item.title) {
        item.title = v;
        item.updatedAt = nowIso();
        commit();
      } else {
        render();
      }
    };

    titleEl.style.display = "none";
    titleEl.parentElement.insertBefore(input, titleEl);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  function reorderByDrag(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const srcIdx = state.items.findIndex((x) => x.id === sourceId);
    const tgtIdx = state.items.findIndex((x) => x.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;

    const [moved] = state.items.splice(srcIdx, 1);
    state.items.splice(tgtIdx, 0, moved);
    state.items.forEach((x, i) => (x.order = i));
    commit();
  }

  function render() {
    const items = filteredItems();
    listEl.innerHTML = "";
    setSummary();

    if (items.length === 0) {
      const empty = document.createElement("li");
      empty.className = "emptyState";
      const title =
        filter === "done" ? "暂无已完成" : filter === "active" ? "没有待办" : "从这里开始";
      const sub =
        filter === "done"
          ? "完成任意任务后会出现在这里"
          : filter === "active"
            ? "切换为「全部」或添加新任务"
            : "在上方输入一条任务，按 Enter 或点新增";
      empty.innerHTML = `
        <div class="emptyIcon" aria-hidden="true"></div>
        <div class="emptyTitle">${title}</div>
        <div class="emptySub muted">${sub}</div>
      `;
      listEl.appendChild(empty);
      return;
    }

    for (const item of items) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = item.id;
      if (item.done) node.classList.add("done");

      const titleEl = node.querySelector(".title");
      const metaEl = node.querySelector(".meta");
      const checkBtn = node.querySelector(".check");
      const editBtn = node.querySelector('[data-action="edit"]');
      const delBtn = node.querySelector('[data-action="delete"]');

      titleEl.textContent = item.title;
      metaEl.textContent = formatItemMeta(item);
      if (item.dueDate && isValidYmd(item.dueDate) && !item.done && isOverdue(item.dueDate)) {
        node.classList.add("overdue");
      }

      checkBtn.addEventListener("click", () => toggleDone(item.id));
      delBtn.addEventListener("click", () => remove(item.id));
      editBtn.addEventListener("click", () => beginEdit(item, titleEl));
      titleEl.addEventListener("dblclick", () => beginEdit(item, titleEl));
      titleEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") beginEdit(item, titleEl);
      });

      node.addEventListener("dragstart", (e) => {
        dragId = item.id;
        node.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", item.id);
        } catch {}
      });
      node.addEventListener("dragend", () => {
        dragId = null;
        node.classList.remove("dragging");
        document.querySelectorAll(".dropTarget").forEach((x) => x.classList.remove("dropTarget"));
      });
      node.addEventListener("dragover", (e) => {
        e.preventDefault();
        node.classList.add("dropTarget");
        e.dataTransfer.dropEffect = "move";
      });
      node.addEventListener("dragleave", () => node.classList.remove("dropTarget"));
      node.addEventListener("drop", (e) => {
        e.preventDefault();
        node.classList.remove("dropTarget");
        const source = dragId || (() => {
          try { return e.dataTransfer.getData("text/plain"); } catch { return null; }
        })();
        reorderByDrag(source, item.id);
      });

      listEl.appendChild(node);
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    add(inputEl.value, dueDateEl.value);
    inputEl.value = "";
    dueDateEl.value = "";
    inputEl.focus();
  });

  clearDoneBtn.addEventListener("click", () => clearDone());

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.filter));
  });

  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    applyTheme(current === "light" ? "dark" : "light");
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      exportedAt: nowIso(),
      version: 1,
      items: state.items,
    };
    downloadText(`todolist-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  });

  importInput.addEventListener("change", async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = "";
    if (!file) return;
    const text = await readFileAsText(file);
    const data = safeJsonParse(text, null);
    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : null;
    if (!items) {
      alert("导入失败：文件格式不正确（需要 JSON）");
      return;
    }
    const normalized = items
      .filter((x) => x && typeof x === "object")
      .map((x) => ({
        id: String(x.id ?? uid()),
        title: clampTitle(x.title ?? ""),
        done: Boolean(x.done),
        createdAt: typeof x.createdAt === "string" ? x.createdAt : nowIso(),
        updatedAt: typeof x.updatedAt === "string" ? x.updatedAt : nowIso(),
        order: Number.isFinite(x.order) ? x.order : 0,
        dueDate: isValidYmd(x.dueDate) ? x.dueDate : null,
      }))
      .filter((x) => x.title.length > 0);

    if (normalized.length === 0) {
      alert("导入失败：没有可用的任务");
      return;
    }
    normalized.sort((a, b) => (a.order - b.order) || (a.createdAt.localeCompare(b.createdAt)));
    normalized.forEach((it, idx) => (it.order = idx));
    state.items = normalized;
    commit();
  });

  // init
  applyTheme(loadTheme());
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createApp);
} else {
  createApp();
}
