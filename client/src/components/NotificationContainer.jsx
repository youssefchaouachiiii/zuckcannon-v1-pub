import React, { useState, useEffect, useCallback } from "react";
import "./Notification.css";

let notificationQueue = [];
let addNotificationCallback = null;

// Global functions accessible from window
window.showError = (message, duration = 5000) => {
  if (addNotificationCallback) {
    addNotificationCallback(message, "error", duration);
  }
};

window.showSuccess = (message, duration = 3000) => {
  if (addNotificationCallback) {
    addNotificationCallback(message, "success", duration);
  }
};

window.showWarning = (message, duration = 4000) => {
  if (addNotificationCallback) {
    addNotificationCallback(message, "warning", duration);
  }
};

export default function NotificationContainer() {
  const [notifications, setNotifications] = useState([]);

  const addNotification = useCallback((message, type, duration) => {
    const id = Date.now() + Math.random();
    const notification = { id, message, type, duration };

    setNotifications((prev) => [...prev, notification]);

    if (duration > 0) {
      setTimeout(() => {
        removeNotification(id);
      }, duration);
    }
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    // Register global callback
    addNotificationCallback = addNotification;

    // Global error handlers
    const handleError = (e) => {
      console.error("Global error:", e);
      addNotification("An unexpected error occurred", "error", 5000);
    };

    const handleUnhandledRejection = (e) => {
      console.error("Unhandled promise rejection:", e);
      addNotification("An unexpected error occurred", "error", 5000);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      addNotificationCallback = null;
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, [addNotification]);

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <div key={notification.id} className={`notification notification-${notification.type}`}>
          <span>{notification.message}</span>
          <button className="notification-close" onClick={() => removeNotification(notification.id)}>
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
