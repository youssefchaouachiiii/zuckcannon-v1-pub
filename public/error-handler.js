// Frontend error handling and user feedback system

class ErrorHandler {
  constructor() {
    this.errorContainer = null;
    this.errorQueue = [];
    this.init();
  }

  init() {
    // Create error container if it doesn't exist
    this.createErrorContainer();
    
    // Setup global error handlers
    window.addEventListener('error', (e) => {
      console.error('Global error:', e);
      this.showError('An unexpected error occurred', 'error');
    });

    window.addEventListener('unhandledrejection', (e) => {
      console.error('Unhandled promise rejection:', e);
      this.showError('An unexpected error occurred', 'error');
    });

    // Intercept fetch errors
    this.interceptFetch();
  }

  createErrorContainer() {
    this.errorContainer = document.createElement('div');
    this.errorContainer.id = 'error-container';
    this.errorContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      max-width: 400px;
    `;
    document.body.appendChild(this.errorContainer);
  }

  showError(message, type = 'error', duration = 5000) {
    const errorEl = document.createElement('div');
    errorEl.className = `error-notification ${type}`;
    errorEl.style.cssText = `
      background: ${type === 'error' ? '#f44336' : type === 'warning' ? '#ff9800' : '#4caf50'};
      color: white;
      padding: 16px;
      margin-bottom: 10px;
      border-radius: 4px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      display: flex;
      justify-content: space-between;
      align-items: center;
      animation: slideIn 0.3s ease-out;
    `;

    errorEl.innerHTML = `
      <span>${this.escapeHtml(message)}</span>
      <button onclick="this.parentElement.remove()" style="
        background: none;
        border: none;
        color: white;
        font-size: 20px;
        cursor: pointer;
        margin-left: 10px;
      ">&times;</button>
    `;

    this.errorContainer.appendChild(errorEl);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        if (errorEl.parentElement) {
          errorEl.style.animation = 'slideOut 0.3s ease-out';
          setTimeout(() => errorEl.remove(), 300);
        }
      }, duration);
    }
  }

  showSuccess(message, duration = 3000) {
    this.showError(message, 'success', duration);
  }

  showWarning(message, duration = 4000) {
    this.showError(message, 'warning', duration);
  }

  escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        
        // Handle non-OK responses
        if (!response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            const message = error.error || error.message || `HTTP ${response.status} error`;
            
            // Show user-friendly error messages
            this.handleApiError(response.status, message);
          }
        }
        
        return response;
      } catch (err) {
        // Network errors
        if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
          this.showError('Network error: Please check your connection', 'error');
        } else {
          this.showError('Request failed: ' + err.message, 'error');
        }
        throw err;
      }
    };
  }

  handleApiError(status, message) {
    switch (status) {
      case 400:
        this.showError(`Invalid request: ${message}`, 'warning');
        break;
      case 401:
        this.showError('Session expired. Please login again.', 'error');
        setTimeout(() => window.location.href = '/login.html', 2000);
        break;
      case 403:
        this.showError('Access denied', 'error');
        break;
      case 404:
        this.showError('Resource not found', 'warning');
        break;
      case 429:
        this.showError('Too many requests. Please slow down.', 'warning');
        break;
      case 500:
      case 502:
      case 503:
        this.showError('Server error. Please try again later.', 'error');
        break;
      default:
        this.showError(message || `Error: ${status}`, 'error');
    }
  }
}

// CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Initialize error handler
window.errorHandler = new ErrorHandler();

// Helper functions for manual error handling
window.showError = (message, duration) => window.errorHandler.showError(message, 'error', duration);
window.showSuccess = (message, duration) => window.errorHandler.showSuccess(message, duration);
window.showWarning = (message, duration) => window.errorHandler.showWarning(message, duration);