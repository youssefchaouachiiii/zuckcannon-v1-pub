import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as FacebookStrategy } from "passport-facebook";
import { UserDB } from "./auth-db.js";
import { FacebookAuthDB } from "../utils/facebook-auth-db.js";

export function configurePassport() {
  // Local Strategy
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

  const callbackURL = process.env.NODE_ENV === 'development' ? 'https://localhost:6969/auth/facebook/callback' : `https://${process.env.DOMAIN}/auth/facebook/callback`;

  // Facebook Strategy
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.META_APP_ID,
        clientSecret: process.env.META_APP_SECRET,
        callbackURL: callbackURL,
        passReqToCallback: true,
      },
      async (req, accessToken, refreshToken, profile, done) => {
        try {
          console.log("Facebook OAuth callback - Profile ID:", profile.id);
          
          let user = req.user; // Existing logged-in user
          
          if (user) {
            // User already logged in - just connect Facebook
            // Save the Facebook access token for the logged-in user
            await FacebookAuthDB.saveToken(
              user.id,
              profile.id,
              accessToken,
              "user",
              null // Facebook user tokens don't expire by default
            );
            
            // Update user's Facebook ID in database
            await UserDB.updateFacebookId(user.id, profile.id);
            
            console.log("Facebook connected to existing user:", user.id);
            return done(null, user);
          }
          
          // No session - check if Facebook ID exists in database
          const existingUser = await UserDB.findByFacebookId(profile.id);
          
          if (existingUser) {
            // Auto-login existing Facebook user
            // Update/save the access token
            await FacebookAuthDB.saveToken(
              existingUser.id,
              profile.id,
              accessToken,
              "user",
              null
            );
            
            console.log("Auto-login existing Facebook user:", existingUser.id);
            return done(null, existingUser);
          }
          
          // Create new user from Facebook profile
          const username = profile.displayName || profile.emails?.[0]?.value || `fb_${profile.id}`;
          const email = profile.emails?.[0]?.value || null;
          
          const newUser = await UserDB.createFacebookUser(username, profile.id, email);
          
          // Save the Facebook access token
          await FacebookAuthDB.saveToken(
            newUser.id,
            profile.id,
            accessToken,
            "user",
            null
          );
          
          console.log("Created new Facebook user:", newUser.id);
          return done(null, newUser);
        } catch (error) {
          console.error("Facebook strategy error:", error);
          return done(error);
        }
      }
    )
  );

  passport.serializeUser(function (user, done) {
    console.log("Serializing user:", user);
    done(null, user.id);
  });

  passport.deserializeUser(async function (id, done) {
    console.log("Deserializing user ID:", id);
    try {
      const user = await UserDB.findById(id);
      console.log("Deserialized user:", user);
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
