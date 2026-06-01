// public/fb-accounts.js

const COLSPAN = 7;

function fmtDate(v) {
  return v ? new Date(v).toLocaleDateString() : '—';
}

function expiresBadge(expiresAt) {
  if (!expiresAt) return { text: fmtDate(expiresAt), badge: '<span style="color:#28a745;font-weight:600;">&#x2705; Active</span>' };
  const date = new Date(expiresAt).toLocaleDateString();
  const daysLeft = Math.ceil((new Date(expiresAt) - new Date()) / 86400000);
  const badge = daysLeft > 7
    ? '<span style="color:#28a745;font-weight:600;">&#x2705; Active</span>'
    : daysLeft > 0
    ? `<span style="color:#f59e0b;font-weight:600;">&#x26A0;&#xFE0F; Expires in ${daysLeft}d</span>`
    : '<span style="color:#dc3545;font-weight:600;">&#x1F534; Expired</span>';
  return { text: date, badge };
}

async function loadSystemUsers() {
  const tbody = document.getElementById('system-user-tokens-body');
  try {
    const [tokens, bms] = await Promise.all([
      fetch('/api/fb-accounts/system-users').then(r => { if (!r.ok) throw new Error('Server error'); return r.json(); }),
      fetch('/api/fb-accounts/business-managers').then(r => { if (!r.ok) throw new Error('Server error'); return r.json(); }),
    ]);

    // id -> name map from business-managers
    const bmName = {};
    (Array.isArray(bms) ? bms : []).forEach(bm => { bmName[bm.id] = bm.name; });

    if (!Array.isArray(tokens) || tokens.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${COLSPAN}" style="padding:12px 8px;color:#888;">No system users registered. Add one above.</td></tr>`;
      return;
    }

    // ad-account counts: fetch per UNIQUE business_manager_id (small set — acceptable N+1)
    const uniqueBmIds = [...new Set(tokens.map(t => t.business_manager_id).filter(Boolean))];
    const bmAcctCount = {};
    await Promise.all(uniqueBmIds.map(async (bmId) => {
      try {
        const res = await fetch(`/api/fb-accounts/business-managers/${encodeURIComponent(bmId)}/ad-accounts`);
        if (!res.ok) return;
        const accts = await res.json();
        bmAcctCount[bmId] = Array.isArray(accts) ? accts.length : 0;
      } catch (e) { /* leave undefined → renders as — */ }
    }));

    tbody.innerHTML = tokens.map(t => {
      const exp = expiresBadge(t.expires_at);
      const bm = t.business_manager_id;
      const bmLabel = bmName[bm] || bm;
      const acctCount = bmAcctCount[bm] ?? '—';
      const validated = fmtDate(t.last_validated_at);
      const statusBadge = t.last_validation_ok
        ? '<span style="color:#28a745;font-weight:600;">&#x2705; OK</span>'
        : '<span style="color:#f59e0b;font-weight:600;">&#x26A0;&#xFE0F; Unvalidated</span>';
      const safeName = (t.name || '').replace(/"/g, '&quot;');

      return `<tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:8px;">
          ${t.name || '—'}
          <div style="font-family:monospace;font-size:11px;color:#999;">${t.fb_user_id}</div>
        </td>
        <td style="padding:8px;">
          ${bmLabel}
          <div style="font-family:monospace;font-size:11px;color:#999;">${bm}</div>
        </td>
        <td style="padding:8px;">${acctCount}</td>
        <td style="padding:8px;font-family:monospace;font-size:12px;">${t.token_preview || '—'}</td>
        <td style="padding:8px;">${exp.text}<br>${exp.badge}</td>
        <td style="padding:8px;">${validated}<br>${statusBadge}</td>
        <td style="padding:8px;white-space:nowrap;">
          <button class="btn-secondary btn-sm revalidate-btn"
            data-fb-user-id="${t.fb_user_id}"
            data-bm-id="${bm}">Revalidate</button>
          <button class="btn-danger btn-sm remove-btn"
            data-fb-user-id="${t.fb_user_id}"
            data-bm-id="${bm}"
            data-name="${safeName}">Remove</button>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="${COLSPAN}" style="padding:12px 8px;color:#dc3545;">Failed to load system users.</td></tr>`;
  }
}

async function registerToken() {
  const input = document.getElementById('system-user-token-input');
  const status = document.getElementById('verify-token-status');
  const btn = document.getElementById('verify-token-btn');

  const token = input.value.trim();
  if (!token) return;

  btn.disabled = true;
  status.innerHTML = '<span style="color:#666;">Registering...</span>';

  try {
    const res = await fetch('/api/fb-accounts/system-users/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token }),
    });
    const data = await res.json();

    if (!res.ok) {
      let msg = data.error || 'Registration failed.';
      if (res.status === 401) {
        msg = `${data.error || 'Not signed in.'} — log in with Facebook first.`;
      } else if (res.status === 403 && Array.isArray(data.rejected_bm_ids) && data.rejected_bm_ids.length) {
        msg = `${data.error || 'Rejected.'} (BM IDs: ${data.rejected_bm_ids.join(', ')})`;
      }
      status.innerHTML = `<span style="color:#dc3545;">&#x274C; ${msg}</span>`;
      return;
    }

    const suName = (data.system_user && data.system_user.name) || 'system user';
    const bmNames = Array.isArray(data.business_managers)
      ? data.business_managers.map(b => b.name || b.id).join(', ')
      : '';
    const expires = data.expires_at ? new Date(data.expires_at).toLocaleDateString() : 'never';
    status.innerHTML = `<span style="color:#28a745;">&#x2705; Registered ${suName} &middot; BM(s): ${bmNames} &middot; ${data.ad_accounts_wired} ad accounts &middot; expires ${expires}</span>`;
    input.value = '';
    await loadSystemUsers();
  } catch (err) {
    status.innerHTML = '<span style="color:#dc3545;">&#x274C; Network error. Try again.</span>';
  } finally {
    btn.disabled = false;
  }
}

async function revalidate(fbUserId, bmId) {
  const status = document.getElementById('verify-token-status');
  status.innerHTML = '<span style="color:#666;">Revalidating...</span>';
  try {
    const res = await fetch(`/api/fb-accounts/system-users/${encodeURIComponent(fbUserId)}/${encodeURIComponent(bmId)}/revalidate`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      status.innerHTML = `<span style="color:#dc3545;">&#x274C; ${data.error || 'Revalidation failed.'}</span>`;
      return;
    }
    const suName = (data.system_user && data.system_user.name) || 'system user';
    status.innerHTML = `<span style="color:#28a745;">&#x2705; Revalidated ${suName} &middot; ${data.ad_accounts_wired} ad accounts</span>`;
    await loadSystemUsers();
  } catch (err) {
    status.innerHTML = '<span style="color:#dc3545;">&#x274C; Network error. Try again.</span>';
  }
}

function confirmDeleteSystemUser(fbUserId, bmId, name) {
  const confirmDiv = document.getElementById('fb-accounts-confirm');
  const confirmMsg = document.getElementById('fb-accounts-confirm-msg');
  const confirmYes = document.getElementById('fb-accounts-confirm-yes');
  const confirmNo = document.getElementById('fb-accounts-confirm-no');

  confirmMsg.textContent = `Remove system user "${name}" for this BM? Ads-ops for its accounts will fall back to OAuth (or fail if the write flag is on).`;
  confirmDiv.style.display = 'block';

  // Clone to remove old listeners
  const newYes = confirmYes.cloneNode(true);
  const newNo = confirmNo.cloneNode(true);
  confirmYes.replaceWith(newYes);
  confirmNo.replaceWith(newNo);

  newYes.addEventListener('click', async () => {
    confirmDiv.style.display = 'none';
    try {
      const deleteRes = await fetch(`/api/fb-accounts/system-users/${encodeURIComponent(fbUserId)}/${encodeURIComponent(bmId)}`, { method: 'DELETE' });
      if (!deleteRes.ok) throw new Error('Server error');
      await loadSystemUsers();
    } catch (err) {
      if (typeof showError === 'function') showError('Failed to remove system user. Try again.');
    }
  });

  newNo.addEventListener('click', () => {
    confirmDiv.style.display = 'none';
  });
}

function openFbAccountsModal() {
  document.getElementById('fb-accounts-modal').style.display = 'flex';
  loadSystemUsers();
}

function closeFbAccountsModal() {
  document.getElementById('fb-accounts-modal').style.display = 'none';
}

function initFbAccountsPage() {
  document.getElementById('fb-accounts-btn').addEventListener('click', openFbAccountsModal);
  document.getElementById('fb-accounts-modal-close').addEventListener('click', closeFbAccountsModal);
  document.getElementById('verify-token-btn').addEventListener('click', registerToken);

  // Event delegation for row actions — avoids embedding name in onclick attribute
  document.getElementById('system-user-tokens-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { fbUserId, bmId, name } = btn.dataset;
    if (btn.classList.contains('revalidate-btn')) {
      revalidate(fbUserId, bmId);
    } else if (btn.classList.contains('remove-btn') || btn.classList.contains('delete-token-btn')) {
      confirmDeleteSystemUser(fbUserId, bmId, name);
    }
  });

  // Close modal when clicking backdrop
  document.getElementById('fb-accounts-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('fb-accounts-modal')) closeFbAccountsModal();
  });
}

window.deleteSystemUserToken = confirmDeleteSystemUser;
