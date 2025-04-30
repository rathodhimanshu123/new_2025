const mongoose = require('mongoose');
require('dotenv').config();

// Enhanced MongoDB options for better performance and reliability
const mongoOptions = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4,
    maxPoolSize: 20,
    minPoolSize: 5,
    retryWrites: true,
    useNewUrlParser: true,
    useUnifiedTopology: true
};

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/location-tracker';

// Enable debugging only in development
if (process.env.NODE_ENV !== 'production') {
    mongoose.set('debug', { color: true, shell: true });
}

// User Schema with optimized indexing
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        minlength: [2, 'Name must be at least 2 characters long'],
        maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        index: true, // Add index for faster lookups
        validate: {
            validator: function(v) {
                return /^([\w-\.]+@([\w-]+\.)+[\w-]{2,4})?$/.test(v);
            },
            message: props => `${props.value} is not a valid email address!`
        }
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        unique: true,
        index: true, // Add index for faster lookups
        validate: {
            validator: function(v) {
                return /^\d{10,15}$/.test(v);
            },
            message: props => `${props.value} is not a valid phone number! It must be 10-15 digits.`
        }
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters long']
    },
    created_at: {
        type: Date,
        default: Date.now,
        index: true // Add index for sorting by creation date
    },
    last_login: {
        type: Date
    }
}, {
    // Add timestamps for automatic created_at and updated_at fields
    timestamps: true,
    // Optimize document size by excluding unnecessary fields from queries
    toJSON: { 
        transform: (doc, ret) => {
            delete ret.password; // Never return passwords
            delete ret.__v;
            return ret;
        }
    }
});

// Location Schema with optimized indexing and storage
const locationSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    // Use array for more compact storage of coordinates
    loc: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    accuracy: {
        type: Number,
        default: 0
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    // Optimize document size
    versionKey: false
});

// Create a 2dsphere index for geospatial queries
locationSchema.index({ loc: '2dsphere' });

// Create a compound index for faster user location history queries
locationSchema.index({ user_id: 1, timestamp: -1 });

// Virtual getters for latitude/longitude for compatibility
locationSchema.virtual('latitude').get(function() {
    return this.loc.coordinates[1];
});

locationSchema.virtual('longitude').get(function() {
    return this.loc.coordinates[0];
});

// Set schemas to transform coordinates automatically
locationSchema.pre('save', function(next) {
    // Ensure loc is properly formatted when saving
    if (this.latitude !== undefined && this.longitude !== undefined && !this.loc.coordinates) {
        this.loc = {
            type: 'Point',
            coordinates: [this.longitude, this.latitude]
        };
    }
    next();
});

// Pre-save hook to ensure required fields and normalize data
userSchema.pre('save', function(next) {
    // Normalize phone number by removing non-digit characters
    if (this.phone) {
        this.phone = this.phone.replace(/\D/g, '');
    }
    
    // Normalize email by converting to lowercase
    if (this.email) {
        this.email = this.email.toLowerCase();
    }
    
    next();
});

// Helpful error messages for database errors
userSchema.post('save', function(error, doc, next) {
    if (error.name === 'MongoServerError' && error.code === 11000) {
        let fieldName = Object.keys(error.keyPattern)[0];
        let errorMessage = `User with this ${fieldName} already exists`;
        next(new Error(errorMessage));
    } else {
        next(error);
    }
});

// Add findUserByEmailOrPhone static method for efficient lookups
userSchema.statics.findUserByEmailOrPhone = function(emailOrPhone) {
    // Detect if input is email or phone
    const isEmail = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,4})?$/.test(emailOrPhone);
    
    // Create optimized query
    if (isEmail) {
        return this.findOne({ email: emailOrPhone.toLowerCase() });
    } else {
        // Remove non-digit characters for phone lookup
        const cleanPhone = emailOrPhone.replace(/\D/g, '');
        return this.findOne({ phone: cleanPhone });
    }
};

// Add method to get recent locations efficiently
locationSchema.statics.getRecentLocations = async function(userId, limit = 20) {
    return this.find({ user_id: userId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean() // Return plain objects for better performance
        .select('-__v'); // Exclude unnecessary fields
};

// Add method to find nearby users
locationSchema.statics.findNearbyUsers = async function(coords, maxDistance = 1000, limit = 10) {
    return this.aggregate([
        {
            $geoNear: {
                near: {
                    type: 'Point',
                    coordinates: [coords.longitude, coords.latitude]
                },
                distanceField: 'distance',
                maxDistance: maxDistance,
                spherical: true,
                query: {
                    timestamp: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes
                }
            }
        },
        {
            $group: {
                _id: '$user_id',
                lastLocation: { $first: '$$ROOT' },
                distance: { $first: '$distance' }
            }
        },
        { $limit: limit },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user'
            }
        },
        { $unwind: '$user' },
        {
            $project: {
                _id: 0,
                userId: '$_id',
                name: '$user.name',
                distance: 1,
                location: '$lastLocation.loc',
                timestamp: '$lastLocation.timestamp'
            }
        }
    ]);
};

// Create models
const User = mongoose.model('User', userSchema);
const Location = mongoose.model('Location', locationSchema);

module.exports = {
    Location,
    User,
    mongoose,
    mongoOptions,
    MONGODB_URI,
    
    // Export a function to connect to the database
    connect: async () => {
        try {
            await mongoose.connect(MONGODB_URI, mongoOptions);
            console.log('Connected to MongoDB successfully');
            return true;
        } catch (err) {
            console.error('MongoDB connection error:', err.message);
            return false;
        }
    },
    
    // Export a function to close the database connection
    disconnect: async () => {
        try {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
            return true;
        } catch (err) {
            console.error('Error disconnecting from MongoDB:', err.message);
            return false;
        }
    }
};
