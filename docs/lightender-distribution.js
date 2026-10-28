/*
 * Keyless Abyss HTML5 distribution manager.
 *
 * HTML5-001 owns installation metadata and the browser Cache Storage cache.
 * UE4's existing IndexedDB cache remains independent and is not deleted by
 * this script, which protects SaveGame data during the first milestone.
 */
(function () {
    'use strict';

    var MANIFEST_URL = 'lightender-manifest.json';
    var INSTALL_DB = 'LightenderDistribution';
    var INSTALL_DB_VERSION = 1;
    var INSTALL_STORE = 'installations';
    var CACHE_PREFIX = 'lightender-build-';
    var RUNTIME_SCRIPT = 'MhLightender-HTML5-Shipping.UE4.js';

    var state = {
        manifest: null,
        installation: null,
        registration: null,
        runtimeLoaded: false,
        busy: false,
        autoLaunch: false,
        fullscreenAttempted: false,
        lastError: false
    };

    function element(id) {
        return document.getElementById(id);
    }

    function setStatus(message, kind) {
        var status = element('distribution_status');
        if (!status) return;
        status.textContent = message;
        status.className = 'distribution-status' + (kind ? ' ' + kind : '');
    }

    function setProgress(value, label) {
        var progress = element('distribution_progress');
        var text = element('distribution_progress_text');
        if (progress) {
            progress.hidden = value === null;
            if (value !== null) progress.value = Math.max(0, Math.min(100, value));
        }
        if (text) text.textContent = label || '';
    }

    function setButtons() {
        var install = element('distribution_install');
        var play = element('distribution_play');
        var update = element('distribution_update');
        var uninstall = element('distribution_uninstall');
        var installed = !!state.installation;
        var current = installed && state.installation.buildId === state.manifest.buildId;
        var disabled = state.busy;
        var hosted = isHostedDeployment();

        if (install) {
            // Hosted pages should automatically install and launch. Keep a
            // retry button only after a failed hosted install; local launches
            // retain the manual install option.
            install.hidden = hosted ? !state.lastError : installed;
            install.textContent = state.lastError ? 'Retry Install' : 'Install Lightender';
            install.disabled = disabled;
        }
        if (play) {
            play.hidden = !installed;
            play.disabled = disabled || !current;
        }
        if (update) {
            update.hidden = hosted || !installed || current;
            update.disabled = disabled;
        }
        if (uninstall) {
            uninstall.hidden = hosted || !installed;
            uninstall.disabled = disabled;
        }
    }

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod|Windows Phone/i.test(navigator.userAgent || '') ||
            (navigator.maxTouchPoints > 1 && window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
    }

    function isHostedDeployment() {
        var hostname = (location.hostname || '').toLowerCase();
        return location.protocol === 'https:' && hostname.slice(-10) === '.github.io';
    }

    function isFullscreen() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    }

    function fullscreenRequestFunction() {
        var root = document.documentElement;
        return root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen;
    }

    function hideMobileFullscreenPrompt() {
        var prompt = element('mobile_fullscreen_prompt');
        if (prompt) prompt.hidden = true;
    }

    function showMobileFullscreenPrompt() {
        var prompt = element('mobile_fullscreen_prompt');
        var button = element('mobile_fullscreen_request');
        var note = element('mobile_fullscreen_note');
        if (!prompt || !isMobileDevice() || isFullscreen()) return;

        prompt.hidden = false;
        if (!fullscreenRequestFunction()) {
            if (button) {
                button.textContent = 'Use Add to Home Screen';
                button.disabled = true;
            }
            if (note) note.textContent = 'iPhone Safari does not expose page fullscreen. Add this page to the Home Screen for a standalone full-screen app.';
        } else {
            if (button) {
                button.textContent = 'Enter fullscreen';
                button.disabled = false;
            }
            if (note) note.textContent = 'Tap once to fill the screen.';
        }
    }

    function requestFullscreenAndLandscape() {
        try {
            var orientation = screen.orientation || screen.msOrientation || screen.mozOrientation;
            if (orientation && orientation.lock) {
                var lockResult = orientation.lock('landscape');
                if (lockResult && lockResult.catch) lockResult.catch(function () {});
            }
        } catch (error) {}

        var request = fullscreenRequestFunction();
        if (!request || isFullscreen()) {
            if (isFullscreen()) hideMobileFullscreenPrompt();
            else showMobileFullscreenPrompt();
            return Promise.resolve(false);
        }

        try {
            var result = request.call(document.documentElement);
            return Promise.resolve(result).then(function () {
                if (isFullscreen()) hideMobileFullscreenPrompt();
                return isFullscreen();
            }).catch(function () {
                showMobileFullscreenPrompt();
                return false;
            });
        } catch (error) {
            showMobileFullscreenPrompt();
            return Promise.resolve(false);
        }
    }

    function wireFullscreenControls() {
        var mobileButton = element('mobile_fullscreen_request');
        if (mobileButton) mobileButton.addEventListener('click', function () {
            requestFullscreenAndLandscape();
        });

        var dismiss = element('mobile_fullscreen_dismiss');
        if (dismiss) dismiss.addEventListener('click', hideMobileFullscreenPrompt);

        var legacyButton = element('fullscreen_request');
        if (legacyButton) legacyButton.addEventListener('click', requestFullscreenAndLandscape);

        var tryFromGesture = function () {
            if (!state.runtimeLoaded || state.fullscreenAttempted || !isMobileDevice()) return;
            state.fullscreenAttempted = true;
            requestFullscreenAndLandscape();
        };
        document.addEventListener('pointerdown', tryFromGesture, { passive: true, capture: true });
        if (!window.PointerEvent) document.addEventListener('touchstart', tryFromGesture, { passive: true, capture: true });
    }

    function setAutoLaunchPending(value) {
        try {
            if (value) sessionStorage.setItem('lightender-auto-launch', '1');
            else sessionStorage.removeItem('lightender-auto-launch');
        } catch (error) {}
    }

    function consumeAutoLaunchPending() {
        try {
            var pending = sessionStorage.getItem('lightender-auto-launch') === '1';
            if (pending) sessionStorage.removeItem('lightender-auto-launch');
            return pending;
        } catch (error) {
            return false;
        }
    }

    function openInstallDb() {
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open(INSTALL_DB, INSTALL_DB_VERSION);
            request.onupgradeneeded = function () {
                var db = request.result;
                if (!db.objectStoreNames.contains(INSTALL_STORE)) {
                    db.createObjectStore(INSTALL_STORE, { keyPath: 'id' });
                }
            };
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error || new Error('Could not open installation database.')); };
        });
    }

    function readInstallation() {
        return openInstallDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var request = db.transaction(INSTALL_STORE, 'readonly')
                    .objectStore(INSTALL_STORE).get('active');
                request.onsuccess = function () { resolve(request.result || null); };
                request.onerror = function () { reject(request.error); };
            });
        });
    }

    function writeInstallation(record) {
        return openInstallDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var request = db.transaction(INSTALL_STORE, 'readwrite')
                    .objectStore(INSTALL_STORE).put(record);
                request.onsuccess = function () { resolve(record); };
                request.onerror = function () { reject(request.error); };
            });
        });
    }

    function deleteInstallationRecord() {
        return openInstallDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var request = db.transaction(INSTALL_STORE, 'readwrite')
                    .objectStore(INSTALL_STORE).delete('active');
                request.onsuccess = function () { resolve(); };
                request.onerror = function () { reject(request.error); };
            });
        });
    }

    function bytes(bytesValue) {
        if (bytesValue >= 1024 * 1024 * 1024) return (bytesValue / (1024 * 1024 * 1024)).toFixed(2) + ' GiB';
        if (bytesValue >= 1024 * 1024) return (bytesValue / (1024 * 1024)).toFixed(1) + ' MiB';
        if (bytesValue >= 1024) return (bytesValue / 1024).toFixed(1) + ' KiB';
        return bytesValue + ' B';
    }

    function hex(buffer) {
        return Array.prototype.map.call(new Uint8Array(buffer), function (value) {
            return value.toString(16).padStart(2, '0');
        }).join('');
    }

    function digest(buffer) {
        if (!window.crypto || !window.crypto.subtle) {
            return Promise.reject(new Error('This browser does not provide Web Crypto integrity checks.'));
        }
        return window.crypto.subtle.digest('SHA-256', buffer).then(hex);
    }

    // Incremental SHA-256 used for the chunked package's whole-file check.
    // It keeps verification bounded to one transport chunk at a time instead
    // of allocating a second 269 MiB ArrayBuffer during installation.
    function Sha256() {
        this.h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
        this.buffer = new Uint8Array(64);
        this.bufferLength = 0;
        this.bytes = 0;
    }

    Sha256.prototype.process = function (data, offset) {
        var k = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
            0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
            0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
            0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
            0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
            0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
            0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
            0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
            0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
            0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
            0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
            0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
            0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
            0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
            0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
            0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
        var w = new Uint32Array(64);
        var i;
        for (i = 0; i < 16; i += 1) {
            var p = offset + i * 4;
            w[i] = ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0;
        }
        function rotr(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
        for (i = 16; i < 64; i += 1) {
            var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
        }
        var a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];
        var e = this.h[4], f = this.h[5], g = this.h[6], h = this.h[7];
        for (i = 0; i < 64; i += 1) {
            var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            var ch = (e & f) ^ ((~e) & g);
            var t1 = (h + S1 + ch + k[i] + w[i]) >>> 0;
            var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            var maj = (a & b) ^ (a & c) ^ (b & c);
            var t2 = (S0 + maj) >>> 0;
            h = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        this.h[0] = (this.h[0] + a) >>> 0; this.h[1] = (this.h[1] + b) >>> 0;
        this.h[2] = (this.h[2] + c) >>> 0; this.h[3] = (this.h[3] + d) >>> 0;
        this.h[4] = (this.h[4] + e) >>> 0; this.h[5] = (this.h[5] + f) >>> 0;
        this.h[6] = (this.h[6] + g) >>> 0; this.h[7] = (this.h[7] + h) >>> 0;
    };

    Sha256.prototype.update = function (data) {
        var offset = 0;
        this.bytes += data.byteLength;
        while (offset < data.byteLength) {
            var take = Math.min(64 - this.bufferLength, data.byteLength - offset);
            this.buffer.set(data.subarray(offset, offset + take), this.bufferLength);
            this.bufferLength += take;
            offset += take;
            if (this.bufferLength === 64) {
                this.process(this.buffer, 0);
                this.bufferLength = 0;
            }
        }
    };

    Sha256.prototype.hex = function () {
        var bitLength = this.bytes * 8;
        var high = Math.floor(bitLength / 0x100000000);
        var low = bitLength >>> 0;
        var paddingLength = this.bufferLength < 56 ? 56 - this.bufferLength : 120 - this.bufferLength;
        var padding = new Uint8Array(paddingLength + 8);
        padding[0] = 0x80;
        padding[padding.length - 8] = (high >>> 24) & 255;
        padding[padding.length - 7] = (high >>> 16) & 255;
        padding[padding.length - 6] = (high >>> 8) & 255;
        padding[padding.length - 5] = high & 255;
        padding[padding.length - 4] = (low >>> 24) & 255;
        padding[padding.length - 3] = (low >>> 16) & 255;
        padding[padding.length - 2] = (low >>> 8) & 255;
        padding[padding.length - 1] = low & 255;
        this.update(padding);
        return this.h.map(function (value) { return ('00000000' + value.toString(16)).slice(-8); }).join('');
    };

    function verifyChunkedPackage(cache) {
        var delivery = state.manifest.packageDelivery;
        if (!delivery || delivery.type !== 'chunked') return Promise.resolve();
        return cache.match(new URL(delivery.manifest, location.href).toString()).then(function (response) {
            if (!response) throw new Error('Chunk manifest was not cached.');
            return response.json();
        }).then(function (chunkManifest) {
            var hasher = new Sha256();
            var chunks = (chunkManifest.chunks || []).slice().sort(function (a, b) { return a.index - b.index; });
            return chunks.reduce(function (chain, chunk) {
                return chain.then(function () {
                    return cache.match(new URL(chunk.path, location.href).toString()).then(function (response) {
                        if (!response) throw new Error('Package chunk was not cached: ' + chunk.path);
                        return response.arrayBuffer().then(function (buffer) { hasher.update(new Uint8Array(buffer)); });
                    });
                });
            }, Promise.resolve()).then(function () {
                var actual = hasher.hex();
                if (actual !== delivery.sourceSha256) throw new Error('Whole-package integrity check failed.');
            });
        });
    }

    function cacheResponse(cache, entry, index, total) {
        var url = entry.path;
        setStatus('Downloading ' + (index + 1) + ' of ' + total + ': ' + url);
        var separator = url.indexOf('?') === -1 ? '?' : '&';
        var requestUrl = url + separator + 'lightender_build=' + encodeURIComponent(state.manifest.buildId);
        return fetch(requestUrl, { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('Download failed (' + response.status + '): ' + url);
            return response.arrayBuffer().then(function (buffer) {
                if (entry.size !== buffer.byteLength) {
                    throw new Error('Size check failed for ' + url + '. Expected ' + entry.size + ', received ' + buffer.byteLength + '.');
                }
                return digest(buffer).then(function (hash) {
                    if (entry.sha256 && hash !== entry.sha256) {
                        throw new Error('Integrity check failed for ' + url + '.');
                    }
                    return cache.put(new Request(new URL(url, location.href).toString()),
                        new Response(buffer, { headers: response.headers, status: response.status }));
                });
            });
        });
    }

    function registerWorker() {
        if (!('serviceWorker' in navigator)) {
            return Promise.reject(new Error('This browser does not support Service Workers.'));
        }
        var workerUrl = new URL('lightender-sw.js', location.href).toString();
        return navigator.serviceWorker.register(workerUrl, { scope: new URL('./', location.href).pathname })
            .then(function (registration) {
                state.registration = registration;
                return navigator.serviceWorker.ready;
            });
    }

    function activateWorker() {
        if (state.registration && state.registration.waiting) {
            state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        if (!navigator.serviceWorker.controller) {
            setStatus('Installation complete. Reloading once to enable offline launch…', 'success');
            window.setTimeout(function () { location.reload(); }, 700);
            return false;
        }
        return true;
    }

    function tellWorkerWhichBuildIsActive() {
        if (state.installation && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'SET_ACTIVE_CACHE',
                cacheName: state.installation.cacheName
            });
        }
    }

    function install(force, autoLaunch) {
        if (state.busy) return;
        state.autoLaunch = state.autoLaunch || !!autoLaunch;
        if (state.autoLaunch) setAutoLaunchPending(true);
        state.lastError = false;
        state.busy = true;
        setButtons();
        setProgress(0, 'Preparing installation…');
        setStatus(force ? 'Updating Lightender…' : 'Installing Lightender…');

        var cacheName = CACHE_PREFIX + state.manifest.buildId;
        caches.open(cacheName).then(function (cache) {
            var files = state.manifest.files || [];
            var completed = 0;
            var manifestRequest = new Request(new URL(MANIFEST_URL, location.href).toString());
            var manifestResponse = new Response(JSON.stringify(state.manifest), {
                headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
            return files.reduce(function (chain, entry) {
                return chain.then(function () {
                    return cacheResponse(cache, entry, completed, files.length).then(function () {
                        completed += 1;
                        setProgress((completed / files.length) * 100, completed + ' of ' + files.length + ' files verified');
                    });
                });
            }, cache.put(manifestRequest, manifestResponse)).then(function () {
                return verifyChunkedPackage(cache);
            }).then(function () {
                return writeInstallation({
                    id: 'active',
                    buildId: state.manifest.buildId,
                    manifestVersion: state.manifest.version,
                    cacheName: cacheName,
                    installedAt: new Date().toISOString(),
                    bytes: state.manifest.totalBytes
                });
            });
        }).then(function (record) {
            state.installation = record;
            state.busy = false;
            tellWorkerWhichBuildIsActive();
            setProgress(null, '');
            setStatus('Lightender is installed (' + bytes(record.bytes) + ').', 'success');
            setButtons();
            if (activateWorker()) {
                if (state.autoLaunch) {
                    state.autoLaunch = false;
                    loadRuntime();
                }
            }
        }).catch(function (error) {
            state.busy = false;
            state.lastError = true;
            setProgress(null, '');
            setStatus('Installation failed: ' + (error && error.message ? error.message : error), 'error');
            setButtons();
            console.error('Lightender installation failed:', error);
        });
    }

    function loadRuntime() {
        if (state.runtimeLoaded) return;
        if (!state.installation) return setStatus('Install Lightender before pressing Play.', 'error');
        if (!activateWorker()) return;
        state.runtimeLoaded = true;
        setStatus('Launching Lightender…');
        var script = document.createElement('script');
        script.src = RUNTIME_SCRIPT;
        script.async = false;
        script.onload = function () {
            setAutoLaunchPending(false);
            setStatus('Lightender is ready.', 'success');
            var panel = element('distribution_panel');
            if (panel) panel.classList.add('runtime-started');
            showMobileFullscreenPrompt();
        };
        script.onerror = function () {
            state.runtimeLoaded = false;
            setStatus('The installed runtime could not be loaded.', 'error');
        };
        document.body.appendChild(script);
    }

    function uninstall() {
        if (state.busy || !state.installation) return;
        if (!window.confirm('Remove the Lightender distribution cache? Your UE4 SaveGame data will not be touched.')) return;
        state.busy = true;
        setButtons();
        setStatus('Removing the Lightender distribution cache…');
        var cacheName = state.installation.cacheName;
        caches.delete(cacheName).then(deleteInstallationRecord).then(function () {
            state.installation = null;
            state.busy = false;
            setStatus('Lightender was uninstalled. UE4 SaveGame data was preserved.', 'success');
            setButtons();
        }).catch(function (error) {
            state.busy = false;
            setStatus('Uninstall failed: ' + (error && error.message ? error.message : error), 'error');
            setButtons();
        });
    }

    function humanDate(value) {
        try { return new Date(value).toLocaleString(); } catch (error) { return value; }
    }

    function init() {
        wireFullscreenControls();
        ['distribution_install', 'distribution_update'].forEach(function (id) {
            var button = element(id);
            if (button) button.addEventListener('click', function () { install(id === 'distribution_update'); });
        });
        var play = element('distribution_play');
        if (play) play.addEventListener('click', loadRuntime);
        var uninstallButton = element('distribution_uninstall');
        if (uninstallButton) uninstallButton.addEventListener('click', uninstall);

        fetch(MANIFEST_URL + '?lightender_manifest=' + Date.now(), { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('Could not load the Lightender manifest.');
            return response.json();
        }).then(function (manifest) {
            state.manifest = manifest;
            return Promise.all([registerWorker(), readInstallation()]);
        }).then(function (results) {
            state.installation = results[1];
            tellWorkerWhichBuildIsActive();
            var version = element('distribution_version');
            if (version) version.textContent = 'Build ' + state.manifest.buildId;
            var installed = element('distribution_installed_at');
            if (installed && state.installation) installed.textContent = 'Installed ' + humanDate(state.installation.installedAt);
            setButtons();
            var current = state.installation && state.installation.buildId === state.manifest.buildId;
            var pendingLaunch = consumeAutoLaunchPending();
            if (current) {
                state.lastError = false;
                setStatus('Lightender is installed and ready to play.', 'success');
                if (pendingLaunch) loadRuntime();
            } else {
                setStatus(state.installation ? 'A new Lightender build is ready. Downloading the update…' : 'Downloading Lightender…', 'success');
                install(!!state.installation, true);
            }
        }).catch(function (error) {
            setStatus('Distribution setup failed: ' + (error && error.message ? error.message : error), 'error');
            console.error('Lightender distribution setup failed:', error);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}());
