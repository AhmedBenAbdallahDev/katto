"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayAPI", {
  onInit: (cb) => ipcRenderer.once("share-overlay-init", (_e, data) => cb(data)),
  onCropUpdate: (cb) => ipcRenderer.on("share-crop-update", (_e, crop) => cb(crop)),
});
