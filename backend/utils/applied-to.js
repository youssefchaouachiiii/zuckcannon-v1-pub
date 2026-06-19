// Pure display builder for a rule's "Applied to" cell. No DB/IO.
// BM is attached ONLY where an account name is shown (account names repeat
// across BMs — Sigma 1/2/3 each have an "Ad Account 1").

function accountLabel(accountId, accountBm) {
  const bm = accountBm[accountId]?.bm_name;
  const name = `Ad Account ${accountId}`;
  return bm ? `${bm} · ${name}` : name;
}

export function buildAppliedTo(assignments, { accountBm = {}, campaignAccount = {} } = {}) {
  if (!assignments || assignments.length === 0) return { inline: 'Unassigned', detail: [] };

  const byType = { campaign: [], adset: [], ad: [], vertical: [], tag: [], account: [] };
  for (const a of assignments) {
    if (byType[a.entity_type]) byType[a.entity_type].push(a.entity_id);
  }

  const parts = [];
  // labels (vertical/tag first)
  for (const v of byType.vertical) parts.push(`Vertical: ${v}`);
  for (const t of byType.tag) parts.push(`Tag: ${t}`);
  // account: name(s) with BM; single → labeled, many → count
  if (byType.account.length === 1) parts.push(accountLabel(byType.account[0], accountBm));
  else if (byType.account.length > 1) parts.push(`${byType.account.length} accounts`);
  // entity counts
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (byType.campaign.length) parts.push(plural(byType.campaign.length, 'campaign'));
  if (byType.adset.length) parts.push(plural(byType.adset.length, 'adset'));
  if (byType.ad.length) parts.push(plural(byType.ad.length, 'ad'));

  // detail: resolve campaign/adset/ad → account → BM (deduped, ordered by first seen)
  const seen = new Set();
  const detail = [];
  const pushAccount = (accountId) => {
    if (!accountId || seen.has(accountId)) return;
    seen.add(accountId);
    detail.push({
      bm_name: accountBm[accountId]?.bm_name || null,
      account_name: `Ad Account ${accountId}`,
      account_id: accountId,
    });
  };
  for (const id of byType.account) pushAccount(id);
  for (const cid of [...byType.campaign, ...byType.adset, ...byType.ad]) pushAccount(campaignAccount[cid]);

  return { inline: parts.join(' + '), detail };
}
