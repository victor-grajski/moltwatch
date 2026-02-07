#!/usr/bin/env node
/**
 * MoltWatch Weekly Rollup Generator
 * Analyzes past 7 days of snapshots and generates weekly summary
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DAYS = 7;

function getDateString(date) {
  return date.toISOString().split('T')[0];
}

function loadSnapshotsFromPastWeek() {
  const snapshots = [];
  const now = new Date();
  
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = getDateString(date);
    const snapshotPath = path.join(DATA_DIR, `snapshot-${dateStr}.json`);
    
    if (fs.existsSync(snapshotPath)) {
      const data = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      data.dateStr = dateStr;
      snapshots.push(data);
    }
  }
  
  // Sort by date, oldest first
  snapshots.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
  
  return snapshots;
}

function analyzeWeeklyData(snapshots) {
  if (snapshots.length === 0) {
    throw new Error('No snapshot data found for the past week');
  }
  
  const latest = snapshots[snapshots.length - 1];
  const oldest = snapshots[0];
  
  // Create submolt activity maps
  const submoltPostCounts = new Map();
  const submoltsByName = new Map();
  const agentPostCounts = new Map();
  
  // Track submolts that were inactive before but are active now
  const oldActiveSubmolts = new Set();
  const newActiveSubmolts = new Set();
  
  // If we have older data, identify what was active before
  if (oldest.submolts) {
    const oneWeekAgo = new Date(oldest.timestamp);
    const cutoff = new Date(oneWeekAgo.getTime() - (7 * 24 * 60 * 60 * 1000));
    
    oldest.submolts.forEach(submolt => {
      const lastActivity = new Date(submolt.last_activity);
      if (lastActivity > cutoff) {
        oldActiveSubmolts.add(submolt.name);
      }
    });
  }
  
  // Analyze current data
  if (latest.submolts) {
    latest.submolts.forEach(submolt => {
      submoltsByName.set(submolt.name, submolt);
      
      const lastActivity = new Date(submolt.last_activity);
      const now = new Date(latest.timestamp);
      const weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      
      if (lastActivity > weekAgo) {
        newActiveSubmolts.add(submolt.name);
      }
    });
  }
  
  // Count posts per submolt (estimated from activity)
  snapshots.forEach(snapshot => {
    if (snapshot.posts) {
      snapshot.posts.forEach(post => {
        const submolt = post.submolt;
        submoltPostCounts.set(submolt, (submoltPostCounts.get(submolt) || 0) + 1);
        
        const author = post.author;
        if (author) {
          agentPostCounts.set(author, (agentPostCounts.get(author) || 0) + 1);
        }
      });
    }
  });
  
  // Find rising spots (newly active submolts)
  const risingSpots = [];
  newActiveSubmolts.forEach(name => {
    if (!oldActiveSubmolts.has(name)) {
      const submolt = submoltsByName.get(name);
      if (submolt) {
        risingSpots.push(submolt);
      }
    }
  });
  
  // Find new submolts created this week
  const newSubmolts = [];
  if (latest.submolts) {
    const weekAgo = new Date(latest.timestamp);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    latest.submolts.forEach(submolt => {
      const created = new Date(submolt.created);
      if (created > weekAgo) {
        newSubmolts.push(submolt);
      }
    });
  }
  
  // Top submolts by activity
  const topSubmoltsByPosts = Array.from(submoltPostCounts.entries())
    .map(([name, count]) => ({ name, count, submolt: submoltsByName.get(name) }))
    .filter(item => item.submolt)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  // Top posting agents
  const topAgents = Array.from(agentPostCounts.entries())
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  
  return {
    latest,
    totalActiveSubmolts: newActiveSubmolts.size,
    totalSubmolts: latest.stats?.totalSubmolts || latest.submolts?.length || 0,
    totalPosts: Array.from(submoltPostCounts.values()).reduce((sum, count) => sum + count, 0),
    topSubmoltsByPosts,
    risingSpots,
    newSubmolts,
    topAgents,
    snapshotCount: snapshots.length
  };
}

function formatWeeklyRollup(analysis) {
  const { latest, totalActiveSubmolts, totalSubmolts, totalPosts, topSubmoltsByPosts, risingSpots, newSubmolts, topAgents } = analysis;
  
  const weekDate = new Date(latest.timestamp);
  weekDate.setDate(weekDate.getDate() - 6); // Start of the week
  const weekStr = weekDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  
  const activePercentage = totalSubmolts > 0 ? Math.round((totalActiveSubmolts / totalSubmolts) * 100) : 0;
  
  let rollup = `**MoltWatch Weekly Rollup — Week of ${weekStr}**\n\n`;
  
  // This Week in Numbers
  rollup += `## 📊 This Week in Numbers\n`;
  rollup += `- ${totalActiveSubmolts.toLocaleString()} submolts had activity (${activePercentage}% of total)\n`;
  rollup += `- ${totalPosts.toLocaleString()} new posts across the ecosystem\n\n`;
  
  // Most Active Submolts
  rollup += `## 🔥 Most Active Submolts\n`;
  if (topSubmoltsByPosts.length > 0) {
    topSubmoltsByPosts.forEach((item, index) => {
      const displayName = item.submolt.display_name || item.name;
      rollup += `${index + 1}. m/${item.name} — ${item.count} posts`;
      if (item.submolt.subscribers) {
        rollup += ` (${item.submolt.subscribers.toLocaleString()} subs)`;
      }
      rollup += `\n`;
    });
  } else {
    rollup += `No post activity detected in available data.\n`;
  }
  rollup += `\n`;
  
  // Rising Spots
  rollup += `## 🌱 Rising Spots\n`;
  if (risingSpots.length > 0) {
    rollup += `Submolts waking up this week:\n`;
    risingSpots.slice(0, 5).forEach(submolt => {
      const displayName = submolt.display_name || submolt.name;
      rollup += `- m/${submolt.name} — ${displayName}`;
      if (submolt.subscribers) {
        rollup += ` (${submolt.subscribers.toLocaleString()} subs)`;
      }
      rollup += `\n`;
    });
  } else {
    rollup += `No new activity spikes detected this week.\n`;
  }
  rollup += `\n`;
  
  // New Submolts
  if (newSubmolts.length > 0) {
    rollup += `## 🆕 Fresh Submolts\n`;
    rollup += `New submolts created this week:\n`;
    newSubmolts.forEach(submolt => {
      const displayName = submolt.display_name || submolt.name;
      const created = new Date(submolt.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      rollup += `- m/${submolt.name} — ${displayName} (created ${created})\n`;
    });
    rollup += `\n`;
  }
  
  // Top Contributors
  rollup += `## 🏆 Top Contributors\n`;
  if (topAgents.length > 0) {
    topAgents.slice(0, 5).forEach((agent, index) => {
      rollup += `${index + 1}. ${agent.author} — ${agent.count} posts\n`;
    });
  } else {
    rollup += `No contributor activity detected in available data.\n`;
  }
  
  return rollup;
}

function main() {
  const args = process.argv.slice(2);
  const shouldPost = args.includes('--post');
  
  try {
    console.error('Loading snapshots from past 7 days...');
    const snapshots = loadSnapshotsFromPastWeek();
    
    if (snapshots.length === 0) {
      console.error('No snapshot data found for the past week.');
      console.error('Run the scraper to generate snapshot data first.');
      process.exit(1);
    }
    
    console.error(`Found ${snapshots.length} snapshots from ${snapshots[0].dateStr} to ${snapshots[snapshots.length - 1].dateStr}`);
    
    const analysis = analyzeWeeklyData(snapshots);
    const rollup = formatWeeklyRollup(analysis);
    
    if (shouldPost) {
      console.error('📝 Post mode: Would post to m/moltwatch (stubbed for now)');
      console.error('Post content:');
      console.error('---');
      console.log(rollup);
      console.error('---');
      console.error('✅ Posted to m/moltwatch (stubbed)');
    } else {
      console.log(rollup);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadSnapshotsFromPastWeek, analyzeWeeklyData, formatWeeklyRollup };