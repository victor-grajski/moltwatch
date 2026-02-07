#!/usr/bin/env node
/**
 * Moltbook Pulse Scraper
 * Light-touch data collection for ecosystem visibility
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://www.moltbook.com/api/v1';
const API_KEY = process.env.MOLTBOOK_API_KEY || 'moltbook_sk_FrfNTK2tHCYxm004W3aWm12G5tecUWyV';
const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function fetchAPI(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  
  return res.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeSubmolts(maxOffset = 2000) {
  console.log('Scraping submolts (up to offset', maxOffset + ')...');
  const submolts = [];
  
  for (let offset = 0; offset < maxOffset; offset += 100) {
    const data = await fetchAPI('/submolts', { limit: 100, offset });
    if (!data.submolts || data.submolts.length === 0) break;
    
    submolts.push(...data.submolts);
    console.log(`  Fetched ${submolts.length} submolts...`);
    
    // Be nice - small delay between requests
    await sleep(200);
  }
  
  return submolts;
}

async function scrapeGlobalPosts(limit = 100) {
  try {
    const data = await fetchAPI('/posts', { limit });
    return data.posts || [];
  } catch (e) {
    console.error('Error fetching global posts:', e.message);
    return [];
  }
}

async function runScrape() {
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split('T')[0];
  
  console.log(`\n=== Moltbook Pulse Scrape: ${timestamp} ===\n`);
  
  // 1. Get all active submolts
  const submolts = await scrapeSubmolts(2000);
  console.log(`\nTotal submolts fetched: ${submolts.length}`);
  
  // 2. Categorize by activity
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  
  const active24h = submolts.filter(s => 
    s.last_activity_at && (now - new Date(s.last_activity_at).getTime()) < day
  );
  const active7d = submolts.filter(s => 
    s.last_activity_at && (now - new Date(s.last_activity_at).getTime()) < 7 * day
  );
  
  console.log(`Active in 24h: ${active24h.length}`);
  console.log(`Active in 7d: ${active7d.length}`);
  
  // 3. Get recent global posts
  console.log('\nFetching recent global posts...');
  const posts = await scrapeGlobalPosts(100);
  console.log(`  Got ${posts.length} posts`);
  
  // 4. Save snapshot
  const snapshot = {
    timestamp,
    stats: {
      totalSubmolts: submolts.length,
      active24h: active24h.length,
      active7d: active7d.length,
      postsScraped: posts.length
    },
    submolts: submolts.map(s => ({
      name: s.name,
      display_name: s.display_name,
      subscribers: s.subscriber_count,
      last_activity: s.last_activity_at,
      created: s.created_at
    })),
    posts: posts.map(p => ({
      id: p.id,
      title: p.title,
      submolt: p.submolt?.name,
      author: p.author?.name,
      upvotes: p.upvote_count,
      comments: p.comment_count,
      created: p.created_at
    }))
  };
  
  const snapshotFile = path.join(DATA_DIR, `snapshot-${dateStr}.json`);
  fs.writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));
  console.log(`\nSnapshot saved: ${snapshotFile}`);
  
  // 5. Update latest pointer
  const latestFile = path.join(DATA_DIR, 'latest.json');
  fs.writeFileSync(latestFile, JSON.stringify({
    timestamp,
    file: `snapshot-${dateStr}.json`,
    stats: snapshot.stats
  }, null, 2));
  
  console.log('\n=== Scrape complete ===\n');
  return snapshot;
}

// Run if called directly
if (require.main === module) {
  runScrape().catch(e => {
    console.error('Scrape failed:', e);
    process.exit(1);
  });
}

module.exports = { runScrape, fetchAPI, scrapeSubmolts, scrapeGlobalPosts };
