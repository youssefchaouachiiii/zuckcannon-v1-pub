import React, { useState } from "react";
import { BrowserRouter as Router } from "react-router-dom";
import { useUploadProtection } from "./hooks/useUploadProtection";
import { useFacebookConnection } from "./hooks/useFacebookConnection";
import { useAuth } from "./hooks/useAuth";
import { shouldUseMockData } from "./mockData";
import useStore from "./store/useStore";
import CampaignColumn from "./components/columns/CampaignColumn";
import ActionColumn from "./components/columns/ActionColumn";
import WorkflowColumn from "./components/columns/WorkflowColumn";
import WorkflowSelectionColumn from "./components/columns/WorkflowSelectionColumn";
import AccountColumn from "./components/columns/AccountColumn";
import ReviewColumn from "./components/columns/ReviewColumn";
import FacebookModal from "./components/FacebookModal";
import NotificationContainer from "./components/NotificationContainer";
import "./App.css";

function App() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFacebookModalOpen, setIsFacebookModalOpen] = useState(false);

  const workflow = useStore((state) => state.workflow);

  // Check authentication
  const { user, isAuthenticated, isLoading: isAuthLoading, logout } = useAuth();

  // Enable global upload protection
  useUploadProtection();

  // Check Facebook connection status
  const { isConnected: isFacebookConnected, isLoading: isFacebookLoading } = useFacebookConnection();

  // Show loading state while checking auth
  if (isAuthLoading) {
    return (
      <div className="app-container">
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  // Show login message if not authenticated
  // TEMPORARILY DISABLED - Allow viewing UI without login
  // if (!isAuthenticated) {
  //   return (
  //     <div className="app-container">
  //       <div className="auth-message" style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", flexDirection: "column" }}>
  //         <p style={{ fontSize: "18px", marginBottom: "20px" }}>Not authenticated.</p>
  //         <a href="/login.html" style={{ color: "#103dee", textDecoration: "underline" }}>
  //           Please login to view data.
  //         </a>
  //       </div>
  //     </div>
  //   );
  // }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetch("/api/refresh-meta-cache", { method: "POST" });
      window.location.reload();
    } catch (error) {
      console.error("Refresh failed:", error);
      setIsRefreshing(false);
    }
  };

  const useMockData = shouldUseMockData();

  return (
    <Router>
      <div className="app-container">
        {/* Mock Data Banner */}
        {useMockData && (
          <div
            style={{
              background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
              color: "white",
              padding: "8px 20px",
              textAlign: "center",
              fontSize: "14px",
              fontWeight: "500",
              borderBottom: "2px solid rgba(255,255,255,0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "20px" }}>🎭</span>
            <span>
              <strong>UI Development Mode</strong> - Using Mock Data (Backend tidak diperlukan)
            </span>
            <button
              onClick={() => {
                if (window.confirm("Matikan Mock Data Mode? Halaman akan di-reload.")) {
                  localStorage.removeItem("USE_MOCK_DATA");
                  window.location.reload();
                }
              }}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.4)",
                color: "white",
                padding: "4px 12px",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
                marginLeft: "12px",
              }}
            >
              Disable Mock Mode
            </button>
          </div>
        )}

        <header className="app-header">
          <h1>
            Bulk Uploader <span className="h1-version">v1.0</span>
            <button className={`refresh-data-btn ${isRefreshing ? "refreshing" : ""}`} onClick={handleRefresh} title="Refresh data from Facebook" disabled={isRefreshing}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6"></path>
                <path d="M1 20v-6h6"></path>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
          </h1>
          <div className="header-controls">
            <button className={`facebook-connect-btn ${isFacebookConnected ? "connected" : ""}`} onClick={() => setIsFacebookModalOpen(true)} title="Connect Facebook Account" disabled={isFacebookLoading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              <span className="facebook-status-text">{isFacebookConnected ? "Facebook Connected" : "Connect Facebook"}</span>
            </button>
            <span id="username-display">{user?.username || "User"}</span>
            <button className="logout-btn" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        <main className="main-content">
          <div className="columns-container">
            <WorkflowSelectionColumn />

            {workflow === "manage" ? (
              <>
                {/* Single-Campaign Management Workflow */}
                <CampaignColumn />
                <ActionColumn />
                <WorkflowColumn />
              </>
            ) : (
              <>
                {/* Bulk Upload Workflow */}
                <CampaignColumn />
                <AccountColumn />
                <ReviewColumn />
              </>
            )}
          </div>
        </main>

        {/* Facebook Connection Modal */}
        <FacebookModal isOpen={isFacebookModalOpen} onClose={() => setIsFacebookModalOpen(false)} />

        {/* Global Notification System */}
        <NotificationContainer />
      </div>
    </Router>
  );
}

export default App;
