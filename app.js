const STORAGE_KEY = "mptech_data_v1";
const SESSION_KEY = "mptech_logged";
const SETTINGS_KEY = "mptech_settings_v1";
const AUTO_BACKUP_KEY = "mptech_auto_backup_v1";
const PDV_LOCK_KEY = "mptech_pdv_locked_v1";
const PDV_SELLER_KEY = "mptech_pdv_seller_v1";
const SYNC_QUEUE_KEY = "mptech_sync_queue_v1";
const APP_VERSION = "1.1.34";
const APP_VERSION_UPDATED_AT = "2026-05-04";
const APP_ENV = window.MPTECH_APP_ENV || "production";
const CLIENTS_PAGE_SIZE = 50;
const LOCAL_STORAGE_LIMITS = {
  auditLogs: 50,
  stockMovements: 400,
  syncQueue: 80,
  closedCashSessions: 80,
  openCashMovements: 300,
};
const LOCAL_STORAGE_EMERGENCY_LIMITS = {
  auditLogs: 20,
  stockMovements: 120,
  syncQueue: 20,
  closedCashSessions: 25,
  openCashMovements: 120,
  quotes: 50,
  serviceRecords: 200,
};
const LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS = {
  products: 3000,
  sales: 300,
  clients: 500,
  expenses: 120,
  accountsPayable: 200,
  accountsReceivable: 300,
  quotes: 40,
  serviceRecords: 80,
  stockMovements: 80,
  auditLogs: 10,
  closedCashSessions: 8,
  openCashMovements: 80,
  accountPayments: 12,
};
const LOCAL_STORAGE_MINIMAL_SNAPSHOT_LIMITS = {
  products: 500,
  sales: 50,
  clients: 100,
  expenses: 30,
  accountsPayable: 50,
  accountsReceivable: 80,
  quotes: 10,
  serviceRecords: 20,
  stockMovements: 20,
  auditLogs: 5,
  closedCashSessions: 3,
  openCashMovements: 30,
  accountPayments: 5,
};
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const SUPABASE_CONFIG = {
  url: window.MPTECH_SUPABASE_URL || SUPABASE_URL,
  anonKey: window.MPTECH_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY,
};

// Supabase central e usado apenas pelos services de licenca SaaS.
// Dados operacionais usam PostgreSQL local via local-server, com fallback localStorage.
const dbClient = null;
const services = window.MPTechServices || {};
const licenseCacheService = services.licenseCacheService;
const saasLicenseService = services.saasLicenseService;
const systemAccessService = services.systemAccessService;
const localDatabaseService = services.localDatabaseService;

const money = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const DEFAULT_PERMISSIONS = {
  pdv_access: true,
  estoque_access: true,
  financeiro_access: true,
  config_access: true,
};

const ROLE_PERMISSIONS = {
  Administrador: { ...DEFAULT_PERMISSIONS },
  Gerente: {
    pdv_access: true,
    estoque_access: true,
    financeiro_access: true,
    config_access: false,
  },
  Funcionario: {
    pdv_access: true,
    estoque_access: false,
    financeiro_access: false,
    config_access: false,
  },
  Vendedor: {
    pdv_access: true,
    estoque_access: false,
    financeiro_access: false,
    config_access: false,
  },
};

const state = {
  data: loadData(),
  cart: [],
  activeScreen: "dashboard",
  pdvCategory: "Todos",
  selectedClientId: "",
  selectedSaleId: "",
  activeQuoteId: "",
  pdvClientSearch: "",
  inventorySearch: "",
  inventoryCategory: "Todas",
  inventoryStatus: "Todos",
  clientSearch: "",
  clientDebtOnly: false,
  clientStatusFilter: "Todos",
  clientPage: 1,
  settingsTab: "store",
  financeMenuOpen: false,
  pdvLocked: localStorage.getItem(PDV_LOCK_KEY) === "1",
  currentSellerId: localStorage.getItem(PDV_SELLER_KEY) || "",
  printingUntil: 0,
  dbStatus: "checking",
  dbMessage: "",
  dbSyncPaused: false,
  dbErrorNotified: {},
  lastSyncAt: "",
  lastSaasSync: null,
  lastSupabaseImport: null,
  license: null,
  localDbAvailable: false,
  storageQuotaNotified: false,
  storagePreferCompact: false,
  bulkImportType: "",
  settings: loadSettings(),
};

state.storagePreferCompact = Boolean(state.data?.storageCompactedAt)
  || ((localStorage.getItem(STORAGE_KEY) || "").length > 3500000);
state.lastSupabaseImport = state.settings.backup?.lastSupabaseImport || null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function debounce(callback, delay = 160) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLong(date = new Date()) {
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function appVersionInfo() {
  return {
    version: APP_VERSION,
    updatedAt: APP_VERSION_UPDATED_AT,
    label: `v${APP_VERSION} - ${APP_VERSION_UPDATED_AT}`,
  };
}

function updateVersionInfo() {
  const version = appVersionInfo();
  $$("[data-app-version]").forEach((item) => {
    item.textContent = version.label;
  });
  return version;
}

function makeId(prefix) {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomProductCodeSuffix() {
  const values = new Uint32Array(1);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(values);
  const seed = values[0] || Math.floor(Math.random() * 2176782336);
  return seed.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

function generateProductCode(currentProductId = "") {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const code = `PRD-${randomProductCodeSuffix()}`;
    const exists = state.data.products.some((item) => item.code === code && item.id !== currentProductId);
    if (!exists) return code;
  }
  return `PRD-${Date.now().toString(36).toUpperCase()}`;
}

function simpleHash(value) {
  let hash = 0;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return `h${Math.abs(hash)}`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

const RECEIPT_PAPER_WIDTHS = ["48mm", "58mm", "80mm"];
const RECEIPT_PRINT_DENSITIES = ["normal", "dark", "strong", "maximum"];
const RECEIPT_PRINT_DENSITY_LABELS = {
  normal: "Normal",
  dark: "Escura",
  strong: "Reforcada",
  maximum: "Maxima / Bematech",
};
const RECEIPT_PRINT_DENSITY_STYLES = {
  normal: { weight: "800", stroke: "0px", shadow: "none" },
  dark: {
    weight: "900",
    stroke: "0.16px",
    shadow: "0.18px 0 0 #000000, -0.18px 0 0 #000000, 0 0.18px 0 #000000",
  },
  strong: {
    weight: "900",
    stroke: "0.28px",
    shadow: "0.26px 0 0 #000000, -0.26px 0 0 #000000, 0 0.26px 0 #000000, 0 -0.26px 0 #000000, 0.18px 0.18px 0 #000000",
  },
  maximum: {
    weight: "900",
    stroke: "0.36px",
    shadow: "0.32px 0 0 #000000, -0.32px 0 0 #000000, 0 0.32px 0 #000000, 0 -0.32px 0 #000000, 0.24px 0.24px 0 #000000, -0.24px 0.24px 0 #000000",
  },
};

function normalizeReceiptPaperWidth(value, fallback = "80mm") {
  const width = normalizeText(value).toLowerCase();
  return RECEIPT_PAPER_WIDTHS.includes(width) ? width : fallback;
}

function normalizeReceiptPrintDensity(value, fallback = "maximum") {
  const density = normalizeText(value).toLowerCase();
  return RECEIPT_PRINT_DENSITIES.includes(density) ? density : fallback;
}

function receiptPrintDensityStyles(value) {
  return RECEIPT_PRINT_DENSITY_STYLES[normalizeReceiptPrintDensity(value)] || RECEIPT_PRINT_DENSITY_STYLES.maximum;
}

function normalizedKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeAppRole(value, fallback = "Funcionario") {
  const role = normalizedKey(value);
  if (["admin", "administrador"].includes(role)) return "Administrador";
  if (["gerente", "manager"].includes(role)) return "Gerente";
  if (["vendedor", "seller"].includes(role)) return "Vendedor";
  if (["usuario", "usuário", "user", "operador", "funcionario", "funcionário"].includes(role)) return "Funcionario";
  return fallback;
}

function onlyDigits(value) {
  return normalizeText(value).replace(/\D/g, "");
}

function isValidEmail(value) {
  const text = normalizeText(value);
  return !text || text === "-" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function isValidPhone(value) {
  const digits = onlyDigits(value);
  return !digits || digits.length >= 10;
}

function isValidCpfCnpj(value) {
  const digits = onlyDigits(value);
  return !digits || digits.length === 11 || digits.length === 14;
}

function validateContactFields({ email = "", phone = "", document = "" } = {}) {
  if (!isValidEmail(email)) return "E-mail invalido.";
  if (!isValidPhone(phone)) return "Telefone invalido.";
  if (!isValidCpfCnpj(document)) return "CPF/CNPJ invalido.";
  return "";
}

const TOTP_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateTotpSecret(length = 20) {
  const bytes = new Uint8Array(length);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  let bits = "";
  bytes.forEach((byte) => {
    bits += byte.toString(2).padStart(8, "0");
  });
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    output += TOTP_BASE32_ALPHABET[parseInt(chunk, 2)];
  }
  return output;
}

function formatTotpSecret(secret = "") {
  return normalizeText(secret).replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function decodeBase32Secret(secret = "") {
  const clean = normalizeText(secret).replace(/=|\s+/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const value = TOTP_BASE32_ALPHABET.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return new Uint8Array(bytes);
}

function counterBytes(counter) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(4, counter, false);
  return buffer;
}

async function generateTotpCode(secret, timeStep = Math.floor(Date.now() / 30000)) {
  const keyData = decodeBase32Secret(secret);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes(timeStep)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, "0");
}

async function verifyTotpCode(secret, code) {
  const cleanCode = onlyDigits(code);
  if (cleanCode.length !== 6 || !secret) return false;
  const currentStep = Math.floor(Date.now() / 30000);
  for (let drift = -1; drift <= 1; drift += 1) {
    if (await generateTotpCode(secret, currentStep + drift) === cleanCode) return true;
  }
  return false;
}

function totpUri(secret, account = "") {
  const issuer = normalizeText(state.settings.security?.twoFactorIssuer) || "MPTech Gestao";
  const label = `${issuer}:${account || currentUser()?.username || state.settings.companyName || "usuario"}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function productThumbMarkup(product) {
  const src = product.image || product.imageUrl || product.photo || product.foto || product.picture || "";
  const name = product.name || "Produto";
  if (src) {
    return `<span class="product-thumb has-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" /></span>`;
  }
  return `<span class="product-thumb"><span>${escapeHtml(name.slice(0, 2).toUpperCase())}</span></span>`;
}

function isProduction() {
  return APP_ENV === "production";
}

function toNumber(value, fallback = 0) {
  let normalized = value;
  if (typeof value === "string") {
    normalized = value.trim();
    if (normalized.includes(",") && normalized.includes(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (normalized.includes(",")) {
      normalized = normalized.replace(",", ".");
    }
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : fallback;
}

function showToast(message, type = "info") {
  let area = $("#toast-area");
  if (!area) {
    area = document.createElement("div");
    area.id = "toast-area";
    area.className = "toast-area";
    document.body.appendChild(area);
  }
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  area.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function ensureDialogRoot() {
  let root = $("#app-dialog-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "app-dialog-root";
    document.body.appendChild(root);
  }
  return root;
}

function ensureImportInput() {
  if ($("#import-file")) return;
  const input = document.createElement("input");
  input.id = "import-file";
  input.type = "file";
  input.accept = "application/json,.json";
  input.className = "hidden";
  document.body.appendChild(input);
}

function ensureBulkImportInput() {
  if ($("#bulk-import-file")) return;
  const input = document.createElement("input");
  input.id = "bulk-import-file";
  input.type = "file";
  input.accept = ".xlsx,.xls,.csv,.tsv,.html,.htm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/tab-separated-values,text/html";
  input.className = "hidden";
  document.body.appendChild(input);
}

function showDialog({ title, body, confirmText = "Confirmar", cancelText = "Cancelar", danger = false }) {
  return new Promise((resolve) => {
    const root = ensureDialogRoot();
    root.innerHTML = `
      <div class="modal app-dialog" role="dialog" aria-modal="true">
        <div class="modal-backdrop" data-dialog-cancel="true"></div>
        <div class="modal-card dialog-card">
          <h3>${title}</h3>
          <div class="dialog-body">${body}</div>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-dialog-cancel="true">${cancelText}</button>
            <button class="btn ${danger ? "danger" : "primary"}" type="button" data-dialog-confirm="true">${confirmText}</button>
          </div>
        </div>
      </div>
    `;
    const close = (value) => {
      root.innerHTML = "";
      resolve(value);
    };
    root.querySelector("[data-dialog-confirm]").addEventListener("click", () => close(true));
    root.querySelectorAll("[data-dialog-cancel]").forEach((item) => item.addEventListener("click", () => close(false)));
  });
}

function confirmAction(title, message, options = {}) {
  return showDialog({
    title: escapeHtml(title),
    body: `<p>${escapeHtml(message)}</p>`,
    confirmText: options.confirmText || "Confirmar",
    cancelText: options.cancelText || "Cancelar",
    danger: Boolean(options.danger),
  });
}

async function promptFields(title, fields, options = {}) {
  const body = `
    <form id="dialog-form" class="dialog-form">
      ${fields.map((field) => `
        <label>
          ${escapeHtml(field.label)}
          ${field.type === "textarea"
            ? `<textarea name="${escapeHtml(field.name)}" ${field.required ? "required" : ""}>${escapeHtml(field.value || "")}</textarea>`
            : field.type === "select"
              ? `<select name="${escapeHtml(field.name)}" ${field.required ? "required" : ""}>${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${String(field.value || "") === String(option) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`
              : `<input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(field.value || "")}" ${field.required ? "required" : ""} ${field.min !== undefined ? `min="${escapeHtml(field.min)}"` : ""} ${field.step !== undefined ? `step="${escapeHtml(field.step)}"` : ""} ${field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : ""} />`}
        </label>
      `).join("")}
    </form>
  `;
  return new Promise((resolve) => {
    const root = ensureDialogRoot();
    root.innerHTML = `
      <div class="modal app-dialog" role="dialog" aria-modal="true">
        <div class="modal-backdrop" data-dialog-cancel="true"></div>
        <div class="modal-card dialog-card">
          <h3>${title}</h3>
          <div class="dialog-body">${body}</div>
          <div class="modal-actions">
            <button class="btn ghost" type="button" data-dialog-cancel="true">Cancelar</button>
            <button class="btn primary" type="button" data-dialog-confirm="true">${options.confirmText || "Salvar"}</button>
          </div>
        </div>
      </div>
    `;
    const close = (value) => {
      root.innerHTML = "";
      resolve(value);
    };
    const submit = () => {
      const form = root.querySelector("#dialog-form");
      if (!form.reportValidity()) return;
      close(Object.fromEntries(new FormData(form).entries()));
    };
    root.querySelector("[data-dialog-confirm]").addEventListener("click", submit);
    root.querySelector("#dialog-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    root.querySelectorAll("[data-dialog-cancel]").forEach((item) => item.addEventListener("click", () => close(null)));
    root.querySelector("input, select, textarea")?.focus();
  });
}

function audit(action, detail = "") {
  state.data.auditLogs.unshift({
    id: makeId("log"),
    date: new Date().toISOString(),
    user: state.settings.adminName,
    action,
    detail,
  });
  state.data.auditLogs = state.data.auditLogs.slice(0, LOCAL_STORAGE_LIMITS.auditLogs);
  saveData();
}

function currentCashSession() {
  return state.data.cashSessions.find((session) => !session.closedAt);
}

function currentCashTotal() {
  const session = currentCashSession();
  if (!session) return 0;
  return session.movements.reduce((sum, movement) => {
    if (movement.type === "out") return sum - movement.value;
    return sum + movement.value;
  }, session.openingValue);
}

function cashSoldTotal(session = currentCashSession()) {
  if (!session) return 0;
  return (session.movements || [])
    .filter((movement) => movement.type === "sale")
    .reduce((sum, movement) => sum + toNumber(movement.value), 0);
}

function loadSyncQueue(fallback = []) {
  const saved = localStorage.getItem(SYNC_QUEUE_KEY);
  if (!saved) return Array.isArray(fallback) ? fallback.slice(-LOCAL_STORAGE_LIMITS.syncQueue) : [];
  try {
    const queue = JSON.parse(saved);
    return Array.isArray(queue) ? queue.slice(-LOCAL_STORAGE_LIMITS.syncQueue) : [];
  } catch {
    localStorage.removeItem(SYNC_QUEUE_KEY);
    return Array.isArray(fallback) ? fallback.slice(-LOCAL_STORAGE_LIMITS.syncQueue) : [];
  }
}

function loadData() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const data = normalizeData(JSON.parse(saved));
      data.syncQueue = loadSyncQueue(data.syncQueue);
      return data;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const data = emptyData();
  data.syncQueue = loadSyncQueue();
  return data;
}

function emptyData() {
  return normalizeData({
    products: [],
    sales: [],
    expenses: [],
    accountsPayable: [],
    accountsReceivable: [],
    quotes: [],
    serviceRecords: [],
    syncQueue: [],
    clients: [],
    cashSessions: [],
    stockMovements: [],
    auditLogs: [],
  });
}

function normalizeData(data) {
  data.products = data.products || [];
  data.products = data.products.map((product) => ({
    ...product,
    barcode: product.barcode || product.code,
    supplier: product.supplier || "Não informado",
    retailPrice: toNumber(product.retailPrice ?? product.price),
    wholesalePrice: toNumber(product.wholesalePrice ?? product.precoAtacado ?? product.price),
    wholesaleMinQty: Math.max(1, toNumber(product.wholesaleMinQty ?? product.qtdAtacado ?? 1)),
    price: toNumber(product.price ?? product.retailPrice),
    active: product.active !== false,
  }));
  data.sales = data.sales || [];
  data.sales = data.sales.map((sale) => {
    const netTotal = toNumber(sale.netTotal ?? sale.total);
    const commissionPercent = toNumber(sale.commissionPercent ?? sale.comissaoPercentual ?? 0);
    return {
      ...sale,
      grossTotal: toNumber(sale.grossTotal ?? sale.subtotal ?? sale.total),
      subtotal: toNumber(sale.subtotal ?? sale.grossTotal ?? sale.total),
      discount: toNumber(sale.discount ?? 0),
      netTotal,
      vendedorId: sale.vendedorId || sale.sellerId || "",
      vendedorNome: sale.vendedorNome || sale.sellerName || "",
      commissionPercent,
      commissionValue: toNumber(sale.commissionValue ?? sale.comissaoValor ?? (sale.canceled ? 0 : netTotal * commissionPercent / 100)),
      commissionCanceled: Boolean(sale.commissionCanceled || sale.canceled),
    };
  });
  data.expenses = data.expenses || [];
  data.expenses = data.expenses.map((expense) => ({ category: "Geral", ...expense }));
  data.accountsPayable = data.accountsPayable || [];
  data.accountsReceivable = data.accountsReceivable || [];
  data.accountsReceivable = data.accountsReceivable.map((account) => {
    const paidValue = toNumber(account.paidValue ?? account.valorPago ?? (account.status === "Recebido" ? account.value : 0));
    const value = toNumber(account.value ?? account.valor);
    return {
      ...account,
      value,
      paidValue,
      remainingValue: Math.max(0, value - paidValue),
      payments: Array.isArray(account.payments) ? account.payments : [],
      status: account.status || (paidValue >= value ? "Recebido" : paidValue > 0 ? "Parcial" : "Pendente"),
    };
  });
  data.quotes = (data.quotes || []).map((quote) => ({
    status: "Aberto",
    createdAt: quote.createdAt || quote.date || new Date().toISOString(),
    items: [],
    ...quote,
  }));
  data.serviceRecords = (data.serviceRecords || []).map((record) => ({
    type: record.type || "assistencia",
    status: record.status || "Aberto",
    createdAt: record.createdAt || record.entryDate || new Date().toISOString(),
    ...record,
  }));
  data.clients = data.clients || [];
  data.clients = data.clients.map((client) => ({
    ...client,
    createdAt: client.createdAt || "",
    email: client.email || "-",
  }));
  data.cashSessions = data.cashSessions || [];
  data.stockMovements = data.stockMovements || [];
  data.auditLogs = data.auditLogs || [];
  data.syncQueue = Array.isArray(data.syncQueue) ? data.syncQueue.slice(-LOCAL_STORAGE_LIMITS.syncQueue) : [];
  return data;
}

function defaultSettings() {
  return {
    systemName: "MPTech Gestao",
    companyName: "World Acessorios Atacado",
    adminName: "",
    general: {
      language: "pt-BR",
      timeZone: "America/Sao_Paulo",
      dateFormat: "DD/MM/AAAA",
    },
    users: [],
    sessionMinutes: 240,
    store: {
      storeName: "World Acessorios Atacado",
      name: "World Acessorios Atacado",
      cnpj: "",
      document: "",
      address: "",
      city: "",
      state: "MG",
      phone: "",
      instagram: "",
      email: "",
      defaultMessage: "Ola! Seja bem-vindo(a) a World Acessorios Atacado. Como podemos ajudar?",
      receiptFooter: "Obrigado pela preferencia. Volte sempre!",
    },
    finance: {
      categories: ["Vendas", "Geral", "Conta a pagar"],
      bankAccounts: ["Caixa"],
      defaultBankAccount: "Caixa",
      pixFee: 0,
      cardFee: 3.49,
      cardFeeMode: "percent",
      monthlySalesGoal: 50000,
      monthlyProfitGoal: 15000,
      monthlyClientGoal: 50,
      receivableAlertDays: 3,
      payableAlertDays: 3,
      defaultCommissionPercent: 0,
    },
    pdv: {
      printerEnabled: true,
      printerMode: "dialog",
      receiptPrinter: "Impressora termica",
      receiptType: "detalhado",
      receiptCopies: 1,
      receiptPaperWidth: "80mm",
      compactSmallPaper: true,
      receiptFontSize: 12,
      receiptPrintDensity: "maximum",
      receiptSideMarginMm: 3,
      receiptOptions: {
        systemTitle: true,
        storeName: true,
        document: true,
        address: true,
        cityState: true,
        phone: true,
        saleId: true,
        date: true,
        payment: true,
        seller: true,
        clientName: true,
        clientDocument: true,
        clientPhone: false,
        items: true,
        itemCode: true,
        subtotal: true,
        discount: true,
        fees: true,
        netTotal: true,
        cashReceived: true,
        footer: true,
      },
      autoOpenCash: false,
      allowNegativeStock: false,
      maxDiscountPercent: 10,
      discountLimits: {
        Administrador: 100,
        Gerente: 30,
        Funcionario: 10,
        Vendedor: 10,
      },
      autoCutPaper: false,
      shortcuts: "F1 buscar produto, F2 gaveta, ESC limpar carrinho, ENTER adicionar produto, F4 finalizar venda",
    },
    notifications: {
      sale: true,
      lowStock: true,
      error: true,
    },
    integrations: {
      paymentProvider: "manual",
      whatsappNumber: "",
      whatsappDefaultMessage: "",
      instagramProfile: "",
      pixKeyType: "aleatoria",
      pixKey: "",
      pixMerchantName: "",
      pixMerchantCity: "",
    },
    security: {
      twoFactorEnabled: false,
      totpSecret: "",
      twoFactorVerifiedAt: "",
      twoFactorIssuer: "MPTech Gestao",
    },
    backup: {
      autoDaily: true,
      lastAutoBackupAt: "",
      lastSupabaseImport: null,
    },
    tenant: {
      tenantId: "world-acessorios",
      licenseStatus: "ativo",
      trialEndsAt: "",
      expiresAt: "",
      plan: "local",
    },
    appearance: {
      theme: "Claro",
      accent: "MPTech",
      primaryColor: "#0f1f3d",
      secondaryColor: "#6d3fd1",
    },
  };
}

function normalizeUsers(users) {
  return users.filter((user) => !(user.username === "admin" && user.passwordHash === simpleHash("admin"))).map((user, index) => {
    const role = normalizeAppRole(user.role || user.perfil, index === 0 ? "Administrador" : "Funcionario");
    const commissionPercent = user.commissionPercent ?? user.comissaoPercentual ?? user.payload?.commissionPercent ?? "";
    return {
      id: user.id || makeId("usr"),
      name: user.name || user.username || "Usuario",
      username: user.username || `usuario${index + 1}`,
      email: user.email || "",
      passwordHash: user.passwordHash || simpleHash(user.password || "123456"),
      role,
      discountLimitPercent: user.discountLimitPercent ?? user.maxDiscountPercent ?? "",
      commissionPercent: commissionPercent === "" || commissionPercent === null || commissionPercent === undefined ? "" : Math.max(0, Math.min(100, toNumber(commissionPercent))),
      monthlyGoal: toNumber(user.monthlyGoal ?? user.metaMensal ?? 0),
      permissions: {
        ...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Funcionario),
        ...(user.permissions || {}),
      },
      active: user.active !== false,
    };
  });
}

function mergeSettings(settings = {}) {
  const defaults = defaultSettings();
  const store = { ...defaults.store, ...(settings.store || {}) };
  store.storeName = store.storeName || store.name || defaults.store.storeName;
  store.name = store.storeName;
  store.cnpj = store.cnpj || store.document || "";
  store.document = store.cnpj;
  const pdv = {
    ...defaults.pdv,
    ...(settings.pdv || {}),
    receiptOptions: {
      ...defaults.pdv.receiptOptions,
      ...(settings.pdv?.receiptOptions || {}),
    },
  };
  return {
    ...defaults,
    ...settings,
    general: { ...defaults.general, ...(settings.general || {}) },
    store,
    finance: { ...defaults.finance, ...(settings.finance || {}) },
    pdv,
    notifications: { ...defaults.notifications, ...(settings.notifications || {}) },
    integrations: { ...defaults.integrations, ...(settings.integrations || {}) },
    security: { ...defaults.security, ...(settings.security || {}) },
    backup: { ...defaults.backup, ...(settings.backup || {}) },
    tenant: { ...defaults.tenant, ...(settings.tenant || {}) },
    appearance: { ...defaults.appearance, ...(settings.appearance || {}) },
    users: normalizeUsers(settings.users || defaults.users),
    sessionMinutes: settings.sessionMinutes || defaults.sessionMinutes,
  };
}

function isQuotaExceededError(error) {
  return error?.name === "QuotaExceededError"
    || error?.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error?.code === 22
    || error?.code === 1014;
}

function storageDataSnapshot() {
  const { syncQueue, ...data } = state.data || {};
  return {
    ...data,
    syncQueue: [],
  };
}

function limitStorageArray(items, limit) {
  if (!Array.isArray(items) || limit <= 0) return [];
  return items.slice(0, limit);
}

function compactProductForStorage(product = {}) {
  return {
    id: product.id,
    code: product.code,
    barcode: product.barcode || product.code,
    name: product.name,
    category: product.category,
    cost: toNumber(product.cost),
    price: toNumber(product.price ?? product.retailPrice),
    retailPrice: toNumber(product.retailPrice ?? product.price),
    wholesalePrice: toNumber(product.wholesalePrice ?? product.price),
    wholesaleMinQty: Math.max(1, toNumber(product.wholesaleMinQty || 1)),
    stock: toNumber(product.stock),
    minStock: toNumber(product.minStock),
    active: product.active !== false,
  };
}

function compactClientForStorage(client = {}) {
  return {
    id: client.id,
    name: client.name,
    document: client.document,
    phone: client.phone,
    email: client.email,
    status: client.status,
    createdAt: client.createdAt,
  };
}

function compactAccountForStorage(account = {}, limits = LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS) {
  return {
    ...account,
    payments: limitStorageArray(account.payments, limits.accountPayments),
  };
}

function compactCashSessionsForStorage(sessions = [], limits = LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS) {
  if (!Array.isArray(sessions)) return [];
  const open = sessions
    .filter((session) => !session.closedAt)
    .map((session) => ({ ...session, movements: (session.movements || []).slice(-limits.openCashMovements) }));
  const closed = sessions
    .filter((session) => session.closedAt)
    .slice(0, limits.closedCashSessions)
    .map((session) => ({ ...session, movements: [] }));
  return [...open, ...closed]
    .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));
}

function compactStorageDataSnapshot(limits = LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS) {
  const data = storageDataSnapshot();
  return {
    ...data,
    products: limitStorageArray(data.products, limits.products).map(compactProductForStorage),
    sales: limitStorageArray(data.sales, limits.sales),
    expenses: limitStorageArray(data.expenses, limits.expenses),
    accountsPayable: limitStorageArray(data.accountsPayable, limits.accountsPayable)
      .map((account) => compactAccountForStorage(account, limits)),
    accountsReceivable: limitStorageArray(data.accountsReceivable, limits.accountsReceivable)
      .map((account) => compactAccountForStorage(account, limits)),
    quotes: limitStorageArray(data.quotes, limits.quotes),
    serviceRecords: limitStorageArray(data.serviceRecords, limits.serviceRecords),
    clients: limitStorageArray(data.clients, limits.clients).map(compactClientForStorage),
    cashSessions: compactCashSessionsForStorage(data.cashSessions, limits),
    stockMovements: limitStorageArray(data.stockMovements, limits.stockMovements),
    auditLogs: limitStorageArray(data.auditLogs, limits.auditLogs),
    syncQueue: [],
    storageCompactedAt: new Date().toISOString(),
  };
}

function trimStorageData(limits = LOCAL_STORAGE_LIMITS) {
  if (!state.data) return;
  if (Array.isArray(state.data.auditLogs)) state.data.auditLogs = state.data.auditLogs.slice(0, limits.auditLogs);
  if (Array.isArray(state.data.stockMovements)) state.data.stockMovements = state.data.stockMovements.slice(0, limits.stockMovements);
  if (Array.isArray(state.data.syncQueue)) state.data.syncQueue = state.data.syncQueue.slice(-limits.syncQueue);
  if (limits.quotes && Array.isArray(state.data.quotes)) state.data.quotes = state.data.quotes.slice(0, limits.quotes);
  if (limits.serviceRecords && Array.isArray(state.data.serviceRecords)) state.data.serviceRecords = state.data.serviceRecords.slice(0, limits.serviceRecords);
  if (Array.isArray(state.data.cashSessions)) {
    const open = state.data.cashSessions
      .filter((session) => !session.closedAt)
      .map((session) => ({ ...session, movements: (session.movements || []).slice(-limits.openCashMovements) }));
    const closed = state.data.cashSessions
      .filter((session) => session.closedAt)
      .slice(0, limits.closedCashSessions)
      .map((session) => ({ ...session, movements: [] }));
    state.data.cashSessions = [...open, ...closed]
      .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));
  }
}

function notifyStorageQuotaCompaction() {
  if (state.storageQuotaNotified) return;
  state.storageQuotaNotified = true;
  showToast("Armazenamento local cheio. O cache local foi reduzido para manter o sistema operando.", "info");
}

function writeDataToLocalStorage(context = "dados", options = {}) {
  const write = (snapshot = storageDataSnapshot(), replaceCurrent = false) => {
    const payload = JSON.stringify(snapshot);
    if (replaceCurrent) localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY, payload);
  };
  const writeCompact = (limits = LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS) => {
    write(compactStorageDataSnapshot(limits), true);
    state.storagePreferCompact = true;
    notifyStorageQuotaCompaction();
    return true;
  };
  if (options.preferCompact || state.storagePreferCompact) {
    try {
      return writeCompact(LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS);
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      console.warn(`Snapshot compacto de ${context} excede o localStorage. Gravando snapshot minimo.`, error);
    }

    try {
      return writeCompact(LOCAL_STORAGE_MINIMAL_SNAPSHOT_LIMITS);
    } catch (error) {
      console.error(`Nao foi possivel persistir ${context} no localStorage.`, error);
      showToast("Nao foi possivel salvar no armazenamento local. Verifique o banco local/backup antes de fechar o sistema.", "error");
      return false;
    }
  }

  try {
    write();
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    state.storagePreferCompact = true;
    console.warn(`LocalStorage cheio ao salvar ${context}. Compactando dados locais.`, error);
  }

  trimStorageData(LOCAL_STORAGE_LIMITS);
  try {
    write();
    notifyStorageQuotaCompaction();
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    state.storagePreferCompact = true;
    console.warn(`LocalStorage ainda cheio ao salvar ${context}. Aplicando compactacao emergencial.`, error);
  }

  trimStorageData(LOCAL_STORAGE_EMERGENCY_LIMITS);
  try {
    write();
    notifyStorageQuotaCompaction();
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    state.storagePreferCompact = true;
    console.warn(`LocalStorage cheio mesmo apos compactacao emergencial de ${context}. Gravando snapshot compacto.`, error);
  }

  try {
    return writeCompact(LOCAL_STORAGE_COMPACT_SNAPSHOT_LIMITS);
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    console.warn(`Snapshot compacto de ${context} ainda excede o localStorage. Gravando snapshot minimo.`, error);
  }

  try {
    return writeCompact(LOCAL_STORAGE_MINIMAL_SNAPSHOT_LIMITS);
  } catch (error) {
    console.error(`Nao foi possivel persistir ${context} no localStorage.`, error);
    showToast("Nao foi possivel salvar no armazenamento local. Verifique o banco local/backup antes de fechar o sistema.", "error");
    return false;
  }
}

function loadSettings() {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    try {
      const settings = JSON.parse(saved);
      settings.users = settings.users || defaultSettings().users;
      settings.sessionMinutes = settings.sessionMinutes || 240;
      return mergeSettings(settings);
    } catch {
      localStorage.removeItem(SETTINGS_KEY);
    }
  }
  return {
    systemName: "MPTech Gestão",
    companyName: "World Acessorios Atacado",
    adminName: "",
    users: [],
    sessionMinutes: 240,
  };
}

function saveData() {
  writeDataToLocalStorage("dados");
  syncData();
}

function saveDataWithAudit(action, detail = "") {
  state.data.auditLogs.unshift({
    id: makeId("log"),
    date: new Date().toISOString(),
    user: currentUser()?.username || state.settings.adminName,
    action,
    detail,
  });
  state.data.auditLogs = state.data.auditLogs.slice(0, LOCAL_STORAGE_LIMITS.auditLogs);
  saveData();
  syncAudit(action, detail);
}

function saveSettings() {
  state.settings = mergeSettings(state.settings);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  syncSettings();
  if (document.body) applyRuntimeSettings();
}

function syncData() {
  if (!dbClient || state.dbSyncPaused) return;
  state.lastSyncAt = new Date().toISOString();
}

function currentSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
  } catch {
    return {};
  }
}

function hasLocalApiSession() {
  return Boolean(currentSession().token);
}

function currentUser() {
  const session = currentSession();
  const storedUser = state.settings.users.find((user) => (
    user.username === session.user ||
    user.email === session.user ||
    user.id === session.userId
  ) && user.active !== false);
  if (storedUser) return storedUser;
  if (session.logged && session.user) {
    const role = session.role || "Funcionario";
    return {
      id: session.userId || session.user,
      username: session.user,
      name: session.user,
      role,
      permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Funcionario,
      active: true,
    };
  }
  return null;
}

function activeSellers() {
  const users = state.settings.users
    .filter((user) => user.active !== false)
    .filter((user) => ["Vendedor", "Funcionario", "Gerente", "Administrador"].includes(user.role || "Funcionario"));
  const sessionUser = currentUser();
  if (!users.length && sessionUser) return [sessionUser];
  return users;
}

function currentSeller() {
  const sellers = activeSellers();
  const selected = sellers.find((seller) => seller.id === state.currentSellerId || seller.username === state.currentSellerId);
  return selected || null;
}

function commissionPercentForSeller(seller = currentSeller()) {
  const individual = seller?.commissionPercent;
  if (individual !== undefined && individual !== null && individual !== "") return Math.max(0, toNumber(individual));
  return Math.max(0, toNumber(state.settings.finance?.defaultCommissionPercent || 0));
}

function discountLimitForSeller(seller = currentSeller()) {
  const individual = seller?.discountLimitPercent;
  if (individual !== undefined && individual !== null && individual !== "") return Math.max(0, Math.min(100, toNumber(individual)));
  const role = seller?.role || "Vendedor";
  const limits = { ...defaultSettings().pdv.discountLimits, ...(state.settings.pdv?.discountLimits || {}) };
  return Math.max(0, Math.min(100, toNumber(limits[role] ?? state.settings.pdv?.maxDiscountPercent ?? 10)));
}

function focusPdvSearch() {
  if (state.activeScreen !== "pdv") return;
  const checkoutModal = $("#pdv-checkout-modal");
  if (checkoutModal && !checkoutModal.classList.contains("hidden")) return;
  setTimeout(() => $("#product-search")?.focus(), 0);
}

function alertProductNotFound(term = "") {
  showToast(term ? `Produto nao encontrado para ${term}.` : "Produto nao encontrado.", "error");
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 220;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
  } catch {
    // Alerta visual continua suficiente quando o navegador bloqueia audio.
  }
}

function findExactBarcodeProduct(term) {
  const key = normalizedKey(term);
  if (!key) return null;
  return state.data.products.find((product) => product.active !== false && (
    normalizedKey(product.code) === key || normalizedKey(product.barcode) === key
  )) || null;
}

function handleBarcodeSearch(term, { alertMissing = false } = {}) {
  const product = findExactBarcodeProduct(term);
  if (product) {
    addToCart(product.id);
    const search = $("#product-search");
    if (search) search.value = "";
    renderSearchResults();
    focusPdvSearch();
    return true;
  }
  if (alertMissing && normalizeText(term)) alertProductNotFound(term);
  return false;
}

async function authorizeDiscountAboveLimit(discount, limitValue) {
  const result = await promptFields("Autorizar desconto acima do limite", [
    { name: "password", label: "Senha do administrador", type: "password", required: true },
  ], { confirmText: "Autorizar desconto", cancelText: "Cancelar" });
  if (!result) return null;
  const admin = await authenticateAdminPassword(result.password);
  if (!admin) {
    saveDataWithAudit("Desconto acima do limite negado", `Desconto ${money.format(discount)} | Limite ${money.format(limitValue)}`);
    showToast("Senha de administrador invalida.", "error");
    return null;
  }
  saveDataWithAudit("Desconto acima do limite autorizado", `${admin.name || admin.username} autorizou ${money.format(discount)} acima de ${money.format(limitValue)}`);
  return admin;
}

function isAdminUser(user = currentUser()) {
  return user?.role === "Administrador";
}

function canViewCommissions(user = currentUser()) {
  return isAdminUser(user);
}

function findLocalAdminByPassword(password = "") {
  const hash = simpleHash(password);
  return state.settings.users.find((user) => user.active !== false && user.role === "Administrador" && user.passwordHash === hash) || null;
}

function adminLoginCandidates() {
  const candidates = [];
  const session = currentSession();
  const sessionUser = currentUser();
  if (sessionUser?.role === "Administrador") candidates.push(session.user, sessionUser.username, sessionUser.email);
  state.settings.users
    .filter((user) => user.active !== false && user.role === "Administrador")
    .forEach((user) => candidates.push(user.username, user.email));
  return [...new Set(candidates.map(normalizeText).filter(Boolean))].slice(0, 5);
}

async function authenticateAdminPassword(password = "") {
  const localAdmin = findLocalAdminByPassword(password);
  if (localAdmin) return localAdmin;
  if (!localDatabaseService?.login) return null;

  const candidates = adminLoginCandidates();
  for (const login of candidates) {
    try {
      const response = await localDatabaseService.login(login, password);
      const authUser = response?.data || response;
      if (authUser?.id && roleFromAuth(authUser) === "Administrador") {
        upsertAuthenticatedUser(authUser);
        return state.settings.users.find((user) => user.id === authUser.id || user.username === login || user.email === login) || {
          id: authUser.id,
          username: authUser.usuario || authUser.email || login,
          name: authUser.nome || authUser.name || login,
          role: "Administrador",
        };
      }
    } catch {
      // Continua tentando outros administradores conhecidos; falha final fica generica.
    }
  }
  return null;
}

async function validateAdminPassword(password = "") {
  return Boolean(await authenticateAdminPassword(password));
}

function productCategories(products = state.data.products) {
  const categories = [];
  const seen = new Set();
  products.forEach((product) => {
    const category = normalizeText(product.category);
    const key = normalizedKey(category);
    if (!category || seen.has(key)) return;
    seen.add(key);
    categories.push(category);
  });
  return categories.sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function normalizeCategoryName(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const key = normalizedKey(text);
  return productCategories().find((category) => normalizedKey(category) === key) || text;
}

function renderProductCategoryDatalist() {
  const datalist = $("#product-category-list");
  if (!datalist) return;
  datalist.innerHTML = productCategories().map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
}

function renderPdvSellerSelector() {
  const select = $("#pdv-seller");
  if (!select) return;
  const sellers = activeSellers();
  const selectedStillExists = sellers.some((seller) => seller.id === state.currentSellerId || seller.username === state.currentSellerId);
  if (!selectedStillExists) state.currentSellerId = "";
  select.classList.toggle("required-missing", !state.currentSellerId);
  select.innerHTML = [
    `<option value="">Selecione o vendedor (obrigatorio)</option>`,
    ...sellers.map((seller) => {
      const id = seller.id || seller.username;
      const label = seller.name || seller.username || "Vendedor";
      return `<option value="${escapeHtml(id)}" ${state.currentSellerId === id ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }),
  ].join("");
  const seller = currentSeller();
  setText("#pdv-seller-current", seller ? (seller.name || seller.username || "Vendedor selecionado") : "Vendedor no fechamento");
}

function applyPdvLockMode() {
  const shell = $("#app-shell");
  if (!shell) return;
  shell.classList.toggle("pdv-locked", state.pdvLocked);
  shell.classList.toggle("pdv-sale-only", state.pdvLocked);
  localStorage.setItem(PDV_LOCK_KEY, state.pdvLocked ? "1" : "0");
  const lockButton = $("#pdv-lock-mode");
  if (lockButton) {
    lockButton.classList.toggle("active", state.pdvLocked);
    lockButton.disabled = !state.pdvLocked;
    lockButton.textContent = "Desbloquear";
    lockButton.setAttribute("aria-label", state.pdvLocked ? "Desbloquear modo venda" : "Modo venda inativo");
  }
  const saleModeButton = $(".pdv-sale-mode");
  if (saleModeButton) {
    saleModeButton.classList.toggle("active", state.pdvLocked);
    saleModeButton.textContent = state.pdvLocked ? "Modo venda ativo" : "Modo venda";
    saleModeButton.setAttribute("aria-pressed", state.pdvLocked ? "true" : "false");
  }
  const overlay = $("#pdv-lock-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }
  const pdvIsVisible = $("#pdv")?.classList.contains("active");
  if (state.pdvLocked && (state.activeScreen !== "pdv" || !pdvIsVisible)) switchScreen("pdv");
  focusPdvSearch();
}

async function requestUnlockPdvMode() {
  const result = await promptFields("Desbloquear modo venda", [
    { name: "password", label: "Senha do administrador", type: "password", required: true },
  ], { confirmText: "Desbloquear", cancelText: "Cancelar" });
  if (!result) return;
  showToast("Validando senha do administrador...", "info");
  const unlocked = await validateAdminPassword(result.password);
  if (!unlocked) {
    console.warn("Tentativa invalida de sair do modo venda.");
    saveDataWithAudit("Tentativa de desbloqueio do modo venda", "Senha de administrador invalida.");
    showToast("Senha de administrador invalida.", "error");
    return;
  }
  state.pdvLocked = false;
  applyPdvLockMode();
  saveDataWithAudit("Modo venda desativado", "Gestao liberada por administrador.");
  showToast("Gestao liberada.", "success");
}

async function togglePdvLockMode() {
  if (state.pdvLocked) {
    await requestUnlockPdvMode();
    return;
  }
  activatePdvSaleMode();
}

function activatePdvSaleMode() {
  state.pdvLocked = true;
  applyPdvLockMode();
  switchScreen("pdv");
  saveDataWithAudit("Modo venda ativado", "Gestao bloqueada; navegacao restrita ao PDV.");
  showToast("Modo venda ativado. Gestao bloqueada ate desbloqueio do administrador.", "success");
}

async function unlockPdvFromOverlay() {
  const input = $("#pdv-unlock-password");
  const password = input?.value || "";
  if (!password) {
    input?.focus();
    showToast("Informe a senha do administrador.", "error");
    return;
  }
  showToast("Validando senha do administrador...", "info");
  const unlocked = await validateAdminPassword(password);
  if (!unlocked) {
    saveDataWithAudit("Tentativa de desbloqueio do modo venda", "Senha de administrador invalida.");
    showToast("Senha de administrador invalida.", "error");
    input.value = "";
    input.focus();
    return;
  }
  input.value = "";
  state.pdvLocked = false;
  applyPdvLockMode();
  saveDataWithAudit("Modo venda desativado", "Gestao liberada por administrador.");
  showToast("Gestao liberada.", "success");
}

function roleFromAuth(authUser = {}) {
  return normalizeAppRole(authUser.role || authUser.perfil, "Funcionario");
}

function upsertAuthenticatedUser(authUser = {}) {
  if (!authUser?.id && !authUser?.email && !authUser?.usuario) return;
  const role = roleFromAuth(authUser);
  const username = authUser.usuario || authUser.email || authUser.id;
  const existing = state.settings.users.find((user) => user.id === authUser.id || user.username === username || user.email === authUser.email);
  const next = {
    ...(existing || {}),
    id: authUser.id || existing?.id || makeId("usr"),
    name: authUser.nome || authUser.name || existing?.name || username,
    username,
    email: authUser.email || existing?.email || username,
    role,
      commissionPercent: authUser.commissionPercent ?? authUser.comissaoPercentual ?? existing?.commissionPercent ?? "",
      discountLimitPercent: authUser.discountLimitPercent ?? existing?.discountLimitPercent ?? "",
      monthlyGoal: toNumber(authUser.monthlyGoal ?? authUser.metaMensal ?? existing?.monthlyGoal ?? 0),
    permissions: { ...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Funcionario), ...(existing?.permissions || {}), ...(authUser.permissions || {}) },
    active: true,
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    state.settings.users.push(next);
  }
  saveSettings();
}

async function refreshUsersFromApi() {
  if (!localDatabaseService?.listUsers || !hasLocalApiSession()) return;
  try {
    const response = await localDatabaseService.listUsers();
    const users = response?.data || response || [];
    if (!Array.isArray(users) || !users.length) return;
    users.forEach(upsertAuthenticatedUser);
    renderSettings();
  } catch {
    // A tela continua usando os usuarios locais quando a API nao responder.
  }
}

function userHasPermission(user, permission) {
  if (!permission) return true;
  if (user?.role === "Administrador") return true;
  return Boolean(user?.permissions?.[permission]);
}

function hasPermission(permission) {
  return userHasPermission(currentUser(), permission);
}

function requirePermission(permission, action = "executar esta acao") {
  if (!requireSession(action)) return false;
  if ((permission === "pdv_access" && isLicenseBlockedFor("pdv")) || (permission === "financeiro_access" && isLicenseBlockedFor("finance"))) {
    showToast("Licenca vencida ou bloqueada para esta operacao.", "error");
    return false;
  }
  if (hasPermission(permission)) return true;
  showToast(`Seu usuario nao tem permissao para ${action}.`, "error");
  return false;
}

function isLicenseBlockedFor(screen = state.activeScreen) {
  if (state.license && state.license.allowed === false) return true;
  const tenant = state.settings.tenant || {};
  const expired = tenant.expiresAt && tenant.expiresAt < todayISO();
  const blockedStatus = ["vencido", "bloqueado", "expired", "blocked"].includes(tenant.licenseStatus);
  const protectedScreens = ["pdv", "finance", "finance-income", "finance-expenses", "accounts-payable", "accounts-receivable", "reports"];
  return (expired || blockedStatus) && protectedScreens.includes(screen);
}

function moduleForScreen(screen) {
  return {
    dashboard: "dashboard",
    pdv: "pdv",
    products: "produtos",
    finance: "financeiro",
    "finance-income": "financeiro",
    "finance-expenses": "financeiro",
    "accounts-payable": "financeiro",
    "accounts-receivable": "financeiro",
    sales: "vendas",
    reports: "relatorios",
    clients: "clientes",
    settings: "configuracoes",
  }[screen] || "";
}

function hasModuleAccess(moduleSlug) {
  if (!moduleSlug) return true;
  if (!systemAccessService?.hasModuleAccess) return true;
  return systemAccessService.hasModuleAccess(moduleSlug, state.license);
}

function permissionForScreen(screen) {
  if (screen === "pdv") return "pdv_access";
  if (screen === "products") return "estoque_access";
  if (["finance", "finance-income", "finance-expenses", "accounts-payable", "accounts-receivable", "reports"].includes(screen)) return "financeiro_access";
  if (screen === "settings") return "config_access";
  return "";
}

function notifyEvent(event, message, type = "info") {
  const enabled = state.settings.notifications?.[event] !== false;
  if (enabled) showToast(message, type);
}

function activeUserCount() {
  const identities = new Set();
  state.settings.users
    .filter((user) => user.active !== false)
    .forEach((user) => {
      const identity = normalizeText(user.id || user.email || user.username || user.name);
      if (identity) identities.add(identity.toLowerCase());
    });
  return identities.size;
}

async function refreshLicenseForLimitCheck() {
  if (!systemAccessService?.validateSystemAccess) return state.license;
  try {
    await validateSystemAccess(false);
  } catch {
    // Mantem a ultima licenca carregada; o servidor local ainda valida ao salvar.
  }
  return state.license;
}

async function validateTwoFactorIfNeeded(user = null) {
  if (!state.settings.security?.twoFactorEnabled) return true;
  if (!state.settings.security?.totpSecret) {
    notifyEvent("error", "2FA habilitado sem chave configurada. Reconfigure a seguranca.", "error");
    return false;
  }
  const result = await promptFields("Verificacao em duas etapas", [
    { name: "code", label: "Codigo do autenticador", required: true },
  ], { confirmText: "Validar" });
  if (await verifyTotpCode(state.settings.security.totpSecret, result?.code)) return true;
  notifyEvent("error", `Codigo 2FA invalido para ${user?.email || user?.username || "este usuario"}.`, "error");
  return false;
}

async function createUser() {
  if (localDatabaseService?.listUsers && hasLocalApiSession()) {
    await refreshUsersFromApi();
  }
  const latestLicense = await refreshLicenseForLimitCheck();
  const userLimit = Number(latestLicense?.limits?.users || 0);
  const activeUsers = activeUserCount();
  if (userLimit > 0 && activeUsers >= userLimit) {
    showToast(`Licenca nao permitida. Limite atual: ${userLimit} usuario${userLimit === 1 ? "" : "s"}.`, "error");
    return;
  }
  const result = await promptFields("Novo usuario", [
    { name: "name", label: "Nome", required: true },
    { name: "username", label: "Usuario", required: true },
    { name: "password", label: "Senha", type: "password", required: true },
    { name: "role", label: "Perfil (Administrador, Usuario, Vendedor ou Gerente)", value: "Usuario", required: true },
    { name: "commissionPercent", label: "Comissao individual (%)", type: "number", value: "", min: "0" },
    { name: "discountLimitPercent", label: "Desconto maximo individual (%)", type: "number", value: "", min: "0" },
    { name: "monthlyGoal", label: "Meta mensal do vendedor (R$)", type: "number", value: "0", min: "0" },
  ], { confirmText: "Criar usuario" });
  if (!result) return;
  const username = normalizeText(result.username);
  if (state.settings.users.some((user) => user.username === username)) {
    notifyEvent("error", "Ja existe usuario com esse login.", "error");
    return;
  }
  const role = normalizeAppRole(result.role, "Funcionario");
  const commissionPercent = normalizeText(result.commissionPercent);
  const discountLimitPercent = normalizeText(result.discountLimitPercent);
  const user = {
    id: makeId("usr"),
    name: normalizeText(result.name),
    username,
    email: username.includes("@") ? username : "",
    passwordHash: simpleHash(result.password),
    role,
    commissionPercent: commissionPercent === "" ? "" : Math.max(0, Math.min(100, toNumber(commissionPercent))),
    discountLimitPercent: discountLimitPercent === "" ? "" : Math.max(0, Math.min(100, toNumber(discountLimitPercent))),
    monthlyGoal: Math.max(0, toNumber(result.monthlyGoal)),
    permissions: { ...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Funcionario) },
    active: true,
  };
  if (localDatabaseService?.createUser && hasLocalApiSession()) {
    try {
      const response = await localDatabaseService.createUser({
        id: user.id,
        nome: user.name,
        usuario: user.username,
        email: user.email || user.username,
        password: result.password,
        role: role === "Administrador" ? "admin" : role === "Gerente" ? "gerente" : role === "Vendedor" ? "vendedor" : "operador",
        perfil: role,
        saasClientId: state.license?.clientId || window.MPTECH_SAAS_CLIENT_ID || null,
        permissions: user.permissions,
        commissionPercent: user.commissionPercent,
        discountLimitPercent: user.discountLimitPercent,
        monthlyGoal: user.monthlyGoal,
      });
      if (response?.ok === false) {
        showToast(response.message || "Nao foi possivel criar usuario.", "error");
        return;
      }
    } catch (error) {
      showToast(error.message || "API local indisponivel para criar usuario.", "error");
      return;
    }
  }
  state.settings.users.push(user);
  saveSettings();
  renderSettings();
  showToast("Usuario criado.", "success");
}

async function editUser(userId) {
  const user = state.settings.users.find((item) => item.id === userId);
  if (!user) return;
  const result = await promptFields("Editar usuario", [
    { name: "name", label: "Nome", value: user.name, required: true },
    { name: "username", label: "Usuario", value: user.username, required: true },
    { name: "password", label: "Nova senha (opcional)", type: "password" },
    { name: "role", label: "Perfil (Administrador, Usuario, Vendedor ou Gerente)", value: user.role, required: true },
    { name: "commissionPercent", label: "Comissao individual (%)", type: "number", value: user.commissionPercent ?? "", min: "0" },
    { name: "discountLimitPercent", label: "Desconto maximo individual (%)", type: "number", value: user.discountLimitPercent ?? "", min: "0" },
    { name: "monthlyGoal", label: "Meta mensal do vendedor (R$)", type: "number", value: user.monthlyGoal ?? 0, min: "0" },
  ], { confirmText: "Salvar usuario" });
  if (!result) return;
  const username = normalizeText(result.username);
  if (state.settings.users.some((item) => item.username === username && item.id !== user.id)) {
    notifyEvent("error", "Ja existe usuario com esse login.", "error");
    return;
  }
  const nextName = normalizeText(result.name);
  const nextRole = normalizeAppRole(result.role, user.role);
  const commissionPercent = normalizeText(result.commissionPercent);
  const nextCommissionPercent = commissionPercent === "" ? "" : Math.max(0, Math.min(100, toNumber(commissionPercent)));
  const discountLimitPercent = normalizeText(result.discountLimitPercent);
  const nextDiscountLimitPercent = discountLimitPercent === "" ? "" : Math.max(0, Math.min(100, toNumber(discountLimitPercent)));
  const nextMonthlyGoal = Math.max(0, toNumber(result.monthlyGoal));
  const nextPermissions = { ...(ROLE_PERMISSIONS[nextRole] || ROLE_PERMISSIONS.Funcionario), ...(user.permissions || {}) };
  if (localDatabaseService?.updateUser && hasLocalApiSession()) {
    try {
      const response = await localDatabaseService.updateUser(user.id, {
        nome: nextName,
        usuario: username,
        email: username.includes("@") ? username : user.email || username,
        password: result.password || "",
        role: nextRole === "Administrador" ? "admin" : nextRole === "Gerente" ? "gerente" : nextRole === "Vendedor" ? "vendedor" : "operador",
        perfil: nextRole,
        saasClientId: state.license?.clientId || window.MPTECH_SAAS_CLIENT_ID || null,
        permissions: nextPermissions,
        commissionPercent: nextCommissionPercent,
        discountLimitPercent: nextDiscountLimitPercent,
        monthlyGoal: nextMonthlyGoal,
      });
      if (response?.ok === false) {
        showToast(response.message || "Nao foi possivel atualizar usuario no banco.", "error");
        return;
      }
    } catch (error) {
      showToast(error.message || "API local indisponivel para atualizar usuario.", "error");
      return;
    }
  }
  user.name = nextName;
  user.username = username;
  user.email = username.includes("@") ? username : user.email || "";
  user.role = nextRole;
  user.commissionPercent = nextCommissionPercent;
  user.discountLimitPercent = nextDiscountLimitPercent;
  user.monthlyGoal = nextMonthlyGoal;
  user.permissions = nextPermissions;
  if (result.password) user.passwordHash = simpleHash(result.password);
  saveSettings();
  renderSettings();
  showToast("Usuario atualizado.", "success");
}

async function deleteUser(userId) {
  const user = state.settings.users.find((item) => item.id === userId);
  if (!user || user.username === "admin") return;
  const confirmed = await confirmAction("Excluir usuario", `Excluir o usuario ${user.name}?`, { danger: true, confirmText: "Excluir" });
  if (!confirmed) return;
  state.settings.users = state.settings.users.filter((item) => item.id !== userId);
  saveSettings();
  renderSettings();
  showToast("Usuario excluido.", "success");
}

function listUsers() {
  return state.settings.users;
}

function sameDay(dateText, isoDay) {
  return new Date(dateText).toISOString().slice(0, 10) === isoDay;
}

function handleDbError(error, context) {
  if (!error) return;
  state.dbStatus = "error";
  state.dbMessage = error.message || "Falha desconhecida na conexao com o Supabase.";
  const status = Number(error.status || error.code || 0);
  if ([400, 401, 403].includes(status)) state.dbSyncPaused = true;
  const key = `${context}:${status || state.dbMessage}`;
  if (!state.dbErrorNotified[key]) {
    state.dbErrorNotified[key] = true;
    if (!isProduction()) console.error(context, error);
    showToast(`${context}. Uso local mantido.`, "error");
  }
  renderSettings();
}

function markDbAvailable(message = "Banco local conectado.") {
  state.dbStatus = "connected";
  state.dbMessage = message;
  state.dbSyncPaused = false;
  state.dbErrorNotified = {};
  state.lastSyncAt = new Date().toISOString();
  updateDbConnectionIndicator();
  flushOfflineQueue();
}

function markDbUnavailable(message = "PostgreSQL local indisponivel. O sistema esta usando localStorage.") {
  state.dbStatus = "local";
  state.dbMessage = isProduction()
    ? `${message} Em producao, novas vendas ficam bloqueadas ate o PostgreSQL local voltar ou a contingencia auditavel ser autorizada.`
    : message;
  updateDbConnectionIndicator();
}

function updateDbConnectionIndicator() {
  const indicator = $("#db-connection-indicator");
  if (!indicator) return;
  const connected = state.localDbAvailable === true || state.dbStatus === "connected";
  indicator.classList.toggle("connected", connected);
  indicator.classList.toggle("offline", !connected);
  const label = connected ? "Banco conectado" : isProduction() ? "Banco offline - vendas bloqueadas" : "Banco offline";
  const queueCount = state.data.syncQueue?.length || 0;
  indicator.title = queueCount ? `${label} | ${queueCount} item(ns) pendente(s)` : label;
  indicator.setAttribute("aria-label", label);
}

function productionSaleBackendBlockReason() {
  if (!localDatabaseService?.registrarVenda) {
    return "API local do PDV nao carregou. Abra o MPTech Gestao pelo atalho e aguarde a inicializacao.";
  }
  if (!hasLocalApiSession()) {
    return "sessao local expirada. Entre novamente antes de finalizar a venda.";
  }
  return "";
}

function productionRequiresBackendForSale() {
  return isProduction() && Boolean(productionSaleBackendBlockReason());
}

function saleBackendProductLabel(productId) {
  const product = state.data.products.find((item) => item.id === productId || item.code === productId || item.name === productId);
  return product?.name ? `"${product.name}"` : productId;
}

function saleBackendErrorMessage(error) {
  const message = normalizeText(error?.message || error);
  const missingProduct = message.match(/^Produto (.+) nao encontrado para baixa de estoque\.$/i);
  if (missingProduct) {
    return `Produto ${saleBackendProductLabel(missingProduct[1])} nao foi encontrado no banco para baixa de estoque. Sincronize o cadastro de produtos e tente novamente.`;
  }
  const insufficientStock = message.match(/^Estoque insuficiente para o produto (.+)\.$/i);
  if (insufficientStock) {
    return `Estoque insuficiente para o produto ${saleBackendProductLabel(insufficientStock[1])}. Atualize o estoque e tente novamente.`;
  }
  if (/api local|sessao|token|postgresql|banco|database|timeout|demorou|indisponivel|nao configurad/i.test(message)) {
    return message;
  }
  return message || "baixa de estoque nao foi confirmada no banco local.";
}

async function refreshDataFromSupabase() {
  return validateSystemAccess(true);
}

async function testSupabaseConnection() {
  state.dbStatus = "checking";
  state.dbMessage = "Validando licenca SaaS e API local...";
  renderSettings();
  await Promise.all([validateSystemAccess(false), testLocalDatabaseConnection()]);
  if (state.license?.allowed === false) {
    markDbUnavailable(state.license.message);
  } else if (state.localDbAvailable) {
    markDbAvailable("Licenca validada e PostgreSQL local disponivel.");
  } else {
    markDbUnavailable("Licenca liberada. PostgreSQL local indisponivel; usando localStorage.");
  }
  renderSettings();
}

async function testLocalDatabaseConnection() {
  if (!localDatabaseService) {
    state.localDbAvailable = false;
    return false;
  }
  try {
    const result = await localDatabaseService.health();
    state.localDbAvailable = Boolean(result?.configured);
    return state.localDbAvailable;
  } catch {
    state.localDbAvailable = false;
    return false;
  }
}

function snapshotHasBusinessData(snapshot = {}) {
  const counts = snapshot.counts || {};
  return [
    "products",
    "clients",
    "sales",
    "expenses",
    "accountsPayable",
    "accountsReceivable",
    "cashSessions",
    "stockMovements",
    "serviceRecords",
  ].some((key) => Number(counts[key] || snapshot.data?.[key]?.length || 0) > 0);
}

async function hydrateDataFromLocalApi() {
  if (!localDatabaseService?.snapshot || !hasLocalApiSession()) return false;
  try {
    const response = await localDatabaseService.snapshot();
    const snapshot = response?.data || response;
    const remoteData = snapshot?.data;
    const hasRemoteData = snapshotHasBusinessData(snapshot);
    if (remoteData && hasRemoteData) {
      const pendingQueue = state.data.syncQueue || [];
      state.data = normalizeData({ ...emptyData(), ...remoteData, syncQueue: pendingQueue });
      writeDataToLocalStorage("snapshot local", { preferCompact: true });
      persistSyncQueue();
    }
    if (snapshot?.settings) {
      state.settings = mergeSettings({ ...state.settings, ...snapshot.settings });
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      applyRuntimeSettings();
    }
    state.localDbAvailable = true;
    state.lastSyncAt = new Date().toISOString();
    markDbAvailable(hasRemoteData ? "Dados carregados do PostgreSQL local." : "PostgreSQL local conectado.");
    return true;
  } catch {
    state.localDbAvailable = false;
    return false;
  }
}

function persistSyncQueue() {
  state.data.syncQueue = (state.data.syncQueue || []).slice(-LOCAL_STORAGE_LIMITS.syncQueue);
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(state.data.syncQueue));
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    state.data.syncQueue = state.data.syncQueue.slice(-LOCAL_STORAGE_EMERGENCY_LIMITS.syncQueue);
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(state.data.syncQueue));
      notifyStorageQuotaCompaction();
    } catch (finalError) {
      console.error("Nao foi possivel persistir a fila offline.", finalError);
      state.data.syncQueue = [];
      localStorage.removeItem(SYNC_QUEUE_KEY);
      showToast("Fila offline limpa por falta de espaco local. Dados principais continuam em memoria.", "error");
    }
  }
  updateDbConnectionIndicator();
}

function queueOfflineSync(resource, payload) {
  if (!payload) return;
  const key = `${resource}:${payload.id || payload.sessionId || JSON.stringify(payload).slice(0, 80)}`;
  state.data.syncQueue = state.data.syncQueue || [];
  const item = {
    id: key,
    resource,
    payload,
    createdAt: new Date().toISOString(),
    tries: 0,
  };
  const currentIndex = state.data.syncQueue.findIndex((queued) => queued.id === key);
  if (currentIndex >= 0) state.data.syncQueue[currentIndex] = { ...state.data.syncQueue[currentIndex], ...item };
  else state.data.syncQueue.push(item);
  state.data.syncQueue = state.data.syncQueue.slice(-LOCAL_STORAGE_LIMITS.syncQueue);
  persistSyncQueue();
}

async function flushOfflineQueue() {
  if (!localDatabaseService || !state.data.syncQueue?.length || !hasLocalApiSession()) return;
  const pending = [...state.data.syncQueue];
  const synced = new Set();
  for (const item of pending) {
    try {
      await localDatabaseService.upsert(item.resource, item.payload);
      synced.add(item.id);
    } catch {
      item.tries = Number(item.tries || 0) + 1;
      state.localDbAvailable = false;
      break;
    }
  }
  if (synced.size) {
    state.data.syncQueue = state.data.syncQueue.filter((item) => !synced.has(item.id));
    state.lastSyncAt = new Date().toISOString();
    persistSyncQueue();
  }
}

async function syncLocalResource(resource, payload) {
  if (!localDatabaseService) return;
  if (!hasLocalApiSession()) {
    state.localDbAvailable = false;
    queueOfflineSync(resource, payload);
    return;
  }
  try {
    await localDatabaseService.upsert(resource, payload);
    state.localDbAvailable = true;
    state.lastSyncAt = new Date().toISOString();
  } catch {
    state.localDbAvailable = false;
    queueOfflineSync(resource, payload);
  }
}

async function syncProduct(product) {
  return syncLocalResource("produtos", product);
}

async function syncClient(client) {
  return syncLocalResource("clientes", client);
}

async function syncInBatches(records, handler, concurrency = 10) {
  const queue = [...records];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const record = queue.shift();
      await handler(record);
    }
  });
  await Promise.allSettled(workers);
}

async function syncImportedRecords(resource, records, fallbackHandler) {
  if (localDatabaseService?.bulkUpsert && hasLocalApiSession()) {
    try {
      await localDatabaseService.bulkUpsert(resource, records);
      state.localDbAvailable = true;
      state.lastSyncAt = new Date().toISOString();
      return;
    } catch {
      state.localDbAvailable = false;
    }
  }
  await syncInBatches(records, fallbackHandler);
}

async function syncExpense(expense) {
  return syncLocalResource("financeiro", { ...expense, type: "expense" });
}

async function syncPayable(account) {
  return syncLocalResource("financeiro", { ...account, type: "payable" });
}

async function syncReceivable(account) {
  return syncLocalResource("financeiro", { ...account, type: "receivable" });
}

async function syncCashSession(session) {
  return syncLocalResource("caixa", session);
}

async function syncCashMovement(sessionId, movement) {
  return syncLocalResource("caixa", { id: movement.id, sessionId, movement });
}

async function syncStockMovement(movement) {
  return syncLocalResource("produtos", { id: movement.id, stockMovement: movement });
}

async function syncSale(sale) {
  return syncLocalResource("vendas", sale);
}

async function syncAudit(action, detail = "") {
  return syncLocalResource("financeiro", { id: makeId("audit"), type: "audit", action, detail, date: new Date().toISOString() });
}

async function syncSettings() {
  if (localDatabaseService?.saveSettings && hasLocalApiSession()) {
    try {
      await localDatabaseService.saveSettings(state.settings);
      return;
    } catch {
      state.localDbAvailable = false;
    }
  }
  return syncLocalResource("financeiro", { id: "configuracoes_loja", type: "settings", settings: state.settings });
}

function licenseStatusLabel(status) {
  return {
    active: "ativo",
    trial: "teste",
    expired: "vencido",
    blocked: "bloqueado",
    cancelled: "cancelado",
    offline_grace: "tolerancia offline",
    offline_without_cache: "offline sem cache",
    offline_expired: "cache expirado",
  }[status] || status || "indefinido";
}

function isTrialLikeLicense(status, plan = "") {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedPlan = String(plan || "").trim().toLowerCase();
  return ["trial", "teste"].includes(normalizedStatus) || /teste|trial/.test(normalizedPlan);
}

function nonEmptySaasValue(value) {
  const text = normalizeText(value);
  return text || "";
}

function syncStoreFromSaasLicense(license = {}) {
  const saasStore = license.store || {};
  const hasSaasStore = saasStore.source === "saas"
    || saasStore.saasClientId
    || saasStore.storeName
    || saasStore.name
    || saasStore.cnpj
    || saasStore.document
    || saasStore.email
    || saasStore.phone
    || saasStore.address
    || saasStore.city
    || saasStore.state
    || saasStore.instagram;
  if (!hasSaasStore) return false;

  const before = JSON.stringify({
    store: state.settings.store,
    companyName: state.settings.companyName,
  });
  const nextStore = {
    ...(state.settings.store || {}),
    source: "saas",
    saasClientId: license.clientId || saasStore.saasClientId || state.settings.store?.saasClientId || "",
    externalClientId: license.externalClientId || saasStore.externalClientId || state.settings.store?.externalClientId || "",
  };
  const storeName = nonEmptySaasValue(saasStore.storeName || saasStore.name);
  const documentValue = nonEmptySaasValue(saasStore.cnpj || saasStore.document);
  const fields = {
    legalName: saasStore.legalName,
    address: saasStore.address,
    city: saasStore.city,
    state: saasStore.state,
    phone: saasStore.phone,
    email: saasStore.email,
    neighborhood: saasStore.neighborhood,
    zipCode: saasStore.zipCode,
    instagram: saasStore.instagram,
    defaultMessage: saasStore.defaultMessage,
    receiptFooter: saasStore.receiptFooter,
  };

  if (storeName) {
    nextStore.storeName = storeName;
    nextStore.name = storeName;
    state.settings.companyName = storeName;
  }
  if (documentValue) {
    nextStore.cnpj = documentValue;
    nextStore.document = documentValue;
  }
  Object.entries(fields).forEach(([key, value]) => {
    const normalized = nonEmptySaasValue(value);
    if (normalized) nextStore[key] = normalized;
  });

  state.settings.store = nextStore;
  return before !== JSON.stringify({
    store: state.settings.store,
    companyName: state.settings.companyName,
  });
}

function isStoreControlledBySaas() {
  return state.settings.store?.source === "saas" || Boolean(state.license?.store);
}

function syncTenantFromLicense(license = {}) {
  if (!license) return;
  const before = JSON.stringify(state.settings.tenant || {});
  const statusLabel = licenseStatusLabel(license.status);
  const plan = license.plan || state.settings.tenant?.plan || "";
  const trialEndsAt = license.trialEndsAt || (isTrialLikeLicense(license.status || statusLabel, plan) ? license.expiresAt || "" : "");
  state.settings.tenant = {
    ...(state.settings.tenant || {}),
    tenantId: license.clientId || state.settings.tenant?.tenantId || "",
    licenseStatus: statusLabel,
    plan,
    trialEndsAt,
    expiresAt: license.expiresAt || "",
  };
  const tenantChanged = before !== JSON.stringify(state.settings.tenant || {});
  const storeChanged = syncStoreFromSaasLicense(license);
  return tenantChanged || storeChanged;
}

function currentSaasClientId() {
  const config = saasLicenseService?.readConfig ? saasLicenseService.readConfig() : {};
  const session = currentSession();
  return nonEmptySaasValue(
    session.saasClientId ||
    state.license?.clientId ||
    state.settings.store?.saasClientId ||
    state.settings.store?.externalClientId ||
    window.MPTECH_SAAS_CLIENT_ID ||
    localStorage.getItem("mptech_saas_client_id") ||
    config.clientId ||
    state.settings.tenant?.tenantId
  );
}

function formatDateTime(value) {
  if (!value) return "Nao executado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR");
}

function formatDateOnly(value, fallback = "Nao informado") {
  const text = normalizeText(value);
  if (!text) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString("pt-BR");
}

function formatInterval(ms) {
  const minutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  return `${minutes}min`;
}

function saasDetailValue(value, fallback = "Nao informado") {
  const text = normalizeText(value);
  return text || fallback;
}

function renderSaasSyncDetailPanel(title, rows) {
  return `
    <section class="saas-sync-detail-panel">
      <h4>${escapeHtml(title)}</h4>
      <dl>
        ${rows.map((row) => `
          <div>
            <dt>${escapeHtml(row.label)}</dt>
            <dd>${escapeHtml(saasDetailValue(row.value, row.fallback))}</dd>
          </div>
        `).join("")}
      </dl>
    </section>
  `;
}

function renderSaasSyncStatus() {
  const sync = state.lastSaasSync;
  if (!sync) {
    return `
      <div class="settings-note saas-sync-status">
        <strong>Sincronizacao manual</strong>
        <p>Use o botao para buscar no Supabase os dados alterados no portal SaaS e aplicar cadastro da loja, licenca, plano, modulos e configuracoes no sistema local.</p>
      </div>
    `;
  }

  const validations = sync.validation?.validations || [];
  const details = sync.validation?.details || {};
  const detailsStore = sync.store || details.store || {};
  const detailsLicense = sync.license || {};
  const licenseRecord = details.licenseRecord || {};
  const detailModules = Array.isArray(details.modules) ? details.modules : (Array.isArray(detailsLicense.modules) ? detailsLicense.modules : []);
  const detailConfigKeys = Array.isArray(details.configKeys) ? details.configKeys : [];
  const trialEndsAt = details.trialEndsAt || detailsLicense.trialEndsAt || state.settings.tenant?.trialEndsAt || "";
  const expiresAt = details.expiresAt || detailsLicense.expiresAt || state.settings.tenant?.expiresAt || "";
  const daysRemaining = detailsLicense.daysRemaining ?? details.daysRemaining ?? "";
  const licenseDetails = renderSaasSyncDetailPanel("Licenca e plano", [
    { label: "Status aplicado", value: licenseStatusLabel(details.status || detailsLicense.status || state.settings.tenant?.licenseStatus) },
    { label: "Plano", value: details.plan || detailsLicense.plan || state.settings.tenant?.plan },
    { label: "Fim do teste", value: trialEndsAt ? formatDateOnly(trialEndsAt) : "Nao aplicavel" },
    { label: "Vencimento", value: expiresAt ? formatDateOnly(expiresAt) : "" },
    { label: "Dias restantes", value: daysRemaining === "" ? "" : String(daysRemaining) },
    { label: "Tipo no banco", value: licenseRecord.tipo || licenseRecord.tipoLicenca },
    { label: "Status no banco", value: licenseRecord.status || licenseRecord.statusLicenca },
    { label: "Inicio no banco", value: licenseRecord.dataInicio ? formatDateOnly(licenseRecord.dataInicio) : "" },
  ]);
  const storeDetails = renderSaasSyncDetailPanel("Dados da loja sincronizados", [
    { label: "Nome", value: detailsStore.storeName || detailsStore.name },
    { label: "CNPJ / CPF", value: detailsStore.cnpj || detailsStore.document },
    { label: "Endereco", value: detailsStore.address },
    { label: "Cidade / UF", value: [detailsStore.city, detailsStore.state].filter(Boolean).join(" / ") },
    { label: "Telefone / WhatsApp", value: detailsStore.phone },
    { label: "Email", value: detailsStore.email },
    { label: "Instagram", value: detailsStore.instagram },
    { label: "Rodape recibo", value: detailsStore.receiptFooter },
  ]);
  const integrationDetails = renderSaasSyncDetailPanel("Modulos e configuracoes", [
    { label: "Modulos aplicados", value: detailModules.length ? detailModules.join(", ") : "Padrao local" },
    { label: "Configuracoes recebidas", value: detailConfigKeys.length ? detailConfigKeys.join(", ") : "Nenhuma configuracao adicional" },
    { label: "Cliente solicitado", value: details.requestedClientId || sync.requestedClientId },
    { label: "Cliente resolvido", value: details.resolvedClientId || sync.clientId },
  ]);
  const auto = sync.automaticDatabaseUpdates || {};
  const visibleClientId = sync.externalClientId || sync.clientId || currentSaasClientId() || "-";
  const resolvedClientId = sync.clientId && sync.externalClientId && sync.clientId !== sync.externalClientId ? sync.clientId : "";
  const autoLabel = auto.enabled
    ? `Ativa a cada ${formatInterval(auto.intervalMs)}${auto.nextRunAt ? ` | proxima: ${formatDateTime(auto.nextRunAt)}` : ""}`
    : "Atualizacao automatica inativa ou nao iniciada";
  const validationCards = validations.length
    ? validations.map((item) => `
      <article class="saas-sync-validation-item ${item.ok ? "ok" : "warn"}">
        <div>
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.message || "")}</span>
        </div>
        ${settingBadge(item.ok ? "OK" : "Verificar", item.ok ? "normal" : "critico")}
      </article>
    `).join("")
    : `<article class="saas-sync-validation-item warn"><div><strong>Validacao</strong><span>Nenhum detalhe retornado pela API local.</span></div>${settingBadge("Verificar", "critico")}</article>`;

  return `
    <div class="saas-sync-report">
      <div class="saas-sync-summary">
        <article><span>Ultima sincronizacao</span><strong>${escapeHtml(formatDateTime(sync.syncedAt))}</strong></article>
        <article><span>Cliente SaaS</span><strong>${escapeHtml(visibleClientId)}</strong></article>
        ${resolvedClientId ? `<article><span>ID interno</span><strong>${escapeHtml(resolvedClientId)}</strong></article>` : ""}
        <article><span>Cache local</span><strong>${settingBadge(sync.cache?.updated ? "Atualizado" : "Nao atualizado", sync.cache?.updated ? "normal" : "critico")}</strong></article>
        <article><span>Atualizacao automatica</span><strong>${auto.enabled ? settingBadge(auto.running ? "Rodando" : "Ativa") : settingBadge("Inativa", "critico")}</strong></article>
      </div>
      <div class="settings-note">
        <strong>Status da sincronizacao</strong>
        <p>${escapeHtml(sync.message || (sync.ok ? "Dados recebidos do Supabase." : "Nao foi possivel concluir a sincronizacao."))}</p>
        <p>${escapeHtml(autoLabel)}</p>
      </div>
      <div class="saas-sync-validation-grid">
        ${validationCards}
      </div>
      <div class="saas-sync-details">
        ${licenseDetails}
        ${storeDetails}
        ${integrationDetails}
      </div>
    </div>
  `;
}

async function syncSaasClientFromSettings() {
  if (!requirePermission("config_access", "sincronizar dados do SaaS")) return;
  if (!localDatabaseService?.syncSaasClient) {
    showToast("API local nao possui sincronizacao SaaS manual.", "error");
    return;
  }

  const clientId = currentSaasClientId();
  if (!clientId) {
    state.lastSaasSync = {
      ok: false,
      syncedAt: new Date().toISOString(),
      message: "Cliente SaaS nao identificado. Faca login novamente ou configure SAAS_CLIENT_ID no servidor local.",
      validation: {
        validations: [{ key: "cliente", label: "Cliente SaaS", ok: false, value: "", message: "ID do cliente ausente." }],
      },
    };
    renderSettings();
    showToast("Cliente SaaS nao identificado.", "error");
    return;
  }

  showToast("Sincronizando dados do portal SaaS...", "info");
  try {
    const session = currentSession();
    const store = state.settings.store || {};
    const response = await localDatabaseService.syncSaasClient(clientId, {
      email: session.email || session.user || store.email || "",
      storeEmail: store.email || "",
      document: store.cnpj || store.document || "",
    });
    const sync = response?.data || response || {};
    state.lastSaasSync = {
      ...sync,
      syncedAt: sync.syncedAt || new Date().toISOString(),
    };
    if (sync.license) {
      state.license = sync.license;
      window.MPTechCurrentLicense = sync.license;
      licenseCacheService?.saveCache?.(sync.license);
      const settingsChanged = syncTenantFromLicense(sync.license);
      if (settingsChanged) saveSettings();
      applyAccessControls();
    }
    if (sync.ok) {
      state.localDbAvailable = sync.cache?.updated !== false;
      state.dbStatus = state.localDbAvailable ? "connected" : state.dbStatus;
      state.dbMessage = sync.message || "Dados SaaS sincronizados.";
      updateDbConnectionIndicator();
      renderSettings();
      showToast(sync.licenseAllowed === false ? "Sincronizacao concluida, mas a licenca nao esta liberada." : "Dados do SaaS sincronizados.", sync.licenseAllowed === false ? "info" : "success");
      return;
    }
    state.dbStatus = "error";
    state.dbMessage = sync.message || response?.message || "Falha na sincronizacao SaaS.";
    updateDbConnectionIndicator();
    renderSettings();
    showToast(state.dbMessage, "error");
  } catch (error) {
    state.lastSaasSync = {
      ok: false,
      syncedAt: new Date().toISOString(),
      message: error.message || "Nao foi possivel sincronizar os dados do SaaS.",
      validation: {
        validations: [{ key: "api", label: "API local", ok: false, value: "", message: error.message || "Falha de comunicacao." }],
      },
    };
    state.dbStatus = "error";
    state.dbMessage = state.lastSaasSync.message;
    updateDbConnectionIndicator();
    renderSettings();
    showToast(state.lastSaasSync.message, "error");
  }
}

async function validateSystemAccess(showBlockedScreen = true) {
  if (!systemAccessService?.validateSystemAccess) {
    state.license = {
      allowed: true,
      status: "offline_grace",
      message: "Validacao SaaS indisponivel. Sistema liberado em modo local.",
      modules: ["dashboard", "pdv", "produtos", "financeiro", "vendas", "relatorios", "clientes", "configuracoes", "backup", "multiusuario"],
      limits: { users: 0, products: 0, salesPerMonth: 0 },
      offlineUntil: null,
    };
  } else {
    state.license = await systemAccessService.validateSystemAccess();
  }
  const settingsChanged = syncTenantFromLicense(state.license);
  if (settingsChanged) saveSettings();
  window.MPTechCurrentLicense = state.license;
  if (state.license.allowed === false && showBlockedScreen) {
    window.LicenseBlockedScreen?.show(state.license, () => validateSystemAccess(true));
  } else {
    window.LicenseBlockedScreen?.hide();
  }
  applyAccessControls();
  renderSettings();
  return state.license;
}

function screenMeta(screen) {
  return {
    dashboard: ["Dashboard", "Visão geral da sua empresa"],
    pdv: ["PDV", "Ponto de venda"],
    products: ["Estoque", "Controle de produtos e estoque"],
    finance: ["Financeiro", "Visão geral financeira"],
    "finance-income": ["Entradas", "Receitas e vendas recebidas"],
    "finance-expenses": ["Saídas", "Despesas e pagamentos"],
    "accounts-payable": ["Contas a Pagar", "Obrigações financeiras"],
    "accounts-receivable": ["Contas a Receber", "Valores pendentes de recebimento"],
    sales: ["Vendas", "Histórico de vendas realizadas"],
    reports: ["Relatórios", "Resumo gerencial e exportação"],
    clients: ["Clientes", "Cadastro e relacionamento"],
    settings: ["Configurações", "Gerencie preferências do sistema e da loja"],
  }[screen];
}

async function showApp() {
  $("#login-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  restoreSidebarState();
  if (state.pdvLocked) state.activeScreen = "pdv";
  applySettings();
  await hydrateDataFromLocalApi();
  validateSystemAccess(true);
  refreshUsersFromApi();
  if (state.settings.pdv?.autoOpenCash && !currentCashSession() && hasPermission("pdv_access")) {
    const session = {
      id: makeId("cash-session"),
      openedAt: new Date().toISOString(),
      openingValue: 0,
      movements: [],
      closedAt: null,
      closingValue: null,
    };
    state.data.cashSessions.unshift(session);
    syncCashSession(session);
    saveDataWithAudit("Caixa aberto automaticamente", "Configuração do PDV");
  }
  runAutomaticBackup();
  renderAll();
  applyPdvLockMode();
  testSupabaseConnection();
}

function showLogin() {
  $("#login-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
}

function switchScreen(screen) {
  if (state.pdvLocked && screen !== "pdv") {
    showToast("Modo venda ativo. Desbloqueie com senha de administrador para acessar a gestao.", "error");
    return;
  }
  const permission = permissionForScreen(screen);
  if (permission && !hasPermission(permission)) {
    notifyEvent("error", "Acesso bloqueado para este usuario.", "error");
    return;
  }
  if (!hasModuleAccess(moduleForScreen(screen))) {
    notifyEvent("error", "Modulo nao liberado no plano atual.", "error");
    return;
  }
  if (isLicenseBlockedFor(screen)) {
    notifyEvent("error", "Licenca vencida ou bloqueada para este modulo.", "error");
    return;
  }
  state.activeScreen = screen;
  if (["finance", "finance-income", "finance-expenses", "accounts-payable", "accounts-receivable"].includes(screen)) {
    state.financeMenuOpen = true;
  }
  $$(".screen").forEach((item) => item.classList.toggle("active", item.id === screen));
  $$(".nav-link").forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  $$(".nav-sublink").forEach((item) => item.classList.toggle("active", item.dataset.screen === screen));
  updateFinanceMenu();
  const [title, subtitle] = screenMeta(screen);
  $("#screen-title").textContent = title;
  $("#screen-subtitle").textContent = subtitle;
  $("#app-shell").classList.remove("mobile-menu-open");
  renderAll();
}

function updateFinanceMenu() {
  const group = $(".nav-group");
  const parent = $(".nav-parent");
  if (!group || !parent) return;
  const isFinanceScreen = ["finance", "finance-income", "finance-expenses", "accounts-payable", "accounts-receivable"].includes(state.activeScreen);
  group.classList.toggle("open", state.financeMenuOpen);
  parent.classList.toggle("active", isFinanceScreen);
  parent.setAttribute("aria-expanded", state.financeMenuOpen ? "true" : "false");
}

function headerNotificationItems() {
  const items = [];
  try {
    const lowStock = lowStockProducts();
    if (lowStock.length) {
      items.push({
        title: "Estoque baixo",
        detail: `${lowStock.length} produto(s) precisam de reposicao.`,
        screen: "products",
      });
    }
    const payableAlertDays = Number(state.settings.finance?.payableAlertDays ?? 3);
    const receivableAlertDays = Number(state.settings.finance?.receivableAlertDays ?? 3);
    const duePayables = state.data.accountsPayable.filter((item) => item.status !== "Pago" && dateWithinDays(item.dueDate, payableAlertDays));
    if (duePayables.length) {
      items.push({
        title: "Contas a pagar",
        detail: `${duePayables.length} conta(s) vencidas ou vencendo.`,
        screen: "accounts-payable",
      });
    }
    const dueReceivables = state.data.accountsReceivable.filter((item) => item.status !== "Recebido" && dateWithinDays(item.dueDate, receivableAlertDays));
    if (dueReceivables.length) {
      items.push({
        title: "Contas a receber",
        detail: `${dueReceivables.length} conta(s) vencidas ou vencendo.`,
        screen: "accounts-receivable",
      });
    }
    if (state.dbStatus === "local" || state.dbStatus === "error") {
      items.push({
        title: "Banco local offline",
        detail: isProduction()
          ? "Vendas bloqueadas ate o PostgreSQL local voltar; nenhuma baixa sera concluida silenciosamente."
          : "Sistema usando fallback local ate a API local responder.",
        screen: "settings",
      });
    }
  } catch {
    return [];
  }
  return items;
}

function updateHeaderControls() {
  const isDark = state.settings.appearance?.theme === "Escuro";
  const darkButton = $("#theme-dark-toggle");
  const lightButton = $("#theme-light-toggle");
  if (darkButton) {
    darkButton.classList.toggle("active", isDark);
    darkButton.setAttribute("aria-pressed", isDark ? "true" : "false");
  }
  if (lightButton) {
    lightButton.classList.toggle("active", !isDark);
    lightButton.setAttribute("aria-pressed", !isDark ? "true" : "false");
  }

  const notifications = headerNotificationItems();
  const count = notifications.length;
  const button = $("#notification-button");
  const menu = $("#notification-menu");
  setText("#notification-count", String(count));
  if (button) {
    button.classList.toggle("empty", count === 0);
    button.setAttribute("aria-label", count ? `Abrir ${count} notificacao(oes)` : "Nenhuma notificacao");
  }
  if (menu) {
    menu.innerHTML = `
      <h3>Notificacoes</h3>
      ${count
        ? notifications.map((item) => `
          <button type="button" data-screen-jump="${escapeHtml(item.screen)}">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.detail)}</small>
          </button>
        `).join("")
        : `<div class="empty-notification">Nenhuma pendencia agora.</div>`}
    `;
  }
}

function setHeaderTheme(theme) {
  state.settings.appearance = {
    ...defaultSettings().appearance,
    ...(state.settings.appearance || {}),
    theme,
  };
  saveSettings();
  showToast(theme === "Escuro" ? "Tema escuro ativado." : "Tema claro ativado.", "success");
}

function toggleHeaderNotifications() {
  const menu = $("#notification-menu");
  const button = $("#notification-button");
  if (!menu || !button) return;
  updateHeaderControls();
  const nextOpen = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !nextOpen);
  button.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

function isMobileMenu() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function toggleSidebar() {
  const shell = $("#app-shell");
  if (isMobileMenu()) {
    shell.classList.toggle("mobile-menu-open");
    return;
  }
  shell.classList.toggle("sidebar-collapsed");
  localStorage.setItem("mptech_sidebar_collapsed", shell.classList.contains("sidebar-collapsed") ? "1" : "0");
}

function restoreSidebarState() {
  const shell = $("#app-shell");
  shell.classList.toggle("sidebar-collapsed", localStorage.getItem("mptech_sidebar_collapsed") === "1" && !isMobileMenu());
  shell.classList.remove("mobile-menu-open");
}

function updatePdvFullscreenButton() {
  const button = $("#pdv-fullscreen");
  if (!button) return;
  const active = document.fullscreenElement === $("#pdv");
  button.classList.toggle("active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
  const label = button.querySelector("b");
  if (label) label.textContent = active ? "Sair da tela cheia" : "Tela cheia";
}

async function togglePdvFullscreen() {
  const pdv = $("#pdv");
  if (!pdv || !document.fullscreenEnabled || !pdv.requestFullscreen) {
    showToast("Tela cheia nao suportada neste navegador.", "error");
    return;
  }
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await pdv.requestFullscreen();
    }
    updatePdvFullscreenButton();
  } catch {
    showToast("Nao foi possivel alternar para tela cheia.", "error");
  }
}

function renderAll() {
  renderActiveScreen();
}

function renderFullApp() {
  renderDashboard();
  renderPdvSummary();
  renderPdvSellerSelector();
  renderCategoryFilter();
  renderSearchResults();
  renderCart();
  renderProducts();
  renderFinance();
  renderCash();
  renderFinanceDetailScreens();
  renderAccounts();
  renderClients();
  renderReports();
  renderSettings();
  applySettings();
  applyRuntimeSettings();
}

function renderActiveScreen() {
  switch (state.activeScreen) {
    case "dashboard":
      renderDashboard();
      break;
    case "pdv":
      renderPdvSummary();
      renderPdvSellerSelector();
      renderCategoryFilter();
      renderSearchResults();
      renderCart();
      focusPdvSearch();
      break;
    case "products":
      renderProducts();
      break;
    case "finance":
      renderFinance();
      renderCash();
      break;
    case "finance-income":
    case "finance-expenses":
      renderFinanceDetailScreens();
      break;
    case "accounts-payable":
    case "accounts-receivable":
      renderAccounts();
      break;
    case "sales":
      renderSalesHistory();
      break;
    case "reports":
      renderReports();
      break;
    case "clients":
      renderClients();
      break;
    case "settings":
      renderSettings();
      break;
    default:
      renderDashboard();
  }
  applySettings();
  applyRuntimeSettings();
}

function salesTotal(list) {
  return list.filter((sale) => !sale.canceled).reduce((sum, sale) => sum + (sale.netTotal || sale.total), 0);
}

function expenseTotal(list) {
  return list.reduce((sum, expense) => sum + expense.value, 0);
}

function lowStockProducts() {
  return state.data.products.filter((product) => product.active !== false && product.stock <= product.minStock);
}

function productSoldQty(productId, days = 30) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  return state.data.sales
    .filter((sale) => !sale.canceled && new Date(sale.date) >= start)
    .reduce((sum, sale) => sum + sale.items
      .filter((item) => (item.productId || item.id) === productId)
      .reduce((inner, item) => inner + Number(item.qty || item.quantity || 1), 0), 0);
}

function restockSuggestion(product) {
  const dailyAverage = productSoldQty(product.id, 30) / 30;
  const safetyStock = Math.ceil(dailyAverage * 15);
  return Math.max(0, Math.ceil(toNumber(product.minStock) + safetyStock - toNumber(product.stock)));
}

function productStatus(product) {
  if (product.stock <= Math.max(1, Math.floor(product.minStock / 2))) return "Critico";
  if (product.stock <= product.minStock) return "Baixo";
  return "Normal";
}

function productStatusLabel(status) {
  return status === "Critico" ? "Crítico" : status;
}

function retailPrice(product = {}) {
  return toNumber(product.retailPrice ?? product.price);
}

function wholesalePrice(product = {}) {
  return toNumber(product.wholesalePrice ?? product.retailPrice ?? product.price);
}

function roundCurrency(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function productMargin(price, cost) {
  const value = toNumber(price);
  const baseCost = toNumber(cost);
  if (value <= 0) return 0;
  return ((value - baseCost) / value) * 100;
}

function cartItemQty(item = {}) {
  return Math.max(1, toNumber(item.qty, 1));
}

function itemEffectivePrice(item = {}) {
  const minQty = Math.max(1, toNumber(item.wholesaleMinQty || 1));
  const wholesale = toNumber(item.wholesalePrice || 0);
  if (wholesale > 0 && item.qty >= minQty) return wholesale;
  return toNumber(item.retailPrice ?? item.price);
}

function cartItemBasePrice(item = {}) {
  return roundCurrency(itemEffectivePrice({ ...item, qty: cartItemQty(item), price: item.retailPrice ?? item.basePrice ?? item.price }));
}

function syncCartItemPrice(item = {}) {
  const basePrice = cartItemBasePrice(item);
  const minQty = Math.max(1, toNumber(item.wholesaleMinQty || 1));
  const adjusted = item.priceAdjusted === true;
  const finalPrice = adjusted ? Math.max(0, roundCurrency(toNumber(item.finalUnitPrice ?? item.price, basePrice))) : basePrice;
  item.basePrice = basePrice;
  item.finalUnitPrice = finalPrice;
  item.price = finalPrice;
  item.priceType = basePrice === toNumber(item.wholesalePrice || 0) && cartItemQty(item) >= minQty ? "Atacado" : "Varejo";
  item.priceAdjusted = adjusted && Math.abs(finalPrice - basePrice) >= 0.005;
  item.itemAdjustment = roundCurrency((finalPrice - basePrice) * cartItemQty(item));
  return item;
}

function setCartItemFinalPrice(item, value) {
  const basePrice = cartItemBasePrice(item);
  const finalPrice = Math.max(0, roundCurrency(toNumber(value, basePrice)));
  item.finalUnitPrice = finalPrice;
  item.priceAdjusted = Math.abs(finalPrice - basePrice) >= 0.005;
  syncCartItemPrice(item);
}

function applyPendingCartFinalPrice() {
  const input = document.activeElement;
  const itemId = input?.dataset?.cartFinalPrice;
  if (!itemId || input.value === "") return;
  const item = state.cart.find((cartItem) => cartItem.id === itemId);
  if (item) setCartItemFinalPrice(item, input.value);
}

function cartItemLineTotal(item = {}) {
  return roundCurrency(toNumber(item.price, cartItemBasePrice(item)) * cartItemQty(item));
}

function cartBaseSubtotal() {
  return roundCurrency(state.cart.reduce((sum, item) => sum + cartItemBasePrice(item) * cartItemQty(item), 0));
}

function cartSubtotal() {
  return roundCurrency(state.cart.reduce((sum, item) => sum + cartItemLineTotal(item), 0));
}

function cartPriceAdjustment() {
  return roundCurrency(cartSubtotal() - cartBaseSubtotal());
}

function calculateDiscount(subtotal, rawValue = $("#cart-discount")?.value, type = $("#cart-discount-type")?.value) {
  const value = Math.max(0, toNumber(rawValue));
  if (type === "percent") return Math.min(subtotal, subtotal * Math.min(100, value) / 100);
  return Math.min(value, subtotal);
}

function normalizePayment(payment = "") {
  const value = normalizeText(payment).toLowerCase();
  if (value === "pix") return "Pix";
  if (value === "fiado") return "Fiado";
  if (value === "cartao" || value === "cartão") return "Cartão";
  return "Dinheiro";
}

function validateCartStock() {
  for (const item of state.cart) {
    const qty = Math.max(1, toNumber(item.qty, 1));
    const product = state.data.products.find((stored) => stored.id === item.id || stored.id === item.productId);
    if (!product) return `Produto ${item.name || item.id} nao encontrado.`;
    if (!state.settings.pdv.allowNegativeStock && qty > toNumber(product.stock)) {
      return `Estoque insuficiente para ${product.name}. Disponivel: ${product.stock}.`;
    }
    if (qty <= 0 || toNumber(item.price) < 0) return `Quantidade ou valor invalido para ${item.name}.`;
  }
  return "";
}

function saleProfit(sale) {
  if (sale.canceled) return 0;
  return sale.items.reduce((sum, item) => {
    const product = state.data.products.find((stored) => stored.id === item.productId);
    const cost = toNumber(item.cost ?? product?.cost);
    const feeRatio = sale.total ? (sale.feeValue || 0) / sale.total : 0;
    const gross = toNumber(item.total ?? item.price * item.qty);
    return sum + gross * (1 - feeRatio) - cost * item.qty;
  }, 0);
}

function movementDay(dateText) {
  return new Date(dateText).toISOString().slice(0, 10);
}

function daysBack(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (count - 1 - index));
    return date.toISOString().slice(0, 10);
  });
}

function daysBetween(startDay, endDay) {
  const start = new Date(`${startDay}T12:00:00`);
  const end = new Date(`${endDay}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return daysBack(7);
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const days = [];
  for (const date = new Date(first); date <= last; date.setDate(date.getDate() + 1)) {
    days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

function monthStartISO() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function setDashboardDateRangeByPreset(preset = $("#dashboard-period")?.value || "7") {
  const startInput = $("#dashboard-start-date");
  const endInput = $("#dashboard-end-date");
  if (!startInput || !endInput) return;
  const today = todayISO();
  if (preset === "month") {
    startInput.value = monthStartISO();
    endInput.value = today;
    return;
  }
  const days = Number(preset || 7);
  const range = daysBack(Number.isFinite(days) && days > 0 ? days : 7);
  startInput.value = range[0];
  endInput.value = range[range.length - 1] || today;
}

function ensureDashboardDateRange() {
  const startInput = $("#dashboard-start-date");
  const endInput = $("#dashboard-end-date");
  if (!startInput || !endInput) return;
  if (!startInput.value || !endInput.value) setDashboardDateRangeByPreset();
}

function dashboardDateRangeDays() {
  ensureDashboardDateRange();
  const start = $("#dashboard-start-date")?.value;
  const end = $("#dashboard-end-date")?.value;
  const days = daysBetween(start, end);
  return days.length > 120 ? days.slice(-120) : days;
}

function sameMonth(dateText) {
  if (!dateText) return false;
  return new Date(dateText).toISOString().slice(0, 7) === todayISO().slice(0, 7);
}

function dateWithinDays(dateText, days) {
  if (!dateText) return false;
  const target = new Date(`${dateText}T12:00:00`);
  const limit = new Date();
  limit.setDate(limit.getDate() + Number(days || 0));
  limit.setHours(23, 59, 59, 999);
  return target.getTime() <= limit.getTime();
}

function percentOf(value, target) {
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function setBar(selector, percent) {
  const element = $(selector);
  if (element) element.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function renderDashboard() {
  const todaySales = state.data.sales.filter((sale) => !sale.canceled && sameDay(sale.date, todayISO()));
  const allSalesTotal = salesTotal(state.data.sales);
  const allExpenseTotal = expenseTotal(state.data.expenses);
  const lowStock = lowStockProducts();
  const todayProfit = todaySales.reduce((sum, sale) => sum + saleProfit(sale), 0);
  const monthSales = state.data.sales.filter((sale) => !sale.canceled && sameMonth(sale.date));
  const monthExpenses = state.data.expenses.filter((expense) => sameMonth(expense.date));
  const monthClients = state.data.clients.filter((client) => sameMonth(client.createdAt));
  const monthSalesTotal = salesTotal(monthSales);
  const monthProfit = monthSales.reduce((sum, sale) => sum + saleProfit(sale), 0) - expenseTotal(monthExpenses);
  const averageTicket = todaySales.length ? salesTotal(todaySales) / todaySales.length : 0;
  const monthlySalesGoal = Number(state.settings.finance?.monthlySalesGoal || 50000);
  const monthlyProfitGoal = Number(state.settings.finance?.monthlyProfitGoal || 15000);
  const monthlyClientGoal = Number(state.settings.finance?.monthlyClientGoal || 50);
  const currentDay = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const projectedMonth = currentDay ? (monthSalesTotal / currentDay) * daysInMonth : monthSalesTotal;
  const todayCommission = todaySales.reduce((sum, sale) => sum + (sale.commissionCanceled ? 0 : toNumber(sale.commissionValue)), 0);
  const monthSellerRows = commissionRows(monthSales).sort((a, b) => b.total - a.total);
  const topSeller = monthSellerRows[0];
  const overdueReceivables = state.data.accountsReceivable.filter((account) => account.status !== "Recebido" && account.dueDate && account.dueDate < todayISO());
  const overdueTotal = overdueReceivables.reduce((sum, account) => sum + toNumber(account.remainingValue ?? account.value), 0);
  const hasTodaySales = todaySales.length > 0;

  $("#dash-sales-today").textContent = money.format(salesTotal(todaySales));
  setText("#dash-cash", money.format(allSalesTotal - allExpenseTotal));
  $("#dash-profit-today").textContent = money.format(todayProfit);
  $("#dash-sales-count").textContent = todaySales.length;
  setText("#dash-ticket", money.format(averageTicket));
  setText("#dash-new-clients", String(monthClients.length));
  $("#dash-products").textContent = state.data.products.length;
  $("#dash-low-stock").textContent = lowStock.length;
  $("#dash-sales-note").textContent = hasTodaySales ? `${todaySales.length} venda(s) hoje` : "Nenhuma venda hoje";
  $("#dash-profit-note").textContent = hasTodaySales ? "Lucro estimado" : "Sem lucro registrado";
  $("#dashboard-empty-state")?.classList.toggle("hidden", hasTodaySales);
  setText("#dash-commission-today", money.format(todayCommission));
  setText("#dash-top-seller", topSeller ? topSeller.sellerName : "-");
  setText("#dash-top-seller-note", topSeller ? `${topSeller.count} venda(s) | ${money.format(topSeller.total)}` : "Sem vendas ainda");
  setText("#dash-overdue-receivables", money.format(overdueTotal));
  setText("#dash-overdue-note", `${overdueReceivables.length} conta(s)`);
  setText("#goal-sales-label", `${money.format(monthSalesTotal)} / ${money.format(monthlySalesGoal)}`);
  setText("#goal-sales-percent", `${percentOf(monthSalesTotal, monthlySalesGoal)}%`);
  setBar("#goal-sales-bar", percentOf(monthSalesTotal, monthlySalesGoal));
  setText("#goal-profit-label", `${money.format(monthProfit)} / ${money.format(monthlyProfitGoal)}`);
  setText("#goal-profit-percent", `${percentOf(monthProfit, monthlyProfitGoal)}%`);
  setBar("#goal-profit-bar", percentOf(monthProfit, monthlyProfitGoal));
  setText("#goal-clients-label", `${monthClients.length} / ${monthlyClientGoal} clientes`);
  setText("#goal-clients-percent", `${percentOf(monthClients.length, monthlyClientGoal)}%`);
  setBar("#goal-clients-bar", percentOf(monthClients.length, monthlyClientGoal));
  setText("#month-projection", money.format(projectedMonth));
  setText("#month-projection-note", projectedMonth >= monthlySalesGoal ? "Acima da meta mensal" : "Abaixo da meta mensal");

  $("#low-stock-table").innerHTML = lowStock.length
    ? lowStock.map((product) => `
      <tr class="low-stock">
        <td>${product.code}</td>
        <td>${product.name}</td>
        <td>${product.stock}</td>
        <td>${product.minStock} | repor ${restockSuggestion(product)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4" class="muted">Nenhum produto com estoque baixo.</td></tr>`;

  renderFinanceSummaryChart();
  renderFinancialStatus(allSalesTotal, allExpenseTotal);
  renderDashboardLists(lowStock);
  renderDashboardAdvanced(monthSales, monthClients, monthSalesTotal, monthProfit, lowStock);
}

function renderFinanceSummaryChart() {
  const days = dashboardDateRangeDays();
  const rows = days.map((day) => {
    const sales = state.data.sales.filter((sale) => !sale.canceled && movementDay(sale.date) === day);
    const expenses = state.data.expenses.filter((expense) => expense.date === day);
    const income = salesTotal(sales);
    const outcome = expenseTotal(expenses);
    return {
      label: day.slice(5).split("-").reverse().join("/"),
      income,
      outcome,
      profit: income - outcome,
    };
  });
  const hasActivity = rows.some((row) => row.income > 0 || row.outcome > 0 || row.profit > 0);

  const maxValue = Math.max(100, ...rows.flatMap((row) => [row.income, row.outcome, Math.max(row.profit, 0)]));
  const width = 720;
  const height = 260;
  const left = 70;
  const right = 24;
  const top = 18;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index) => left + (plotWidth / Math.max(rows.length - 1, 1)) * index;
  const y = (value) => top + plotHeight - (Math.max(value, 0) / maxValue) * plotHeight;
  const points = (key) => rows.map((row, index) => `${x(index)},${y(row[key])}`).join(" ");
  const area = `${left},${height - bottom} ${points("profit")} ${width - right},${height - bottom}`;
  const labelStep = Math.max(1, Math.ceil(rows.length / 10));
  const grid = [0, 0.25, 0.5, 0.75, 1].map((step) => {
    const value = maxValue * step;
    const lineY = y(value);
    return `<line x1="${left}" y1="${lineY}" x2="${width - right}" y2="${lineY}" />
      <text x="8" y="${lineY + 4}">${money.format(value).replace(",00", "")}</text>`;
  }).join("");

  const chartNode = $("#finance-chart");
  if (!chartNode) return;
  chartNode.classList.toggle("is-empty", !hasActivity);
  chartNode.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" aria-label="Resumo financeiro">
      <g class="chart-grid">${grid}</g>
      <polyline class="line income-line" points="${points("income")}" />
      <polyline class="line expense-line" points="${points("outcome")}" />
      <polygon class="profit-area" points="${area}" />
      <polyline class="line profit-line" points="${points("profit")}" />
      ${rows.map((row, index) => index % labelStep === 0 || index === rows.length - 1 ? `<text class="x-label" x="${x(index)}" y="${height - 10}">${row.label}</text>` : "").join("")}
    </svg>
    ${hasActivity ? "" : `
      <div class="chart-empty-state">
        <span>PDV</span>
        <strong>Nenhuma venda hoje</strong>
        <small>Comece registrando vendas no PDV</small>
      </div>
    `}
  `;
}

function renderFinancialStatus(income, expenses) {
  const balance = income - expenses;
  const movementTotal = income + expenses;
  const total = Math.max(movementTotal, 1);
  const incomeDeg = Math.round((income / total) * 360);
  const expenseDeg = Math.round((expenses / total) * 360);

  const donut = $("#finance-donut");
  if (donut) {
    donut.classList.toggle("is-empty", movementTotal <= 0);
    donut.style.background = movementTotal > 0
      ? `conic-gradient(#35b779 0deg ${incomeDeg}deg, #d93636 ${incomeDeg}deg ${incomeDeg + expenseDeg}deg, #4263eb ${incomeDeg + expenseDeg}deg 360deg)`
      : "conic-gradient(#e2e8f0 0deg 360deg)";
  }
  $("#donut-balance").textContent = money.format(balance);
  $("#status-income").textContent = money.format(income);
  $("#status-expenses").textContent = money.format(expenses);
  $("#status-balance").textContent = money.format(balance);
  setText("#finance-status-note", movementTotal > 0 ? "Resumo atualizado em tempo real." : "Nenhuma movimentacao financeira registrada.");
}

function renderDashboardLists(lowStock) {
  const latestSales = state.data.sales.filter((sale) => !sale.canceled).slice(0, 5);
  const latestExpenses = state.data.expenses.slice(0, 4);
  const topProducts = new Map();

  state.data.sales.filter((sale) => !sale.canceled).forEach((sale) => {
    sale.items.forEach((item) => {
      const key = item.productId || item.id || item.name;
      const current = topProducts.get(key) || { name: item.name || "Produto", qty: 0, total: 0 };
      current.qty += Number(item.qty || item.quantity || 1);
      current.total += Number(item.total || 0);
      topProducts.set(key, current);
    });
  });

  $("#latest-income").innerHTML = latestSales.length
    ? latestSales.map((sale) => `
      <div class="movement-item">
        <span class="movement-icon income">↓</span>
        <div>
          <strong>Venda #${sale.id.slice(-6).toUpperCase()}</strong>
          <small>${sale.payment}</small>
        </div>
        <div class="movement-value">
          <strong>${money.format(sale.total)}</strong>
          <small>${new Date(sale.date).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</small>
        </div>
      </div>
    `).join("")
    : `<p class="muted">Nenhuma entrada registrada.</p>`;

  $("#latest-expenses").innerHTML = latestExpenses.length
    ? latestExpenses.map((expense) => `
      <div class="movement-item">
        <span class="movement-icon expense">↑</span>
        <div>
          <strong>${expense.description}</strong>
          <small>Saída manual</small>
        </div>
        <div class="movement-value expense-text">
          <strong>${money.format(expense.value)}</strong>
          <small>${new Date(`${expense.date}T12:00:00`).toLocaleDateString("pt-BR")}</small>
        </div>
      </div>
    `).join("")
    : `<p class="muted">Nenhuma saída registrada.</p>`;

  $("#low-stock-list").innerHTML = lowStock.length
    ? lowStock.slice(0, 5).map((product) => `
      <div class="stock-item">
        <span class="stock-alert-icon">△</span>
        <div>
          <strong>${escapeHtml(product.name)}</strong>
          <small>Estoque: ${product.stock} | Sugestao: repor ${restockSuggestion(product)}</small>
        </div>
        <span class="min-pill">Mínimo: ${product.minStock}</span>
      </div>
    `).join("")
    : `<p class="muted">Nenhum produto com estoque baixo.</p>`;

  const topRows = Array.from(topProducts.values()).sort((a, b) => b.total - a.total).slice(0, 5);
  const topTable = $("#top-products-table");
  if (topTable) {
    topTable.closest(".dashboard-list-panel")?.querySelector("h3") && (topTable.closest(".dashboard-list-panel").querySelector("h3").textContent = "Top Produtos");
    topTable.innerHTML = topRows.length
      ? topRows.map((product) => `<tr><td>${escapeHtml(product.name)}</td><td>${product.qty}</td><td>${money.format(product.total)}</td></tr>`).join("")
      : `<tr><td colspan="3" class="muted">Nenhuma venda registrada.</td></tr>`;
  }

  const latestSalesTable = $("#latest-sales-table");
  if (latestSalesTable) {
    latestSalesTable.closest(".dashboard-list-panel")?.querySelector("h3") && (latestSalesTable.closest(".dashboard-list-panel").querySelector("h3").textContent = "Ultimas Vendas");
    latestSalesTable.innerHTML = latestSales.length
      ? latestSales.map((sale) => `<tr><td>#${escapeHtml(String(sale.id).slice(-5).toUpperCase())}</td><td>${escapeHtml(sale.client || "Cliente")}</td><td>${money.format(sale.total)}</td><td>${settingBadge(sale.payment || "-")}</td></tr>`).join("")
      : `<tr><td colspan="4" class="muted">Nenhuma venda registrada.</td></tr>`;
  }

  const sellerRows = commissionRows(state.data.sales.filter((sale) => !sale.canceled && sameMonth(sale.date))).sort((a, b) => b.total - a.total).slice(0, 5);
  const topSellersTable = $("#top-sellers-table");
  if (topSellersTable) {
    topSellersTable.innerHTML = sellerRows.length
      ? sellerRows.map((row) => {
        const seller = state.settings.users.find((user) => user.id === row.sellerId || user.username === row.sellerId);
        const goal = toNumber(seller?.monthlyGoal || 0);
        return `<tr><td>${escapeHtml(row.sellerName)}</td><td>${row.count}</td><td>${money.format(row.total)}</td><td>${goal ? `${percentOf(row.total, goal)}%` : "-"}</td></tr>`;
      }).join("")
      : `<tr><td colspan="4" class="muted">Nenhum vendedor com venda no mes.</td></tr>`;
  }

  const receivableAlertDays = Number(state.settings.finance?.receivableAlertDays ?? 3);
  const payableAlertDays = Number(state.settings.finance?.payableAlertDays ?? 3);
  const dueReceivables = state.data.accountsReceivable.filter((item) => item.status !== "Recebido" && dateWithinDays(item.dueDate, receivableAlertDays));
  const duePayables = state.data.accountsPayable.filter((item) => item.status !== "Pago" && dateWithinDays(item.dueDate, payableAlertDays));
  const alerts = [
    lowStock.length ? ["Estoque baixo", `${lowStock.length} produto(s) precisam de reposicao`, "danger"] : null,
    dueReceivables.length
      ? ["Contas a receber", `${dueReceivables.length} titulo(s) vencidos ou vencendo em ate ${receivableAlertDays} dia(s)`, "warning"]
      : null,
    duePayables.length
      ? ["Contas a pagar", `${duePayables.length} pagamento(s) vencidos ou vencendo em ate ${payableAlertDays} dia(s)`, "warning"]
      : null,
    ["Backup", state.settings.backup?.lastAutoBackupAt ? `Ultimo backup em ${new Date(state.settings.backup.lastAutoBackupAt).toLocaleDateString("pt-BR")}` : "Nenhum backup automatico recente", "info"],
  ].filter(Boolean);

  const alertsNode = $("#dashboard-alerts");
  if (alertsNode) {
    alertsNode.closest(".dashboard-list-panel")?.querySelector("h3") && (alertsNode.closest(".dashboard-list-panel").querySelector("h3").textContent = "Alertas e Notificacoes");
    alertsNode.innerHTML = alerts.map(([title, detail, tone]) => `
      <div class="alert-item ${tone}">
        <span>${tone === "danger" ? "!" : tone === "warning" ? "i" : "ok"}</span>
        <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>
      </div>
    `).join("");
  }
}

function renderDashboardAdvanced(monthSales, monthClients, monthSalesTotal, monthProfit, lowStock) {
  const soldQty = monthSales.reduce((sum, sale) => sum + sale.items.reduce((inner, item) => inner + Number(item.qty || item.quantity || 1), 0), 0);
  const stockQty = state.data.products.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const turnover = stockQty ? soldQty / stockQty : 0;
  const grossProfit = monthSales.reduce((sum, sale) => sum + sale.items.reduce((inner, item) => {
    const product = state.data.products.find((stored) => stored.id === item.productId);
    const cost = toNumber(item.cost ?? product?.cost);
    const total = toNumber(item.total ?? item.price * item.qty);
    return inner + total - cost * Number(item.qty || 1);
  }, 0), 0);
  const margin = monthSalesTotal ? (grossProfit / monthSalesTotal) * 100 : 0;
  const cac = monthClients.length ? expenseTotal(state.data.expenses.filter((expense) => sameMonth(expense.date))) / monthClients.length : 0;
  const ltv = state.data.clients.length ? salesTotal(state.data.sales) / state.data.clients.length : 0;
  const conversion = state.data.clients.length ? (monthSales.length / state.data.clients.length) * 100 : 0;

  setText("#metric-stock-turnover", `${turnover.toFixed(1).replace(".", ",")}x`);
  setText("#metric-margin", `${margin.toFixed(1).replace(".", ",")}%`);
  setText("#metric-cac", money.format(cac));
  setText("#metric-ltv", money.format(ltv));
  setText("#metric-conversion", `${conversion.toFixed(1).replace(".", ",")}%`);
  setText("#metric-license", state.settings.tenant?.plan || "-");
  setText("#metric-license-note", `${state.settings.tenant?.licenseStatus || "indefinida"}${lowStock.length ? ` | ${lowStock.length} alerta(s)` : ""}`);
}

function renderSearchResults() {
  const term = $("#product-search").value.trim().toLowerCase();
  const products = state.data.products
    .filter((product) => product.active !== false)
    .filter((product) => state.pdvCategory === "Todos" || product.category === state.pdvCategory)
    .filter((product) => !term || product.name.toLowerCase().includes(term) || product.code.toLowerCase().includes(term) || (product.barcode || "").toLowerCase().includes(term));

  $("#search-results").innerHTML = products.length
    ? products.map((product) => `
      <button class="product-option pdv-product-card" type="button" data-add-cart="${escapeHtml(product.id)}" ${product.stock <= 0 && !state.settings.pdv.allowNegativeStock ? "disabled" : ""}>
        ${productThumbMarkup(product)}
        <div class="product-card-body">
          <strong>${escapeHtml(product.name)}</strong>
          <small>Código: ${escapeHtml(product.code)}</small>
          <b>${money.format(retailPrice(product))}</b>
          <small>Atacado: ${money.format(wholesalePrice(product))} acima de ${Math.max(1, toNumber(product.wholesaleMinQty || 1))} un.</small>
          <small class="${product.stock <= product.minStock ? "stock-danger" : "stock-ok"}">Estoque: ${product.stock}</small>
        </div>
      </button>
    `).join("")
    : `<p class="muted">Nenhum produto encontrado.</p>`;
}

function renderPdvSummary() {
  const todaySales = state.data.sales.filter((sale) => !sale.canceled && sameDay(sale.date, todayISO()));
  const total = salesTotal(todaySales);
  const itemCount = todaySales.reduce((sum, sale) => sum + sale.items.reduce((inner, item) => inner + Number(item.qty || item.quantity || 1), 0), 0);
  const clients = new Set(todaySales.map((sale) => sale.client || sale.clientName).filter(Boolean));
  setText("#pdv-kpi-sales", money.format(total));
  setText("#pdv-kpi-sales-note", `${todaySales.length} venda(s)`);
  setText("#pdv-kpi-ticket", money.format(todaySales.length ? total / todaySales.length : 0));
  setText("#pdv-kpi-items", String(itemCount));
  setText("#pdv-kpi-clients", String(clients.size || todaySales.length));
}

function selectedPdvClient() {
  if (!state.selectedClientId) return null;
  return state.data.clients.find((client) => client.id === state.selectedClientId) || null;
}

function clientMatchesTerm(client, term) {
  if (!term) return true;
  return [client.name, client.phone, client.email, client.document]
    .some((value) => String(value || "").toLowerCase().includes(term));
}

function renderPdvClientSelector() {
  const select = $("#pdv-client-select");
  if (!select) return;
  const term = normalizeText(state.pdvClientSearch).toLowerCase();
  const clients = state.data.clients
    .filter((client) => client.status !== "Inativo")
    .filter((client) => clientMatchesTerm(client, term))
    .slice(0, 60);
  const selected = selectedPdvClient();
  select.innerHTML = [
    `<option value="">Consumidor final / sem cadastro</option>`,
    ...clients.map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}${client.document && client.document !== "-" ? ` - ${escapeHtml(client.document)}` : ""}</option>`),
  ].join("");
  if (selected && !clients.some((client) => client.id === selected.id)) {
    select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(selected.id)}">${escapeHtml(selected.name)}</option>`);
  }
  select.value = state.selectedClientId || "";
  const search = $("#pdv-client-search");
  if (search && search.value !== state.pdvClientSearch) search.value = state.pdvClientSearch;
  const summary = $("#pdv-client-summary");
  if (!summary) return;
  summary.classList.toggle("selected", Boolean(selected));
  summary.innerHTML = selected
    ? `<strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(selected.document || "-")} | ${escapeHtml(selected.phone || "-")} | ${escapeHtml(selected.email || "-")}</span>`
    : `Consumidor final. Selecione um cadastro para sair na nota.`;
}

function renderQuoteSelector() {
  const select = $("#quote-select");
  if (!select) return;
  const openQuotes = state.data.quotes
    .filter((quote) => quote.status === "Aberto")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 80);
  select.innerHTML = [
    `<option value="">Selecione um orcamento</option>`,
    ...openQuotes.map((quote) => `<option value="${escapeHtml(quote.id)}">${escapeHtml(quote.title || `Orcamento ${quote.id.slice(-5).toUpperCase()}`)} - ${money.format(quote.total || 0)}</option>`),
  ].join("");
  if (state.activeQuoteId && openQuotes.some((quote) => quote.id === state.activeQuoteId)) select.value = state.activeQuoteId;
}

async function saveQuote() {
  if (!requirePermission("pdv_access", "salvar orcamento")) return;
  if (!state.cart.length) {
    showToast("Adicione produtos ao carrinho antes de salvar o orcamento.", "error");
    return;
  }
  applyPendingCartFinalPrice();
  state.cart.forEach(syncCartItemPrice);
  const subtotal = cartSubtotal();
  const baseSubtotal = cartBaseSubtotal();
  const itemAdjustment = cartPriceAdjustment();
  const discountType = $("#cart-discount-type")?.value || "value";
  const discountValue = Math.max(0, toNumber($("#cart-discount")?.value));
  const discount = calculateDiscount(subtotal, discountValue, discountType);
  const client = selectedPdvClient();
  const seller = currentSeller();
  const quote = {
    id: makeId("quote"),
    title: client?.name ? `Orcamento ${client.name}` : `Orcamento ${new Date().toLocaleDateString("pt-BR")}`,
    createdAt: new Date().toISOString(),
    status: "Aberto",
    clientId: client?.id || "",
    clientName: client?.name || "",
    sellerId: seller?.id || seller?.username || "",
    sellerName: seller?.name || seller?.username || "",
    baseSubtotal,
    itemAdjustment,
    subtotal,
    discount,
    discountType,
    discountValue,
    total: Math.max(subtotal - discount, 0),
    items: state.cart.map((item) => ({ ...item })),
  };
  state.data.quotes.unshift(quote);
  state.activeQuoteId = quote.id;
  saveDataWithAudit("Orcamento salvo", `${quote.items.length} item(ns), total ${money.format(quote.total)}`);
  renderQuoteSelector();
  showToast("Orcamento salvo sem baixar estoque.", "success");
}

function selectedQuote() {
  const id = $("#quote-select")?.value || state.activeQuoteId;
  return state.data.quotes.find((quote) => quote.id === id) || null;
}

function recoverQuote(markActive = true) {
  const quote = selectedQuote();
  if (!quote || quote.status !== "Aberto") {
    showToast("Selecione um orcamento aberto.", "error");
    return null;
  }
  state.cart = quote.items.map((item) => ({ ...item }));
  state.selectedClientId = quote.clientId || "";
  state.pdvClientSearch = "";
  state.activeQuoteId = markActive ? quote.id : "";
  if ($("#cart-discount")) $("#cart-discount").value = quote.discountValue ?? quote.discount ?? 0;
  if ($("#cart-discount-type")) $("#cart-discount-type").value = quote.discountType || "value";
  renderCart();
  renderQuoteSelector();
  showToast("Orcamento recuperado.", "success");
  return quote;
}

function convertQuoteToSale() {
  const quote = recoverQuote(true);
  if (quote) showToast("Revise o carrinho e finalize a venda.", "info");
}

async function cancelQuote() {
  const quote = selectedQuote();
  if (!quote || quote.status !== "Aberto") {
    showToast("Selecione um orcamento aberto.", "error");
    return;
  }
  const confirmed = await confirmAction("Cancelar orcamento", `Cancelar ${quote.title || quote.id}?`, { danger: true, confirmText: "Cancelar" });
  if (!confirmed) return;
  quote.status = "Cancelado";
  quote.canceledAt = new Date().toISOString();
  if (state.activeQuoteId === quote.id) state.activeQuoteId = "";
  saveDataWithAudit("Orcamento cancelado", quote.title || quote.id);
  renderQuoteSelector();
  showToast("Orcamento cancelado.", "success");
}

function cartFinalPriceInput(item, className = "") {
  const id = escapeHtml(item.id);
  const adjusted = item.priceAdjusted ? "adjusted" : "";
  return `
    <label class="cart-final-price ${adjusted} ${className}">
      <span>Valor final/un.</span>
      <input type="number" min="0" step="0.01" value="${toNumber(item.price).toFixed(2)}" data-cart-final-price="${id}" />
    </label>
  `;
}

function renderCheckoutItemAdjustments() {
  const node = $("#pdv-checkout-item-adjustments");
  if (!node) return;
  node.innerHTML = state.cart.length
    ? state.cart.map((item) => {
      const qty = cartItemQty(item);
      const lineTotal = cartItemLineTotal(item);
      return `
        <div class="pdv-checkout-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${qty} un. | Base ${money.format(item.basePrice)} | Total ${money.format(lineTotal)}</small>
          </div>
          ${cartFinalPriceInput(item, "compact")}
        </div>
      `;
    }).join("")
    : `<p class="muted">Nenhum item no carrinho.</p>`;
}

function renderCart() {
  applyPendingCartFinalPrice();
  state.cart.forEach(syncCartItemPrice);
  const subtotal = cartSubtotal();
  const adjustment = cartPriceAdjustment();
  const discount = calculateDiscount(subtotal);
  const total = Math.max(subtotal - discount, 0);
  const received = Number($("#amount-received")?.value || 0);
  const paymentMethod = $("#payment-method")?.value || "Dinheiro";
  const change = paymentMethod === "Dinheiro" ? Math.max(received - total, 0) : 0;
  const cartNode = $("#cart-table");
  const cartPanel = $("#pdv .pdv-cart");
  const cartIsEmpty = !state.cart.length;

  cartNode?.classList.toggle("is-empty", cartIsEmpty);
  cartPanel?.classList.toggle("cart-empty", cartIsEmpty);
  cartNode.innerHTML = state.cart.length
    ? state.cart.map((item) => `
      <div class="pdv-cart-item">
        <span class="cart-thumb">${escapeHtml(item.name.slice(0, 2).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>Codigo: ${escapeHtml(item.code)} | ${escapeHtml(item.priceType)} | Base ${money.format(item.basePrice)}</small>
        </div>
        <div class="cart-qty-stepper">
          <button type="button" data-cart-dec="${escapeHtml(item.id)}">-</button>
          <input class="qty-control" type="number" min="1" ${state.settings.pdv.allowNegativeStock ? "" : `max="${item.stock}"`} value="${item.qty}" data-cart-qty="${escapeHtml(item.id)}" />
          <button type="button" data-cart-inc="${escapeHtml(item.id)}">+</button>
        </div>
        <span>${money.format(item.basePrice)}</span>
        ${cartFinalPriceInput(item)}
        <strong>${money.format(cartItemLineTotal(item))}</strong>
        <button class="cart-remove" type="button" data-remove-cart="${escapeHtml(item.id)}">x</button>
      </div>
    `).join("")
    : `<div class="empty-cart muted"><strong>Carrinho vazio</strong><small>Adicione produtos para iniciar a venda</small></div>`;

  $("#cart-subtotal").textContent = money.format(subtotal);
  setText("#cart-item-adjustment", money.format(adjustment));
  $("#cart-item-adjustment-row")?.classList.toggle("hidden", Math.abs(adjustment) < 0.005);
  $("#cart-total").textContent = money.format(total);
  setText("#pdv-footer-total", money.format(total));
  setText("#pdv-checkout-subtotal", money.format(subtotal));
  setText("#pdv-checkout-item-adjustment", money.format(adjustment));
  $("#pdv-checkout-item-adjustment-row")?.classList.toggle("hidden", Math.abs(adjustment) < 0.005);
  setText("#pdv-checkout-discount", money.format(discount));
  setText("#pdv-checkout-total", money.format(total));
  setText("#change-value", money.format(change));
  renderCheckoutItemAdjustments();
  renderPdvClientSelector();
  renderQuoteSelector();
}

function clearPdvCart() {
  state.cart = [];
  state.selectedClientId = "";
  state.pdvClientSearch = "";
  if ($("#cart-discount")) $("#cart-discount").value = 0;
  if ($("#cart-discount-type")) $("#cart-discount-type").value = "value";
  if ($("#amount-received")) $("#amount-received").value = "";
  renderCart();
  focusPdvSearch();
}

function addFirstVisibleProductFromSearch() {
  const search = $("#product-search");
  const term = normalizeText(search?.value || "");
  if (handleBarcodeSearch(term, { alertMissing: false })) return true;
  if (!term) return false;
  const firstProduct = $("#search-results [data-add-cart]:not(:disabled)");
  if (!firstProduct?.dataset.addCart) {
    alertProductNotFound(term);
    return false;
  }
  addToCart(firstProduct.dataset.addCart);
  if (search) search.value = "";
  renderSearchResults();
  focusPdvSearch();
  return true;
}

function renderCategoryFilter() {
  const categories = ["Todos", ...productCategories(state.data.products.filter((product) => product.active !== false))];
  $("#category-filter").innerHTML = categories.map((category) => `
    <button class="${state.pdvCategory === category ? "active" : ""}" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>
  `).join("");
}

function addToCart(productId) {
  if (!hasPermission("pdv_access")) {
    notifyEvent("error", "Acesso ao PDV bloqueado.", "error");
    return;
  }
  const product = state.data.products.find((item) => item.id === productId);
  if (!product || (product.stock <= 0 && !state.settings.pdv.allowNegativeStock)) return;

  const item = state.cart.find((cartItem) => cartItem.id === product.id);
  if (item) {
    if (state.settings.pdv.allowNegativeStock || item.qty < product.stock) item.qty += 1;
    else showToast(`Estoque insuficiente para ${product.name}.`, "error");
    syncCartItemPrice(item);
  } else {
    state.cart.push(syncCartItemPrice({
      ...product,
      retailPrice: retailPrice(product),
      wholesalePrice: wholesalePrice(product),
      wholesaleMinQty: Math.max(1, toNumber(product.wholesaleMinQty || 1)),
      cost: toNumber(product.cost),
      qty: 1,
    }));
  }
  renderCart();
  focusPdvSearch();
}

function backendSalePayload(sale) {
  return {
    ...sale,
    itens: sale.items.map((item) => ({
      ...item,
      id: item.productId,
      produto_id: item.productId,
      quantidade: item.qty,
    })),
    total: sale.total,
    pagamento: sale.payment.toLowerCase(),
    valor_pago: sale.received,
  };
}

async function tryRegisterSaleBackend(sale) {
  if (!localDatabaseService?.registrarVenda || !hasLocalApiSession()) {
    if (isProduction()) throw new Error("API local autenticada e obrigatoria para concluir venda em producao.");
    return false;
  }
  try {
    await localDatabaseService.registrarVenda(backendSalePayload(sale));
    state.localDbAvailable = true;
    state.lastSyncAt = new Date().toISOString();
    return true;
  } catch (error) {
    state.localDbAvailable = false;
    if (isProduction()) throw error;
    return false;
  }
}

async function finalizarVenda() {
  if (!requirePermission("pdv_access", "finalizar vendas")) return;
  if (isLicenseBlockedFor("pdv")) {
    notifyEvent("error", "Licenca vencida ou bloqueada para vendas.", "error");
    return;
  }
  if (!state.cart.length) {
    showToast("Adicione produtos ao carrinho antes de finalizar.", "error");
    return;
  }

  applyPendingCartFinalPrice();
  state.cart.forEach(syncCartItemPrice);
  const stockError = validateCartStock();
  if (stockError) {
    showToast(stockError, "error");
    return;
  }
  // Operacao critica: em producao deve ser validada em backend/transacao no banco.
  const subtotal = cartSubtotal();
  const baseSubtotal = cartBaseSubtotal();
  const itemAdjustment = cartPriceAdjustment();
  const itemDiscount = Math.max(0, -itemAdjustment);
  const itemIncrease = Math.max(0, itemAdjustment);
  const discountType = $("#cart-discount-type")?.value || "value";
  const discountValue = Math.max(0, toNumber($("#cart-discount")?.value));
  const discount = calculateDiscount(subtotal, discountValue, discountType);
  const total = Math.max(subtotal - discount, 0);
  const received = Math.max(0, Number($("#amount-received").value || 0));
  const payment = normalizePayment($("#payment-method").value);
  const client = selectedPdvClient();
  const seller = currentSeller();
  if (payment === "Fiado" && !client) {
    showToast("Selecione um cliente cadastrado para venda fiado.", "error");
    return;
  }
  if (!seller) {
    $("#pdv-seller")?.classList.add("required-missing");
    $("#pdv-seller")?.focus();
    showToast("Selecione o vendedor antes de finalizar a venda.", "error");
    return;
  }
  const discountLimitPercent = discountLimitForSeller(seller);
  const totalDiscountForAuthorization = Math.max(0, baseSubtotal - total);
  const maxDiscount = baseSubtotal * (discountLimitPercent / 100);
  let discountAuthorizedBy = "";
  if (totalDiscountForAuthorization > maxDiscount) {
    const admin = await authorizeDiscountAboveLimit(totalDiscountForAuthorization, maxDiscount);
    if (!admin) return;
    discountAuthorizedBy = admin.name || admin.username || "Administrador";
  }
  const cardPayment = payment === "Cartão" || payment === "Cartao";
  const feePercent = payment === "Pix" ? toNumber(state.settings.finance.pixFee) : cardPayment && state.settings.finance.cardFeeMode !== "fixed" ? toNumber(state.settings.finance.cardFee) : 0;
  const feeValue = cardPayment && state.settings.finance.cardFeeMode === "fixed"
    ? Math.min(total, toNumber(state.settings.finance.cardFee))
    : total * (feePercent / 100);
  const netTotal = Math.max(total - feeValue, 0);
  const commissionPercent = commissionPercentForSeller(seller);
  const commissionValue = netTotal * (commissionPercent / 100);

  if (!currentCashSession()) {
    showToast("Abra o caixa antes de finalizar vendas.", "error");
    return;
  }

  if ($("#payment-method").value === "Dinheiro" && received < total) {
    showToast("Informe o valor recebido em dinheiro igual ou maior que o total.", "error");
    return;
  }

  const backendBlockReason = productionSaleBackendBlockReason();
  if (isProduction() && backendBlockReason) {
    markDbUnavailable(backendBlockReason);
    showToast(`Venda bloqueada: ${backendBlockReason}`, "error");
    return;
  }

  const sale = {
    id: makeId("sale"),
    date: new Date().toISOString(),
    payment,
    pagamento: payment.toLowerCase(),
    valor_pago: received,
    clientId: client?.id || "",
    cliente_id: client?.id || null,
    client: client?.name || "",
    clientName: client?.name || "",
    clientDocument: client?.document || "",
    clientPhone: client?.phone || "",
    clientEmail: client?.email || "",
    vendedorId: seller.id || seller.username || "",
    vendedorNome: seller.name || seller.username || "Vendedor",
    sellerId: seller.id || seller.username || "",
    sellerName: seller.name || seller.username || "Vendedor",
    grossTotal: subtotal,
    baseSubtotal,
    itemAdjustment,
    itemDiscount,
    itemIncrease,
    subtotal,
    discount,
    discountType,
    discountValue,
    discountLimitPercent,
    discountAuthorizedBy,
    feePercent,
    feeValue,
    netTotal,
    commissionPercent,
    commissionValue,
    commissionCanceled: false,
    received,
    change: payment === "Dinheiro" ? Math.max(received - total, 0) : 0,
    items: state.cart.map((item) => ({
      productId: item.id,
      code: item.code,
      name: item.name,
      qty: item.qty,
      price: item.price,
      finalUnitPrice: item.finalUnitPrice,
      basePrice: item.basePrice,
      retailPrice: item.retailPrice,
      wholesalePrice: item.wholesalePrice,
      wholesaleMinQty: item.wholesaleMinQty,
      priceType: item.priceType,
      priceAdjusted: item.priceAdjusted,
      itemAdjustment: item.itemAdjustment,
      cost: item.cost,
      originalTotal: cartItemBasePrice(item) * cartItemQty(item),
      total: cartItemLineTotal(item),
    })),
    total,
  };

  let backendSaved = false;
  try {
    backendSaved = await tryRegisterSaleBackend(sale);
  } catch (error) {
    const errorMessage = saleBackendErrorMessage(error);
    console.error("Falha ao finalizar venda", error);
    markDbUnavailable(errorMessage);
    showToast(`Venda nao concluida: ${errorMessage}`, "error");
    return;
  }
  sale.backendSynced = backendSaved;

  sale.items.forEach((item) => {
    const product = state.data.products.find((stored) => stored.id === item.productId);
    product.stock -= item.qty;
  });

  state.data.sales.unshift(sale);
  if (state.activeQuoteId) {
    const quote = state.data.quotes.find((item) => item.id === state.activeQuoteId);
    if (quote) {
      quote.status = "Convertido";
      quote.convertedAt = sale.date;
      quote.convertedSaleId = sale.id;
    }
    state.activeQuoteId = "";
  }
  if (payment === "Fiado") {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const receivable = {
      id: makeId("rec"),
      dueDate: dueDate.toISOString().slice(0, 10),
      clientId: client.id,
      client: client.name,
      description: `Venda fiado ${sale.id.slice(-6).toUpperCase()}`,
      value: total,
      paidValue: 0,
      remainingValue: total,
      payments: [],
      status: "Pendente",
      saleId: sale.id,
    };
    state.data.accountsReceivable.unshift(receivable);
    syncReceivable(receivable);
  }
  const saleMovement = {
    id: makeId("cash"),
    type: "sale",
    date: sale.date,
    description: `Venda ${sale.id.slice(-6).toUpperCase()}`,
    value: sale.netTotal,
    payment: sale.payment,
  };
  currentCashSession().movements.push(saleMovement);
  saveData();
  if (backendSaved) {
    state.data.products.forEach((product) => syncProduct(product));
  } else {
    // Evita sincronizar produto ja baixado e depois reprocessar a venda, o que duplicaria baixa de estoque no PostgreSQL.
    syncSale(sale);
  }
  syncCashMovement(currentCashSession().id, saleMovement);
  saveDataWithAudit("Venda finalizada", `${sale.items.length} item(ns), total ${money.format(sale.total)}`);
  state.cart = [];
  state.selectedClientId = "";
  state.pdvClientSearch = "";
  state.currentSellerId = "";
  localStorage.removeItem(PDV_SELLER_KEY);
  $("#cart-discount").value = 0;
  if ($("#cart-discount-type")) $("#cart-discount-type").value = "value";
  $("#amount-received").value = "";
  renderReceipt(sale);
  closePdvCheckoutModal({ restoreFocus: false });
  renderAll();
  notifyEvent("sale", "Venda finalizada com sucesso.", "success");
  if (lowStockProducts().length) notifyEvent("lowStock", "Existem produtos com estoque baixo.", "info");
  if (state.settings.pdv.printerEnabled) {
    const printerName = state.settings.pdv.receiptPrinter || "impressora padrao";
    const printerMode = state.settings.pdv.printerMode || "dialog";
    const paperWidth = normalizeReceiptPaperWidth(state.settings.pdv.receiptPaperWidth, "80mm");
    const printTip = ` Em Mais definicoes, desmarque "Cabecalhos e rodapes" e use papel ${paperWidth} com margens Nenhuma quando disponivel.`;
    const printMessage = printerMode === "default"
      ? `A janela de impressao sera aberta. Confirme a impressora padrao do Windows (${printerName}) antes de imprimir.${printTip}`
      : printerMode === "reference"
        ? `A janela de impressao sera aberta. Selecione "${printerName}" na lista de impressoras do navegador.${printTip}`
        : `A janela de impressao sera aberta para voce escolher a impressora instalada no Windows.${printTip}`;
    const shouldPrint = await confirmAction(
      "Imprimir cupom?",
      printMessage,
      { confirmText: "Imprimir cupom", cancelText: "Nao imprimir" },
    );
    if (shouldPrint) {
      const copies = Math.max(1, Math.min(3, Math.round(toNumber(state.settings.pdv.receiptCopies, 1))));
      printCurrentReceipt(copies, { hideAfterPrint: true, restoreFocus: true });
    } else {
      hideReceipt();
    }
  } else {
    hideReceipt();
  }
  focusPdvSearch();
}

function isPdvCheckoutModalOpen() {
  const modal = $("#pdv-checkout-modal");
  return Boolean(modal && !modal.classList.contains("hidden"));
}

function openPdvCheckoutModal() {
  if (!state.cart.length) {
    showToast("Adicione produtos ao carrinho antes de finalizar.", "error");
    focusPdvSearch();
    return true;
  }
  const modal = $("#pdv-checkout-modal");
  if (!modal) return false;
  renderPdvSellerSelector();
  renderPdvClientSelector();
  renderCart();
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    const paymentMethod = $("#payment-method")?.value || "Dinheiro";
    const target = state.currentSellerId
      ? (paymentMethod === "Dinheiro" ? $("#amount-received") : $("#confirm-finish-sale"))
      : $("#pdv-seller");
    target?.focus();
  }, 0);
  return true;
}

function closePdvCheckoutModal({ restoreFocus = true } = {}) {
  const modal = $("#pdv-checkout-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (restoreFocus) focusPdvSearch();
}

async function confirmPdvCheckoutSale() {
  return finalizarVenda();
}

async function finishSale() {
  if (!openPdvCheckoutModal()) return finalizarVenda();
  return null;
}

function receiptNode() {
  return $("#print-area") || $("#receipt");
}

function hideReceipt() {
  receiptNode()?.classList.add("hidden");
}

function receiptPrintPageHeight(node = receiptNode()) {
  const paper = node?.querySelector(".receipt-paper") || node;
  const rectHeight = paper?.getBoundingClientRect?.().height || 0;
  const heightPx = Math.ceil(Math.max(rectHeight, paper?.scrollHeight || 0));
  const heightMm = Math.ceil((heightPx * 25.4) / 96) + 14;
  return Math.max(90, Math.min(5000, heightMm));
}

function receiptPrintCss(paperWidth, pageHeight) {
  return `
    @page { size: ${paperWidth} ${pageHeight}mm; margin: 0; }
    html,
    body {
      width: ${paperWidth};
      min-height: 0;
      height: auto;
      margin: 0;
      padding: 0;
      overflow: visible;
      background: #ffffff;
    }
    body {
      color: #000000;
      font-family: "Courier New", Courier, ui-monospace, SFMono-Regular, "Segoe UI Mono", Consolas, "Liberation Mono", monospace;
      font-variant-numeric: tabular-nums;
      font-synthesis: weight;
      font-weight: var(--receipt-print-weight, 900);
      line-height: 1.25;
      text-rendering: geometricPrecision;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    #print-area.receipt {
      display: block !important;
      width: calc(${paperWidth} - var(--receipt-print-side-margin, 3mm)) !important;
      max-width: calc(${paperWidth} - var(--receipt-print-side-margin, 3mm)) !important;
      min-height: 0 !important;
      height: auto !important;
      margin: 0 auto !important;
      padding: 0 !important;
      overflow: visible !important;
      color: #000000 !important;
      background: #ffffff !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .receipt-paper {
      width: 100% !important;
      min-height: 0 !important;
      height: auto !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: #ffffff !important;
      color: #000000 !important;
      box-shadow: none !important;
      font-size: var(--receipt-font-size, 10px) !important;
      font-synthesis: weight;
      font-weight: var(--receipt-print-weight, 900) !important;
      text-rendering: geometricPrecision;
      overflow: visible !important;
      overflow-wrap: anywhere;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .receipt-paper *,
    .receipt-section,
    .receipt-items,
    .receipt-item,
    .receipt-total-section,
    .receipt-footer {
      background: #ffffff !important;
      color: #000000 !important;
      opacity: 1 !important;
      box-shadow: none !important;
      font-synthesis: weight;
      text-shadow: var(--receipt-print-shadow, 0.18px 0 0 #000000) !important;
      -webkit-text-stroke: var(--receipt-print-stroke, 0.16px) #000000;
    }
    .receipt-brand {
      display: grid;
      gap: 3px;
      padding-bottom: 10px;
      border-bottom: 1px dashed #000000;
      text-align: center;
    }
    .receipt-brand span,
    .receipt-section h4 {
      color: #000000 !important;
      font-size: max(9px, calc(var(--receipt-font-size, 10px) - 2px));
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .receipt-brand strong {
      color: #000000 !important;
      font-weight: 900;
      font-size: max(15px, calc(var(--receipt-font-size, 10px) + 4px));
      line-height: 1.2;
    }
    .receipt-brand small {
      color: #000000 !important;
      font-size: max(10px, calc(var(--receipt-font-size, 10px) - 1px));
      font-weight: var(--receipt-print-weight, 900);
    }
    .receipt-section {
      padding: 10px 0;
      border-bottom: 1px dashed #000000;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .receipt-section h4 {
      margin: 0 0 7px;
    }
    .receipt-fields {
      display: grid;
      gap: 5px;
      margin: 0;
    }
    .receipt-field {
      display: grid;
      grid-template-columns: minmax(58px, max-content) minmax(0, 1fr);
      gap: 8px;
      font-size: var(--receipt-font-size, 11px);
      line-height: 1.25;
    }
    .receipt-field dt {
      color: #000000 !important;
      font-weight: 900;
    }
    .receipt-field dd {
      margin: 0;
      color: #000000 !important;
      font-weight: 900;
      overflow-wrap: anywhere;
      text-align: right;
    }
    .receipt[data-paper-width="58mm"] .receipt-field,
    .receipt[data-paper-width="48mm"] .receipt-field {
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
      font-size: max(10px, calc(var(--receipt-font-size, 11px) - 1px));
    }
    .receipt[data-paper-width="58mm"] .receipt-field dd,
    .receipt[data-paper-width="48mm"] .receipt-field dd {
      text-align: left;
    }
    .receipt-items {
      display: grid;
      gap: 8px;
    }
    .receipt-item {
      display: grid;
      gap: 4px;
      font-size: var(--receipt-font-size, 11px);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .receipt-item-meta {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 2px 8px;
    }
    .receipt-item strong {
      display: block;
      color: #000000 !important;
      font-weight: 900;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }
    .receipt-item span,
    .receipt-item em {
      color: #000000 !important;
      font-style: normal;
      font-weight: var(--receipt-print-weight, 900);
      overflow-wrap: anywhere;
    }
    .receipt-item b {
      margin-left: auto;
      color: #000000 !important;
      font-weight: 900;
      white-space: nowrap;
    }
    .receipt-total-section {
      border-bottom: 0;
    }
    .receipt-grand-total {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 10px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 2px solid #000000;
    }
    .receipt-grand-total span {
      color: #000000 !important;
      font-size: var(--receipt-font-size, 11px);
      font-weight: 900;
      text-transform: uppercase;
    }
    .receipt-grand-total strong {
      color: #000000 !important;
      font-weight: 900;
      font-size: 22px;
      line-height: 1;
    }
    .receipt[data-paper-width="58mm"] .receipt-grand-total strong {
      font-size: 18px;
    }
    .receipt[data-paper-width="48mm"] .receipt-grand-total strong {
      font-size: 16px;
    }
    .receipt-footer {
      padding: 10px 4px 2px;
      border-top: 1px dashed #000000;
      color: #000000 !important;
      font-size: var(--receipt-font-size, 11px);
      font-weight: 900;
      line-height: 1.35;
      text-align: center;
      break-inside: avoid;
      page-break-inside: avoid;
    }
  `;
}

function buildReceiptPrintDocument(node, paperWidth, pageHeight) {
  const fontSize = node.style.getPropertyValue("--receipt-font-size") || "10px";
  const sideMargin = node.style.getPropertyValue("--receipt-print-side-margin") || "3mm";
  const printWeight = node.style.getPropertyValue("--receipt-print-weight") || "900";
  const printStroke = node.style.getPropertyValue("--receipt-print-stroke") || "0.16px";
  const printShadow = node.style.getPropertyValue("--receipt-print-shadow") || "0.18px 0 0 #000000, -0.18px 0 0 #000000, 0 0.18px 0 #000000";
  const compactSmallPaper = node.dataset.compactSmallPaper || "1";
  const printDensity = node.dataset.printDensity || "strong";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base href="${escapeHtml(document.baseURI)}">
  <title>Cupom</title>
  <style id="receipt-frame-page-style">${receiptPrintCss(paperWidth, pageHeight)}</style>
</head>
<body>
  <div id="print-area" class="receipt" data-paper-width="${escapeHtml(paperWidth)}" data-compact-small-paper="${escapeHtml(compactSmallPaper)}" data-print-density="${escapeHtml(printDensity)}" style="--receipt-font-size: ${escapeHtml(fontSize)}; --receipt-print-side-margin: ${escapeHtml(sideMargin)}; --receipt-print-weight: ${escapeHtml(printWeight)}; --receipt-print-stroke: ${escapeHtml(printStroke)}; --receipt-print-shadow: ${escapeHtml(printShadow)};">
    ${node.innerHTML}
  </div>
</body>
</html>`;
}

function printReceiptInFrame(node, finishPrint) {
  if (!node?.innerHTML) return false;
  const paperWidth = normalizeReceiptPaperWidth(node.dataset.paperWidth, "80mm");
  const firstHeight = receiptPrintPageHeight(node);
  const frame = document.createElement("iframe");
  frame.title = "Impressao do cupom";
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.style.opacity = "0";
  frame.style.pointerEvents = "none";
  document.body.appendChild(frame);

  const cleanup = () => {
    setTimeout(() => frame.remove(), 250);
    finishPrint();
  };

  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument || frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    frame.remove();
    return false;
  }

  frameWindow.addEventListener("afterprint", cleanup, { once: true });
  frameDocument.open();
  frameDocument.write(buildReceiptPrintDocument(node, paperWidth, firstHeight));
  frameDocument.close();

  setTimeout(() => {
    const frameNode = frameDocument.getElementById("print-area");
    const finalHeight = receiptPrintPageHeight(frameNode);
    const style = frameDocument.getElementById("receipt-frame-page-style");
    if (style) style.textContent = receiptPrintCss(paperWidth, finalHeight);
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch (error) {
      cleanup();
      throw error;
    }
  }, 120);

  return frame;
}

function setReceiptPrintPageStyle(enabled) {
  const styleId = "receipt-print-page-style";
  let style = document.getElementById(styleId);
  if (!enabled) {
    style?.remove();
    return;
  }
  const node = receiptNode();
  const paperWidth = normalizeReceiptPaperWidth(node?.dataset.paperWidth, "80mm");
  const pageHeight = receiptPrintPageHeight(node);
  if (!style) {
    style = document.createElement("style");
    style.id = styleId;
    document.head.appendChild(style);
  }
  style.textContent = receiptPrintCss(paperWidth, pageHeight);
}

function setReceiptPrintMode(enabled) {
  const active = Boolean(enabled);
  document.body?.classList.toggle("receipt-print-mode", active);
  setReceiptPrintPageStyle(active);
}

function clearReceiptPrintMode() {
  setReceiptPrintMode(false);
}

function printCurrentReceipt(copies = 1, options = {}) {
  const now = Date.now();
  if (now < state.printingUntil) {
    showToast("Impressao ja em andamento. Aguarde alguns segundos.", "info");
    return false;
  }
  const printOptions = typeof options === "boolean" ? { hideAfterPrint: options } : options;
  state.printingUntil = now + 3500;
  const requestedCopies = Math.max(1, Math.min(3, Math.round(toNumber(copies, 1))));
  if (requestedCopies > 1) {
    showToast("Cupom enviado uma vez. Ajuste a quantidade de copias na janela da impressora.", "info");
  }
  const node = receiptNode();
  let finished = false;
  let fallbackTimer = null;
  let printFrame = null;
  const finishPrint = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener("afterprint", finishPrint);
    window.removeEventListener("focus", finishAfterFocus);
    document.removeEventListener("visibilitychange", finishAfterVisible);
    if (fallbackTimer) clearTimeout(fallbackTimer);
    if (printFrame?.remove) printFrame.remove();
    state.printingUntil = 0;
    clearReceiptPrintMode();
    if (printOptions.hideAfterPrint) hideReceipt();
    if (printOptions.restoreFocus) focusPdvSearch();
  };
  const finishAfterFocus = () => setTimeout(finishPrint, 150);
  const finishAfterVisible = () => {
    if (document.visibilityState === "visible") finishAfterFocus();
  };
  try {
    printFrame = printReceiptInFrame(node, finishPrint);
    if (printFrame) {
      fallbackTimer = setTimeout(finishPrint, 120000);
      return true;
    }

    setReceiptPrintMode(true);
    window.addEventListener("afterprint", finishPrint, { once: true });
    window.addEventListener("focus", finishAfterFocus, { once: true });
    document.addEventListener("visibilitychange", finishAfterVisible);
    fallbackTimer = setTimeout(finishPrint, 120000);
    setReceiptPrintPageStyle(true);
    window.print();
  } catch (error) {
    finishPrint();
    throw error;
  }
  return true;
}

function receiptFirst(...values) {
  return values.find((value) => normalizeText(value)) || "";
}

function receiptDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR");
}

function receiptQuantity(value) {
  const qty = toNumber(value, 1);
  return qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
}

function receiptVisibleRows(rows) {
  return rows.filter((row) => row && normalizeText(row.value));
}

function receiptFieldsHtml(rows) {
  const visibleRows = receiptVisibleRows(rows);
  if (!visibleRows.length) return "";
  return `<dl class="receipt-fields">${visibleRows.map((row) => `
    <div class="receipt-field">
      <dt>${escapeHtml(row.label)}</dt>
      <dd>${escapeHtml(row.value)}</dd>
    </div>
  `).join("")}</dl>`;
}

function receiptTextRows(rows) {
  return receiptVisibleRows(rows).map((row) => `${row.label}: ${row.value}`);
}

function receiptSectionHtml(title, rows) {
  const html = receiptFieldsHtml(rows);
  if (!html) return "";
  return `
    <section class="receipt-section">
      <h4>${escapeHtml(title)}</h4>
      ${html}
    </section>
  `;
}

function receiptSectionText(title, rows) {
  const lines = receiptTextRows(rows);
  return lines.length ? [title.toUpperCase(), ...lines] : [];
}

function receiptMoney(value, fallback = 0) {
  return money.format(toNumber(value, fallback));
}

function receiptEffectiveOptions(pdv = {}, receiptOptions = {}) {
  const paperWidth = normalizeReceiptPaperWidth(pdv.receiptPaperWidth);
  const compact = pdv.compactSmallPaper !== false && paperWidth !== "80mm";
  if (!compact) return receiptOptions;
  return {
    ...receiptOptions,
    systemTitle: false,
    phone: false,
    clientPhone: false,
    fees: false,
    netTotal: false,
    address: paperWidth === "58mm" ? receiptOptions.address : false,
    clientDocument: paperWidth === "58mm" ? receiptOptions.clientDocument : false,
    itemCode: paperWidth === "58mm" ? receiptOptions.itemCode : false,
    subtotal: paperWidth === "58mm" ? receiptOptions.subtotal : false,
  };
}

function receiptSaleData(sale, pdv, receiptOptions) {
  const store = state.settings.store || {};
  const simple = pdv.receiptType === "simples";
  const items = Array.isArray(sale.items) ? sale.items : [];
  const subtotal = toNumber(sale.subtotal ?? sale.grossTotal, toNumber(sale.total));
  const discount = toNumber(sale.discount);
  const feeValue = toNumber(sale.feeValue ?? sale.fees);
  const total = toNumber(sale.total, subtotal - discount);
  const received = toNumber(sale.received ?? sale.amountReceived ?? sale.valor_pago);
  const change = toNumber(sale.change);
  const storeName = receiptFirst(store.storeName, store.name, state.settings.companyName, "MPTech Gestao");
  const storeLocation = [store.city, store.state].filter(Boolean).join(" / ");
  const footer = state.settings.store?.receiptFooter || "Obrigado pela preferencia. Volte sempre!";
  const paymentRaw = receiptFirst(sale.payment, sale.pagamento);
  const payment = paymentRaw ? normalizePayment(paymentRaw) : "";
  const itemRows = simple
    ? [{
        name: `${items.length} item(ns)`,
        detail: "Resumo da venda",
        qty: "",
        total,
      }]
    : items.map((item) => {
        const qty = toNumber(item.qty, 1);
        const unit = toNumber(item.price ?? item.unitPrice, qty ? toNumber(item.total) / qty : 0);
        return {
          name: item.name || "Produto",
          detail: receiptOptions.itemCode && item.code ? `Cod. ${item.code}` : "",
          qty: `${receiptQuantity(qty)} x ${receiptMoney(unit)}`,
          total: toNumber(item.total, qty * unit),
        };
      });

  return {
    title: receiptOptions.systemTitle ? "MPTech Gestao" : "",
    storeName: receiptOptions.storeName ? storeName : "",
    storeRows: [
      { label: "CNPJ/CPF", value: receiptOptions.document ? receiptFirst(store.cnpj, store.document) : "" },
      { label: "Endereco", value: receiptOptions.address ? receiptFirst(store.address, store.endereco) : "" },
      { label: "Cidade/UF", value: receiptOptions.cityState ? storeLocation : "" },
      { label: "Telefone", value: receiptOptions.phone ? receiptFirst(store.phone, store.telefone, store.whatsapp) : "" },
    ],
    saleRows: [
      { label: "Venda", value: receiptOptions.saleId ? sale.id : "" },
      { label: "Data", value: receiptOptions.date ? receiptDateTime(sale.date || sale.createdAt || Date.now()) : "" },
      { label: "Pagamento", value: receiptOptions.payment ? payment : "" },
      { label: "Vendedor", value: receiptOptions.seller ? receiptFirst(sale.vendedorNome, sale.sellerName) : "" },
    ],
    clientRows: [
      { label: "Cliente", value: receiptOptions.clientName ? receiptFirst(sale.client, sale.clientName) : "" },
      { label: "Documento", value: receiptOptions.clientDocument ? receiptFirst(sale.clientDocument, sale.documento_cliente) : "" },
      { label: "Telefone", value: receiptOptions.clientPhone ? receiptFirst(sale.clientPhone, sale.telefone_cliente) : "" },
    ],
    totalRows: [
      { label: "Subtotal", value: !simple && receiptOptions.subtotal ? receiptMoney(subtotal) : "" },
      { label: "Desconto", value: !simple && receiptOptions.discount ? receiptMoney(discount) : "" },
      { label: "Taxas", value: !simple && receiptOptions.fees && feeValue ? receiptMoney(feeValue) : "" },
      { label: "Liquido", value: receiptOptions.netTotal && feeValue ? receiptMoney(sale.netTotal ?? total - feeValue) : "" },
      { label: "Recebido", value: receiptOptions.cashReceived && payment === "Dinheiro" ? receiptMoney(received) : "" },
      { label: "Troco", value: receiptOptions.cashReceived && payment === "Dinheiro" ? receiptMoney(change) : "" },
    ],
    itemRows: receiptOptions.items ? itemRows : [],
    total,
    footer: receiptOptions.footer ? footer : "",
  };
}

function buildReceiptHtml(sale, pdv, receiptOptions) {
  const data = receiptSaleData(sale, pdv, receiptEffectiveOptions(pdv, receiptOptions));
  const hasBrand = data.title || data.storeName;
  return `
    <div class="receipt-paper">
      <header class="receipt-brand">
        ${data.title ? `<span>${escapeHtml(data.title)}</span>` : ""}
        <strong>${escapeHtml(data.storeName || "Comprovante")}</strong>
        <small>Comprovante de venda</small>
      </header>
      ${receiptSectionHtml("Loja", data.storeRows)}
      ${receiptSectionHtml("Venda", data.saleRows)}
      ${receiptSectionHtml("Cliente", data.clientRows)}
      ${data.itemRows.length ? `
        <section class="receipt-section receipt-items-section">
          <h4>Itens</h4>
          <div class="receipt-items">
            ${data.itemRows.map((item) => `
              <div class="receipt-item">
                <strong class="receipt-item-title">${escapeHtml(item.name)}</strong>
                <div class="receipt-item-meta">
                  ${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ""}
                  ${item.qty ? `<em>${escapeHtml(item.qty)}</em>` : ""}
                  <b>${receiptMoney(item.total)}</b>
                </div>
              </div>
            `).join("")}
          </div>
        </section>
      ` : ""}
      <section class="receipt-section receipt-total-section">
        ${receiptFieldsHtml(data.totalRows)}
        <div class="receipt-grand-total">
          <span>Total</span>
          <strong>${receiptMoney(data.total)}</strong>
        </div>
      </section>
      ${data.footer ? `<footer class="receipt-footer">${escapeHtml(data.footer)}</footer>` : ""}
      ${hasBrand ? "" : `<span class="sr-only">Comprovante</span>`}
    </div>
  `;
}

function buildReceiptText(sale, pdv, receiptOptions) {
  const data = receiptSaleData(sale, pdv, receiptEffectiveOptions(pdv, receiptOptions));
  const lines = [];
  if (data.title) lines.push(`${data.title} - Comprovante`);
  if (data.storeName) lines.push(data.storeName);
  lines.push(...receiptTextRows(data.storeRows));
  lines.push("");
  lines.push(...receiptSectionText("Venda", data.saleRows));
  lines.push(...receiptSectionText("Cliente", data.clientRows));
  if (data.itemRows.length) {
    lines.push("", "ITENS");
    data.itemRows.forEach((item) => {
      const qty = item.qty ? ` | ${item.qty}` : "";
      const detail = item.detail ? ` (${item.detail})` : "";
      lines.push(`${item.name}${detail}${qty} - ${receiptMoney(item.total)}`);
    });
  }
  lines.push("");
  lines.push(...receiptTextRows(data.totalRows));
  lines.push(`TOTAL: ${receiptMoney(data.total)}`);
  if (data.footer) lines.push("", data.footer);
  return lines.filter((line, index, all) => line || (all[index - 1] && all[index + 1])).join("\n");
}

function renderReceipt(sale) {
  const pdv = { ...defaultSettings().pdv, ...(state.settings.pdv || {}) };
  const receiptOptions = { ...defaultSettings().pdv.receiptOptions, ...(pdv.receiptOptions || {}) };
  const paperWidth = normalizeReceiptPaperWidth(pdv.receiptPaperWidth);
  const printDensity = normalizeReceiptPrintDensity(pdv.receiptPrintDensity);
  const minimumFontSize = paperWidth === "80mm" && ["strong", "maximum"].includes(printDensity) ? 11.5 : 8;
  const fontSize = Math.max(minimumFontSize, Math.min(13, toNumber(pdv.receiptFontSize, 12)));
  const sideMargin = Math.max(0, Math.min(8, toNumber(pdv.receiptSideMarginMm, 3)));
  const printDensityStyles = receiptPrintDensityStyles(printDensity);
  const node = receiptNode();
  if (!node) return;
  node.classList.remove("hidden");
  node.dataset.paperWidth = paperWidth;
  node.dataset.compactSmallPaper = pdv.compactSmallPaper !== false ? "1" : "0";
  node.dataset.printDensity = printDensity;
  node.style.width = paperWidth;
  node.style.maxWidth = paperWidth;
  node.style.setProperty("--receipt-font-size", `${fontSize}px`);
  node.style.setProperty("--receipt-print-side-margin", `${sideMargin}mm`);
  node.style.setProperty("--receipt-print-weight", printDensityStyles.weight);
  node.style.setProperty("--receipt-print-stroke", printDensityStyles.stroke);
  node.style.setProperty("--receipt-print-shadow", printDensityStyles.shadow);
  node.innerHTML = buildReceiptHtml(sale, pdv, receiptOptions);
  node.dataset.receiptText = buildReceiptText(sale, pdv, receiptOptions);
}

function renderProducts() {
  const lowStock = lowStockProducts();
  const activeProducts = state.data.products.filter((product) => product.active !== false);
  const totalStock = activeProducts.reduce((sum, product) => sum + toNumber(product.stock), 0);
  const stockValue = activeProducts.reduce((sum, product) => sum + toNumber(product.cost) * toNumber(product.stock), 0);
  const categories = ["Todas", ...productCategories(activeProducts)];
  renderProductCategoryDatalist();

  $("#inventory-total-products").textContent = activeProducts.length;
  $("#inventory-total-stock").textContent = totalStock.toLocaleString("pt-BR");
  $("#inventory-low-stock").textContent = lowStock.length;
  $("#inventory-stock-value").textContent = money.format(stockValue);
  $("#stock-alert").textContent = lowStock.length ? `${lowStock.length} produto(s) com estoque baixo` : "Estoque em dia";

  $("#inventory-category-filter").innerHTML = categories.map((category) => `
    <option value="${category}" ${state.inventoryCategory === category ? "selected" : ""}>${category === "Todas" ? "Todas as Categorias" : category}</option>
  `).join("");

  const term = state.inventorySearch.toLowerCase();
  const products = activeProducts.filter((product) => {
    const status = productStatus(product);
    const matchesTerm = !term
      || product.name.toLowerCase().includes(term)
      || product.code.toLowerCase().includes(term)
      || (product.barcode || "").toLowerCase().includes(term)
      || product.category.toLowerCase().includes(term);
    const matchesCategory = state.inventoryCategory === "Todas" || product.category === state.inventoryCategory;
    const matchesStatus = state.inventoryStatus === "Todos" || status === state.inventoryStatus;
    return matchesTerm && matchesCategory && matchesStatus;
  });

  $("#inventory-count-label").textContent = `Mostrando ${products.length} de ${activeProducts.length} produtos`;

  $("#products-table").innerHTML = products.length ? products.map((product) => {
    const status = productStatus(product);
    const retail = retailPrice(product);
    const wholesale = wholesalePrice(product);
    const cost = toNumber(product.cost);
    const stock = toNumber(product.stock);
    const minStock = toNumber(product.minStock);
    const marginRetail = productMargin(retail, cost);
    const marginWholesale = productMargin(wholesale, cost);
    return `
    <tr class="${status !== "Normal" ? "low-stock" : ""}">
      <td>${escapeHtml(product.code)}</td>
      <td>
        <div class="inventory-product-cell">
          <span class="cart-thumb">${escapeHtml(product.name.slice(0, 2).toUpperCase())}</span>
          <div>
            <strong>${escapeHtml(product.name)}</strong>
            <small>${escapeHtml(product.category)} | ${escapeHtml(product.supplier || "Sem fornecedor")}</small>
          </div>
        </div>
      </td>
      <td><span class="category-pill">${escapeHtml(product.category)}</span></td>
      <td>${money.format(retail)}</td>
      <td><strong>${money.format(wholesale)}</strong><small>${Math.max(1, toNumber(product.wholesaleMinQty || 1))}+ un.</small></td>
      <td>${money.format(cost)}</td>
      <td><strong>V: ${marginRetail.toFixed(1).replace(".", ",")}%</strong><small>A: ${marginWholesale.toFixed(1).replace(".", ",")}%</small></td>
      <td><strong class="${status === "Normal" ? "stock-ok" : status === "Baixo" ? "stock-warning" : "stock-critical"}">${stock.toLocaleString("pt-BR")}</strong></td>
      <td>${minStock.toLocaleString("pt-BR")}</td>
      <td><span class="status-pill ${status.toLowerCase()}">${productStatusLabel(status)}</span></td>
      <td>
        <div class="actions">
          <button class="icon-action edit-action" title="Editar" data-edit-product="${escapeHtml(product.id)}">✎</button>
          <button class="icon-action" title="Ajustar estoque" data-adjust-stock="${escapeHtml(product.id)}">±</button>
          <button class="icon-action delete-action" title="Excluir" data-delete-product="${escapeHtml(product.id)}">×</button>
        </div>
      </td>
    </tr>
  `;
  }).join("") : `<tr><td colspan="11" class="muted">Nenhum produto encontrado.</td></tr>`;
}

function resetProductForm() {
  $("#product-id").value = "";
  $("#product-form").reset();
  $("#product-form-title").textContent = "Cadastrar produto";
  $("#product-modal").classList.add("hidden");
}

function openProductModal() {
  renderProductCategoryDatalist();
  $("#product-modal").classList.remove("hidden");
  setTimeout(() => ($("#product-id").value ? $("#product-code") : $("#product-name")).focus(), 0);
}

function editProduct(productId) {
  if (!requirePermission("estoque_access", "editar produtos")) return;
  const product = state.data.products.find((item) => item.id === productId);
  if (!product) return;

  $("#product-id").value = product.id;
  $("#product-code").value = product.code;
  $("#product-name").value = product.name;
  $("#product-category").value = product.category;
  $("#product-barcode").value = product.barcode || product.code;
  $("#product-supplier").value = product.supplier || "";
  $("#product-retail-price").value = retailPrice(product);
  $("#product-wholesale-price").value = wholesalePrice(product);
  $("#product-wholesale-min-qty").value = Math.max(1, toNumber(product.wholesaleMinQty || 1));
  $("#product-price").value = retailPrice(product);
  $("#product-cost").value = product.cost;
  $("#product-stock").value = product.stock;
  $("#product-min-stock").value = product.minStock;
  $("#product-form-title").textContent = "Editar produto";
  openProductModal();
}

async function saveProduct(event) {
  event.preventDefault();
  if (!requirePermission("estoque_access", "salvar produtos")) return;

  const productId = $("#product-id").value || makeId("prd");
  const productCode = normalizeText($("#product-code").value) || generateProductCode(productId);
  const product = {
    id: productId,
    code: productCode,
    name: $("#product-name").value.trim(),
    category: normalizeCategoryName($("#product-category").value) || "Geral",
    barcode: $("#product-barcode").value.trim() || productCode,
    supplier: $("#product-supplier").value.trim() || "Não informado",
    retailPrice: toNumber($("#product-retail-price").value),
    wholesalePrice: toNumber($("#product-wholesale-price").value || $("#product-retail-price").value),
    wholesaleMinQty: Math.max(1, toNumber($("#product-wholesale-min-qty").value, 1)),
    cost: toNumber($("#product-cost").value),
    stock: Math.max(0, toNumber($("#product-stock").value)),
    minStock: Math.max(0, toNumber($("#product-min-stock").value)),
    active: true,
  };
  product.price = product.retailPrice;

  const duplicatedCode = state.data.products.some((item) => item.code === product.code && item.id !== product.id);
  if (!product.name || product.retailPrice < 0 || product.wholesalePrice < 0 || product.cost < 0) {
    showToast("Informe nome e valores validos para o produto.", "error");
    return;
  }
  if (duplicatedCode) {
    showToast("Já existe um produto com esse código.", "error");
    return;
  }

  const index = state.data.products.findIndex((item) => item.id === product.id);
  if (index >= 0) {
    state.data.products[index] = product;
  } else {
    state.data.products.unshift(product);
  }

  saveDataWithAudit(index >= 0 ? "Produto editado" : "Produto cadastrado", product.name);
  resetProductForm();
  renderAll();
  showToast(index >= 0 ? "Produto atualizado." : "Produto cadastrado.", "success");
  if (product.stock <= product.minStock) notifyEvent("lowStock", `${product.name} esta com estoque baixo.`, "info");
  syncProduct(product);
}

async function deleteProduct(productId) {
  if (!requirePermission("estoque_access", "excluir produtos")) return;
  const product = state.data.products.find((item) => item.id === productId);
  if (!product) return;
  const confirmed = await confirmAction("Excluir produto", `Excluir o produto ${product.name}?`, { danger: true, confirmText: "Excluir" });
  if (!confirmed) return;

  const hasSales = state.data.sales.some((sale) => sale.items.some((item) => item.productId === productId));
  if (hasSales) {
    product.active = false;
    syncProduct(product);
    showToast("Produto possui vendas vinculadas e foi inativado em vez de excluído.", "info");
  } else {
    state.data.products = state.data.products.filter((item) => item.id !== productId);
    if (localDatabaseService?.remove && hasLocalApiSession()) {
      localDatabaseService.remove("produtos", productId).catch(() => {
        state.localDbAvailable = false;
      });
    }
  }
  state.cart = state.cart.filter((item) => item.id !== productId);
  saveDataWithAudit(hasSales ? "Produto inativado" : "Produto excluído", product.name);
  renderAll();
}

function filteredFinance() {
  const start = $("#filter-start").value;
  const end = $("#filter-end").value;
  const entries = [
    ...state.data.sales.filter((sale) => !sale.canceled).map((sale) => ({
      id: sale.id,
      date: sale.date,
      type: "Entrada",
      description: `Venda ${sale.id}`,
      payment: sale.payment,
      value: sale.netTotal || sale.total,
      category: "Vendas",
    })),
    ...state.data.expenses.map((expense) => ({
      id: expense.id,
      date: `${expense.date}T12:00:00`,
      type: "Saída",
      description: expense.description,
      payment: "-",
      value: expense.value,
      category: expense.category || "Geral",
    })),
  ];

  return entries
    .filter((entry) => {
      const day = new Date(entry.date).toISOString().slice(0, 10);
      return (!start || day >= start) && (!end || day <= end);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

function salesInDateRange(start = "", end = "", sellerId = "") {
  return state.data.sales.filter((sale) => {
    if (sale.canceled) return false;
    const day = movementDay(sale.date);
    const saleSellerId = sale.vendedorId || sale.sellerId || "";
    return (!start || day >= start) && (!end || day <= end) && (!sellerId || saleSellerId === sellerId);
  });
}

function commissionRows(sales = []) {
  const rows = new Map();
  sales.forEach((sale) => {
    const sellerId = sale.vendedorId || sale.sellerId || "sem-vendedor";
    const sellerName = sale.vendedorNome || sale.sellerName || "Sem vendedor";
    const current = rows.get(sellerId) || { sellerId, sellerName, count: 0, total: 0, percentSum: 0, commission: 0 };
    const netTotal = toNumber(sale.netTotal ?? sale.total);
    const percent = toNumber(sale.commissionPercent);
    current.count += 1;
    current.total += netTotal;
    current.percentSum += percent;
    current.commission += sale.commissionCanceled ? 0 : toNumber(sale.commissionValue);
    rows.set(sellerId, current);
  });
  return Array.from(rows.values()).map((row) => ({
    ...row,
    percent: row.count ? row.percentSum / row.count : 0,
  }));
}

function renderCommissionSellerOptions() {
  const select = $("#commission-seller");
  if (!select) return;
  const current = select.value;
  select.innerHTML = [
    `<option value="">Todos</option>`,
    ...activeSellers().map((seller) => {
      const id = seller.id || seller.username;
      return `<option value="${escapeHtml(id)}">${escapeHtml(seller.name || seller.username || "Vendedor")}</option>`;
    }),
  ].join("");
  select.value = current;
}

function renderCommissionReport() {
  renderCommissionSellerOptions();
  const start = $("#commission-start")?.value || "";
  const end = $("#commission-end")?.value || "";
  const sellerId = $("#commission-seller")?.value || "";
  const rows = commissionRows(salesInDateRange(start, end, sellerId));
  const table = $("#commission-report-table");
  if (!table) return;
  if (!canViewCommissions()) {
    table.innerHTML = `<tr><td colspan="5" class="muted">Relatorio de comissoes restrito ao administrador.</td></tr>`;
    applySensitiveDataVisibility();
    return;
  }
  table.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.sellerName)}</td>
        <td>${row.count}</td>
        <td>${money.format(row.total)}</td>
        <td>${row.percent.toFixed(2).replace(".", ",")}%</td>
        <td>${money.format(row.commission)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="muted">Nenhuma comissao no periodo.</td></tr>`;
}

function renderFinance() {
  const entries = filteredFinance();
  const sales = entries.filter((entry) => entry.type === "Entrada");
  const expenses = entries.filter((entry) => entry.type === "Saída");
  const totalSales = sales.reduce((sum, entry) => sum + entry.value, 0);
  const totalExpenses = expenses.reduce((sum, entry) => sum + entry.value, 0);
  const commission = commissionRows(salesInDateRange($("#filter-start").value, $("#filter-end").value));
  const commissionTotal = commission.reduce((sum, row) => sum + row.commission, 0);

  $("#finance-overview-income").textContent = money.format(totalSales);
  $("#finance-overview-expenses").textContent = money.format(totalExpenses);
  $("#finance-overview-balance").textContent = money.format(totalSales - totalExpenses);
  $("#finance-overview-sales-count").textContent = sales.length;
  $("#finance-sales-total").textContent = money.format(totalSales);
  $("#finance-expense-total").textContent = money.format(totalExpenses);
  $("#finance-balance").textContent = money.format(totalSales - totalExpenses);
  setText("#finance-commission-total", money.format(commissionTotal));
  const commissionSummary = $("#finance-commission-summary");
  if (commissionSummary) {
    commissionSummary.innerHTML = !canViewCommissions()
      ? `<p class="muted">Comissoes restritas ao administrador.</p>`
      : commission.length
      ? commission.map((row) => `<article><span>${escapeHtml(row.sellerName)}</span><strong>${money.format(row.commission)}</strong><small>${row.count} venda(s) | ${money.format(row.total)}</small></article>`).join("")
      : `<p class="muted">Nenhuma comissao no periodo.</p>`;
  }

  $("#finance-table").innerHTML = entries.length
    ? entries.map((entry) => `
      <tr>
        <td>${new Date(entry.date).toLocaleDateString("pt-BR")}</td>
        <td>${entry.type}</td>
      <td>${entry.description}</td>
      <td>${entry.payment}</td>
      <td>${money.format(entry.value)}</td>
      <td>${entry.type === "Entrada" ? `<button class="btn small danger" data-cancel-sale="${entry.id}">Cancelar</button>` : "-"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" class="muted">Nenhum movimento no período.</td></tr>`;
}

function renderCash() {
  const session = currentCashSession();
  const statusText = session ? `Aberto desde ${new Date(session.openedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Fechado";
  const totalText = money.format(currentCashTotal());
  $("#cash-status").textContent = statusText;
  $("#cash-session-total").textContent = totalText;
  $("#pdv-cash-status").textContent = statusText;
  $("#pdv-cash-total").textContent = totalText;
  $("#open-cash").disabled = Boolean(session);
  $("#pdv-open-cash").disabled = Boolean(session);
  $("#cash-in").disabled = !session;
  $("#cash-out").disabled = !session;
  $("#close-cash").disabled = !session;
  $("#pdv-close-cash").disabled = !session;
  const history = $("#cash-history-table");
  if (history) {
    history.innerHTML = state.data.cashSessions.length
      ? state.data.cashSessions.map((cash) => `
        <tr>
          <td>${cash.openedAt ? new Date(cash.openedAt).toLocaleString("pt-BR") : "-"}</td>
          <td>${cash.closedAt ? new Date(cash.closedAt).toLocaleString("pt-BR") : "Aberto"}</td>
          <td>${money.format(toNumber(cash.openingValue))}</td>
          <td>${money.format(toNumber(cash.totalSold ?? cashSoldTotal(cash)))}</td>
          <td>${money.format(toNumber(cash.expectedValue ?? cash.closingValue ?? cashSoldTotal(cash) + toNumber(cash.openingValue)))}</td>
          <td>${cash.closedAt ? money.format(toNumber(cash.closingValue)) : "-"}</td>
          <td>${cash.closedAt ? money.format(toNumber(cash.cashDifference ?? toNumber(cash.closingValue) - toNumber(cash.expectedValue))) : "-"}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="7" class="muted">Nenhuma abertura registrada.</td></tr>`;
  }
}

async function openCash() {
  if (!requirePermission("financeiro_access", "abrir caixa")) return;
  if (currentCashSession()) return;
  const result = await promptFields("Abrir caixa", [
    { name: "openingValue", label: "Valor inicial (R$)", type: "number", value: "0", min: "0", placeholder: "R$ 0,00", required: true },
  ], { confirmText: "Abrir caixa" });
  if (!result) return;
  const openingValue = Math.max(0, toNumber(result.openingValue));
  const session = {
    id: makeId("cash-session"),
    openedAt: new Date().toISOString(),
    openingValue,
    movements: [],
    closedAt: null,
    closingValue: null,
  };
  state.data.cashSessions.unshift(session);
  syncCashSession(session);
  saveDataWithAudit("Caixa aberto", money.format(openingValue));
  renderAll();
  showToast("Caixa aberto.", "success");
}

async function moveCash(type) {
  if (!requirePermission("financeiro_access", "movimentar caixa")) return;
  const session = currentCashSession();
  if (!session) return;
  const label = type === "in" ? "Reforço" : "Sangria";
  const result = await promptFields(label, [
    { name: "value", label: "Valor (R$)", type: "number", value: "0", min: "0", placeholder: "R$ 0,00", required: true },
    { name: "description", label: "Descricao", value: label, required: true },
  ]);
  if (!result) return;
  const value = toNumber(result.value);
  if (value <= 0) return;
  const description = normalizeText(result.description) || label;
  const movement = {
    id: makeId("cash"),
    type,
    date: new Date().toISOString(),
    description,
    value,
    payment: "Dinheiro",
  };
  session.movements.push(movement);
  syncCashMovement(session.id, movement);
  saveDataWithAudit(label, `${description} - ${money.format(value)}`);
  renderAll();
}

async function closeCash() {
  if (!requirePermission("financeiro_access", "fechar caixa")) return;
  const session = currentCashSession();
  if (!session) return;
  const calculated = currentCashTotal();
  const result = await promptFields("Fechar caixa", [
    { name: "closingValue", label: "Valor contado (R$)", type: "number", value: calculated.toFixed(2), min: "0", placeholder: "R$ 0,00", required: true },
  ], { confirmText: "Fechar caixa" });
  if (!result) return;
  const closingValue = Math.max(0, toNumber(result.closingValue, calculated));
  session.closedAt = new Date().toISOString();
  session.expectedValue = calculated;
  session.totalSold = cashSoldTotal(session);
  session.closingValue = closingValue;
  session.cashDifference = closingValue - calculated;
  syncCashSession(session);
  saveDataWithAudit("Caixa fechado", `Vendido ${money.format(session.totalSold)} | Esperado ${money.format(calculated)} | Contado ${money.format(closingValue)} | Diferenca ${money.format(session.cashDifference)}`);
  renderAll();
  showToast("Caixa fechado.", "success");
}

function renderFinanceDetailScreens() {
  const incomeTotal = salesTotal(state.data.sales);
  const expensesTotal = expenseTotal(state.data.expenses);
  const validSales = state.data.sales.filter((sale) => !sale.canceled);

  $("#income-total").textContent = money.format(incomeTotal);
  $("#income-table").innerHTML = validSales.length
    ? validSales.map((sale) => `
      <tr>
        <td>${new Date(sale.date).toLocaleString("pt-BR")}</td>
        <td>Venda ${sale.id.slice(-6).toUpperCase()}</td>
        <td>${sale.payment}</td>
        <td>${sale.items.reduce((sum, item) => sum + item.qty, 0)}</td>
        <td>${money.format(sale.total)}</td>
        <td><button class="btn small danger" data-cancel-income="${sale.id}">Cancelar</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" class="muted">Nenhuma entrada registrada.</td></tr>`;

  $("#expenses-total").textContent = money.format(expensesTotal);
  $("#expenses-table").innerHTML = state.data.expenses.length
    ? state.data.expenses.map((expense) => `
      <tr>
        <td>${new Date(`${expense.date}T12:00:00`).toLocaleDateString("pt-BR")}</td>
        <td>${expense.description}</td>
        <td>${expense.category || "Geral"}</td>
        <td>${money.format(expense.value)}</td>
        <td><button class="btn small danger" data-delete-expense="${expense.id}">Excluir</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="5" class="muted">Nenhuma saída registrada.</td></tr>`;
}

function renderAccounts() {
  $("#payable-table").innerHTML = state.data.accountsPayable.length
    ? state.data.accountsPayable.map((account) => `
      <tr>
        <td>${new Date(`${account.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</td>
        <td>${account.description}</td>
        <td>${account.category}</td>
        <td><span class="status-pill ${account.status === "Pago" ? "normal" : "baixo"}">${account.status}</span></td>
        <td>${money.format(account.value)}</td>
        <td><button class="btn small ghost" data-pay-account="${account.id}">${account.status === "Pago" ? "Reabrir" : "Pagar"}</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" class="muted">Nenhuma conta a pagar cadastrada.</td></tr>`;

  $("#receivable-table").innerHTML = state.data.accountsReceivable.length
    ? state.data.accountsReceivable.map((account) => `
      <tr>
        <td>${new Date(`${account.dueDate}T12:00:00`).toLocaleDateString("pt-BR")}</td>
        <td>${account.client}</td>
        <td>${account.description}</td>
        <td><span class="status-pill ${account.status === "Recebido" ? "normal" : "baixo"}">${account.status}</span></td>
        <td>${money.format(account.value)}</td>
        <td><button class="btn small ghost" data-receive-account="${account.id}">${account.status === "Recebido" ? "Reabrir" : "Receber"}</button></td>
      </tr>
    `).join("")
    : `<tr><td colspan="6" class="muted">Nenhuma conta a receber cadastrada.</td></tr>`;
}

function saveExpense(event) {
  event.preventDefault();
  if (!requirePermission("financeiro_access", "salvar despesas")) return;
  const suffix = event.target.id === "expense-form-secondary" ? "-secondary" : "";
  const expense = {
    id: makeId("exp"),
    date: $(`#expense-date${suffix}`).value,
    description: $(`#expense-description${suffix}`).value.trim(),
    category: $(`#expense-category${suffix}`).value.trim(),
    value: Number($(`#expense-value${suffix}`).value),
    type: "expense",
  };
  state.data.expenses.unshift(expense);
  syncExpense(expense);
  saveData();
  event.target.reset();
  $("#expense-date").value = todayISO();
  $("#expense-date-secondary").value = todayISO();
  renderAll();
}

function saleItemsSummaryHtml(sale) {
  return (sale.items || [])
    .map((item) => `${escapeHtml(item.qty)}x ${escapeHtml(item.name)}`)
    .join("<br>");
}

function selectedSale() {
  return state.data.sales.find((sale) => sale.id === state.selectedSaleId) || null;
}

function updateSelectedSalePrintButton() {
  const button = $("#reprint-selected-sale");
  if (!button) return;
  const sale = selectedSale();
  const canPrint = Boolean(sale && !sale.canceled);
  button.disabled = !canPrint;
  button.textContent = "Reimprimir cupom";
  button.title = sale?.canceled ? "Venda cancelada nao pode ser reimpressa." : sale ? "" : "Selecione uma venda.";
}

function renderSalesHistory() {
  if (state.selectedSaleId && !selectedSale()) state.selectedSaleId = "";

  const summaryTable = $("#sales-table");
  if (summaryTable) {
    summaryTable.innerHTML = state.data.sales.length
      ? state.data.sales.map((sale) => `
        <tr>
          <td>${new Date(sale.date).toLocaleString("pt-BR")}</td>
          <td>${saleItemsSummaryHtml(sale)}</td>
          <td>${escapeHtml(sale.payment)}</td>
          <td>${sale.canceled ? `<span class="status-pill critico">Cancelada</span>` : money.format(sale.total)}</td>
        </tr>
      `).join("")
      : `<tr><td colspan="4" class="muted">Nenhuma venda realizada.</td></tr>`;
  }

  updateSelectedSalePrintButton();

  const fullTable = $("#sales-full-table");
  if (!fullTable) return;
  fullTable.innerHTML = state.data.sales.length
    ? state.data.sales.map((sale) => {
      const isSelected = sale.id === state.selectedSaleId;
      return `
        <tr class="sales-row ${isSelected ? "selected" : ""}" data-select-sale="${escapeHtml(sale.id)}" aria-selected="${isSelected ? "true" : "false"}">
          <td><button class="btn small ghost sale-select-btn ${isSelected ? "active" : ""}" type="button" data-select-sale="${escapeHtml(sale.id)}">${isSelected ? "Selecionada" : "Selecionar"}</button></td>
          <td>${new Date(sale.date).toLocaleString("pt-BR")}</td>
          <td>${saleItemsSummaryHtml(sale)}</td>
          <td>${escapeHtml(sale.payment)}</td>
          <td>${money.format(sale.discount || 0)}</td>
          <td>${money.format(sale.total)}</td>
          <td class="sale-row-actions">
            <button class="btn small ghost" type="button" data-view-sale="${escapeHtml(sale.id)}">Ver</button>
            ${sale.canceled ? `<span class="status-pill critico">Cancelada</span>` : `<button class="btn small ghost" type="button" data-copy-receipt="${escapeHtml(sale.id)}">Copiar</button> <button class="btn small ghost" type="button" data-whatsapp-sale="${escapeHtml(sale.id)}">WhatsApp</button> <button class="btn small danger" type="button" data-cancel-sale="${escapeHtml(sale.id)}">Cancelar</button>`}
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="7" class="muted">Nenhuma venda realizada.</td></tr>`;
}

function percent(value, total) {
  return total ? Math.round((value / total) * 100) : 0;
}

function clientNameForDisplay(client = {}) {
  return normalizeText(client.name || client.nome || client.razaoSocial || client.razao_social || "Cliente");
}

function clientInitials(name) {
  return normalizeText(name)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "CL";
}

function openReceivablesByClient() {
  return state.data.accountsReceivable
    .filter((account) => account.status !== "Recebido")
    .reduce((acc, account) => {
      const key = account.client || "Cliente";
      acc[key] = (acc[key] || 0) + toNumber(account.remainingValue ?? account.value);
      return acc;
    }, {});
}

function purchasedByClient() {
  return state.data.sales
    .filter((sale) => !sale.canceled && (sale.client || sale.clientName))
    .reduce((acc, sale) => {
      const key = sale.client || sale.clientName;
      acc[key] = (acc[key] || 0) + toNumber(sale.netTotal ?? sale.total);
      return acc;
    }, {});
}

function lastPurchaseByClient() {
  return state.data.sales
    .filter((sale) => !sale.canceled && (sale.clientId || sale.cliente_id || sale.client || sale.clientName))
    .reduce((acc, sale) => {
      const keys = [
        sale.clientId || sale.cliente_id,
        normalizedKey(sale.client || sale.clientName),
      ].filter(Boolean);
      for (const key of keys) {
        const current = acc.get(key);
        if (!current || new Date(sale.date || sale.createdAt || 0) > new Date(current.date || current.createdAt || 0)) {
          acc.set(key, sale);
        }
      }
      return acc;
    }, new Map());
}

function renderClients() {
  const clients = state.data.clients;
  const total = clients.length;
  const active = clients.filter((client) => client.status !== "Inativo").length;
  const inactive = total - active;
  const openReceivables = openReceivablesByClient();
  const purchased = purchasedByClient();
  const lastPurchases = lastPurchaseByClient();
  const debtClients = clients.filter((client) => openReceivables[clientNameForDisplay(client)] > 0).length;
  const month = todayISO().slice(0, 7);
  const newThisMonth = clients.filter((client) => (client.createdAt || "").slice(0, 7) === month).length;
  const salesTotalValue = salesTotal(state.data.sales);
  const ticket = total ? salesTotalValue / total : 0;
  const clientsWithPurchases = clients.filter((client) => purchased[clientNameForDisplay(client)] > 0).length;
  const lastClient = clients.reduce((latest, client) => (
    !latest || new Date(client.createdAt || 0) > new Date(latest.createdAt || 0) ? client : latest
  ), null);
  const term = normalizeText(state.clientSearch).toLowerCase();
  const filteredClients = clients.filter((client) => {
    const clientName = clientNameForDisplay(client);
    const hasDebt = openReceivables[clientName] > 0;
    const hasPurchases = purchased[clientName] > 0;
    const matchesSearch = [clientName, client.phone || client.telefone, client.email, client.document || client.documento]
      .join(" ")
      .toLowerCase()
      .includes(term);
    const statusMatches = state.clientStatusFilter === "Todos"
      || (state.clientStatusFilter === "Ativo" && client.status !== "Inativo")
      || (state.clientStatusFilter === "Inativo" && client.status === "Inativo")
      || (state.clientStatusFilter === "Debito" && hasDebt)
      || (state.clientStatusFilter === "Compras" && hasPurchases);
    return matchesSearch && statusMatches && (!state.clientDebtOnly || hasDebt);
  });
  const totalFiltered = filteredClients.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / CLIENTS_PAGE_SIZE));
  state.clientPage = Math.min(Math.max(1, Number(state.clientPage) || 1), totalPages);
  const pageStart = (state.clientPage - 1) * CLIENTS_PAGE_SIZE;
  const pageClients = filteredClients.slice(pageStart, pageStart + CLIENTS_PAGE_SIZE);
  const showingFrom = totalFiltered ? pageStart + 1 : 0;
  const showingTo = Math.min(pageStart + pageClients.length, totalFiltered);

  $("#clients-total").textContent = total;
  $("#clients-new-month").textContent = lastClient?.createdAt ? new Date(lastClient.createdAt).toLocaleDateString("pt-BR") : "-";
  $("#clients-active").textContent = active;
  $("#clients-ticket").textContent = clientsWithPurchases;
  $("#clients-debt").textContent = debtClients;
  $("#clients-donut-total").textContent = total;
  $("#clients-active-legend").textContent = `${active} (${percent(active, total)}%)`;
  $("#clients-inactive-legend").textContent = `${inactive} (${percent(inactive, total)}%)`;
  $("#clients-debt-legend").textContent = `${debtClients} (${percent(debtClients, total)}%)`;
  $("#clients-donut").style.background = `conic-gradient(#12b76a 0 ${percent(active, total)}%, #f5a60a ${percent(active, total)}% ${percent(active + inactive, total)}%, #ff3b3b ${percent(active + inactive, total)}% 100%)`;
  $("#client-filter-btn").classList.toggle("active-filter", state.clientDebtOnly);
  if ($("#client-status-filter")) $("#client-status-filter").value = state.clientStatusFilter;
  $("#clients-showing").textContent = totalFiltered === total
    ? `Mostrando ${showingFrom}-${showingTo} de ${total} clientes`
    : `Mostrando ${showingFrom}-${showingTo} de ${totalFiltered} filtrados (${total} no total)`;

  $("#clients-table").innerHTML = pageClients.length
    ? pageClients.map((client, index) => {
      const clientName = clientNameForDisplay(client);
      const lastPurchase = lastPurchases.get(client.id) || lastPurchases.get(normalizedKey(clientName));
      const lastPurchaseDate = lastPurchase?.date || lastPurchase?.createdAt;
      const statusClass = client.status === "Inativo" ? "critico" : "normal";
      const totalPurchased = purchased[clientName] || openReceivables[clientName] || 0;
      const avatarIndex = (pageStart + index) % 6;
      return `
        <tr>
          <td>
            <div class="client-cell">
              <span class="client-avatar avatar-${avatarIndex}">${escapeHtml(clientInitials(clientName))}</span>
              <div><strong>${escapeHtml(clientName)}</strong><small>${escapeHtml(client.email || "Consumidor Final")}</small></div>
            </div>
          </td>
          <td>${escapeHtml(client.phone || client.telefone || "-")}</td>
          <td>${escapeHtml(client.document || client.documento || "-")}</td>
          <td><strong>${lastPurchaseDate ? new Date(lastPurchaseDate).toLocaleDateString("pt-BR") : "-"}</strong><small>${lastPurchaseDate ? new Date(lastPurchaseDate).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "sem compra"}</small></td>
          <td>${money.format(totalPurchased)}</td>
          <td><span class="status-pill ${statusClass}">${escapeHtml(client.status || "Ativo")}</span></td>
          <td>
            <div class="client-actions">
              <button type="button" title="Visualizar" data-view-client="${escapeHtml(client.id)}">Ver</button>
              <button class="client-menu-trigger" type="button" title="Mais opcoes" aria-haspopup="menu" aria-expanded="false" aria-label="Mais opcoes para ${escapeHtml(clientName)}" data-client-menu="${escapeHtml(client.id)}">...</button>
            </div>
          </td>
        </tr>
      `;
    }).join("")
    : `<tr><td colspan="7" class="muted">Nenhum cliente encontrado.</td></tr>`;

  const pagination = $(".client-pagination");
  if (pagination) {
    pagination.dataset.totalPages = String(totalPages);
    pagination.setAttribute("aria-hidden", totalPages <= 1 ? "true" : "false");
    pagination.innerHTML = totalPages > 1
      ? `
        <button type="button" title="Pagina anterior" data-client-page="prev" ${state.clientPage <= 1 ? "disabled" : ""}>&lt;</button>
        <button class="active" type="button" aria-current="page">${state.clientPage} / ${totalPages}</button>
        <button type="button" title="Proxima pagina" data-client-page="next" ${state.clientPage >= totalPages ? "disabled" : ""}>&gt;</button>
      `
      : "";
  }

  $("#clients-breakdown").innerHTML = `
    <div><span class="mini-icon green">A</span><p><strong>Clientes Ativos</strong>${active} clientes</p><b>${percent(active, total)}%</b></div>
    <div><span class="mini-icon amber">I</span><p><strong>Clientes Inativos</strong>${inactive} clientes</p><b>${percent(inactive, total)}%</b></div>
    <div><span class="mini-icon blue">R</span><p><strong>Clientes com compras</strong>${clientsWithPurchases} clientes</p><b>${percent(clientsWithPurchases, total)}%</b></div>
    <div><span class="mini-icon red">!</span><p><strong>Clientes com Pendencia</strong>${debtClients} clientes</p><b>${percent(debtClients, total)}%</b></div>
  `;
  renderServiceRecords();
}

function serviceTypeLabel(type) {
  return {
    troca: "Troca",
    garantia: "Garantia",
    assistencia: "Assistencia",
  }[type] || "Assistencia";
}

function renderServiceRecords() {
  const table = $("#service-records-table");
  if (!table) return;
  table.innerHTML = state.data.serviceRecords.length
    ? state.data.serviceRecords
      .slice()
      .sort((a, b) => new Date(b.createdAt || b.entryDate || 0) - new Date(a.createdAt || a.entryDate || 0))
      .map((record) => `
        <tr>
          <td>${escapeHtml(serviceTypeLabel(record.type))}</td>
          <td>${escapeHtml(record.clientName || record.client || "-")}</td>
          <td>${escapeHtml(record.productName || record.product || "-")}</td>
          <td><span class="status-pill ${record.status === "Concluido" ? "normal" : "baixo"}">${escapeHtml(record.status || "Aberto")}</span></td>
          <td>${record.entryDate ? new Date(`${record.entryDate}T12:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
          <td>${record.expectedDate ? new Date(`${record.expectedDate}T12:00:00`).toLocaleDateString("pt-BR") : "-"}</td>
          <td>${money.format(toNumber(record.value))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="7" class="muted">Nenhuma troca, garantia ou ordem de servico registrada.</td></tr>`;
}

async function createServiceRecord(type = "assistencia") {
  if (!requireSession("registrar atendimento")) return;
  const title = serviceTypeLabel(type);
  const result = await promptFields(`Registrar ${title}`, [
    { name: "client", label: "Cliente", required: true },
    { name: "product", label: "Produto", required: true },
    { name: "defect", label: "Defeito / motivo", required: true },
    { name: "status", label: "Status", value: "Aberto", required: true },
    { name: "entryDate", label: "Data de entrada", type: "date", value: todayISO(), required: true },
    { name: "expectedDate", label: "Previsao", type: "date", value: todayISO() },
    { name: "value", label: "Valor (R$)", type: "number", value: "0", min: "0" },
    { name: "notes", label: "Observacoes" },
  ], { confirmText: "Salvar" });
  if (!result) return;
  const record = {
    id: makeId("srv"),
    type,
    clientName: normalizeText(result.client),
    productName: normalizeText(result.product),
    defect: normalizeText(result.defect),
    status: normalizeText(result.status) || "Aberto",
    entryDate: normalizeText(result.entryDate) || todayISO(),
    expectedDate: normalizeText(result.expectedDate),
    value: Math.max(0, toNumber(result.value)),
    notes: normalizeText(result.notes),
    createdAt: new Date().toISOString(),
  };
  state.data.serviceRecords.unshift(record);
  syncLocalResource("financeiro", { id: record.id, type: "serviceRecord", record });
  saveDataWithAudit(`${title} registrada`, `${record.clientName} - ${record.productName}`);
  renderClients();
  showToast(`${title} registrada.`, "success");
}

const REPORT_KIND_LABELS = {
  general: "Geral",
  financial: "Financeiro",
  sales: "Vendas",
  products: "Produtos vendidos",
  clients: "Clientes",
  payments: "Formas de pagamento",
  commissions: "Comissoes",
};

function reportPeriodRange(period = "all") {
  const today = todayISO();
  if (period === "today") return { start: today, end: today };
  if (period === "7days") {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return { start: date.toISOString().slice(0, 10), end: today };
  }
  if (period === "month") {
    const date = new Date();
    date.setDate(1);
    return { start: date.toISOString().slice(0, 10), end: today };
  }
  return { start: "", end: "" };
}

function formatReportDate(isoDate = "") {
  if (!isoDate) return "";
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("pt-BR");
}

function syncReportPeriodFields() {
  const period = $("#report-period")?.value || "all";
  const custom = period === "custom";
  const start = $("#report-start");
  const end = $("#report-end");
  if (!custom) {
    const range = reportPeriodRange(period);
    if (start) start.value = range.start;
    if (end) end.value = range.end;
  }
  if (start) start.disabled = !custom;
  if (end) end.disabled = !custom;
}

function readReportFilters({ syncInputs = false } = {}) {
  if (syncInputs) syncReportPeriodFields();
  const period = $("#report-period")?.value || "all";
  const range = period === "custom"
    ? { start: $("#report-start")?.value || "", end: $("#report-end")?.value || "" }
    : reportPeriodRange(period);
  return {
    kind: $("#report-kind")?.value || "general",
    period,
    start: range.start,
    end: range.end,
    format: $("#report-format")?.value || "screen",
  };
}

function safeReportDay(dateText) {
  try {
    return dateText ? movementDay(dateText) : "";
  } catch {
    return "";
  }
}

function reportDateMatches(dateText, filters = readReportFilters()) {
  const day = safeReportDay(dateText);
  if (!day) return !filters.start && !filters.end;
  return (!filters.start || day >= filters.start) && (!filters.end || day <= filters.end);
}

function filteredReportSales(filters = readReportFilters()) {
  return state.data.sales.filter((sale) => !sale.canceled && reportDateMatches(sale.date, filters));
}

function filteredReportExpenses(filters = readReportFilters()) {
  return state.data.expenses.filter((expense) => reportDateMatches(expense.date, filters));
}

function reportPeriodText(filters = readReportFilters()) {
  if (!filters.start && !filters.end) return "Todo o periodo";
  if (filters.start && filters.end && filters.start === filters.end) return formatReportDate(filters.start);
  return `${filters.start ? formatReportDate(filters.start) : "Inicio"} ate ${filters.end ? formatReportDate(filters.end) : "hoje"}`;
}

function reportAggregates(filters = readReportFilters()) {
  const sales = filteredReportSales(filters);
  const expenses = filteredReportExpenses(filters);
  const income = salesTotal(sales);
  const expensesTotal = expenseTotal(expenses);
  const productCostTotal = sales.reduce((sum, sale) => sum + sale.items.reduce((inner, item) => {
    const product = state.data.products.find((stored) => stored.id === item.productId);
    const cost = toNumber(item.cost ?? product?.cost);
    return inner + cost * Number(item.qty || 1);
  }, 0), 0);
  const grossProfit = income - productCostTotal;
  const profit = sales.reduce((sum, sale) => sum + saleProfit(sale), 0) - expensesTotal;
  const topProducts = new Map();
  sales.forEach((sale) => sale.items.forEach((item) => {
    const product = state.data.products.find((stored) => stored.id === item.productId);
    const key = item.productId || item.name;
    const qty = Number(item.qty || item.quantity || 1);
    const total = toNumber(item.total || qty * toNumber(item.price));
    const cost = toNumber(item.cost ?? product?.cost);
    const current = topProducts.get(key) || { name: item.name, qty: 0, total: 0, profit: 0 };
    current.qty += qty;
    current.total += total;
    current.profit += total - (cost * qty);
    topProducts.set(key, current);
  }));
  const topClients = new Map();
  sales.forEach((sale) => {
    const key = sale.client || sale.clientName || "Cliente";
    const current = topClients.get(key) || { name: key, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(sale.total || 0);
    topClients.set(key, current);
  });
  const payments = new Map();
  sales.forEach((sale) => {
    const current = payments.get(sale.payment) || { name: sale.payment || "-", count: 0, total: 0 };
    current.count += 1;
    current.total += Number(sale.total || 0);
    payments.set(current.name, current);
  });
  return {
    sales,
    expenses,
    income,
    expensesTotal,
    balance: income - expensesTotal,
    productCostTotal,
    grossProfit,
    profit,
    topProducts: Array.from(topProducts.values()).sort((a, b) => b.total - a.total),
    topClients: Array.from(topClients.values()).sort((a, b) => b.total - a.total),
    payments: Array.from(payments.values()).sort((a, b) => b.total - a.total),
  };
}

function renderReports() {
  const filters = readReportFilters({ syncInputs: true });
  const aggregates = reportAggregates(filters);
  const { income, expensesTotal: expenses, balance, sales: validSales, productCostTotal, grossProfit, profit } = aggregates;
  const lowStock = lowStockProducts().length;
  const totalStock = state.data.products.reduce((sum, product) => sum + toNumber(product.stock), 0);
  const stockValue = state.data.products.reduce((sum, product) => sum + toNumber(product.cost) * toNumber(product.stock), 0);
  const categorySummary = state.settings.finance.categories.map((category) => {
    const total = aggregates.expenses
      .filter((expense) => (expense.category || "Geral") === category)
      .reduce((sum, expense) => sum + expense.value, 0);
    return `${escapeHtml(category)}: ${money.format(total)}`;
  }).join(" | ");
  setText("#report-active-filter", `${REPORT_KIND_LABELS[filters.kind] || "Geral"} | ${reportPeriodText(filters)}`);

  $("#report-income").textContent = money.format(income);
  $("#report-expenses").textContent = money.format(expenses);
  $("#report-balance").textContent = money.format(balance);
  $("#report-sales-count").textContent = validSales.length;
  $("#report-summary").innerHTML = `
    <div><span>Produtos cadastrados</span><strong>${state.data.products.length}</strong></div>
    <div><span>Itens em estoque</span><strong>${totalStock.toLocaleString("pt-BR")}</strong></div>
    <div><span>Produtos em alerta</span><strong>${lowStock}</strong></div>
    <div><span>Valor de custo em estoque (R$)</span><strong>${money.format(stockValue)}</strong></div>
    <div><span>Ticket médio</span><strong>${money.format(validSales.length ? income / validSales.length : 0)}</strong></div>
  `;
  if (categorySummary) {
    $("#report-summary").insertAdjacentHTML("beforeend", `<div><span>Categorias financeiras</span><strong>${categorySummary}</strong></div>`);
  }

  const topProducts = new Map();
  validSales.forEach((sale) => sale.items.forEach((item) => {
    const key = item.productId || item.name;
    const current = topProducts.get(key) || { name: item.name, qty: 0, total: 0 };
    current.qty += Number(item.qty || 1);
    current.total += Number(item.total || 0);
    topProducts.set(key, current);
  }));
  const topClients = new Map();
  validSales.forEach((sale) => {
    const key = sale.client || sale.clientName || "Cliente";
    const current = topClients.get(key) || { name: key, count: 0, total: 0 };
    current.count += 1;
    current.total += Number(sale.total || 0);
    topClients.set(key, current);
  });
  const payments = new Map();
  validSales.forEach((sale) => {
    const current = payments.get(sale.payment) || { name: sale.payment || "-", count: 0, total: 0 };
    current.count += 1;
    current.total += Number(sale.total || 0);
    payments.set(current.name, current);
  });

  const fillRows = (selector, rows, mapper, colspan) => {
    const node = $(selector);
    if (!node) return;
    node.innerHTML = rows.length ? rows.map(mapper).join("") : `<tr><td colspan="${colspan}" class="muted">Sem dados no periodo.</td></tr>`;
  };
  fillRows("#report-top-products", Array.from(topProducts.values()).sort((a, b) => b.total - a.total).slice(0, 5), (row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.qty}</td><td>${money.format(row.total)}</td></tr>`, 3);
  fillRows("#report-top-clients", Array.from(topClients.values()).sort((a, b) => b.total - a.total).slice(0, 5), (row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td><td>${money.format(row.total)}</td></tr>`, 3);
  fillRows("#report-payments", Array.from(payments.values()).sort((a, b) => b.total - a.total), (row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.count}</td><td>${money.format(row.total)}</td></tr>`, 3);

  const financialDetail = $("#report-financial-detail");
  if (financialDetail) {
    financialDetail.innerHTML = `
      <div><span>Receita bruta</span><strong>${money.format(income)}</strong></div>
      <div><span>Custo dos produtos vendidos</span><strong class="danger-text">${money.format(productCostTotal)}</strong></div>
      <div><span>Despesas</span><strong class="danger-text">${money.format(expenses)}</strong></div>
      <div><span>Lucro bruto</span><strong>${money.format(grossProfit)}</strong></div>
      <div><span>Resultado operacional</span><strong>${money.format(balance)}</strong></div>
      <div><span>Lucro estimado</span><strong>${money.format(profit)}</strong></div>
    `;
  }
  const indicators = $("#report-indicators");
  if (indicators) {
    const ticket = validSales.length ? income / validSales.length : 0;
    const margin = income ? (grossProfit / income) * 100 : 0;
    indicators.innerHTML = `
      <div><span>Ticket medio</span><strong>${money.format(ticket)}</strong></div>
      <div><span>Margem de lucro</span><strong>${margin.toFixed(1).replace(".", ",")}%</strong></div>
      <div><span>Clientes atendidos</span><strong>${new Set(validSales.map((sale) => sale.client || sale.clientName).filter(Boolean)).size}</strong></div>
      <div><span>Produtos em alerta</span><strong>${lowStock}</strong></div>
    `;
  }
  if ($("#report-evolution-chart")) {
    const original = $("#finance-chart");
    if (original?.innerHTML) $("#report-evolution-chart").innerHTML = original.innerHTML;
  }
  renderReportExportPreview(filters);
  renderCommissionReport();
  renderProductSalesReport();
}

function renderProductReportFilters() {
  const sellerSelect = $("#product-report-seller");
  const categorySelect = $("#product-report-category");
  if (sellerSelect) {
    const current = sellerSelect.value;
    sellerSelect.innerHTML = [
      `<option value="">Todos</option>`,
      ...activeSellers().map((seller) => {
        const id = seller.id || seller.username;
        return `<option value="${escapeHtml(id)}">${escapeHtml(seller.name || seller.username || "Vendedor")}</option>`;
      }),
    ].join("");
    sellerSelect.value = current;
  }
  if (categorySelect) {
    const current = categorySelect.value;
    categorySelect.innerHTML = [
      `<option value="">Todas</option>`,
      ...productCategories().map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`),
    ].join("");
    categorySelect.value = current;
  }
}

function renderProductSalesReport() {
  renderProductReportFilters();
  const table = $("#product-report-table");
  if (!table) return;
  const start = $("#product-report-start")?.value || "";
  const end = $("#product-report-end")?.value || "";
  const sellerId = $("#product-report-seller")?.value || "";
  const category = $("#product-report-category")?.value || "";
  const rows = new Map();
  state.data.sales
    .filter((sale) => !sale.canceled)
    .filter((sale) => {
      const day = movementDay(sale.date);
      const saleSellerId = sale.vendedorId || sale.sellerId || "";
      return (!start || day >= start) && (!end || day <= end) && (!sellerId || saleSellerId === sellerId);
    })
    .forEach((sale) => {
      sale.items.forEach((item) => {
        const product = state.data.products.find((stored) => stored.id === item.productId);
        const productCategory = product?.category || item.category || "Sem categoria";
        if (category && productCategory !== category) return;
        const key = item.productId || item.code || item.name;
        const current = rows.get(key) || { name: item.name || product?.name || "Produto", qty: 0, total: 0, profit: 0 };
        const qty = Number(item.qty || item.quantity || 1);
        const total = toNumber(item.total || qty * toNumber(item.price));
        const cost = toNumber(item.cost ?? product?.cost);
        current.qty += qty;
        current.total += total;
        current.profit += total - (cost * qty);
        rows.set(key, current);
      });
    });
  const sorted = Array.from(rows.values()).sort((a, b) => b.qty - a.qty || b.total - a.total);
  table.innerHTML = sorted.length
    ? sorted.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${row.qty}</td><td>${money.format(row.total)}</td><td>${money.format(row.profit)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">Sem produtos vendidos no filtro.</td></tr>`;
}

function settingSwitch(checked = true, name = "") {
  return `<label class="setting-switch"><input ${name ? `name="${name}"` : ""} type="checkbox" ${checked ? "checked" : ""} /><span></span></label>`;
}

function settingBadge(text, tone = "normal") {
  const safeTone = ["normal", "baixo", "critico"].includes(tone) ? tone : "normal";
  return `<span class="status-pill ${safeTone}">${escapeHtml(text)}</span>`;
}

function settingsActions() {
  return `
    <div class="settings-form-actions">
      <button class="btn primary" type="submit">Salvar alterações</button>
      <button class="btn ghost" type="reset">Cancelar</button>
    </div>
  `;
}

function renderSettingsStore() {
  return `
    <div class="settings-content-header">
      <div><h3>Loja</h3><p>Dados comerciais usados no PDV, recibos e atendimento.</p></div>
      <span class="settings-section-icon store">LJ</span>
    </div>
    <form class="settings-detail-form" data-settings-form="store">
      <label>Nome da loja <input value="Genesis Store" /></label>
      <label>CNPJ / CPF <input placeholder="00.000.000/0001-00" /></label>
      <label class="span-2">Endereço <input value="Av. Solidariedade Nº365" /></label>
      <label>Bairro <input value="Residencial Integração" /></label>
      <label>Cidade <input value="Uberlândia" /></label>
      <label>Estado <select><option>MG</option><option>SP</option><option>GO</option></select></label>
      <label>Telefone / WhatsApp <input placeholder="(34) 99999-9999" /></label>
      <label>Instagram <input value="@genesis.store.udi" /></label>
      <label>Email <input placeholder="contato@genesisstore.com" /></label>
      <label class="span-2">Mensagem padrão de atendimento <textarea>Olá! Seja bem-vindo(a) à Genesis Store. Como podemos ajudar?</textarea></label>
      <label class="span-2">Rodapé para recibos <textarea>Obrigado pela preferência. Volte sempre!</textarea></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsGeneral() {
  const version = appVersionInfo();
  const general = state.settings.general || {};
  return `
    <div class="settings-content-header">
      <div><h3>Geral</h3><p>Preferências visuais e regionais do sistema.</p></div>
      <span class="settings-section-icon blue">GE</span>
    </div>
    <form class="settings-detail-form" data-settings-form="general">
      <label>Nome do sistema <input id="setting-system-name" value="${state.settings.systemName}" /></label>
      <label>Logo do sistema <input type="file" accept="image/*" /></label>
      <label>Tema do sistema <select><option>Claro</option><option>Escuro</option><option>Automático</option></select></label>
      <label>Idioma <select><option>Português (Brasil)</option><option>English</option></select></label>
      <label>Fuso horário <select><option>America/Sao_Paulo</option><option>UTC</option></select></label>
      <label>Formato de data <select><option>DD/MM/AAAA</option><option>AAAA-MM-DD</option></select></label>
      <div class="settings-note span-2">
        <strong>Versao do sistema: <span data-app-version>${version.label}</span></strong>
        <p>Atualize com scripts/update-version.ps1 sempre que alterar codigo publicado.</p>
      </div>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsUsers() {
  return `
    <div class="settings-content-header">
      <div><h3>Usuários</h3><p>Equipe com acesso ao sistema.</p></div>
      <button class="btn primary" type="button">+ Novo usuário</button>
    </div>
    <div class="table-wrap">
      <table class="settings-table">
        <thead><tr><th>Nome</th><th>Email</th><th>Perfil</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          <tr><td>Admin</td><td>admin@mptech.com</td><td>Administrador</td><td>${settingBadge("Ativo")}</td><td><button class="btn small ghost" type="button">Editar</button></td></tr>
          <tr><td>Vendedor</td><td>vendedor@mptech.com</td><td>Vendedor</td><td>${settingBadge("Ativo")}</td><td><button class="btn small ghost" type="button">Editar</button></td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderSettingsGeneralLive() {
  const version = appVersionInfo();
  const general = state.settings.general || {};
  return `
    <div class="settings-content-header">
      <div><h3>Geral</h3><p>Preferencias regionais e identificacao do sistema.</p></div>
      <span class="settings-section-icon blue">GE</span>
    </div>
    <form class="settings-detail-form" data-settings-form="general">
      <label>Nome do sistema <input id="setting-system-name" value="${escapeHtml(state.settings.systemName)}" /></label>
      <label>Administrador padrao <input id="setting-admin-name" value="${escapeHtml(state.settings.adminName)}" /></label>
      <label>Idioma <select id="setting-language">
        <option value="pt-BR" ${general.language === "pt-BR" ? "selected" : ""}>Portugues (Brasil)</option>
        <option value="en-US" ${general.language === "en-US" ? "selected" : ""}>English</option>
      </select></label>
      <label>Fuso horario <select id="setting-time-zone">
        <option value="America/Sao_Paulo" ${general.timeZone === "America/Sao_Paulo" ? "selected" : ""}>America/Sao_Paulo</option>
        <option value="UTC" ${general.timeZone === "UTC" ? "selected" : ""}>UTC</option>
      </select></label>
      <label>Formato de data <select id="setting-date-format">
        <option value="DD/MM/AAAA" ${general.dateFormat === "DD/MM/AAAA" ? "selected" : ""}>DD/MM/AAAA</option>
        <option value="AAAA-MM-DD" ${general.dateFormat === "AAAA-MM-DD" ? "selected" : ""}>AAAA-MM-DD</option>
      </select></label>
      <div class="settings-note span-2">
        <strong>Versao do sistema: <span data-app-version>${version.label}</span></strong>
        <p>Atualize com scripts/update-version.ps1 sempre que alterar codigo publicado.</p>
      </div>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsPermissions() {
  const modules = ["Dashboard", "PDV", "Produtos / Estoque", "Financeiro", "Vendas", "Relatórios", "Clientes", "Configurações"];
  return `
    <div class="settings-content-header">
      <div><h3>Permissões</h3><p>Matriz de acesso por perfil.</p></div>
      <span class="settings-section-icon purple">PE</span>
    </div>
    <div class="table-wrap">
      <table class="settings-table permissions-table">
        <thead><tr><th>Módulo</th><th>Administrador</th><th>Vendedor</th></tr></thead>
        <tbody>${modules.map((module) => `<tr><td>${module}</td><td>${settingSwitch(true)}</td><td>${settingSwitch(module !== "Financeiro" && module !== "Configurações")}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderSettingsFinance() {
  return `
    <div class="settings-content-header">
      <div><h3>Financeiro</h3><p>Parâmetros de contas, taxas e caixa.</p></div>
      <span class="settings-section-icon green">FI</span>
    </div>
    <form class="settings-detail-form" data-settings-form="finance">
      <label>Categoria padrão de entradas <input value="Vendas" /></label>
      <label>Categoria padrão de saídas <input value="Geral" /></label>
      <label class="span-2">Contas bancárias <input value="Caixa, Banco Principal" /></label>
      <div class="setting-toggle-row"><span>Abrir caixa automaticamente</span>${settingSwitch(false)}</div>
      <div class="setting-toggle-row"><span>Habilitar controle de fiado</span>${settingSwitch(true)}</div>
      <label>Taxa Pix (%) <input type="number" value="0" /></label>
      <label>Taxa Cartão (%) <input type="number" value="3.49" /></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsPdv() {
  return `
    <div class="settings-content-header">
      <div><h3>PDV</h3><p>Preferências de venda, recibo e atalhos.</p></div>
      <span class="settings-section-icon orange">PD</span>
    </div>
    <form class="settings-detail-form" data-settings-form="pdv">
      <label>Impressora padrão <input value="Impressora térmica 58mm" /></label>
      <label>Tipo de recibo <select><option>Compacto</option><option>Detalhado</option></select></label>
      <div class="setting-toggle-row"><span>Abrir caixa automaticamente</span>${settingSwitch(true)}</div>
      <div class="setting-toggle-row"><span>Permitir venda sem estoque</span>${settingSwitch(false)}</div>
      <label>Desconto máximo permitido (%) <input type="number" value="10" /></label>
      <label>Atalhos de teclado <input value="F1 buscar produto, F2 gaveta, ESC limpar carrinho, ENTER adicionar produto, F4 finalizar venda" /></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsNotifications() {
  const events = ["Venda realizada", "Cliente novo", "Produto com estoque baixo", "Conta a pagar vencendo", "Conta a receber vencendo"];
  return `
    <div class="settings-content-header">
      <div><h3>Notificações</h3><p>Eventos e canais de aviso do sistema.</p></div>
      <span class="settings-section-icon blue">NO</span>
    </div>
    <div class="settings-list">${events.map((event, index) => `<div class="setting-toggle-row"><span>${event}</span>${settingSwitch(index !== 4)}</div>`).join("")}</div>
    <div class="settings-channel-grid">
      <article>${settingBadge("Ativo")}<strong>Sistema</strong><span>Notificações internas</span></article>
      <article>${settingBadge("Ativo")}<strong>Email</strong><span>Envio administrativo</span></article>
      <article>${settingBadge("Em breve", "baixo")}<strong>WhatsApp futuro</strong><span>Integração planejada</span></article>
    </div>
  `;
}

function renderSettingsIntegrations() {
  const cards = [
    ["WhatsApp API", "Não conectado", "critico"],
    ["Mercado Pago / Pix", "Conectado", "normal"],
    ["Instagram", "Não conectado", "critico"],
    ["Correios", "Em breve", "baixo"],
    ["Backup em nuvem", "Em breve", "baixo"],
  ];
  return `
    <div class="settings-content-header">
      <div><h3>Integrações</h3><p>Serviços externos preparados para conexão futura.</p></div>
      <span class="settings-section-icon purple">IN</span>
    </div>
    <div class="integration-grid">${cards.map(([name, status, tone]) => `<article class="integration-card"><span class="settings-section-icon blue">${name.slice(0, 2).toUpperCase()}</span><div><strong>${name}</strong>${settingBadge(status, tone)}</div><button class="btn small ghost" type="button">Configurar</button></article>`).join("")}</div>
  `;
}

function dbStatusText() {
  return {
    checking: "Verificando",
    connected: "Conectado",
    error: "Falha",
    local: "Local",
  }[state.dbStatus] || "Local";
}

function renderSettingsSecurity() {
  return `
    <div class="settings-content-header">
      <div><h3>Segurança</h3><p>Controle de senha, sessão e acesso.</p></div>
      <span class="settings-section-icon red">SE</span>
    </div>
    <form class="settings-detail-form" data-settings-form="security">
      <label>Alterar senha <input id="setting-admin-password" type="password" placeholder="Nova senha" /></label>
      <div class="setting-toggle-row"><span>Verificação em duas etapas</span>${settingSwitch(false)}</div>
      <label>Sessões ativas <input value="1 sessão ativa" disabled /></label>
      <label>Tempo de logout automático <input id="setting-session-minutes" type="number" value="${state.settings.sessionMinutes || 240}" /></label>
      <label class="span-2">Histórico de acesso <textarea>Último acesso: ${new Date().toLocaleString("pt-BR")}</textarea></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsBackup() {
  return `
    <div class="settings-content-header">
      <div><h3>Backup</h3><p>Rotina de cópia, restauração e exportação.</p></div>
      <button id="export-settings-data" class="btn primary" type="button">Exportar dados em Excel</button>
    </div>
    <div class="backup-grid">
      <article><strong>Backup automático diário</strong><span>Ativo às 02:00</span>${settingSwitch(true)}</article>
      <article><strong>Fazer backup agora</strong><span>Gera arquivo JSON do sistema</span><button class="btn ghost" type="button" data-settings-action="backup-now">Executar</button></article>
      <article><strong>Restaurar backup</strong><span>Importação preparada para API futura</span><button class="btn ghost" type="button">Selecionar arquivo</button></article>
      <article><strong>Último backup realizado</strong><span>${state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("pt-BR") : "Nenhum backup recente"}</span>${settingBadge("Pronto")}</article>
    </div>
  `;
}

function renderSettingsLicense() {
  const tenant = state.settings.tenant;
  const statusTone = ["vencido", "bloqueado", "cancelado", "expired", "blocked", "cancelled"].includes(tenant.licenseStatus) ? "critico" : "normal";
  const trialEndsAt = tenant.trialEndsAt || (isTrialLikeLicense(tenant.licenseStatus, tenant.plan) ? tenant.expiresAt || "" : "");
  return `
    <div class="settings-content-header">
      <div><h3>Licenca SaaS</h3><p>Consulta administrativa. A alteracao da licenca sera feita pelo painel SaaS.</p></div>
      <button class="btn primary" type="button" data-settings-action="sync-saas-client">Sincronizar SaaS</button>
    </div>
    <div class="license-info-grid">
      <article><span>Tenant ID</span><strong>${escapeHtml(tenant.tenantId || "-")}</strong></article>
      <article><span>Status</span><strong>${settingBadge(tenant.licenseStatus || "indefinido", statusTone)}</strong></article>
      <article><span>Plano</span><strong>${escapeHtml(tenant.plan || "-")}</strong></article>
      <article><span>Fim do teste</span><strong>${escapeHtml(trialEndsAt ? formatDateOnly(trialEndsAt) : "Nao aplicavel")}</strong></article>
      <article><span>Vencimento</span><strong>${escapeHtml(tenant.expiresAt ? formatDateOnly(tenant.expiresAt) : "Nao definido")}</strong></article>
    </div>
    <div class="settings-note">
      <strong>Painel informativo</strong>
      <p>O administrador apenas acompanha estes dados nesta tela. Cadastro, renovacao, bloqueio e validacao real da licenca serao tratados no painel SaaS.</p>
    </div>
    ${renderSaasSyncStatus()}
  `;
}

function renderSettingsAppearance() {
  return `
    <div class="settings-content-header">
      <div><h3>Aparencia</h3><p>Preferencias visuais locais do sistema.</p></div>
      <span class="settings-section-icon blue">AP</span>
    </div>
    <form class="settings-detail-form" data-settings-form="appearance">
      <label>Tema <select id="setting-theme"><option ${state.settings.appearance.theme === "Claro" ? "selected" : ""}>Claro</option><option ${state.settings.appearance.theme === "Escuro" ? "selected" : ""}>Escuro</option></select></label>
      <label>Identidade visual <input id="setting-accent" value="${state.settings.appearance.accent}" /></label>
      <label class="span-2">Rodape do comprovante <textarea id="setting-receipt-footer">${state.settings.store.receiptFooter}</textarea></label>
      ${settingsActions()}
    </form>
  `;
}

function csvToList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToCsv(list) {
  return (list || []).join(", ");
}

function renderSettingsStoreLive() {
  const store = state.settings.store;
  const controlledBySaas = isStoreControlledBySaas();
  const lockInputAttr = controlledBySaas ? "readonly" : "";
  const lockSelectAttr = controlledBySaas ? "disabled" : "";
  const saasNote = controlledBySaas
    ? `<div class="settings-note span-2"><strong>Dados vindos do SaaS</strong><p>Nome da loja, CNPJ/CPF, cidade, estado, telefone e e-mail sao exibidos em modo leitura e sincronizados do cadastro da loja no portal SaaS. Altere esses dados no SaaS para refletir aqui, no PDV e nos recibos.</p></div>`
    : "";
  return `
    <div class="settings-content-header">
      <div><h3>Loja</h3><p>Dados comerciais usados no cabecalho, recibos e WhatsApp.</p></div>
      <span class="settings-section-icon store">LJ</span>
    </div>
    <form class="settings-detail-form" data-settings-form="store">
      ${saasNote}
      <label>Nome da loja <input id="setting-store-name" value="${escapeHtml(store.storeName || store.name || "")}" ${lockInputAttr} /></label>
      <label>CNPJ / CPF <input id="setting-store-cnpj" value="${escapeHtml(store.cnpj || store.document || "")}" ${lockInputAttr} /></label>
      <label class="span-2">Endereco <input id="setting-store-address" value="${escapeHtml(store.address || "")}" ${lockInputAttr} /></label>
      <label>Cidade <input id="setting-store-city" value="${escapeHtml(store.city || "")}" ${lockInputAttr} /></label>
      <label>Estado <select id="setting-store-state" ${lockSelectAttr}>${["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"].map((uf) => `<option ${store.state === uf ? "selected" : ""}>${uf}</option>`).join("")}</select></label>
      <label>Telefone / WhatsApp <input id="setting-store-phone" value="${escapeHtml(store.phone || "")}" ${lockInputAttr} /></label>
      <label>Instagram <input id="setting-store-instagram" value="${escapeHtml(store.instagram || "")}" /></label>
      <label>Email <input id="setting-store-email" value="${escapeHtml(store.email || "")}" ${lockInputAttr} /></label>
      <label class="span-2">Mensagem padrao de atendimento <textarea id="setting-store-message">${escapeHtml(store.defaultMessage || "")}</textarea></label>
      <label class="span-2">Rodape para recibos <textarea id="setting-store-footer">${escapeHtml(store.receiptFooter || "")}</textarea></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsUsersLive() {
  const userLimit = Number(state.license?.limits?.users || 0);
  const activeUsers = activeUserCount();
  const limitText = userLimit > 0 ? `${activeUsers}/${userLimit} usuarios da licenca` : `${activeUsers} usuarios ativos`;
  return `
    <div class="settings-content-header">
      <div><h3>Usuarios</h3><p>Equipe com acesso real ao sistema. ${escapeHtml(limitText)}.</p></div>
      <button class="btn primary" type="button" data-user-action="new">+ Novo usuario</button>
    </div>
    <div class="table-wrap">
      <table class="settings-table">
        <thead><tr><th>Nome</th><th>Usuario</th><th>Perfil</th><th>Comissao</th><th>Meta</th><th>Status</th><th>Acoes</th></tr></thead>
        <tbody>${state.settings.users.length ? state.settings.users.map((user) => `
          <tr>
            <td>${escapeHtml(user.name)}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.role)}</td>
            <td>${user.commissionPercent === "" || user.commissionPercent === undefined ? "Padrao" : `${toNumber(user.commissionPercent).toFixed(2).replace(".", ",")}%`}</td>
            <td>${toNumber(user.monthlyGoal) ? money.format(user.monthlyGoal) : "-"}</td>
            <td>${settingBadge(user.active === false ? "Inativo" : "Ativo", user.active === false ? "critico" : "normal")}</td>
            <td>
              <button class="btn small ghost" type="button" data-user-action="edit" data-user-id="${user.id}">Editar</button>
              <button class="btn small danger" type="button" data-user-action="delete" data-user-id="${user.id}" ${user.username === "admin" ? "disabled" : ""}>Excluir</button>
            </td>
          </tr>
        `).join("") : `<tr><td colspan="7">Nenhum usuario carregado. Faca login novamente ou valide a API local.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderSettingsPermissionsLive() {
  const permissionLabels = {
    pdv_access: "PDV",
    estoque_access: "Produtos / Estoque",
    financeiro_access: "Financeiro / Relatorios",
    config_access: "Configuracoes",
  };
  return `
    <div class="settings-content-header">
      <div><h3>Permissoes</h3><p>Permissoes aplicadas em menus e acoes criticas.</p></div>
      <span class="settings-section-icon purple">PE</span>
    </div>
    <form data-settings-form="permissions">
      <div class="table-wrap">
        <table class="settings-table permissions-table">
          <thead><tr><th>Usuario</th>${Object.values(permissionLabels).map((label) => `<th>${label}</th>`).join("")}</tr></thead>
          <tbody>${state.settings.users.length ? state.settings.users.map((user) => `
            <tr>
              <td>${escapeHtml(user.name)}<small>${escapeHtml(user.role)}</small></td>
              ${Object.keys(permissionLabels).map((permission) => `<td>${settingSwitch(userHasPermission(user, permission), `${user.id}:${permission}`)}</td>`).join("")}
            </tr>
          `).join("") : `<tr><td colspan="${Object.keys(permissionLabels).length + 1}">Nenhum usuario carregado para permissao. O usuario logado sera sincronizado ao entrar pela API local.</td></tr>`}</tbody>
        </table>
      </div>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsFinanceLive() {
  const finance = { ...defaultSettings().finance, ...(state.settings.finance || {}) };
  const integrations = { ...defaultSettings().integrations, ...(state.settings.integrations || {}) };
  const accountOptions = (finance.bankAccounts?.length ? finance.bankAccounts : ["Caixa"])
    .map((account) => `<option value="${escapeHtml(account)}" ${finance.defaultBankAccount === account ? "selected" : ""}>${escapeHtml(account)}</option>`)
    .join("");
  const cardFeeLabel = finance.cardFeeMode === "fixed" ? money.format(toNumber(finance.cardFee)) : `${toNumber(finance.cardFee).toFixed(2).replace(".", ",")}%`;
  return `
    <div class="settings-content-header">
      <div><h3>Financeiro e pagamentos</h3><p>Metas, contas, taxas e regras usadas no PDV, caixa e relatórios.</p></div>
      <span class="settings-section-icon green">FI</span>
    </div>
    <form class="settings-detail-form" data-settings-form="finance">
      <div class="settings-note span-2">
        <strong>Metas exibidas no Dashboard</strong>
        <p>Estes valores alimentam desempenho do mes, projecao de fechamento e indicadores avancados.</p>
      </div>
      <label>Meta mensal de vendas (R$) <input id="setting-monthly-sales-goal" type="number" step="0.01" min="0" placeholder="R$ 0,00" value="${finance.monthlySalesGoal}" /></label>
      <label>Meta mensal de lucro (R$) <input id="setting-monthly-profit-goal" type="number" step="0.01" min="0" placeholder="R$ 0,00" value="${finance.monthlyProfitGoal}" /></label>
      <label>Meta de novos clientes <input id="setting-monthly-client-goal" type="number" step="1" min="0" value="${finance.monthlyClientGoal}" /></label>
      <label>Conta padrao <select id="setting-default-bank-account">${accountOptions}</select></label>
      <label class="span-2">Categorias financeiras <input id="setting-finance-categories" value="${escapeHtml(listToCsv(finance.categories))}" placeholder="Vendas, Geral, Conta a pagar" /></label>
      <label class="span-2">Contas bancarias / caixas <input id="setting-bank-accounts" value="${escapeHtml(listToCsv(finance.bankAccounts))}" placeholder="Caixa, Banco Principal, Maquininha" /></label>
      <div class="settings-note payment-instructions span-2">
        <strong>Como configurar pagamentos</strong>
        <p>1. Cadastre a conta padrao onde o dinheiro da venda entra. 2. Informe as taxas de Pix e cartao. 3. Configure a chave Pix na aba Integracoes. 4. Teste uma venda no PDV e confira o valor liquido no caixa.</p>
      </div>
      <div class="payment-method-grid span-2">
        <article>
          <strong>Dinheiro</strong>
          <span>Sem taxa automatica. O PDV exige valor recebido e calcula troco.</span>
          ${settingBadge("Ativo")}
        </article>
        <article>
          <strong>Pix</strong>
          <span>Taxa atual: ${toNumber(finance.pixFee).toFixed(2).replace(".", ",")}%</span>
          ${settingBadge(integrations.pixKey ? "Chave cadastrada" : "Cadastrar chave")}
        </article>
        <article>
          <strong>Cartao</strong>
          <span>Taxa atual: ${cardFeeLabel}</span>
          ${settingBadge(finance.cardFeeMode === "fixed" ? "Fixa" : "Percentual")}
        </article>
      </div>
      <label>Taxa Pix (%) <input id="setting-pix-fee" type="number" step="0.01" min="0" value="${finance.pixFee}" /></label>
      <label>Taxa Cartao (% ou R$ fixo) <input id="setting-card-fee" type="number" step="0.01" min="0" placeholder="R$ 0,00" value="${finance.cardFee}" /></label>
      <label>Comissao padrao sobre vendas (%) <input id="setting-default-commission" type="number" step="0.01" min="0" max="100" value="${finance.defaultCommissionPercent}" /></label>
      <label>Tipo da taxa do cartao <select id="setting-card-fee-mode">
        <option value="percent" ${finance.cardFeeMode !== "fixed" ? "selected" : ""}>Percentual (%)</option>
        <option value="fixed" ${finance.cardFeeMode === "fixed" ? "selected" : ""}>Valor fixo por venda (R$)</option>
      </select></label>
      <label>Dias de alerta a receber <input id="setting-receivable-alert-days" type="number" step="1" min="0" value="${finance.receivableAlertDays}" /></label>
      <label>Dias de alerta a pagar <input id="setting-payable-alert-days" type="number" step="1" min="0" value="${finance.payableAlertDays}" /></label>
      ${settingsActions()}
    </form>
  `;
}

function collectPdvSettingsForm(form) {
  const defaults = defaultSettings().pdv;
  const defaultReceiptOptions = defaults.receiptOptions;
  const receiptOptions = Object.keys(defaultReceiptOptions).reduce((acc, key) => {
    acc[key] = Boolean(form.querySelector(`input[name="receipt:${key}"]`)?.checked);
    return acc;
  }, {});
  const printerMode = normalizeText($("#setting-printer-mode")?.value) || defaults.printerMode;
  const allowedPrinterModes = ["dialog", "default", "reference"];
  return {
    printerEnabled: Boolean(form.querySelector('input[name="printerEnabled"]')?.checked),
    printerMode: allowedPrinterModes.includes(printerMode) ? printerMode : defaults.printerMode,
    receiptPrinter: normalizeText($("#setting-receipt-printer")?.value) || "Impressora padrao",
    receiptType: normalizeText($("#setting-receipt-type")?.value) || "detalhado",
    receiptPaperWidth: normalizeReceiptPaperWidth($("#setting-receipt-paper-width")?.value, defaults.receiptPaperWidth),
    receiptCopies: Math.max(1, Math.min(3, Math.round(toNumber($("#setting-receipt-copies")?.value, 1)))),
    compactSmallPaper: Boolean(form.querySelector('input[name="compactSmallPaper"]')?.checked),
    receiptFontSize: Math.max(8, Math.min(13, toNumber($("#setting-receipt-font-size")?.value, defaults.receiptFontSize))),
    receiptPrintDensity: normalizeReceiptPrintDensity($("#setting-receipt-print-density")?.value, defaults.receiptPrintDensity),
    receiptSideMarginMm: Math.max(0, Math.min(8, toNumber($("#setting-receipt-side-margin")?.value, defaults.receiptSideMarginMm))),
    receiptOptions,
    autoCutPaper: Boolean(form.querySelector('input[name="autoCutPaper"]')?.checked),
    autoOpenCash: Boolean(form.querySelector('input[name="autoOpenCash"]')?.checked),
    allowNegativeStock: Boolean(form.querySelector('input[name="allowNegativeStock"]')?.checked),
    maxDiscountPercent: Math.max(0, Math.min(100, toNumber($("#setting-max-discount")?.value, 10))),
    shortcuts: normalizeText($("#setting-shortcuts")?.value),
  };
}

function renderSettingsPdvLive() {
  const pdv = { ...defaultSettings().pdv, ...(state.settings.pdv || {}) };
  pdv.receiptPaperWidth = normalizeReceiptPaperWidth(pdv.receiptPaperWidth);
  const printDensity = normalizeReceiptPrintDensity(pdv.receiptPrintDensity);
  const printDensityStyles = receiptPrintDensityStyles(printDensity);
  const receiptOptions = { ...defaultSettings().pdv.receiptOptions, ...(pdv.receiptOptions || {}) };
  const printerMode = pdv.printerMode || "dialog";
  const receiptOptionLabels = {
    systemTitle: "Titulo do sistema",
    storeName: "Nome da loja",
    document: "CNPJ/CPF",
    address: "Endereco",
    cityState: "Cidade/UF",
    phone: "Telefone",
    saleId: "Numero da venda",
    date: "Data e hora",
    payment: "Forma de pagamento",
    seller: "Vendedor",
    clientName: "Nome do cliente",
    clientDocument: "Documento do cliente",
    clientPhone: "Telefone do cliente",
    items: "Itens vendidos",
    itemCode: "Codigo do produto",
    subtotal: "Subtotal",
    discount: "Desconto",
    fees: "Taxas",
    netTotal: "Total liquido (R$)",
    cashReceived: "Recebido e troco",
    footer: "Rodape",
  };
  const previewSale = {
    id: "SALE-0001",
    date: new Date("2026-04-28T15:30:00").toISOString(),
    payment: "Dinheiro",
    vendedorNome: "Ana Vendedora",
    clientName: "Maria Atacado",
    clientDocument: "123.456.789-00",
    clientPhone: "(34) 99999-0000",
    subtotal: 25,
    discount: 0,
    total: 25,
    received: 30,
    change: 5,
    items: [{
      name: "Produto Teste",
      code: "TESTE001",
      qty: 1,
      price: 25,
      total: 25,
    }],
  };
  const receiptPreview = buildReceiptHtml(previewSale, pdv, receiptOptions);
  return `
    <div class="settings-content-header">
      <div><h3>Impressora e cupom</h3><p>Defina impressao, formato e quais dados aparecem no comprovante.</p></div>
      <span class="settings-section-icon orange">PD</span>
    </div>
    <form class="settings-detail-form" data-settings-form="pdv">
      <div class="settings-note receipt-guide span-2">
        <strong>Como configurar</strong>
        <p>O navegador nao libera a lista de impressoras do Windows para o sistema escolher sozinho. Configure abaixo como o caixa deve imprimir, salve, use Imprimir teste e selecione a impressora real na janela de impressao.</p>
      </div>
      <div class="printer-setup-card span-2">
        <div class="printer-setup-header">
          <div>
            <strong>Impressora do cupom</strong>
            <span>Use uma impressora instalada no Windows. Para impressao direta sem janela, sera necessario um agente local/nativo no futuro.</span>
          </div>
          <button class="btn primary" type="button" data-settings-action="test-receipt-print">Imprimir teste</button>
        </div>
        <div class="printer-mode-grid">
          <label>Modo de impressao <select id="setting-printer-mode">
            <option value="dialog" ${printerMode === "dialog" ? "selected" : ""}>Escolher na janela do navegador</option>
            <option value="default" ${printerMode === "default" ? "selected" : ""}>Usar impressora padrao do Windows</option>
            <option value="reference" ${printerMode === "reference" ? "selected" : ""}>Lembrar nome da impressora</option>
          </select></label>
          <label>Nome de referencia <input id="setting-receipt-printer" value="${escapeHtml(pdv.receiptPrinter || "")}" placeholder="Ex: Bematech MP-4200 TH, Epson TM-T20" /></label>
        </div>
        <div class="printer-flow-grid">
          <article><strong>1</strong><span>Instale a impressora no Windows e imprima uma pagina de teste pelo proprio Windows.</span></article>
          <article><strong>2</strong><span>Salve esta tela e clique em Imprimir teste para conferir largura, vias e dados do cupom.</span></article>
          <article><strong>3</strong><span>No caixa, confirme a impressora na janela de impressao quando finalizar a venda.</span></article>
        </div>
      </div>
      <div class="setting-toggle-row"><span>Perguntar impressao do cupom ao finalizar venda</span>${settingSwitch(pdv.printerEnabled, "printerEnabled")}</div>
      <label>Tipo de recibo <select id="setting-receipt-type"><option value="simples" ${pdv.receiptType === "simples" ? "selected" : ""}>Simples</option><option value="detalhado" ${pdv.receiptType === "detalhado" ? "selected" : ""}>Detalhado</option></select></label>
      <label>Largura do papel <select id="setting-receipt-paper-width">${RECEIPT_PAPER_WIDTHS.map((width) => `<option value="${width}" ${pdv.receiptPaperWidth === width ? "selected" : ""}>${width}</option>`).join("")}</select></label>
      <label>Vias por venda <input id="setting-receipt-copies" type="number" min="1" max="3" step="1" value="${pdv.receiptCopies || 1}" /></label>
      <label>Tamanho da fonte do cupom <input id="setting-receipt-font-size" type="number" min="8" max="13" step="0.5" value="${toNumber(pdv.receiptFontSize, 12)}" /></label>
      <label>Escurecimento do cupom <select id="setting-receipt-print-density">${RECEIPT_PRINT_DENSITIES.map((density) => `<option value="${density}" ${printDensity === density ? "selected" : ""}>${RECEIPT_PRINT_DENSITY_LABELS[density]}</option>`).join("")}</select></label>
      <label>Margem lateral segura (mm) <input id="setting-receipt-side-margin" type="number" min="0" max="8" step="0.5" value="${toNumber(pdv.receiptSideMarginMm, 3)}" /></label>
      <div class="setting-toggle-row"><span>Compactar automaticamente em 48/58mm</span>${settingSwitch(pdv.compactSmallPaper !== false, "compactSmallPaper")}</div>
      <div class="setting-toggle-row"><span>Cortar papel automaticamente</span>${settingSwitch(pdv.autoCutPaper, "autoCutPaper")}</div>
      <div class="setting-toggle-row"><span>Abrir caixa automaticamente</span>${settingSwitch(pdv.autoOpenCash, "autoOpenCash")}</div>
      <div class="setting-toggle-row"><span>Permitir venda sem estoque</span>${settingSwitch(pdv.allowNegativeStock, "allowNegativeStock")}</div>
      <label>Desconto maximo permitido (%) <input id="setting-max-discount" type="number" min="0" max="100" value="${pdv.maxDiscountPercent}" /></label>
      <div class="receipt-calibration-card span-2">
        <div>
          <strong>Calibracao rapida</strong>
          <span>Imprima testes por largura e ajuste margem/fonte ate nenhuma informacao cortar nas laterais.</span>
        </div>
        <div class="receipt-calibration-actions">
          ${RECEIPT_PAPER_WIDTHS.map((width) => `<button class="btn ghost" type="button" data-settings-action="test-receipt-print" data-receipt-test-width="${width}">Teste ${width}</button>`).join("")}
        </div>
      </div>
      <div class="receipt-settings-grid span-2">
        <section>
          <strong>Dados exibidos no cupom</strong>
          <div class="receipt-option-grid">
            ${Object.entries(receiptOptionLabels).map(([key, label]) => `
              <div class="setting-toggle-row compact"><span>${label}</span>${settingSwitch(receiptOptions[key], `receipt:${key}`)}</div>
            `).join("")}
          </div>
        </section>
        <section>
          <strong>Previa do cupom</strong>
          <div class="receipt-preview" data-paper-width="${pdv.receiptPaperWidth}" data-print-density="${printDensity}" style="--receipt-font-size:${toNumber(pdv.receiptFontSize, 12)}px; --receipt-print-weight:${printDensityStyles.weight}; --receipt-print-stroke:${printDensityStyles.stroke}; --receipt-print-shadow:${printDensityStyles.shadow};">${receiptPreview}</div>
        </section>
      </div>
      <label class="span-2">Atalhos de teclado <input id="setting-shortcuts" value="${escapeHtml(pdv.shortcuts)}" /></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsNotificationsLive() {
  const notifications = state.settings.notifications;
  return `
    <div class="settings-content-header">
      <div><h3>Notificacoes</h3><p>Alertas internos do sistema.</p></div>
      <span class="settings-section-icon blue">NO</span>
    </div>
    <form class="settings-list" data-settings-form="notifications">
      <div class="setting-toggle-row"><span>Venda realizada</span>${settingSwitch(notifications.sale, "sale")}</div>
      <div class="setting-toggle-row"><span>Estoque baixo</span>${settingSwitch(notifications.lowStock, "lowStock")}</div>
      <div class="setting-toggle-row"><span>Erro de operacao</span>${settingSwitch(notifications.error, "error")}</div>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsIntegrationsLive() {
  const integrations = { ...defaultSettings().integrations, ...(state.settings.integrations || {}) };
  const store = state.settings.store || {};
  const whatsappDigits = String(integrations.whatsappNumber || store.phone || "").replace(/\D/g, "");
  const pixReady = Boolean(integrations.pixKey && integrations.pixMerchantName && integrations.pixMerchantCity);
  return `
    <div class="settings-content-header">
      <div><h3>Pagamentos e integracoes</h3><p>Configure canais externos, Pix e instrucoes para automacao segura.</p></div>
      <span class="settings-section-icon purple">IN</span>
    </div>
    <form class="settings-detail-form" data-settings-form="integrations">
      <div class="settings-note integration-guide span-2">
        <strong>Como deve ser feito</strong>
        <p>Use esta tela para dados publicos de atendimento e Pix. Credenciais sensiveis de gateways, tokens de maquininha ou APIs de pagamento devem ficar somente no backend local ou servidor SaaS, nunca no HTML ou JavaScript do frontend.</p>
      </div>
      <div class="integration-steps span-2">
        <article><strong>1</strong><span>Cadastre WhatsApp e Instagram para abrir canais oficiais da loja.</span></article>
        <article><strong>2</strong><span>Cadastre chave Pix, nome do recebedor e cidade para simular o payload.</span></article>
        <article><strong>3</strong><span>Configure taxas em Financeiro e valide uma venda de teste no PDV.</span></article>
      </div>
      <label>Modo de pagamento <select id="setting-payment-provider">
        <option value="manual" ${integrations.paymentProvider !== "gateway" ? "selected" : ""}>Manual / PDV local</option>
        <option value="gateway" ${integrations.paymentProvider === "gateway" ? "selected" : ""}>Gateway externo futuro</option>
      </select></label>
      <label>WhatsApp da loja <input id="setting-whatsapp-number" value="${escapeHtml(integrations.whatsappNumber)}" placeholder="5534999999999" /></label>
      <label>Instagram <input id="setting-instagram-profile" value="${escapeHtml(integrations.instagramProfile)}" placeholder="@worldacessorios" /></label>
      <label>Tipo da chave Pix <select id="setting-pix-key-type">
        <option value="aleatoria" ${integrations.pixKeyType === "aleatoria" ? "selected" : ""}>Chave aleatoria</option>
        <option value="cnpj" ${integrations.pixKeyType === "cnpj" ? "selected" : ""}>CNPJ</option>
        <option value="cpf" ${integrations.pixKeyType === "cpf" ? "selected" : ""}>CPF</option>
        <option value="email" ${integrations.pixKeyType === "email" ? "selected" : ""}>E-mail</option>
        <option value="telefone" ${integrations.pixKeyType === "telefone" ? "selected" : ""}>Telefone</option>
      </select></label>
      <label class="span-2">Chave Pix <input id="setting-pix-key" value="${escapeHtml(integrations.pixKey)}" placeholder="Chave Pix usada para recebimentos" /></label>
      <label>Nome do recebedor Pix <input id="setting-pix-merchant-name" maxlength="25" value="${escapeHtml(integrations.pixMerchantName || store.storeName || "")}" placeholder="WORLD ACESSORIOS" /></label>
      <label>Cidade Pix <input id="setting-pix-merchant-city" maxlength="15" value="${escapeHtml(integrations.pixMerchantCity || store.city || "")}" placeholder="UBERLANDIA" /></label>
      <label class="span-2">Mensagem padrao do WhatsApp <textarea id="setting-whatsapp-message" placeholder="Ola! Como podemos ajudar?">${escapeHtml(integrations.whatsappDefaultMessage || store.defaultMessage || "")}</textarea></label>
      <div class="integration-status-grid span-2">
        <article><strong>WhatsApp</strong><span>${whatsappDigits ? `Numero pronto: ${escapeHtml(whatsappDigits)}` : "Informe DDI + DDD + numero."}</span>${settingBadge(whatsappDigits ? "Configurado" : "Pendente")}</article>
        <article><strong>Pix</strong><span>${pixReady ? "Dados minimos preenchidos para simulacao." : "Preencha chave, nome e cidade."}</span>${settingBadge(pixReady ? "Pronto" : "Pendente")}</article>
        <article><strong>Gateway</strong><span>Reservado para integracao via backend seguro.</span>${settingBadge(integrations.paymentProvider === "gateway" ? "Planejado" : "Manual")}</article>
      </div>
      <div class="settings-form-actions">
        <button class="btn ghost" type="button" data-integration-action="whatsapp">Abrir WhatsApp</button>
        <button class="btn ghost" type="button" data-integration-action="instagram">Abrir Instagram</button>
        <button class="btn ghost" type="button" data-integration-action="pix">Simular Pix</button>
      </div>
      ${settingsActions()}
    </form>
  `;
}

function renderSettingsSecurityLive() {
  const security = state.settings.security || {};
  const totpReady = Boolean(security.totpSecret);
  const twoFactorStatus = security.twoFactorEnabled && totpReady ? "Ativo" : totpReady ? "Pendente" : "Desativado";
  const twoFactorTone = security.twoFactorEnabled && totpReady ? "normal" : "baixo";
  const accountLabel = currentUser()?.username || currentUser()?.email || "usuario";
  const secret = security.totpSecret || "";
  const uri = secret ? totpUri(secret, accountLabel) : "";
  return `
    <div class="settings-content-header">
      <div><h3>Seguranca</h3><p>Senha, sessao e autenticador de dois fatores.</p></div>
      <span class="settings-section-icon red">SE</span>
    </div>
    <form class="settings-detail-form" data-settings-form="security">
      <div class="security-status-grid span-2">
        <article><strong>Autenticador 2FA</strong><span>${twoFactorStatus}</span>${settingBadge(twoFactorStatus, twoFactorTone)}</article>
        <article><strong>Sessao</strong><span>Logout automatico em ${state.settings.sessionMinutes || 240} minutos</span>${settingBadge("Configurado")}</article>
        <article><strong>Senha</strong><span>Altere a senha do usuario logado com sincronizacao no banco local.</span>${settingBadge("Protegida")}</article>
      </div>

      <label>Alterar senha do usuario atual <input id="setting-admin-password" type="password" autocomplete="new-password" placeholder="Nova senha com pelo menos 6 caracteres" /></label>
      <label>Tempo de logout automatico <input id="setting-session-minutes" type="number" min="5" value="${state.settings.sessionMinutes || 240}" /></label>

      <section class="two-factor-panel span-2">
        <div class="two-factor-header">
          <div>
            <strong>Autenticador em duas etapas</strong>
            <span>Use Google Authenticator, Microsoft Authenticator, 1Password ou app TOTP compativel.</span>
          </div>
          ${settingBadge(twoFactorStatus, twoFactorTone)}
        </div>
        ${secret ? `
          <div class="two-factor-setup">
            <label>Chave manual <input id="setting-totp-secret" value="${escapeHtml(formatTotpSecret(secret))}" readonly /></label>
            <label class="span-2">URI otpauth <textarea id="setting-totp-uri" readonly>${escapeHtml(uri)}</textarea></label>
            <label>Codigo atual do app <input id="setting-totp-code" inputmode="numeric" maxlength="6" placeholder="000000" /></label>
            <div class="two-factor-actions">
              <button class="btn primary" type="button" data-security-action="confirm-2fa">${security.twoFactorEnabled ? "Revalidar 2FA" : "Ativar 2FA"}</button>
              <button class="btn ghost" type="button" data-security-action="copy-2fa">Copiar chave</button>
              <button class="btn danger" type="button" data-security-action="disable-2fa">${security.twoFactorEnabled ? "Desativar 2FA" : "Descartar chave"}</button>
            </div>
          </div>
        ` : `
          <div class="two-factor-empty">
            <p>Ao configurar, o sistema gera uma chave real TOTP e so habilita a protecao depois que o primeiro codigo for confirmado.</p>
            <button class="btn primary" type="button" data-security-action="generate-2fa">Configurar autenticador</button>
          </div>
        `}
      </section>
      ${settingsActions()}
    </form>
  `;
}

function supabaseImportStatusText() {
  const last = state.lastSupabaseImport;
  if (!last) return "Copia produtos, clientes, vendas, caixa, financeiro, usuarios, logs e configuracoes para o Supabase.";
  const when = last.finishedAt ? formatDateTime(last.finishedAt) : "em andamento";
  const records = Number(last.records || 0).toLocaleString("pt-BR");
  const primary = last.primaryRecords ? ` | operacional: ${Number(last.primaryRecords || 0).toLocaleString("pt-BR")}` : "";
  return `Ultima importacao: ${records} registro(s) em ${when}${primary}`;
}

function renderSettingsBackupLive() {
  const license = state.license || {};
  const dbLabel = state.localDbAvailable ? "PostgreSQL OK" : "PostgreSQL pendente";
  const licenseLabel = license.status || state.settings.tenant?.licenseStatus || "indefinida";
  return `
    <div class="settings-content-header">
      <div><h3>Backup</h3><p>Exportacao, importacao e copia automatica local.</p></div>
      <button id="export-settings-data" class="btn primary" type="button">Exportar JSON</button>
    </div>
    <div class="backup-grid">
      <article><strong>Backup automatico diario</strong><span>Ultimo: ${state.settings.backup.lastAutoBackupAt ? new Date(state.settings.backup.lastAutoBackupAt).toLocaleString("pt-BR") : "Nunca"}</span>${settingSwitch(state.settings.backup.autoDaily, "autoDaily")}</article>
      <article><strong>Fazer backup agora</strong><span>Gera arquivo JSON completo</span><button class="btn ghost" type="button" data-settings-action="backup-now">Executar</button></article>
      <article><strong>Restaurar backup</strong><span>Importa JSON exportado</span><button class="btn ghost" type="button" data-settings-action="restore-backup">Selecionar arquivo</button></article>
      <article><strong>Importar banco para Supabase</strong><span>${escapeHtml(supabaseImportStatusText())}</span><button class="btn ghost" type="button" data-settings-action="import-supabase-db">Importar agora</button></article>
      <article><strong>Diagnostico local</strong><span>API: ${escapeHtml(state.dbStatus || "local")} | Banco: ${escapeHtml(dbLabel)} | Licenca: ${escapeHtml(licenseLabel)} | Versao: ${escapeHtml(APP_VERSION)}</span><button class="btn ghost" type="button" data-settings-action="diagnostics">Atualizar</button></article>
      <article><strong>Conteudo</strong><span>Usuarios, vendas, estoque, configuracoes e financeiro</span>${settingBadge("Completo")}</article>
    </div>
  `;
}

function renderSettingsAppearanceLive() {
  const appearance = state.settings.appearance;
  return `
    <div class="settings-content-header">
      <div><h3>Aparencia</h3><p>Tema, cores e rodape do comprovante.</p></div>
      <span class="settings-section-icon blue">AP</span>
    </div>
    <form class="settings-detail-form" data-settings-form="appearance">
      <label>Tema <select id="setting-theme"><option ${appearance.theme === "Claro" ? "selected" : ""}>Claro</option><option ${appearance.theme === "Escuro" ? "selected" : ""}>Escuro</option></select></label>
      <label>Identidade visual <input id="setting-accent" value="${escapeHtml(appearance.accent)}" /></label>
      <label>Cor principal <input id="setting-primary-color" type="color" value="${escapeHtml(appearance.primaryColor || "#0f1f3d")}" /></label>
      <label>Cor secundaria <input id="setting-secondary-color" type="color" value="${escapeHtml(appearance.secondaryColor || "#6d3fd1")}" /></label>
      <label class="span-2">Rodape do comprovante <textarea id="setting-receipt-footer">${escapeHtml(state.settings.store.receiptFooter)}</textarea></label>
      ${settingsActions()}
    </form>
  `;
}

function renderSettings() {
  const content = $("#settings-tab-content");
  if (!content) return;
  if (state.settingsTab === "general") state.settingsTab = "store";
  $$(".settings-tab").forEach((button) => button.classList.toggle("active", button.dataset.settingsTab === state.settingsTab));
  const renderers = {
    store: renderSettingsStoreLive,
    users: renderSettingsUsersLive,
    permissions: renderSettingsPermissionsLive,
    finance: renderSettingsFinanceLive,
    "pdv-settings": renderSettingsPdvLive,
    notifications: renderSettingsNotificationsLive,
    integrations: renderSettingsIntegrationsLive,
    security: renderSettingsSecurityLive,
    backup: renderSettingsBackupLive,
    license: renderSettingsLicense,
    appearance: renderSettingsAppearanceLive,
  };
  content.innerHTML = (renderers[state.settingsTab] || renderSettingsStoreLive)();
}

function applySettings() {
  applyRuntimeSettings();
  return;
  document.title = state.settings.systemName;
  $(".login-card h1").textContent = state.settings.systemName;
  $$(".sidebar-brand strong").forEach((item) => {
    item.textContent = state.settings.systemName.replace(" Gestão", "");
  });
  $$(".sidebar-brand span:last-child").forEach((item) => {
    item.textContent = state.settings.systemName.includes("Gestão") ? "Gestão" : "Sistema";
  });
  $$(".user-chip strong").forEach((item) => {
    item.textContent = state.settings.adminName;
  });
}

function applyRuntimeSettings() {
  const storeName = state.settings.store?.storeName || state.settings.store?.name || state.settings.companyName;
  document.title = state.settings.systemName;
  $(".login-card h1").textContent = state.settings.systemName;
  $$(".sidebar-brand strong").forEach((item) => {
    item.textContent = storeName;
  });
  $$(".sidebar-brand span:last-child").forEach((item) => {
    item.textContent = state.settings.systemName;
  });
  const user = currentUser();
  const displayName = user?.name || user?.username || state.settings.adminName || "Administrador";
  const userEmail = user?.email || user?.username || "admin@worldatacado.com.br";
  const initial = displayName.trim().charAt(0).toUpperCase() || "A";
  const role = normalizeAppRole(user?.role, "Administrador");
  $$(".user-chip strong").forEach((item) => {
    item.textContent = displayName;
  });
  $$(".user-chip .avatar").forEach((item) => {
    item.textContent = initial;
  });
  $$(".user-chip small").forEach((item) => {
    item.textContent = role;
  });
  setText("#sidebar-user-name", displayName);
  const sidebarRole = $("#sidebar-user-email");
  if (sidebarRole) {
    sidebarRole.textContent = role;
    sidebarRole.title = userEmail;
  }
  setText(".sidebar-user-avatar", initial);
  document.documentElement.dataset.theme = state.settings.appearance?.theme === "Escuro" ? "dark" : "light";
  document.documentElement.style.setProperty("--navy", state.settings.appearance?.primaryColor || "#0f1f3d");
  document.documentElement.style.setProperty("--purple", state.settings.appearance?.secondaryColor || "#6d3fd1");
  updateVersionInfo();
  updateDbConnectionIndicator();
  applyAccessControls();
  updateFinanceMenu();
  updateHeaderControls();
  const saleModeButton = $(".pdv-sale-mode");
  if (saleModeButton) {
    const active = state.pdvLocked;
    saleModeButton.classList.toggle("active", active);
    saleModeButton.textContent = active ? "Modo venda ativo" : "Modo venda";
    saleModeButton.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function applyAccessControls() {
  $$(".nav-link, .nav-sublink").forEach((button) => {
    const permission = permissionForScreen(button.dataset.screen);
    const blocked = (permission && !hasPermission(permission))
      || isLicenseBlockedFor(button.dataset.screen)
      || !hasModuleAccess(moduleForScreen(button.dataset.screen));
    button.classList.toggle("hidden", Boolean(blocked));
  });
  applySensitiveDataVisibility();
}

function toggleClosest(selector, closestSelector, hidden) {
  const element = $(selector);
  const target = closestSelector ? element?.closest(closestSelector) : element;
  if (target) target.classList.toggle("hidden", Boolean(hidden));
}

function applySensitiveDataVisibility() {
  const restricted = !canViewCommissions();
  toggleClosest("#dash-commission-today", ".stat-card", restricted);
  toggleClosest("#finance-commission-total", "span", restricted);
  toggleClosest("#finance-commission-summary", ".panel", restricted);
  toggleClosest("#commission-report-table", ".panel", restricted);
  toggleClosest("#export-commission-csv", null, restricted);
}

function reportExportRows(filters = readReportFilters({ syncInputs: true })) {
  const data = reportAggregates(filters);
  if (filters.kind === "financial") {
    return [
      ["tipo", "data", "descricao", "forma_ou_categoria", "valor"],
      ...[
        ...data.sales.map((sale) => ["venda", safeReportDay(sale.date), sale.id, sale.payment || "-", toNumber(sale.total).toFixed(2)]),
        ...data.expenses.map((expense) => ["despesa", safeReportDay(expense.date), expense.description, expense.category || "Geral", toNumber(expense.value).toFixed(2)]),
      ].sort((a, b) => String(b[1]).localeCompare(String(a[1]))),
    ];
  }
  if (filters.kind === "sales") {
    return [
      ["data", "venda", "cliente", "vendedor", "pagamento", "subtotal", "desconto", "total"],
      ...data.sales.map((sale) => [
        safeReportDay(sale.date),
        sale.id,
        sale.client || sale.clientName || "Consumidor final",
        sale.vendedorNome || sale.sellerName || "-",
        sale.payment || "-",
        toNumber(sale.subtotal || sale.grossTotal || sale.total).toFixed(2),
        toNumber(sale.discount || 0).toFixed(2),
        toNumber(sale.total).toFixed(2),
      ]),
    ];
  }
  if (filters.kind === "products") {
    return [
      ["produto", "quantidade", "faturamento", "lucro"],
      ...data.topProducts.map((row) => [row.name, row.qty, row.total.toFixed(2), row.profit.toFixed(2)]),
    ];
  }
  if (filters.kind === "clients") {
    return [
      ["cliente", "compras", "total_comprado"],
      ...data.topClients.map((row) => [row.name, row.count, row.total.toFixed(2)]),
    ];
  }
  if (filters.kind === "payments") {
    return [
      ["forma_pagamento", "quantidade", "total"],
      ...data.payments.map((row) => [row.name, row.count, row.total.toFixed(2)]),
    ];
  }
  if (filters.kind === "commissions") {
    return [
      ["vendedor", "quantidade_vendas", "total_vendido", "percentual_comissao", "comissao_a_pagar"],
      ...commissionRows(data.sales).map((row) => [
        row.sellerName,
        row.count,
        row.total.toFixed(2),
        row.percent.toFixed(2),
        row.commission.toFixed(2),
      ]),
    ];
  }
  return [
    ["secao", "indicador", "valor"],
    ["resumo", "periodo", reportPeriodText(filters)],
    ["resumo", "receita", data.income.toFixed(2)],
    ["resumo", "despesas", data.expensesTotal.toFixed(2)],
    ["resumo", "saldo", data.balance.toFixed(2)],
    ["resumo", "vendas", data.sales.length],
    ["resumo", "custo_produtos_vendidos", data.productCostTotal.toFixed(2)],
    ["resumo", "lucro_bruto", data.grossProfit.toFixed(2)],
    ["resumo", "lucro_estimado", data.profit.toFixed(2)],
  ];
}

function renderReportExportPreview(filters = readReportFilters()) {
  const node = $("#report-export-preview");
  if (!node) return;
  const rows = reportExportRows(filters);
  const headers = rows[0] || [];
  const body = rows.slice(1, 26);
  node.innerHTML = `
    <table class="compact-dashboard-table">
      <thead><tr>${headers.map((header) => `<th>${escapeHtml(String(header).replaceAll("_", " "))}</th>`).join("")}</tr></thead>
      <tbody>${body.length
        ? body.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? ""))}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${Math.max(1, headers.length)}" class="muted">Sem dados para este filtro.</td></tr>`}
      </tbody>
    </table>
  `;
}

function reportExportFilename(filters = readReportFilters()) {
  const slug = String(filters.kind || "general").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const start = filters.start || "inicio";
  const end = filters.end || todayISO();
  return `mptech-relatorio-${slug}-${start}-${end}`;
}

function assertReportExportAllowed(filters = readReportFilters()) {
  if (filters.kind === "commissions" && !canViewCommissions()) {
    showToast("Relatorio de comissoes restrito ao administrador.", "error");
    return false;
  }
  return true;
}

function exportReportTxt() {
  const filters = readReportFilters({ syncInputs: true });
  if (!assertReportExportAllowed(filters)) return;
  const rows = reportExportRows(filters);
  const content = rows.map((row) => row.join(" | ")).join("\n");
  downloadText(`${reportExportFilename(filters)}.txt`, `${REPORT_KIND_LABELS[filters.kind] || "Relatorio"}\nPeriodo: ${reportPeriodText(filters)}\n\n${content || "Sem dados."}`);
  showToast("Relatorio TXT gerado.", "success");
}

function generateSelectedReport() {
  const filters = readReportFilters({ syncInputs: true });
  if (!assertReportExportAllowed(filters)) return;
  renderReports();
  if (filters.format === "screen") {
    showToast("Relatorio atualizado na tela.", "success");
    return;
  }
  if (filters.format === "json") {
    exportData();
    return;
  }
  if (filters.format === "pdf") {
    exportReportPdf();
    return;
  }
  if (filters.format === "txt") {
    exportReportTxt();
    return;
  }
  exportCsv();
}

function printReport() {
  const entries = filteredFinance();
  const text = entries.map((entry) => {
    const date = new Date(entry.date).toLocaleDateString("pt-BR");
    return `${date} | ${entry.type} | ${entry.description} | ${entry.payment} | ${money.format(entry.value)}`;
  }).join("\n");
  downloadText(`mptech-relatorio-financeiro-${todayISO()}.txt`, `Relatório financeiro\n\n${text || "Nenhum movimento no período."}`);
  showToast("Relatório financeiro gerado.", "success");
}

function exportReportPdf() {
  switchScreen("reports");
  readReportFilters({ syncInputs: true });
  renderReports();
  clearReceiptPrintMode();
  window.print();
}

async function exportData() {
  const version = appVersionInfo();
  let payload;
  try {
    if (localDatabaseService?.exportBackup && hasLocalApiSession()) {
      const response = await localDatabaseService.exportBackup();
      payload = response?.data || response;
      state.localDbAvailable = true;
    }
  } catch {
    state.localDbAvailable = false;
  }
  if (!payload) {
    payload = {
      exportedAt: new Date().toISOString(),
      appVersion: version.version,
      appVersionUpdatedAt: version.updatedAt,
      users: state.settings.users,
      finance: state.settings.finance,
      config: state.settings,
      settings: state.settings,
      data: state.data,
    };
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mptech-backup-${todayISO()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.settings.backup.lastAutoBackupAt = new Date().toISOString();
  saveSettings();
}

async function importDatabaseToSupabase() {
  if (!requirePermission("config_access", "importar banco para Supabase")) return;
  if (!isAdminUser()) {
    showToast("Apenas administrador pode importar o banco para o Supabase.", "error");
    return;
  }
  if (!localDatabaseService?.importDatabaseToSupabase || !hasLocalApiSession()) {
    showToast("Entre pela API local para importar o banco ao Supabase.", "error");
    return;
  }

  const confirmed = await confirmAction(
    "Importar banco para Supabase",
    "Esta acao copia todo o PostgreSQL local para tabelas de importacao no Supabase. O banco local nao sera apagado nem substituido.",
    { confirmText: "Importar agora", cancelText: "Cancelar" },
  );
  if (!confirmed) return;

  try {
    showToast("Importando banco local para o Supabase...", "info");
    const response = await localDatabaseService.importDatabaseToSupabase({
      clientId: currentSaasClientId(),
      requestedBy: currentUser()?.username || currentUser()?.email || "",
    });
    const result = response?.data || response;
    if (result?.ok === false) throw new Error(result.message || "Importacao recusada pelo backend local.");
    const importSummary = {
      ok: result?.ok !== false,
      importId: result?.importId || "",
      records: Number(result?.records || 0),
      operationalRecords: Number(result?.operationalRecords || 0),
      primaryRecords: Number(result?.primaryRecords || 0),
      primarySchema: result?.primarySchema || "",
      backupFile: result?.backupFile || "",
      startedAt: result?.startedAt || "",
      finishedAt: result?.finishedAt || new Date().toISOString(),
      counts: result?.counts || {},
    };
    state.lastSupabaseImport = importSummary;
    state.settings.backup.lastSupabaseImport = importSummary;
    state.localDbAvailable = true;
    state.lastSyncAt = importSummary.finishedAt;
    saveSettings();
    renderSettings();
    showToast(`Banco importado para o Supabase: ${importSummary.records.toLocaleString("pt-BR")} registro(s).`, "success");
  } catch (error) {
    showToast(error?.message || "Nao foi possivel importar o banco para o Supabase.", "error");
  }
}

function runAutomaticBackup() {
  if (!state.settings.backup?.autoDaily) return;
  const last = state.settings.backup.lastAutoBackupAt ? state.settings.backup.lastAutoBackupAt.slice(0, 10) : "";
  if (last === todayISO()) return;
  localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify({
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    appVersionUpdatedAt: APP_VERSION_UPDATED_AT,
    users: state.settings.users,
    finance: state.settings.finance,
    config: state.settings,
    data: state.data,
  }));
  state.settings.backup.lastAutoBackupAt = new Date().toISOString();
  saveSettings();
}

function runIntegrationAction(action) {
  const integrations = state.settings.integrations || {};
  const store = state.settings.store || {};
  if (action === "whatsapp") {
    const phone = (integrations.whatsappNumber || store.phone || "").replace(/\D/g, "");
    if (!phone) {
      notifyEvent("error", "Configure o numero do WhatsApp.", "error");
      return;
    }
    const message = integrations.whatsappDefaultMessage || store.defaultMessage || "Ola! Como podemos ajudar?";
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  }
  if (action === "instagram") {
    const profile = normalizeText(integrations.instagramProfile || store.instagram).replace("@", "");
    if (!profile) {
      notifyEvent("error", "Configure o Instagram.", "error");
      return;
    }
    window.open(`https://instagram.com/${profile}`, "_blank");
  }
  if (action === "pix") {
    const merchant = integrations.pixMerchantName || store.storeName || state.settings.companyName || "LOJA";
    const city = integrations.pixMerchantCity || store.city || "CIDADE";
    const pixPayload = [
      "PIX-SIMULADO",
      `TIPO=${integrations.pixKeyType || "aleatoria"}`,
      `CHAVE=${integrations.pixKey || "sem-chave"}`,
      `RECEBEDOR=${merchant}`,
      `CIDADE=${city}`,
    ].join("|");
    showDialog({
      title: "Pix simulado",
      body: `<p><strong>${escapeHtml(pixPayload)}</strong></p><p>Use esta base para validar dados antes de gerar QR Code em uma integracao backend.</p>`,
      confirmText: "Fechar",
      cancelText: "Voltar",
    });
  }
}

function downloadText(filename, content, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvContent(rows) {
  return rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";")).join("\n");
}

function exportCsv() {
  const filters = readReportFilters({ syncInputs: true });
  if (!assertReportExportAllowed(filters)) return;
  downloadText(`${reportExportFilename(filters)}.csv`, csvContent(reportExportRows(filters)), "text/csv");
  showToast("Relatorio CSV gerado.", "success");
}

function exportCommissionCsv() {
  if (!canViewCommissions()) {
    showToast("Relatorio de comissoes restrito ao administrador.", "error");
    return;
  }
  const start = $("#commission-start")?.value || "";
  const end = $("#commission-end")?.value || "";
  const sellerId = $("#commission-seller")?.value || "";
  const rows = [
    ["vendedor", "quantidade_vendas", "total_vendido", "percentual_comissao", "comissao_a_pagar"],
    ...commissionRows(salesInDateRange(start, end, sellerId)).map((row) => [
      row.sellerName,
      row.count,
      row.total.toFixed(2),
      row.percent.toFixed(2),
      row.commission.toFixed(2),
    ]),
  ];
  downloadText(`mptech-comissoes-${todayISO()}.csv`, csvContent(rows), "text/csv");
}

function exportClientsCsv() {
  const openReceivables = openReceivablesByClient();
  const rows = [
    ["nome", "telefone", "email", "documento", "status", "debito_aberto"],
    ...state.data.clients.map((client) => [
      client.name,
      client.phone || "",
      client.email || "",
      client.document || "",
      client.status || "Ativo",
      openReceivables[client.name] || 0,
    ]),
  ];
  downloadText(`mptech-clientes-${todayISO()}.csv`, csvContent(rows), "text/csv");
}

function downloadBulkTemplate(type) {
  const isProduct = type === "products";
  const rows = isProduct
    ? [
      ["codigo_opcional", "nome", "categoria", "codigo_barras", "fornecedor", "preco_varejo", "preco_atacado", "qtd_minima_atacado", "preco_custo", "estoque", "estoque_minimo"],
      ["", "Camiseta Basica", "Roupas", "789000000001", "Fornecedor A", "59,90", "49,90", "10", "30,00", "20", "5"],
    ]
    : [
      ["nome", "telefone", "email", "documento", "observacoes", "status"],
      ["Maria Silva", "(11) 99999-0000", "maria@email.com", "123.456.789-00", "Cliente atacado", "Ativo"],
    ];
  downloadText(`modelo-${isProduct ? "produtos" : "clientes"}-${todayISO()}.csv`, csvContent(rows), "text/csv");
}

function normalizeHeader(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function rowValue(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(row, key) && normalizeText(row[key]) !== "") {
      return row[key];
    }
  }
  return "";
}

function parseWorksheetRows(sheetRows) {
  if (!sheetRows.length) return [];
  const headers = sheetRows[0].map(normalizeHeader);
  return sheetRows.slice(1)
    .map((cells, index) => {
      const row = { __line: index + 2 };
      headers.forEach((header, cellIndex) => {
        if (header) row[header] = cells[cellIndex] ?? "";
      });
      return row;
    })
    .filter((row) => Object.entries(row).some(([key, value]) => key !== "__line" && normalizeText(value) !== ""));
}

function parseCsvText(text) {
  const delimiter = text.includes(";") ? ";" : text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function readTextFile(file) {
  const buffer = await file.arrayBuffer();
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  if (!utf8Text.includes("\uFFFD")) return utf8Text;
  try {
    return new TextDecoder("windows-1252").decode(buffer);
  } catch {
    return utf8Text;
  }
}

function parseHtmlTableRows(text) {
  const html = normalizeText(text).replace(/^"+|"+$/g, "");
  if (!html) return [];

  const decodeCell = (value) => {
    const wrapper = document.createElement("textarea");
    wrapper.innerHTML = String(value || "").replace(/<br\s*\/?>/gi, " ");
    return normalizeText(wrapper.value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  };
  const regexRows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) => Array.from(row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cell) => decodeCell(cell[1])))
    .filter((cells) => cells.some((cell) => cell));

  const parser = new DOMParser();
  const documentHtml = parser.parseFromString(html, "text/html");
  const domRows = Array.from(documentHtml.querySelectorAll("tr"))
    .map((tr) => Array.from(tr.querySelectorAll("th,td")).map((cell) => normalizeText(cell.textContent).replace(/\s+/g, " ")))
    .filter((cells) => cells.some((cell) => cell));
  const tableRows = regexRows.length ? regexRows : domRows;

  if (!tableRows.length) return [];

  const headerIndex = tableRows.findIndex((cells) => {
    const headers = cells.map(normalizeHeader);
    const hasName = headers.some((header) => ["nome", "nome_razao", "nome_raz_o", "cliente", "razao_social"].includes(header));
    const hasPhone = headers.some((header) => ["telefone", "celular", "whatsapp", "fone"].includes(header));
    return cells.length >= 3 && hasName && hasPhone;
  });

  return parseWorksheetRows(tableRows.slice(Math.max(0, headerIndex)));
}

async function readBulkSheet(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  if (["html", "htm"].includes(extension) || file.type === "text/html") {
    const text = await readTextFile(file);
    return parseHtmlTableRows(text);
  }
  if (["csv", "tsv"].includes(extension) && !window.XLSX) {
    const text = await readTextFile(file);
    return parseWorksheetRows(parseCsvText(text));
  }
  if (!window.XLSX) {
    throw new Error("Leitor de Excel nao carregado.");
  }
  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });
  return parseWorksheetRows(rows);
}

function productFromImportRow(row) {
  const code = normalizeText(rowValue(row, ["codigo", "codigo_opcional", "cod", "sku", "referencia"])) || generateProductCode();
  const name = normalizeText(rowValue(row, ["nome", "produto", "descricao"]));
  return {
    sourceLine: row.__line,
    product: {
      id: makeId("prd"),
      code,
      name,
      category: normalizeCategoryName(rowValue(row, ["categoria", "grupo"])) || "Geral",
      barcode: normalizeText(rowValue(row, ["codigo_barras", "cod_barras", "ean", "barcode"])) || code,
      supplier: normalizeText(rowValue(row, ["fornecedor"])) || "Nao informado",
      retailPrice: Math.max(0, toNumber(rowValue(row, ["preco_varejo", "preco_venda", "preco", "venda", "valor_venda"]))),
      wholesalePrice: Math.max(0, toNumber(rowValue(row, ["preco_atacado", "atacado", "valor_atacado", "preco_venda"]))),
      wholesaleMinQty: Math.max(1, toNumber(rowValue(row, ["qtd_minima_atacado", "quantidade_minima_atacado", "qtd_atacado", "min_atacado"]), 1)),
      price: Math.max(0, toNumber(rowValue(row, ["preco_varejo", "preco_venda", "preco", "venda", "valor_venda"]))),
      cost: Math.max(0, toNumber(rowValue(row, ["preco_custo", "custo", "valor_custo"]))),
      stock: Math.max(0, toNumber(rowValue(row, ["estoque", "quantidade", "qtd"]))),
      minStock: Math.max(0, toNumber(rowValue(row, ["estoque_minimo", "minimo", "min_stock"]))),
      active: true,
    },
  };
}

function clientFromImportRow(row) {
  const name = normalizeText(rowValue(row, ["nome", "nome_razao", "nome_raz_o", "cliente", "razao_social"]));
  const phone = normalizeText(rowValue(row, ["celular", "whatsapp", "telefone", "fone"]));
  const landline = normalizeText(rowValue(row, ["telefone", "fone"]));
  const mobile = normalizeText(rowValue(row, ["celular", "whatsapp"]));
  const contact = normalizeText(rowValue(row, ["contato"]));
  const fax = normalizeText(rowValue(row, ["fax"]));
  const group = normalizeText(rowValue(row, ["grupo", "categoria"]));
  const importedNotes = [
    contact ? `Contato: ${contact}` : "",
    landline && mobile && landline !== mobile ? `Telefone: ${landline}` : "",
    fax ? `FAX: ${fax}` : "",
    group ? `Grupo: ${group}` : "",
    normalizeText(rowValue(row, ["observacoes", "obs", "notas"])),
  ].filter(Boolean).join(" | ");
  return {
    sourceLine: row.__line,
    client: {
      id: makeId("cli"),
      name,
      phone: phone || landline || mobile || "-",
      email: normalizeText(rowValue(row, ["email", "e_mail"])) || "-",
      document: normalizeText(rowValue(row, ["documento", "cpf", "cnpj", "cpf_cnpj"])) || "-",
      notes: importedNotes,
      status: normalizeText(rowValue(row, ["status"])) || "Ativo",
      createdAt: new Date().toISOString(),
    },
  };
}

function validateBulkItems(type, rows) {
  const items = rows.map(type === "products" ? productFromImportRow : clientFromImportRow);
  const errors = [];
  const seenKeys = new Set();
  const validItems = [];

  for (const item of items) {
    if (type === "products") {
      const product = item.product;
      if (!product.name) {
        errors.push(`Linha ${item.sourceLine}: nome do produto e obrigatorio.`);
        continue;
      }
      if (seenKeys.has(product.code)) {
        errors.push(`Linha ${item.sourceLine}: codigo duplicado na planilha (${product.code}).`);
        continue;
      }
      seenKeys.add(product.code);
      const existing = state.data.products.find((stored) => stored.code === product.code);
      if (existing) product.id = existing.id;
      validItems.push({ ...item, action: existing ? "Atualizar" : "Criar" });
    } else {
      const client = item.client;
      if (!client.name) {
        errors.push(`Linha ${item.sourceLine}: nome do cliente e obrigatorio.`);
        continue;
      }
      const key = client.document !== "-" ? client.document : client.email !== "-" ? client.email.toLowerCase() : client.name.toLowerCase();
      if (seenKeys.has(key)) {
        errors.push(`Linha ${item.sourceLine}: cliente duplicado na planilha (${key}).`);
        continue;
      }
      seenKeys.add(key);
      const existing = state.data.clients.find((stored) =>
        (client.document !== "-" && stored.document === client.document)
        || (client.email !== "-" && (stored.email || "").toLowerCase() === client.email.toLowerCase())
        || stored.name.toLowerCase() === client.name.toLowerCase()
      );
      if (existing) client.id = existing.id;
      validItems.push({ ...item, action: existing ? "Atualizar" : "Criar" });
    }
  }

  return { validItems, errors };
}

function importPreviewHtml(type, validItems, errors, fileName) {
  const isProduct = type === "products";
  const rows = validItems.slice(0, 8).map((item) => {
    const record = isProduct ? item.product : item.client;
    return `<tr><td>${item.sourceLine}</td><td>${escapeHtml(record.code || record.name)}</td><td>${escapeHtml(record.name)}</td><td>${item.action}</td></tr>`;
  }).join("");
  return `
    <div class="bulk-import-preview">
      <p><strong>Arquivo:</strong> ${escapeHtml(fileName)}</p>
      <div class="import-summary-grid">
        <article><strong>${validItems.length}</strong><span>registros validos</span></article>
        <article><strong>${validItems.filter((item) => item.action === "Criar").length}</strong><span>novos</span></article>
        <article><strong>${validItems.filter((item) => item.action === "Atualizar").length}</strong><span>atualizacoes</span></article>
        <article><strong>${errors.length}</strong><span>erros</span></article>
      </div>
      ${errors.length ? `<div class="import-errors"><strong>Erros encontrados</strong><ul>${errors.slice(0, 8).map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>${errors.length > 8 ? `<small>Mais ${errors.length - 8} erro(s) oculto(s).</small>` : ""}</div>` : ""}
      ${validItems.length ? `<div class="table-wrap"><table class="settings-table"><thead><tr><th>Linha</th><th>${isProduct ? "Codigo" : "Chave"}</th><th>Nome</th><th>Acao</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
      <p class="muted">A importacao atualiza registros existentes pela chave principal e cria os demais.</p>
    </div>
  `;
}

async function importBulkFile(type, file) {
  if (!file) return;
  if (type === "products" && !requirePermission("estoque_access", "importar produtos")) return;
  if (type === "clients" && !requireSession("importar clientes")) return;

  try {
    const rows = await readBulkSheet(file);
    if (!rows.length) {
      showToast("O arquivo nao possui linhas para importar.", "error");
      return;
    }
    const { validItems, errors } = validateBulkItems(type, rows);
    const confirmed = await showDialog({
      title: type === "products" ? "Importar produtos" : "Importar clientes",
      body: importPreviewHtml(type, validItems, errors, file.name),
      confirmText: validItems.length ? "Importar" : "Fechar",
      cancelText: "Cancelar",
    });
    if (!confirmed || !validItems.length) return;

    if (type === "products") {
      for (const item of validItems) {
        const index = state.data.products.findIndex((product) => product.id === item.product.id);
        if (index >= 0) state.data.products[index] = item.product;
        else state.data.products.unshift(item.product);
      }
      await syncImportedRecords("produtos", validItems.map((item) => item.product), syncProduct);
      saveDataWithAudit("Importacao de produtos", `${validItems.length} registro(s) de ${file.name}`);
    } else {
      for (const item of validItems) {
        const index = state.data.clients.findIndex((client) => client.id === item.client.id);
        if (index >= 0) state.data.clients[index] = item.client;
        else state.data.clients.unshift(item.client);
      }
      await syncImportedRecords("clientes", validItems.map((item) => item.client), syncClient);
      saveDataWithAudit("Importacao de clientes", `${validItems.length} registro(s) de ${file.name}`);
      state.clientPage = 1;
    }

    renderAll();
    showToast(`${validItems.length} registro(s) importado(s).`, "success");
  } catch (error) {
    showToast(error?.message || "Nao foi possivel importar o arquivo.", "error");
  } finally {
    const input = $("#bulk-import-file");
    if (input) input.value = "";
    state.bulkImportType = "";
  }
}

function viewClientHistory(clientId) {
  const client = state.data.clients.find((item) => item.id === clientId);
  if (!client) return;
  const clientName = clientNameForDisplay(client);
  const clientKey = normalizedKey(clientName);
  const sales = state.data.sales.filter((sale) => !sale.canceled && (
    sale.clientId === client.id
    || sale.cliente_id === client.id
    || normalizedKey(sale.client || sale.clientName) === clientKey
  ));
  const body = `
    <div class="client-history">
      <p><strong>${escapeHtml(clientName)}</strong><br>${escapeHtml(client.phone || client.telefone || "-")} | ${escapeHtml(client.email || "-")} | ${escapeHtml(client.document || client.documento || "-")}</p>
      ${sales.length ? `
        <div class="table-wrap">
          <table class="settings-table">
            <thead><tr><th>Data</th><th>Pagamento</th><th>Itens</th><th>Total (R$)</th></tr></thead>
            <tbody>${sales.map((sale) => {
              const saleDate = sale.date || sale.createdAt;
              const itemCount = Array.isArray(sale.items) ? sale.items.length : 0;
              return `<tr><td>${saleDate ? new Date(saleDate).toLocaleDateString("pt-BR") : "-"}</td><td>${escapeHtml(sale.payment || "-")}</td><td>${itemCount}</td><td>${money.format(toNumber(sale.total))}</td></tr>`;
            }).join("")}</tbody>
          </table>
        </div>
      ` : `<p class="muted">Nenhuma compra vinculada a este cliente.</p>`}
    </div>
  `;
  showDialog({ title: "Histórico do cliente", body, confirmText: "Fechar", cancelText: "Voltar" });
}

function normalizeBackupPayload(payload = {}) {
  if (payload.app === "MPTech Gestao" && payload.data) return payload;
  return {
    app: "MPTech Gestao",
    version: 1,
    exportedAt: payload.exportedAt || new Date().toISOString(),
    data: payload.data,
  };
}

function importBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!payload.data) throw new Error("Backup inválido");
      if (localDatabaseService?.validateBackup && hasLocalApiSession()) {
        const validationResponse = await localDatabaseService.validateBackup(normalizeBackupPayload(payload));
        const validation = validationResponse?.data || validationResponse;
        if (validation?.ok === false) throw new Error(validation.errors?.join(" ") || "Backup invalido");
      }
      if (localDatabaseService?.restoreBackup && hasLocalApiSession()) {
        await localDatabaseService.restoreBackup(normalizeBackupPayload(payload));
        state.localDbAvailable = true;
      }
      state.data = normalizeData(payload.data);
      if (payload.settings || payload.config || payload.users) {
        state.settings = mergeSettings({ ...state.settings, ...(payload.settings || payload.config || {}), users: payload.users || payload.settings?.users || payload.config?.users });
      }
      saveDataWithAudit("Backup importado", file.name);
      saveSettings();
      renderAll();
    } catch (error) {
      showToast("Não foi possível importar o arquivo.", "error");
    }
  };
  reader.readAsText(file);
}

async function cancelSale(saleId) {
  return cancelarVenda(saleId);
}

async function cancelIncome(saleId) {
  return cancelarVenda(saleId, "entrada");
}

async function tryCancelSaleBackend(saleId, motivo = "") {
  if (!localDatabaseService?.cancelarVenda || !hasLocalApiSession()) return false;
  try {
    await localDatabaseService.cancelarVenda(saleId, motivo);
    state.localDbAvailable = true;
    state.lastSyncAt = new Date().toISOString();
    return true;
  } catch {
    state.localDbAvailable = false;
    return false;
  }
}

async function cancelarVenda(saleId, source = "venda") {
  if (!requirePermission("financeiro_access", "cancelar vendas")) return;
  const sale = state.data.sales.find((item) => item.id === saleId);
  if (!sale || sale.canceled) return;
  const isIncomeCancellation = source === "entrada";
  const confirmed = await confirmAction(
    isIncomeCancellation ? "Cancelar entrada" : "Cancelar venda",
    isIncomeCancellation ? "Cancelar esta entrada, estornar o valor do caixa e devolver produtos ao estoque?" : "Cancelar venda e devolver produtos ao estoque?",
    { danger: true, confirmText: isIncomeCancellation ? "Cancelar entrada" : "Cancelar venda" }
  );
  if (!confirmed) return;
  const reason = isIncomeCancellation ? "Cancelamento pela tela de entradas" : "Cancelamento manual";
  const backendCanceled = await tryCancelSaleBackend(saleId, reason);
  sale.canceled = true;
  sale.canceledAt = new Date().toISOString();
  sale.cancelReason = reason;
  sale.commissionCanceled = true;
  sale.commissionCanceledAt = sale.canceledAt;
  sale.items.forEach((item) => {
    const product = state.data.products.find((stored) => stored.id === item.productId);
    if (product) {
      product.stock += item.qty;
      state.data.stockMovements.unshift({
        id: makeId("mov"),
        date: new Date().toISOString(),
        productId: product.id,
        productName: product.name,
        type: "Cancelamento de venda",
        qty: item.qty,
        reason: `Venda ${sale.id.slice(-6).toUpperCase()}`,
      });
      syncProduct(product);
      syncStockMovement(state.data.stockMovements[0]);
    }
  });
  const session = currentCashSession();
  if (session) {
    const movement = {
      id: makeId("cash"),
      type: "out",
      date: new Date().toISOString(),
      description: `Cancelamento ${sale.id.slice(-6).toUpperCase()}`,
      value: sale.total,
      payment: sale.payment,
    };
    session.movements.push(movement);
    syncCashMovement(session.id, movement);
  }
  if (!backendCanceled) syncSale(sale);
  saveDataWithAudit("Venda cancelada", `${sale.id} - ${money.format(sale.total)}`);
  renderAll();
}

function printSale(saleId) {
  const sale = state.data.sales.find((item) => item.id === saleId);
  if (!sale) return;
  imprimirComprovante(sale);
}

function selectSaleForReceipt(saleId) {
  const sale = state.data.sales.find((item) => item.id === saleId);
  if (!sale) return;
  state.selectedSaleId = sale.id;
  renderSalesHistory();
}

function reprintSelectedSale() {
  const sale = selectedSale();
  if (!sale) {
    showToast("Selecione uma venda para reimprimir o cupom.", "error");
    return;
  }
  if (sale.canceled) {
    showToast("Venda cancelada nao pode ser reimpressa.", "error");
    return;
  }
  printSale(sale.id);
}

function imprimirComprovante(venda) {
  if (!venda) return;
  renderReceipt(venda);
  printCurrentReceipt(1);
}

function saleReceiptMessage(sale) {
  const pdv = { ...defaultSettings().pdv, ...(state.settings.pdv || {}) };
  const receiptOptions = { ...defaultSettings().pdv.receiptOptions, ...(pdv.receiptOptions || {}) };
  return buildReceiptText(sale, pdv, receiptOptions);
}

async function copySaleReceipt(saleId) {
  const sale = state.data.sales.find((item) => item.id === saleId);
  if (!sale) return;
  const message = saleReceiptMessage(sale);
  try {
    await navigator.clipboard.writeText(message);
    showToast("Comprovante copiado para envio.", "success");
  } catch {
    downloadText(`comprovante-${sale.id}.txt`, message);
    showToast("Comprovante gerado em TXT.", "info");
  }
}

function sendSaleReceiptWhatsApp(saleId) {
  const sale = state.data.sales.find((item) => item.id === saleId);
  if (!sale) return;
  const phone = onlyDigits(sale.clientPhone || state.data.clients.find((client) => client.id === sale.clientId)?.phone || "");
  const message = saleReceiptMessage(sale);
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
  saveDataWithAudit("Comprovante WhatsApp", `Venda ${sale.id}`);
}

async function imprimirCupomTeste(width = "") {
  const form = document.querySelector('[data-settings-form="pdv"]');
  const previousPdvSettings = { ...state.settings.pdv };
  const currentFormSettings = form ? collectPdvSettingsForm(form) : previousPdvSettings;
  state.settings.pdv = { ...defaultSettings().pdv, ...previousPdvSettings, ...currentFormSettings };
  if (width) state.settings.pdv.receiptPaperWidth = normalizeReceiptPaperWidth(width, state.settings.pdv.receiptPaperWidth);
  const effectiveWidth = state.settings.pdv.receiptPaperWidth;
  const testSale = {
    id: "TESTE-CUPOM",
    date: new Date().toISOString(),
    items: [
      {
        name: "Produto teste",
        code: "TESTE001",
        qty: 2,
        unitPrice: 12.5,
        total: 25,
      },
    ],
    subtotal: 25,
    discount: 0,
    fees: 0,
    total: 25,
    netTotal: 25,
    payment: "Dinheiro",
    vendedorNome: "Ana Vendedora",
    amountReceived: 30,
    change: 5,
    clientName: "Cliente teste",
    clientDocument: "000.000.000-00",
    clientPhone: "(00) 00000-0000",
  };
  renderReceipt(testSale);
  state.settings.pdv = previousPdvSettings;
  const shouldPrint = await confirmAction(
    "Teste de impressao",
    `Um cupom de teste ${effectiveWidth} foi gerado. Na proxima janela, selecione a impressora termica instalada no Windows e confira papel, margens e dados exibidos.`,
    { confirmText: "Abrir impressao", cancelText: "Cancelar" },
  );
  if (shouldPrint) printCurrentReceipt(1);
}

function viewSale(saleId) {
  const sale = state.data.sales.find((item) => item.id === saleId);
  if (!sale) return;
  const canReprint = !sale.canceled;
  const body = `
    <div class="client-history">
      <p><strong>Venda ${escapeHtml(sale.id)}</strong><br>${new Date(sale.date).toLocaleString("pt-BR")} | ${escapeHtml(sale.payment)} | ${escapeHtml(sale.client || sale.clientName || "Consumidor final")}</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Item</th><th>Qtd.</th><th>Total (R$)</th></tr></thead>
          <tbody>${sale.items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.qty}</td><td>${money.format(item.total)}</td></tr>`).join("")}</tbody>
        </table>
      </div>
      <p><strong>Total:</strong> ${money.format(sale.total)}${sale.canceled ? " | Cancelada" : ""}</p>
      ${canReprint ? `<div class="sale-detail-actions"><button class="btn primary" type="button" data-print-sale="${escapeHtml(sale.id)}">Reimprimir cupom</button></div>` : ""}
    </div>
  `;
  showDialog({ title: "Detalhes da venda", body, confirmText: "Fechar", cancelText: "Voltar" });
}

async function deleteExpense(expenseId) {
  if (!requirePermission("financeiro_access", "excluir despesas")) return;
  const expense = state.data.expenses.find((item) => item.id === expenseId);
  if (!expense) return;
  const confirmed = await confirmAction("Excluir despesa", `Excluir despesa ${expense.description}?`, { danger: true, confirmText: "Excluir" });
  if (!confirmed) return;
  state.data.expenses = state.data.expenses.filter((item) => item.id !== expenseId);
  if (localDatabaseService?.remove && hasLocalApiSession()) {
    localDatabaseService.remove("financeiro", expenseId).catch(() => {
      state.localDbAvailable = false;
    });
  }
  saveDataWithAudit("Despesa excluída", expense.description);
  renderAll();
}

function togglePayable(id) {
  if (!requirePermission("financeiro_access", "atualizar contas")) return;
  const account = state.data.accountsPayable.find((item) => item.id === id);
  if (!account) return;
  account.status = account.status === "Pago" ? "Aberto" : "Pago";
  if (account.status === "Pago") {
    const expense = {
      id: makeId("exp"),
      date: todayISO(),
      description: account.description,
      category: account.category || "Conta a pagar",
      value: account.value,
      type: "expense",
    };
    state.data.expenses.unshift(expense);
    syncExpense(expense);
  }
  syncPayable(account);
  saveDataWithAudit("Conta a pagar atualizada", `${account.description} - ${account.status}`);
  renderAll();
}

async function toggleReceivable(id) {
  if (!requirePermission("financeiro_access", "atualizar contas")) return;
  const account = state.data.accountsReceivable.find((item) => item.id === id);
  if (!account) return;
  if (account.status === "Recebido") {
    const confirmed = await confirmAction("Reabrir conta", `Reabrir ${account.description}?`, { confirmText: "Reabrir" });
    if (!confirmed) return;
    account.status = "Aberto";
    account.paidValue = 0;
    account.remainingValue = toNumber(account.value);
    account.payments = [];
    syncReceivable(account);
    saveDataWithAudit("Conta a receber reaberta", `${account.description} - ${account.client}`);
    renderAll();
    return;
  }
  const remaining = Math.max(0, toNumber(account.remainingValue ?? account.value) || toNumber(account.value));
  const result = await promptFields("Receber conta", [
    { name: "value", label: "Valor recebido (R$)", type: "number", value: remaining.toFixed(2), min: "0.01", step: "0.01", required: true },
    { name: "payment", label: "Forma", value: "Dinheiro", required: true },
  ], { confirmText: "Registrar recebimento" });
  if (!result) return;
  const received = Math.min(remaining, Math.max(0, toNumber(result.value)));
  if (received <= 0) return;
  account.payments = Array.isArray(account.payments) ? account.payments : [];
  account.payments.push({
    id: makeId("payrec"),
    date: new Date().toISOString(),
    value: received,
    payment: normalizeText(result.payment) || "Dinheiro",
  });
  account.paidValue = toNumber(account.paidValue) + received;
  account.remainingValue = Math.max(0, toNumber(account.value) - account.paidValue);
  account.status = account.remainingValue <= 0.009 ? "Recebido" : "Parcial";
  if (received > 0) {
    const session = currentCashSession();
    if (session) {
      const movement = {
        id: makeId("cash"),
        type: "in",
        date: new Date().toISOString(),
        description: `Recebimento: ${account.description}`,
        value: received,
        payment: normalizeText(result.payment) || "Dinheiro",
      };
      session.movements.push(movement);
      syncCashMovement(session.id, movement);
    }
  }
  syncReceivable(account);
  saveDataWithAudit("Conta a receber atualizada", `${account.description} - recebido ${money.format(received)} - ${account.status}`);
  renderAll();
}

async function adjustStock(productId) {
  if (!requirePermission("estoque_access", "ajustar estoque")) return;
  const product = state.data.products.find((item) => item.id === productId);
  if (!product) return;
  const result = await promptFields("Ajustar estoque", [
    { name: "qty", label: "Quantidade do ajuste (use negativo para saída)", type: "number", value: "0", required: true },
    { name: "reason", label: "Motivo", value: "Ajuste manual", required: true },
  ]);
  if (!result) return;
  const qty = toNumber(result.qty);
  if (!qty) return;
  const reason = normalizeText(result.reason) || "Ajuste manual";
  product.stock = Math.max(0, product.stock + qty);
  state.data.stockMovements.unshift({
    id: makeId("mov"),
    date: new Date().toISOString(),
    productId: product.id,
    productName: product.name,
    type: qty > 0 ? "Entrada manual" : "Saída manual",
    qty,
    reason,
  });
  syncProduct(product);
  syncStockMovement(state.data.stockMovements[0]);
  saveDataWithAudit("Estoque ajustado", `${product.name}: ${qty}`);
  renderAll();
  showToast("Estoque ajustado.", "success");
  if (product.stock <= product.minStock) notifyEvent("lowStock", `${product.name} esta com estoque baixo.`, "info");
}

async function addSimpleAccount(type) {
  if (!requirePermission("financeiro_access", "criar contas")) return;
  const fields = [
    { name: "description", label: type === "payable" ? "Descrição da conta a pagar" : "Descrição da conta a receber", required: true },
    { name: "value", label: "Valor (R$)", type: "number", value: "0", min: "0", placeholder: "R$ 0,00", required: true },
    { name: "dueDate", label: "Vencimento", type: "date", value: todayISO(), required: true },
    { name: type === "payable" ? "category" : "client", label: type === "payable" ? "Categoria" : "Cliente", value: type === "payable" ? "Geral" : "Cliente", required: true },
  ];
  const result = await promptFields(type === "payable" ? "Conta a pagar" : "Conta a receber", fields);
  if (!result?.description) return;
  const description = normalizeText(result.description);
  const value = toNumber(result.value);
  if (value <= 0) return;
  const dueDate = normalizeText(result.dueDate) || todayISO();

  if (type === "payable") {
    const category = normalizeText(result.category) || "Geral";
    const account = {
      id: makeId("pay"),
      dueDate,
      description,
      category,
      value,
      status: "Aberto",
    };
    state.data.accountsPayable.unshift(account);
    syncPayable(account);
  } else {
    const client = normalizeText(result.client) || "Cliente";
    const account = {
      id: makeId("rec"),
      dueDate,
      client,
      description,
      value,
      status: "Aberto",
    };
    state.data.accountsReceivable.unshift(account);
    syncReceivable(account);
  }

  saveData();
  renderAll();
  showToast("Conta cadastrada.", "success");
}

async function addAccountModal(type) {
  if (!requirePermission("financeiro_access", "criar contas")) return;
  const isPayable = type === "payable";
  const clientOptions = state.data.clients.length ? state.data.clients.map((client) => client.name) : ["Cliente"];
  const categoryOptions = state.settings.finance?.categories?.length ? state.settings.finance.categories : ["Geral"];
  const fields = [
    { name: "description", label: isPayable ? "Descricao da despesa" : "Descricao da cobranca", placeholder: isPayable ? "Ex.: Aluguel, fornecedor, energia" : "Ex.: Parcela, fiado, pedido", required: true },
    { name: "value", label: "Valor (R$)", type: "number", value: "0", min: "0.01", step: "0.01", placeholder: "R$ 0,00", required: true },
    { name: "dueDate", label: "Vencimento", type: "date", value: todayISO(), required: true },
    isPayable
      ? { name: "category", label: "Categoria", type: "select", options: categoryOptions, value: categoryOptions[0], required: true }
      : { name: "client", label: "Cliente", type: "select", options: clientOptions, value: clientOptions[0], required: true },
    { name: "notes", label: "Observacoes", type: "textarea" },
  ];
  const result = await promptFields(isPayable ? "Nova conta a pagar" : "Nova conta a receber", fields, { confirmText: "Cadastrar conta" });
  if (!result?.description) return;
  const description = normalizeText(result.description);
  const value = toNumber(result.value);
  if (value <= 0) {
    notifyEvent("error", "Informe um valor maior que zero.", "error");
    return;
  }
  const dueDate = normalizeText(result.dueDate) || todayISO();
  const notes = normalizeText(result.notes);

  if (isPayable) {
    const account = {
      id: makeId("pay"),
      dueDate,
      description,
      category: normalizeText(result.category) || "Geral",
      value,
      notes,
      status: "Aberto",
    };
    state.data.accountsPayable.unshift(account);
    syncPayable(account);
  } else {
    const account = {
      id: makeId("rec"),
      dueDate,
      client: normalizeText(result.client) || "Cliente",
      description,
      value,
      notes,
      status: "Aberto",
    };
    state.data.accountsReceivable.unshift(account);
    syncReceivable(account);
  }

  saveDataWithAudit(isPayable ? "Conta a pagar cadastrada" : "Conta a receber cadastrada", `${description} - ${money.format(value)}`);
  renderAll();
  showToast("Conta cadastrada.", "success");
}

async function addSimpleClient(options = {}) {
  if (!requireSession("cadastrar clientes")) return;
  const result = await promptFields("Novo cliente", [
    { name: "name", label: "Nome", required: true },
    { name: "phone", label: "Telefone" },
    { name: "document", label: "CPF/CNPJ" },
    { name: "email", label: "E-mail", type: "email" },
    { name: "notes", label: "Observacoes", type: "textarea" },
  ], { confirmText: "Cadastrar" });
  if (!result?.name) return;
  const validationError = validateContactFields(result);
  if (validationError) {
    showToast(validationError, "error");
    return;
  }
  const client = {
    id: makeId("cli"),
    name: normalizeText(result.name),
    phone: normalizeText(result.phone) || "-",
    email: normalizeText(result.email) || "-",
    document: normalizeText(result.document) || "-",
    notes: normalizeText(result.notes),
    status: "Ativo",
    createdAt: new Date().toISOString(),
  };
  state.data.clients.unshift(client);
  if (options?.selectForPdv) {
    state.selectedClientId = client.id;
    state.pdvClientSearch = "";
  }
  state.clientPage = 1;
  syncClient(client);
  saveDataWithAudit("Cliente cadastrado", client.name);
  renderAll();
  showToast("Cliente cadastrado.", "success");
  return client;
}

function closeClientActionsMenu() {
  $("#client-floating-menu")?.remove();
  $$("[data-client-menu][aria-expanded='true']").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function openClientActionsMenu(clientId, anchor) {
  const client = state.data.clients.find((item) => item.id === clientId);
  if (!client || !anchor) return;
  const isInactive = client.status === "Inativo";
  closeClientActionsMenu();
  anchor.setAttribute("aria-expanded", "true");

  const menu = document.createElement("div");
  menu.id = "client-floating-menu";
  menu.className = "client-floating-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-edit-client="${escapeHtml(client.id)}">Editar</button>
    <button type="button" role="menuitem" data-toggle-client-status="${escapeHtml(client.id)}">${isInactive ? "Reativar" : "Inativar"}</button>
    <button class="danger" type="button" role="menuitem" data-delete-client="${escapeHtml(client.id)}">Excluir</button>
  `;
  document.body.appendChild(menu);

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;
  let left = anchorRect.right - menuRect.width;
  let top = anchorRect.bottom + 6;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));
  if (top + menuRect.height > window.innerHeight - margin) {
    top = Math.max(margin, anchorRect.top - menuRect.height - 6);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function clientLinkedRecordCount(client) {
  const clientName = clientNameForDisplay(client);
  const clientKey = normalizedKey(clientName);
  const byClientRef = (value) => normalizedKey(value) === clientKey;
  const sales = state.data.sales.filter((sale) =>
    sale.clientId === client.id
    || sale.cliente_id === client.id
    || byClientRef(sale.client || sale.clientName)
  ).length;
  const receivables = state.data.accountsReceivable.filter((account) =>
    account.clientId === client.id
    || byClientRef(account.client)
  ).length;
  const quotes = state.data.quotes.filter((quote) =>
    quote.clientId === client.id
    || byClientRef(quote.clientName || quote.client)
  ).length;
  const services = state.data.serviceRecords.filter((record) =>
    record.clientId === client.id
    || byClientRef(record.clientName || record.client)
  ).length;
  return sales + receivables + quotes + services;
}

function updateLinkedClientReferences(previousName, client) {
  const previousKey = normalizedKey(previousName);
  const clientName = clientNameForDisplay(client);
  const clientDocument = client.document || client.documento || "";
  const clientPhone = client.phone || client.telefone || "";
  const clientEmail = client.email || "";
  const matches = (recordId, recordName) => recordId === client.id || normalizedKey(recordName) === previousKey;

  state.data.sales.forEach((sale) => {
    if (!matches(sale.clientId || sale.cliente_id, sale.client || sale.clientName)) return;
    sale.clientId = sale.clientId || client.id;
    sale.cliente_id = sale.cliente_id || client.id;
    sale.client = clientName;
    sale.clientName = clientName;
    sale.clientDocument = clientDocument;
    sale.clientPhone = clientPhone;
    sale.clientEmail = clientEmail;
  });

  state.data.accountsReceivable.forEach((account) => {
    if (!matches(account.clientId, account.client)) return;
    account.clientId = account.clientId || client.id;
    account.client = clientName;
  });

  state.data.quotes.forEach((quote) => {
    if (!matches(quote.clientId, quote.clientName || quote.client)) return;
    quote.clientId = quote.clientId || client.id;
    quote.clientName = clientName;
  });

  state.data.serviceRecords.forEach((record) => {
    if (!matches(record.clientId, record.clientName || record.client)) return;
    record.clientId = record.clientId || client.id;
    record.clientName = clientName;
  });
}

async function editClient(clientId) {
  if (!requireSession("editar clientes")) return;
  const client = state.data.clients.find((item) => item.id === clientId);
  if (!client) return;
  const result = await promptFields("Editar cliente", [
    { name: "name", label: "Nome", value: clientNameForDisplay(client), required: true },
    { name: "phone", label: "Telefone", value: client.phone || client.telefone || "" },
    { name: "document", label: "CPF/CNPJ", value: client.document || client.documento || "" },
    { name: "email", label: "E-mail", type: "email", value: client.email === "-" ? "" : client.email },
    { name: "status", label: "Status", type: "select", options: ["Ativo", "Inativo"], value: client.status === "Inativo" ? "Inativo" : "Ativo" },
    { name: "notes", label: "Observacoes", type: "textarea", value: client.notes || client.observacoes || "" },
  ], { confirmText: "Salvar" });
  if (!result?.name) return;
  const validationError = validateContactFields(result);
  if (validationError) {
    showToast(validationError, "error");
    return;
  }

  const previousName = clientNameForDisplay(client);
  client.name = normalizeText(result.name);
  client.phone = normalizeText(result.phone) || "-";
  client.telefone = client.phone;
  client.email = normalizeText(result.email) || "-";
  client.document = normalizeText(result.document) || "-";
  client.documento = client.document;
  client.notes = normalizeText(result.notes);
  client.status = result.status === "Inativo" ? "Inativo" : "Ativo";
  client.updatedAt = new Date().toISOString();

  updateLinkedClientReferences(previousName, client);
  if (state.selectedClientId === client.id && client.status === "Inativo") {
    state.selectedClientId = "";
    state.pdvClientSearch = "";
  }
  syncClient(client);
  saveDataWithAudit("Cliente editado", client.name);
  renderAll();
  showToast("Cliente atualizado.", "success");
}

async function toggleClientStatus(clientId) {
  if (!requireSession("alterar status de cliente")) return;
  const client = state.data.clients.find((item) => item.id === clientId);
  if (!client) return;
  const inactivate = client.status !== "Inativo";
  if (inactivate) {
    const confirmed = await confirmAction("Inativar cliente", `Inativar ${clientNameForDisplay(client)}?`, { confirmText: "Inativar" });
    if (!confirmed) return;
  }

  client.status = inactivate ? "Inativo" : "Ativo";
  client.updatedAt = new Date().toISOString();
  if (state.selectedClientId === client.id && inactivate) {
    state.selectedClientId = "";
    state.pdvClientSearch = "";
  }
  syncClient(client);
  saveDataWithAudit(inactivate ? "Cliente inativado" : "Cliente reativado", clientNameForDisplay(client));
  renderAll();
  showToast(inactivate ? "Cliente inativado." : "Cliente reativado.", "success");
}

async function deleteClient(clientId) {
  if (!requireSession("excluir clientes")) return;
  const client = state.data.clients.find((item) => item.id === clientId);
  if (!client) return;
  const linkedRecords = clientLinkedRecordCount(client);
  const clientName = clientNameForDisplay(client);
  const confirmed = await confirmAction(
    linkedRecords ? "Inativar cliente" : "Excluir cliente",
    linkedRecords
      ? `${clientName} possui ${linkedRecords} registro(s) vinculado(s). Para preservar o historico, ele sera inativado em vez de excluido.`
      : `Excluir definitivamente ${clientName}?`,
    { danger: true, confirmText: linkedRecords ? "Inativar" : "Excluir" },
  );
  if (!confirmed) return;

  if (linkedRecords) {
    client.status = "Inativo";
    client.updatedAt = new Date().toISOString();
    syncClient(client);
    saveDataWithAudit("Cliente inativado", clientName);
    showToast("Cliente possui historico e foi inativado.", "info");
  } else {
    state.data.clients = state.data.clients.filter((item) => item.id !== client.id);
    if (localDatabaseService?.remove && hasLocalApiSession()) {
      localDatabaseService.remove("clientes", client.id).catch(() => {
        state.localDbAvailable = false;
      });
    }
    saveDataWithAudit("Cliente excluido", clientName);
    showToast("Cliente excluido.", "success");
  }

  if (state.selectedClientId === client.id) {
    state.selectedClientId = "";
    state.pdvClientSearch = "";
  }
  renderAll();
}

function bindEvents() {
  const debouncedProductSearch = debounce(renderSearchResults, 120);
  const debouncedInventoryRender = debounce(renderProducts, 180);
  const debouncedClientSelectorRender = debounce(renderPdvClientSelector, 160);
  const debouncedClientsRender = debounce(renderClients, 180);

  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const user = $("#login-user").value.trim();
    const pass = $("#login-pass").value.trim();
    if (localDatabaseService?.login) {
      try {
        const response = await localDatabaseService.login(user, pass);
        const authUser = response?.data || response;
        if (authUser?.id) {
          upsertAuthenticatedUser(authUser);
          const twoFactorValid = await validateTwoFactorIfNeeded(authUser);
          if (!twoFactorValid) return;
          if (authUser.saasClientId) {
            localStorage.setItem("mptech_saas_client_id", authUser.saasClientId);
            window.MPTECH_SAAS_CLIENT_ID = authUser.saasClientId;
          }
          localStorage.setItem(SESSION_KEY, JSON.stringify({
            logged: true,
            userId: authUser.id,
            user: authUser.usuario || authUser.email || user,
            role: roleFromAuth(authUser),
            saasClientId: authUser.saasClientId || null,
            token: authUser.token || "",
            expiresAt: Date.now() + state.settings.sessionMinutes * 60 * 1000,
          }));
          saveDataWithAudit("Login", `Usuario ${authUser.usuario || authUser.email || user} entrou pela API local.`);
          showApp();
          return;
        }
      } catch (error) {
        if (isProduction()) {
          $("#login-error").textContent = error?.message || "Nao foi possivel validar o usuario na API local.";
          return;
        }
        // Em desenvolvimento/homologacao, mantem fallback local quando a API ainda nao estiver pronta.
      }
    }
    const foundUser = state.settings.users.find((item) => item.active !== false && item.username === user && item.passwordHash === simpleHash(pass));
    if (foundUser) {
      const twoFactorValid = await validateTwoFactorIfNeeded(foundUser);
      if (!twoFactorValid) return;
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        logged: true,
        userId: foundUser.id,
        user: foundUser.username,
        role: foundUser.role,
        expiresAt: Date.now() + state.settings.sessionMinutes * 60 * 1000,
      }));
      saveDataWithAudit("Login", `Usuário ${foundUser.username} entrou no sistema.`);
      showApp();
      return;
    }
    $("#login-error").textContent = state.settings.users.length
      ? "Usuário ou senha inválidos."
      : "Use o e-mail e a senha cadastrados para esta loja no portal SaaS.";
  });

  $("#logout-btn").addEventListener("click", () => {
    saveDataWithAudit("Logout", "Sessão encerrada.");
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PDV_SELLER_KEY);
    state.currentSellerId = "";
    state.cart = [];
    state.selectedClientId = "";
    showLogin();
  });

  $$(".nav-link").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("nav-parent")) {
        state.financeMenuOpen = !state.financeMenuOpen;
        updateFinanceMenu();
        if (state.financeMenuOpen) switchScreen("finance");
        return;
      }
      switchScreen(button.dataset.screen);
    });
  });
  $$(".nav-sublink").forEach((button) => {
    button.addEventListener("click", () => {
      switchScreen(button.dataset.screen);
      state.financeMenuOpen = false;
      updateFinanceMenu();
    });
  });
  $("#theme-dark-toggle")?.addEventListener("click", () => setHeaderTheme("Escuro"));
  $("#theme-light-toggle")?.addEventListener("click", () => setHeaderTheme("Claro"));
  $("#notification-button")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleHeaderNotifications();
  });
  $("#notification-menu")?.addEventListener("click", (event) => {
    const jump = event.target.closest("[data-screen-jump]");
    if (jump) {
      $("#notification-menu")?.classList.add("hidden");
      $("#notification-button")?.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("click", (event) => {
    const clickedNotifications = event.target.closest("#notification-menu, #notification-button");
    if (!clickedNotifications) {
      $("#notification-menu")?.classList.add("hidden");
      $("#notification-button")?.setAttribute("aria-expanded", "false");
    }
    if (state.financeMenuOpen && !event.target.closest(".nav-group")) {
      state.financeMenuOpen = false;
      updateFinanceMenu();
    }
  });
  $(".menu-toggle").addEventListener("click", toggleSidebar);
  $(".sidebar-backdrop").addEventListener("click", () => $("#app-shell").classList.remove("mobile-menu-open"));
  window.addEventListener("resize", restoreSidebarState);
  $("#pdv-fullscreen")?.addEventListener("click", togglePdvFullscreen);
  document.addEventListener("fullscreenchange", updatePdvFullscreenButton);
  $("#product-search").addEventListener("input", (event) => {
    debouncedProductSearch();
    handleBarcodeSearch(event.target.value);
  });
  $("#product-search").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!addFirstVisibleProductFromSearch()) handleBarcodeSearch(event.target.value, { alertMissing: true });
  });
  $("#open-drawer")?.addEventListener("click", () => showToast("Comando de abertura de gaveta enviado.", "info"));
  $("#dashboard-period").addEventListener("change", (event) => {
    if (event.target.value !== "custom") setDashboardDateRangeByPreset(event.target.value);
    renderFinanceSummaryChart();
  });
  $("#dashboard-start-date")?.addEventListener("change", () => {
    $("#dashboard-period").value = "custom";
    renderFinanceSummaryChart();
  });
  $("#dashboard-end-date")?.addEventListener("change", () => {
    $("#dashboard-period").value = "custom";
    renderFinanceSummaryChart();
  });
  $("#cart-discount").addEventListener("input", renderCart);
  $("#cart-discount-type")?.addEventListener("change", renderCart);
  $("#amount-received").addEventListener("input", renderCart);
  $("#quick-product").addEventListener("click", () => {
    if (state.pdvLocked) {
      showToast("Modo venda ativo. Cadastros ficam bloqueados ate desbloquear a gestao.", "error");
      return;
    }
    switchScreen("products");
  });
  $(".pdv-sale-mode")?.addEventListener("click", () => {
    if (!state.pdvLocked) activatePdvSaleMode();
    else switchScreen("pdv");
    focusPdvSearch();
  });
  $("#new-product-btn").addEventListener("click", () => {
    if (!requirePermission("estoque_access", "cadastrar produtos")) return;
    $("#product-form").reset();
    $("#product-id").value = "";
    $("#product-code").value = generateProductCode();
    $("#product-form-title").textContent = "Cadastrar produto";
    openProductModal();
  });
  $("#inventory-search").addEventListener("input", (event) => {
    state.inventorySearch = event.target.value;
    debouncedInventoryRender();
  });
  $("#inventory-category-filter").addEventListener("change", (event) => {
    state.inventoryCategory = event.target.value;
    renderProducts();
  });
  $("#inventory-status-filter").addEventListener("change", (event) => {
    state.inventoryStatus = event.target.value;
    renderProducts();
  });
  $("#clear-cart").addEventListener("click", clearPdvCart);
  $("#pdv-client-search")?.addEventListener("input", (event) => {
    state.pdvClientSearch = event.target.value;
    debouncedClientSelectorRender();
  });
  $("#pdv-client-select")?.addEventListener("change", (event) => {
    state.selectedClientId = event.target.value;
    renderPdvClientSelector();
  });
  $("#pdv-clear-client")?.addEventListener("click", () => {
    state.selectedClientId = "";
    state.pdvClientSearch = "";
    renderPdvClientSelector();
  });
  $("#pdv-new-client")?.addEventListener("click", () => {
    if (state.pdvLocked) {
      showToast("Modo venda ativo. Cadastro de cliente bloqueado ate desbloquear a gestao.", "error");
      return;
    }
    addSimpleClient({ selectForPdv: true });
  });
  $("#pdv-seller")?.addEventListener("change", (event) => {
    state.currentSellerId = event.target.value;
    event.target.classList.toggle("required-missing", !state.currentSellerId);
    if (state.currentSellerId) localStorage.setItem(PDV_SELLER_KEY, state.currentSellerId);
    else localStorage.removeItem(PDV_SELLER_KEY);
  });
  $("#pdv-lock-mode")?.addEventListener("click", togglePdvLockMode);
  $("#pdv-unlock-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    unlockPdvFromOverlay();
  });
  $("#finish-sale").addEventListener("click", finishSale);
  $("#confirm-finish-sale")?.addEventListener("click", confirmPdvCheckoutSale);
  $("#pdv-checkout-close")?.addEventListener("click", () => closePdvCheckoutModal());
  $("#pdv-checkout-cancel")?.addEventListener("click", () => closePdvCheckoutModal());
  $("#pdv-checkout-modal")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closePdvCheckoutModal();
  });
  $("#save-quote")?.addEventListener("click", saveQuote);
  $("#recover-quote")?.addEventListener("click", () => recoverQuote(true));
  $("#convert-quote")?.addEventListener("click", convertQuoteToSale);
  $("#cancel-quote")?.addEventListener("click", cancelQuote);
  $("#product-form").addEventListener("submit", saveProduct);
  $("#cancel-product-edit").addEventListener("click", resetProductForm);
  $("#expense-form").addEventListener("submit", saveExpense);
  $("#expense-form-secondary").addEventListener("submit", saveExpense);
  $("#filter-start").addEventListener("change", renderFinance);
  $("#filter-end").addEventListener("change", renderFinance);
  $("#clear-filter").addEventListener("click", () => {
    $("#filter-start").value = "";
    $("#filter-end").value = "";
    renderFinance();
  });
  $("#open-cash").addEventListener("click", openCash);
  $("#pdv-open-cash")?.addEventListener("click", openCash);
  $("#cash-in").addEventListener("click", () => moveCash("in"));
  $("#cash-out").addEventListener("click", () => moveCash("out"));
  $("#close-cash").addEventListener("click", closeCash);
  $("#pdv-close-cash")?.addEventListener("click", closeCash);
  $("#print-report").addEventListener("click", printReport);
  $("#export-data").addEventListener("click", exportData);
  $("#export-settings-data")?.addEventListener("click", exportData);
  $("#export-csv").addEventListener("click", exportCsv);
  $("#generate-report")?.addEventListener("click", generateSelectedReport);
  $("#report-kind")?.addEventListener("change", renderReports);
  $("#report-format")?.addEventListener("change", () => readReportFilters({ syncInputs: true }));
  $("#report-period")?.addEventListener("change", renderReports);
  $("#report-start")?.addEventListener("change", renderReports);
  $("#report-end")?.addEventListener("change", renderReports);
  $("#export-commission-csv")?.addEventListener("click", exportCommissionCsv);
  $("#commission-start")?.addEventListener("change", renderCommissionReport);
  $("#commission-end")?.addEventListener("change", renderCommissionReport);
  $("#commission-seller")?.addEventListener("change", renderCommissionReport);
  $("#product-report-start")?.addEventListener("change", renderProductSalesReport);
  $("#product-report-end")?.addEventListener("change", renderProductSalesReport);
  $("#product-report-seller")?.addEventListener("change", renderProductSalesReport);
  $("#product-report-category")?.addEventListener("change", renderProductSalesReport);
  $("#export-pdf")?.addEventListener("click", exportReportPdf);
  $("#import-data")?.addEventListener("click", () => $("#import-file")?.click());
  $("#import-file")?.addEventListener("change", (event) => importBackup(event.target.files[0]));
  $("#import-products").addEventListener("click", () => {
    state.bulkImportType = "products";
    $("#bulk-import-file")?.click();
  });
  $("#products-template").addEventListener("click", () => downloadBulkTemplate("products"));
  $("#bulk-import-file")?.addEventListener("change", (event) => importBulkFile(state.bulkImportType, event.target.files[0]));
  $("#settings-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = $("#setting-admin-password").value.trim();
    state.settings = {
      ...state.settings,
      companyName: $("#setting-company-name").value.trim(),
      sessionMinutes: Number($("#setting-session-minutes").value || 240),
    };
    if (password) {
      state.settings.users = [{ username: "admin", passwordHash: simpleHash(password), role: "Administrador" }];
    }
    saveSettings();
    syncSettings();
    saveDataWithAudit("Configurações atualizadas", "Dados do sistema");
    applySettings();
    showToast("Configurações salvas.", "success");
  });
  $("#reset-sample-data")?.addEventListener("click", () => {
    refreshDataFromSupabase();
    return;
  });
  $("#new-payable").addEventListener("click", () => addAccountModal("payable"));
  $("#new-receivable").addEventListener("click", () => addAccountModal("receivable"));
  $("#new-client").addEventListener("click", addSimpleClient);
  $("#client-search").addEventListener("input", (event) => {
    state.clientSearch = event.target.value;
    state.clientPage = 1;
    debouncedClientsRender();
  });
  $("#client-status-filter")?.addEventListener("change", (event) => {
    state.clientStatusFilter = event.target.value;
    state.clientPage = 1;
    renderClients();
  });
  $("#client-filter-btn").addEventListener("click", () => {
    state.clientDebtOnly = !state.clientDebtOnly;
    state.clientPage = 1;
    renderClients();
  });
  $(".client-pagination")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-client-page]");
    if (!button || button.disabled) return;
    const totalPages = Math.max(1, Number(button.closest(".client-pagination")?.dataset.totalPages) || 1);
    if (button.dataset.clientPage === "prev") state.clientPage = Math.max(1, state.clientPage - 1);
    if (button.dataset.clientPage === "next") state.clientPage = Math.min(totalPages, state.clientPage + 1);
    renderClients();
  });
  $("#export-clients").addEventListener("click", exportClientsCsv);
  $("#import-clients").addEventListener("click", () => {
    state.bulkImportType = "clients";
    $("#bulk-import-file")?.click();
  });
  $("#clients-template").addEventListener("click", () => downloadBulkTemplate("clients"));
  $("#client-quick-new")?.addEventListener("click", addSimpleClient);
  $("#client-quick-import")?.addEventListener("click", () => {
    state.bulkImportType = "clients";
    $("#bulk-import-file")?.click();
  });
  $("#client-quick-export")?.addEventListener("click", exportClientsCsv);
  $("#new-exchange")?.addEventListener("click", () => createServiceRecord("troca"));
  $("#new-warranty")?.addEventListener("click", () => createServiceRecord("garantia"));
  $("#new-service-order")?.addEventListener("click", () => createServiceRecord("assistencia"));

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-settings-form]");
    if (!form) return;
    event.preventDefault();
    if (!requirePermission("config_access", "alterar configuracoes")) return;
    let auditAction = "Configurações atualizadas";
    let auditDetail = `Aba ${form.dataset.settingsForm}`;
    if (form.dataset.settingsForm === "general") {
      showToast("Configuracoes gerais do sistema sao alteradas somente pelo SaaS.", "error");
      return;
    }
    if (["finance", "pdv"].includes(form.dataset.settingsForm) && !isAdminUser()) {
      showToast("Apenas administrador pode alterar comissao, impressora e cupom.", "error");
      return;
    }
    if (form.dataset.settingsForm === "store") {
      const storeControlledBySaas = isStoreControlledBySaas();
      const validationError = validateContactFields({
        document: storeControlledBySaas ? state.settings.store.cnpj : $("#setting-store-cnpj")?.value,
        phone: storeControlledBySaas ? state.settings.store.phone : $("#setting-store-phone")?.value,
        email: storeControlledBySaas ? state.settings.store.email : $("#setting-store-email")?.value,
      });
      if (validationError) {
        showToast(validationError, "error");
        return;
      }
      if (storeControlledBySaas) {
        state.settings.store = {
          ...state.settings.store,
          instagram: normalizeText($("#setting-store-instagram")?.value),
          defaultMessage: normalizeText($("#setting-store-message")?.value),
          receiptFooter: normalizeText($("#setting-store-footer")?.value),
        };
        showToast("Dados cadastrais da loja sao sincronizados pelo SaaS. Preferencias locais salvas.", "info");
        saveSettings();
        renderSettings();
        return;
      }
      const storeName = normalizeText($("#setting-store-name")?.value) || state.settings.store.storeName;
      state.settings.store = {
        ...state.settings.store,
        storeName,
        name: storeName,
        cnpj: normalizeText($("#setting-store-cnpj")?.value),
        document: normalizeText($("#setting-store-cnpj")?.value),
        address: normalizeText($("#setting-store-address")?.value),
        city: normalizeText($("#setting-store-city")?.value),
        state: normalizeText($("#setting-store-state")?.value),
        phone: normalizeText($("#setting-store-phone")?.value),
        instagram: normalizeText($("#setting-store-instagram")?.value),
        email: normalizeText($("#setting-store-email")?.value),
        defaultMessage: normalizeText($("#setting-store-message")?.value),
        receiptFooter: normalizeText($("#setting-store-footer")?.value),
      };
      state.settings.companyName = storeName;
    }
    if (form.dataset.settingsForm === "permissions") {
      let changed = 0;
      state.settings.users.forEach((user) => {
        Object.keys(DEFAULT_PERMISSIONS).forEach((permission) => {
          const input = form.querySelector(`input[name="${user.id}:${permission}"]`);
          if (input && user.permissions[permission] !== input.checked) {
            user.permissions[permission] = input.checked;
            changed += 1;
          }
        });
      });
      auditAction = "Permissoes atualizadas";
      auditDetail = `${changed} permissao(oes) alterada(s).`;
    }
    if (form.dataset.settingsForm === "finance") {
      const defaults = defaultSettings().finance;
      const categories = csvToList($("#setting-finance-categories")?.value);
      const bankAccounts = csvToList($("#setting-bank-accounts")?.value);
      const defaultBankAccount = normalizeText($("#setting-default-bank-account")?.value) || bankAccounts[0] || defaults.defaultBankAccount;
      state.settings.finance = {
        categories: categories.length ? categories : defaults.categories,
        bankAccounts: bankAccounts.length ? bankAccounts : defaults.bankAccounts,
        defaultBankAccount,
        pixFee: Math.max(0, toNumber($("#setting-pix-fee")?.value)),
        cardFee: Math.max(0, toNumber($("#setting-card-fee")?.value)),
        cardFeeMode: normalizeText($("#setting-card-fee-mode")?.value) || "percent",
        monthlySalesGoal: Math.max(0, toNumber($("#setting-monthly-sales-goal")?.value, defaults.monthlySalesGoal)),
        monthlyProfitGoal: Math.max(0, toNumber($("#setting-monthly-profit-goal")?.value, defaults.monthlyProfitGoal)),
        monthlyClientGoal: Math.max(0, Math.round(toNumber($("#setting-monthly-client-goal")?.value, defaults.monthlyClientGoal))),
        receivableAlertDays: Math.max(0, Math.round(toNumber($("#setting-receivable-alert-days")?.value, defaults.receivableAlertDays))),
        payableAlertDays: Math.max(0, Math.round(toNumber($("#setting-payable-alert-days")?.value, defaults.payableAlertDays))),
        defaultCommissionPercent: Math.max(0, Math.min(100, toNumber($("#setting-default-commission")?.value, defaults.defaultCommissionPercent))),
      };
    }
    if (form.dataset.settingsForm === "pdv") {
      state.settings.pdv = collectPdvSettingsForm(form);
    }
    if (form.dataset.settingsForm === "notifications") {
      state.settings.notifications = {
        sale: Boolean(form.querySelector('input[name="sale"]')?.checked),
        lowStock: Boolean(form.querySelector('input[name="lowStock"]')?.checked),
        error: Boolean(form.querySelector('input[name="error"]')?.checked),
      };
    }
    if (form.dataset.settingsForm === "integrations") {
      const store = state.settings.store || {};
      state.settings.integrations = {
        paymentProvider: normalizeText($("#setting-payment-provider")?.value) || "manual",
        whatsappNumber: normalizeText($("#setting-whatsapp-number")?.value),
        whatsappDefaultMessage: normalizeText($("#setting-whatsapp-message")?.value) || store.defaultMessage || "",
        instagramProfile: normalizeText($("#setting-instagram-profile")?.value),
        pixKeyType: normalizeText($("#setting-pix-key-type")?.value) || "aleatoria",
        pixKey: normalizeText($("#setting-pix-key")?.value),
        pixMerchantName: normalizeText($("#setting-pix-merchant-name")?.value).toUpperCase(),
        pixMerchantCity: normalizeText($("#setting-pix-merchant-city")?.value).toUpperCase(),
      };
    }
    if (form.dataset.settingsForm === "security") {
      const minutes = Number($("#setting-session-minutes")?.value || state.settings.sessionMinutes || 240);
      state.settings.sessionMinutes = Math.max(5, minutes || 240);
      const password = $("#setting-admin-password")?.value.trim();
      if (password) {
        const user = currentUser() || state.settings.users.find((item) => item.username === "admin");
        if (password.length < 6) {
          showToast("Senha deve ter pelo menos 6 caracteres.", "error");
          return;
        }
        if (user && localDatabaseService?.updateUser && hasLocalApiSession()) {
          try {
            const response = await localDatabaseService.updateUser(user.id, {
              nome: user.name || user.username,
              usuario: user.username,
              email: user.email || user.username,
              password,
              role: user.role === "Administrador" ? "admin" : user.role === "Gerente" ? "gerente" : user.role === "Vendedor" ? "vendedor" : "operador",
              perfil: user.role,
              saasClientId: currentSession().saasClientId || window.MPTECH_SAAS_CLIENT_ID || null,
              permissions: user.permissions,
            });
            if (response?.ok === false) {
              showToast(response.message || "Nao foi possivel atualizar a senha no banco.", "error");
              return;
            }
          } catch (error) {
            showToast(error.message || "API local indisponivel para atualizar senha.", "error");
            return;
          }
        } else if (user) {
          user.passwordHash = simpleHash(password);
        }
      }
    }
    if (form.dataset.settingsForm === "license") {
      state.settings.tenant = {
        tenantId: normalizeText($("#setting-tenant-id")?.value) || state.settings.tenant.tenantId,
        licenseStatus: normalizeText($("#setting-license-status")?.value) || "teste",
        plan: normalizeText($("#setting-license-plan")?.value) || "local",
        trialEndsAt: normalizeText($("#setting-trial-ends")?.value),
        expiresAt: normalizeText($("#setting-license-expires")?.value),
      };
    }
    if (form.dataset.settingsForm === "appearance") {
      state.settings.appearance = {
        theme: normalizeText($("#setting-theme")?.value) || "Claro",
        accent: normalizeText($("#setting-accent")?.value) || "MPTech",
        primaryColor: normalizeText($("#setting-primary-color")?.value) || "#0f1f3d",
        secondaryColor: normalizeText($("#setting-secondary-color")?.value) || "#6d3fd1",
      };
      state.settings.store.receiptFooter = normalizeText($("#setting-receipt-footer")?.value) || state.settings.store.receiptFooter;
    }
    saveSettings();
    syncSettings();
    saveDataWithAudit(auditAction, auditDetail);
    applySettings();
    showToast("Configurações salvas.", "success");
  });

  document.addEventListener("click", async (event) => {
    const clientMenuButton = event.target.closest("[data-client-menu]");
    if (clientMenuButton) {
      const wasExpanded = clientMenuButton.getAttribute("aria-expanded") === "true";
      closeClientActionsMenu();
      if (!wasExpanded) openClientActionsMenu(clientMenuButton.dataset.clientMenu, clientMenuButton);
      return;
    }
    if (!event.target.closest("#client-floating-menu")) {
      closeClientActionsMenu();
    }

    const settingsTab = event.target.closest("[data-settings-tab]");
    if (settingsTab) {
      state.settingsTab = settingsTab.dataset.settingsTab;
      renderSettings();
      return;
    }

    const exportSettings = event.target.closest("#export-settings-data");
    if (exportSettings) {
      exportData();
      return;
    }

    const securityAction = event.target.closest("[data-security-action]");
    if (securityAction) {
      const action = securityAction.dataset.securityAction;
      state.settings.security = { ...defaultSettings().security, ...(state.settings.security || {}) };
      if (action === "generate-2fa") {
        state.settings.security.totpSecret = generateTotpSecret();
        state.settings.security.twoFactorEnabled = false;
        state.settings.security.twoFactorVerifiedAt = "";
        saveSettings();
        renderSettings();
        showToast("Chave gerada. Cadastre no aplicativo autenticador e confirme o codigo.", "success");
        return;
      }
      if (action === "copy-2fa") {
        const text = state.settings.security.totpSecret || "";
        try {
          await navigator.clipboard.writeText(formatTotpSecret(text));
          showToast("Chave 2FA copiada.", "success");
        } catch {
          showToast("Nao foi possivel copiar automaticamente.", "error");
        }
        return;
      }
      if (action === "confirm-2fa") {
        const code = $("#setting-totp-code")?.value;
        if (await verifyTotpCode(state.settings.security.totpSecret, code)) {
          state.settings.security.twoFactorEnabled = true;
          state.settings.security.twoFactorVerifiedAt = new Date().toISOString();
          saveSettings();
          renderSettings();
          showToast("Autenticador 2FA habilitado.", "success");
        } else {
          showToast("Codigo do autenticador invalido.", "error");
        }
        return;
      }
      if (action === "disable-2fa") {
        const confirmed = state.settings.security.twoFactorEnabled
          ? await confirmAction("Desativar 2FA", "Desativar a verificacao em duas etapas neste sistema?", { confirmText: "Desativar" })
          : true;
        if (!confirmed) return;
        state.settings.security.twoFactorEnabled = false;
        state.settings.security.totpSecret = "";
        state.settings.security.twoFactorVerifiedAt = "";
        saveSettings();
        renderSettings();
        showToast("Autenticador 2FA desativado.", "success");
        return;
      }
    }

    const settingsAction = event.target.closest("[data-settings-action]");
    if (settingsAction?.dataset.settingsAction === "sync-saas-client") {
      await syncSaasClientFromSettings();
      return;
    }
    if (settingsAction?.dataset.settingsAction === "backup-now") {
      exportData();
      return;
    }
    if (settingsAction?.dataset.settingsAction === "import-supabase-db") {
      await importDatabaseToSupabase();
      return;
    }
    if (settingsAction?.dataset.settingsAction === "restore-backup") {
      $("#import-file")?.click();
      return;
    }
    if (settingsAction?.dataset.settingsAction === "diagnostics") {
      testSupabaseConnection();
      if (localDatabaseService?.diagnostics && hasLocalApiSession()) {
        localDatabaseService.diagnostics()
          .then((response) => {
            const diagnostics = response?.data || response;
            showToast(`Diagnostico atualizado: API ${diagnostics?.api?.ok ? "OK" : "falha"}, banco ${diagnostics?.database?.configured ? "OK" : "pendente"}.`, diagnostics?.ok ? "success" : "info");
          })
          .catch(() => showToast("Nao foi possivel carregar diagnostico completo.", "error"));
      }
      return;
    }
    if (settingsAction?.dataset.settingsAction === "test-receipt-print") {
      imprimirCupomTeste(settingsAction.dataset.receiptTestWidth || "");
      return;
    }
    const userAction = event.target.closest("[data-user-action]");
    if (userAction) {
      if (!requirePermission("config_access", "gerenciar usuarios")) return;
      const action = userAction.dataset.userAction;
      if (action === "new") createUser();
      if (action === "edit") editUser(userAction.dataset.userId);
      if (action === "delete") deleteUser(userAction.dataset.userId);
      return;
    }

    const integrationAction = event.target.closest("[data-integration-action]");
    if (integrationAction) {
      runIntegrationAction(integrationAction.dataset.integrationAction);
      return;
    }

    const jump = event.target.closest("[data-screen-jump]");
    if (jump) {
      switchScreen(jump.dataset.screenJump);
      return;
    }

    const target = event.target.closest("[data-add-cart], [data-edit-product], [data-delete-product], [data-remove-cart], [data-category], [data-payment], [data-cart-inc], [data-cart-dec], [data-close-product-modal], [data-cancel-sale], [data-cancel-income], [data-print-sale], [data-select-sale], [data-reprint-selected-sale], [data-view-sale], [data-copy-receipt], [data-whatsapp-sale], [data-delete-expense], [data-pay-account], [data-receive-account], [data-adjust-stock], [data-view-client], [data-edit-client], [data-toggle-client-status], [data-delete-client]");
    if (!target) return;

    const addId = target.dataset.addCart;
    const editId = target.dataset.editProduct;
    const deleteId = target.dataset.deleteProduct;
    const removeId = target.dataset.removeCart;
    const category = target.dataset.category;
    const payment = target.dataset.payment;
    const incId = target.dataset.cartInc;
    const decId = target.dataset.cartDec;
    const closeProductModal = target.dataset.closeProductModal;
    const cancelSaleId = target.dataset.cancelSale;
    const cancelIncomeId = target.dataset.cancelIncome;
    const printSaleId = target.dataset.printSale;
    const selectSaleId = target.dataset.selectSale;
    const reprintSelectedSaleAction = target.dataset.reprintSelectedSale;
    const viewSaleId = target.dataset.viewSale;
    const copyReceiptId = target.dataset.copyReceipt;
    const whatsappSaleId = target.dataset.whatsappSale;
    const deleteExpenseId = target.dataset.deleteExpense;
    const payAccountId = target.dataset.payAccount;
    const receiveAccountId = target.dataset.receiveAccount;
    const adjustStockId = target.dataset.adjustStock;
    const viewClientId = target.dataset.viewClient;
    const editClientId = target.dataset.editClient;
    const toggleClientStatusId = target.dataset.toggleClientStatus;
    const deleteClientId = target.dataset.deleteClient;

    if (addId) addToCart(addId);
    if (editId) editProduct(editId);
    if (deleteId) deleteProduct(deleteId);
    if (cancelSaleId) cancelSale(cancelSaleId);
    if (cancelIncomeId) cancelIncome(cancelIncomeId);
    if (printSaleId) printSale(printSaleId);
    if (selectSaleId) selectSaleForReceipt(selectSaleId);
    if (reprintSelectedSaleAction) reprintSelectedSale();
    if (viewSaleId) {
      selectSaleForReceipt(viewSaleId);
      viewSale(viewSaleId);
    }
    if (copyReceiptId) copySaleReceipt(copyReceiptId);
    if (whatsappSaleId) sendSaleReceiptWhatsApp(whatsappSaleId);
    if (deleteExpenseId) deleteExpense(deleteExpenseId);
    if (payAccountId) togglePayable(payAccountId);
    if (receiveAccountId) toggleReceivable(receiveAccountId);
    if (adjustStockId) adjustStock(adjustStockId);
    if (viewClientId) viewClientHistory(viewClientId);
    if (editClientId || toggleClientStatusId || deleteClientId) closeClientActionsMenu();
    if (editClientId) editClient(editClientId);
    if (toggleClientStatusId) toggleClientStatus(toggleClientStatusId);
    if (deleteClientId) deleteClient(deleteClientId);
    if (category) {
      state.pdvCategory = category;
      renderCategoryFilter();
      renderSearchResults();
    }
    if (payment) {
      $("#payment-method").value = payment;
      $$(".payment-option").forEach((button) => button.classList.toggle("active", button.dataset.payment === payment));
      renderCart();
    }
    if (incId || decId) {
      const id = incId || decId;
      const item = state.cart.find((cartItem) => cartItem.id === id);
      if (item) {
        item.qty = incId ? (state.settings.pdv.allowNegativeStock ? item.qty + 1 : Math.min(item.stock, item.qty + 1)) : Math.max(1, item.qty - 1);
        renderCart();
      }
    }
    if (closeProductModal) resetProductForm();
    if (removeId) {
      state.cart = state.cart.filter((item) => item.id !== removeId);
      renderCart();
    }
  });

  document.addEventListener("input", (event) => {
    const cartId = event.target.dataset.cartQty;
    if (!cartId) return;

    const item = state.cart.find((cartItem) => cartItem.id === cartId);
    if (!item) return;
    item.qty = state.settings.pdv.allowNegativeStock ? Math.max(1, Number(event.target.value)) : Math.max(1, Math.min(item.stock, Number(event.target.value)));
    renderCart();
  });

  window.addEventListener("resize", closeClientActionsMenu);
  document.addEventListener("scroll", closeClientActionsMenu, true);

  document.addEventListener("change", (event) => {
    const finalPriceId = event.target.dataset.cartFinalPrice;
    if (finalPriceId) {
      const item = state.cart.find((cartItem) => cartItem.id === finalPriceId);
      if (!item) return;
      setCartItemFinalPrice(item, event.target.value);
      renderCart();
      return;
    }

    if (event.target.name === "autoDaily") {
      state.settings.backup.autoDaily = event.target.checked;
      saveSettings();
      renderSettings();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || state.activeScreen !== "pdv" || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isPdvCheckoutModalOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePdvCheckoutModal();
        return;
      }
      if (event.key === "F4" || event.key === "F9") {
        event.preventDefault();
        $("#confirm-finish-sale")?.click();
        return;
      }
      if (event.key === "Enter" && (document.activeElement === $("#amount-received") || document.activeElement === $("#confirm-finish-sale"))) {
        event.preventDefault();
        $("#confirm-finish-sale")?.click();
        return;
      }
      if (/^F\d+$/.test(event.key)) event.preventDefault();
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      $("#product-search")?.focus();
    }
    if (event.key === "F2") {
      event.preventDefault();
      showToast("Comando de abertura de gaveta enviado.", "info");
    }
    if (event.key === "F3") {
      event.preventDefault();
      $("#cart-discount")?.focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearPdvCart();
    }
    if (event.key === "Enter" && document.activeElement === $("#product-search")) {
      event.preventDefault();
      addFirstVisibleProductFromSearch();
    }
    if (event.key === "F4") {
      event.preventDefault();
      $("#finish-sale")?.click();
    }
    if (event.key === "F9") {
      event.preventDefault();
      $("#finish-sale")?.click();
    }
  });
}

state.settings = mergeSettings(state.settings);
if (!dbClient) markDbUnavailable();
ensureImportInput();
ensureBulkImportInput();

bindEvents();
$("#expense-date").value = todayISO();
$("#expense-date-secondary").value = todayISO();
const currentDateText = formatDateLong();
$("#current-date").textContent = currentDateText;
$$("[data-current-date-text]").forEach((item) => {
  item.textContent = currentDateText;
});

function hasValidSession() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
    if (!session.logged || Date.now() > session.expiresAt) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    const sessionUserExists = state?.settings?.users?.some((user) => (
      user.username === session.user ||
      user.email === session.user ||
      user.id === session.userId
    ) && user.active !== false);
    if (state?.settings?.users?.length && !sessionUserExists && !session.saasClientId) {
      localStorage.removeItem(SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return false;
  }
}

function requireSession(action = "executar esta acao") {
  if (hasValidSession()) return true;
  showToast(`Sessao expirada. Entre novamente para ${action}.`, "error");
  showLogin();
  return false;
}

if (hasValidSession()) {
  showApp();
} else {
  showLogin();
}
