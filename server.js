// Imports
import fs from "fs";
import axios from "axios";
import express from "express";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import dotenv from "dotenv";
import passport from "passport";
import session from "express-session";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { CreativeDB, CreativeAccountDB, BatchDB } from "./backend/utils/database.js";
import { processCreative, updateCreativeThumbnail, getCreativeFilePath, getThumbnailFilePath } from "./backend/utils/creative-utils.js";
import { FacebookCacheDB } from "./backend/utils/facebook-cache-db.js";
import { FacebookAuthDB } from "./backend/utils/facebook-auth-db.js";
import { UserDB } from "./backend/auth/auth-db.js";
import { configurePassport, ensureAuthenticated, ensureAuthenticatedAPI, ensureNotAuthenticated } from "./backend/auth/passport-config.js";
import { validateRequest, loginRateLimiter, apiRateLimiter } from "./backend/middleware/validation.js";
import { getPaths } from "./backend/utils/paths.js";
import { setupHttpsServer } from "./backend/utils/https-config.js";

// ffmpeg set up
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
ffmpeg.setFfmpegPath(ffmpegPath);

// Multer set up
const paths = getPaths();
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure uploads directory exists
    const uploadDir = paths.uploads;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

dotenv.config();

const upload = multer({
  storage,
  limits: {
    fileSize: 4 * 1024 * 1024 * 1024, // 4GB limit per file
  },
});

// Express server set up
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 6969;
const isProduction = process.env.NODE_ENV === "production";

// Security Configuration
// Enable trust proxy for production (when behind a reverse proxy like Nginx)
if (isProduction) {
  app.set("trust proxy", 1);
}

// Enable compression for all responses
app.use(compression());

// Configure CORS
const corsOptions = {
  origin: function (origin, callback) {
    // In production, use FRONTEND_URL from environment
    const allowedOrigins = isProduction
      ? process.env.FRONTEND_URL
        ? [process.env.FRONTEND_URL, process.env.FRONTEND_URL.replace("https://", "https://www.")]
        : ["*"]
      : [
          "http://localhost:3000",
          "https://localhost:3000", // React client with HTTPS
          "http://localhost:6969",
          "https://localhost:6969",
          "http://localhost:5173",
          "https://localhost:5173",
        ];

    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);

    // Allow all origins if * is specified (not recommended for production)
    if (allowedOrigins.includes("*")) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // Allow credentials (cookies, authorization headers)
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));

// Security headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // Removed unsafe-eval for security
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "https://graph.facebook.com", "https://www.googleapis.com"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false, // May need to be false for some external resources
  })
);

// Configure session before passport
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    console.error("FATAL: SESSION_SECRET not set in production! Exiting...");
    process.exit(1);
  }
  console.warn("WARNING: Using default SESSION_SECRET in development only");
}

const sessionConfig = {
  secret: sessionSecret || "dev-secret-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction, // Only use secure cookies in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: isProduction ? "lax" : "strict", // Use 'lax' in production for redirects
  },
};

// In production, we need to trust the proxy for secure cookies
if (isProduction) {
  sessionConfig.proxy = true; // Trust the proxy
}

// Log session config without sensitive data
console.info("Session config:", {
  isProduction,
  cookieSecure: sessionConfig.cookie.secure,
  sameSite: sessionConfig.cookie.sameSite,
  proxy: sessionConfig.proxy,
  hasSecret: !!sessionSecret,
});

app.use(session(sessionConfig));

// Initialize Passport
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(paths.uploads));

// Apply rate limiting to API routes
app.use("/api/", apiRateLimiter);

// Facebook Graph API credentials
const api_version = "v24.0";
const access_token = process.env.META_ACCESS_TOKEN;
const system_user_id = process.env.META_SYSTEM_USER_ID;

// Helper function to get access token (user-specific or system user fallback)
async function getAccessToken(userId = null) {
  // If userId is provided, try to get user-specific token first
  if (userId) {
    try {
      const tokenData = await FacebookAuthDB.getValidToken(userId);
      if (tokenData) {
        console.log(`Using user-specific token for user ${userId}`);
        return tokenData.access_token;
      }
    } catch (error) {
      console.error("Error fetching user token, falling back to system token:", error);
    }
  }

  // Fallback to system user token
  if (!access_token) {
    throw new Error("No Facebook access token available. Please connect your Facebook account or configure META_ACCESS_TOKEN.");
  }

  console.log("Using system user token");
  return access_token;
}

// Helper function to get user ID from request
function getUserId(req) {
  if (process.env.NODE_ENV === "development") {
    return 1; // Development mode user ID
  }
  return req.user?.id || null;
}

// Google OAuth2 setup
const oauth2Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// SSE Upload Progress Management
const uploadSessions = new Map();

// Circuit Breaker for external API calls
class CircuitBreaker {
  constructor(name, timeout = 60000) {
    this.name = name;
    this.failureCount = 0;
    this.failureThreshold = 5;
    this.timeout = timeout;
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.nextAttempt = Date.now();
  }

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

  onSuccess() {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  onFailure() {
    this.failureCount++;
    if (this.failureCount >= this.failureThreshold) {
      this.state = "OPEN";
      this.nextAttempt = Date.now() + this.timeout;
      console.error(`Circuit breaker opened for ${this.name}. Will retry after ${new Date(this.nextAttempt)}`);

      // Only notify for critical services
      if (this.name === "Facebook API") {
        const telegramMessage = `<b>🔴 CRITICAL: Facebook API Circuit Breaker Opened</b>\n<b>Service Down - Multiple Failures Detected</b>\n<b>Next Retry:</b> ${new Date(this.nextAttempt).toLocaleString()}`;
        sendTelegramNotification(telegramMessage);
      }
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      nextAttempt: this.state === "OPEN" ? new Date(this.nextAttempt) : null,
    };
  }
}

// Initialize circuit breakers for external services
const circuitBreakers = {
  facebook: new CircuitBreaker("Facebook API", 60000),
  google: new CircuitBreaker("Google Drive API", 60000),
};

// Telegram notification helper
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

    let formattedMessage = `<b>${isError ? "🚨 ERROR" : "ℹ️ INFO"} - ${serverName}</b>\n`;
    formattedMessage += `<b>Environment:</b> ${environment}\n`;
    formattedMessage += `<b>Time:</b> ${timestamp}\n`;
    formattedMessage += `<b>Message:</b>\n${message}`;

    const response = await axios.post(url, {
      chat_id: 5008532894,
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

// Helper to send SSE messages
function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (res.flush) res.flush();
}

function createUploadSession() {
  const sessionId = Date.now().toString(36) + Math.random().toString(36);
  uploadSessions.set(sessionId, {
    sessionId,
    totalFiles: 0,
    processedFiles: 0,
    currentFile: null,
    clients: new Set(),
    errors: [],
  });
  return sessionId;
}

function broadcastToSession(sessionId, event, data) {
  const session = uploadSessions.get(sessionId);
  if (!session) {
    console.log("No session found for broadcast:", sessionId);
    return;
  }

  console.log(`Broadcasting ${event} to ${session.clients.size} clients:`, data);

  session.clients.forEach((client) => {
    try {
      sendSSE(client, event, data);
    } catch (err) {
      console.error("Error sending SSE:", err);
    }
  });
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Authentication routes
app.post("/login", ensureNotAuthenticated, loginRateLimiter, (req, res, next) => {
  console.log("Login attempt for username:", req.body.username);

  passport.authenticate("local", (err, user, info) => {
    if (err) {
      console.error("Login error:", err);
      return next(err);
    }

    if (!user) {
      console.log("Login failed - no user returned:", info);
      return res.redirect("/login.html?error=auth");
    }

    req.logIn(user, (err) => {
      if (err) {
        console.error("Session login error:", err);
        return next(err);
      }

      console.log("Login successful for user:", user.username);
      console.log("Session after login:", {
        sessionID: req.sessionID,
        user: req.user,
        isAuthenticated: req.isAuthenticated(),
      });

      return res.redirect("/");
    });
  })(req, res, next);
});

app.post("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.redirect("/login.html");
  });
});

app.get("/api/auth/status", (req, res) => {
  const isDevelopment = process.env.NODE_ENV === "development";

  console.log("Auth status check:", {
    authenticated: isDevelopment ? true : req.isAuthenticated(),
    sessionID: req.sessionID,
    user: req.user,
    session: req.session,
    isDevelopment: isDevelopment,
  });

  res.json({
    authenticated: isDevelopment ? true : req.isAuthenticated(),
    user: isDevelopment ? { id: "dev-user", username: "developer" } : req.user ? { id: req.user.id, username: req.user.username } : null,
    isDevelopment: isDevelopment,
    environment: process.env.NODE_ENV,
  });
});

// Facebook OAuth routes
app.get(
  "/auth/facebook",
  ensureAuthenticated,
  passport.authenticate("facebook", {
    scope: ["pages_show_list", "pages_read_engagement", "ads_management", "ads_read", "business_management", "pages_manage_ads", "pages_manage_metadata", "pages_read_user_content", "leads_retrieval"],
    authType: "rerequest",
  })
);

app.get(
  "/auth/facebook/callback",
  passport.authenticate("facebook", { failureRedirect: "/login" }),
  (req, res) => {
    // Successful authentication - redirect to frontend
    const frontendUrl = process.env.FRONTEND_URL || "https://localhost:3000";
    res.redirect(frontendUrl);
  }
);


// Check Facebook connection status
app.get("/api/facebook/status", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = process.env.NODE_ENV === "development" ? 1 : req.user.id;
    const isConnected = await FacebookAuthDB.isConnected(userId);

    res.json({ connected: isConnected });
  } catch (error) {
    console.error("Error checking Facebook status:", error);
    res.status(500).json({ error: "Failed to check Facebook connection status" });
  }
});

// Disconnect Facebook
app.post("/api/facebook/disconnect", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = process.env.NODE_ENV === "development" ? 1 : req.user.id;
    console.log(`Disconnecting Facebook for user ${userId}...`);
    
    // Delete all Facebook data for this user
    await FacebookAuthDB.deleteAllUserData(userId);
    
    console.log(`Successfully disconnected Facebook for user ${userId}`);
    res.json({ message: "Facebook account disconnected successfully" });
  } catch (error) {
    console.error("Error disconnecting Facebook:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ 
      error: "Failed to disconnect Facebook account",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// Get user's Facebook data (businesses, ad accounts, pages)
app.get("/api/facebook/data", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = process.env.NODE_ENV === "development" ? 1 : req.user.id;
    const data = await FacebookAuthDB.getUserFacebookData(userId);

    res.json(data);
  } catch (error) {
    console.error("Error fetching Facebook data:", error);
    res.status(500).json({ error: "Failed to fetch Facebook data" });
  }
});

// Sync Facebook data (fetch and store ad accounts, pages, businesses)
app.post("/api/facebook/sync", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = process.env.NODE_ENV === "development" ? 1 : req.user.id;

    // Get user's access token
    const tokenData = await FacebookAuthDB.getValidToken(userId);
    if (!tokenData) {
      return res.status(401).json({ error: "Facebook not connected. Please connect your Facebook account first." });
    }

    const userAccessToken = tokenData.access_token;

    // Wrap all Facebook API calls in circuit breaker
    await circuitBreakers.facebook.call(async () => {
      // Fetch businesses
      const businessesUrl = `https://graph.facebook.com/${api_version}/me/businesses`;
      const businessesResponse = await axios.get(businessesUrl, {
        params: {
          fields: "id,name",
          access_token: userAccessToken,
        },
      });

      const businesses = businessesResponse.data.data || [];
      for (const business of businesses) {
        await FacebookAuthDB.saveBusiness(business.id, userId, business.name);
      }

      // Add small delay between calls to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fetch ad accounts
      const adAccountsUrl = `https://graph.facebook.com/${api_version}/me/adaccounts`;
      const adAccountsResponse = await axios.get(adAccountsUrl, {
        params: {
          fields: "id,account_id,name,currency,timezone_name,business",
          access_token: userAccessToken,
        },
      });

      const adAccounts = adAccountsResponse.data.data || [];
      for (const account of adAccounts) {
        await FacebookAuthDB.saveAdAccount(account.id, account.account_id, userId, account.business?.id || null, account.name, account.currency, account.timezone_name);
      }

      // Add small delay between calls to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fetch pages
      const pagesUrl = `https://graph.facebook.com/${api_version}/me/accounts`;
      const pagesResponse = await axios.get(pagesUrl, {
        params: {
          fields: "id,name,access_token",
          access_token: userAccessToken,
        },
      });

      const pages = pagesResponse.data.data || [];
      for (const page of pages) {
        await FacebookAuthDB.savePage(page.id, userId, page.name, page.access_token);
      }
    });

    // Return synced data
    const syncedData = await FacebookAuthDB.getUserFacebookData(userId);

    res.json({
      message: "Facebook data synced successfully",
      data: syncedData,
    });
  } catch (error) {
    console.error("Error syncing Facebook data:", error);

    // Check if it's a rate limit error
    const isRateLimitError =
      error.response?.status === 400 &&
      (error.response?.data?.error?.code === 80004 || // Rate limit error code
        error.response?.data?.error?.message?.includes("too many calls"));

    if (isRateLimitError) {
      return res.status(429).json({
        error: "Facebook rate limit exceeded",
        message: "Too many API calls. Please wait a few minutes and try again.",
        retryAfter: 300, // Suggest retry after 5 minutes
      });
    }

    // Check if circuit breaker is open
    if (error.message?.includes("Circuit breaker is OPEN")) {
      return res.status(503).json({
        error: "Service temporarily unavailable",
        message: "Facebook API is temporarily unavailable. Please try again later.",
      });
    }

    res.status(500).json({
      error: "Failed to sync Facebook data",
      details: error.response?.data || error.message,
    });
  }
});

// User management routes (only for authenticated users)
app.post("/api/users", ensureAuthenticated, validateRequest.createUser, async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required" });
    }

    const result = await UserDB.create(username, password, email);
    res.json({ message: "User created successfully", userId: result.lastID });
  } catch (error) {
    console.error("Error creating user:", error);
    if (error.message?.includes("UNIQUE constraint failed")) {
      res.status(400).json({ error: "Username already exists" });
    } else {
      // Critical database error - notify
      const telegramMessage = `<b>🚨 CRITICAL: User Database Error</b>\n<b>Operation:</b> Create User Failed\n<b>Error:</b> ${error.message}`;
      sendTelegramNotification(telegramMessage);
      res.status(500).json({ error: "Failed to create user" });
    }
  }
});

app.get("/api/users", ensureAuthenticated, async (req, res) => {
  try {
    const users = await UserDB.getAll();
    res.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Serve login page without authentication
app.get("/login.html", ensureNotAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Serve index.html to root (no authentication required for viewing)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Apply authentication to all API routes except auth status
app.use("/api", (req, res, next) => {
  // Skip authentication for auth status endpoint
  if (req.path === "/auth/status") {
    return next();
  }
  // All other API routes require authentication
  ensureAuthenticatedAPI(req, res, next);
});

// SSE endpoint for Meta data updates
const metaDataClients = new Set();
app.get("/api/meta-data-updates", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  metaDataClients.add(res);

  // Send initial connection message
  sendSSE(res, "connected", { message: "Connected to Meta data updates" });

  const keepAlive = setInterval(() => {
    res.write(":keep-alive\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(keepAlive);
    metaDataClients.delete(res);
  });
});

// Broadcast updates to all connected clients
function broadcastMetaDataUpdate(event, data) {
  metaDataClients.forEach((client) => {
    try {
      sendSSE(client, event, data);
    } catch (err) {
      console.error("Error sending Meta data SSE:", err);
      metaDataClients.delete(client);
    }
  });
}

// Manual cache refresh endpoint
app.post("/api/refresh-meta-cache", async (req, res) => {
  try {
    if (isRefreshing) {
      return res.json({
        status: "already_refreshing",
        message: "A refresh is already in progress",
      });
    }

    // Start refresh
    broadcastMetaDataUpdate("refresh-started", { timestamp: new Date().toISOString() });

    const freshData = await fetchMetaDataFresh();

    // Broadcast completion with the new data
    broadcastMetaDataUpdate("refresh-completed", {
      timestamp: new Date().toISOString(),
      data: freshData,
    });

    res.json({
      status: "success",
      message: "Cache refreshed successfully",
      data: freshData,
    });
  } catch (error) {
    console.error("Manual cache refresh failed:", error);

    broadcastMetaDataUpdate("refresh-failed", {
      timestamp: new Date().toISOString(),
      error: error.message,
    });

    res.status(500).json({
      status: "error",
      message: "Failed to refresh cache",
      error: error.message,
    });
  }
});

// Clear cache endpoint
app.delete("/api/meta-cache", async (req, res) => {
  try {
    await FacebookCacheDB.clearCache();
    res.json({ message: "Cache cleared successfully" });
  } catch (error) {
    console.error("Error clearing cache:", error);
    res.status(500).json({ error: "Failed to clear cache" });
  }
});

// Create upload session endpoint
app.post("/api/create-upload-session", (req, res) => {
  const sessionId = createUploadSession();
  const session = uploadSessions.get(sessionId);

  if (req.body.totalFiles) {
    session.totalFiles = req.body.totalFiles;
  }

  res.json({ sessionId });
});

// SSE endpoint for upload progress
app.get("/api/upload-progress/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = uploadSessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  session.clients.add(res);

  sendSSE(res, "connected", {
    sessionId,
    totalFiles: session.totalFiles,
    processedFiles: session.processedFiles,
  });

  const keepAlive = setInterval(() => {
    res.write(":keep-alive\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(keepAlive);
    session.clients.delete(res);

    if (session.clients.size === 0) {
      setTimeout(() => {
        if (session.clients.size === 0) {
          uploadSessions.delete(sessionId);
        }
      }, 60000);
    }
  });
});

// DEPRECATED: Fetch ad account data with caching (OLD SYSTEM - use /api/meta-data instead)
// This endpoint is kept for backward compatibility but should not be used in new code
app.get("/api/fetch-meta-data", async (req, res) => {
  const forceRefresh = req.query.refresh === "true";
  const userId = getUserId(req);

  try {
    // Check if user has connected Facebook
    const isConnected = userId ? await FacebookAuthDB.isConnected(userId) : false;

    if (isConnected) {
      // Use user-specific data from FacebookAuthDB
      const userData = await FacebookAuthDB.getUserFacebookData(userId);

      if (!forceRefresh && userData.adAccounts.length > 0) {
        // Return user's data
        res.json({
          adAccounts: userData.adAccounts,
          pages: userData.pages,
          campaigns: [], // Will be fetched separately if needed
          pixels: [],
          fromCache: false,
          source: "oauth",
        });
        return;
      }
    }

    // Fallback to system user cache method (DEPRECATED - requires META_ACCESS_TOKEN)
    // Check if we have cached data and it's still valid
    const hasValidCache = await FacebookCacheDB.isCacheValid(60); // Cache valid for 60 minutes

    if (!forceRefresh && hasValidCache) {
      // Return cached data immediately
      const cachedData = await FacebookCacheDB.getAllCachedData();

      // Send cached data with a flag indicating it's from cache
      res.json({
        ...cachedData,
        fromCache: true,
        cacheAge: await getCacheAge(),
        source: "system_user",
      });

      // Trigger background refresh
      refreshMetaDataInBackground(userId);
    } else {
      // No cache or force refresh - fetch fresh data
      const freshData = await fetchMetaDataFresh(userId);
      res.json({
        ...freshData,
        fromCache: false,
        source: "system_user",
      });
    }
  } catch (error) {
    console.error("Error in fetch-meta-data endpoint:", error);

    // If there's an error but we have cache, return cached data
    try {
      const cachedData = await FacebookCacheDB.getAllCachedData();
      if (cachedData.adAccounts && cachedData.adAccounts.length > 0) {
        res.json({
          ...cachedData,
          fromCache: true,
          error: "Using cached data due to API error",
          source: "system_user",
        });
        return;
      }
    } catch (cacheError) {
      console.error("Cache retrieval also failed:", cacheError);
    }

    // Critical: Both API and cache failed
    const telegramMessage = `<b>🔴 CRITICAL: Meta Data Fetch Failed</b>\n<b>Both API and cache retrieval failed</b>\n<b>Error:</b> ${error.message}`;
    sendTelegramNotification(telegramMessage);

    res.status(500).json({ error: "Failed to fetch Meta data" });
  }
});

// NEW REACT API ENDPOINTS
// ============================================================================

// GET /api/meta-data - Returns Facebook connection status (uses OAuth system)
app.get("/api/meta-data", async (req, res) => {
  try {
    const userId = getUserId(req);
    
    // Check if user has connected Facebook via OAuth
    const isConnected = userId ? await FacebookAuthDB.isConnected(userId) : false;
    
    if (isConnected) {
      // Get user's Facebook data from OAuth system
      const userData = await FacebookAuthDB.getUserFacebookData(userId);
      
      // Fetch campaigns for all user's ad accounts
      const campaignsPromises = userData.adAccounts.map(account => 
        fetchCampaigns(account.id, userId).catch(err => {
          console.error(`Error fetching campaigns for ${account.id}:`, err);
          return [];
        })
      );
      
      const campaignsResults = await Promise.all(campaignsPromises);
      const allCampaigns = campaignsResults.flat();
      
      // Fetch ad sets for all campaigns
      const adsetsPromises = allCampaigns.map(campaign => 
        fetchAdSets(campaign.id, campaign.account_id, userId).catch(err => {
          console.error(`Error fetching ad sets for campaign ${campaign.id}:`, err);
          return [];
        })
      );
      
      const adsetsResults = await Promise.all(adsetsPromises);
      const allAdSets = adsetsResults.flat();
      
      // Fetch pixels for all user's ad accounts
      const pixelsPromises = userData.adAccounts.map(account => 
        fetchPixels(account.id, userId).catch(err => {
          console.error(`Error fetching pixels for ${account.id}:`, err);
          return null;
        })
      );
      
      const pixelsResults = await Promise.all(pixelsPromises);
      const allPixels = pixelsResults.filter(p => p !== null);
      
      // Save all fetched data to cache for faster subsequent requests
      try {
        await FacebookCacheDB.saveAllData(userData.adAccounts, userData.pages, allCampaigns, allPixels, allAdSets);
      } catch (cacheError) {
        console.error('Error saving to cache:', cacheError);
        // Continue even if cache fails
      }
      
      res.json({
        isConnected: true,
        accounts: userData.adAccounts || [],
        pages: userData.pages || [],
        businesses: userData.businesses || [],
        campaigns: allCampaigns || [],
        pixels: allPixels || [],
        adsets: allAdSets || [],
        source: 'oauth'
      });
    } else {
      // User not connected via OAuth
      res.json({
        isConnected: false,
        accounts: [],
        pages: [],
        businesses: [],
        campaigns: [],
        pixels: [],
        adsets: [],
        source: 'none'
      });
    }
  } catch (error) {
    console.error("Error in /api/meta-data:", error);
    res.status(500).json({ error: error.message, isConnected: false });
  }
});

// GET /api/campaigns?account_id=act_123456789 - Get campaigns for account
app.get("/api/campaigns", async (req, res) => {
  try {
    const { account_id } = req.query;
    
    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }
    
    const campaigns = await FacebookCacheDB.getCampaignsByAccount(account_id);
    
    res.json({
      campaigns: campaigns || [],
    });
  } catch (error) {
    console.error("Error in /api/campaigns:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/adsets?campaign_id=camp_001 - Get ad sets for campaign
app.get("/api/adsets", async (req, res) => {
  try {
    const { campaign_id } = req.query;
    
    if (!campaign_id) {
      return res.status(400).json({ error: "campaign_id is required" });
    }
    
    const adsets = await FacebookCacheDB.getAdSetsByCampaign(campaign_id);
    
    res.json({
      adsets: adsets || [],
    });
  } catch (error) {
    console.error("Error in /api/adsets:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/creatives?account_id=act_123456789 - Get creatives for account
app.get("/api/creatives", async (req, res) => {
  try {
    const { account_id } = req.query;
    
    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }
    
    // Get creatives from creative-library database
    const creatives = await CreativeDB.getByAccount(account_id);
    
    res.json({
      creatives: creatives || [],
    });
  } catch (error) {
    console.error("Error in /api/creatives:", error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/campaigns - Create a new campaign
app.post("/api/campaigns", async (req, res) => {
  try {
    const { account_id, name, objective, daily_budget, status, special_ad_categories } = req.body;
    const userId = getUserId(req);

    // Validate required fields
    if (!account_id || !name || !objective) {
      return res.status(400).json({ 
        error: "Missing required fields: account_id, name, and objective are required" 
      });
    }

    // Ensure account_id has 'act_' prefix (Facebook requires it for API calls)
    const formattedAccountId = account_id.startsWith('act_') ? account_id : `act_${account_id}`;

    // Get OAuth token
    const token = await getAccessToken(userId);

    // Create campaign via Facebook Graph API using FormData (as per Meta's documentation)
    const campaignUrl = `https://graph.facebook.com/${api_version}/${formattedAccountId}/campaigns`;
    
    // Use FormData for proper array/object serialization (matches Meta's curl -F examples)
    const formData = new URLSearchParams();
    formData.append('name', name);
    formData.append('objective', objective);
    formData.append('status', status || 'PAUSED');
    formData.append('access_token', token);
    
    // Meta requires special_ad_categories as JSON string when empty
    formData.append('special_ad_categories', JSON.stringify(special_ad_categories || []));

    // Add daily_budget if provided (convert to cents as Meta requires)
    if (daily_budget) {
      const budgetInCents = Math.round(parseFloat(daily_budget) * 100);
      formData.append('daily_budget', budgetInCents.toString());
    }

    console.log('Creating campaign:', { 
      url: campaignUrl, 
      data: Object.fromEntries(formData.entries()).access_token = '***'
    });

    const response = await axios.post(campaignUrl, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    // Fetch the newly created campaign with full details
    const newCampaignId = response.data.id;
    const campaignDetailsUrl = `https://graph.facebook.com/${api_version}/${newCampaignId}`;
    const detailsResponse = await axios.get(campaignDetailsUrl, {
      params: {
        fields: "id,account_id,name,objective,status,daily_budget,bid_strategy,created_time,special_ad_categories",
        access_token: token,
      },
    });

    const newCampaign = detailsResponse.data;

    // Save to cache
    try {
      await FacebookCacheDB.saveCampaigns([newCampaign]);
    } catch (cacheError) {
      console.error('Error saving campaign to cache:', cacheError);
      // Continue even if cache fails
    }

    res.json({
      success: true,
      campaign: newCampaign,
      message: `Campaign "${name}" created successfully`,
    });

  } catch (error) {
    console.error("Error creating campaign:", error.response?.data || error);
    res.status(500).json({ 
      error: error.response?.data?.error?.message || error.message,
      details: error.response?.data || null
    });
  }
});

// POST /api/upload - Unified upload endpoint for images and videos
app.post("/api/upload", upload.array("files", 50), async (req, res) => {
  try {
    const files = req.files;
    const { account_id, adset_id } = req.body;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    // Create SSE session for progress tracking
    const sessionId = createUploadSession();
    const session = uploadSessions.get(sessionId);
    
    session.totalFiles = files.length;
    session.processedFiles = 0;

    // Send session ID back immediately
    res.json({ 
      sessionId,
      message: "Upload started",
      totalFiles: files.length 
    });

    // Broadcast session start
    broadcastToSession(sessionId, "session-start", {
      sessionId,
      totalFiles: files.length,
    });

    // Process uploads asynchronously
    const results = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      
      try {
        // Determine if video or image
        const isVideo = file.mimetype.startsWith("video");
        
        // Broadcast progress
        broadcastToSession(sessionId, "progress", {
          current: i + 1,
          total: files.length,
          currentFile: file.originalname,
          status: "processing",
        });

        let uploadResult;
        
        if (isVideo) {
          // Upload video to Facebook
          uploadResult = await uploadVideoToMeta(file, account_id);
        } else {
          // Upload image to Facebook
          const imageHash = await uploadImageToMeta(file.path, account_id);
          uploadResult = { hash: imageHash, success: true };
        }

        // Save to creative library database
        const creative = await CreativeDB.create({
          name: file.originalname,
          type: isVideo ? "VIDEO" : "IMAGE",
          filePath: file.path,
          facebookId: uploadResult.id || uploadResult.hash,
          accounts: [account_id],
          adsetId: adset_id || null,
        });

        results.push({
          filename: file.originalname,
          success: true,
          facebookId: uploadResult.id || uploadResult.hash,
          isDuplicate: false,
        });

      } catch (error) {
        console.error(`Error uploading ${file.originalname}:`, error);
        results.push({
          filename: file.originalname,
          success: false,
          error: error.message,
        });
      }
      
      session.processedFiles = i + 1;
    }

    // Broadcast completion
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    broadcastToSession(sessionId, "complete", {
      sessionId,
      uploaded: successCount,
      failed: failCount,
      results,
    });

  } catch (error) {
    console.error("Error in /api/upload:", error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to get cache age
async function getCacheAge() {
  const db = await import("./backend/utils/facebook-cache-db.js").then((m) => m.default);
  const result = await db.getAsync(`
    SELECT (julianday('now') - julianday(MIN(last_fetched))) * 24 * 60 as age_minutes
    FROM cached_ad_accounts
  `);
  return result ? Math.round(result.age_minutes) : null;
}

// Background refresh function
let isRefreshing = false;
async function refreshMetaDataInBackground(userId = null) {
  if (isRefreshing) return; // Prevent multiple simultaneous refreshes

  isRefreshing = true;
  try {
    console.log("Starting background refresh of Meta data...");
    broadcastMetaDataUpdate("refresh-started", {
      timestamp: new Date().toISOString(),
      source: "background",
    });

    const freshData = await fetchMetaDataFresh(userId);
    console.log("Background refresh completed successfully");

    broadcastMetaDataUpdate("refresh-completed", {
      timestamp: new Date().toISOString(),
      source: "background",
      data: freshData,
    });
  } catch (error) {
    console.error("Background refresh failed:", error);
    broadcastMetaDataUpdate("refresh-failed", {
      timestamp: new Date().toISOString(),
      source: "background",
      error: error.message,
    });
  } finally {
    isRefreshing = false;
  }
}

// Extract the main fetch logic into a separate function
async function fetchMetaDataFresh(userId = null) {
  async function fetchMetaData() {
    let adAccAndPagesPromises = [fetchAdAccounts(userId), fetchAssignedPages(userId)];

    const metaResponse = await Promise.allSettled(adAccAndPagesPromises);

    let adAccounts;
    let pages;
    let failedPromises = [];

    try {
      metaResponse;
      const metaData = metaResponse;

      for (const data of metaData) {
        if (data.status === "fulfilled" && data.value.adAccounts) {
          adAccounts = data.value.adAccounts;
        } else if (data.status === "fulfilled" && data.value.pages) {
          pages = data.value.pages;
        } else {
          failedPromises.push(data);
        }
      }

      if (failedPromises.length > 0) {
        const error = {
          error_code: "META_DATA_FETCH_FAILED",
          error_message: `${failedPromises.length} promises failed while fetching Meta data.`,
          error_details: failedPromises,
          timestamp: new Date().toISOString(),
        };

        console.error(JSON.stringify(error));
      } else {
        console.log(`Successfully fetched ad account data assigned to system user id ${system_user_id}:`, adAccounts);
      }

      const dataPromises = adAccounts.flatMap((account) => {
        return Promise.all([fetchCampaigns(account.id, userId), fetchPixels(account.id, userId)]).then(async ([campaigns, pixels]) => {
          // Fetch ad sets for each campaign
          const adsetsPromises = campaigns.map(campaign => 
            fetchAdSets(campaign.id, campaign.account_id, userId).catch(err => {
              console.error(`Error fetching ad sets for campaign ${campaign.id}:`, err);
              return [];
            })
          );
          const adsetsResults = await Promise.all(adsetsPromises);
          const adsets = adsetsResults.flat();
          
          return {
            campaigns,
            pixels,
            adsets,
          };
        });
      });

      const results = await Promise.all(dataPromises);

      const allCampaigns = results.flatMap((accountData) => accountData.campaigns);
      const allPixels = results.flatMap((accountData) => accountData.pixels);
      const allAdSets = results.flatMap((accountData) => accountData.adsets);

      // Save to cache using single transaction (including ad sets)
      await FacebookCacheDB.saveAllData(adAccounts, pages, allCampaigns, allPixels, allAdSets);

      return {
        adAccounts,
        pages,
        campaigns: allCampaigns,
        pixels: allPixels,
        adsets: allAdSets,
      };
    } catch (err) {
      console.log("Error fetching data from Meta: ", err.message);
      throw err;
    }
  }

  return await fetchMetaData();
}

// Fetch ad accounts
async function fetchAdAccounts(userId = null) {
  try {
    const token = await getAccessToken(userId);

    // Try user-specific endpoint first if userId provided
    if (userId) {
      const isConnected = await FacebookAuthDB.isConnected(userId);
      if (isConnected) {
        const userAdAccURL = `https://graph.facebook.com/${api_version}/me/adaccounts`;
        const adAccResponse = await axios.get(userAdAccURL, {
          params: {
            fields: "name,id,account_id",
            access_token: token,
          },
        });
        return { adAccounts: adAccResponse.data.data };
      }
    }

    // Fallback to system user method
    const adAccURL = `https://graph.facebook.com/${api_version}/${system_user_id}/assigned_ad_accounts`;
    const adAccResponse = await axios.get(adAccURL, {
      params: {
        fields: "name,id,account_id",
        access_token: token,
      },
    });
    return { adAccounts: adAccResponse.data.data };
  } catch (err) {
    console.error("There was an error fetching assigned ad accounts.", err);
    return { adAccounts: [] };
  }
}

// Fetch assigned pages for system user
async function fetchAssignedPages(userId = null) {
  try {
    return await circuitBreakers.facebook.call(async () => {
      const token = await getAccessToken(userId);

      // Try user-specific endpoint first if userId provided
      if (userId) {
        const isConnected = await FacebookAuthDB.isConnected(userId);
        if (isConnected) {
          const userPagesUrl = `https://graph.facebook.com/${api_version}/me/accounts`;
          const response = await axios.get(userPagesUrl, {
            params: {
              fields: "name,id",
              access_token: token,
            },
          });
          return { pages: response.data.data };
        }
      }

      // Fallback to system user method
      const pagesUrl = `https://graph.facebook.com/${api_version}/${system_user_id}/assigned_pages`;
      const response = await axios.get(pagesUrl, {
        params: {
          fields: "name,id",
          access_token: token,
        },
      });
      return { pages: response.data.data };
    });
  } catch (err) {
    console.error(`There was an error fetching assigned pages:`, err);
    return { pages: [] };
  }
}

async function fetchCampaigns(account_id, userId = null) {
  const campaignUrl = `https://graph.facebook.com/${api_version}/${account_id}/campaigns`;

  try {
    const token = await getAccessToken(userId);
    const campaignResponse = await axios.get(campaignUrl, {
      params: {
        fields: "account_id,id,name,bid_strategy,special_ad_categories,status,objective,insights{spend,clicks,impressions},daily_budget,created_time",
        access_token: token,
      },
    });
    return campaignResponse.data.data;
  } catch (err) {
    console.error(`Error fetching campaigns for account ${account_id}:`, err);
    return [];
  }
}

// Fetch ad sets for a campaign
async function fetchAdSets(campaign_id, account_id, userId = null) {
  const adsetUrl = `https://graph.facebook.com/${api_version}/${campaign_id}/adsets`;
  
  try {
    const token = await getAccessToken(userId);
    const adsetResponse = await axios.get(adsetUrl, {
      params: {
        fields: "id,name,status,daily_budget,bid_strategy,optimization_goal,billing_event,created_time,insights{spend,clicks,impressions}",
        access_token: token,
      },
    });
    
    // Add campaign_id and account_id to each ad set for proper tracking
    const adsets = adsetResponse.data.data.map(adset => ({
      ...adset,
      campaign_id: campaign_id,
      account_id: account_id
    }));
    
    return adsets;
  } catch (err) {
    console.error(`Error fetching ad sets for campaign ${campaign_id}:`, err);
    return [];
  }
}

// Fetch pixels for ad account
async function fetchPixels(account_id, userId = null) {
  const pixelUrl = `https://graph.facebook.com/${api_version}/${account_id}/`;

  try {
    const token = await getAccessToken(userId);
    const params = {
      fields: "account_id,adspixels{name,id}",
      access_token: token,
    };

    const pixelResponse = await axios.get(pixelUrl, { params });

    if (pixelResponse.status === 200) {
      console.log("Successfully fetched pixels.");
      return pixelResponse.data;
    } else {
      console.log("Fetch pixels failed in if else block.");
      return null;
    }
  } catch (err) {
    console.error(`Error fetching pixels for account ${account_id}:`, err);
    return null;
  }
}

// Global helper function to upload image to Meta
async function uploadImageToMeta(filePath, adAccountId) {
  const imageUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/adimages`;

  try {
    const fd = new FormData();
    fd.append("source", fs.createReadStream(filePath));
    fd.append("access_token", access_token);

    const response = await axios.post(imageUrl, fd, {
      headers: {
        ...fd.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log("Successfully uploaded image to Meta!");
    const images = response.data.images;
    const dynamicKey = Object.keys(images)[0];
    const imageHash = images[dynamicKey].hash;

    return imageHash;
  } catch (err) {
    console.log("Error uploading image:", err.response?.data || err.message);
    throw err;
  }
}

// Global helper function to upload video to Meta
async function uploadVideoToMeta(file, adAccountId) {
  const fileStats = fs.statSync(file.path);
  const fileSize = fileStats.size;

  // Use resumable upload for files > 20MB
  if (fileSize > 20 * 1024 * 1024) {
    return await uploadLargeVideoToMeta(file, adAccountId);
  }

  // Regular upload for smaller files
  const upload_url = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

  try {
    const fd = new FormData();
    fd.append("source", fs.createReadStream(file.path));
    fd.append("name", file.originalname);
    fd.append("access_token", access_token);

    const response = await axios.post(upload_url, fd, {
      headers: {
        ...fd.getHeaders(),
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    console.log("Successfully uploaded video to Meta!");
    return response.data.id;
  } catch (err) {
    console.log("Error uploading video to Facebook:", err.response?.data || err.message);
    throw err;
  }
}

// Global helper function for large video uploads
async function uploadLargeVideoToMeta(file, adAccountId) {
  const fileStats = fs.statSync(file.path);
  const fileSize = fileStats.size;

  const initUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

  try {
    const initResponse = await axios.post(initUrl, {
      upload_phase: "start",
      file_size: fileSize,
      access_token,
    });

    const { upload_session_id, video_id } = initResponse.data;

    const chunkSize = 4 * 1024 * 1024; // 4MB chunks
    let offset = 0;

    while (offset < fileSize) {
      const endChunk = Math.min(offset + chunkSize, fileSize);
      const chunk = fs.createReadStream(file.path, {
        start: offset,
        end: endChunk - 1,
      });

      const fd = new FormData();
      fd.append("video_file_chunk", chunk);
      fd.append("upload_phase", "transfer");
      fd.append("upload_session_id", upload_session_id);
      fd.append("start_offset", offset.toString());
      fd.append("access_token", access_token);

      await axios.post(initUrl, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      offset = endChunk;
    }

    await axios.post(initUrl, {
      upload_phase: "finish",
      upload_session_id: upload_session_id,
      access_token,
      title: file.originalname,
    });

    return video_id;
  } catch (err) {
    console.log("Error uploading large video to Facebook:", err.response?.data || err.message);
    throw err;
  }
}

// Global helper function to get thumbnail from video
async function getThumbnailFromVideo(file) {
  const videoPath = file.path;
  const thumbnailDir = path.join(__dirname, "uploads", "thumbnails");
  const thumbnailName = `thumb-${Date.now()}-${path.basename(file.originalname, path.extname(file.originalname))}.png`;
  const thumbnailPath = path.join(thumbnailDir, thumbnailName);

  console.log("Creating thumbnail from video:");
  console.log("  Video path:", videoPath);
  console.log("  Thumbnail path:", thumbnailPath);

  // Ensure thumbnails directory exists
  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput("00:00:01")
      .screenshots({
        timestamps: ["00:00:01"],
        filename: thumbnailName,
        folder: thumbnailDir,
      })
      .on("end", () => {
        console.log("Thumbnail created successfully:", thumbnailPath);
        resolve({ path: thumbnailPath });
      })
      .on("error", (err) => {
        console.error("Error creating thumbnail:", err);
        reject(err);
      });
  });
}

// Fetch file names from Google Drive folder
app.get("/api/fetch-google-data", async (req, res) => {
  const { folderId } = req.query;

  if (!folderId) {
    return res.status(400).json({ error: "Folder ID is required" });
  }

  try {
    const drive = google.drive({
      version: "v3",
      auth: oauth2Client,
    });

    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, size, webContentLink, webViewLink)",
      pageSize: 1000,
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    const files = response.data.files || [];

    const folders = files.filter((file) => file.mimeType === "application/vnd.google-apps.folder");
    const regularFiles = files.filter((file) => file.mimeType !== "application/vnd.google-apps.folder");

    res.json({
      files: regularFiles,
      folders: folders,
      totalCount: files.length,
    });
  } catch (error) {
    console.error("Error fetching Google Drive files:", error);
    res.status(500).json({
      error: "Failed to fetch Google Drive files",
      details: error.message,
    });
  }
});

app.post("/api/download-and-upload-google-files", validateRequest.googleDriveDownload, async (req, res) => {
  const { fileIds, account_id } = req.body;
  const sessionId = req.body.sessionId || createUploadSession();

  if (!fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "File IDs array is required" });
  }

  if (!account_id) {
    return res.status(400).json({ error: "Account ID is required" });
  }

  try {
    const drive = google.drive({
      version: "v3",
      auth: oauth2Client,
    });

    const uploadPromises = fileIds.map(async (fileId, index) => {
      try {
        const metadataResponse = await drive.files.get({
          fileId: fileId,
          fields: "id, name, mimeType, size",
          supportsAllDrives: true,
        });

        const file = metadataResponse.data;

        const isImage = file.mimeType.startsWith("image/");
        const isVideo = file.mimeType.startsWith("video/");

        if (!isImage && !isVideo) {
          console.log(`Skipping non-media file: ${file.name} (${file.mimeType})`);
          return {
            fileId: file.id,
            fileName: file.name,
            status: "skipped",
            error: "Only images and videos are supported",
            mimeType: file.mimeType,
          };
        }

        const response = await drive.files.get(
          {
            fileId: fileId,
            alt: "media",
            supportsAllDrives: true,
          },
          { responseType: "stream" }
        );

        const timestamp = Date.now();
        const fileName = `${timestamp}-${file.name}`;
        const tempPath = path.join(__dirname, "uploads", fileName);

        await new Promise((resolve, reject) => {
          const writeStream = fs.createWriteStream(tempPath);
          response.data.pipe(writeStream).on("finish", resolve).on("error", reject);
        });

        broadcastToSession(sessionId, "file-start", {
          fileIndex: index,
          fileName: file.name,
          fileSize: file.size ? (parseInt(file.size) / (1024 * 1024)).toFixed(2) + "MB" : "Unknown",
          totalFiles: fileIds.length,
          source: "google-drive",
        });

        if (isVideo) {
          try {
            const fileObj = {
              filename: fileName,
              path: tempPath,
              originalname: file.name,
              size: file.size,
              mimetype: "video/mp4",
            };

            broadcastToSession(sessionId, "file-progress", {
              fileIndex: index,
              fileName: file.name,
              stage: "Processing creative",
              progress: 5,
            });

            // Process creative with deduplication
            const creativeResult = await processCreative(fileObj, account_id);

            let videoId, imageHash;

            if (creativeResult.isDuplicate) {
              // Creative already exists and is uploaded to this account
              videoId = creativeResult.facebookIds.facebook_video_id;
              imageHash = creativeResult.facebookIds.facebook_image_hash;

              // Update session progress
              const uploadSession = uploadSessions.get(sessionId);
              if (uploadSession) {
                uploadSession.processedFiles++;
              }

              // Send file complete event
              broadcastToSession(sessionId, "file-complete", {
                fileIndex: index,
                fileName: file.name,
                processedFiles: uploadSession.processedFiles,
                totalFiles: fileIds.length,
                isDuplicate: true,
                message: "Using existing creative from library",
              });

              return {
                type: "video",
                file: file.name,
                data: {
                  uploadVideo: videoId,
                  getImageHash: imageHash,
                  adAccountId: account_id,
                },
                status: "success",
                isDuplicate: true,
              };
            } else {
              // Need to upload to Meta
              if (!creativeResult.isNew) {
                // Use existing file from library
                fileObj.path = getCreativeFilePath(creativeResult.creative);
              } else {
                // New file was moved to library, update the path
                fileObj.path = creativeResult.libraryPath || getCreativeFilePath(creativeResult.creative);
              }

              broadcastToSession(sessionId, "file-progress", {
                fileIndex: index,
                fileName: file.name,
                stage: "Creating thumbnail",
                progress: 10,
              });

              const thumbnail = await getThumbnailFromVideo(fileObj);

              broadcastToSession(sessionId, "file-progress", {
                fileIndex: index,
                fileName: file.name,
                stage: "Uploading video to Meta",
                progress: 30,
              });

              videoId = await uploadVideoToMeta(fileObj, account_id, sessionId, index);

              broadcastToSession(sessionId, "file-progress", {
                fileIndex: index,
                fileName: file.name,
                stage: "Uploading thumbnail",
                progress: 90,
              });

              imageHash = await uploadThumbnailImage(thumbnail, account_id);

              // Store Facebook IDs in database
              await CreativeAccountDB.recordUpload(creativeResult.creative.id, account_id, {
                videoId: videoId,
                imageHash: imageHash,
              });

              // Update creative with thumbnail path
              if (creativeResult.isNew) {
                await updateCreativeThumbnail(creativeResult.creative.id, thumbnail);
              }

              // Clean up temporary thumbnail
              if (fs.existsSync(thumbnail)) {
                fs.unlinkSync(thumbnail);
              }

              // Update session progress
              const uploadSession = uploadSessions.get(sessionId);
              if (uploadSession) {
                uploadSession.processedFiles++;
              }

              // Send file complete event
              broadcastToSession(sessionId, "file-complete", {
                fileIndex: index,
                fileName: file.name,
                processedFiles: uploadSession.processedFiles,
                totalFiles: fileIds.length,
                isNew: creativeResult.isNew,
              });

              return {
                type: "video",
                file: file.name,
                data: {
                  uploadVideo: videoId,
                  getImageHash: imageHash,
                  adAccountId: account_id,
                },
                status: "success",
                isNew: creativeResult.isNew,
              };
            }
          } catch (error) {
            console.error("Error processing video:", error);

            // Send file error event
            broadcastToSession(sessionId, "file-error", {
              fileIndex: index,
              fileName: file.name,
              error: error.message,
            });

            if (fs.existsSync(tempPath) && tempPath.startsWith(paths.uploads)) {
              fs.unlinkSync(tempPath);
            }
            return {
              file: file.name,
              status: "failed",
              error: error.message,
            };
          }
        } else if (isImage) {
          try {
            const fileObj = {
              filename: fileName,
              path: tempPath,
              originalname: file.name,
              size: file.size,
              mimetype: file.mimeType,
            };

            // Process creative with deduplication
            const creativeResult = await processCreative(fileObj, account_id);

            let imageHash;

            if (creativeResult.isDuplicate) {
              // Creative already exists and is uploaded to this account
              imageHash = creativeResult.facebookIds.facebook_image_hash;

              return {
                type: "image",
                file: file.name,
                imageHash: imageHash,
                status: "success",
                isDuplicate: true,
                message: "Using existing creative from library",
              };
            } else {
              // Need to upload to Meta
              let uploadPath = tempPath;
              if (!creativeResult.isNew) {
                // Use existing file from library
                uploadPath = getCreativeFilePath(creativeResult.creative);
              } else {
                // New file was moved to library, use the new path
                uploadPath = creativeResult.libraryPath || getCreativeFilePath(creativeResult.creative);
              }

              imageHash = await uploadImageToMeta(uploadPath, account_id);

              // Store Facebook IDs in database
              await CreativeAccountDB.recordUpload(creativeResult.creative.id, account_id, {
                imageHash: imageHash,
              });

              // Clean up temp file if it still exists (for new files it was moved)
              if (!creativeResult.isNew && fs.existsSync(tempPath) && tempPath.startsWith(paths.uploads)) {
                fs.unlinkSync(tempPath);
              }

              return {
                type: "image",
                file: file.name,
                imageHash: imageHash,
                status: "success",
                isNew: creativeResult.isNew,
              };
            }
          } catch (error) {
            console.error("Error processing image:", error);
            if (fs.existsSync(tempPath) && tempPath.startsWith(paths.uploads)) {
              fs.unlinkSync(tempPath);
            }
            return {
              file: file.name,
              status: "failed",
              error: error.message,
            };
          }
        }
      } catch (error) {
        console.error(`Error processing file ${fileId}:`, error);
        return {
          fileId: fileId,
          status: "failed",
          error: error.message,
          details: error.response?.data?.error || error.message,
        };
      }
    });

    // Process files with concurrency limit to avoid EPIPE errors
    const processInBatches = async (promises, batchSize = 3) => {
      const results = [];
      for (let i = 0; i < promises.length; i += batchSize) {
        const batch = promises.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch);
        results.push(...batchResults);
      }
      return results;
    };

    const uploadResults = await processInBatches(uploadPromises, 3);

    const uploadSession = uploadSessions.get(sessionId);
    broadcastToSession(sessionId, "session-complete", {
      totalFiles: fileIds.length,
      processedFiles: uploadSession?.processedFiles || 0,
      results: uploadResults,
    });

    res.json({ results: uploadResults, sessionId });
  } catch (error) {
    console.error("Error in download and upload process:", error);
    res.status(500).json({
      error: "Failed to process Google Drive files",
      details: error.message,
    });
  }

  async function getThumbnailFromVideo(file) {
    const videoPath = file.path;
    const thumbnailDir = path.join(__dirname, "uploads");
    const thumbnailName = `${file.filename}-thumb.png`;
    const thumbnailPath = path.join(thumbnailDir, thumbnailName);

    console.log("Attempting to create thumbnail (Google Drive):");
    console.log("  Video path:", videoPath);
    console.log("  Thumbnail path:", thumbnailPath);
    console.log("  Video exists:", fs.existsSync(videoPath));

    // Ensure uploads directory exists
    if (!fs.existsSync(thumbnailDir)) {
      console.log("Creating uploads directory:", thumbnailDir);
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput("00:00:01")
        .screenshots({
          timestamps: ["00:00:01"],
          filename: thumbnailName,
          folder: thumbnailDir,
        })
        .on("end", () => {
          console.log("Thumbnail created successfully:", thumbnailPath);
          console.log("Thumbnail exists:", fs.existsSync(thumbnailPath));
          resolve(thumbnailPath);
        })
        .on("error", (err) => {
          console.error("Error creating thumbnail:", err);
          reject(err);
        });
    });
  }

  // Helper function to upload video using resumable upload for large files
  async function uploadVideoToMeta(file, adAccountId, sessionId, fileIndex) {
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Use resumable upload for files > 20MB
    if (fileSize > 20 * 1024 * 1024) {
      return await uploadLargeVideoToMeta(file, adAccountId, sessionId, fileIndex);
    }

    // Regular upload for smaller files
    const upload_url = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(file.path));
      fd.append("name", file.originalname);
      fd.append("access_token", access_token);

      const response = await axios.post(upload_url, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log("Successfully uploaded video to Meta!");
      return response.data.id;
    } catch (err) {
      console.log("Error uploading video to Facebook:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function for chunked upload of large videos
  async function uploadLargeVideoToMeta(file, adAccountId, sessionId, fileIndex) {
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Step 1: Initialize upload session
    const initUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

    try {
      // Initialize the upload session
      const initResponse = await axios.post(initUrl, {
        upload_phase: "start",
        file_size: fileSize,
        access_token,
      });

      const { upload_session_id, video_id, start_offset, end_offset } = initResponse.data;
      console.log(`Upload session initialized. Session ID: ${upload_session_id}`);

      // Step 2: Upload chunks
      const chunkSize = 4 * 1024 * 1024; // 4MB chunks
      let offset = 0;
      const totalChunks = Math.ceil(fileSize / chunkSize);
      let currentChunk = 0;

      while (offset < fileSize) {
        currentChunk++;
        const endChunk = Math.min(offset + chunkSize, fileSize);
        const chunk = fs.createReadStream(file.path, {
          start: offset,
          end: endChunk - 1,
        });

        const fd = new FormData();
        fd.append("video_file_chunk", chunk);
        fd.append("upload_phase", "transfer");
        fd.append("upload_session_id", upload_session_id);
        fd.append("start_offset", offset.toString());
        fd.append("access_token", access_token);

        await axios.post(initUrl, fd, {
          headers: {
            ...fd.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        const percentComplete = Math.round((endChunk / fileSize) * 100);
        console.log(`Uploaded chunk: ${offset}-${endChunk} of ${fileSize} (${percentComplete}%)`);

        // Send chunk progress event if sessionId provided
        if (sessionId && fileIndex !== undefined) {
          broadcastToSession(sessionId, "file-progress", {
            fileIndex: fileIndex,
            fileName: file.originalname,
            stage: `Uploading video chunk ${currentChunk}/${totalChunks}`,
            progress: 30 + Math.round(percentComplete * 0.6), // Scale from 30% to 90%
          });
        }

        offset = endChunk;
      }

      // Step 3: Finish upload
      const finishResponse = await axios.post(initUrl, {
        upload_phase: "finish",
        upload_session_id: upload_session_id,
        access_token,
        title: file.originalname,
      });

      console.log("Successfully completed large video upload to Meta!");
      return video_id;
    } catch (err) {
      console.log("Error uploading large video to Facebook:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function to upload image
  async function uploadImageToMeta(filePath, adAccountId) {
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/adimages`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(filePath));
      fd.append("access_token", access_token);

      const response = await axios.post(imageUrl, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log("Successfully uploaded image!");
      const images = response.data.images;
      const dynamicKey = Object.keys(images)[0];
      return images[dynamicKey].hash;
    } catch (err) {
      console.log("Error uploading image:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function to upload thumbnail
  async function uploadThumbnailImage(thumbnailPath, adAccountId) {
    return uploadImageToMeta(thumbnailPath, adAccountId);
  }
});

app.post("/api/create-ad-set", validateRequest.createAdSet, (req, res) => {
  const payload = {
    name: req.body.adset_name,
    optimization_goal: req.body.optimization_goal,
    billing_event: req.body.billing_event,
    bid_strategy: req.body.bid_strategy,
    daily_budget: parseInt(req.body.daily_budget),
    campaign_id: req.body.campaign_id,
    destination_type: req.body.destination_type,
    targeting: {
      geo_locations: req.body.geo_locations || {
        countries: ["US"],
      },
      ...(req.body.excluded_geo_locations && {
        excluded_geo_locations: req.body.excluded_geo_locations,
      }),
      targeting_automation: {
        advantage_audience: 0,
      },
      ...(req.body.min_age &&
        req.body.max_age && {
          age_min: req.body.min_age,
          age_max: req.body.max_age,
        }),
    },
    promoted_object: {
      pixel_id: req.body.pixel_id,
      custom_event_type: req.body.event_type,
    },
    status: req.body.status,
    access_token,
  };

  if (req.body.bid_amount) {
    payload.bid_amount = req.body.bid_amount;
  }

  const graphUrl = `https://graph.facebook.com/${api_version}/act_${req.body.account_id}/adsets`;

  async function createAdSet() {
    try {
      await axios
        .post(graphUrl, payload, {
          headers: {
            "Content-Type": "application/json",
          },
        })
        .then((response) => {
          if (!response.statusText === "OK") {
            console.log("There was an error posting to adsets endpoint:", res);
          } else {
            // return the adset info for the creative upload section
            console.log(`Successfully created ad set ${req.body.adset_name} in act_${req.body.account_id}`);
            res.status(200).send(response.data);
          }
        });
    } catch (err) {
      console.log("There was an error creating your ad set.", err.response?.data);

      // Critical ad creation failure
      const fbError = err.response?.data?.error;
      const errorMessage = fbError?.error_user_msg || fbError?.message || err.message;
      const telegramMessage = `<b>⚠️ CRITICAL: Ad Set Creation Failed</b>\n<b>Account:</b> ${adAccountId}\n<b>Error:</b> ${errorMessage}`;
      sendTelegramNotification(telegramMessage);

      res.status(400).send("Error creating ad set.", err);
    }
  }

  createAdSet();
});

app.post("/api/duplicate-ad-set", async (req, res) => {
  const { ad_set_id, deep_copy, status_option, name, campaign_id, account_id } = req.body;

  const payload = {
    deep_copy: deep_copy || false,
    status_option: status_option || "PAUSED",
    access_token,
  };

  const graphUrl = `https://graph.facebook.com/${api_version}/${ad_set_id}/copies`;

  try {
    const response = await axios.post(graphUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status === 200 && response.data) {
      console.log(`Successfully duplicated ad set ${ad_set_id}`);

      const newAdSetId = response.data.copied_adset_id || response.data.id;

      if (name && newAdSetId) {
        try {
          const updateUrl = `https://graph.facebook.com/${api_version}/${newAdSetId}`;
          await axios.post(updateUrl, {
            name: name,
            access_token,
          });
          console.log(`Updated ad set name to: ${name}`);
        } catch (updateErr) {
          console.log("Warning: Could not update ad set name:", updateErr.response?.data || updateErr.message);
        }
      }

      // Add the new ad set to the cache
      if (campaign_id && account_id) {
        const newAdSet = {
          id: newAdSetId,
          name: name || `Copy of ${ad_set_id}`,
          account_id: account_id,
          campaign_id: campaign_id,
        };

        await FacebookCacheDB.addAdSetToCampaign(campaign_id, newAdSet);
      }

      // Return success
      res.status(200).json({
        id: newAdSetId,
        original_id: ad_set_id,
        success: true,
      });
    } else {
      console.log("Unexpected response from Facebook API:", response.data);
      res.status(400).json({ error: "Failed to duplicate ad set" });
    }
  } catch (err) {
    console.log("Error duplicating ad set:", err.response?.data || err.message);
    res.status(400).json({
      error: "Error duplicating ad set",
      details: err.response?.data?.error || err.message,
    });
  }
});

app.post("/api/duplicate-campaign", async (req, res) => {
  const { campaign_id, deep_copy, status_option, name, account_id } = req.body;

  const payload = {
    deep_copy: deep_copy || false,
    status_option: status_option || "PAUSED",
    rename_options: {
      rename_strategy: "ONLY_TOP_LEVEL_RENAME",
      rename_suffix: " - Copy",
    },
    access_token,
  };

  const graphUrl = `https://graph.facebook.com/${api_version}/${campaign_id}/copies`;

  try {
    const response = await axios.post(graphUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.status === 200 && response.data) {
      console.log(`Successfully duplicated campaign ${campaign_id}`);
      console.log("Facebook API response:", JSON.stringify(response.data, null, 2));

      const newCampaignId = response.data.copied_campaign_id || response.data.id || response.data.campaign_id;

      if (!newCampaignId) {
        console.error("No campaign ID found in response:", response.data);
        res.status(400).json({ error: "Campaign duplicated but ID not found in response" });
        return;
      }

      if (name && newCampaignId) {
        try {
          const updateUrl = `https://graph.facebook.com/${api_version}/${newCampaignId}`;
          await axios.post(updateUrl, {
            name: name,
            access_token,
          });
          console.log(`Updated campaign name to: ${name}`);

          // If we have a name, update the database with the new campaign info
          if (account_id) {
            await addCampaignToDatabase(newCampaignId, name, account_id);
          }
        } catch (updateError) {
          console.error("Error updating campaign name:", updateError.response?.data || updateError.message);
          // Don't fail the whole operation if just the rename fails
        }
      } else if (account_id) {
        // If no name provided, still add to database with original name
        try {
          await addCampaignToDatabase(newCampaignId, null, account_id);
        } catch (dbError) {
          console.error("Error adding to database:", dbError);
          // Don't fail the whole operation if just the database update fails
        }
      }

      // Return success
      res.status(200).json({
        id: newCampaignId,
        original_id: campaign_id,
        success: true,
      });
    } else {
      console.log("Unexpected response from Facebook API:", response.data);
      res.status(400).json({ error: "Failed to duplicate campaign" });
    }
  } catch (err) {
    console.log("Error duplicating campaign:", err.response?.data || err.message);
    res.status(400).json({
      error: "Error duplicating campaign",
      details: err.response?.data?.error || err.message,
    });
  }
});

// Helper function to add campaign to database
async function addCampaignToDatabase(campaignId, campaignName, accountId) {
  try {
    // Get campaign details from Facebook API
    const campaignUrl = `https://graph.facebook.com/${api_version}/${campaignId}?fields=name,status,special_ad_categories,daily_budget,bid_strategy&access_token=${access_token}`;
    const campaignResponse = await axios.get(campaignUrl);

    if (campaignResponse.data) {
      const campaign = campaignResponse.data;
      const name = campaignName || campaign.name;

      // Insert into database
      await FacebookCacheDB.saveCampaigns([
        {
          id: campaign.id,
          account_id: accountId,
          name: name,
          status: campaign.status || "PAUSED",
          special_ad_categories: campaign.special_ad_categories || [],
          daily_budget: campaign.daily_budget || "",
          bid_strategy: campaign.bid_strategy || "",
        },
      ]);

      console.log(`Added campaign ${campaignId} to database`);
    }
  } catch (error) {
    console.error("Error adding campaign to database:", error.response?.data || error.message);
  }
}

// Bulk copy campaigns to multiple accounts
app.post("/api/bulk-copy-campaigns", ensureAuthenticatedAPI, async (req, res) => {
  const { campaign_ids, target_account_id } = req.body;

  // Validate input
  if (!campaign_ids || !Array.isArray(campaign_ids) || campaign_ids.length === 0) {
    return res.status(400).json({ error: "campaign_ids must be a non-empty array" });
  }

  if (!target_account_id) {
    return res.status(400).json({ error: "target_account_id is required" });
  }

  try {
    const userId = getUserId(req);
    const token = await getAccessToken(userId);

    // Meta Batch API can handle up to 50 requests per batch
    const batchSize = 50;
    const results = [];

    // Process campaigns in batches
    for (let i = 0; i < campaign_ids.length; i += batchSize) {
      const batchCampaigns = campaign_ids.slice(i, i + batchSize);
      
      // Build batch request array
      const batchRequests = batchCampaigns.map((campaignId, index) => ({
        method: "POST",
        name: `copy-campaign-${index}`,
        relative_url: `${campaignId}/copies`,
        body: new URLSearchParams({
          deep_copy: "true",
          status_option: "PAUSED",
          rename_options: JSON.stringify({
            rename_strategy: "ONLY_TOP_LEVEL_RENAME",
            rename_suffix: " - Copy"
          }),
          access_token: token
        }).toString()
      }));

      // Execute batch request
      const batchUrl = `https://graph.facebook.com/${api_version}/`;
      const batchResponse = await circuitBreakers.facebook.call(async () => {
        return await axios.post(batchUrl, null, {
          params: {
            batch: JSON.stringify(batchRequests),
            access_token: token,
            include_headers: false
          },
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        });
      });

      // Parse batch response
      if (batchResponse.data && Array.isArray(batchResponse.data)) {
        for (let j = 0; j < batchResponse.data.length; j++) {
          const response = batchResponse.data[j];
          const originalCampaignId = batchCampaigns[j];
          
          if (response.code === 200) {
            try {
              const body = JSON.parse(response.body);
              const newCampaignId = body.copied_campaign_id || body.id || body.campaign_id;
              
              if (newCampaignId) {
                // Add to database cache
                try {
                  await addCampaignToDatabase(newCampaignId, null, target_account_id);
                } catch (dbError) {
                  console.error("Error adding campaign to database:", dbError);
                }

                results.push({
                  original_id: originalCampaignId,
                  new_id: newCampaignId,
                  success: true
                });
              } else {
                results.push({
                  original_id: originalCampaignId,
                  success: false,
                  error: "Campaign ID not found in response"
                });
              }
            } catch (parseError) {
              results.push({
                original_id: originalCampaignId,
                success: false,
                error: "Failed to parse response: " + parseError.message
              });
            }
          } else {
            // Extract error from response
            let errorMessage = "Unknown error";
            try {
              const body = JSON.parse(response.body);
              errorMessage = body.error?.message || body.error || errorMessage;
            } catch (e) {
              errorMessage = response.body || errorMessage;
            }

            results.push({
              original_id: originalCampaignId,
              success: false,
              error: errorMessage
            });
          }
        }
      }
    }

    // Count successes and failures
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      total: campaign_ids.length,
      successful,
      failed,
      results
    });

  } catch (error) {
    console.error("Bulk copy campaigns error:", error.response?.data || error.message);
    
    // Send Telegram notification for critical failures
    if (process.env.TELEGRAM_BOT_TOKEN) {
      await sendTelegramNotification(
        `🚨 Bulk Copy Campaigns Failed\n\nError: ${error.message}\nAccount: ${target_account_id}\nCampaigns: ${campaign_ids.length}`
      );
    }

    res.status(500).json({
      error: "Failed to copy campaigns",
      details: error.response?.data?.error?.message || error.message
    });
  }
});

app.post("/api/upload-videos", upload.array("file", 50), validateRequest.uploadFiles, (req, res) => {
  try {
    const files = req.files;
    const adAccountId = req.body.account_id;

    let sessionId = req.body.sessionId;
    let session;

    if (sessionId && uploadSessions.has(sessionId)) {
      // Use existing session
      session = uploadSessions.get(sessionId);
      console.log("Using existing session:", sessionId);
    } else {
      // Create new session
      sessionId = createUploadSession();
      session = uploadSessions.get(sessionId);
      console.log("Created new session:", sessionId);
    }

    // Update session with file info
    if (session) {
      session.totalFiles = files.length;
      session.processedFiles = 0;

      // Send session start event
      broadcastToSession(sessionId, "session-start", {
        sessionId,
        totalFiles: files.length,
      });
    }

    async function videoUploadPromise() {
      const results = await Promise.allSettled(
        files.map((file, index) => {
          return handleVideoUpload(file, index)
            .then((response) => ({
              type: "video",
              file: file.originalname,
              data: response,
              status: "success",
            }))
            .then((data) => {
              return data;
            })
            .catch((error) => ({
              file: file.originalname,
              status: "failed",
              error: error.message,
            }));
        })
      );

      // Send session complete event
      broadcastToSession(sessionId, "session-complete", {
        totalFiles: files.length,
        processedFiles: session.processedFiles,
        results: results,
      });

      res.status(200).json({ results, sessionId });
    }

    videoUploadPromise();

    async function handleVideoUpload(file, index) {
      console.log("File: ", file);
      console.log(`File size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`);

      // Send file start event
      broadcastToSession(sessionId, "file-start", {
        fileIndex: index,
        fileName: file.originalname,
        fileSize: (file.size / (1024 * 1024)).toFixed(2) + "MB",
        totalFiles: files.length,
      });

      try {
        // Update session current file
        if (session) {
          session.currentFile = {
            name: file.originalname,
            size: (file.size / (1024 * 1024)).toFixed(2) + "MB",
            status: "processing",
            progress: 0,
            stage: "Processing creative",
          };
        }

        // Process creative with deduplication
        broadcastToSession(sessionId, "file-progress", {
          fileIndex: index,
          fileName: file.originalname,
          stage: "Processing creative",
          progress: 5,
        });

        file.mimetype = "video/mp4"; // Set mimetype for videos
        const creativeResult = await processCreative(file, adAccountId);

        let uploadVideo, getImageHash;
        let filePath = file.path; // Default to uploaded file path

        if (creativeResult.isDuplicate) {
          // Creative already exists and is uploaded to this account
          uploadVideo = creativeResult.facebookIds.facebook_video_id;
          getImageHash = creativeResult.facebookIds.facebook_image_hash;

          // Update session progress
          if (session) {
            session.processedFiles++;
          }

          // Send file complete event
          broadcastToSession(sessionId, "file-complete", {
            fileIndex: index,
            fileName: file.originalname,
            processedFiles: session.processedFiles,
            totalFiles: files.length,
            isDuplicate: true,
            message: "Using existing creative from library",
          });

          return { uploadVideo, getImageHash, adAccountId, isDuplicate: true };
        } else {
          // Need to upload to Meta
          if (!creativeResult.isNew) {
            // Use existing file from library
            filePath = getCreativeFilePath(creativeResult.creative);
          } else {
            // New creative was moved to library, get the new path
            filePath = creativeResult.libraryPath || getCreativeFilePath(creativeResult.creative);
          }

          // Update file path for all upload functions
          file.path = filePath;

          // 1. Get thumbnail from video
          broadcastToSession(sessionId, "file-progress", {
            fileIndex: index,
            fileName: file.originalname,
            stage: "Creating thumbnail",
            progress: 10,
          });
          const thumbnail = await getThumbnailFromVideo(file);

          // 2. Upload video
          broadcastToSession(sessionId, "file-progress", {
            fileIndex: index,
            fileName: file.originalname,
            stage: "Uploading video to Meta",
            progress: 30,
          });
          uploadVideo = await uploadVideosToMeta(file, adAccountId, sessionId, index);

          // 3. Upload thumbnail to meta
          broadcastToSession(sessionId, "file-progress", {
            fileIndex: index,
            fileName: file.originalname,
            stage: "Uploading thumbnail",
            progress: 90,
          });
          getImageHash = await uploadThumbnailImage(thumbnail, adAccountId);

          // 4. Store Facebook IDs in database
          await CreativeAccountDB.recordUpload(creativeResult.creative.id, adAccountId, {
            videoId: uploadVideo,
            imageHash: getImageHash,
          });

          // 5. Update creative with thumbnail path
          if (creativeResult.isNew) {
            await updateCreativeThumbnail(creativeResult.creative.id, thumbnail);
          }

          // 6. Clean up temporary thumbnail (but not the video - it's in library now)
          try {
            if (fs.existsSync(thumbnail)) {
              fs.unlinkSync(thumbnail);
              console.log(`Deleted temporary thumbnail file: ${thumbnail}`);
            }
          } catch (cleanupErr) {
            console.error("Error cleaning up thumbnail:", cleanupErr);
          }

          // Update session progress
          if (session) {
            session.processedFiles++;
          }

          // Send file complete event
          broadcastToSession(sessionId, "file-complete", {
            fileIndex: index,
            fileName: file.originalname,
            processedFiles: session.processedFiles,
            totalFiles: files.length,
            isNew: creativeResult.isNew,
          });

          return { uploadVideo, getImageHash, adAccountId, isNew: creativeResult.isNew };
        }
      } catch (err) {
        console.log("There was an error inside handleVideoUpload() try catch block.", err);

        // Send file error event
        broadcastToSession(sessionId, "file-error", {
          fileIndex: index,
          fileName: file.originalname,
          error: err.message,
        });

        // Clean up files on error as well
        try {
          if (file.path && fs.existsSync(file.path) && file.path.includes(paths.uploads)) {
            // Only delete if it's still in uploads directory
            fs.unlinkSync(file.path);
          }
        } catch (cleanupErr) {
          console.error("Error cleaning up files on error:", cleanupErr);
        }

        throw err; // Re-throw to be caught by Promise
      }
    }
  } catch (err) {
    console.log("There was an error in uploading videos to facebook.", err);
    res.status(500).send("Could not upload videos to facebook.", err);
  }

  // function to get thumbnail from video
  async function getThumbnailFromVideo(file) {
    // Use the actual file path which may be in creative-library
    const videoPath = file.path;
    const thumbnailDir = path.join(__dirname, "uploads");
    const thumbnailName = `${path.basename(file.path)}-thumb.png`;
    const thumbnailPath = path.join(thumbnailDir, thumbnailName);

    console.log("Attempting to create thumbnail:");
    console.log("  Video path:", videoPath);
    console.log("  Thumbnail path:", thumbnailPath);
    console.log("  Video exists:", fs.existsSync(videoPath));

    // Ensure uploads directory exists
    if (!fs.existsSync(thumbnailDir)) {
      console.log("Creating uploads directory:", thumbnailDir);
      fs.mkdirSync(thumbnailDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput("00:00:01")
        .screenshots({
          timestamps: ["00:00:01"],
          filename: thumbnailName,
          folder: thumbnailDir,
        })
        .on("end", () => {
          console.log("Thumbnail created successfully:", thumbnailPath);
          console.log("Thumbnail exists:", fs.existsSync(thumbnailPath));
          resolve(thumbnailPath);
        })
        .on("error", (err) => {
          console.error("Error creating thumbnail:", err);
          reject(err);
        });
    });
  }

  // Upload videos to meta
  async function uploadVideosToMeta(file, adAccountId, sessionId, fileIndex) {
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Use resumable upload for files > 20MB
    if (fileSize > 20 * 1024 * 1024) {
      return await uploadLargeVideoToMetaWithProgress(file, adAccountId, sessionId, fileIndex);
    }

    // Regular upload for smaller files
    const upload_url = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(file.path));
      fd.append("name", file.originalname);
      fd.append("access_token", access_token);

      const response = await axios.post(upload_url, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log("Successfully uploaded video to Meta!");
      console.log("Video ID:", response.data.id);

      return response.data.id;
    } catch (err) {
      console.log("There was an error uploading video to Facebook:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function for chunked upload with progress
  async function uploadLargeVideoToMetaWithProgress(file, adAccountId, sessionId, fileIndex) {
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Step 1: Initialize upload session
    const initUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

    try {
      // Initialize the upload session
      const initResponse = await axios.post(initUrl, {
        upload_phase: "start",
        file_size: fileSize,
        access_token,
      });

      const { upload_session_id, video_id } = initResponse.data;
      console.log(`Upload session initialized. Session ID: ${upload_session_id}`);

      // Step 2: Upload chunks
      const chunkSize = 4 * 1024 * 1024; // 4MB chunks
      let offset = 0;
      const totalChunks = Math.ceil(fileSize / chunkSize);
      let currentChunk = 0;

      while (offset < fileSize) {
        currentChunk++;
        const endChunk = Math.min(offset + chunkSize, fileSize);
        const chunk = fs.createReadStream(file.path, {
          start: offset,
          end: endChunk - 1,
        });

        const fd = new FormData();
        fd.append("video_file_chunk", chunk);
        fd.append("upload_phase", "transfer");
        fd.append("upload_session_id", upload_session_id);
        fd.append("start_offset", offset.toString());
        fd.append("access_token", access_token);

        await axios.post(initUrl, fd, {
          headers: {
            ...fd.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        const percentComplete = Math.round((endChunk / fileSize) * 100);
        console.log(`Uploaded chunk: ${offset}-${endChunk} of ${fileSize} (${percentComplete}%)`);

        // Send chunk progress event
        broadcastToSession(sessionId, "file-progress", {
          fileIndex: fileIndex,
          fileName: file.originalname,
          stage: `Uploading video chunk ${currentChunk}/${totalChunks}`,
          progress: 30 + Math.round(percentComplete * 0.6), // Scale from 30% to 90%
        });

        offset = endChunk;
      }

      // Step 3: Finish upload
      await axios.post(initUrl, {
        upload_phase: "finish",
        upload_session_id: upload_session_id,
        access_token,
        title: file.originalname,
      });

      console.log("Successfully completed large video upload to Meta!");
      return video_id;
    } catch (err) {
      console.log("Error uploading large video to Facebook:", err.response?.data || err.message);
      throw err;
    }
  }

  // upload thumbnail as image to get image_hash
  async function uploadThumbnailImage(thumbnailPath, adAccountId) {
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/adimages`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(thumbnailPath));
      fd.append("access_token", access_token);

      const response = await axios.post(imageUrl, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log("Successfully uploaded thumbnail image!");

      console.log(response.data);

      const images = response.data.images;
      const dynamicKey = Object.keys(images)[0];
      const imageHash = images[dynamicKey].hash;

      return imageHash;
    } catch (err) {
      console.log("Error uploading thumbnail image:", err.response?.data || err.message);
      throw err;
    }
  }
});

app.post("/api/upload-images", upload.array("file", 50), validateRequest.uploadFiles, (req, res) => {
  const files = req.files;
  const accountId = req.body.account_id;
  const imageUrl = `https://graph.facebook.com/${api_version}/act_${accountId}/adimages`;

  async function imageUploadPromise() {
    const results = await Promise.allSettled(
      files.map(async (file) => {
        try {
          // Process creative with deduplication
          file.mimetype = file.mimetype || "image/jpeg"; // Set mimetype for images
          const creativeResult = await processCreative(file, accountId);

          if (creativeResult.isDuplicate) {
            // Creative already exists and is uploaded to this account
            return {
              type: "image",
              file: file.originalname,
              imageHash: creativeResult.facebookIds.facebook_image_hash,
              status: "success",
              isDuplicate: true,
              message: "Using existing creative from library",
            };
          } else {
            // Need to upload to Meta
            let filePath;
            if (!creativeResult.isNew) {
              // Use existing file from library
              filePath = getCreativeFilePath(creativeResult.creative);
            } else {
              // New file was moved to library, use the new path
              filePath = creativeResult.libraryPath || getCreativeFilePath(creativeResult.creative);
            }
            // Update file.path for consistency
            file.path = filePath;

            const imageHash = await uploadImages(filePath, file.originalname);

            // Store Facebook IDs in database
            await CreativeAccountDB.recordUpload(creativeResult.creative.id, accountId, {
              imageHash: imageHash,
            });

            return {
              type: "image",
              file: file.originalname,
              imageHash: imageHash,
              status: "success",
              isNew: creativeResult.isNew,
            };
          }
        } catch (error) {
          return {
            file: file.originalname,
            status: "failed",
            error: error.message,
          };
        }
      })
    );

    res.status(200).json(results);
  }

  imageUploadPromise();

  async function uploadImages(filePath, originalName) {
    const file_path = fs.createReadStream(filePath);

    try {
      const fd = new FormData();
      fd.append(`${originalName}`, file_path);
      fd.append("access_token", access_token);

      const response = await axios.post(imageUrl, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log("Successfully uploaded images!");

      const images = response.data.images;
      const dynamicKey = Object.keys(images)[0];
      const imageHash = images[dynamicKey].hash;

      return imageHash;
    } catch (err) {
      console.log("There was an error uploading images to facebook.", err.response?.data);
      throw err;
    }
  }
});

app.post("/api/create-ad-creative", (req, res) => {
  try {
    const { name, page_id, message, headline, type, link, description, account_id, adset_id, assets } = req.body;

    // Log the link safely
    console.log("Received ad creative request with link length:", link ? link.length : 0);

    async function createAdCreativePromises() {
      const response = await Promise.allSettled(
        assets.map((asset) => {
          return createAdCreative(asset);
        })
      );

      // Check if any creatives failed
      const failures = response.filter((r) => r.status === "rejected");
      if (failures.length > 0) {
        console.log("Some ad creatives failed to create:", failures);
      }

      res.status(200).json(response);
    }

    createAdCreativePromises();

    async function createAdCreative(asset) {
      let creativeData;

      const adName = asset.adName || name;
      const assetType = asset.value.type;

      // IZAK - i believe to update the display link it is "caption" https://developers.facebook.com/docs/marketing-api/reference/ad-creative-link-data/

      // payload for video upload
      if (assetType === "video") {
        creativeData = {
          name: adName,
          object_story_spec: {
            page_id,
            video_data: {
              title: headline,
              image_hash: asset.value.data.getImageHash,
              video_id: asset.value.data.uploadVideo,
              message,
              link_description: description,
              call_to_action: {
                type,
                value: {
                  link,
                },
              },
            },
          },
        };
      } else {
        // payload for image upload
        creativeData = {
          name: adName,
          adset_id,
          object_story_spec: {
            page_id,
            link_data: {
              call_to_action: {
                type,
                value: {
                  link,
                },
              },
              image_hash: asset.value.imageHash,
              message,
              name: headline,
              description,
              link,
            },
          },
        };
      }

      const creative_url = `https://graph.facebook.com/${api_version}/act_${account_id}/adcreatives`;

      return axios
        .post(creative_url, {
          ...creativeData,
          access_token,
        })
        .then((response) => {
          return response.data;
        })
        .then((data) => {
          return createAd(data.id, adName).then(() => {
            console.log(`Facebook ad created successfully! Ad ID: ${data.id}`);
            return { adId: data.id, adName: adName, success: true };
          });
        })
        .catch((err) => {
          console.log("Error creating ad creative:", err.response?.data || err.message);
          const fbError = err.response?.data?.error;
          let errorMessage = "Unknown error";

          if (fbError) {
            // Use Facebook's user-friendly message if available
            errorMessage = fbError.error_user_msg || fbError.message;

            // Add more context for common errors
            if (fbError.error_subcode === 1487860) {
              errorMessage = `${errorMessage} (Ad Set Status: ${fbError.error_user_title})`;
            }
          } else {
            errorMessage = err.message;
          }

          throw new Error(`Ad "${adName}": ${errorMessage}`);
        });
    }

    async function createAd(adCreativeId, adName) {
      const payload = {
        name: adName,
        adset_id,
        status: "ACTIVE",
        creative: {
          creative_id: adCreativeId,
        },
        access_token,
      };
      const url = `https://graph.facebook.com/${api_version}/act_${account_id}/ads`;

      try {
        const response = await axios.post(url, payload);
        const data = await response;
        console.log("Ad created!", data);
        return data;
      } catch (err) {
        console.log("There was an error creating ad.", err.response?.data);
        throw err;
      }
    }
  } catch (error) {
    console.error("Error in create-ad-creative endpoint:", error);
    res.status(500).json({ error: "Failed to process ad creative request" });
  }
});

// Get all creatives from library
app.get("/api/creative-library", async (req, res) => {
  try {
    const { limit = 100, offset = 0, search } = req.query;

    let creatives;
    if (search) {
      creatives = await CreativeDB.search(search);
    } else {
      creatives = await CreativeDB.getAll(parseInt(limit), parseInt(offset));
    }

    // Add full URLs for thumbnails
    creatives = creatives.map((creative) => ({
      ...creative,
      thumbnailUrl: creative.thumbnail_path ? `/creative-library/thumbnails/${path.basename(creative.thumbnail_path)}` : null,
      fileUrl: `/creative-library/${creative.file_type.startsWith("video/") ? "videos" : "images"}/${path.basename(creative.file_path)}`,
    }));

    res.json({ creatives });
  } catch (error) {
    console.error("Error fetching creatives:", error);
    res.status(500).json({ error: "Failed to fetch creatives" });
  }
});

// Get specific creative details
app.get("/api/creative-library/:id", async (req, res) => {
  try {
    const creative = await CreativeDB.getById(req.params.id);
    if (!creative) {
      return res.status(404).json({ error: "Creative not found" });
    }

    // Add full URLs
    creative.thumbnailUrl = creative.thumbnail_path ? `/creative-library/thumbnails/${path.basename(creative.thumbnail_path)}` : null;
    creative.fileUrl = `/creative-library/${creative.file_type.startsWith("video/") ? "videos" : "images"}/${path.basename(creative.file_path)}`;

    res.json({ creative });
  } catch (error) {
    console.error("Error fetching creative:", error);
    res.status(500).json({ error: "Failed to fetch creative" });
  }
});

// Upload existing creative to new ad account
app.post("/api/creative-library/upload-to-account", async (req, res) => {
  try {
    const { creativeId, adAccountId } = req.body;

    // Get creative details
    const creative = await CreativeDB.getById(creativeId);
    if (!creative) {
      return res.status(404).json({ error: "Creative not found" });
    }

    // Check if already uploaded to this account
    const isUploaded = await CreativeAccountDB.isUploadedToAccount(creativeId, adAccountId);
    if (isUploaded) {
      const facebookIds = await CreativeAccountDB.getFacebookIds(creativeId, adAccountId);
      return res.json({
        message: "Creative already uploaded to this account",
        facebookIds,
        isExisting: true,
      });
    }

    // Get file paths
    const filePath = getCreativeFilePath(creative);
    const isVideo = creative.file_type.startsWith("video/");

    if (isVideo) {
      // Upload video
      const fileObj = {
        path: filePath,
        originalname: creative.original_name,
        size: creative.file_size,
      };

      const videoId = await uploadVideoToMeta(fileObj, adAccountId);

      // Upload thumbnail if exists
      let imageHash = null;
      if (creative.thumbnail_path) {
        const thumbnailPath = getThumbnailFilePath(creative);
        imageHash = await uploadThumbnailImage(thumbnailPath, adAccountId);
      }

      // Store Facebook IDs
      await CreativeAccountDB.recordUpload(creativeId, adAccountId, {
        videoId,
        imageHash,
      });

      res.json({
        message: "Video uploaded successfully",
        facebookIds: { videoId, imageHash },
      });
    } else {
      // Upload image
      const imageHash = await uploadImageToMeta(filePath, adAccountId);

      // Store Facebook IDs
      await CreativeAccountDB.recordUpload(creativeId, adAccountId, {
        imageHash,
      });

      res.json({
        message: "Image uploaded successfully",
        facebookIds: { imageHash },
      });
    }
  } catch (error) {
    console.error("Error uploading creative to account:", error);
    res.status(500).json({ error: "Failed to upload creative to account" });
  }

  // Helper function to upload video to Meta (extracted from existing code)
  async function uploadVideoToMeta(file, adAccountId) {
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Use resumable upload for files > 20MB
    if (fileSize > 20 * 1024 * 1024) {
      return await uploadLargeVideoToMeta(file, adAccountId);
    }

    // Regular upload for smaller files
    const upload_url = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(file.path));
      fd.append("name", file.originalname);
      fd.append("access_token", access_token);

      const response = await axios.post(upload_url, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      console.log("Successfully uploaded video to Meta!");
      return response.data.id;
    } catch (err) {
      console.log("Error uploading video to Facebook:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function for large video uploads
  async function uploadLargeVideoToMeta(file, adAccountId) {
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    const initUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/advideos`;

    try {
      const initResponse = await axios.post(initUrl, {
        upload_phase: "start",
        file_size: fileSize,
        access_token,
      });

      const { upload_session_id, video_id } = initResponse.data;

      const chunkSize = 4 * 1024 * 1024; // 4MB chunks
      let offset = 0;

      while (offset < fileSize) {
        const endChunk = Math.min(offset + chunkSize, fileSize);
        const chunk = fs.createReadStream(file.path, {
          start: offset,
          end: endChunk - 1,
        });

        const fd = new FormData();
        fd.append("video_file_chunk", chunk);
        fd.append("upload_phase", "transfer");
        fd.append("upload_session_id", upload_session_id);
        fd.append("start_offset", offset.toString());
        fd.append("access_token", access_token);

        await axios.post(initUrl, fd, {
          headers: {
            ...fd.getHeaders(),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });

        offset = endChunk;
      }

      await axios.post(initUrl, {
        upload_phase: "finish",
        upload_session_id: upload_session_id,
        access_token,
        title: file.originalname,
      });

      return video_id;
    } catch (err) {
      console.log("Error uploading large video to Facebook:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function to upload image
  async function uploadImageToMeta(filePath, adAccountId) {
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${adAccountId}/adimages`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(filePath));
      fd.append("access_token", access_token);

      const response = await axios.post(imageUrl, fd, {
        headers: {
          ...fd.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const images = response.data.images;
      const dynamicKey = Object.keys(images)[0];
      return images[dynamicKey].hash;
    } catch (err) {
      console.log("Error uploading image:", err.response?.data || err.message);
      throw err;
    }
  }

  // Helper function to upload thumbnail
  async function uploadThumbnailImage(thumbnailPath, adAccountId) {
    return uploadImageToMeta(thumbnailPath, adAccountId);
  }
});

// Delete a creative from library
app.delete("/api/creative-library/:id", async (req, res) => {
  try {
    const creativeId = parseInt(req.params.id);

    // Get creative details before deleting
    const creativeData = await CreativeDB.getById(creativeId);
    if (!creativeData) {
      return res.status(404).json({ error: "Creative not found" });
    }

    // Delete files from filesystem
    const filePath = getCreativeFilePath(creativeData);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted file: ${filePath}`);
    }

    // Delete thumbnail if exists
    if (creativeData.thumbnail_path) {
      const thumbnailPath = getThumbnailFilePath(creativeData);
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
        console.log(`Deleted thumbnail: ${thumbnailPath}`);
      }
    }

    // Delete from database
    await CreativeDB.delete(creativeId);

    res.json({ message: "Creative deleted successfully" });
  } catch (error) {
    console.error("Error deleting creative:", error);
    res.status(500).json({ error: "Failed to delete creative" });
  }
});

// Delete all creatives from library
app.delete("/api/creative-library", async (req, res) => {
  try {
    // Get all creatives before deleting
    const creatives = await CreativeDB.getAll(1000, 0);

    // Delete all files
    for (const creative of creatives) {
      // Delete main file
      const filePath = getCreativeFilePath(creative);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted file: ${filePath}`);
      }

      // Delete thumbnail if exists
      if (creative.thumbnail_path) {
        const thumbnailPath = getThumbnailFilePath(creative);
        if (fs.existsSync(thumbnailPath)) {
          fs.unlinkSync(thumbnailPath);
          console.log(`Deleted thumbnail: ${thumbnailPath}`);
        }
      }
    }

    // Delete all from database
    const deletedCount = await CreativeDB.deleteAll();

    res.json({
      message: "All creatives deleted successfully",
      deletedCount,
    });
  } catch (error) {
    console.error("Error deleting all creatives:", error);
    res.status(500).json({ error: "Failed to delete all creatives" });
  }
});

// Creative Batch API endpoints

// Get all batches
app.get("/api/creative-batches", async (req, res) => {
  try {
    const batches = await BatchDB.getAll();
    res.json({ batches });
  } catch (error) {
    console.error("Error fetching batches:", error);
    res.status(500).json({ error: "Failed to fetch batches" });
  }
});

// Create new batch
app.post("/api/creative-batches", async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Batch name is required" });
    }

    const batchId = await BatchDB.create(name, description);
    const batch = await BatchDB.getById(batchId);

    res.json({ batch });
  } catch (error) {
    console.error("Error creating batch:", error);
    if (error.message?.includes("UNIQUE constraint failed")) {
      res.status(400).json({ error: "A batch with this name already exists" });
    } else {
      res.status(500).json({ error: "Failed to create batch" });
    }
  }
});

// Update batch
app.put("/api/creative-batches/:id", async (req, res) => {
  try {
    const { name, description } = req.body;
    const batchId = parseInt(req.params.id);

    if (!name) {
      return res.status(400).json({ error: "Batch name is required" });
    }

    await BatchDB.update(batchId, name, description);
    const batch = await BatchDB.getById(batchId);

    res.json({ batch });
  } catch (error) {
    console.error("Error updating batch:", error);
    res.status(500).json({ error: "Failed to update batch" });
  }
});

// Delete batch
app.delete("/api/creative-batches/:id", async (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const deletedCount = await BatchDB.delete(batchId);

    if (deletedCount === 0) {
      return res.status(404).json({ error: "Batch not found" });
    }

    res.json({ message: "Batch deleted successfully" });
  } catch (error) {
    console.error("Error deleting batch:", error);
    res.status(500).json({ error: "Failed to delete batch" });
  }
});

// Get creatives in a batch
app.get("/api/creative-batches/:id/creatives", async (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const creatives = await BatchDB.getCreatives(batchId);

    // Add full URLs for thumbnails and files
    const creativesWithUrls = creatives.map((creative) => ({
      ...creative,
      thumbnailUrl: creative.thumbnail_path ? `/creative-library/thumbnails/${path.basename(creative.thumbnail_path)}` : null,
      fileUrl: `/creative-library/${creative.file_type.startsWith("video/") ? "videos" : "images"}/${path.basename(creative.file_path)}`,
    }));

    res.json({ creatives: creativesWithUrls });
  } catch (error) {
    console.error("Error fetching batch creatives:", error);
    res.status(500).json({ error: "Failed to fetch batch creatives" });
  }
});

// Add creatives to batch
app.post("/api/creative-batches/:id/creatives", async (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const { creativeIds } = req.body;

    if (!Array.isArray(creativeIds) || creativeIds.length === 0) {
      return res.status(400).json({ error: "Creative IDs array is required" });
    }

    const updatedCount = await CreativeDB.updateBatchBulk(creativeIds, batchId);

    res.json({
      message: `${updatedCount} creative(s) added to batch`,
      updatedCount,
    });
  } catch (error) {
    console.error("Error adding creatives to batch:", error);
    res.status(500).json({ error: "Failed to add creatives to batch" });
  }
});

// Remove creative from batch
app.delete("/api/creative-batches/:batchId/creatives/:creativeId", async (req, res) => {
  try {
    const creativeId = parseInt(req.params.creativeId);

    await CreativeDB.updateBatch(creativeId, null);

    res.json({ message: "Creative removed from batch" });
  } catch (error) {
    console.error("Error removing creative from batch:", error);
    res.status(500).json({ error: "Failed to remove creative from batch" });
  }
});

// Upload library creatives to a specific ad account
app.post("/api/upload-library-creatives", validateRequest.uploadLibraryCreatives, async (req, res) => {
  try {
    const { creativeIds, account_id, sessionId } = req.body;

    if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
      return res.status(400).json({ error: "Creative IDs array is required" });
    }

    if (!account_id) {
      return res.status(400).json({ error: "Account ID is required" });
    }

    const results = [];

    for (const creativeId of creativeIds) {
      try {
        // Get creative details
        const creative = await CreativeDB.getById(creativeId);
        if (!creative) {
          results.push({
            status: "rejected",
            creativeId,
            reason: "Creative not found",
          });
          continue;
        }

        // Check if already uploaded to this account
        const existingUpload = await CreativeAccountDB.getFacebookIds(creativeId, account_id);
        if (existingUpload) {
          // Already uploaded, just return existing data
          if (creative.file_type.startsWith("video/")) {
            results.push({
              status: "fulfilled",
              value: {
                type: "video",
                file: creative.original_name,
                data: {
                  uploadVideo: existingUpload.facebook_video_id,
                  getImageHash: existingUpload.facebook_image_hash,
                },
                status: "success",
                isExisting: true,
              },
            });
          } else {
            results.push({
              status: "fulfilled",
              value: {
                type: "image",
                file: creative.original_name,
                imageHash: existingUpload.facebook_image_hash,
                status: "success",
                isExisting: true,
              },
            });
          }
          continue;
        }

        // Get file path
        const filePath = getCreativeFilePath(creative);
        const isVideo = creative.file_type.startsWith("video/");

        if (isVideo) {
          // Upload video
          const fileObj = {
            path: filePath,
            originalname: creative.original_name,
            size: creative.file_size,
          };

          // Get or create thumbnail
          let thumbnailPath = creative.thumbnail_path ? getThumbnailFilePath(creative) : null;
          if (!thumbnailPath) {
            const thumbnail = await getThumbnailFromVideo(fileObj);
            thumbnailPath = thumbnail.path;

            // Update creative with thumbnail
            await updateCreativeThumbnail(creative.id, path.relative(__dirname, thumbnailPath));
          }

          // Upload video and thumbnail
          const thumbnail_image_hash = await uploadImageToMeta(thumbnailPath, account_id);
          const video_id = await uploadVideoToMeta(fileObj, account_id);

          // Store Facebook IDs
          await CreativeAccountDB.recordUpload(creative.id, account_id, {
            videoId: video_id,
            imageHash: thumbnail_image_hash,
          });

          results.push({
            status: "fulfilled",
            value: {
              type: "video",
              file: creative.original_name,
              data: {
                uploadVideo: video_id,
                getImageHash: thumbnail_image_hash,
              },
              status: "success",
            },
          });
        } else {
          // Upload image
          const imageHash = await uploadImageToMeta(filePath, account_id);

          // Store Facebook ID
          await CreativeAccountDB.recordUpload(creative.id, account_id, { imageHash });

          results.push({
            status: "fulfilled",
            value: {
              type: "image",
              file: creative.original_name,
              imageHash: imageHash,
              status: "success",
            },
          });
        }
      } catch (error) {
        console.error(`Error uploading creative ${creativeId}:`, error);
        results.push({
          status: "rejected",
          creativeId,
          reason: error.message,
        });
      }
    }

    res.json({ results });
  } catch (error) {
    console.error("Error in upload-library-creatives:", error);
    res.status(500).json({ error: "Failed to upload library creatives" });
  }
});

// Serve creative library files
app.use("/creative-library", express.static(paths.creativeLibrary));

// Global error handler middleware (must be last)
app.use((err, req, res, next) => {
  const errorDetails = {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  };

  console.error("Unhandled error:", errorDetails);

  // Send Telegram notification for unhandled errors
  const telegramMessage = `<b>Unhandled Express Error</b>
<b>URL:</b> ${req.method} ${req.url}
<b>Error:</b> ${err.message}
<b>IP:</b> ${req.ip}`;
  sendTelegramNotification(telegramMessage);

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === "development";

  res.status(err.status || 500).json({
    error: "Internal server error",
    message: isDevelopment ? err.message : "An unexpected error occurred",
    ...(isDevelopment && { stack: err.stack }),
  });
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Process-level error handlers
process.on("uncaughtException", (err) => {
  const errorDetails = {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  };

  console.error("UNCAUGHT EXCEPTION:", errorDetails);

  // Send critical Telegram notification
  const telegramMessage = `<b>🔥 CRITICAL: Uncaught Exception</b>
<b>Error:</b> ${err.message}
<b>Stack:</b> ${err.stack?.substring(0, 500)}...`;
  sendTelegramNotification(telegramMessage);

  // Log the error but don't exit immediately to allow ongoing requests to complete
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on("unhandledRejection", (reason, promise) => {
  const errorDetails = {
    reason: reason,
  };

  console.error("UNHANDLED REJECTION:", errorDetails);

  // Send Telegram notification for unhandled rejections
  const telegramMessage = `<b>⚠️ Unhandled Promise Rejection</b>
<b>Reason:</b> ${reason?.toString() || "Unknown reason"}`;
  sendTelegramNotification(telegramMessage);

  console.error("UNHANDLED REJECTION:", {
    promise: promise,
    timestamp: new Date().toISOString(),
  });
  // Convert unhandled rejections to exceptions
  throw reason;
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("HTTP server closed");

    // Close database connections
    console.log("Server shut down gracefully");
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error("Forced shutdown after 30 seconds");
    process.exit(1);
  }, 30000);
};

// Listen for termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const server = setupHttpsServer(app, PORT);

// Temporary for OAuth Meta HTTPS Rights
server.listen(PORT, "0.0.0.0", () => {
  console.log(`App is listening on PORT:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Circuit breakers initialized for: ${Object.keys(circuitBreakers).join(", ")}`);
  
  const protocol = process.env.NODE_ENV === 'development' ? 'https' : 'http';
  console.log(`Server is now accepting connections on ${protocol}://localhost:${PORT}`);

  // Send startup notification (non-error) - wrapped in async to avoid blocking
  (async () => {
    try {
      const startupMessage = `<b>✅ Server Started Successfully</b>\n<b>Port:</b> ${PORT}\n<b>Environment:</b> ${process.env.NODE_ENV || "development"}\n<b>Time:</b> ${new Date().toLocaleString()}`;
      await sendTelegramNotification(startupMessage, false);
    } catch (err) {
      console.error("Startup notification failed:", err.message);
    }
  })();
});
