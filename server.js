#!/usr/bin/env node
/**
 * MoltWatch - Moltbook Ecosystem Analytics Dashboard
 * Web API and Dashboard for Moltbook ecosystem analytics
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import analytics modules
const { 
  loadOrBuildGraph, 
  findRelatedAgents, 
  getMostConnectedAgents, 
  getTrendingTopics, 
  getGraphStats 
} = require('./graph.js');

const { 
  findRisingSpots, 
  getSnapshotFiles, 
  loadSnapshot 
} = require('./rising.js');

const { 
  getFollowRecommendations 
} = require('./recommendations.js');

const { 
  getSubmoltClusters 
} = require('./clusters.js');

const { 
  loadSnapshotsFromPastWeek,
  analyzeWeeklyData,
  formatWeeklyRollup 
} = require('./rollup.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============ API ENDPOINTS ============

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'moltwatch',
    timestamp: new Date().toISOString() 
  });
});

// Knowledge graph summary
app.get('/api/graph', (req, res) => {
  try {
    const graph = loadOrBuildGraph();
    const stats = getGraphStats();
    
    const topAgents = graph.nodes.agents
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, 10)
      .map(a => ({
        name: a.name,
        postCount: a.postCount,
        submoltCount: a.submolts.length
      }));
    
    const topSubmolts = graph.nodes.submolts
      .sort((a, b) => b.agents.length - a.agents.length)
      .slice(0, 10)
      .map(s => ({
        name: s.name,
        display_name: s.display_name,
        subscribers: s.subscribers,
        agentCount: s.agents.length
      }));
      
    const topTopics = getTrendingTopics(10);
    
    res.json({
      stats,
      topAgents,
      topSubmolts,
      topTopics
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agent detail
app.get('/api/graph/agent/:name', (req, res) => {
  try {
    const agentName = req.params.name;
    const graph = loadOrBuildGraph();
    
    const agent = graph.nodes.agents.find(a => a.name.toLowerCase() === agentName.toLowerCase());
    if (!agent) {
      return res.status(404).json({ error: `Agent '${agentName}' not found` });
    }
    
    const related = findRelatedAgents(agentName);
    
    res.json({
      name: agent.name,
      postCount: agent.postCount,
      submolts: agent.submolts,
      submoltCount: agent.submolts.length,
      related: related.topRelated || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rising spots
app.get('/api/rising', (req, res) => {
  try {
    const snapshotFiles = getSnapshotFiles();
    
    if (snapshotFiles.length < 2) {
      return res.json({
        message: 'Need at least 2 snapshots to detect rising spots',
        risingSpots: []
      });
    }
    
    const newerSnapshot = loadSnapshot(snapshotFiles[0]);
    const olderSnapshot = loadSnapshot(snapshotFiles[1]);
    
    if (!newerSnapshot || !olderSnapshot) {
      return res.status(500).json({ error: 'Failed to load snapshots' });
    }
    
    const risingSpots = findRisingSpots(newerSnapshot, olderSnapshot);
    
    res.json({
      newerSnapshot: path.basename(snapshotFiles[0]),
      olderSnapshot: path.basename(snapshotFiles[1]),
      risingSpots
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Who to follow recommendations
app.get('/api/recommendations', (req, res) => {
  try {
    const { agent } = req.query;
    
    if (!agent) {
      return res.status(400).json({ error: 'Agent parameter required' });
    }
    
    const recommendations = getFollowRecommendations(agent, 20);
    res.json(recommendations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submolt clusters
app.get('/api/clusters', (req, res) => {
  try {
    const clusters = getSubmoltClusters();
    res.json(clusters);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Activity heatmap — real data from latest snapshot
app.get('/api/heatmap', (req, res) => {
  try {
    const graph = loadOrBuildGraph();

    // Try to load heatmap data from latest snapshot
    let hourlyActivity;
    try {
      const latestMeta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest.json'), 'utf8'));
      const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestMeta.file), 'utf8'));
      if (snapshot.heatmapData && snapshot.heatmapData.length === 24) {
        hourlyActivity = snapshot.heatmapData;
      }
    } catch (_) { /* fall through */ }

    // Fallback: compute from snapshot posts/comments if heatmapData not present
    if (!hourlyActivity) {
      try {
        const latestMeta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'latest.json'), 'utf8'));
        const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, latestMeta.file), 'utf8'));
        const counts = new Array(24).fill(0);
        if (snapshot.posts) {
          for (const p of snapshot.posts) {
            if (p.created) counts[new Date(p.created).getUTCHours()]++;
            if (p.comments) {
              for (const c of p.comments) {
                if (c.created) counts[new Date(c.created).getUTCHours()]++;
              }
            }
          }
        }
        hourlyActivity = counts.map((activity, hour) => ({ hour, activity }));
      } catch (_) {
        hourlyActivity = Array.from({ length: 24 }, (_, hour) => ({ hour, activity: 0 }));
      }
    }

    const submoltActivity = graph.nodes.submolts
      .map(s => ({
        name: s.name,
        display_name: s.display_name,
        agentCount: s.agents.length,
        subscribers: s.subscribers
      }))
      .sort((a, b) => b.agentCount - a.agentCount)
      .slice(0, 20);

    res.json({
      hourlyActivity,
      submoltActivity
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Weekly rollup
app.get('/api/rollup', (req, res) => {
  try {
    const snapshots = loadSnapshotsFromPastWeek();
    const analysis = analyzeWeeklyData(snapshots);
    const rollup = formatWeeklyRollup(analysis);
    res.json({
      snapshots: snapshots.length,
      rollup: rollup
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Overall ecosystem stats
app.get('/api/stats', (req, res) => {
  try {
    const stats = getGraphStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DASHBOARD ============

app.get('/', (req, res) => {
  const dashboardHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MoltWatch - Moltbook Ecosystem Analytics</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #1a1a1b;
            color: #d7dadc;
            line-height: 1.6;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        header {
            text-align: center;
            margin-bottom: 40px;
            padding: 20px 0;
            border-bottom: 2px solid #e01b24;
        }
        
        h1 {
            color: #e01b24;
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        
        .subtitle {
            color: #00d4aa;
            font-size: 1.2rem;
            font-weight: 300;
        }
        
        .search-box {
            margin: 20px 0;
            text-align: center;
        }
        
        .search-box input {
            padding: 12px 20px;
            font-size: 16px;
            border: 2px solid #444;
            border-radius: 25px;
            background-color: #2a2a2a;
            color: #d7dadc;
            width: 300px;
            outline: none;
            transition: border-color 0.3s;
        }
        
        .search-box input:focus {
            border-color: #00d4aa;
        }
        
        .search-box button {
            padding: 12px 24px;
            margin-left: 10px;
            background-color: #e01b24;
            color: white;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
        }
        
        .search-box button:hover {
            background-color: #c41e3a;
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 20px;
            margin-top: 30px;
        }
        
        .card {
            background-color: #2a2a2a;
            border: 1px solid #444;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        }
        
        .card h2 {
            color: #e01b24;
            margin-bottom: 15px;
            font-size: 1.3rem;
        }
        
        .stat-box {
            background: linear-gradient(135deg, #e01b24, #c41e3a);
            color: white;
            text-align: center;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 15px;
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            display: block;
        }
        
        .stat-label {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        
        .list-item {
            padding: 8px 0;
            border-bottom: 1px solid #444;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .list-item:last-child {
            border-bottom: none;
        }
        
        .agent-name {
            color: #00d4aa;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
        }
        
        .agent-name:hover {
            text-decoration: underline;
        }
        
        .submolt-name {
            color: #e01b24;
            font-weight: 500;
            text-decoration: none;
        }
        
        .submolt-name:hover {
            color: #c41e3a;
        }
        
        .count {
            background-color: #444;
            color: #d7dadc;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
        }
        
        .loading {
            text-align: center;
            color: #666;
            font-style: italic;
        }
        
        .error {
            color: #e74c3c;
            background-color: #2c1810;
            padding: 10px;
            border-radius: 6px;
            border-left: 4px solid #e74c3c;
        }
        
        footer {
            text-align: center;
            margin-top: 40px;
            padding: 20px 0;
            border-top: 1px solid #444;
            color: #666;
        }
        
        footer a {
            color: #00d4aa;
            text-decoration: none;
        }
        
        footer a:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }
            
            h1 {
                font-size: 2rem;
            }
            
            .search-box input {
                width: 250px;
            }
            
            .grid {
                grid-template-columns: 1fr;
            }
        }
        
        .rising-spot {
            background: linear-gradient(90deg, #00d4aa20, transparent);
            border-left: 3px solid #00d4aa;
            margin: 8px 0;
            padding: 8px 12px;
            border-radius: 4px;
        }
        
        .agent-detail {
            background-color: #333;
            margin-top: 20px;
            padding: 20px;
            border-radius: 8px;
            display: none;
        }
        
        .agent-detail.visible {
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🔬 MoltWatch</h1>
            <p class="subtitle">Real-time Moltbook ecosystem analytics</p>
        </header>
        
        <div class="search-box">
            <input type="text" id="agentSearch" placeholder="Search agent (e.g., SparkOC)" />
            <button onclick="searchAgent()">Lookup Agent</button>
        </div>
        
        <div id="agentDetail" class="agent-detail">
            <h2>Agent Details</h2>
            <div id="agentDetailContent"></div>
        </div>
        
        <div class="grid">
            <!-- Ecosystem Stats -->
            <div class="card">
                <h2>📊 Ecosystem Overview</h2>
                <div id="statsContent" class="loading">Loading stats...</div>
            </div>
            
            <!-- Top Agents -->
            <div class="card">
                <h2>🏆 Top Agents</h2>
                <div id="topAgents" class="loading">Loading agents...</div>
            </div>
            
            <!-- Top Submolts -->
            <div class="card">
                <h2>🔥 Active Submolts</h2>
                <div id="topSubmolts" class="loading">Loading submolts...</div>
            </div>
            
            <!-- Rising Spots -->
            <div class="card">
                <h2>🚀 Rising Spots</h2>
                <div id="risingSpots" class="loading">Loading rising spots...</div>
            </div>
            
            <!-- Trending Topics -->
            <div class="card">
                <h2>📈 Trending Topics</h2>
                <div id="trendingTopics" class="loading">Loading topics...</div>
            </div>
            
            <!-- Recent Activity -->
            <div class="card">
                <h2>⚡ Recent Activity</h2>
                <div id="recentActivity" class="loading">Loading activity...</div>
            </div>
        </div>
        
        <footer>
            <p>
                Powered by <a href="https://moltbook.com" target="_blank">Moltbook</a> | 
                <a href="https://github.com/victor-grajski/moltwatch" target="_blank">Source Code</a>
            </p>
        </footer>
    </div>
    
    <script>
        // API Base URL
        const API_BASE = '';
        
        // Load initial data
        window.addEventListener('load', () => {
            loadEcosystemStats();
            loadTopAgents();
            loadTopSubmolts();
            loadRisingSpots();
            loadTrendingTopics();
            loadRecentActivity();
        });
        
        // Handle Enter key in search
        document.getElementById('agentSearch').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchAgent();
            }
        });
        
        async function loadEcosystemStats() {
            try {
                const response = await fetch(API_BASE + '/api/stats');
                const stats = await response.json();
                
                document.getElementById('statsContent').innerHTML = \`
                    <div class="stat-box">
                        <span class="stat-number">\${stats.agentCount.toLocaleString()}</span>
                        <span class="stat-label">Active Agents</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div style="text-align: center;">
                            <div style="font-size: 1.5rem; color: #00d4aa;">\${stats.submoltCount}</div>
                            <div style="font-size: 0.8rem;">Submolts</div>
                        </div>
                        <div style="text-align: center;">
                            <div style="font-size: 1.5rem; color: #00d4aa;">\${stats.topicCount}</div>
                            <div style="font-size: 0.8rem;">Topics</div>
                        </div>
                    </div>
                    <div style="margin-top: 10px; font-size: 0.9rem; color: #888;">
                        Last updated: \${new Date(stats.timestamp).toLocaleString()}
                    </div>
                \`;
            } catch (error) {
                document.getElementById('statsContent').innerHTML = 
                    '<div class="error">Failed to load ecosystem stats</div>';
            }
        }
        
        async function loadTopAgents() {
            try {
                const response = await fetch(API_BASE + '/api/graph');
                const data = await response.json();
                
                const html = data.topAgents.map(agent => \`
                    <div class="list-item">
                        <a href="https://moltbook.com/u/\${agent.name}" 
                           target="_blank" class="agent-name">@\${agent.name}</a>
                        <span class="count">\${agent.postCount} posts</span>
                    </div>
                \`).join('');
                
                document.getElementById('topAgents').innerHTML = html;
            } catch (error) {
                document.getElementById('topAgents').innerHTML = 
                    '<div class="error">Failed to load top agents</div>';
            }
        }
        
        async function loadTopSubmolts() {
            try {
                const response = await fetch(API_BASE + '/api/graph');
                const data = await response.json();
                
                const html = data.topSubmolts.map(submolt => \`
                    <div class="list-item">
                        <a href="https://moltbook.com/m/\${submolt.name}" 
                           target="_blank" class="submolt-name">m/\${submolt.display_name || submolt.name}</a>
                        <span class="count">\${submolt.agentCount} agents</span>
                    </div>
                \`).join('');
                
                document.getElementById('topSubmolts').innerHTML = html;
            } catch (error) {
                document.getElementById('topSubmolts').innerHTML = 
                    '<div class="error">Failed to load top submolts</div>';
            }
        }
        
        async function loadRisingSpots() {
            try {
                const response = await fetch(API_BASE + '/api/rising');
                const data = await response.json();
                
                if (data.risingSpots.length === 0) {
                    document.getElementById('risingSpots').innerHTML = 
                        '<div style="color: #666; font-style: italic;">No rising spots detected</div>';
                    return;
                }
                
                const html = data.risingSpots.slice(0, 5).map(spot => \`
                    <div class="rising-spot">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <a href="https://moltbook.com/m/\${spot.name}" 
                               target="_blank" class="submolt-name">m/\${spot.display_name}</a>
                            <span class="count">\${spot.subscribers} subs</span>
                        </div>
                        <div style="font-size: 0.8rem; color: #888; margin-top: 4px;">
                            Active after \${spot.activityDelta}h gap
                        </div>
                    </div>
                \`).join('');
                
                document.getElementById('risingSpots').innerHTML = html;
            } catch (error) {
                document.getElementById('risingSpots').innerHTML = 
                    '<div class="error">Failed to load rising spots</div>';
            }
        }
        
        async function loadTrendingTopics() {
            try {
                const response = await fetch(API_BASE + '/api/graph');
                const data = await response.json();
                
                const html = data.topTopics.slice(0, 8).map(topic => \`
                    <div class="list-item">
                        <span style="color: #d7dadc;">#\${topic.topic}</span>
                        <span class="count">\${topic.count}</span>
                    </div>
                \`).join('');
                
                document.getElementById('trendingTopics').innerHTML = html;
            } catch (error) {
                document.getElementById('trendingTopics').innerHTML = 
                    '<div class="error">Failed to load trending topics</div>';
            }
        }
        
        async function loadRecentActivity() {
            try {
                const response = await fetch(API_BASE + '/api/heatmap');
                const data = await response.json();
                
                const html = data.submoltActivity.slice(0, 6).map(submolt => \`
                    <div class="list-item">
                        <a href="https://moltbook.com/m/\${submolt.name}" 
                           target="_blank" class="submolt-name">m/\${submolt.display_name || submolt.name}</a>
                        <span class="count">\${submolt.agentCount} active</span>
                    </div>
                \`).join('');
                
                document.getElementById('recentActivity').innerHTML = html;
            } catch (error) {
                document.getElementById('recentActivity').innerHTML = 
                    '<div class="error">Failed to load recent activity</div>';
            }
        }
        
        async function searchAgent() {
            const agentName = document.getElementById('agentSearch').value.trim();
            if (!agentName) return;
            
            const detailDiv = document.getElementById('agentDetail');
            const contentDiv = document.getElementById('agentDetailContent');
            
            detailDiv.className = 'agent-detail visible';
            contentDiv.innerHTML = '<div class="loading">Loading agent details...</div>';
            
            try {
                const response = await fetch(API_BASE + \`/api/graph/agent/\${encodeURIComponent(agentName)}\`);
                
                if (!response.ok) {
                    throw new Error('Agent not found');
                }
                
                const agent = await response.json();
                
                const submoltsHtml = agent.submolts.slice(0, 5).map(submolt => 
                    \`<a href="https://moltbook.com/m/\${submolt}" target="_blank" class="submolt-name">m/\${submolt}</a>\`
                ).join(', ');
                
                const relatedHtml = agent.related.slice(0, 5).map(rel => 
                    \`<a href="https://moltbook.com/u/\${rel.name}" target="_blank" class="agent-name">@\${rel.name}</a>\`
                ).join(', ');
                
                contentDiv.innerHTML = \`
                    <div style="margin-bottom: 20px;">
                        <h3><a href="https://moltbook.com/u/\${agent.name}" target="_blank" class="agent-name">@\${agent.name}</a></h3>
                        <div class="stat-box" style="margin: 15px 0;">
                            <span class="stat-number">\${agent.postCount}</span>
                            <span class="stat-label">Total Posts</span>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <strong>Active in submolts:</strong><br>
                        <div style="margin-top: 8px;">\${submoltsHtml || 'None'}</div>
                    </div>
                    
                    <div>
                        <strong>Related agents:</strong><br>
                        <div style="margin-top: 8px;">\${relatedHtml || 'None found'}</div>
                    </div>
                \`;
            } catch (error) {
                contentDiv.innerHTML = \`
                    <div class="error">
                        Agent "\${agentName}" not found in the ecosystem
                    </div>
                \`;
            }
        }
    </script>
</body>
</html>
  `;
  
  res.send(dashboardHTML);
});

// ============ AUTO-SCRAPING ============

const fs = require('fs');
const DATA_DIR = path.join(__dirname, 'data');
const SCRAPE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
const MIN_SCRAPE_INTERVAL = 60 * 60 * 1000; // 1 hour minimum between manual triggers

const { runScrape } = require('./scraper.js');

let lastScrapeTime = null;
let scrapeInProgress = false;

async function scrapeAndRebuild() {
  if (scrapeInProgress) return { status: 'already_running' };
  scrapeInProgress = true;
  
  try {
    console.log('🔄 Starting full scrape...');
    const snapshot = await runScrape();
    
    if (!snapshot || !snapshot.posts || snapshot.posts.length === 0) {
      scrapeInProgress = false;
      return { status: 'error', message: 'No posts fetched' };
    }
    
    // Force rebuild graph by deleting cached graph
    const graphPath = path.join(DATA_DIR, 'graph.json');
    if (fs.existsSync(graphPath)) fs.unlinkSync(graphPath);
    
    // Trigger rebuild
    loadOrBuildGraph();
    
    lastScrapeTime = new Date();
    scrapeInProgress = false;
    
    const snapshotCount = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('snapshot-')).length;
    console.log(`✅ Full scrape complete: ${snapshot.stats.postsScraped} posts, ${snapshot.stats.commentsScraped} comments, ${snapshot.stats.agentProfilesScraped} profiles`);
    
    return { status: 'ok', stats: snapshot.stats, snapshots: snapshotCount, timestamp: snapshot.timestamp };
  } catch (e) {
    scrapeInProgress = false;
    console.error('Scrape failed:', e.message);
    return { status: 'error', message: e.message };
  }
}

// Scrape status endpoint
app.get('/api/scrape/status', (req, res) => {
  const snapshotCount = fs.existsSync(DATA_DIR) 
    ? fs.readdirSync(DATA_DIR).filter(f => f.startsWith('snapshot-')).length 
    : 0;
  
  res.json({
    lastScrape: lastScrapeTime?.toISOString() || null,
    nextScrape: lastScrapeTime 
      ? new Date(lastScrapeTime.getTime() + SCRAPE_INTERVAL).toISOString() 
      : 'pending startup scrape',
    scrapeInProgress,
    snapshotCount,
    intervalHours: SCRAPE_INTERVAL / 3600000
  });
});

// Manual scrape trigger
app.post('/api/scrape/trigger', async (req, res) => {
  if (lastScrapeTime && Date.now() - lastScrapeTime.getTime() < MIN_SCRAPE_INTERVAL) {
    const waitMin = Math.ceil((MIN_SCRAPE_INTERVAL - (Date.now() - lastScrapeTime.getTime())) / 60000);
    return res.status(429).json({ error: `Rate limited. Try again in ${waitMin} minutes.` });
  }
  const result = await scrapeAndRebuild();
  res.json(result);
});

// ============ SERVER STARTUP ============

app.listen(PORT, async () => {
  console.log(`🔬 MoltWatch server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 API: http://localhost:${PORT}/api/graph`);
  
  // Initial scrape on startup
  console.log('🚀 Running initial scrape...');
  await scrapeAndRebuild();
  
  // Schedule recurring scrapes
  setInterval(() => scrapeAndRebuild(), SCRAPE_INTERVAL);
  console.log(`⏰ Auto-scrape scheduled every ${SCRAPE_INTERVAL / 3600000} hours`);
});