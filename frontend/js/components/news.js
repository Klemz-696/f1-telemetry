/**
 * news.js — Module d'actualités F1 francophones en temps réel.
 * Récupère les vrais flux d'actualités depuis l'API backend (/api/news).
 * Affiche une grille de cartes responsive avec filtrage par catégorie et recherche.
 */

import { store, updateStore, onUpdate } from "../store.js";
import { playSound } from "./sound_engine.js";

let _activeCategory = "all";
let _searchQuery = "";
let _allArticles = [];

export const FALLBACK_NEWS_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' stop-color='%23111317'/%3E%3Cstop offset='100%25' stop-color='%231c202a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='360' fill='url(%23g)'/%3E%3Cpath d='M200 180 L270 180 L290 120 L315 240 L335 150 L355 200 L375 180 L440 180' fill='none' stroke='%23e10600' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ctext x='50%25' y='82%25' fill='%23667085' font-family='system-ui,-apple-system,sans-serif' font-size='15' font-weight='bold' letter-spacing='2' text-anchor='middle'%3EFORMULA 1%3C/text%3E%3C/svg%3E";

function detectApiUrl() {
  const h = window.location.hostname;
  const p = window.location.port;
  if (p === "8080" || p === "80" || p === "443" || p === "" || (h !== "localhost" && h !== "127.0.0.1")) {
    return window.location.origin;
  }
  return "http://localhost:8000";
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  try {
    const pub = new Date(dateStr).getTime();
    if (isNaN(pub)) return dateStr;
    const diffSec = Math.floor((Date.now() - pub) / 1000);
    if (diffSec < 60) return "À l'instant";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Il y a ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `Il y a ${diffHours} h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Hier";
    if (diffDays < 7) return `Il y a ${diffDays} j`;
    return new Date(pub).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return dateStr;
  }
}

function getCategoryColor(category) {
  const MAP = {
    "Grand Prix": "#e10600",
    "Écuries": "#00d2be",
    "Technique": "#ffd700",
    "Transferts": "#9b59ff",
    "Interviews": "#3671c6",
    "Actualité": "#ff8000",
  };
  return MAP[category] || "#e10600";
}

function renderNewsGrid(articles) {
  const grid = document.getElementById("news-grid");
  if (!grid) return;

  if (!articles || articles.length === 0) {
    grid.innerHTML = `
      <div class="news-empty">
        <span class="news-empty-icon">📰</span>
        <p>Aucun article trouvé pour cette recherche ou catégorie.</p>
      </div>`;
    return;
  }

  grid.innerHTML = articles.map(a => {
    const catColor = getCategoryColor(a.category);
    const dateFormatted = timeAgo(a.published_at);
    const imgUrl = a.image_url || FALLBACK_NEWS_IMG;

    return `
      <article class="news-card" data-id="${a.id}">
        <div class="news-card-thumb">
          <img src="${imgUrl}" alt="${a.title}" loading="lazy" onerror="this.onerror=null; this.src=FALLBACK_NEWS_IMG;" />
          <span class="news-card-badge" style="background:${catColor}">${a.category}</span>
        </div>
        <div class="news-card-content">
          <div class="news-card-meta">
            <span class="news-source">📢 ${a.source || "F1"}</span>
            <span class="news-sep">•</span>
            <span class="news-time">⏱️ ${dateFormatted}</span>
          </div>
          <h3 class="news-card-title">${a.title}</h3>
          <p class="news-card-summary">${a.summary}</p>
          <div class="news-card-footer">
            <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="news-read-btn">
              Lire l'article complet ↗
            </a>
          </div>
        </div>
      </article>`;
  }).join("");
}

function filterArticles() {
  let filtered = _allArticles;

  if (_activeCategory !== "all") {
    filtered = filtered.filter(a => (a.category || "").toLowerCase() === _activeCategory.toLowerCase());
  }

  if (_searchQuery.trim()) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(a =>
      (a.title || "").toLowerCase().includes(q) ||
      (a.summary || "").toLowerCase().includes(q) ||
      (a.source || "").toLowerCase().includes(q)
    );
  }

  renderNewsGrid(filtered);
  updateNewsCount(filtered.length);
}

function updateNewsCount(count) {
  const countEl = document.getElementById("news-count");
  if (countEl) {
    countEl.textContent = `${count} article${count > 1 ? "s" : ""}`;
  }
}

export async function fetchNews(showSpinner = false) {
  const refreshBtn = document.getElementById("news-refresh-btn");
  if (refreshBtn && showSpinner) refreshBtn.classList.add("spinning");

  const statusEl = document.getElementById("news-status-msg");
  if (statusEl) statusEl.textContent = "Actualisation des dépêches F1…";

  const apiBase = detectApiUrl();
  const endpoints = [`${apiBase}/api/news`];
  if (apiBase.includes(":8000")) {
    endpoints.push(`${apiBase}/news`);
  }
  endpoints.push(`${apiBase}/proxy/api/news`);

  let data = null;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { headers: { Accept: "application/json" } });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("application/json")) {
        data = await res.json();
        if (data?.articles?.length) break;
      }
    } catch {
      // continuer sur fallback suivant
    }
  }

  if (refreshBtn) refreshBtn.classList.remove("spinning");

  if (data && Array.isArray(data.articles) && data.articles.length > 0) {
    _allArticles = data.articles;
    updateStore({ news: _allArticles });
    filterArticles();
    if (statusEl) {
      const updated = data.updated_at ? new Date(data.updated_at * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "Récemment";
      statusEl.textContent = `Dernière synchronisation : ${updated}`;
    }
  } else {
    if (statusEl) statusEl.textContent = "Flux temporairement indisponible.";
  }
}

export function renderHomeNews(container) {
  if (!container) return;
  const articles = store.news || _allArticles;
  if (!articles || articles.length === 0) {
    container.innerHTML = `<div class="home-section-empty">Chargement des actualités…</div>`;
    return;
  }

  const top3 = articles.slice(0, 3);
  container.innerHTML = `
    <div class="home-news-grid">
      ${top3.map(a => {
        const catColor = getCategoryColor(a.category);
        const dateFormatted = timeAgo(a.published_at);
        return `
          <a href="${a.link}" target="_blank" rel="noopener noreferrer" class="home-news-card">
            <div class="home-news-thumb">
              <img src="${a.image_url || FALLBACK_NEWS_IMG}" alt="${a.title}" onerror="this.onerror=null; this.src=FALLBACK_NEWS_IMG;" />
              <span class="home-news-badge" style="background:${catColor}">${a.category}</span>
            </div>
            <div class="home-news-body">
              <span class="home-news-source">${a.source} · ${dateFormatted}</span>
              <h4 class="home-news-title">${a.title}</h4>
            </div>
          </a>`;
      }).join("")}
    </div>`;
}

export function initNews() {
  // Onglets filtres catégories
  document.querySelectorAll(".news-filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      playSound("click");
      document.querySelectorAll(".news-filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _activeCategory = btn.dataset.category || "all";
      filterArticles();
    });
  });

  // Recherche textuelle
  const searchInput = document.getElementById("news-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", e => {
      _searchQuery = e.target.value;
      filterArticles();
    });
  }

  // Bouton de rafraîchissement
  const refreshBtn = document.getElementById("news-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      playSound("click");
      fetchNews(true);
    });
  }

  // Chargement initial
  fetchNews();

  // Écoute des mises à jour du store (notamment pour la home page)
  onUpdate(state => {
    if (state.news && state.news.length && state.news !== _allArticles) {
      _allArticles = state.news;
      filterArticles();
    }
    const homeNewsEl = document.getElementById("home-news-container");
    if (homeNewsEl) renderHomeNews(homeNewsEl);
  });
}
