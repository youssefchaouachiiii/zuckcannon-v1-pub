/**
 * Server-Sent Events (SSE) Utilities
 * Handles real-time updates for upload progress and Meta data sync
 */

// Upload session storage (for file upload progress)
export const uploadSessions = new Map();

// Meta data clients storage (for Facebook data sync updates)
export const metaDataClients = new Set();

/**
 * Send a Server-Sent Event message to a client
 * @param {Response} res - Express response object
 * @param {string} event - Event name
 * @param {Object} data - Data to send (will be JSON stringified)
 */
export function sendSSE(res, event, data) {
    try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (res.flush) res.flush();
    } catch (error) {
        console.error(`Error sending SSE event "${event}":`, error);
    }
}

/**
 * Create a new upload session
 * @returns {string} Session ID
 */
export function createUploadSession() {
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2, 9);

    uploadSessions.set(sessionId, {
        sessionId,
        totalFiles: 0,
        processedFiles: 0,
        currentFile: null,
        clients: new Set(),
        errors: [],
        createdAt: new Date(),
    });

    console.log(`Created upload session: ${sessionId}`);
    return sessionId;
}

/**
 * Get an upload session by ID
 * @param {string} sessionId - Session ID
 * @returns {Object|null} Session object or null if not found
 */
export function getUploadSession(sessionId) {
    return uploadSessions.get(sessionId) || null;
}

/**
 * Update upload session data
 * @param {string} sessionId - Session ID
 * @param {Object} updates - Partial updates to apply
 */
export function updateUploadSession(sessionId, updates) {
    const session = uploadSessions.get(sessionId);
    if (session) {
        Object.assign(session, updates);
    }
}

/**
 * Broadcast an event to all clients connected to a specific upload session
 * @param {string} sessionId - Session ID
 * @param {string} event - Event name
 * @param {Object} data - Data to broadcast
 */
export function broadcastToSession(sessionId, event, data) {
    const session = uploadSessions.get(sessionId);

    if (!session) {
        console.log(`No session found for broadcast: ${sessionId}`);
        return;
    }

    console.log(`Broadcasting ${event} to ${session.clients.size} clients:`, data);

    session.clients.forEach((client) => {
        try {
            sendSSE(client, event, data);
        } catch (err) {
            console.error("Error sending SSE to client:", err);
            session.clients.delete(client);
        }
    });
}

/**
 * Add a client to an upload session
 * @param {string} sessionId - Session ID
 * @param {Response} res - Express response object
 */
export function addClientToSession(sessionId, res) {
    const session = uploadSessions.get(sessionId);
    if (session) {
        session.clients.add(res);
        console.log(`Client connected to session ${sessionId}. Total clients: ${session.clients.size}`);
    }
}

/**
 * Remove a client from an upload session
 * @param {string} sessionId - Session ID
 * @param {Response} res - Express response object
 */
export function removeClientFromSession(sessionId, res) {
    const session = uploadSessions.get(sessionId);
    if (session) {
        session.clients.delete(res);
        console.log(`Client disconnected from session ${sessionId}. Remaining clients: ${session.clients.size}`);

        // Clean up session if no clients remain after a timeout
        if (session.clients.size === 0) {
            setTimeout(() => {
                if (session.clients.size === 0) {
                    uploadSessions.delete(sessionId);
                    console.log(`Cleaned up empty session: ${sessionId}`);
                }
            }, 60000); // 1 minute grace period
        }
    }
}

/**
 * Delete an upload session
 * @param {string} sessionId - Session ID
 */
export function deleteUploadSession(sessionId) {
    const deleted = uploadSessions.delete(sessionId);
    if (deleted) {
        console.log(`Deleted session: ${sessionId}`);
    }
    return deleted;
}

/**
 * Broadcast Meta data updates to all connected clients
 * @param {string} event - Event name
 * @param {Object} data - Data to broadcast
 */
export function broadcastMetaDataUpdate(event, data) {
    console.log(`Broadcasting Meta data update: ${event} to ${metaDataClients.size} clients`);

    metaDataClients.forEach((client) => {
        try {
            sendSSE(client, event, data);
        } catch (err) {
            console.error("Error sending Meta data SSE:", err);
            metaDataClients.delete(client);
        }
    });
}

/**
 * Add a client to Meta data updates
 * @param {Response} res - Express response object
 */
export function addMetaDataClient(res) {
    metaDataClients.add(res);
    console.log(`Meta data client connected. Total clients: ${metaDataClients.size}`);
}

/**
 * Remove a client from Meta data updates
 * @param {Response} res - Express response object
 */
export function removeMetaDataClient(res) {
    metaDataClients.delete(res);
    console.log(`Meta data client disconnected. Remaining clients: ${metaDataClients.size}`);
}

/**
 * Setup SSE response headers
 * @param {Response} res - Express response object
 */
export function setupSSEHeaders(res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
    });
}

/**
 * Setup SSE keep-alive ping
 * @param {Response} res - Express response object
 * @param {number} interval - Ping interval in milliseconds (default: 30 seconds)
 * @returns {NodeJS.Timeout} Interval timer
 */
export function setupSSEKeepAlive(res, interval = 30000) {
    return setInterval(() => {
        try {
            res.write(":keep-alive\n\n");
        } catch (error) {
            console.error("Error sending keep-alive ping:", error);
        }
    }, interval);
}

/**
 * Get session statistics
 * @returns {Object} Session statistics
 */
export function getSessionStats() {
    return {
        uploadSessions: {
            total: uploadSessions.size,
            sessions: Array.from(uploadSessions.values()).map(s => ({
                id: s.sessionId,
                totalFiles: s.totalFiles,
                processedFiles: s.processedFiles,
                clients: s.clients.size,
                errors: s.errors.length,
                createdAt: s.createdAt,
            })),
        },
        metaDataClients: {
            total: metaDataClients.size,
        },
    };
}