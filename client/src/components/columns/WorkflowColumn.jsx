import React, { useState, useEffect } from "react";
import useStore from "../../store/useStore";
import UploadWorkflow from "../workflows/UploadWorkflow";
import AdSetList from "../workflows/AdSetList";
import CreativeUpload from "../workflows/CreativeUpload";
import "./Column.css";

/**
 * Workflow Column (Column 4)
 * Dynamic content based on selected action
 */
function WorkflowColumn() {
  const selectedAction = useStore((state) => state.selectedAction);
  const [selectedAdSet, setSelectedAdSet] = useState(null);

  // Reset local state when the global action changes
  useEffect(() => {
    setSelectedAdSet(null);
  }, [selectedAction]);

  if (!selectedAction) {
    return null; // Don't render if no action is selected
  }

  const handleUploadComplete = (result) => {
    console.log("Upload completed:", result);
    window.showSuccess?.("Creatives uploaded successfully!");
    // Optionally reset to ad set list
    setTimeout(() => {
      setSelectedAdSet(null);
    }, 2000);
  };

  const handleBackToAdSetList = () => {
    setSelectedAdSet(null);
  };

  const renderWorkflow = () => {
    switch (selectedAction) {
      case "create-new":
        return <UploadWorkflow />;

      case "upload-existing":
        if (!selectedAdSet) {
          return <AdSetList onAdSetSelect={setSelectedAdSet} />;
        }
        return (
          <div>
            <button className="back-to-list-btn" onClick={handleBackToAdSetList} style={{ margin: "0 0 16px 16px" }}>
              ← Back to Ad Set List
            </button>
            <CreativeUpload adSetId={selectedAdSet.id} adSetName={selectedAdSet.name} onUploadComplete={handleUploadComplete} />
          </div>
        );

      case "duplicate-existing":
        if (!selectedAdSet) {
          return <AdSetList onAdSetSelect={setSelectedAdSet} />;
        }
        return (
          <div>
            <button className="back-to-list-btn" onClick={handleBackToAdSetList} style={{ margin: "0 0 16px 16px" }}>
              ← Back to Ad Set List
            </button>
            <div style={{ padding: "16px", background: "#f8f9fa", borderRadius: "8px", margin: "0 16px 16px 16px" }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: "16px" }}>Duplicating Ad Set</h3>
              <p style={{ margin: 0, color: "#666", fontSize: "14px" }}>
                <strong>{selectedAdSet.name}</strong>
              </p>
              <p style={{ margin: "8px 0 0 0", fontSize: "12px", color: "#888" }}>
                Budget: ${selectedAdSet.daily_budget}/day • Status: {selectedAdSet.status}
              </p>
            </div>
            <CreativeUpload adSetId={selectedAdSet.id} adSetName={`${selectedAdSet.name} (Copy)`} onUploadComplete={handleUploadComplete} />
          </div>
        );

      case "duplicate-campaign":
        // This action is handled directly in ActionColumn, so nothing to show here.
        return null;

      default:
        return null;
    }
  };

  return <div className="column">{renderWorkflow()}</div>;
}

export default WorkflowColumn;
