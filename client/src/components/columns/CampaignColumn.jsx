import React, { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { useNavigationGuard } from "../../hooks/useUploadProtection";
import "./Column.css";

/**
 * Campaign Selection Column (Column 2)
 * Displays campaigns for selected account
 */
function CampaignColumn() {
  const [campaigns, setCampaigns] = useState([]);
  const [filteredCampaigns, setFilteredCampaigns] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  const selectedAccount = useStore((state) => state.selectedAccount);
  const selectedCampaign = useStore((state) => state.selectedCampaign);
  const setSelectedCampaign = useStore((state) => state.setSelectedCampaign);
  const { shouldBlock, checkNavigation } = useNavigationGuard();

  useEffect(() => {
    if (selectedAccount) {
      fetchCampaigns();
    } else {
      setCampaigns([]);
      setFilteredCampaigns([]);
    }
  }, [selectedAccount]);

  useEffect(() => {
    filterCampaigns(searchTerm);
  }, [campaigns, searchTerm]);

  const fetchCampaigns = async () => {
    try {
      const response = await fetch("/api/fetch-meta-data");
      const data = await response.json();
      const accountCampaigns = data.campaigns?.filter((c) => c.account_id === selectedAccount) || [];

      // Sort: ACTIVE first, then by created_time
      const sorted = accountCampaigns.sort((a, b) => {
        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
        return new Date(b.created_time) - new Date(a.created_time);
      });

      setCampaigns(sorted);
    } catch (error) {
      console.error("Error fetching campaigns:", error);
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
    // Check if upload is in progress
    if (shouldBlock && !checkNavigation(campaign.name)) {
      return;
    }

    setSelectedCampaign(campaign.id, campaign.bid_strategy, campaign.daily_budget);
  };

  if (!selectedAccount) {
    return null;
  }

  return (
    <div className="column">
      <div className="column-header">
        <h2>Select Campaign</h2>
      </div>

      <input type="text" placeholder="Search campaigns..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="search-input" />

      <div className="column-content">
        {filteredCampaigns.length === 0 ? (
          <div className="empty-state">{campaigns.length === 0 ? "No campaigns found" : "No campaigns match your search"}</div>
        ) : (
          <div>
            {filteredCampaigns.map((campaign) => (
              <div key={campaign.id} className={`campaign-item ${selectedCampaign === campaign.id ? "selected" : ""} ${campaign.status === "ACTIVE" ? "active" : ""}`} onClick={() => handleCampaignClick(campaign)}>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default CampaignColumn;
