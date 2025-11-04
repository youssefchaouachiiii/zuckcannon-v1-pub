import React, { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { shouldUseMockData, mockCampaigns, mockApiDelay } from "../../mockData";
import CreateCampaignWorkflow from "./CreateCampaignWorkflow";
import "./Column.css";

/**
 * Campaign Column (Column 2)
 * A dynamic column that handles both single-select for campaign management
 * and multi-select for bulk uploading.
 */
function CampaignColumn() {
  const [campaigns, setCampaigns] = useState([]);
  const [filteredCampaigns, setFilteredCampaigns] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  // State selectors from Zustand store
  const workflow = useStore((state) => state.workflow);
  const manageMode = useStore((state) => state.manageMode);
  const setManageMode = useStore((state) => state.setManageMode);
  const selectedCampaign = useStore((state) => state.selectedCampaign);
  const setSelectedCampaign = useStore((state) => state.setSelectedCampaign);
  const selectedCampaigns = useStore((state) => state.selectedCampaigns);
  const toggleCampaignSelection = useStore((state) => state.toggleCampaignSelection);

  useEffect(() => {
    // Fetch campaigns only when needed
    if ((workflow === "manage" && manageMode === "select_existing") || workflow === "bulk_upload") {
      fetchCampaigns();
    }
  }, [workflow, manageMode]);

  useEffect(() => {
    filterCampaigns(searchTerm);
  }, [campaigns, searchTerm]);

  const fetchCampaigns = async () => {
    try {
      if (shouldUseMockData()) {
        console.log("🎭 Using all mock campaigns data");
        await mockApiDelay(500);
        const sorted = [...mockCampaigns].sort((a, b) => {
          if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
          if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
          return new Date(b.created_time) - new Date(a.created_time);
        });
        setCampaigns(sorted);
        return;
      }

      // Use /api/meta-data endpoint to get all campaigns from OAuth system
      const response = await fetch("/api/meta-data");
      if (!response.ok) {
        throw new Error("Failed to fetch campaigns");
      }
      
      const data = await response.json();
      
      // Check if user is connected
      if (!data.isConnected) {
        console.log("Facebook not connected via OAuth");
        setCampaigns([]);
        return;
      }
      
      const allCampaigns = data.campaigns || [];
      const sorted = allCampaigns.sort((a, b) => {
        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
        return new Date(b.created_time) - new Date(a.created_time);
      });
      setCampaigns(sorted);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
      if (window.showError) {
        window.showError("Failed to load campaigns. Please try again.", 3000);
      }
    }
  };

  const filterCampaigns = (term) => {
    if (!term.trim()) {
      setFilteredCampaigns(campaigns);
      return;
    }
    const filtered = campaigns.filter((campaign) => campaign.name.toLowerCase().includes(term.toLowerCase()));
    setFilteredCampaigns(filtered);
  };

  const handleCampaignClick = (campaign) => {
    if (workflow === "manage") {
      setSelectedCampaign(campaign.id, campaign.bid_strategy, campaign.daily_budget);
    } else if (workflow === "bulk_upload") {
      toggleCampaignSelection(campaign.id);
    }
  };

  const renderCampaignList = () => (
    <>
      <input type="text" placeholder="Search campaigns..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />
      <div className="column-content">
        {filteredCampaigns.length === 0 ? (
          <div className="empty-state">{campaigns.length === 0 ? "No campaigns found" : "No campaigns match your search"}</div>
        ) : (
          <div>
            {filteredCampaigns.map((campaign) => {
              const isSelected = workflow === "manage" ? selectedCampaign === campaign.id : selectedCampaigns.includes(campaign.id);
              return (
                <div
                  key={campaign.id}
                  className={`campaign-item ${isSelected ? "selected" : ""} ${campaign.status === "ACTIVE" ? "active" : ""}`}
                  onClick={() => handleCampaignClick(campaign)}
                >
                  <h3>{campaign.name}</h3>
                  <ul>
                    <li>{campaign.status}</li>
                    {campaign.insights?.data?.[0] && (
                      <>
                        <li>Spend: ${campaign.insights.data[0].spend}</li>
                        <li>Clicks: {campaign.insights.data[0].clicks}</li>
                      </>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  if (workflow === "manage") {
    return (
      <div className="column">
        <div className="column-header">
          <h2>Manage Campaign</h2>
        </div>
        <div className="sub-workflow-selector">
          <button className={manageMode === "select_existing" ? "active" : ""} onClick={() => setManageMode("select_existing")}>
            Select Existing
          </button>
          <button className={manageMode === "create_new" ? "active" : ""} onClick={() => setManageMode("create_new")}>
            Create New
          </button>
        </div>
        {manageMode === "select_existing" ? renderCampaignList() : <CreateCampaignWorkflow />}
      </div>
    );
  }

  // Render for 'bulk_upload' workflow
  return (
    <div className="column">
      <div className="column-header">
        <h2>Select Campaign(s) for Bulk Upload</h2>
      </div>
      {renderCampaignList()}
    </div>
  );
}

export default CampaignColumn;
