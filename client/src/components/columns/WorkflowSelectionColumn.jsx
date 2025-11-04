import React from "react";
import useStore from "../../store/useStore";
import "./Column.css";

/**
 * Workflow Selection Column (Column 1)
 * Allows the user to choose the desired top-level workflow.
 */
function WorkflowSelectionColumn() {
  const workflow = useStore((state) => state.workflow);
  const setWorkflow = useStore((state) => state.setWorkflow);

  return (
    <div className="column">
      <div className="column-header">
        <h2>Select Workflow</h2>
      </div>

      <div className="column-content">
        <ul className="item-list">
          <li
            className={`action-item ${workflow === "manage" ? "selected" : ""}`}
            onClick={() => setWorkflow("manage")}
          >
            Manage Campaign
          </li>
          <li
            className={`action-item ${workflow === "bulk_upload" ? "selected" : ""}`}
            onClick={() => setWorkflow("bulk_upload")}
          >
            Bulk Upload Campaigns
          </li>
        </ul>
      </div>
    </div>
  );
}

export default WorkflowSelectionColumn;
