import axios from "axios";

/**
 * Circuit Breaker Pattern Implementation
 * Provides fault tolerance for external API calls
 */
export class CircuitBreaker {
    constructor(name, timeout = 60000) {
        this.name = name;
        this.failureCount = 0;
        this.failureThreshold = 5;
        this.timeout = timeout;
        this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
        this.nextAttempt = Date.now();
    }

    /**
     * Execute a function with circuit breaker protection
     * @param {Function} fn - Async function to execute
     * @returns {Promise} Result of the function
     */
    async call(fn) {
        if (this.state === "OPEN") {
            if (Date.now() < this.nextAttempt) {
                throw new Error(`Circuit breaker is OPEN for ${this.name}`);
            }
            this.state = "HALF_OPEN";
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * Handle successful execution
     */
    onSuccess() {
        this.failureCount = 0;
        this.state = "CLOSED";
    }

    /**
     * Handle failed execution
     */
    onFailure() {
        this.failureCount++;
        if (this.failureCount >= this.failureThreshold) {
            this.state = "OPEN";
            this.nextAttempt = Date.now() + this.timeout;
            console.error(
                `Circuit breaker opened for ${this.name}. Will retry after ${new Date(
                    this.nextAttempt
                )}`
            );

            // Only notify for critical services
            if (this.name === "Facebook API") {
                const telegramMessage = `<b>🔴 CRITICAL: Facebook API Circuit Breaker Opened</b>\n<b>Service Down - Multiple Failures Detected</b>\n<b>Next Retry:</b> ${new Date(
                    this.nextAttempt
                ).toLocaleString()}`;
                sendTelegramNotification(telegramMessage).catch((err) =>
                    console.error("Failed to send Telegram notification:", err)
                );
            }
        }
    }

    /**
     * Get current circuit breaker state
     * @returns {Object} Current state information
     */
    getState() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            nextAttempt: this.state === "OPEN" ? new Date(this.nextAttempt) : null,
        };
    }

    /**
     * Reset circuit breaker to initial state
     */
    reset() {
        this.failureCount = 0;
        this.state = "CLOSED";
        this.nextAttempt = Date.now();
        console.log(`Circuit breaker reset for ${this.name}`);
    }
}

/**
 * Send Telegram notification for critical errors
 * @param {string} message - Message to send
 * @param {boolean} isError - Whether this is an error notification
 */
async function sendTelegramNotification(message, isError = true) {
    try {
        if (!process.env.TELEGRAM_BOT_TOKEN) {
            console.log("Telegram bot token not configured");
            return;
        }

        const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;

        // Format the message with HTML
        const timestamp = new Date().toLocaleString();
        const serverName = process.env.SERVER_NAME || "MetaMass Server";
        const environment = process.env.NODE_ENV || "development";

        let formattedMessage = `<b>${
            isError ? "🚨 ERROR" : "ℹ️ INFO"
        } - ${serverName}</b>\n`;
        formattedMessage += `<b>Environment:</b> ${environment}\n`;
        formattedMessage += `<b>Time:</b> ${timestamp}\n`;
        formattedMessage += `<b>Message:</b>\n${message}`;

        const response = await axios.post(url, {
            chat_id: process.env.TELEGRAM_CHAT_ID || 5008532894,
            text: formattedMessage,
            parse_mode: "HTML",
        });

        if (response.data.ok) {
            console.log("Telegram notification sent successfully");
        }
    } catch (error) {
        // Don't throw error to avoid breaking the main flow
        console.error("Failed to send Telegram notification:", error.message);
    }
}

// Initialize circuit breakers for external services
export const circuitBreakers = {
    facebook: new CircuitBreaker("Facebook API", 60000),
    google: new CircuitBreaker("Google Drive API", 60000),
};

/**
 * Get status of all circuit breakers
 * @returns {Object} Status of all circuit breakers
 */
export function getAllCircuitBreakerStates() {
    const states = {};
    for (const [key, breaker] of Object.entries(circuitBreakers)) {
        states[key] = breaker.getState();
    }
    return states;
}

/**
 * Reset all circuit breakers
 */
export function resetAllCircuitBreakers() {
    for (const breaker of Object.values(circuitBreakers)) {
        breaker.reset();
    }
    console.log("All circuit breakers reset");
}

/**
 * Export Telegram notification function for use in other modules
 */
export { sendTelegramNotification };