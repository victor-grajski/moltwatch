#!/usr/bin/env node
/**
 * Moltbook Pulse Agent Dashboard
 * Generates comprehensive agent profiles from MoltWatch data
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Common stop words for topic analysis
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my',
  'your', 'his', 'her', 'its', 'our', 'their', 'what', 'which', 'who',
  'whom', 'why', 'how', 'when', 'where', 'just', 'only', 'very', 'too',
  'also', 'not', 'no', 'yes', 'all', 'any', 'some', 'most', 'other',
  'about', 'into', 'over', 'after', 'before', 'between', 'under', 'again',
  'so', 'if', 'because', 'as', 'until', 'while', 'during', 'through'
]);

/**
 * Load the latest snapshot data
 */
function loadLatestSnapshot() {
  const latestPath = path.join(DATA_DIR, 'latest.json');
  if (!fs.existsSync(latestPath)) {
    throw new Error('No snapshot data found. Run scraper first.');
  }
  
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
  const snapshotPath = path.join(DATA_DIR, latest.file);
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
}

/**
 * Load the graph data
 */
function loadGraph() {
  const graphPath = path.join(DATA_DIR, 'graph.json');
  if (!fs.existsSync(graphPath)) {
    return null; // Graph is optional
  }
  return JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
}

/**
 * Extract @mentions from text
 */
function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@[\w-]+/g) || [];
  return matches.map(m => m.slice(1).toLowerCase());
}

/**
 * Extract topics (keywords) from title
 */
function extractTopics(title) {
  if (!title) return [];
  
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(w => 
    w.length >= 4 && 
    !STOP_WORDS.has(w) &&
    !/^\d+$/.test(w)
  );
  
  return [...new Set(words)];
}

/**
 * Calculate time difference in human readable format
 */
function timeAgo(timestamp) {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now - past;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays/30)} months ago`;
  return `${Math.floor(diffDays/365)} years ago`;
}

/**
 * Generate comprehensive agent dashboard
 */
function getAgentDashboard(agentName) {
  const snapshot = loadLatestSnapshot();
  const graph = loadGraph();
  
  // Find agent (case-insensitive)
  const targetName = agentName.toLowerCase();
  const agentPosts = (snapshot.posts || []).filter(p => 
    p.author && p.author.toLowerCase() === targetName
  );
  
  if (agentPosts.length === 0) {
    throw new Error(`Agent "${agentName}" not found in current snapshot`);
  }
  
  // Use the original case from posts for display
  const displayName = agentPosts[0].author;
  
  // Basic stats
  const postCount = agentPosts.length;
  const totalComments = agentPosts.reduce((sum, p) => sum + (p.comments || 0), 0);
  const totalKarma = totalComments; // Use comment count as karma proxy for now
  
  // Account age (based on earliest post)
  const earliestPost = agentPosts.sort((a, b) => 
    new Date(a.created) - new Date(b.created)
  )[0];
  const accountAge = timeAgo(earliestPost.created);
  
  // Activity analysis
  const submoltCounts = {};
  const mentionCounts = {};
  const topicCounts = {};
  
  agentPosts.forEach(post => {
    // Submolt activity
    if (post.submolt) {
      submoltCounts[post.submolt] = (submoltCounts[post.submolt] || 0) + 1;
    }
    
    // Mentions (collaborators)
    const mentions = extractMentions(post.title);
    mentions.forEach(mention => {
      mentionCounts[mention] = (mentionCounts[mention] || 0) + 1;
    });
    
    // Topics
    const topics = extractTopics(post.title);
    topics.forEach(topic => {
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
  });
  
  // Sort and get top items
  const topSubmolts = Object.entries(submoltCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  const topCollaborators = Object.entries(mentionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  const topTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  // Top posts by engagement
  const topPosts = [...agentPosts]
    .sort((a, b) => (b.comments || 0) - (a.comments || 0))
    .slice(0, 5);
  
  // Activity timeline (posts per week)
  const weeklyActivity = {};
  agentPosts.forEach(post => {
    const date = new Date(post.created);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay()); // Start of week
    const weekKey = weekStart.toISOString().split('T')[0];
    weeklyActivity[weekKey] = (weeklyActivity[weekKey] || 0) + 1;
  });
  
  const recentWeeks = Object.entries(weeklyActivity)
    .sort((a, b) => b[0].localeCompare(a[0])) // Most recent first
    .slice(0, 4);
  
  // Engagement stats
  const avgComments = Math.round(totalComments / postCount);
  const avgScore = avgComments; // Using comments as score proxy
  
  // Historical karma trajectory (stubbed for now)
  const karmaTrajectory = 'Historical tracking not yet available (requires multiple snapshots over time)';
  
  return {
    agent: displayName,
    basicStats: {
      karma: totalKarma,
      postCount,
      commentCount: totalComments,
      accountAge
    },
    activitySummary: {
      postsPerWeek: Math.round((postCount / Math.max(recentWeeks.length, 1)) * 10) / 10,
      mostActiveSubmolts: topSubmolts,
      recentWeeklyActivity: recentWeeks
    },
    karmaTrajectory,
    topPosts: topPosts.map(p => ({
      title: p.title,
      submolt: p.submolt,
      comments: p.comments || 0,
      created: p.created,
      timeAgo: timeAgo(p.created)
    })),
    engagementStats: {
      avgComments,
      avgScore,
      totalEngagement: totalComments
    },
    network: {
      topCollaborators: topCollaborators.map(([name, count]) => ({
        agent: name,
        interactions: count
      }))
    },
    topics: {
      mostUsedKeywords: topTopics.map(([topic, count]) => ({
        keyword: topic,
        frequency: count
      }))
    },
    generatedAt: new Date().toISOString()
  };
}

/**
 * Format dashboard as markdown
 */
function formatDashboardMarkdown(dashboard) {
  const { agent, basicStats, activitySummary, karmaTrajectory, topPosts, 
          engagementStats, network, topics } = dashboard;
  
  let md = `# 👤 ${agent} - Agent Dashboard

*Generated: ${new Date(dashboard.generatedAt).toUTCString()}*

## 📊 Basic Stats

| Metric | Value |
|--------|-------|
| **Karma** | ${basicStats.karma.toLocaleString()} |
| **Posts** | ${basicStats.postCount.toLocaleString()} |
| **Total Comments** | ${basicStats.commentCount.toLocaleString()} |
| **Account Age** | ${basicStats.accountAge} |

## 📈 Activity Summary

**Posts Per Week:** ${activitySummary.postsPerWeek}

### Most Active Submolts
${activitySummary.mostActiveSubmolts.map(([submolt, count]) => 
  `- **m/${submolt}**: ${count} posts`
).join('\n') || '- No submolt data available'}

### Recent Weekly Activity
${activitySummary.recentWeeklyActivity.map(([week, count]) =>
  `- Week of ${week}: ${count} posts`
).join('\n') || '- No recent activity data'}

## 📊 Karma Trajectory

${karmaTrajectory}

## 🏆 Top Posts

${topPosts.map((post, i) => 
  `**${i+1}.** ${post.title}
   - **m/${post.submolt}** • ${post.comments.toLocaleString()} comments • ${post.timeAgo}`
).join('\n\n') || 'No posts found'}

## 💬 Engagement Stats

| Metric | Value |
|--------|-------|
| **Avg Comments/Post** | ${engagementStats.avgComments} |
| **Avg Score/Post** | ${engagementStats.avgScore} |
| **Total Engagement** | ${engagementStats.totalEngagement.toLocaleString()} |

## 🤝 Network

### Top Collaborators
${network.topCollaborators.map(collab => 
  `- **@${collab.agent}**: ${collab.interactions} interactions`
).join('\n') || '- No collaborations found'}

## 🏷️ Topics

### Most Used Keywords
${topics.mostUsedKeywords.map(topic => 
  `- **${topic.keyword}**: ${topic.frequency} times`
).join('\n') || '- No topics identified'}

---

*Dashboard by MoltWatch • Data from ${new Date(dashboard.generatedAt).toDateString()}*`;

  return md;
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node dashboard.js <agentName> [--json]');
    console.log('Examples:');
    console.log('  node dashboard.js SparkOC');
    console.log('  node dashboard.js SparkOC --json');
    process.exit(1);
  }
  
  const agentName = args[0];
  const outputJson = args.includes('--json');
  
  try {
    const dashboard = getAgentDashboard(agentName);
    
    if (outputJson) {
      console.log(JSON.stringify(dashboard, null, 2));
    } else {
      const markdown = formatDashboardMarkdown(dashboard);
      console.log(markdown);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

module.exports = { getAgentDashboard, formatDashboardMarkdown };