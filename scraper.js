#!/usr/bin/env node
/**
 * Moltbook Full Scraper
 * Complete data collection: posts, comments, agent profiles, submolts
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://www.moltbook.com/api/v1';
const API_KEY = process.env.MOLTBOOK_API_KEY || 'moltbook_sk_FrfNTK2tHCYxm004W3aWm12G5tecUWyV';
const DATA_DIR = path.join(__dirname, 'data');
const RATE_LIMIT_MS = 200;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function fetchAPI(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ SUBMOLTS ============

async function scrapeSubmolts() {
  console.log('📦 Scraping submolts...');
  const submolts = [];

  for (let offset = 0; ; offset += 100) {
    const data = await fetchAPI('/submolts', { limit: 100, offset });
    if (!data.submolts || data.submolts.length === 0) break;
    submolts.push(...data.submolts);
    console.log(`  ${submolts.length} submolts...`);
    await sleep(RATE_LIMIT_MS);
  }

  console.log(`  ✅ ${submolts.length} submolts total`);
  return submolts;
}

// ============ POSTS (full pagination) ============

async function scrapeAllPosts() {
  console.log('📝 Scraping ALL posts...');
  const allPosts = [];

  for (let offset = 0; ; offset += 50) {
    try {
      const data = await fetchAPI('/posts', { sort: 'new', limit: 50, offset });
      if (!data.posts || data.posts.length === 0) break;
      allPosts.push(...data.posts);

      if (offset % 500 === 0 || !data.has_more) {
        console.log(`  ${allPosts.length} posts (offset ${offset})...`);
      }

      if (!data.has_more) break;
      await sleep(RATE_LIMIT_MS);
    } catch (e) {
      console.error(`  Error at offset ${offset}: ${e.message}`);
      break;
    }
  }

  console.log(`  ✅ ${allPosts.length} posts total`);
  return allPosts;
}

// ============ COMMENTS ============

async function scrapeCommentsForPost(postId) {
  try {
    const data = await fetchAPI(`/posts/${postId}/comments`, { sort: 'new' });
    return data.comments || data || [];
  } catch (e) {
    // Some posts may not have comments or endpoint may 404
    return [];
  }
}

async function scrapeAllComments(posts) {
  console.log(`💬 Scraping comments for ${posts.length} posts...`);
  const postComments = {};
  let totalComments = 0;
  let i = 0;

  for (const post of posts) {
    const postId = post.id;
    // Only fetch if post has comments
    if (post.comment_count > 0) {
      const comments = await scrapeCommentsForPost(postId);
      if (comments.length > 0) {
        postComments[postId] = comments;
        totalComments += comments.length;
      }
      await sleep(RATE_LIMIT_MS);
    }
    i++;
    if (i % 100 === 0) {
      console.log(`  ${i}/${posts.length} posts checked, ${totalComments} comments found...`);
    }
  }

  console.log(`  ✅ ${totalComments} comments from ${Object.keys(postComments).length} posts`);
  return postComments;
}

// ============ AGENT PROFILES ============

async function scrapeAgentProfiles(posts, postComments) {
  // Collect unique author names from posts and comments
  const authorNames = new Set();

  for (const post of posts) {
    if (post.author?.name) authorNames.add(post.author.name);
  }

  for (const comments of Object.values(postComments)) {
    for (const comment of comments) {
      if (comment.author?.name) authorNames.add(comment.author.name);
    }
  }

  console.log(`👤 Scraping ${authorNames.size} agent profiles...`);
  const profiles = {};
  let i = 0;

  for (const name of authorNames) {
    try {
      const data = await fetchAPI('/agents/profile', { name });
      profiles[name] = {
        name: data.name || name,
        karma: data.karma,
        follower_count: data.follower_count,
        following_count: data.following_count,
        created_at: data.created_at,
      };
    } catch (e) {
      // Profile might not exist or be private
      profiles[name] = { name, error: e.message };
    }
    await sleep(RATE_LIMIT_MS);
    i++;
    if (i % 50 === 0) {
      console.log(`  ${i}/${authorNames.size} profiles...`);
    }
  }

  console.log(`  ✅ ${Object.keys(profiles).length} profiles fetched`);
  return profiles;
}

// ============ HEATMAP DATA ============

function buildHeatmapData(posts, postComments) {
  // Count activity per hour (0-23) from post and comment timestamps
  const hourCounts = new Array(24).fill(0);

  for (const post of posts) {
    if (post.created_at) {
      const hour = new Date(post.created_at).getUTCHours();
      hourCounts[hour]++;
    }
  }

  for (const comments of Object.values(postComments)) {
    for (const comment of comments) {
      if (comment.created_at) {
        const hour = new Date(comment.created_at).getUTCHours();
        hourCounts[hour]++;
      }
    }
  }

  return hourCounts.map((count, hour) => ({ hour, activity: count }));
}

// ============ FULL SCRAPE ============

async function runScrape() {
  const timestamp = new Date().toISOString();
  const now = new Date();
  console.log(`\n=== Full Moltbook Scrape: ${timestamp} ===\n`);

  // 1. Submolts
  const submolts = await scrapeSubmolts();

  // 2. All posts
  const rawPosts = await scrapeAllPosts();

  // 3. Comments for all posts
  const postComments = await scrapeAllComments(rawPosts);

  // 4. Agent profiles
  const agentProfiles = await scrapeAgentProfiles(rawPosts, postComments);

  // 5. Build heatmap
  const heatmapData = buildHeatmapData(rawPosts, postComments);

  // 6. Categorize submolts
  const nowMs = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const active24h = submolts.filter(s =>
    s.last_activity_at && (nowMs - new Date(s.last_activity_at).getTime()) < day
  );
  const active7d = submolts.filter(s =>
    s.last_activity_at && (nowMs - new Date(s.last_activity_at).getTime()) < 7 * day
  );

  // 7. Build snapshot
  const snapshot = {
    timestamp,
    stats: {
      totalSubmolts: submolts.length,
      active24h: active24h.length,
      active7d: active7d.length,
      postsScraped: rawPosts.length,
      commentsScraped: Object.values(postComments).reduce((sum, c) => sum + c.length, 0),
      agentProfilesScraped: Object.keys(agentProfiles).length,
    },
    submolts: submolts.map(s => ({
      name: s.name,
      display_name: s.display_name,
      subscribers: s.subscriber_count,
      last_activity: s.last_activity_at,
      created: s.created_at
    })),
    posts: rawPosts.map(p => ({
      id: p.id,
      title: p.title,
      submolt: p.submolt?.name,
      author: p.author?.name,
      upvotes: p.upvote_count,
      comment_count: p.comment_count,
      created: p.created_at,
      comments: postComments[p.id] ? postComments[p.id].map(c => ({
        id: c.id,
        author: c.author?.name,
        body: c.body || c.content,
        upvotes: c.upvote_count,
        created: c.created_at,
      })) : [],
    })),
    agentProfiles,
    heatmapData,
  };

  // 8. Save
  const filename = `snapshot-${now.toISOString().replace(/[:.]/g, '-').slice(0, 16)}.json`;
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify({
    timestamp,
    file: filename,
    stats: snapshot.stats
  }, null, 2));

  console.log(`\n✅ Snapshot saved: ${filename}`);
  console.log(`   Posts: ${snapshot.stats.postsScraped}, Comments: ${snapshot.stats.commentsScraped}, Profiles: ${snapshot.stats.agentProfilesScraped}`);
  console.log('\n=== Scrape complete ===\n');

  return snapshot;
}

// ============ INCREMENTAL SCRAPE ============

async function runIncrementalScrape() {
  const timestamp = new Date().toISOString();
  console.log(`\n=== Incremental Moltbook Scrape: ${timestamp} ===\n`);

  // Load existing snapshot to merge into
  let existing = null;
  try {
    const latestMeta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest.json'), 'utf8'));
    existing = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestMeta.file), 'utf8'));
  } catch (_) {}

  if (!existing) {
    console.log('  No existing snapshot found, falling back to full scrape');
    return runScrape();
  }

  // 1. Fetch recent posts (limit 50)
  console.log('📝 Fetching recent posts...');
  let recentPosts = [];
  try {
    const data = await fetchAPI('/posts', { sort: 'new', limit: 50 });
    recentPosts = data.posts || [];
  } catch (e) {
    console.error('  Error fetching recent posts:', e.message);
  }
  console.log(`  ✅ ${recentPosts.length} recent posts fetched`);

  // 2. Comments for recent posts
  const postComments = await scrapeAllComments(recentPosts);

  // 3. Find new authors not already in snapshot
  const existingAuthors = new Set(Object.keys(existing.agentProfiles || {}));
  const newAuthors = new Set();
  for (const post of recentPosts) {
    if (post.author?.name && !existingAuthors.has(post.author.name)) {
      newAuthors.add(post.author.name);
    }
  }
  for (const comments of Object.values(postComments)) {
    for (const c of comments) {
      if (c.author?.name && !existingAuthors.has(c.author.name)) {
        newAuthors.add(c.author.name);
      }
    }
  }

  console.log(`👤 Fetching ${newAuthors.size} new agent profiles...`);
  const newProfiles = {};
  for (const name of newAuthors) {
    try {
      const data = await fetchAPI('/agents/profile', { name });
      newProfiles[name] = {
        name: data.name || name,
        karma: data.karma,
        follower_count: data.follower_count,
        following_count: data.following_count,
        created_at: data.created_at,
      };
    } catch (e) {
      newProfiles[name] = { name, error: e.message };
    }
    await sleep(RATE_LIMIT_MS);
  }

  // 4. Update submolts
  const submolts = await scrapeSubmolts();

  // 5. Merge: add new posts, update existing posts if they appear in recent
  const existingPostMap = new Map();
  for (const p of existing.posts) {
    existingPostMap.set(p.id, p);
  }

  const recentFormatted = recentPosts.map(p => ({
    id: p.id,
    title: p.title,
    submolt: p.submolt?.name,
    author: p.author?.name,
    upvotes: p.upvote_count,
    comment_count: p.comment_count,
    created: p.created_at,
    comments: postComments[p.id] ? postComments[p.id].map(c => ({
      id: c.id,
      author: c.author?.name,
      body: c.body || c.content,
      upvotes: c.upvote_count,
      created: c.created_at,
    })) : [],
  }));

  // Overwrite/add recent posts into existing
  for (const p of recentFormatted) {
    existingPostMap.set(p.id, p);
  }

  const mergedPosts = Array.from(existingPostMap.values())
    .sort((a, b) => new Date(b.created) - new Date(a.created));

  // Merge profiles
  const mergedProfiles = { ...existing.agentProfiles, ...newProfiles };

  // Categorize submolts
  const nowMs = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const active24h = submolts.filter(s =>
    s.last_activity_at && (nowMs - new Date(s.last_activity_at).getTime()) < day
  );
  const active7d = submolts.filter(s =>
    s.last_activity_at && (nowMs - new Date(s.last_activity_at).getTime()) < 7 * day
  );

  // Build heatmap from merged posts
  const mergedPostComments = {};
  for (const p of mergedPosts) {
    if (p.comments && p.comments.length > 0) {
      mergedPostComments[p.id] = p.comments;
    }
  }
  const heatmapData = buildHeatmapData(
    mergedPosts.map(p => ({ created_at: p.created })),
    mergedPostComments
  );

  const snapshot = {
    timestamp,
    stats: {
      totalSubmolts: submolts.length,
      active24h: active24h.length,
      active7d: active7d.length,
      postsScraped: mergedPosts.length,
      commentsScraped: mergedPosts.reduce((sum, p) => sum + (p.comments?.length || 0), 0),
      agentProfilesScraped: Object.keys(mergedProfiles).length,
      incrementalNewPosts: recentPosts.length,
      incrementalNewProfiles: newAuthors.size,
    },
    submolts: submolts.map(s => ({
      name: s.name,
      display_name: s.display_name,
      subscribers: s.subscriber_count,
      last_activity: s.last_activity_at,
      created: s.created_at
    })),
    posts: mergedPosts,
    agentProfiles: mergedProfiles,
    heatmapData,
  };

  // Save
  const now = new Date();
  const filename = `snapshot-${now.toISOString().replace(/[:.]/g, '-').slice(0, 16)}.json`;
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(DATA_DIR, 'latest.json'), JSON.stringify({
    timestamp,
    file: filename,
    stats: snapshot.stats
  }, null, 2));

  console.log(`\n✅ Incremental snapshot saved: ${filename}`);
  console.log(`   Merged posts: ${mergedPosts.length}, New profiles: ${newAuthors.size}`);
  console.log('\n=== Incremental scrape complete ===\n');

  return snapshot;
}

// Run if called directly
if (require.main === module) {
  runScrape().catch(e => {
    console.error('Scrape failed:', e);
    process.exit(1);
  });
}

module.exports = { runScrape, runIncrementalScrape, fetchAPI, scrapeSubmolts, scrapeAllPosts, scrapeAllComments, scrapeAgentProfiles, buildHeatmapData };
