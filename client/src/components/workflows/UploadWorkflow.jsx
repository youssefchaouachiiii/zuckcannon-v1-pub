import React, { useState } from "react";
import useStore from "../../store/useStore";
import { useUploadProtection } from "../../hooks/useUploadProtection";
import "./UploadWorkflow.css";

/**
 * Upload Workflow Component matching the original design
 */
function UploadWorkflow() {
  const [currentStep, setCurrentStep] = useState("config"); // 'config', 'upload', 'copy'
  const [files, setFiles] = useState([]);

  const selectedAccount = useStore((state) => state.selectedAccount);
  const selectedCampaign = useStore((state) => state.selectedCampaign);

  // Enable upload protection
  useUploadProtection();

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    setFiles(selectedFiles);
    if (selectedFiles.length > 0) {
      setCurrentStep("upload");
    }
  };

  return (
    <div className="upload-column">
      {/* Ad Set Configuration */}
      <div className="adset-config">
        <h2>Ad Set Configuration</h2>
        <div className="adset-form-container">
          <input type="text" value={selectedCampaign || "Campaign Id"} className="preselect config-campaign-id" readOnly />
          <input type="text" value="WEBSITE" className="preselect config-destination-type" readOnly />
          <input type="text" value="OFFSITE_CONVERSIONS" className="preselect config-optimization-goal" readOnly />
          <input type="text" value="IMPRESSIONS" className="preselect config-billing-event" readOnly />
          <input type="text" value="LOWEST_COST_WITHOUT_CAP" className="preselect config-bid-strategy" readOnly />
          <input type="text" placeholder="Ad Set Name*" className="config-adset-name" required />

          <select className="status-dropdown">
            <option value="">Status*</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAUSED">PAUSED</option>
          </select>

          <select className="pixel-dropdown">
            <option value="">Pixel*</option>
          </select>

          <input type="text" placeholder="Custom Event Type*" className="config-event-type" required readOnly />

          <div className="budget-input-wrapper">
            <span className="currency-prefix">$</span>
            <input type="number" placeholder="100" className="config-daily-budget" step="0.01" min="0" />
            <span className="currency-suffix">/day</span>
          </div>

          <div className="budget-input-wrapper">
            <span className="currency-prefix">$</span>
            <input type="number" placeholder="12.50" className="config-cost-per-result-goal" step="0.01" min="0" />
            <span className="currency-suffix">per result</span>
          </div>

          <div className="targeting-age">
            <input type="number" placeholder="Min Age*" className="min-age" required />
            <input type="number" placeholder="Max Age*" className="max-age" required />
          </div>

          <input type="text" placeholder="Type to search countries*" className="country-search-input" />

          <input type="text" placeholder="Type to search regions" className="region-search-input" />

          <button className="create-adset-btn">Create Ad Set</button>
        </div>
      </div>

      {/* Creative Upload */}
      <div className="creative-upload">
        <h2>Creative Upload</h2>
        <div className="file-drop-zone">
          <p className="drop-zone-text">
            Drag & drop <strong>images and videos</strong> here <br />
            <br />
            or
          </p>
          <input type="file" multiple accept="image/*,video/*" onChange={handleFileSelect} id="file-upload" style={{ display: "none" }} />
          <label htmlFor="file-upload" className="browse-btn">
            Browse Files
          </label>

          <div className="gdrive-input-container">
            <p style={{ margin: "15px 0 10px 0", color: "#666", fontSize: "14px" }}>or</p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="text" className="gdrive-link-input" placeholder="Paste Google Drive link..." />
              <button className="gdrive-fetch-btn">Fetch</button>
            </div>
          </div>

          <div className="creative-library-link-container">
            <p style={{ margin: "10px 0", color: "#666", fontSize: "14px" }}>or</p>
            <button className="open-library-btn">📚 Browse Creative Library</button>
          </div>
        </div>

        {files.length > 0 && (
          <div className="uploaded-files-list">
            <h3>{files.length} file(s) selected</h3>
            <ul>
              {files.map((file, index) => (
                <li key={index}>
                  {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </li>
              ))}
            </ul>
            <button className="upload-btn">Upload Creatives</button>
            <button className="back-btn">← Clear All Files</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadWorkflow;
