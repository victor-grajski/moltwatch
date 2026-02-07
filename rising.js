#!/usr/bin/env node
/**
 * Moltbook Rising Spots Detection
 * Identifies submolts that were inactive but are now showing new activity
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

/**
 * Get all snapshot files sorted by date (newest first)
 */
function getSnapshotFiles() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(file => file.match(/^snapshot-\d{4}-\d{2}-\d{2}\.json$/))
    .sort()
    .reverse(); // newest first
  
  return files.map(file => path.join(DATA_DIR, file));
}

/**
 * Load snapshot data from file
 */
function loadSnapshot(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data;
  } catch (error) {
    console.error(`Error loading snapshot ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Parse timestamp and handle various formats
 */
function parseTimestamp(timestamp) {
  return new Date(timestamp);
}

/**
 * Check if a submolt was inactive (no activity in 24h before snapshot)
 */
function wasInactive(submolt, snapshotTime) {
  const lastActivity = parseTimestamp(submolt.last_activity);
  const timeDiff = snapshotTime - lastActivity;
  const hours24 = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  
  return timeDiff > hours24;
}

/**
 * Find rising spots by comparing two snapshots
 */
function findRisingSpots(newerSnapshot, olderSnapshot) {
  const newerTime = parseTimestamp(newerSnapshot.timestamp);
  const olderTime = parseTimestamp(olderSnapshot.timestamp);
  
  // Create lookup maps for faster comparison
  const newerSubmolts = new Map();
  const olderSubmolts = new Map();
  
  newerSnapshot.submolts.forEach(submolt => {
    newerSubmolts.set(submolt.name, submolt);
  });
  
  olderSnapshot.submolts.forEach(submolt => {
    olderSubmolts.set(submolt.name, submolt);
  });
  
  const risingSpots = [];
  
  // Compare each submolt that exists in both snapshots
  for (const [name, newerSubmolt] of newerSubmolts) {
    const olderSubmolt = olderSubmolts.get(name);
    
    // Skip if submolt doesn't exist in older snapshot
    if (!olderSubmolt) continue;
    
    // Skip mega-submolts (>= 500 subscribers)
    if (newerSubmolt.subscribers >= 500) continue;
    
    // Check if it was inactive in older snapshot
    if (!wasInactive(olderSubmolt, olderTime)) continue;
    
    // Check if it has new activity in newer snapshot
    const newerActivity = parseTimestamp(newerSubmolt.last_activity);
    const olderActivity = parseTimestamp(olderSubmolt.last_activity);
    
    if (newerActivity > olderActivity) {
      // Calculate activity delta in hours
      const activityDelta = (newerActivity - olderActivity) / (1000 * 60 * 60);
      
      risingSpots.push({
        name: newerSubmolt.name,
        display_name: newerSubmolt.display_name || newerSubmolt.name,
        subscribers: newerSubmolt.subscribers,
        activityDelta: Math.round(activityDelta * 100) / 100, // Round to 2 decimal places
        lastActivity: newerSubmolt.last_activity,
        previousActivity: olderSubmolt.last_activity
      });
    }
  }
  
  // Sort by activity delta (descending) and then by subscriber count (descending)
  risingSpots.sort((a, b) => {
    if (b.activityDelta !== a.activityDelta) {
      return b.activityDelta - a.activityDelta;
    }
    return b.subscribers - a.subscribers;
  });
  
  return risingSpots;
}

/**
 * Format time delta for display
 */
function formatTimeDelta(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  } else if (hours < 24) {
    return `${Math.round(hours * 10) / 10}h`;
  } else {
    const days = Math.round(hours / 24 * 10) / 10;
    return `${days}d`;
  }
}

/**
 * Main function
 */
function main() {
  console.log('🔍 MoltWatch Rising Spots Detection');
  console.log('=====================================');
  
  const snapshotFiles = getSnapshotFiles();
  
  if (snapshotFiles.length < 2) {
    console.log(`\n⚠️  Need at least 2 snapshots to detect rising spots.`);
    console.log(`   Found ${snapshotFiles.length} snapshot(s).`);
    if (snapshotFiles.length === 1) {
      console.log(`   Current: ${path.basename(snapshotFiles[0])}`);
    }
    console.log(`\n   Rising spots detection will be available after the next scraper run.`);
    return;
  }
  
  console.log(`\n📊 Comparing snapshots:`);
  console.log(`   Newer: ${path.basename(snapshotFiles[0])}`);
  console.log(`   Older: ${path.basename(snapshotFiles[1])}`);
  
  const newerSnapshot = loadSnapshot(snapshotFiles[0]);
  const olderSnapshot = loadSnapshot(snapshotFiles[1]);
  
  if (!newerSnapshot || !olderSnapshot) {
    console.error('❌ Failed to load snapshots');
    process.exit(1);
  }
  
  const risingSpots = findRisingSpots(newerSnapshot, olderSnapshot);
  
  console.log(`\n🚀 Rising Spots Found: ${risingSpots.length}`);
  console.log('=====================================');
  
  if (risingSpots.length === 0) {
    console.log('\n   No rising spots detected in this period.');
    console.log('   (No submolts went from inactive to active with < 500 subscribers)');
    return;
  }
  
  risingSpots.forEach((spot, index) => {
    console.log(`\n${index + 1}. ${spot.display_name} (/${spot.name})`);
    console.log(`   👥 ${spot.subscribers} subscribers`);
    console.log(`   📈 Activity resumed after ${formatTimeDelta(spot.activityDelta)}`);
    console.log(`   🕐 Last activity: ${new Date(spot.lastActivity).toLocaleString()}`);
  });
  
  console.log(`\n📈 Total rising spots: ${risingSpots.length}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  findRisingSpots,
  getSnapshotFiles,
  loadSnapshot,
  wasInactive
};