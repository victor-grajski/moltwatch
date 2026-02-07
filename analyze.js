#!/usr/bin/env node
/**
 * Moltbook Pulse Analyzer
 * Generates reports from scraped data
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

function generateReport(snapshot) {
  const { timestamp, stats, submolts, posts } = snapshot;
  
  // Top submolts by subscribers
  const topBySubscribers = [...submolts]
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, 15);
  
  // Most recently active (excluding giant default ones)
  const recentlyActive = [...submolts]
    .filter(s => s.subscribers < 1000) // Filter out mega-submolts
    .sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity))
    .slice(0, 15);
  
  // Group posts by submolt
  const postsBySubmolt = {};
  (posts || []).forEach(p => {
    const s = p.submolt || 'unknown';
    postsBySubmolt[s] = (postsBySubmolt[s] || 0) + 1;
  });
  
  const activeSubmolts = Object.entries(postsBySubmolt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Generate markdown report
  let report = `# Moltbook Pulse Report

**Generated:** ${new Date(timestamp).toUTCString()}

## 📊 Overview

| Metric | Value |
|--------|-------|
| Total Submolts | ${stats.totalSubmolts.toLocaleString()} |
| Active (24h) | ${stats.active24h.toLocaleString()} |
| Active (7d) | ${stats.active7d.toLocaleString()} |
| Recent Posts | ${stats.postsScraped} |

## 🏆 Top Submolts by Subscribers

| Rank | Submolt | Subscribers |
|------|---------|-------------|
${topBySubscribers.map((s, i) => `| ${i+1} | m/${s.name} | ${s.subscribers.toLocaleString()} |`).join('\n')}

## 🔥 Recently Active (Non-Mega)

These smaller submolts had recent activity — potential rising stars:

| Submolt | Subscribers | Last Activity |
|---------|-------------|---------------|
${recentlyActive.map(s => {
  const ago = Math.round((Date.now() - new Date(s.last_activity).getTime()) / 60000);
  const agoStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago/60)}h ago`;
  return `| m/${s.name} | ${s.subscribers} | ${agoStr} |`;
}).join('\n')}

## 📝 Where Posts Are Happening

Based on recent ${posts?.length || 0} posts:

${activeSubmolts.map(([name, count]) => `- **m/${name}**: ${count} posts`).join('\n')}

---

*Report by Moltbook Pulse • [SparkOC](https://moltbook.com/u/SparkOC)*
`;

  return report;
}

// Run if called directly
if (require.main === module) {
  try {
    const snapshot = loadLatestSnapshot();
    const report = generateReport(snapshot);
    console.log(report);
    
    // Also save to file
    const reportPath = path.join(DATA_DIR, 'report.md');
    fs.writeFileSync(reportPath, report);
    console.log(`\n✅ Report saved to ${reportPath}`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

module.exports = { loadLatestSnapshot, generateReport };
