// public/fb-accounts.js

async function loadSystemUserTokens() {
  const tbody = document.getElementById('system-user-tokens-body');
  try {
    const res = await fetch('/api/fb-accounts/tokens');
    if (!res.ok) throw new Error('Server error');
    const tokens = await res.json();

    if (tokens.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#888;">No tokens configured. Add one above.</td></tr>';
      return;
    }

    tbody.innerHTML = tokens.map(t => {
      const expires = t.expires_at
        ? new Date(t.expires_at).toLocaleDateString()
        : 'Never';
      const daysLeft = t.expires_at
        ? Math.ceil((new Date(t.expires_at) - new Date()) / 86400000)
        : null;
      const statusBadge = !t.expires_at
        ? '<span style="color:#28a745;font-weight:600;">&#x2705; Active</span>'
        : daysLeft > 7
        ? '<span style="color:#28a745;font-weight:600;">&#x2705; Active</span>'
        : daysLeft > 0
        ? `<span style="color:#f59e0b;font-weight:600;">&#x26A0;&#xFE0F; Expires in ${daysLeft}d</span>`
        : '<span style="color:#dc3545;font-weight:600;">&#x1F534; Expired</span>';

      return `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">${t.business_name}</td>
        <td style="padding:8px;font-family:monospace;font-size:12px;">${t.business_manager_id}</td>
        <td style="padding:8px;font-family:monospace;font-size:12px;">${t.token_preview}</td>
        <td style="padding:8px;">${expires}</td>
        <td style="padding:8px;">${statusBadge}</td>
        <td style="padding:8px;">
          <button class="btn-danger btn-sm delete-token-btn"
            data-bm-id="${t.business_manager_id}"
            data-bm-name="${t.business_name.replace(/"/g, '&quot;')}">
            Remove
          </button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:12px 8px;color:#dc3545;">Failed to load tokens.</td></tr>';
  }
}

async function verifyAndSaveToken() {
  const input = document.getElementById('system-user-token-input');
  const status = document.getElementById('verify-token-status');
  const btn = document.getElementById('verify-token-btn');

  const token = input.value.trim();
  if (!token) return;

  btn.disabled = true;
  status.textContent = 'Verifying...';

  try {
    const res = await fetch('/api/fb-accounts/tokens/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token }),
    });
    const data = await res.json();

    if (!res.ok) {
      status.innerHTML = `<span style="color:#dc3545;">&#x274C; ${data.error}</span>`;
      return;
    }

    status.innerHTML = `<span style="color:#28a745;">&#x2705; Connected: ${data.business_name}</span>`;
    input.value = '';
    await loadSystemUserTokens();
  } catch (err) {
    status.innerHTML = '<span style="color:#dc3545;">&#x274C; Network error. Try again.</span>';
  } finally {
    btn.disabled = false;
  }
}

function confirmDeleteSystemUserToken(bmId, bmName) {
  const confirmDiv = document.getElementById('fb-accounts-confirm');
  const confirmMsg = document.getElementById('fb-accounts-confirm-msg');
  const confirmYes = document.getElementById('fb-accounts-confirm-yes');
  const confirmNo = document.getElementById('fb-accounts-confirm-no');

  confirmMsg.textContent = `Remove token for "${bmName}"? FB API calls will fall back to OAuth tokens.`;
  confirmDiv.style.display = 'block';

  // Clone to remove old listeners
  const newYes = confirmYes.cloneNode(true);
  const newNo = confirmNo.cloneNode(true);
  confirmYes.replaceWith(newYes);
  confirmNo.replaceWith(newNo);

  newYes.addEventListener('click', async () => {
    confirmDiv.style.display = 'none';
    try {
      const deleteRes = await fetch(`/api/fb-accounts/tokens/${bmId}`, { method: 'DELETE' });
      if (!deleteRes.ok) throw new Error('Server error');
      await loadSystemUserTokens();
    } catch (err) {
      if (typeof showError === 'function') showError('Failed to remove token. Try again.');
    }
  });

  newNo.addEventListener('click', () => {
    confirmDiv.style.display = 'none';
  });
}

function openFbAccountsModal() {
  document.getElementById('fb-accounts-modal').style.display = 'flex';
  loadSystemUserTokens();
}

function closeFbAccountsModal() {
  document.getElementById('fb-accounts-modal').style.display = 'none';
}

function initFbAccountsPage() {
  document.getElementById('fb-accounts-btn').addEventListener('click', openFbAccountsModal);
  document.getElementById('fb-accounts-modal-close').addEventListener('click', closeFbAccountsModal);
  document.getElementById('verify-token-btn').addEventListener('click', verifyAndSaveToken);

  // Event delegation for Remove buttons — avoids embedding bmName in onclick attribute
  document.getElementById('system-user-tokens-body').addEventListener('click', (e) => {
    if (e.target.classList.contains('delete-token-btn')) {
      confirmDeleteSystemUserToken(e.target.dataset.bmId, e.target.dataset.bmName);
    }
  });

  // Close modal when clicking backdrop
  document.getElementById('fb-accounts-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('fb-accounts-modal')) closeFbAccountsModal();
  });
}

window.deleteSystemUserToken = confirmDeleteSystemUserToken;
