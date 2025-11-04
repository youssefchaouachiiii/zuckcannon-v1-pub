import React, { useState, useEffect } from "react";
import "./FacebookModal.css";

export default function FacebookModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [fbData, setFbData] = useState({
    adAccounts: [],
    pages: [],
    businesses: [],
  });

  useEffect(() => {
    if (isOpen) {
      loadFacebookData();
    }
  }, [isOpen]);

  const loadFacebookData = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/facebook/data");
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch Facebook data");
      }

      const data = await response.json();
      console.log("Facebook data loaded:", data);
      setIsConnected(data.connected);
      setFbData({
        adAccounts: data.adAccounts || [],
        pages: data.pages || [],
        businesses: data.businesses || [],
      });
    } catch (error) {
      console.error("Error loading Facebook modal:", error);
      setIsConnected(false);
      if (window.showError) {
        window.showError(error.message || "Failed to load Facebook data", 4000);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    window.location.href = "/auth/facebook";
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/facebook/sync", { method: "POST" });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // Handle rate limit error specifically
        if (response.status === 429) {
          const retryMinutes = Math.ceil((errorData.retryAfter || 300) / 60);
          throw new Error(`Facebook rate limit exceeded. Please wait ${retryMinutes} minutes and try again.`);
        }
        
        // Handle service unavailable (circuit breaker open)
        if (response.status === 503) {
          throw new Error(errorData.message || "Facebook API is temporarily unavailable. Please try again later.");
        }
        
        throw new Error(errorData.message || errorData.error || "Failed to sync Facebook data");
      }

      const result = await response.json();
      setFbData({
        adAccounts: result.data.adAccounts || [],
        pages: result.data.pages || [],
        businesses: result.data.businesses || [],
      });

      // Show success message
      if (window.showSuccess) {
        window.showSuccess("Facebook data synced successfully! Reloading page...", 2000);
      }
      
      // Reload page after short delay to update campaigns and accounts
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error("Error syncing Facebook data:", error);
      if (window.showError) {
        window.showError(error.message || "Failed to sync Facebook data. Please try again.", 6000);
      }
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm("Are you sure you want to disconnect your Facebook account?")) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/facebook/disconnect", { method: "POST" });
      if (!response.ok) throw new Error("Failed to disconnect Facebook");

      setIsConnected(false);
      setFbData({ adAccounts: [], pages: [], businesses: [] });

      if (window.showSuccess) {
        window.showSuccess("Facebook account disconnected successfully!", 3000);
      }
    } catch (error) {
      console.error("Error disconnecting Facebook:", error);
      if (window.showError) {
        window.showError("Failed to disconnect Facebook account. Please try again.", 4000);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal facebook-modal" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Facebook Account Connection</h2>
          <span className="close" onClick={onClose}>
            &times;
          </span>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="facebook-loading">
              <p>Loading...</p>
            </div>
          ) : isConnected ? (
            <div className="facebook-connected">
              <div className="facebook-status-success">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4BB543" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <p style={{ color: "#4BB543", fontWeight: 600, margin: "16px 0 8px 0" }}>Facebook Connected</p>
              </div>
              <div className="facebook-data-summary">
                <p>
                  <strong>Ad Accounts:</strong> <span>{fbData.adAccounts.length}</span>
                </p>
                <p>
                  <strong>Pages:</strong> <span>{fbData.pages.length}</span>
                </p>
                <p>
                  <strong>Businesses:</strong> <span>{fbData.businesses.length}</span>
                </p>
              </div>
              <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
                <button className="secondary-btn" onClick={handleSync}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: "6px" }}>
                    <path d="M23 4v6h-6"></path>
                    <path d="M1 20v-6h6"></path>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  Sync Data
                </button>
                <button className="danger-btn" onClick={handleDisconnect}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="facebook-not-connected">
              <p>Connect your Facebook account to manage your ad accounts, pages, and business portfolios directly.</p>
              <button className="primary-btn" onClick={handleConnect}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: "8px" }}>
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                Connect Facebook
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
