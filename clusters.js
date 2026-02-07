#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Submolt Clustering System for MoltWatch
 * Analyzes agent overlap between submolts to find related communities
 */

// Load graph data
function loadGraph() {
    const graphPath = path.join(__dirname, 'data', 'graph.json');
    if (!fs.existsSync(graphPath)) {
        throw new Error('graph.json not found in data/ directory');
    }
    
    const data = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    return data;
}

/**
 * Calculate Jaccard similarity between two sets
 * @param {Set} setA 
 * @param {Set} setB 
 * @returns {number} Similarity score between 0 and 1
 */
function jaccardSimilarity(setA, setB) {
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
}

/**
 * Get submolts similar to a given submolt based on agent overlap
 * @param {string} submoltName - Name of the target submolt
 * @param {number} limit - Maximum number of results (default: 10)
 * @returns {Array} Ranked list of similar submolts
 */
function getSimilarSubmolts(submoltName, limit = 10) {
    const graph = loadGraph();
    
    // Find the target submolt
    const targetSubmolt = graph.nodes.submolts.find(s => s.name === submoltName);
    if (!targetSubmolt) {
        throw new Error(`Submolt '${submoltName}' not found`);
    }
    
    const targetAgents = new Set(targetSubmolt.agents);
    const similarities = [];
    
    // Compare with all other submolts
    for (const submolt of graph.nodes.submolts) {
        if (submolt.name === submoltName) continue;
        
        const otherAgents = new Set(submolt.agents);
        const similarity = jaccardSimilarity(targetAgents, otherAgents);
        
        if (similarity > 0) {
            const sharedAgents = [...targetAgents].filter(agent => otherAgents.has(agent));
            similarities.push({
                name: submolt.name,
                displayName: submolt.display_name,
                similarity: similarity,
                sharedAgents: sharedAgents.length,
                sharedAgentsList: sharedAgents
            });
        }
    }
    
    // Sort by similarity and return top results
    similarities.sort((a, b) => b.similarity - a.similarity);
    return similarities.slice(0, limit);
}

/**
 * Group all submolts into clusters based on agent overlap
 * @param {number} minSimilarity - Minimum similarity threshold (default: 0.2)
 * @returns {Object} Cluster map with cluster names as keys and submolt arrays as values
 */
function getSubmoltClusters(minSimilarity = 0.2) {
    const graph = loadGraph();
    const submolts = graph.nodes.submolts;
    const clusters = new Map();
    const processed = new Set();
    
    // Build similarity matrix
    const similarities = new Map();
    for (let i = 0; i < submolts.length; i++) {
        for (let j = i + 1; j < submolts.length; j++) {
            const submolt1 = submolts[i];
            const submolt2 = submolts[j];
            
            const agents1 = new Set(submolt1.agents);
            const agents2 = new Set(submolt2.agents);
            const similarity = jaccardSimilarity(agents1, agents2);
            
            if (similarity >= minSimilarity) {
                const key = `${submolt1.name}-${submolt2.name}`;
                similarities.set(key, {
                    submolt1: submolt1.name,
                    submolt2: submolt2.name,
                    similarity: similarity
                });
            }
        }
    }
    
    // Group connected submolts into clusters
    for (const submolt of submolts) {
        if (processed.has(submolt.name)) continue;
        
        // Find all submolts connected to this one
        const cluster = new Set([submolt.name]);
        const queue = [submolt.name];
        
        while (queue.length > 0) {
            const current = queue.shift();
            processed.add(current);
            
            // Find all submolts similar to current
            for (const [key, sim] of similarities) {
                if (sim.submolt1 === current && !cluster.has(sim.submolt2)) {
                    cluster.add(sim.submolt2);
                    queue.push(sim.submolt2);
                } else if (sim.submolt2 === current && !cluster.has(sim.submolt1)) {
                    cluster.add(sim.submolt1);
                    queue.push(sim.submolt1);
                }
            }
        }
        
        // Generate cluster name based on most active/representative submolt
        const clusterSubmolts = [...cluster];
        const clusterData = clusterSubmolts.map(name => 
            submolts.find(s => s.name === name)
        ).filter(s => s);
        
        // Sort by agent count to find most representative
        clusterData.sort((a, b) => b.agents.length - a.agents.length);
        const clusterName = clusterData[0] ? getClusterName(clusterData[0].name) : 'misc';
        
        if (!clusters.has(clusterName)) {
            clusters.set(clusterName, []);
        }
        clusters.get(clusterName).push(...clusterSubmolts);
    }
    
    return Object.fromEntries(clusters);
}

/**
 * Generate a meaningful cluster name from a representative submolt
 * @param {string} submoltName 
 * @returns {string}
 */
function getClusterName(submoltName) {
    // Map common submolt patterns to cluster themes
    const themeMap = {
        'general': 'social',
        'agents': 'tech',
        'builds': 'tech', 
        'moltdev': 'tech',
        'showandtell': 'creative',
        'ponderings': 'thoughtful',
        'existential': 'thoughtful',
        'shitposts': 'humor',
        'crab-rave': 'celebration',
        'headlines': 'news',
        'todayilearned': 'learning',
        'usdc': 'finance',
        'blesstheirhearts': 'support'
    };
    
    return themeMap[submoltName] || submoltName;
}

/**
 * Recommend submolts for an agent based on their posting history
 * @param {string} agentName - Name of the agent
 * @param {number} limit - Maximum number of recommendations (default: 10)
 * @returns {Array} Recommended submolts with reasoning
 */
function getRecommendedSubmolts(agentName, limit = 10) {
    const graph = loadGraph();
    
    // Find the agent
    const agent = graph.nodes.agents.find(a => a.name === agentName);
    if (!agent) {
        throw new Error(`Agent '${agentName}' not found`);
    }
    
    if (agent.submolts.length === 0) {
        return [{ message: `${agentName} hasn't posted anywhere yet. Try starting with 'general'!` }];
    }
    
    const agentSubmolts = new Set(agent.submolts);
    const recommendations = new Map();
    
    // For each submolt the agent participates in, find similar ones
    for (const submoltName of agent.submolts) {
        const similarSubmolts = getSimilarSubmolts(submoltName, 20);
        
        for (const similar of similarSubmolts) {
            if (agentSubmolts.has(similar.name)) continue; // Skip submolts they already use
            
            if (!recommendations.has(similar.name)) {
                recommendations.set(similar.name, {
                    name: similar.name,
                    displayName: similar.displayName,
                    score: 0,
                    reasons: []
                });
            }
            
            const rec = recommendations.get(similar.name);
            rec.score += similar.similarity;
            rec.reasons.push({
                fromSubmolt: submoltName,
                similarity: similar.similarity,
                sharedAgents: similar.sharedAgents
            });
        }
    }
    
    // Convert to array and sort by score
    const recommendationArray = Array.from(recommendations.values());
    recommendationArray.sort((a, b) => b.score - a.score);
    
    // Format recommendations
    return recommendationArray.slice(0, limit).map(rec => {
        const bestReason = rec.reasons.reduce((best, reason) => 
            reason.similarity > best.similarity ? reason : best
        );
        
        return {
            name: rec.name,
            displayName: rec.displayName,
            score: rec.score.toFixed(3),
            reason: `You post in m/${bestReason.fromSubmolt} → try m/${rec.name} (${Math.round(bestReason.similarity * 100)}% agent overlap)`,
            sharedAgents: bestReason.sharedAgents
        };
    });
}

// CLI Interface
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
MoltWatch Submolt Clustering

Usage:
  node clusters.js similar <submolt>    - Find submolts similar to the given one
  node clusters.js recommend <agent>    - Recommend submolts for an agent  
  node clusters.js all                  - Show all clusters

Examples:
  node clusters.js similar agents
  node clusters.js recommend SparkOC
  node clusters.js all
`);
        process.exit(1);
    }
    
    const command = args[0];
    
    try {
        switch (command) {
            case 'similar':
                if (!args[1]) {
                    console.error('Please specify a submolt name');
                    process.exit(1);
                }
                const similarSubmolts = getSimilarSubmolts(args[1]);
                console.log(`\n🔗 Submolts similar to m/${args[1]}:\n`);
                if (similarSubmolts.length === 0) {
                    console.log('No similar submolts found.');
                } else {
                    for (const submolt of similarSubmolts) {
                        console.log(`  m/${submolt.name} is ${Math.round(submolt.similarity * 100)}% similar to m/${args[1]} (shared: ${submolt.sharedAgents} agents)`);
                    }
                }
                break;
                
            case 'recommend':
                if (!args[1]) {
                    console.error('Please specify an agent name');
                    process.exit(1);
                }
                const recommendations = getRecommendedSubmolts(args[1]);
                console.log(`\n💡 Submolt recommendations for ${args[1]}:\n`);
                if (recommendations.length === 0) {
                    console.log('No recommendations found.');
                } else if (recommendations[0].message) {
                    console.log(`  ${recommendations[0].message}`);
                } else {
                    for (const rec of recommendations) {
                        console.log(`  ${rec.reason}`);
                    }
                }
                break;
                
            case 'all':
                const clusters = getSubmoltClusters();
                console.log('\n🎯 Submolt Clusters:\n');
                
                for (const [clusterName, submolts] of Object.entries(clusters)) {
                    if (submolts.length > 1) { // Only show actual clusters
                        console.log(`  ${clusterName}: [${submolts.join(', ')}]`);
                    }
                }
                
                // Show stats
                const totalSubmolts = Object.values(clusters).reduce((sum, arr) => sum + arr.length, 0);
                const clusterCount = Object.keys(clusters).length;
                console.log(`\n📊 ${clusterCount} clusters containing ${totalSubmolts} submolts`);
                break;
                
            default:
                console.error(`Unknown command: ${command}`);
                process.exit(1);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

// Export functions for use as module
module.exports = {
    getSimilarSubmolts,
    getSubmoltClusters, 
    getRecommendedSubmolts,
    loadGraph
};