#!/usr/bin/env node
/**
 * Moltbook Activity Heatmap Analyzer
 * Analyzes posting patterns and identifies optimal posting times
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function loadLatestSnapshot() {
  const latestPath = path.join(DATA_DIR, 'latest.json');
  if (!fs.existsSync(latestPath)) {
    throw new Error('No snapshot data found. Run scraper first.');
  }
  
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  const snapshotPath = path.join(DATA_DIR, latest.file);
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
}

function loadAllSnapshots() {
  const snapshots = [];
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('snapshot-') && f.endsWith('.json'));
  
  for (const file of files.sort()) {
    const filePath = path.join(DATA_DIR, file);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      snapshots.push(data);
    } catch (e) {
      console.warn(`Warning: Failed to load ${file}`);
    }
  }
  
  return snapshots;
}

/**
 * Get activity heatmap for a specific submolt
 * @param {string} submoltName - Name of the submolt
 * @returns {Object} Hourly breakdown and peak activity window
 */
function getActivityHeatmap(submoltName) {
  const snapshots = loadAllSnapshots();
  const hourlyActivity = {};
  const dayOfWeekActivity = {};
  
  // Initialize hourly counters
  for (let i = 0; i < 24; i++) {
    hourlyActivity[i.toString()] = 0;
  }
  
  // Initialize day of week counters
  for (let i = 0; i < 7; i++) {
    dayOfWeekActivity[i] = 0;
  }
  
  let totalPosts = 0;
  
  for (const snapshot of snapshots) {
    const posts = snapshot.posts || [];
    
    for (const post of posts) {
      if (post.submolt === submoltName && post.created) {
        const date = new Date(post.created);
        const hour = date.getUTCHours();
        const dayOfWeek = date.getUTCDay();
        
        hourlyActivity[hour.toString()]++;
        dayOfWeekActivity[dayOfWeek]++;
        totalPosts++;
      }
    }
  }
  
  // Find peak activity window
  const peakInfo = findPeakActivity(hourlyActivity);
  
  return {
    submolt: submoltName,
    totalPosts,
    hourlyBreakdown: hourlyActivity,
    dayOfWeekBreakdown: dayOfWeekActivity,
    peakActivity: peakInfo,
    dataPoints: snapshots.length
  };
}

/**
 * Get global activity heatmap across all submolts
 * @returns {Object} Platform-wide activity patterns
 */
function getGlobalHeatmap() {
  const snapshots = loadAllSnapshots();
  const hourlyActivity = {};
  const dayOfWeekActivity = {};
  const submoltCounts = {};
  
  // Initialize counters
  for (let i = 0; i < 24; i++) {
    hourlyActivity[i.toString()] = 0;
  }
  
  for (let i = 0; i < 7; i++) {
    dayOfWeekActivity[i] = 0;
  }
  
  let totalPosts = 0;
  
  for (const snapshot of snapshots) {
    const posts = snapshot.posts || [];
    
    for (const post of posts) {
      if (post.created) {
        const date = new Date(post.created);
        const hour = date.getUTCHours();
        const dayOfWeek = date.getUTCDay();
        
        hourlyActivity[hour.toString()]++;
        dayOfWeekActivity[dayOfWeek]++;
        
        const submolt = post.submolt || 'unknown';
        submoltCounts[submolt] = (submoltCounts[submolt] || 0) + 1;
        
        totalPosts++;
      }
    }
  }
  
  const peakInfo = findPeakActivity(hourlyActivity);
  
  return {
    totalPosts,
    hourlyBreakdown: hourlyActivity,
    dayOfWeekBreakdown: dayOfWeekActivity,
    submoltDistribution: submoltCounts,
    peakActivity: peakInfo,
    dataPoints: snapshots.length
  };
}

/**
 * Find peak activity window from hourly data
 * @param {Object} hourlyData - Hours mapped to post counts
 * @returns {Object} Peak activity information
 */
function findPeakActivity(hourlyData) {
  const hours = Object.keys(hourlyData).map(Number).sort((a, b) => a - b);
  let maxWindow = { start: 0, end: 0, total: 0 };
  
  // Try different 4-hour windows
  for (let start = 0; start < 24; start++) {
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const hour = (start + i) % 24;
      total += hourlyData[hour.toString()] || 0;
    }
    
    if (total > maxWindow.total) {
      maxWindow = {
        start,
        end: (start + 3) % 24,
        total
      };
    }
  }
  
  // Find single peak hour
  const peakHour = hours.reduce((max, hour) => 
    (hourlyData[hour] || 0) > (hourlyData[max] || 0) ? hour : max, 0);
  
  return {
    window: `Peak activity: ${maxWindow.start.toString().padStart(2, '0')}:00-${((maxWindow.end + 1) % 24).toString().padStart(2, '0')}:00 UTC`,
    peakHour: `${peakHour.toString().padStart(2, '0')}:00 UTC`,
    windowTotal: maxWindow.total,
    peakHourCount: hourlyData[peakHour.toString()] || 0
  };
}

/**
 * Get best times to post for a submolt
 * @param {string} submoltName - Name of the submolt
 * @returns {Object} Top 3 recommended posting times
 */
function getBestTimeToPost(submoltName) {
  const heatmap = getActivityHeatmap(submoltName);
  const { hourlyBreakdown, dayOfWeekBreakdown } = heatmap;
  
  // Get top 3 hours by activity
  const topHours = Object.entries(hourlyBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour, count]) => ({
      time: `${hour.padStart(2, '0')}:00 UTC`,
      posts: count,
      relative: count > 0 ? 'High' : count === 0 ? 'No data' : 'Low'
    }));
  
  // Get best day of week if we have enough data
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const bestDay = Object.entries(dayOfWeekBreakdown)
    .sort((a, b) => b[1] - a[1])[0];
  
  const bestDayInfo = bestDay ? {
    day: dayNames[parseInt(bestDay[0])],
    posts: bestDay[1]
  } : null;
  
  return {
    submolt: submoltName,
    totalPosts: heatmap.totalPosts,
    recommendations: topHours,
    bestDay: bestDayInfo,
    confidence: heatmap.totalPosts > 10 ? 'High' : heatmap.totalPosts > 5 ? 'Medium' : 'Low'
  };
}

/**
 * Get activity trend for a submolt over specified days
 * @param {string} submoltName - Name of the submolt
 * @param {number} days - Number of days to analyze (default: 7)
 * @returns {Object} Daily counts and trend analysis
 */
function getActivityTrend(submoltName, days = 7) {
  const snapshots = loadAllSnapshots();
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const cutoff = now - (days * msPerDay);
  
  const dailyCounts = {};
  
  // Initialize daily counters
  for (let i = 0; i < days; i++) {
    const date = new Date(now - (i * msPerDay));
    const dateStr = date.toISOString().split('T')[0];
    dailyCounts[dateStr] = 0;
  }
  
  for (const snapshot of snapshots) {
    const posts = snapshot.posts || [];
    
    for (const post of posts) {
      if (post.submolt === submoltName && post.created) {
        const postDate = new Date(post.created);
        if (postDate.getTime() >= cutoff) {
          const dateStr = postDate.toISOString().split('T')[0];
          if (dailyCounts.hasOwnProperty(dateStr)) {
            dailyCounts[dateStr]++;
          }
        }
      }
    }
  }
  
  // Calculate trend
  const counts = Object.values(dailyCounts);
  const trend = calculateTrend(counts);
  
  return {
    submolt: submoltName,
    period: `${days} days`,
    dailyCounts,
    totalPosts: counts.reduce((sum, count) => sum + count, 0),
    averagePerDay: Math.round((counts.reduce((sum, count) => sum + count, 0) / days) * 10) / 10,
    trend
  };
}

/**
 * Calculate trend from daily counts
 * @param {number[]} counts - Array of daily post counts
 * @returns {string} Trend description
 */
function calculateTrend(counts) {
  if (counts.length < 3) return 'insufficient data';
  
  const recent = counts.slice(-3);
  const earlier = counts.slice(0, -3);
  
  if (earlier.length === 0) return 'insufficient data';
  
  const recentAvg = recent.reduce((sum, count) => sum + count, 0) / recent.length;
  const earlierAvg = earlier.reduce((sum, count) => sum + count, 0) / earlier.length;
  
  const change = recentAvg - earlierAvg;
  const percentChange = earlierAvg > 0 ? (change / earlierAvg) * 100 : 0;
  
  if (Math.abs(percentChange) < 10) {
    return 'stable';
  } else if (percentChange > 0) {
    return 'growing';
  } else {
    return 'declining';
  }
}

/**
 * Format and display heatmap data
 * @param {Object} data - Heatmap data to display
 * @param {string} type - Type of display
 */
function displayHeatmap(data, type = 'basic') {
  console.log(`\n🔥 Activity Heatmap${data.submolt ? ` - m/${data.submolt}` : ' - Global'}`);
  console.log('═'.repeat(50));
  
  if (data.submolt) {
    console.log(`Total posts analyzed: ${data.totalPosts}`);
  } else {
    console.log(`Total posts analyzed: ${data.totalPosts}`);
    console.log(`Active submolts: ${Object.keys(data.submoltDistribution || {}).length}`);
  }
  
  console.log(`Data points: ${data.dataPoints} snapshots\n`);
  
  // Display hourly breakdown
  console.log('📊 Hourly Activity (UTC):');
  console.log('Hour │ Posts │ Bar');
  console.log('─────┼───────┼──────────────────────────────────────');
  
  const maxPosts = Math.max(...Object.values(data.hourlyBreakdown));
  const barWidth = 30;
  
  for (let hour = 0; hour < 24; hour++) {
    const posts = data.hourlyBreakdown[hour.toString()] || 0;
    const barLength = maxPosts > 0 ? Math.round((posts / maxPosts) * barWidth) : 0;
    const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
    
    console.log(`${hour.toString().padStart(2, '0')}:00│ ${posts.toString().padStart(5)} │ ${bar}`);
  }
  
  console.log('\n' + data.peakActivity.window);
  console.log(`Peak hour: ${data.peakActivity.peakHour} (${data.peakActivity.peakHourCount} posts)`);
}

/**
 * CLI Interface
 */
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
🔥 Moltbook Activity Heatmap Analyzer

Usage:
  node heatmap.js <submolt>           Show activity heatmap for submolt
  node heatmap.js <submolt> --best    Show best times to post
  node heatmap.js <submolt> --trend   Show activity trend
  node heatmap.js --global            Show platform-wide heatmap

Examples:
  node heatmap.js agents              Activity heatmap for m/agents
  node heatmap.js agents --best       Best time to post in m/agents
  node heatmap.js trading --trend     Activity trend for m/trading
  node heatmap.js --global            Platform-wide heatmap
    `);
    return;
  }
  
  try {
    if (args[0] === '--global') {
      const global = getGlobalHeatmap();
      displayHeatmap(global);
      
      console.log('\n📈 Top Active Submolts:');
      const topSubmolts = Object.entries(global.submoltDistribution || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
        
      topSubmolts.forEach(([submolt, count], i) => {
        console.log(`${(i + 1).toString().padStart(2)}. m/${submolt}: ${count} posts`);
      });
      
    } else {
      const submolt = args[0];
      const option = args[1];
      
      if (option === '--best') {
        const bestTimes = getBestTimeToPost(submolt);
        
        console.log(`\n⏰ Best Times to Post - m/${submolt}`);
        console.log('═'.repeat(40));
        console.log(`Total posts analyzed: ${bestTimes.totalPosts}`);
        console.log(`Confidence: ${bestTimes.confidence}\n`);
        
        console.log('🎯 Recommended Times:');
        bestTimes.recommendations.forEach((rec, i) => {
          console.log(`${i + 1}. ${rec.time} - ${rec.posts} posts (${rec.relative} activity)`);
        });
        
        if (bestTimes.bestDay) {
          console.log(`\n📅 Best day: ${bestTimes.bestDay.day} (${bestTimes.bestDay.posts} posts)`);
        }
        
      } else if (option === '--trend') {
        const trend = getActivityTrend(submolt, 7);
        
        console.log(`\n📈 Activity Trend - m/${submolt}`);
        console.log('═'.repeat(40));
        console.log(`Period: ${trend.period}`);
        console.log(`Total posts: ${trend.totalPosts}`);
        console.log(`Average per day: ${trend.averagePerDay}`);
        console.log(`Trend: ${trend.trend}\n`);
        
        console.log('📊 Daily Breakdown:');
        Object.entries(trend.dailyCounts)
          .sort((a, b) => b[0].localeCompare(a[0]))
          .forEach(([date, count]) => {
            const bar = '█'.repeat(Math.min(count, 20)) + (count > 20 ? '+' : '');
            console.log(`${date}: ${count.toString().padStart(2)} ${bar}`);
          });
          
      } else {
        const heatmap = getActivityHeatmap(submolt);
        
        if (heatmap.totalPosts === 0) {
          console.log(`\n❌ No posts found for m/${submolt}`);
          console.log('This could mean:');
          console.log('- The submolt doesn\'t exist');
          console.log('- No posts were captured in snapshots');
          console.log('- Check spelling and try again');
          return;
        }
        
        displayHeatmap(heatmap);
      }
    }
    
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
}

// Export functions for use as module
module.exports = {
  getActivityHeatmap,
  getGlobalHeatmap,
  getBestTimeToPost,
  getActivityTrend,
  loadLatestSnapshot,
  loadAllSnapshots
};

// Run CLI if called directly
if (require.main === module) {
  main();
}