// ════════════════════════════════════════════════════════════════
//  Odds Scraper — local no Electron (puppeteer-core)
//  Port do OddsScraperService.js da API para execução local
// ════════════════════════════════════════════════════════════════
const puppeteer = require('puppeteer-core');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

// ────── Config ──────
const CACHE_TTL = 3 * 60 * 1000; // 3 minutos
const BROWSER_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 min sem uso → fecha browser

// ────── Cache simples (Map + TTL) ──────
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

function cacheClear() {
  cache.clear();
}

// ────── Helpers ──────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const humanDelay = (min, max) => sleep(min + Math.random() * (max - min));

function humanMove(page, x, y) {
  return page.mouse.move(x, y, { steps: 3 + Math.floor(Math.random() * 5) });
}

// ────── Chrome path detection ──────
function findChromePath() {
  const platform = os.platform();
  if (platform === 'win32') {
    const candidates = [
      path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Chromium', 'Application', 'chrome.exe'),
      // Edge as fallback
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['PROGRAMFILES'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
  } else {
    // Linux
    const { execSync } = require('child_process');
    const cmds = ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'];
    for (const cmd of cmds) {
      try { return execSync(`which ${cmd}`).toString().trim(); } catch {}
    }
  }
  return null;
}

// ────── Browser Management ──────
let browserInstance = null;
let browserIdleTimer = null;

function resetBrowserIdle() {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(async () => {
    if (browserInstance) {
      console.log('[OddsScraper] Browser idle timeout — closing');
      await browserInstance.close().catch(() => {});
      browserInstance = null;
    }
  }, BROWSER_IDLE_TIMEOUT);
}

async function getBrowser() {
  resetBrowserIdle();
  if (browserInstance) {
    try {
      // Check if still alive
      await browserInstance.version();
      return browserInstance;
    } catch {
      browserInstance = null;
    }
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error('Chrome/Chromium não encontrado. Instala o Google Chrome para usar o scraping de odds.');
  }

  console.log(`[OddsScraper] Launching browser: ${chromePath}`);

  browserInstance = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    protocolTimeout: 60000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-first-run',
      '--window-size=1920,1080',
    ],
    defaultViewport: { width: 1920, height: 1080 },
  });

  return browserInstance;
}

// ────── Progress tracking via IPC ──────
let progressData = {
  status: 'idle',
  sites: {},
  overallPercent: 0,
  elapsed: 0,
  eta: 0,
  startedAt: null,
};

function sendProgress(data) {
  Object.assign(progressData, data);

  // Calculate overall percent from per-site data
  const sites = Object.values(progressData.sites);
  if (sites.length > 0) {
    progressData.overallPercent = Math.round(
      sites.reduce((s, site) => s + (site.percent || 0), 0) / sites.length
    );
  }

  // Calculate elapsed
  if (progressData.startedAt) {
    progressData.elapsed = Math.round((Date.now() - progressData.startedAt) / 1000);
    // ETA estimate
    if (progressData.overallPercent > 5) {
      const rate = progressData.elapsed / progressData.overallPercent;
      progressData.eta = Math.round(rate * (100 - progressData.overallPercent));
    }
  }

  // Send to all renderer windows
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('odds:progress', { ...progressData });
    } catch {}
  }
}

function updateSiteProgress(site, update) {
  if (!progressData.sites[site]) {
    progressData.sites[site] = { status: 'waiting', percent: 0, events: 0, current: '' };
  }
  Object.assign(progressData.sites[site], update);
  sendProgress({});
}

// ────── Site URLs ──────
const SITE_URLS = {
  betano: {
    football: 'https://www.betano.pt/sport/futebol/',
    tennis: 'https://www.betano.pt/sport/tenis/',
  },
  bwin: {
    football: [
      'https://sports.bwin.pt/pt/sports/futebol-4/hoje/apostas',
      'https://sports.bwin.pt/pt/sports/futebol-4/amanha/apostas',
      'https://sports.bwin.pt/pt/sports/futebol-4/dia-depois-de-amanha/apostas',
      'https://sports.bwin.pt/pt/sports/futebol-4/daqui-a-3-dias/apostas',
    ],
    tennis: [
      'https://sports.bwin.pt/pt/sports/tenis-5/hoje/apostas',
      'https://sports.bwin.pt/pt/sports/tenis-5/amanha/apostas',
    ],
  },
  betclic: {
    football: 'https://www.betclic.pt/futebol-s1',
    tennis: 'https://www.betclic.pt/tenis-s2',
  },
  placard: {
    football: 'https://www.placard.pt/apostas/sports/soccer/competitions',
    tennis: 'https://www.placard.pt/apostas/sports/tennis/competitions',
  },
};

const BOOKMAKERS = {
  betano:  { name: 'Betano',  color: '#00a826' },
  betclic: { name: 'Betclic', color: '#e30613' },
  placard: { name: 'Placard', color: '#004a99' },
  bwin:    { name: 'Bwin',    color: '#f5c800' },
};

// ════════════════════════════════════════════
//  Page Creation (3 stealth levels)
// ════════════════════════════════════════════

// Full stealth + request interception (Bwin, Betclic)
async function createPage(browser) {
  const page = await browser.newPage();

  // Stealth: override navigator properties
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-PT', 'pt', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = { runtime: {} };
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);
  });

  // UA & headers
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Sec-CH-UA': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-CH-UA-Mobile': '?0',
  });

  // Block heavy resources
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const rt = req.resourceType();
    const url = req.url();
    if (['image', 'media', 'font', 'stylesheet'].includes(rt)) return req.abort();
    if (url.includes('google-analytics') || url.includes('gtag') || url.includes('facebook') ||
        url.includes('doubleclick') || url.includes('hotjar') || url.includes('clarity') ||
        url.includes('adsbygoogle') || url.includes('googlesyndication')) return req.abort();
    req.continue();
  });

  page.setDefaultTimeout(30000);
  return page;
}

// Medium stealth — no interception (Placard)
async function createCleanPage(browser) {
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-PT', 'pt', 'en'] });
    window.chrome = { runtime: {} };
  });

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' });
  page.setDefaultTimeout(30000);
  return page;
}

// Minimal stealth (Betano)
async function createMinimalPage(browser) {
  const page = await browser.newPage();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  page.setDefaultTimeout(30000);

  // Block images only
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (['image', 'media', 'font'].includes(req.resourceType())) return req.abort();
    req.continue();
  });

  return page;
}

// ════════════════════════════════════════════
//  MAIN: getOdds
// ════════════════════════════════════════════
async function getOdds(sports = 'football', forceRefresh = false, sites = null, options = {}) {
  // Normalize sports to array
  if (typeof sports === 'string') sports = [sports];
  const crossOdds = options.crossOdds !== false; // default true
  const activeSites = sites && sites.length > 0 ? sites : Object.keys(BOOKMAKERS);
  const cacheKey = `odds_${sports.sort().join('+')}_${activeSites.sort().join(',')}${crossOdds ? '' : '_raw'}`;

  if (!forceRefresh) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      console.log(`[OddsScraper] Cache hit for ${sports.join('+')} [${activeSites.join(',')}]`);
      return { success: true, result: { data: cached } };
    }
  }

  // Reset progress
  progressData = {
    status: 'starting',
    sites: {},
    overallPercent: 0,
    elapsed: 0,
    eta: 0,
    startedAt: Date.now(),
  };
  for (const s of activeSites) {
    progressData.sites[s] = { status: 'waiting', percent: 0, events: 0, current: 'A aguardar...' };
  }
  sendProgress({ status: 'starting' });

  const startTime = Date.now();

  const scraperMap = {
    betano: scrapeBetano,
    bwin: scrapeBwin,
    betclic: scrapeBetclic,
    placard: scrapePlacard,
  };

  try {
    const browser = await getBrowser();
    sendProgress({ status: 'scraping' });

    let allMatchedEvents = [];
    const allErrors = [];
    const combinedPerSite = {};
    let totalSiteEvents = 0;

    for (let si = 0; si < sports.length; si++) {
      const sport = sports[si];
      const isLastSport = si === sports.length - 1;
      console.log(`[OddsScraper] Scraping ${sport} (${si + 1}/${sports.length})...`);

      // Launch selected scrapers in parallel for this sport
      const results = await Promise.allSettled(
        activeSites.map(site => {
          const fn = scraperMap[site];
          if (!fn) return Promise.reject(new Error(`Scraper desconhecido: ${site}`));
          return fn(browser, sport).then(events => {
            console.log(`[OddsScraper] ${site}/${sport} returned: ${Array.isArray(events) ? events.length : typeof events} events`);
            if (!Array.isArray(events)) events = [];
            const prev = combinedPerSite[site] || 0;
            updateSiteProgress(site, {
              status: isLastSport ? 'done' : 'scraping',
              events: prev + events.length,
              percent: isLastSport ? 100 : Math.round(((si + 1) / sports.length) * 50),
              current: `${prev + events.length} eventos`,
            });
            return { site, events };
          }).catch(err => {
            console.error(`[OddsScraper] ${site}/${sport} FAILED:`, err);
            updateSiteProgress(site, { status: 'error', current: err?.message || String(err) });
            throw { site, error: err };
          });
        })
      );

      const siteData = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') {
          siteData[r.value.site] = r.value.events;
          combinedPerSite[r.value.site] = (combinedPerSite[r.value.site] || 0) + r.value.events.length;
        } else {
          const site = r.reason?.site || 'unknown';
          allErrors.push({ site, error: r.reason?.error?.message || 'Erro desconhecido' });
          if (!combinedPerSite[site]) combinedPerSite[site] = 0;
        }
      });

      totalSiteEvents += Object.values(siteData).reduce((a, b) => a + b.length, 0);

      sendProgress({ status: 'matching' });
      const matched = matchEvents(siteData, sport, crossOdds);
      matched.forEach(e => e.sport = sport);
      allMatchedEvents.push(...matched);
    }

    // Final sort
    allMatchedEvents.sort((a, b) => {
      if (b.bookmakerCount !== a.bookmakerCount) return b.bookmakerCount - a.bookmakerCount;
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const responseData = {
      events: allMatchedEvents,
      errors: allErrors,
      stats: {
        totalEvents: allMatchedEvents.length,
        totalSiteEvents,
        perSite: combinedPerSite,
        scrapeDuration: `${duration}s`,
      },
    };

    cacheSet(cacheKey, responseData);
    sendProgress({ status: 'done', overallPercent: 100 });
    console.log(`[OddsScraper] ${sports.join('+')}: ${allMatchedEvents.length} events in ${duration}s (${totalSiteEvents} raw from ${Object.keys(combinedPerSite).length} sites)`);

    return { success: true, result: { data: responseData } };
  } catch (err) {
    console.error(`[OddsScraper] Fatal error:`, err);
    sendProgress({ status: 'error' });
    return { success: false, message: err.message };
  }
}

function getSports() {
  return ['football', 'tennis'];
}

// ════════════════════════════════════════════
//  BETANO.PT
// ════════════════════════════════════════════
// ── Betano market tab data-qa selectors ──
const BETANO_MARKETS = [
  { qa: 'tab-matchresult',       name: 'matchresult' },
  { qa: 'tab-overunder',         name: 'overunder' },
  { qa: 'tab-bothteamstoscore',  name: 'btts' },
  { qa: 'tab-doublechance',      name: 'doublechance' },
  { qa: 'tab-halftimeoverunder', name: 'htoverunder' },
];

async function scrapeBetano(browser, sport) {
  const url = SITE_URLS.betano[sport];
  if (!url) return [];
  const sportSlug = sport === 'football' ? 'futebol' : 'tenis';
  updateSiteProgress('betano', { status: 'scraping', current: 'A recolher ligas...' });

  // ── Phase 1: Collect league links from sidebar ──
  const sidebarPage = await createMinimalPage(browser);
  let leagueLinks = [];

  try {
    await sidebarPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await humanDelay(1500, 2500);
    try { await sidebarPage.mouse.click(10, 10); } catch {}
    await humanDelay(300, 600);

    // Wait for sidebar sport-picker to render
    try { await sidebarPage.waitForSelector('.sport-picker__secondary__item__title', { timeout: 10000 }); } catch {
      console.warn('[OddsScraper] Betano: sidebar sport-picker not found, trying longer wait...');
      await humanDelay(3000, 5000);
    }

    const allLeagueLinks = [];
    const seenHrefs = new Set();

    // Collect top-level visible leagues
    const topLinks = await sidebarPage.evaluate((slug) => {
      const links = [];
      document.querySelectorAll('.sport-picker__secondary__item__title').forEach(a => {
        const href = a.getAttribute('href') || '';
        const title = a.getAttribute('title') || a.innerText?.trim() || '';
        if (href.includes(`/sport/${slug}/`) && href.match(/\/\d+\/$/)) links.push({ href, title });
      });
      return links;
    }, sportSlug);
    for (const l of topLinks) { if (!seenHrefs.has(l.href)) { seenHrefs.add(l.href); allLeagueLinks.push(l); } }
    console.log(`[OddsScraper] Betano: ${topLinks.length} top-level leagues`);

    // Get sub-category names & expand each
    const subCatNames = await sidebarPage.evaluate(() => {
      const sportSection = document.querySelector('li.sport-picker--expanded');
      if (!sportSection) return [];
      const items = sportSection.querySelectorAll('.sport-picker__item--expandable .sport-picker__item__title');
      return Array.from(items).map(t => t.innerText.trim());
    });
    console.log(`[OddsScraper] Betano: ${subCatNames.length} sub-categories: ${subCatNames.join(', ')}`);

    for (let i = 0; i < subCatNames.length; i++) {
      try {
        const handles = await sidebarPage.$$('li.sport-picker--expanded .sport-picker__item--expandable');
        let targetHandle = null, matchCount = 0;
        for (const h of handles) {
          if (await h.$('.sport-picker__item__title')) {
            if (matchCount === i) { targetHandle = h; break; }
            matchCount++;
          }
        }
        if (!targetHandle) continue;
        await targetHandle.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await humanDelay(200, 400);
        const box = await targetHandle.boundingBox();
        if (!box) continue;
        await sidebarPage.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await humanDelay(700, 1000);

        const subLinks = await sidebarPage.evaluate((slug) => {
          const links = [];
          document.querySelectorAll('.sport-picker__item--primary a.sport-picker__item__title').forEach(a => {
            const href = a.getAttribute('href') || '';
            const title = a.innerText?.trim() || '';
            if (href.includes(`/sport/${slug}/`) && href.match(/\/\d+\/$/)) links.push({ href, title });
          });
          return links;
        }, sportSlug);
        for (const l of subLinks) { if (!seenHrefs.has(l.href)) { seenHrefs.add(l.href); allLeagueLinks.push(l); } }
        console.log(`[OddsScraper] Betano: "${subCatNames[i]}" → ${subLinks.length} leagues`);
      } catch (err) {
        console.warn(`[OddsScraper] Betano: expand error "${subCatNames[i]}": ${err.message}`);
      }
    }

    leagueLinks = allLeagueLinks;
    console.log(`[OddsScraper] Betano: ${leagueLinks.length} total league links collected`);
  } catch (err) {
    console.error(`[OddsScraper] Betano sidebar error: ${err.message}`);
  } finally {
    await sidebarPage.close();
  }

  // ── Phase 2: Scrape leagues in parallel (3 pages at a time) ──
  const BATCH_SIZE = 5;
  const allEvents = [];
  const seenIds = new Set();
  const totalLeagues = leagueLinks.length;
  let leaguesDone = 0;

  updateSiteProgress('betano', { total: totalLeagues, current: `0/${totalLeagues} ligas` });

  for (let b = 0; b < leagueLinks.length; b += BATCH_SIZE) {
    const batch = leagueLinks.slice(b, b + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map(league => betanoScrapeLeague(browser, league))
    );

    for (const result of batchResults) {
      leaguesDone++;
      if (result.status === 'fulfilled' && result.value) {
        for (const evt of result.value) {
          const key = `${evt.home}|${evt.away}|${evt.startTime}`;
          if (!seenIds.has(key)) { seenIds.add(key); allEvents.push(evt); }
        }
      }
    }
    updateSiteProgress('betano', {
      events: allEvents.length,
      percent: Math.round((leaguesDone / totalLeagues) * 100),
      current: `${leaguesDone}/${totalLeagues} ligas`,
    });
  }

  console.log(`[OddsScraper] Betano: TOTAL ${allEvents.length} events across ${totalLeagues} leagues`);
  return allEvents;
}

// ── Betano: scrape a single league page with all market tabs ──
async function betanoScrapeLeague(browser, league) {
  const page = await createMinimalPage(browser);
  const fullUrl = `https://www.betano.pt${league.href}`;

  try {
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(800, 1400);

    // Dismiss cookie overlay
    try { await page.mouse.click(10, 10); } catch {}
    await humanDelay(200, 300);

    // Click "Ver todos" if present
    try {
      const hasVerTodos = await page.evaluate(() => {
        const btn = document.querySelector('[data-qa="button_view_all"]');
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (hasVerTodos) await humanDelay(800, 1200);
    } catch {}

    // ── Detect division tabs ──
    const tabCount = await page.evaluate(() => {
      return document.querySelectorAll('[data-qa^="league_tab_"]').length;
    });
    console.log(`[OddsScraper] Betano ${league.title}: found ${tabCount} division tabs`);

    let allEvents = [];

    if (tabCount === 0) {
      // No tabs: single division, scrape current page
      await betanoScrollAndParse(page);
      allEvents = await betanoParseAllMarkets(page, league.title, '');
    } else {
      // Multiple tabs: click each and scrape
      for (let tabIdx = 0; tabIdx < tabCount; tabIdx++) {
        try {
          // Click this tab
          const tabClicked = await page.evaluate((idx) => {
            const tabs = document.querySelectorAll('[data-qa^="league_tab_"]');
            if (tabs[idx]) {
              tabs[idx].click();
              return true;
            }
            return false;
          }, tabIdx);

          if (!tabClicked) continue;
          await humanDelay(600, 1000);

          // Get tab name
          const tabName = await page.evaluate((idx) => {
            const tabs = document.querySelectorAll('[data-qa^="league_tab_"]');
            if (!tabs[idx]) return '';
            const span = tabs[idx].querySelector('span.tw-truncate');
            return span ? span.innerText.trim() : '';
          }, tabIdx);

          console.log(`[OddsScraper] Betano ${league.title}: scraping tab ${tabIdx + 1}/${tabCount} "${tabName}"`);

          // Scroll to load events for this tab
          await betanoScrollAndParse(page);

          // Parse all markets for this tab
          const tabEvents = await betanoParseAllMarkets(page, league.title, tabName);
          allEvents.push(...tabEvents);
        } catch (err) {
          console.warn(`[OddsScraper] Betano: tab ${tabIdx} error in ${league.title}: ${err.message}`);
        }
      }
    }

    console.log(`[OddsScraper] Betano: ${league.title} → ${allEvents.length} events`);
    return allEvents;
  } catch (err) {
    console.warn(`[OddsScraper] Betano: league error ${league.title}: ${err.message}`);
    return [];
  } finally {
    await page.close();
  }
}

// ── Betano helper: parse all markets for current division ──
async function betanoParseAllMarkets(page, leagueTitle, divisionName) {
  const eventsMap = new Map();

  for (const market of BETANO_MARKETS) {
    try {
      const tabClicked = await page.evaluate((qa) => {
        const tab = document.querySelector(`[data-qa="${qa}"]`);
        if (tab) { tab.click(); return true; }
        return false;
      }, market.qa);

      if (!tabClicked) continue;
      await humanDelay(250, 450);

      const marketEvents = await betanoParseMarket(page, market.name);

      for (const evt of marketEvents) {
        const key = `${evt.home}|${evt.away}|${evt.startTime}`;
        if (!eventsMap.has(key)) {
          const finalLeague = divisionName ? `${leagueTitle} - ${divisionName}` : leagueTitle;
          eventsMap.set(key, { home: evt.home, away: evt.away, league: finalLeague, startTime: evt.startTime, odds: {} });
        }
        Object.assign(eventsMap.get(key).odds, evt.odds);
      }
    } catch (err) {
      console.warn(`[OddsScraper] Betano: market ${market.name} error: ${err.message}`);
    }
  }

  return Array.from(eventsMap.values()).filter(e => e.odds.home || e.odds.away);
}

// ── Betano helper: scroll to load all events ──
async function betanoScrollAndParse(page) {
  let prevCount = 0;
  let stableRounds = 0;
  for (let s = 0; s < 15; s++) {
    await page.keyboard.press('End');
    await humanDelay(350, 600);
    const count = await page.evaluate(() => document.querySelectorAll('[data-evtid]').length);
    if (count === prevCount) { stableRounds++; if (stableRounds >= 2) break; }
    else { stableRounds = 0; prevCount = count; }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await humanDelay(200, 300);
}

// ── Betano helper: parse events + odds for a specific market tab ──
async function betanoParseMarket(page, marketName) {
  return page.evaluate((market) => {
    const results = [];
    const cards = document.querySelectorAll('[data-evtid]');

    cards.forEach(card => {
      try {
        const participantsEl = card.querySelector('[data-qa="participants"]');
        if (!participantsEl) return;
        const teamEls = participantsEl.querySelectorAll('.tw-truncate');
        if (teamEls.length < 2) return;
        const home = teamEls[0]?.innerText?.trim();
        const away = teamEls[1]?.innerText?.trim();
        if (!home || !away) return;

        const timeSpans = card.querySelectorAll('span.tw-m-0');
        let dateStr = '', timeStr = '';
        timeSpans.forEach(sp => {
          const txt = sp.innerText?.trim() || '';
          if (/^\d{2}\/\d{2}$/.test(txt)) dateStr = txt;
          else if (/^\d{2}:\d{2}$/.test(txt)) timeStr = txt;
        });
        if (!timeStr) return;

        // Parse all selections from this card
        const selections = card.querySelectorAll('[data-qa="event-selection"]');
        const rawOdds = [];
        selections.forEach(sel => {
          const aria = sel.getAttribute('aria-label') || '';
          const ariaMatch = aria.match(/Bet on (.+?) with odds ([\d.]+)/);
          if (ariaMatch) {
            rawOdds.push({ label: ariaMatch[1].trim(), value: parseFloat(ariaMatch[2]) });
            return;
          }
          const labelEl = sel.querySelector('.s-name');
          const valueEl = sel.querySelector('.tw-text-sem-color-text-highlight');
          if (labelEl && valueEl) {
            rawOdds.push({ label: labelEl.innerText?.trim(), value: parseFloat(valueEl.innerText?.trim()?.replace(',', '.')) });
          }
        });

        // Map odds based on market
        const odds = {};
        for (const o of rawOdds) {
          if (!(o.value > 1 && o.value < 1000)) continue;
          const l = o.label;
          if (market === 'matchresult') {
            if (l === '1') odds.home = o.value;
            else if (l.toUpperCase() === 'X') odds.draw = o.value;
            else if (l === '2') odds.away = o.value;
          } else if (market === 'overunder') {
            if (/over|mais/i.test(l)) odds.over = o.value;
            else if (/under|menos/i.test(l)) odds.under = o.value;
            const lineMatch = l.match(/([\d.]+)/);
            if (lineMatch) odds.ouLine = parseFloat(lineMatch[1]);
          } else if (market === 'btts') {
            if (/sim|yes/i.test(l)) odds.bttsYes = o.value;
            else if (/n[ãa]o|no/i.test(l)) odds.bttsNo = o.value;
          } else if (market === 'doublechance') {
            if (l === '1X' || l === 'X1') odds.dc1x = o.value;
            else if (l === '12' || l === '21') odds.dc12 = o.value;
            else if (l === 'X2' || l === '2X') odds.dcx2 = o.value;
          } else if (market === 'htoverunder') {
            if (/over|mais/i.test(l)) odds.htOver = o.value;
            else if (/under|menos/i.test(l)) odds.htUnder = o.value;
            const lineMatch = l.match(/([\d.]+)/);
            if (lineMatch) odds.htOuLine = parseFloat(lineMatch[1]);
          }
        }

        const startTime = dateStr ? `${dateStr} ${timeStr}` : timeStr;
        results.push({ home, away, startTime, odds });
      } catch {}
    });
    return results;
  }, marketName);
}

// ════════════════════════════════════════════
//  BWIN.PT
// ════════════════════════════════════════════
async function scrapeBwin(browser, sport) {
  const urls = SITE_URLS.bwin[sport];
  if (!urls || !urls.length) return [];
  updateSiteProgress('bwin', { status: 'scraping', total: urls.length, current: 'A iniciar...' });

  const page = await createPage(browser);
  const allEvents = [];
  const seen = new Set();

  try {
    let cookiesHandled = false;

    for (let u = 0; u < urls.length; u++) {
      const url = urls[u];
      console.log(`[OddsScraper] Bwin: loading page ${u + 1}/${urls.length}`);
      updateSiteProgress('bwin', { current: `Página ${u + 1}/${urls.length}`, percent: Math.round((u / urls.length) * 100) });

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await humanDelay(500, 1000);

      // Accept cookies once
      if (!cookiesHandled) {
        try {
          const btn = await page.$('#onetrust-accept-btn-handler');
          if (btn) { await btn.click(); await humanDelay(300, 500); cookiesHandled = true; }
        } catch {}
      }

      await page.waitForSelector('.grid-event-wrapper, [class*="grid-event"]', { timeout: 15000 }).catch(() => {});
      await humanDelay(500, 800);

      // Scroll pattern
      const viewport = page.viewport() || { width: 1280, height: 800 };
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.mouse.click(viewport.width / 2, viewport.height / 2);
      await humanDelay(200, 400);

      let prevCount = 0;
      for (let s = 0; s < 15; s++) {
        await page.keyboard.press('End');
        await humanDelay(800, 1200);
        // Scroll back up via JS (avoids Input.dispatchMouseEvent protocolTimeout)
        await page.evaluate(() => window.scrollBy(0, -300));
        await humanDelay(500, 800);
        await page.evaluate(() => window.scrollBy(0, -200));
        await humanDelay(2000, 3000);
        const currentCount = await page.evaluate(() => document.querySelectorAll('.grid-event-wrapper').length);
        if (currentCount === prevCount && s > 2) break;
        prevCount = currentCount;
      }

      await page.keyboard.press('Home');
      await humanDelay(500, 800);

      const events = await page.evaluate((sportType) => {
        const results = [];
        const wrappers = document.querySelectorAll('.grid-event-wrapper');
        wrappers.forEach(el => {
          try {
            const participants = el.querySelectorAll('.participant');
            if (participants.length < 2) return;
            const home = participants[0]?.textContent?.trim();
            const away = participants[1]?.textContent?.trim();
            if (!home || !away || home.length > 80 || away.length > 80) return;

            const firstGroup = el.querySelector('.grid-option-group');
            if (!firstGroup) return;
            const valueEls = firstGroup.querySelectorAll('.option-value');
            const oddsValues = [];
            valueEls.forEach(valEl => {
              const text = valEl.textContent?.trim();
              if (text) {
                const val = parseFloat(text.replace(',', '.'));
                if (val > 1 && val < 1000) oddsValues.push(val);
              }
            });
            if (oddsValues.length < 2) return;

            const odds = { home: oddsValues[0] };
            if (sportType === 'football' && oddsValues.length >= 3) {
              odds.draw = oddsValues[1];
              odds.away = oddsValues[2];
            } else {
              odds.away = oddsValues[oddsValues.length >= 3 ? 2 : 1];
            }

            let startTime = '';
            const timerEl = el.querySelector('ms-prematch-timer');
            if (timerEl) startTime = timerEl.textContent.trim();

            results.push({ home, away, league: '', startTime, odds });
          } catch {}
        });
        return results;
      }, sport);

      let added = 0;
      for (const ev of events) {
        const key = `${ev.home}|${ev.away}`;
        if (!seen.has(key)) { seen.add(key); allEvents.push(ev); added++; }
      }
      console.log(`[OddsScraper] Bwin: page ${u + 1} — ${events.length} raw, ${added} new (total: ${allEvents.length})`);
    }

    console.log(`[OddsScraper] Bwin: found ${allEvents.length} events`);
    return allEvents;
  } catch (err) {
    console.error(`[OddsScraper] Bwin error:`, err);
    throw err;
  } finally {
    await page.close();
  }
}

// ════════════════════════════════════════════
//  BETCLIC.PT
// ════════════════════════════════════════════
async function scrapeBetclic(browser, sport) {
  const url = SITE_URLS.betclic[sport];
  if (!url) return [];
  updateSiteProgress('betclic', { status: 'scraping', current: 'A carregar página...' });

  const page = await createPage(browser);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    await humanDelay(500, 1000);

    // Accept cookies
    try {
      const btn = await page.$('#popin_tc_privacy_button_2, [id*="cookie-accept"], #onetrust-accept-btn-handler');
      if (btn) { await btn.click(); await humanDelay(300, 500); }
    } catch {}

    await page.waitForSelector('.cardEvent', { timeout: 15000 }).catch(() => {});
    await humanDelay(500, 800);

    // Scroll to load all lazy events
    let prevCount = 0;
    for (let s = 0; s < 20; s++) {
      await page.keyboard.press('End');
      await humanDelay(1500, 2500);
      const currentCount = await page.evaluate(() => document.querySelectorAll('.cardEvent').length);
      updateSiteProgress('betclic', { events: currentCount, current: `A carregar... ${currentCount} eventos`, percent: Math.min(90, s * 5) });
      if (currentCount === prevCount && s > 2) break;
      prevCount = currentCount;
    }

    await page.keyboard.press('Home');
    await humanDelay(300, 500);

    const rawEvents = await page.evaluate((sportType) => {
      const results = [];
      const cards = document.querySelectorAll('.cardEvent');
      cards.forEach(card => {
        try {
          const nameEls = card.querySelectorAll('.scoreboard_contestantLabel');
          if (nameEls.length < 2) return;
          const home = nameEls[0].textContent.trim();
          const away = nameEls[1].textContent.trim();
          if (!home || !away) return;

          const allLabels = card.querySelectorAll('.market_odds .btn_label:not(.is-top)');
          const oddsValues = [];
          allLabels.forEach(lbl => {
            const text = lbl.textContent.trim();
            if (text) {
              const val = parseFloat(text.replace(',', '.'));
              if (val > 1 && val < 1000) oddsValues.push(val);
            }
          });
          if (oddsValues.length < 2) return;

          const odds = { home: oddsValues[0] };
          if (sportType === 'football' && oddsValues.length >= 3) {
            odds.draw = oddsValues[1];
            odds.away = oddsValues[2];
          } else {
            odds.away = oddsValues[oddsValues.length >= 3 ? 2 : 1];
          }

          let startTime = '';
          const hourEl = card.querySelector('.scoreboard_hour');
          if (hourEl) startTime = hourEl.textContent.trim();

          let league = '';
          const breadcrumb = card.querySelector('.breadcrumb_item.is-ellipsis .breadcrumb_itemLabel');
          if (breadcrumb) league = breadcrumb.textContent.trim();

          results.push({ home, away, league, startTime, odds });
        } catch {}
      });
      return results;
    }, sport);

    // Dedup
    const seen = new Set();
    const events = [];
    for (const ev of rawEvents) {
      const key = `${ev.home}|${ev.away}`;
      if (!seen.has(key)) { seen.add(key); events.push(ev); }
    }
    console.log(`[OddsScraper] Betclic: found ${events.length} events`);
    return events;
  } catch (err) {
    console.error(`[OddsScraper] Betclic error:`, err);
    throw err;
  } finally {
    await page.close();
  }
}

// ════════════════════════════════════════════
//  PLACARD.PT
// ════════════════════════════════════════════
async function scrapePlacard(browser, sport) {
  const url = SITE_URLS.placard[sport];
  if (!url) return [];
  updateSiteProgress('placard', { status: 'scraping', current: 'A carregar competições...' });

  const PARALLEL_TABS = 3;

  // ── Shared helpers ──
  const dismissCookies = async (p) => {
    try {
      await p.evaluate(() => {
        const sels = ['#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll','#onetrust-accept-btn-handler','[class*="cookie"] button[class*="accept"]','[class*="cookie"] button[class*="Allow"]','[class*="Cookie"] button','.accept-cookies','button[data-testid="cookie-accept"]','[class*="consent"] button','[id*="cookie"] button'];
        for (const s of sels) { const b = document.querySelector(s); if (b) { b.click(); return; } }
        document.querySelectorAll('[class*="cookie"],[class*="Cookie"],[id*="cookie"],[class*="consent"],[class*="CybotCookiebot"]').forEach(e => e.remove());
      });
    } catch {}
  };

  const parseEvents = async (p, sportType, fallbackLeague) => {
    return p.evaluate((st, fl) => {
      const results = [];
      for (const item of document.querySelectorAll('.ta-EventListItem')) {
        try {
          const nameEls = item.querySelectorAll('.ta-participantName');
          if (nameEls.length < 2) continue;
          const home = nameEls[0].textContent.trim();
          const away = nameEls[1].textContent.trim();
          if (!home || !away) continue;
          const mkt = item.querySelector('.ta-MarketType-1');
          if (!mkt) continue;
          const prices = mkt.querySelectorAll('.ta-price_text');
          if (prices.length < (st === 'football' ? 3 : 2)) continue;
          const o1 = parseFloat(prices[0].textContent.trim().replace(',', '.'));
          const o2 = parseFloat(prices[1].textContent.trim().replace(',', '.'));
          const o3 = st === 'football' ? parseFloat(prices[2].textContent.trim().replace(',', '.')) : 0;
          if (isNaN(o1) || isNaN(o2) || o1 < 1.01 || o2 < 1.01) continue;
          if (st === 'football' && (isNaN(o3) || o3 < 1.01)) continue;
          let startTime = '';
          const dd = item.querySelector('div[style*="font-size: 12px"][style*="white-space: nowrap"]');
          if (dd) startTime = dd.textContent.trim();
          let league = fl || '';
          let el = item.parentElement; let d = 0;
          while (el && d < 20) {
            const h = el.querySelector('.ta-GroupHeader');
            if (h) { league = h.textContent.trim().split(/\n/)[0].replace(/1X2.*$/, '').replace(/Mais.*$/, '').trim(); break; }
            el = el.previousElementSibling || el.parentElement; if (el === document.body) break; d++;
          }
          const odds = { home: o1 };
          if (st === 'football') { odds.draw = o2; odds.away = o3; } else { odds.away = o2; }
          results.push({ home, away, league, startTime, odds });
        } catch {}
      }
      return results;
    }, sportType, fallbackLeague);
  };

  const expandAndScrape = async (p, sportType, compName) => {
    await p.waitForSelector('.ta-EventListItem, .ta-GroupHeader', { timeout: 10000 }).catch(() => {});
    await humanDelay(400, 700);
    // Fast expand: use evaluate to click + count in one call per header
    const headerCount = await p.evaluate(() => document.querySelectorAll('.ta-GroupHeader').length);
    for (let i = 0; i < headerCount; i++) {
      try {
        const closed = await p.evaluate((idx) => {
          const before = document.querySelectorAll('.ta-EventListItem').length;
          const h = document.querySelectorAll('.ta-GroupHeader')[idx];
          if (h) { h.scrollIntoView({ block: 'center' }); h.click(); }
          return before; // we'll check after
        }, i);
        await humanDelay(180, 300);
        const countAfter = await p.evaluate(() => document.querySelectorAll('.ta-EventListItem').length);
        if (countAfter < closed) {
          await p.evaluate((idx) => { const h = document.querySelectorAll('.ta-GroupHeader')[idx]; if (h) h.click(); }, i);
          await humanDelay(120, 200);
        }
      } catch {}
    }
    // Quick scroll for lazy loading
    for (let s = 0; s < 4; s++) {
      await p.evaluate((y) => window.scrollBy(0, y), 1200);
      await humanDelay(80, 150);
    }
    return parseEvents(p, sportType, compName);
  };

  const scrapeCompetition = async (tab, comp, sportType) => {
    try {
      await tab.goto(comp.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(600, 1000);
      await dismissCookies(tab);
      return await expandAndScrape(tab, sportType, comp.name);
    } catch (err) {
      console.warn(`[OddsScraper] Placard: failed "${comp.name}":`, err.message);
      return [];
    }
  };

  const listPage = await createCleanPage(browser);
  try {
    // ───── Step 1: Get competition list ─────
    await listPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(1200, 2000);
    await dismissCookies(listPage);
    await humanDelay(300, 500);
    await dismissCookies(listPage);
    await listPage.waitForSelector('a.ta-SportGroupsListButton', { timeout: 15000 }).catch(() => {});
    await humanDelay(400, 800);

    const competitionLinks = await listPage.evaluate(() => {
      return Array.from(document.querySelectorAll('a.ta-SportGroupsListButton')).map(a => ({
        href: a.href,
        name: (a.querySelector('.ta-sportClassTypeName')?.textContent || '').trim(),
      })).filter(l => l.href && l.name);
    });
    await listPage.close();

    console.log(`[OddsScraper] Placard: ${competitionLinks.length} competitions — ${PARALLEL_TABS} tabs parallel`);
    if (competitionLinks.length === 0) return [];
    updateSiteProgress('placard', { total: competitionLinks.length, current: `0/${competitionLinks.length} competições` });

    // ───── Step 2: Scrape in parallel batches ─────
    const allEvents = [];
    const dedup = new Set();
    let done = 0;

    for (let i = 0; i < competitionLinks.length; i += PARALLEL_TABS) {
      const batch = competitionLinks.slice(i, i + PARALLEL_TABS);
      const tabs = await Promise.all(batch.map(() => createCleanPage(browser)));
      const results = await Promise.all(batch.map((comp, idx) => scrapeCompetition(tabs[idx], comp, sport)));
      await Promise.all(tabs.map(t => t.close().catch(() => {})));

      for (let j = 0; j < batch.length; j++) {
        for (const ev of results[j]) {
          const key = `${ev.home}|${ev.away}`;
          if (!dedup.has(key)) { dedup.add(key); allEvents.push(ev); }
        }
        done++;
        console.log(`[OddsScraper] Placard: ${batch[j].name} — ${results[j].length} ev (total: ${allEvents.length})`);
      }
      updateSiteProgress('placard', { percent: Math.round((done / competitionLinks.length) * 95), current: `${done}/${competitionLinks.length} competições` });
    }

    console.log(`[OddsScraper] Placard: ${allEvents.length} total events from ${competitionLinks.length} competitions`);
    return allEvents;
  } catch (err) {
    console.error(`[OddsScraper] Placard error:`, err);
    throw err;
  }
}

// ════════════════════════════════════════════
//  EVENT MATCHING
// ════════════════════════════════════════════
function normalizeTeamName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|sc|ac|cf|cd|ud|sl|scp|sporting|clube|club|desportivo|associacao)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEventKey(home, away) {
  const h = normalizeTeamName(home);
  const a = normalizeTeamName(away);
  return h < a ? `${h}|${a}` : `${a}|${h}`;
}

function findBestOdds(oddsMap, sport) {
  const best = {};
  const outcomes = sport === 'tennis'
    ? ['home', 'away']
    : ['home', 'draw', 'away', 'over', 'under', 'bttsYes', 'bttsNo', 'dc1x', 'dcx2', 'dc12', 'htOver', 'htUnder'];

  outcomes.forEach(outcome => {
    let bestOdd = 0;
    let bestSite = null;
    Object.entries(oddsMap).forEach(([site, odds]) => {
      if (odds[outcome] && odds[outcome] > bestOdd) {
        bestOdd = odds[outcome];
        bestSite = site;
      }
    });
    if (bestOdd > 0) {
      best[outcome] = { odds: bestOdd, site: bestSite };
    }
  });

  return best;
}

function checkArbitrage(bestOdds, sport) {
  const coreOutcomes = sport === 'tennis' ? ['home', 'away'] : ['home', 'draw', 'away'];
  const coreOdds = coreOutcomes.map(o => bestOdds[o]).filter(Boolean);

  if (coreOdds.length < coreOutcomes.length) return { isArbitrage: false, roi: 0 };

  const totalImplied = coreOdds.reduce((sum, o) => sum + (1 / o.odds), 0);
  const roi = ((1 / totalImplied) - 1) * 100;

  return {
    isArbitrage: totalImplied < 1,
    roi: Math.round(roi * 100) / 100,
    totalImplied: Math.round(totalImplied * 10000) / 100,
  };
}

function matchEvents(siteData, sport, crossOdds = true) {
  // Raw mode: don't match/cross events across bookmakers
  if (!crossOdds) {
    const rawEvents = [];
    Object.entries(siteData).forEach(([site, events]) => {
      events.forEach(event => {
        const wrapped = {
          homeTeam: event.home,
          awayTeam: event.away,
          league: event.league || '',
          startTime: event.startTime || '',
          sport,
          odds: { [site]: event.odds },
          bookmakerCount: 1,
        };
        wrapped.bestOdds = findBestOdds(wrapped.odds, sport);
        wrapped.arbitrage = false;
        wrapped.arbitrageMargin = 0;
        rawEvents.push(wrapped);
      });
    });
    rawEvents.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    return rawEvents;
  }

  // Cross mode: match events across bookmakers
  const eventMap = new Map();

  Object.entries(siteData).forEach(([site, events]) => {
    events.forEach(event => {
      const key = normalizeEventKey(event.home, event.away);
      if (!eventMap.has(key)) {
        eventMap.set(key, {
          homeTeam: event.home,
          awayTeam: event.away,
          league: event.league || '',
          startTime: event.startTime || '',
          sport,
          odds: {},
        });
      }

      const existing = eventMap.get(key);
      existing.odds[site] = event.odds;

      if (event.league && event.league.length > (existing.league || '').length) {
        existing.league = event.league;
      }
      if (event.startTime && (!existing.startTime || event.startTime < existing.startTime)) {
        existing.startTime = event.startTime;
      }
    });
  });

  const allEvents = [];
  for (const event of eventMap.values()) {
    const bookmakerCount = Object.keys(event.odds).length;
    if (bookmakerCount >= 1) {
      event.bookmakerCount = bookmakerCount;
      event.bestOdds = findBestOdds(event.odds, sport);
      const arb = checkArbitrage(event.bestOdds, sport);
      event.arbitrage = arb.isArbitrage;
      event.arbitrageMargin = arb.roi / 100;
      allEvents.push(event);
    }
  }

  allEvents.sort((a, b) => {
    if (b.bookmakerCount !== a.bookmakerCount) return b.bookmakerCount - a.bookmakerCount;
    return (a.startTime || '').localeCompare(b.startTime || '');
  });

  return allEvents;
}

// ────── Cleanup ──────
async function closeBrowser() {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    console.log('[OddsScraper] Browser closed');
  }
}

// ────── Exports ──────
module.exports = {
  getOdds,
  getSports,
  clearCache: cacheClear,
  closeBrowser,
  getProgress: () => ({ ...progressData }),
};
