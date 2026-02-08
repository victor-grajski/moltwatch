#!/usr/bin/env node
/**
 * MoltWatch Reputation/Trust Scoring System
 * Computes trust scores for moltbook agents from scraped data
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Tier thresholds (out of 100)
const TIERS = [
  { name: 'pillar',      emoji: '🏛️', minScore: 75 },
  { name: 'builder',     emoji: '🔨', minScore: 50 },
  { name: 'contributor', emoji: '🌱', minScore: 25 },
  { name: 'newcomer',    emoji: '🐣', minScore: 0  },
];

function getTier(score) {
  for (const tier of TIERS) {
    if (score >= tier.minScore) return tier;
  }
  return TIERS[TIERS.length - 1];
}

/**
 * Load latest snapshot
 */
function loadLatestSnapshot() {
  const latestPath = path.join(DATA_DIR, 'latest.json');
  if (!fs.existsSync(latestPath)) return null;
  const meta = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, meta.file), 'utf8'));
}

/**
 * Load all available snapshots for karma velocity analysis
 */
function loadAllSnapshots() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Compute reputation scores for all agents
 */
function computeReputationScores() {
  const snapshot = loadLatestSnapshot();
  if (!snapshot || !snapshot.posts) return [];

  const posts = snapshot.posts;
  const profiles = snapshot.agentProfiles || {};
  const now = Date.now();

  // Build per-agent data
  const agents = {};

  for (const post of posts) {
    const name = post.author?.name || post.author;
    if (!name) continue;

    if (!agents[name]) {
      agents[name] = {
        name,
        posts: [],
        submolts: new Set(),
        commentsMade: 0,       // comments this agent made on others' posts
        commentsReceived: 0,   // comments on this agent's posts
        repliesOnOwn: 0,       // this agent replying on their own posts
        totalUpvotes: 0,
      };
    }

    agents[name].posts.push(post);
    if (post.submolt?.name || post.submolt) {
      agents[name].submolts.add(post.submolt?.name || post.submolt);
    }
    agents[name].totalUpvotes += (post.upvotes || 0);
    agents[name].commentsReceived += (post.comment_count || 0);

    // Analyze embedded comments if available
    if (Array.isArray(post.comments)) {
      for (const c of post.comments) {
        const commentAuthor = c.author?.name || c.author;
        if (!commentAuthor) continue;

        // Track commenter
        if (!agents[commentAuthor]) {
          agents[commentAuthor] = {
            name: commentAuthor,
            posts: [],
            submolts: new Set(),
            commentsMade: 0,
            commentsReceived: 0,
            repliesOnOwn: 0,
            totalUpvotes: 0,
          };
        }
        agents[commentAuthor].commentsMade++;

        // Did original author reply on their own post?
        if (commentAuthor === name) {
          agents[name].repliesOnOwn++;
        }
      }
    }
  }

  // Score each agent
  const scored = [];

  for (const agent of Object.values(agents)) {
    const breakdown = computeBreakdown(agent, profiles[agent.name], now, posts.length);
    const totalScore = Math.round(
      breakdown.accountAge.score * 0.10 +
      breakdown.karmaVelocity.score * 0.15 +
      breakdown.commentToPostRatio.score * 0.20 +
      breakdown.submoltBreadth.score * 0.15 +
      breakdown.replyRate.score * 0.15 +
      breakdown.contentQuality.score * 0.25
    );

    const tier = getTier(totalScore);

    scored.push({
      name: agent.name,
      score: totalScore,
      tier: tier.name,
      tierEmoji: tier.emoji,
      postCount: agent.posts.length,
      commentsMade: agent.commentsMade,
      submoltCount: agent.submolts.size,
      breakdown,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Compute individual scoring breakdown
 */
function computeBreakdown(agent, profile, now, totalPostsInSystem) {
  // 1. Account age score (0-100)
  let accountAgeScore = 0;
  let accountAgeDetail = 'Unknown';
  
  // Use profile created_at if available, else earliest post
  let createdAt = profile?.created_at;
  if (!createdAt && agent.posts.length > 0) {
    const earliest = agent.posts.reduce((min, p) => {
      const d = new Date(p.created_at || p.created);
      return d < min ? d : min;
    }, new Date());
    createdAt = earliest.toISOString();
  }

  if (createdAt) {
    const ageDays = (now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
    // 30+ days = full score, scales linearly
    accountAgeScore = Math.min(100, Math.round((ageDays / 30) * 100));
    accountAgeDetail = `${Math.round(ageDays)} days`;
  }

  // 2. Karma velocity (0-100) — steady posting over time vs burst
  let karmaVelocityScore = 0;
  let karmaVelocityDetail = 'N/A';

  if (agent.posts.length >= 2) {
    // Group posts by day
    const dayBuckets = {};
    for (const p of agent.posts) {
      const day = (p.created_at || p.created || '').slice(0, 10);
      if (day) dayBuckets[day] = (dayBuckets[day] || 0) + 1;
    }
    const days = Object.keys(dayBuckets).sort();
    const activeDays = days.length;
    
    if (activeDays >= 2) {
      const firstDay = new Date(days[0]);
      const lastDay = new Date(days[days.length - 1]);
      const spanDays = Math.max(1, (lastDay - firstDay) / (1000 * 60 * 60 * 24));
      
      // Spread = active days / span (1.0 = posted every day, low = bursty)
      const spread = activeDays / Math.max(activeDays, spanDays);
      // Penalize single-day bursts
      const maxPerDay = Math.max(...Object.values(dayBuckets));
      const burstPenalty = maxPerDay > agent.posts.length * 0.8 ? 0.3 : 1.0;
      
      karmaVelocityScore = Math.min(100, Math.round(spread * burstPenalty * 100));
      karmaVelocityDetail = `${activeDays} active days, spread ${(spread * 100).toFixed(0)}%`;
    } else {
      karmaVelocityScore = 20;
      karmaVelocityDetail = '1 active day';
    }
  }

  // 3. Comment-to-post ratio (0-100)
  let commentToPostScore = 0;
  let commentToPostDetail = 'N/A';
  
  const totalActivity = agent.posts.length + agent.commentsMade;
  if (totalActivity > 0) {
    const ratio = agent.commentsMade / Math.max(1, agent.posts.length);
    // Ideal ratio ~2:1 comments to posts (engaged commenter)
    // 0 comments = 0, ratio >= 2 = 100
    commentToPostScore = Math.min(100, Math.round((ratio / 2) * 100));
    commentToPostDetail = `${agent.commentsMade} comments / ${agent.posts.length} posts (${ratio.toFixed(1)}:1)`;
  }

  // 4. Submolt breadth (0-100)
  let submoltBreadthScore = 0;
  const submoltCount = agent.submolts.size;
  // 5+ submolts = full score
  submoltBreadthScore = Math.min(100, Math.round((submoltCount / 5) * 100));
  const submoltBreadthDetail = `${submoltCount} unique submolts`;

  // 5. Reply rate on own posts (0-100)
  let replyRateScore = 0;
  let replyRateDetail = 'N/A';

  if (agent.commentsReceived > 0) {
    const rate = agent.repliesOnOwn / agent.commentsReceived;
    // 20%+ reply rate = full score
    replyRateScore = Math.min(100, Math.round((rate / 0.2) * 100));
    replyRateDetail = `${agent.repliesOnOwn} replies / ${agent.commentsReceived} received (${(rate * 100).toFixed(0)}%)`;
  } else if (agent.posts.length > 0) {
    replyRateDetail = 'No comments received yet';
    replyRateScore = 0;
  }

  // 6. Content quality (0-100)
  let contentQualityScore = 0;
  let contentQualityDetail = {};

  if (agent.posts.length > 0) {
    let totalLen = 0;
    let linksCount = 0;
    let codeBlockCount = 0;

    for (const p of agent.posts) {
      const content = p.content || p.title || '';
      totalLen += content.length;
      if (/https?:\/\//.test(content)) linksCount++;
      if (/```/.test(content) || /`[^`]+`/.test(content)) codeBlockCount++;
    }

    const avgLen = totalLen / agent.posts.length;
    const linkRate = linksCount / agent.posts.length;
    const codeRate = codeBlockCount / agent.posts.length;

    // Sub-scores
    const lengthScore = Math.min(100, Math.round((avgLen / 500) * 100)); // 500+ chars = full
    const linkScore = Math.min(100, Math.round(linkRate * 200));          // 50%+ posts with links = full
    const codeScore = Math.min(100, Math.round(codeRate * 200));          // 50%+ posts with code = full

    contentQualityScore = Math.round(lengthScore * 0.5 + linkScore * 0.25 + codeScore * 0.25);
    contentQualityDetail = {
      avgLength: Math.round(avgLen),
      postsWithLinks: linksCount,
      postsWithCode: codeBlockCount,
      lengthScore,
      linkScore,
      codeScore,
    };
  }

  return {
    accountAge:         { score: accountAgeScore, detail: accountAgeDetail, weight: 0.10 },
    karmaVelocity:      { score: karmaVelocityScore, detail: karmaVelocityDetail, weight: 0.15 },
    commentToPostRatio: { score: commentToPostScore, detail: commentToPostDetail, weight: 0.20 },
    submoltBreadth:     { score: submoltBreadthScore, detail: submoltBreadthDetail, weight: 0.15 },
    replyRate:          { score: replyRateScore, detail: replyRateDetail, weight: 0.15 },
    contentQuality:     { score: contentQualityScore, detail: contentQualityDetail, weight: 0.25 },
  };
}

/**
 * Get single agent reputation
 */
function getAgentReputation(agentName) {
  const all = computeReputationScores();
  const agent = all.find(a => a.name.toLowerCase() === agentName.toLowerCase());
  if (!agent) return null;
  agent.rank = all.indexOf(agent) + 1;
  agent.totalAgents = all.length;
  return agent;
}

module.exports = {
  computeReputationScores,
  getAgentReputation,
  getTier,
  TIERS,
};

// CLI
if (require.main === module) {
  const arg = process.argv[2];
  if (arg) {
    const rep = getAgentReputation(arg);
    console.log(rep ? JSON.stringify(rep, null, 2) : `Agent "${arg}" not found`);
  } else {
    const scores = computeReputationScores();
    console.log(`Top 20 agents by trust score:\n`);
    scores.slice(0, 20).forEach((a, i) => {
      console.log(`${i+1}. ${a.tierEmoji} ${a.name} — ${a.score}/100 (${a.tier}) | ${a.postCount} posts, ${a.submoltCount} submolts`);
    });
  }
}
