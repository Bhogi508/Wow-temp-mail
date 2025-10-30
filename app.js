/*
  WOW TEMP MAIL GENERATOR
  - Fixed and enhanced by AI
  - Uses mail.tm API
  - Auto-checks every 5 seconds.
*/

document.addEventListener('DOMContentLoaded', () => {
  const API = 'https://api.mail.tm';
  const LS_KEY = 'temp_mail_account_v3';
  const POLL_INTERVAL_MS = 5000;

  // Get DOM Elements
  const btnGenerate = document.getElementById('btnGenerate');
  const btnCopy = document.getElementById('btnCopy');
  const btnDelete = document.getElementById('btnDelete');
  const btnRefresh = document.getElementById('btnRefresh');

  const emailBox = document.getElementById('emailBox');
  const acctInfo = document.getElementById('acctInfo');
  const inboxList = document.getElementById('inboxList');
  const newTag = document.getElementById('newTag');

  let pollTimer = null;
  let lastMessageIds = new Set();
  let currentAccount = null;

  // --- Helper Functions ---

  function rand(len = 8) {
    const s = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let r = '';
    for (let i = 0; i < len; i++) r += s[Math.floor(Math.random() * s.length)];
    return r;
  }

  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) {
      const t = await res.text().catch(() => res.statusText);
      throw new Error('HTTP ' + res.status + ' — ' + t);
    }
    // Handle cases with empty response body
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    return null; // Return null for non-JSON or empty responses
  }

  // --- UI Update Functions ---

  function updateUIAccount(acc) {
    currentAccount = acc;
    if (acc) {
      emailBox.textContent = acc.address;
      acctInfo.textContent = `Status: Monitoring inbox... (Password saved locally)`;
      btnCopy.disabled = false;
      btnDelete.disabled = false;
      btnRefresh.disabled = false;
      startAutoPoll();
      loadInbox();
    } else {
      emailBox.textContent = "[Click 'GENERATE' to start]";
      acctInfo.textContent = 'Status: Idle';
      inboxList.innerHTML = '<div class="msg-placeholder">Your messages will appear here...</div>';
      btnCopy.disabled = true;
      btnDelete.disabled = true;
      btnRefresh.disabled = true;
      stopAutoPoll();
      lastMessageIds = new Set();
    }
  }

  function showInboxLoading() {
    inboxList.innerHTML = '<div class="msg-info">Loading messages...</div>';
  }

  function showInboxError(message) {
    inboxList.innerHTML = `<div class="msg-info" style="color:var(--neon-red)">${escapeHtml(message)}</div>`;
  }

  function showInboxEmpty() {
    inboxList.innerHTML = '<div class="msg-info">No messages yet.</div>';
  }

  // --- API Functions ---

  async function getDomains() {
    const d = await fetchJson(API + '/domains?page=1');
    return d['hydra:member'] || [];
  }

  async function createAccount() {
    const domains = await getDomains();
    if (!domains.length) throw new Error('No mail domains available');
    
    // Use the first available domain
    const domain = domains[0].domain;
    const local = 'user' + rand(6);
    const addr = `${local}@${domain}`;
    const pwd = 'pass' + rand(12); // Simple password, it's temp anyway

    // 1. Create account
    await fetchJson(API + '/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, password: pwd })
    });

    // 2. Get token
    const tokenRes = await fetchJson(API + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: addr, password: pwd })
    });

    if (!tokenRes.token) {
        throw new Error('Failed to get auth token after account creation.');
    }

    const acc = { address: addr, password: pwd, token: tokenRes.token };
    localStorage.setItem(LS_KEY, JSON.stringify(acc));
    return acc;
  }

  async function loadStored() {
    try {
      const acc = JSON.parse(localStorage.getItem(LS_KEY));
      // Simple validation
      if (acc && acc.address && acc.token) {
        return acc;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  async function deleteRemote(acc) {
    if (!acc || !acc.token) return;
    try {
      const me = await fetchJson(API + '/me', { headers: { Authorization: 'Bearer ' + acc.token } }).catch(() => null);
      if (me && me.id) {
        await fetch(API + '/accounts/' + me.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + acc.token } }).catch(() => null);
      }
    } catch (e) {
      console.warn('Failed to delete remote account, token might be expired.', e);
    }
  }

  // --- Core Logic ---

  async function generate() {
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'CREATING...';
    acctInfo.textContent = 'Status: Requesting new email...';

    // Delete old account first, if one exists
    if(currentAccount) {
      await deleteRemote(currentAccount);
    }

    try {
      const acc = await createAccount();
      lastMessageIds = new Set(); // Reset message tracking
      updateUIAccount(acc);
    } catch (err) {
      alert('Failed to create account: ' + err.message);
      acctInfo.textContent = 'Status: Error!';
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.textContent = 'GENERATE NEW';
    }
  }

  async function loadInbox(silent = false) {
    if (!currentAccount) {
      showInboxError('No account. Generate first.');
      return;
    }
    if (!silent) {
      showInboxLoading();
    }

    try {
      const res = await fetch(API + '/messages', { headers: { Authorization: 'Bearer ' + currentAccount.token } });
      
      if (res.status === 401) {
          // Token expired. Clear account.
          showInboxError('Session expired. Please generate a new email.');
          handleDelete(false); // Clear local without remote delete
          return;
      }
      if (!res.ok) {
        showInboxError('Failed to fetch messages.');
        return;
      }
      
      const data = await res.json();
      const msgs = data['hydra:member'] || [];

      // Detect new messages
      const incomingIds = new Set(msgs.map(m => m.id));
      let isNew = false;
      if (lastMessageIds.size > 0) { // Only detect 'new' if we have a baseline
        for (const id of incomingIds) {
          if (!lastMessageIds.has(id)) {
            isNew = true;
            break;
          }
        }
      }
      lastMessageIds = incomingIds; // Update baseline

      if (isNew) {
        newTag.style.display = 'inline-block';
        setTimeout(() => newTag.style.display = 'none', 3000);
      }

      if (msgs.length === 0) {
        showInboxEmpty();
        return;
      }

      inboxList.innerHTML = ''; // Clear list
      msgs.forEach(m => {
        const node = document.createElement('div');
        node.className = 'msg';
        node.onclick = () => readFull(m.id); // Add click event
        
        const time = new Date(m.createdAt).toLocaleString();
        node.innerHTML = `
          <div class="meta">
            <strong>From:</strong> ${escapeHtml(m.from?.address || '(unknown)')}
            <span style="float:right">${time}</span>
          </div>
          <div class="subject">${escapeHtml(m.subject || '(no subject)')}</div>
          <div class="preview">${escapeHtml(m.intro || '')}</div>
        `;
        inboxList.appendChild(node);
      });

    } catch (e) {
      showInboxError('Error loading inbox: ' + e.message);
    }
  }

  async function readFull(id) {
    if (!currentAccount) {
      alert('No account stored.');
      return;
    }
    
    // Show a temporary loading message in a new tab
    const w = window.open('', '_blank');
    w.document.write(`<body style="background:#030305;color:#e6faff;font-family:monospace;padding:24px"><h2>Loading message...</h2></body>`);

    try {
      const res = await fetch(API + '/messages/' + id, { headers: { Authorization: 'Bearer ' + currentAccount.token } });
      if (!res.ok) {
        w.document.body.innerHTML = '<h2>Failed to load message.</h2>';
        return;
      }
      const m = await res.json();
      
      // Get the content (HTML or text)
      const content = m.html && m.html.length > 0 ? m.html[0] : `<pre style="white-space:pre-wrap">${escapeHtml(m.text || m.intro || '(no content)')}</pre>`;
      const from = escapeHtml(m.from?.address || '(unknown)');
      const subject = escapeHtml(m.subject || '(no subject)');
      
      // Write final content
      w.document.title = subject;
      w.document.body.innerHTML = `
        <div style="max-width: 800px; margin: auto;">
          <h3>From: ${from}</h3>
          <h4>Subject: ${subject}</h4>
          <hr style="border-color: #333;">
          <div style="margin-top: 20px; font-size: 1.1rem; line-height: 1.6;">
            ${content}
          </div>
        </div>
      `;
      // If content was HTML, we need to reset the styles for the content itself
      if (m.html && m.html.length > 0) {
        w.document.body.style.background = '#fff'; // Assume light mode for HTML emails
        w.document.body.style.color = '#000';
      }

    } catch (e) {
      w.document.body.innerHTML = `<h2>Error: ${e.message}</h2>`;
    }
  }

  function copyToClipboard() {
    if (currentAccount && currentAccount.address) {
      navigator.clipboard.writeText(currentAccount.address).then(() => {
        acctInfo.textContent = 'Status: Copied to clipboard!';
        setTimeout(() => updateUIAccount(currentAccount), 2000); // Reset status
      }).catch(err => {
        alert('Failed to copy: ' + err);
      });
    }
  }

  async function handleDelete(confirmDelete = true) {
    if (!currentAccount) return;

    if (confirmDelete && !confirm('Are you sure you want to delete this temp email? This cannot be undone.')) {
      return;
    }

    btnDelete.disabled = true;
    btnDelete.textContent = 'DELETING...';
    
    await deleteRemote(currentAccount);
    localStorage.removeItem(LS_KEY);
    updateUIAccount(null); // Clear UI
    
    btnDelete.textContent = 'DELETE';
  }

  // --- Auto-Polling ---

  function startAutoPoll() {
    stopAutoPoll(); // Ensure only one timer runs
    if (currentAccount) {
      pollTimer = setInterval(() => loadInbox(true), POLL_INTERVAL_MS); // Silent load
    }
  }

  function stopAutoPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // --- Initialization ---

  async function init() {
    const acc = await loadStored();
    if (acc) {
      updateUIAccount(acc);
    } else {
      updateUIAccount(null); // Set initial disabled state
    }

    // Add Event Listeners
    btnGenerate.addEventListener('click', generate);
    btnCopy.addEventListener('click', copyToClipboard);
    btnDelete.addEventListener('click', () => handleDelete(true));
    btnRefresh.addEventListener('click', () => loadInbox(false)); // Non-silent load
  }

  init();
});
