import React, { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { shouldUseMockData, mockAdAccounts, mockApiDelay } from "../../mockData";
import "./Column.css";

/**
 * Account Selection Column (Column 3)
 * Displays available Meta ad accounts for multi-selection.
 */
function AccountColumn() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);

  const workflow = useStore((state) => state.workflow);
  const selectedCampaigns = useStore((state) => state.selectedCampaigns);
  const selectedAccounts = useStore((state) => state.selectedAccounts);
  const toggleAccountSelection = useStore((state) => state.toggleAccountSelection);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      // Use mock data if enabled
      if (shouldUseMockData()) {
        console.log("🎭 Using mock ad accounts data");
        await mockApiDelay(500);
        setAccounts(mockAdAccounts);
        return;
      }

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
    toggleAccountSelection(account.account_id);
  };

  // This column should only appear if the workflow is 'create_new'
  // OR if the workflow is 'select_existing' and at least one campaign is selected.
  if (workflow === "select_existing" && selectedCampaigns.length === 0) {
    return (
      <div className="column">
        <div className="empty-state">Please select one or more campaigns to proceed.</div>
      </div>
    );
  }

  return (
    <div className="column">
      <div className="column-header">
        <h2>Select Target Ad Account(s)</h2>
      </div>

      <div className="column-content">
        {loading ? (
          <div className="loading">Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div className="empty-state">No accounts found</div>
        ) : (
          <ul className="item-list">
            {accounts.map((account) => (
              <li
                key={account.account_id}
                className={`item ${selectedAccounts.includes(account.account_id) ? "selected" : ""}`}
                onClick={() => handleAccountClick(account)}
              >
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
