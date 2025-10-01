// Request validation middleware
export const validateRequest = {
  // Validate file upload requests
  uploadFiles: (req, res, next) => {
    if (!req.body.account_id) {
      return res.status(400).json({ error: 'account_id is required' });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    // Validate file size limits
    const maxFileSize = 4 * 1024 * 1024 * 1024; // 4GB
    for (const file of req.files) {
      if (file.size > maxFileSize) {
        return res.status(400).json({ 
          error: `File ${file.originalname} exceeds maximum size of 4GB` 
        });
      }
    }
    
    next();
  },

  // Validate Google Drive download request
  googleDriveDownload: (req, res, next) => {
    const { fileIds, account_id } = req.body;
    
    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({ error: 'fileIds array is required' });
    }
    
    if (!account_id) {
      return res.status(400).json({ error: 'account_id is required' });
    }
    
    // Limit number of files per request
    if (fileIds.length > 50) {
      return res.status(400).json({ 
        error: 'Maximum 50 files can be processed per request' 
      });
    }
    
    next();
  },

  // Validate ad set creation
  createAdSet: (req, res, next) => {
    const requiredFields = ['account_id', 'campaign_id', 'name', 'optimization_goal', 'billing_event'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: `Missing required fields: ${missingFields.join(', ')}` 
      });
    }
    
    // Validate budget
    if (req.body.daily_budget && isNaN(parseFloat(req.body.daily_budget))) {
      return res.status(400).json({ error: 'daily_budget must be a valid number' });
    }
    
    if (req.body.lifetime_budget && isNaN(parseFloat(req.body.lifetime_budget))) {
      return res.status(400).json({ error: 'lifetime_budget must be a valid number' });
    }
    
    next();
  },

  // Validate creative upload from library
  uploadLibraryCreatives: (req, res, next) => {
    const { creativeIds, account_id } = req.body;
    
    if (!creativeIds || !Array.isArray(creativeIds) || creativeIds.length === 0) {
      return res.status(400).json({ error: 'creativeIds array is required' });
    }
    
    if (!account_id) {
      return res.status(400).json({ error: 'account_id is required' });
    }
    
    // Limit batch size
    if (creativeIds.length > 100) {
      return res.status(400).json({ 
        error: 'Maximum 100 creatives can be uploaded per request' 
      });
    }
    
    next();
  },

  // Validate user creation
  createUser: (req, res, next) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Basic password strength check
    const hasNumber = /\d/.test(password);
    const hasLetter = /[a-zA-Z]/.test(password);
    if (!hasNumber || !hasLetter) {
      return res.status(400).json({ 
        error: 'Password must contain both letters and numbers' 
      });
    }
    
    next();
  }
};

// Rate limiting middleware factory
export const createRateLimiter = (windowMs, maxRequests) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    // Clean up old entries
    for (const [ip, data] of requests.entries()) {
      if (now - data.firstRequest > windowMs) {
        requests.delete(ip);
      }
    }
    
    if (!requests.has(key)) {
      requests.set(key, { count: 1, firstRequest: now });
      return next();
    }
    
    const userData = requests.get(key);
    if (now - userData.firstRequest > windowMs) {
      userData.count = 1;
      userData.firstRequest = now;
    } else {
      userData.count++;
    }
    
    if (userData.count > maxRequests) {
      return res.status(429).json({ 
        error: 'Too many requests. Please try again later.' 
      });
    }
    
    next();
  };
};

// Login rate limiter - 5 attempts per 15 minutes
export const loginRateLimiter = createRateLimiter(15 * 60 * 1000, 5);

// API rate limiter - 100 requests per minute
export const apiRateLimiter = createRateLimiter(60 * 1000, 100);