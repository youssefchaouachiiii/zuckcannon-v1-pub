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
import { RulesDB } from "./backend/utils/rules-db.js";

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
async function fetchPixels(account_id, userAccessToken = null) {
  const pixelUrl = `https://graph.facebook.com/${api_version}/${account_id}/`;
  const token = userAccessToken || access_token;

  const params = {
    // Request additional fields for sorting: is_unavailable and last_fired_time
    fields: "account_id,adspixels{name,id,is_unavailable,last_fired_time}",
    access_token: token,
  };

  try {
    const pixelResponse = await axios.get(pixelUrl, { params });

    if (pixelResponse.status === 200 && pixelResponse.data) {
      const accountData = pixelResponse.data;

      if (accountData.adspixels && accountData.adspixels.data) {
        const allPixels = accountData.adspixels.data;

        // Sort pixels: Active first (by last_fired_time desc), then inactive
        accountData.adspixels.data = allPixels.sort((a, b) => {
          const aUnavailable = a.is_unavailable === true;
          const bUnavailable = b.is_unavailable === true;

          // 1. Unavailable pixels go to bottom
          if (aUnavailable && !bUnavailable) return 1;
          if (!aUnavailable && bUnavailable) return -1;

          // 2. Both available or both unavailable: sort by last_fired_time
          // Handle both ISO string and timestamp formats
          const aTime = a.last_fired_time ? new Date(a.last_fired_time).getTime() : 0;
          const bTime = b.last_fired_time ? new Date(b.last_fired_time).getTime() : 0;

          // Newer (higher timestamp) comes first
          return bTime - aTime;
        });
      }

      return accountData;
    } else {
      console.log(`Fetch pixels failed for account ${account_id} with status ${pixelResponse.status}`);
      return { id: account_id, adspixels: { data: [] } };
    }
  } catch (err) {
    console.error(`Error fetching pixels for account ${account_id}:`, err.response?.data || err.message);
    return { id: account_id, adspixels: { data: [] } };
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

app.post("/api/create-ad-set", ensureAuthenticatedAPI, validateRequest.createAdSet, async (req, res) => {
  const userAccessToken = req.user.facebook_access_token;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  // Fetch campaign details to get special_ad_category_country
  let campaignCountries = null;
  try {
    const campaignDetailsUrl = `https://graph.facebook.com/${api_version}/${req.body.campaign_id}`;
    const campaignResponse = await axios.get(campaignDetailsUrl, {
      params: {
        fields: "special_ad_category_country",
        access_token: userAccessToken,
      },
    });

    if (campaignResponse.data.special_ad_category_country && campaignResponse.data.special_ad_category_country.length > 0) {
      campaignCountries = campaignResponse.data.special_ad_category_country;
      console.log(`Campaign ${req.body.campaign_id} has special ad category countries:`, campaignCountries);
    }
  } catch (err) {
    console.warn("Could not fetch campaign details for special_ad_category_country:", err.message);
    // Continue with ad set creation even if campaign fetch fails
  }

  const payload = {
    name: req.body.name,
    optimization_goal: req.body.optimization_goal,
    billing_event: req.body.billing_event,
    bid_strategy: req.body.bid_strategy || "LOWEST_COST_WITHOUT_CAP", // Default to LOWEST_COST_WITHOUT_CAP
    campaign_id: req.body.campaign_id,
    status: req.body.status,
    targeting: {
      geo_locations:
        req.body.geo_locations ||
        (campaignCountries
          ? {
              countries: campaignCountries,
            }
          : {
              countries: ["US"],
            }),
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

  // Add page_id if provided (for objectives that require a page)
  if (req.body.page_id) {
    payload.promoted_object = payload.promoted_object || {};
    payload.promoted_object.page_id = req.body.page_id;
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

  console.log("=== PROMOTED OBJECT DEBUG ===");
  console.log("Optimization Goal:", optimizationGoal);
  console.log("page_id from request:", req.body.page_id);
  console.log("pixel_id from request:", req.body.pixel_id);
  console.log("Current promoted_object:", payload.promoted_object);

  // Build promoted_object based on optimization goal requirements
  if (optimizationGoal === "OFFSITE_CONVERSIONS") {
    // CONVERSIONS objective - pixel_id and event_type are optional, user decides if needed
    if (req.body.pixel_id && req.body.pixel_id.trim() !== "" && req.body.event_type) {
      // Validate that pixel_id doesn't start with "act_"
      if (req.body.pixel_id.startsWith("act_")) {
        console.log("⚠️ WARNING: Invalid pixel ID - appears to be an account ID.");
      } else {
        // Merge with existing promoted_object if it exists
        payload.promoted_object = payload.promoted_object || {};
        payload.promoted_object.pixel_id = req.body.pixel_id;
        payload.promoted_object.custom_event_type = req.body.event_type;
      }
    }
  } else if (optimizationGoal === "LEAD_GENERATION") {
    // LEAD_GENERATION - requires page_id, optionally pixel_id
    // custom_event_type should be a separate field, not in promoted_object
    if (!req.body.page_id) {
      console.log("⚠️ WARNING: Page ID is recommended for LEAD_GENERATION optimization goal.");
    } else {
      // Merge with existing promoted_object if it exists
      payload.promoted_object = payload.promoted_object || {};
      payload.promoted_object.page_id = req.body.page_id;
    }

    // Add pixel_id if provided (for lead conversion tracking)
    if (req.body.pixel_id && req.body.pixel_id.trim() !== "" && !req.body.pixel_id.startsWith("act_")) {
      payload.promoted_object = payload.promoted_object || {};
      payload.promoted_object.pixel_id = req.body.pixel_id;
    }

    // custom_event_type is a separate field for LEAD_GENERATION, not inside promoted_object
    if (req.body.event_type && req.body.event_type.trim() !== "") {
      payload.custom_event_type = req.body.event_type;
    }
  } else if (optimizationGoal === "APP_INSTALLS") {
    // APP_INSTALLS - requires application_id and object_store_url
    if (!req.body.application_id || !req.body.object_store_url) {
      // return res.status(400).json({
      //   error: "Application ID and Object Store URL are required for APP_INSTALLS optimization goal.",
      //   missing_fields: {
      //     application_id: !req.body.application_id,
      //     object_store_url: !req.body.object_store_url,
      //   },
      // });
      console.log("Application ID and Object Store URL are required for APP_INSTALLS optimization goal.");
    }

    // Merge with existing promoted_object if it exists
    payload.promoted_object = payload.promoted_object || {};
    payload.promoted_object.application_id = req.body.application_id;
    payload.promoted_object.object_store_url = req.body.object_store_url;

    // Add custom_event_type if provided (for mobile app events)
    if (req.body.event_type) {
      payload.promoted_object.custom_event_type = req.body.event_type;
    }
  } else if (optimizationGoal === "LINK_CLICKS" && req.body.application_id && req.body.object_store_url) {
    // LINK_CLICKS for mobile app or Canvas app engagement
    payload.promoted_object = payload.promoted_object || {};
    payload.promoted_object.application_id = req.body.application_id;
    payload.promoted_object.object_store_url = req.body.object_store_url;
  } else if (optimizationGoal === "PAGE_LIKES" || optimizationGoal === "OFFER_CLAIMS") {
    // PAGE_LIKES or OFFER_CLAIMS - page_id is recommended
    if (!req.body.page_id) {
      console.log(`⚠️ WARNING: Page ID is recommended for ${optimizationGoal} optimization goal.`);
    } else {
      // Merge with existing promoted_object if it exists
      payload.promoted_object = payload.promoted_object || {};
      payload.promoted_object.page_id = req.body.page_id;
    }
  } else if (optimizationGoal === "PRODUCT_CATALOG_SALES") {
    // PRODUCT_CATALOG_SALES - requires product_set_id
    if (!req.body.product_set_id) {
      console.log("⚠️ WARNING: Product Set ID is recommended for PRODUCT_CATALOG_SALES optimization goal.");
    } else {
      // Merge with existing promoted_object if it exists
      payload.promoted_object = payload.promoted_object || {};
      payload.promoted_object.product_set_id = req.body.product_set_id;
    }

    // Add custom_event_type if provided
    if (req.body.event_type) {
      payload.promoted_object.custom_event_type = req.body.event_type;
    }
  } else if (optimizationGoal === "LINK_CLICKS" && req.body.pixel_id && req.body.pixel_id.trim() !== "" && req.body.event_type) {
    // For other goals that optionally support conversion tracking
    if (!req.body.pixel_id.startsWith("act_")) {
      // Merge with existing promoted_object if it exists
      payload.promoted_object = payload.promoted_object || {};
      payload.promoted_object.pixel_id = req.body.pixel_id;
      payload.promoted_object.custom_event_type = req.body.event_type;
    }
  }

  // Validate and add bid_amount based on bid strategy
  const bidStrategy = req.body.bid_strategy || "LOWEST_COST_WITHOUT_CAP";
  const bidAmountRequired = ["LOWEST_COST_WITH_BID_CAP", "TARGET_COST"].includes(bidStrategy);

  if (bidAmountRequired) {
    if (!req.body.bid_amount || req.body.bid_amount <= 0) {
      // return res.status(400).json({
      //   error: `Bid amount required: you must provide a bid cap or target cost in bid_amount field. For ${bidStrategy}, you must provide the bid_amount field.`,
      //   details: "Bid amount required for bid strategy provided",
      //   missing_fields: { bid_amount: true },
      // });
      console.log("Bid amount required: you must provide a bid cap or target cost in bid_amount field. For ${bidStrategy}, you must provide the bid_amount field.");
    }
    payload.bid_amount = parseInt(req.body.bid_amount);
  } else if (req.body.bid_amount) {
    // Optional bid_amount for other strategies
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

      // Convert payload to URLSearchParams for proper Meta API format
      const formData = new URLSearchParams();

      for (const [key, value] of Object.entries(payload)) {
        if (key === "targeting" || key === "promoted_object") {
          // These fields must be JSON stringified
          formData.append(key, JSON.stringify(value));
        } else if (Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else if (typeof value === "object" && value !== null) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value);
        }
      }

      console.log("Sending to Meta API:", formData.toString());

      const response = await axios.post(graphUrl, formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
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

// Create ad set across multiple campaigns
app.post("/api/create-ad-set-multiple", ensureAuthenticatedAPI, validateRequest.multiCampaignCreateAdSet, async (req, res) => {
  const userAccessToken = req.user.facebook_access_token;
  const { account_id, campaign_ids, ...adSetBody } = req.body;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  const [firstCampaignId, ...remainingCampaignIds] = campaign_ids;
  const normalizedAccountId = account_id.replace(/^act_/, "");
  const adSetUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adsets`;

  const created_adsets = [];
  const failed_adsets = [];
  let baseAdSetId = null;

  try {
    // 1. Create the base ad set in the first campaign
    const adSetPayload = {
      ...adSetBody,
      campaign_id: firstCampaignId,
      access_token: userAccessToken,
    };

    // Convert budget to cents if provided
    if (adSetPayload.daily_budget) {
      adSetPayload.daily_budget = Math.round(parseFloat(adSetPayload.daily_budget) * 100);
    }
    if (adSetPayload.lifetime_budget) {
      adSetPayload.lifetime_budget = Math.round(parseFloat(adSetPayload.lifetime_budget) * 100);
    }

    // The API expects targeting to be a JSON string
    if (adSetPayload.targeting && typeof adSetPayload.targeting === "object") {
      adSetPayload.targeting = JSON.stringify(adSetPayload.targeting);
    }

    // The API expects promoted_object to be a JSON string
    if (adSetPayload.promoted_object && typeof adSetPayload.promoted_object === "object") {
      adSetPayload.promoted_object = JSON.stringify(adSetPayload.promoted_object);
    }

    // Handle ad scheduling - must set pacing_type if adset_schedule is provided
    if (adSetPayload.adset_schedule && Array.isArray(adSetPayload.adset_schedule)) {
      adSetPayload.adset_schedule = JSON.stringify(adSetPayload.adset_schedule);
      adSetPayload.pacing_type = JSON.stringify(["day_parting"]);
    }

    const createResponse = await axios.post(adSetUrl, new URLSearchParams(adSetPayload));
    baseAdSetId = createResponse.data.id;
    created_adsets.push({
      campaign_id: firstCampaignId,
      adset_id: baseAdSetId,
      status: "success",
    });

    // 2. If there are other campaigns, duplicate the ad set
    if (remainingCampaignIds.length > 0) {
      const copyOperations = remainingCampaignIds.map((campaignId) => {
        const body = {
          campaign_id: campaignId,
          status: adSetBody.status || "PAUSED", // Default to paused for copies
        };
        // Use the base ad set ID for the copy operation
        return MetaBatch.createBatchOperation("POST", `${baseAdSetId}/copies`, body);
      });

      const batchResults = await MetaBatch.executeChunkedBatchRequest(copyOperations, userAccessToken);

      batchResults.forEach((result, index) => {
        const campaignId = remainingCampaignIds[index];
        if (result.success && result.data.id) {
          created_adsets.push({
            campaign_id: campaignId,
            adset_id: result.data.id,
            status: "success",
          });
        } else {
          failed_adsets.push({
            campaign_id: campaignId,
            status: "failed",
            error: result.error || { message: "Batch operation failed without specific error" },
          });
        }
      });
    }

    // 3. Fetch and cache the new ad sets in the background (don't block response)
    const allNewAdSetIds = created_adsets.map((adset) => adset.adset_id);
    if (allNewAdSetIds.length > 0) {
      fetchAndCacheAdSets(allNewAdSetIds, userAccessToken).catch((err) => {
        console.error("Failed to cache new ad sets in background:", err.message);
      });
    }

    res.json({
      success: true,
      base_adset_id: baseAdSetId,
      created_adsets: created_adsets,
      failed_adsets: failed_adsets,
      total_created: created_adsets.length,
      total_failed: failed_adsets.length,
    });
  } catch (error) {
    console.error("Error creating multi-campaign ad sets:", error.response?.data || error.message);

    // If the base ad set creation failed, report it and stop
    if (!baseAdSetId) {
      return res.status(error.response?.status || 500).json({
        error: "Failed to create the base ad set.",
        details: error.response?.data?.error || { message: error.message },
      });
    }

    // If base creation succeeded but subsequent steps failed, return partial success
    res.status(207).json({
      // 207 Multi-Status is appropriate here
      success: false,
      message: "Partial failure during ad set duplication. The base ad set was created, but some copies failed.",
      base_adset_id: baseAdSetId,
      created_adsets: created_adsets,
      failed_adsets: failed_adsets,
      error: error.message,
    });
  }
});

// Create Campaign in Multiple Ad Accounts
app.post("/api/create-campaign-multiple", ensureAuthenticatedAPI, validateRequest.multiAccountCreateCampaign, async (req, res) => {
  const userAccessToken = req.user.facebook_access_token;
  const { ad_account_ids, campaign_name, objective, status, special_ad_categories, budget_type, budget_amount } = req.body;

  if (!userAccessToken) {
    return res.status(403).json({
      error: "Facebook account not connected",
      needsAuth: true,
    });
  }

  if (!ad_account_ids || ad_account_ids.length === 0) {
    return res.status(400).json({
      error: "At least one ad account ID is required",
    });
  }

  const results = [];

  try {
    // Create campaign in each ad account using batch API
    const batchOperations = ad_account_ids.map((accountId) => {
      const normalizedAccountId = accountId.replace(/^act_/, "");

      // Build campaign payload
      const campaignPayload = {
        name: campaign_name,
        objective: objective,
        status: status || "PAUSED",
        access_token: userAccessToken,
        // Always include special_ad_categories, defaulting to an empty array.
        // The value must be a JSON string as per Meta API requirements.
        special_ad_categories: JSON.stringify(special_ad_categories || []),
        // Since we are not using a campaign-level budget, this field is required.
        // Defaulting to 'false' is the safest option.
        is_adset_budget_sharing_enabled: false,
      };

      // Budget (daily_budget, lifetime_budget) is set at the Ad Set level,
      // not at the Campaign level in this application's architecture.
      // It is intentionally omitted here to maintain consistency.

      return MetaBatch.createBatchOperation("POST", `act_${normalizedAccountId}/campaigns`, campaignPayload);
    });

    // Execute batch request
    const batchResults = await MetaBatch.executeChunkedBatchRequest(batchOperations, userAccessToken);

    // Process results
    batchResults.forEach((result, index) => {
      const accountId = ad_account_ids[index];

      if (result.success && result.data.id) {
        results.push({
          success: true,
          ad_account_id: accountId,
          campaign_id: result.data.id,
        });
      } else {
        results.push({
          success: false,
          ad_account_id: accountId,
          error: result.error || { message: "Batch operation failed without specific error" },
        });
      }
    });

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    // If all succeeded
    if (failCount === 0) {
      return res.json({
        success: true,
        message: `Campaign created successfully in ${successCount} account(s)`,
        results: results,
        total_created: successCount,
        total_failed: failCount,
      });
    }

    // If some succeeded, some failed
    if (successCount > 0) {
      return res.status(207).json({
        // 207 Multi-Status
        success: true,
        message: `Campaign created in ${successCount} account(s), failed in ${failCount} account(s)`,
        results: results,
        total_created: successCount,
        total_failed: failCount,
      });
    }

    // If all failed
    return res.status(500).json({
      success: false,
      error: "Failed to create campaign in all accounts",
      results: results,
      total_created: successCount,
      total_failed: failCount,
    });
  } catch (error) {
    console.error("Error creating multi-account campaigns:", error.response?.data || error.message);

    return res.status(error.response?.status || 500).json({
      error: "Failed to create campaigns",
      details: error.response?.data?.error || { message: error.message },
      results: results,
    });
  }
});

// Helper to fetch and cache new ad sets
async function fetchAndCacheAdSets(adSetIds, accessToken) {
  if (!adSetIds || adSetIds.length === 0) return;

  const operations = adSetIds.map((id) => MetaBatch.createBatchOperation("GET", `${id}?fields=id,name,campaign_id,status,optimization_goal,billing_event,daily_budget,lifetime_budget,created_time`));

  const results = await MetaBatch.executeChunkedBatchRequest(operations, accessToken);

  const adSetsToCache = results.filter((res) => res.success && res.data).map((res) => res.data);

  if (adSetsToCache.length > 0) {
    await FacebookCacheDB.saveAdSets(adSetsToCache);
    console.log(`Successfully cached ${adSetsToCache.length} new ad sets.`);
  }
}

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

  // Get source ad set's account ID to check if cross-account
  let sourceAdSetAccountId = null;
  let targetCampaignAccountId = null;

  try {
    // Get source ad set account
    const adSetCheckUrl = `https://graph.facebook.com/${api_version}/${ad_set_id}`;
    const adSetCheckResponse = await axios.get(adSetCheckUrl, {
      params: {
        fields: "account_id",
        access_token: userAccessToken,
      },
    });
    sourceAdSetAccountId = normalizeAdAccountId(adSetCheckResponse.data.account_id);

    // Get target campaign account
    if (campaign_id) {
      const campaignCheckUrl = `https://graph.facebook.com/${api_version}/${campaign_id}`;
      const campaignCheckResponse = await axios.get(campaignCheckUrl, {
        params: {
          fields: "account_id",
          access_token: userAccessToken,
        },
      });
      targetCampaignAccountId = normalizeAdAccountId(campaignCheckResponse.data.account_id);
    }
  } catch (err) {
    console.error("Failed to get account IDs:", err.response?.data || err.message);
  }

  const isCrossAccount = sourceAdSetAccountId && targetCampaignAccountId && sourceAdSetAccountId !== targetCampaignAccountId;
  console.log(`[ADSET DUPLICATION] Ad Set ${ad_set_id}:`);
  console.log(`  - Source AdSet Account: ${sourceAdSetAccountId}`);
  console.log(`  - Target Campaign: ${campaign_id} (Account: ${targetCampaignAccountId})`);
  console.log(`  - Requested Account: ${normalizedAccountId}`);
  console.log(`  - Cross-Account: ${isCrossAccount}`);

  // Validation: Check if campaign belongs to the specified account
  if (targetCampaignAccountId && normalizedAccountId !== targetCampaignAccountId) {
    console.error(`❌ MISMATCH: Campaign ${campaign_id} belongs to account ${targetCampaignAccountId}, but request specifies account ${normalizedAccountId}`);
    return res.status(400).json({
      error: "Campaign and account mismatch",
      details: `The selected campaign belongs to account ${targetCampaignAccountId}, but you're trying to create the ad set in account ${normalizedAccountId}. Please select a campaign from the correct account.`,
    });
  }

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
    let newAdSetId;

    if (isCrossAccount) {
      // CROSS-ACCOUNT DUPLICATION: Fetch full ad set details and create new ad set
      console.log(`Using CROSS-ACCOUNT duplication for ad set ${ad_set_id}`);

      // Fetch full ad set details
      const adSetDetailsUrl = `https://graph.facebook.com/${api_version}/${ad_set_id}`;
      const adSetDetailsResponse = await axios.get(adSetDetailsUrl, {
        params: {
          fields:
            "name,optimization_goal,billing_event,bid_strategy,daily_budget,lifetime_budget,bid_amount,targeting,destination_type,promoted_object,status,start_time,end_time,pacing_type,adset_schedule" + (deep_copy ? ",ads{id,name}" : ""),
          access_token: userAccessToken,
        },
      });

      const sourceAdSet = adSetDetailsResponse.data;
      console.log("Source ad set details:", sourceAdSet.name);

      if (deep_copy) {
        adsData = sourceAdSet.ads?.data || [];
        totalAdsCount = adsData.length;
        totalChildObjects = totalAdsCount;
      }

      // Create new ad set in target account with target campaign
      const createAdSetPayload = {
        name: name || `${sourceAdSet.name} (Copy)`,
        campaign_id: campaign_id,
        optimization_goal: sourceAdSet.optimization_goal,
        billing_event: sourceAdSet.billing_event,
        status: status_option === "INHERITED_FROM_SOURCE" ? sourceAdSet.status : status_option || "PAUSED",
        access_token: userAccessToken,
      };

      // Copy optional fields
      if (sourceAdSet.bid_strategy) createAdSetPayload.bid_strategy = sourceAdSet.bid_strategy;
      if (sourceAdSet.daily_budget) createAdSetPayload.daily_budget = sourceAdSet.daily_budget;
      if (sourceAdSet.lifetime_budget) createAdSetPayload.lifetime_budget = sourceAdSet.lifetime_budget;
      if (sourceAdSet.bid_amount) createAdSetPayload.bid_amount = sourceAdSet.bid_amount;
      if (sourceAdSet.targeting) createAdSetPayload.targeting = sourceAdSet.targeting;
      if (sourceAdSet.destination_type) createAdSetPayload.destination_type = sourceAdSet.destination_type;
      if (sourceAdSet.promoted_object) createAdSetPayload.promoted_object = sourceAdSet.promoted_object;
      if (sourceAdSet.start_time) createAdSetPayload.start_time = sourceAdSet.start_time;
      if (sourceAdSet.end_time) createAdSetPayload.end_time = sourceAdSet.end_time;
      if (sourceAdSet.pacing_type) createAdSetPayload.pacing_type = sourceAdSet.pacing_type;
      if (sourceAdSet.adset_schedule) createAdSetPayload.adset_schedule = sourceAdSet.adset_schedule;

      // Create ad set in target account
      const createAdSetUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/adsets`;

      // Convert to URLSearchParams
      const formData = new URLSearchParams();
      for (const [key, value] of Object.entries(createAdSetPayload)) {
        if (typeof value === "object" && value !== null) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, value.toString());
        }
      }

      const createResponse = await axios.post(createAdSetUrl, formData, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      newAdSetId = createResponse.data.id;
      console.log(`✅ Created new ad set in target account: ${newAdSetId}`);

      // If deep_copy, duplicate ads
      if (deep_copy && totalAdsCount > 0) {
        console.log(`Duplicating ${totalAdsCount} ads to new ad set ${newAdSetId}`);

        // Use batch requests for ads
        const FormData = (await import("form-data")).default;
        const batchOperations = adsData.map((ad) => ({
          method: "POST",
          relative_url: `${ad.id}/copies`,
          body: `adset_id=${newAdSetId}&status_option=${status_option || "PAUSED"}`,
        }));

        // Send in chunks
        const chunkSize = 50;
        const batchIds = [];

        for (let i = 0; i < batchOperations.length; i += chunkSize) {
          const chunk = batchOperations.slice(i, i + chunkSize);
          const formData = new FormData();
          formData.append("access_token", userAccessToken);
          formData.append("batch", JSON.stringify(chunk));
          formData.append("is_parallel", "true");

          const batchResponse = await axios.post(`https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_batch_requests`, formData, { headers: formData.getHeaders(), timeout: 30000 });

          const batchId = batchResponse.data?.id || batchResponse.data?.async_batch_request_id || null;
          batchIds.push(batchId);
        }

        return res.json({
          success: true,
          mode: "cross_account_async",
          id: newAdSetId,
          original_id: ad_set_id,
          batchRequestIds: batchIds,
          adsCount: totalAdsCount,
          message: `Ad set created in target account. ${totalAdsCount} ads are being duplicated asynchronously.`,
        });
      }

      // No deep copy or no ads
      return res.json({
        success: true,
        mode: "cross_account_sync",
        id: newAdSetId,
        original_id: ad_set_id,
        message: "Ad set created successfully in target account",
      });
    } else if (needsAsync) {
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

  // Get source campaign's account ID to check if cross-account
  let sourceCampaignAccountId = null;
  try {
    const campaignCheckUrl = `https://graph.facebook.com/${api_version}/${campaign_id}`;
    const campaignCheckResponse = await axios.get(campaignCheckUrl, {
      params: {
        fields: "account_id",
        access_token: userAccessToken,
      },
    });
    sourceCampaignAccountId = normalizeAdAccountId(campaignCheckResponse.data.account_id);
  } catch (err) {
    console.error("Failed to get campaign account ID:", err.response?.data || err.message);
  }

  const isCrossAccount = sourceCampaignAccountId && sourceCampaignAccountId !== normalizedAccountId;
  console.log(`Campaign ${campaign_id}: source=${sourceCampaignAccountId}, target=${normalizedAccountId}, cross-account=${isCrossAccount}`);

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
    let newCampaignId;

    if (isCrossAccount) {
      // For cross-account duplication, we need to fetch full campaign details and create new campaign
      const campaignDetailsUrl = `https://graph.facebook.com/${api_version}/${campaign_id}`;
      const campaignDetailsResponse = await axios.get(campaignDetailsUrl, {
        params: {
          fields: "name,objective,status,special_ad_categories,special_ad_category_country,bid_strategy,daily_budget,lifetime_budget,start_time,stop_time,buying_type",
          access_token: userAccessToken,
        },
      });

      const sourceCampaign = campaignDetailsResponse.data;
      console.log("Source campaign details:", sourceCampaign);

      // Create new campaign in target account
      const createCampaignPayload = {
        name: name || `${sourceCampaign.name} (Copy)`,
        objective: sourceCampaign.objective,
        status: status_option || "PAUSED",
        access_token: userAccessToken,
      };

      // Add optional fields if they exist
      if (sourceCampaign.special_ad_categories && sourceCampaign.special_ad_categories.length > 0) {
        createCampaignPayload.special_ad_categories = sourceCampaign.special_ad_categories;
      }
      if (sourceCampaign.special_ad_category_country && sourceCampaign.special_ad_category_country.length > 0) {
        createCampaignPayload.special_ad_category_country = sourceCampaign.special_ad_category_country;
      }
      if (sourceCampaign.bid_strategy) {
        createCampaignPayload.bid_strategy = sourceCampaign.bid_strategy;
      }
      if (sourceCampaign.daily_budget) {
        createCampaignPayload.daily_budget = sourceCampaign.daily_budget;
      }
      if (sourceCampaign.lifetime_budget) {
        createCampaignPayload.lifetime_budget = sourceCampaign.lifetime_budget;
      }
      if (sourceCampaign.start_time) {
        createCampaignPayload.start_time = sourceCampaign.start_time;
      }
      if (sourceCampaign.stop_time) {
        createCampaignPayload.stop_time = sourceCampaign.stop_time;
      }
      if (sourceCampaign.buying_type) {
        createCampaignPayload.buying_type = sourceCampaign.buying_type;
      }

      // Set is_adset_budget_sharing_enabled to true for cross-account duplication
      createCampaignPayload.is_adset_budget_sharing_enabled = false;

      const createCampaignUrl = `https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/campaigns`;
      const createResponse = await axios.post(createCampaignUrl, createCampaignPayload);

      newCampaignId = createResponse.data.id;
      console.log(`✅ Created new campaign in target account: ${newCampaignId}`);
    } else {
      // For same-account duplication, use the /copies endpoint
      const shallowPayload = {
        deep_copy: false,
        status_option: status_option || "PAUSED",
        access_token: userAccessToken,
      };

      const campaignCopyUrl = `https://graph.facebook.com/${api_version}/${campaign_id}/copies`;
      const shallowResponse = await axios.post(campaignCopyUrl, shallowPayload, {
        headers: { "Content-Type": "application/json" },
      });

      newCampaignId = shallowResponse.data.copied_campaign_id || shallowResponse.data.id;
      console.log(`✅ Created campaign copy in same account: ${newCampaignId}`);

      if (name && newCampaignId) {
        await axios.post(`https://graph.facebook.com/${api_version}/${newCampaignId}`, {
          name,
          access_token: userAccessToken,
        });
        console.log(`Updated campaign name to: ${name}`);
      }
    }

    if (!newCampaignId) {
      throw new Error("Failed to create campaign - no campaign ID returned");
    }

    // If not doing deep copy, return here
    if (!deep_copy) {
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

      const resp = await axios.post(`https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_batch_requests`, formData, { headers: formData.getHeaders(), timeout: 30000 });

      const data = resp.data;
      return data?.id || data?.async_batch_request_id || data?.handle || (Array.isArray(data) && data[0]?.id) || (typeof data === "string" ? data : null);
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
      const resp = await axios.post(`https://graph.facebook.com/${api_version}/act_${normalizedAccountId}/async_batch_requests`, formData, { headers: formData.getHeaders(), timeout: 30000 });
      const data = resp.data;

      // If Meta executed synchronously
      if (Array.isArray(data) && data[0]?.body?.includes("copied_adset_id")) {
        try {
          const parsed = JSON.parse(data[0].body);
          const copied = parsed.ad_object_ids?.[0];
          if (copied) adsetMapping[copied.source_id] = copied.copied_id;
        } catch (_) {}
      }

      adsetBatchIds.push(data?.id || data?.async_batch_request_id || data?.handle || (Array.isArray(data) && data[0]?.id) || null);
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
      message: "Campaign duplicated with two-phase async batch (adsets first, ads second). Check Meta Ads Manager after 1–5 minutes.",
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

      // Transform Error objects to plain objects so they serialize properly
      const serializedResponse = response.map((result) => {
        if (result.status === "rejected" && result.reason instanceof Error) {
          return {
            status: "rejected",
            reason: {
              message: result.reason.message,
              name: result.reason.name,
              stack: result.reason.stack,
            },
          };
        }
        return result;
      });

      res.status(200).json(serializedResponse);
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

// ========================================
// Automated Rules API Endpoints
// ========================================

// Helper function to format account ID with act_ prefix
function formatAccountId(accountId) {
  if (!accountId) return accountId;
  const cleanId = String(accountId).trim();
  return cleanId.startsWith("act_") ? cleanId : `act_${cleanId}`;
}

// Field mapping configuration for Meta API
// Monetary fields need conversion to cents (multiply by 100)
const FIELD_CONFIG = {
  // Monetary fields (convert dollars to cents)
  // Based on Meta API documentation for Automated Rules
  monetary: ["spent", "cpc", "cpm", "cpp", "cost_per_unique_click"],
  // ROAS fields (keep as decimal ratio)
  roas: ["website_purchase_roas", "mobile_app_purchase_roas"],
  // Percentage fields (keep as-is, already in percentage format)
  percentage: ["ctr", "result_rate"],
  // Count fields (keep as-is)
  count: ["impressions", "unique_impressions", "reach", "clicks", "unique_clicks", "frequency"],
};

// Helper function to process condition field and value for Meta API
function processConditionForMeta(condition) {
  const { field, operator, value } = condition;

  // Determine if this is a monetary field that needs conversion to cents
  const needsCentsConversion = FIELD_CONFIG.monetary.includes(field);

  // Handle range operators with array values
  if ((operator === "IN_RANGE" || operator === "NOT_IN_RANGE") && Array.isArray(value)) {
    let processedValue = value;
    if (needsCentsConversion) {
      // Convert both min and max from dollars to cents
      processedValue = [Math.round(value[0] * 100), Math.round(value[1] * 100)];
    }
    return {
      field,
      operator,
      value: processedValue,
    };
  }

  // Convert value if needed for single-value operators
  let processedValue = value;
  if (needsCentsConversion && typeof value === "number") {
    // Convert dollars to cents (e.g., 100.00 -> 10000)
    processedValue = Math.round(value * 100);
  }

  return {
    field,
    operator,
    value: processedValue,
  };
}

// Helper function to process condition value from Meta API for display
function processConditionFromMeta(condition) {
  const { field, operator, value } = condition;

  // Determine if this is a monetary field that needs conversion from cents
  const needsCentsConversion = FIELD_CONFIG.monetary.includes(field);

  // Handle range operators with array values
  if ((operator === "IN_RANGE" || operator === "NOT_IN_RANGE") && Array.isArray(value)) {
    let processedValue = value;
    if (needsCentsConversion) {
      // Convert both min and max from cents to dollars
      processedValue = [value[0] / 100, value[1] / 100];
    }
    return {
      field,
      operator,
      value: processedValue,
    };
  }

  // Convert value if needed for single-value operators
  let processedValue = value;
  if (needsCentsConversion && typeof value === "number") {
    // Convert cents to dollars (e.g., 10000 -> 100.00)
    processedValue = value / 100;
  }

  return {
    field,
    operator,
    value: processedValue,
  };
}

// Get all rules for a user/account
app.get("/api/rules", ensureAuthenticatedAPI, async (req, res) => {
  console.log("restarted");
  try {
    const userId = req.user.id;
    const { account_id } = req.query;
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

    // Format account ID with act_ prefix
    const formattedAccountId = formatAccountId(account_id);

    // Fetch rules from Meta API
    const metaApiUrl = `https://graph.facebook.com/${api_version}/${formattedAccountId}/adrules_library`;

    try {
      const response = await axios.get(metaApiUrl, {
        params: {
          fields: "id,name,evaluation_spec,execution_spec,schedule_spec,status",
          access_token: userAccessToken,
        },
      });

      const metaRules = response.data.data || [];

      // DEBUGGING: Log raw data from Meta API
      console.log("================== RAW META API RULES DATA ==================");
      console.log(JSON.stringify(metaRules, null, 2));
      console.log("===========================================================");

      // Sync with local database and return combined data
      const localRules = RulesDB.getRules(userId, account_id);

      // Merge Meta rules with local data and convert values from cents to dollars
      const mergedRules = metaRules.map((metaRule) => {
        const localRule = localRules.find((lr) => lr.meta_rule_id === metaRule.id);

        // Extract entity_type from evaluation_spec filters
        let entityType = "CAMPAIGN"; // default
        if (metaRule.evaluation_spec && metaRule.evaluation_spec.filters) {
          const entityFilter = metaRule.evaluation_spec.filters.find((f) => f.field === "entity_type");
          if (entityFilter && entityFilter.value) {
            entityType = entityFilter.value;
          }
        }

        // Process evaluation_spec to convert monetary values from cents to dollars
        let processedEvalSpec = metaRule.evaluation_spec;
        if (processedEvalSpec && processedEvalSpec.filters) {
          processedEvalSpec = {
            ...processedEvalSpec,
            filters: processedEvalSpec.filters.map((filter) => {
              // Skip non-condition filters
              if (["id", "entity_type", "time_preset", "effective_status"].includes(filter.field)) {
                return filter;
              }
              return processConditionFromMeta(filter);
            }),
          };
        }

        // Process execution_spec to convert budget/bid values from cents to dollars
        let processedExecSpec = metaRule.execution_spec;
        if (processedExecSpec && processedExecSpec.execution_options) {
          processedExecSpec = {
            ...processedExecSpec,
            execution_options: processedExecSpec.execution_options.map((option) => ({
              ...option,
              value:
                option.field === "daily_budget" || option.field === "bid_amount"
                  ? option.value / 100 // Convert cents to dollars
                  : option.value,
            })),
          };
        }

        return {
          id: localRule?.id || null,
          meta_rule_id: metaRule.id,
          name: metaRule.name,
          entity_type: entityType,
          rule_type: localRule?.rule_type || "SCHEDULE", // <-- ADDED THIS LINE
          status: metaRule.status === "ENABLED" ? "ACTIVE" : metaRule.status === "DISABLED" ? "PAUSED" : metaRule.status,
          evaluation_spec: processedEvalSpec,
          execution_spec: processedExecSpec,
          schedule_spec: metaRule.schedule_spec,
          created_at: localRule?.created_at,
          updated_at: localRule?.updated_at,
        };
      });

      res.json({
        success: true,
        rules: mergedRules,
        count: mergedRules.length,
      });
    } catch (metaError) {
      console.error("Meta API error fetching rules:", metaError.response?.data || metaError.message);
      return res.status(400).json({
        error: "Failed to fetch rules from Meta API",
        details: metaError.response?.data?.error?.message || metaError.message,
      });
    }
  } catch (error) {
    console.error("Error fetching rules:", error);
    res.status(500).json({ error: "Failed to fetch rules" });
  }
});

// Get a single rule by ID
app.get("/api/rules/:id", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    const ruleId = parseInt(req.params.id);

    const rule = RulesDB.getRuleById(ruleId, userId);

    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    res.json({
      success: true,
      rule,
    });
  } catch (error) {
    console.error("Error fetching rule:", error);
    res.status(500).json({ error: "Failed to fetch rule" });
  }
});

// Helper function: Create rule for a single account (reusable for batch operations)
async function createSingleAccountRule(userId, userAccessToken, ad_account_id, ruleConfig) {
  const { name, entity_type, entity_ids, conditions, action, rule_type, schedule, time_preset, subscribers } = ruleConfig;

  // Format account ID with act_ prefix
  const formattedAccountId = formatAccountId(ad_account_id);

  // Build evaluation_spec for Meta API
  const evaluation_spec = {
    evaluation_type: rule_type || "SCHEDULE",
    filters: [],
  };

  // Add entity filter
  if (entity_ids && entity_ids.length > 0) {
    evaluation_spec.filters.push({
      field: "id",
      operator: "IN",
      value: entity_ids,
    });
  } else {
    // Apply to all active entities of type
    evaluation_spec.filters.push({
      field: "entity_type",
      operator: "EQUAL",
      value: entity_type,
    });

    // Add effective_status filter for "All active..." entities
    evaluation_spec.filters.push({
      field: "effective_status",
      operator: "IN",
      value: ["ACTIVE"],
    });
  }

  // Add time preset filter (from user selection or default)
  evaluation_spec.filters.push({
    field: "time_preset",
    operator: "EQUAL",
    value: time_preset || "LAST_7_DAYS",
  });

  // Add condition filters with proper field and value processing
  for (const condition of conditions) {
    const processed = processConditionForMeta(condition);
    evaluation_spec.filters.push(processed);
  }

  // Add budget_reset_period filter for CHANGE_BUDGET actions
  if (action.type === "CHANGE_BUDGET" && action.budget_type) {
    const fieldPrefix = entity_type.toLowerCase();
    const budgetPeriodValue = action.budget_type === "daily_budget" ? "DAY" : "LIFETIME";

    evaluation_spec.filters.push({
      field: `${fieldPrefix}.budget_reset_period`,
      operator: "IN",
      value: [budgetPeriodValue],
    });
  }

  // Build execution_spec for Meta API
  const execution_spec = {};
  const exec_type = action.type;
  const isScheduleRule = (rule_type || "SCHEDULE") === "SCHEDULE";

  if (exec_type === "CHANGE_BUDGET") {
    if (entity_type === "CAMPAIGN") {
      execution_spec.execution_type = "CHANGE_CAMPAIGN_BUDGET";

      let amount = parseFloat(action.amount);
      if (action.budget_change_type === "DECREASE") {
        amount = -Math.abs(amount);
      } else {
        amount = Math.abs(amount);
      }

      const unit = action.unit === "PERCENTAGE" ? "PERCENTAGE" : "ACCOUNT_CURRENCY";
      if (unit === "ACCOUNT_CURRENCY") {
        amount = Math.round(amount * 100);
      }

      const changeSpecData = {
        amount: amount,
        unit: unit,
      };

      if (isScheduleRule) {
        execution_spec.execution_options = [
          {
            field: "change_spec",
            operator: "EQUAL",
            value: changeSpecData,
          },
        ];
      } else {
        execution_spec.change_spec = changeSpecData;
      }
    } else if (entity_type === "ADSET") {
      execution_spec.execution_type = "CHANGE_BUDGET";

      let amount = parseFloat(action.amount);
      if (action.budget_change_type === "DECREASE") {
        amount = -Math.abs(amount);
      } else {
        amount = Math.abs(amount);
      }

      const unit = action.unit === "PERCENTAGE" || action.unit === "PERCENT" ? "PERCENTAGE" : "ACCOUNT_CURRENCY";
      if (unit === "ACCOUNT_CURRENCY") {
        amount = Math.round(amount * 100);
      }

      const changeSpecData = {
        amount: amount,
        unit: unit,
      };

      if (isScheduleRule) {
        execution_spec.execution_options = [
          {
            field: "change_spec",
            operator: "EQUAL",
            value: changeSpecData,
          },
        ];
      } else {
        execution_spec.change_spec = changeSpecData;
      }
    }
  } else if (exec_type === "CHANGE_BID") {
    execution_spec.execution_type = "CHANGE_BID";

    let amount = parseFloat(action.amount);
    if (action.bid_change_type === "DECREASE") {
      amount = -Math.abs(amount);
    } else if (action.bid_change_type === "INCREASE") {
      amount = Math.abs(amount);
    }

    const unit = action.unit === "PERCENTAGE" ? "PERCENTAGE" : "ACCOUNT_CURRENCY";
    if (unit === "ACCOUNT_CURRENCY") {
      amount = Math.round(amount * 100);
    }

    const changeSpecData = {
      amount: amount,
      unit: unit,
    };

    if (isScheduleRule) {
      execution_spec.execution_options = [
        {
          field: "change_spec",
          operator: "EQUAL",
          value: changeSpecData,
        },
      ];
    } else {
      execution_spec.change_spec = changeSpecData;
    }
  } else {
    execution_spec.execution_type = exec_type === "PAUSE" ? "PAUSE" : exec_type === "UNPAUSE" ? "UNPAUSE" : exec_type === "SEND_NOTIFICATION" ? "NOTIFICATION" : exec_type;
  }

  if (!execution_spec.execution_options) {
    execution_spec.execution_options = [];
  }

  if (action.type === "SEND_NOTIFICATION" && subscribers && subscribers.length > 0) {
    execution_spec.execution_options.push({
      field: "user_ids",
      operator: "EQUAL",
      value: subscribers,
    });
  }

  // Build schedule_spec if schedule provided
  let schedule_spec = null;
  if (schedule && schedule.frequency && isScheduleRule) {
    // Map CONTINUOUSLY, HOURLY (legacy), and SEMI_HOURLY to SEMI_HOURLY for Meta API
    // This shows as "Checked at least once every 30 minutes" in Facebook Business Manager
    if (schedule.frequency === "CONTINUOUSLY" || schedule.frequency === "HOURLY" || schedule.frequency === "SEMI_HOURLY") {
      schedule_spec = {
        schedule_type: "SEMI_HOURLY",
      };
    } else if (schedule.frequency === "DAILY") {
      schedule_spec = {
        schedule_type: "DAILY",
        schedule_time: "12:00",
      };
    } else if (schedule.frequency === "CUSTOM") {
      schedule_spec = {
        schedule_type: "CUSTOM",
        schedule: [
          {
            days: schedule.days,
            start_minute: schedule.start_minute,
            end_minute: schedule.end_minute,
          },
        ],
      };
    } else {
      // Fallback: ensure schedule_spec exists for schedule rules
      schedule_spec = {
        schedule_type: "SEMI_HOURLY",
      };
    }
  }

  // Create rule on Meta API
  const metaPayload = {
    name,
    evaluation_spec,
    execution_spec,
  };

  if (schedule_spec) {
    metaPayload.schedule_spec = schedule_spec;
  }

  const metaResponse = await axios.post(`https://graph.facebook.com/v21.0/${formattedAccountId}/adrules_library`, metaPayload, {
    params: { access_token: userAccessToken },
  });

  const metaRuleId = metaResponse.data.id;

  // Save rule to local database
  const ruleData = {
    user_id: userId,
    ad_account_id,
    meta_rule_id: metaRuleId,
    name,
    entity_type,
    entity_ids,
    rule_type: rule_type || "SCHEDULE",
    evaluation_spec,
    execution_spec,
    schedule_spec,
    status: "ACTIVE",
  };

  const createdRule = RulesDB.createRule(ruleData);

  return {
    success: true,
    rule: createdRule,
    meta_rule_id: metaRuleId,
  };
}

// Create a new rule
app.post("/api/rules", ensureAuthenticatedAPI, validateRequest.createRule, async (req, res) => {
  try {
    const userId = req.user.id;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    const { ad_account_id, ...ruleConfig } = req.body;

    // Use helper function to create rule
    const result = await createSingleAccountRule(userId, userAccessToken, ad_account_id, ruleConfig);

    res.json({
      success: true,
      message: "Rule created successfully",
      rule: result.rule,
      meta_rule_id: result.meta_rule_id,
    });
  } catch (error) {
    console.error("Error creating rule:", error);
    res.status(500).json({ error: "Failed to create rule", details: error.message });
  }
});

// Helper function: Create rules on multiple accounts with concurrency control
async function createMultiAccountRulesWithConcurrency(userId, userAccessToken, ruleConfig, ad_account_ids, concurrency = 2) {
  const results = [];

  // Process accounts in batches to control concurrency
  for (let i = 0; i < ad_account_ids.length; i += concurrency) {
    const batch = ad_account_ids.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (accountId) => {
        try {
          const result = await createSingleAccountRule(userId, userAccessToken, accountId, ruleConfig);
          return {
            ad_account_id: accountId,
            success: true,
            local_rule_id: result.rule.id,
            meta_rule_id: result.meta_rule_id,
            error: null,
          };
        } catch (error) {
          console.error(`Error creating rule on account ${accountId}:`, error.message);
          return {
            ad_account_id: accountId,
            success: false,
            local_rule_id: null,
            meta_rule_id: null,
            error: error.response?.data?.error?.message || error.message,
          };
        }
      })
    );

    results.push(...batchResults);
  }

  return results;
}

// Create rules on multiple accounts (batch creation)
app.post("/api/rules/batch", ensureAuthenticatedAPI, validateRequest.createBatchRule, async (req, res) => {
  try {
    const userId = req.user.id;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    const { ad_account_ids, ...ruleConfig } = req.body;

    if (!ad_account_ids || !Array.isArray(ad_account_ids) || ad_account_ids.length === 0) {
      return res.status(400).json({
        error: "ad_account_ids array is required and must contain at least one account",
      });
    }

    // Limit max accounts per batch (prevent abuse)
    if (ad_account_ids.length > 20) {
      return res.status(400).json({
        error: "Maximum 20 accounts allowed per batch request",
      });
    }

    console.log(`Creating rule "${ruleConfig.name}" on ${ad_account_ids.length} accounts...`);

    // Create rules with concurrency control (2 accounts at a time)
    const results = await createMultiAccountRulesWithConcurrency(
      userId,
      userAccessToken,
      ruleConfig,
      ad_account_ids,
      2 // Concurrency limit to avoid rate limiting
    );

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    console.log(`Batch creation completed: ${successCount} succeeded, ${failureCount} failed`);

    res.json({
      success: successCount > 0,
      message: `Rule created on ${successCount} out of ${ad_account_ids.length} accounts`,
      total_accounts: ad_account_ids.length,
      completed: successCount,
      failed: failureCount,
      results,
    });
  } catch (error) {
    console.error("Error creating batch rules:", error);
    res.status(500).json({
      error: "Failed to create batch rules",
      details: error.message,
    });
  }
});

// Update a rule
app.put("/api/rules/:id", ensureAuthenticatedAPI, validateRequest.updateRule, async (req, res) => {
  try {
    const userId = req.user.id;
    const ruleId = parseInt(req.params.id);
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Get existing rule
    const existingRule = RulesDB.getRuleById(ruleId, userId);
    if (!existingRule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    const { name, entity_type, entity_ids, conditions, action, rule_type, schedule, status } = req.body;

    // Build updated specs
    let updatedEvalSpec = existingRule.evaluation_spec;
    let updatedExecSpec = existingRule.execution_spec;
    let updatedScheduleSpec = existingRule.schedule_spec;

    // Update evaluation_spec if conditions changed
    if (conditions) {
      updatedEvalSpec = {
        evaluation_type: rule_type || existingRule.rule_type,
        filters: [], // Both metadata and insights filters
      };

      if (entity_ids && entity_ids.length > 0) {
        updatedEvalSpec.filters.push({
          field: "id",
          operator: "IN",
          value: entity_ids,
        });
      } else {
        updatedEvalSpec.filters.push({
          field: "entity_type",
          operator: "EQUAL",
          value: entity_type || existingRule.entity_type,
        });
      }

      updatedEvalSpec.filters.push({
        field: "time_preset",
        operator: "EQUAL",
        value: "LAST_7_DAYS",
      });

      for (const condition of conditions) {
        const processed = processConditionForMeta(condition);
        updatedEvalSpec.filters.push(processed);
      }

      // Add budget_reset_period filter for CHANGE_BUDGET actions
      // This ensures the rule only applies to entities with matching budget type (daily vs lifetime)
      // Reference: Meta API Automated Rules - budget_reset_period metadata filter
      if (action && action.type === "CHANGE_BUDGET" && action.budget_type) {
        const current_entity_type = entity_type || existingRule.entity_type;
        const fieldPrefix = current_entity_type.toLowerCase(); // 'campaign' or 'adset'
        const budgetPeriodValue = action.budget_type === "daily_budget" ? "DAY" : "LIFETIME";

        updatedEvalSpec.filters.push({
          field: `${fieldPrefix}.budget_reset_period`,
          operator: "IN",
          value: [budgetPeriodValue],
        });
      }
    }

    // Update execution_spec if action changed
    if (action) {
      updatedExecSpec = {}; // Initialize as empty object
      const exec_type = action.type;
      const current_entity_type = entity_type || existingRule.entity_type;
      const current_rule_type = rule_type || existingRule.rule_type;
      const isScheduleRule = current_rule_type === "SCHEDULE";

      if (exec_type === "CHANGE_BUDGET") {
        if (current_entity_type === "CAMPAIGN") {
          // Campaigns use a different spec and execution type
          updatedExecSpec.execution_type = "CHANGE_CAMPAIGN_BUDGET";

          let amount = parseFloat(action.amount);
          if (action.budget_change_type === "DECREASE") {
            amount = -Math.abs(amount);
          } else {
            amount = Math.abs(amount);
          }

          const unit = action.unit === "PERCENTAGE" ? "PERCENTAGE" : "ACCOUNT_CURRENCY";
          if (unit === "ACCOUNT_CURRENCY") {
            amount = Math.round(amount * 100);
          }

          const changeSpecData = {
            amount: amount,
            unit: unit,
          };

          // SCHEDULE rules use execution_options, TRIGGER rules use direct change_spec
          if (isScheduleRule) {
            updatedExecSpec.execution_options = [
              {
                field: "change_spec",
                operator: "EQUAL",
                value: changeSpecData,
              },
            ];
          } else {
            updatedExecSpec.change_spec = changeSpecData;
          }
        } else if (current_entity_type === "ADSET") {
          // Adsets juga menggunakan change_spec
          updatedExecSpec.execution_type = "CHANGE_BUDGET";

          // Hitung amount dengan tanda (positif untuk INCREASE, negatif untuk DECREASE)
          let amount = parseFloat(action.amount);
          if (action.budget_change_type === "DECREASE") {
            amount = -Math.abs(amount);
          } else {
            amount = Math.abs(amount);
          }

          const unit = action.unit === "PERCENTAGE" || action.unit === "PERCENT" ? "PERCENTAGE" : "ACCOUNT_CURRENCY";
          if (unit === "ACCOUNT_CURRENCY") {
            amount = Math.round(amount * 100); // Convert to cents
          }

          const changeSpecData = {
            amount: amount,
            unit: unit,
          };

          // SCHEDULE rules use execution_options, TRIGGER rules use direct change_spec
          if (isScheduleRule) {
            updatedExecSpec.execution_options = [
              {
                field: "change_spec",
                operator: "EQUAL",
                value: changeSpecData,
              },
            ];
          } else {
            updatedExecSpec.change_spec = changeSpecData;
          }
        }
      } else if (exec_type === "CHANGE_BID") {
        // Handle CHANGE_BID action
        updatedExecSpec.execution_type = "CHANGE_BID";

        // Hitung amount dengan tanda (positif untuk INCREASE, negatif untuk DECREASE)
        let amount = parseFloat(action.amount);
        if (action.bid_change_type === "DECREASE") {
          amount = -Math.abs(amount);
        } else if (action.bid_change_type === "INCREASE") {
          amount = Math.abs(amount);
        }
        // Untuk SET, gunakan amount as-is

        const unit = action.unit === "PERCENTAGE" ? "PERCENTAGE" : "ACCOUNT_CURRENCY";
        if (unit === "ACCOUNT_CURRENCY") {
          amount = Math.round(amount * 100); // Convert to cents
        }

        // Build change_spec untuk CHANGE_BID
        const changeSpecData = {
          amount: amount,
          unit: unit,
        };

        // SCHEDULE rules use execution_options, TRIGGER rules use direct change_spec
        if (isScheduleRule) {
          updatedExecSpec.execution_options = [
            {
              field: "change_spec",
              operator: "EQUAL",
              value: changeSpecData,
            },
          ];
        } else {
          updatedExecSpec.change_spec = changeSpecData;
        }
      } else {
        // Handle other action types
        updatedExecSpec.execution_type = exec_type === "PAUSE" ? "PAUSE" : exec_type === "UNPAUSE" ? "UNPAUSE" : exec_type;
      }
    }

    // Update schedule_spec if schedule changed
    if (schedule) {
      if (schedule.frequency === "CONTINUOUSLY" || schedule.frequency === "HOURLY" || schedule.frequency === "SEMI_HOURLY") {
        // Map CONTINUOUSLY, HOURLY (legacy), and SEMI_HOURLY to SEMI_HOURLY for Meta API
        updatedScheduleSpec = {
          schedule_type: "SEMI_HOURLY",
        };
      } else if (schedule.frequency === "DAILY") {
        updatedScheduleSpec = {
          schedule_type: "DAILY",
          schedule_time: "12:00",
        };
      } else if (schedule.frequency === "CUSTOM") {
        updatedScheduleSpec = {
          schedule_type: "CUSTOM",
          schedule: [
            {
              days: schedule.days,
              start_minute: schedule.start_minute,
              end_minute: schedule.end_minute,
            },
          ],
        };
      }
    }

    // Update rule via Meta API
    if (existingRule.meta_rule_id) {
      const metaApiUrl = `https://graph.facebook.com/${api_version}/${existingRule.meta_rule_id}`;
      const metaPayload = {
        access_token: userAccessToken,
      };

      if (name) metaPayload.name = name;
      if (conditions) metaPayload.evaluation_spec = JSON.stringify(updatedEvalSpec);
      if (action) metaPayload.execution_spec = JSON.stringify(updatedExecSpec);
      if (schedule) metaPayload.schedule_spec = JSON.stringify(updatedScheduleSpec);

      try {
        await axios.post(metaApiUrl, metaPayload);
      } catch (metaError) {
        console.error("Meta API error updating rule:", metaError.response?.data || metaError.message);
        return res.status(400).json({
          error: "Failed to update rule in Meta API",
          details: metaError.response?.data?.error?.message || metaError.message,
        });
      }
    }

    // Update local database
    const updateData = {};
    if (name) updateData.name = name;
    if (entity_type) updateData.entity_type = entity_type;
    if (entity_ids) updateData.entity_ids = entity_ids;
    if (rule_type) updateData.rule_type = rule_type;
    if (conditions) updateData.evaluation_spec = updatedEvalSpec;
    if (action) updateData.execution_spec = updatedExecSpec;
    if (schedule) updateData.schedule_spec = updatedScheduleSpec;
    if (status) updateData.status = status;

    const updatedRule = RulesDB.updateRule(ruleId, userId, updateData);

    res.json({
      success: true,
      message: "Rule updated successfully",
      rule: updatedRule,
    });
  } catch (error) {
    console.error("Error updating rule:", error);
    res.status(500).json({ error: "Failed to update rule", details: error.message });
  }
});

// Toggle rule status (Enable/Disable)
app.patch("/api/rules/:id/status", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    const metaRuleId = req.params.id; // Now receives meta_rule_id from frontend
    const { status, local_rule_id } = req.body; // ENABLED or DISABLED (Meta format), and optional local_rule_id
    const userAccessToken = req.user?.facebook_access_token;

    console.log("Toggle status request:", { metaRuleId, status, local_rule_id, userId });

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Try to get local rule if local_rule_id is provided and not null
    let rule = null;
    if (local_rule_id && local_rule_id !== "null") {
      rule = RulesDB.getRuleById(parseInt(local_rule_id), userId);
      console.log("Local rule found:", rule ? "yes" : "no");
    }

    // Update in Meta API with ENABLED/DISABLED format
    // Use metaRuleId from URL params (works for both local and non-local rules)
    const metaApiUrl = `https://graph.facebook.com/${api_version}/${metaRuleId}`;

    try {
      // STEP 1: Fetch the current Rule Specs from Meta
      // Meta requires ALL fields to be provided when updating, not just status
      const currentRuleResponse = await axios.get(metaApiUrl, {
        params: {
          access_token: userAccessToken,
          fields: "name,evaluation_spec,execution_spec,schedule_spec",
        },
      });

      const currentData = currentRuleResponse.data;

      // STEP 2: Prepare the Update Payload
      // Send back existing specs + NEW status
      // Meta API expects specs to be JSON strings in POST body
      const updatePayload = {
        access_token: userAccessToken,
        status: status, // 'ENABLED' or 'DISABLED'
        name: currentData.name,
        evaluation_spec: JSON.stringify(currentData.evaluation_spec),
        execution_spec: JSON.stringify(currentData.execution_spec),
      };

      // Only include schedule_spec if it exists (null for trigger-based rules)
      if (currentData.schedule_spec) {
        updatePayload.schedule_spec = JSON.stringify(currentData.schedule_spec);
      }

      // STEP 3: Send the Update (data in body, not params)
      await axios.post(metaApiUrl, updatePayload);
      console.log("Meta API update successful");
    } catch (metaError) {
      console.error("Meta API error updating rule status:", metaError.response?.data || metaError.message);
      return res.status(400).json({
        error: "Failed to update rule status in Meta API",
        details: metaError.response?.data?.error?.message || metaError.message,
      });
    }

    // Update local DB if rule exists locally
    if (rule) {
      console.log("Updating local DB for rule:", local_rule_id);
      const frontendStatus = status === "ENABLED" ? "ACTIVE" : status === "DISABLED" ? "PAUSED" : status;
      RulesDB.updateRule(parseInt(local_rule_id), userId, { status: frontendStatus });
      console.log("Local DB updated");
    }

    // Convert to frontend format for response
    const frontendStatus = status === "ENABLED" ? "ACTIVE" : status === "DISABLED" ? "PAUSED" : status;
    console.log("Sending response:", { success: true, status: frontendStatus });
    res.json({ success: true, status: frontendStatus });
  } catch (error) {
    console.error("Error updating rule status:", error);
    res.status(500).json({ error: "Failed to update rule status", details: error.message });
  }
});

// Delete a rule
app.delete("/api/rules/:id", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    const metaRuleId = req.params.id; // Now receives meta_rule_id from frontend
    const { local_rule_id } = req.body; // Optional local_rule_id
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Delete from Meta API using metaRuleId
    const metaApiUrl = `https://graph.facebook.com/${api_version}/${metaRuleId}`;

    try {
      await axios.delete(metaApiUrl, {
        params: {
          access_token: userAccessToken,
        },
      });
    } catch (metaError) {
      console.error("Meta API error deleting rule:", metaError.response?.data || metaError.message);
      return res.status(400).json({
        error: "Failed to delete rule from Meta API",
        details: metaError.response?.data?.error?.message || metaError.message,
      });
    }

    // Delete from local database if local_rule_id exists
    if (local_rule_id && local_rule_id !== "null") {
      RulesDB.deleteRule(parseInt(local_rule_id), userId);
    }

    res.json({
      success: true,
      message: "Rule deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting rule:", error);
    res.status(500).json({ error: "Failed to delete rule", details: error.message });
  }
});

// Preview a rule (see which entities would be affected)
app.post("/api/rules/:id/preview", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    const ruleId = parseInt(req.params.id);
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Get existing rule
    const rule = RulesDB.getRuleById(ruleId, userId);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    // Call Meta API preview endpoint
    if (!rule.meta_rule_id) {
      return res.status(400).json({ error: "Rule does not have a Meta rule ID" });
    }

    const metaApiUrl = `https://graph.facebook.com/${api_version}/${rule.meta_rule_id}/preview`;

    try {
      const previewResponse = await axios.post(metaApiUrl, {
        access_token: userAccessToken,
      });

      res.json({
        success: true,
        affected_entities: previewResponse.data.data || [],
        count: previewResponse.data.data?.length || 0,
      });
    } catch (metaError) {
      console.error("Meta API error previewing rule:", metaError.response?.data || metaError.message);
      return res.status(400).json({
        error: "Failed to preview rule",
        details: metaError.response?.data?.error?.message || metaError.message,
      });
    }
  } catch (error) {
    console.error("Error previewing rule:", error);
    res.status(500).json({ error: "Failed to preview rule", details: error.message });
  }
});

// Manually execute a rule
app.post("/api/rules/:id/execute", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    const ruleId = parseInt(req.params.id);
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Get existing rule
    const rule = RulesDB.getRuleById(ruleId, userId);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    // Call Meta API execute endpoint
    if (!rule.meta_rule_id) {
      return res.status(400).json({ error: "Rule does not have a Meta rule ID" });
    }

    const metaApiUrl = `https://graph.facebook.com/${api_version}/${rule.meta_rule_id}/execute`;

    try {
      const executeResponse = await axios.post(metaApiUrl, {
        access_token: userAccessToken,
      });

      // Record execution in database
      RulesDB.recordExecution({
        rule_id: ruleId,
        execution_time: new Date().toISOString(),
        entities_affected: 0, // Will be updated once we fetch history
        actions_taken: 0,
        status: "SUCCESS",
        result_data: executeResponse.data,
      });

      res.json({
        success: true,
        message: "Rule executed successfully. Check history for results.",
        execution_id: executeResponse.data.id,
      });
    } catch (metaError) {
      console.error("Meta API error executing rule:", metaError.response?.data || metaError.message);

      // Record failed execution
      RulesDB.recordExecution({
        rule_id: ruleId,
        execution_time: new Date().toISOString(),
        entities_affected: 0,
        actions_taken: 0,
        status: "FAILED",
        error_message: metaError.response?.data?.error?.message || metaError.message,
      });

      return res.status(400).json({
        error: "Failed to execute rule",
        details: metaError.response?.data?.error?.message || metaError.message,
      });
    }
  } catch (error) {
    console.error("Error executing rule:", error);
    res.status(500).json({ error: "Failed to execute rule", details: error.message });
  }
});

// Get rule execution history
app.get("/api/rules/:id/history", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    const ruleId = parseInt(req.params.id);
    const userAccessToken = req.user?.facebook_access_token;
    const limit = parseInt(req.query.limit) || 50;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Get rule to verify ownership
    const rule = RulesDB.getRuleById(ruleId, userId);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    // Get local execution history
    const localHistory = RulesDB.getExecutionHistory(ruleId, userId, limit);

    // Get Meta API history if rule has Meta ID
    let metaHistory = [];
    if (rule.meta_rule_id) {
      try {
        const metaApiUrl = `https://graph.facebook.com/${api_version}/${rule.meta_rule_id}/history`;
        const metaResponse = await axios.get(metaApiUrl, {
          params: {
            access_token: userAccessToken,
            limit: limit,
          },
        });
        metaHistory = metaResponse.data.data || [];
      } catch (metaError) {
        console.error("Meta API error fetching history:", metaError.response?.data || metaError.message);
        // Continue with local history only
      }
    }

    res.json({
      success: true,
      local_history: localHistory,
      meta_history: metaHistory,
      count: localHistory.length,
    });
  } catch (error) {
    console.error("Error fetching rule history:", error);
    res.status(500).json({ error: "Failed to fetch rule history", details: error.message });
  }
});

// Get account-level rule execution history
app.get("/api/rules/account/:account_id/history", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const accountId = req.params.account_id;
    const userAccessToken = req.user?.facebook_access_token;
    const limit = parseInt(req.query.limit) || 100;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Get Meta API account-level history
    const metaApiUrl = `https://graph.facebook.com/${api_version}/${accountId}/adrules_history`;

    try {
      const metaResponse = await axios.get(metaApiUrl, {
        params: {
          access_token: userAccessToken,
          limit: limit,
        },
      });

      res.json({
        success: true,
        history: metaResponse.data.data || [],
        count: metaResponse.data.data?.length || 0,
      });
    } catch (metaError) {
      console.error("Meta API error fetching account history:", metaError.response?.data || metaError.message);
      return res.status(400).json({
        error: "Failed to fetch account history",
        details: metaError.response?.data?.error?.message || metaError.message,
      });
    }
  } catch (error) {
    console.error("Error fetching account history:", error);
    res.status(500).json({ error: "Failed to fetch account history", details: error.message });
  }
});

// Get ad account users for subscriber dropdown
// Skip subscriber pick for now, cause it's not essential for schedule rules
app.get("/api/account/:account_id/users", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const accountId = req.params.account_id;
    const userAccessToken = req.user?.facebook_access_token;

    if (!userAccessToken) {
      return res.status(403).json({
        error: "Facebook account not connected",
        needsAuth: true,
      });
    }

    // Format account ID with act_ prefix
    const formattedAccountId = formatAccountId(accountId);

    // Fetch users from Meta API using assigned_users edge
    const metaApiUrl = `https://graph.facebook.com/${api_version}/${formattedAccountId}/assigned_users`;

    try {
      const response = await axios.get(metaApiUrl, {
        params: {
          fields: "id,name,email,role",
          access_token: userAccessToken,
        },
      });

      const assignedUsers = response.data.data || [];

      // Map assigned users - they have a 'user' field with the actual user data
      const users = assignedUsers.map((assignedUser) => ({
        id: assignedUser.id || assignedUser.user?.id,
        name: assignedUser.name || assignedUser.user?.name || "Unknown User",
        email: assignedUser.email || assignedUser.user?.email,
        role: assignedUser.role,
      }));

      res.json({
        success: true,
        users: users,
      });
    } catch (metaError) {
      console.error("Meta API error fetching account users:", metaError.response?.data || metaError.message);
      // DEBUGGING: Log actual Meta API error for users endpoint
      console.error("================== RAW META API USERS ERROR DATA ==================");
      console.error(JSON.stringify(metaError.response?.data || { message: metaError.message }, null, 2));
      console.error("===================================================================");

      // Return empty array instead of error to allow rule creation without subscribers
      res.json({
        success: true,
        users: [],
      });
    }
  } catch (error) {
    console.error("Error fetching account users:", error);
    res.json({ success: true, users: [] }); // Return empty array on error
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
