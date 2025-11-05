import React, { useState, useEffect } from "react";
import useStore from "../../store/useStore";
import "./Column.css"; // Re-using general column styles

/**
 * Create Campaign Workflow Component
 * Form for creating a new campaign using real Facebook Graph API
 */
function CreateCampaignWorkflow() {
  const [campaignName, setCampaignName] = useState("");
  const [budget, setBudget] = useState("");
  const [objective, setObjective] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [isCreating, setIsCreating] = useState(false);

  const setManageMode = useStore((state) => state.setManageMode);
  const setSelectedCampaign = useStore((state) => state.setSelectedCampaign);

  // Fetch ad accounts on mount
  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    try {
      const response = await fetch("/api/meta-data");
      if (!response.ok) throw new Error("Failed to fetch accounts");
      
      const data = await response.json();
      if (data.isConnected && data.accounts) {
        setAccounts(data.accounts);
        // Auto-select first account if available (use 'id' which has act_ prefix)
        if (data.accounts.length > 0) {
          setSelectedAccount(data.accounts[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching accounts:", error);
    }
  };

  const handleCreateCampaign = async () => {
    if (!isFormValid) return;

    setIsCreating(true);
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_id: selectedAccount,
          name: campaignName,
          objective: objective,
          daily_budget: budget,
          status: "PAUSED", // Always create as PAUSED for safety
          special_ad_categories: [],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create campaign");
      }

      const data = await response.json();
      
      // Show success notification
      if (window.showSuccess) {
        window.showSuccess(`Campaign "${campaignName}" created successfully!`, 3000);
      } else {
        alert(`✅ Campaign "${campaignName}" created successfully!`);
      }

      // Set the new campaign as selected and switch to existing mode
      setSelectedCampaign(data.campaign);
      setManageMode("select_existing");

      // Reset form
      setCampaignName("");
      setBudget("");
      setObjective("");

    } catch (error) {
      console.error("Error creating campaign:", error);
      if (window.showError) {
        window.showError(error.message, 5000);
      } else {
        alert(`❌ Error: ${error.message}`);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const isFormValid = 
    campaignName.trim() !== "" && 
    budget.trim() !== "" && 
    objective.trim() !== "" &&
    selectedAccount.trim() !== "";

  return (
    <div className="column">
      <div className="column-header">
        <h2>Create New Campaign</h2>
      </div>

      <div className="column-content">
        <div className="adset-form-container">
          {/* Ad Account Selection */}
          <select
            className="status-dropdown"
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            required
            disabled={accounts.length === 0}
          >
            <option value="">Select Ad Account*</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.account_id})
              </option>
            ))}
          </select>

          {/* Campaign Name */}
          <input
            type="text"
            placeholder="Campaign Name*"
            className="config-adset-name"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            required
            disabled={isCreating}
          />

          {/* Campaign Objective */}
          <select
            className="status-dropdown"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            required
            disabled={isCreating}
          >
            <option value="">Select Objective*</option>
            <option value="OUTCOME_AWARENESS">OUTCOME_AWARENESS</option>
            <option value="OUTCOME_TRAFFIC">OUTCOME_TRAFFIC</option>
            <option value="OUTCOME_ENGAGEMENT">OUTCOME_ENGAGEMENT</option>
            <option value="OUTCOME_LEADS">OUTCOME_LEADS</option>
            <option value="OUTCOME_APP_PROMOTION">OUTCOME_APP_PROMOTION</option>
            <option value="OUTCOME_SALES">OUTCOME_SALES</option>
          </select>

          {/* Daily Budget */}
          <div className="budget-input-wrapper">
            <span className="currency-prefix">$</span>
            <input
              type="number"
              placeholder="Daily Budget*"
              className="config-daily-budget"
              step="0.01"
              min="1"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              required
              disabled={isCreating}
            />
            <span className="currency-suffix">/day</span>
          </div>

          {/* Info message */}
          <div style={{ 
            fontSize: "12px", 
            color: "#666", 
            marginTop: "10px",
            padding: "8px",
            backgroundColor: "#f8f9fa",
            borderRadius: "4px"
          }}>
            ℹ️ Campaign will be created with status <strong>PAUSED</strong> for safety
          </div>

          {/* Create Button */}
          <button
            className={`create-adset-btn ${isFormValid && !isCreating ? "active" : ""}`}
            onClick={handleCreateCampaign}
            disabled={!isFormValid || isCreating}
          >
            {isCreating ? "Creating..." : "Create Campaign"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateCampaignWorkflow;
