import React, { useEffect, useState } from "react";
import useStore from "../../store/useStore";
import { shouldUseMockData, mockAdSets, mockApiDelay } from "../../mockData.js";
import "../columns/Column.css"; // Re-using general column styles

/**
 * AdSetList Component
 * Fetches and displays a list of ad sets for a given campaign.
 */
function AdSetList({ onAdSetSelect }) {
  const [adSets, setAdSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const selectedCampaign = useStore((state) => state.selectedCampaign);

  useEffect(() => {
    if (selectedCampaign) {
      fetchAdSets(selectedCampaign);
    }
  }, [selectedCampaign]);

  const fetchAdSets = async (campaignId) => {
    setLoading(true);
    try {
      if (shouldUseMockData()) {
        console.log("🎭 Using mock ad sets data");
        await mockApiDelay(500);
        const campaignAdSets = mockAdSets.filter((adSet) => adSet.campaign_id === campaignId);
        setAdSets(campaignAdSets);
      } else {
        // In a real app, you'd fetch adsets for the specific campaignId
        const response = await fetch(`/api/fetch-meta-data?campaign_id=${campaignId}`);
        const data = await response.json();
        setAdSets(data.ad_sets || []); // Assuming the API can return ad_sets
      }
    } catch (error) {
      console.error("Error fetching ad sets:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading ad sets...</div>;
  }

  if (adSets.length === 0) {
    return <div className="empty-state">No ad sets found for this campaign.</div>;
  }

  return (
    <div className="column-content" style={{ maxHeight: "100%" }}>
      <ul className="item-list">
        {adSets.map((adSet) => (
          <li key={adSet.id} className="item" onClick={() => onAdSetSelect(adSet)}>
            <span className="item-name">{adSet.name}</span>
            <span className="item-id">{adSet.id}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default AdSetList;
