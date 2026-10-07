/*
 * RTEC PHC Field Reporting — single source of truth for the build
 * identifier. Shared between the page (app.js, which displays it on the
 * home screen so a tech can read off exactly what's running) and the
 * service worker (sw.js, which uses it as CACHE_VERSION) via
 * importScripts(), so there is exactly one place to bump per release
 * instead of two that can drift out of sync.
 *
 * Works in both contexts: `self` is the global object in both a plain
 * page script and a service worker (service workers have no `window`).
 */
self.PHC_BUILD_VERSION = 'phc-field-v14';
