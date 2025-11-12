import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { UserDB } from "./auth-db.js";

export function configurePassport() {
  // Local Strategy (username/password)
  passport.use(
    new LocalStrategy(async function (username, password, done) {
      console.log("Login attempt in passport strategy for:", username);
      try {
        const user = await UserDB.verifyPassword(username, password);
        if (!user) {
          console.log("No user returned from verifyPassword");
          return done(null, false, { message: "Incorrect username or password." });
        }
        console.log("User verified:", user);
        return done(null, user);
      } catch (err) {
        console.error("Passport strategy error:", err);
        return done(err);
      }
    })
  );

  // Facebook OAuth Strategy
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.META_APP_ID,
        clientSecret: process.env.META_APP_SECRET,
        callbackURL: process.env.META_OAUTH_CALLBACK_URL,
        profileFields: ["id", "displayName", "emails"],
        enableProof: true,
      },
      async function (accessToken, refreshToken, profile, done) {
        console.log("Facebook OAuth callback - Profile:", profile.id);
        try {
          // Token expires in 60 days by default (Facebook long-lived token)
          const expiresIn = 60 * 24 * 60 * 60; // 60 days in seconds

          const user = await UserDB.createOrUpdateFacebookUser(profile.id, accessToken, expiresIn, profile);

          console.log("Facebook user authenticated:", user);
          return done(null, user);
        } catch (err) {
          console.error("Facebook OAuth error:", err);
          return done(err);
        }
      }
    )
  );

  passport.serializeUser(function (user, done) {
    console.log("Serializing user:", user);
    done(null, user.id);
  });

  passport.deserializeUser(async function (id, done) {
    // console.log("Deserializing user ID:", id);
    try {
      const user = await UserDB.findById(id);
      // console.log("Deserialized user:", user);
      done(null, user);
    } catch (err) {
      console.error("Deserialize error:", err);
      done(err);
    }
  });
}

// Middleware to check if user is authenticated
export function ensureAuthenticated(req, res, next) {
  // Bypass auth in development mode
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login.html");
}

// Middleware for API endpoints - returns 401 instead of redirecting
export function ensureAuthenticatedAPI(req, res, next) {
  // Bypass auth in development mode
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Authentication required" });
}

// Middleware to check if user is not authenticated (for login page)
export function ensureNotAuthenticated(req, res, next) {
  // In development, don't redirect authenticated users away from login
  if (process.env.NODE_ENV === "development") {
    return next();
  }

  if (req.isAuthenticated()) {
    return res.redirect("/");
  }
  next();
}
