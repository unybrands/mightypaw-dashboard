// ═══════════════════════════════════════════════════════════════════════════════════
// MIGHTY PAW DASHBOARD - LIVE DATA REFRESH SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════════

// Configuration
const BIGQUERY_CONFIG = {
  projectId: 'bq-uny-data',
  // Add your service account key or OAuth token here
  // For production, use proper authentication
};

// ── CORE REFRESH FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Main refresh function - updates all data sources
 */
async function refreshAllData() {
  console.log('🔄 Starting dashboard data refresh...');
  
  try {
    // Show loading indicator
    showLoadingIndicator();
    
    // Refresh all data sources in parallel
    const refreshPromises = [
      refreshVelocityData(),
      refreshInventoryData(),
      refreshAmazonData()
    ];
    
    await Promise.all(refreshPromises);
    
    // Update timestamps and UI
    updateLastRefreshed();
    hideLoadingIndicator();
    
    // Re-render affected components
    rerenderDashboard();
    
    console.log('✅ Dashboard refresh completed successfully');
    
  } catch (error) {
    console.error('❌ Dashboard refresh failed:', error);
    showErrorMessage('Data refresh failed. Using cached data.');
    hideLoadingIndicator();
  }
}

/**
 * Refresh velocity data from Flieber (90-day corrected)
 */
async function refreshVelocityData() {
  console.log('📈 Refreshing velocity data...');
  
  // Shopify velocities (90-day corrected)
  const shopifyQuery = `
    SELECT 
      p.sku,
      ROUND(SUM(f.units) / 90.0, 3) AS daily_velocity
    FROM \`bq-uny-data.prod.flbr_raw_forecast_daily\` f
    JOIN (
      SELECT DISTINCT asin, sku 
      FROM \`bq-uny-data.prod.po_inventory_performance_3pls\`
      WHERE product_brand = 'Mighty Paw'
    ) p ON f.product_code = p.asin
    WHERE f.account_label = 'Mighty Paw-Shopify-US'
      AND f.forecasted_date >= CURRENT_DATE()
      AND f.forecasted_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 89 DAY)
      AND p.sku IS NOT NULL
      AND p.sku NOT IN (
        'Black Small Collar','Large Sports Collar','TB2 Green','TB2 Grey',
        'AddOn_Smart_Act','AddOn_Smart_Rec','ElkAntlerGNT_LRG_8_1pk'
      )
    GROUP BY p.sku
    HAVING SUM(f.units) > 0
    ORDER BY daily_velocity DESC
  `;
  
  // Chewy velocities (90-day corrected)
  const chewyQuery = `
    SELECT 
      p.sku,
      ROUND(SUM(f.units) / 90.0, 3) AS daily_velocity
    FROM \`bq-uny-data.prod.flbr_raw_forecast_daily\` f
    JOIN (
      SELECT DISTINCT asin, sku 
      FROM \`bq-uny-data.prod.po_inventory_performance_3pls\`
      WHERE product_brand = 'Mighty Paw'
    ) p ON f.product_code = p.asin
    WHERE f.account_label = 'Mighty Paw-CHEWY-US'
      AND f.forecasted_date >= CURRENT_DATE()
      AND f.forecasted_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 89 DAY)
      AND p.sku IS NOT NULL
      AND p.sku NOT IN (
        'Black Small Collar','Large Sports Collar','AddOn_Smart_Act'
      )
    GROUP BY p.sku
    HAVING SUM(f.units) > 0
    ORDER BY daily_velocity DESC
  `;
  
  // TikTok combined velocities (90-day corrected)
  const tiktokQuery = `
    SELECT 
      p.sku,
      ROUND(SUM(f.units) / 90.0, 3) AS daily_velocity,
      ROUND(SUM(f.units) / 90.0 * 7, 1) AS daily7_velocity
    FROM \`bq-uny-data.prod.flbr_raw_forecast_daily\` f
    JOIN (
      SELECT DISTINCT asin, sku 
      FROM \`bq-uny-data.prod.po_inventory_performance_3pls\`
      WHERE product_brand = 'Mighty Paw'
    ) p ON f.product_code = p.asin
    WHERE f.account_label IN ('Mighty Paw-TIKTOK-US', 'Mighty Paw-TIKTOK Samples-US')
      AND f.forecasted_date >= CURRENT_DATE()
      AND f.forecasted_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 89 DAY)
      AND p.sku IS NOT NULL
    GROUP BY p.sku
    HAVING SUM(f.units) > 0
    ORDER BY daily_velocity DESC
  `;
  
  // Execute queries and update arrays
  const [shopifyData, chewyData, tiktokData] = await Promise.all([
    executeBigQueryQuery(shopifyQuery),
    executeBigQueryQuery(chewyQuery), 
    executeBigQueryQuery(tiktokQuery)
  ]);
  
  // Update velocity arrays
  updateVelocityArrays(shopifyData, chewyData, tiktokData);
}

/**
 * Refresh inventory data (WH 240, Amazon FBA)
 */
async function refreshInventoryData() {
  console.log('📦 Refreshing inventory data...');
  
  // WH 240 inventory query
  const whQuery = `
    SELECT 
      sku,
      SUM(quantity_on_hand) as on_hand_qty
    FROM \`bq-uny-data.prod.po_inventory_performance_3pls\`
    WHERE product_brand = 'Mighty Paw'
      AND warehouse_location = 'WH 240'
      AND sku IS NOT NULL
    GROUP BY sku
    HAVING SUM(quantity_on_hand) > 0
    ORDER BY on_hand_qty DESC
  `;
  
  // Amazon FBA inventory query  
  const fbaQuery = `
    SELECT 
      sku,
      SUM(fba_available) as fba_avail,
      SUM(fba_inbound) as fba_inbound
    FROM \`bq-uny-data.prod.po_inventory_performance_3pls\`
    WHERE product_brand = 'Mighty Paw'
      AND marketplace = 'Amazon'
      AND sku IS NOT NULL
    GROUP BY sku
    ORDER BY sku
  `;
  
  // Execute queries and update inventory
  const [whData, fbaData] = await Promise.all([
    executeBigQueryQuery(whQuery),
    executeBigQueryQuery(fbaQuery)
  ]);
  
  // Update inventory arrays
  updateInventoryArrays(whData, fbaData);
}

/**
 * Refresh Amazon velocity data (already live from Flieber)
 */
async function refreshAmazonData() {
  console.log('🛒 Refreshing Amazon velocity data...');
  
  // Amazon US velocities
  const amzUsQuery = `
    SELECT 
      p.sku,
      f.product_name as name,
      ROUND(AVG(f.daily_velocity), 3) as daily_velocity
    FROM \`bq-uny-data.prod.flbr_raw_forecast_daily\` f
    JOIN (
      SELECT DISTINCT asin, sku 
      FROM \`bq-uny-data.prod.po_inventory_performance_3pls\`
      WHERE product_brand = 'Mighty Paw'
    ) p ON f.product_code = p.asin
    WHERE f.account_label = 'Mighty Paw-Amazon-US'
      AND f.forecasted_date >= CURRENT_DATE()
      AND f.forecasted_date <= DATE_ADD(CURRENT_DATE(), INTERVAL 6 DAY)
      AND p.sku IS NOT NULL
    GROUP BY p.sku, f.product_name
    ORDER BY daily_velocity DESC
  `;
  
  const amzUsData = await executeBigQueryQuery(amzUsQuery);
  updateAmazonArrays(amzUsData);
}

// ── DATA UPDATE FUNCTIONS ───────────────────────────────────────────────────────────

/**
 * Update velocity arrays with fresh data
 */
function updateVelocityArrays(shopifyData, chewyData, tiktokData) {
  // Clear existing arrays
  Object.keys(D.shopify).forEach(k => delete D.shopify[k]);
  Object.keys(D.chewy).forEach(k => delete D.chewy[k]);  
  Object.keys(D.tiktok).forEach(k => delete D.tiktok[k]);
  
  // Update D.shopify
  shopifyData.rows?.forEach(row => {
    const sku = row.f[0].v;
    const velocity = parseFloat(row.f[1].v);
    D.shopify[sku] = velocity;
  });
  
  // Update D.chewy
  chewyData.rows?.forEach(row => {
    const sku = row.f[0].v;
    const velocity = parseFloat(row.f[1].v);
    D.chewy[sku] = velocity;
  });
  
  // Update D.tiktok
  tiktokData.rows?.forEach(row => {
    const sku = row.f[0].v;
    const velocity = parseFloat(row.f[1].v);
    D.tiktok[sku] = velocity;
  });
  
  // Update TT array (for TikTok alerts)
  updateTTArray(tiktokData);
  
  console.log(`📊 Updated velocities: Shopify(${Object.keys(D.shopify).length}), Chewy(${Object.keys(D.chewy).length}), TikTok(${Object.keys(D.tiktok).length})`);
}

/**
 * Update TT array with corrected daily7 values
 */
function updateTTArray(tiktokData) {
  // Find existing TT entries and update their daily7 values
  tiktokData.rows?.forEach(row => {
    const sku = row.f[0].v;
    const daily7 = parseFloat(row.f[2].v); // daily7_velocity
    
    const ttEntry = TT.find(t => t.sku === sku);
    if (ttEntry) {
      ttEntry.daily7 = daily7;
      // Recalculate DOS
      const total = (ttEntry.avail || 0) + (ttEntry.inbound || 0);
      ttEntry.dos = daily7 > 0 ? Math.round(total / daily7) : null;
    }
  });
}

/**
 * Update inventory arrays
 */
function updateInventoryArrays(whData, fbaData) {
  // Clear and update WH array
  Object.keys(WH).forEach(k => delete WH[k]);
  whData.rows?.forEach(row => {
    const sku = row.f[0].v;
    const qty = parseInt(row.f[1].v);
    WH[sku] = qty;
  });
  
  // Update Amazon US array with fresh FBA data
  fbaData.rows?.forEach(row => {
    const sku = row.f[0].v;
    const fbaAvail = parseInt(row.f[1].v) || 0;
    const fbaInbound = parseInt(row.f[2].v) || 0;
    
    const amzEntry = AMZ_US.find(a => a.sku === sku);
    if (amzEntry) {
      amzEntry.avail = fbaAvail;
      amzEntry.inbound = fbaInbound;
      amzEntry.total = fbaAvail + fbaInbound;
    }
  });
  
  console.log(`📦 Updated inventory: WH 240(${Object.keys(WH).length}), Amazon entries updated`);
}

// ── UTILITY FUNCTIONS ───────────────────────────────────────────────────────────────

/**
 * Execute BigQuery query (mock implementation - replace with actual API calls)
 */
async function executeBigQueryQuery(query) {
  // This is a mock - in real implementation you would:
  // 1. Use Google Cloud BigQuery API
  // 2. Handle authentication properly
  // 3. Return actual query results
  
  console.log('Executing query:', query.substring(0, 100) + '...');
  
  // Mock delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Return mock data structure
  return {
    rows: [
      { f: [{ v: 'CheeseStick_4pk' }, { v: '25.292' }] }
    ]
  };
}

/**
 * Re-render dashboard components after data update
 */
function rerenderDashboard() {
  // Re-render any visible tabs
  const activeTab = document.querySelector('.nav-tab.active');
  if (activeTab) {
    const tabName = activeTab.onclick.toString().match(/'(\w+)'/)?.[1];
    if (tabName === 'channels') renderByChannel();
    if (tabName === 'alloc') renderAlloc();
    if (tabName === 'alert') renderAlertTab();
  }
  
  // Update summary cards
  if (typeof renderExecSummary === 'function') {
    renderExecSummary();
  }
}

/**
 * Update last refreshed timestamp
 */
function updateLastRefreshed() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true
  });
  
  document.getElementById('as-of-date').textContent = `${dateStr} ${timeStr}`;
}

/**
 * Show loading indicator
 */
function showLoadingIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'loading-indicator';
  indicator.innerHTML = `
    <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;color:white;font-size:18px;font-weight:600;">
      <div style="text-align:center;">
        <div style="margin-bottom:15px;">🔄 Refreshing Dashboard Data...</div>
        <div style="font-size:14px;opacity:0.8;">Fetching latest velocities and inventory</div>
      </div>
    </div>
  `;
  document.body.appendChild(indicator);
}

/**
 * Hide loading indicator
 */
function hideLoadingIndicator() {
  const indicator = document.getElementById('loading-indicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Show error message
 */
function showErrorMessage(message) {
  const errorDiv = document.createElement('div');
  errorDiv.style.cssText = `
    position:fixed;top:20px;right:20px;background:#ff6b6b;color:white;
    padding:12px 18px;border-radius:8px;z-index:10000;font-size:14px;
    box-shadow:0 4px 12px rgba(0,0,0,0.3);
  `;
  errorDiv.textContent = message;
  document.body.appendChild(errorDiv);
  
  setTimeout(() => errorDiv.remove(), 5000);
}

// ── INITIALIZATION ──────────────────────────────────────────────────────────────────

/**
 * Initialize live refresh system
 */
function initializeLiveRefresh() {
  console.log('🚀 Initializing live dashboard refresh system...');
  
  // Add refresh button to header
  addRefreshButton();
  
  // Set up automatic refresh (every 4 hours)
  setInterval(refreshAllData, 4 * 60 * 60 * 1000);
  
  // Initial refresh on page load (with delay to let page settle)
  setTimeout(refreshAllData, 3000);
}

/**
 * Add manual refresh button to dashboard
 */
function addRefreshButton() {
  const topbarRight = document.querySelector('.topbar-right');
  if (topbarRight) {
    const refreshBtn = document.createElement('button');
    refreshBtn.innerHTML = '🔄 Refresh Data';
    refreshBtn.style.cssText = `
      background:var(--blue);color:white;border:none;border-radius:6px;
      padding:8px 15px;margin-left:15px;font-size:12px;font-weight:600;
      cursor:pointer;font-family:'DM Sans',sans-serif;
    `;
    refreshBtn.onclick = refreshAllData;
    topbarRight.appendChild(refreshBtn);
  }
}

// ── AUTO-START ──────────────────────────────────────────────────────────────────────

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeLiveRefresh);
} else {
  initializeLiveRefresh();
}

// Export functions for manual use
window.refreshAllData = refreshAllData;
window.refreshVelocityData = refreshVelocityData;
window.refreshInventoryData = refreshInventoryData;
