"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const MAX_TRACKED_FILES = 50;
const MAX_PARTIAL_BYTES = 65536;

class KiroLogMonitor {
  constructor(onStateChange) {
    this._onStateChange = onStateChange;
    this._interval = null;
    this._tracked = new Map();
    this._baseDir = path.join(os.homedir(), "Library", "Application Support", "Kiro", "logs");
    this._startedAtMs = Date.now();
    this._lastState = null;
    this._lastEventTime = 0;
    this._lastNotificationLine = "";
    this._activeAgent = false;
  }

  start() {
    if (this._interval) return;
    this._startedAtMs = Date.now();
    this._poll();
    this._interval = setInterval(() => this._poll(), 1500);
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    this._tracked.clear();
  }

  _poll() {
    for (const filePath of this._getLogFiles()) {
      this._pollFile(filePath);
    }
    this._cleanStaleFiles();
  }

  _getLogFiles() {
    const files = [];
    const visit = (dir, depth) => {
      if (depth > 5 || files.length >= MAX_TRACKED_FILES) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(entryPath, depth + 1);
          continue;
        }
        if (entry.name === "Kiro Logs.log" || entry.name === "q-client.log") {
          try {
            if (Date.now() - fs.statSync(entryPath).mtimeMs <= 10 * 60 * 1000) files.push(entryPath);
          } catch {}
        }
      }
    };
    visit(this._baseDir, 0);
    return files;
  }

  _pollFile(filePath) {
    let stat;
    try { stat = fs.statSync(filePath); }
    catch { return; }

    let tracked = this._tracked.get(filePath);
    if (!tracked) {
      tracked = {
        offset: stat.mtimeMs < this._startedAtMs - 1500 ? stat.size : 0,
        partial: "",
        lastEventTime: Date.now(),
      };
      this._tracked.set(filePath, tracked);
    }
    if (stat.size < tracked.offset) tracked.offset = 0;
    if (stat.size <= tracked.offset) return;

    let buf;
    try {
      const fd = fs.openSync(filePath, "r");
      buf = Buffer.alloc(stat.size - tracked.offset);
      fs.readSync(fd, buf, 0, buf.length, tracked.offset);
      fs.closeSync(fd);
    } catch {
      return;
    }
    tracked.offset = stat.size;

    const lines = (tracked.partial + buf.toString("utf8")).split("\n");
    tracked.partial = lines.pop() || "";
    if (tracked.partial.length > MAX_PARTIAL_BYTES) tracked.partial = "";
    for (const line of lines) {
      if (line.trim()) this._processLine(line, tracked);
    }
  }

  _processLine(line, tracked) {
    const event = this._eventForLine(line);
    if (!event) return;
    if (event.state === "complete" && !this._activeAgent) return;
    tracked.lastEventTime = Date.now();
    this._emit(event.state, event.event);
    if (event.state === "thinking" || event.state === "working") {
      this._activeAgent = true;
    } else if (event.state === "complete" || event.state === "idle" || event.state === "error") {
      this._activeAgent = false;
    }
  }

  _eventForLine(line) {
    if (this._isApprovalLine(line)) {
      return { state: "notification", event: "approval-required" };
    }
    if (line.includes("[agent-controller] Triggered new agent")) {
      return { state: "thinking", event: "agent-start" };
    }
    if (line.includes("[Execution] Completed with abort") || line.includes("[AgentExecution] Abort triggered")) {
      return { state: "idle", event: "agent-abort" };
    }
    if (line.includes("[Execution] Completed") || line.includes("\"generateAssistantResponseResponse\"")) {
      return { state: "complete", event: "agent-complete" };
    }
    if (
      line.includes("[AgentIterator] Parallel invoking agent") ||
      line.includes("[AgentIterator] Detecting intent") ||
      line.includes("\"commandName\":\"GenerateAssistantResponseCommand\"")
    ) {
      return { state: "working", event: "agent-working" };
    }
    return null;
  }

  _isApprovalLine(line) {
    const lower = String(line || "").toLowerCase();
    if (!lower) return false;
    if (this._lastNotificationLine === line && Date.now() - this._lastEventTime < 5000) return false;
    const matched = [
      "action required",
      "approval required",
      "waiting for approval",
      "awaiting approval",
      "needs approval",
      "requires approval",
      "accept/reject",
      "accept or reject",
      "supervised mode",
      "permission required",
      "needs permission",
      "requires permission",
      "confirm tool",
      "confirm command",
    ].some((pattern) => lower.includes(pattern));
    if (matched) this._lastNotificationLine = line;
    return matched;
  }

  _emit(state, event) {
    if (state === this._lastState && Date.now() - this._lastEventTime < 1000) return;
    this._lastState = state;
    this._lastEventTime = Date.now();
    this._onStateChange({
      agentId: "kiro",
      sessionId: "kiro",
      state,
      event,
      cwd: "",
    });
  }

  _cleanStaleFiles() {
    const now = Date.now();
    for (const [filePath, tracked] of this._tracked) {
      if (now - tracked.lastEventTime > 10 * 60 * 1000 || this._tracked.size > MAX_TRACKED_FILES) {
        this._tracked.delete(filePath);
      }
    }
  }
}

module.exports = KiroLogMonitor;
