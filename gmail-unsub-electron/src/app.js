/**
 * Gmail Unsubscriber - Modular App State & Logic
 * Production-ready with proper error handling, state management, and performance optimization
 */

// ══════════════════════════════════════════════════════════════════════════════
// STATE MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

class AppState {
  constructor() {
    this.senders = [];
    this.selected = new Set();
    this.confirmed = [];
    this.filter = 'all';
    this.sort = 'count';
    this.isScanning = false;
    this.isProcessing = false;
    this.undoTimer = null;
    this.currentScreen = 'auth';
  }

  reset() {
    this.senders = [];
    this.selected.clear();
    this.confirmed = [];
    this.filter = 'all';
    this.sort = 'count';
  }

  addSenders(data) {
    this.senders = data;
    this.selected.clear();
  }

  toggleSender(id) {
    if (this.isSenderLocked(id)) return false;
    if (this.selected.has(id)) {
      this.selected.delete(id);
    } else {
      this.selected.add(id);
    }
    return true;
  }

  isSenderLocked(id) {
    const sender = this.senders.find(s => s.id === id);
    return sender?.risk === 'important';
  }

  getFilteredSenders() {
    let list = this.senders.filter(s => {
      if (this.filter === 'safe') return s.risk === 'safe';
      if (this.filter === 'high') return s.count >= 50;
      return true;
    });
    return list.sort((a, b) => {
      if (this.sort === 'count') return b.count - a.count;
      return new Date(b.lastDate) - new Date(a.lastDate);
    });
  }

  getSafeSenders() {
    return this.senders.filter(s => s.risk === 'safe' && s.hasUnsub);
  }

  getSelectedCount() {
    return this.selected.size;
  }

  getSelectedEmails() {
    return [...this.selected].reduce((acc, id) => {
      const sender = this.senders.find(s => s.id === id);
      return acc + (sender?.count || 0);
    }, 0);
  }

  setConfirmed() {
    this.confirmed = this.senders.filter(s => this.selected.has(s.id));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// UI CONTROLLER
// ══════════════════════════════════════════════════════════════════════════════

class UIController {
  constructor(state) {
    this.state = state;
  }

  showScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const screen = document.getElementById(name + '-screen');
    if (screen) {
      screen.classList.add('active');
      this.state.currentScreen = name;
    }
  }

  setLoadingButton(buttonId, loading = true) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.disabled = loading;
    btn.setAttribute('data-loading', loading);
  }

  toast(message, duration = 3200, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.setAttribute('data-type', type);
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), duration);
  }

  updateAuthUI(email) {
    const pill = document.getElementById('user-pill');
    const emailEl = document.getElementById('user-email');
    if (email) {
      emailEl.textContent = email;
      pill.style.display = 'flex';
    } else {
      pill.style.display = 'none';
    }
  }

  updateScanProgress(phase, progress) {
    const fill = document.getElementById('prog-fill');
    const label = document.getElementById('prog-lbl');
    if (fill) fill.style.width = progress + '%';
    if (label) {
      // Use textContent instead of innerHTML to prevent XSS
      label.textContent = `${phase} `;
      const strong = document.createElement('strong');
      strong.textContent = `${progress}%`;
      label.appendChild(strong);
    }
  }

  renderSenderList() {
    const list = document.getElementById('sender-list');
    const empty = document.getElementById('list-empty');
    const filtered = this.state.getFilteredSenders();

    if (!filtered.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    list.innerHTML = filtered
      .map(s => this.createSenderRow(s))
      .join('');
  }

  createSenderRow(sender) {
    const isSelected = this.state.selected.has(sender.id);
    const isLocked = this.state.isSenderLocked(sender.id);
    const initials = (sender.name.split(' ').map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
    const category = sender.category || 'Other';
    const fmtDate = new Date(sender.lastDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    return `
      <div class="sender-item ${isSelected ? 'on' : ''} ${isLocked ? 'locked' : ''}" 
           id="sender-${this.escapeId(sender.id)}"
           data-sender-id="${this.escapeAttr(sender.id)}"
           role="checkbox" aria-checked="${isSelected}" tabindex="0">
        <input type="checkbox" ${isSelected ? 'checked' : ''} ${isLocked ? 'disabled' : ''}
               class="sender-checkbox" 
               aria-label="Select ${this.escapeText(sender.name)}"
               ${isLocked ? 'title="Important sender - cannot unsubscribe"' : ''}>
        <div class="av ${isLocked ? 'locked' : ''}">${initials}</div>
        <div class="si">
          <div class="sn-row">
            <span class="sn">${this.escapeText(sender.name)}</span>
            ${isLocked ? '<span class="badge badge-imp" title="Important emails">important</span>' : ''}
            <span class="badge" style="background:var(--${this.getCategoryColor(category)}-bg);color:var(--${this.getCategoryColor(category)})">${category}</span>
          </div>
          <div class="se">${this.escapeText(sender.email)}</div>
        </div>
        <div class="sm">
          <div class="sc">${sender.count}</div>
          <div class="sd">${fmtDate}</div>
        </div>
      </div>
    `;
  }

  updateHeaderStats() {
    const safe = this.state.getSafeSenders();
    const total = this.state.senders.reduce((a, s) => a + s.count, 0);
    const smartBtn = document.getElementById('smart-btn');
    const title = document.getElementById('sel-title');
    const sub = document.getElementById('sel-sub');

    if (title) title.textContent = `${this.state.senders.length} senders`;
    if (sub) sub.textContent = `${total.toLocaleString()} emails · ${safe.length} safe`;
    if (smartBtn) smartBtn.textContent = `Select safe (${safe.length})`;
  }

  updateSelectionUI() {
    const f = this.state.getFilteredSenders().filter(s => !this.state.isSenderLocked(s.id));
    const allIn = f.length > 0 && f.every(s => this.state.selected.has(s.id));

    const checkAll = document.getElementById('chk-all');
    const chkLbl = document.getElementById('chk-lbl');
    const selCount = document.getElementById('sel-count');
    const bottomBar = document.getElementById('bottom-bar');
    const bbLbl = document.getElementById('bb-lbl');
    const bbSub = document.getElementById('bb-sub');

    if (checkAll) {
      checkAll.checked = allIn;
      checkAll.indeterminate = !allIn && this.state.selected.size > 0;
    }
    if (chkLbl) chkLbl.textContent = allIn ? 'Deselect all' : 'Select all';
    if (selCount) {
      selCount.innerHTML = this.state.selected.size > 0 
        ? `<strong>${this.state.selected.size}</strong> selected` 
        : '';
    }

    const emails = this.state.getSelectedEmails();
    if (bottomBar) bottomBar.classList.toggle('show', this.state.selected.size > 0);
    if (bbLbl) bbLbl.textContent = `${this.state.selected.size} sender${this.state.selected.size !== 1 ? 's' : ''}`;
    if (bbSub) bbSub.textContent = `≈ ${emails.toLocaleString()} emails`;
  }

  updateConfirmScreen() {
    const senders = this.state.confirmed.length;
    const emails = this.state.confirmed.reduce((a, s) => a + s.count, 0);
    const important = this.state.confirmed.filter(s => s.risk === 'important');

    document.getElementById('cf-senders').textContent = senders;
    document.getElementById('cf-emails').textContent = emails.toLocaleString();
    document.getElementById('btn-cf').textContent = `Confirm unsubscribe — ${senders} senders`;

    const warn = document.getElementById('cf-warn');
    if (important.length) {
      warn.style.display = 'block';
      document.getElementById('cf-warn-txt').textContent = 
        `${important.map(s => this.escapeText(s.name)).join(', ')} may send important notifications.`;
    } else {
      warn.style.display = 'none';
    }

    const preview = document.getElementById('prev-list');
    preview.innerHTML = this.state.confirmed.slice(0, 8)
      .map((s, i, arr) => `
        <div class="prev-row" style="${i === arr.length - 1 ? 'border-bottom:none' : ''}">
          <span class="prev-name">${this.escapeText(s.name)}</span>
          <span class="prev-ct">${s.count} emails</span>
        </div>
      `).join('') + 
      (this.state.confirmed.length > 8 ? `<div class="prev-more">+${this.state.confirmed.length - 8} more</div>` : '');
  }

  updateExecuteScreen(ok, fail) {
    document.getElementById('ex-title').textContent = 'Done ✓';
    document.getElementById('ex-sub').textContent = `${ok} unsubscribed · ${fail} failed`;
    document.getElementById('ex-ok').textContent = ok;
    document.getElementById('ex-fail').textContent = fail;
    document.getElementById('ex-cards').style.display = 'flex';
  }

  setExecuteRowStatus(senderId, status, method) {
    const row = document.getElementById(`exec-row-${this.escapeId(senderId)}`);
    if (!row) return;

    row.classList.add(status === 'success' ? 's' : 'f');
    const dot = row.querySelector('.sdot');
    const st = row.querySelector('.est');
    const mth = row.querySelector('.emth');

    if (dot) {
      dot.classList.add(status === 'success' ? 's' : 'f');
      dot.innerHTML = status === 'success'
        ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
        : '<span style="font-size:10px;color:var(--red);font-weight:700">✕</span>';
    }

    if (st) {
      st.className = 'est ' + (status === 'success' ? 's' : 'f');
      st.textContent = status === 'success' ? 'Unsubscribed' : 'Failed';
    }

    if (mth) mth.textContent = method || '';
  }

  // Utility methods
  escapeId(str) {
    return CSS.escape(str);
  }

  escapeAttr(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeText(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  getCategoryColor(category) {
    const colors = {
      Entertainment: 'green',
      Professional: 'blue',
      Shopping: 'amber',
      Newsletter: 'blue',
      Learning: 'green',
      Social: 'amber',
      Banking: 'red',
      Travel: 'red',
      Developer: 'blue',
      Productivity: 'blue',
      Other: 'blue',
    };
    return colors[category] || 'blue';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT FOR INDEX.HTML
// ══════════════════════════════════════════════════════════════════════════════

window.AppState = AppState;
window.UIController = UIController;
