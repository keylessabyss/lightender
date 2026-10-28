/*
 * Lightender offline shell worker.
 *
 * The worker is deliberately distribution-only. It does not know anything
 * about Unreal gameplay, save data, or the UE4 IndexedDB database. It serves
 * files from versioned Lightender caches and falls back to the network.
 */
var LIGHTENDER_CACHE_PREFIX = 'lightender-build-';
var activeCacheName = null;

self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SET_ACTIVE_CACHE') {
        activeCacheName = event.data.cacheName || null;
    }
});

function isLightenderCache(name) {
    return name.indexOf(LIGHTENDER_CACHE_PREFIX) === 0;
}

async function findCached(request) {
    var names = await caches.keys();
    var buildCaches = names.filter(isLightenderCache).sort().reverse();
    if (activeCacheName && buildCaches.indexOf(activeCacheName) !== -1) {
        buildCaches.splice(buildCaches.indexOf(activeCacheName), 1);
        buildCaches.unshift(activeCacheName);
    }
    for (var i = 0; i < buildCaches.length; i += 1) {
        var cache = await caches.open(buildCaches[i]);
        var response = await cache.match(request);
        if (response) return response;
    }
    return null;
}

async function findChunkedPackage(request) {
    var names = await caches.keys();
    var buildCaches = names.filter(isLightenderCache).sort().reverse();
    if (activeCacheName && buildCaches.indexOf(activeCacheName) !== -1) {
        buildCaches.splice(buildCaches.indexOf(activeCacheName), 1);
        buildCaches.unshift(activeCacheName);
    }
    var requestedPath = new URL(request.url).pathname;

    for (var i = 0; i < buildCaches.length; i += 1) {
        var cache = await caches.open(buildCaches[i]);
        var distributionManifest = await cache.match(new URL('lightender-manifest.json', self.location.href).toString());
        if (!distributionManifest) continue;

        var manifest;
        try {
            manifest = await distributionManifest.clone().json();
        } catch (error) {
            continue;
        }
        var delivery = manifest.packageDelivery;
        if (!delivery || delivery.type !== 'chunked') continue;
        if (new URL(delivery.path, self.location.href).pathname !== requestedPath) continue;

        var chunkManifestResponse = await cache.match(new URL(delivery.manifest, self.location.href).toString());
        if (!chunkManifestResponse) throw new Error('Installed chunk manifest is missing.');
        var chunkManifest = await chunkManifestResponse.clone().json();
        var chunks = (chunkManifest.chunks || []).slice().sort(function (a, b) { return a.index - b.index; });
        if (!chunks.length) throw new Error('Installed chunk manifest contains no chunks.');

        if (typeof ReadableStream === 'undefined') {
            throw new Error('This browser cannot stream the installed package.');
        }

        var index = 0;
        var stream = new ReadableStream({
            pull: async function (controller) {
                if (index >= chunks.length) {
                    controller.close();
                    return;
                }
                var chunkUrl = new URL(chunks[index].path, self.location.href).toString();
                var chunkResponse = await cache.match(chunkUrl);
                if (!chunkResponse) {
                    controller.error(new Error('Installed package chunk is missing: ' + chunks[index].path));
                    return;
                }
                controller.enqueue(new Uint8Array(await chunkResponse.arrayBuffer()));
                index += 1;
            }
        });
        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(delivery.sourceBytes)
            }
        });
    }
    return null;
}

self.addEventListener('fetch', function (event) {
    var request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith((async function () {
        // Installer metadata and installation downloads explicitly use
        // cache:'no-store'. They must see the network so a new build can be
        // detected instead of being hidden behind the previous build cache.
        var bypassCache = request.cache === 'no-store';
        var cached = bypassCache ? null : await findCached(request);
        if (cached) return cached;

        if (bypassCache) {
            try {
                return await fetch(request);
            } catch (networkError) {
                cached = await findCached(request);
                if (cached) return cached;
                throw networkError;
            }
        }

        var reconstructed = await findChunkedPackage(request);
        if (reconstructed) return reconstructed;

        // A GitHub Pages navigation is commonly requested as /lightender/,
        // while the installer caches index.html explicitly.
        if (request.mode === 'navigate') {
            var indexRequest = new Request(new URL('index.html', request.url).toString(), {
                method: 'GET',
                credentials: 'same-origin'
            });
            cached = await findCached(indexRequest);
            if (cached) return cached;
        }

        return fetch(request);
    }()).catch(function (error) {
        if (request.mode === 'navigate') {
            return new Response('Lightender is installed, but this page is unavailable offline.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }
        throw error;
    }));
});
