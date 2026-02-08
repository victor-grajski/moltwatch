#!/usr/bin/env node
/**
 * Moltbook Pulse Knowledge Graph
 * Builds relationship graphs from snapshot data
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// Common stop words to filter out of topic extraction
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
 * Extract @mentions from text
 */
function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@[\w-]+/g) || [];
  return matches.map(m => m.slice(1).toLowerCase()); // Remove @ and lowercase
}

/**
 * Extract topics (keywords) from title
 * Simple approach: words 4+ chars, not stop words, alphanumeric
 */
function extractTopics(title) {
  if (!title) return [];
  
  // Normalize: lowercase, remove special chars except spaces
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(w => 
    w.length >= 4 && 
    !STOP_WORDS.has(w) &&
    !/^\d+$/.test(w) // Exclude pure numbers
  );
  
  // Return unique topics
  return [...new Set(words)];
}

/**
 * Build knowledge graph from snapshot data
 */
function buildGraph(snapshot) {
  const nodes = {
    agents: new Map(),    // name -> { name, postCount, submolts: Set }
    submolts: new Map(),  // name -> { name, display_name, subscribers, agents: Set }
    topics: new Map()     // topic -> { topic, count, posts: [] }
  };
  
  const edges = {
    posted_in: [],        // { agent, submolt, postId, timestamp }
    mentioned: []         // { fromAgent, toAgent, postId, submolt }
  };
  
  // Process submolts from top-level array if present
  for (const submolt of snapshot.submolts || []) {
    const name = (typeof submolt === 'object' ? submolt.name : submolt)?.toLowerCase();
    if (name) {
      nodes.submolts.set(name, {
        name,
        display_name: submolt.display_name || name,
        subscribers: submolt.subscribers || 0,
        agents: new Set()
      });
    }
  }
  
  // Process posts
  for (const post of snapshot.posts || []) {
    const authorName = (typeof post.author === 'object' ? post.author?.name : post.author)?.toLowerCase();
    const submoltObj = typeof post.submolt === 'object' ? post.submolt : null;
    const submoltName = (submoltObj?.name || (typeof post.submolt === 'string' ? post.submolt : null))?.toLowerCase();
    
    // Create submolt node from post data if not already present
    if (submoltName && !nodes.submolts.has(submoltName)) {
      nodes.submolts.set(submoltName, {
        name: submoltName,
        display_name: submoltObj?.display_name || submoltName,
        subscribers: submoltObj?.subscribers || 0,
        agents: new Set()
      });
    }
    
    if (!authorName) continue;
    
    // Add/update agent node
    if (!nodes.agents.has(authorName)) {
      nodes.agents.set(authorName, {
        name: authorName,
        postCount: 0,
        submolts: new Set()
      });
    }
    const agent = nodes.agents.get(authorName);
    agent.postCount++;
    if (submoltName) {
      agent.submolts.add(submoltName);
    }
    
    // Add posted_in edge
    if (submoltName) {
      edges.posted_in.push({
        agent: authorName,
        submolt: submoltName,
        postId: post.id,
        timestamp: post.created
      });
      
      // Update submolt's agent set
      if (nodes.submolts.has(submoltName)) {
        nodes.submolts.get(submoltName).agents.add(authorName);
      }
    }
    
    // Extract and process mentions
    const mentions = extractMentions(post.title);
    for (const mentioned of mentions) {
      edges.mentioned.push({
        fromAgent: authorName,
        toAgent: mentioned,
        postId: post.id,
        submolt: submoltName
      });
      
      // Ensure mentioned agent exists as node
      if (!nodes.agents.has(mentioned)) {
        nodes.agents.set(mentioned, {
          name: mentioned,
          postCount: 0,
          submolts: new Set()
        });
      }
    }
    
    // Extract and process topics
    const topics = extractTopics(post.title);
    for (const topic of topics) {
      if (!nodes.topics.has(topic)) {
        nodes.topics.set(topic, {
          topic,
          count: 0,
          posts: []
        });
      }
      const topicNode = nodes.topics.get(topic);
      topicNode.count++;
      topicNode.posts.push({
        id: post.id,
        title: post.title,
        author: authorName,
        submolt: submoltName
      });
    }
  }
  
  return { nodes, edges, timestamp: snapshot.timestamp };
}

/**
 * Convert graph to JSON-serializable format
 */
function graphToJSON(graph) {
  return {
    timestamp: graph.timestamp,
    nodes: {
      agents: Array.from(graph.nodes.agents.values()).map(a => ({
        ...a,
        submolts: Array.from(a.submolts)
      })),
      submolts: Array.from(graph.nodes.submolts.values()).map(s => ({
        ...s,
        agents: Array.from(s.agents)
      })),
      topics: Array.from(graph.nodes.topics.values())
    },
    edges: graph.edges,
    stats: {
      agentCount: graph.nodes.agents.size,
      submoltCount: graph.nodes.submolts.size,
      topicCount: graph.nodes.topics.size,
      postedInEdges: graph.edges.posted_in.length,
      mentionedEdges: graph.edges.mentioned.length
    }
  };
}

/**
 * Load graph from JSON file or build fresh
 */
function loadOrBuildGraph() {
  const graphPath = path.join(DATA_DIR, 'graph.json');
  const latestPath = path.join(DATA_DIR, 'latest.json');
  
  // Check if graph exists and is up to date
  if (fs.existsSync(graphPath) && fs.existsSync(latestPath)) {
    const graphData = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
    const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
    
    if (graphData.timestamp === latest.timestamp) {
      return graphData;
    }
  }
  
  // Build fresh graph
  const snapshot = loadLatestSnapshot();
  const graph = buildGraph(snapshot);
  const graphJSON = graphToJSON(graph);
  
  // Save it
  fs.writeFileSync(graphPath, JSON.stringify(graphJSON, null, 2));
  
  return graphJSON;
}

// ============ QUERY FUNCTIONS ============

/**
 * Find all agents who have posted in a given submolt
 */
function findAgentsBySubmolt(submoltName) {
  const graph = loadOrBuildGraph();
  const normalizedName = submoltName.toLowerCase();
  
  const submolt = graph.nodes.submolts.find(s => s.name === normalizedName);
  if (!submolt) {
    return { error: `Submolt '${submoltName}' not found`, agents: [] };
  }
  
  // Get full agent info for each agent in this submolt
  const agents = submolt.agents.map(agentName => {
    const agent = graph.nodes.agents.find(a => a.name === agentName);
    return agent || { name: agentName, postCount: 0 };
  }).sort((a, b) => b.postCount - a.postCount);
  
  return {
    submolt: submolt.name,
    display_name: submolt.display_name,
    subscribers: submolt.subscribers,
    agentCount: agents.length,
    agents
  };
}

/**
 * Find agents related to a given agent (co-posted in same submolts, or mentioned)
 */
function findRelatedAgents(agentName) {
  const graph = loadOrBuildGraph();
  const normalizedName = agentName.toLowerCase();
  
  const agent = graph.nodes.agents.find(a => a.name === normalizedName);
  if (!agent) {
    return { error: `Agent '${agentName}' not found`, related: [] };
  }
  
  const related = new Map(); // name -> { name, connection, submolts }
  
  // Find agents who post in the same submolts
  for (const submoltName of agent.submolts) {
    const submolt = graph.nodes.submolts.find(s => s.name === submoltName);
    if (!submolt) continue;
    
    for (const otherAgent of submolt.agents) {
      if (otherAgent === normalizedName) continue;
      
      if (!related.has(otherAgent)) {
        related.set(otherAgent, {
          name: otherAgent,
          sharedSubmolts: [],
          mentionedBy: false,
          mentionedThem: false
        });
      }
      related.get(otherAgent).sharedSubmolts.push(submoltName);
    }
  }
  
  // Find mention relationships
  for (const edge of graph.edges.mentioned) {
    if (edge.fromAgent === normalizedName) {
      const targetName = edge.toAgent;
      if (!related.has(targetName)) {
        related.set(targetName, {
          name: targetName,
          sharedSubmolts: [],
          mentionedBy: false,
          mentionedThem: false
        });
      }
      related.get(targetName).mentionedThem = true;
    }
    
    if (edge.toAgent === normalizedName) {
      const sourceName = edge.fromAgent;
      if (!related.has(sourceName)) {
        related.set(sourceName, {
          name: sourceName,
          sharedSubmolts: [],
          mentionedBy: false,
          mentionedThem: false
        });
      }
      related.get(sourceName).mentionedBy = true;
    }
  }
  
  // Score and sort by relevance
  const sortedRelated = Array.from(related.values())
    .map(r => ({
      ...r,
      score: r.sharedSubmolts.length * 2 + (r.mentionedBy ? 3 : 0) + (r.mentionedThem ? 3 : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  
  return {
    agent: agent.name,
    postCount: agent.postCount,
    activeSubmolts: agent.submolts,
    relatedCount: related.size,
    topRelated: sortedRelated
  };
}

/**
 * Get the most connected agents (by post count and submolt diversity)
 */
function getMostConnectedAgents(limit = 20) {
  const graph = loadOrBuildGraph();
  
  // Score agents by connectivity
  const scored = graph.nodes.agents.map(agent => {
    // Count incoming mentions
    const incomingMentions = graph.edges.mentioned.filter(e => e.toAgent === agent.name).length;
    const outgoingMentions = graph.edges.mentioned.filter(e => e.fromAgent === agent.name).length;
    
    return {
      name: agent.name,
      postCount: agent.postCount,
      submoltCount: agent.submolts.length,
      submolts: agent.submolts,
      incomingMentions,
      outgoingMentions,
      // Connectivity score: posts + submolt diversity + mention network
      score: agent.postCount * 2 + agent.submolts.length * 3 + incomingMentions * 2 + outgoingMentions
    };
  });
  
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get trending topics from the graph
 */
function getTrendingTopics(limit = 20) {
  const graph = loadOrBuildGraph();
  
  return graph.nodes.topics
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(t => ({
      topic: t.topic,
      count: t.count,
      samplePosts: t.posts.slice(0, 3).map(p => p.title)
    }));
}

/**
 * Get graph statistics
 */
function getGraphStats() {
  const graph = loadOrBuildGraph();
  return {
    timestamp: graph.timestamp,
    ...graph.stats
  };
}

// ============ CLI ============

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'build':
      console.log('Building graph from latest snapshot...');
      const snapshot = loadLatestSnapshot();
      const graph = buildGraph(snapshot);
      const graphJSON = graphToJSON(graph);
      fs.writeFileSync(path.join(DATA_DIR, 'graph.json'), JSON.stringify(graphJSON, null, 2));
      console.log('Graph saved to data/graph.json');
      console.log('Stats:', graphJSON.stats);
      break;
      
    case 'stats':
      console.log('Graph Statistics:');
      console.log(JSON.stringify(getGraphStats(), null, 2));
      break;
      
    case 'agents':
      const submolt = args[1];
      if (!submolt) {
        console.log('Usage: node graph.js agents <submolt>');
        process.exit(1);
      }
      console.log(JSON.stringify(findAgentsBySubmolt(submolt), null, 2));
      break;
      
    case 'related':
      const agent = args[1];
      if (!agent) {
        console.log('Usage: node graph.js related <agent>');
        process.exit(1);
      }
      console.log(JSON.stringify(findRelatedAgents(agent), null, 2));
      break;
      
    case 'connected':
      const limit = parseInt(args[1]) || 20;
      console.log(`Top ${limit} most connected agents:`);
      console.log(JSON.stringify(getMostConnectedAgents(limit), null, 2));
      break;
      
    case 'topics':
      console.log('Trending topics:');
      console.log(JSON.stringify(getTrendingTopics(20), null, 2));
      break;
      
    default:
      console.log(`
Moltbook Pulse Knowledge Graph

Commands:
  build              Build/rebuild graph from latest snapshot
  stats              Show graph statistics  
  agents <submolt>   Find agents active in a submolt
  related <agent>    Find agents related to a given agent
  connected [limit]  Show most connected agents (default: 20)
  topics             Show trending topics
      `);
  }
}

module.exports = {
  buildGraph,
  loadOrBuildGraph,
  findAgentsBySubmolt,
  findRelatedAgents,
  getMostConnectedAgents,
  getTrendingTopics,
  getGraphStats
};
