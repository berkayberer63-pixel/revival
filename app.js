(() => {
  "use strict";

  const PAGE_SIZE = 50;

  // 21 Sub-stat Turkish names (exact Goley / Revival card popup labels)
  const SUB_STAT_NAMES = [
    { idx: 0,  name: "Hız",       cat: "hiz" },
    { idx: 1,  name: "Sürat",     cat: "hiz" },
    { idx: 2,  name: "Kond.",     cat: "guc" },
    { idx: 3,  name: "Denge",     cat: "guc" },
    { idx: 4,  name: "Tepki",     cat: "zhn" },
    { idx: 5,  name: "Atiklik",   cat: "hiz" },
    { idx: 6,  name: "Aktiflik",  cat: "zhn" },
    { idx: 7,  name: "Sakinlik",  cat: "zhn" },
    { idx: 8,  name: "Sürme",     cat: "tek" },
    { idx: 9,  name: "Kontrol",   cat: "tek" },
    { idx: 10, name: "Kısa P.",   cat: "tek" },
    { idx: 11, name: "Uzun P.",   cat: "tek" },
    { idx: 12, name: "Şut",       cat: "ofa" },
    { idx: 13, name: "Ş.Gücü",    cat: "ofa" },
    { idx: 14, name: "Falso",     cat: "ofa" },
    { idx: 15, name: "Kafa",      cat: "guc" },
    { idx: 16, name: "Markaj",    cat: "def" },
    { idx: 17, name: "Çalma",     cat: "def" },
    { idx: 18, name: "Dalış",        cat: "def" },
    { idx: 19, name: "Elle Kontrol", cat: "def" },
    { idx: 20, name: "Kurtarış",     cat: "guc" }
  ];

  const GRADE_LABELS = {
    Gold: "Efsane",
    Master: "Süper",
    Elite: "Uzman",
    Rare: "Ender",
    Special: "Özel",
    Normal: "Normal"
  };

  const WEATHER_LABELS = {
    Sunny: "☀️ Güneşli",
    Rainy: "🌧️ Yağmurlu",
    Snow: "❄️ Karlı",
    Cloudy: "☁️ Bulutlu",
    None: "➖ Yok"
  };

  // Position category for badge coloring
  function getPosCategory(role) {
    if (["GF", "FRV", "K FT"].includes(role)) return "pos-fw";
    if (["OOS", "KNT", "OS", "LBR"].includes(role)) return "pos-mf";
    if (["K DF", "BEK", "DF", "LİB"].includes(role)) return "pos-df";
    return "pos-gk";
  }

  // Stat color class
  function getStatClass(val) {
    if (val >= 90) return "stat-s";
    if (val >= 80) return "stat-a";
    if (val >= 70) return "stat-b";
    if (val >= 60) return "stat-c";
    return "stat-d";
  }

  // Bar fill color
  function getBarColor(val) {
    if (val >= 90) return "#facc15";
    if (val >= 80) return "#4ade80";
    if (val >= 70) return "#38bdf8";
    if (val >= 60) return "#94a3b8";
    return "#475569";
  }

  // PWR pill class
  function getPwrClass(val) {
    if (val >= 80) return "pwr-high";
    if (val >= 70) return "pwr-mid";
    return "pwr-low";
  }

  // State
  let allPlayers = [];
  let filteredPlayers = [];
  let currentPage = 1;
  let expandedCardId = null;
  let compareList = [];
  let favoritesSet = new Set();
  const playerDetailEquip = new Map(); // playerId -> { cle, leg, arm }

  // Active Filters
  const state = {
    search: "",
    team: "",
    year: "",
    sort: "pwr_desc",
    roles: new Set(),
    grades: new Set(),
    regions: new Set(),
    favOnly: false,
    minOfa: 0,
    minDef: 0,
    minGuc: 0,
    minHiz: 0,
    minTek: 0,
    minZhn: 0,
    minSub: new Array(21).fill(0),
    weather: "",
    level: 0,
    // Seçili amblem: { team, year, stars, league, bonus:{ATT,DEF,POW,SPD,TEC,MEN} }
    emblem: null
  };

  function saveFavorites() {
    try { localStorage.setItem("rvl_favorites", JSON.stringify(Array.from(favoritesSet))); } catch (_) {}
    const cntEl = document.getElementById("favCount");
    if (cntEl) cntEl.textContent = String(favoritesSet.size);
  }

  function saveCompareList() {
    try { localStorage.setItem("rvl_compare_list", JSON.stringify(compareList.map((p) => p.id))); } catch (_) {}
  }

  const EQUIP_BUFF_MAP = {
    "Hız": 0,
    "Sürat": 1,
    "Kondisyon": 2,
    "Denge": 3,
    "Tepki": 4,
    "Atiklik": 5,
    "Aktiflik": 6,
    "Sakinlik": 7,
    "Top Sürme": 8,
    "Top Kontrolü": 9,
    "Kısa Pas": 10,
    "Uzun Pas": 11,
    "Şut": 12,
    "Şut Gücü": 13,
    "Falso": 14,
    "Kafa": 15,
    "Markaj": 16,
    "Çalma": 17,
    "Dalış (KL)": 18,
    "Kontrol (KL)": 19,
    "Kurtarış (KL)": 20
  };

  function getEquipmentsBySlot(slotName, isGk) {
    const data = window.EQUIPMENTS_DATA || {};
    const target = isGk ? "Kaleci" : "Saha oyuncusu";
    return (data.items || []).filter((it) => it.slot === slotName && it.target === target);
  }

  function addEquipmentBuffs(subBonus, buffStr, overrideValue = null) {
    for (const part of String(buffStr || "").split(",")) {
      const m = part.trim().match(/^\+(\d+)\s+(.+)$/);
      if (m) {
        const idx = EQUIP_BUFF_MAP[m[2].trim()];
        if (idx !== undefined) subBonus[idx] += overrideValue !== null ? overrideValue : Number(m[1]);
      }
    }
  }

  function computeEquipmentBonuses(equipIds) {
    const subBonus = new Array(21).fill(0);
    if (!equipIds) return { subBonus, items: [], activeSet: null };
    const data = window.EQUIPMENTS_DATA || {};
    const allItems = data.items || [];
    const allSets = data.sets || [];
    const picked = [];
    for (const key of ["cle", "leg", "arm"]) {
      const id = equipIds[key];
      if (!id) continue;
      const item = allItems.find((x) => String(x.id) === String(id));
      if (item) {
        picked.push(item);
        addEquipmentBuffs(subBonus, item.buff);
      }
    }
    let activeSet = null;
    if (picked.length === 3 && picked[0].setId && picked[0].setId === picked[1].setId && picked[1].setId === picked[2].setId) {
      activeSet = allSets.find((s) => s.id === picked[0].setId) || null;
      for (const item of picked) {
        addEquipmentBuffs(subBonus, item.buff, 1);
      }
    }
    return { subBonus, items: picked, activeSet };
  }

  // DOM Elements
  const dbBadge = document.getElementById("dbBadge");
  const searchInput = document.getElementById("searchInput");
  const clearSearchBtn = document.getElementById("clearSearchBtn");
  const teamSelect = document.getElementById("teamSelect");
  const yearSelect = document.getElementById("yearSelect");
  const sortSelect = document.getElementById("sortSelect");
  const advFilterBtn = document.getElementById("advFilterBtn");
  const advFilterPanel = document.getElementById("advFilterPanel");
  const minOfaInput = document.getElementById("minOfa");
  const minDefInput = document.getElementById("minDef");
  const minGucInput = document.getElementById("minGuc");
  const minHizInput = document.getElementById("minHiz");
  const minTekInput = document.getElementById("minTek");
  const minZhnInput = document.getElementById("minZhn");
  const weatherSelect = document.getElementById("weatherSelect");
  const resetAllBtn = document.getElementById("resetAllBtn");
  const levelSlider = document.getElementById("levelSlider");
  const levelValue = document.getElementById("levelValue");
  const resultCountText = document.getElementById("resultCountText");
  const playersTableBody = document.getElementById("playersTableBody");
  const pageInfo = document.getElementById("pageInfo");
  const pageButtons = document.getElementById("pageButtons");

  // Compare & Spirit Modal Elements
  const compareBar = document.getElementById("compareBar");
  const compareSlots = document.getElementById("compareSlots");
  const compareCount = document.getElementById("compareCount");
  const openCompareModalBtn = document.getElementById("openCompareModalBtn");
  const clearCompareBtn = document.getElementById("clearCompareBtn");
  const compareModal = document.getElementById("compareModal");
  const closeCompareModal = document.getElementById("closeCompareModal");
  const compareModalBody = document.getElementById("compareModalBody");

  const teamSpiritBtn = document.getElementById("teamSpiritBtn");
  const spiritActiveBadge = document.getElementById("spiritActiveBadge");
  const spiritModal = document.getElementById("spiritModal");
  const closeSpiritModal = document.getElementById("closeSpiritModal");
  const applySpiritBtn = document.getElementById("applySpiritBtn");
  const resetSpiritBtn = document.getElementById("resetSpiritBtn");

  // Exact position weights & normalization constants (Revival card pool)
  const ROLE_WEIGHTS = {
    "KL":   [ 5, 35, 30,  5, 10, 15],
    "LİB":  [ 5, 35, 20, 10, 10, 20],
    "DF":   [ 0, 40, 20, 15, 10, 15],
    "BEK":  [10, 30, 15, 20, 15, 10],
    "K DF": [15, 25, 15, 20, 15, 10],
    "LBR":  [10, 30, 20, 10, 15, 15],
    "OS":   [20, 15, 15, 10, 25, 15],
    "KNT":  [25, 10, 10, 20, 20, 15],
    "OOS":  [30,  5, 10, 15, 25, 15],
    "K FT": [30,  5, 10, 25, 20, 10],
    "FRV":  [35,  5, 15, 15, 15, 15],
    "GF":   [40,  5, 15, 15, 10, 15]
  };
  const MIN_RAW_W = 33.15;
  const MAX_RAW_W = 79.10;

  // ===== AMBLEM SİSTEMİ =====
  // Ana stat sırası: ATT(OFA), DEF, POW(GÜÇ), SPD(HIZ), TEC(TEK), MEN(ZHN)
  const MAIN_KEYS = ["ATT", "DEF", "POW", "SPD", "TEC", "MEN"];
  const MAIN_LABELS = { ATT: "OFA", DEF: "DEF", POW: "GÜÇ", SPD: "HIZ", TEC: "TEK", MEN: "ZHN" };

  // 2. resimdeki eşleşmeye göre her ana stat kendi grubundaki alt statlara birebir eklenir:
  // OFA(ATT): Şut, Ş.Gücü, Falso
  // DEF(DEF): Markaj, Çalma, Elle K., Uzanma
  // GÜÇ(POW): Denge, Kond., Kafa, Kurtarış
  // HIZ(SPD): Hız, Sürat, Atiklik
  // ZHN(MEN): Tepki, Aktiflik, Sakinlik
  // TEK(TEC): Sürme, Kontrol, Kısa P., Uzun P.
  const CAT_TO_MAIN = {
    ofa: "ATT",
    def: "DEF",
    guc: "POW",
    hiz: "SPD",
    tek: "TEC",
    zhn: "MEN"
  };

  const EMBLEMS = Array.isArray(window.EMBLEMS_DATA) ? window.EMBLEMS_DATA : [];
  const STAR_LABELS = ["", "1★ Normal", "2★ Özel", "3★ Ender", "4★ Uzman", "5★ Süper"];

  const GOLEY_TEAM_CODES = {
    "ABD": "USA", "Ace Milano": "AML", "ACF Firenze": "AFZ", "Almanya": "GER",
    "Amsterdam Look": "ASR", "Amsterdam Rook": "ASR", "Anatolian Star": "STI",
    "Anatolian Warriors": "AWA", "Anatolian Wolves": "AWA", "Arjantin": "ARG",
    "AT Matador": "ATM", "Avustralya": "AUS", "Bat Knight": "BKN", "Belçika": "BEL",
    "Black Lion": "BLL", "Black Sea Hawks": "NHA", "Black Sea Storm": "NLS",
    "Blue Navy": "BNV", "Bosna-Hersek": "BIH", "Brezilya": "BRA",
    "Catalonia King": "CTK", "Cataluna King": "CTK", "Cezayir": "ALG",
    "Dark Eagles": "DEG", "Ekvador": "ECU", "FC Napoli": "FNP", "FC Sapphire": "FSP",
    "FC Spurs": "FSS", "Fildişi Sahili": "CIV", "Fiorentina": "AFZ", "Fire Bird": "FIB",
    "Flying Birds": "FYB", "Fransa": "FRA", "Gana": "GHA", "Green Crocodiles": "WCR",
    "Güney Kore": "KOR", "Hırvatistan": "CRO", "Hollanda": "NED", "Honduras": "HND",
    "Ice Lion": "ICL", "İngiltere": "ENG", "İran": "IRN", "İspanya": "ESP",
    "İsviçre": "SUI", "İtalya": "ITA", "Japonya": "JPN", "Kamerun": "CMR",
    "King of Jungle": "KOJ", "King Sociedad": "KSD", "Knight Hoven": "NTH",
    "Knighthoven": "NTH", "Kolombiya": "COL", "Kosta Rika": "CRC", "London Cruiser": "LDC",
    "Lyon Lilly": "LOL", "Lyon Lily": "LOL", "Man Angel": "MAG", "Man Devil": "MAD",
    "Mandeville": "MAD", "Marseille Rose": "MAR", "Meksika": "MEX", "Napoli": "FNP",
    "Nijerya": "NGA", "Northern Hawks": "NHA", "Northlanders": "NLS", "Paris Iris": "PIR",
    "Portekiz": "POR", "Queen Madrid": "QMD", "Real Sociedad": "KSD", "Red Bear": "RDB",
    "Red Soldier": "RSD", "Red Wind": "WOA", "Romeu": "WFR", "Rusya": "RUS",
    "Schalke 04": "SK4", "Shark 04": "SK4", "SL Ruby": "SLR", "Snow Tigers": "STI",
    "South Falcons": "SFA", "Southern Falcons": "SFA", "Şili": "CHL", "Torino Zebra": "TRZ",
    "Türkiye": "TUR", "Uruguay": "URU", "Valencia": "BKN", "White Lily": "FSS",
    "Wild Crocs": "WCR", "Wind of Anatolia": "WOA", "Wolf Roma": "WFR",
    "Wyvern Milano": "WML", "Yellow Hornet": "YHN", "Yunanistan": "GRE"
  };
  const GOLEY_TEAM_CODES_LC = Object.fromEntries(
    Object.entries(GOLEY_TEAM_CODES).map(([k, v]) => [k.toLocaleLowerCase("tr"), v])
  );
  function hydratePlayerTeams(players) {
    for (const p of players) {
      if (!p.team && p.goleyTeam) {
        p.team = GOLEY_TEAM_CODES[p.goleyTeam] ||
          GOLEY_TEAM_CODES_LC[String(p.goleyTeam).toLocaleLowerCase("tr")] ||
          GOLEY_TEAM_CODES_LC[String(p.goleyTeam).toLowerCase()] || "";
      }
    }
  }

  const teamLabelMap = new Map();
  const teamDisplayMap = new Map();
  function ensureTeamMaps() {
    if (teamLabelMap.size > 0 || allPlayers.length === 0) return;
    for (const p of allPlayers) {
      if (!teamLabelMap.has(p.team)) {
        const label = p.goleyTeam || p.team;
        teamLabelMap.set(p.team, label);
        teamDisplayMap.set(p.team, {
          goleyName: p.goleyTeam || p.team,
          realName: ""
        });
      }
    }
  }
  function teamLabel(code) {
    ensureTeamMaps();
    return teamLabelMap.get(code) || code;
  }
  function getTeamDisplay(code) {
    ensureTeamMaps();
    return teamDisplayMap.get(code) || { goleyName: code, realName: "" };
  }

  // Seçilen yıldız sayısına göre amblem efektlerinin toplamı (SetEff1..N)
  function sumEmblemEffects(emb, stars) {
    const total = { ATT: 0, DEF: 0, POW: 0, SPD: 0, TEC: 0, MEN: 0 };
    const n = Math.min(stars, emb.effs.length);
    for (let i = 0; i < n; i++) {
      for (const k of Object.keys(emb.effs[i])) {
        if (k in total) total[k] += emb.effs[i][k];
      }
    }
    return total;
  }

  // Amblemin oyuncuya etki oranı:
  //  - Farklı bölge: 0
  //  - Aynı takım + aynı yıl: tam
  //  - Aynı takım + farklı yıl: yarım (yukarı yuvarla)
  //  - Aynı bölge, farklı takım + aynı yıl: yarım (yukarı yuvarla)
  //  - Aynı bölge, farklı takım + farklı yıl: 0
  function getEmblemMode(p) {
    const e = state.emblem;
    if (!e) return "none";
    if (p.league !== e.league) return "none";
    const isAll = e.year === 0 || e.year === "ALL";
    if (p.team === e.team) return (isAll || p.year === e.year) ? "full" : "half";
    return (isAll || p.year === e.year) ? "half" : "none";
  }

  function getEmblemBonusFor(p) {
    const mode = getEmblemMode(p);
    if (mode === "none") return null;
    const out = {};
    for (const k of MAIN_KEYS) {
      const v = state.emblem.bonus[k] || 0;
      out[k] = mode === "full" ? v : Math.ceil(v / 2);
    }
    out._mode = mode;
    return out;
  }

  function computeMainFromSub(sub, pos) {
    const isGk = pos === "GK";
    return {
      ofa: Math.floor((sub[12] + sub[13] + sub[14]) / 3),
      def: isGk ? Math.floor((sub[18] + sub[19]) / 2) : Math.floor((sub[16] + sub[17]) / 2),
      guc: isGk ? Math.floor((sub[2] + sub[3] + sub[20]) / 3) : Math.floor((sub[2] + sub[3] + sub[15]) / 3),
      hiz: Math.floor((sub[0] + sub[1] + sub[5]) / 3),
      tek: Math.floor((sub[8] + sub[9] + sub[10] + sub[11]) / 4),
      zhn: Math.floor((sub[4] + sub[6] + sub[7]) / 3)
    };
  }

  function getMaxLevelForGrade(grade) {
    if (grade === "Gold" || grade === "Master") return 25;
    if (grade === "Elite") return 20;
    return 15;
  }

  // Compute effective stats for a player given current level + emblem bonus (+ optional equipIds)
  function getEffectiveStats(p, lvlOverride = null, equipIds = null) {
    const rawLvl = lvlOverride !== null && lvlOverride !== undefined ? lvlOverride : state.level;
    const lvl = Math.min(rawLvl, getMaxLevelForGrade(p.grade));
    const emb = getEmblemBonusFor(p);
    const eq = equipIds ? computeEquipmentBonuses(equipIds) : null;
    const hasEq = eq && eq.items.length > 0;

    if (lvl === 0 && !emb && !hasEq) {
      return {
        ofa: p.ofa, def: p.def, guc: p.guc, hiz: p.hiz, tek: p.tek, zhn: p.zhn,
        pwr: p.pwr, total: p.total, sub: p.sub, emblemMode: "none", activeSet: null
      };
    }

    const sub = p.sub.map((val, idx) => {
      let add = lvl;
      if (emb) {
        const mainKey = CAT_TO_MAIN[SUB_STAT_NAMES[idx].cat];
        if (mainKey) add += emb[mainKey] || 0;
      }
      if (hasEq) {
        add += eq.subBonus[idx] || 0;
      }
      return val + add;
    });

    const m = computeMainFromSub(sub, p.pos);
    const total = m.ofa + m.def + m.guc + m.hiz + m.tek + m.zhn;
    const w = ROLE_WEIGHTS[p.role] || [16, 16, 16, 16, 18, 18];
    const rawW = (w[0] * m.ofa + w[1] * m.def + w[2] * m.guc + w[3] * m.hiz + w[4] * m.tek + w[5] * m.zhn) / 100.0;
    const pwr = Math.max(1, Math.round(1.0 + ((rawW - MIN_RAW_W) / (MAX_RAW_W - MIN_RAW_W)) * 99.0));

    return { ...m, pwr, total, sub, emblemMode: emb ? emb._mode : "none", activeSet: eq ? eq.activeSet : null };
  }

  // Populate Team & Year Dropdowns
  const TEAM_LEAGUE_ORDER = ["Güney Avrupa", "Kuzey Avrupa", "Türkiye", "Milli Takımlar"];
  let teamPickerMeta = new Map();

  function buildTeamIconImg(code) {
    const embIcon = (window.EMBLEM_ICONS || {})[code];
    if (!embIcon) return "";
    return `<img class="team-picker-icon" src="assets/emblems/${embIcon}" alt="" loading="lazy" onerror="this.style.display='none';" />`;
  }

  function syncTeamPickerUI(val) {
    const picker = document.getElementById("teamPicker");
    if (!picker) return;
    const btnLabel = picker.querySelector(".team-picker-btn-label");
    const info = val ? teamPickerMeta.get(val) : null;
    if (btnLabel) {
      btnLabel.innerHTML = info
        ? `${buildTeamIconImg(info.code)}<span>${info.label}</span>`
        : `<span>Tüm Takımlar</span>`;
    }
    picker.querySelectorAll(".team-picker-opt").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.value === (val || ""));
    });
  }

  function renderTeamPicker(groupedTeams) {
    if (!teamSelect || !teamSelect.parentNode) return;
    teamSelect.style.display = "none";

    let picker = document.getElementById("teamPicker");
    if (!picker) {
      picker = document.createElement("div");
      picker.id = "teamPicker";
      picker.className = "team-picker";
      picker.innerHTML = `
        <button type="button" class="team-picker-btn filter-select" aria-haspopup="listbox" aria-expanded="false">
          <span class="team-picker-btn-label"><span>Tüm Takımlar</span></span>
          <span class="team-picker-caret">▾</span>
        </button>
        <div class="team-picker-menu hidden" role="listbox"></div>
      `;
      teamSelect.insertAdjacentElement("afterend", picker);

      const btn = picker.querySelector(".team-picker-btn");
      const menu = picker.querySelector(".team-picker-menu");

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = !menu.classList.contains("hidden");
        menu.classList.toggle("hidden", isOpen);
        btn.setAttribute("aria-expanded", String(!isOpen));
      });

      menu.addEventListener("click", (e) => {
        const opt = e.target.closest(".team-picker-opt");
        if (!opt) return;
        const val = opt.dataset.value || "";
        teamSelect.value = val;
        state.team = val;
        syncTeamPickerUI(val);
        menu.classList.add("hidden");
        btn.setAttribute("aria-expanded", "false");
        applyFilters();
      });

      document.addEventListener("click", (e) => {
        if (!picker.contains(e.target)) {
          menu.classList.add("hidden");
          btn.setAttribute("aria-expanded", "false");
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          menu.classList.add("hidden");
          btn.setAttribute("aria-expanded", "false");
        }
      });
    }

    const menu = picker.querySelector(".team-picker-menu");
    let html = `<button type="button" class="team-picker-opt active" data-value=""><span>Tüm Takımlar</span></button>`;
    for (const [league, teams] of groupedTeams) {
      html += `<div class="team-picker-group-hdr">${league}</div>`;
      for (const t of teams) {
        html += `<button type="button" class="team-picker-opt" data-value="${t.code}">${buildTeamIconImg(t.code)}<span>${t.label}</span></button>`;
      }
    }
    menu.innerHTML = html;
    syncTeamPickerUI(teamSelect.value);
  }

  function populateDropdowns() {
    const teamMap = new Map();
    const yearsSet = new Set();

    for (const p of allPlayers) {
      if (p.team && !teamMap.has(p.team)) {
        const label = p.goleyTeam || p.team;
        teamMap.set(p.team, { code: p.team, label, league: p.league || "Diğer" });
      }
      if (p.year) yearsSet.add(p.year);
    }

    teamPickerMeta = teamMap;
    const byLeague = new Map();
    for (const item of teamMap.values()) {
      if (!byLeague.has(item.league)) byLeague.set(item.league, []);
      byLeague.get(item.league).push(item);
    }
    for (const list of byLeague.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label, "tr"));
    }

    const orderedLeagues = [
      ...TEAM_LEAGUE_ORDER.filter((lg) => byLeague.has(lg)),
      ...Array.from(byLeague.keys()).filter((lg) => !TEAM_LEAGUE_ORDER.includes(lg))
    ];
    const groupedTeams = orderedLeagues.map((lg) => [lg, byLeague.get(lg)]);

    for (const [league, teams] of groupedTeams) {
      const grp = document.createElement("optgroup");
      grp.label = league;
      for (const t of teams) {
        const opt = document.createElement("option");
        opt.value = t.code;
        opt.textContent = t.label;
        grp.appendChild(opt);
      }
      teamSelect.appendChild(grp);
    }
    renderTeamPicker(groupedTeams);

    const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
    for (const yr of sortedYears) {
      const opt = document.createElement("option");
      opt.value = String(yr);
      opt.textContent = String(yr);
      yearSelect.appendChild(opt);
    }
  }

  // Normalize string for Turkish case-insensitive search
  function normStr(str) {
    return (str || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/i̇/g, "i")
      .trim();
  }

  // Filter & Sort Players
  function applyFilters() {
    const q = normStr(state.search);

    filteredPlayers = [];
    for (let i = 0; i < allPlayers.length; i++) {
      const p = allPlayers[i];

      if (q) {
        const nameMatch = normStr(p.name).includes(q);
        const teamMatch = normStr(p.goleyTeam).includes(q);
        if (!nameMatch && !teamMatch) continue;
      }

      if (state.team && p.team !== state.team) continue;
      if (state.year && String(p.year) !== state.year) continue;
      if (state.favOnly && !favoritesSet.has(p.id)) continue;
      if (state.roles.size > 0 && !state.roles.has(p.role)) continue;
      if (state.grades.size > 0 && !state.grades.has(p.grade)) continue;
      if (state.regions.size > 0 && !state.regions.has(p.league)) continue;
      if (state.weather && p.weather !== state.weather) continue;

      const eff = getEffectiveStats(p);
      if (state.minOfa > 0 && eff.ofa < state.minOfa) continue;
      if (state.minDef > 0 && eff.def < state.minDef) continue;
      if (state.minGuc > 0 && eff.guc < state.minGuc) continue;
      if (state.minHiz > 0 && eff.hiz < state.minHiz) continue;
      if (state.minTek > 0 && eff.tek < state.minTek) continue;
      if (state.minZhn > 0 && eff.zhn < state.minZhn) continue;

      let subOk = true;
      for (let si = 0; si < state.minSub.length; si++) {
        const mv = state.minSub[si];
        if (mv > 0 && (eff.sub[si] || 0) < mv) {
          subOk = false;
          break;
        }
      }
      if (!subOk) continue;

      filteredPlayers.push({ player: p, eff });
    }

    // Sort
    const GRADE_SORT_ORDER = { Gold: 6, Master: 5, Elite: 4, Rare: 3, Special: 2, Normal: 1 };
    const ROLE_SORT_ORDER = {
      GF: 12, FRV: 11, "K FT": 10, OOS: 9, KNT: 8, OS: 7,
      LBR: 6, "K DF": 5, BEK: 4, DF: 3, "LİB": 2, KL: 1
    };
    const sortMode = state.sort;
    filteredPlayers.sort((a, b) => {
      switch (sortMode) {
        case "pwr_desc":
          return b.eff.pwr - a.eff.pwr || a.player.id - b.player.id;
        case "pwr_asc":
          return a.eff.pwr - b.eff.pwr || a.player.id - b.player.id;
        case "pos_desc":
          return (ROLE_SORT_ORDER[b.player.role] || 0) - (ROLE_SORT_ORDER[a.player.role] || 0) ||
            b.eff.pwr - a.eff.pwr;
        case "pos_asc":
          return (ROLE_SORT_ORDER[a.player.role] || 0) - (ROLE_SORT_ORDER[b.player.role] || 0) ||
            b.eff.pwr - a.eff.pwr;
        case "name_asc":
          return a.player.name.localeCompare(b.player.name, "tr") || b.eff.pwr - a.eff.pwr;
        case "name_desc":
          return b.player.name.localeCompare(a.player.name, "tr") || b.eff.pwr - a.eff.pwr;
        case "ofa_desc":
          return b.eff.ofa - a.eff.ofa || b.eff.pwr - a.eff.pwr;
        case "ofa_asc":
          return a.eff.ofa - b.eff.ofa || b.eff.pwr - a.eff.pwr;
        case "def_desc":
          return b.eff.def - a.eff.def || b.eff.pwr - a.eff.pwr;
        case "def_asc":
          return a.eff.def - b.eff.def || b.eff.pwr - a.eff.pwr;
        case "guc_desc":
          return b.eff.guc - a.eff.guc || b.eff.pwr - a.eff.pwr;
        case "guc_asc":
          return a.eff.guc - b.eff.guc || b.eff.pwr - a.eff.pwr;
        case "hiz_desc":
          return b.eff.hiz - a.eff.hiz || b.eff.pwr - a.eff.pwr;
        case "hiz_asc":
          return a.eff.hiz - b.eff.hiz || b.eff.pwr - a.eff.pwr;
        case "tek_desc":
          return b.eff.tek - a.eff.tek || b.eff.pwr - a.eff.pwr;
        case "tek_asc":
          return a.eff.tek - b.eff.tek || b.eff.pwr - a.eff.pwr;
        case "zhn_desc":
          return b.eff.zhn - a.eff.zhn || b.eff.pwr - a.eff.pwr;
        case "zhn_asc":
          return a.eff.zhn - b.eff.zhn || b.eff.pwr - a.eff.pwr;
        case "total_desc":
          return b.eff.total - a.eff.total || b.eff.pwr - a.eff.pwr;
        case "total_asc":
          return a.eff.total - b.eff.total || b.eff.pwr - a.eff.pwr;
        case "year_desc":
          return b.player.year - a.player.year || b.eff.pwr - a.eff.pwr;
        case "year_asc":
          return a.player.year - b.player.year || b.eff.pwr - a.eff.pwr;
        case "team_asc":
          return (a.player.goleyTeam || a.player.team || "").localeCompare(
            b.player.goleyTeam || b.player.team || "",
            "tr"
          ) || b.eff.pwr - a.eff.pwr;
        case "team_desc":
          return (b.player.goleyTeam || b.player.team || "").localeCompare(
            a.player.goleyTeam || a.player.team || "",
            "tr"
          ) || b.eff.pwr - a.eff.pwr;
        case "grade_desc":
          return (GRADE_SORT_ORDER[b.player.grade] || 0) - (GRADE_SORT_ORDER[a.player.grade] || 0) ||
            b.eff.pwr - a.eff.pwr;
        case "grade_asc":
          return (GRADE_SORT_ORDER[a.player.grade] || 0) - (GRADE_SORT_ORDER[b.player.grade] || 0) ||
            b.eff.pwr - a.eff.pwr;
        default:
          return b.eff.pwr - a.eff.pwr;
      }
    });

    currentPage = 1;
    renderTable();
  }

  function renderGoleyCardHtml(p, eff, lvl, refEff = null) {
    const subItems = [];
    const subStatsToShow = p.role === "KL"
      ? SUB_STAT_NAMES.filter((s) => s.idx !== 15 && s.idx !== 16 && s.idx !== 17)
      : SUB_STAT_NAMES.slice(0, 18);
    for (let si = 0; si < subStatsToShow.length; si++) {
      const st = subStatsToShow[si];
      const val = eff.sub[st.idx];
      let prefixHtml = "";
      if (refEff) {
        const cmpDiff = val - refEff.sub[st.idx];
        if (cmpDiff > 0) prefixHtml = `<span class="goley-stat-diff-pos">+${cmpDiff}</span>`;
        else if (cmpDiff < 0) prefixHtml = `<span class="goley-stat-diff-neg">${cmpDiff}</span>`;
      } else {
        const diff = val - p.sub[st.idx];
        if (diff > 0) prefixHtml = `<span class="goley-stat-plus">+${diff}</span>`;
      }
      const gColor =
        val >= 90 ? "gstat-purple" :
        val >= 80 ? "gstat-red" :
        val >= 70 ? "gstat-dorange" :
        val >= 60 ? "gstat-lorange" : "gstat-gray";
      subItems.push(`
        <div class="goley-stat-item">
          <span class="goley-stat-label">${st.name}</span>
          <span class="goley-stat-num ${gColor}">${prefixHtml}${val}</span>
        </div>
      `);
    }

    const yrShort = String(p.year).length === 4 ? String(p.year).slice(2) : String(p.year);
    const footVal = p.foot || "R";
    const leftFootClass = (footVal === "L" || footVal === "B") ? "goley-foot-active" : "goley-foot-dim";
    const rightFootClass = (footVal === "R" || footVal === "B") ? "goley-foot-active" : "goley-foot-dim";
    const dobNation = [p.dob, p.nation].filter(Boolean).join(" / ") || `${p.year} / ${p.league}`;

    let shortSkill = "";
    if (p.skill) {
      const m = p.skill.match(/\(([^)]+)\)/);
      shortSkill = m ? m[1] : p.skill;
    }
    const effectiveLvl = Math.min(lvl, getMaxLevelForGrade(p.grade));
    const lvlPct = Math.min(100, Math.round((effectiveLvl / getMaxLevelForGrade(p.grade)) * 100));

    return `
      <div class="goley-card-popup">
        <div class="goley-card-header goley-header-${p.grade}">
          ${p.grade === "Master" ? `<div class="holo-hex"></div><div class="holo-shine"></div>` : ""}
          <div class="goley-header-top">
            <div class="goley-title-block">
              <div class="goley-yr-name">${yrShort} ${p.name}</div>
              <div class="goley-club-name">${p.goleyTeam}</div>
            </div>
            <div class="goley-icons-right">
              <div class="goley-jersey-icon" title="Forma Numarası">
                <svg viewBox="0 0 36 32" fill="none">
                  <path d="M9 3L2 8.5L5.5 14L9.5 11.5V29H26.5V11.5L30.5 14L34 8.5L27 3H22.5C21.8 5.2 20.1 6.5 18 6.5C15.9 6.5 14.2 5.2 13.5 3H9Z" fill="#ffffff" stroke="#18181b" stroke-width="1.5"/>
                </svg>
                <span class="goley-jersey-num">${p.number || ""}</span>
              </div>
              <div class="goley-feet-icon" title="Kullandığı Ayak: ${footVal === "B" ? "Her İki Ayak" : footVal === "L" ? "Sol Ayak" : "Sağ Ayak"}">
                <svg class="goley-foot-svg ${leftFootClass}" viewBox="0 0 14 28">
                  <path d="M7.5 1.5C4.2 1.5 2 4.5 2.2 9.2C2.4 13.2 3.5 16.5 3.6 19.5C3.7 23.2 4.2 26.5 7.2 26.5C9.8 26.5 10.8 23.8 10.6 19.8C10.4 16.5 11.4 13.2 11.8 9.2C12.2 4.8 10.5 1.5 7.5 1.5Z"/>
                </svg>
                <svg class="goley-foot-svg ${rightFootClass}" viewBox="0 0 14 28">
                  <path d="M6.5 1.5C9.8 1.5 12 4.5 11.8 9.2C11.6 13.2 10.5 16.5 10.4 19.5C10.3 23.2 9.8 26.5 6.8 26.5C4.2 26.5 3.2 23.8 3.4 19.8C3.6 16.5 2.6 13.2 2.2 9.2C1.8 4.8 3.5 1.5 6.5 1.5Z"/>
                </svg>
              </div>
            </div>
          </div>
          <div class="goley-header-sub">${dobNation}</div>
        </div>
        <div class="goley-stats-grid">
          ${subItems.join("")}
        </div>
        <div class="goley-card-footer">
          <div class="goley-lvl-row">
            <span class="goley-lvl-text">LvL<strong>${effectiveLvl}</strong></span>
            <div class="goley-lvl-bar-track">
              <div class="goley-lvl-bar-fill" style="width:${lvlPct}%"></div>
            </div>
          </div>
          <div class="goley-skill-slots">
            <div class="goley-skill-box ${shortSkill ? "has-skill" : ""}" title="${p.skill || "Yetenek Yok"}">
              ${shortSkill ? `<span class="goley-s-shield">S</span><span>${shortSkill}</span>` : "-"}
            </div>
            <div class="goley-skill-box">-</div>
            <div class="goley-skill-box">-</div>
            <div class="goley-skill-box">-</div>
          </div>
        </div>
      </div>
    `;
  }

  function buildDetailRowHtml(p) {
    const detEq = playerDetailEquip.get(p.id) || { cle: "", leg: "", arm: "" };
    const detEff = getEffectiveStats(p, state.level, detEq);
    let emblemTxt = "Yok";
    if (state.emblem) {
      const modeTxt = { full: "Tam bonus", half: "Yarım bonus", none: "Etkisiz" }[detEff.emblemMode];
      emblemTxt = `${state.emblem.team} ${state.emblem.year} ${state.emblem.stars}★ — ${modeTxt}`;
    }
    const weatherTxt = WEATHER_LABELS[p.weather] || p.weather;
    const isGk = p.pos === "GK" || p.role === "KL";
    const buildEqOpts = (slotName, selId) => {
      const items = getEquipmentsBySlot(slotName, isGk);
      return `<option value="">Yok</option>` + items.map((it) =>
        `<option value="${it.id}" ${String(it.id) === String(selId) ? "selected" : ""}>${it.name} (${it.buff})</option>`
      ).join("");
    };

    return `
      <tr class="detail-row">
        <td colspan="13">
          <div class="detail-popup-wrap">
            ${renderGoleyCardHtml(p, detEff, state.level)}

            <div class="detail-side-info">
              <div class="detail-side-row"><span>Bölge</span><strong>${p.league}</strong></div>
              <div class="detail-side-row"><span>Maliyet</span><strong>${p.cost}</strong></div>
              <div class="detail-side-row"><span>Hava Durumu</span><strong>${weatherTxt}</strong></div>
              <div class="detail-side-row"><span>Amblem</span><strong class="emb-mode-${detEff.emblemMode}">${emblemTxt}</strong></div>
              ${p.skill ? `<div class="detail-side-row"><span>Tam Yetenek</span><strong>⚡ ${p.skill}</strong></div>` : ""}

              <div class="detail-equip-sim">
                <div class="detail-equip-title">Ekipman Simülatörü</div>
                <div class="detail-equip-row">
                  <label>Krampon</label>
                  <select class="filter-select detail-equip-sel" data-eq-pid="${p.id}" data-eq-slot="cle">${buildEqOpts("Krampon", detEq.cle)}</select>
                </div>
                <div class="detail-equip-row">
                  <label>Bacak</label>
                  <select class="filter-select detail-equip-sel" data-eq-pid="${p.id}" data-eq-slot="leg">${buildEqOpts("Bacak", detEq.leg)}</select>
                </div>
                <div class="detail-equip-row">
                  <label>Kol</label>
                  <select class="filter-select detail-equip-sel" data-eq-pid="${p.id}" data-eq-slot="arm">${buildEqOpts("Kol", detEq.arm)}</select>
                </div>
                ${detEff.activeSet ? `<div class="sq-equip-set-badge">✨ Set Aktif: ${detEff.activeSet.name} (Tüm ekipmana +1)</div>` : ""}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function toggleRowDetailInPlace(row, cid) {
    const prevDetail = playersTableBody.querySelector("tr.detail-row");
    if (prevDetail) prevDetail.remove();
    const prevExpanded = playersTableBody.querySelector("tr.player-row.expanded");
    if (prevExpanded && prevExpanded !== row) prevExpanded.classList.remove("expanded");

    if (expandedCardId === cid) {
      expandedCardId = null;
      row.classList.remove("expanded");
      return;
    }

    const found = allPlayers.find((x) => x.id === cid);
    if (!found) return;
    expandedCardId = cid;
    row.classList.add("expanded");
    row.insertAdjacentHTML("afterend", buildDetailRowHtml(found));
  }

  // Render Table & Pagination
  function renderTable() {
    const total = filteredPlayers.length;
    resultCountText.textContent = `${total.toLocaleString("tr-TR")} oyuncu bulundu`;

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filteredPlayers.slice(startIdx, startIdx + PAGE_SIZE);

    if (pageItems.length === 0) {
      playersTableBody.innerHTML = `<tr><td colspan="13" class="loading-cell">Arama kriterlerinize uygun oyuncu bulunamadı.</td></tr>`;
      pageInfo.textContent = "Sayfa 0 / 0";
      pageButtons.innerHTML = "";
      return;
    }

    const rowsHtml = [];
    for (const item of pageItems) {
      const p = item.player;
      const eff = item.eff;
      const isExpanded = expandedCardId === p.id;
      const isCompared = compareList.some((c) => c.id === p.id);

      const posClass = getPosCategory(p.role);
      const gradeLabel = GRADE_LABELS[p.grade] || p.grade;
      const embIcon = (window.EMBLEM_ICONS || {})[p.team];
      const teamIconHtml = embIcon
        ? `<img class="tbl-team-icon" src="assets/emblems/${embIcon}" alt="${p.team}" loading="lazy" onerror="this.style.display='none';" />`
        : "";

      rowsHtml.push(`
        <tr class="player-row ${isExpanded ? "expanded" : ""}" data-id="${p.id}">
          <td class="cell-center"><span class="pos-badge ${posClass}">${p.role}</span></td>
          <td>
            <div class="player-name-wrap">
              <span class="player-name-text">${p.name}</span>
            </div>
          </td>
          <td>
            <div class="tbl-team-wrap">
              ${teamIconHtml}
              <div>
                <span class="team-main">${p.goleyTeam}</span>
              </div>
            </div>
          </td>
          <td class="cell-center"><span class="year-text">${p.year}</span></td>
          <td class="cell-center"><span class="grade-badge grade-${p.grade}">${gradeLabel}</span></td>
          <td class="stat-cell ${getStatClass(eff.ofa)}">${eff.ofa}</td>
          <td class="stat-cell ${getStatClass(eff.def)}">${eff.def}</td>
          <td class="stat-cell ${getStatClass(eff.guc)}">${eff.guc}</td>
          <td class="stat-cell ${getStatClass(eff.hiz)}">${eff.hiz}</td>
          <td class="stat-cell ${getStatClass(eff.tek)}">${eff.tek}</td>
          <td class="stat-cell ${getStatClass(eff.zhn)}">${eff.zhn}</td>
          <td class="cell-center"><span class="pwr-pill ${getPwrClass(eff.pwr)}">${eff.pwr}</span></td>
          <td class="cell-center">
            <div class="tbl-row-actions">
              <button class="btn-fav-row ${favoritesSet.has(p.id) ? "active" : ""}" data-fav-id="${p.id}" title="Favorilere Ekle/Çıkar">★</button>
              <button class="btn-sq-row" data-send-sq-id="${p.id}" title="Kadroya Gönder">⚽</button>
              <button class="btn-cmp-row ${isCompared ? "selected" : ""}" data-cmp-id="${p.id}" title="Karşılaştırmaya Ekle">+</button>
            </div>
          </td>
        </tr>
      `);

      if (isExpanded) {
        rowsHtml.push(buildDetailRowHtml(p));
      }
    }

    playersTableBody.innerHTML = rowsHtml.join("");
    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    pageInfo.textContent = `Sayfa ${currentPage} / ${totalPages}`;
    const btns = [];

    btns.push(
      `<button class="page-btn" data-page="${currentPage - 1}" ${
        currentPage <= 1 ? "disabled" : ""
      }>‹ Önceki</button>`
    );

    const maxVisible = 5;
    let startP = Math.max(1, currentPage - 2);
    let endP = Math.min(totalPages, startP + maxVisible - 1);
    if (endP - startP < maxVisible - 1) {
      startP = Math.max(1, endP - maxVisible + 1);
    }

    if (startP > 1) {
      btns.push(`<button class="page-btn" data-page="1">1</button>`);
      if (startP > 2) btns.push(`<span class="page-info">...</span>`);
    }

    for (let p = startP; p <= endP; p++) {
      btns.push(
        `<button class="page-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`
      );
    }

    if (endP < totalPages) {
      if (endP < totalPages - 1) btns.push(`<span class="page-info">...</span>`);
      btns.push(
        `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`
      );
    }

    btns.push(
      `<button class="page-btn" data-page="${currentPage + 1}" ${
        currentPage >= totalPages ? "disabled" : ""
      }>Sonraki ›</button>`
    );

    pageButtons.innerHTML = btns.join("");
  }

  // Compare Logic
  function toggleComparePlayer(cardId) {
    const cidStr = String(cardId);
    const idx = compareList.findIndex((c) => String(c.id) === cidStr);
    if (idx >= 0) {
      compareList.splice(idx, 1);
    } else {
      if (compareList.length >= 4) {
        alert("En fazla 4 oyuncuyu aynı anda karşılaştırabilirsiniz.");
        return;
      }
      const found = allPlayers.find((p) => String(p.id) === cidStr);
      if (found) compareList.push(found);
    }
    saveCompareList();
    updateCompareBar();
    renderTable();
    if (activeTab === "compare") renderCompareView();
  }

  function updateCompareBar() {
    if (compareList.length === 0) {
      compareBar.classList.add("hidden");
      return;
    }
    compareBar.classList.remove("hidden");
    compareCount.textContent = String(compareList.length);

    compareSlots.innerHTML = compareList
      .map(
        (p) => `
      <div class="cmp-chip">
        <span>${p.name} (${p.year} - ${GRADE_LABELS[p.grade] || p.grade})</span>
        <button data-rm-cmp="${p.id}">✕</button>
      </div>
    `
      )
      .join("");
  }

  function renderCompareSequenceHtml(list, rmAttr) {
    const effList = list.map((p) => getEffectiveStats(p));
    const parts = [];

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const eff = effList[i];
      parts.push(`
        <div class="compare-card-slot cmp-card-frame-${i}">
          <button class="cmp-remove-btn" ${rmAttr}="${p.id}" title="Karşılaştırmadan Çıkar">✕</button>
          ${renderGoleyCardHtml(p, eff, state.level)}
        </div>
      `);

      if (i < list.length - 1) {
        const nextP = list[i + 1];
        const nextEff = effList[i + 1];
        const hasGk = p.role === "KL" || nextP.role === "KL";
        const statsToCmp = hasGk ? SUB_STAT_NAMES : SUB_STAT_NAMES.slice(0, 18);

        const rows = statsToCmp.map((st) => {
          const lv = eff.sub[st.idx];
          const rv = nextEff.sub[st.idx];
          const diff = lv - rv;
          return `
            <div class="cmp-det-row">
              <span class="cmp-det-diff-l">${diff > 0 ? `▲${diff}` : ""}</span>
              <span class="cmp-det-val ${diff > 0 ? "win" : ""}">${lv}</span>
              <span class="cmp-det-label">${st.name}</span>
              <span class="cmp-det-val ${diff < 0 ? "win" : ""}">${rv}</span>
              <span class="cmp-det-diff-r">${diff < 0 ? `${Math.abs(diff)}▲` : ""}</span>
            </div>
          `;
        }).join("");

        parts.push(`
          <div class="cmp-details-panel">
            <div class="cmp-details-title">Detaylar</div>
            ${rows}
          </div>
        `);
      }
    }

    return `<div class="compare-sequence">${parts.join("")}</div>`;
  }

  function renderCompareRadarHtml(list) {
    if (!list || list.length === 0) return "";
    const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];
    const axes = [
      { key: "ofa", label: "OFA" },
      { key: "def", label: "DEF" },
      { key: "guc", label: "GÜÇ" },
      { key: "hiz", label: "HIZ" },
      { key: "tek", label: "TEK" },
      { key: "zhn", label: "ZHN" }
    ];
    const cx = 135, cy = 125, rMax = 88;
    const maxVal = 125;
    const angleFor = (i) => (-Math.PI / 2) + (i * 2 * Math.PI) / axes.length;
    const pt = (i, val) => {
      const a = angleFor(i);
      const r = (Math.min(maxVal, Math.max(0, val)) / maxVal) * rMax;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    };

    const rings = [25, 50, 75, 100, 125].map((lv) => {
      const pts = axes.map((_, i) => pt(i, lv)).join(" ");
      return `<polygon points="${pts}" fill="none" stroke="rgba(148,163,184,0.18)" stroke-width="1" />`;
    }).join("");

    const spokes = axes.map((ax, i) => {
      const a = angleFor(i);
      const x2 = (cx + rMax * Math.cos(a)).toFixed(1);
      const y2 = (cy + rMax * Math.sin(a)).toFixed(1);
      const lx = (cx + (rMax + 18) * Math.cos(a)).toFixed(1);
      const ly = (cy + (rMax + 16) * Math.sin(a) + 4).toFixed(1);
      return `
        <line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="rgba(148,163,184,0.22)" stroke-width="1" />
        <text x="${lx}" y="${ly}" text-anchor="middle" fill="#cbd5e1" font-size="11" font-weight="700">${ax.label}</text>
      `;
    }).join("");

    const polys = list.map((p, idx) => {
      const eff = getEffectiveStats(p);
      const c = colors[idx % colors.length];
      const pts = axes.map((ax, i) => pt(i, eff[ax.key])).join(" ");
      return `<polygon points="${pts}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="2.2" />`;
    }).join("");

    const legend = list.map((p, idx) => {
      const eff = getEffectiveStats(p);
      const c = colors[idx % colors.length];
      return `
        <div class="radar-legend-item">
          <span class="radar-dot" style="background:${c};"></span>
          <span><strong>${p.name}</strong> <small>(${eff.pwr} PWR)</small></span>
        </div>
      `;
    }).join("");

    return `
      <div class="radar-card">
        <div class="radar-head">
          <h4>Ana Değer Radar Grafiği</h4>
          <div class="radar-legend">${legend}</div>
        </div>
        <svg viewBox="0 0 270 250" class="compare-radar-svg" aria-label="Oyuncu Radar Grafiği">
          ${rings}
          ${spokes}
          ${polys}
        </svg>
      </div>
    `;
  }

  function renderCompareSummaryHtml(list) {
    if (!list || list.length < 2) return "";
    const effs = list.map((p) => getEffectiveStats(p));
    const hasGk = list.some((p) => p.role === "KL");
    const mainRows = [
      { label: "PWR", vals: effs.map((e) => e.pwr) },
      { label: "OFA", vals: effs.map((e) => e.ofa) },
      { label: "DEF", vals: effs.map((e) => e.def) },
      { label: "GÜÇ", vals: effs.map((e) => e.guc) },
      { label: "HIZ", vals: effs.map((e) => e.hiz) },
      { label: "TEK", vals: effs.map((e) => e.tek) },
      { label: "ZHN", vals: effs.map((e) => e.zhn) },
      { label: "TOPLAM", vals: effs.map((e) => e.total) }
    ];
    const subRows = (hasGk ? SUB_STAT_NAMES : SUB_STAT_NAMES.slice(0, 18)).map((st) => ({
      label: st.name,
      vals: effs.map((e) => e.sub[st.idx] || 0)
    }));

    const buildRows = (rows, isSub) => rows.map((r) => {
      const maxV = Math.max(...r.vals);
      const minV = Math.min(...r.vals);
      const diff = maxV - minV;
      const cells = r.vals.map((v) => {
        const isWin = v === maxV && diff > 0;
        const delta = v - r.vals[0];
        const deltaStr = delta === 0 ? "" : `<small class="${delta > 0 ? "diff-pos" : "diff-neg"}">${delta > 0 ? `+${delta}` : delta}</small>`;
        return `<td class="${isWin ? "cmp-sum-win" : ""}">${isWin ? "🏆 " : ""}${v} ${deltaStr}</td>`;
      }).join("");
      return `
        <tr class="${isSub ? "cmp-sum-sub-row" : "cmp-sum-main-row"}">
          <td class="cmp-sum-lbl">${r.label}</td>
          ${cells}
          <td class="cmp-sum-spread">${diff > 0 ? `±${diff}` : "Eşit"}</td>
        </tr>
      `;
    }).join("");

    const headCols = list.map((p) => `<th>${p.name} <small>(${p.year})</small></th>`).join("");
    return `
      <div class="cmp-summary-card">
        <div class="cmp-summary-title">Kazanan Vurgusu & Fark Tablosu <small>(İlk oyuncuya göre +/- fark)</small></div>
        <div class="cmp-summary-scroll">
          <table class="cmp-sum-tbl">
            <thead>
              <tr><th>Değer</th>${headCols}<th>Fark</th></tr>
            </thead>
            <tbody>
              ${buildRows(mainRows, false)}
              ${buildRows(subRows, true)}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderCompareModal() {
    if (compareList.length === 0) return;

    compareModalBody.innerHTML = renderCompareRadarHtml(compareList) + renderCompareSequenceHtml(compareList, "data-cmp-modal-rm") + renderCompareSummaryHtml(compareList);
    compareModalBody.querySelectorAll("[data-cmp-modal-rm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleComparePlayer(btn.dataset.cmpModalRm);
        if (compareList.length === 0) {
          compareModal.classList.add("hidden");
        } else {
          renderCompareModal();
        }
      });
    });
    compareModal.classList.remove("hidden");
  }

  function debounce(fn, delay = 110) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function rafSchedule(fn) {
    let rafId = 0;
    return (...args) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        fn(...args);
      });
    };
  }

  // Event Listeners
  function bindEvents() {
    const applyFiltersDebounced = debounce(applyFilters, 110);
    const applyFiltersRaf = rafSchedule(applyFilters);

    searchInput.addEventListener("input", () => {
      state.search = searchInput.value;
      clearSearchBtn.classList.toggle("hidden", !state.search);
      applyFiltersDebounced();
    });

    clearSearchBtn.addEventListener("click", () => {
      searchInput.value = "";
      state.search = "";
      clearSearchBtn.classList.add("hidden");
      applyFilters();
    });

    teamSelect.addEventListener("change", () => {
      state.team = teamSelect.value;
      syncTeamPickerUI(state.team);
      applyFilters();
    });

    yearSelect.addEventListener("change", () => {
      state.year = yearSelect.value;
      applyFilters();
    });

    sortSelect.addEventListener("change", () => {
      state.sort = sortSelect.value;
      applyFilters();
    });

    advFilterBtn.addEventListener("click", () => {
      advFilterPanel.classList.toggle("hidden");
      advFilterBtn.classList.toggle("active");
    });

    const numInputs = [
      [minOfaInput, "minOfa"],
      [minDefInput, "minDef"],
      [minGucInput, "minGuc"],
      [minHizInput, "minHiz"],
      [minTekInput, "minTek"],
      [minZhnInput, "minZhn"]
    ];
    for (const [el, key] of numInputs) {
      el.addEventListener("input", () => {
        state[key] = parseInt(el.value, 10) || 0;
        applyFiltersDebounced();
      });
    }

    weatherSelect.addEventListener("change", () => {
      state.weather = weatherSelect.value;
      applyFilters();
    });

    const advSubGrid = document.getElementById("advSubGrid");
    if (advSubGrid && advSubGrid.children.length === 0) {
      advSubGrid.innerHTML = SUB_STAT_NAMES.map((st) => `
        <div class="adv-item">
          <label>${st.name}</label>
          <input type="number" class="min-sub-input" data-sub-idx="${st.idx}" min="0" max="150" placeholder="0" />
        </div>
      `).join("");
      advSubGrid.querySelectorAll(".min-sub-input").forEach((inp) => {
        inp.addEventListener("input", () => {
          const si = Number(inp.dataset.subIdx);
          const v = parseInt(inp.value, 10);
          state.minSub[si] = (!isNaN(v) && v > 0) ? v : 0;
          applyFiltersDebounced();
        });
      });
    }

    function resetAllFiltersAndEmblem() {
      state.search = "";
      state.team = "";
      state.year = "";
      state.sort = "pwr_desc";
      state.roles.clear();
      state.grades.clear();
      state.regions.clear();
      state.minOfa = 0;
      state.minDef = 0;
      state.minGuc = 0;
      state.minHiz = 0;
      state.minTek = 0;
      state.minZhn = 0;
      state.minSub.fill(0);
      state.weather = "";
      state.level = 0;
      state.favOnly = false;
      state.emblem = null;
      expandedCardId = null;
      try { localStorage.removeItem("rvl_emblem"); } catch (_) {}
      if (spiritActiveBadge) {
        spiritActiveBadge.textContent = "";
        spiritActiveBadge.classList.add("hidden");
      }

      searchInput.value = "";
      clearSearchBtn.classList.add("hidden");
      teamSelect.value = "";
      syncTeamPickerUI("");
      yearSelect.value = "";
      sortSelect.value = "pwr_desc";
      minOfaInput.value = "";
      minDefInput.value = "";
      minGucInput.value = "";
      minHizInput.value = "";
      minTekInput.value = "";
      minZhnInput.value = "";
      document.querySelectorAll(".min-sub-input").forEach((inp) => { inp.value = ""; });
      weatherSelect.value = "";
      levelSlider.value = "0";
      levelValue.textContent = "0";
      const favBtn = document.getElementById("favOnlyBtn");
      if (favBtn) favBtn.classList.remove("active");

      document.querySelectorAll(".players-table thead th .sort-arrow").forEach((el) => el.remove());
      const pwrTh = document.querySelector('.players-table thead th[data-sort="pwr"]');
      if (pwrTh) {
        const arrow = document.createElement("span");
        arrow.className = "sort-arrow";
        arrow.textContent = "▼";
        pwrTh.appendChild(document.createTextNode(" "));
        pwrTh.appendChild(arrow);
      }

      document
        .querySelectorAll(".pill.active")
        .forEach((b) => b.classList.remove("active"));
      if (typeof syncSquadEmblemUI === "function") syncSquadEmblemUI();
      applyFilters();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    resetAllBtn.addEventListener("click", resetAllFiltersAndEmblem);
    const resetMainBtn = document.getElementById("resetMainBtn");
    if (resetMainBtn) resetMainBtn.addEventListener("click", resetAllFiltersAndEmblem);

    // Pills
    document.getElementById("rolePills").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-role]");
      if (!btn) return;
      const r = btn.dataset.role;
      if (state.roles.has(r)) {
        state.roles.delete(r);
        btn.classList.remove("active");
      } else {
        state.roles.add(r);
        btn.classList.add("active");
      }
      applyFilters();
    });

    document.getElementById("gradePills").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-grade]");
      if (!btn) return;
      const g = btn.dataset.grade;
      if (state.grades.has(g)) {
        state.grades.delete(g);
        btn.classList.remove("active");
      } else {
        state.grades.add(g);
        btn.classList.add("active");
      }
      applyFilters();
    });

    document.getElementById("regionPills").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-region]");
      if (!btn) return;
      const rg = btn.dataset.region;
      if (state.regions.has(rg)) {
        state.regions.delete(rg);
        btn.classList.remove("active");
      } else {
        state.regions.add(rg);
        btn.classList.add("active");
      }
      applyFilters();
    });

    // Level Slider
    levelSlider.addEventListener("input", () => {
      state.level = parseInt(levelSlider.value, 10) || 0;
      levelValue.textContent = String(state.level);
      applyFiltersRaf();
    });

    // Table Header Sort (toggles asc/desc on repeated clicks)
    document.querySelector(".players-table thead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const col = th.dataset.sort;
      const textFirstAsc = col === "name" || col === "team";
      const descKey = `${col}_desc`;
      const ascKey = `${col}_asc`;
      let targetSort;
      if (state.sort === descKey) {
        targetSort = ascKey;
      } else if (state.sort === ascKey) {
        targetSort = descKey;
      } else {
        targetSort = textFirstAsc ? ascKey : descKey;
      }
      state.sort = targetSort;
      if ([...sortSelect.options].some((o) => o.value === targetSort)) {
        sortSelect.value = targetSort;
      }
      document.querySelectorAll(".players-table thead th .sort-arrow").forEach((el) => el.remove());
      const arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      arrow.textContent = targetSort.endsWith("_asc") ? "▲" : "▼";
      th.appendChild(document.createTextNode(" "));
      th.appendChild(arrow);
      applyFilters();
    });

    // Row click (instant expand) or double-click (floating card on cols 0..4) or Favorite / Squad / Compare click
    playersTableBody.addEventListener("click", (e) => {
      const favBtn = e.target.closest("button[data-fav-id]");
      if (favBtn) {
        e.stopPropagation();
        const fid = Number(favBtn.dataset.favId);
        if (favoritesSet.has(fid)) favoritesSet.delete(fid);
        else favoritesSet.add(fid);
        saveFavorites();
        if (state.favOnly) applyFilters();
        else renderTable();
        return;
      }

      const sqBtn = e.target.closest("button[data-send-sq-id]");
      if (sqBtn) {
        e.stopPropagation();
        const sid = Number(sqBtn.dataset.sendSqId);
        const found = allPlayers.find((x) => x.id === sid);
        if (found) {
          sendPlayerToSquad(found);
          sqBtn.textContent = "✓";
          sqBtn.classList.add("sent");
          setTimeout(() => {
            sqBtn.textContent = "⚽";
            sqBtn.classList.remove("sent");
          }, 1100);
        }
        return;
      }

      const cmpBtn = e.target.closest("button[data-cmp-id]");
      if (cmpBtn) {
        e.stopPropagation();
        const cid = Number(cmpBtn.dataset.cmpId);
        toggleComparePlayer(cid);
        return;
      }

      if (e.target.closest(".detail-row")) return;

      const row = e.target.closest("tr.player-row");
      if (!row) return;
      const cid = Number(row.dataset.id);
      toggleRowDetailInPlace(row, cid);
    });

    playersTableBody.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest(".detail-row")) return;
      const row = e.target.closest("tr.player-row");
      const cell = e.target.closest("td");
      if (!row || !cell || cell.cellIndex > 4) return;
      const cid = Number(row.dataset.id);
      const found = allPlayers.find((x) => x.id === cid);
      if (found) {
        openSquadCardModal(found, playerDetailEquip.get(found.id) || null, state.level);
      }
    });

    playersTableBody.addEventListener("change", (e) => {
      const sel = e.target.closest("select.detail-equip-sel");
      if (!sel) return;
      const pid = Number(sel.dataset.eqPid);
      const slot = sel.dataset.eqSlot;
      const cur = playerDetailEquip.get(pid) || { cle: "", leg: "", arm: "" };
      cur[slot] = sel.value;
      playerDetailEquip.set(pid, cur);
      const detRow = sel.closest("tr.detail-row");
      const found = allPlayers.find((x) => x.id === pid);
      if (detRow && found) detRow.outerHTML = buildDetailRowHtml(found);
      else renderTable();
    });

    const favOnlyBtn = document.getElementById("favOnlyBtn");
    if (favOnlyBtn) {
      favOnlyBtn.addEventListener("click", () => {
        state.favOnly = !state.favOnly;
        favOnlyBtn.classList.toggle("active", state.favOnly);
        applyFilters();
      });
    }

    // Pagination clicks
    pageButtons.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-page]");
      if (!btn || btn.disabled) return;
      currentPage = Number(btn.dataset.page);
      renderTable();
      window.scrollTo({ top: 180, behavior: "smooth" });
    });

    // Compare bar events
    compareSlots.addEventListener("click", (e) => {
      const rmBtn = e.target.closest("button[data-rm-cmp]");
      if (!rmBtn) return;
      toggleComparePlayer(Number(rmBtn.dataset.rmCmp));
    });

    clearCompareBtn.addEventListener("click", () => {
      compareList = [];
      saveCompareList();
      updateCompareBar();
      renderTable();
    });

    openCompareModalBtn.addEventListener("click", renderCompareModal);
    closeCompareModal.addEventListener("click", () =>
      compareModal.classList.add("hidden")
    );

    // ===== Amblem Modal =====
    const emblemLeagueSel = document.getElementById("emblemLeague");
    const emblemTeamSel = document.getElementById("emblemTeam");
    const emblemYearSel = document.getElementById("emblemYear");
    const emblemStarsSel = document.getElementById("emblemStars");
    const emblemPreview = document.getElementById("emblemPreview");

    function findEmblem(team, year) {
      return EMBLEMS.find((e) => e.team === team && e.year === year) || null;
    }

    const emblemTeamPicker = document.getElementById("emblemTeamPicker");
    const emblemTeamTrigger = document.getElementById("emblemTeamTrigger");
    const emblemTeamTriggerContent = document.getElementById("emblemTeamTriggerContent");
    const emblemTeamMenu = document.getElementById("emblemTeamMenu");

    function renderTeamOptionHtml(t) {
      const iconFile = (window.EMBLEM_ICONS || {})[t];
      const iconHtml = iconFile
        ? `<img class="custom-team-icon" src="assets/emblems/${iconFile}" alt="${t}" />`
        : "";
      return `${iconHtml}<span>${teamLabel(t)}</span>`;
    }

    function updateEmblemTeamPickerUI(teams) {
      if (!emblemTeamMenu || !emblemTeamTriggerContent) return;
      const cur = emblemTeamSel.value;
      emblemTeamTriggerContent.innerHTML = cur ? renderTeamOptionHtml(cur) : "Takım seç...";
      if (Array.isArray(teams)) {
        emblemTeamMenu.innerHTML = teams.map((t) => `
          <button type="button" class="custom-team-option ${t === cur ? "active" : ""}" data-pick-team="${t}">
            ${renderTeamOptionHtml(t)}
          </button>
        `).join("");
        emblemTeamMenu.querySelectorAll(".custom-team-option").forEach((btn) => {
          btn.addEventListener("click", () => {
            const val = btn.dataset.pickTeam;
            emblemTeamSel.value = val;
            emblemTeamMenu.classList.add("hidden");
            updateEmblemTeamPickerUI(teams);
            refreshEmblemYears();
          });
        });
      }
    }

    if (emblemTeamTrigger && emblemTeamMenu) {
      emblemTeamTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        emblemTeamMenu.classList.toggle("hidden");
      });
      document.addEventListener("click", (e) => {
        if (emblemTeamPicker && !emblemTeamPicker.contains(e.target)) {
          emblemTeamMenu.classList.add("hidden");
        }
      });
    }

    function refreshEmblemTeams(keep) {
      const league = emblemLeagueSel.value;
      const teams = [...new Set(EMBLEMS.filter((e) => e.league === league).map((e) => e.team))]
        .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b), "tr"));
      emblemTeamSel.innerHTML = teams.map((t) => `<option value="${t}">${teamLabel(t)}</option>`).join("");
      if (keep && teams.includes(keep)) emblemTeamSel.value = keep;
      updateEmblemTeamPickerUI(teams);
      refreshEmblemYears();
    }

    function refreshEmblemYears(keep) {
      const team = emblemTeamSel.value;
      const years = EMBLEMS.filter((e) => e.team === team).map((e) => e.year).sort((a, b) => {
        if (a === 0) return -1;
        if (b === 0) return 1;
        return b - a;
      });
      emblemYearSel.innerHTML = years
        .map((y) => `<option value="${y}">${y === 0 ? "ALL (Tüm Yıllar)" : y}</option>`)
        .join("");
      if (keep !== undefined && keep !== null && years.includes(keep)) emblemYearSel.value = String(keep);
      refreshEmblemStars();
    }

    function refreshEmblemStars(keep) {
      const emb = findEmblem(emblemTeamSel.value, Number(emblemYearSel.value));
      const max = emb ? emb.effs.length : 0;
      let html = "";
      for (let s = 1; s <= max; s++) html += `<option value="${s}">${STAR_LABELS[s] || s + "★"}</option>`;
      emblemStarsSel.innerHTML = html;
      emblemStarsSel.value = String(keep && keep <= max ? keep : max);
      renderEmblemPreview();
    }

    function fmtEff(obj) {
      return MAIN_KEYS.filter((k) => obj[k]).map((k) => `${MAIN_LABELS[k]} +${obj[k]}`).join(", ");
    }

    function renderEmblemPreview() {
      const emb = findEmblem(emblemTeamSel.value, Number(emblemYearSel.value));
      if (!emb) {
        emblemPreview.innerHTML = `<p class="modal-desc">Amblem bulunamadı.</p>`;
        return;
      }
      const stars = Number(emblemStarsSel.value) || 1;
      const total = sumEmblemEffects(emb, stars);
      const half = {};
      for (const k of MAIN_KEYS) half[k] = Math.ceil(total[k] / 2);

      let rows = "";
      emb.effs.forEach((eff, i) => {
        const active = i < stars;
        rows += `<div class="emb-eff-row ${active ? "active" : ""}" data-pick-star="${i + 1}" title="${i + 1} Yıldız Seç">
          <span class="emb-eff-star">${"★".repeat(i + 1)}</span>
          <span>${fmtEff(eff)}</span>
        </div>`;
      });

      const isAll = emb.year === 0;
      const rulesHtml = isAll
        ? `
          <div><strong>Tam bonus:</strong> ${teamLabel(emb.team)} tüm yıl (ALL) oyuncuları</div>
          <div><strong>Yarım bonus (yukarı yuvarlanır):</strong> ${emb.league} bölgesindeki diğer takımların tüm oyuncuları</div>
          <div><strong>Etkisiz:</strong> ${emb.league} dışındaki tüm oyuncular</div>`
        : `
          <div><strong>Tam bonus:</strong> ${teamLabel(emb.team)} ${emb.year} oyuncuları</div>
          <div><strong>Yarım bonus (yukarı yuvarlanır):</strong> ${teamLabel(emb.team)} farklı yıl oyuncuları ve ${emb.league} bölgesindeki diğer takımların ${emb.year} oyuncuları</div>
          <div><strong>Etkisiz:</strong> ${emb.league} dışındaki tüm oyuncular ve bölgedeki diğer takımların farklı yıl oyuncuları</div>`;

      emblemPreview.innerHTML = `
        <div class="emb-eff-list">${rows}</div>
        <div class="emb-total-grid">
          ${MAIN_KEYS.map((k) => `
            <div class="emb-total-cell">
              <span class="emb-total-label">${MAIN_LABELS[k]}</span>
              <span class="emb-total-full">+${total[k]}</span>
              <span class="emb-total-half">½ +${half[k]}</span>
            </div>`).join("")}
        </div>
        <div class="emb-rules">${rulesHtml}</div>`;

      emblemPreview.querySelectorAll(".emb-eff-row[data-pick-star]").forEach((row) => {
        row.addEventListener("click", () => {
          emblemStarsSel.value = row.dataset.pickStar;
          renderEmblemPreview();
        });
      });
    }

    emblemLeagueSel.addEventListener("change", () => refreshEmblemTeams());
    emblemTeamSel.addEventListener("change", () => refreshEmblemYears());
    emblemYearSel.addEventListener("change", () => refreshEmblemStars());
    emblemStarsSel.addEventListener("change", renderEmblemPreview);

    teamSpiritBtn.addEventListener("click", () => {
      const e = state.emblem;
      if (e) {
        emblemLeagueSel.value = e.league;
        refreshEmblemTeams(e.team);
        refreshEmblemYears(e.year);
        refreshEmblemStars(e.stars);
      } else {
        refreshEmblemTeams();
      }
      spiritModal.classList.remove("hidden");
    });
    closeSpiritModal.addEventListener("click", () => spiritModal.classList.add("hidden"));

    applySpiritBtn.addEventListener("click", () => {
      const emb = findEmblem(emblemTeamSel.value, Number(emblemYearSel.value));
      if (emb) {
        const stars = Number(emblemStarsSel.value) || emb.effs.length;
        state.emblem = {
          team: emb.team,
          year: emb.year,
          league: emb.league,
          stars,
          bonus: sumEmblemEffects(emb, stars)
        };
        try { localStorage.setItem("rvl_emblem", JSON.stringify(state.emblem)); } catch (_) {}
        spiritActiveBadge.textContent = `${emb.team} ${emb.year === 0 ? "ALL" : emb.year} ${stars}★`;
        spiritActiveBadge.classList.remove("hidden");
      }
      spiritModal.classList.add("hidden");
      applyFilters();
      if (typeof syncSquadEmblemUI === "function") syncSquadEmblemUI();
      if (activeTab === "compare") renderCompareView();
    });

    resetSpiritBtn.addEventListener("click", () => {
      state.emblem = null;
      try { localStorage.removeItem("rvl_emblem"); } catch (_) {}
      spiritActiveBadge.classList.add("hidden");
      spiritModal.classList.add("hidden");
      applyFilters();
      if (typeof syncSquadEmblemUI === "function") syncSquadEmblemUI();
      if (activeTab === "compare") renderCompareView();
    });
  }

  // =========================================================================
  // TAB NAVIGATION
  // =========================================================================
  const TAB_FILES = {
    home: "index.html",
    players: "oyuncular.html",
    emblems: "amblemler.html",
    equipments: "ekipmanlar.html",
    squad: "kadro.html",
    compare: "karsilastirma.html"
  };
  const FILE_TO_TAB = Object.fromEntries(Object.entries(TAB_FILES).map(([k, v]) => [v, k]));

  let activeTab = document.body.dataset.page || "players";
  function switchTab(tabName, opts = {}) {
    if (!TAB_FILES[tabName]) tabName = "players";
    activeTab = tabName;
    document.body.dataset.page = tabName;
    document.querySelectorAll("#mainNav .nav-link").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    document.querySelectorAll(".page-view").forEach((view) => {
      view.classList.toggle("hidden", view.id !== `view-${tabName}`);
    });
    if (opts.push !== false) {
      try {
        const targetFile = TAB_FILES[tabName];
        if (targetFile && !window.location.pathname.endsWith("/" + targetFile)) {
          history.pushState({ tab: tabName }, "", targetFile);
        }
      } catch (_) {}
    }
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    if (tabName === "emblems") renderEmblemsView();
    else if (tabName === "equipments") renderEquipmentsView();
    else if (tabName === "squad") renderSquadView();
    else if (tabName === "compare") renderCompareView();
  }

  function initColorMode() {
    const saved = localStorage.getItem("rvl_color_mode") || "light";
    const applyMode = (mode) => {
      const isDark = mode === "dark";
      document.body.classList.toggle("theme-dark", isDark);
      const btn = document.getElementById("colorModeToggle");
      if (btn) {
        btn.innerHTML = isDark ? "<span>☀️</span><span>Açık Mod</span>" : "<span>🌙</span><span>Karanlık Mod</span>";
        btn.setAttribute("aria-pressed", String(isDark));
      }
    };
    const bgSelect = document.getElementById("bgThemeSelect");
    if (bgSelect && bgSelect.parentNode && !document.getElementById("colorModeToggle")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "colorModeToggle";
      btn.className = "color-mode-btn";
      btn.title = "Açık / Karanlık Mod Değiştir";
      bgSelect.insertAdjacentElement("beforebegin", btn);
      btn.addEventListener("click", () => {
        const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
        localStorage.setItem("rvl_color_mode", next);
        applyMode(next);
      });
    }
    applyMode(saved);
  }

  function initAnimMode() {
    const savedOff = localStorage.getItem("rvl_no_anim") === "1";
    const applyAnimMode = (isOff) => {
      document.body.classList.toggle("no-anim", isOff);
      window.__rvlPauseBg = isOff;
      const btn = document.getElementById("animToggleBtn");
      if (btn) {
        btn.classList.toggle("is-off", isOff);
        btn.innerHTML = isOff ? "<span>✨</span><span>Animasyonları Aç</span>" : "<span>⚡</span><span>Animasyonları Kapat</span>";
        btn.setAttribute("aria-pressed", String(isOff));
        btn.title = isOff ? "Arka plan ve kart animasyonlarını aç" : "Arka plan ve Süper kart efektlerini kapat (Performans Modu)";
      }
      window.dispatchEvent(new CustomEvent("rvl:anim-change", { detail: { paused: isOff } }));
    };

    const bgSelect = document.getElementById("bgThemeSelect");
    if (bgSelect && bgSelect.parentNode && !document.getElementById("animToggleBtn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "animToggleBtn";
      btn.className = "color-mode-btn anim-toggle-btn";
      bgSelect.insertAdjacentElement("beforebegin", btn);
      btn.addEventListener("click", () => {
        const nextOff = !document.body.classList.contains("no-anim");
        localStorage.setItem("rvl_no_anim", nextOff ? "1" : "0");
        applyAnimMode(nextOff);
      });
    }
    applyAnimMode(savedOff);
  }

  function initNavigation() {
    initColorMode();
    initAnimMode();
    document.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest("a[data-tab], a[data-nav], a[href]");
      if (!link) return;
      let targetTab = link.dataset.tab || link.dataset.nav || "";
      if (!targetTab) {
        const href = (link.getAttribute("href") || "").split("?")[0].split("#")[0];
        targetTab = FILE_TO_TAB[href] || "";
      }
      if (!targetTab || !document.getElementById(`view-${targetTab}`)) return;
      e.preventDefault();
      switchTab(targetTab);
    });
    window.addEventListener("popstate", (e) => {
      const file = (window.location.pathname.split("/").pop() || "").toLowerCase();
      const tab = (e.state && e.state.tab) || FILE_TO_TAB[file] || document.body.dataset.page || "home";
      switchTab(tab, { push: false });
    });
  }

  // =========================================================================
  // 2. AMBLEMLER SAYFASI
  // =========================================================================
  const embViewState = {
    search: "",
    regions: new Set(),
    globalStars: 5,
    cardStates: new Map() // team -> { mode: "yearly"|"all", year: number, stars: number }
  };

  const REGION_ORDER = ["Türkiye", "Güney Avrupa", "Kuzey Avrupa", "Milli Takımlar"];
  const REGION_DOT_CLASS = {
    "Türkiye": "dot-red",
    "Güney Avrupa": "dot-blue",
    "Kuzey Avrupa": "dot-amber",
    "Milli Takımlar": "dot-green"
  };
  const STAFF_KEY_MAP = [
    ["ATT", "OFA"],
    ["DEF", "DEF"],
    ["POW", "GÜÇ"],
    ["SPD", "HIZ"],
    ["TEC", "TEK"],
    ["MEN", "ZHN"]
  ];

  function getGroupedEmblems() {
    const byTeam = new Map();
    for (const e of EMBLEMS) {
      if (!byTeam.has(e.team)) {
        byTeam.set(e.team, {
          team: e.team,
          league: e.league,
          allEntry: null,
          yearlyEntries: []
        });
      }
      const g = byTeam.get(e.team);
      if (!e.year || e.year === 0) {
        g.allEntry = e;
      } else {
        g.yearlyEntries.push(e);
      }
    }
    for (const g of byTeam.values()) {
      g.yearlyEntries.sort((a, b) => b.year - a.year);
    }
    return Array.from(byTeam.values());
  }

  function initEmblemsView() {
    const searchEl = document.getElementById("embSearchInput");
    const yearEl = document.getElementById("embYearFilter");
    const regionPills = document.getElementById("embRegionPills");
    const starPills = document.getElementById("embStarPills");

    if (yearEl) {
      const years = [...new Set(EMBLEMS.filter((e) => e.year > 0).map((e) => e.year))].sort((a, b) => b - a);
      const hasAll = EMBLEMS.some((e) => !e.year || e.year === 0);
      let opts = `<option value="">Tüm Yıllar</option>`;
      if (hasAll) opts += `<option value="ALL">ALL (Tüm Yıllar)</option>`;
      opts += years.map((y) => `<option value="${y}">${y}</option>`).join("");
      yearEl.innerHTML = opts;
      yearEl.addEventListener("change", () => {
        embViewState.yearFilter = yearEl.value;
        if (embViewState.yearFilter === "ALL") {
          for (const cs of embViewState.cardStates.values()) cs.mode = "all";
        } else if (embViewState.yearFilter) {
          const yr = Number(embViewState.yearFilter);
          for (const cs of embViewState.cardStates.values()) {
            cs.mode = "yearly";
            cs.year = yr;
          }
        }
        renderEmblemsView();
      });
    }

    searchEl.addEventListener("input", () => {
      embViewState.search = searchEl.value.trim().toLowerCase();
      renderEmblemsView();
    });

    regionPills.querySelectorAll(".pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const reg = pill.dataset.embRegion;
        if (embViewState.regions.has(reg)) {
          embViewState.regions.delete(reg);
          pill.classList.remove("active");
        } else {
          embViewState.regions.add(reg);
          pill.classList.add("active");
        }
        renderEmblemsView();
      });
    });

    starPills.querySelectorAll(".emb-star-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const st = Number(pill.dataset.embStars);
        embViewState.globalStars = st;
        starPills.querySelectorAll(".emb-star-pill").forEach((p) => {
          p.classList.toggle("active", Number(p.dataset.embStars) === st);
        });
        for (const cs of embViewState.cardStates.values()) {
          cs.stars = st;
        }
        renderEmblemsView();
      });
    });
  }

  function renderEmblemsView() {
    const wrap = document.getElementById("emblemsGridWrap");
    if (!wrap) return;
    const groups = getGroupedEmblems();

    const filtered = groups.filter((g) => {
      if (embViewState.regions.size > 0 && !embViewState.regions.has(g.league)) return false;
      if (embViewState.yearFilter === "ALL" && !g.allEntry) return false;
      if (embViewState.yearFilter && embViewState.yearFilter !== "ALL") {
        const yr = Number(embViewState.yearFilter);
        if (!g.yearlyEntries.some((y) => y.year === yr)) return false;
      }
      if (embViewState.search) {
        const hay = `${g.team} ${teamLabel(g.team)} ${g.league}`.toLowerCase();
        if (!hay.includes(embViewState.search)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      wrap.innerHTML = `<div class="cmp-empty-msg">Filtrelere uygun amblem bulunamadı.</div>`;
      return;
    }

    const byRegion = new Map();
    for (const r of REGION_ORDER) byRegion.set(r, []);
    for (const g of filtered) {
      if (!byRegion.has(g.league)) byRegion.set(g.league, []);
      byRegion.get(g.league).push(g);
    }

    let html = "";
    for (const [region, list] of byRegion.entries()) {
      if (list.length === 0) continue;
      list.sort((a, b) => a.team.localeCompare(b.team, "tr"));
      const dotCls = REGION_DOT_CLASS[region] || "dot-blue";
      html += `<section class="emb-region-section">`;
      html += `<h2 class="emb-region-title"><span class="dot ${dotCls}"></span>${region} <small style="color:var(--text-muted);font-weight:500;">(${list.length})</small></h2>`;
      html += `<div class="emb-cards-grid">`;

      for (const g of list) {
        if (!embViewState.cardStates.has(g.team)) {
          const defMode = embViewState.yearFilter === "ALL" && g.allEntry
            ? "all"
            : (g.yearlyEntries.length > 0 ? "yearly" : "all");
          const defYear = embViewState.yearFilter && embViewState.yearFilter !== "ALL"
            ? Number(embViewState.yearFilter)
            : (g.yearlyEntries[0]?.year || 0);
          embViewState.cardStates.set(g.team, {
            mode: defMode,
            year: defYear,
            stars: embViewState.globalStars
          });
        }
        const cs = embViewState.cardStates.get(g.team);
        const activeEntry =
          cs.mode === "all" && g.allEntry
            ? g.allEntry
            : (g.yearlyEntries.find((y) => y.year === cs.year) || g.yearlyEntries[0] || g.allEntry);
        if (!activeEntry) continue;

        const maxStars = activeEntry.effs ? activeEntry.effs.length : 5;
        const curStars = Math.min(cs.stars, maxStars);
        const bonus = sumEmblemEffects(activeEntry, curStars);

        const STAR_GRADE_META = {
          1: { cls: "emb-grade-normal", label: "Normal" },
          2: { cls: "emb-grade-special", label: "Özel" },
          3: { cls: "emb-grade-rare", label: "Ender" },
          4: { cls: "emb-grade-expert", label: "Uzman" },
          5: { cls: "emb-grade-super", label: "Süper" }
        };
        const gradeMeta = STAR_GRADE_META[curStars] || STAR_GRADE_META[3];

        const disp = getTeamDisplay(g.team);
        const initials = disp.goleyName.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
        const embIcon = (window.EMBLEM_ICONS || {})[g.team];
        const crestHtml = embIcon
          ? `<img src="assets/emblems/${embIcon}" alt="${disp.goleyName}" loading="lazy" class="emb-stage-icon" onerror="this.style.display='none';this.parentNode.querySelector('.emb-stage-fallback').style.display='flex';" /><span class="emb-stage-fallback" style="display:none;">${initials}</span>`
          : `<span class="emb-stage-fallback">${initials}</span>`;
        const staffPills = [];
        if (activeEntry.staff) {
          for (const [sk, label] of STAFF_KEY_MAP) {
            const sv = activeEntry.staff[sk] || 0;
            if (sv > 0) staffPills.push(`<span class="emb-staff-pill">${label} +${sv}</span>`);
          }
        }

        const barsHtml = [
          ["OFA", bonus.ATT],
          ["DEF", bonus.DEF],
          ["GÜÇ", bonus.POW],
          ["HIZ", bonus.SPD],
          ["TEK", bonus.TEC],
          ["ZHN", bonus.MEN]
        ].map(([lbl, val]) => {
          const pct = Math.min(100, Math.round((val / 25) * 100));
          return `
            <div class="emb-bar-row">
              <span class="emb-bar-label">${lbl}</span>
              <div class="emb-bar-track">
                <div class="emb-bar-fill" style="width:${pct}%"></div>
                <div class="emb-bar-segs" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>
              </div>
              <span class="emb-bar-val">${val}</span>
            </div>
          `;
        }).join("");

        const starBtns = [1, 2, 3, 4, 5].map((s) => {
          const starsTxt = "★".repeat(s) + "☆".repeat(5 - s);
          return `<button class="emb-star-btn s${s} ${curStars === s ? "active" : ""}" data-emb-team="${g.team}" data-set-star="${s}" ${s > maxStars ? "disabled" : ""}>${starsTxt}</button>`;
        }).join("");

        const yearOptions = g.yearlyEntries.map((y) =>
          `<option value="${y.year}" ${y.year === activeEntry.year ? "selected" : ""}>${y.year}</option>`
        ).join("");

        const yrShort = cs.mode === "all"
          ? "ALL"
          : (activeEntry.year ? String(activeEntry.year).slice(-2) : "");
        const bannerTitle = yrShort ? `${yrShort} ${disp.goleyName}` : disp.goleyName;

        html += `
          <div class="emb-card emb-game-card ${gradeMeta.cls}">
            <div class="emb-stage">
              ${curStars === 5 ? `<span class="holo-hex"></span><span class="holo-shine"></span>` : ""}
              <div class="emb-stage-sheen" aria-hidden="true"></div>
              <div class="emb-stage-top">
                <span class="emb-em-tag">EM</span>
                <span class="emb-grade-tag">${gradeMeta.label}</span>
              </div>
              <div class="emb-stage-crest">${crestHtml}</div>
            </div>
            <div class="emb-name-banner">
              <span class="emb-banner-title">${bannerTitle}</span>
              <span class="emb-banner-sub">${g.league}</span>
            </div>
            <div class="emb-game-body">
              <div class="emb-bars">${barsHtml}</div>
              <div class="emb-controls-row">
                <div class="emb-mode-switch">
                  <button class="emb-mode-btn ${cs.mode === "yearly" ? "active" : ""}" data-emb-team="${g.team}" data-set-mode="yearly">Yıllı</button>
                  <button class="emb-mode-btn ${cs.mode === "all" ? "active" : ""}" data-emb-team="${g.team}" data-set-mode="all">Tüm Yıllar</button>
                </div>
                ${cs.mode === "yearly" && g.yearlyEntries.length > 0 ? `
                  <select class="emb-year-select" data-emb-team="${g.team}" title="Sezon Yılı">${yearOptions}</select>
                ` : ""}
              </div>
              ${staffPills.length > 0 ? `
                <div class="emb-staff-row">
                  <span>Teknik heyet:</span>
                  ${staffPills.join("")}
                </div>
              ` : ""}
              <div class="emb-card-stars">${starBtns}</div>
            </div>
          </div>
        `;
      }
      html += `</div></section>`;
    }

    wrap.innerHTML = html;

    wrap.querySelectorAll("[data-set-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cs = embViewState.cardStates.get(btn.dataset.embTeam);
        if (cs) {
          cs.mode = btn.dataset.setMode;
          renderEmblemsView();
        }
      });
    });

    wrap.querySelectorAll(".emb-year-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        const cs = embViewState.cardStates.get(sel.dataset.embTeam);
        if (cs) {
          cs.year = Number(sel.value);
          renderEmblemsView();
        }
      });
    });

    wrap.querySelectorAll("[data-set-star]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cs = embViewState.cardStates.get(btn.dataset.embTeam);
        if (cs) {
          cs.stars = Number(btn.dataset.setStar);
          renderEmblemsView();
        }
      });
    });
  }

  // =========================================================================
  // 3. EKİPMANLAR SAYFASI
  // =========================================================================
  const eqViewState = {
    tab: "sets",
    search: "",
    slots: new Set(),
    targets: new Set()
  };

  function initEquipmentsView() {
    const searchEl = document.getElementById("eqSearchInput");
    const subtabs = document.getElementById("eqSubtabs");
    const slotPills = document.getElementById("eqSlotPills");
    const targetPills = document.getElementById("eqTargetPills");

    searchEl.addEventListener("input", () => {
      eqViewState.search = searchEl.value.trim().toLowerCase();
      renderEquipmentsView();
    });

    subtabs.querySelectorAll(".eq-subtab").forEach((btn) => {
      btn.addEventListener("click", () => {
        eqViewState.tab = btn.dataset.eqtab;
        subtabs.querySelectorAll(".eq-subtab").forEach((b) => b.classList.toggle("active", b === btn));
        document.getElementById("eqSubFilters").classList.toggle("hidden", eqViewState.tab !== "items");
        renderEquipmentsView();
      });
    });

    slotPills.querySelectorAll(".pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const v = pill.dataset.eqSlot;
        if (eqViewState.slots.has(v)) { eqViewState.slots.delete(v); pill.classList.remove("active"); }
        else { eqViewState.slots.add(v); pill.classList.add("active"); }
        renderEquipmentsView();
      });
    });

    targetPills.querySelectorAll(".pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const v = pill.dataset.eqTarget;
        if (eqViewState.targets.has(v)) { eqViewState.targets.delete(v); pill.classList.remove("active"); }
        else { eqViewState.targets.add(v); pill.classList.add("active"); }
        renderEquipmentsView();
      });
    });
  }

  function renderEquipmentsView() {
    const data = window.EQUIPMENTS_DATA || { items: [], sets: [], skills: [] };
    const container = document.getElementById("equipmentsContent");
    const countLabel = document.getElementById("eqCountLabel");
    if (!container) return;

    const q = eqViewState.search;

    if (eqViewState.tab === "items") {
      const list = data.items.filter((it) => {
        if (eqViewState.slots.size > 0 && !eqViewState.slots.has(it.slot)) return false;
        if (eqViewState.targets.size > 0 && !eqViewState.targets.has(it.target)) return false;
        if (q) {
          const hay = `${it.name} ${it.setName} ${it.buff} ${it.skill || ""} ${it.cat} ${it.slot}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      countLabel.textContent = `${list.length} ekipman gösteriliyor`;
      const slotIcons = { "Krampon": "👟", "Bacak": "🦵", "Kol": "💪" };
      container.innerHTML = list.map((it) => `
        <div class="eq-card">
          <div class="eq-icon-box" style="border-bottom: 2px solid ${it.color || "#3b82f6"}">
            ${it.id ? `<img src="assets/equipment/${it.id}.png" alt="${it.name}" loading="lazy" style="width:56px;height:56px;object-fit:contain;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" /><span style="display:none;">${slotIcons[it.slot] || "⚙️"}</span>` : `<span>${slotIcons[it.slot] || "⚙️"}</span>`}
          </div>
          <div class="eq-card-title">${it.name}</div>
          <div class="eq-tags">
            <span class="eq-tag">${it.slot}</span>
            <span class="eq-tag">${it.cat}</span>
            <span class="eq-tag">${it.tier}</span>
          </div>
          <div class="eq-buff-text">${it.buff}</div>
          <div class="eq-tags" style="margin-top:auto;">
            ${it.skill ? `<span class="eq-skill-pill">${it.skill}</span>` : ""}
            <span class="eq-tag">${it.setName}</span>
          </div>
        </div>
      `).join("");
    } else if (eqViewState.tab === "sets") {
      const list = data.sets.filter((s) => {
        if (eqViewState.targets.size > 0 && !eqViewState.targets.has(s.target)) return false;
        if (!q) return true;
        return `${s.name} ${s.cat} ${s.buff} ${s.skill || ""} ${s.target}`.toLowerCase().includes(q);
      });
      countLabel.textContent = `${list.length} set gösteriliyor`;
      const slotOrder = ["Krampon", "Kol", "Bacak"];
      const slotIcons = { "Krampon": "👟", "Kol": "💪", "Bacak": "🦵" };
      container.innerHTML = list.map((s) => {
        const pieces = slotOrder.map((slot) =>
          (data.items || []).find((it) => it.setId === s.id && it.slot === slot)
        ).filter(Boolean);
        const firstTier = (pieces[0] && pieces[0].tier) || "";
        const tierBadge = firstTier.replace("Kademe ", "") || "C";
        const bonusSum = String(s.buff || "").split(",").reduce((acc, part) => {
          const m = part.trim().match(/^\+(\d+)/);
          return acc + (m ? Number(m[1]) : 0);
        }, 0);
        const piecesHtml = pieces.map((it) => `
          <div class="eq-set-piece">
            <span class="eq-set-slot-lbl">${it.slot.toUpperCase()}</span>
            <div class="eq-set-img-wrap">
              ${it.id ? `<img src="assets/equipment/${it.id}.png" alt="${it.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline';" /><span style="display:none;">${slotIcons[it.slot] || "⚙️"}</span>` : `<span>${slotIcons[it.slot] || "⚙️"}</span>`}
            </div>
            <span class="eq-set-cat">${it.cat || it.slot}</span>
            <span class="eq-set-buff">${it.buff}</span>
            ${it.skill ? `<span class="eq-set-skill">⚡ ${it.skill}</span>` : ""}
          </div>
        `).join("");
        return `
          <div class="eq-set-card">
            <div class="eq-set-head">
              <div>
                <div class="eq-set-title-row">
                  <span class="eq-set-title">${s.name}</span>
                  <span class="eq-set-tier">${tierBadge}</span>
                </div>
                <div class="eq-set-sub">${s.target} seti • Set bonusu: tüm parçalara +1</div>
              </div>
              <div class="eq-set-total">
                <span class="eq-set-total-num">+${bonusSum}</span>
                <span class="eq-set-total-lbl">toplam bonus</span>
              </div>
            </div>
            <div class="eq-set-pieces">${piecesHtml}</div>
          </div>
        `;
      }).join("");
    } else {
      const list = data.skills.filter((sk) => {
        if (!q) return true;
        return `${sk.name} ${sk.cat} ${sk.desc}`.toLowerCase().includes(q);
      });
      countLabel.textContent = `${list.length} aktif yetenek gösteriliyor`;
      container.innerHTML = list.map((sk) => `
        <div class="eq-skill-card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span class="eq-skill-pill">${sk.name}</span>
            <span class="eq-tag">${sk.cat}</span>
          </div>
          <div style="font-size:0.84rem;color:var(--text-muted);line-height:1.45;">${sk.desc}</div>
        </div>
      `).join("");
    }
  }

  // =========================================================================
  // 4. KADRO KURUCU SAYFASI
  // =========================================================================
  const FORMATIONS = {
    "4-4-2 A": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "BEK", label: "SLB", y: 71, x: 11 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "BEK", label: "SĞB", y: 71, x: 89 },
      { role: "KNT", label: "SLK", y: 42, x: 11 },
      { role: "OS", label: "SL OS", y: 44, x: 37 },
      { role: "OS", label: "SĞ OS", y: 44, x: 63 },
      { role: "KNT", label: "SĞK", y: 42, x: 89 },
      { role: "FRV", label: "SL SF", y: 10, x: 37 },
      { role: "FRV", label: "SĞ SF", y: 10, x: 63 }
    ],
    "4-4-2 B": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "K DF", label: "LWB", y: 68, x: 10 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "K DF", label: "RWB", y: 68, x: 90 },
      { role: "LBR", label: "LBR", y: 56, x: 50 },
      { role: "OS", label: "SL OS", y: 42, x: 28 },
      { role: "OS", label: "SĞ OS", y: 42, x: 72 },
      { role: "OOS", label: "OOS", y: 30, x: 50 },
      { role: "FRV", label: "SL SF", y: 9, x: 36 },
      { role: "GF", label: "GF", y: 9, x: 64 }
    ],
    "4-4-2 C": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "K DF", label: "LWB", y: 68, x: 10 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "K DF", label: "RWB", y: 68, x: 90 },
      { role: "LBR", label: "LBR", y: 56, x: 50 },
      { role: "KNT", label: "SLK", y: 40, x: 25 },
      { role: "KNT", label: "SĞK", y: 40, x: 75 },
      { role: "OOS", label: "OOS", y: 30, x: 50 },
      { role: "FRV", label: "SL SF", y: 10, x: 37 },
      { role: "FRV", label: "SĞ SF", y: 10, x: 63 }
    ],
    "4-3-3 A": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "BEK", label: "SLB", y: 71, x: 11 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "BEK", label: "SĞB", y: 71, x: 89 },
      { role: "LBR", label: "LBR", y: 56, x: 50 },
      { role: "OS", label: "SL OS", y: 41, x: 31 },
      { role: "OS", label: "SĞ OS", y: 41, x: 69 },
      { role: "K FT", label: "LWF", y: 12, x: 22 },
      { role: "FRV", label: "FRV", y: 9, x: 50 },
      { role: "K FT", label: "RWF", y: 12, x: 78 }
    ],
    "4-3-3 B": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "K DF", label: "LWB", y: 68, x: 10 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "K DF", label: "RWB", y: 68, x: 90 },
      { role: "LBR", label: "LDM", y: 51, x: 33 },
      { role: "LBR", label: "RDM", y: 51, x: 67 },
      { role: "OOS", label: "OOS", y: 35, x: 50 },
      { role: "K FT", label: "LWF", y: 12, x: 22 },
      { role: "GF", label: "GF", y: 9, x: 50 },
      { role: "K FT", label: "RWF", y: 12, x: 78 }
    ],
    "4-3-3 C": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "K DF", label: "LWB", y: 68, x: 10 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "K DF", label: "RWB", y: 68, x: 90 },
      { role: "LBR", label: "LBR", y: 55, x: 50 },
      { role: "OS", label: "SL OS", y: 41, x: 28 },
      { role: "OS", label: "SĞ OS", y: 41, x: 72 },
      { role: "FRV", label: "SL SF", y: 12, x: 30 },
      { role: "GF", label: "GF", y: 9, x: 50 },
      { role: "FRV", label: "SĞ SF", y: 12, x: 70 }
    ],
    "4-5-1 A": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "BEK", label: "SLB", y: 71, x: 11 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "BEK", label: "SĞB", y: 71, x: 89 },
      { role: "KNT", label: "SLK", y: 41, x: 9 },
      { role: "OS", label: "SL OS", y: 42, x: 30 },
      { role: "OOS", label: "OOS", y: 36, x: 50 },
      { role: "OS", label: "SĞ OS", y: 42, x: 70 },
      { role: "KNT", label: "SĞK", y: 41, x: 91 },
      { role: "GF", label: "GF", y: 9, x: 50 }
    ],
    "4-5-1 B": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "K DF", label: "LWB", y: 68, x: 10 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "K DF", label: "RWB", y: 68, x: 90 },
      { role: "OS", label: "SL OS", y: 43, x: 11 },
      { role: "OOS", label: "LAM", y: 34, x: 31 },
      { role: "OS", label: "OS", y: 47, x: 50 },
      { role: "OOS", label: "RAM", y: 34, x: 69 },
      { role: "OS", label: "SĞ OS", y: 43, x: 89 },
      { role: "GF", label: "GF", y: 9, x: 50 }
    ],
    "4-5-1 C": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "BEK", label: "SLB", y: 71, x: 11 },
      { role: "DF", label: "SL DF", y: 74, x: 37 },
      { role: "DF", label: "SĞ DF", y: 74, x: 63 },
      { role: "BEK", label: "SĞB", y: 71, x: 89 },
      { role: "KNT", label: "SLK", y: 37, x: 9 },
      { role: "LBR", label: "LDM", y: 48, x: 31 },
      { role: "OOS", label: "OOS", y: 38, x: 50 },
      { role: "LBR", label: "RDM", y: 48, x: 69 },
      { role: "KNT", label: "SĞK", y: 37, x: 91 },
      { role: "FRV", label: "FRV", y: 9, x: 50 }
    ],
    "3-5-2 A": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "DF", label: "SL DF", y: 73, x: 26 },
      { role: "DF", label: "DF", y: 75, x: 50 },
      { role: "DF", label: "SĞ DF", y: 73, x: 74 },
      { role: "KNT", label: "SLK", y: 42, x: 8 },
      { role: "OS", label: "SL OS", y: 42, x: 30 },
      { role: "LBR", label: "LBR", y: 52, x: 50 },
      { role: "OS", label: "SĞ OS", y: 42, x: 70 },
      { role: "KNT", label: "SĞK", y: 42, x: 92 },
      { role: "FRV", label: "SL SF", y: 10, x: 37 },
      { role: "FRV", label: "SĞ SF", y: 10, x: 63 }
    ],
    "3-5-2 B": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "DF", label: "SL DF", y: 73, x: 26 },
      { role: "DF", label: "DF", y: 75, x: 50 },
      { role: "DF", label: "SĞ DF", y: 73, x: 74 },
      { role: "KNT", label: "SLK", y: 38, x: 8 },
      { role: "OOS", label: "LAM", y: 32, x: 33 },
      { role: "LBR", label: "LBR", y: 50, x: 50 },
      { role: "OOS", label: "RAM", y: 32, x: 67 },
      { role: "KNT", label: "SĞK", y: 38, x: 92 },
      { role: "FRV", label: "SL SF", y: 9, x: 30 },
      { role: "GF", label: "GF", y: 9, x: 70 }
    ],
    "3-5-2 C": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "DF", label: "SL DF", y: 70, x: 26 },
      { role: "LİB", label: "LİB", y: 76, x: 50 },
      { role: "DF", label: "SĞ DF", y: 70, x: 74 },
      { role: "LBR", label: "LDM", y: 52, x: 35 },
      { role: "LBR", label: "RDM", y: 52, x: 65 },
      { role: "KNT", label: "SLK", y: 36, x: 8 },
      { role: "KNT", label: "SĞK", y: 36, x: 92 },
      { role: "OOS", label: "OOS", y: 32, x: 50 },
      { role: "FRV", label: "SL SF", y: 10, x: 37 },
      { role: "FRV", label: "SĞ SF", y: 10, x: 63 }
    ],
    "3-4-3 A": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "DF", label: "SL DF", y: 73, x: 26 },
      { role: "DF", label: "DF", y: 75, x: 50 },
      { role: "DF", label: "SĞ DF", y: 73, x: 74 },
      { role: "KNT", label: "SLK", y: 43, x: 8 },
      { role: "OS", label: "SL OS", y: 43, x: 36 },
      { role: "OS", label: "SĞ OS", y: 43, x: 64 },
      { role: "KNT", label: "SĞK", y: 43, x: 92 },
      { role: "FRV", label: "SL SF", y: 12, x: 27 },
      { role: "FRV", label: "FRV", y: 9, x: 50 },
      { role: "FRV", label: "SĞ SF", y: 12, x: 73 }
    ],
    "3-4-3 B": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "DF", label: "SL DF", y: 73, x: 26 },
      { role: "DF", label: "DF", y: 75, x: 50 },
      { role: "DF", label: "SĞ DF", y: 73, x: 74 },
      { role: "LBR", label: "LBR", y: 55, x: 36 },
      { role: "OS", label: "SL OS", y: 41, x: 9 },
      { role: "OOS", label: "OOS", y: 36, x: 62 },
      { role: "OS", label: "SĞ OS", y: 41, x: 91 },
      { role: "K FT", label: "LWF", y: 12, x: 22 },
      { role: "GF", label: "GF", y: 9, x: 50 },
      { role: "K FT", label: "RWF", y: 12, x: 78 }
    ],
    "3-4-3 C": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "DF", label: "SL DF", y: 70, x: 26 },
      { role: "LİB", label: "LİB", y: 76, x: 50 },
      { role: "DF", label: "SĞ DF", y: 70, x: 74 },
      { role: "LBR", label: "LBR", y: 53, x: 35 },
      { role: "OS", label: "OS", y: 43, x: 63 },
      { role: "KNT", label: "SLK", y: 41, x: 8 },
      { role: "KNT", label: "SĞK", y: 41, x: 92 },
      { role: "FRV", label: "SL SF", y: 12, x: 27 },
      { role: "GF", label: "GF", y: 9, x: 50 },
      { role: "FRV", label: "SĞ SF", y: 12, x: 73 }
    ],
    "5-4-1 A": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "BEK", label: "SLB", y: 67, x: 7 },
      { role: "DF", label: "SL DF", y: 72, x: 29 },
      { role: "LİB", label: "LİB", y: 76, x: 50 },
      { role: "DF", label: "SĞ DF", y: 72, x: 71 },
      { role: "BEK", label: "SĞB", y: 67, x: 93 },
      { role: "LBR", label: "LBR", y: 53, x: 39 },
      { role: "KNT", label: "SLK", y: 39, x: 15 },
      { role: "KNT", label: "SĞK", y: 39, x: 85 },
      { role: "OOS", label: "OOS", y: 31, x: 62 },
      { role: "GF", label: "GF", y: 9, x: 50 }
    ],
    "5-4-1 B": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "K DF", label: "LWB", y: 67, x: 7 },
      { role: "DF", label: "SL DF", y: 73, x: 29 },
      { role: "DF", label: "DF", y: 75, x: 50 },
      { role: "DF", label: "SĞ DF", y: 73, x: 71 },
      { role: "K DF", label: "RWB", y: 67, x: 93 },
      { role: "LBR", label: "LBR", y: 53, x: 39 },
      { role: "OS", label: "SL OS", y: 37, x: 17 },
      { role: "OS", label: "SĞ OS", y: 37, x: 83 },
      { role: "OOS", label: "OOS", y: 29, x: 62 },
      { role: "GF", label: "GF", y: 9, x: 50 }
    ],
    "5-4-1 C": [
      { role: "KL", label: "KL", y: 91, x: 50 },
      { role: "BEK", label: "SLB", y: 67, x: 7 },
      { role: "DF", label: "SL DF", y: 72, x: 29 },
      { role: "LİB", label: "LİB", y: 76, x: 50 },
      { role: "DF", label: "SĞ DF", y: 72, x: 71 },
      { role: "BEK", label: "SĞB", y: 67, x: 93 },
      { role: "LBR", label: "LDM", y: 51, x: 37 },
      { role: "LBR", label: "RDM", y: 51, x: 63 },
      { role: "KNT", label: "SLK", y: 35, x: 17 },
      { role: "KNT", label: "SĞK", y: 35, x: 83 },
      { role: "FRV", label: "FRV", y: 9, x: 50 }
    ]
  };

  const sqState = {
    formation: "4-4-2 A",
    vert: 0,
    horiz: 0,
    slots: new Array(11).fill(null),
    slotEquip: Array.from({ length: 11 }, () => ({ cle: "", leg: "", arm: "" })),
    maxCost: 0,
    selectedSlot: null,
    search: "",
    emblemOnly: false,
    roles: new Set(),
    grade: "",
    year: "",
    level: 0
  };

  function serializeSquad() {
    return {
      formation: sqState.formation,
      vert: sqState.vert,
      horiz: sqState.horiz,
      maxCost: sqState.maxCost || 0,
      level: sqState.level || 0,
      slotIds: sqState.slots.map((p) => (p ? p.id : null)),
      slotEquip: sqState.slotEquip.map((eq) => ({ cle: eq?.cle || "", leg: eq?.leg || "", arm: eq?.arm || "" }))
    };
  }

  function applySerializedSquad(data) {
    if (!data || !allPlayers.length) return false;
    if (data.formation && FORMATIONS[data.formation]) sqState.formation = data.formation;
    if (typeof data.vert === "number") sqState.vert = data.vert;
    if (typeof data.horiz === "number") sqState.horiz = data.horiz;
    if (typeof data.maxCost === "number") sqState.maxCost = data.maxCost;
    if (typeof data.level === "number") sqState.level = data.level;

    const pMap = new Map(allPlayers.map((p) => [String(p.id), p]));
    if (Array.isArray(data.slotIds)) {
      sqState.slots = Array.from({ length: 11 }, (_, i) => {
        const id = data.slotIds[i];
        return id !== null && id !== undefined ? (pMap.get(String(id)) || null) : null;
      });
    }
    if (Array.isArray(data.slotEquip)) {
      sqState.slotEquip = Array.from({ length: 11 }, (_, i) => {
        const eq = data.slotEquip[i] || {};
        return { cle: eq.cle || "", leg: eq.leg || "", arm: eq.arm || "" };
      });
    }
    sqState.selectedSlot = null;

    const formSel = document.getElementById("sqFormation");
    if (formSel) formSel.value = sqState.formation;
    const vertEl = document.getElementById("sqVertSlider");
    if (vertEl) vertEl.value = String(sqState.vert);
    const horizEl = document.getElementById("sqHorizSlider");
    if (horizEl) horizEl.value = String(sqState.horiz);
    const maxCostEl = document.getElementById("sqMaxCost");
    if (maxCostEl) maxCostEl.value = sqState.maxCost > 0 ? String(sqState.maxCost) : "";
    const lvlEl = document.getElementById("sqLevelSlider");
    if (lvlEl) {
      lvlEl.value = String(sqState.level);
      const lvlVal = document.getElementById("sqLevelVal");
      if (lvlVal) lvlVal.textContent = String(sqState.level);
    }
    return true;
  }

  function saveActiveSquad() {
    try { localStorage.setItem("rvl_active_squad", JSON.stringify(serializeSquad())); } catch (_) {}
  }

  function loadActiveSquad() {
    try {
      const raw = localStorage.getItem("rvl_active_squad");
      if (raw) applySerializedSquad(JSON.parse(raw));
    } catch (_) {}
  }

  function sendPlayerToSquad(p) {
    if (!p) return;
    loadActiveSquad();
    const layout = FORMATIONS[sqState.formation] || FORMATIONS["4-4-2 A"];
    let targetIdx = layout.findIndex((s, i) => !sqState.slots[i] && s.role === p.role);
    if (targetIdx < 0) targetIdx = sqState.slots.findIndex((x) => !x);
    if (targetIdx < 0) targetIdx = 0;
    sqState.slots[targetIdx] = p;
    saveActiveSquad();
  }

  function getSavedSquads() {
    try {
      return JSON.parse(localStorage.getItem("rvl_saved_squads") || "[]");
    } catch (_) {
      return [];
    }
  }

  function setSavedSquads(list) {
    try { localStorage.setItem("rvl_saved_squads", JSON.stringify(list)); } catch (_) {}
  }

  function refreshSavedSquadsSelect(selectedName = "") {
    const sel = document.getElementById("sqSavedSelect");
    if (!sel) return;
    const list = getSavedSquads();
    if (list.length === 0) {
      sel.innerHTML = `<option value="">Kayıtlı kadro yok</option>`;
      return;
    }
    sel.innerHTML = list.map((item) =>
      `<option value="${item.name.replace(/"/g, "&quot;")}" ${item.name === selectedName ? "selected" : ""}>${item.name} (${item.data.formation})</option>`
    ).join("");
  }

  function syncSlotEquipPanel() {
    const box = document.getElementById("sqSlotEquipBox");
    if (!box) return;
    const idx = sqState.selectedSlot;
    const p = idx !== null && idx !== undefined ? sqState.slots[idx] : null;
    if (!p) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    const layout = FORMATIONS[sqState.formation] || [];
    const slotLabel = layout[idx]?.label || `Slot ${idx + 1}`;
    document.getElementById("sqSlotEquipTitle").textContent = `${slotLabel} • ${p.name}`;

    const eq = sqState.slotEquip[idx] || { cle: "", leg: "", arm: "" };
    const isGk = p.pos === "GK" || p.role === "KL";
    const fillSel = (elId, slotName, val) => {
      const sel = document.getElementById(elId);
      if (!sel) return;
      const items = getEquipmentsBySlot(slotName, isGk);
      sel.innerHTML = `<option value="">Yok</option>` + items.map((it) =>
        `<option value="${it.id}" ${String(it.id) === String(val) ? "selected" : ""}>${it.name} (${it.buff})</option>`
      ).join("");
    };
    fillSel("sqEquipCle", "Krampon", eq.cle);
    fillSel("sqEquipLeg", "Bacak", eq.leg);
    fillSel("sqEquipArm", "Kol", eq.arm);

    const eqBonus = computeEquipmentBonuses(eq);
    const badge = document.getElementById("sqEquipSetBadge");
    if (eqBonus.activeSet) {
      badge.textContent = `✨ Set Aktif: ${eqBonus.activeSet.name} (Tüm ekipmana +1)`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  function autoFillSquad(gradeFilter = null) {
    const layout = FORMATIONS[sqState.formation] || [];
    const maxBudget = sqState.maxCost > 0 ? sqState.maxCost : Infinity;
    let pool = sqState.emblemOnly && state.emblem
      ? allPlayers.filter((p) => p.team === state.emblem.team)
      : allPlayers;
    if (gradeFilter) {
      pool = pool.filter((p) => p.grade === gradeFilter);
    }

    // Score each player at current sqState.level (+ emblem)
    const scored = pool.map((p) => ({
      p,
      pwr: getEffectiveStatsAtLevel(p, sqState.level).pwr,
      cost: p.cost || 0
    })).sort((a, b) => b.pwr - a.pwr || a.cost - b.cost);

    const usedNames = new Set();
    const chosen = new Array(11).fill(null);
    let spent = 0;

    // Reserve minimum cost for remaining slots if budget is finite
    layout.forEach((slot, idx) => {
      const remainingSlots = layout.length - 1 - idx;
      const budgetForSlot = maxBudget === Infinity ? Infinity : maxBudget - spent - remainingSlots * 1;
      let pick = scored.find((x) =>
        !usedNames.has(x.p.name) &&
        x.p.role === slot.role &&
        x.cost <= budgetForSlot
      );
      if (!pick) {
        pick = scored.find((x) =>
          !usedNames.has(x.p.name) &&
          getPosCategory(x.p.role) === getPosCategory(slot.role) &&
          x.cost <= budgetForSlot
        );
      }
      if (!pick) {
        pick = scored.find((x) => !usedNames.has(x.p.name) && x.cost <= budgetForSlot);
      }
      if (pick) {
        chosen[idx] = pick.p;
        usedNames.add(pick.p.name);
        spent += pick.cost;
      }
    });

    sqState.slots = chosen;
    sqState.selectedSlot = null;
    renderSquadPitch();
  }

  function syncSquadEmblemUI() {
    const txtEl = document.getElementById("sqEmblemText");
    const hintEl = document.getElementById("sqEmblemHint");
    const embOnlyBtn = document.getElementById("sqEmblemOnlyBtn");
    if (!txtEl) return;
    if (state.emblem) {
      const embIcon = (window.EMBLEM_ICONS || {})[state.emblem.team];
      const yrTxt = state.emblem.year === 0 ? "ALL" : state.emblem.year;
      const tName = teamLabel(state.emblem.team);
      txtEl.innerHTML = embIcon
        ? `<img src="assets/emblems/${embIcon}" alt="${tName}" class="sq-emblem-logo" />`
        : tName;
      hintEl.innerHTML = `<strong>${tName}</strong> · ${yrTxt} · ${state.emblem.stars}★`;
    } else {
      txtEl.textContent = "+ Amblem Seç";
      hintEl.textContent = "Amblem seçilmedi, + ile amblem seç.";
      if (sqState.emblemOnly) {
        sqState.emblemOnly = false;
        document.getElementById("sqAllTeamsBtn").classList.add("active");
        embOnlyBtn.classList.remove("active");
      }
    }
    if (activeTab === "squad") renderSquadView();

    const cmpBtnTxt = document.getElementById("cmpEmblemBtnText");
    if (cmpBtnTxt) {
      cmpBtnTxt.textContent = state.emblem
        ? `${state.emblem.team} (${state.emblem.year}) ${state.emblem.stars}★`
        : "Amblem Seç";
    }
  }

  function initSquadView() {
    document.getElementById("sqEmblemBtn").addEventListener("click", () => {
      teamSpiritBtn.click();
    });

    const formSel = document.getElementById("sqFormation");
    formSel.addEventListener("change", () => {
      sqState.formation = formSel.value;
      renderSquadPitch();
    });

    const vertSlider = document.getElementById("sqVertSlider");
    const horizSlider = document.getElementById("sqHorizSlider");
    const vertLabels = { "-2": "Çok Geri", "-1": "Geri", "0": "Temel", "1": "İleri", "2": "Çok İleri" };
    const horizLabels = { "-2": "Çok Dar", "-1": "Dar", "0": "Temel", "1": "Geniş", "2": "Çok Geniş" };

    vertSlider.addEventListener("input", () => {
      sqState.vert = Number(vertSlider.value);
      document.getElementById("sqVertLabel").textContent = vertLabels[vertSlider.value] || "Temel";
      renderSquadPitch();
    });

    horizSlider.addEventListener("input", () => {
      sqState.horiz = Number(horizSlider.value);
      document.getElementById("sqHorizLabel").textContent = horizLabels[horizSlider.value] || "Temel";
      renderSquadPitch();
    });

    document.getElementById("sqClearBtn").addEventListener("click", () => {
      sqState.slots.fill(null);
      sqState.slotEquip = Array.from({ length: 11 }, () => ({ cle: "", leg: "", arm: "" }));
      sqState.selectedSlot = null;
      renderSquadPitch();
    });

    document.getElementById("sqMaxCost")?.addEventListener("input", (e) => {
      sqState.maxCost = parseInt(e.target.value, 10) || 0;
      renderSquadPitch();
    });

    document.getElementById("sqAutoFillBtn")?.addEventListener("click", () => autoFillSquad(null));
    document.getElementById("sqAutoBestRareBtn")?.addEventListener("click", () => autoFillSquad("Rare"));

    document.getElementById("sqRemoveSlotBtn")?.addEventListener("click", () => {
      if (sqState.selectedSlot !== null && sqState.selectedSlot !== undefined) {
        sqState.slots[sqState.selectedSlot] = null;
        sqState.slotEquip[sqState.selectedSlot] = { cle: "", leg: "", arm: "" };
        sqState.selectedSlot = null;
        renderSquadPitch();
      }
    });

    [["sqEquipCle", "cle"], ["sqEquipLeg", "leg"], ["sqEquipArm", "arm"]].forEach(([elId, key]) => {
      document.getElementById(elId)?.addEventListener("change", (e) => {
        if (sqState.selectedSlot === null || sqState.selectedSlot === undefined) return;
        if (!sqState.slotEquip[sqState.selectedSlot]) sqState.slotEquip[sqState.selectedSlot] = { cle: "", leg: "", arm: "" };
        sqState.slotEquip[sqState.selectedSlot][key] = e.target.value;
        renderSquadPitch();
      });
    });

    document.getElementById("sqSaveBtn")?.addEventListener("click", () => {
      const nameInp = document.getElementById("sqSaveName");
      const name = (nameInp?.value || "").trim() || `Kadro ${getSavedSquads().length + 1}`;
      const list = getSavedSquads().filter((x) => x.name !== name);
      list.unshift({ name, data: serializeSquad(), updatedAt: Date.now() });
      setSavedSquads(list.slice(0, 20));
      if (nameInp) nameInp.value = "";
      refreshSavedSquadsSelect(name);
    });

    document.getElementById("sqLoadBtn")?.addEventListener("click", () => {
      const sel = document.getElementById("sqSavedSelect");
      if (!sel || !sel.value) return;
      const found = getSavedSquads().find((x) => x.name === sel.value);
      if (found && applySerializedSquad(found.data)) {
        renderSquadPitch();
        renderSquadPool();
      }
    });

    document.getElementById("sqDelSavedBtn")?.addEventListener("click", () => {
      const sel = document.getElementById("sqSavedSelect");
      if (!sel || !sel.value) return;
      const list = getSavedSquads().filter((x) => x.name !== sel.value);
      setSavedSquads(list);
      refreshSavedSquadsSelect();
    });

    document.getElementById("sqImportBtn")?.addEventListener("click", () => {
      const raw = prompt("Paylaşılan kadro kodunu veya linkini yapıştırın:");
      if (!raw) return;
      try {
        let code = raw.trim();
        if (code.includes("squad=")) {
          const u = new URL(code, window.location.href);
          code = u.searchParams.get("squad") || code;
        }
        const json = decodeURIComponent(escape(atob(code)));
        const parsed = JSON.parse(json);
        if (applySerializedSquad(parsed)) {
          renderSquadPitch();
          renderSquadPool();
        }
      } catch (_) {
        alert("Geçersiz kadro kodu!");
      }
    });

    document.getElementById("sqShareBtn").addEventListener("click", () => {
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(serializeSquad()))));
      const base = window.location.href.split("?")[0].replace(/[^/]+$/, "kadro.html");
      const shareUrl = `${base}?squad=${encodeURIComponent(encoded)}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl).catch(() => {});
      }
      const btn = document.getElementById("sqShareBtn");
      const old = btn.textContent;
      btn.textContent = "Link Kopyalandı!";
      setTimeout(() => { btn.textContent = old; }, 1400);
    });

    refreshSavedSquadsSelect();

    const renderSquadPoolDebounced = debounce(renderSquadPool, 100);
    const updateSquadLevelRaf = rafSchedule(() => {
      renderSquadPitch();
      renderSquadPool();
    });

    document.getElementById("sqSearch").addEventListener("input", (e) => {
      sqState.search = e.target.value.trim().toLowerCase();
      renderSquadPoolDebounced();
    });

    const allBtn = document.getElementById("sqAllTeamsBtn");
    const embBtn = document.getElementById("sqEmblemOnlyBtn");
    allBtn.addEventListener("click", () => {
      sqState.emblemOnly = false;
      allBtn.classList.add("active");
      embBtn.classList.remove("active");
      renderSquadPool();
    });
    embBtn.addEventListener("click", () => {
      if (!state.emblem) {
        teamSpiritBtn.click();
        return;
      }
      sqState.emblemOnly = true;
      embBtn.classList.add("active");
      allBtn.classList.remove("active");
      renderSquadPool();
    });

    document.getElementById("sqRolePills").querySelectorAll(".pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const r = pill.dataset.sqRole;
        if (sqState.roles.has(r)) { sqState.roles.delete(r); pill.classList.remove("active"); }
        else { sqState.roles.add(r); pill.classList.add("active"); }
        renderSquadPool();
      });
    });

    document.getElementById("sqGrade").addEventListener("change", (e) => {
      sqState.grade = e.target.value;
      renderSquadPool();
    });

    document.getElementById("sqYear").addEventListener("change", (e) => {
      sqState.year = e.target.value;
      renderSquadPool();
    });

    const lvlSlider = document.getElementById("sqLevelSlider");
    lvlSlider.addEventListener("input", () => {
      sqState.level = Number(lvlSlider.value);
      document.getElementById("sqLevelVal").textContent = String(sqState.level);
      updateSquadLevelRaf();
    });

    initSquadCardModal();
  }

  function formatRoleCode(role) {
    if (role === "K FT") return "KFT";
    if (role === "K DF") return "KDF";
    return role;
  }

  function getRoleGroupName(role) {
    if (["GF", "FRV", "K FT"].includes(role)) return "Forvet";
    if (["OOS", "KNT", "OS", "LBR"].includes(role)) return "Orta Saha";
    if (["K DF", "BEK", "DF", "LİB"].includes(role)) return "Defans";
    return "Kaleci";
  }

  function getWeatherEmoji(w) {
    if (w === "Sunny") return "☀️";
    if (w === "Rainy") return "🌧️";
    if (w === "Snow") return "❄️";
    if (w === "Cloudy") return "☁️";
    return "➖";
  }

  function buildCardPortraitHtml(p, isMini) {
    if (isMini) {
      return `
        <div class="sq-pool-avatar">
          <svg width="24" height="24" viewBox="0 0 36 32" fill="none"><path d="M9 3L2 8.5L5.5 14L9.5 11.5V29H26.5V11.5L30.5 14L34 8.5L27 3H22.5C21.8 5.2 20.1 6.5 18 6.5C15.9 6.5 14.2 5.2 13.5 3H9Z" fill="rgba(248,250,252,0.75)" stroke="#0f172a" stroke-width="1.5"/></svg>
        </div>
      `;
    }
    return `
      <div class="rc-portrait-wrap">
        <div class="rc-portrait-fallback">
          <svg viewBox="0 0 120 130" width="128" height="140" fill="none">
            <circle cx="60" cy="34" r="22" fill="rgba(255,255,255,0.86)" stroke="#0f172a" stroke-width="3"/>
            <path d="M26 62L8 82L22 96L36 84V124H84V84L98 96L112 82L94 62H76C73 70 67 74 60 74C53 74 47 70 44 62H26Z" fill="rgba(255,255,255,0.86)" stroke="#0f172a" stroke-width="3"/>
            <text x="60" y="106" text-anchor="middle" font-size="22" font-weight="900" fill="#0f172a">${p.number || ""}</text>
          </svg>
        </div>
      </div>
    `;
  }

  function renderRevivalCardFrontHtml(p, eff) {
    const yrShort = String(p.year).length === 4 ? String(p.year).slice(2) : String(p.year);
    const gradeLabel = GRADE_LABELS[p.grade] || p.grade;
    const roleGroup = getRoleGroupName(p.role);
    const weatherIcon = getWeatherEmoji(p.weather);
    const mainStats = [
      { label: "OFA", val: eff.ofa },
      { label: "DEF", val: eff.def },
      { label: "GÜÇ", val: eff.guc },
      { label: "HIZ", val: eff.hiz },
      { label: "TEK", val: eff.tek },
      { label: "ZHN", val: eff.zhn }
    ];

    const barsHtml = mainStats.map((st) => {
      const pct = Math.max(4, Math.min(100, Math.round((st.val / 125) * 100)));
      const valCls = st.val >= 60 ? "rc-stat-val-hot" : "";
      return `
        <div class="rc-stat-row">
          <span class="rc-stat-lbl">${st.label}</span>
          <div class="rc-bar-track">
            <div class="rc-bar-fill" style="width:${pct}%;"></div>
          </div>
          <span class="rc-stat-val ${valCls}">${st.val}</span>
        </div>
      `;
    }).join("");

    const embIcon = (window.EMBLEM_ICONS || {})[p.team];
    const crestContent = embIcon
      ? `<img src="assets/emblems/${embIcon}" alt="${p.team}" class="rc-crest-img" />`
      : `<span>${p.team || "RVL"}</span>`;

    return `
      <div class="revival-card rc-grade-${p.grade}">
        <div class="rc-hero">
          <div class="rc-top-grade">${gradeLabel}</div>
          <div class="rc-sunburst"></div>
          <div class="rc-gloss"></div>
          ${p.grade === "Master" ? `<div class="holo-hex"></div><div class="holo-shine"></div>` : ""}
          <div class="rc-pos-block">
            <span class="rc-pos-code">${formatRoleCode(p.role)}</span>
            <span class="rc-pos-sub">${roleGroup}</span>
            <div class="rc-cost-hex" title="Maliyet"><span>${p.cost || 0}</span></div>
          </div>
          <div class="rc-weather-box" title="${WEATHER_LABELS[p.weather] || "Hava Durumu"}">${weatherIcon}</div>
          ${buildCardPortraitHtml(p, false)}
        </div>
        <div class="rc-name-strip">
          <div class="rc-club-crest" title="${p.goleyTeam || ""}">
            ${crestContent}
          </div>
          <div class="rc-player-title">${yrShort} ${p.name}</div>
          <div class="rc-player-club">${p.goleyTeam}</div>
        </div>
        <div class="rc-stats-panel">
          ${barsHtml}
        </div>
      </div>
    `;
  }

  let floatingCardTopZ = 2500;
  let floatingCardCounter = 0;

  function clearFloatingCompareGlow() {
    const layer = document.getElementById("floatingCardsLayer");
    if (!layer) return;
    for (const el of layer.children) {
      el.classList.remove("compare-glow");
    }
  }

  function closePairCompareOverlay() {
    const existing = document.getElementById("pairCompareOverlay");
    if (existing) existing.remove();
  }

  function openPairCompareOverlay(cardA, cardB) {
    closePairCompareOverlay();
    if (!cardA || !cardB) return;

    const pA = cardA.player, effA = cardA.eff, lvlA = cardA.level;
    const pB = cardB.player, effB = cardB.eff, lvlB = cardB.level;

    const mainKeys = [
      { key: "pwr", name: "PWR" },
      { key: "ofa", name: "OFA" },
      { key: "def", name: "DEF" },
      { key: "guc", name: "GÜÇ" },
      { key: "hiz", name: "HIZ" },
      { key: "tek", name: "TEK" },
      { key: "zhn", name: "ZHN" }
    ];
    const mainRowsHtml = mainKeys.map((st) => {
      const lv = effA[st.key];
      const rv = effB[st.key];
      const diff = lv - rv;
      return `
        <div class="cmp-det-row cmp-det-main-row">
          <span class="cmp-det-diff-l">${diff > 0 ? `▲${diff}` : ""}</span>
          <span class="cmp-det-val ${diff > 0 ? "win" : ""}">${lv}</span>
          <span class="cmp-det-label">${st.name}</span>
          <span class="cmp-det-val ${diff < 0 ? "win" : ""}">${rv}</span>
          <span class="cmp-det-diff-r">${diff < 0 ? `${Math.abs(diff)}▲` : ""}</span>
        </div>
      `;
    }).join("");

    const hasGk = pA.role === "KL" || pB.role === "KL";
    const statsToCmp = hasGk ? SUB_STAT_NAMES : SUB_STAT_NAMES.slice(0, 18);
    const subRowsHtml = statsToCmp.map((st) => {
      const lv = effA.sub[st.idx];
      const rv = effB.sub[st.idx];
      const diff = lv - rv;
      return `
        <div class="cmp-det-row">
          <span class="cmp-det-diff-l">${diff > 0 ? `▲${diff}` : ""}</span>
          <span class="cmp-det-val ${diff > 0 ? "win" : ""}">${lv}</span>
          <span class="cmp-det-label">${st.name}</span>
          <span class="cmp-det-val ${diff < 0 ? "win" : ""}">${rv}</span>
          <span class="cmp-det-diff-r">${diff < 0 ? `${Math.abs(diff)}▲` : ""}</span>
        </div>
      `;
    }).join("");

    const buildCardCol = (p, eff, lvl) => `
      <div class="pair-compare-card-col">
        <div class="flip-card-scene pair-cmp-flip" title="Tıklayıp çevir">
          <div class="flip-card-inner">
            <div class="flip-card-face flip-card-front">${renderRevivalCardFrontHtml(p, eff)}</div>
            <div class="flip-card-face flip-card-back">${renderGoleyCardHtml(p, eff, lvl)}</div>
          </div>
        </div>
        <button type="button" class="btn-card-flip pair-cmp-flip-btn">Dön</button>
      </div>
    `;

    const overlay = document.createElement("div");
    overlay.id = "pairCompareOverlay";
    overlay.className = "pair-compare-backdrop";
    overlay.innerHTML = `
      <div class="modal-box modal-xl pair-compare-box">
        <div class="modal-header">
          <h3>⚡ İkili Kart Karşılaştırma — ${pA.name} vs ${pB.name}</h3>
          <button type="button" id="closePairCompareBtn" class="modal-close" title="Kapat ve Kartlara Dön">✕</button>
        </div>
        <div class="modal-body">
          <div class="pair-compare-stage">
            ${buildCardCol(pA, effA, lvlA)}
            <div class="cmp-details-panel pair-cmp-panel">
              <div class="cmp-details-title">Ana Değerler (Lv.${lvlA} vs Lv.${lvlB})</div>
              ${mainRowsHtml}
              <div class="cmp-details-title pair-cmp-sub-title">Alt İstatistikler</div>
              ${subRowsHtml}
            </div>
            ${buildCardCol(pB, effB, lvlB)}
          </div>
        </div>
      </div>
    `;

    overlay.querySelector("#closePairCompareBtn").addEventListener("click", closePairCompareOverlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePairCompareOverlay();
    });
    overlay.querySelectorAll(".pair-compare-card-col").forEach((col) => {
      const inner = col.querySelector(".flip-card-inner");
      const flip = () => inner.classList.toggle("is-flipped");
      col.querySelector(".pair-cmp-flip").addEventListener("click", flip);
      col.querySelector(".pair-cmp-flip-btn").addEventListener("click", flip);
    });

    document.body.appendChild(overlay);
  }

  function openSquadCardModal(p, equipIds = null, levelOverride = null) {
    const layer = document.getElementById("floatingCardsLayer");
    if (!layer || !p) return;

    const lvl = levelOverride !== null && levelOverride !== undefined ? levelOverride : sqState.level;
    const eff = getEffectiveStatsAtLevel(p, lvl, equipIds);
    floatingCardTopZ += 2;
    const slotIdx = floatingCardCounter++;

    const win = document.createElement("div");
    win.className = "floating-card-window";
    win.dataset.grade = p.grade || "Normal";
    win.style.zIndex = String(floatingCardTopZ);
    win._cardPayload = { player: p, eff, level: lvl };

    const baseCenterLeft = Math.round((window.innerWidth - 288) / 2);
    const sideShift = window.innerWidth >= 700 ? (slotIdx % 2 === 0 ? -165 : 165) : 0;
    const stepShift = Math.floor(slotIdx / 2) % 3 * 24;
    let posX = Math.max(8, Math.min(window.innerWidth - 296, baseCenterLeft + sideShift + stepShift));
    let posY = Math.max(72, Math.min(window.innerHeight - 520, Math.round((window.innerHeight - 510) / 2) - 24 + stepShift));
    const applyPos = (x, y) => {
      win._posX = x;
      win._posY = y;
      win.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    applyPos(posX, posY);

    win.innerHTML = `
      <div class="flip-card-scene" title="Ekranın istediğin yerine sürükle • İki kartı üst üste bırakıp karşılaştır • Tıklayıp çevir">
        <div class="flip-card-inner">
          <div class="flip-card-face flip-card-front">${renderRevivalCardFrontHtml(p, eff)}</div>
          <div class="flip-card-face flip-card-back">${renderGoleyCardHtml(p, eff, lvl)}</div>
        </div>
      </div>
      <div class="floating-card-actions">
        <button class="btn-card-flip">Dön</button>
        <button class="btn-card-close">Kapat</button>
      </div>
    `;

    const scene = win.querySelector(".flip-card-scene");
    const inner = win.querySelector(".flip-card-inner");
    const flipBtn = win.querySelector(".btn-card-flip");
    const closeBtn = win.querySelector(".btn-card-close");

    const bringToFront = () => {
      floatingCardTopZ += 2;
      win.style.zIndex = String(floatingCardTopZ);
    };

    const toggleFlip = () => {
      bringToFront();
      inner.classList.toggle("is-flipped");
    };

    flipBtn.addEventListener("click", toggleFlip);
    closeBtn.addEventListener("click", () => {
      document.body.classList.remove("dragging-floating-card");
      window.__rvlPauseBg = false;
      clearFloatingCompareGlow();
      win.remove();
    });
    win.addEventListener("pointerdown", bringToFront);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;
    let curX = 0;
    let curY = 0;
    let maxX = 0;
    let maxY = 0;
    let sceneW = 288;
    let sceneH = 468;
    let cachedOthers = [];
    let lastGlowTarget = null;
    let rafId = 0;

    const findCachedOverlap = (x, y) => {
      const area1 = sceneW * sceneH;
      if (area1 <= 0 || cachedOthers.length === 0) return null;
      const r1Right = x + sceneW;
      const r1Bottom = y + sceneH;
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < cachedOthers.length; i++) {
        const o = cachedOthers[i];
        const ow = Math.max(0, Math.min(r1Right, o.right) - Math.max(x, o.left));
        const oh = Math.max(0, Math.min(r1Bottom, o.bottom) - Math.max(y, o.top));
        const overlapArea = ow * oh;
        if (overlapArea / area1 >= 0.25 && ow >= 85 && oh >= 110 && overlapArea > bestArea) {
          bestArea = overlapArea;
          best = o.win;
        }
      }
      return best;
    };

    scene.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      bringToFront();
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      origX = win._posX || 0;
      origY = win._posY || 0;
      curX = origX;
      curY = origY;
      maxX = Math.max(8, window.innerWidth - win.offsetWidth - 8);
      maxY = Math.max(8, window.innerHeight - win.offsetHeight - 8);
      sceneW = scene.offsetWidth || 288;
      sceneH = scene.offsetHeight || 468;

      cachedOthers = [];
      for (const otherWin of layer.children) {
        if (otherWin === win || !otherWin._cardPayload) continue;
        const os = otherWin.querySelector(".flip-card-scene");
        if (!os) continue;
        const r = os.getBoundingClientRect();
        cachedOthers.push({ win: otherWin, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      lastGlowTarget = null;
      win.classList.add("is-dragging");
      document.body.classList.add("dragging-floating-card");
      window.__rvlPauseBg = true;
      scene.setPointerCapture(e.pointerId);
    });

    scene.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      curX = Math.min(maxX, Math.max(8, origX + dx));
      curY = Math.min(maxY, Math.max(8, origY + dy));

      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!dragging) return;
        applyPos(curX, curY);
        if (moved) {
          const targetWin = findCachedOverlap(curX, curY);
          if (targetWin !== lastGlowTarget) {
            if (lastGlowTarget) lastGlowTarget.classList.remove("compare-glow");
            if (targetWin) {
              win.classList.add("compare-glow");
              targetWin.classList.add("compare-glow");
            } else {
              win.classList.remove("compare-glow");
            }
            lastGlowTarget = targetWin;
          }
        }
      });
    });

    const finishDrag = (e, cancelled) => {
      if (!dragging) return;
      dragging = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      win.classList.remove("is-dragging");
      document.body.classList.remove("dragging-floating-card");
      window.__rvlPauseBg = false;
      try { scene.releasePointerCapture(e.pointerId); } catch {}
      clearFloatingCompareGlow();
      lastGlowTarget = null;
      if (cancelled) {
        applyPos(origX, origY);
        return;
      }
      if (!moved) {
        toggleFlip();
        return;
      }
      applyPos(curX, curY);
      const targetWin = findCachedOverlap(curX, curY);
      if (targetWin) {
        applyPos(origX, origY);
        openPairCompareOverlay(win._cardPayload, targetWin._cardPayload);
      }
    };

    scene.addEventListener("pointerup", (e) => finishDrag(e, false));
    scene.addEventListener("pointercancel", (e) => finishDrag(e, true));

    layer.appendChild(win);
  }

  function initSquadCardModal() {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const pairOverlay = document.getElementById("pairCompareOverlay");
      if (pairOverlay) {
        pairOverlay.remove();
        return;
      }
      const layer = document.getElementById("floatingCardsLayer");
      if (!layer || layer.children.length === 0) return;
      const cards = Array.from(layer.children);
      cards.sort((a, b) => Number(a.style.zIndex || 0) - Number(b.style.zIndex || 0));
      cards[cards.length - 1].remove();
    });
  }

  function populateSquadYears() {
    const sqYear = document.getElementById("sqYear");
    if (!sqYear || sqYear.options.length > 1) return;
    const years = Array.from(new Set(allPlayers.map((p) => p.year))).sort((a, b) => b - a);
    for (const y of years) {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      sqYear.appendChild(opt);
    }
  }

  function renderSquadView() {
    populateSquadYears();
    renderSquadPitch();
    renderSquadPool();
  }

  function renderSquadPitch() {
    const layer = document.getElementById("sqSlotsLayer");
    if (!layer) return;
    const layout = FORMATIONS[sqState.formation] || FORMATIONS["4-4-2 A"];

    let totalCost = 0;
    let totalPwr = 0;
    let filledCount = 0;
    const sumMain = { ofa: 0, def: 0, guc: 0, hiz: 0, tek: 0, zhn: 0 };
    const weatherCounts = { Sunny: 0, Rainy: 0, Snow: 0, Cloudy: 0 };

    layer.innerHTML = layout.map((slot, idx) => {
      const p = sqState.slots[idx];
      let y = slot.y;
      let x = slot.x;
      if (idx > 0) {
        y = Math.max(10, Math.min(78, y - sqState.vert * 3));
        const dx = x - 50;
        x = Math.max(10, Math.min(90, 50 + dx * (1 + sqState.horiz * 0.08)));
      }

      if (p) {
        filledCount++;
        totalCost += p.cost || 0;
        const eq = sqState.slotEquip[idx] || { cle: "", leg: "", arm: "" };
        const eff = getEffectiveStatsAtLevel(p, sqState.level, eq);
        totalPwr += eff.pwr;
        sumMain.ofa += eff.ofa;
        sumMain.def += eff.def;
        sumMain.guc += eff.guc;
        sumMain.hiz += eff.hiz;
        sumMain.tek += eff.tek;
        sumMain.zhn += eff.zhn;
        if (weatherCounts[p.weather] !== undefined) weatherCounts[p.weather]++;
        const eqCount = [eq.cle, eq.leg, eq.arm].filter(Boolean).length;
        const eqBadge = eqCount > 0 ? `<span class="sq-slot-eq-badge" title="${eqCount} Ekipman Takılı">🛡️${eqCount}</span>` : "";
        return `
          <div class="sq-slot filled ${sqState.selectedSlot === idx ? "selected" : ""}" draggable="true" data-slot-idx="${idx}" style="top:${y}%;left:${x}%;" title="Sürükle: Taşı • Tek tık: Seç / Ekipman Tak • Çift tık: Kartı Gör • Sağ tık / ×: Çıkar">
            <button type="button" class="sq-slot-remove" data-remove-slot="${idx}" title="Oyuncuyu Çıkar">×</button>
            ${eqBadge}
            <span class="sq-slot-role">${formatRoleCode(p.role)}</span>
            <span class="sq-slot-name">${p.name}</span>
            <span class="sq-slot-pwr">${eff.pwr} PWR</span>
          </div>
        `;
      }
      return `
        <div class="sq-slot ${sqState.selectedSlot === idx ? "selected" : ""}" data-slot-idx="${idx}" style="top:${y}%;left:${x}%;">
          <span style="font-size:1rem;line-height:1;">+</span>
          <span class="sq-slot-role">${slot.label}</span>
        </div>
      `;
    }).join("");

    const costEl = document.getElementById("sqTotalCost");
    costEl.textContent = String(totalCost);
    costEl.classList.toggle("cost-over", sqState.maxCost > 0 && totalCost > sqState.maxCost);
    document.getElementById("sqAvgPwr").textContent = filledCount > 0 ? String(Math.round(totalPwr / filledCount)) : "0";
    const totalPwrEl = document.getElementById("sqTotalPwr");
    if (totalPwrEl) totalPwrEl.textContent = String(totalPwr);
    document.getElementById("sqFilledCount").textContent = `${filledCount} / 11`;

    const avgStatsEl = document.getElementById("sqAvgStats");
    if (avgStatsEl) {
      const d = filledCount || 1;
      avgStatsEl.innerHTML = filledCount > 0 ? `
        <span>OFA <b>${Math.round(sumMain.ofa / d)}</b></span>
        <span>DEF <b>${Math.round(sumMain.def / d)}</b></span>
        <span>GÜÇ <b>${Math.round(sumMain.guc / d)}</b></span>
        <span>HIZ <b>${Math.round(sumMain.hiz / d)}</b></span>
        <span>TEK <b>${Math.round(sumMain.tek / d)}</b></span>
        <span>ZHN <b>${Math.round(sumMain.zhn / d)}</b></span>
      ` : "";
    }

    const weatherEl = document.getElementById("sqWeatherSummary");
    if (weatherEl) {
      weatherEl.innerHTML = filledCount > 0 ? `
        <span title="Güneşli">☀️ ${weatherCounts.Sunny}</span>
        <span title="Yağmurlu">🌧️ ${weatherCounts.Rainy}</span>
        <span title="Karlı">❄️ ${weatherCounts.Snow}</span>
        <span title="Bulutlu">☁️ ${weatherCounts.Cloudy}</span>
      ` : "";
    }

    syncSlotEquipPanel();
    saveActiveSquad();

    layer.querySelectorAll(".sq-slot").forEach((el) => {
      const idx = Number(el.dataset.slotIdx);
      let slotClickTimer = null;
      if (sqState.slots[idx]) {
        el.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", `slot:${idx}`);
        });
        el.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          sqState.slots[idx] = null;
          sqState.slotEquip[idx] = { cle: "", leg: "", arm: "" };
          if (sqState.selectedSlot === idx) sqState.selectedSlot = null;
          renderSquadPitch();
        });
      }
      const remBtn = el.querySelector(".sq-slot-remove");
      if (remBtn) {
        remBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (slotClickTimer) { clearTimeout(slotClickTimer); slotClickTimer = null; }
          sqState.slots[idx] = null;
          sqState.slotEquip[idx] = { cle: "", leg: "", arm: "" };
          if (sqState.selectedSlot === idx) sqState.selectedSlot = null;
          renderSquadPitch();
        });
      }
      el.addEventListener("click", () => {
        if (slotClickTimer) clearTimeout(slotClickTimer);
        slotClickTimer = setTimeout(() => {
          slotClickTimer = null;
          if (sqState.selectedSlot === idx) {
            sqState.selectedSlot = null;
          } else if (
            sqState.selectedSlot !== null &&
            sqState.selectedSlot !== undefined &&
            sqState.selectedSlot !== idx &&
            sqState.slots[sqState.selectedSlot]
          ) {
            const temp = sqState.slots[idx];
            sqState.slots[idx] = sqState.slots[sqState.selectedSlot];
            sqState.slots[sqState.selectedSlot] = temp;
            const tempEq = sqState.slotEquip[idx];
            sqState.slotEquip[idx] = sqState.slotEquip[sqState.selectedSlot];
            sqState.slotEquip[sqState.selectedSlot] = tempEq;
            sqState.selectedSlot = null;
          } else {
            sqState.selectedSlot = idx;
          }
          renderSquadPitch();
        }, 210);
      });
      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (slotClickTimer) {
          clearTimeout(slotClickTimer);
          slotClickTimer = null;
        }
        if (sqState.slots[idx]) {
          openSquadCardModal(sqState.slots[idx], sqState.slotEquip[idx]);
        }
      });
      el.addEventListener("dragover", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        const payload = e.dataTransfer.getData("text/plain");
        if (payload && payload.startsWith("slot:")) {
          const srcIdx = Number(payload.slice(5));
          if (!Number.isNaN(srcIdx) && srcIdx !== idx && sqState.slots[srcIdx]) {
            const temp = sqState.slots[idx];
            sqState.slots[idx] = sqState.slots[srcIdx];
            sqState.slots[srcIdx] = temp;
            sqState.selectedSlot = null;
            renderSquadPitch();
          }
          return;
        }
        const found = allPlayers.find((x) => String(x.id) === String(payload));
        if (found) {
          sqState.slots[idx] = found;
          sqState.selectedSlot = null;
          renderSquadPitch();
        }
      });
    });
  }

  function getEffectiveStatsAtLevel(p, lvl, equipIds = null) {
    return getEffectiveStats(p, lvl, equipIds);
  }

  function renderSquadPool() {
    const grid = document.getElementById("sqPoolGrid");
    if (!grid) return;

    const allBtn = document.getElementById("sqAllTeamsBtn");
    const embBtn = document.getElementById("sqEmblemOnlyBtn");
    allBtn.textContent = `Tüm Takımlar (${allPlayers.length})`;

    let embMatchCount = 0;
    if (state.emblem) {
      embMatchCount = allPlayers.filter((p) => p.team === state.emblem.team).length;
    }
    embBtn.textContent = `Seçili Amblem (${embMatchCount})`;

    const list = [];
    for (const p of allPlayers) {
      if (sqState.emblemOnly && state.emblem && p.team !== state.emblem.team) continue;
      if (sqState.roles.size > 0 && !sqState.roles.has(p.role)) continue;
      if (sqState.grade && p.grade !== sqState.grade) continue;
      if (sqState.year && String(p.year) !== sqState.year) continue;
      if (sqState.search) {
        const hay = `${p.name} ${p.goleyTeam}`.toLowerCase();
        if (!hay.includes(sqState.search)) continue;
      }
      list.push({ p, eff: getEffectiveStatsAtLevel(p, sqState.level) });
    }

    list.sort((a, b) => b.eff.pwr - a.eff.pwr);
    const slice = list.slice(0, 60);

    grid.innerHTML = slice.map(({ p, eff }) => `
      <div class="sq-pool-card g-${p.grade}" draggable="true" data-pool-pid="${p.id}" title="${p.name} (${p.goleyTeam}) — Çift tık: Kartı Gör">
        ${buildCardPortraitHtml(p, true)}
        <div class="sq-pool-name">${p.name}</div>
        <div class="sq-pool-meta">${p.year} • ${p.goleyTeam}</div>
        <div class="sq-pool-bot">
          <span class="pos-badge ${getPosCategory(p.role)}" style="padding:1px 5px;font-size:0.65rem;">${p.role}</span>
          <strong style="color:#fbbf24;">${eff.pwr}</strong>
        </div>
      </div>
    `).join("");

    grid.querySelectorAll(".sq-pool-card").forEach((card) => {
      const pid = card.dataset.poolPid;
      let poolClickTimer = null;
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", pid);
      });
      card.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (poolClickTimer) {
          clearTimeout(poolClickTimer);
          poolClickTimer = null;
        }
        const found = allPlayers.find((x) => String(x.id) === String(pid));
        if (found) openSquadCardModal(found);
      });
      card.addEventListener("click", () => {
        if (poolClickTimer) clearTimeout(poolClickTimer);
        poolClickTimer = setTimeout(() => {
          poolClickTimer = null;
          const found = allPlayers.find((x) => String(x.id) === String(pid));
          if (!found) return;
          let targetIdx = sqState.selectedSlot;
          if (targetIdx === null || targetIdx === undefined) {
            const layout = FORMATIONS[sqState.formation];
            targetIdx = layout.findIndex((s, i) => !sqState.slots[i] && s.role === found.role);
            if (targetIdx < 0) targetIdx = sqState.slots.findIndex((x) => !x);
            if (targetIdx < 0) targetIdx = 0;
          }
          sqState.slots[targetIdx] = found;
          sqState.selectedSlot = null;
          renderSquadPitch();
        }, 210);
      });
    });
  }

  // =========================================================================
  // 5. KARŞILAŞTIRMA SAYFASI
  // =========================================================================
  function initCompareView() {
    const searchEl = document.getElementById("cmpSearchInput");
    const dropEl = document.getElementById("cmpSearchResults");
    const lvlSlider = document.getElementById("cmpLevelSlider");
    const lvlValue = document.getElementById("cmpLevelValue");
    const clearBtn = document.getElementById("cmpClearAllBtn");
    const cmpEmblemBtn = document.getElementById("cmpEmblemBtn");
    if (cmpEmblemBtn) {
      cmpEmblemBtn.addEventListener("click", () => teamSpiritBtn.click());
    }

    searchEl.addEventListener("input", () => {
      const q = searchEl.value.trim().toLowerCase();
      if (q.length < 2) {
        dropEl.classList.add("hidden");
        return;
      }
      const matches = allPlayers.filter((p) =>
        `${p.name} ${p.goleyTeam}`.toLowerCase().includes(q)
      ).slice(0, 12);

      if (matches.length === 0) {
        dropEl.innerHTML = `<div class="cmp-search-item">Sonuç bulunamadı</div>`;
      } else {
        dropEl.innerHTML = matches.map((p) => `
          <div class="cmp-search-item" data-cmp-pick="${p.id}">
            <span><strong>${p.name}</strong> <small style="color:var(--text-muted)">(${p.year} • ${p.goleyTeam})</small></span>
            <span class="grade-badge grade-${p.grade}">${GRADE_LABELS[p.grade] || p.grade} • ${p.role}</span>
          </div>
        `).join("");
      }
      dropEl.classList.remove("hidden");

      dropEl.querySelectorAll("[data-cmp-pick]").forEach((row) => {
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = row.dataset.cmpPick;
          if (!compareList.some((c) => String(c.id) === String(id))) {
            toggleComparePlayer(id);
          }
          searchEl.value = "";
          dropEl.classList.add("hidden");
          renderCompareView();
        });
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".compare-picker-row")) {
        dropEl.classList.add("hidden");
      }
    });

    const updateCmpLevelRaf = rafSchedule(() => {
      renderCompareView();
      applyFilters();
    });

    lvlSlider.addEventListener("input", () => {
      state.level = Number(lvlSlider.value);
      lvlValue.textContent = String(state.level);
      levelSlider.value = String(state.level);
      levelValue.textContent = String(state.level);
      updateCmpLevelRaf();
    });

    clearBtn.addEventListener("click", () => {
      compareList = [];
      saveCompareList();
      updateCompareBar();
      renderTable();
      renderCompareView();
    });
  }

  function renderCompareView() {
    const grid = document.getElementById("compareCardsGrid");
    const radarWrap = document.getElementById("compareRadarWrap");
    const sumWrap = document.getElementById("compareSummaryTable");
    const lvlSlider = document.getElementById("cmpLevelSlider");
    const lvlValue = document.getElementById("cmpLevelValue");
    if (!grid) return;

    if (lvlSlider) {
      lvlSlider.value = String(state.level);
      lvlValue.textContent = String(state.level);
    }

    if (compareList.length === 0) {
      if (radarWrap) { radarWrap.innerHTML = ""; radarWrap.classList.add("hidden"); }
      if (sumWrap) { sumWrap.innerHTML = ""; sumWrap.classList.add("hidden"); }
      grid.innerHTML = `<div class="cmp-empty-msg">Karşılaştırmak için yukarıdan oyuncu arayıp ekleyin veya Oyuncular tablosundaki <strong>+</strong> butonunu kullanın (en fazla 4 oyuncu).</div>`;
      return;
    }

    if (radarWrap) {
      radarWrap.innerHTML = renderCompareRadarHtml(compareList);
      radarWrap.classList.remove("hidden");
    }

    grid.innerHTML = renderCompareSequenceHtml(compareList, "data-cmp-page-rm");

    if (sumWrap) {
      const sumHtml = renderCompareSummaryHtml(compareList);
      sumWrap.innerHTML = sumHtml;
      sumWrap.classList.toggle("hidden", !sumHtml);
    }

    grid.querySelectorAll("[data-cmp-page-rm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleComparePlayer(btn.dataset.cmpPageRm);
        renderCompareView();
      });
    });
  }

  // Load Data (supports both file:// via window.PLAYERS_DATA and http via fetch)
  async function init() {
    const initialPage = document.body.dataset.page || "players";
    switchTab(initialPage, { push: false, scroll: false });
    bindEvents();
    initNavigation();
    initEmblemsView();
    initEquipmentsView();
    initSquadView();
    initCompareView();
    try {
      const preloaded = window.PLAYERS_DATA;
      if (Array.isArray(preloaded) && preloaded.length > 0) {
        allPlayers = preloaded;
      } else {
        const res = await fetch("players.json");
        allPlayers = await res.json();
      }
      hydratePlayerTeams(allPlayers);
      dbBadge.textContent = `${allPlayers.length.toLocaleString("tr-TR")} Kart`;
      try {
        const savedEmb = localStorage.getItem("rvl_emblem");
        if (savedEmb) {
          const parsedEmb = JSON.parse(savedEmb);
          if (parsedEmb && parsedEmb.team && parsedEmb.bonus) {
            state.emblem = parsedEmb;
            spiritActiveBadge.textContent = `${parsedEmb.team} ${parsedEmb.year} ${parsedEmb.stars}★`;
            spiritActiveBadge.classList.remove("hidden");
          }
        }
      } catch (_) {}
      try {
        const savedFav = JSON.parse(localStorage.getItem("rvl_favorites") || "[]");
        if (Array.isArray(savedFav)) {
          favoritesSet = new Set(savedFav.map(Number));
          saveFavorites();
        }
      } catch (_) {}
      try {
        const savedCmp = JSON.parse(localStorage.getItem("rvl_compare_list") || "[]");
        if (Array.isArray(savedCmp) && savedCmp.length > 0) {
          const pMap = new Map(allPlayers.map((p) => [String(p.id), p]));
          compareList = savedCmp.map((id) => pMap.get(String(id))).filter(Boolean).slice(0, 4);
          updateCompareBar();
        }
      } catch (_) {}
      loadActiveSquad();
      try {
        const params = new URLSearchParams(window.location.search);
        const sqParam = params.get("squad");
        if (sqParam) {
          const parsed = JSON.parse(decodeURIComponent(escape(atob(sqParam))));
          if (applySerializedSquad(parsed)) saveActiveSquad();
        }
      } catch (_) {}
      populateDropdowns();
      applyFilters();
      syncSquadEmblemUI();
      if (activeTab === "emblems") renderEmblemsView();
      else if (activeTab === "equipments") renderEquipmentsView();
      else if (activeTab === "squad") renderSquadView();
      else if (activeTab === "compare") renderCompareView();
    } catch (err) {
      console.error("Veri yükleme hatası:", err);
      playersTableBody.innerHTML = `<tr><td colspan="13" class="loading-cell">Veri dosyası (players-data.js / players.json) yüklenemedi.</td></tr>`;
    }
  }

  init();
})();
