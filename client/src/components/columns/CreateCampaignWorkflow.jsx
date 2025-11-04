import React, { useState } from "react";
import useStore from "../../store/useStore";
import "./Column.css"; // Re-using general column styles

/**
 * Create Campaign Workflow Component
 * Form for creating a new campaign.
 */
function CreateCampaignWorkflow() {
  const [campaignName, setCampaignName] = useState("");
  const [budget, setBudget] = useState("");
  const [bidStrategy, setBidStrategy] = useState("");

  const selectedAccounts = useStore((state) => state.selectedAccounts);
  const toggleAccountSelection = useStore((state) => state.toggleAccountSelection);

  const handleCreateCampaign = () => {
    // In a real application, this would send data to the backend
    // For now, we'll just log the data.
    console.log("Creating new campaign with:", {
      campaignName,
      budget,
      bidStrategy,
      targetAccounts: selectedAccounts,
    });
    alert("New Campaign: " + campaignName + " created (frontend placeholder).");
    // Optionally reset form or navigate
  };

  const isFormValid = campaignName.trim() !== "" && budget.trim() !== "" && bidStrategy.trim() !== "";

  return (
    <div className="column">
      <div className="column-header">
        <h2>Create New Campaign</h2>
      </div>

      <div className="column-content">
        <div className="adset-form-container"> {/* Re-using adset-form-container for styling */}
          <input
            type="text"
            placeholder="Campaign Name*"
            className="config-adset-name"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            required
          />

          <div className="budget-input-wrapper">
            <span className="currency-prefix">$</span>
            <input
              type="number"
              placeholder="Daily Budget*"
              className="config-daily-budget"
              step="0.01"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              required
            />
            <span className="currency-suffix">/day</span>
          </div>

          <select
            className="status-dropdown" // Re-using for general dropdown styling
            value={bidStrategy}
            onChange={(e) => setBidStrategy(e.target.value)}
            required
          >
            <option value="">Select Bid Strategy*</option>
            <option value="LOWEST_COST_WITHOUT_CAP">LOWEST_COST_WITHOUT_CAP</option>
            <option value="TARGET_COST">TARGET_COST</option>
          </select>

          {/* More fields can be added here for full campaign creation */}

          <button
            className={`create-adset-btn ${isFormValid ? "active" : ""}`}
            onClick={handleCreateCampaign}
            disabled={!isFormValid}
          >
            Create Campaign
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateCampaignWorkflow;
