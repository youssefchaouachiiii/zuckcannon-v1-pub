import React, { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { useNavigationGuard } from "../../hooks/useUploadProtection";
import "./Column.css";

/**
 * Account Selection Column (Column 1)
 * Displays available Meta ad accounts
 */
function AccountColumn() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const selectedAccount = useStore((state) => state.selectedAccount);
  const setSelectedAccount = useStore((state) => state.setSelectedAccount);
  const { shouldBlock, checkNavigation } = useNavigationGuard();

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const response = await fetch("/api/fetch-meta-data");
      const data = await response.json();
      setAccounts(data.ad_accounts || []);
    } catch (error) {
      console.error("Error fetching accounts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccountClick = (account) => {
    // Check if upload is in progress
    if (shouldBlock && !checkNavigation(account.name)) {
      return;
    }

    setSelectedAccount(account.account_id);
  };

  return (
    <div className="column">
      <div className="column-header">
        <h2>Select Ad Account</h2>
      </div>

      <div className="column-content">
        {loading ? (
          <div className="loading">Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="empty-state">No accounts found</div>
        ) : (
          <ul className="item-list">
            {accounts.map((account) => (
              <li key={account.account_id} className={`item ${selectedAccount === account.account_id ? "selected" : ""}`} onClick={() => handleAccountClick(account)}>
                <span className="item-name">{account.name}</span>
                <span className="item-id">{account.account_id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AccountColumn;
