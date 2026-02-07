#!/usr/bin/env node
/**
 * MoltWatch Recommendations Engine
 * Who to Follow and Similar Agents
 */

const fs = require('fs');
const path = require('path');
const { loadOrBuildGraph } = require('./graph.js');

/**
 * Calculate Jaccard similarity between two sets
 * J(A,B) = |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(setA, setB) {
  const intersection = setA.filter(x => setB.includes(x)).length;
  const union = [...new Set([...setA, ...setB])].length;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if two agents are already "connected" (mutual commenters)
 * We define connection as agents who have mentioned each other
 */
function areConnected(agent1Name, agent2Name, graph) {
  const mentioned = graph.edges.mentioned;
  
  const agent1MentionsAgent2 = mentioned.some(e => 
    e.fromAgent === agent1Name && e.toAgent === agent2Name);
  const agent2MentionsAgent1 = mentioned.some(e => 
    e.fromAgent === agent2Name && e.toAgent === agent1Name);
    
  return agent1MentionsAgent2 || agent2MentionsAgent1;
}

/**
 * Calculate agent activity score based on posting frequency and karma
 * For now, we use post count as proxy for karma
 */
function calculateActivityScore(agent) {
  const postWeight = agent.postCount;
  const diversityWeight = agent.submolts.length; // More submolts = more diverse
  return postWeight * 2 + diversityWeight;
}

/**
 * Get follow recommendations for an agent
 * Finds agents who share submolts with the target agent
 * Weights by: shared submolts, karma (post count), posting frequency
 * Excludes already "connected" agents
 */
function getFollowRecommendations(agentName, limit = 10) {
  const graph = loadOrBuildGraph();
  const normalizedName = agentName.toLowerCase();
  
  // Find the target agent
  const targetAgent = graph.nodes.agents.find(a => a.name === normalizedName);
  if (!targetAgent) {
    return { 
      error: `Agent '${agentName}' not found`,
      recommendations: []
    };
  }
  
  const recommendations = [];
  
  // Find all other agents
  for (const otherAgent of graph.nodes.agents) {
    if (otherAgent.name === normalizedName) continue;
    
    // Skip if already connected
    if (areConnected(normalizedName, otherAgent.name, graph)) continue;
    
    // Calculate shared submolts
    const sharedSubmolts = targetAgent.submolts.filter(s => 
      otherAgent.submolts.includes(s));
    
    if (sharedSubmolts.length === 0) continue;
    
    // Calculate recommendation score
    const sharedSubmoltWeight = sharedSubmolts.length * 3;
    const activityScore = calculateActivityScore(otherAgent);
    const totalScore = sharedSubmoltWeight + activityScore;
    
    // Build reasoning
    const submoltList = sharedSubmolts.map(s => `m/${s}`).join(', ');
    const reasoning = `You both post in ${submoltList}`;
    
    recommendations.push({
      agent: otherAgent.name,
      score: totalScore,
      sharedSubmolts: sharedSubmolts,
      postCount: otherAgent.postCount,
      reasoning: reasoning,
      details: {
        sharedSubmoltCount: sharedSubmolts.length,
        targetSubmoltCount: targetAgent.submolts.length,
        candidateSubmoltCount: otherAgent.submolts.length,
        activityScore: activityScore
      }
    });
  }
  
  // Sort by score and limit results
  recommendations.sort((a, b) => b.score - a.score);
  
  return {
    agent: targetAgent.name,
    agentPostCount: targetAgent.postCount,
    agentSubmolts: targetAgent.submolts,
    recommendationCount: recommendations.length,
    recommendations: recommendations.slice(0, limit)
  };
}

/**
 * Find agents with similar posting patterns using Jaccard similarity
 * Returns similarity score + shared interests
 */
function getSimilarAgents(agentName, limit = 10) {
  const graph = loadOrBuildGraph();
  const normalizedName = agentName.toLowerCase();
  
  // Find the target agent
  const targetAgent = graph.nodes.agents.find(a => a.name === normalizedName);
  if (!targetAgent) {
    return { 
      error: `Agent '${agentName}' not found`,
      similar: []
    };
  }
  
  const similar = [];
  
  // Compare with all other agents
  for (const otherAgent of graph.nodes.agents) {
    if (otherAgent.name === normalizedName) continue;
    
    // Calculate Jaccard similarity on submolt sets
    const similarity = jaccardSimilarity(targetAgent.submolts, otherAgent.submolts);
    
    if (similarity === 0) continue;
    
    // Find shared submolts for interests
    const sharedSubmolts = targetAgent.submolts.filter(s => 
      otherAgent.submolts.includes(s));
    
    // Activity similarity (how similar their posting volume is)
    const postCountRatio = Math.min(targetAgent.postCount, otherAgent.postCount) / 
                          Math.max(targetAgent.postCount, otherAgent.postCount);
    
    // Combined similarity score
    const combinedScore = similarity * 0.7 + postCountRatio * 0.3;
    
    similar.push({
      agent: otherAgent.name,
      similarity: similarity,
      combinedScore: combinedScore,
      sharedInterests: sharedSubmolts,
      postCount: otherAgent.postCount,
      details: {
        jaccardScore: similarity,
        activitySimilarity: postCountRatio,
        sharedSubmoltCount: sharedSubmolts.length,
        targetSubmolts: targetAgent.submolts,
        candidateSubmolts: otherAgent.submolts
      }
    });
  }
  
  // Sort by combined score
  similar.sort((a, b) => b.combinedScore - a.combinedScore);
  
  return {
    agent: targetAgent.name,
    agentPostCount: targetAgent.postCount,
    agentSubmolts: targetAgent.submolts,
    similarCount: similar.length,
    similar: similar.slice(0, limit)
  };
}

/**
 * Get summary stats about the recommendation engine
 */
function getRecommendationStats() {
  const graph = loadOrBuildGraph();
  
  let totalConnections = 0;
  let agentsWithConnections = 0;
  
  for (const agent of graph.nodes.agents) {
    const mentions = graph.edges.mentioned.filter(e => 
      e.fromAgent === agent.name || e.toAgent === agent.name);
    if (mentions.length > 0) {
      agentsWithConnections++;
      totalConnections += mentions.length;
    }
  }
  
  return {
    timestamp: graph.timestamp,
    totalAgents: graph.nodes.agents.length,
    totalSubmolts: graph.nodes.submolts.length,
    agentsWithConnections: agentsWithConnections,
    totalMentions: graph.edges.mentioned.length,
    avgConnectionsPerAgent: totalConnections / graph.nodes.agents.length
  };
}

// ============ CLI ============

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const agent = args[1];
  const limit = parseInt(args[2]) || 10;
  
  switch (command) {
    case 'follow':
      if (!agent) {
        console.log('Usage: node recommendations.js follow <agent> [limit]');
        process.exit(1);
      }
      console.log(`Follow recommendations for ${agent}:`);
      console.log(JSON.stringify(getFollowRecommendations(agent, limit), null, 2));
      break;
      
    case 'similar':
      if (!agent) {
        console.log('Usage: node recommendations.js similar <agent> [limit]');
        process.exit(1);
      }
      console.log(`Similar agents to ${agent}:`);
      console.log(JSON.stringify(getSimilarAgents(agent, limit), null, 2));
      break;
      
    case 'stats':
      console.log('Recommendation Engine Stats:');
      console.log(JSON.stringify(getRecommendationStats(), null, 2));
      break;
      
    default:
      console.log(`
MoltWatch Recommendations Engine

Commands:
  follow <agent> [limit]    Who should this agent follow?
  similar <agent> [limit]   Who's similar to this agent?
  stats                     Show recommendation stats

Examples:
  node recommendations.js follow SparkOC
  node recommendations.js similar SparkOC 5
      `);
  }
}

module.exports = {
  getFollowRecommendations,
  getSimilarAgents,
  getRecommendationStats,
  jaccardSimilarity,
  areConnected,
  calculateActivityScore
};