const express = require('express');
const cors = require('cors');
const path = require('path');
const database = require('./database');
const { Location, User, mongoose } = database;
const auth = require('./auth');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Add this after other const definitions
const LOCAL_USERS_FILE = path.join(__dirname, 'local_users.json');

// Store recent OTPs for debugging
global.recentOTPs = {};

// Function to read local users file
function getLocalUsers() {
  try {
    if (fs.existsSync(LOCAL_USERS_FILE)) {
      const data = fs.readFileSync(LOCAL_USERS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading local users file:', error);
    return [];
  }
}

// Function to save local users
function saveLocalUsers(users) {
  try {
    fs.writeFileSync(LOCAL_USERS_FILE, JSON.stringify(users, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving local users:', error);
    return false;
  }
}

// Function to find local user by email or phone
function findLocalUser(email, phone) {
  const users = getLocalUsers();
  return users.find(u => 
    (email && u.email.toLowerCase() === email.toLowerCase()) || 
    (phone && u.phone === phone)
  );
}

// Configure CORS with more detailed options
app.use(cors({
  origin: '*', // Allow all origins during development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Include OPTIONS for preflight requests
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  exposedHeaders: ['Content-Length', 'X-Requested-With']
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Add this for form data
app.use(express.static(path.join(__dirname, '../frontend')));

// Log all requests to help with debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - IP: ${req.ip}`);
  
  // Add custom header to identify API responses
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-API-Response', 'true');
  }
  
  // Modify the json method for API routes to ensure proper content type
  if (req.path.startsWith('/api/')) {
    const originalJson = res.json;
    res.json = function(obj) {
      res.setHeader('Content-Type', 'application/json');
      return originalJson.call(this, obj);
    };
  }
  
  next();
});

// Serve static files - ensure all routes work
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index-landing.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/track', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Also serve the files directly by name
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/login.html'));
});

app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/register.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dashboard.html'));
});

app.get('/debug.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/debug.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Add simple health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    // Try to ping MongoDB
    const dbStatus = mongoose.connection.readyState;
    
    // readyState values: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const status = {
      status: dbStatus === 1 ? 'ok' : 'degraded',
      mongodb: {
        status: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbStatus],
        readyState: dbStatus
      },
      server: 'running',
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    };
    
    res.status(dbStatus === 1 ? 200 : 207).json(status);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      mongodb: {
        status: 'error',
        error: error.message
      },
      server: 'running'
    });
  }
});

// Add a health check endpoint to verify MongoDB connection
app.get('/api/health', async (req, res) => {
  try {
    // Try to ping MongoDB
    const dbStatus = mongoose.connection.readyState;
    
    // readyState values: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    const status = {
      status: dbStatus === 1 ? 'ok' : 'degraded',
      mongodb: {
        status: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbStatus],
        readyState: dbStatus
      },
      server: 'running'
    };
    
    res.status(dbStatus === 1 ? 200 : 207).json(status);
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      status: 'error',
      mongodb: {
        status: 'error',
        error: error.message
      },
      server: 'running'
    });
  }
});

// After the existing app.get('/api/health') endpoint, add a more detailed endpoint
app.get('/api/dev/config', (req, res) => {
  // Only available in development mode
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is not available in production' });
  }
  
  // Return a sanitized version of environment configuration
  res.json({
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    mongoConnected: mongoose.connection.readyState === 1,
    mongoReadyState: mongoose.connection.readyState,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    features: {
      localUserStorage: true,
      otpVerification: true,
      jwtAuth: true,
      passwordReset: true
    }
  });
});

// Add this at the beginning of the file, after requiring modules
// Set NODE_ENV to development by default
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// Log startup with clear environment information
console.log(`Starting server in ${process.env.NODE_ENV} mode`);
if (process.env.NODE_ENV === 'development') {
  console.log('Developer features enabled:');
  console.log('- OTP debugging endpoints');
  console.log('- Fixed OTP code: 123456');
  console.log('- Local storage fallback');
}

// Before the app.listen call, add this database connection logic
// Connect to MongoDB with better error handling and reconnection logic
let mongoConnected = false;
let mongoConnectionAttempts = 0;
const MAX_MONGO_RECONNECT_ATTEMPTS = 3;

// Start the server with better port conflict handling
const startServer = (port) => {
  // Use native HTTP module instead of Express's app.listen
  const http = require('http');
  
  // Create a robust HTTP server
  const server = http.createServer((req, res) => {
    // Add error listeners for the request and response objects
    req.on('error', (err) => {
      console.log(`Request error handled: ${err.code} (${err.syscall})`);
      try {
        if (!res.headersSent) {
          res.writeHead(400);
          res.end('Bad Request');
        }
      } catch (e) {
        console.error('Error sending error response:', e);
      }
    });
    
    res.on('error', (err) => {
      console.log(`Response error handled: ${err.code} (${err.syscall})`);
    });
    
    // Forward the request to Express app
    try {
      app(req, res);
    } catch (err) {
      console.error('Express app error:', err);
      try {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end('Internal Server Error');
        }
      } catch (e) {
        console.error('Error sending error response:', e);
      }
    }
  });
  
  // Set up more robust error handling
  server.timeout = 120000; // 2 minute timeout
  
  // Handle server-level errors
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy. Trying next port...`);
      setTimeout(() => startServer(port + 1), 1000);
    } else {
      console.error('Server error:', err);
    }
  });
  
  // Handle client connection errors
  server.on('clientError', (err, socket) => {
    if (err.code === 'UNKNOWN' && err.syscall === 'read') {
      console.log(`Client connection read error handled gracefully: ${err.code}`);
    } else {
      console.log(`Client error handled: ${err.code} (${err.syscall})`);
    }
    
    try {
      if (!socket.destroyed) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      }
    } catch (e) {
      console.error('Error closing client socket:', e);
    }
  });
  
  // Set up connection monitoring to catch problematic sockets
  server.on('connection', (socket) => {
    // Set socket timeout
    socket.setTimeout(60000); // 1 minute timeout
    
    // Handle socket errors
    socket.on('error', (err) => {
      console.log(`Socket error handled: ${err.code} (${err.syscall})`);
      try {
        if (!socket.destroyed) {
          socket.destroy();
        }
      } catch (e) {
        console.error('Error destroying socket:', e);
      }
    });
    
    // Handle socket timeout
    socket.on('timeout', () => {
      console.log('Socket timeout - closing connection');
      try {
        if (!socket.destroyed) {
          socket.end();
        }
      } catch (e) {
        console.error('Error closing timed-out socket:', e);
      }
    });
  });
  
  // Start listening on the port
  server.listen(port, () => {
    console.log(`Server running successfully on port ${port}`);
    console.log(`Server URLs:`);
    console.log(`- Local: http://localhost:${port}`);
    console.log(`- Debug: http://localhost:${port}/debug.html`);
    
    // Update frontend URLs if needed
    if (port != process.env.PORT) {
      console.log(`NOTE: Remember to update your frontend to use port ${port} instead of ${process.env.PORT}`);
    }
  });
};

function connectToMongoDB() {
  if (mongoConnected) return;
  
  // Don't try to reconnect more than MAX_MONGO_RECONNECT_ATTEMPTS times if in development mode
  if (process.env.NODE_ENV === 'development' && mongoConnectionAttempts >= MAX_MONGO_RECONNECT_ATTEMPTS) {
    console.log(`Reached maximum reconnection attempts (${MAX_MONGO_RECONNECT_ATTEMPTS}). Continuing without MongoDB.`);
    startServer(parseInt(process.env.PORT || 7890));
    return;
  }
  
  mongoConnectionAttempts++;
  
  const MONGO_URI = database.MONGODB_URI || 'mongodb://localhost:27017/live-location-tracker';
  const MONGO_OPTIONS = database.mongoOptions || {};
  
  console.log(`Attempting to connect to MongoDB at ${MONGO_URI}`);
  
  try {
    mongoose.connect(MONGO_URI, MONGO_OPTIONS)
      .then(() => {
        console.log('Connected to MongoDB successfully');
        mongoConnected = true;
        
        // Start the server after MongoDB connection is established
        if (mongoConnectionAttempts === 1) {
          startServer(parseInt(process.env.PORT || 7890));
        }
      })
      .catch(err => {
        console.error('Failed to connect to MongoDB:', err.message);
        mongoConnected = false;
        
        // In development mode, just log the error and continue
        if (process.env.NODE_ENV === 'development') {
          console.log('Running in development mode without MongoDB. Using local storage fallback.');
          
          // Start the server if we've tried enough times
          if (mongoConnectionAttempts >= MAX_MONGO_RECONNECT_ATTEMPTS) {
            startServer(parseInt(process.env.PORT || 7890));
          } else {
            console.log('Will retry MongoDB connection in 5 seconds...');
            setTimeout(connectToMongoDB, 5000);
          }
        } else {
          // In production, retry connection after delay
          console.log('Will retry connection in 5 seconds...');
          setTimeout(connectToMongoDB, 5000);
        }
      });
  } catch (error) {
    console.error('Error attempting to connect to MongoDB:', error.message);
    console.log('Running without MongoDB. Using local storage fallback.');
    mongoConnected = false;
    
    // Start server even if we can't connect to MongoDB in development mode
    if (process.env.NODE_ENV === 'development' && mongoConnectionAttempts >= MAX_MONGO_RECONNECT_ATTEMPTS) {
      startServer(parseInt(process.env.PORT || 7890));
    } else if (process.env.NODE_ENV === 'development') {
      setTimeout(connectToMongoDB, 5000);
    }
  }
}

// Handle MongoDB connection events only if they haven't been set up already
if (!mongoose.connection.eventNames().includes('error')) {
  mongoose.connection.on('error', err => {
    console.error('MongoDB connection error:', err);
    mongoConnected = false;
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB disconnected');
    mongoConnected = false;
    
    // Try to reconnect unless shutting down
    if (!app.get('shutting_down')) {
      setTimeout(connectToMongoDB, 5000);
    }
  });
}

// Handle process termination
process.on('SIGINT', () => {
  app.set('shutting_down', true);
  if (mongoose.connection.readyState !== 0) {
    mongoose.connection.close(() => {
      console.log('MongoDB connection closed through app termination');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Call the connect function to start the application
connectToMongoDB();

// Use the auth router for all '/api/auth' routes
app.use('/api/auth', auth.router);

// User registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    console.log('Registration request received:', req.body);
    // Extract user data from request
    const { name, email, phone, password, useLocalStorage } = req.body;
    
    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: {
          name: name ? null : 'Name is required',
          email: email ? null : 'Email is required',
          password: password ? null : 'Password is required'
        }
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Check MongoDB connection status
    const isMongoConnected = mongoose.connection.readyState === 1;
    console.log('MongoDB connection status:', isMongoConnected ? 'Connected' : 'Disconnected');
    
    // Use local storage if requested or if MongoDB is not available
    const useLocal = useLocalStorage || !isMongoConnected;
    
    if (useLocal) {
      console.log('Using local storage for registration');
      
      // Check if user already exists
      const existingUser = findLocalUser(email, phone);
      if (existingUser) {
        return res.status(400).json({ 
          error: 'User already exists with this email or phone number' 
        });
      }
      
      // Generate a salt and hash the password
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
      
      // Create new user
      const userId = crypto.randomBytes(16).toString('hex');
      const newUser = {
        id: userId,
        name,
        email: email.toLowerCase(),
        phone: phone || null,
        password: `${salt}:${hash}`,
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString()
      };
      
      // Save user to local storage
      const users = getLocalUsers();
      users.push(newUser);
      saveLocalUsers(users);
      
      // Generate JWT token
      const token = jwt.sign(
        { id: userId, email: newUser.email },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Return success response
      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: userId,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone
        },
        mode: 'local'
      });
    }
    
    // Use MongoDB
    console.log('Using MongoDB for registration');
    try {
      // Check if user already exists
      const existingUser = await User.findOne({ 
        $or: [
          { email: email.toLowerCase() },
          ...(phone ? [{ phone }] : [])
        ]
      });
      
      if (existingUser) {
        const reason = existingUser.email === email.toLowerCase() 
          ? 'email' 
          : 'phone number';
        
        return res.status(400).json({ 
          error: `User already exists with this ${reason}` 
        });
      }
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Create new user
      const user = new User({
        name,
        email: email.toLowerCase(),
        password: hashedPassword,
        phone: phone || undefined
      });
      
      // Save user to database
      await user.save();
      
      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Return success response
      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone
        },
        mode: 'database'
      });
    } catch (dbError) {
      console.error('Database registration error:', dbError);
      
      // If MongoDB operation fails, offer local storage fallback
      if (!useLocalStorage) {
        return res.status(500).json({
          error: 'Failed to register user in database',
          fallbackAvailable: true,
          details: dbError.message
        });
      }
      
      throw dbError; // Re-throw for general error handling
    }
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: 'Failed to register user',
      details: error.message
    });
  }
});

// Password-based login
app.post('/api/login', async (req, res) => {
  try {
    const { email, emailOrPhone, password } = req.body;
    
    // Enhanced logging for debugging
    console.log(`Login attempt with email/phone: ${email || emailOrPhone}`);
    
    // Support both email and emailOrPhone fields
    const userEmail = email || emailOrPhone;
    
    // Validate input
    if (!userEmail) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    // Check if MongoDB is available
    const useLocalFallback = mongoose.connection.readyState !== 1;
    
    if (useLocalFallback) {
      console.log('Using local login because MongoDB is unavailable');
      
      // Find user in local storage
      const localUser = findLocalUser(userEmail, null);
      if (!localUser) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      // Verify password - handle both bcrypt and crypto hashes
      let passwordValid = false;
      
      if (localUser.password.includes(':')) {
        // Crypto hash format (salt:hash)
        const [salt, storedHash] = localUser.password.split(':');
        const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
        passwordValid = storedHash === hash;
      } else {
        // Bcrypt hash
        try {
          passwordValid = await bcrypt.compare(password, localUser.password);
        } catch (err) {
          console.error('Password comparison error:', err);
          passwordValid = false;
        }
      }
      
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      // Generate JWT token
      const token = jwt.sign(
        { id: localUser.id, email: localUser.email },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Update last login time
      localUser.last_login = new Date().toISOString();
      const users = getLocalUsers();
      const userIndex = users.findIndex(u => u.id === localUser.id);
      if (userIndex !== -1) {
        users[userIndex] = localUser;
        saveLocalUsers(users);
      }
      
      return res.json({
        success: true,
        token, 
        user: {
          id: localUser.id,
          name: localUser.name,
          email: localUser.email,
          phone: localUser.phone
        },
        mode: 'local'
      });
    }
    
    // MongoDB is available, use database login
    try {
      // Find user in database
      const user = await User.findOne({ 
        $or: [
          { email: userEmail.toLowerCase() },
          { phone: userEmail }
        ]
      });
      
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      // Verify password
      const passwordValid = await bcrypt.compare(password, user.password);
      
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      
      // Update last login time
      user.lastLogin = new Date();
      await user.save();
      
      return res.json({
        success: true,
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone
        },
        mode: 'database'
      });
    } catch (dbError) {
      console.error('Database login error:', dbError);
      
      // If MongoDB operation fails but local users exist, try local login
      const localUser = findLocalUser(userEmail, null);
      if (localUser) {
        console.log('Falling back to local login after database error');
        
        // Verify password
        let passwordValid = false;
        
        if (localUser.password.includes(':')) {
          // Crypto hash format (salt:hash)
          const [salt, storedHash] = localUser.password.split(':');
          const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
          passwordValid = storedHash === hash;
        } else {
          // Bcrypt hash
          try {
            passwordValid = await bcrypt.compare(password, localUser.password);
          } catch (err) {
            console.error('Password comparison error:', err);
            passwordValid = false;
          }
        }
        
        if (!passwordValid) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        
        // Generate JWT token
        const token = jwt.sign(
          { id: localUser.id, email: localUser.email },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        
        return res.json({
          success: true,
          token,
          user: {
            id: localUser.id,
            name: localUser.name,
            email: localUser.email,
            phone: localUser.phone
          },
          mode: 'local_fallback'
        });
      }
      
      return res.status(500).json({ 
        error: 'Server error during login', 
        details: dbError.message 
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Failed to process login request',
      details: error.message
    });
  }
});

// Legacy OTP routes (keep for backward compatibility)
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, email } = req.body;
    
    if (!phone || !email) {
      return res.status(400).json({ error: 'Phone number and email are required' });
    }
    
    // Validate phone number and email (basic validation)
    const phoneRegex = /^\+?[0-9]{10,15}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }
    
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });
    let isNewUser = false;
    
    if (!user) {
      // Create new user
      user = new User({
        email: email.toLowerCase(),
        phone: phone.replace(/\D/g, ''),
        name: email.split('@')[0] // Default name from email
      });
      
      await user.save();
      isNewUser = true;
    }
    
    // Generate OTP
    const otp = auth.generateOTP();
    auth.storeOTP(phone, otp);
    
    // In a real app, send OTP via SMS
    console.log(`OTP for ${phone}: ${otp}`);
    
    res.status(200).json({ 
      success: true, 
      message: 'OTP sent successfully', 
      userId: user._id,
      isNewUser
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Server error' });
  }
});

// Verify OTP
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { userId, otp, phone } = req.body;
    
    if (!userId || !otp || !phone) {
      return res.status(400).json({ error: 'User ID, phone, and OTP are required' });
    }
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Verify OTP
    const verification = auth.verifyOTP(phone, otp);
    
    if (!verification.valid) {
      return res.status(401).json({ error: verification.message });
    }
    
    // Generate token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.status(200).json({ 
      success: true, 
      message: 'OTP verified successfully', 
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone
      }
    });
  } catch (error) {
    console.error('Verification error:', error);
    res.status(401).json({ error: error.message || 'Invalid or expired OTP' });
  }
});

// Handle location endpoints
app.post('/api/location', auth.verifyToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }
    
    // Create new location record
    const location = new Location({
      user_id: req.userId,
      latitude,
      longitude
    });
    
    await location.save();
    
    res.status(201).json({ 
      success: true, 
      message: 'Location saved successfully',
      location: {
        id: location._id,
        latitude,
        longitude,
        timestamp: location.timestamp
      }
    });
  } catch (error) {
    console.error('Error saving location:', error);
    res.status(500).json({ error: error.message || 'Error saving location' });
  }
});

// Batch location update endpoint for improved efficiency
app.post('/api/location/batch', auth.verifyToken, async (req, res) => {
  try {
    // Validate request
    if (!req.body.locations || !Array.isArray(req.body.locations) || req.body.locations.length === 0) {
      return res.status(400).json({ error: 'Invalid request: locations array is required' });
    }

    // Limit batch size to prevent abuse
    if (req.body.locations.length > 100) {
      return res.status(400).json({ error: 'Batch size too large. Maximum 100 locations per request.' });
    }

    const userId = req.userId;
    const locations = req.body.locations;
    const validationErrors = [];
    const validLocations = [];

    // Validate all locations
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i];
      
      // Basic validation
      if (!location.latitude || !location.longitude) {
        validationErrors.push({ index: i, error: 'Missing latitude or longitude' });
        continue;
      }
      
      // Validate coordinates
      if (location.latitude < -90 || location.latitude > 90 || 
          location.longitude < -180 || location.longitude > 180) {
        validationErrors.push({ index: i, error: 'Invalid coordinates' });
        continue;
      }

      // Prepare valid location for database
      validLocations.push({
        user_id: userId,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy || 0,
        timestamp: location.timestamp || new Date().toISOString()
      });
    }

    // If no valid locations, return error
    if (validLocations.length === 0) {
      return res.status(400).json({ 
        error: 'No valid locations in batch', 
        details: validationErrors 
      });
    }

    // Use bulk insert for better performance
    const result = await Location.insertMany(validLocations, { ordered: false });
    
    // Return success with stats
    res.status(201).json({
      success: true,
      saved: result.length,
      total: locations.length,
      errors: validationErrors.length,
      error_details: validationErrors.length > 0 ? validationErrors : undefined
    });
    
    // Log activity
    console.log(`Batch saved ${result.length}/${locations.length} locations for user ${userId}`);
  } catch (error) {
    console.error('Error saving batch locations:', error);
    res.status(500).json({ error: 'Failed to save batch locations' });
  }
});

// Add this after the batch endpoint - a helper route to sync offline data
app.post('/api/location/sync', auth.verifyToken, async (req, res) => {
  try {
    // Validate request
    if (!req.body.locations || !Array.isArray(req.body.locations)) {
      return res.status(400).json({ error: 'Invalid request: locations array is required' });
    }

    const userId = req.userId;
    const locations = req.body.locations;
    
    // Skip empty arrays
    if (locations.length === 0) {
      return res.status(200).json({ success: true, saved: 0 });
    }

    // Process in chunks for better performance with large datasets
    const CHUNK_SIZE = 50;
    let saved = 0;
    let failed = 0;
    
    // Process in chunks
    for (let i = 0; i < locations.length; i += CHUNK_SIZE) {
      const chunk = locations.slice(i, i + CHUNK_SIZE);
      const validLocations = chunk
        .filter(loc => loc.latitude && loc.longitude)
        .map(loc => ({
          user_id: userId,
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy || 0,
          timestamp: loc.timestamp || new Date().toISOString()
        }));
      
      if (validLocations.length > 0) {
        try {
          const result = await Location.insertMany(validLocations, { ordered: false });
          saved += result.length;
        } catch (err) {
          console.error('Error in chunk insert:', err);
          failed += chunk.length;
        }
      } else {
        failed += chunk.length;
      }
    }

    // Return success with stats
    res.status(200).json({
      success: true,
      saved,
      failed,
      total: locations.length
    });
    
    console.log(`Synced ${saved}/${locations.length} offline locations for user ${userId}`);
  } catch (error) {
    console.error('Error syncing offline locations:', error);
    res.status(500).json({ error: 'Failed to sync offline locations' });
  }
});

// Get user's location history
app.get('/api/locations', auth.verifyToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    // Get location history for user
    const locations = await Location.find({ user_id: req.userId })
      .sort({ timestamp: -1 })
      .limit(limit);
    
    res.json({ locations });
  } catch (error) {
    console.error('Error fetching location history:', error);
    res.status(500).json({ error: error.message || 'Error fetching location history' });
  }
});

// Password Reset Routes
app.post('/api/request-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Please provide your mobile number' });
    }
    
    const result = await auth.requestOTP(phone);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ message: result.message });
  } catch (error) {
    console.error('OTP request error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// Add a robust sendSMS function after the const definitions
function sendSMS(phone, message) {
  const normalizedPhone = phone.replace(/\D/g, '');
  console.log(`[SMS GATEWAY] Sending SMS to ${normalizedPhone}: ${message}`);
  
  // Store OTP for debugging
  if (message.includes('verification code') || message.includes('OTP')) {
    // Extract the OTP code (assuming it's 6 digits)
    const otpMatch = message.match(/\b(\d{6})\b/);
    const otp = otpMatch ? otpMatch[1] : 'unknown';
    
    // Store in global variable for the debugging endpoint
    global.recentOTPs[normalizedPhone] = {
      otp: otp,
      timestamp: Date.now(),
      expires: Date.now() + (5 * 60 * 1000) // 5 minutes
    };
    
    // In development, write to a file for easy access
    if (process.env.NODE_ENV !== 'production') {
      const logDir = path.join(__dirname, 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      
      const logFile = path.join(logDir, 'sms_log.txt');
      const logEntry = `[${new Date().toISOString()}] To: ${normalizedPhone}, Message: ${message}\n`;
      
      try {
        fs.appendFileSync(logFile, logEntry);
      } catch (error) {
        console.error('Failed to write to SMS log file:', error);
      }
    }
  }
  
  // In development mode, always return success
  if (process.env.NODE_ENV !== 'production') {
    return { success: true, message: 'SMS sent successfully (development mode)' };
  }
  
  // In production, you would implement actual SMS gateway here
  // Example: return twilioClient.messages.create({...})
  
  // For now, return mock success
  return { success: true, message: 'SMS sent successfully' };
}

// Update the forgot-password endpoint to use the new sendSMS function
app.post('/api/forgot-password', async (req, res) => {
  try {
    const { email, phone } = req.body;
    
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone number is required' });
    }
    
    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }
    
    // Validate phone format if provided
    let normalizedPhone = null;
    if (phone) {
      normalizedPhone = phone.replace(/\D/g, '');
      if (normalizedPhone.length < 10) {
        return res.status(400).json({ error: 'Invalid phone number format. Please enter at least 10 digits.' });
      }
    }
    
    // Check if MongoDB is available
    const isMongoConnected = mongoose.connection.readyState === 1;
    const useLocal = !isMongoConnected;
    
    // Generate OTP - always generate the same OTP if in development
    const otp = process.env.NODE_ENV !== 'production' 
      ? '123456'  // Fixed OTP for testing
      : Math.floor(100000 + Math.random() * 900000).toString(); // Random 6-digit OTP
    
    const otpExpires = Date.now() + 300000; // 5 minutes
    
    // Send OTP via SMS
    const smsMessage = `Your verification code is: ${otp}. Valid for 5 minutes.`;
    const smsResult = sendSMS(normalizedPhone || phone || '0000000000', smsMessage);
    
    if (!smsResult.success && process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Failed to send SMS. Please try again later.' });
    }
    
    console.log(`OTP for ${normalizedPhone || phone || 'test'}: ${otp} (${smsResult.success ? 'SMS sent' : 'SMS failed'})`);
    
    // Always return success in development mode
    if (process.env.NODE_ENV !== 'production') {
      return res.json({
        success: true,
        message: 'Verification code sent to your phone',
        otp: otp,
        phone: normalizedPhone || phone || '0000000000'
      });
    }
    
    // Continue with normal flow (finding/updating user, etc.)
    // ... existing code ...
    
    if (useLocal) {
      // ... existing local storage code ...
    } else {
      // ... existing MongoDB code ...
    }
    
    // Always return success, with OTP only in development mode
    return res.json({ 
      success: true, 
      message: 'Verification code sent to your phone',
      ...(process.env.NODE_ENV !== 'production' ? { 
        otp, 
        phone: normalizedPhone || phone || '0000000000' 
      } : {})
    });
  } catch (error) {
    console.error('Password reset error:', error);
    
    // Development fallback
    if (process.env.NODE_ENV !== 'production') {
      const testOtp = '123456';
      return res.json({
        success: true,
        message: 'Emergency fallback: Verification code generated',
        otp: testOtp,
        phone: phone || '0000000000'
      });
    }
    
    res.status(500).json({ 
      error: 'Failed to process password reset request',
      details: error.message
    });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, phone, otp, newPassword } = req.body;
    
    if ((!email && !phone) || !otp || !newPassword) {
      return res.status(400).json({ error: 'Please provide email or phone, OTP and new password' });
    }
    
    // Validate the new password
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Normalize phone if provided
    let normalizedPhone = null;
    if (phone) {
      normalizedPhone = phone.replace(/\D/g, '');
    }
    
    // Check if MongoDB is available
    const isMongoConnected = mongoose.connection.readyState === 1;
    const useLocal = !isMongoConnected;
    
    if (useLocal) {
      // Handle local storage reset
      const users = getLocalUsers();
      const userQuery = {};
      if (email) userQuery.email = email;
      if (normalizedPhone) userQuery.phone = normalizedPhone;
      
      const localUser = findLocalUser(email, normalizedPhone);
      
      if (!localUser) {
        return res.status(400).json({ error: 'User not found' });
      }
      
      // Verify OTP
      if (!localUser.resetOtp || localUser.resetOtp !== otp) {
        return res.status(400).json({ error: 'Invalid OTP' });
      }
      
      // Check if OTP is expired
      if (!localUser.resetOtpExpires || localUser.resetOtpExpires < Date.now()) {
        return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      }
      
      // Update password
      const userIndex = users.findIndex(u => u.id === localUser.id);
      if (userIndex !== -1) {
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        users[userIndex].password = hashedPassword;
        users[userIndex].resetOtp = null;
        users[userIndex].resetOtpExpires = null;
        saveLocalUsers(users);
        
        return res.json({ success: true, message: 'Password reset successful' });
      } else {
        return res.status(500).json({ error: 'Failed to update user data' });
      }
    }
    
    // MongoDB is available
    try {
      // Find user by email or phone
      const query = {};
      if (email) query.email = email.toLowerCase();
      if (normalizedPhone) query.phone = normalizedPhone;
      
      const user = await User.findOne(query);
      
      if (!user) {
        return res.status(400).json({ error: 'User not found' });
      }
      
      // Verify OTP
      if (!user.resetOtp || user.resetOtp !== otp) {
        return res.status(400).json({ error: 'Invalid OTP' });
      }
      
      // Check if OTP is expired
      if (!user.resetOtpExpires || user.resetOtpExpires < Date.now()) {
        return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
      }
      
      // Update password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      
      user.password = hashedPassword;
      user.resetOtp = null;
      user.resetOtpExpires = null;
      await user.save();
      
      return res.json({ success: true, message: 'Password reset successful' });
    } catch (dbError) {
      console.error('Database error during password reset:', dbError);
      return res.status(500).json({ error: 'Failed to reset password', details: dbError.message });
    }
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Add debugging endpoint for OTP status (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/dev/recent-otps', (req, res) => {
    const recentOTPs = global.recentOTPs || {};
    
    // Format the data for display
    const formattedData = {};
    Object.keys(recentOTPs).forEach(phone => {
      const { otp, timestamp, expires } = recentOTPs[phone];
      const now = Date.now();
      const expiresIn = Math.max(0, Math.floor((expires - now) / 1000)); // seconds
      
      formattedData[phone] = {
        otp,
        received: new Date(timestamp).toLocaleString(),
        expiresIn: `${Math.floor(expiresIn / 60)}:${(expiresIn % 60).toString().padStart(2, '0')}`,
        valid: now < expires
      };
    });
    
    res.json({ 
      message: 'Development only: Recent OTPs sent',
      data: formattedData
    });
  });
  
  // Add a simple HTML page to view recent OTPs
  app.get('/dev/otps', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Recent OTPs (Development Only)</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
          h1 { color: #3f51b5; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
          th { background-color: #f2f2f2; }
          .valid { color: green; }
          .expired { color: red; }
          .refresh { background: #3f51b5; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>Recent OTPs (Development Only)</h1>
        <p>This page displays recently sent OTPs for development purposes.</p>
        <button class="refresh" onclick="refreshData()">Refresh Data</button>
        <div id="otps-container">Loading...</div>
        
        <script>
          function refreshData() {
            fetch('/api/dev/recent-otps')
              .then(response => response.json())
              .then(data => {
                const container = document.getElementById('otps-container');
                const phones = Object.keys(data.data);
                
                if (phones.length === 0) {
                  container.innerHTML = '<p>No recent OTPs found.</p>';
                  return;
                }
                
                let html = '<table><tr><th>Phone Number</th><th>OTP</th><th>Received</th><th>Expires In</th><th>Status</th></tr>';
                
                phones.forEach(phone => {
                  const otpData = data.data[phone];
                  const statusClass = otpData.valid ? 'valid' : 'expired';
                  const statusText = otpData.valid ? 'Valid' : 'Expired';
                  
                  html += '<tr>' +
                    '<td>' + phone + '</td>' +
                    '<td>' + otpData.otp + '</td>' +
                    '<td>' + otpData.received + '</td>' +
                    '<td>' + otpData.expiresIn + '</td>' +
                    '<td class="' + statusClass + '">' + statusText + '</td>' +
                    '</tr>';
                });
                
                html += '</table>';
                container.innerHTML = html;
              })
              .catch(error => {
                document.getElementById('otps-container').innerHTML = '<p>Error loading data: ' + error.message + '</p>';
              });
          }
          
          // Initial load
          refreshData();
          
          // Auto-refresh every 10 seconds
          setInterval(refreshData, 10000);
        </script>
      </body>
      </html>
    `);
  });
}

// Add a helper endpoint to view OTPs for a specific phone number
app.get('/api/check-otp/:phone', (req, res) => {
  const { phone } = req.params;
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required' });
  }
  
  // This is for development purposes only
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'This endpoint is disabled in production' });
  }
  
  const normalizedPhone = phone.replace(/\D/g, '');
  const recentOTPs = global.recentOTPs || {};
  const otpData = recentOTPs[normalizedPhone];
  
  if (!otpData) {
    return res.status(404).json({ error: 'No OTPs found for this phone number' });
  }
  
  const now = Date.now();
  const isValid = now < otpData.expires;
  
  res.json({
    phone: normalizedPhone,
    otp: otpData.otp,
    valid: isValid,
    expiresIn: Math.max(0, Math.floor((otpData.expires - now) / 1000)) // seconds
  });
});

// Remove the duplicate logout endpoint and use this one instead
app.post('/api/logout', (req, res) => {
  // In a real application with sessions, you'd invalidate the session here
  // Since we're using JWT tokens, the client simply removes the token
  
  // Log the logout
  console.log(`User logout at ${new Date().toISOString()}`);
  
  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

// Add robust emergency middleware to catch all errors
app.use((req, res, next) => {
  // Add a timeout to ensure the response is sent even if next() never calls a handler
  const timeoutId = setTimeout(() => {
    console.error(`Request timeout: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Request timed out' });
    }
  }, 30000); // 30 second timeout
  
  // Patch the res.end method to clear the timeout
  const originalEnd = res.end;
  res.end = function() {
    clearTimeout(timeoutId);
    return originalEnd.apply(this, arguments);
  };
  
  // Continue with the next middleware
  next();
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error('Express error handler caught:', err);
  
  // Clear any response timeout if it exists
  if (req.timeout) {
    clearTimeout(req.timeout);
  }
  
  // Ensure API routes always return JSON
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      error: 'Server error occurred',
      message: err.message
    });
  }
  
  // For non-API routes, render an error page or redirect
  res.status(500).send('Server error occurred');
});

// Handle 404 - Keep this as the last route
app.use((req, res) => {
  // Clear any response timeout if it exists
  if (req.timeout) {
    clearTimeout(req.timeout);
  }
  
  if (req.path.startsWith('/api/')) {
    // API route not found - ensure JSON response
    res.setHeader('Content-Type', 'application/json');
    res.status(404).json({ error: 'API endpoint not found' });
  } else {
    // Try to serve index.html for any other routes
    res.sendFile(path.join(__dirname, '../frontend/index-landing.html'));
  }
});

// Function to handle critical errors and enable graceful restarts
const handleCriticalError = (err) => {
  console.error('CRITICAL ERROR - Server will exit:', err);
  
  // Close database connection if open
  if (mongoose.connection.readyState !== 0) {
    mongoose.connection.close().catch(e => console.error('Error closing MongoDB connection:', e));
  }
  
  // Set a short timeout to allow any pending operations to complete
  setTimeout(() => {
    console.log('Server shutting down to allow restart...');
    process.exit(1); // Exit with error code so process manager can restart
  }, 1000);
};

// Add additional error handlers for uncaught errors
process.on('uncaughtException', (err) => {
  // Don't crash the server for read errors
  if (err.code === 'UNKNOWN' && err.syscall === 'read') {
    console.log('Handled uncaught read error gracefully');
    return;
  }
  
  // For HTTP/net related errors, just log them
  if (
    (err.code && ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) ||
    (err.syscall && ['connect', 'getaddrinfo', 'read', 'write'].includes(err.syscall))
  ) {
    console.error('Network-related error caught:', err.message);
    return;
  }
  
  console.error('Uncaught exception:', err);
  
  // Only exit for critical errors that aren't network related
  if (!(err.code === 'UNKNOWN' && err.syscall === 'read')) {
    handleCriticalError(err);
  }
});

// Also handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  // Handle rejection reason if it's an Error object
  if (reason instanceof Error) {
    // Don't crash for network/read errors
    if (reason.code === 'UNKNOWN' && reason.syscall === 'read') {
      console.log('Handled unhandled rejection with read error gracefully');
      return;
    }
    
    // For HTTP/net related errors, just log them
    if (
      (reason.code && ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND'].includes(reason.code)) ||
      (reason.syscall && ['connect', 'getaddrinfo', 'read', 'write'].includes(reason.syscall))
    ) {
      console.error('Network-related rejection caught:', reason.message);
      return;
    }
  }
  
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Only exit for critical errors that aren't network related
  if (!(reason && reason.code === 'UNKNOWN' && reason.syscall === 'read')) {
    handleCriticalError(reason);
  }
});
