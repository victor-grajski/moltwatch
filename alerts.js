#!/usr/bin/env node
/**
 * MoltWatch Alerts - Mention and Reply Tracking
 * Monitors @mentions and replies for specific agents
 */

const fs = require('fs');
const path = require('path');
const { fetchAPI } = require('./scraper.js');

const DATA_DIR = path.join(__dirname, 'data');
const ALERTS_STATE_FILE = path.join(DATA_DIR, 'alerts-state.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

class AlertTracker {
  constructor() {
    this.state = this.loadState();
  }

  loadState() {
    try {
      if (fs.existsSync(ALERTS_STATE_FILE)) {
        return JSON.parse(fs.readFileSync(ALERTS_STATE_FILE, 'utf8'));
      }
    } catch (error) {
      console.warn('Failed to load alerts state:', error.message);
    }
    return { agents: {} };
  }

  saveState() {
    try {
      fs.writeFileSync(ALERTS_STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (error) {
      console.error('Failed to save alerts state:', error.message);
    }
  }

  getLastCheck(agentName) {
    return this.state.agents[agentName]?.lastCheck || 0;
  }

  markChecked(agentName) {
    if (!this.state.agents[agentName]) {
      this.state.agents[agentName] = {};
    }
    this.state.agents[agentName].lastCheck = Date.now();
    this.saveState();
  }

  async getNewAlerts(agentName) {
    const lastCheck = this.getLastCheck(agentName);
    const mentions = await checkMentions(agentName, lastCheck);
    const replies = await checkReplies(agentName, lastCheck);
    
    return {
      mentions,
      replies,
      lastCheck: new Date(lastCheck).toISOString(),
      newCount: mentions.length + replies.length
    };
  }
}

async function checkMentions(agentName, sinceTimestamp = 0) {
  console.log(`Checking for @${agentName} mentions...`);
  
  const mentions = [];
  const mentionPattern = new RegExp(`@${agentName}\\b`, 'gi');
  
  try {
    // Search recent posts
    const postsData = await fetchAPI('/posts', { limit: 100 });
    const posts = postsData.posts || [];
    
    for (const post of posts) {
      const createdAt = new Date(post.created).getTime();
      
      // Skip if older than our last check
      if (createdAt <= sinceTimestamp) continue;
      
      // Check title for mentions
      if (mentionPattern.test(post.title)) {
        mentions.push({
          type: 'post_title',
          post: {
            id: post.id,
            title: post.title,
            submolt: post.submolt,
            url: `https://moltbook.com/m/${post.submolt}/p/${post.id}`
          },
          author: post.author,
          content: post.title,
          timestamp: post.created,
          createdAt
        });
      }
      
      // Get post comments if there are any
      if (post.comments > 0) {
        await checkPostComments(post, agentName, sinceTimestamp, mentions);
      }
    }
    
    console.log(`  Found ${mentions.length} mentions`);
    return mentions.sort((a, b) => b.createdAt - a.createdAt);
    
  } catch (error) {
    console.error('Error checking mentions:', error.message);
    return [];
  }
}

async function checkPostComments(post, agentName, sinceTimestamp, mentions) {
  try {
    const commentsData = await fetchAPI(`/posts/${post.id}/comments`);
    const comments = commentsData.comments || [];
    
    const mentionPattern = new RegExp(`@${agentName}\\b`, 'gi');
    
    for (const comment of comments) {
      const createdAt = new Date(comment.created).getTime();
      
      // Skip if older than our last check
      if (createdAt <= sinceTimestamp) continue;
      
      if (mentionPattern.test(comment.content)) {
        mentions.push({
          type: 'comment_mention',
          post: {
            id: post.id,
            title: post.title,
            submolt: post.submolt,
            url: `https://moltbook.com/m/${post.submolt}/p/${post.id}#${comment.id}`
          },
          commenter: comment.author,
          content: comment.content,
          timestamp: comment.created,
          createdAt
        });
      }
    }
    
    // Small delay to be nice to the API
    await new Promise(resolve => setTimeout(resolve, 100));
    
  } catch (error) {
    // Not all posts may have accessible comments
    console.log(`  Couldn't fetch comments for post ${post.id}:`, error.message);
  }
}

async function checkReplies(agentName, sinceTimestamp = 0) {
  console.log(`Checking for replies to ${agentName}...`);
  
  const replies = [];
  
  try {
    // Get recent posts by the agent
    const postsData = await fetchAPI('/posts', { limit: 100 });
    const posts = postsData.posts || [];
    const agentPosts = posts.filter(post => post.author === agentName);
    
    console.log(`  Found ${agentPosts.length} posts by ${agentName}`);
    
    // Check comments on agent's posts
    for (const post of agentPosts) {
      if (post.comments > 0) {
        await checkPostReplies(post, agentName, sinceTimestamp, replies);
      }
    }
    
    // Also check for replies to agent's comments
    await checkCommentReplies(agentName, sinceTimestamp, replies);
    
    console.log(`  Found ${replies.length} replies`);
    return replies.sort((a, b) => b.createdAt - a.createdAt);
    
  } catch (error) {
    console.error('Error checking replies:', error.message);
    return [];
  }
}

async function checkPostReplies(post, agentName, sinceTimestamp, replies) {
  try {
    const commentsData = await fetchAPI(`/posts/${post.id}/comments`);
    const comments = commentsData.comments || [];
    
    for (const comment of comments) {
      const createdAt = new Date(comment.created).getTime();
      
      // Skip if older than our last check or if it's the agent's own comment
      if (createdAt <= sinceTimestamp || comment.author === agentName) continue;
      
      replies.push({
        type: 'post_reply',
        post: {
          id: post.id,
          title: post.title,
          submolt: post.submolt,
          url: `https://moltbook.com/m/${post.submolt}/p/${post.id}#${comment.id}`
        },
        commenter: comment.author,
        content: comment.content,
        timestamp: comment.created,
        createdAt
      });
    }
    
    // Small delay to be nice to the API
    await new Promise(resolve => setTimeout(resolve, 100));
    
  } catch (error) {
    console.log(`  Couldn't fetch comments for post ${post.id}:`, error.message);
  }
}

async function checkCommentReplies(agentName, sinceTimestamp, replies) {
  // This is trickier - we'd need to search through all recent comments
  // to find replies to the agent's comments. For now, we'll focus on post replies.
  // This could be enhanced by maintaining a database of the agent's comment IDs.
  
  try {
    // Get recent posts to scan for agent's comments
    const postsData = await fetchAPI('/posts', { limit: 50 });
    const posts = postsData.posts || [];
    
    for (const post of posts) {
      if (post.comments > 0) {
        const commentsData = await fetchAPI(`/posts/${post.id}/comments`);
        const comments = commentsData.comments || [];
        
        // Find agent's comments in this post
        const agentComments = comments.filter(c => c.author === agentName);
        
        // Look for replies to those comments (comments that reference them)
        for (const comment of comments) {
          const createdAt = new Date(comment.created).getTime();
          
          if (createdAt <= sinceTimestamp || comment.author === agentName) continue;
          
          // Simple heuristic: if comment mentions agent or appears to be a reply
          if (comment.content.includes(`@${agentName}`) || 
              (agentComments.length > 0 && comment.parent_id)) {
            
            replies.push({
              type: 'comment_reply',
              post: {
                id: post.id,
                title: post.title,
                submolt: post.submolt,
                url: `https://moltbook.com/m/${post.submolt}/p/${post.id}#${comment.id}`
              },
              commenter: comment.author,
              content: comment.content,
              timestamp: comment.created,
              createdAt
            });
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  } catch (error) {
    console.log('Error checking comment replies:', error.message);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
MoltWatch Alerts - Usage:

  node alerts.js mentions <agentName>  - Check for @mentions
  node alerts.js replies <agentName>   - Check for replies 
  node alerts.js all <agentName>       - Check both mentions and replies

Examples:
  node alerts.js mentions SparkOC
  node alerts.js replies SparkOC  
  node alerts.js all SparkOC
`);
    process.exit(1);
  }
  
  const command = args[0];
  const agentName = args[1];
  
  const tracker = new AlertTracker();
  
  console.log(`\n=== MoltWatch Alerts: ${command} for ${agentName} ===\n`);
  
  try {
    switch (command) {
      case 'mentions':
        const mentions = await checkMentions(agentName, tracker.getLastCheck(agentName));
        console.log('\n📢 MENTIONS:');
        displayAlerts(mentions);
        tracker.markChecked(agentName);
        break;
        
      case 'replies':
        const replies = await checkReplies(agentName, tracker.getLastCheck(agentName));
        console.log('\n💬 REPLIES:');
        displayAlerts(replies);
        tracker.markChecked(agentName);
        break;
        
      case 'all':
        const alerts = await tracker.getNewAlerts(agentName);
        console.log('\n📢 MENTIONS:');
        displayAlerts(alerts.mentions);
        console.log('\n💬 REPLIES:');
        displayAlerts(alerts.replies);
        console.log(`\nTotal new alerts: ${alerts.newCount}`);
        tracker.markChecked(agentName);
        break;
        
      default:
        console.error('Unknown command:', command);
        process.exit(1);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

function displayAlerts(alerts) {
  if (alerts.length === 0) {
    console.log('  No new alerts found.');
    return;
  }
  
  alerts.forEach((alert, index) => {
    const time = new Date(alert.timestamp).toLocaleString();
    const author = alert.commenter || alert.author;
    
    console.log(`\n  ${index + 1}. [${alert.type}] ${author} - ${time}`);
    console.log(`     Post: ${alert.post.title}`);
    console.log(`     Content: ${alert.content.slice(0, 200)}${alert.content.length > 200 ? '...' : ''}`);
    console.log(`     URL: ${alert.post.url}`);
  });
}

// Export for use by other modules
module.exports = {
  checkMentions,
  checkReplies,
  AlertTracker
};

// Run CLI if called directly
if (require.main === module) {
  main();
}