// DOM Elements - cache all DOM elements on load
const elements = {};
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM elements
  ['latitude', 'longitude', 'last-updated', 'accuracy', 'status-indicator', 
   'status-text', 'start-tracking-btn', 'stop-tracking-btn', 'center-map-btn', 
   'logout-btn', 'error-message', 'history-list'].forEach(id => {
    elements[id.replace(/-/g, '')] = document.getElementById(id);
  });
});

// App State
let isTracking = false;
let watchId = null;
let locationUpdateInterval = null;
// Increase update interval to reduce server load and battery usage
const UPDATE_INTERVAL = 5000; // 5 seconds 
let currentPosition = null;
let retryCount = 0;
const MAX_RETRIES = 3;
let mapRetryInterval = null;
let lastSavedPosition = null;
let locationsSaved = 0;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;
let lastKnownPosition = null;

// Cache for API responses
const apiCache = {
  data: {},
  timestamp: {},
  maxAge: 60000, // 1 minute default cache
  
  get(key) {
    const now = Date.now();
    if (this.data[key] && (now - this.timestamp[key] < this.maxAge)) {
      return this.data[key];
    }
    return null;
  },
  
  set(key, data, customMaxAge) {
    this.data[key] = data;
    this.timestamp[key] = Date.now();
    if (customMaxAge) this.maxAge = customMaxAge;
    return data;
  },
  
  clear(key) {
    if (key) {
      delete this.data[key];
      delete this.timestamp[key];
    } else {
      this.data = {};
      this.timestamp = {};
    }
  }
};

// Throttled function for resource-intensive operations
function throttle(func, delay) {
  let lastCall = 0;
  return function(...args) {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      return func.apply(this, args);
    }
  };
}

// Debounced function for operations that should wait until user stops action
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Privacy Settings
let shareLocationWithServer = true;

// Optimize location options for better battery life and accuracy balance
const locationOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 10000 // Accept positions up to 10 seconds old to reduce GPS polling
};

// API URL configuration with caching
const API_CONFIG = {
  baseUrl: window.location.origin,
  endpoints: {
    location: '/api/location',
    history: '/api/location/history',
    health: '/api/health'
  },
  
  getUrl(endpointName) {
    return this.baseUrl + this.endpoints[endpointName];
  }
};

// Batch API requests to reduce server load
const requestQueue = {
  locations: [],
  timer: null,
  batchSize: 5,
  
  add(location) {
    this.locations.push(location);
    
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), 10000); // 10 seconds max wait
    }
    
    if (this.locations.length >= this.batchSize) {
      this.flush();
    }
  },
  
  async flush() {
    if (this.locations.length === 0) return;
    
    const locationsToSend = [...this.locations];
    this.locations = [];
    clearTimeout(this.timer);
    this.timer = null;
    
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      
      await fetch(API_CONFIG.getUrl('location') + '/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ locations: locationsToSend })
      });
      
      locationsSaved += locationsToSend.length;
      if (elements.statustext) {
        elements.statustext.textContent = `Online - Saved ${locationsSaved} positions`;
      }
    } catch (error) {
      console.error('Failed to batch save locations:', error);
      // Re-add failed locations for retry
      this.locations = [...locationsToSend, ...this.locations];
    }
  }
};

// Check if user is logged in
function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) {
    window.location.href = '/login.html';
  }
  return token;
}

// Show error message - with throttling to avoid UI thrashing
const showError = throttle((message) => {
  console.error('Error:', message);
  if (!elements.errormessage) return;
  
  elements.errormessage.textContent = message;
  elements.errormessage.classList.remove('hidden');
  elements.errormessage.classList.remove('success-message');
  elements.errormessage.classList.add('error-message');
  
  setTimeout(() => {
    elements.errormessage.classList.add('hidden');
  }, 5000);
}, 2000); // Only show one error every 2 seconds

// Show success message
const showSuccess = throttle((message) => {
  if (!elements.errormessage) return;
  
  elements.errormessage.textContent = message;
  elements.errormessage.classList.remove('hidden', 'error-message');
  elements.errormessage.classList.add('success-message');
  
  setTimeout(() => {
    elements.errormessage.classList.add('hidden');
  }, 3000);
}, 1000);

// Format time - use Intl formatter for better localization and performance
const timeFormatter = new Intl.DateTimeFormat(navigator.language, { 
  hour: '2-digit', 
  minute: '2-digit', 
  second: '2-digit',
  hour12: false 
});

function formatTime(date) {
  return timeFormatter.format(date);
}

// Check if the map is ready to be updated
function isMapReady() {
  return typeof window.map !== 'undefined' && window.map !== null;
}

// Calculate distance between two coordinates in meters
// Optimized haversine formula implementation
function calculateDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  
  // Convert to radians
  const toRad = value => value * Math.PI / 180;
  const R = 6371e3; // Earth's radius in meters
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
}

// Update UI with location data - Optimized DOM updates
function updateLocationUI(position) {
  if (!position || !position.coords) return;
  
  try {
    const { latitude, longitude, accuracy } = position.coords;
    
    if (!elements.latitude || !elements.longitude) return;
    
    // Only update DOM if values have changed
    if (elements.latitude.textContent !== latitude.toFixed(6)) {
      elements.latitude.textContent = latitude.toFixed(6);
    }
    
    if (elements.longitude.textContent !== longitude.toFixed(6)) {
      elements.longitude.textContent = longitude.toFixed(6);
    }
    
    if (elements.accuracy && elements.accuracy.textContent !== `${accuracy.toFixed(0)} m`) {
      elements.accuracy.textContent = `${accuracy.toFixed(0)} m`;
    }
    
    if (elements.lastupdated) {
      elements.lastupdated.textContent = formatTime(new Date());
    }
    
    if (elements.statusindicator && elements.statustext) {
      elements.statusindicator.classList.remove('offline');
      elements.statusindicator.classList.add('online');
      elements.statustext.textContent = 'Online - Tracking';
    }
    
    currentPosition = {
      latitude,
      longitude,
      accuracy,
      timestamp: new Date().toISOString()
    };
    
    lastKnownPosition = currentPosition;
    consecutiveErrors = 0;
    
    // Check if this is a significant location change (> 10 meters or first position)
    // Increased threshold to reduce unnecessary updates
    let shouldSave = false;
    if (!lastSavedPosition) {
      shouldSave = true;
    } else {
      const distance = calculateDistance(
        lastSavedPosition.latitude, lastSavedPosition.longitude,
        latitude, longitude
      );
      shouldSave = distance > 10; // Save if moved more than 10 meters
    }
    
    // Update map efficiently - throttled to avoid performance issues
    updateMapThrottled(latitude, longitude, accuracy);
    
    // Save significant location changes if sharing is enabled
    if (shouldSave && shareLocationWithServer) {
      const locationData = { 
        latitude, 
        longitude, 
        accuracy, 
        timestamp: new Date().toISOString() 
      };
      
      // Add to batch queue instead of immediate save
      requestQueue.add(locationData);
      lastSavedPosition = locationData;
    }
  } catch (error) {
    console.error("Error in updateLocationUI:", error);
    consecutiveErrors++;
    
    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      showError("Multiple errors updating location. Refreshing tracking...");
      restartTracking();
    }
  }
}

// Throttled map update to prevent performance issues
const updateMapThrottled = throttle((latitude, longitude, accuracy) => {
  if (typeof window.updateMap === 'function' && isMapReady()) {
    try {
      window.updateMap(latitude, longitude, accuracy);
      retryCount = 0;
      
      if (mapRetryInterval) {
        clearInterval(mapRetryInterval);
        mapRetryInterval = null;
      }
    } catch (error) {
      console.error("Error updating map:", error);
      handleMapUpdateError();
    }
  } else {
    handleMapUpdateError();
  }
}, 1000); // Update map at most once per second

// Optimized API function for saving location
async function saveLocation(position) {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    const { latitude, longitude, accuracy } = position.coords;
    const locationData = {
      latitude,
      longitude,
      accuracy,
      timestamp: new Date().toISOString()
    };
    
    const response = await fetch(API_CONFIG.getUrl('location'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(locationData)
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    
    locationsSaved++;
    
    // Update status indicator to show saved count
    if (elements.statustext) {
      elements.statustext.textContent = `Online - Saved ${locationsSaved} positions`;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to save location:', error);
    if (error.message.includes('Failed to fetch')) {
      showError('Cannot reach server. Working offline.');
      
      // Store locally for later sync
      const offlineLocations = JSON.parse(localStorage.getItem('offlineLocations') || '[]');
      offlineLocations.push({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date().toISOString()
      });
      
      // Cap storage to prevent excessive local storage use
      if (offlineLocations.length > 100) {
        offlineLocations.splice(0, offlineLocations.length - 100);
      }
      
      localStorage.setItem('offlineLocations', JSON.stringify(offlineLocations));
    }
    return null;
  }
}

// Start tracking user location
function startTracking() {
  if (isTracking) return;
  
  console.log("Starting location tracking...");
  
  // Update UI
  if (elements.starttrackingbtn) elements.starttrackingbtn.disabled = true;
  if (elements.stoptrackingbtn) elements.stoptrackingbtn.disabled = false;
  if (elements.statusindicator) elements.statusindicator.className = 'online';
  if (elements.statustext) elements.statustext.textContent = 'Online - Tracking Active';
  
  // Set the sharing settings from UI if available
  const visibilityToggle = document.getElementById('visibility-toggle');
  if (visibilityToggle) {
    shareLocationWithServer = visibilityToggle.checked;
  }
  
  // Start watching position
  startWatchingPosition();
}

// Start watching the user's position
function startWatchingPosition() {
  if (navigator.geolocation) {
    try {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          // Update UI with position data
          updateLocationUI(position);
        },
        (error) => {
          // Handle geolocation errors
          handleGeolocationError(error);
        },
        locationOptions
      );
      
      console.log("Geolocation watch started with ID:", watchId);
      
      // Set flag to indicate tracking is active
      isTracking = true;
      
      // Schedule periodic UI updates
      locationUpdateInterval = setInterval(() => {
        const lastUpdatedEl = document.getElementById('last-updated');
        if (lastUpdatedEl) {
          lastUpdatedEl.textContent = formatTime(new Date());
        }
        
        // Occasionally check server connection
        if (Math.random() < 0.2) { // 20% chance each interval
          checkServerConnection();
        }
      }, UPDATE_INTERVAL);
      
      showSuccess("Location tracking started");
      
    } catch (error) {
      console.error("Error starting geolocation watch:", error);
      showError(`Failed to start location tracking: ${error.message}`);
      isTracking = false;
    }
  } else {
    showError("Geolocation is not supported by this browser");
    isTracking = false;
  }
}

// Restart tracking after errors
function restartTracking() {
  stopTracking();
  setTimeout(startTracking, 1000);
}

// Stop tracking user location
function stopTracking() {
  if (!isTracking) return;
  
  console.log("Stopping location tracking...");
  
  // Update UI
  if (elements.starttrackingbtn) elements.starttrackingbtn.disabled = false;
  if (elements.stoptrackingbtn) elements.stoptrackingbtn.disabled = true;
  if (elements.statusindicator) elements.statusindicator.className = 'offline';
  if (elements.statustext) elements.statustext.textContent = 'Offline - Not Tracking';
  
  // Stop watching position
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    console.log("Geolocation watch stopped");
  }
  
  // Clear interval
  if (locationUpdateInterval) {
    clearInterval(locationUpdateInterval);
    locationUpdateInterval = null;
  }
  
  // Set flag to indicate tracking is inactive
  isTracking = false;
  
  showSuccess("Location tracking stopped");
}

// Handle geolocation errors
function handleGeolocationError(error) {
  console.error("Geolocation error:", error);
  
  let errorMsg = "Location tracking error: ";
  switch (error.code) {
    case 1:
      errorMsg += "Permission denied. Please enable location services in your browser settings.";
      break;
    case 2:
      errorMsg += "Position unavailable. Please check your device's location services.";
      break;
    case 3:
      errorMsg += "Timeout. Getting your location took too long.";
      break;
    default:
      errorMsg += error.message || "Unknown error";
  }
  
  showError(errorMsg);
  
  // Increment consecutive errors
  consecutiveErrors++;
  
  // If we have multiple consecutive errors, stop tracking
  if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    console.log(`${MAX_CONSECUTIVE_ERRORS} consecutive errors, stopping tracking`);
    stopTracking();
  }
}

// Format time difference as relative time
function formatTimeDifference(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  
  if (diffMs < 60000) {
    return 'Just now';
  } else if (diffMs < 3600000) {
    const mins = Math.floor(diffMs / 60000);
    return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
  } else if (diffMs < 86400000) {
    const hours = Math.floor(diffMs / 3600000);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Add location to history
function addLocationToHistory(position) {
  if (!elements.historylist) {
    console.warn("History list element not found");
    return;
  }
  
  try {
    const { latitude, longitude, accuracy, timestamp, localOnly } = position;
    
    // Format timestamp for display
    const date = new Date(timestamp);
    const timeString = date.toLocaleTimeString();
    const relativeTime = formatTimeDifference(timestamp);
    
    // Create a new list item
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    
    // Add local-only class if applicable
    if (localOnly) {
      historyItem.classList.add('local-only');
    }
    
    historyItem.innerHTML = `
      <span class="history-time"><i class="fas fa-clock"></i> ${relativeTime}</span>
      <span class="history-coords">
        <i class="fas fa-map-marker-alt"></i> Lat: ${latitude.toFixed(6)}, Lon: ${longitude.toFixed(6)}
      </span>
      <span class="history-accuracy"><i class="fas fa-crosshairs"></i> Accuracy: ${accuracy ? accuracy.toFixed(0) : '?'} m</span>
      ${localOnly ? '<span class="local-badge" title="This location is only stored locally"><i class="fas fa-eye-slash"></i> Private</span>' : ''}
      <button class="btn-show-on-map" data-lat="${latitude}" data-lon="${longitude}">
        <i class="fas fa-eye"></i>
      </button>
    `;
    
    // Add to list (at the beginning)
    elements.historylist.insertBefore(historyItem, elements.historylist.firstChild);
    
    // Add event listener to show on map button
    const showOnMapBtn = historyItem.querySelector('.btn-show-on-map');
    showOnMapBtn.addEventListener('click', () => {
      const lat = parseFloat(showOnMapBtn.dataset.lat);
      const lon = parseFloat(showOnMapBtn.dataset.lon);
      
      if (typeof window.map !== 'undefined' && window.map && typeof window.marker !== 'undefined' && window.marker) {
        window.map.setView([lat, lon], 16);
        window.marker.setLatLng([lat, lon]);
        window.marker.bindPopup(`<b>Recorded Location</b><br>Lat: ${lat.toFixed(6)}<br>Lon: ${lon.toFixed(6)}<br>Time: ${timeString}${localOnly ? '<br><i>Private - Not shared</i>' : ''}`).openPopup();
      } else {
        showError("Map not available. Try refreshing the page.");
      }
    });
    
    // Limit history items to 20
    const historyItems = elements.historylist.querySelectorAll('.history-item');
    if (historyItems.length > 20) {
      elements.historylist.removeChild(historyItems[historyItems.length - 1]);
    }
  } catch (error) {
    console.error("Error adding location to history:", error);
  }
}

// Fetch location history from server
async function fetchLocationHistory() {
  try {
    const token = checkAuth();
    if (!token) return;
    
    const response = await fetch(API_CONFIG.getUrl('history'), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('Location history:', data);
      
      // Clear existing history
      if (elements.historylist) {
        elements.historylist.innerHTML = '';
      }
      
      // Add each location to history
      if (data.locations && data.locations.length > 0) {
        data.locations.forEach(location => {
          addLocationToHistory({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            timestamp: location.timestamp,
            localOnly: false
          });
        });
        
        showSuccess(`Loaded ${data.locations.length} location records`);
      } else {
        // No history available message
        if (elements.historylist) {
          elements.historylist.innerHTML = '<div class="no-history">No location history available</div>';
        }
      }
    } else {
      const errorData = await response.json();
      console.error('Failed to fetch location history:', errorData);
      showError(errorData.error || 'Failed to load location history');
    }
  } catch (error) {
    console.error('Error fetching location history:', error);
    showError('Could not load location history. Please try again later.');
  }
}

// Check if server is reachable
async function checkServerConnection() {
  try {
    const response = await fetch(API_CONFIG.getUrl('health'), { method: 'GET' });
    if (response.ok) {
      console.log("Server connection OK");
      return true;
    } else {
      console.warn("Server returned non-OK status:", response.status);
      return false;
    }
  } catch (error) {
    console.error("Server connection check failed:", error);
    return false;
  }
}

// Logout function
function logout() {
  // Stop tracking if active
  if (isTracking) {
    stopTracking();
  }
  
  // Clear auth data
  localStorage.removeItem('token');
  localStorage.removeItem('userId');
  
  // Redirect to login page
  window.location.href = '/login.html';
}

// Initialize UI event listeners
document.addEventListener('DOMContentLoaded', function() {
  console.log("script.js: DOM loaded. Initializing event listeners...");
  
  // Check authentication
  const token = checkAuth();
  if (!token) return;
  
  // Event listeners for tracking buttons
  if (elements.starttrackingbtn) {
    elements.starttrackingbtn.addEventListener('click', startTracking);
  }
  if (elements.stoptrackingbtn) {
    elements.stoptrackingbtn.addEventListener('click', stopTracking);
  }
  
  // Center map button
  if (elements.centermapbtn) {
    elements.centermapbtn.addEventListener('click', function() {
      if (currentPosition && typeof window.map !== 'undefined' && window.map) {
        window.map.setView([currentPosition.latitude, currentPosition.longitude], 16);
        console.log("Map centered on current position");
      } else if (lastKnownPosition && typeof window.map !== 'undefined' && window.map) {
        window.map.setView([lastKnownPosition.latitude, lastKnownPosition.longitude], 16);
        console.log("Map centered on last known position");
      } else {
        showError("No position available to center map");
      }
    });
  }
  
  // Visibility toggle
  const visibilityToggle = document.getElementById('visibility-toggle');
  if (visibilityToggle) {
    visibilityToggle.addEventListener('change', function() {
      shareLocationWithServer = this.checked;
      console.log("Location sharing set to:", shareLocationWithServer);
      showSuccess(shareLocationWithServer ? 
        "Your location will be saved to the server" : 
        "Your location will only be saved locally");
      
      // Save preference
      localStorage.setItem('shareLocationWithServer', shareLocationWithServer);
    });
    
    // Initialize from localStorage
    const savedSharingPref = localStorage.getItem('shareLocationWithServer');
    if (savedSharingPref !== null) {
      const shouldShare = savedSharingPref === 'true';
      visibilityToggle.checked = shouldShare;
      shareLocationWithServer = shouldShare;
    }
  }
  
  // Logout button
  if (elements.logoutbtn) {
    elements.logoutbtn.addEventListener('click', logout);
  }
  
  // Fetch location history
  fetchLocationHistory();
  
  // Start tracking after short delay
  setTimeout(startTracking, 1000);
});
