"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("controlsAPI", {
  onInit: (cb) => ipcRenderer.once("share-controls-init", (_e, data) => cb(data)),
  sendCancel: () => ipcRenderer.send("share-capture-cancel"),
});
