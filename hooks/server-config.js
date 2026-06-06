"use strict";

const http = require("http");

const DEFAULT_AGENT_PORT = 23456;
const STATE_PATH = "/agent-state";

function postAgentState(payload, callback) {
  const body = JSON.stringify(payload || {});
  const req = http.request({
    hostname: "127.0.0.1",
    port: DEFAULT_AGENT_PORT,
    path: STATE_PATH,
    method: "POST",
    timeout: 120,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  }, (res) => {
    res.resume();
    res.on("end", () => callback && callback());
  });

  req.on("timeout", () => req.destroy());
  req.on("error", () => callback && callback());
  req.end(body);
}

module.exports = {
  DEFAULT_AGENT_PORT,
  STATE_PATH,
  postAgentState,
};
