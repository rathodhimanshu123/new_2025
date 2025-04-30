const { User } = require('./database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const express = require('express');
require('dotenv').config();

// Create express router
const router = express.Router();

// JWT Secret from environment or fallback
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Store OTPs temporarily (in a real app, use Redis or another store)
const otpStore = new Map();

// Verify JWT token
const verifyToken = (req, res, next) => {
  try {
    // Get auth header
    const authHeader = req.headers.authorization;
    
    // Check if auth header exists
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }
    
    // Get token from header
    const token = authHeader.split(' ')[1];
    
    // Verify token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        console.error('Token verification error:', err.message);
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      // Add user ID to request
      req.userId = decoded.id;
      console.log(`Authenticated request from user: ${req.userId}`);
      next();
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Generate a random 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Store OTP with expiry time (5 minutes)
function storeOTP(phone, otp) {
    // Normalize phone number by removing non-digit characters
    const normalizedPhone = phone.replace(/\D/g, '');
    
    otpStore.set(normalizedPhone, {
        otp,
        expires: Date.now() + 5 * 60 * 1000 // 5 minutes in milliseconds
    });
    
    // Set timeout to automatically remove expired OTPs
    setTimeout(() => {
        if (otpStore.has(normalizedPhone)) {
            otpStore.delete(normalizedPhone);
        }
    }, 5 * 60 * 1000);
}

// Verify if OTP is valid and not expired
function verifyOTP(phone, otp) {
    // Normalize phone number
    const normalizedPhone = phone.replace(/\D/g, '');
    const entry = otpStore.get(normalizedPhone);
    
    if (!entry) {
        return { valid: false, message: 'OTP not found or expired' };
    }
    
    if (entry.expires < Date.now()) {
        otpStore.delete(normalizedPhone);
        return { valid: false, message: 'OTP has expired' };
    }
    
    if (entry.otp !== otp) {
        return { valid: false, message: 'Invalid OTP' };
    }
    
    // OTP is valid, remove it so it can't be reused
    otpStore.delete(normalizedPhone);
    return { valid: true };
}

// Send OTP via SMS
async function sendSMS(phone, message) {
    // Log the message for development purposes
    console.log(`[SMS] To: ${phone}, Message: ${message}`);
    
    // In a real application, integrate with SMS service provider like Twilio
    // Uncomment and add your Twilio credentials to use Twilio for SMS
    /*
    try {
        // Example with Twilio
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
        
        if (!accountSid || !authToken || !twilioPhone) {
            console.error('Twilio credentials not set. SMS not sent.');
            return false;
        }
        
        const twilio = require('twilio')(accountSid, authToken);
        const result = await twilio.messages.create({
            body: message,
            from: twilioPhone,
            to: phone
        });
        
        console.log(`Twilio message sent with SID: ${result.sid}`);
        return true;
    } catch (error) {
        console.error('Failed to send SMS via Twilio:', error);
        return false;
    }
    */
    
    // Write the OTP to a file for easy testing in development environments
    if (process.env.NODE_ENV !== 'production') {
        try {
            const fs = require('fs');
            const path = require('path');
            const logsDir = path.join(__dirname, 'logs');
            
            // Create logs directory if it doesn't exist
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            
            // Generate timestamp for the filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = path.join(logsDir, `sms_${phone.replace(/\D/g, '')}_${timestamp}.txt`);
            
            // Write message to file
            fs.writeFileSync(
                filename, 
                `Time: ${new Date().toISOString()}\nTo: ${phone}\nMessage: ${message}\n`
            );
            
            console.log(`SMS log written to ${filename}`);
        } catch (fileError) {
            console.error('Failed to write SMS log to file:', fileError);
        }
    }
    
    // Create a cache of recent OTPs for development
    if (!global.recentOTPs) {
        global.recentOTPs = {};
    }
    
    // Extract the OTP from the message using regex
    const otpMatch = message.match(/code is: (\d+)/i) || message.match(/OTP[^\d]+(\d+)/i);
    if (otpMatch && otpMatch[1]) {
        const otp = otpMatch[1];
        const normalizedPhone = phone.replace(/\D/g, '');
        
        // Store in memory cache with expiration
        global.recentOTPs[normalizedPhone] = {
            otp,
            timestamp: Date.now(),
            expires: Date.now() + (5 * 60 * 1000) // 5 minutes expiration
        };
        
        // Keep the cache clean by removing expired entries
        Object.keys(global.recentOTPs).forEach(key => {
            if (global.recentOTPs[key].expires < Date.now()) {
                delete global.recentOTPs[key];
            }
        });
        
        console.log(`OTP stored in memory cache for phone ${normalizedPhone}`);
    }
    
    // Simulate success response
    return true;
}

// Request OTP for mobile number verification or password reset
async function requestOTP(phone) {
    try {
        // Normalize phone number
        const normalizedPhone = phone.replace(/\D/g, '');
        
        // Basic validation
        if (normalizedPhone.length < 10) {
            return { success: false, error: 'Invalid mobile number format' };
        }
        
        // Check if user exists with this phone number
        const user = await User.findOne({ phone: normalizedPhone });
        
        if (!user) {
            return { success: false, error: 'User with this mobile number does not exist' };
        }
        
        // Generate and store OTP
        const otp = generateOTP();
        storeOTP(normalizedPhone, otp);
        
        // In a real app, send the OTP via SMS
        const message = `Your OTP for password reset is: ${otp}. Valid for 5 minutes.`;
        await sendSMS(normalizedPhone, message);
        
        return { success: true, message: 'OTP sent to your mobile number' };
    } catch (error) {
        console.error('Error in requestOTP:', error);
        return { success: false, error: 'Failed to generate OTP' };
    }
}

// Reset password using OTP
async function resetPassword(phone, otp, newPassword) {
    try {
        // Normalize phone number
        const normalizedPhone = phone.replace(/\D/g, '');
        
        // Verify OTP
        const verification = verifyOTP(normalizedPhone, otp);
        
        if (!verification.valid) {
            return { success: false, error: verification.message };
        }
        
        // Find user by phone number
        const user = await User.findOne({ phone: normalizedPhone });
        
        if (!user) {
            return { success: false, error: 'User with this mobile number does not exist' };
        }
        
        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        
        // Update user's password
        user.password = hashedPassword;
        await user.save();
        
        return { success: true, message: 'Password reset successful' };
    } catch (error) {
        console.error('Error in resetPassword:', error);
        return { success: false, error: 'Failed to reset password' };
    }
}

// Register or login with email and password
async function registerOrLoginUser(email, name, password, phone) {
    try {
        console.log(`Login attempt with email: ${email}`);
        
        if (!email) {
            console.error('Login failed: Email is required');
            return { success: false, error: 'Email is required' };
        }
        
        if (!password) {
            console.error('Login failed: Password is required');
            return { success: false, error: 'Password is required' };
        }
        
        // Check if user exists by email
        let user = await User.findOne({ email: email.toLowerCase() });
        let isNewUser = false;
        
        console.log(`User lookup result: ${user ? 'User found' : 'User not found'} for email: ${email}`);
        
        if (!user) {
            // If user doesn't exist by email, check by phone (if provided)
            if (phone) {
                const normalizedPhone = phone.replace(/\D/g, '');
                user = await User.findOne({ phone: normalizedPhone });
                console.log(`Phone lookup result: ${user ? 'User found' : 'User not found'} for phone: ${normalizedPhone.substring(0, 3)}...`);
            }
            
            // If still no user, create a new one
            if (!user) {
                // Only create new user if name is provided (for registration)
                if (!name) {
                    console.error('Login failed: User not found');
                    return { success: false, error: 'Invalid email or password' };
                }
                
                isNewUser = true;
                console.log(`Creating new user with email: ${email}`);
                
                // Hash the password for new users
                const salt = await bcrypt.genSalt(10);
                const hashedPassword = await bcrypt.hash(password, salt);
                
                const userData = {
                    email: email.toLowerCase(),
                    name,
                    password: hashedPassword
                };
                
                // Add phone if provided
                if (phone) {
                    userData.phone = phone.replace(/\D/g, '');
                }
                
                try {
                    user = new User(userData);
                    await user.save();
                    console.log(`New user created with ID: ${user._id}`);
                } catch (saveError) {
                    console.error('Error saving new user:', saveError);
                    if (saveError.code === 11000) {
                        // Duplicate key error
                        return { success: false, error: 'User with this email already exists' };
                    }
                    throw saveError; // Rethrow for general error handling
                }
            } else {
                // User found by phone but not email
                console.log('Validating password for user found by phone');
                const validPassword = await bcrypt.compare(password, user.password);
                if (!validPassword) {
                    console.error('Login failed: Invalid password for user found by phone');
                    return { success: false, error: 'Invalid password' };
                }
            }
        } else {
            // User found by email
            if (!user.password) {
                console.error('Login failed: User has no password set');
                return { success: false, error: 'Please use OTP login for this account' };
            }
            
            console.log('Validating password for user found by email');
            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                console.error('Login failed: Invalid password for user found by email');
                return { success: false, error: 'Invalid email or password' };
            }
            
            // Update phone if provided and not already set
            if (phone && !user.phone) {
                user.phone = phone.replace(/\D/g, '');
                await user.save();
                console.log(`Updated phone number for user: ${user._id}`);
            }
        }
        
        // Create and return JWT token
        const token = jwt.sign(
            { id: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );
        
        console.log(`Login successful for user: ${user._id}`);
        
        return {
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                phone: user.phone
            },
            isNewUser
        };
    } catch (error) {
        console.error('Error in registerOrLoginUser:', error);
        return { success: false, error: 'Failed to register or login. Please try again later.' };
    }
}

// Logout endpoint
router.post('/logout', (req, res) => {
  // In a real application with sessions, you'd invalidate the session
  // Since we're using JWT tokens, the client simply removes the token

  // Log the logout
  console.log(`User logged out at ${new Date().toISOString()}`);
  
  // Return success
  res.status(200).json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = {
  verifyToken,
  generateOTP,
  storeOTP,
  verifyOTP,
  requestOTP,
  resetPassword,
  registerOrLoginUser,
  sendSMS,
  router // Export the router
};
