import { useState, useEffect } from "react";
import { shouldUseMockData, mockFacebookConnection, mockApiDelay } from "../mockData";

export function useFacebookConnection() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkStatus = async () => {
    if (shouldUseMockData()) {
      console.log("--- USING MOCK FACEBOOK CONNECTION DATA ---");
      await mockApiDelay();
      setIsConnected(mockFacebookConnection.connected);
      setIsLoading(false);
      return;
    }

    try {
      // Use the /api/meta-data endpoint (now uses OAuth system)
      const response = await fetch("/api/meta-data");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to check Facebook status");
      }

      const data = await response.json();
      console.log("Facebook connection status (OAuth):", data);
      
      // Connected if isConnected is true and we have at least one ad account
      setIsConnected(data.isConnected === true && data.accounts && data.accounts.length > 0);
    } catch (error) {
      console.error("Error checking Facebook status:", error);
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();

    // Check for Facebook OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("facebook_connected") === "true") {
      if (window.showSuccess) {
        window.showSuccess("Facebook account connected successfully!", 4000);
      }
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      // Re-check status
      checkStatus();
    } else if (urlParams.get("facebook_error") === "true") {
      if (window.showError) {
        window.showError("Failed to connect Facebook account. Please try again.", 5000);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return { isConnected, isLoading, checkStatus };
}
