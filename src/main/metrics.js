// Performance monitoring and metrics - Admin App
const { app } = require('electron');
const { DEBUG } = require('./config');

// Metrics storage
const metrics = {
  sessionStart: Date.now(),
  pageLoads: {},
  featureUsage: {},
  errors: [],
  performance: {
    pageLoadTimes: {},
    cacheHitRate: { hits: 0, misses: 0 }
  }
};

// Track page load time
function trackPageLoad(pageName, startTime) {
  const loadTime = Date.now() - startTime;
  
  if (!metrics.pageLoads[pageName]) {
    metrics.pageLoads[pageName] = { count: 0, totalTime: 0, avgTime: 0 };
  }
  
  metrics.pageLoads[pageName].count++;
  metrics.pageLoads[pageName].totalTime += loadTime;
  metrics.pageLoads[pageName].avgTime = Math.round(
    metrics.pageLoads[pageName].totalTime / metrics.pageLoads[pageName].count
  );
  
  DEBUG && console.log(`[METRICS] Page "${pageName}" loaded in ${loadTime}ms (avg: ${metrics.pageLoads[pageName].avgTime}ms)`);
  
  return loadTime;
}

// Track feature usage
function trackFeatureUsage(featureName) {
  if (!metrics.featureUsage[featureName]) {
    metrics.featureUsage[featureName] = 0;
  }
  metrics.featureUsage[featureName]++;
  
  DEBUG && console.log(`[METRICS] Feature "${featureName}" used ${metrics.featureUsage[featureName]} times`);
}

// Track cache performance
function trackCacheHit(hit = true) {
  if (hit) {
    metrics.performance.cacheHitRate.hits++;
  } else {
    metrics.performance.cacheHitRate.misses++;
  }
  
  const total = metrics.performance.cacheHitRate.hits + metrics.performance.cacheHitRate.misses;
  const hitRate = total > 0 ? Math.round((metrics.performance.cacheHitRate.hits / total) * 100) : 0;
  
  DEBUG && console.log(`[METRICS] Cache hit rate: ${hitRate}% (${metrics.performance.cacheHitRate.hits}/${total})`);
}

// Track error
function trackError(error, context = '') {
  metrics.errors.push({
    timestamp: Date.now(),
    message: error.message || String(error),
    context,
    stack: error.stack
  });
  
  // Keep only last 50 errors
  if (metrics.errors.length > 50) {
    metrics.errors = metrics.errors.slice(-50);
  }
}

// Get session duration
function getSessionDuration() {
  return Math.round((Date.now() - metrics.sessionStart) / 1000); // in seconds
}

// Get metrics summary
function getMetricsSummary() {
  const summary = {
    sessionDuration: getSessionDuration(),
    totalPageLoads: Object.values(metrics.pageLoads).reduce((sum, p) => sum + p.count, 0),
    pageLoadStats: metrics.pageLoads,
    featureUsage: metrics.featureUsage,
    cacheHitRate: (() => {
      const total = metrics.performance.cacheHitRate.hits + metrics.performance.cacheHitRate.misses;
      return total > 0 ? Math.round((metrics.performance.cacheHitRate.hits / total) * 100) : 0;
    })(),
    errorCount: metrics.errors.length,
    recentErrors: metrics.errors.slice(-5)
  };
  
  return summary;
}

// Log metrics summary (called on app quit or periodically)
function logMetricsSummary() {
  const summary = getMetricsSummary();
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 ADMIN SESSION METRICS SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Session Duration: ${Math.floor(summary.sessionDuration / 60)}m ${summary.sessionDuration % 60}s`);
  console.log(`Total Page Loads: ${summary.totalPageLoads}`);
  console.log(`Cache Hit Rate: ${summary.cacheHitRate}%`);
  console.log(`Errors: ${summary.errorCount}`);
  
  if (Object.keys(summary.pageLoadStats).length > 0) {
    console.log('\nPage Load Times:');
    Object.entries(summary.pageLoadStats).forEach(([page, stats]) => {
      console.log(`  ${page}: ${stats.avgTime}ms avg (${stats.count} loads)`);
    });
  }
  
  if (Object.keys(summary.featureUsage).length > 0) {
    console.log('\nFeature Usage:');
    Object.entries(summary.featureUsage)
      .sort((a, b) => b[1] - a[1])
      .forEach(([feature, count]) => {
        console.log(`  ${feature}: ${count} times`);
      });
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// Setup metrics logging on app quit
function setupMetrics() {
  app.on('before-quit', () => {
    if (DEBUG) {
      logMetricsSummary();
    }
  });
  
  // Log metrics every 5 minutes in debug mode
  if (DEBUG) {
    setInterval(() => {
      logMetricsSummary();
    }, 5 * 60 * 1000);
  }
  
  DEBUG && console.log('[METRICS] Admin performance monitoring initialized');
}

module.exports = {
  setupMetrics,
  trackPageLoad,
  trackFeatureUsage,
  trackCacheHit,
  trackError,
  getSessionDuration,
  getMetricsSummary,
  logMetricsSummary
};
