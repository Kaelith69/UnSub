'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Auth
  authStatus:  ()       => ipcRenderer.invoke('auth:status'),
  authLogin:   ()       => ipcRenderer.invoke('auth:login'),
  authLogout:  ()       => ipcRenderer.invoke('auth:logout'),

  // Scan
  scanStart:   (options) => ipcRenderer.invoke('scan:start', options),
  onProgress:  (cb)     => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },

  // Unsubscribe and optional cleanup
  unsubOne:    (payload) => ipcRenderer.invoke('unsub:one', payload),
});
