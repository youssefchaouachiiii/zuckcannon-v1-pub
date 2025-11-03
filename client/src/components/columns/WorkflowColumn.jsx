import React from "react";
import useStore from "../../store/useStore";
import UploadWorkflow from "../workflows/UploadWorkflow";
import "./Column.css";

/**
 * Workflow Column (Column 4)
 * Dynamic content based on selected action
 */
function WorkflowColumn() {
  const selectedCampaign = useStore((state) => state.selectedCampaign);

  if (!selectedCampaign) {
    return null;
  }

  return (
    <div className="column">
      <UploadWorkflow />
    </div>
  );
}

export default WorkflowColumn;
