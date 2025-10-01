import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { UserDB } from './auth-db.js';

export function configurePassport() {
  passport.use(new LocalStrategy(
    async function(username, password, done) {
      console.log('Login attempt in passport strategy for:', username);
      try {
        const user = await UserDB.verifyPassword(username, password);
        if (!user) {
          console.log('No user returned from verifyPassword');
          return done(null, false, { message: 'Incorrect username or password.' });
        }
        console.log('User verified:', user);
        return done(null, user);
      } catch (err) {
        console.error('Passport strategy error:', err);
        return done(err);
      }
    }
  ));

  passport.serializeUser(function(user, done) {
    console.log('Serializing user:', user);
    done(null, user.id);
  });

  passport.deserializeUser(async function(id, done) {
    console.log('Deserializing user ID:', id);
    try {
      const user = await UserDB.findById(id);
      console.log('Deserialized user:', user);
      done(null, user);
    } catch (err) {
      console.error('Deserialize error:', err);
      done(err);
    }
  });
}

// Middleware to check if user is authenticated
export function ensureAuthenticated(req, res, next) {
  // Bypass auth in development mode
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login.html');
}

// Middleware for API endpoints - returns 401 instead of redirecting
export function ensureAuthenticatedAPI(req, res, next) {
  // Bypass auth in development mode
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

// Middleware to check if user is not authenticated (for login page)
export function ensureNotAuthenticated(req, res, next) {
  // In development, don't redirect authenticated users away from login
  if (process.env.NODE_ENV === 'development') {
    return next();
  }
  
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  next();
}