import React, { useState } from "react";
import useStore from "../../store/useStore";
import "./Column.css";

/**
 * Review and Copy Column (Column 4 - Bulk Upload Workflow)
 * Displays a summary of selected campaigns and triggers copying them to multiple accounts.
 */
function ReviewColumn() {
  const [copying, setCopying] = useState(false);
  const [copyResults, setCopyResults] = useState(null);

  const selectedCampaigns = useStore((state) => state.selectedCampaigns);
  const selectedAccounts = useStore((state) => state.selectedAccounts);
  const metaData = useStore((state) => state.metaData);

  const hasSelection = selectedCampaigns.length > 0 && selectedAccounts.length > 0;

  // Get campaign names for display
  const getCampaignNames = () => {
    if (!metaData?.campaigns) return [];
    return selectedCampaigns.map((id) => {
      const campaign = metaData.campaigns.find((c) => c.id === id);
      return campaign?.name || id;
    });
  };

  // Get account names for display
  const getAccountNames = () => {
    if (!metaData?.accounts) return [];
    return selectedAccounts.map((id) => {
      const account = metaData.accounts.find((a) => a.account_id === id);
      return account?.name || id;
    });
  };

  const handleCopyCampaigns = async () => {
    if (!window.confirm(
      `Are you sure you want to copy ${selectedCampaigns.length} campaign(s) to ${selectedAccounts.length} ad account(s)?\n\nThis will duplicate the entire campaign structure including ad sets and ads.`
    )) {
      return;
    }

    setCopying(true);
    setCopyResults(null);

    const results = {
      total: selectedAccounts.length,
      successful: [],
      failed: [],
    };

    try {
      // Copy campaigns one at a time across all accounts
      // Pattern: Campaign 1 → All Accounts, then Campaign 2 → All Accounts, etc.
      for (const campaignId of selectedCampaigns) {
        for (const accountId of selectedAccounts) {
          try {
            const response = await fetch("/api/bulk-copy-campaigns", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                campaign_ids: [campaignId], // Copy one campaign at a time
                target_account_id: accountId,
              }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || `Failed to copy to account ${accountId}`);
            }

            const result = await response.json();
            
            // Check if this account already exists in successful results
            const existingAccount = results.successful.find(r => r.accountId === accountId);
            if (existingAccount) {
              // Merge results for this account
              existingAccount.result.results = [...existingAccount.result.results, ...result.results];
              existingAccount.result.successful += result.successful;
              existingAccount.result.failed += result.failed;
            } else {
              results.successful.push({ accountId, result });
            }
          } catch (error) {
            console.error(`Error copying campaign ${campaignId} to account ${accountId}:`, error);
            
            // Check if this account already has failures
            const existingFailure = results.failed.find(r => r.accountId === accountId);
            if (existingFailure) {
              existingFailure.error += `; ${error.message}`;
            } else {
              results.failed.push({ accountId, error: error.message });
            }
          }
        }
      }

      // Show summary
      setCopyResults(results);
      
      if (results.failed.length === 0) {
        window.showSuccess?.(
          `Successfully copied ${selectedCampaigns.length} campaign(s) to ${results.successful.length} account(s)!`
        );
      } else {
        window.showWarning?.(
          `Copy completed with issues: ${results.successful.length} successful, ${results.failed.length} failed`
        );
      }
    } catch (error) {
      console.error("Bulk copy error:", error);
      window.showError?.("Bulk copy failed. Please try again.");
    } finally {
      setCopying(false);
    }
  };

  const campaignNames = getCampaignNames();
  const accountNames = getAccountNames();

  return (
    <div className="column">
      <div className="column-header">
        <h2>Review & Copy</h2>
      </div>

      {hasSelection ? (
        <div className="column-content">
          <div className="review-summary">
            <h4>📋 Copy Summary</h4>
            <p style={{ fontSize: "14px", color: "#666", marginBottom: "20px" }}>
              You are about to copy the selected campaigns to multiple ad accounts.
            </p>

            <div style={{ marginBottom: "20px" }}>
              <strong style={{ display: "block", marginBottom: "8px" }}>
                Campaigns to Copy: ({selectedCampaigns.length})
              </strong>
              <ul style={{ 
                listStyle: "none", 
                padding: "10px", 
                background: "#f8f9fa", 
                borderRadius: "6px",
                maxHeight: "150px",
                overflowY: "auto",
                margin: 0
              }}>
                {campaignNames.map((name, idx) => (
                  <li key={idx} style={{ padding: "4px 0", fontSize: "13px" }}>
                    📊 {name}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <strong style={{ display: "block", marginBottom: "8px" }}>
                Target Ad Accounts: ({selectedAccounts.length})
              </strong>
              <ul style={{ 
                listStyle: "none", 
                padding: "10px", 
                background: "#f8f9fa", 
                borderRadius: "6px",
                maxHeight: "150px",
                overflowY: "auto",
                margin: 0
              }}>
                {accountNames.map((name, idx) => (
                  <li key={idx} style={{ padding: "4px 0", fontSize: "13px" }}>
                    🎯 {name}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{
              padding: "12px",
              background: "#e7f3ff",
              border: "1px solid #b3d9ff",
              borderRadius: "6px",
              marginBottom: "20px",
              fontSize: "13px",
              color: "#004085"
            }}>
              <strong>ℹ️ Note:</strong> This will duplicate the entire campaign structure including ad sets and ads to each selected account.
            </div>
          </div>

          {/* Copy Results */}
          {copyResults && (
            <div
              style={{
                marginTop: "15px",
                padding: "12px",
                background: copyResults.failed.length === 0 ? "#d4edda" : "#fff3cd",
                border: `1px solid ${copyResults.failed.length === 0 ? "#c3e6cb" : "#ffeeba"}`,
                borderRadius: "6px",
              }}
            >
              <h5 style={{ margin: "0 0 8px 0" }}>Copy Results</h5>
              <p style={{ margin: "4px 0", fontSize: "13px" }}>
                ✓ Successful: {copyResults.successful.length} account(s)
              </p>
              {copyResults.failed.length > 0 && (
                <>
                  <p style={{ margin: "4px 0", fontSize: "13px", color: "#856404" }}>
                    ✗ Failed: {copyResults.failed.length} account(s)
                  </p>
                  <details style={{ marginTop: "8px", fontSize: "12px" }}>
                    <summary style={{ cursor: "pointer", color: "#856404" }}>
                      View failed accounts
                    </summary>
                    <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                      {copyResults.failed.map((item, idx) => (
                        <li key={idx}>
                          {item.accountId}: {item.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </div>
          )}

          {/* Copy Button */}
          <button
            className="upload-btn"
            onClick={handleCopyCampaigns}
            disabled={copying}
            style={{
              width: "100%",
              marginTop: "20px",
              padding: "12px",
              background: copying ? "#ccc" : "#28a745",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: copying ? "not-allowed" : "pointer",
              fontSize: "16px",
              fontWeight: "600",
            }}
          >
            {copying
              ? "Copying Campaigns..."
              : `📤 Copy to ${selectedAccounts.length} Account(s)`}
          </button>
        </div>
      ) : (
        <div className="empty-state">Please select campaigns and accounts to continue.</div>
      )}
    </div>
  );
}

export default ReviewColumn;
