import React from "react";
import useStore from "../../store/useStore";
import "./Column.css";

/**
 * Action Selection Column (Column 3)
 * Shows available actions for selected campaign
 */
function ActionColumn() {
  const selectedCampaign = useStore((state) => state.selectedCampaign);
  const [selectedAction, setSelectedAction] = React.useState(null);

  const handleActionClick = (action) => {
    setSelectedAction(action);
  };

  if (!selectedCampaign) {
    return null;
  }

  return (
    <div className="column">
      <div className="column-header">
        <h2>Select Action</h2>
      </div>

      <div className="column-content">
        <ul className="item-list">
          <li className={`action-item ${selectedAction === "duplicate-campaign" ? "selected" : ""}`} onClick={() => handleActionClick("duplicate-campaign")}>
            Duplicate <strong>Campaign</strong>
          </li>
          <li className={`action-item ${selectedAction === "create-new" ? "selected" : ""}`} onClick={() => handleActionClick("create-new")}>
            Create New <strong>Ad Set</strong>
          </li>
          <li className={`action-item ${selectedAction === "upload-existing" ? "selected" : ""}`} onClick={() => handleActionClick("upload-existing")}>
            Upload to Existing <strong>Ad Set</strong>
          </li>
          <li className={`action-item ${selectedAction === "duplicate-existing" ? "selected" : ""}`} onClick={() => handleActionClick("duplicate-existing")}>
            Duplicate Existing <strong>Ad Set</strong>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default ActionColumn;
