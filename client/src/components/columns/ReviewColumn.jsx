import React from "react";
import useStore from "../../store/useStore";
import "./Column.css";

/**
 * Review and Upload Column (Column 4 - New)
 * Displays a summary of the selection and triggers the upload.
 */
function ReviewColumn() {
  const selectedCampaigns = useStore((state) => state.selectedCampaigns);
  const selectedAccounts = useStore((state) => state.selectedAccounts);

  const hasSelection = selectedCampaigns.length > 0 && selectedAccounts.length > 0;

  const handleUpload = () => {
    // This will trigger the backend API call
    alert(`Uploading ${selectedCampaigns.length} campaign(s) to ${selectedAccounts.length} account(s).`);
  };

  return (
    <div className="column">
      <div className="column-header">
        <h2>Review & Upload</h2>
      </div>

      {hasSelection ? (
        <div className="column-content">
          <div className="review-summary">
            <h4>Summary</h4>
            <p>
              <strong>Campaigns to Upload:</strong>
              <span>{selectedCampaigns.length}</span>
            </p>
            <p>
              <strong>Target Accounts:</strong>
              <span>{selectedAccounts.length}</span>
            </p>
          </div>
          <button className="upload-btn" onClick={handleUpload}>
            Confirm & Upload to Accounts
          </button>
        </div>
      ) : (
        <div className="empty-state">Please select campaigns and accounts to continue.</div>
      )}
    </div>
  );
}

export default ReviewColumn;
