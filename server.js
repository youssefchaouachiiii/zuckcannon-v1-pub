// Imports
import fs from "fs";
import axios from "axios";
import express from "express";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import dotenv from "dotenv";
import passport from "passport";
import session from "express-session";
import cookieParser from "cookie-parser";
import SQLiteStoreFactory from "connect-sqlite3";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { CreativeDB, CreativeAccountDB, BatchDB } from "./backend/utils/database.js";
import { processCreative, updateCreativeThumbnail, getCreativeFilePath, getThumbnailFilePath } from "./backend/utils/creative-utils.js";
import { FacebookCacheDB } from "./backend/utils/facebook-cache-db.js";
import { UserDB } from "./backend/auth/auth-db.js";
import { configurePassport, ensureAuthenticated, ensureAuthenticatedAPI, ensureNotAuthenticated } from "./backend/auth/passport-config.js";
import { validateRequest, loginRateLimiter, apiRateLimiter } from "./backend/middleware/validation.js";
import { getPaths } from "./backend/utils/paths.js";
import MetaBatch from "./backend/utils/meta-batch.js";

// ffmpeg set up
const ffmpegPath = process.env.FFMPEG_PATH || ffmpegInstaller.path;
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
    // Production: Use FRONTEND_URL from environment
    let allowedOrigins;

    if (process.env.FRONTEND_URL) {
      const baseUrl = process.env.FRONTEND_URL;
      allowedOrigins = [baseUrl, baseUrl.replace("https://", "https://www."), baseUrl.replace("http://", "http://www.")];
    } else {
      console.warn("⚠️  FRONTEND_URL not set. Allowing all origins (not recommended for production)");
      allowedOrigins = ["*"];
    }

    // Allow requests with no origin (mobile apps, Postman, same-origin, server-to-server)
    if (!origin) {
      return callback(null, true);
    }

    // Allow all origins if * is specified
    if (allowedOrigins.includes("*")) {
      return callback(null, true);
    }

    // Check if origin is allowed (case-insensitive)
    const originLower = origin.toLowerCase();
    const isAllowed = allowedOrigins.some((allowed) => allowed.toLowerCase() === originLower);

    if (isAllowed) {
      callback(null, true);
    } else {
      // Debug-friendly error logging for production
      console.error(`🚫 CORS blocked: origin="${origin}"`);
      console.error(`   Allowed: [${allowedOrigins.join(", ")}]`);
      console.error(`   💡 Fix: Add "${origin}" to FRONTEND_URL or update your environment config`);

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
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // You may want to remove unsafe-eval in production
        scriptSrcAttr: ["'unsafe-inline'"], // Allow inline event handlers
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

// Configure cookie parser
app.use(cookieParser());

// Configure SQLite session store
const SQLiteStore = SQLiteStoreFactory(session);

// Configure session before passport
const sessionSecret = process.env.SESSION_SECRET || "dev-secret-change-in-production";
if (!process.env.SESSION_SECRET && isProduction) {
  console.warn("WARNING: SESSION_SECRET not set in production!");
}

const sessionConfig = {
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: "sessions.db",
    dir: "./data/db",
    table: "sessions",
  }),
  cookie: {
    secure: isProduction, // Only use secure cookies in production with HTTPS
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (increased from 24 hours)
    sameSite: "lax", // Use 'lax' for both dev and prod to allow OAuth redirects
  },
};

// In production, we need to trust the proxy for secure cookies
if (isProduction) {
  sessionConfig.proxy = true; // Trust the proxy
}

// console.log("Session config:", {
//   isProduction,
//   cookieSecure: sessionConfig.cookie.secure,
//   sameSite: sessionConfig.cookie.sameSite,
//   proxy: sessionConfig.proxy,
//   store: "SQLite (persistent)",
//   maxAge: "7 days",
// });

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
    // console.error("Failed to send Telegram notification:", error.message);
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

// Facebook OAuth routes
app.get(
  "/auth/facebook",
  passport.authenticate("facebook", {
    scope: ["ads_management", "ads_read", "pages_show_list", "pages_read_engagement", "email"],
  })
);

app.get("/auth/facebook/callback", passport.authenticate("facebook", { failureRedirect: "/login.html?error=facebook" }), (req, res) => {
  console.log("Facebook OAuth successful for user:", req.user.username);
  res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
        return res.status(500).json({ error: "Session cleanup failed" });
      }
      res.json({ success: true, message: "Logged out successfully" });
    });
  });
});

app.get("/api/auth/status", (req, res) => {
  const isDevelopment = process.env.NODE_ENV === "development";

  // console.log("Auth status check:", {
  //   authenticated: isDevelopment ? true : req.isAuthenticated(),
  //   sessionID: req.sessionID,
  //   user: req.user,
  //   session: req.session,
  //   isDevelopment: isDevelopment,
  //   cookies: req.cookies,
  //   headers: {
  //     cookie: req.headers.cookie,
  //     origin: req.headers.origin,
  //   },
  // });

  // Check if session exists but user is not authenticated
  if (!isDevelopment && req.session && !req.user) {
    console.log("Session exists but no user - session may have expired");
  }

  res.json({
    authenticated: isDevelopment ? true : req.isAuthenticated(),
    user: isDevelopment ? { id: "dev-user", username: "developer" } : req.user ? { id: req.user.id, username: req.user.username } : null,
    isDevelopment: isDevelopment,
    environment: process.env.NODE_ENV,
    sessionValid: !!(req.session && req.sessionID),
  });
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
app.post("/api/refresh-meta-cache", ensureAuthenticatedAPI, async (req, res) => {
  try {
    if (isRefreshing) {
      return res.json({
        status: "already_refreshing",
        message: "A refresh is already in progress",
      });
    }

    // Get user credentials from session
    const userId = req.user.id;
    const userAccessToken = req.user.facebook_access_token;

    // Validate user has access token
    if (!userAccessToken) {
      return res.status(401).json({
        status: "error",
        message: "No Facebook access token found. Please authenticate via Facebook OAuth.",
      });
    }

    // Start refresh
    broadcastMetaDataUpdate("refresh-started", { timestamp: new Date().toISOString() });

    const freshData = await fetchMetaDataFresh(userId, userAccessToken);

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

// Fetch ad account data with caching
app.get("/api/fetch-meta-data", ensureAuthenticatedAPI, async (req, res) => {
  const forceRefresh = req.query.refresh === "true";
  const userId = req.user.id;
  let userAccessToken = req.user.facebook_access_token;

  try {
    // Check if user has connected Facebook account
    if (!userAccessToken) {
      // In development, allow using the environment token as fallback
      if (process.env.NODE_ENV === "development" && process.env.META_ACCESS_TOKEN) {
        console.log("⚠️  Using META_ACCESS_TOKEN from .env (development mode)");
        userAccessToken = process.env.META_ACCESS_TOKEN;
      } else {
        return res.status(403).json({
          error: "Facebook account not connected",
          needsAuth: true,
          message: "Please connect your Facebook account to access ad data. Visit /auth/facebook to authenticate.",
          authUrl: "/auth/facebook",
        });
      }
    }

    // Check if we have cached data and it's still valid
    const hasValidCache = await FacebookCacheDB.isCacheValid(60, userId); // Cache valid for 60 minutes

    if (!forceRefresh && hasValidCache) {
      // Return cached data immediately
      const cachedData = await FacebookCacheDB.getAllCachedData(userId);

      // Send cached data with a flag indicating it's from cache
      res.json({
        ...cachedData,
        fromCache: true,
        cacheAge: await getCacheAge(userId),
      });

      // Trigger background refresh
      refreshMetaDataInBackground(userId, userAccessToken);
    } else {
      // No cache or force refresh - fetch fresh data
      const freshData = await fetchMetaDataFresh(userId, userAccessToken);
      res.json({
        ...freshData,
        fromCache: false,
      });
    }
  } catch (error) {
    console.error("Error in fetch-meta-data endpoint:", error);

    // If there's an error but we have cache, return cached data
    try {
      const cachedData = await FacebookCacheDB.getAllCachedData(userId);
      if (cachedData.adAccounts && cachedData.adAccounts.length > 0) {
        res.json({
          ...cachedData,
          fromCache: true,
          error: "Using cached data due to API error",
        });
        return;
      }
    } catch (cacheError) {
      console.error("Cache retrieval also failed:", cacheError);
    }

    // Critical: Both API and cache failed
    const telegramMessage = `<b>🔴 CRITICAL: Meta Data Fetch Failed</b>\n<b>User:</b> ${req.user.username}\n<b>Both API and cache retrieval failed</b>\n<b>Error:</b> ${error.message}`;
    sendTelegramNotification(telegramMessage);

    res.status(500).json({ error: "Failed to fetch Meta data" });
  }
});

// Helper function to get cache age
async function getCacheAge(userId) {
  const db = await import("./backend/utils/facebook-cache-db.js").then((m) => m.default);
  const result = await db.getAsync(
    `
    SELECT (julianday('now') - julianday(MIN(last_fetched))) * 24 * 60 as age_minutes
    FROM cached_ad_accounts
    WHERE user_id = ?
  `,
    [userId]
  );
  return result ? Math.round(result.age_minutes) : null;
}

// Background refresh function
let isRefreshing = false;
async function refreshMetaDataInBackground(userId, userAccessToken) {
  if (isRefreshing) return; // Prevent multiple simultaneous refreshes

  isRefreshing = true;
  try {
    // console.log("Starting background refresh of Meta data for user:", userId);
    broadcastMetaDataUpdate("refresh-started", {
      timestamp: new Date().toISOString(),
      source: "background",
    });

    const freshData = await fetchMetaDataFresh(userId, userAccessToken);
    // console.log("Background refresh completed successfully");

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
async function fetchMetaDataFresh(userId, userAccessToken) {
  async function fetchMetaData() {
    // Get user's ad accounts using /me/adaccounts endpoint
    let adAccAndPagesPromises = [fetchUserAdAccounts(userAccessToken), fetchUserPages(userAccessToken)];

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

        // If adAccounts failed to fetch, throw an error
        if (!adAccounts || adAccounts.length === 0) {
          throw new Error("Failed to fetch ad accounts from Meta. Please check your access token and permissions.");
        }
      } else {
        // console.log(`Successfully fetched ad account data for user ${userId}:`, adAccounts);
      }

      // Ensure adAccounts exists before using flatMap
      if (!adAccounts || adAccounts.length === 0) {
        console.warn("No ad accounts available to fetch campaigns and pixels.");
        return {
          adAccounts: [],
          pages: pages || [],
          campaigns: [],
          pixels: [],
        };
      }

      const dataPromises = adAccounts.flatMap((account) => {
        return Promise.all([fetchCampaigns(account.id, userAccessToken), fetchPixels(account.id, userAccessToken)]).then(([campaigns, pixels]) => ({
          campaigns,
          pixels,
        }));
      });

      const results = await Promise.all(dataPromises);

      const allCampaigns = results.flatMap((accountData) => accountData.campaigns);
      const allPixels = results.flatMap((accountData) => accountData.pixels);

      // Save to cache using single transaction
      await FacebookCacheDB.saveAllData(adAccounts, pages, allCampaigns, allPixels, userId);

      return {
        adAccounts,
        pages,
        campaigns: allCampaigns,
        pixels: allPixels,
      };
    } catch (err) {
      console.log("Error fetching data from Meta: ", err.message);
      throw err;
    }
  }

  return await fetchMetaData();
}

// Fetch ad accounts for user (OAuth token)
async function fetchUserAdAccounts(userAccessToken) {
  const adAccURL = `https://graph.facebook.com/${api_version}/me/adaccounts`;

  try {
    const adAccResponse = await axios.get(adAccURL, {
      headers: {
        Authorization: `Bearer ${userAccessToken}`,
      },
      params: {
        fields: "name,id,account_id",
      },
    });
    return { adAccounts: adAccResponse.data.data };
  } catch (err) {
    console.error("❌ Error fetching user ad accounts:", err.message);

    if (err.response) {
      console.error("📊 Response status:", err.response.status);
      console.error("📋 Response data:", JSON.stringify(err.response.data, null, 2));

      // Provide helpful error messages based on status code
      if (err.response.status === 400) {
        console.error("\n⚠️  Facebook API 400 Error - Possible causes:");
        console.error("   1. Access token doesn't have required permissions (ads_management, ads_read)");
        console.error("   2. Access token is invalid or expired");
        console.error("   3. User hasn't connected Facebook via OAuth");
        console.error("   4. Token is for a test/sandbox account without ad accounts");
        console.error("\n💡 Solution: Log in via Facebook OAuth at /auth/facebook");
      }
    }
    throw err;
  }
}

// Fetch user's pages (OAuth token)
async function fetchUserPages(userAccessToken) {
  try {
    return await circuitBreakers.facebook.call(async () => {
      const pagesUrl = `https://graph.facebook.com/${api_version}/me/accounts`;

      const response = await axios.get(pagesUrl, {
        params: {
          fields: "name,id",
          access_token: userAccessToken,
        },
      });
      return { pages: response.data.data };
    });
  } catch (err) {
    console.error(`There was an error fetching user pages:`, err);
    return { pages: [] };
  }
}

// Legacy functions for system user (kept for backward compatibility)
async function fetchAdAccounts() {
  const adAccURL = `https://graph.facebook.com/${api_version}/${system_user_id}/assigned_ad_accounts`;

  try {
    const adAccResponse = await axios.get(adAccURL, {
      params: {
        fields: "name,id,account_id",
        access_token,
      },
    });
    return { adAccounts: adAccResponse.data.data };
  } catch (err) {
    console.error("There was an error fetching assigned ad accounts.", err);
  }
}

async function fetchAssignedPages() {
  try {
    return await circuitBreakers.facebook.call(async () => {
      const pagesUrl = `https://graph.facebook.com/${api_version}/${system_user_id}/assigned_pages`;

      const response = await axios.get(pagesUrl, {
        params: {
          fields: "name,id",
          access_token,
        },
      });
      return { pages: response.data.data };
    });
  } catch (err) {
    console.error(`There was an error fetching assigned pages:`, err);
    return { pages: [] };
  }
}

async function fetchCampaigns(account_id, userAccessToken = null) {
  const campaignUrl = `https://graph.facebook.com/${api_version}/${account_id}/campaigns`;
  const token = userAccessToken || access_token;

  try {
    const campaignResponse = await axios.get(campaignUrl, {
      params: {
        fields: "account_id,id,name,objective,bid_strategy,special_ad_categories,status,insights{spend,clicks},adsets{id,name},daily_budget,lifetime_budget,created_time",
        access_token: token,
      },
    });
    return campaignResponse.data.data;
  } catch (err) {
    console.error(`Error fetching campaigns for account ${account_id}:`, err);
    return [];
  }
}

// Fetch pixels for ad account
// Helper function to check a single pixel's activity
async function isPixelActive(pixelId, token) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startTime = Math.floor(thirtyDaysAgo.getTime() / 1000);

  const statsUrl = `https://graph.facebook.com/${api_version}/${pixelId}/stats`;
  const params = {
    access_token: token,
    start_time: startTime,
    aggregation: "total",
  };

  try {
    const statsResponse = await axios.get(statsUrl, { params });
    const statsData = statsResponse.data?.data;

    if (statsData && statsData.length > 0) {
      const totalEventsData = statsData[0].data;
      if (totalEventsData && totalEventsData.length > 0) {
        const totalCount = totalEventsData.reduce((sum, event) => sum + (event.count || 0), 0);
        return totalCount > 0;
      }
    }
    return false; // No stats data found
  } catch (error) {
    // If stats endpoint fails (e.g., for a very old/broken pixel), treat as inactive.
    console.error(`Could not fetch stats for pixel ${pixelId}. Treating as inactive. Error: ${error.response?.data?.error?.message || error.message}`);
    return false;
  }
}

async function fetchPixels(account_id, userAccessToken = null) {
  const pixelUrl = `https://graph.facebook.com/${api_version}/${account_id}/`;
  const token = userAccessToken || access_token;

  // 1. Fetch the initial list of all pixels
  const initialPixelParams = {
    fields: "account_id,adspixels{name,id}", // Just get the list first
    access_token: token,
  };

  try {
    const initialResponse = await axios.get(pixelUrl, { params: initialPixelParams });
    const accountData = initialResponse.data;

    if (!accountData.adspixels || !accountData.adspixels.data) {
      return { id: account_id, adspixels: { data: [] } }; // No pixels for this account
    }

    const allPixels = accountData.adspixels.data;

    // 2. For each pixel, create a promise to check its activity
    const activityCheckPromises = allPixels.map((pixel) => isPixelActive(pixel.id, token));
    const activityResults = await Promise.all(activityCheckPromises);

    // 3. Filter the original list
    const activePixels = allPixels.filter((pixel, index) => activityResults[index]);

    // Log detailed filtering results
    const inactivePixels = allPixels.filter((pixel, index) => !activityResults[index]);
    console.log(`\n====== PIXEL FILTERING RESULTS ======`);
    console.log(`Account ${account_id}:`);
    console.log(`  Total pixels: ${allPixels.length}`);
    console.log(`  Active pixels: ${activePixels.length}`);
    console.log(`  Inactive pixels: ${inactivePixels.length}`);
    if (activePixels.length > 0) {
      console.log(`  Active pixel IDs: ${activePixels.map(p => `${p.name} (${p.id})`).join(', ')}`);
    }
    if (inactivePixels.length > 0) {
      console.log(`  Inactive pixel IDs: ${inactivePixels.map(p => `${p.name} (${p.id})`).join(', ')}`);
    }
    console.log(`====================================\n`);

    // 4. Return the data in the expected format
    accountData.adspixels.data = activePixels;
    return accountData;
  } catch (err) {
    console.error(`There was an error fetching initial pixels for account ${account_id}:`, err.response?.data || err.message);
    return { id: account_id, adspixels: { data: [] } }; // Return empty structure on error
  }
}

// Helper function to normalize ad account ID (remove 'act_' prefix if present)
function normalizeAdAccountId(adAccountId) {
  if (!adAccountId) return adAccountId;
  const original = adAccountId.toString();
  const normalized = original.replace(/^act_/, "");

  // Log if we made a change (for debugging double prefix issues)
  if (original !== normalized) {
    console.log(`Normalized account ID: ${original} -> ${normalized}`);
  }

  return normalized;
}

// Global helper function to upload image to Meta
async function uploadImageToMeta(filePath, adAccountId, userAccessToken = null) {
  const normalizedAccountId = normalizeAdAccountId(adAccountId);
  const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;
  const token = userAccessToken || access_token;

  try {
    const fd = new FormData();
    fd.append("source", fs.createReadStream(filePath));
    fd.append("access_token", token);

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
  const normalizedAccountId = normalizeAdAccountId(adAccountId);
  const fileStats = fs.statSync(file.path);
  const fileSize = fileStats.size;

  // Use resumable upload for files > 20MB
  if (fileSize > 20 * 1024 * 1024) {
    return await uploadLargeVideoToMeta(file, adAccountId);
  }

  // Regular upload for smaller files
  const upload_url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

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
  const normalizedAccountId = normalizeAdAccountId(adAccountId);
  const fileStats = fs.statSync(file.path);
  const fileSize = fileStats.size;

  const initUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

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
  const userAccessToken = req.user?.facebook_access_token;

  if (!fileIds || !Array.isArray(fileIds)) {
    return res.status(400).json({ error: "File IDs array is required" });
  }

  if (!account_id) {
    return res.status(400).json({ error: "Account ID is required" });
  }

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
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

              imageHash = await uploadThumbnailImage(thumbnail, account_id, userAccessToken);

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

              imageHash = await uploadImageToMeta(uploadPath, account_id, userAccessToken);

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
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Use resumable upload for files > 20MB
    if (fileSize > 20 * 1024 * 1024) {
      return await uploadLargeVideoToMeta(file, adAccountId, sessionId, fileIndex);
    }

    // Regular upload for smaller files
    const upload_url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

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
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Step 1: Initialize upload session
    const initUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

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
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;

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
  async function uploadThumbnailImage(thumbnailPath, adAccountId, token = userAccessToken) {
    return uploadImageToMeta(thumbnailPath, adAccountId, token);
  }
});

// Create new ad campaign
app.post("/api/create-campaign", ensureAuthenticatedAPI, validateRequest.createCampaign, async (req, res) => {
  try {
    const {
      account_id,
      name,
      objective,
      status,
      // Budget options - MOVED TO AD SET LEVEL
      // daily_budget,
      // lifetime_budget,
      // spend_cap,
      // Special categories
      special_ad_categories,
      special_ad_category,
      special_ad_category_country,
      // Bid strategy - MOVED TO AD SET LEVEL
      // bid_strategy,
      // Advanced options
      adlabels,
      adset_bid_amounts,
      adset_budgets,
      budget_rebalance_flag,
      campaign_optimization_type,
      execution_options,
      is_adset_budget_sharing_enabled,
      is_skadnetwork_attribution,
      is_using_l3_schedule,
      iterative_split_test_configs,
      // Promoted object
      promoted_object,
      // Smart promotion
      smart_promotion_type,
      // Timing - MOVED TO AD SET LEVEL
      // start_time,
      // stop_time,
    } = req.body;

    const userAccessToken = req.user.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Validate required fields
    if (!account_id || !name || !objective) {
      return res.status(400).json({
        error: "Missing required fields: account_id, name, and objective are required",
      });
    }

    // Ensure account_id has 'act_' prefix (Facebook requires it for API calls)
    const formattedAccountId = account_id.startsWith("act_") ? account_id : `act_${account_id}`;

    // Create campaign via Facebook Graph API using FormData (as per Meta's documentation)
    const campaignUrl = `https://graph.facebook.com/${api_version}/${formattedAccountId}/campaigns`;

    // Use URLSearchParams for proper serialization (matches Meta's official SDK)
    const formData = new URLSearchParams();

    // Required fields
    formData.append("name", name);
    formData.append("objective", objective);
    formData.append("status", status || "PAUSED");
    formData.append("access_token", userAccessToken);

    // Budget fields - MOVED TO AD SET LEVEL
    // const hasCampaignBudget = !!(daily_budget || lifetime_budget);
    const hasCampaignBudget = false; // Always false now since budgets moved to ad set level

    // if (daily_budget) {
    //   const budgetInCents = Math.round(parseFloat(daily_budget) * 100);
    //   formData.append("daily_budget", budgetInCents.toString());
    // }

    // if (lifetime_budget) {
    //   const budgetInCents = Math.round(parseFloat(lifetime_budget) * 100);
    //   formData.append("lifetime_budget", budgetInCents.toString());
    // }

    // if (spend_cap) {
    //   const capInCents = Math.round(parseFloat(spend_cap) * 100);
    //   formData.append("spend_cap", capInCents.toString());
    // }

    // Special ad categories (Meta requires JSON array)
    if (special_ad_categories) {
      formData.append("special_ad_categories", JSON.stringify(special_ad_categories));
    } else if (special_ad_category) {
      // Handle singular form
      formData.append("special_ad_category", special_ad_category);
    } else {
      // Default to empty array per official SDK
      formData.append("special_ad_categories", JSON.stringify([]));
    }

    // Special ad category country
    if (special_ad_category_country && special_ad_category_country.length > 0) {
      formData.append("special_ad_category_country", JSON.stringify(special_ad_category_country));
    }

    // Bid strategy - MOVED TO AD SET LEVEL
    // if (bid_strategy) {
    //   formData.append("bid_strategy", bid_strategy);
    // }

    // Advanced campaign options
    if (adlabels) {
      formData.append("adlabels", JSON.stringify(adlabels));
    }

    if (adset_bid_amounts) {
      formData.append("adset_bid_amounts", JSON.stringify(adset_bid_amounts));
    }

    if (adset_budgets) {
      formData.append("adset_budgets", JSON.stringify(adset_budgets));
    }

    if (budget_rebalance_flag !== undefined) {
      formData.append("budget_rebalance_flag", budget_rebalance_flag.toString());
    }

    if (campaign_optimization_type) {
      formData.append("campaign_optimization_type", campaign_optimization_type);
    }

    if (execution_options && execution_options.length > 0) {
      formData.append("execution_options", JSON.stringify(execution_options));
    }

    // Meta API requirement: is_adset_budget_sharing_enabled MUST be set when NOT using campaign budget
    // If not using campaign-level budget, default to false unless explicitly provided
    if (!hasCampaignBudget) {
      const budgetSharingValue = is_adset_budget_sharing_enabled !== undefined ? is_adset_budget_sharing_enabled : false;
      formData.append("is_adset_budget_sharing_enabled", budgetSharingValue.toString());
    } else if (is_adset_budget_sharing_enabled !== undefined) {
      // Only set if explicitly provided when using campaign budget
      formData.append("is_adset_budget_sharing_enabled", is_adset_budget_sharing_enabled.toString());
    }

    if (is_skadnetwork_attribution !== undefined) {
      formData.append("is_skadnetwork_attribution", is_skadnetwork_attribution.toString());
    }

    if (is_using_l3_schedule !== undefined) {
      formData.append("is_using_l3_schedule", is_using_l3_schedule.toString());
    }

    if (iterative_split_test_configs) {
      formData.append("iterative_split_test_configs", JSON.stringify(iterative_split_test_configs));
    }

    // Promoted object
    if (promoted_object) {
      formData.append("promoted_object", JSON.stringify(promoted_object));
    }

    // Smart promotion type
    if (smart_promotion_type) {
      formData.append("smart_promotion_type", smart_promotion_type);
    }

    // Timing - MOVED TO AD SET LEVEL
    // if (start_time) {
    //   formData.append("start_time", start_time);
    // }

    // if (stop_time) {
    //   formData.append("stop_time", stop_time);
    // }

    console.log("Creating campaign:", {
      url: campaignUrl,
      name,
      objective,
      status: status || "PAUSED",
      account: formattedAccountId,
      hasCampaignBudget,
      budgetSharing: !hasCampaignBudget ? (is_adset_budget_sharing_enabled !== undefined ? is_adset_budget_sharing_enabled : false) : "N/A",
      hasAdvancedOptions: !!(adlabels || adset_bid_amounts || adset_budgets || campaign_optimization_type || promoted_object),
    });

    const response = await axios.post(campaignUrl, formData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    // Fetch the newly created campaign with full details
    const newCampaignId = response.data.id;
    const campaignDetailsUrl = `https://graph.facebook.com/${api_version}/${newCampaignId}`;
    const detailsResponse = await axios.get(campaignDetailsUrl, {
      params: {
        fields: "id,account_id,name,objective,status,daily_budget,lifetime_budget,spend_cap,bid_strategy,created_time,special_ad_categories,budget_rebalance_flag,smart_promotion_type,start_time,stop_time",
        access_token: userAccessToken,
      },
    });

    const newCampaign = detailsResponse.data;

    // Save to cache
    try {
      await FacebookCacheDB.saveCampaigns([newCampaign]);
    } catch (cacheError) {
      console.error("Error saving campaign to cache:", cacheError);
      // Continue even if cache fails
    }

    // Trigger background refresh
    // triggerMetaCacheRefresh();

    res.json({
      success: true,
      campaign_id: newCampaignId,
      campaign: newCampaign,
      message: `Campaign "${name}" created successfully`,
    });
  } catch (error) {
    console.error("Error creating campaign:", error.response?.data || error.message);

    // Send Telegram notification for critical errors
    if (error.response?.status >= 500) {
      const telegramMessage = `<b>Campaign Creation Failed</b>\n<b>User:</b> ${req.user?.username || "Unknown"}\n<b>Account:</b> ${req.body.account_id}\n<b>Error:</b> ${error.response?.data?.error?.message || error.message}`;
      sendTelegramNotification(telegramMessage);
    }

    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error?.message || error.message,
      details: error.response?.data || null,
    });
  }
});

app.post("/api/create-ad-set", ensureAuthenticatedAPI, validateRequest.createAdSet, (req, res) => {
  const userAccessToken = req.user.facebook_access_token;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  const payload = {
    name: req.body.name,
    optimization_goal: req.body.optimization_goal,
    billing_event: req.body.billing_event,
    bid_strategy: req.body.bid_strategy || "LOWEST_COST_WITHOUT_CAP", // Default to LOWEST_COST_WITHOUT_CAP
    campaign_id: req.body.campaign_id,
    status: req.body.status,
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
    access_token: userAccessToken,
  };

  // Add destination_type only if provided
  if (req.body.destination_type) {
    payload.destination_type = req.body.destination_type;
  }

  // Add budget - either daily_budget or lifetime_budget (moved from campaign level)
  if (req.body.daily_budget) {
    const budgetInCents = Math.round(parseFloat(req.body.daily_budget) * 100);
    payload.daily_budget = budgetInCents;
  } else if (req.body.lifetime_budget) {
    const budgetInCents = Math.round(parseFloat(req.body.lifetime_budget) * 100);
    payload.lifetime_budget = budgetInCents;
  }

  // Add schedule times (moved from campaign level)
  if (req.body.start_time) {
    payload.start_time = req.body.start_time;
  } else {
    // Default to now if not provided
    payload.start_time = new Date().toISOString();
  }

  if (req.body.end_time) {
    payload.end_time = req.body.end_time;
  }

  // Handle promoted_object based on optimization goal and campaign objective
  // Reference: https://developers.facebook.com/docs/marketing-api/reference/ad-promoted-object
  const optimizationGoal = req.body.optimization_goal;

  // Build promoted_object based on optimization goal requirements
  if (optimizationGoal === "OFFSITE_CONVERSIONS") {
    // CONVERSIONS objective - requires pixel_id and custom_event_type
    if (!req.body.pixel_id || req.body.pixel_id.trim() === "") {
      return res.status(400).json({
        error: "Pixel ID is required for OFFSITE_CONVERSIONS optimization goal.",
        missing_fields: { pixel_id: true },
      });
    }

    if (!req.body.event_type) {
      return res.status(400).json({
        error: "Event type is required for OFFSITE_CONVERSIONS optimization goal.",
        missing_fields: { event_type: true },
      });
    }

    // Validate that pixel_id doesn't start with "act_"
    if (req.body.pixel_id.startsWith("act_")) {
      return res.status(400).json({
        error: "Invalid pixel ID. Please select a valid Meta Pixel from the dropdown.",
        details: "The pixel ID appears to be an account ID.",
      });
    }

    payload.promoted_object = {
      pixel_id: req.body.pixel_id,
      custom_event_type: req.body.event_type,
    };
  } else if (optimizationGoal === "LEAD_GENERATION") {
    // LEAD_GENERATION - requires page_id
    if (!req.body.page_id) {
      return res.status(400).json({
        error: "Page ID is required for LEAD_GENERATION optimization goal.",
        missing_fields: { page_id: true },
      });
    }

    payload.promoted_object = {
      page_id: req.body.page_id,
    };
  } else if (optimizationGoal === "APP_INSTALLS") {
    // APP_INSTALLS - requires application_id and object_store_url
    if (!req.body.application_id || !req.body.object_store_url) {
      return res.status(400).json({
        error: "Application ID and Object Store URL are required for APP_INSTALLS optimization goal.",
        missing_fields: {
          application_id: !req.body.application_id,
          object_store_url: !req.body.object_store_url,
        },
      });
    }

    payload.promoted_object = {
      application_id: req.body.application_id,
      object_store_url: req.body.object_store_url,
    };

    // Add custom_event_type if provided (for mobile app events)
    if (req.body.event_type) {
      payload.promoted_object.custom_event_type = req.body.event_type;
    }
  } else if (optimizationGoal === "LINK_CLICKS" && req.body.application_id && req.body.object_store_url) {
    // LINK_CLICKS for mobile app or Canvas app engagement
    payload.promoted_object = {
      application_id: req.body.application_id,
      object_store_url: req.body.object_store_url,
    };
  } else if (optimizationGoal === "PAGE_LIKES" || optimizationGoal === "OFFER_CLAIMS") {
    // PAGE_LIKES or OFFER_CLAIMS - requires page_id
    if (req.body.page_id) {
      payload.promoted_object = {
        page_id: req.body.page_id,
      };
    }
  } else if (optimizationGoal === "PRODUCT_CATALOG_SALES") {
    // PRODUCT_CATALOG_SALES - requires product_set_id
    if (!req.body.product_set_id) {
      return res.status(400).json({
        error: "Product Set ID is required for PRODUCT_CATALOG_SALES optimization goal.",
        missing_fields: { product_set_id: true },
      });
    }

    payload.promoted_object = {
      product_set_id: req.body.product_set_id,
    };

    // Add custom_event_type if provided
    if (req.body.event_type) {
      payload.promoted_object.custom_event_type = req.body.event_type;
    }
  } else if (optimizationGoal === "LINK_CLICKS" && req.body.pixel_id && req.body.pixel_id.trim() !== "" && req.body.event_type) {
    // For other goals that optionally support conversion tracking
    if (!req.body.pixel_id.startsWith("act_")) {
      payload.promoted_object = {
        pixel_id: req.body.pixel_id,
        custom_event_type: req.body.event_type,
      };
    }
  }

  if (req.body.bid_amount) {
    payload.bid_amount = parseInt(req.body.bid_amount);
  }

  // Add adset_schedule if provided
  if (req.body.adset_schedule && Array.isArray(req.body.adset_schedule)) {
    payload.adset_schedule = req.body.adset_schedule;
    payload.pacing_type = ["day_parting"]; // Only set pacing for scheduled ads
  }

  const normalizedAccountId = normalizeAdAccountId(req.body.account_id);
  const graphUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adsets`;

  async function createAdSet() {
    try {
      console.log("Creating ad set with payload:", JSON.stringify(payload, null, 2));

      const response = await axios.post(graphUrl, payload, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      // return the adset info for the creative upload section
      console.log(`Successfully created ad set ${req.body.name} in act_${req.body.account_id}`);
      res.status(200).json(response.data);
    } catch (err) {
      console.log("There was an error creating your ad set.");
      console.log("Facebook API Error:", JSON.stringify(err.response?.data, null, 2));
      console.log("Request payload was:", JSON.stringify(payload, null, 2));

      // Critical ad creation failure
      const fbError = err.response?.data?.error;
      const errorMessage = fbError?.error_user_msg || fbError?.message || err.message;
      const errorDetails = fbError?.error_user_title || fbError?.type || "";

      const telegramMessage = `<b>⚠️ CRITICAL: Ad Set Creation Failed</b>\n<b>Account:</b> ${req.body.account_id}\n<b>Error:</b> ${errorMessage}`;
      sendTelegramNotification(telegramMessage);

      res.status(400).json({
        error: errorMessage,
        details: errorDetails,
        fbtrace_id: fbError?.fbtrace_id,
      });
    }
  }

  createAdSet();
});

app.post("/api/duplicate-ad-set", async (req, res) => {
  const { ad_set_id, deep_copy, status_option, name, campaign_id, account_id } = req.body;
  const userAccessToken = req.user?.facebook_access_token;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  const normalizedAccountId = normalizeAdAccountId(account_id);
  let adSetData = null;
  let adsData = [];
  let totalAdsCount = 0;
  let totalChildObjects = 0;

  // If deep_copy is true, fetch ad set structure to count ads
  if (deep_copy) {
    try {
      // Fetch ad set details with ads
      const adSetDetailsUrl = `https://graph.facebook.com/${api_version}/${ad_set_id}`;
      const adSetResponse = await axios.get(adSetDetailsUrl, {
        params: {
          fields: "name,ads{id,name}",
          access_token: userAccessToken,
        },
      });

      adSetData = adSetResponse.data;
      adsData = adSetData.ads?.data || [];
      totalAdsCount = adsData.length;

      // Total child objects = ads only (ad set itself is not counted as child)
      totalChildObjects = totalAdsCount;

      console.log(`Ad Set ${ad_set_id} structure:`, {
        name: adSetData.name,
        ads: totalAdsCount,
        totalChildObjects: totalChildObjects,
      });
    } catch (err) {
      console.error("Failed to fetch ad set structure:", err.response?.data || err.message);
      return res.status(500).json({
        error: "Failed to fetch ad set structure",
        details: err.response?.data || err.message,
      });
    }
  }

  // Determine if async batch is needed. For /copies endpoint, >2 ads require batch request
  // Facebook limit: total objects (ad set + ads) must be < 3
  const needsAsync = deep_copy && totalChildObjects > 2;

  console.log(`Duplicating ad set ${ad_set_id}:`, {
    deepCopy: deep_copy,
    totalAdsCount,
    totalChildObjects,
    needsAsync,
    mode: needsAsync ? "asynchronous (manual batch)" : "synchronous (/copies endpoint)",
  });

  try {
    if (needsAsync) {
      // ASYNC/BATCH REQUEST FOR AD SET - Manual approach:
      // 1. Create new ad set shell with /copies but deep_copy=false
      // 2. Duplicate ads into new ad set using async batch
      // 3. Return batch request ID for status tracking

      console.log(`Using MANUAL ASYNC duplication for ad set ${ad_set_id} with ${totalChildObjects} ads`);

      // STEP 1: CREATE NEW AD SET SHELL (shallow copy)
      const shallowPayload = {
        deep_copy: false,
        status_option: status_option || "PAUSED",
        access_token: userAccessToken,
      };

      const graphUrl = `https://graph.facebook.com/${api_version}/${ad_set_id}/copies`;
      const shallowResponse = await axios.post(graphUrl, shallowPayload, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      const newAdSetId = shallowResponse.data.copied_adset_id || shallowResponse.data.id;
      console.log(`✅ Created new ad set shell: ${newAdSetId}`);

      // Update the name if provided
      if (name && newAdSetId) {
        try {
          const updateUrl = `https://graph.facebook.com/${api_version}/${newAdSetId}`;
          await axios.post(updateUrl, {
            name: name,
            access_token: userAccessToken,
          });
          console.log(`Updated ad set name to: ${name}`);
        } catch (updateErr) {
          console.log("Warning: Could not update ad set name:", updateErr.response?.data || updateErr.message);
        }
      }

      // STEP 2: BUILD BATCH OPERATIONS FOR ADS
      const batchOperations = [];

      adsData.forEach((ad, index) => {
        batchOperations.push({
          method: "POST", // ✅ Required by Facebook Batch API
          relative_url: `${ad.id}/copies`,
          body: `adset_id=${newAdSetId}&status_option=${status_option || "PAUSED"}`,
        });
      });

      console.log(`Created ${batchOperations.length} ad duplication operations`);

      // STEP 3: CHUNK AND SEND ASYNC BATCH REQUESTS FOR ADS
      const chunkSize = 1; // Max 1 copy operation per batch for maximum safety
      const batchChunks = [];
      for (let i = 0; i < batchOperations.length; i += chunkSize) {
        batchChunks.push(batchOperations.slice(i, i + chunkSize));
      }

      console.log(`Split ad operations into ${batchChunks.length} chunks of size ${chunkSize}`);

      const batchPromises = batchChunks.map(async (chunk, index) => {
        // Retry function for failed batch requests
        const sendBatchWithRetry = async (retryCount = 0) => {
          const FormData = (await import("form-data")).default;
          const formData = new FormData();

          formData.append("access_token", userAccessToken);
          formData.append("name", `Duplicate Ad Set ${ad_set_id} - Ads (Part ${index + 1}/${batchChunks.length})`);
          formData.append("batch", JSON.stringify(chunk));
          formData.append("is_parallel", "true");

          const retryLabel = retryCount > 0 ? ` (Retry ${retryCount})` : "";
          // console.log(`[AD-BATCH ${index + 1}/${batchChunks.length}]${retryLabel} Sending async batch request for ads`);
          // console.log(`[AD-BATCH ${index + 1}] Payload:`, {
          //   chunk_operations: chunk.length,
          //   batch_content: JSON.stringify(chunk, null, 2)
          // });

          try {
            const batchResponse = await axios.post(`https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_batch_requests`, formData, {
              headers: {
                ...formData.getHeaders(),
              },
              timeout: 30000, // 30 second timeout
            });

            // DETAILED RESPONSE LOGGING
            // console.log(`[AD-BATCH ${index + 1}] Facebook API Response:`, {
            //   status: batchResponse.status,
            //   statusText: batchResponse.statusText,
            //   data_type: typeof batchResponse.data,
            //   data_keys: typeof batchResponse.data === 'object' ? Object.keys(batchResponse.data) : 'N/A',
            //   raw_data: JSON.stringify(batchResponse.data, null, 2),
            // });

            // Extract batch request ID from potentially varied response formats
            let batchRequestId = batchResponse.data.id;
            if (typeof batchResponse.data === "string") {
              batchRequestId = batchResponse.data;
              // console.log(`[AD-BATCH ${index + 1}] ID extracted from string response`);
            } else if (batchResponse.data?.id) {
              batchRequestId = batchResponse.data.id;
              // console.log(`[AD-BATCH ${index + 1}] ID extracted from data.id`);
            } else if (batchResponse.data?.async_batch_request_id) {
              batchRequestId = batchResponse.data.async_batch_request_id;
              // console.log(`[AD-BATCH ${index + 1}] ID extracted from data.async_batch_request_id`);
            } else if (batchResponse.data?.handle) {
              batchRequestId = batchResponse.data.handle;
              // console.log(`[AD-BATCH ${index + 1}] ID extracted from data.handle`);
            } else if (batchResponse.data?.batch_id) {
              batchRequestId = batchResponse.data.batch_id;
              // console.log(`[AD-BATCH ${index + 1}] ID extracted from data.batch_id`);
            } else if (Array.isArray(batchResponse.data) && batchResponse.data[0]?.id) {
              batchRequestId = batchResponse.data[0].id;
              // console.log(`[AD-BATCH ${index + 1}] ID extracted from array[0].id`);
            }

            if (!batchRequestId) {
              // console.error(`[AD-BATCH ${index + 1}] ❌ No batch request ID found in response`);
              // console.error(`[AD-BATCH ${index + 1}] Full response:`, JSON.stringify(batchResponse.data, null, 2));
              // console.error(`[AD-BATCH ${index + 1}] Response analysis:`, {
              //   hasError: !!batchResponse.data?.error,
              //   error: batchResponse.data?.error,
              //   allKeys: Object.keys(batchResponse.data || {}),
              // });
              // ✅ Retry logic if no ID returned
              // if (retryCount < 2) {
              //   console.warn(`[AD-BATCH ${index + 1}] Retrying after 1 second... (Attempt ${retryCount + 1}/2)`);
              //   await new Promise(resolve => setTimeout(resolve, 1000));
              //   return sendBatchWithRetry(retryCount + 1);
              // }
              // throw new Error(`Async batch request for chunk ${index + 1} created but no ID returned after ${retryCount + 1} attempts`);
            }

            // console.log(`[AD-BATCH ${index + 1}] ✅ Success - Batch ID: ${batchRequestId}`);
            return batchRequestId;
          } catch (axiosError) {
            console.error(`[AD-BATCH ${index + 1}] ❌ Request failed:`, {
              message: axiosError.message,
              response_status: axiosError.response?.status,
              response_data: axiosError.response?.data,
            });

            // ✅ Retry on network errors
            // if (retryCount < 2 && (!axiosError.response || axiosError.response.status >= 500)) {
            //   console.warn(`[AD-BATCH ${index + 1}] Network/server error, retrying... (Attempt ${retryCount + 1}/2)`);
            //   await new Promise(resolve => setTimeout(resolve, 1000));
            //   return sendBatchWithRetry(retryCount + 1);
            // }

            // throw axiosError;
          }
        };

        // Start the batch request with retry capability
        return sendBatchWithRetry();
      });

      const batchRequestIds = await Promise.all(batchPromises);
      console.log("✅ All async batch requests created with IDs:", batchRequestIds);

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

      // STEP 4: RETURN SUCCESS WITH TRACKING INFO
      return res.json({
        success: true,
        mode: "async_manual_chunked",
        id: newAdSetId,
        original_id: ad_set_id,
        batchRequestIds: batchRequestIds,
        structure: {
          ads: totalAdsCount,
          totalChildObjects: totalChildObjects,
        },
        message: `Ad set shell created. Duplicating ${totalAdsCount} ads in ${batchChunks.length} batches.`,
        statusCheckEndpoint: `/api/batch-request-status/`,
        note: "Ads are being duplicated in chunks. This may take 1-5 minutes.",
      });
    } else {
      // Use sync API for ≤2 ads
      const payload = {
        deep_copy: deep_copy || false,
        status_option: status_option || "PAUSED",
        access_token: userAccessToken,
      };

      const graphUrl = `https://graph.facebook.com/${api_version}/${ad_set_id}/copies`;

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
              access_token: userAccessToken,
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
          mode: "sync",
        });
      } else {
        console.log("Unexpected response from Facebook API:", response.data);
        res.status(400).json({ error: "Failed to duplicate ad set" });
      }
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
  const userAccessToken = req.user?.facebook_access_token;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  const normalizedAccountId = normalizeAdAccountId(account_id);
  let campaignData = null;
  let adsetsData = [];
  let adsData = [];
  let adsetCount = 0;
  let totalAdsCount = 0;
  let totalChildObjects = 0;

  // STEP 1 Fetch campaign structure (adsets + ads)
  if (deep_copy) {
    try {
      const campaignDetailsUrl = `https://graph.facebook.com/${api_version}/${campaign_id}`;
      const campaignResponse = await axios.get(campaignDetailsUrl, {
        params: {
          fields: "name,adsets{id,name,ads{id,name,adset_id}}",
          access_token: userAccessToken,
        },
      });

      campaignData = campaignResponse.data;
      adsetsData = campaignData.adsets?.data || [];
      adsetCount = adsetsData.length;

      adsetsData.forEach((adset) => {
        const ads = adset.ads?.data || [];
        totalAdsCount += ads.length;
        adsData.push(...ads.map((ad) => ({ ...ad, adset_id: adset.id })));
      });

      totalChildObjects = adsetCount + totalAdsCount;
      // console.log(`Campaign ${campaign_id} structure:`, {
      //   name: campaignData.name,
      //   adsets: adsetCount,
      //   ads: totalAdsCount,
      //   totalChildObjects,
      // });
    } catch (err) {
      console.error("Failed to fetch campaign structure:", err.response?.data || err.message);
      return res.status(500).json({
        error: "Failed to fetch campaign structure",
        details: err.response?.data || err.message,
      });
    }
  }

  const needsAsync = deep_copy && totalChildObjects > 3;
  // console.log(`Duplicating campaign ${campaign_id}:`, {
  //   deepCopy: deep_copy,
  //   adsetCount,
  //   totalAdsCount,
  //   totalChildObjects,
  //   needsAsync,
  // });

  try {
    // STEP 2 Create campaign shell
    const shallowPayload = {
      deep_copy: false,
      status_option: status_option || "PAUSED",
      access_token: userAccessToken,
    };

    const campaignCopyUrl = `https://graph.facebook.com/${api_version}/${campaign_id}/copies`;
    const shallowResponse = await axios.post(campaignCopyUrl, shallowPayload, {
      headers: { "Content-Type": "application/json" },
    });

    const newCampaignId = shallowResponse.data.copied_campaign_id || shallowResponse.data.id;
    // console.log(`✅ Created new campaign shell: ${newCampaignId}`);

    if (name && newCampaignId) {
      await axios.post(`https://graph.facebook.com/${api_version}/${newCampaignId}`, {
        name,
        access_token: userAccessToken,
      });
      // console.log(`Updated campaign name to: ${name}`);
    }

    if (!needsAsync) {
      return res.json({
        success: true,
        mode: "sync",
        id: newCampaignId,
        message: "Campaign duplicated synchronously (no children detected)",
      });
    }

    const FormData = (await import("form-data")).default;

    // Send async batch
    const sendAsyncBatch = async (ops, label) => {
      const formData = new FormData();
      formData.append("access_token", userAccessToken);
      formData.append("name", label);
      formData.append("batch", JSON.stringify(ops));
      formData.append("is_parallel", "true");

      const resp = await axios.post(
        `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_batch_requests`,
        formData,
        { headers: formData.getHeaders(), timeout: 30000 }
      );

      const data = resp.data;
      return (
        data?.id ||
        data?.async_batch_request_id ||
        data?.handle ||
        (Array.isArray(data) && data[0]?.id) ||
        (typeof data === "string" ? data : null)
      );
    };

    // STEP 3 First async batch: duplicate adsets
    const adsetOps = adsetsData.map((adset) => ({
      method: "POST",
      relative_url: `${adset.id}/copies`,
      body: `campaign_id=${newCampaignId}&deep_copy=false&status_option=${status_option || "PAUSED"}`,
    }));

    const adsetChunks = [];
    for (let i = 0; i < adsetOps.length; i += 1) adsetChunks.push(adsetOps.slice(i, i + 1));

    const adsetBatchIds = [];
    const adsetMapping = {};

    for (let i = 0; i < adsetChunks.length; i++) {
      const label = `Duplicate Campaign ${campaign_id} - AdSets (Part ${i + 1})`;
      const ops = adsetChunks[i];
      const formData = new FormData();
      formData.append("access_token", userAccessToken);
      formData.append("batch", JSON.stringify(ops));
      formData.append("is_parallel", "true");
      const resp = await axios.post(
        `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_batch_requests`,
        formData,
        { headers: formData.getHeaders(), timeout: 30000 }
      );
      const data = resp.data;

      // If Meta executed synchronously
      if (Array.isArray(data) && data[0]?.body?.includes("copied_adset_id")) {
        try {
          const parsed = JSON.parse(data[0].body);
          const copied = parsed.ad_object_ids?.[0];
          if (copied) adsetMapping[copied.source_id] = copied.copied_id;
        } catch (_) {}
      }

      adsetBatchIds.push(
        data?.id ||
          data?.async_batch_request_id ||
          data?.handle ||
          (Array.isArray(data) && data[0]?.id) ||
          null
      );
    }

    // console.log("✅ All adset async batches created:", adsetBatchIds);
    // console.log("🗺️ Adset mapping:", adsetMapping);

    // STEP 4 Second async batch: duplicate ads into new adsets
    const adOps = [];
    adsData.forEach((ad) => {
      const newAdsetId = adsetMapping[ad.adset_id];
      if (!newAdsetId) return;
      adOps.push({
        method: "POST",
        relative_url: `${ad.id}/copies`,
        body: `adset_id=${newAdsetId}&status_option=${status_option || "PAUSED"}`,
      });
    });

    const adChunks = [];
    for (let i = 0; i < adOps.length; i += 50) adChunks.push(adOps.slice(i, i + 50));

    const adBatchIds = [];
    for (let i = 0; i < adChunks.length; i++) {
      const label = `Duplicate Campaign ${campaign_id} - Ads (Batch ${i + 1})`;
      const id = await sendAsyncBatch(adChunks[i], label);
      adBatchIds.push(id);
    }

    // console.log("✅ All ad async batch requests created:", adBatchIds);

    // STEP 5 Return combined result
    return res.json({
      success: true,
      mode: "async_double_batch",
      newCampaignId,
      originalCampaignId: campaign_id,
      batchRequestIds: {
        adsets: adsetBatchIds,
        ads: adBatchIds,
      },
      structure: {
        adsets: adsetCount,
        ads: totalAdsCount,
        totalChildObjects,
      },
      message:
        "Campaign duplicated with two-phase async batch (adsets first, ads second). Check Meta Ads Manager after 1–5 minutes.",
    });
  } catch (err) {
    console.error("❌ Error duplicating campaign:", err.response?.data || err.message);
    res.status(400).json({
      error: "Error duplicating campaign",
      details: err.response?.data?.error || err.message,
    });
  }
});

app.get("/api/batch-requests/:account_id", ensureAuthenticatedAPI, async (req, res) => {
  const { account_id } = req.params;
  const userAccessToken = req.user?.facebook_access_token;
  const isCompleted = req.query.is_completed; // Optional filter

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  try {
    const normalizedAccountId = normalizeAdAccountId(account_id);
    const listUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_requests`;

    const params = {
      fields: "id,name,is_completed,total_count,success_count,error_count,in_progress_count,initial_count",
      access_token: userAccessToken,
    };

    if (isCompleted !== undefined) {
      params.is_completed = isCompleted;
    }

    const response = await axios.get(listUrl, { params });

    res.json({
      account_id: `act_${normalizedAccountId}`,
      batch_requests: response.data.data || [],
      paging: response.data.paging,
    });
  } catch (err) {
    console.error("Error listing batch requests:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to list batch requests",
      details: err.response?.data?.error || err.message,
    });
  }
});

// Check status of async batch request
app.get("/api/batch-request-status/:batch_id", ensureAuthenticatedAPI, async (req, res) => {
  const { batch_id } = req.params;
  const userAccessToken = req.user?.facebook_access_token;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  try {
    const statusUrl = `https://graph.facebook.com/${api_version}/${batch_id}`;
    const response = await axios.get(statusUrl, {
      params: {
        fields: "id,name,is_completed,total_count,success_count,error_count,in_progress_count",
        access_token: userAccessToken,
      },
    });

    const batchStatus = response.data;

    // If completed, fetch the individual request results
    if (batchStatus.is_completed) {
      try {
        const requestsUrl = `https://graph.facebook.com/${api_version}/${batch_id}/requests`;
        const requestsResponse = await axios.get(requestsUrl, {
          params: {
            fields: "id,status,result",
            access_token: userAccessToken,
          },
        });

        const requests = requestsResponse.data.data || [];
        const successfulRequest = requests.find((r) => r.status === "SUCCESS");

        if (successfulRequest && successfulRequest.result) {
          const newCampaignId = successfulRequest.result.copied_campaign_id || successfulRequest.result.id;

          return res.json({
            status: "completed",
            batch_id,
            is_completed: true,
            success_count: batchStatus.success_count,
            error_count: batchStatus.error_count,
            new_campaign_id: newCampaignId,
            details: batchStatus,
          });
        }
      } catch (reqErr) {
        console.error("Error fetching batch requests:", reqErr.message);
      }
    }

    res.json({
      status: batchStatus.is_completed ? "completed" : "in_progress",
      batch_id,
      is_completed: batchStatus.is_completed,
      total_count: batchStatus.total_count,
      success_count: batchStatus.success_count,
      error_count: batchStatus.error_count,
      in_progress_count: batchStatus.in_progress_count,
      details: batchStatus,
    });
  } catch (err) {
    console.error("Error checking batch request status:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to check batch request status",
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

app.post("/api/upload-videos", upload.array("file", 50), validateRequest.uploadFiles, (req, res) => {
  try {
    const files = req.files;
    const adAccountId = req.body.account_id;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

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
          return handleVideoUpload(file, index, userAccessToken)
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

    async function handleVideoUpload(file, index, userAccessToken) {
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
          uploadVideo = await uploadVideosToMeta(file, adAccountId, sessionId, index, userAccessToken);

          // 3. Upload thumbnail to meta
          broadcastToSession(sessionId, "file-progress", {
            fileIndex: index,
            fileName: file.originalname,
            stage: "Uploading thumbnail",
            progress: 90,
          });
          getImageHash = await uploadThumbnailImage(thumbnail, adAccountId, userAccessToken);

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
  async function uploadVideosToMeta(file, adAccountId, sessionId, fileIndex, userAccessToken) {
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Use resumable upload for files > 20MB
    if (fileSize > 20 * 1024 * 1024) {
      return await uploadLargeVideoToMetaWithProgress(file, adAccountId, sessionId, fileIndex, userAccessToken);
    }

    // Regular upload for smaller files
    const upload_url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(file.path));
      fd.append("name", file.originalname);
      fd.append("access_token", userAccessToken);

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
  async function uploadLargeVideoToMetaWithProgress(file, adAccountId, sessionId, fileIndex, userAccessToken) {
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Step 1: Initialize upload session
    const initUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

    try {
      // Initialize the upload session
      const initResponse = await axios.post(initUrl, {
        upload_phase: "start",
        file_size: fileSize,
        access_token: userAccessToken,
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
        fd.append("access_token", userAccessToken);

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
        access_token: userAccessToken,
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
  async function uploadThumbnailImage(thumbnailPath, adAccountId, userAccessToken) {
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;

    try {
      const fd = new FormData();
      fd.append("source", fs.createReadStream(thumbnailPath));
      fd.append("access_token", userAccessToken);

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
  const userAccessToken = req.user?.facebook_access_token;
  const normalizedAccountId = normalizeAdAccountId(accountId);
  const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

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
      fd.append("access_token", userAccessToken);

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
    const userAccessToken = req.user?.facebook_access_token;

    // Log the link safely
    console.log("Received ad creative request with link length:", link ? link.length : 0);

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

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
              message,
              title: headline,
              video_id: asset.value.data.uploadVideo,
              image_hash: asset.value.data.getImageHash, // Thumbnail for video
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
          object_story_spec: {
            page_id,
            link_data: {
              message,
              link,
              name: headline, // Headline text - shown as the main title
              image_hash: asset.value.imageHash,
              description,
              call_to_action: {
                type,
                value: {
                  link,
                },
              },
            },
          },
        };
      }

      const normalizedAccountId = normalizeAdAccountId(account_id);
      const creative_url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adcreatives`;

      return axios
        .post(creative_url, {
          ...creativeData,
          access_token: userAccessToken,
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
          let errorTitle = "";

          if (fbError) {
            // Use Facebook's user-friendly message if available (prioritizes user-facing messages)
            errorMessage = fbError.error_user_msg || fbError.message;
            errorTitle = fbError.error_user_title || "";

            // Add more context for common errors
            if (fbError.error_subcode === 1487860) {
              // Ad set is paused/inactive
              errorMessage = `${errorMessage} (Ad Set Status: ${errorTitle})`;
            } else if (fbError.error_subcode === 1885183) {
              // App is in development mode - needs to be public to create ads
              errorMessage = errorTitle ? `${errorTitle}: ${errorMessage}` : errorMessage;
            } else if (errorTitle) {
              // Include title for any other errors that have one
              errorMessage = `${errorTitle} - ${errorMessage}`;
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
        access_token: userAccessToken,
      };
      const normalizedAccountId = normalizeAdAccountId(account_id);
      const url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/ads`;

      try {
        const response = await axios.post(url, payload);
        const data = await response;
        console.log("Ad created!", data);
        return data;
      } catch (err) {
        console.log("There was an error creating ad.", err.response?.data);
        // Extract a clear error message from the Facebook API response
        const fbError = err.response?.data?.error;
        let errorMessage = "Failed to create ad.";
        if (fbError) {
          errorMessage = fbError.error_user_msg || fbError.message || "Unknown Facebook API error.";
        } else if (err.message) {
          errorMessage = err.message;
        }
        // Throw a new, clean Error object so the reason is not empty
        throw new Error(errorMessage);
      }
    }
  } catch (error) {
    console.error("Error in create-ad-creative endpoint:", error);
    res.status(500).json({ error: "Failed to process ad creative request" });
  }
});

// ============================================
// BATCH API ENDPOINTS
// ============================================

/**
 * Batch create ads and creatives
 * This endpoint creates multiple ads with their creatives in a single batch request
 *
 * Request body:
 * {
 *   "account_id": "123456789",
 *   "adset_id": "120123456789",
 *   "page_id": "987654321",
 *   "ads": [
 *     {
 *       "name": "Ad 1",
 *       "creativeName": "Creative 1",
 *       "message": "Ad message",
 *       "headline": "Ad headline",
 *       "description": "Ad description",
 *       "link": "https://example.com",
 *       "call_to_action_type": "LEARN_MORE",
 *       "imageHash": "abc123...",
 *       "status": "PAUSED"
 *     }
 *   ]
 * }
 */
app.post("/api/batch/create-ads", ensureAuthenticatedAPI, validateRequest.batchCreateAds, async (req, res) => {
  try {
    const { account_id, adset_id, page_id, ads } = req.body;
    const userAccessToken = req.user?.facebook_access_token;

    // Validation
    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    if (!account_id || !adset_id || !page_id) {
      return res.status(400).json({
        error: "account_id, adset_id, and page_id are required",
      });
    }

    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      return res.status(400).json({
        error: "ads array is required and must not be empty",
      });
    }

    if (ads.length > 100) {
      return res.status(400).json({
        error: "Maximum 100 ads can be created per batch request",
      });
    }

    console.log(`Processing batch ad creation: ${ads.length} ads for account ${account_id}`);

    // Prepare batch data
    const batchData = ads.map((ad) => {
      // Build object_story_spec based on creative type
      let object_story_spec;

      if (ad.video_id) {
        // Video ad
        object_story_spec = {
          page_id,
          video_data: {
            message: ad.message || "",
            title: ad.headline || "",
            video_id: ad.video_id,
            link_description: ad.description || "",
            call_to_action: {
              type: ad.call_to_action_type || "LEARN_MORE",
              value: {
                link: ad.link || "",
              },
            },
          },
        };

        // Add thumbnail if provided
        if (ad.thumbnailHash) {
          object_story_spec.video_data.image_hash = ad.thumbnailHash;
        }
      } else if (ad.imageHash) {
        // Image ad
        object_story_spec = {
          page_id,
          link_data: {
            message: ad.message || "",
            link: ad.link || "",
            name: ad.headline || "",
            image_hash: ad.imageHash,
            description: ad.description || "",
            call_to_action: {
              type: ad.call_to_action_type || "LEARN_MORE",
              value: {
                link: ad.link || "",
              },
            },
          },
        };
      } else {
        throw new Error(`Ad "${ad.name}" must have either imageHash or video_id`);
      }

      return {
        adName: ad.name,
        creativeName: ad.creativeName || ad.name,
        adset_id,
        status: ad.status || "PAUSED",
        object_story_spec,
      };
    });

    // Execute batch request
    const results = await MetaBatch.batchCreateCreativesAndAds(account_id, batchData, userAccessToken);

    // Process results
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    console.log(`Batch ad creation completed: ${successCount} succeeded, ${failureCount} failed`);

    // Separate creative and ad results
    const creativeResults = results.filter((_, index) => index % 2 === 0);
    const adResults = results.filter((_, index) => index % 2 === 1);

    res.json({
      success: failureCount === 0,
      message: `Created ${successCount / 2} ads out of ${ads.length} requested`,
      stats: {
        total: ads.length,
        succeeded: successCount / 2,
        failed: failureCount / 2,
      },
      creatives: creativeResults.map((r, i) => ({
        name: ads[i]?.creativeName || ads[i]?.name,
        success: r.success,
        creative_id: r.data?.id,
        error: r.error,
      })),
      ads: adResults.map((r, i) => ({
        name: ads[i]?.name,
        success: r.success,
        ad_id: r.data?.id,
        error: r.error,
      })),
      rawResults: results,
    });
  } catch (error) {
    console.error("Error in batch ad creation:", error);
    res.status(500).json({
      error: "Failed to process batch ad creation",
      details: error.message,
    });
  }
});

/**
 * Batch create ads (creatives already exist)
 * Use this when you already have creative IDs and just want to create multiple ads
 *
 * Request body:
 * {
 *   "account_id": "123456789",
 *   "ads": [
 *     {
 *       "name": "Ad 1",
 *       "adset_id": "120123456789",
 *       "creative_id": "120123456789",
 *       "status": "PAUSED"
 *     }
 *   ]
 * }
 */
app.post("/api/batch/create-ads-only", ensureAuthenticatedAPI, validateRequest.batchCreateAdsOnly, async (req, res) => {
  try {
    const { account_id, ads } = req.body;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    if (!account_id) {
      return res.status(400).json({ error: "account_id is required" });
    }

    if (!ads || !Array.isArray(ads) || ads.length === 0) {
      return res.status(400).json({
        error: "ads array is required and must not be empty",
      });
    }

    console.log(`Processing batch ad creation (ads only): ${ads.length} ads`);

    const results = await MetaBatch.batchCreateAds(account_id, ads, userAccessToken);

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: successCount === ads.length,
      message: `Created ${successCount} ads out of ${ads.length} requested`,
      stats: {
        total: ads.length,
        succeeded: successCount,
        failed: ads.length - successCount,
      },
      results: results.map((r, i) => ({
        name: ads[i]?.name,
        success: r.success,
        ad_id: r.data?.id,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error("Error in batch ads-only creation:", error);
    res.status(500).json({
      error: "Failed to process batch ads-only creation",
      details: error.message,
    });
  }
});

/**
 * Batch update campaign/adset/ad status
 * Update status for multiple entities in a single request
 *
 * Request body:
 * {
 *   "entity_ids": ["123456789", "987654321"],
 *   "status": "ACTIVE" | "PAUSED"
 * }
 */
app.post("/api/batch/update-status", ensureAuthenticatedAPI, validateRequest.batchUpdateStatus, async (req, res) => {
  try {
    const { entity_ids, status } = req.body;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    if (!entity_ids || !Array.isArray(entity_ids) || entity_ids.length === 0) {
      return res.status(400).json({ error: "entity_ids array is required" });
    }

    if (!status || !["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"].includes(status)) {
      return res.status(400).json({
        error: "Valid status is required (ACTIVE, PAUSED, DELETED, ARCHIVED)",
      });
    }

    console.log(`Batch updating ${entity_ids.length} entities to status: ${status}`);

    const results = await MetaBatch.batchUpdateCampaignStatus(entity_ids, status, userAccessToken);

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: successCount === entity_ids.length,
      message: `Updated ${successCount} entities out of ${entity_ids.length} requested`,
      stats: {
        total: entity_ids.length,
        succeeded: successCount,
        failed: entity_ids.length - successCount,
      },
      results: results.map((r, i) => ({
        entity_id: entity_ids[i],
        success: r.success,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error("Error in batch status update:", error);
    res.status(500).json({
      error: "Failed to process batch status update",
      details: error.message,
    });
  }
});

/**
 * Batch fetch account data
 * Fetch data from multiple ad accounts in a single request
 *
 * Request body:
 * {
 *   "account_ids": ["123456789", "987654321"],
 *   "fields": "name,account_status,amount_spent,balance"
 * }
 */
app.post("/api/batch/fetch-accounts", ensureAuthenticatedAPI, validateRequest.batchFetchAccounts, async (req, res) => {
  try {
    const { account_ids, fields } = req.body;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    if (!account_ids || !Array.isArray(account_ids) || account_ids.length === 0) {
      return res.status(400).json({ error: "account_ids array is required" });
    }

    const fieldsParam = fields || "name,account_status,currency";

    console.log(`Batch fetching ${account_ids.length} accounts with fields: ${fieldsParam}`);

    const results = await MetaBatch.batchFetchAccountData(account_ids, fieldsParam, userAccessToken);

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: successCount === account_ids.length,
      message: `Fetched ${successCount} accounts out of ${account_ids.length} requested`,
      stats: {
        total: account_ids.length,
        succeeded: successCount,
        failed: account_ids.length - successCount,
      },
      accounts: results.map((r, i) => ({
        account_id: account_ids[i],
        success: r.success,
        data: r.data,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error("Error in batch account fetch:", error);
    res.status(500).json({
      error: "Failed to fetch accounts",
      details: error.message,
    });
  }
});

/**
 * Generic batch request endpoint
 * For advanced users who want to send custom batch operations
 *
 * Request body:
 * {
 *   "operations": [
 *     {
 *       "method": "GET",
 *       "relative_url": "act_123/campaigns?fields=name,status"
 *     },
 *     {
 *       "method": "POST",
 *       "relative_url": "act_123/ads",
 *       "body": "name=Test&adset_id=456&status=PAUSED"
 *     }
 *   ]
 * }
 */
app.post("/api/batch/custom", ensureAuthenticatedAPI, validateRequest.customBatchRequest, async (req, res) => {
  try {
    const { operations } = req.body;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ error: "operations array is required" });
    }

    if (operations.length > 50) {
      return res.status(400).json({
        error: "Maximum 50 operations per batch request",
      });
    }

    console.log(`Processing custom batch request with ${operations.length} operations`);

    const results = await MetaBatch.executeBatchRequest(operations, userAccessToken);

    const successCount = results.filter((r) => r.success).length;

    res.json({
      success: successCount === operations.length,
      message: `Executed ${successCount} operations out of ${operations.length} requested`,
      stats: {
        total: operations.length,
        succeeded: successCount,
        failed: operations.length - successCount,
      },
      results,
    });
  } catch (error) {
    console.error("Error in custom batch request:", error);
    res.status(500).json({
      error: "Failed to execute custom batch request",
      details: error.message,
    });
  }
});

// ============================================
// END BATCH API ENDPOINTS
// ============================================

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
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    // Use resumable upload for files > 20MB
    if (fileSize > 20 * 1024 * 1024) {
      return await uploadLargeVideoToMeta(file, adAccountId);
    }

    // Regular upload for smaller files
    const upload_url = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

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
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const fileStats = fs.statSync(file.path);
    const fileSize = fileStats.size;

    const initUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/advideos`;

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
    const normalizedAccountId = normalizeAdAccountId(adAccountId);
    const imageUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adimages`;

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
  // Determine the status code (default to 500 if not set)
  const statusCode = err.status || err.statusCode || 500;

  const errorDetails = {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  };

  console.error("Unhandled error:", errorDetails);

  res.status(statusCode).json({
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
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

  // Log the error but don't exit immediately to allow ongoing requests to complete
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("UNHANDLED REJECTION:", {
    reason: reason,
    timestamp: new Date().toISOString(),
  });
  // Convert unhandled rejections to uncaught exceptions for consistent handling
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

const server = app.listen(PORT, "0.0.0.0", () => {
  // console.log(`App is listening on PORT:${PORT}`);
  // console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  // console.log(`Circuit breakers initialized for: ${Object.keys(circuitBreakers).join(", ")}`);

  // Send startup notification (non-error)
  const startupMessage = `<b>✅ Server Started Successfully</b>\n<b>Port:</b> ${PORT}\n<b>Environment:</b> ${process.env.NODE_ENV || "development"}\n<b>Time:</b> ${new Date().toLocaleString()}`;
  sendTelegramNotification(startupMessage, false);
});
