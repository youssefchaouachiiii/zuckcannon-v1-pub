import { useState, useEffect } from "react";
import { mockUser, shouldUseMockData, mockApiDelay } from "../mockData";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = async () => {
    if (shouldUseMockData()) {
      console.log("--- USING MOCK AUTH DATA ---");
      await mockApiDelay();
      setUser(mockUser);
      setIsAuthenticated(true);
      setIsLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/auth/status");
      if (!response.ok) throw new Error("Failed to check auth status");

      const data = await response.json();
      setIsAuthenticated(data.authenticated);
      setUser(data.user);
    } catch (error) {
      console.error("Error checking auth status:", error);
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const logout = async () => {
    try {
      const response = await fetch("/logout", { method: "POST" });
      if (response.ok || response.redirected) {
        window.location.href = "/login.html";
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, isAuthenticated, isLoading, logout, checkAuth };
}
