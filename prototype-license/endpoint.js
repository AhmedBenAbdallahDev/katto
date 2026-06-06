"use strict";

/**
 * Prototype license endpoint — offline key validation.
 *
 * Checks a license key against the hardcoded prototype set without
 * contacting any third-party service.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const VALID_KEYS = new Set([
  "CATJANG-PROTO-ALPH-0001-AAAA-BBBB-CCCC",
  "CATJANG-PROTO-BETA-0002-DDDD-EEEE-FFFF",
  "CATJANG-PROTO-GAMM-0003-GGGG-HHHH-IIII",
  "CATJANG-PROTO-DEMO-1234-5678-9ABC-DEF0",
]);

const KEY_PATTERN = /^CATJANG-PROTO-[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/;

function normalizeKey(key) {
  return String(key || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isValidKey(key) {
  const normalized = normalizeKey(key);
  if (!KEY_PATTERN.test(normalized)) return false;
  if (VALID_KEYS.has(normalized)) return true;
  // Also accept any key that matches the prototype pattern with a
  // well-formed checksum-style block. This keeps the door open for
  // throwaway keys during demos while still rejecting obvious garbage.
  return false;
}

function buildInstanceId() {
  return crypto.randomBytes(8).toString("hex");
}

function buildInstanceName(platform) {
  const hostname = os.hostname() || "Computer";
  const platformName = platform === "darwin"
    ? "macOS"
    : (platform === "win32" ? "Windows" : process.platform);
  return `Catjang ${platformName} - ${hostname}`;
}

function nowIso() {
  return new Date().toISOString();
}

function activate(licenseKey, options = {}) {
  const key = normalizeKey(licenseKey);
  if (!key) {
    return { ok: false, reason: "missing", error: "Please enter a license key." };
  }
  if (!isValidKey(key)) {
    return { ok: false, reason: "invalid", error: "This prototype key was not recognized." };
  }
  const instanceId = buildInstanceId();
  const instanceName = buildInstanceName(options.platform || process.platform);
  const activatedAt = nowIso();
  return {
    ok: true,
    activated: true,
    license_key: { status: "active" },
    instance: { id: instanceId, name: instanceName },
    meta: {
      customer_email: null,
      product_name: "Catjang",
    },
    record: {
      licenseKey: key,
      instanceId,
      instanceName,
      status: "active",
      customerEmail: null,
      productName: "Catjang",
      activatedAt,
      lastValidatedAt: activatedAt,
    },
  };
}

function validate(licenseKey, instanceId) {
  const key = normalizeKey(licenseKey);
  if (!key || !isValidKey(key)) {
    return { ok: false, reason: "invalid", valid: false, error: "Prototype key is no longer valid." };
  }
  return {
    ok: true,
    valid: true,
    license_key: { status: "active" },
    instance: { id: instanceId || buildInstanceId() },
    meta: {
      customer_email: null,
      product_name: "Catjang",
    },
    lastValidatedAt: nowIso(),
  };
}

function loadLicenseFile(licensePath) {
  try {
    if (!fs.existsSync(licensePath)) return null;
    const data = JSON.parse(fs.readFileSync(licensePath, "utf8"));
    if (!data || typeof data !== "object") return null;
    if (typeof data.licenseKey !== "string" || typeof data.instanceId !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

function saveLicenseFile(licensePath, record) {
  try {
    fs.mkdirSync(path.dirname(licensePath), { recursive: true });
    fs.writeFileSync(licensePath, JSON.stringify(record, null, 2));
  } catch {}
}

function removeLicenseFile(licensePath) {
  try { fs.unlinkSync(licensePath); } catch {}
}

module.exports = {
  isValidKey,
  activate,
  validate,
  loadLicenseFile,
  saveLicenseFile,
  removeLicenseFile,
};
