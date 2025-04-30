/**
 * Database Optimization Script for Live Location Tracking
 * 
 * This script performs various optimization tasks:
 * 1. Prunes old location data to keep database size manageable
 * 2. Creates and updates indexes for better query performance
 * 3. Fixes corrupted data and ensures consistency
 * 4. Provides database statistics
 * 
 * Usage: 
 * - node optimize.js --prune-days=30  # Keep last 30 days of location data
 * - node optimize.js --stats          # Show database statistics
 * - node optimize.js --reindex        # Rebuild indexes
 * - node optimize.js --compact        # Compact database
 * - node optimize.js --fix-locations  # Fix corrupted location data
 */

const database = require('./database');
const { Location, User, mongoose, connect, disconnect } = database;
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Parse command line arguments
const args = process.argv.slice(2).reduce((acc, arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.slice(2).split('=');
    acc[key] = value !== undefined ? value : true;
  }
  return acc;
}, {});

// Default options
const options = {
  pruneDays: args['prune-days'] ? parseInt(args['prune-days']) : 30,
  showStats: args['stats'] === true,
  reindex: args['reindex'] === true,
  compact: args['compact'] === true,
  fixLocations: args['fix-locations'] === true,
  force: args['force'] === true,
  backup: args['backup'] === true,
  all: args['all'] === true
};

// If no specific options are provided, show help
if (Object.keys(args).length === 0) {
  options.help = true;
}

// Show help message
if (options.help) {
  console.log(`
Database Optimization Script for Live Location Tracking

Usage:
  node optimize.js [options]

Options:
  --prune-days=N     Remove location data older than N days (default: 30)
  --stats            Display database statistics
  --reindex          Rebuild database indexes
  --compact          Compact database and reclaim space
  --fix-locations    Fix corrupted location data
  --all              Run all optimization tasks
  --force            Skip confirmation prompts
  --backup           Create backup before making changes
  --help             Show this help message

Examples:
  node optimize.js --stats
  node optimize.js --prune-days=14 --reindex
  node optimize.js --all
  `);
  process.exit(0);
}

// If --all is specified, set all options to true
if (options.all) {
  options.showStats = true;
  options.reindex = true;
  options.compact = true;
  options.fixLocations = true;
}

// Helper to create backup
async function createBackup() {
  console.log('Creating database backup...');
  
  try {
    const backupDir = path.join(__dirname, 'backups');
    
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir);
    }
    
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}`;
    
    // Export collections to JSON
    const users = await User.find({}).lean();
    fs.writeFileSync(
      path.join(backupDir, `users_${timestamp}.json`),
      JSON.stringify(users, null, 2)
    );
    
    console.log(`- Backed up ${users.length} users`);
    
    // For locations, we need to do it in batches since there could be a lot
    const locationsBackupPath = path.join(backupDir, `locations_${timestamp}.json`);
    const totalLocations = await Location.countDocuments();
    const batchSize = 5000;
    const batches = Math.ceil(totalLocations / batchSize);
    
    // Create a write stream
    const writeStream = fs.createWriteStream(locationsBackupPath);
    writeStream.write('[');
    
    let processedLocations = 0;
    let isFirst = true;
    
    for (let i = 0; i < batches; i++) {
      const locations = await Location.find({})
        .skip(i * batchSize)
        .limit(batchSize)
        .lean();
      
      for (const location of locations) {
        if (!isFirst) {
          writeStream.write(',');
        }
        writeStream.write('\n' + JSON.stringify(location));
        isFirst = false;
        processedLocations++;
      }
      
      process.stdout.write(`- Backing up locations: ${Math.round((processedLocations / totalLocations) * 100)}% complete\r`);
    }
    
    writeStream.write('\n]');
    writeStream.end();
    
    console.log(`\n- Backed up ${processedLocations} locations`);
    console.log(`Backup saved to: ${path.join(backupDir, `users_${timestamp}.json`)} and ${locationsBackupPath}`);
    
    return true;
  } catch (error) {
    console.error('Backup failed:', error);
    return false;
  }
}

// Ask for confirmation
async function confirm(message) {
  if (options.force) return true;
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise(resolve => {
    rl.question(`${message} [y/N]: `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// Show database statistics
async function showStats() {
  console.log('\n=== Database Statistics ===');
  
  try {
    // Count documents
    const userCount = await User.countDocuments();
    const locationCount = await Location.countDocuments();
    
    console.log(`- Users: ${userCount}`);
    console.log(`- Location points: ${locationCount}`);
    
    // Get storage size
    const db = mongoose.connection.db;
    const stats = await db.stats();
    const sizeMB = Math.round(stats.dataSize / (1024 * 1024) * 100) / 100;
    const storageSize = Math.round(stats.storageSize / (1024 * 1024) * 100) / 100;
    
    console.log(`- Database size: ${sizeMB} MB`);
    console.log(`- Storage allocated: ${storageSize} MB`);
    
    // Location data by age
    const now = new Date();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    
    const last24h = await Location.countDocuments({ timestamp: { $gte: dayAgo } });
    const lastWeek = await Location.countDocuments({ timestamp: { $gte: weekAgo } });
    const lastMonth = await Location.countDocuments({ timestamp: { $gte: monthAgo } });
    const older = locationCount - lastMonth;
    
    console.log('\nLocation data by age:');
    console.log(`- Last 24 hours: ${last24h} (${Math.round(last24h / locationCount * 100)}%)`);
    console.log(`- Last 7 days: ${lastWeek} (${Math.round(lastWeek / locationCount * 100)}%)`);
    console.log(`- Last 30 days: ${lastMonth} (${Math.round(lastMonth / locationCount * 100)}%)`);
    console.log(`- Older than 30 days: ${older} (${Math.round(older / locationCount * 100)}%)`);
    
    // Index information
    console.log('\nDatabase indexes:');
    const collections = await db.collections();
    
    for (const collection of collections) {
      const indexes = await collection.indexes();
      console.log(`- ${collection.collectionName}: ${indexes.length} indexes`);
      
      for (const index of indexes) {
        const size = index.size ? `(${Math.round(index.size / 1024)}KB)` : '';
        console.log(`  - ${index.name} ${size}`);
      }
    }
    
    // Check for corrupted data
    const invalidLocations = await Location.countDocuments({
      $or: [
        { latitude: { $exists: false } },
        { longitude: { $exists: false } },
        { latitude: null },
        { longitude: null },
        { latitude: { $lt: -90, $gt: 90 } },
        { longitude: { $lt: -180, $gt: 180 } }
      ]
    });
    
    if (invalidLocations > 0) {
      console.log(`\nFound ${invalidLocations} corrupted location entries!`);
      console.log('Run with --fix-locations to repair them.');
    }
    
  } catch (error) {
    console.error('Error fetching statistics:', error);
  }
}

// Prune old location data
async function pruneOldData() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - options.pruneDays);
  
  console.log(`\nPruning location data older than ${options.pruneDays} days (before ${cutoffDate.toISOString()})...`);
  
  // Count how many records will be affected
  const count = await Location.countDocuments({ timestamp: { $lt: cutoffDate } });
  
  if (count === 0) {
    console.log('No old location data found to prune.');
    return;
  }
  
  console.log(`Found ${count} location records to prune.`);
  
  if (await confirm(`Proceed with deleting ${count} location records?`)) {
    try {
      // Delete in batches to avoid timeout
      const batchSize = 5000;
      const batches = Math.ceil(count / batchSize);
      let deleted = 0;
      
      for (let i = 0; i < batches; i++) {
        const result = await Location.deleteMany({ 
          timestamp: { $lt: cutoffDate } 
        }).limit(batchSize);
        
        deleted += result.deletedCount;
        process.stdout.write(`- Deleted ${deleted}/${count} records (${Math.round(deleted / count * 100)}%)\r`);
      }
      
      console.log(`\nSuccessfully pruned ${deleted} old location records.`);
    } catch (error) {
      console.error('Error pruning old data:', error);
    }
  }
}

// Rebuild indexes
async function rebuildIndexes() {
  console.log('\nRebuilding database indexes...');
  
  if (await confirm('This may take a while for large collections. Proceed?')) {
    try {
      console.log('- Rebuilding User collection indexes...');
      await User.collection.dropIndexes();
      await User.createIndexes();
      
      console.log('- Rebuilding Location collection indexes...');
      await Location.collection.dropIndexes();
      await Location.createIndexes();
      
      console.log('Successfully rebuilt all indexes.');
    } catch (error) {
      console.error('Error rebuilding indexes:', error);
    }
  }
}

// Compact database
async function compactDatabase() {
  console.log('\nCompacting database to reclaim space...');
  
  if (await confirm('This operation will lock the database. Proceed?')) {
    try {
      console.log('Running compact command...');
      await mongoose.connection.db.command({ compact: 'locations' });
      await mongoose.connection.db.command({ compact: 'users' });
      
      console.log('Database compaction complete.');
    } catch (error) {
      console.error('Error compacting database:', error);
    }
  }
}

// Fix corrupted location data
async function fixLocations() {
  console.log('\nScanning for corrupted location data...');
  
  try {
    // Find locations that need to be converted to the new format
    const oldFormatCount = await Location.countDocuments({
      'loc.type': { $exists: false },
      latitude: { $exists: true },
      longitude: { $exists: true }
    });
    
    if (oldFormatCount > 0) {
      console.log(`Found ${oldFormatCount} locations in old format that need conversion.`);
      
      if (await confirm('Convert to new geospatial format?')) {
        // Process in batches
        const batchSize = 1000;
        const batches = Math.ceil(oldFormatCount / batchSize);
        let updated = 0;
        
        for (let i = 0; i < batches; i++) {
          const locations = await Location.find({
            'loc.type': { $exists: false },
            latitude: { $exists: true },
            longitude: { $exists: true }
          }).limit(batchSize);
          
          for (const location of locations) {
            location.loc = {
              type: 'Point',
              coordinates: [location.longitude, location.latitude]
            };
            await location.save();
            updated++;
          }
          
          process.stdout.write(`- Converted ${updated}/${oldFormatCount} locations (${Math.round(updated / oldFormatCount * 100)}%)\r`);
        }
        
        console.log(`\nSuccessfully converted ${updated} locations to the new format.`);
      }
    } else {
      console.log('No locations found in old format.');
    }
    
    // Find invalid locations
    const invalidLocations = await Location.find({
      $or: [
        { 'loc.coordinates.0': { $lt: -180, $gt: 180 } },
        { 'loc.coordinates.1': { $lt: -90, $gt: 90 } },
        { 'loc.coordinates': { $size: { $ne: 2 } } },
        { 'loc.type': { $ne: 'Point' } }
      ]
    }).limit(100);
    
    if (invalidLocations.length > 0) {
      console.log(`Found ${invalidLocations.length} locations with invalid coordinates.`);
      
      if (await confirm('Delete invalid locations?')) {
        const result = await Location.deleteMany({
          $or: [
            { 'loc.coordinates.0': { $lt: -180, $gt: 180 } },
            { 'loc.coordinates.1': { $lt: -90, $gt: 90 } },
            { 'loc.coordinates': { $size: { $ne: 2 } } },
            { 'loc.type': { $ne: 'Point' } }
          ]
        });
        
        console.log(`Deleted ${result.deletedCount} invalid locations.`);
      }
    } else {
      console.log('No locations with invalid coordinates found.');
    }
    
  } catch (error) {
    console.error('Error fixing locations:', error);
  }
}

// Main function
async function main() {
  console.log('=== Database Optimization Tool ===');
  
  // Connect to database
  console.log('Connecting to MongoDB...');
  await connect();
  
  // Create backup if requested
  if (options.backup && (options.pruneOldData || options.fixLocations || options.reindex || options.compact)) {
    const backupSuccess = await createBackup();
    if (!backupSuccess && !options.force) {
      console.log('Backup failed. Use --force to run without backup.');
      await disconnect();
      process.exit(1);
    }
  }
  
  // Show statistics
  if (options.showStats) {
    await showStats();
  }
  
  // Prune old data
  if (options.pruneDays) {
    await pruneOldData();
  }
  
  // Fix location data
  if (options.fixLocations) {
    await fixLocations();
  }
  
  // Rebuild indexes
  if (options.reindex) {
    await rebuildIndexes();
  }
  
  // Compact database
  if (options.compact) {
    await compactDatabase();
  }
  
  // Show statistics again if multiple operations were performed
  if ((options.pruneDays || options.reindex || options.compact || options.fixLocations) && options.showStats) {
    console.log('\nDone! Updated statistics:');
    await showStats();
  }
  
  // Disconnect from database
  console.log('\nDisconnecting from MongoDB...');
  await disconnect();
  console.log('Optimization completed.');
}

// Run the main function
main().catch(error => {
  console.error('Error:', error);
  disconnect().finally(() => process.exit(1));
}); 